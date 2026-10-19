import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProwessDefinitionKind } from "@prowess/game";

/**
 * M5-WO5 construction catalog shared by the DB history test and the Rules Inspector fixture test: the canonical Core
 * Playtest content (core resolution, runtime resources, Affinity, ability construction) plus NEUTRAL test components.
 * The components carry no catalog mechanics (that content is M5-WO6–WO9) — only explicit Keywords and, where a test needs
 * it, an explicit `rules.construction` access entry.
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

export const AFFINITY_CONTENT = JSON.parse(readFileSync(path.join(CONTENT_DIR, "affinity.json"), "utf8")) as ContentDoc & {
  keywords: { canonicalKey: string; name: string }[];
  keywordCategory: { canonicalKey: string; name: string };
};

const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>): ContentDefinition => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });
const effect = (effectFamily: string, keywords: string[] = []) => ({ effectFamily, resolution: null, outcomes: [], keywords });

export const CONSTRUCTION_TEST_COMPONENTS: ContentDefinition[] = [
  component("spell.targeting.single", "SPELL_TARGETING", { semanticShape: "SINGLE_TARGET", geometry: { origin: "CASTER" } }),
  component("spell.effect.direct_damage", "SPELL_EFFECT", effect("DAMAGE", ["keyword.direct_damage"])),
  component("spell.effect.healing", "SPELL_EFFECT", effect("HEALING", ["keyword.healing"])),
  component("spell.duration.instant", "SPELL_DURATION", { durationConcept: "INSTANT" }),
  component("spell.casting_condition.verbal", "SPELL_CASTING_CONDITION", { restriction: { restrictionKey: "VERBAL", data: {} }, tradeoff: { authored: true } }),
  component("maneuver.targeting.single", "MANEUVER_TARGETING", { semanticShape: "SINGLE_TARGET", geometry: { origin: "CASTER" } }),
  component("maneuver.effect.strike", "MANEUVER_EFFECT", effect("DAMAGE", ["keyword.direct_damage"])),
  component("maneuver.effect.sweep", "MANEUVER_EFFECT", effect("CONTROL")),
  component("maneuver.duration.instant", "MANEUVER_DURATION", { durationConcept: "INSTANT" }),
  component("maneuver.foundation.weapon_attack", "MANEUVER_FOUNDATION", { foundationKind: "WEAPON_ATTACK" }),
];

export const CONSTRUCTION_DEFINITIONS: ContentDefinition[] = [
  ...canonical("core-resolution.json"),
  ...canonical("runtime-resources.json"),
  ...canonical("affinity.json"),
  ...canonical("ability-construction.json"),
  ...CONSTRUCTION_TEST_COMPONENTS,
];

export type RefOf = (canonicalKey: string) => Record<string, unknown>;
const use = (ref: RefOf, componentKey: string, key: string, order?: number) => ({ componentKey, ...(order === undefined ? {} : { order }), definition: ref(key), parameters: {} });

/** An Arcane-Authority Spell: one Targeting, the given Effects, Instant, the given Casting Conditions. */
export function spellComposition(ref: RefOf, effects: string[], conditions: string[] = []) {
  return {
    compositionKey: "composition.spell.construction",
    abilityKind: "SPELL",
    affinity: null,
    authority: { authority: "ARCANE_AUTHORITY" },
    keywords: [],
    targeting: use(ref, "targeting", "spell.targeting.single"),
    effects: effects.map((k, i) => use(ref, `effect${String(i + 1)}`, k, (i + 1) * 10)),
    traits: [],
    duration: use(ref, "duration", "spell.duration.instant"),
    conditions: conditions.map((k, i) => use(ref, `condition${String(i + 1)}`, k, (i + 1) * 10)),
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
}

/** A Maneuver over the weapon-attack Foundation. */
export function maneuverComposition(ref: RefOf, effects: string[]) {
  return {
    compositionKey: "composition.maneuver.construction",
    abilityKind: "MANEUVER",
    affinity: null,
    authority: null,
    keywords: [],
    targeting: use(ref, "targeting", "maneuver.targeting.single"),
    effects: effects.map((k, i) => use(ref, `effect${String(i + 1)}`, k, (i + 1) * 10)),
    traits: [],
    duration: use(ref, "duration", "maneuver.duration.instant"),
    conditions: [],
    branch: { kind: "MANEUVER", foundation: use(ref, "foundation", "maneuver.foundation.weapon_attack"), martialAccess: null, resolutionProfile: null, data: {} },
  };
}

/** The character context: Stats (PRO feeds Signature capacity) and Skill ranks; no Affinity profile. */
export const characterOf = (skills: Record<string, string>, pro = 4) => ({
  stats: { PRO: pro },
  skillRanks: Object.entries(skills).map(([skillKey, rankKey]) => ({ skillKey, rankKey })),
  affinityProfile: null,
});
