import { deepFreeze } from "../internal/plain-data.js";

/**
 * Weapon & Attack vocabulary (PAS-10 M6-WO6). Closed, deep-frozen grammar tokens for the EQUIPMENT-family Definition
 * contracts WEAPON v1, ATTACK v1 and EQUIPMENT_TRAIT v1. Every number a Weapon or Attack is built from (AP, MP, dice,
 * Power, ranges, Loading, Reload, Loud radius, shield bonuses, the Power floor, the Versatile die steps, the Dual Wield
 * table) is authored Definition content pinned by the exact Release — never a constant here.
 */

/** A Weapon's general role (§9). It never supplies AP, damage, Power or handedness. */
export const WEAPON_CATEGORIES = deepFreeze(["LIGHT", "BALANCED", "HEAVY"] as const);
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

/** How a Weapon is held (§10). */
export const WEAPON_HANDEDNESS = deepFreeze(["ONE_HANDED", "TWO_HANDED", "VERSATILE"] as const);
export type WeaponHandedness = (typeof WEAPON_HANDEDNESS)[number];

/** Every Weapon declares exactly one (§24) — never inferred from whether Power is present. */
export const WEAPON_SCALING_MODELS = deepFreeze(["POWER", "STATIC", "HYBRID"] as const);
export type WeaponScalingModel = (typeof WEAPON_SCALING_MODELS)[number];

/** The explicit damage scaling of ONE Attack of a HYBRID Weapon (§29). */
export const ATTACK_SCALINGS = deepFreeze(["POWER", "STATIC"] as const);
export type AttackScaling = (typeof ATTACK_SCALINGS)[number];

/**
 * What kind of profile a WEAPON Definition is: an ordinary held Weapon, the intrinsic Unarmed profile of one Martial
 * rank (§56–§58, never equipped), or a generated Improvised profile (§137, not an ordinary catalog entry).
 */
export const WEAPON_PROFILE_KINDS = deepFreeze(["STANDARD", "UNARMED", "IMPROVISED"] as const);
export type WeaponProfileKind = (typeof WEAPON_PROFILE_KINDS)[number];

/**
 * What a held profile is for: a Weapon, or a Shield (defensive equipment that is also a Weapon because WO6 gives it
 * Moves, §61). Explicit — a Shield is never recognized by its name, family or modifiers. Shield + Weapon is never
 * Dual Wielding (§75).
 */
export const EQUIPMENT_ROLES = deepFreeze(["WEAPON", "SHIELD"] as const);
export type EquipmentRole = (typeof EQUIPMENT_ROLES)[number];

/** Authored damage types (§21, §99). */
export const DAMAGE_TYPES = deepFreeze(["SLASHING", "PIERCING", "BLUDGEONING", "FIRE", "ENERGY", "SHOCK", "ELEMENTAL"] as const);
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Die sides an Attack may author. */
export const DAMAGE_DIE_SIDES = deepFreeze([4, 6, 8, 10, 12] as const);

/** Attack resolution (§35). DEFERRED: canon states no resolution for the Move — shown, never resolved by guess. */
export const ATTACK_RESOLUTION_MODES = deepFreeze(["ATTACK_ROLL", "SAVING_THROW", "DEFERRED"] as const);
export type AttackResolutionMode = (typeof ATTACK_RESOLUTION_MODES)[number];

/** How much authored damage an outcome deals (§37–§38). */
export const DAMAGE_OUTCOMES = deepFreeze(["FULL", "HALF", "NO_DAMAGE"] as const);
export type DamageOutcome = (typeof DAMAGE_OUTCOMES)[number];

/** The DC a Saving Throw Attack (or a post-hit property Save) is made against. */
export const SAVING_THROW_DCS = deepFreeze(["ATTACKER_CHARACTER_DC"] as const);
export type SavingThrowDc = (typeof SAVING_THROW_DCS)[number];

/** Attack targeting forms (§32–§34). */
export const ATTACK_TARGETING_MODES = deepFreeze(["MELEE", "CLOSE", "RANGED_MULTIPLIER", "LINE", "CONE"] as const);
export type AttackTargetingMode = (typeof ATTACK_TARGETING_MODES)[number];

/** Areas a ranged Attack may detonate in (§34). */
export const ATTACK_AREA_SHAPES = deepFreeze(["BLAST"] as const);
export type AttackAreaShape = (typeof ATTACK_AREA_SHAPES)[number];

/** Every Equipment Trait states whether WO6 executes it (§18). */
export const TRAIT_EXECUTION_STATUSES = deepFreeze(["EXECUTABLE", "REFERENCE_ONLY", "DEFERRED"] as const);
export type TraitExecutionStatus = (typeof TRAIT_EXECUTION_STATUSES)[number];

/** Where an Equipment Trait may be used. */
export const TRAIT_USE_SITES = deepFreeze(["WEAPON_PROPERTY", "MOVE_PROPERTY"] as const);
export type TraitUseSite = (typeof TRAIT_USE_SITES)[number];

/** Parameter kinds an Equipment Trait may declare. */
export const TRAIT_PARAMETER_KINDS = deepFreeze(["COUNT", "FEET", "AP", "MP", "DICE"] as const);
export type TraitParameterKind = (typeof TRAIT_PARAMETER_KINDS)[number];

/**
 * The complete machine-readable contracts WO6 executes (§19). A trait is EXECUTABLE only with one of these; anything
 * else is REFERENCE_ONLY or DEFERRED (§18) — behavior is never invented to fill a gap.
 */
export const TRAIT_CONTRACT_KINDS = deepFreeze([
  "CLOSE_QUARTERS",
  "REACH",
  "ARMOR_PIERCE",
  "POST_HIT_SAVE",
  "DIE_STEP",
  "SAVE_AREA_FIRE",
  "AUTHORED_BURST",
  "POWER_SCALING",
  "DUAL_WIELD",
] as const);
export type TraitContractKind = (typeof TRAIT_CONTRACT_KINDS)[number];

/** What a failed post-hit property Save does (Sweep → Tripped, Hook → pulled). */
export const POST_HIT_FAILURE_KINDS = deepFreeze(["APPLY_CONDITION", "PULL"] as const);
export type PostHitFailureKind = (typeof POST_HIT_FAILURE_KINDS)[number];

/** Character statistics an equipped Weapon (a Shield) may adjust while equipped (§66). Derived, never stored. */
export const EQUIPMENT_MODIFIER_TARGETS = deepFreeze(["ARMOR", "DODGE", "MOVEMENT"] as const);
export type EquipmentModifierTarget = (typeof EQUIPMENT_MODIFIER_TARGETS)[number];

/** Structured Weapon / Attack requirement kinds (§60). Never parsed from text. */
export const WEAPON_REQUIREMENT_KINDS = deepFreeze(["MARTIAL_RANK_AT_LEAST", "STAT_AT_LEAST"] as const);
export type WeaponRequirementKind = (typeof WEAPON_REQUIREMENT_KINDS)[number];

/** A Versatile Weapon's explicit grip (§74); other Weapons have exactly their handedness. */
export const WEAPON_GRIPS = deepFreeze(["ONE_HANDED", "TWO_HANDED"] as const);
export type WeaponGrip = (typeof WEAPON_GRIPS)[number];

/** The hand slots WO6 activates (§68). Armor and Accessories stay outside WO6. */
export const WEAPON_HANDS = deepFreeze(["MAIN_HAND", "OFF_HAND"] as const);
export type WeaponHand = (typeof WEAPON_HANDS)[number];
