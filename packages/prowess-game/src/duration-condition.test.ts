import { describe, expect, it, vi } from "vitest";
import { compileAbilityDefinition, evaluateAbilityDefinition, readAbilityDefinitionRun } from "./ability/compile.js";
import { orchestrateRulesEvaluation } from "@prowess/rules";
import { createProwessDefinitionEnvelope } from "./definition/envelope.js";
import { serializeAuthoredAbilityDefinition, deserializeAuthoredAbilityDefinition } from "./definition/authored-ability-payload.js";
import { durationConditionFixture, fixtureRequestWith, WO9_REFERENCE_KEYS, copy, setPath } from "./testing/duration-condition-fixtures.js";
import { abilityDefinitionFixture } from "./testing/ability-definition-fixtures.js";
import { effectCharacter } from "./testing/effect-fixtures.js";
vi.setConfig({ testTimeout: 60_000 });
const f = durationConditionFixture();
const run = (key: string) => { const r = evaluateAbilityDefinition(f.request(key)); if (!r.ok) throw new Error(JSON.stringify(r.problems)); return r.value; };
describe("M5-WO9 Duration & Ability Condition Framework", () => {
  it.each(WO9_REFERENCE_KEYS)("compiles the reference %s using permanent construction, targeting, Effect and M4 contracts", key => {
    const r = run(key); expect(r.valid).toBe(![WO9_REFERENCE_KEYS[4], WO9_REFERENCE_KEYS[9]].includes(key)); expect(r.durationConditions).toBeTruthy();
  });
  it("exposes Verbal and Somatic only as listed percentage/AP contributions and runtime contracts", () => {
    const r = run(WO9_REFERENCE_KEYS[1]!).durationConditions!;
    expect(r.conditions.flatMap(c => c.listedContributions).map(c => [c.modifier, c.listedValue])).toEqual([["MP_PERCENT_REDUCTION", 10], ["AP_REDUCTION", 1]]);
    expect(r.conditionSummary).toMatchObject({ usedCapacity: 2, maximumCapacity: 3, spellMpPercent: { maximum: 30, listed: 10, effective: 10, excess: 0 }, maneuverAp: { listed: 0 }, costStage: "LISTED_COMPONENT_CONTRIBUTIONS_ONLY" });
    expect(r.conditions.every(c => c.runtimeRequirements.every(q => q.status === "REQUIREMENT_CONTRACT_ONLY"))).toBe(true);
  });
  it("Charge exposes both sides, with a flat 30% cap independent of rank slots", () => {
    const r = run(WO9_REFERENCE_KEYS[5]!).durationConditions!;
    expect(r.conditionSummary.spellMpPercent).toEqual({ maximum: 30, listed: 50, effective: 30, excess: 20 });
    expect(r.conditions[1]!.listedContributions.map(c => [c.modifier, c.listedValue])).toEqual([["AP_COMMITMENT", 4], ["MP_PERCENT_REDUCTION", 40]]);
    for (const rank of ["TRAINED", "EXPERT", "MASTER"]) {
      const req = fixtureRequestWith(f, WO9_REFERENCE_KEYS[5]!, "composition/conditions", [{ componentKey: "charge", order: 1, definition: f.ref("spell.casting_condition.charge"), parameters: { extraAp: 5 } }]);
      const q = evaluateAbilityDefinition({ ...req, character: effectCharacter({ arcana: rank }) });
      expect(q.ok && q.value.valid).toBe(true); if (q.ok) expect(q.value.durationConditions!.conditionSummary.spellMpPercent.effective).toBe(30);
    }
  });
  it("selects AP OR MP explicitly and rejects an AP total over three", () => {
    const r = run(WO9_REFERENCE_KEYS[8]!).durationConditions!;
    expect(r.conditions[0]).toMatchObject({ selectedCostOption: "MP", listedContributions: [{ modifier: "MP_REDUCTION", listedValue: 3 }] });
    const cap = run(WO9_REFERENCE_KEYS[9]!); expect(cap.valid).toBe(false);
    expect(cap.durationConditions!.conditionSummary.maneuverAp).toEqual({ listed: 4, effective: 3, excess: 1, maximum: 3 });
  });
  it.each(["scene", "combat", "mission", "mana_lock", "sustained"])("represents %s without executing maintenance or payment", mode => {
    const req = fixtureRequestWith(f, WO9_REFERENCE_KEYS[6]!, "composition/duration/definition", f.ref(`spell.duration.${mode}`));
    const r = evaluateAbilityDefinition(req); expect(r.ok && r.value.valid).toBe(true);
    if (r.ok) expect(r.value.durationConditions!.duration).toMatchObject({ mode: mode.toUpperCase(), costStatus: "UNLISTED", listedContributions: [] });
    expect(JSON.stringify(r)).not.toMatch(/"(finalMp|finalAp|resourcePayment|activeEffects|combatState)"/);
  });
  it("all declarative source components retain exact envelope identity and valid closed contracts", () => {
    for (const d of f.bundle.definitions.filter(d => d.definitionKind.includes("DURATION") || d.definitionKind.includes("CONDITION"))) expect(createProwessDefinitionEnvelope(d).ok, d.canonicalKey).toBe(true);
    expect(run(WO9_REFERENCE_KEYS[2]!).durationConditions!.duration.parameters).toEqual({ rounds: 3 });
    expect(run(WO9_REFERENCE_KEYS[10]!).durationConditions!.duration.definition.definitionKind).toBe("MANEUVER_DURATION");
  });
  it("validates Limited Use selections without final percentage netting", () => {
    for (const [period, value] of [["SCENE", 10], ["COMBAT", 20], ["MISSION", 30]] as const) {
      const req = fixtureRequestWith(f, WO9_REFERENCE_KEYS[0]!, "composition/conditions", [{ componentKey: "limit", order: 1, definition: f.ref("spell.casting_condition.limited_use"), parameters: { period } }]);
      const r = evaluateAbilityDefinition(req); expect(r.ok && r.value.valid).toBe(true); if (r.ok) expect(r.value.durationConditions!.conditionSummary.spellMpPercent.effective).toBe(value);
    }
  });
  it("cites authored Ability, exact components and policy on every WO9 step", () => {
    const p = compileAbilityDefinition(f.request(WO9_REFERENCE_KEYS[5]!)); expect(p.ok).toBe(true); if (!p.ok) return;
    for (const e of p.value.sourceMap.entries.filter(e => e.role.includes("wo9."))) {
      expect(e.definitions).toContainEqual(f.ref(WO9_REFERENCE_KEYS[5]!)); expect(e.definitions.length).toBeGreaterThan(1); expect(e.componentKeys.length).toBeGreaterThan(0);
      for (const d of e.definitions) expect(f.bundle.definitions.some(q => q.entityVersionId === d.entityVersionId)).toBe(true);
    }
    expect(p.value.sourceMap.entries.some(e => e.definitions.some(d => d.canonicalKey === "spell.casting_condition.charge"))).toBe(true);
  });
  it("preserves exact historical Duration and Condition versions across isolated R1/R2 evaluation", () => {
    const duration = copy(f.bundle.definitions.find(d => d.canonicalKey === "spell.duration.rounds")!.payload), verbal = copy(f.bundle.definitions.find(d => d.canonicalKey === "spell.casting_condition.verbal")!.payload);
    setPath(duration, "rules/duration/costStatus", "AUTHORED"); setPath(duration, "costContributions", [{ contributionKey: "fixture.duration.mp", currency: "MP", data: { kind: "FIXED", amount: 2 } }]);
    setPath(verbal, "costContributions/0/data/amount", 15);
    const next = durationConditionFixture({ rulesetId: "00000000-0000-4000-8000-000000009909", manifestId: "00000000-0000-4000-8000-000000009919", revise: { "spell.duration.rounds": duration, "spell.casting_condition.verbal": verbal } });
    const before = evaluateAbilityDefinition(f.request()), after = evaluateAbilityDefinition(next.request()); expect(after.ok && after.value.valid).toBe(true);
    if (before.ok && after.ok) { expect(before.value.durationConditions!.conditionSummary.spellMpPercent.listed).toBe(10); expect(after.value.durationConditions!.conditionSummary.spellMpPercent.listed).toBe(15); }
    const timed = evaluateAbilityDefinition(next.request(WO9_REFERENCE_KEYS[2]!)); expect(timed.ok).toBe(true); if (timed.ok) expect(timed.value.durationConditions!.duration.listedContributions[0]!.listedValue).toBe(2);
    expect(evaluateAbilityDefinition(f.request())).toEqual(before);
    expect(compileAbilityDefinition({ ...f.request(), definitions: next.bundle }).ok).toBe(false);
    expect(f.ref("spell.duration.rounds").entityVersionId).not.toBe(next.ref("spell.duration.rounds").entityVersionId);
    expect(f.ref("spell.casting_condition.verbal").entityVersionId).not.toBe(next.ref("spell.casting_condition.verbal").entityVersionId);
  });
  it("is detached, immutable, stable under bundle permutations, and losslessly serializable", () => {
    const req = f.request(), bytes = JSON.stringify(req), p = compileAbilityDefinition(req), result = evaluateAbilityDefinition(req);
    expect(JSON.stringify(req)).toBe(bytes); expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(result)).toBe(true);
    const reversed = copy(req); (reversed.definitions.definitions as unknown[]).reverse();
    expect(compileAbilityDefinition(reversed)).toEqual(p); expect(evaluateAbilityDefinition(JSON.parse(bytes))).toEqual(result);
    const env = f.bundle.definitions.find(d => d.canonicalKey === WO9_REFERENCE_KEYS[1])!, serialized = serializeAuthoredAbilityDefinition("SPELL_DEFINITION", env.payload); expect(serialized.ok).toBe(true);
    if (serialized.ok) expect(deserializeAuthoredAbilityDefinition("SPELL_DEFINITION", serialized.value)).toEqual({ ok: true, value: env.payload });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
  it("keeps all WO8 Inspector plans identical when the typed WO9 extension is absent", () => {
    const old = abilityDefinitionFixture(), p = compileAbilityDefinition(old.request("fixture.spell.simple")); expect(p.ok).toBe(true); if (p.ok) expect(p.value).not.toHaveProperty("durationConditions");
  });
  it("rejects unsafe data before invoking accessors or executable values", () => {
    const callback = vi.fn(), req = copy(f.request());
    const bad = Object.defineProperty({}, "definition", { get: callback, enumerable: true }); expect(compileAbilityDefinition(bad).ok).toBe(false); expect(callback).not.toHaveBeenCalled();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [callback, cycle, NaN, Infinity, BigInt(1), new Date(), Object.create({ a: 1 }), JSON.parse('{"__proto__":{"polluted":true}}')]) expect(compileAbilityDefinition({ ...req, injected: value }).ok).toBe(false);
    expect({}).not.toHaveProperty("polluted");
  });
  it("requires complete exact M4 execution for the new contributions", () => {
    const req = f.request(), p = compileAbilityDefinition(req); if (!p.ok) throw new Error(JSON.stringify(p.problems));
    const r = orchestrateRulesEvaluation({ evaluationKey: "wo9", contexts: { ruleset: req.ruleset }, plan: p.value.evaluationPlan }); if (!r.data) throw new Error(JSON.stringify(r.errors));
    expect(readAbilityDefinitionRun(p.value, r.data).ok).toBe(true);
    const partial = copy(r.data); (partial.steps as unknown[]).pop(); expect(readAbilityDefinitionRun(p.value, partial).ok).toBe(false);
    const malformed = copy(r.data); const step = malformed.steps.find(s => s.stepKey.includes(".wo9.") && s.operation === "FORMULA")!;
    setPath(step, "response/data", {}); expect(readAbilityDefinitionRun(p.value, malformed).ok).toBe(false);
  });
  it("accepts an explicit authored slot exemption without changing the percentage cap", () => {
    const req = copy(f.request()), d = req.definitions.definitions.find(d => d.canonicalKey === "spell.casting_condition.verbal")!;
    setPath(d.payload, "rules/condition/consumesSlot", false); setPath(d.payload, "rules/condition/slotExemption", "fixture.exact_slot_exemption");
    const r = evaluateAbilityDefinition({ ...req, character: effectCharacter({ arcana: "TRAINED" }) }); expect(r.ok && r.value.valid).toBe(true);
    if (r.ok) expect(r.value.durationConditions!.conditionSummary).toMatchObject({ usedCapacity: 1, maximumCapacity: 1, spellMpPercent: { maximum: 30, listed: 10 } });
  });
  it("checks Trait/Duration compatibility using exact structured metadata", () => {
    const req = copy(f.request());
    setPath(req.definitions.definitions.find(d => d.canonicalKey === WO9_REFERENCE_KEYS[1])!.payload, "composition/traits", [{ componentKey: "trait", order: 1, definition: f.ref("fixture.trait.stackable"), parameters: { stacks: 1 }, appliesTo: { scope: "ABILITY_WIDE", componentKey: null } }]);
    const d = req.definitions.definitions.find(d => d.canonicalKey === "fixture.trait.stackable")!;
    setPath(d.payload, "compatibility", [{ relation: "DURATION", allow: ["INSTANT"] }]); expect(evaluateAbilityDefinition(req).ok).toBe(true);
    setPath(d.payload, "compatibility", [{ relation: "DURATION", allow: ["ROUNDS"] }]); const r = evaluateAbilityDefinition(req); expect(r.ok && r.value.valid).toBe(false);
  });
  it("recognizes a compiled Effect Save and projectile delivery without interpreting prose", () => {
    const req = copy(f.request(WO9_REFERENCE_KEYS[2]!));
    const ability = req.definitions.definitions.find(d => d.canonicalKey === WO9_REFERENCE_KEYS[2])!, cond = req.definitions.definitions.find(d => d.canonicalKey === "spell.casting_condition.verbal")!;
    setPath(ability.payload, "composition/effects/0/definition", f.ref("spell.effect.impair"));
    setPath(ability.payload, "composition/conditions", [{ componentKey: "condition", order: 1, definition: f.ref("spell.casting_condition.verbal"), parameters: {} }]);
    setPath(cond.payload, "restriction/restrictionKey", "SAVE_RESTRICTION"); setPath(cond.payload, "rules/condition/applicability", { kind: "NUMERIC_COMPARE", factKey: "mechanic.save", operator: ">=", expected: 1 });
    const r = evaluateAbilityDefinition(req); expect(r.ok && r.value.valid).toBe(true);
    setPath(ability.payload, "composition/targeting/definition", f.ref("spell.targeting.projectile"));
    setPath(cond.payload, "restriction/restrictionKey", "ATTACK_RESTRICTION"); setPath(cond.payload, "rules/condition/applicability/factKey", "mechanic.attack");
    const p = evaluateAbilityDefinition(req); expect(p.ok && p.value.valid).toBe(true);
  });
});
