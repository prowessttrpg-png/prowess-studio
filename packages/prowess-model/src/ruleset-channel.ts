/**
 * Release channel of a Ruleset — classification metadata aligned with PAS-08
 * (PAS-10 M2-WO1 §7).
 *
 * A channel does NOT itself publish the Ruleset, select EntityVersions, change
 * Canon, or alter any game mechanic; nothing in the system behaves differently
 * based on a Ruleset's channel in M2-WO1. Kept in lockstep with the Prisma
 * `RulesetChannel` enum (enforced by the static audit).
 */
export const RULESET_CHANNELS = [
  "DEVELOPMENT",
  "INTERNAL_PLAYTEST",
  "CORE_PLAYTEST",
  "EXPERIMENTAL",
  "STABLE",
  "LEGACY",
] as const;

export type RulesetChannel = (typeof RULESET_CHANNELS)[number];

export function isRulesetChannel(value: string): value is RulesetChannel {
  return (RULESET_CHANNELS as readonly string[]).includes(value);
}
