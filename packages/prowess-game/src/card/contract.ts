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

export type SpellCard = CardEnvelope<"SIGNATURE_SPELL", SpellCardSection>;
export type ManeuverCard = CardEnvelope<"SIGNATURE_MANEUVER", ManeuverCardSection>;
export type MageArtCard = CardEnvelope<"MAGE_ART", MageArtCardSection>;
export type CardPresentation = SpellCard | ManeuverCard | MageArtCard;

export const available = <T>(value: T): CardValue<T> => ({ status: "AVAILABLE", value });
export const unavailable = <T>(code: string, reason: string): CardValue<T> => ({ status: "UNAVAILABLE", code, reason });
export const deferred = <T>(conflictKey: string, reason: string): CardValue<T> => ({ status: "DEFERRED", conflictKey, reason });
