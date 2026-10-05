/**
 * How urgently a RuleConflict deserves review (PAS-10 M2-WO5 §6), lowest first.
 *
 * GOVERNANCE METADATA ONLY — it may later order a review queue. It never selects a
 * candidate, blocks manifest resolution, changes a Ruleset's status, changes a
 * CanonPolicy, changes an EntityVersion's status, or alters mechanics: a CRITICAL
 * conflict changes nothing anywhere except the row that records it. Kept in lockstep
 * with the Prisma `RuleConflictSeverity` enum (static audit).
 */
export const RULE_CONFLICT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type RuleConflictSeverity = (typeof RULE_CONFLICT_SEVERITIES)[number];

export function isRuleConflictSeverity(value: string): value is RuleConflictSeverity {
  return (RULE_CONFLICT_SEVERITIES as readonly string[]).includes(value);
}
