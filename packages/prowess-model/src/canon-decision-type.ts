/**
 * What governance action a CanonDecision records (PAS-10 M2-WO6 §6) — the conflict-resolution
 * subset of the PAS-08 CanonDecision vocabulary.
 *
 *   SELECT_RULE       one existing candidate is the governance-preferred interpretation
 *   KEEP_SEPARATE     two or more candidates intentionally remain distinct (accepted divergence)
 *   MERGE             two or more candidates were reconciled into another exact EntityVersion
 *   RESOLVE_CONFLICT  a generic resolution or dismissal that selects no particular candidate
 *
 * GOVERNANCE RECORDS ONLY. SELECT_RULE does not make a Version active or Canon, MERGE does not
 * merge rules text or JSON, KEEP_SEPARATE creates no package, RESOLVE_CONFLICT rewrites nothing.
 * Other PAS-08 types (RENAME, DEPRECATE, AUTHORIZE_EXPERIMENT, PROMOTE, ROLLBACK,
 * SOURCE_AUTHORITY_CHANGE) are deliberately absent until their workflows exist. Kept in lockstep
 * with the Prisma `CanonDecisionType` enum (static audit).
 */
export const CANON_DECISION_TYPES = ["SELECT_RULE", "KEEP_SEPARATE", "MERGE", "RESOLVE_CONFLICT"] as const;

export type CanonDecisionType = (typeof CANON_DECISION_TYPES)[number];

export function isCanonDecisionType(value: string): value is CanonDecisionType {
  return (CANON_DECISION_TYPES as readonly string[]).includes(value);
}
