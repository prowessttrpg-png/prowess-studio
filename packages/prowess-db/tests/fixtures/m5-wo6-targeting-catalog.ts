import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProwessDefinitionKind } from "@prowess/game";

/**
 * M5-WO6 Targeting catalog shared by the DB history test and the Rules Inspector fixture test: the canonical Core
 * Playtest content (core resolution, runtime resources, Affinity, Targeting) plus NEUTRAL test components (the Effect
 * catalog is M5-WO7) that carry nothing but structure.
 */
export interface ContentDefinition {
  canonicalKey: string;
  definitionKind: ProwessDefinitionKind;
  schemaVersion: number;
  payload: Record<string, unknown>;
}
type ContentDoc = { definitions: { canonicalKey: string; definitionKind: ProwessDefinitionKind; schemaVersion?: number; payload: Record<string, unknown> }[] };

const CONTENT_DIR = path.resolve(import.meta.dirname, "../../../prowess-game/src/content/core-playtest-v0.1");
const load = (file: string) => JSON.parse(readFileSync(path.join(CONTENT_DIR, file), "utf8")) as ContentDoc;
const canonical = (file: string): ContentDefinition[] => load(file).definitions.map((d) => ({ ...d, schemaVersion: d.schemaVersion ?? 1 }));

export const KEYWORD_CONTENT = JSON.parse(readFileSync(path.join(CONTENT_DIR, "affinity.json"), "utf8")) as ContentDoc & {
  keywords: { canonicalKey: string; name: string }[];
  keywordCategory: { canonicalKey: string; name: string };
};

const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>): ContentDefinition => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });

export const TARGETING_TEST_COMPONENTS: ContentDefinition[] = [
  component("spell.effect.test_plain", "SPELL_EFFECT", { effectFamily: "UTILITY", resolution: null, outcomes: [] }),
  component("spell.duration.instant", "SPELL_DURATION", { durationConcept: "INSTANT" }),
  component("maneuver.effect.test_strike", "MANEUVER_EFFECT", { effectFamily: "DAMAGE", resolution: null, outcomes: [] }),
  component("maneuver.duration.instant", "MANEUVER_DURATION", { durationConcept: "INSTANT" }),
  component("maneuver.foundation.weapon_attack", "MANEUVER_FOUNDATION", { foundationKind: "WEAPON_ATTACK" }),
];

export const TARGETING_DEFINITIONS: ContentDefinition[] = [
  ...canonical("core-resolution.json"),
  ...canonical("runtime-resources.json"),
  ...canonical("affinity.json"),
  ...canonical("targeting.json"),
  ...TARGETING_TEST_COMPONENTS,
];

export type RefOf = (canonicalKey: string) => Record<string, unknown>;
const use = (ref: RefOf, componentKey: string, key: string, order?: number, parameters: Record<string, unknown> = {}) => ({ componentKey, ...(order === undefined ? {} : { order }), definition: ref(key), parameters });

/** A Spell over the canonical Spell Targeting `targetingKey` (one neutral Effect, Instant, Arcane Authority). */
export function spellWith(ref: RefOf, targetingKey: string, parameters: Record<string, unknown> = {}) {
  return {
    compositionKey: "composition.spell.targeting",
    abilityKind: "SPELL",
    affinity: null,
    authority: { authority: "ARCANE_AUTHORITY" },
    keywords: [],
    targeting: use(ref, "targeting", targetingKey, undefined, parameters),
    effects: [use(ref, "effect1", "spell.effect.test_plain", 10)],
    traits: [],
    duration: use(ref, "duration", "spell.duration.instant"),
    conditions: [],
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
}

/** A Maneuver over the canonical Maneuver Targeting `targetingKey` (weapon-attack Foundation). */
export function maneuverWith(ref: RefOf, targetingKey: string, parameters: Record<string, unknown> = {}) {
  return {
    compositionKey: "composition.maneuver.targeting",
    abilityKind: "MANEUVER",
    affinity: null,
    authority: null,
    keywords: [],
    targeting: use(ref, "targeting", targetingKey, undefined, parameters),
    effects: [use(ref, "effect1", "maneuver.effect.test_strike", 10)],
    traits: [],
    duration: use(ref, "duration", "maneuver.duration.instant"),
    conditions: [],
    branch: { kind: "MANEUVER", foundation: use(ref, "foundation", "maneuver.foundation.weapon_attack"), martialAccess: null, resolutionProfile: null, data: {} },
  };
}

export const characterOf = (stats: Record<string, number>, martial?: string) => ({
  stats,
  skillRanks: martial === undefined ? [] : [{ skillKey: "skill.martial", rankKey: martial }],
});
