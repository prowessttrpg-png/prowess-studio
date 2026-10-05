import {
  CANON_POLICY_ERROR_CODES,
  DomainError,
  GLOBAL_SOURCE_AUTHORITY_SCOPE,
  isValidSourceAuthorityScopeKey,
  resolveAuthorityFromDeclarations,
  SOURCE_AUTHORITY_ERROR_CODES,
  validateCreateCanonPolicyInput,
  type CanonPolicy,
  type CanonPolicyWithAuthorities,
  type CreateCanonPolicyInput,
  type SourceAuthorityRecord,
  type SourceAuthorityResolution,
  type SourceAuthorityStatus,
} from "@prowess/model";
import { selectRulesetById } from "../ruleset/repository.js";
import { selectSourceDocumentById } from "../source-document/repository.js";
import {
  insertCanonPolicyWithAuthorities,
  isPolicyVersionViolation,
  isSourceScopeDuplicateViolation,
  selectCanonPoliciesByRuleset,
  selectCanonPolicyById,
  selectCanonPolicyWithAuthorities,
  selectLatestCanonPolicy,
  selectSourceAuthorityRecord,
  type AuthorityInsert,
} from "./repository.js";

/**
 * CanonPolicy service (PAS-10 M2-WO4) — Ruleset-scoped source-authority snapshots.
 *
 * What a policy is: governance metadata that INFORMS later Canon and conflict
 * decisions. What it is NOT: nothing here selects an EntityVersion, reads or alters
 * a manifest, overrides an explicit or inherited pin, changes a lifecycle status, or
 * makes anything Canon. The only "resolution" is of AUTHORITY, inside ONE policy:
 * exact scope, then `global`, then UNRESOLVED — never another policy, never a parent
 * Ruleset's policy, never inferred from dates, labels, counts, statuses, or channels.
 *
 * Deliberately absent: any operation that changes a policy or its records after
 * creation. To change source authority, create policy N+1. A static audit scans this
 * directory for the identifiers that would break any of this.
 */

const normalizeId = (value: string) => value.trim().toLowerCase();

async function requireRuleset(rulesetId: string) {
  const ruleset = await selectRulesetById(rulesetId);
  if (ruleset === null) {
    throw new DomainError(CANON_POLICY_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  }
  return ruleset;
}

async function requirePolicy(policyId: string): Promise<CanonPolicy> {
  const policy = await selectCanonPolicyById(policyId);
  if (policy === null) {
    throw new DomainError(CANON_POLICY_ERROR_CODES.NOT_FOUND, `CanonPolicy not found: ${policyId}`);
  }
  return policy;
}

function requireValidScope(scopeKey: string): void {
  if (!isValidSourceAuthorityScopeKey(scopeKey)) {
    throw new DomainError(SOURCE_AUTHORITY_ERROR_CODES.INVALID_SCOPE, `Not a valid scope key: ${JSON.stringify(scopeKey)}`);
  }
}

/**
 * Creates the next policy for a Ruleset, atomically, with exactly the supplied
 * authority declarations. `policy_version` is allocated automatically — the input
 * has no field for it.
 *
 * Validation, in this order — the first failure is reported and NOTHING is written:
 *   1. input shape, scope keys, statuses       -> INVALID_INPUT / INVALID_SCOPE
 *   2. the same SourceDocument + scope twice   -> DUPLICATE_SOURCE_SCOPE
 *   3. the Ruleset exists                      -> RULESET_NOT_FOUND
 *   4. every SourceDocument exists             -> SOURCE_NOT_FOUND
 *   5. write policy + records in ONE transaction; a concurrent allocation loser
 *      retries, and only an exhausted retry budget -> VERSION_CONFLICT.
 *
 * An EMPTY authorities list is allowed: an empty snapshot declares no Ruleset-scoped
 * authority, so every lookup against it resolves UNRESOLVED.
 */
export async function createCanonPolicy(rulesetId: string, input: CreateCanonPolicyInput): Promise<CanonPolicyWithAuthorities> {
  const problem = validateCreateCanonPolicyInput(input);
  if (problem !== null) {
    if (problem.kind === "INVALID_SCOPE") {
      throw new DomainError(SOURCE_AUTHORITY_ERROR_CODES.INVALID_SCOPE, problem.message);
    }
    if (problem.kind === "DUPLICATE_SOURCE_SCOPE") {
      throw new DomainError(SOURCE_AUTHORITY_ERROR_CODES.DUPLICATE_SOURCE_SCOPE, problem.message);
    }
    throw new DomainError(CANON_POLICY_ERROR_CODES.INVALID_INPUT, problem.message);
  }

  const ruleset = await requireRuleset(rulesetId);

  const records: AuthorityInsert[] = [];
  for (const authority of input.authorities) {
    const document = await selectSourceDocumentById(normalizeId(authority.sourceDocumentId));
    if (document === null) {
      throw new DomainError(SOURCE_AUTHORITY_ERROR_CODES.SOURCE_NOT_FOUND, `SourceDocument not found: ${authority.sourceDocumentId}`);
    }
    records.push({
      sourceDocumentId: document.id,
      scopeKey: authority.scopeKey,
      authorityStatus: authority.authorityStatus as SourceAuthorityStatus, // validated above
      rationale: authority.rationale ?? null,
    });
  }

  try {
    return await insertCanonPolicyWithAuthorities(ruleset.id, input.name.trim(), input.description ?? null, records);
  } catch (error) {
    if (isPolicyVersionViolation(error)) {
      throw new DomainError(
        CANON_POLICY_ERROR_CODES.VERSION_CONFLICT,
        `Could not allocate a policy_version for Ruleset ${ruleset.id} after repeated concurrent creations; the request is safe to retry`,
      );
    }
    if (isSourceScopeDuplicateViolation(error)) {
      throw new DomainError(SOURCE_AUTHORITY_ERROR_CODES.DUPLICATE_SOURCE_SCOPE, "A policy declares one authority per SourceDocument per scope");
    }
    throw error;
  }
}

/** By explicit identity: absence is exceptional (`CANON_POLICY.NOT_FOUND`), including a malformed id. */
export async function getCanonPolicy(policyId: string): Promise<CanonPolicyWithAuthorities> {
  const policy = await selectCanonPolicyWithAuthorities(policyId);
  if (policy === null) {
    throw new DomainError(CANON_POLICY_ERROR_CODES.NOT_FOUND, `CanonPolicy not found: ${policyId}`);
  }
  return policy;
}

/**
 * A Ruleset's policies, ordered `policy_version ASC` (headers only; use
 * `getCanonPolicy` for the declarations). A Ruleset with no policies yet lists as
 * empty; a Ruleset that does not exist is `RULESET_NOT_FOUND` — different facts.
 */
export async function listCanonPolicies(rulesetId: string): Promise<CanonPolicy[]> {
  const ruleset = await requireRuleset(rulesetId);
  return selectCanonPoliciesByRuleset(ruleset.id);
}

/**
 * The "Latest Canon Policy": the one with the highest policy_version, or `null` if the
 * Ruleset has none. A deterministic historical convenience ONLY — it is not the
 * active, current, or effective policy, and nothing treats it as in force.
 */
export async function getLatestCanonPolicy(rulesetId: string): Promise<CanonPolicyWithAuthorities | null> {
  const ruleset = await requireRuleset(rulesetId);
  const highest = await selectLatestCanonPolicy(ruleset.id);
  return highest === null ? null : selectCanonPolicyWithAuthorities(highest.id);
}

/**
 * The declaration for EXACTLY this (policy, document, scope), or `null` when there is
 * none. Exact lookup only: no fallback to `global`, no other policy. A malformed scope
 * is `SOURCE_AUTHORITY.INVALID_SCOPE`; an unknown policy is `CANON_POLICY.NOT_FOUND`.
 */
export async function getSourceAuthorityRecord(
  policyId: string,
  sourceDocumentId: string,
  scopeKey: string,
): Promise<SourceAuthorityRecord | null> {
  const policy = await requirePolicy(policyId);
  requireValidScope(scopeKey);
  return selectSourceAuthorityRecord(policy.id, normalizeId(sourceDocumentId), scopeKey);
}

/**
 * A SourceDocument's authority within one policy, with the scope that answered:
 *
 *   1. the declaration at exactly the requested scope  -> EXACT
 *   2. else, if that scope is not `global`, the `global` declaration
 *                                                       -> GLOBAL_FALLBACK
 *   3. else                                             -> UNRESOLVED
 *
 * UNRESOLVED is derived, never written: no row is created for "nothing declared". It is
 * not an error either, and it does not require the SourceDocument to exist. The ONLY
 * fallback is within this policy — never another policy, never a parent Ruleset's.
 */
export async function resolveSourceAuthority(
  policyId: string,
  sourceDocumentId: string,
  scopeKey: string,
): Promise<SourceAuthorityResolution> {
  const policy = await requirePolicy(policyId);
  requireValidScope(scopeKey);
  const documentId = normalizeId(sourceDocumentId);

  const exact = await selectSourceAuthorityRecord(policy.id, documentId, scopeKey);
  const global =
    scopeKey === GLOBAL_SOURCE_AUTHORITY_SCOPE ? null : await selectSourceAuthorityRecord(policy.id, documentId, GLOBAL_SOURCE_AUTHORITY_SCOPE);

  return resolveAuthorityFromDeclarations({
    policyId: policy.id,
    sourceDocumentId: documentId,
    requestedScopeKey: scopeKey,
    exact: exact === null ? null : exact.authorityStatus,
    global: global === null ? null : global.authorityStatus,
  });
}
