/** M5-WO7 Effect vocabulary. These are Prowess-domain tokens; M4 remains generic. */
export const SPELL_EFFECT_FAMILIES = Object.freeze([
  "DAMAGE",
  "HEALING",
  "BUFF",
  "DEBUFF",
  "CONTROL",
  "UTILITY",
  "SUMMONING",
] as const);
export type SpellEffectFamily = (typeof SPELL_EFFECT_FAMILIES)[number];

/** Optional semantic families nested beneath a top-level Effect family. */
export const EFFECT_SUBFAMILIES = Object.freeze([
  "DIRECT",
  "RESTORATION",
  "CLEANSE",
  "MODIFICATION",
  "FORCED_MOVEMENT",
  "MOVEMENT",
  "COUNTERSPELL",
  "DETECTION",
  "MANIFESTATION",
  "TARGETING_CONVERSION",
  "DAMAGE_CONVERSION",
] as const);
export type EffectSubfamily = (typeof EFFECT_SUBFAMILIES)[number];

/** SPELL_EFFECT owns its resolution. MANEUVER_EFFECT may explicitly inherit the Maneuver foundation's resolution. */
export const EFFECT_RESOLUTION_POLICIES = Object.freeze(["OWN", "INHERIT_ABILITY"] as const);
export type EffectResolutionPolicy = (typeof EFFECT_RESOLUTION_POLICIES)[number];

export const EFFECT_ATTACK_TYPES = Object.freeze(["ABILITY_ATTACK", "MELEE_ATTACK", "RANGED_ATTACK", "FOUNDATION_ATTACK"] as const);
export type EffectAttackType = (typeof EFFECT_ATTACK_TYPES)[number];

export const EFFECT_SAVE_SELECTION_POLICIES = Object.freeze([
  "FIXED",
  "CONSTRUCTION_CHOICE",
  "TARGET_CHOICE",
  "MARTIAL_CONTROL",
] as const);
export type EffectSaveSelectionPolicy = (typeof EFFECT_SAVE_SELECTION_POLICIES)[number];

export const EFFECT_PARAMETER_KINDS = Object.freeze(["COUNT", "TOKEN", "FLAG"] as const);
export type EffectParameterKind = (typeof EFFECT_PARAMETER_KINDS)[number];

export const EFFECT_LIMIT_KINDS = Object.freeze(["FIXED", "STAT"] as const);
export type EffectLimitKind = (typeof EFFECT_LIMIT_KINDS)[number];

export const EFFECT_VARIABLE_SOURCE_KINDS = Object.freeze(["STAT", "PARAMETER", "MARTIAL_RANK_VALUE"] as const);
export type EffectVariableSourceKind = (typeof EFFECT_VARIABLE_SOURCE_KINDS)[number];

export const EFFECT_COST_KINDS = Object.freeze(["FIXED", "PER_UNIT", "PER_SELECTION"] as const);
export type EffectCostKind = (typeof EFFECT_COST_KINDS)[number];

/** Deterministic semantic outcome keys for executable Effect Definitions. */
export const EFFECT_OUTCOME_KEYS = Object.freeze(["SUCCESS", "FAILURE"] as const);
export type EffectOutcomeKey = (typeof EFFECT_OUTCOME_KEYS)[number];

/** Outcome operations are authored data only in WO7. Runtime mutation is deliberately deferred. */
export const EFFECT_OUTCOME_OPERATIONS = Object.freeze([
  "NO_EFFECT",
  "DAMAGE",
  "HEAL",
  "CLEANSE",
  "MODIFY_VALUE",
  "CONTROL",
  "UTILITY",
  "SUMMON",
  "FOUNDATION_DAMAGE",
  "CONVERT_TARGETING",
  "CONVERT_DAMAGE_TYPE",
] as const);
export type EffectOutcomeOperation = (typeof EFFECT_OUTCOME_OPERATIONS)[number];

/** An exact Targeting Definition may impose a delivery check without owning the Effect outcome. */
export const TARGETING_DELIVERY_CHECKS = Object.freeze(["RANGED_ATTACK_ROLL"] as const);
export type TargetingDeliveryCheck = (typeof TARGETING_DELIVERY_CHECKS)[number];

export const EFFECT_DELIVERY_INTERACTIONS = Object.freeze([
  "NONE",
  "SAME_ATTACK_ROLL",
  "DELIVERY_THEN_SAVE",
  "DELIVERY_THEN_AUTOMATIC",
  "DELIVERY_THEN_INHERITED",
] as const);
export type EffectDeliveryInteraction = (typeof EFFECT_DELIVERY_INTERACTIONS)[number];
