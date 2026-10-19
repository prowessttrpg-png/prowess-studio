import { createRulesetContext, type RulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import affinityContent from "../content/core-playtest-v0.1/affinity.json";
import coreContent from "../content/core-playtest-v0.1/core-resolution.json";
import constructionContent from "../content/core-playtest-v0.1/ability-construction.json";
import { conditionPayload, durationPayload, effectPayload, targetingPayload, traitPayload, uuid } from "./fixtures.js";
import { AFFINITY_KEYWORD_CATEGORY_ID } from "./affinity-fixtures.js";

interface ContentDefinition {
  readonly canonicalKey: string;
  readonly definitionKind: ProwessDefinitionKind;
  readonly schemaVersion?: number;
  readonly payload: Record<string, unknown>;
}

const AFFINITY = affinityContent as unknown as {
  readonly definitions: readonly ContentDefinition[];
  readonly keywords: readonly { canonicalKey: string; name: string; category: string }[];
};
const CORE = coreContent as unknown as { readonly definitions: readonly ContentDefinition[] };
const CONSTRUCTION = constructionContent as unknown as { readonly definitions: readonly ContentDefinition[] };
const skillLadder = CORE.definitions.find((d) => d.canonicalKey === "core.rank_ladder.skill");
if (skillLadder === undefined) throw new Error("core.rank_ladder.skill missing");

const kw = (...keys: string[]) => keys.map((k) => `keyword.${k}`);
const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>): ContentDefinition => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });

export const CONSTRUCTION_COMPONENTS = {
  spellSingle: component("spell.targeting.wo5_single", "SPELL_TARGETING", targetingPayload("SINGLE_TARGET", { keywords: kw("direct_damage") })),
  spellDamage: component("spell.effect.wo5_damage", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage") })),
  spellHealing: component("spell.effect.wo5_healing", "SPELL_EFFECT", effectPayload("HEALING", { keywords: kw("healing") })),
  spellPlain: component("spell.effect.wo5_plain", "SPELL_EFFECT", effectPayload("UTILITY")),
  spellTrait: component("spell.trait.wo5_focus", "SPELL_TRAIT", traitPayload("FOCUS", "EFFECT_SPECIFIC", { keywords: kw("direct_damage") })),
  spellDuration: component("spell.duration.wo5_instant", "SPELL_DURATION", { ...durationPayload("INSTANT"), keywords: kw("direct_damage") }),
  spellCondition: component("spell.condition.wo5_verbal", "SPELL_CASTING_CONDITION", conditionPayload("VERBAL", { keywords: kw("direct_damage") })),
  maneuverSingle: component("maneuver.targeting.wo5_single", "MANEUVER_TARGETING", targetingPayload("SINGLE_TARGET")),
  maneuverEffect: component("maneuver.effect.wo5_strike", "MANEUVER_EFFECT", effectPayload("DAMAGE")),
  maneuverTrait: component("maneuver.trait.wo5_focus", "MANEUVER_TRAIT", traitPayload("FOCUS", "EFFECT_SPECIFIC")),
  maneuverDuration: component("maneuver.duration.wo5_instant", "MANEUVER_DURATION", durationPayload("INSTANT")),
  maneuverCondition: component("maneuver.condition.wo5_commit", "MANEUVER_CONDITION", conditionPayload("COMMITMENT")),
} as const satisfies Record<string, ContentDefinition>;
export type ConstructionComponentKey = keyof typeof CONSTRUCTION_COMPONENTS;

const CATALOG: readonly ContentDefinition[] = [skillLadder, ...CONSTRUCTION.definitions, ...AFFINITY.definitions, ...Object.values(CONSTRUCTION_COMPONENTS)];

export const CONSTRUCTION_RULESET = uuid(8401);
export const CONSTRUCTION_MANIFEST = uuid(8402);
export const CONSTRUCTION_RULESET_2 = uuid(8411);
export const CONSTRUCTION_MANIFEST_2 = uuid(8412);
const entityOf = (i: number) => uuid(8500 + i);
const versionOf = (i: number, revision: number) => uuid(8700 + i + revision * 100);

export interface ConstructionFixtureOptions {
  readonly rulesetId?: string;
  readonly manifestId?: string;
  readonly revise?: Readonly<Record<string, Record<string, unknown>>>;
  readonly omit?: readonly string[];
}

export interface ConstructionFixture {
  readonly ruleset: RulesetContext;
  readonly bundle: ProwessDefinitionBundle;
  readonly ref: (canonicalKey: string) => ProwessDefinitionRef;
}

export function constructionFixture(options: ConstructionFixtureOptions = {}): ConstructionFixture {
  const rulesetId = options.rulesetId ?? CONSTRUCTION_RULESET;
  const manifestId = options.manifestId ?? CONSTRUCTION_MANIFEST;
  const catalog = CATALOG.filter((d) => !(options.omit ?? []).includes(d.canonicalKey));
  const index = (d: ContentDefinition) => CATALOG.findIndex((x) => x.canonicalKey === d.canonicalKey);
  const revision = (d: ContentDefinition) => (options.revise?.[d.canonicalKey] === undefined ? 0 : 1);
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
    schemaVersion: d.schemaVersion ?? 1,
    systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family,
    definitionKind: d.definitionKind,
    entityId: entityOf(index(d)),
    entityVersionId: versionOf(index(d), revision(d)),
    canonicalKey: d.canonicalKey,
    payload: JSON.parse(JSON.stringify(options.revise?.[d.canonicalKey] ?? d.payload)) as Record<string, unknown>,
    provenance: {
      rulesetId,
      manifestId,
      releaseId: null,
      sourceRulesetId: rulesetId,
      sourceManifestId: manifestId,
      legacyTerms: d.canonicalKey === "affinity.evocation" ? [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] : [],
    },
  }));
  const built = createProwessDefinitionBundle({ ruleset: ctx.value, definitions });
  if (!built.ok) throw new Error(JSON.stringify(built.problems, null, 2));
  const bundle = built.value;
  const ref = (canonicalKey: string): ProwessDefinitionRef => {
    const d = bundle.definitions.find((x) => x.canonicalKey === canonicalKey);
    if (d === undefined) throw new Error(`no ${canonicalKey}`);
    return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  };
  return { ruleset: ctx.value, bundle, ref };
}

export function constructionKeywordCatalog(extra: readonly string[] = []): { keywordId: string; canonicalKey: string; categoryId: string | null }[] {
  const keys = [...AFFINITY.keywords.map((k) => k.canonicalKey), ...extra];
  return keys.map((canonicalKey, i) => ({ keywordId: uuid(9000 + i), canonicalKey, categoryId: extra.includes(canonicalKey) ? null : AFFINITY_KEYWORD_CATEGORY_ID }));
}

export function constructionProfile(
  f: ConstructionFixture,
  options: {
    readonly prowess?: number;
    readonly signatureSlotsUsed?: number;
    readonly arcane?: "UNTRAINED" | "TRAINED" | "EXPERT" | "MASTER";
    readonly martial?: "UNTRAINED" | "TRAINED" | "EXPERT" | "MASTER";
    readonly affinities?: readonly { readonly key: string; readonly rank: "NONE" | "TRAINED" | "EXPERT" | "MASTER"; readonly role: "PRIMARY" | "SECONDARY" }[];
  } = {},
): Record<string, unknown> {
  const affinities = options.affinities ?? [];
  return {
    prowess: options.prowess ?? 4,
    signatureSlotsUsed: options.signatureSlotsUsed ?? 0,
    skills: [
      { skillKey: "skill.arcana", rank: options.arcane ?? "UNTRAINED" },
      { skillKey: "skill.martial", rank: options.martial ?? "UNTRAINED" },
    ],
    affinityProfile: affinities.length === 0
      ? null
      : { affinities: affinities.map((a) => ({ affinity: f.ref(a.key), rank: a.rank, role: a.role, acquisition: null })) },
  };
}

const refOf = (f: ConstructionFixture, key: ConstructionComponentKey) => f.ref(CONSTRUCTION_COMPONENTS[key].canonicalKey);

export function spellComposition(
  f: ConstructionFixture,
  options: {
    readonly authority?: "ARCANE_AUTHORITY" | "AFFINITY_AUTHORITY";
    readonly affinity?: string | null;
    readonly effects?: readonly ConstructionComponentKey[];
    readonly traits?: readonly ConstructionComponentKey[];
    readonly conditions?: readonly ConstructionComponentKey[];
    readonly traitTrades?: number;
  } = {},
): Record<string, unknown> {
  const effects = options.effects ?? ["spellDamage"];
  const traits = options.traits ?? [];
  const conditions = options.conditions ?? [];
  return {
    compositionKey: "composition.spell.wo5",
    abilityKind: "SPELL",
    affinity: options.affinity === null ? null : { componentKey: "affinity", definition: f.ref(options.affinity ?? "affinity.evocation"), parameters: {} },
    authority: { authority: options.authority ?? "ARCANE_AUTHORITY", traitTrades: options.traitTrades ?? 0 },
    keywords: [],
    targeting: { componentKey: "targeting", definition: refOf(f, "spellSingle"), parameters: {} },
    effects: effects.map((key, i) => ({ componentKey: `effect${i + 1}`, order: (i + 1) * 10, definition: refOf(f, key), parameters: {} })),
    traits: traits.map((key, i) => ({ componentKey: `trait${i + 1}`, order: (i + 1) * 10, definition: refOf(f, key), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: "effect1" }, parameters: {} })),
    duration: { componentKey: "duration", definition: refOf(f, "spellDuration"), parameters: {} },
    conditions: conditions.map((key, i) => ({ componentKey: `condition${i + 1}`, order: (i + 1) * 10, definition: refOf(f, key), parameters: {} })),
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
}

export function maneuverComposition(
  f: ConstructionFixture,
  options: {
    readonly effects?: readonly ConstructionComponentKey[];
    readonly traits?: readonly ConstructionComponentKey[];
    readonly conditions?: readonly ConstructionComponentKey[];
  } = {},
): Record<string, unknown> {
  const effects = options.effects ?? ["maneuverEffect"];
  const traits = options.traits ?? [];
  const conditions = options.conditions ?? [];
  return {
    compositionKey: "composition.maneuver.wo5",
    abilityKind: "MANEUVER",
    affinity: null,
    authority: null,
    keywords: [],
    targeting: { componentKey: "targeting", definition: refOf(f, "maneuverSingle"), parameters: {} },
    effects: effects.map((key, i) => ({ componentKey: `effect${i + 1}`, order: (i + 1) * 10, definition: refOf(f, key), parameters: {} })),
    traits: traits.map((key, i) => ({ componentKey: `trait${i + 1}`, order: (i + 1) * 10, definition: refOf(f, key), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: "effect1" }, parameters: {} })),
    duration: { componentKey: "duration", definition: refOf(f, "maneuverDuration"), parameters: {} },
    conditions: conditions.map((key, i) => ({ componentKey: `condition${i + 1}`, order: (i + 1) * 10, definition: refOf(f, key), parameters: {} })),
    branch: { kind: "MANEUVER", foundation: null, martialAccess: null, resolutionProfile: null, data: {} },
  };
}
