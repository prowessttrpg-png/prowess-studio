/**
 * Governance lifecycle of a Ruleset (PAS-10 M2-WO1 §6).
 *
 * Deliberately its OWN vocabulary — not `EntityVersionStatus`, even though some
 * labels (DRAFT, IN_REVIEW, APPROVED, ARCHIVED) overlap. They describe different
 * things: an EntityVersion's status is the maturity of one piece of authored
 * content; a Ruleset's status is the governance state of a whole named rules
 * configuration. Five labels happen to overlap (DRAFT, IN_REVIEW, APPROVED, DEPRECATED,
 * ARCHIVED) yet mean different things for the two subjects; `PUBLISHED` exists only
 * here, while PLAYTEST, CANON and SUPERSEDED exist only on EntityVersion.
 *
 * A status is descriptive metadata. It does NOT make any EntityVersion Canon,
 * select any content, or change any rule (PAS-10 M2-WO1 §20). Kept in lockstep
 * with the Prisma `RulesetStatus` enum (enforced by the M1/M2 static audit).
 */
export const RULESET_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "DEPRECATED",
  "ARCHIVED",
] as const;

export type RulesetStatus = (typeof RULESET_STATUSES)[number];

export function isRulesetStatus(value: string): value is RulesetStatus {
  return (RULESET_STATUSES as readonly string[]).includes(value);
}
