import { deepFreeze } from "../internal/plain-data.js";

/**
 * Core-resolution vocabulary (PAS-10 M5-WO2). These lists are IDENTITIES only: which Stats exist, which roll modes
 * exist, which procedures and derived statistics a CORE_RESOLUTION / DERIVED_STAT Definition may name. No list here
 * carries a number, a formula or a threshold — every mechanical value (score limits, die faces, level bands, rank
 * bonuses, formulas, the Stat Mastery threshold) is versioned Definition content in
 * `packages/prowess-game/content/core-playtest-v0.1/core-resolution.json`, executed by M4.
 */

/** The six Ability Scores (Core Playtest s20). Data identities owned by @prowess/game — @prowess/rules never names them. */
export const PROWESS_STATS = deepFreeze(["STR", "AGI", "CON", "PER", "RES", "PRO"] as const);
export type ProwessStat = (typeof PROWESS_STATS)[number];

/**
 * The exact M4 ActorContext stat key of each Stat. M4 context keys are lowercase dotted keys; this table is the only
 * place the two spellings meet, so no code case-folds a Stat token.
 */
export const STAT_CONTEXT_KEYS = deepFreeze({ STR: "str", AGI: "agi", CON: "con", PER: "per", RES: "res", PRO: "pro" } as const satisfies Record<ProwessStat, string>);

/**
 * The only roll states that exist (M5-SC-010, designer ruling): NORMAL, ADVANTAGE, DISADVANTAGE. There is no
 * double Advantage, no stacking and no cancellation. Both signals present is fail-closed (M5-SC-032).
 */
export const ROLL_MODES = deepFreeze(["NORMAL", "ADVANTAGE", "DISADVANTAGE"] as const);
export type RollMode = (typeof ROLL_MODES)[number];

/**
 * The runtime natural-roll variables each mode's natural-selection Formula must read — exactly these, in this order.
 * NORMAL reads one roll; ADVANTAGE / DISADVANTAGE read exactly two. The selection itself (r1, max, min) is Definition
 * content evaluated by M4, never TypeScript.
 */
export const ROLL_MODE_VARIABLES = deepFreeze({
  NORMAL: ["r1"],
  ADVANTAGE: ["r1", "r2"],
  DISADVANTAGE: ["r1", "r2"],
} as const satisfies Record<RollMode, readonly string[]>);

/** The RuntimeContext `state` key each natural-roll variable is bound from. */
export const ROLL_STATE_KEYS = deepFreeze({ r1: "roll.r1", r2: "roll.r2" } as const);

/** RuntimeContext `state` keys of the comparison inputs a roll is judged against. */
export const COMPARISON_STATE_KEYS = deepFreeze({ DIFFICULTY_CLASS: "roll.difficulty_class", TARGET_DODGE: "target.dodge" } as const);
export type ComparisonAgainst = keyof typeof COMPARISON_STATE_KEYS;
export const COMPARISON_TARGETS = deepFreeze(Object.keys(COMPARISON_STATE_KEYS) as ComparisonAgainst[]);

/** ActorContext `properties` keys the CharacterCore context builder writes. */
export const CHARACTER_PROPERTY_KEYS = deepFreeze({
  LEVEL: "character.level",
  BASE_HP: "character.base_hp",
  BASE_MP: "character.base_mp",
  CHARACTER_DIE_FACES: "character.die_faces",
} as const);
export type CharacterField = Exclude<keyof typeof CHARACTER_PROPERTY_KEYS, "CHARACTER_DIE_FACES">;
export const CHARACTER_FIELDS = deepFreeze(["LEVEL", "BASE_HP", "BASE_MP"] as const satisfies readonly CharacterField[]);

/** The core-resolution procedures a CORE_RESOLUTION Definition may define (one Definition per procedure). */
export const CORE_PROCEDURES = deepFreeze(["CORE_ROLL", "SKILL_CHECK", "SKILL_AUTOMATIC_SUCCESS", "SAVING_THROW", "ATTACK_ROLL", "STAT_MASTERY"] as const);
export type CoreProcedure = (typeof CORE_PROCEDURES)[number];
/** Procedures that are rolls (have a total and a comparison). STAT_MASTERY is a roll-mode signal, not a roll. */
export const ROLL_PROCEDURES = deepFreeze(["CORE_ROLL", "SKILL_CHECK", "SKILL_AUTOMATIC_SUCCESS", "SAVING_THROW", "ATTACK_ROLL"] as const satisfies readonly CoreProcedure[]);
export type RollProcedure = (typeof ROLL_PROCEDURES)[number];

/**
 * The derived statistics M5-WO2 defines (designer rulings M5-SC-003 / 005 / 008 / 009). MOVEMENT is deliberately
 * absent: M5-SC-006 is UNRESOLVED and DEFERRED_PENDING_CANON, so no Movement formula may exist (M5-I060).
 */
export const DERIVED_STATISTICS = deepFreeze([
  "HALF_CHARACTER_DIE",
  "MAXIMUM_HP",
  "MAXIMUM_MP",
  "ACCURACY",
  "DODGE_PERCEPTION_BONUS",
  "DODGE",
  "CHARACTER_DC_RESOLVE_BONUS",
  "CHARACTER_DC",
  "STRENGTH_ARMOR",
  "AP_AGILITY_BONUS",
  "BASE_AP_CAPACITY",
  "COUNTER_ACTION_CAPACITY",
  "BASE_RANGE",
  "BASE_MANA_EFFICIENCY",
  "SIGNATURE_ABILITY_SLOTS",
] as const);
export type DerivedStatistic = (typeof DERIVED_STATISTICS)[number];

/** Statistic keys that are deferred pending canon: refused as executable content (M5-SC-006, M5-I060). */
export const DEFERRED_STATISTICS = deepFreeze(["MOVEMENT", "BASE_MOVEMENT", "MOVEMENT_SPEED"] as const);

/**
 * Where an explicit, named bonus applies. A bonus is never folded into a Stat or a base value; it is its own named
 * Formula term on the roll or statistic it targets.
 */
export const BONUS_TARGETS = deepFreeze(["CORE_ROLL", "SKILL_CHECK", "SAVING_THROW", "ATTACK_ROLL", "DODGE", "CHARACTER_DC"] as const);
export type BonusTarget = (typeof BONUS_TARGETS)[number];
/** ActorContext `properties` key segment of each bonus target (`bonus.<segment>.<bonusKey>`). */
export const BONUS_CONTEXT_SEGMENTS = deepFreeze({
  CORE_ROLL: "core_roll",
  SKILL_CHECK: "skill_check",
  SAVING_THROW: "saving_throw",
  ATTACK_ROLL: "attack_roll",
  DODGE: "dodge",
  CHARACTER_DC: "character_dc",
} as const satisfies Record<BonusTarget, string>);

/** Variable sources a DERIVED_STAT or CORE_RESOLUTION Formula may declare. Every Formula variable names exactly one. */
export const VARIABLE_SOURCE_KINDS = deepFreeze(["STAT", "CHOSEN_STAT", "CHARACTER", "CHARACTER_DIE_FACES", "DERIVED", "NATURAL", "SKILL_RANK_BONUS", "EXPLICIT_BONUSES"] as const);
export type VariableSourceKind = (typeof VARIABLE_SOURCE_KINDS)[number];
/** Sources legal in a DERIVED_STAT (a statistic never reads a roll, a chosen Stat or a Skill rank). */
export const DERIVED_VARIABLE_SOURCE_KINDS = deepFreeze(["STAT", "CHARACTER", "CHARACTER_DIE_FACES", "DERIVED", "EXPLICIT_BONUSES"] as const satisfies readonly VariableSourceKind[]);

/** The Critical rule vocabulary (Core Playtest s59). Damage on a critical hit is deferred to the damage Work Order. */
export const CRITICAL_THREAT_RULES = deepFreeze(["NATURAL_EQUALS_DIE_FACES"] as const);
export const CRITICAL_HIT_RULES = deepFreeze(["THREAT_AND_SUCCESS"] as const);
export const CRITICAL_DAMAGE_RULES = deepFreeze(["DEFERRED"] as const);

/** The only comparison a WO2 roll uses: meet or exceed (s13, s15, s56). */
export const ROLL_COMPARISON_OPERATORS = deepFreeze([">="] as const);

/** The Skill Rank ladder key (s179): UNTRAINED < TRAINED < EXPERT < MASTER is content, ordered by explicit `order`. */
export const SKILL_RANK_LADDER_KEY = "SKILL";

/** Source locator grammars recorded on every WO2 Definition (system-map section keys and conflict keys). */
export const SOURCE_LOCATOR_PATTERN = /^s[0-9]{1,4}$/;
export const SOURCE_CONFLICT_PATTERN = /^M5-SC-[0-9]{3}$/;
