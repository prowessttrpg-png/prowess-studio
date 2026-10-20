import { createRulesetContext, type RulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import targetingContent from "../content/core-playtest-v0.1/targeting.json";
import constructionContent from "../content/core-playtest-v0.1/ability-construction.json";
import { TARGETING_WO7_AMENDMENTS } from "../content/core-playtest-v0.1/targeting-wo7-amendments.js";
import { EFFECT_REFERENCE_CONTENT } from "../content/core-playtest-v0.1/effects.js";
import { AFFINITY_DEFINITIONS, keywordCatalog } from "./affinity-fixtures.js";
import { PLAYTEST_DEFINITIONS } from "./core-fixtures.js";
import { uuid } from "./fixtures.js";
import { validateEffectUse, type EffectUseResult } from "../effect/compile.js";

interface FixtureDefinition { readonly canonicalKey: string; readonly definitionKind: ProwessDefinitionKind; readonly schemaVersion: number; readonly payload: Record<string, unknown>; }
const TARGETING = targetingContent as unknown as { readonly definitions: readonly FixtureDefinition[] };
const CONSTRUCTION = constructionContent as unknown as { readonly definitions: readonly FixtureDefinition[] };
const EFFECTS = EFFECT_REFERENCE_CONTENT as unknown as { readonly definitions: readonly FixtureDefinition[] };
const AMENDMENTS = TARGETING_WO7_AMENDMENTS as unknown as { readonly definitions: readonly FixtureDefinition[] };
const common = (extra: Record<string, unknown> = {}) => ({ keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {}, ...extra });
const SUPPORT: readonly FixtureDefinition[] = [
  { canonicalKey: "spell.duration.instant", definitionKind: "SPELL_DURATION", schemaVersion: 1, payload: common({ durationConcept: "INSTANT" }) },
  { canonicalKey: "maneuver.duration.instant", definitionKind: "MANEUVER_DURATION", schemaVersion: 1, payload: common({ durationConcept: "INSTANT" }) },
  { canonicalKey: "maneuver.foundation.weapon_attack", definitionKind: "MANEUVER_FOUNDATION", schemaVersion: 1, payload: common({ foundationKind: "WEAPON_ATTACK", compatibility: [{ relation: "TARGETING", allow: ["SINGLE_TARGET"] }] }) },
];
const BASE: readonly FixtureDefinition[] = [
  ...PLAYTEST_DEFINITIONS.map((d) => ({ ...d, schemaVersion: 1 } as FixtureDefinition)),
  ...(AFFINITY_DEFINITIONS as unknown as readonly FixtureDefinition[]),
  ...CONSTRUCTION.definitions,
  ...TARGETING.definitions,
  ...EFFECTS.definitions,
  ...SUPPORT,
];
const amendment = new Map(AMENDMENTS.definitions.map((d) => [d.canonicalKey, d.payload]));

export const EFFECT_RULESET = uuid(8701);
export const EFFECT_MANIFEST = uuid(8702);
export const EFFECT_RULESET_2 = uuid(8711);
export const EFFECT_MANIFEST_2 = uuid(8712);

export interface EffectFixtureOptions {
  readonly rulesetId?: string;
  readonly manifestId?: string;
  /** true = current WO7 canon; false = exact WO6 historical Targeting assumptions. */
  readonly currentCanon?: boolean;
  /** Revised Effect content for historical-reproducibility tests. */
  readonly revise?: Readonly<Record<string, Record<string, unknown>>>;
}
export interface EffectFixture { readonly ruleset: RulesetContext; readonly bundle: ProwessDefinitionBundle; readonly ref: (canonicalKey: string) => ProwessDefinitionRef; }

function resolveRefs(value: unknown, ref: (key: string) => ProwessDefinitionRef): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, ref));
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$ref === "string") return ref(o.$ref);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveRefs(v, ref)]));
  }
  return value;
}

export function effectFixture(options: EffectFixtureOptions = {}): EffectFixture {
  const rulesetId = options.rulesetId ?? EFFECT_RULESET, manifestId = options.manifestId ?? EFFECT_MANIFEST, currentCanon = options.currentCanon ?? true;
  const ix = new Map(BASE.map((d, i) => [d.canonicalKey, i]));
  const payloadOf = (d: FixtureDefinition) => options.revise?.[d.canonicalKey] ?? (currentCanon && amendment.has(d.canonicalKey) ? amendment.get(d.canonicalKey)! : d.payload);
  const revision = (d: FixtureDefinition) => options.revise?.[d.canonicalKey] !== undefined ? 2 : currentCanon && amendment.has(d.canonicalKey) ? 1 : 0;
  const entity = (i: number) => uuid(40000 + i), version = (i: number, r: number) => uuid(42000 + i + r * 500);
  const ref = (canonicalKey: string): ProwessDefinitionRef => {
    const d = BASE.find((x) => x.canonicalKey === canonicalKey); if (!d) throw new Error(`no fixture Definition ${canonicalKey}`); const i = ix.get(canonicalKey)!;
    return { entityId: entity(i), entityVersionId: version(i, revision(d)), canonicalKey, definitionKind: d.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family };
  };
  const ctx = createRulesetContext({ rulesetId, manifestId, rules: BASE.map((d) => { const i = ix.get(d.canonicalKey)!; return { entityId: entity(i), entityVersionId: version(i, revision(d)), canonicalKey: d.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0], sourceRulesetId: rulesetId, sourceManifestId: manifestId }; }) });
  if (!ctx.ok) throw new Error(JSON.stringify(ctx.problems));
  const definitions = BASE.map((d) => { const i = ix.get(d.canonicalKey)!; return { schemaVersion: d.schemaVersion, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family, definitionKind: d.definitionKind, entityId: entity(i), entityVersionId: version(i, revision(d)), canonicalKey: d.canonicalKey, payload: resolveRefs(structuredClone(payloadOf(d)), ref), provenance: { rulesetId, manifestId, releaseId: null, sourceRulesetId: rulesetId, sourceManifestId: manifestId, legacyTerms: [] } }; });
  const bundle = createProwessDefinitionBundle({ ruleset: ctx.value, definitions }); if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems, null, 2));
  return { ruleset: ctx.value, bundle: bundle.value, ref };
}

export function spellEffectAbility(f: EffectFixture, effectKey: string, targeting = "spell.targeting.single_target", parameters: Record<string, unknown> = {}) {
  return { compositionKey: "composition.spell.effect_test", abilityKind: "SPELL", affinity: null, authority: { authority: "ARCANE_AUTHORITY" }, keywords: [], targeting: { componentKey: "targeting", definition: f.ref(targeting), parameters: {} }, effects: [{ componentKey: "effect1", order: 10, definition: f.ref(effectKey), parameters }], traits: [], duration: { componentKey: "duration", definition: f.ref("spell.duration.instant"), parameters: {} }, conditions: [], branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} } };
}
export function maneuverEffectAbility(f: EffectFixture, effectKey: string, targeting = "maneuver.targeting.single_target", parameters: Record<string, unknown> = {}) {
  return { compositionKey: "composition.maneuver.effect_test", abilityKind: "MANEUVER", affinity: null, authority: null, keywords: [], targeting: { componentKey: "targeting", definition: f.ref(targeting), parameters: {} }, effects: [{ componentKey: "effect1", order: 10, definition: f.ref(effectKey), parameters }], traits: [], duration: { componentKey: "duration", definition: f.ref("maneuver.duration.instant"), parameters: {} }, conditions: [], branch: { kind: "MANEUVER", foundation: { componentKey: "foundation", definition: f.ref("maneuver.foundation.weapon_attack"), parameters: {} }, martialAccess: null, resolutionProfile: null, data: {} } };
}
export const effectCharacter = (spec: { pro?: number; per?: number; str?: number; arcana?: string; martial?: string } = {}) => ({ stats: { STR: spec.str ?? 5, AGI: 4, CON: 4, PER: spec.per ?? 4, PRO: spec.pro ?? 4, RES: 4 }, skillRanks: [{ skillKey: "skill.arcana", rankKey: spec.arcana ?? "MASTER" }, { skillKey: "skill.martial", rankKey: spec.martial ?? "MASTER" }], affinityProfile: null });
export const effectRequest = (f: EffectFixture, composition: Record<string, unknown>, character = effectCharacter()) => ({ contractVersion: 1, subjectKey: "effect.fixture", componentKey: "effect1", composition, definitions: f.bundle, ruleset: f.ruleset, character, keywords: keywordCatalog(), signature: { usedSlots: 0, candidate: { slotUse: "DEFAULT" as const } } });
export function runEffect(f: EffectFixture, composition: Record<string, unknown>, character = effectCharacter()): EffectUseResult { const r = validateEffectUse(effectRequest(f, composition, character)); if (!r.ok) throw new Error(JSON.stringify(r.problems, null, 2)); return r.value; }
