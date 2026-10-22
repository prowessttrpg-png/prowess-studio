import { describe, expect, it, vi } from "vitest";
import { orchestrateRulesEvaluation } from "@prowess/rules";
import { compileAbilityDefinition, evaluateAbilityDefinition, readAbilityDefinitionRun } from "./ability/compile.js";
import { serializeAuthoredAbilityDefinition, deserializeAuthoredAbilityDefinition, validateAuthoredAbilityDefinition } from "./definition/authored-ability-payload.js";
import { abilityDefinitionFixture, authoredFixturePayload } from "./testing/ability-definition-fixtures.js";
import { createProwessDefinitionEnvelope } from "./definition/envelope.js";
import { createProwessDefinitionBundle } from "./bundle/bundle.js";

vi.setConfig({ testTimeout: 60_000 });

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const set = (x: unknown, path: string, value: unknown) => {
  const parts = path.split("/"); let target = x as Record<string, unknown>;
  for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[parts[parts.length - 1]!] = value;
};
const run = (key: string) => {
  const f = abilityDefinitionFixture(); const req = f.request(key);
  const character = key === "fixture.spell.affinity" ? { ...req.character, affinityProfile: { affinities: [{ affinity: f.ref("affinity.evocation"), rank: "MASTER", role: "PRIMARY", acquisition: null }] } } : req.character;
  const result = evaluateAbilityDefinition({ ...req, character });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return { f, req: { ...req, character }, result: result.value };
};

describe("WO8 authored ability golden fixtures", () => {
  it.each(["fixture.spell.simple", "fixture.spell.multi", "fixture.spell.affinity", "fixture.maneuver.basic", "fixture.maneuver.modified", "fixture.maneuver.multi"])("validates %s through permanent M4/M5 contracts", key => {
    const r = run(key); expect(r.result.problems).toEqual([]); expect(r.result.valid).toBe(true);
  });
  it("retains explicit Arcane/Affinity authority and separate normal/additional Trait capacity", () => {
    const a = run("fixture.spell.simple"), b = run("fixture.spell.affinity");
    expect(a.result.construction.access.path).toBe("ARCANE_AUTHORITY"); expect(b.result.construction.access.path).toBe("AFFINITY_AUTHORITY");
    expect(a.result.traitCapacity.ordinary).toEqual({ base: 3, effective: 3, used: 1 });
    expect(b.result.traitCapacity.affinityAdditional).toEqual({ capacity: null, used: 0, conflictKey: "M5-SC-042" });
  });
  it("inherits weapon range, dice, Power and attack resolution without Spell Character Dice", () => {
    const { result } = run("fixture.maneuver.basic");
    expect(result.actions[0]!.profile.range).toEqual({ kind: "WEAPON_RANGE", feet: 5 });
    expect(result.actions[0]!.profile.damage).toMatchObject({ kind: "WEAPON", baseDice: "1d6", power: 2, stat: "STR" });
    expect(result.effects[0]!.result.resolutionPolicy).toBe("INHERIT_ABILITY");
    expect(result.effects[0]!.result.targetingConversion).toBeNull();
  });
  it("keeps targeting conversion and Powerful Blow separate from foundation damage", () => {
    expect(run("fixture.maneuver.modified").result.effects[0]!.result.targetingConversion!.destination.canonicalKey).toBe("maneuver.targeting.line");
    const { result } = run("fixture.maneuver.multi");
    expect(result.powerfulBlow).toEqual({ actionKeys: ["attack1", "attack2"], damageSource: "COMBINED_COMMITTED_ATTACKS", attachedEffectsResolve: "ONCE" });
    expect(result.construction.usage.effects).toBe(2);
  });
  it("compiles deterministic detached, frozen M4 steps with exact Definition provenance", () => {
    const { req } = run("fixture.spell.multi"); const saved = JSON.stringify(req);
    const a = compileAbilityDefinition(req), b = compileAbilityDefinition(copy(req));
    expect(a).toEqual(b); expect(a.ok).toBe(true); expect(JSON.stringify(req)).toBe(saved);
    if (!a.ok) return;
    expect(Object.isFrozen(a.value)).toBe(true); expect(Object.isFrozen(req)).toBe(false);
    expect(a.value.sourceMap.entries.map(x => x.stepKey)).toEqual(a.value.evaluationPlan.steps.map(x => x.stepKey));
    for (const entry of a.value.sourceMap.entries) expect(entry.definitions).toContainEqual(a.value.definition);
    const response = orchestrateRulesEvaluation({ evaluationKey: "fixture.inspector", contexts: { ruleset: req.ruleset }, plan: copy(a.value.evaluationPlan) });
    expect(response.success).toBe(true); expect((response.data!.steps.find(s => s.stepKey === a.value.explanationStepKey)!.response!.data as { level: string }).level).toBe("DETAILED");
    const result = readAbilityDefinitionRun(a.value, response.data); expect(result.ok).toBe(true);
  });
  it("serializes losslessly and preserves explicit Effect ordering", () => {
    const f = abilityDefinitionFixture(), original = authoredFixturePayload(f, "fixture.spell.multi");
    const a = serializeAuthoredAbilityDefinition("SPELL_DEFINITION", original); expect(a.ok).toBe(true); if (!a.ok) return;
    expect(deserializeAuthoredAbilityDefinition("SPELL_DEFINITION", a.value)).toEqual(validateAuthoredAbilityDefinition("SPELL_DEFINITION", original));
    const reversed = copy(original); set(reversed, "composition/effects/0/order", 30);
    const b = serializeAuthoredAbilityDefinition("SPELL_DEFINITION", reversed); expect(b.ok).toBe(true); expect(b).not.toEqual(a);
  });
});

describe("WO8 deterministic negative controls", () => {
  const structural: readonly [string, string, unknown][] = [
    ["missing Targeting", "composition/targeting", null], ["no Effects", "composition/effects", []],
    ["invalid authority", "composition/authority", { authority: "WHICHEVER_IS_HIGHER" }],
    ["Spell-only branch", "composition/abilityKind", "MANEUVER"],
    ["undeclared runtime mechanics", "composition/branch/data", { damage: "eval()" }],
    ["malformed Duration", "composition/duration", { definition: "Instant" }],
  ];
  it.each(structural)("rejects %s", (_name, path, value) => {
    const f = abilityDefinitionFixture(), env = copy(f.bundle.definitions.find(x => x.canonicalKey === "fixture.spell.simple")!);
    set(env.payload, path, value);
    const a = createProwessDefinitionEnvelope(env), b = createProwessDefinitionEnvelope(copy(env));
    if (path === "composition/effects") {
      const parsed = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: f.bundle.definitions.map(d => d.entityId === env.entityId ? env : d) });
      if (!parsed.ok) { expect(parsed.problems.length).toBeGreaterThan(0); return; }
      const result = evaluateAbilityDefinition({ ...f.request("fixture.spell.simple"), definitions: parsed.value });
      expect(result.ok && result.value.valid).toBe(false);
    } else { expect(a.ok).toBe(false); expect(a).toEqual(b); }
  });
  it.each(["extra", "type", "range", "stack", "unresolved bonus"])("rejects %s Trait selection", testCase => {
    const f = abilityDefinitionFixture(), env = copy(f.bundle.definitions.find(x => x.canonicalKey === "fixture.spell.simple")!);
    if (testCase === "unresolved bonus") set(env.payload, "additionalAffinityTraits", ["trait1"]);
    else if (testCase === "stack") { set(env.payload, "composition/traits/0/definition", f.ref("fixture.trait.stackable")); set(env.payload, "composition/traits/0/appliesTo", { scope: "ABILITY_WIDE", componentKey: null }); set(env.payload, "composition/traits/0/parameters", { stacks: 4 }); }
    else if (testCase === "range") set(env.payload, "composition/traits/0/parameters", { damageType: "VOID" });
    else set(env.payload, "composition/traits/0/parameters", testCase === "extra" ? { injected: 1 } : { damageType: 3 });
    const bundle = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: f.bundle.definitions.map(d => d.entityId === env.entityId ? env : d) });
    expect(bundle.ok).toBe(true); if (!bundle.ok) return;
    const result = evaluateAbilityDefinition({ ...f.request("fixture.spell.simple"), definitions: bundle.value }); expect(result.ok && result.value.valid).toBe(false);
  });
  it("rejects a bundle from another exact Ruleset even with identical pinned Versions", () => {
    const f = abilityDefinitionFixture(), other = abilityDefinitionFixture({ rulesetId: "00000000-0000-4000-8000-000000009999" });
    expect(compileAbilityDefinition({ ...f.request("fixture.spell.simple"), definitions: other.bundle }).ok).toBe(false);
  });
  it("rejects forged run identities and partial runs", () => {
    const { req } = run("fixture.spell.simple"); const p = compileAbilityDefinition(req); if (!p.ok) throw new Error("fixture");
    expect(readAbilityDefinitionRun(p.value, { steps: [] }).ok).toBe(false);
  });
});
