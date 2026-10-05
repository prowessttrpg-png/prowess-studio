/**
 * What kind of disagreement a RuleConflict records (PAS-10 M2-WO5 §5).
 *
 *   SOURCE_CONTRADICTION         source material gives incompatible statements
 *   MECHANICAL_DIVERGENCE        mechanical behavior / formulas / rules disagree
 *   TERMINOLOGY_DIVERGENCE       names or vocabulary differ while possibly meaning the same concept
 *   STRUCTURAL_DIVERGENCE        competing models organize the same rule or content differently
 *   AUTHORING_STANDARD_CONFLICT  content violates or conflicts with an approved design/authoring standard
 *   OTHER                        a legitimate governance conflict outside the categories above
 *
 * CLASSIFICATION ONLY. No type carries behavior: creating a MECHANICAL_DIVERGENCE
 * conflict never invokes the Rules Engine, and an AUTHORING_STANDARD_CONFLICT never
 * edits EntityVersion data. Nothing in `@prowess/model` or `@prowess/db` branches on
 * this value. Kept in lockstep with the Prisma `RuleConflictType` enum (static audit).
 */
export const RULE_CONFLICT_TYPES = [
  "SOURCE_CONTRADICTION",
  "MECHANICAL_DIVERGENCE",
  "TERMINOLOGY_DIVERGENCE",
  "STRUCTURAL_DIVERGENCE",
  "AUTHORING_STANDARD_CONFLICT",
  "OTHER",
] as const;

export type RuleConflictType = (typeof RULE_CONFLICT_TYPES)[number];

export function isRuleConflictType(value: string): value is RuleConflictType {
  return (RULE_CONFLICT_TYPES as readonly string[]).includes(value);
}
