import { describe, expect, it, vi } from "vitest";
import { orchestrateRulesEvaluation } from "@prowess/rules";
import { compileAbilityDefinition, evaluateAbilityDefinition } from "./ability/compile.js";
import { abilityDefinitionFixture, authoredFixturePayload } from "./testing/ability-definition-fixtures.js";
import { createProwessDefinitionEnvelope } from "./definition/envelope.js";
vi.setConfig({ testTimeout: 60_000 });

describe("WO8 typed Trait contracts", () => {
  it("canonical Widen Area adds 5 ft through M4 MODIFIER and reports its exact source and +6 MP", () => {
    const f = abilityDefinitionFixture(), payload = authoredFixturePayload(f, "fixture.spell.simple");
    const composition = payload.composition as { targeting: { definition: unknown }; effects: { definition: unknown; parameters: unknown }[]; traits: { definition: unknown; appliesTo: unknown; parameters: unknown }[] };
    composition.targeting.definition = f.ref("spell.targeting.radius");
    Object.assign(composition.effects[0]!, { definition: f.ref("spell.effect.detect_mana"), parameters: {} });
    Object.assign(composition.traits[0]!, { definition: f.ref("spell.trait.widen_area"), appliesTo: { scope: "TARGETING", componentKey: "targeting" }, parameters: {} });
    const revised = abilityDefinitionFixture({ revise: { "fixture.spell.simple": payload } }), req = revised.request("fixture.spell.simple");
    const plan = compileAbilityDefinition(req), result = evaluateAbilityDefinition(req);
    expect(plan.ok).toBe(true);
    if (plan.ok) { const r = orchestrateRulesEvaluation({ evaluationKey: "widen", contexts: { ruleset: req.ruleset }, plan: plan.value.evaluationPlan }); expect(r.data?.steps.filter(s => !s.response?.success), JSON.stringify(r.errors)).toEqual([]); }
    expect(result.ok).toBe(true); if (!plan.ok || !result.ok) return;
    expect(result.value.problems).toEqual([]); expect(result.value.targeting.geometry.find(g => g.measure === "RADIUS")?.value).toBe(20);
    expect(result.value.targetingChanges).toEqual([{ actionKey: null, measure: "RADIUS", value: 25, definitions: [f.ref("spell.trait.widen_area")] }]);
    expect(result.value.traits[0]!.costs[0]).toMatchObject({ currency: "MP", amount: 6 });
    expect(plan.value.evaluationPlan.steps.find(s => s.stepKey === plan.value.targetingChanges[0]!.stepKey)?.operation).toBe("MODIFIER");
    composition.targeting.definition = f.ref("spell.targeting.line");
    const bad = abilityDefinitionFixture({ revise: { "fixture.spell.simple": payload } });
    expect(compileAbilityDefinition(bad.request("fixture.spell.simple")).ok).toBe(false);
  });
  it("SHARED is explicit and can attach to either family without coercing branch-specific Traits", () => {
    const f = abilityDefinitionFixture();
    for (const key of ["fixture.spell.simple", "fixture.maneuver.multi"]) {
      const payload = authoredFixturePayload(f, key), c = payload.composition as { traits: { definition: unknown }[] };
      c.traits[0]!.definition = f.ref("fixture.trait.shared");
      const revised = abilityDefinitionFixture({ revise: { [key]: payload } });
      const result = evaluateAbilityDefinition(revised.request(key));
      expect(result.ok).toBe(true); if (result.ok) { expect(result.value.problems).toEqual([]); expect(result.value.traits[0]!.family).toBe("SHARED"); }
    }
  });
  it("closed modification grammar rejects undeclared outcomes and contradictory scope/family", () => {
    const f = abilityDefinitionFixture(), env = f.bundle.definitions.find(d => d.canonicalKey === "fixture.trait.spell")!;
    const mutate = (change: (payload: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any -- malformed fixtures
      const bad = JSON.parse(JSON.stringify(env)); change(bad.payload); return createProwessDefinitionEnvelope(bad);
    };
    expect(mutate(p => { p.scope = "TARGETING"; }).ok).toBe(false);
    expect(mutate(p => { p.rules.trait.family = "SHARED"; }).ok).toBe(false);
    expect(mutate(p => { p.rules.trait.modifications[0].outcomes = [{ kind: "DAMAGE" }]; }).ok).toBe(false);
    expect(mutate(p => { p.rules.trait.parameters[0].kind = "CALLBACK"; }).ok).toBe(false);
    expect(mutate(p => { p.rules.trait.parameters[0].allowed = ["FIRE", "FIRE"]; }).ok).toBe(false);
  });
});

describe("WO8 designer ruling SC041 preserves explicit exchanges", () => {
  it("Master constructs five normal Traits only with the approved two-slot exchange", async () => {
    const { createRulesetContext } = await import("@prowess/rules");
    const { createProwessDefinitionBundle } = await import("./bundle/bundle.js");
    const { definitionRefOf } = await import("./definition/envelope.js");
    const f = abilityDefinitionFixture(), cloned = JSON.parse(JSON.stringify(f.bundle.definitions)) as typeof f.bundle.definitions[number][];
    const source = cloned.find(d => d.canonicalKey === "fixture.trait.spell")!;
    const added = Array.from({ length: 5 }, (_, i) => ({ ...source, entityId: `00000000-0000-4000-8000-${String(91000 + i).padStart(12, "0")}`, entityVersionId: `00000000-0000-4000-8000-${String(92000 + i).padStart(12, "0")}`, canonicalKey: `fixture.trait.exchange_${i}` }));
    const spell = cloned.find(d => d.canonicalKey === "fixture.spell.simple")!;
    const payload = spell.payload as unknown as { composition: { traits: unknown[] } };
    payload.composition.traits = added.map((d, i) => ({ componentKey: `trait${i}`, definition: definitionRefOf(d as typeof source), order: i, parameters: {}, appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: "effect1" } }));
    const ruleset = createRulesetContext({ ...f.ruleset, rules: [...f.ruleset.rules, ...added.map(d => ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, entityType: "SPELL_TRAIT", sourceRulesetId: f.ruleset.rulesetId, sourceManifestId: f.ruleset.manifestId }))] });
    if (!ruleset.ok) throw new Error("fixture context");
    const bundle = createProwessDefinitionBundle({ ruleset: ruleset.value, definitions: [...cloned, ...added] });
    if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems));
    const req = { ...f.request("fixture.spell.simple"), ruleset: ruleset.value, definitions: bundle.value };
    const noTrade = evaluateAbilityDefinition(req);
    const withTrade = JSON.parse(JSON.stringify([...cloned, ...added])) as typeof cloned;
    const selected = withTrade.find(d => d.canonicalKey === "fixture.spell.simple")!;
    (selected.payload as Record<string, unknown>).constructionOptions = { effectSlotsTradedForTraits: 2 };
    const tradedBundle = createProwessDefinitionBundle({ ruleset: ruleset.value, definitions: withTrade });
    if (!tradedBundle.ok) throw new Error("fixture trade");
    const trade = evaluateAbilityDefinition({ ...req, definitions: tradedBundle.value });
    expect(noTrade.ok && noTrade.value.valid).toBe(false);
    expect(trade.ok).toBe(true); if (!trade.ok) return;
    expect(trade.value.problems).toEqual([]);
    expect(trade.value.traitCapacity.ordinary).toEqual({ base: 3, effective: 5, used: 5 });
  });
});
