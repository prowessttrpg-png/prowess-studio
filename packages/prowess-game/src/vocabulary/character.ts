import { deepFreeze } from "../internal/plain-data.js";

/**
 * Character-creation vocabulary (PAS-10 M6-WO3). Closed, deep-frozen lists for the character-facing Definition
 * contracts ANCESTRY v1, SKILL v1 and CHARACTER_CREATION_RULE v1. These are grammar tokens only — every number a
 * Character is built from (Stat bounds, point budget, Skill counts, Base HP / MP, grant amounts) is authored Definition
 * content pinned by the Character's exact Release, never a constant here.
 */

/** How an Ancestry Stat grant is applied: a fixed Stat, or a player choice of distinct Stats. */
export const ANCESTRY_STAT_GRANT_KINDS = deepFreeze(["FIXED", "CHOOSE_DISTINCT"] as const);
export type AncestryStatGrantKind = (typeof ANCESTRY_STAT_GRANT_KINDS)[number];

/**
 * How an Ancestry Skill grant selects its Skills: every listed Skill (FIXED), `count` of the listed Skills
 * (CHOOSE_FROM), or `count` of any SKILL the Character's Release publishes (CHOOSE_ANY).
 */
export const ANCESTRY_SKILL_SELECTION_KINDS = deepFreeze(["FIXED", "CHOOSE_FROM", "CHOOSE_ANY"] as const);
export type AncestrySkillSelectionKind = (typeof ANCESTRY_SKILL_SELECTION_KINDS)[number];

/** Where a Character's starting Skill rank came from. Extensible domain token (WO4 adds advancement sources). */
export const CHARACTER_SKILL_SOURCE_KINDS = deepFreeze(["ANCESTRY", "FREE"] as const);
export type CharacterSkillSourceKind = (typeof CHARACTER_SKILL_SOURCE_KINDS)[number];

/**
 * The AFFINITY payload schema versions that are executable (M5-WO4: version 1 is identity-only history; version 2 is
 * the executable Affinity). A Primary Affinity must be an executable AFFINITY Definition.
 */
export const EXECUTABLE_AFFINITY_SCHEMA_VERSIONS = deepFreeze([2] as const);

/**
 * The derived statistics a Release must define for the Character Creation preview to be meaningful: the core character
 * resources and the Signature Ability capacity (M5-WO2 / M5-WO5 DERIVED_STAT content). Others are previewed when
 * present.
 */
export const CHARACTER_CREATION_REQUIRED_DERIVED_STATISTICS = deepFreeze(["MAXIMUM_HP", "MAXIMUM_MP", "SIGNATURE_ABILITY_SLOTS"] as const);
