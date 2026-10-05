import type { CanonPolicyId, RulesetId, SourceAuthorityRecordId, SourceDocumentId } from "./ids.js";
import { isSourceAuthorityStatus, type SourceAuthorityStatus } from "./source-authority-status.js";
import { isValidSourceAuthorityScopeKey } from "./source-authority-scope.js";

/**
 * A CanonPolicy — an immutable historical SNAPSHOT of how authoritative each
 * SourceDocument is within one Ruleset (PAS-10 M2-WO4).
 *
 * ```
 * Ruleset
 *  ├── Canon Policy 1
 *  │     ├── Source A / global → CURRENT_PRIMARY
 *  │     └── Source B / global → CURRENT_SUPPLEMENTAL
 *  └── Canon Policy 2
 *        ├── Source A / global → SUPERSEDED
 *        └── Source B / global → CURRENT_PRIMARY
 * ```
 *
 * A Ruleset has many policies over time; to change source authority you create
 * policy N+1, never edit one. `policyVersion` is allocated automatically (1, 2,
 * 3 … per Ruleset) and is never supplied by a caller.
 *
 * This is GOVERNANCE METADATA ONLY. A policy never selects an EntityVersion,
 * alters a manifest, overrides an explicit pin or an inherited one, changes a
 * lifecycle status, or makes anything Canon. There is deliberately no "current",
 * "active", or "effective" policy: the highest `policyVersion` is only ever the
 * "Latest Canon Policy", a deterministic convenience.
 */
export interface CanonPolicy {
  id: CanonPolicyId;
  rulesetId: RulesetId;
  /** Positive, unique within the Ruleset, automatically allocated. Never the identity. */
  policyVersion: number;
  name: string;
  description: string | null;
  createdAt: Date;
}

/**
 * One declaration inside one policy snapshot: "in this policy, this
 * SourceDocument has this authority within this scope".
 *
 * Distinct from `SourceDocument.authorityStatus`, which is descriptive metadata
 * carried by the document itself. The two are never copied or synchronized: a
 * document can be PLAYTEST_REFERENCE on its own, GOVERNING in one Ruleset's
 * policy, and REFERENCE_ONLY in another's.
 */
export interface SourceAuthorityRecord {
  id: SourceAuthorityRecordId;
  canonPolicyId: CanonPolicyId;
  sourceDocumentId: SourceDocumentId;
  /** `global`, or a dotted machine-readable scope such as `entity_type.spell_effect`. */
  scopeKey: string;
  authorityStatus: SourceAuthorityStatus;
  rationale: string | null;
  createdAt: Date;
}

/** A policy together with its declarations, ordered by scope key then source document id. */
export interface CanonPolicyWithAuthorities extends CanonPolicy {
  authorities: SourceAuthorityRecord[];
}

export interface CreateSourceAuthorityRecordInput {
  sourceDocumentId: string;
  scopeKey: string;
  authorityStatus: string;
  rationale?: string | null;
}

/**
 * What a caller may supply. There is intentionally NO `policyVersion` (always
 * allocated) and nothing that selects content.
 */
export interface CreateCanonPolicyInput {
  name: string;
  description?: string | null;
  /** May be empty: an empty snapshot declares no Ruleset-scoped authority, so every lookup resolves UNRESOLVED. */
  authorities: CreateSourceAuthorityRecordInput[];
}

export const MAX_CANON_POLICY_NAME_LENGTH = 200;
export const MAX_AUTHORITY_RATIONALE_LENGTH = 2000;
/** A documented bound so one request cannot create an unbounded snapshot. */
export const MAX_CANON_POLICY_AUTHORITIES = 10_000;

export interface CanonPolicyInputProblem {
  kind: "INVALID_INPUT" | "INVALID_SCOPE" | "DUPLICATE_SOURCE_SCOPE";
  message: string;
}

const normalizeId = (value: string) => value.trim().toLowerCase();

/**
 * Pure, shape-only validation; returns the first problem found, or `null`.
 *
 * Shape, scope and status problems are reported (in input order) before
 * duplicates. A duplicate is the same SourceDocument + scope twice (document ids
 * compared case-insensitively); the same document in two DIFFERENT scopes is
 * valid. Whether the Ruleset and each SourceDocument exist is a persistence
 * question for the service.
 */
export function validateCreateCanonPolicyInput(input: CreateCanonPolicyInput): CanonPolicyInputProblem | null {
  if (typeof input !== "object" || input === null) {
    return { kind: "INVALID_INPUT", message: "input must be an object" };
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return { kind: "INVALID_INPUT", message: "name is required and must not be empty" };
  }
  if (input.name.trim().length > MAX_CANON_POLICY_NAME_LENGTH) {
    return { kind: "INVALID_INPUT", message: `name must be at most ${MAX_CANON_POLICY_NAME_LENGTH} characters` };
  }
  if (input.description !== undefined && input.description !== null && typeof input.description !== "string") {
    return { kind: "INVALID_INPUT", message: "description, when supplied, must be a string" };
  }
  if (!Array.isArray(input.authorities)) {
    return { kind: "INVALID_INPUT", message: "authorities is required and must be an array (it may be empty)" };
  }
  if (input.authorities.length > MAX_CANON_POLICY_AUTHORITIES) {
    return { kind: "INVALID_INPUT", message: `a policy may contain at most ${MAX_CANON_POLICY_AUTHORITIES} authority records` };
  }

  for (const [index, authority] of input.authorities.entries()) {
    if (typeof authority !== "object" || authority === null) {
      return { kind: "INVALID_INPUT", message: `authorities[${index}] must be an object` };
    }
    if (typeof authority.sourceDocumentId !== "string" || authority.sourceDocumentId.trim().length === 0) {
      return { kind: "INVALID_INPUT", message: `authorities[${index}].sourceDocumentId is required` };
    }
    if (!isValidSourceAuthorityScopeKey(authority.scopeKey)) {
      return {
        kind: "INVALID_SCOPE",
        message: `authorities[${index}].scopeKey is not a valid scope key: ${JSON.stringify(authority.scopeKey)}`,
      };
    }
    if (typeof authority.authorityStatus !== "string" || !isSourceAuthorityStatus(authority.authorityStatus)) {
      return {
        kind: "INVALID_INPUT",
        message: `authorities[${index}].authorityStatus is not a recognized SourceAuthorityStatus: ${JSON.stringify(authority.authorityStatus)}`,
      };
    }
    if (authority.rationale !== undefined && authority.rationale !== null) {
      if (typeof authority.rationale !== "string") {
        return { kind: "INVALID_INPUT", message: `authorities[${index}].rationale, when supplied, must be a string` };
      }
      if (authority.rationale.length > MAX_AUTHORITY_RATIONALE_LENGTH) {
        return { kind: "INVALID_INPUT", message: `authorities[${index}].rationale must be at most ${MAX_AUTHORITY_RATIONALE_LENGTH} characters` };
      }
    }
  }

  const seen = new Set<string>();
  for (const authority of input.authorities) {
    const key = `${normalizeId(authority.sourceDocumentId)}|${authority.scopeKey}`;
    if (seen.has(key)) {
      return {
        kind: "DUPLICATE_SOURCE_SCOPE",
        message: `SourceDocument ${authority.sourceDocumentId} is declared more than once for scope ${authority.scopeKey}`,
      };
    }
    seen.add(key);
  }
  return null;
}
