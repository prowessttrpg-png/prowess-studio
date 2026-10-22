import { beforeAll, describe, expect, it, vi } from "vitest";
import { orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import { compileAbilityDefinition, readAbilityDefinitionRun, type ProwessAbilityDefinitionCompiledPlan } from "./ability/compile.js";
import { abilityDefinitionFixture, authoredFixturePayload } from "./testing/ability-definition-fixtures.js";
import { createProwessDefinitionEnvelope } from "./definition/envelope.js";

vi.setConfig({ testTimeout: 60_000 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
describe("WO8 security and historical identity", () => {
  let plan: ProwessAbilityDefinitionCompiledPlan, run: EvaluationRun;
  beforeAll(() => {
    const f = abilityDefinitionFixture(), req = f.request("fixture.spell.simple");
    const p = compileAbilityDefinition(req); if (!p.ok) throw new Error(JSON.stringify(p.problems)); plan = p.value;
    const response = orchestrateRulesEvaluation({ evaluationKey: "security", contexts: { ruleset: req.ruleset }, plan: plan.evaluationPlan });
    if (!response.success || !response.data) throw new Error("fixture"); run = response.data;
  });
  it.each(["partial", "duplicate", "identity", "operation", "order", "provenance", "failed", "blocked"])("rejects %s evaluation runs", mode => {
    const raw = copy(run) as unknown as { executionStatus: string; steps: { stepKey: string; order: number; operation: string; executionStatus: string; response: { success: boolean; ruleset: { manifestId: string } } }[] };
    const first = raw.steps[0]!;
    if (mode === "partial") raw.steps.pop();
    if (mode === "duplicate") raw.steps[1] = copy(first);
    if (mode === "identity") first.stepKey = "foreign.step";
    if (mode === "operation") first.operation = "DICE";
    if (mode === "order") first.order = 99999;
    if (mode === "provenance") first.response.ruleset.manifestId = "foreign";
    if (mode === "failed") first.response.success = false;
    if (mode === "blocked") first.executionStatus = "BLOCKED";
    expect(readAbilityDefinitionRun(plan, raw).ok).toBe(false);
    expect(readAbilityDefinitionRun(plan, { ...run, steps: [null] }).ok).toBe(false);
  });
  it("rejects unsafe inputs before invoking getters or callbacks", () => {
    const callback = vi.fn();
    const f = abilityDefinitionFixture(), req = f.request("fixture.spell.simple");
    for (const bad of [() => callback(), NaN, Infinity, new Date(), Symbol("x"), BigInt(1)]) expect(compileAbilityDefinition({ ...req, injected: bad }).ok).toBe(false);
    const accessor = Object.defineProperty({}, "definition", { get: callback, enumerable: true });
    expect(compileAbilityDefinition(accessor).ok).toBe(false); expect(callback).not.toHaveBeenCalled();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(compileAbilityDefinition(cycle).ok).toBe(false);
    expect(compileAbilityDefinition({ ...req, definitions: { ...req.definitions, rulesetProvenance: {} } }).ok).toBe(false);
  });
  it("a Trait cannot author additional damage, healing, summon or Condition outcomes", () => {
    const f = abilityDefinitionFixture(), env = copy(f.bundle.definitions.find(d => d.canonicalKey === "fixture.trait.spell")!);
    for (const kind of ["DAMAGE", "HEAL", "SUMMON", "APPLY_CONDITION"]) {
      const bad = copy(env) as unknown as { payload: { rules: { trait: { modifications: unknown[] } } } };
      bad.payload.rules.trait.modifications = [{ kind, amount: 999 }]; expect(createProwessDefinitionEnvelope(bad).ok).toBe(false);
    }
  });
  it("historical definitions reproduce after a new Trait cost version is authored", () => {
    const a = abilityDefinitionFixture();
    const revised = authoredFixturePayload(a, "fixture.trait.spell");
    revised.costContributions = [{ contributionKey: "trait.mp", currency: "MP", data: { kind: "FIXED", amount: 7 } }];
    const b = abilityDefinitionFixture({ manifestId: "00000000-0000-4000-8000-000000007777", revise: { "fixture.trait.spell": revised } });
    const old = compileAbilityDefinition(a.request("fixture.spell.simple")), fresh = compileAbilityDefinition(b.request("fixture.spell.simple"));
    expect(old.ok && fresh.ok).toBe(true); if (!old.ok || !fresh.ok) return;
    expect(old.value.traits[0]!.costs[0]).toMatchObject({ amount: 4 });
    expect(fresh.value.traits[0]!.costs[0]).toMatchObject({ amount: 7 });
    expect(old.value.traits[0]!.definition.entityVersionId).not.toBe(fresh.value.traits[0]!.definition.entityVersionId);
    expect(compileAbilityDefinition(a.request("fixture.spell.simple"))).toEqual(old);
    expect(compileAbilityDefinition({ ...a.request("fixture.spell.simple"), definition: b.ref("fixture.spell.simple"), definitions: b.bundle }).ok).toBe(false);
  });
});
