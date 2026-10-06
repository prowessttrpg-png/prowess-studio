import type { RuleConflictStatus } from "./rule-conflict-status.js";

/**
 * The terminal state a CanonDecision moves its RuleConflict into (PAS-10 M2-WO6 §7, §8).
 *
 * Distinct from the decision TYPE: the type says what governance action was taken, the
 * disposition says how the conflict ended. KEEP_SEPARATE + ACCEPTED_DIVERGENCE, for example.
 * Every value is also a RuleConflictStatus of the same name, and that identity mapping is the
 * ONLY status transition a conflict can undergo (a type-level check below keeps it exact).
 * Kept in lockstep with the Prisma `CanonConflictDisposition` enum (static audit).
 */
export const CANON_CONFLICT_DISPOSITIONS = ["RESOLVED", "ACCEPTED_DIVERGENCE", "DISMISSED"] as const;

export type CanonConflictDisposition = (typeof CANON_CONFLICT_DISPOSITIONS)[number];

export function isCanonConflictDisposition(value: string): value is CanonConflictDisposition {
  return (CANON_CONFLICT_DISPOSITIONS as readonly string[]).includes(value);
}

/** Compile-time proof that every disposition is a RuleConflictStatus. */
const dispositionIsStatus: (d: CanonConflictDisposition) => RuleConflictStatus = (d) => d;

/** The RuleConflict status a disposition produces: always the status of the same name (§8). */
export function ruleConflictStatusForDisposition(disposition: CanonConflictDisposition): RuleConflictStatus {
  return dispositionIsStatus(disposition);
}
