import { createRulesetContext, type RulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import constructionContent from "../content/core-playtest-v0.1/ability-construction.json";
import { AFFINITY_DEFINITIONS, keywordCatalog } from "./affinity-fixtures.js";
import { PLAYTEST_DEFINITIONS } from "./core-fixtures.js";
import { conditionPayload, effectPayload, targetingPayload, traitPayload, uuid } from "./fixtures.js";

/**
 * Test fixtures for M5-WO5 (not public surface). The canonical core, Affinity and construction-rule Definitions come from
 * the content files — never TypeScript. The Ability COMPONENT Definitions below are neutral structural test components
 * (the Spell / Maneuver catalogs are WO6–WO9): each states its construction sub-contract (`rules.construction`)
 * explicitly. `{ $ref: "<canonical key>" }` inside a payload is replaced by that fixture Definition's exact reference.
 */
export interface ConstructionContentDefinition {
  readonly canonicalKey: string;
  readonly definitionKind: ProwessDefinitionKind;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
}
export const CONSTRUCTION_CONTENT = constructionContent as unknown as { readonly definitions: readonly { canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> }[]; readonly [k: string]: unknown };
export const CONSTRUCTION_RULE_PAYLOAD = CONSTRUCTION_CONTENT.definitions[0]?.payload as Record<string, unknown>;

const kw = (...keys: string[]) => keys.map((k) => `keyword.${k}`);
const $ref = (canonicalKey: string) => ({ $ref: canonicalKey });
const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>): ConstructionContentDefinition => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });
const construction = (c: Record<string, unknown>) => ({ rules: { construction: c } });
const evocationAccess = construction({ affinityAccess: [$ref("affinity.evocation")] });
const common = (extra: Record<string, unknown> = {}) => ({ keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {}, ...extra });

/** Neutral test components. Only their explicit Keywords and `rules.construction` carry construction relevance. */
export const CONSTRUCTION_COMPONENTS = {
  // Spell branch
  single: component("spell.targeting.single", "SPELL_TARGETING", targetingPayload("SINGLE_TARGET", evocationAccess)),
  radiusArea: component("spell.targeting.radius_area", "SPELL_TARGETING", targetingPayload("RADIUS", { keywords: kw("area_effect") })),
  directDamage: component("spell.effect.direct_damage", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage") })),
  healing: component("spell.effect.healing", "SPELL_EFFECT", effectPayload("HEALING", { keywords: kw("healing") })),
  light: component("spell.effect.light", "SPELL_EFFECT", effectPayload("UTILITY")),
  stackable3: component("spell.effect.stackable_bolt", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage"), ...construction({ stacking: { stackable: true, limit: { kind: "FIXED", maximum: 3 } } }) })),
  arcaneStack: component("spell.effect.arcane_stack", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage"), ...construction({ stacking: { stackable: true, limit: { kind: "TRACK_RANK_VALUE", track: "ARCANE" } } }) })),
  expertArcana: component("spell.effect.expert_lore", "SPELL_EFFECT", effectPayload("UTILITY", { keywords: kw("direct_damage"), ...construction({ prerequisites: [{ prerequisiteKey: "ARCANA_EXPERT", kind: "SKILL_RANK_AT_LEAST", skillKey: "skill.arcana", minimumRank: "EXPERT" }] }) })),
  evocationExpert: component("spell.effect.evocation_mastery", "SPELL_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage"), ...construction({ prerequisites: [{ prerequisiteKey: "EVOCATION_EXPERT", kind: "AFFINITY_RANK_AT_LEAST", affinity: $ref("affinity.evocation"), minimumRank: "EXPERT" }] }) })),
  widenTrait: component("spell.trait.widen", "SPELL_TRAIT", traitPayload("WIDEN", "EFFECT_SPECIFIC", { keywords: kw("area_effect") })),
  focusTrait: component("spell.trait.focus", "SPELL_TRAIT", traitPayload("FOCUS", "EFFECT_SPECIFIC", evocationAccess)),
  instant: component("spell.duration.instant", "SPELL_DURATION", { durationConcept: "INSTANT", ...evocationAccess }),
  verbal: component("spell.casting_condition.verbal", "SPELL_CASTING_CONDITION", conditionPayload("VERBAL", evocationAccess)),
  somatic: component("spell.casting_condition.somatic", "SPELL_CASTING_CONDITION", conditionPayload("SOMATIC", evocationAccess)),
  material: component("spell.casting_condition.material", "SPELL_CASTING_CONDITION", conditionPayload("MATERIAL", evocationAccess)),
  focusCondition: component("spell.casting_condition.focus", "SPELL_CASTING_CONDITION", conditionPayload("FOCUS", evocationAccess)),
  // Maneuver branch
  maneuverSingle: component("maneuver.targeting.single", "MANEUVER_TARGETING", targetingPayload("SINGLE_TARGET")),
  strike: component("maneuver.effect.strike", "MANEUVER_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage") })),
  conversion: component("maneuver.effect.targeting_conversion", "MANEUVER_EFFECT", effectPayload("TARGETING_CONVERSION")),
  sweep: component("maneuver.effect.sweep", "MANEUVER_EFFECT", effectPayload("CONTROL")),
  feint: component("maneuver.effect.feint", "MANEUVER_EFFECT", effectPayload("CONTROL")),
  flurry: component("maneuver.effect.flurry", "MANEUVER_EFFECT", effectPayload("DAMAGE", construction({ stacking: { stackable: true, limit: { kind: "TRACK_RANK_VALUE", track: "MARTIAL" } } }))),
  barrage: component("maneuver.effect.barrage", "MANEUVER_EFFECT", effectPayload("DAMAGE", construction({ stacking: { stackable: true, limit: { kind: "FIXED", maximum: 4 } } }))),
  emberStrike: component("maneuver.effect.ember_strike", "MANEUVER_EFFECT", effectPayload("DAMAGE", { keywords: kw("direct_damage"), ...construction({ prerequisites: [{ prerequisiteKey: "EVOCATION_TRAINED", kind: "AFFINITY_RANK_AT_LEAST", affinity: $ref("affinity.evocation"), minimumRank: "TRAINED" }] }) })),
  maneuverTrait: component("maneuver.trait.reach", "MANEUVER_TRAIT", traitPayload("REACH", "EFFECT_SPECIFIC")),
  maneuverInstant: component("maneuver.duration.instant", "MANEUVER_DURATION", { durationConcept: "INSTANT" }),
  stance: component("maneuver.condition.stance", "MANEUVER_CONDITION", conditionPayload("MUST_BE_STATIONARY")),
  firstMove: component("maneuver.condition.first_move", "MANEUVER_CONDITION", conditionPayload("MUST_MOVE_FIRST")),
  flanked: component("maneuver.condition.flanked", "MANEUVER_CONDITION", conditionPayload("TARGET_FLANKED")),
  bloodied: component("maneuver.condition.bloodied", "MANEUVER_CONDITION", conditionPayload("TARGET_BLOODIED")),
  weaponAttack: component("maneuver.foundation.weapon_attack", "MANEUVER_FOUNDATION", common({ foundationKind: "WEAPON_ATTACK" })),
} as const satisfies Record<string, ConstructionContentDefinition>;
export type ConstructionComponent = keyof typeof CONSTRUCTION_COMPONENTS;

export const CONSTRUCTION_RULESET = uuid(8501);
export const CONSTRUCTION_MANIFEST = uuid(8502);
export const CONSTRUCTION_RULESET_2 = uuid(8511);
export const CONSTRUCTION_MANIFEST_2 = uuid(8512);

const RULE_DEFINITIONS: readonly ConstructionContentDefinition[] = CONSTRUCTION_CONTENT.definitions.map((d) => ({ ...d, schemaVersion: 1 }));
const CATALOG: readonly ConstructionContentDefinition[] = [
  ...PLAYTEST_DEFINITIONS.map((d) => ({ ...d, schemaVersion: 1 })),
  ...AFFINITY_DEFINITIONS,
  ...RULE_DEFINITIONS,
  ...Object.values(CONSTRUCTION_COMPONENTS),
];
const entityOf = (i: number) => uuid(20000 + i);
const versionOf = (i: number, revision: number) => uuid(21000 + i + revision * 500);

export interface ConstructionFixtureOptions {
  readonly rulesetId?: string;
  readonly manifestId?: string;
  /** Replace a Definition's payload by canonical key — a new EntityVersion (revision 1) of the same Entity. */
  readonly revise?: Readonly<Record<string, Record<string, unknown>>>;
  readonly omit?: readonly string[];
}

export interface ConstructionFixture {
  readonly ruleset: RulesetContext;
  readonly bundle: ProwessDefinitionBundle;
  readonly ref: (canonicalKey: string) => ProwessDefinitionRef;
}

function resolveRefs(value: unknown, ref: (key: string) => ProwessDefinitionRef): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, ref));
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$ref === "string") return ref(o.$ref);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveRefs(v, ref)]));
  }
  return value;
}

export function constructionFixture(options: ConstructionFixtureOptions = {}): ConstructionFixture {
  const rulesetId = options.rulesetId ?? CONSTRUCTION_RULESET;
  const manifestId = options.manifestId ?? CONSTRUCTION_MANIFEST;
  const catalog = CATALOG.filter((d) => !(options.omit ?? []).includes(d.canonicalKey));
  const index = (d: ConstructionContentDefinition) => CATALOG.findIndex((x) => x.canonicalKey === d.canonicalKey);
  const revision = (d: ConstructionContentDefinition) => (options.revise?.[d.canonicalKey] === undefined ? 0 : 1);
  const refOf = (canonicalKey: string): ProwessDefinitionRef => {
    const d = CATALOG.find((x) => x.canonicalKey === canonicalKey);
    if (d === undefined) throw new Error(`no ${canonicalKey}`);
    return { entityId: entityOf(index(d)), entityVersionId: versionOf(index(d), revision(d)), canonicalKey, definitionKind: d.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family } as unknown as ProwessDefinitionRef;
  };
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
    schemaVersion: d.schemaVersion,
    systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family,
    definitionKind: d.definitionKind,
    entityId: entityOf(index(d)),
    entityVersionId: versionOf(index(d), revision(d)),
    canonicalKey: d.canonicalKey,
    payload: resolveRefs(JSON.parse(JSON.stringify(options.revise?.[d.canonicalKey] ?? d.payload)), refOf) as Record<string, unknown>,
    provenance: { rulesetId, manifestId, releaseId: null, sourceRulesetId: rulesetId, sourceManifestId: manifestId, legacyTerms: d.canonicalKey === "affinity.evocation" ? [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] : [] },
  }));
  const out = createProwessDefinitionBundle({ ruleset: ctx.value, definitions });
  if (!out.ok) throw new Error(JSON.stringify(out.problems, null, 2));
  return { ruleset: ctx.value, bundle: out.value, ref: refOf };
}

// ---- Compositions and requests ---------------------------------------------------------------------------------------

export interface EffectSpec {
  readonly c: ConstructionComponent;
  readonly stacks?: number;
}
export interface AbilitySpec {
  readonly authority?: "ARCANE_AUTHORITY" | "AFFINITY_AUTHORITY" | null;
  readonly affinity?: string | null;
  readonly targeting?: ConstructionComponent;
  readonly effects?: readonly (ConstructionComponent | EffectSpec)[];
  readonly traits?: readonly { readonly trait: ConstructionComponent; readonly appliesTo: string }[];
  readonly conditions?: readonly ConstructionComponent[];
  readonly duration?: ConstructionComponent | null;
  readonly foundation?: ConstructionComponent | null;
}

/** A Spell Composition over fixture components. Effect keys are `effect<n>`, Trait keys `trait<n>`, in authored order. */
export function spellOf(f: ConstructionFixture, spec: AbilitySpec = {}): Record<string, unknown> {
  const def = (c: ConstructionComponent) => f.ref(CONSTRUCTION_COMPONENTS[c].canonicalKey);
  const effects = (spec.effects ?? ["directDamage"]).map((e) => (typeof e === "string" ? { c: e } : e));
  return {
    compositionKey: "composition.spell.construction_test",
    abilityKind: "SPELL",
    affinity: spec.affinity === null || spec.affinity === undefined ? null : { componentKey: "affinity", definition: f.ref(spec.affinity), parameters: {} },
    authority: spec.authority === null ? null : { authority: spec.authority ?? "ARCANE_AUTHORITY" },
    keywords: [],
    targeting: { componentKey: "targeting", definition: def(spec.targeting ?? "single"), parameters: {} },
    effects: effects.map((e, i) => ({ componentKey: `effect${String(i + 1)}`, order: (i + 1) * 10, definition: def(e.c), parameters: e.stacks === undefined ? {} : { stacks: e.stacks } })),
    traits: (spec.traits ?? []).map((t, i) => ({ componentKey: `trait${String(i + 1)}`, order: (i + 1) * 10, definition: def(t.trait), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: t.appliesTo }, parameters: {} })),
    duration: spec.duration === null ? null : { componentKey: "duration", definition: def(spec.duration ?? "instant"), parameters: {} },
    conditions: (spec.conditions ?? []).map((c, i) => ({ componentKey: `condition${String(i + 1)}`, order: (i + 1) * 10, definition: def(c), parameters: {} })),
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
}

/** A Maneuver Composition over fixture components (Foundation: a weapon attack unless stated otherwise). */
export function maneuverOf(f: ConstructionFixture, spec: AbilitySpec = {}): Record<string, unknown> {
  const def = (c: ConstructionComponent) => f.ref(CONSTRUCTION_COMPONENTS[c].canonicalKey);
  const effects = (spec.effects ?? ["strike"]).map((e) => (typeof e === "string" ? { c: e } : e));
  return {
    compositionKey: "composition.maneuver.construction_test",
    abilityKind: "MANEUVER",
    affinity: spec.affinity === null || spec.affinity === undefined ? null : { componentKey: "affinity", definition: f.ref(spec.affinity), parameters: {} },
    authority: spec.authority === undefined || spec.authority === null ? null : { authority: spec.authority },
    keywords: [],
    targeting: { componentKey: "targeting", definition: def(spec.targeting ?? "maneuverSingle"), parameters: {} },
    effects: effects.map((e, i) => ({ componentKey: `effect${String(i + 1)}`, order: (i + 1) * 10, definition: def(e.c), parameters: e.stacks === undefined ? {} : { stacks: e.stacks } })),
    traits: (spec.traits ?? []).map((t, i) => ({ componentKey: `trait${String(i + 1)}`, order: (i + 1) * 10, definition: def(t.trait), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: t.appliesTo }, parameters: {} })),
    duration: spec.duration === null ? null : { componentKey: "duration", definition: def(spec.duration ?? "maneuverInstant"), parameters: {} },
    conditions: (spec.conditions ?? []).map((c, i) => ({ componentKey: `condition${String(i + 1)}`, order: (i + 1) * 10, definition: def(c), parameters: {} })),
    branch: { kind: "MANEUVER", foundation: spec.foundation === null ? null : { componentKey: "foundation", definition: def(spec.foundation ?? "weaponAttack"), parameters: {} }, martialAccess: null, resolutionProfile: null, data: {} },
  };
}

export interface CharacterSpec {
  readonly arcana?: string;
  readonly martial?: string;
  /** Owned Affinities: [canonical key, rank]; the first is PRIMARY. Empty → the character owns no Affinity. */
  readonly affinities?: readonly (readonly [string, string])[];
  readonly pro?: number;
}

export interface RequestSpec {
  readonly trades?: number;
  readonly usedSlots?: number;
  readonly candidate?: Record<string, unknown>;
  readonly accessGrants?: readonly { componentKey: string; sourceKey: string }[];
  readonly subjectKey?: string;
}

export function characterOf(f: ConstructionFixture, c: CharacterSpec = {}): Record<string, unknown> {
  const skillRanks = [
    ...(c.arcana === undefined ? [] : [{ skillKey: "skill.arcana", rankKey: c.arcana }]),
    ...(c.martial === undefined ? [] : [{ skillKey: "skill.martial", rankKey: c.martial }]),
  ];
  const affinities = c.affinities ?? [];
  return {
    stats: { PRO: c.pro ?? 4 },
    skillRanks,
    affinityProfile: affinities.length === 0 ? null : { affinities: affinities.map(([key, rank], i) => ({ affinity: f.ref(key), rank, role: i === 0 ? "PRIMARY" : "SECONDARY", acquisition: null })) },
  };
}

export function requestOf(f: ConstructionFixture, composition: Record<string, unknown>, character: CharacterSpec = {}, spec: RequestSpec = {}): Record<string, unknown> {
  return {
    contractVersion: 1,
    subjectKey: spec.subjectKey ?? "golden",
    composition,
    definitions: f.bundle,
    ruleset: f.ruleset,
    character: characterOf(f, character),
    keywords: keywordCatalog(),
    ...(spec.trades === undefined ? {} : { options: { effectSlotsTradedForTraits: spec.trades } }),
    signature: { usedSlots: spec.usedSlots ?? 0, candidate: spec.candidate ?? { slotUse: "DEFAULT" } },
    ...(spec.accessGrants === undefined ? {} : { accessGrants: spec.accessGrants }),
  };
}
