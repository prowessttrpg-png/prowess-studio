import { deepFreeze } from "../internal/plain-data.js";

/**
 * Shared Ability Construction legality vocabulary (PAS-10 M5-WO5). Each list is a closed CLASSIFICATION — a name for a
 * concept the construction compiler understands. None carries a number: capacities, rank floors, the Spell Trait
 * exchange, minimum Effects and the Signature slot policy are versioned ABILITY_CONSTRUCTION_RULE content
 * (`content/core-playtest-v0.1/ability-construction.json`), executed by M4 (§120–§127).
 */

/**
 * The Skill whose rank a construction track reads (§17–§19). ARCANE = the Arcana Skill's rank (M5-SC-011, M5-I153);
 * MARTIAL = the Martial Skill's rank (WO5 ruling §6.2). Neither is a separate progression track: the rank always comes
 * from the character's Skill ranks on the existing SKILL ladder (§43–§44).
 */
export const CONSTRUCTION_SKILL_TRACKS = deepFreeze(["ARCANE", "MARTIAL"] as const);
export type ConstructionSkillTrack = (typeof CONSTRUCTION_SKILL_TRACKS)[number];

/**
 * Explicit, structured component prerequisites WO5 executes (§36–§39). Each compiles to an M4 Requirement. Anything
 * else (STAT_AT_LEAST, EXACT_DEFINITION_REQUIRED …) is refused until a Definition needs it — never parsed from prose.
 */
export const CONSTRUCTION_PREREQUISITE_KINDS = deepFreeze(["SKILL_RANK_AT_LEAST", "AFFINITY_RANK_AT_LEAST"] as const);
export type ConstructionPrerequisiteKind = (typeof CONSTRUCTION_PREREQUISITE_KINDS)[number];

/**
 * Where a stackable Effect's authored stack limit comes from (§55). FIXED: an authored maximum. TRACK_RANK_VALUE: the
 * Rank Value the construction rule authors for the character's rank on a named track — only when the Effect says so;
 * there is no universal rank-derived limit (§56, WO5 ruling §6.8).
 */
export const STACK_LIMIT_KINDS = deepFreeze(["FIXED", "TRACK_RANK_VALUE"] as const);
export type StackLimitKind = (typeof STACK_LIMIT_KINDS)[number];

/**
 * How a candidate Ability uses Signature Ability slots (§46–§48). DEFAULT consumes the rule's default slot cost; EXEMPT
 * consumes none and must name an exemption the exact construction rule authors (§47–§48). There is no anonymous
 * `isFree` flag.
 */
export const SIGNATURE_SLOT_USES = deepFreeze(["DEFAULT", "EXEMPT"] as const);
export type SignatureSlotUse = (typeof SIGNATURE_SLOT_USES)[number];

/** The only Casting Condition capacity source (WO5 ruling §6.5, M5-I157): Arcane Rank — never the Spell's Authority. */
export const CASTING_CONDITION_CAPACITY_SOURCES = deepFreeze(["ARCANE_RANK"] as const);
/** Affinity Authority capacity is the WO4 AFFINITY_RANK_RULE table, reused — never a second table (§122). */
export const AFFINITY_AUTHORITY_CAPACITY_SOURCES = deepFreeze(["AFFINITY_RANK_RULE"] as const);

/**
 * The construction access path a result reports (§92). A Spell names one explicit Authority (§21); a Maneuver is built
 * through Martial training (§12, M5-I158).
 */
export const CONSTRUCTION_ACCESS_PATHS = deepFreeze(["ARCANE_AUTHORITY", "AFFINITY_AUTHORITY", "MARTIAL"] as const);
export type ConstructionAccessPath = (typeof CONSTRUCTION_ACCESS_PATHS)[number];

/** The legality rule families a construction result reports, one per compiled Requirement family (§92–§94). */
export const CONSTRUCTION_RULE_FAMILIES = deepFreeze([
  "ACCESS",
  "EFFECT_CAPACITY",
  "MINIMUM_EFFECTS",
  "TRAIT_CAPACITY",
  "TRADE_LIMIT",
  "CONDITION_CAPACITY",
  "TARGETING_STRUCTURE",
  "FOUNDATION",
  "PREREQUISITE",
  "STACK_LIMIT",
  "AFFINITY_ACCESS",
  "SIGNATURE_EXEMPTION",
  "SIGNATURE_CAPACITY",
] as const);
export type ConstructionRuleFamily = (typeof CONSTRUCTION_RULE_FAMILIES)[number];
