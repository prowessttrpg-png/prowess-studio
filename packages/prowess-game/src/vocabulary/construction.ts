import { deepFreeze } from "../internal/plain-data.js";

/**
 * Shared Ability Construction vocabularies (PAS-10 M5-WO1 §19, §45, §48, §57, §117). Each is a classification — a
 * name for a concept — and carries no mechanics: nothing in @prowess/game branches on these values to produce an
 * outcome, a Save, a cost or a duration.
 */

/**
 * The canonical Affinities (§5A, §19). EVOCATION is canonical; the legacy source term "Emission" is recorded only in
 * the terminology inventory as LEGACY → EVOCATION and is never a canonical structured value (M5-I037).
 */
export const CANONICAL_AFFINITIES = deepFreeze(["EVOCATION", "CONJURATION", "TRANSMUTATION", "DIVINATION", "ENHANCEMENT", "MANIPULATION"] as const);
export type CanonicalAffinity = (typeof CANONICAL_AFFINITIES)[number];

/**
 * Neutral targeting SEMANTIC shapes (§117). A classifier only: it never replaces exact branch-specific Definition
 * identity (§118, M5-I031) and never implies an Effect, Save or resolution (§27, M5-I022).
 */
export const TARGETING_SEMANTIC_SHAPES = deepFreeze([
  "SELF",
  "TOUCH",
  "SINGLE_TARGET",
  "MULTI_TARGET",
  // M5-WO6 (designer ruling M5-SC-016, §11): Projectile is a canonical Spell Targeting Type, distinct from Single Target.
  "PROJECTILE",
  "LINE",
  "CONE",
  "RADIUS",
  "ZONE",
  "AURA",
  "CHAIN",
  // Historical WO1 classifiers. Designer ruling M5-SC-029: Trigger-Based and Glyph / Anchor are Targeting ADD-ONS, never a
  // base Targeting Type (M5-WO6 §12–§16, vocabulary/targeting.ts). Kept readable so WO1-era payloads stay valid.
  "TRIGGERED",
  "ANCHOR",
] as const);
export type TargetingSemanticShape = (typeof TARGETING_SEMANTIC_SHAPES)[number];

/** What part of an Ability a Trait modifies (§45). A Trait is never assumed ability-wide. */
export const TRAIT_SCOPES = deepFreeze(["EFFECT_SPECIFIC", "ABILITY_WIDE", "TARGETING", "DURATION", "CONDITION", "RESOLUTION"] as const);
export type TraitScope = (typeof TRAIT_SCOPES)[number];

/** Shared resolution vocabulary (§57). Branch rules decide formulas, legal Saves and results. */
export const RESOLUTION_MODES = deepFreeze(["ATTACK_ROLL", "SAVING_THROW", "AUTOMATIC"] as const);
export type ResolutionMode = (typeof RESOLUTION_MODES)[number];

/**
 * Duration concepts named by the source (§48). UNTIL_NEXT_TURN is Maneuver-only in Core Playtest V0.1 (Maneuver Anatomy);
 * which concepts each branch may legally use is Definition data, not this list. Costs / maintenance are later WOs.
 */
export const DURATION_CONCEPTS = deepFreeze(["INSTANT", "UNTIL_NEXT_TURN", "ROUNDS", "COMBAT", "SCENE", "MISSION", "SUSTAINED", "MANA_LOCK", "PERMANENT_BY_SPECIAL_RULE"] as const);
export type DurationConcept = (typeof DURATION_CONCEPTS)[number];

/**
 * The currencies a LISTED cost contribution may name (§58–60): a name, never an amount or formula. Mana Efficiency is
 * deliberately absent — ME is a payment source, never a cost or a discount (§140, M5-I023).
 */
export const COST_CURRENCIES = deepFreeze(["MP", "AP", "HP"] as const);
export type CostCurrency = (typeof COST_CURRENCIES)[number];
