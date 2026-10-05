import {
  CanonPolicyId,
  RulesetId,
  SourceAuthorityRecordId,
  SourceDocumentId,
  type CanonPolicy,
  type CanonPolicyWithAuthorities,
  type SourceAuthorityRecord,
  type SourceAuthorityStatus,
} from "@prowess/model";
import { prisma } from "../client.js";
import { isUniqueViolation } from "../prisma-errors.js";
import type {
  CanonPolicy as PrismaCanonPolicyRow,
  SourceAuthorityRecord as PrismaAuthorityRow,
} from "../../generated/prisma/client.js";

/**
 * CanonPolicy repository — the only place that speaks Prisma's policy API.
 * Internal to @prowess/db (not exported from `index.ts`); see `./service.ts`.
 *
 * It stores and returns exactly the declarations it is given. It never chooses an
 * EntityVersion, never reads a manifest, and never looks at a parent Ruleset or at
 * another policy: a policy is a complete, self-contained snapshot.
 */

export function toDomainCanonPolicy(row: PrismaCanonPolicyRow): CanonPolicy {
  return {
    id: CanonPolicyId.of(row.id),
    rulesetId: RulesetId.of(row.rulesetId),
    policyVersion: row.policyVersion,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
  };
}

export function toDomainAuthorityRecord(row: PrismaAuthorityRow): SourceAuthorityRecord {
  return {
    id: SourceAuthorityRecordId.of(row.id),
    canonPolicyId: CanonPolicyId.of(row.canonPolicyId),
    sourceDocumentId: SourceDocumentId.of(row.sourceDocumentId),
    scopeKey: row.scopeKey,
    authorityStatus: row.authorityStatus as SourceAuthorityStatus,
    rationale: row.rationale,
    createdAt: row.createdAt,
  };
}

export interface AuthorityInsert {
  sourceDocumentId: string;
  scopeKey: string;
  authorityStatus: SourceAuthorityStatus;
  rationale: string | null;
}

/**
 * How many times a policy_version allocation is attempted before giving up — the
 * same bounded-retry strategy as EntityVersion revisions and manifest versions.
 * Every round at least one contender wins, so up to this many SIMULTANEOUS creators
 * for one Ruleset are guaranteed to all succeed; beyond that the last unique
 * violation is rethrown (the service reports it as CANON_POLICY.VERSION_CONFLICT,
 * which is safe to retry).
 */
const MAX_POLICY_VERSION_ATTEMPTS = 8;

/**
 * Creates one policy and all of its authority records ATOMICALLY.
 *
 * One transaction: read this Ruleset's highest policy_version, insert the policy at
 * the next number, insert every record in order. If ANY step fails — including a
 * database-level rejection of a record — the whole transaction rolls back, so no
 * policy and no records persist and no version number is consumed. If another
 * request wins the same policy_version, UNIQUE(ruleset_id, policy_version) rejects
 * this attempt and it retries against a fresh maximum.
 */
export async function insertCanonPolicyWithAuthorities(
  rulesetId: string,
  name: string,
  description: string | null,
  authorities: readonly AuthorityInsert[],
): Promise<CanonPolicyWithAuthorities> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_POLICY_VERSION_ATTEMPTS; attempt++) {
    try {
      const policyId = await prisma.$transaction(async (tx) => {
        const highest = await tx.canonPolicy.findFirst({
          where: { rulesetId },
          orderBy: { policyVersion: "desc" },
          select: { policyVersion: true },
        });
        const nextPolicyVersion = (highest?.policyVersion ?? 0) + 1;

        const policy = await tx.canonPolicy.create({
          data: { rulesetId, policyVersion: nextPolicyVersion, name, description },
        });
        for (const authority of authorities) {
          await tx.sourceAuthorityRecord.create({
            data: {
              canonPolicyId: policy.id,
              sourceDocumentId: authority.sourceDocumentId,
              scopeKey: authority.scopeKey,
              authorityStatus: authority.authorityStatus,
              rationale: authority.rationale,
            },
          });
        }
        return policy.id;
      });

      const created = await selectCanonPolicyWithAuthorities(policyId);
      if (created === null) {
        throw new Error(`CanonPolicy ${policyId} disappeared immediately after commit`);
      }
      return created;
    } catch (error) {
      lastError = error;
      if (isPolicyVersionViolation(error)) {
        continue; // another request won this policy_version — retry against a fresh maximum
      }
      throw error;
    }
  }

  throw lastError;
}

/** UUID-safe: a malformed id simply finds nothing (never a raw database error). */
export async function selectCanonPolicyById(id: string): Promise<CanonPolicy | null> {
  try {
    const row = await prisma.canonPolicy.findUnique({ where: { id } });
    return row ? toDomainCanonPolicy(row) : null;
  } catch {
    return null;
  }
}

/** Ordered `scope_key ASC, source_document_id ASC` — deterministic (scope_key uses the database collation, like canonical keys). */
export async function selectSourceAuthorityRecords(canonPolicyId: string): Promise<SourceAuthorityRecord[]> {
  const rows = await prisma.sourceAuthorityRecord.findMany({
    where: { canonPolicyId },
    orderBy: [{ scopeKey: "asc" }, { sourceDocumentId: "asc" }],
  });
  return rows.map(toDomainAuthorityRecord);
}

export async function selectCanonPolicyWithAuthorities(id: string): Promise<CanonPolicyWithAuthorities | null> {
  const policy = await selectCanonPolicyById(id);
  if (policy === null) {
    return null;
  }
  return { ...policy, authorities: await selectSourceAuthorityRecords(policy.id) };
}

/** Ordered `policy_version ASC`. */
export async function selectCanonPoliciesByRuleset(rulesetId: string): Promise<CanonPolicy[]> {
  const rows = await prisma.canonPolicy.findMany({ where: { rulesetId }, orderBy: { policyVersion: "asc" } });
  return rows.map(toDomainCanonPolicy);
}

/**
 * The policy with the highest policy_version for a Ruleset — "Latest Canon Policy", a
 * deterministic convenience ONLY. It is not an active, current, or effective policy;
 * no such concept exists.
 */
export async function selectLatestCanonPolicy(rulesetId: string): Promise<CanonPolicy | null> {
  const row = await prisma.canonPolicy.findFirst({ where: { rulesetId }, orderBy: { policyVersion: "desc" } });
  return row ? toDomainCanonPolicy(row) : null;
}

/** One declaration, by EXACT (policy, document, scope). `null` when none — never a fallback. UUID-safe. */
export async function selectSourceAuthorityRecord(
  canonPolicyId: string,
  sourceDocumentId: string,
  scopeKey: string,
): Promise<SourceAuthorityRecord | null> {
  try {
    const row = await prisma.sourceAuthorityRecord.findUnique({
      where: { canonPolicyId_sourceDocumentId_scopeKey: { canonPolicyId, sourceDocumentId, scopeKey } },
    });
    return row ? toDomainAuthorityRecord(row) : null;
  } catch {
    return null;
  }
}

/**
 * Matched by constraint NAME — see `../prisma-errors.ts` for why `meta.target`
 * cannot be used with the Prisma 7 driver adapter.
 */
export function isPolicyVersionViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: "canon_policies_ruleset_id_policy_version_key",
    fields: ["ruleset_id", "policy_version"],
  });
}

export function isSourceScopeDuplicateViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: "source_authority_records_policy_source_scope_key",
    fields: ["canon_policy_id", "source_document_id", "scope_key"],
  });
}
