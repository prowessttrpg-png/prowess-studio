import { deepFreeze } from "../internal/plain-data.js";
import { TARGETING_SEMANTIC_SHAPES, type TargetingSemanticShape } from "./construction.js";

/**
 * M5-WO6 Targeting vocabularies (PAS-10 M5-WO6 §11–§16, §27, §51–§58, §118). Each is a CLASSIFICATION: nothing in
 * @prowess/game branches on these tokens to produce an outcome, a Save, an Attack Roll, a cost or a distance. Distances
 * are authored M4 Formulas in Definition content; tokens only name what an authored value means.
 */

/**
 * Targeting ADD-ONS (designer ruling M5-SC-029, §12–§17): applied to an already-created Spell; never a base Targeting
 * Type. Detailed Trigger / Glyph mechanics and their (not +4 / +5 MP) costs are later work (§18).
 */
export const TARGETING_ADD_ONS = deepFreeze(["TRIGGER", "ANCHOR"] as const);
export type TargetingAddOn = (typeof TARGETING_ADD_ONS)[number];

/**
 * Historical WO1 semantic classifiers for the add-ons (§13). They stay READABLE in WO1-era payloads, but a Definition
 * that authors executable Targeting rules (`rules.targeting`) can never use them as its base shape (§15–§16, M5-I164).
 */
export const HISTORICAL_ADD_ON_SHAPES = deepFreeze(["TRIGGERED", "ANCHOR"] as const satisfies readonly TargetingSemanticShape[]);

/** The semantic shapes a base Targeting Definition may author (§11): every shape except the historical add-on classifiers. */
export const BASE_TARGETING_SHAPES = deepFreeze(TARGETING_SEMANTIC_SHAPES.filter((s) => !(HISTORICAL_ADD_ON_SHAPES as readonly string[]).includes(s)) as Exclude<TargetingSemanticShape, "TRIGGERED" | "ANCHOR">[]);
export type BaseTargetingShape = Exclude<TargetingSemanticShape, "TRIGGERED" | "ANCHOR">;

/** How far the Targeting origin / target may be (§26–§27). Never inferred from a display name. */
export const TARGETING_RANGE_MODELS = deepFreeze(["SELF", "TOUCH", "DEFAULT_SPELL_RANGE", "FOUNDATION_RANGE", "FIXED", "EFFECT_DEFINED", "SPECIAL"] as const);
export type TargetingRangeModel = (typeof TARGETING_RANGE_MODELS)[number];

/** The geometry measures an area may author (§25, §28–§35). RANGE is never one of them: range and area stay separate (M5-I166). */
export const TARGETING_MEASURES = deepFreeze(["LENGTH", "WIDTH", "RADIUS"] as const);
export type TargetingMeasure = (typeof TARGETING_MEASURES)[number];

/**
 * How a measure's value is known: an executable content FORMULA, DEFERRED_PENDING_CANON (an open conflict — no number
 * is emitted, §30, §119), or EFFECT_DEFINED (the converting / owning Effect supplies it later, §87, §94–§95).
 */
export const TARGETING_MEASURE_STATUSES = deepFreeze(["FORMULA", "DEFERRED_PENDING_CANON", "EFFECT_DEFINED"] as const);
export type TargetingMeasureStatus = (typeof TARGETING_MEASURE_STATUSES)[number];

/** Who or what may be targeted (§55). Deliberately small; Summon / Equipment categories are later work. */
export const TARGET_CATEGORIES = deepFreeze(["SELF", "CREATURE", "OBJECT", "POINT", "SPACE", "AREA", "SOURCE"] as const);
export type TargetCategory = (typeof TARGET_CATEGORIES)[number];

/** How many targets (§37–§45, §94): exactly one, an explicitly selected count, everything valid in the area, or a chain. */
export const TARGET_CARDINALITY_KINDS = deepFreeze(["ONE", "SELECTED", "AREA", "CHAIN"] as const);
export type TargetCardinalityKind = (typeof TARGET_CARDINALITY_KINDS)[number];

/** Where Targeting may originate (§46–§50, §86–§92). The owning Definition lists which ones it allows. */
export const TARGETING_ORIGIN_MODES = deepFreeze([
  "CASTER",
  "PERFORMER",
  "POINT_IN_RANGE",
  "TARGET",
  "SOURCE",
  "WEAPON_TIP",
  "WEAPON_DIRECTION",
  "PROJECTILE_PATH",
  "EMITTED_POINT",
  "THROWN_IMPACT",
  "RANGED_IMPACT",
  "PROJECTILE_IMPACT",
  "FOUNDATION",
  "EFFECT_DEFINED",
] as const);
export type TargetingOriginMode = (typeof TARGETING_ORIGIN_MODES)[number];

/** What an Aura may emanate from (§36). Only the sources an exact Definition lists are legal. */
export const AURA_SOURCES = deepFreeze(["CASTER", "CREATURE", "OBJECT", "SUMMON", "ANCHOR"] as const);
export type AuraSource = (typeof AURA_SOURCES)[number];

/** How the Targeting is placed (§48–§50). */
export const TARGETING_PLACEMENT_MODELS = deepFreeze(["NONE", "CHOOSE_TARGETS", "CHOOSE_POINT", "FROM_ORIGIN", "FOLLOWS_SOURCE", "FOUNDATION", "EFFECT_DEFINED"] as const);
export type TargetingPlacementModel = (typeof TARGETING_PLACEMENT_MODELS)[number];

/** Line of Sight / Line of Effect policy (§56–§57). No ray tracing (§60). */
export const SIGHT_POLICIES = deepFreeze(["REQUIRED", "NOT_REQUIRED", "CONDITIONAL", "INHERITED"] as const);
export type SightPolicy = (typeof SIGHT_POLICIES)[number];

/**
 * Cover interaction metadata (§58–§59): whether the Targeting EXPOSES cover to resolution. Resolution-neutral — the
 * Effect / runtime decides what cover does to Dodge or a Save.
 */
export const COVER_POLICIES = deepFreeze(["EXPOSED_TO_RESOLUTION", "NOT_APPLICABLE", "INHERITED"] as const);
export type CoverPolicy = (typeof COVER_POLICIES)[number];

/**
 * The typical DELIVERY family (§6): Touch / Projectile are Attack-Roll-oriented deliveries. A classification only — it
 * never transfers resolution ownership from the Effect (M5-I022, M5-I160).
 */
export const DELIVERY_FAMILIES = deepFreeze(["SELF_DELIVERY", "DIRECT_ATTACK_DELIVERY", "TARGETED_DELIVERY", "AREA_DELIVERY", "EMANATION_DELIVERY", "CHAIN_DELIVERY", "FOUNDATION_DELIVERY"] as const);
export type DeliveryFamily = (typeof DELIVERY_FAMILIES)[number];

/** The kinds of authored Targeting parameters (§51–§52). Anything not declared by the exact Definition is refused. */
export const TARGETING_PARAMETER_KINDS = deepFreeze(["COUNT", "STEPS", "FLAG", "TOKEN"] as const);
export type TargetingParameterKind = (typeof TARGETING_PARAMETER_KINDS)[number];

/** The sources a Targeting Formula variable may read (§100, §103). */
export const TARGETING_VARIABLE_SOURCES = deepFreeze(["STAT", "DERIVED", "PARAMETER", "SKILL_RANK_TABLE"] as const);
export type TargetingVariableSource = (typeof TARGETING_VARIABLE_SOURCES)[number];

/**
 * LISTED Targeting cost contribution kinds (§20–§23, §43, §61–§67): the base contribution, a base deferred pending canon
 * (Projectile, M5-SC-039), a per-step scaling option, and a selection option. Never a payment (§62) and never ME (§63).
 */
export const TARGETING_COST_KINDS = deepFreeze(["BASE", "BASE_DEFERRED", "PER_STEP", "PER_ADDITIONAL_TARGET", "PER_SELECTION"] as const);
export type TargetingCostKind = (typeof TARGETING_COST_KINDS)[number];

/** Effect / component ↔ Targeting compatibility results (§74). */
export const TARGETING_COMPATIBILITY_STATUSES = deepFreeze(["COMPATIBLE", "INCOMPATIBLE", "MODIFIED_BY_EXPLICIT_RULE", "NOT_DECLARED"] as const);
export type TargetingCompatibilityStatus = (typeof TARGETING_COMPATIBILITY_STATUSES)[number];

/** The measure a radius-modifying Trait (Widen Area, WO8) reads: `radiusCapable` is true exactly when it is authored (§71). */
export const RADIUS_MEASURE: TargetingMeasure = "RADIUS";

/** The single currency a SPELL Targeting contribution is listed in (§61): Spell construction is MP-centred; never ME (§63). */
export const SPELL_TARGETING_COST_CURRENCY = "MP";
