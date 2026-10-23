import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import { createProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { compileSpellCost, readSpellCostRun, type ProwessSpellCostCompiledPlan, type SpellCostResult } from "../ability/spell-cost.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import { copy, durationConditionFixture, setPath } from "./duration-condition-fixtures.js";
import { effectCharacter } from "./effect-fixtures.js";
import { uuid } from "./fixtures.js";

/**
 * M5-WO10 TEST fixtures (not canonical content, not public surface). The canonical WO6 Targeting, WO7 Effects, WO9
 * Durations / Casting Conditions and WO4 Affinities come from content; the two `fixture.wo10.effect.*` Definitions are
 * copies of the canonical Direct Damage Effect whose only listed contribution is an explicit `mp` count (1 MP per unit)
 * so goldens can construct exact base costs. `fixture.wo10.trait.flat` is the WO8 reference conversion Trait listing a
 * FIXED 2 MP. No game mechanic is added.
 */
type Row = { canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> };
export interface SpellSpec {
  readonly targeting?: string;
  readonly targetingParameters?: Record<string, unknown>;
  readonly effect?: "damage" | "dual" | "canonical";
  readonly mp?: number;
  readonly dice?: number;
  readonly trait?: boolean;
  readonly stackable?: number;
  readonly conditions?: readonly (readonly [string, Record<string, unknown>?])[];
  readonly affinity?: string | null;
}

export function spellCostFixture(options: { rulesetId?: string; manifestId?: string; revise?: Readonly<Record<string, Record<string, unknown>>>; spells?: Readonly<Record<string, SpellSpec>> } = {}) {
  const base = durationConditionFixture({ rulesetId: options.rulesetId, manifestId: options.manifestId, revise: options.revise });
  const rows: Row[] = [];
  const ref = (key: string): ProwessDefinitionRef => {
    const i = rows.findIndex((x) => x.canonicalKey === key);
    if (i < 0) return base.ref(key);
    const row = rows[i]!;
    return { entityId: uuid(81000 + i), entityVersionId: uuid((options.revise?.[key] ? 85000 : 83000) + i), canonicalKey: key, definitionKind: row.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[row.definitionKind].family } as ProwessDefinitionRef;
  };
  const add = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>) => rows.push({ canonicalKey, definitionKind, payload });
  const direct = base.bundle.definitions.find((d) => d.canonicalKey === "spell.effect.direct_damage")!.payload as Record<string, unknown>;
  const effect = (keywords: string[]) => {
    const e = copy(direct);
    setPath(e, "keywords", keywords);
    const params = (e as { rules: { effect: { parameters: unknown[] } } }).rules.effect.parameters;
    params.push({ parameter: "mp", kind: "COUNT", minimum: 0, maximum: { kind: "FIXED", value: 100 }, increment: 1, default: 0 });
    setPath(e, "costContributions", [{ contributionKey: "effect.wo10.mp", currency: "MP", data: { kind: "PER_UNIT", parameter: "mp", amount: 1, includedUnits: 0 } }]);
    return e;
  };
  add("fixture.wo10.effect.damage", "SPELL_EFFECT", effect(["keyword.damage", "keyword.direct_damage", "keyword.instant_effect"]));
  add("fixture.wo10.effect.dual", "SPELL_EFFECT", effect(["keyword.buff", "keyword.direct_damage"]));
  const flat = copy(base.bundle.definitions.find((d) => d.canonicalKey === "fixture.trait.spell")!.payload as Record<string, unknown>);
  setPath(flat, "costContributions", [{ contributionKey: "trait.wo10.flat", currency: "MP", data: { kind: "FIXED", amount: 2 } }]);
  setPath(flat, "rules/trait/name", "Reference flat-cost conversion Trait");
  add("fixture.wo10.trait.flat", "SPELL_TRAIT", flat);

  const spell = (key: string, s: SpellSpec) => {
    const d = copy(base.bundle.definitions.find((x) => x.canonicalKey === "fixture.spell.simple")!.payload) as Record<string, unknown>;
    const use = (k: string, componentKey: string, parameters: Record<string, unknown> = {}) => ({ componentKey, definition: ref(k), parameters });
    setPath(d, "name", key);
    setPath(d, "composition/compositionKey", key);
    setPath(d, "composition/targeting", use(s.targeting ?? "spell.targeting.single_target", "targeting", s.targetingParameters ?? {}));
    const effectKey = s.effect === "canonical" ? "spell.effect.direct_damage" : `fixture.wo10.effect.${s.effect ?? "damage"}`;
    setPath(d, "composition/effects", [{ ...use(effectKey, "effect1", s.effect === "canonical" ? { dice: s.dice ?? 1 } : { dice: 1, mp: s.mp ?? 0 }), order: 10 }]);
    const traits = [...(s.trait ? [{ ...use("fixture.wo10.trait.flat", "trait1"), order: 10, appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: "effect1" } }] : []), ...(s.stackable ? [{ ...use("fixture.trait.stackable", "trait2", { stacks: s.stackable }), order: 20, appliesTo: { scope: "ABILITY_WIDE", componentKey: null } }] : [])];
    setPath(d, "composition/traits", traits);
    setPath(d, "composition/duration", use("spell.duration.instant", "duration"));
    setPath(d, "composition/conditions", (s.conditions ?? []).map(([k, parameters], i) => ({ ...use(`spell.casting_condition.${k}`, `condition${String(i + 1)}`, parameters ?? {}), order: 10 * (i + 1) })));
    if (s.affinity) setPath(d, "composition/affinity", use(s.affinity, "affinity"));
    add(key, "SPELL_DEFINITION", d);
  };
  for (const [key, s] of Object.entries({ ...DEFAULT_SPELLS, ...(options.spells ?? {}) })) spell(key, s);

  const context = createRulesetContext({ ...base.ruleset, rules: [...base.ruleset.rules, ...rows.map((r) => ({ entityId: ref(r.canonicalKey).entityId, entityVersionId: ref(r.canonicalKey).entityVersionId, canonicalKey: r.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[r.definitionKind].entityTypes[0], sourceRulesetId: base.ruleset.rulesetId, sourceManifestId: base.ruleset.manifestId }))] });
  if (!context.ok) throw new Error(JSON.stringify(context.errors));
  const definitions = [...base.bundle.definitions, ...rows.map((row) => ({ ...ref(row.canonicalKey), schemaVersion: 1, payload: options.revise?.[row.canonicalKey] ?? row.payload, provenance: { rulesetId: context.value.rulesetId, manifestId: context.value.manifestId, releaseId: null, sourceRulesetId: context.value.rulesetId, sourceManifestId: context.value.manifestId, legacyTerms: [] } }))];
  const bundle = createProwessDefinitionBundle({ ruleset: context.value, definitions });
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems, null, 2));
  const rowPayload = (key: string) => copy(rows.find((x) => x.canonicalKey === key)!.payload);
  const request = (key: string, character: Record<string, unknown> = effectCharacter()) => ({ ...base.request(undefined, character as ReturnType<typeof effectCharacter>), subjectKey: "wo10", definition: ref(key), definitions: bundle.value, ruleset: context.value });
  return { ruleset: context.value, bundle: bundle.value, ref, rowPayload, request };
}

/** A Spell per golden (M5-WO10). Single Target lists 3 MP; Touch 1 MP. */
export const DEFAULT_SPELLS: Readonly<Record<string, SpellSpec>> = {
  "fixture.wo10.spell.simple": { mp: 8, trait: true }, // 3 + 8 + 2 + 0 = 13
  "fixture.wo10.spell.half": { mp: 12, conditions: [["verbal"]] }, // 15 × 90% = 13.5 → 14
  "fixture.wo10.spell.legacy": { mp: 10, conditions: [["verbal"]] }, // 13 × 90% = 11.7 → 12 (never 11)
  "fixture.wo10.spell.strength": { mp: 17, affinity: "affinity.evocation" }, // 20 × 80% = 16
  "fixture.wo10.spell.strength_weakness": { effect: "dual", mp: 17, affinity: "affinity.transmutation" }, // 20 × 90% = 18
  "fixture.wo10.spell.combined": { effect: "dual", mp: 17, affinity: "affinity.transmutation", conditions: [["verbal"]] }, // 20 × 80% = 16
  "fixture.wo10.spell.cap": { mp: 17, conditions: [["verbal"], ["anchored"], ["limited_use", { period: "COMBAT" }]] }, // 45% listed → 30% → 14
  "fixture.wo10.spell.ap": { mp: 14 }, // 17 MP, PRO 4 → 4 AP
  "fixture.wo10.spell.somatic": { mp: 14, conditions: [["somatic"]] }, // 17 MP → 4 − 1 = 3 AP
  "fixture.wo10.spell.minimum": { targeting: "spell.targeting.touch", mp: 1, conditions: [["somatic"]] }, // 2 MP, PRO 5 → 1 AP
  "fixture.wo10.spell.high": { mp: 33 }, // 36 MP, PRO 5 → 7 AP
  "fixture.wo10.spell.charge": { mp: 17, conditions: [["charge", { extraAp: 1 }]] }, // 20 × 90% = 18 MP; 4 + 1 = 5 AP
  "fixture.wo10.spell.dice": { effect: "canonical", dice: 3 }, // 3 + 3 × 4 = 15
  "fixture.wo10.spell.stackable": { mp: 5, stackable: 2 }, // 3 + 5 + 2 (Trait COST ADD of 2 stacks) = 10
};

export const spellCostCharacter = (pro = 4, affinity: readonly [ProwessDefinitionRef, string] | null = null) => ({ ...effectCharacter({ pro }), affinityProfile: affinity === null ? null : { affinities: [{ affinity: affinity[0], rank: affinity[1], role: "PRIMARY", acquisition: null }] } });

export interface SpellCostRun {
  readonly plan: ProwessSpellCostCompiledPlan;
  readonly run: EvaluationRun;
  readonly result: SpellCostResult;
}

/** compile → frozen M4 → read. Throws on any failure. */
export function runSpellCost(request: Record<string, unknown>): SpellCostRun {
  const plan = compileSpellCost(request);
  if (!plan.ok) throw new Error(`compile failed: ${JSON.stringify(plan.problems, null, 2)}`);
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo10.test", contexts: { ruleset: request.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  const failed = response.data.steps.filter((s) => s.response === null || !s.response.success);
  if (failed.length > 0) throw new Error(`steps failed: ${JSON.stringify(failed.map((s) => [s.stepKey, s.executionStatus, s.response?.errors]), null, 2)}`);
  const result = readSpellCostRun(plan.value, response.data);
  if (!result.ok) throw new Error(`reading failed: ${JSON.stringify(result.problems)}`);
  return { plan: plan.value, run: response.data, result: result.value };
}
