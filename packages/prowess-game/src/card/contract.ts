import type { ProwessRulesetProvenance } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { CardRulesModel } from "./semantics.js";
import type { CardInstructions } from "./language.js";

/**
 * PAS-10 M6-WO9 — the Card Presentation Contract (v1). A card is READ-ONLY DERIVED PRESENTATION of authoritative
 * mechanics: it is projected from an existing evaluation (M5 compilers evaluated by M4) and is never a canonical
 * Ability Definition, never persisted as mechanical truth, and never a second rules engine. Every mechanical value is
 * copied from the evaluation it was projected from; a value the evaluation cannot establish is a typed UNAVAILABLE or
 * DEFERRED field with its reason — never a guess, never zero.
 *
 * Shared envelope + discriminated category sections (card families are not forced into one mechanical schema).
 */

export const CARD_CONTRACT_VERSION = 1 as const;
export const CARD_CATEGORIES = Object.freeze(["SIGNATURE_SPELL", "SIGNATURE_MANEUVER", "WEAPON", "ATTACK", "MAGE_ART", "GENERAL_ACTION"] as const);
export type CardCategory = (typeof CARD_CATEGORIES)[number];

/** A value the projection could establish, or the typed reason it could not (§3: never a silent substitute). */
export type CardValue<T> =
  | { readonly status: "AVAILABLE"; readonly value: T }
  | { readonly status: "UNAVAILABLE"; readonly code: string; readonly reason: string }
  | { readonly status: "DEFERRED"; readonly conflictKey: string; readonly reason: string };

/** Presentation availability of the whole card (derived from the evaluation's own state). */
export const CARD_AVAILABILITY = Object.freeze(["AVAILABLE", "AVAILABLE_WITH_RUNTIME_DEFERRED", "INVALID", "INCOMPLETE", "UNAVAILABLE"] as const);
export type CardAvailability = (typeof CARD_AVAILABILITY)[number];

/** The exact identity of a Character-owned Ability a card presents (current or historical revision). */
export interface CardAbilityIdentity {
  readonly kind: "SPELL" | "MANEUVER";
  readonly abilityId: string | null;
  readonly revisionNumber: number | null;
  /** Lifecycle of the presented revision: the current one of an active Ability, a draft, or a historical record. */
  readonly revisionRole: "CURRENT" | "DRAFT" | "HISTORICAL";
}

/** Where every mechanical fact on the card comes from (§3). */
export interface CardProvenance {
  readonly rulesetProvenance: ProwessRulesetProvenance;
  /** The Character's pinned Release (Character-owned cards). */
  readonly characterReleaseId: string | null;
  readonly characterId: string | null;
  readonly ability: CardAbilityIdentity | null;
  /** Every exact canonical Definition the card's mechanics cite (components, Weapons, Attacks …). */
  readonly sources: readonly ProwessDefinitionRef[];
  /** The evaluation the card was projected from (the authority), named by its result vocabulary. */
  readonly evaluation: { readonly authority: string; readonly state: string };
}

/** Artwork is an extensible presentation slot; WO9 renders the designed no-art placeholder only (decision C3). */
export type CardArtwork = { readonly kind: "PLACEHOLDER" };

export interface CardCostLine {
  readonly label: string;
  readonly currency: "MP" | "AP" | "PERCENT";
  readonly value: number;
  readonly source: ProwessDefinitionRef | null;
}
export interface CardCosts {
  readonly ap: CardValue<number>;
  readonly mp: CardValue<number>;
  /** The evaluation's own breakdown rows (Inspector order), never recomputed. */
  readonly breakdown: readonly CardCostLine[];
}

export interface CardTargeting {
  readonly targeting: ProwessDefinitionRef | null;
  readonly range: CardValue<{ readonly value: number | null; readonly unit: string | null; readonly model: string; readonly ruleText: string | null }>;
  readonly targetCount: { readonly kind: string; readonly count: number | null };
}

/** A runtime limitation / deferral exactly as the evaluation reported it. */
export interface CardLimitation {
  readonly code: string;
  readonly message: string;
}

/** Identity a printed snapshot must retain (§8). The print time is added by the server at print, never here. */
export interface CardSnapshotIdentity {
  readonly contractVersion: typeof CARD_CONTRACT_VERSION;
  readonly cardKey: string;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly characterReleaseId: string | null;
  readonly ability: CardAbilityIdentity | null;
  readonly sources: readonly string[];
}

export interface CardEnvelope<C extends CardCategory, S> {
  readonly contractVersion: typeof CARD_CONTRACT_VERSION;
  /** Stable presentation key: category + exact identity (+ revision). Never a name. */
  readonly cardKey: string;
  readonly category: C;
  /** Player prose / authored label — inert text, never read as mechanics. */
  readonly name: string;
  readonly description: string;
  readonly artwork: CardArtwork;
  readonly availability: CardAvailability;
  readonly provenance: CardProvenance;
  readonly costs: CardCosts;
  readonly targeting: CardValue<CardTargeting>;
  /** The typed semantic rules model (source of the generated instructions). */
  readonly rules: CardValue<CardRulesModel>;
  readonly instructions: CardInstructions;
  readonly limitations: readonly CardLimitation[];
  readonly section: S;
  readonly snapshot: CardSnapshotIdentity;
}

export interface SpellCardSection {
  readonly kind: "SIGNATURE_SPELL";
  readonly authority: string | null;
  readonly affinity: ProwessDefinitionRef | null;
  readonly keywords: readonly string[];
  readonly duration: ProwessDefinitionRef | null;
  readonly castingConditions: readonly ProwessDefinitionRef[];
  readonly traits: readonly CardTraitEntry[];
  readonly runtime: {
    readonly sustain: CardValue<{ readonly mpPerRound: number | null; readonly apPerRound: number; readonly meEligible: boolean }> | null;
    readonly manaLock: CardValue<never> | null;
    readonly concentration: string | null;
  };
}
export interface CardTraitEntry {
  readonly componentKey: string;
  readonly trait: ProwessDefinitionRef;
  readonly scope: { readonly scope: string; readonly componentKey: string | null };
  /** The trait's ACTUAL compiled modifications (kind, target and selected value), as M5 reports them. */
  readonly modifications: readonly { readonly kind: string; readonly targetComponentKey: string | null; readonly selected: number | string | boolean | null; readonly detail: Readonly<Record<string, unknown>> }[];
}
export interface ManeuverCardSection {
  readonly kind: "SIGNATURE_MANEUVER";
  readonly actions: readonly { readonly actionKey: string; readonly order: number; readonly source: ProwessDefinitionRef; readonly weapon: ProwessDefinitionRef | null; readonly attackKey: string | null }[];
  readonly duration: ProwessDefinitionRef | null;
  readonly conditions: readonly ProwessDefinitionRef[];
  readonly traits: readonly CardTraitEntry[];
  readonly performance: CardValue<Readonly<Record<string, unknown>>> | null;
}
/** Mage Arts: the presentation slot exists; the Character-facing domain does not (WO9 §4.4) — always UNAVAILABLE. */
export interface MageArtCardSection {
  readonly kind: "MAGE_ART";
  readonly domain: CardValue<never>;
}


// ---- Phase B: Weapons, Attacks and General Actions ----------------------------------------------------------------------

/** Where a Weapon is held for this Character's CURRENT loadout (M6-WO6): Unarmed is intrinsic, never equipped. */
export interface CardEquippedState {
  readonly hand: "UNARMED" | "MAIN_HAND" | "OFF_HAND";
  readonly grip: string;
  readonly occupies: readonly string[];
}
/** One Weapon / Move property use, with its exact execution status (EXECUTABLE / REFERENCE_ONLY / DEFERRED). */
export interface CardPropertyEntry {
  readonly trait: ProwessDefinitionRef;
  readonly traitKey: string;
  readonly executionStatus: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly summary: string;
}
/** A structured requirement exactly as the WO6 evaluation checked it (M4-evaluated; null = unresolved). */
export interface CardRequirementEntry {
  readonly requirementKey: string;
  readonly kind: string;
  readonly required: string;
  readonly actual: string;
  readonly satisfied: boolean | null;
  readonly source: ProwessDefinitionRef;
}
export interface WeaponCardSection {
  readonly kind: "WEAPON";
  readonly weapon: ProwessDefinitionRef;
  readonly equipped: CardEquippedState;
  /** Authored identity values of the exact Weapon revision (never inferred): null where canon authors none. */
  readonly profileKind: string;
  readonly equipmentRole: string;
  readonly category: string | null;
  readonly handedness: string | null;
  readonly scalingModel: string;
  readonly power: CardValue<number>;
  readonly martialRankKey: string | null;
  readonly exampleForms: readonly string[];
  readonly properties: readonly CardPropertyEntry[];
  readonly equippedModifiers: readonly { readonly modifierKey: string; readonly target: string; readonly value: number }[];
  readonly grantedFeatures: readonly { readonly featureKey: string; readonly executionStatus: string; readonly summary: string }[];
  readonly requirements: readonly CardRequirementEntry[];
  /** The Weapon's Moves as exact ATTACK references, with the card key of each Attack card. */
  readonly moveset: readonly { readonly attack: ProwessDefinitionRef; readonly cardKey: string }[];
}
export interface AttackCardSection {
  readonly kind: "ATTACK";
  /** Exact Weapon Attack identity: the Weapon EntityVersion + the Attack EntityVersion (M6-WO6 §14). */
  readonly weapon: ProwessDefinitionRef;
  readonly attack: ProwessDefinitionRef;
  readonly attackKey: string;
  readonly equipped: CardEquippedState;
  readonly moveKey: string;
  readonly weaponFamilyKey: string;
  readonly accuracyModifier: number;
  /** The WO6 damage previews verbatim — one per authored profile, each with its evaluated scaling steps. */
  readonly damage: readonly {
    readonly profileKey: string;
    readonly damageType: string;
    readonly status: string;
    readonly reason: string | null;
    readonly scaling: string;
    readonly base: string;
    readonly final: string | null;
    readonly steps: readonly { readonly step: string; readonly detail: string; readonly source: ProwessDefinitionRef | null }[];
  }[];
  readonly range: { readonly mode: string; readonly reachFeet: number | null; readonly rangeFeet: number | null; readonly lengthFeet: number | null; readonly area: { readonly shape: string; readonly radiusFeet: number } | null; readonly basis: { readonly stat: string; readonly statScore: number; readonly feetPerPoint: number } | null };
  readonly resolution: Readonly<Record<string, unknown>>;
  readonly properties: { readonly weapon: readonly CardPropertyEntry[]; readonly move: readonly CardPropertyEntry[] };
  /** Property uses WO6 does not execute (REFERENCE_ONLY / DEFERRED), as WO6 names them. */
  readonly notExecuted: readonly string[];
  readonly requirements: readonly CardRequirementEntry[];
  readonly eligibility: "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED";
  /** The Release identity the WO6 evaluation reported for this Attack. */
  readonly equipmentProvenance: { readonly rulesetId: string; readonly manifestId: string; readonly releaseId: string | null };
}
/** The Character-facing state of one Action Improvement (Phase B ACTION_IMPROVEMENT contract). */
export interface CardImprovementEntry {
  readonly improvement: ProwessDefinitionRef;
  readonly improvementKey: string;
  readonly status: "ACTIVE" | "CONDITIONAL" | "FUTURE" | "UNAVAILABLE" | "UNRESOLVED";
  readonly eligibility: string;
  readonly applicability: string;
  readonly rulesText: string;
  readonly prerequisites: readonly { readonly prerequisiteKey: string; readonly kind: string; readonly satisfied: boolean | null; readonly progression: string; readonly reason: string | null }[];
  readonly modifications: readonly { readonly modificationKey: string; readonly kind: string; readonly support: string; readonly conditional: boolean; readonly reason: string | null }[];
  readonly reasons: readonly CardLimitation[];
}
export interface GeneralActionCardSection {
  readonly kind: "GENERAL_ACTION";
  readonly action: ProwessDefinitionRef;
  readonly actionKey: string;
  readonly timing: string;
  readonly requiresTrigger: boolean;
  /** ACTION Definitions author no Character prerequisites: every Character may take them (no rule is invented). */
  readonly eligibility: { readonly status: "NO_REQUIREMENTS" };
  readonly otherCosts: readonly { readonly costKey: string; readonly policy: string; readonly amount: number }[];
  /** The movement the Action grants: evaluated by the runtime when taken (DEFERRED here), with its inputs' current values. */
  readonly movementGrant: {
    readonly expression: string;
    readonly unit: string | null;
    readonly inputs: readonly { readonly variable: string; readonly statistic: string | null; readonly current: CardValue<number> }[];
    readonly value: CardValue<number>;
  } | null;
  readonly costOverridableByExplicitRule: boolean;
  readonly source: { readonly locators: readonly string[]; readonly conflicts: readonly string[] };
  readonly improvements: readonly CardImprovementEntry[];
}

export type SpellCard = CardEnvelope<"SIGNATURE_SPELL", SpellCardSection>;
export type ManeuverCard = CardEnvelope<"SIGNATURE_MANEUVER", ManeuverCardSection>;
export type MageArtCard = CardEnvelope<"MAGE_ART", MageArtCardSection>;
export type WeaponCard = CardEnvelope<"WEAPON", WeaponCardSection>;
export type AttackCard = CardEnvelope<"ATTACK", AttackCardSection>;
export type GeneralActionCard = CardEnvelope<"GENERAL_ACTION", GeneralActionCardSection>;
export type CardPresentation = SpellCard | ManeuverCard | MageArtCard | WeaponCard | AttackCard | GeneralActionCard;

export const available = <T>(value: T): CardValue<T> => ({ status: "AVAILABLE", value });
export const unavailable = <T>(code: string, reason: string): CardValue<T> => ({ status: "UNAVAILABLE", code, reason });
export const deferred = <T>(conflictKey: string, reason: string): CardValue<T> => ({ status: "DEFERRED", conflictKey, reason });
