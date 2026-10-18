import { createRulesetContext, type RulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import affinityContent from "../content/core-playtest-v0.1/affinity.json";
import { conditionPayload, durationPayload, effectPayload, targetingPayload, traitPayload, uuid } from "./fixtures.js";

/**
 * Test fixtures for M5-WO4 (not public surface). The canonical Affinity Definitions come from the content file
 * `src/content/core-playtest-v0.1/affinity.json` — never TypeScript. The Ability COMPONENT Definitions below are neutral
 * structural test components (the Spell Effect / Targeting / Trait catalogs are later Work Orders): each states its
 * explicit `keywords`, which is the only way a component contributes Affinity-relevant Keywords (§61–§66).
 */
export interface AffinityContentDefinition {
  readonly canonicalKey: string;
  readonly definitionKind: ProwessDefinitionKind;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
}
export const AFFINITY_CONTENT = affinityContent as unknown as {
  readonly contentKey: string;
  readonly definitions: readonly AffinityContentDefinition[];
  readonly keywords: readonly { canonicalKey: string; name: string; category: string }[];
  readonly keywordCategory: { canonicalKey: string; name: string };
  readonly deferred: readonly { conflictKey: string; concept: string; status: string }[];
  readonly [k: string]: unknown;
};
export const AFFINITY_DEFINITIONS: readonly AffinityContentDefinition[] = AFFINITY_CONTENT.definitions;

const kw = (...keys: string[]) => keys.map((k) => `keyword.${k}`);
const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>): AffinityContentDefinition => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });

/** Neutral test components. Names describe the test role; only `keywords` carries Affinity relevance. */
export const TEST_COMPONENTS = {
  radiusArea: component("spell.targeting.radius_area", "SPELL_TARGETING", targetingPayload("RADIUS", { keywords: kw("area_effect") })),
  radiusPlain: component("spell.targeting.radius_plain", "SPELL_TARGETING", targetingPayload("RADIUS")),
  single: component("spell.targeting.single", "SPELL_TARGETING", targetingPayload("SINGLE_TARGET")),
  directDamage: component("spell.effect.direct_damage", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage") })),
  damage: component("spell.effect.damage", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("damage") })),
  healing: component("spell.effect.healing", "SPELL_EFFECT", effectPayload("HEALING", { keywords: kw("healing") })),
  buff: component("spell.effect.buff", "SPELL_EFFECT", effectPayload("BUFF", { keywords: kw("buff") })),
  persistent: component("spell.effect.persistent_zone", "SPELL_EFFECT", effectPayload("ZONE", { keywords: kw("persistent_effect") })),
  detection: component("spell.effect.detection", "SPELL_EFFECT", effectPayload("DETECTION", { keywords: kw("detection") })),
  light: component("spell.effect.light", "SPELL_EFFECT", effectPayload("UTILITY")),
  /** A different exact Keyword identity whose M1 display name reads "direct damage" — never a match (§191). */
  lookalike: component("spell.effect.lookalike", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage_lookalike") })),
  healingTrait: component("spell.trait.healing_infusion", "SPELL_TRAIT", traitPayload("INFUSION", "EFFECT_SPECIFIC", { keywords: kw("healing") })),
  areaTrait: component("spell.trait.widen", "SPELL_TRAIT", traitPayload("WIDEN", "EFFECT_SPECIFIC", { keywords: kw("area_effect") })),
  plainTrait: component("spell.trait.focus", "SPELL_TRAIT", traitPayload("FOCUS", "EFFECT_SPECIFIC")),
  instant: component("spell.duration.instant", "SPELL_DURATION", durationPayload("INSTANT")),
  verbal: component("spell.casting_condition.verbal", "SPELL_CASTING_CONDITION", conditionPayload("VERBAL")),
  maneuverSingle: component("maneuver.targeting.single", "MANEUVER_TARGETING", targetingPayload("SINGLE_TARGET")),
  maneuverStrike: component("maneuver.effect.force_strike", "MANEUVER_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage") })),
  maneuverInstant: component("maneuver.duration.instant", "MANEUVER_DURATION", durationPayload("INSTANT")),
} as const satisfies Record<string, AffinityContentDefinition>;
export type TestComponent = keyof typeof TEST_COMPONENTS;

export const AFFINITY_RULESET = uuid(7501);
export const AFFINITY_MANIFEST = uuid(7502);
export const AFFINITY_RULESET_2 = uuid(7511);
export const AFFINITY_MANIFEST_2 = uuid(7512);

const CATALOG: readonly AffinityContentDefinition[] = [...AFFINITY_DEFINITIONS, ...Object.values(TEST_COMPONENTS)];
const entityOf = (i: number) => uuid(7600 + i);
const versionOf = (i: number, revision: number) => uuid(7700 + i + revision * 100);

export interface AffinityFixtureOptions {
  readonly rulesetId?: string;
  readonly manifestId?: string;
  /** Replace a Definition's payload by canonical key — a new EntityVersion (revision 1) of the same Entity. */
  readonly revise?: Readonly<Record<string, Record<string, unknown>>>;
  readonly omit?: readonly string[];
  /** Pin these Definitions at an explicit schemaVersion / payload (e.g. a WO1 identity-only AFFINITY v1). */
  readonly override?: Readonly<Record<string, { schemaVersion: number; payload: Record<string, unknown> }>>;
}

export interface AffinityFixture {
  readonly ruleset: RulesetContext;
  readonly bundle: ProwessDefinitionBundle;
  readonly ref: (canonicalKey: string) => ProwessDefinitionRef;
  readonly definitions: Record<string, unknown>[];
}

export function affinityFixture(options: AffinityFixtureOptions = {}): AffinityFixture {
  const rulesetId = options.rulesetId ?? AFFINITY_RULESET;
  const manifestId = options.manifestId ?? AFFINITY_MANIFEST;
  const catalog = CATALOG.filter((d) => !(options.omit ?? []).includes(d.canonicalKey));
  const index = (d: AffinityContentDefinition) => CATALOG.findIndex((x) => x.canonicalKey === d.canonicalKey);
  const revision = (d: AffinityContentDefinition) => (options.revise?.[d.canonicalKey] === undefined && options.override?.[d.canonicalKey] === undefined ? 0 : 1);
  const ctx = createRulesetContext({
    rulesetId,
    manifestId,
    rules: catalog.map((d) => ({
      entityId: entityOf(index(d)),
      entityVersionId: versionOf(index(d), revision(d)),
      canonicalKey: d.canonicalKey,
      entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0],
      sourceRulesetId: rulesetId,
      sourceManifestId: manifestId,
    })),
  });
  if (!ctx.ok) throw new Error(JSON.stringify(ctx));
  const definitions = catalog.map((d) => ({
    schemaVersion: options.override?.[d.canonicalKey]?.schemaVersion ?? d.schemaVersion,
    systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family,
    definitionKind: d.definitionKind,
    entityId: entityOf(index(d)),
    entityVersionId: versionOf(index(d), revision(d)),
    canonicalKey: d.canonicalKey,
    payload: JSON.parse(JSON.stringify(options.override?.[d.canonicalKey]?.payload ?? options.revise?.[d.canonicalKey] ?? d.payload)) as Record<string, unknown>,
    provenance: { rulesetId, manifestId, releaseId: null, sourceRulesetId: rulesetId, sourceManifestId: manifestId, legacyTerms: d.canonicalKey === "affinity.evocation" ? [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] : [] },
  }));
  const out = createProwessDefinitionBundle({ ruleset: ctx.value, definitions });
  if (!out.ok) throw new Error(JSON.stringify(out.problems, null, 2));
  const bundle = out.value;
  const ref = (canonicalKey: string): ProwessDefinitionRef => {
    const d = bundle.definitions.find((x) => x.canonicalKey === canonicalKey);
    if (d === undefined) throw new Error(`no ${canonicalKey}`);
    return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  };
  return { ruleset: ctx.value, bundle, ref, definitions };
}

/** Exact M1 Keyword references for every canonical Affinity Keyword plus the test-only look-alike. */
export const AFFINITY_KEYWORD_CATEGORY_ID = uuid(7990);
export function keywordCatalog(extra: readonly string[] = ["keyword.direct_damage_lookalike"]): { keywordId: string; canonicalKey: string; categoryId: string | null }[] {
  const keys = [...AFFINITY_CONTENT.keywords.map((k) => k.canonicalKey), ...extra];
  return keys.map((canonicalKey, i) => ({ keywordId: uuid(8000 + i), canonicalKey, categoryId: extra.includes(canonicalKey) ? null : AFFINITY_KEYWORD_CATEGORY_ID }));
}

export type ProfileEntry = { readonly affinity: string; readonly rank: string; readonly role: string; readonly acquisition?: { level: number; optionKey: string } | null };

/** A CharacterAffinityProfile over exact fixture refs. `affinity` is a canonical key of the fixture (e.g. affinity.evocation). */
export function profileOf(f: AffinityFixture, entries: readonly ProfileEntry[]): { affinities: Record<string, unknown>[] } {
  return { affinities: entries.map((e) => ({ affinity: f.ref(e.affinity), rank: e.rank, role: e.role, acquisition: e.acquisition ?? null })) };
}

export interface SpellSpec {
  readonly affinity?: string | null;
  readonly authority?: Record<string, unknown> | null;
  readonly targeting?: TestComponent;
  readonly effects?: readonly TestComponent[];
  readonly traits?: readonly { readonly trait: TestComponent; readonly appliesTo: string }[];
  readonly kind?: "SPELL" | "MANEUVER";
}

/** An Ability Composition over fixture components. Effect component keys are `effect<n>` in authored order. */
export function abilityOf(f: AffinityFixture, spec: SpellSpec = {}): Record<string, unknown> {
  const kind = spec.kind ?? "SPELL";
  const def = (c: TestComponent) => f.ref(TEST_COMPONENTS[c].canonicalKey);
  const effects = spec.effects ?? (kind === "SPELL" ? ["directDamage"] : ["maneuverStrike"]);
  return {
    compositionKey: `composition.${kind.toLowerCase()}.affinity_test`,
    abilityKind: kind,
    affinity: spec.affinity === null ? null : { componentKey: "affinity", definition: f.ref(spec.affinity ?? "affinity.evocation"), parameters: {} },
    authority: spec.authority ?? null,
    keywords: [],
    targeting: { componentKey: "targeting", definition: def(spec.targeting ?? (kind === "SPELL" ? "single" : "maneuverSingle")), parameters: {} },
    effects: effects.map((e, i) => ({ componentKey: `effect${String(i + 1)}`, order: (i + 1) * 10, definition: def(e as TestComponent), parameters: {} })),
    traits: (spec.traits ?? []).map((t, i) => ({ componentKey: `trait${String(i + 1)}`, order: (i + 1) * 10, definition: def(t.trait), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: t.appliesTo }, parameters: {} })),
    duration: { componentKey: "duration", definition: def(kind === "SPELL" ? "instant" : "maneuverInstant"), parameters: {} },
    conditions: [],
    branch: kind === "SPELL" ? { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} } : { kind: "MANEUVER", foundation: null, martialAccess: null, resolutionProfile: null, data: {} },
  };
}
