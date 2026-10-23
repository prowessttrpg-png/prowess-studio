import { orchestrateRulesEvaluation } from "@prowess/rules";
import { describe, expect, it, vi } from "vitest";
import { SPELL_COST_ERROR_CODES as K, compileSpellCost, evaluateSpellCost, readSpellCostRun } from "./ability/spell-cost.js";
import { codes } from "./testing/core-run.js";
import { copy, setPath } from "./testing/duration-condition-fixtures.js";
import { runSpellCost, spellCostCharacter, spellCostFixture } from "./testing/spell-cost-fixtures.js";
import { uuid } from "./testing/fixtures.js";

vi.setConfig({ testTimeout: 90_000 });

/**
 * M5-WO10 contracts: exact-Ruleset history (R1 / R2) and isolation, fail-closed contributions, the ME / resource / runtime
 * boundaries, SC042 preservation, plain-data safety, immutability, serialization and determinism.
 * Guard index (docs/architecture/m5-invariants.json): M5-I243 · M5-I253 · M5-I254 · M5-I255 · M5-I256 · M5-I257 · M5-I258 ·
 * M5-I260.
 */
const F = spellCostFixture();
const R2 = uuid(9101);
const M2 = uuid(9102);
const req = (key = "fixture.wo10.spell.simple", character: Record<string, unknown> = spellCostCharacter()) => F.request(key, character) as Record<string, unknown>;

describe("exact Ruleset history and isolation (M5-I257–I258)", () => {
  const r2Trait = () => {
    const t = F.rowPayload("fixture.wo10.trait.flat");
    setPath(t, "costContributions", [{ contributionKey: "trait.wo10.flat", currency: "MP", data: { kind: "FIXED", amount: 4 } }]);
    return t;
  };
  it("R1 Trait v1 = +2 MP; R2 Trait v2 = +4 MP; R1 keeps compiling with +2 MP and re-evaluates identically", () => {
    const r1 = runSpellCost(req());
    const g = spellCostFixture({ rulesetId: R2, manifestId: M2, revise: { "fixture.wo10.trait.flat": r2Trait() } });
    const r2 = runSpellCost(g.request("fixture.wo10.spell.simple", spellCostCharacter()));
    expect([r1.result.finalMpCost, r2.result.finalMpCost]).toEqual([13, 15]);
    expect(r2.result.mp.contributions.find((c) => c.source === "TRAIT")?.definition.entityVersionId).not.toBe(r1.result.mp.contributions.find((c) => c.source === "TRAIT")?.definition.entityVersionId);
    const again = runSpellCost(req());
    expect([again.plan, again.run, again.result]).toEqual([r1.plan, r1.run, r1.result]);
  });

  it("R1 and R2 interleaved never cross-contaminate cost or provenance", () => {
    const g = spellCostFixture({ rulesetId: R2, manifestId: M2, revise: { "fixture.wo10.trait.flat": r2Trait() } });
    const out = [F, g, F, g].map((f) => {
      const r = runSpellCost(f.request("fixture.wo10.spell.simple", spellCostCharacter()));
      return [r.result.finalMpCost, r.result.rulesetProvenance.rulesetId];
    });
    expect(out).toEqual([[13, F.ruleset.rulesetId], [15, R2], [13, F.ruleset.rulesetId], [15, R2]]);
  });

  it("a Spell compiled against another Ruleset's bundle is refused (R1 Spell + R2 components never mix)", () => {
    const g = spellCostFixture({ rulesetId: R2, manifestId: M2 });
    expect(compileSpellCost({ ...req(), ruleset: g.ruleset }).ok).toBe(false);
    expect(compileSpellCost({ ...req(), definitions: g.bundle }).ok).toBe(false);
  });
});

describe("fail-closed contributions and scope boundaries", () => {
  it("M5-I250 Spell AP needs an exact positive PRO: zero is refused, never defaulted", () => {
    const zero = spellCostCharacter(0);
    expect(codes(compileSpellCost(req("fixture.wo10.spell.simple", zero)))).toContain(K.INVALID_PRO);
    const missing = copy(spellCostCharacter()) as { stats: Record<string, number> };
    delete missing.stats.PRO;
    expect(compileSpellCost(req("fixture.wo10.spell.simple", missing)).ok).toBe(false);
    expect(compileSpellCost(req("fixture.wo10.spell.simple", { ...spellCostCharacter(), stats: { ...spellCostCharacter().stats, PRO: 2.5 } })).ok).toBe(false);
  });

  it("an unsupported negative final MP fails closed with a typed problem — never clamped to 0 or 1", () => {
    const immobile = copy(F.bundle.definitions.find((d) => d.canonicalKey === "spell.casting_condition.immobile")!.payload) as Record<string, unknown>;
    setPath(immobile, "costContributions", [{ contributionKey: "immobile.mp", currency: "MP", data: { kind: "FIXED", amount: 50, modifier: "MP_REDUCTION" } }]);
    const g = spellCostFixture({ revise: { "spell.casting_condition.immobile": immobile }, spells: { "fixture.wo10.spell.negative": { mp: 17, conditions: [["immobile"]] } } });
    const r = runSpellCost(g.request("fixture.wo10.spell.negative", spellCostCharacter()));
    expect([r.result.status, r.result.unroundedFinalMpCost, r.result.finalMpCost, r.result.problems.map((q) => q.code)]).toEqual(["INVALID", -30, -30, [K.NEGATIVE_FINAL_MP]]);
  });

  it("M5-SC-046: a selected Multi-Target additional-target count is not priced by a guessed base count", () => {
    const g = spellCostFixture({ spells: { "fixture.wo10.spell.multi": { targeting: "spell.targeting.multi_target", targetingParameters: { targetCount: 3 }, mp: 4 } } });
    expect(codes(compileSpellCost(g.request("fixture.wo10.spell.multi", spellCostCharacter())))).toContain(K.UNRESOLVED_CONTRIBUTION);
  });

  it("a Trait COST MULTIPLY has no authored Spell-cost meaning and fails closed", () => {
    const t = copy(F.bundle.definitions.find((d) => d.canonicalKey === "fixture.trait.stackable")!.payload) as Record<string, unknown>;
    setPath(t, "rules/trait/modifications", [{ kind: "COST", parameter: "stacks", currency: "MP", operation: "MULTIPLY" }]);
    const g = spellCostFixture({ revise: { "fixture.trait.stackable": t } });
    expect(codes(compileSpellCost(g.request("fixture.wo10.spell.stackable", spellCostCharacter())))).toContain(K.UNRESOLVED_CONTRIBUTION);
  });

  it("M5-I256 a Maneuver is refused: final Maneuver cost is M5-WO11", () => {
    expect(codes(compileSpellCost({ ...req(), definition: F.ref("fixture.maneuver.basic") }))).toEqual([K.SPELL_ONLY]);
  });

  it("M5-I260 SC042 stays unresolved: a non-empty additional Affinity Trait allocation is still refused", () => {
    const spell = copy(F.rowPayload("fixture.wo10.spell.simple"));
    setPath(spell, "additionalAffinityTraits", ["trait1"]);
    const g = spellCostFixture({ revise: { "fixture.wo10.spell.simple": spell } });
    const out = compileSpellCost(g.request("fixture.wo10.spell.simple", spellCostCharacter()));
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).toContain("M5-SC-042");
  });

  it("no freeform percentage or ME input exists: unknown request / character fields are refused", () => {
    expect(compileSpellCost({ ...req(), percentModifiers: [{ percent: -20 }] }).ok).toBe(false);
    expect(compileSpellCost({ ...req(), specialModifier: -20 }).ok).toBe(false);
    expect(compileSpellCost(req("fixture.wo10.spell.simple", { ...spellCostCharacter(), manaEfficiency: 6 })).ok).toBe(false);
  });

  it("M5-I253 the Signature slot state never discounts cost (no structured Signature modifier exists)", () => {
    const a = runSpellCost(req());
    const b = runSpellCost({ ...req(), signature: { usedSlots: 1, candidate: { slotUse: "DEFAULT" } } });
    expect([b.result.finalMpCost, b.result.netCostPercent]).toEqual([a.result.finalMpCost, a.result.netCostPercent]);
  });

  it("M5-I254–I255 the plan uses only FORMULA / MODIFIER / REQUIREMENT / KEYWORD / EXPLANATION — no RESOURCE step; nothing is spent", () => {
    const r = runSpellCost(req("fixture.wo10.spell.charge"));
    expect([...new Set(r.plan.evaluationPlan.steps.map((s) => s.operation))].sort()).toEqual(["EXPLANATION", "FORMULA", "KEYWORD", "MODIFIER", "REQUIREMENT"]);
    const cost = { ...r.result, authored: null }; // the authored result carries WO9 future-runtime METADATA only
    expect(JSON.stringify(cost)).not.toMatch(/currentMp|maximumMp|apRemaining|channel|sustainPayment|concentration|manaEfficiency/i);
  });
});

describe("plain-data safety, immutability, serialization, determinism (M5-I258)", () => {
  it.each([
    ["a getter", () => {
      const r = req();
      Object.defineProperty(r.character as object, "stats", { get: () => ({ PRO: 4 }), enumerable: true });
      return r;
    }],
    ["a cycle", () => {
      const r = req();
      const loop: Record<string, unknown> = {};
      loop.self = loop;
      r.accessGrants = [loop];
      return r;
    }],
    ["NaN", () => req("fixture.wo10.spell.simple", { ...spellCostCharacter(), stats: { ...spellCostCharacter().stats, PRO: Number.NaN } })],
    ["a function", () => ({ ...req(), signature: () => null })],
    ["an unsafe __proto__ key", () => JSON.parse(JSON.stringify(req()).replace('"stats":{', '"stats":{"__proto__":{"polluted":1},')) as Record<string, unknown>],
  ])("%s is refused safely", (_label, build) => {
    expect(compileSpellCost(build()).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("inputs are never mutated; outputs are deep-frozen", () => {
    const r = req("fixture.wo10.spell.combined", spellCostCharacter(4, [F.ref("affinity.transmutation"), "EXPERT"]));
    const before = JSON.stringify(r);
    const out = evaluateSpellCost(r);
    expect(JSON.stringify(r)).toBe(before);
    expect(out.ok && Object.isFrozen(out.value) && Object.isFrozen(out.value.mp.contributions) && Object.isFrozen(out.value.ap)).toBe(true);
  });

  it("equal requests give deep-equal plans, runs and results; plans replay through M4 after a JSON round-trip", () => {
    const a = runSpellCost(req("fixture.wo10.spell.cap"));
    const b = runSpellCost(req("fixture.wo10.spell.cap"));
    expect([a.plan, a.run, a.result]).toEqual([b.plan, b.run, b.result]);
    expect(JSON.parse(JSON.stringify(a.result))).toEqual(a.result);
    const replay = orchestrateRulesEvaluation({ evaluationKey: "m5-wo10.test", contexts: { ruleset: F.ruleset }, plan: JSON.parse(JSON.stringify(a.plan.evaluationPlan)) });
    expect(replay.data).toEqual(a.run);
  });

  it("a foreign or incomplete run is refused", () => {
    const a = runSpellCost(req());
    expect(codes(readSpellCostRun(a.plan, { ...a.run, steps: a.run.steps.slice(1) }))).toEqual([K.INCOMPLETE_RUN]);
  });
});
