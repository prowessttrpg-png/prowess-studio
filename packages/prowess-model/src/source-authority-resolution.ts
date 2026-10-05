import { CanonPolicyId, SourceDocumentId } from "./ids.js";
import { GLOBAL_SOURCE_AUTHORITY_SCOPE } from "./source-authority-scope.js";
import type { SourceAuthorityStatus } from "./source-authority-status.js";

/**
 * Resolving a SourceDocument's authority within ONE CanonPolicy (PAS-10 M2-WO4 §16-§18).
 *
 * The only fallback is inside the SAME policy:
 *
 *   exact requested scope  →  `global`  →  UNRESOLVED
 *
 * It never reads another policy (each policy is a complete historical snapshot),
 * never consults a parent Ruleset's policy, and never infers authority from
 * anything — dates, version labels, reference counts, lifecycle status, Ruleset
 * channel. Authority is explicitly authored or it is UNRESOLVED.
 *
 * `source` is a domain-only, transient distinction: it is deliberately NOT a
 * Prisma enum, and an UNRESOLVED answer is never persisted as a row.
 */
export const SOURCE_AUTHORITY_RESOLUTION_SOURCES = ["EXACT", "GLOBAL_FALLBACK", "UNRESOLVED"] as const;
export type SourceAuthorityResolutionSource = (typeof SOURCE_AUTHORITY_RESOLUTION_SOURCES)[number];

export interface SourceAuthorityResolution {
  policyId: CanonPolicyId;
  sourceDocumentId: SourceDocumentId;
  requestedScopeKey: string;
  /** The scope whose declaration answered, or `null` when UNRESOLVED. */
  resolvedScopeKey: string | null;
  authorityStatus: SourceAuthorityStatus;
  source: SourceAuthorityResolutionSource;
}

export interface SourceAuthorityDeclarations {
  policyId: string;
  sourceDocumentId: string;
  requestedScopeKey: string;
  /** The status declared at exactly `requestedScopeKey` in this policy, or null if none. */
  exact: SourceAuthorityStatus | null;
  /** The status declared at `global` in this policy, or null. Consulted only when the requested scope is not itself `global`. */
  global: SourceAuthorityStatus | null;
}

/**
 * Pure and storage-independent: the persistence layer looks up the (at most) two
 * declarations, this applies the rule.
 *
 * A declaration that is itself `UNRESOLVED` is still a declaration — it answers
 * EXACT and blocks the global fallback — because "exact scope record exists" is
 * the rule, not "exact scope record says something useful".
 */
export function resolveAuthorityFromDeclarations(input: SourceAuthorityDeclarations): SourceAuthorityResolution {
  const base = {
    policyId: CanonPolicyId.of(input.policyId),
    sourceDocumentId: SourceDocumentId.of(input.sourceDocumentId),
    requestedScopeKey: input.requestedScopeKey,
  };
  if (input.exact !== null) {
    return { ...base, resolvedScopeKey: input.requestedScopeKey, authorityStatus: input.exact, source: "EXACT" };
  }
  if (input.requestedScopeKey !== GLOBAL_SOURCE_AUTHORITY_SCOPE && input.global !== null) {
    return { ...base, resolvedScopeKey: GLOBAL_SOURCE_AUTHORITY_SCOPE, authorityStatus: input.global, source: "GLOBAL_FALLBACK" };
  }
  return { ...base, resolvedScopeKey: null, authorityStatus: "UNRESOLVED", source: "UNRESOLVED" };
}
