/**
 * Governance state of a RuleConflict (PAS-10 M2-WO5 §7, §8).
 *
 *   OPEN                 recorded; nobody has started reviewing it
 *   UNDER_REVIEW         review in progress
 *   RESOLVED             a governance outcome was reached
 *   ACCEPTED_DIVERGENCE  the difference is INTENTIONAL: both forms may stay valid in distinct
 *                        Ruleset / rule-package contexts (e.g. a simple top-to-bottom Effect
 *                        Chain in Core Playtest, an advanced branching one in Experimental).
 *                        Not an error, and not a "one universal winner" outcome.
 *   DISMISSED            not a real conflict after all
 *
 * The full lifecycle shape is declared now so it is explicit, but M2-WO5 creates every
 * conflict OPEN and exposes NO way to change the status. How a conflict reaches
 * UNDER_REVIEW or a terminal state is owned by M2-WO6 (Canon Decisions), which will also
 * record the decision itself. Kept in lockstep with the Prisma `RuleConflictStatus` enum.
 */
export const RULE_CONFLICT_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "ACCEPTED_DIVERGENCE", "DISMISSED"] as const;

export type RuleConflictStatus = (typeof RULE_CONFLICT_STATUSES)[number];

/** The only status a conflict can be created with in M2-WO5 — never caller-supplied. */
export const INITIAL_RULE_CONFLICT_STATUS = "OPEN" satisfies RuleConflictStatus;

export function isRuleConflictStatus(value: string): value is RuleConflictStatus {
  return (RULE_CONFLICT_STATUSES as readonly string[]).includes(value);
}
