/** Permanent WO8 invariants exercised below: M6-I123 M6-I124 M6-I125 M6-I126 M6-I127 M6-I128. */
import { describe, expect, it, vi } from "vitest";
import { signatureManeuverFixture } from "./testing/signature-maneuver-fixtures.js";
import { maneuverCostFixture, runManeuverCost } from "./testing/maneuver-cost-fixtures.js";
import { evaluateManeuverCost } from "./ability/maneuver-cost.js";
import { copy } from "./testing/duration-condition-fixtures.js";
import { performanceConditionCandidate } from "./content-updates/m6-wo8-amendment-a.js";
import { readConditionRules, readConditionContributions } from "./definition/duration-condition-payload.js";
import type { AbilityConditionDefinitionPayload } from "./definition/payload.js";
import { Problems } from "./internal/problems.js";

vi.setConfig({ testTimeout: 120_000 });
const f = signatureManeuverFixture();
const run = (key: string, signature = false) => runManeuverCost(f.request(`fixture.wo11.maneuver.${key}`, signature));
describe("M6-WO8 Amendment A — versioned protected Action cost", () => {
  it("validates authored Performance benefits by exact rank identity, independent of token order", () => {
    const payload = performanceConditionCandidate(f.ref("test.wo8.skill.performance"));
    const raw = copy(payload.rules.condition);
    raw.parameters[0]!.allowed = ["MASTER", "TRAINED", "EXPERT"];
    const valid = new Problems(), rules = readConditionRules(raw, "MANEUVER", [], valid);
    expect(rules).not.toBeNull(); expect(valid.list).toEqual([]);
    const wrongPreparation = copy(raw);
    wrongPreparation.performance.preparationApByRank.MASTER = 1;
    const preparation = new Problems();
    expect(readConditionRules(wrongPreparation, "MANEUVER", [], preparation)).toBeNull();
    expect(preparation.count).toBeGreaterThan(0);
    const wrongMp = copy(payload);
    (wrongMp.costContributions[0]!.data.amounts as Record<string, number>).MASTER = 7;
    const cost = new Problems();
    readConditionContributions(wrongMp as unknown as AbilityConditionDefinitionPayload, rules!, [], cost);
    expect(cost.count).toBeGreaterThan(0);
  });
  it("preserves historical M5 costs and serialized output shapes", () => {
    const old = runManeuverCost(maneuverCostFixture().request("fixture.wo11.maneuver.multi"));
    expect(old.result.ap.finalApCost).toBe(2);
    expect(old.result.ap).not.toHaveProperty("protectedActionAp");
    expect(old.plan).not.toHaveProperty("protectedActionAp");
    const current = run("multi");
    expect(current.result.ap).toMatchObject({ baseApCost: 5, protectedActionAp: 4, appliedConditionFloor: 4, postConditionApCost: 4, finalApCost: 4, costPolicyVersion: "M6-WO8-A" });
  });
  it("sums every Powerful Blow constituent at full AP, Effect once, Signature after the floor", () => {
    const r = run("powerful_blow", true);
    expect(r.result.ap).toMatchObject({ baseApCost: 8, protectedActionAp: 6, postConditionApCost: 6, finalApCost: 5 });
    expect(r.result.ap.contributions.filter(c => c.source === "FOUNDATION").map(c => c.value)).toEqual([3, 3]);
    expect(r.result.ap.contributions.filter(c => c.source === "EFFECT").map(c => c.value)).toEqual([2]);
    expect(r.result.structure.resolutionGroups).toHaveLength(1);
  });
  it("keeps AP additions, the existing cap, final AP minimum and independent MP minimum", () => {
    expect(run("over_cap").result.ap.conditions).toEqual({ listedApReduction: 4, effectiveApReduction: 3, maximumApReduction: 3 });
    expect(run("over_cap").result.valid).toBe(false);
    expect(run("support", true).result.ap.finalApCost).toBeGreaterThanOrEqual(1);
    expect(run("mp_floor").result.mp.finalMpCost).toBeGreaterThanOrEqual(0);
  });
  it.each([["TRAINED", 2, 1], ["EXPERT", 4, 1], ["MASTER", 6, 0]] as const)("Performance %s is selected once, costs separate preparation, and consumes no ordinary slot", (rank, discount, preparation) => {
    const r = copy(f.request("fixture.wo11.maneuver.mana"));
    const def = r.definitions.definitions.find(d => d.canonicalKey === "fixture.wo11.maneuver.mana")!;
    const payload = def.payload as unknown as { composition: { conditions: unknown[] } };
    payload.composition.conditions = [{ componentKey: "performance", definition: f.ref("maneuver.condition.performance"), order: 1, parameters: {} }];
    r.character.skillRanks.push({ skillKey: "test.wo8.skill.performance", rankKey: rank });
    const result = runManeuverCost(r).result;
    expect(result.valid).toBe(true);
    expect(result.mp).toMatchObject({ baseMpCost: 8, conditionMpReduction: discount, finalMpCost: 8 - discount });
    expect(result.ap).toMatchObject({ protectedActionAp: 2, finalApCost: 4, conditions: { effectiveApReduction: 0 } });
    expect(result.authored.durationConditions?.conditions[0]).toMatchObject({ consumesSlot: false, preparationAp: preparation, performance: { rank, establishedBeforeActivation: true } });
    expect(result.authored.durationConditions?.conditionSummary.usedCapacity).toBe(0);
  });
  it.each(["A", "B", "C", "D"])("matches the approved exact cost example %s", example => {
    const r = copy(f.request("fixture.wo11.maneuver.mana", example === "D"));
    const p = r.definitions.definitions.find(d => d.canonicalKey === "fixture.wo11.maneuver.mana")!.payload as unknown as { actions: unknown[]; effectAttachments: unknown[]; composition: { conditions: unknown[] } };
    p.actions = [["one", "light"], ["two", "longsword"], ["three", "light"]].map(([componentKey, key], order) => ({ componentKey, order, definition: f.ref(`fixture.wo11.attack.${key}`), parameters: {} }));
    p.effectAttachments = [{ effectKey: "effect1", actionKeys: ["two"] }];
    p.composition.conditions = [
      { componentKey: "stationary", order: 1, definition: f.ref("maneuver.condition.stationary"), parameters: {} },
      { componentKey: "unaware", order: 2, definition: f.ref("maneuver.condition.target_unaware"), parameters: {} },
      ...(["C", "D"].includes(example) ? [{ componentKey: "performance", order: 3, definition: f.ref("maneuver.condition.performance"), parameters: {} }] : []),
    ];
    r.character.skillRanks.push({ skillKey: "test.wo8.skill.performance", rankKey: "MASTER" });
    const e = r.definitions.definitions.find(d => d.canonicalKey === "fixture.wo11.effect.surge")!.payload as unknown as { costContributions: unknown[] };
    e.costContributions = [
      { contributionKey: "effect.ap", currency: "AP", data: { kind: "FIXED", amount: example === "B" ? 0 : 3 } },
      { contributionKey: "effect.mp", currency: "MP", data: { kind: "FIXED", amount: ["C", "D"].includes(example) ? 9 : 0 } },
    ];
    const out = runManeuverCost(r).result;
    expect(out.valid, JSON.stringify(out.problems)).toBe(true);
    expect(out.ap).toMatchObject({ protectedActionAp: 4, finalApCost: example === "D" ? 3 : 4 });
    expect(out.mp.finalMpCost).toBe(["C", "D"].includes(example) ? 3 : 0);
    expect(out.ap.conditions.effectiveApReduction).toBe(3);
  });
  it("applies explicit Performance AP rules to the protected floor and MP once across a Powerful Blow", () => {
    const r = copy(f.request("fixture.wo11.maneuver.powerful_blow"));
    const maneuver = r.definitions.definitions.find(d => d.canonicalKey === "fixture.wo11.maneuver.powerful_blow")!.payload as unknown as { composition: { conditions: unknown[]; effects: { definition: unknown }[] } };
    maneuver.composition.effects[0]!.definition = f.ref("fixture.wo11.effect.surge");
    maneuver.composition.conditions = [{ componentKey: "performance", order: 1, definition: f.ref("maneuver.condition.performance"), parameters: {} }];
    r.character.skillRanks.push({ skillKey: "test.wo8.skill.performance", rankKey: "MASTER" });
    const condition = r.definitions.definitions.find(d => d.canonicalKey === "maneuver.condition.performance")!.payload as unknown as { costContributions: unknown[] };
    condition.costContributions.push({ contributionKey: "authored.performance.ap", currency: "AP", data: { kind: "FIXED", amount: 3, modifier: "AP_REDUCTION" } });
    const out = runManeuverCost(r).result;
    expect(out.valid, JSON.stringify(out.problems)).toBe(true);
    expect(out.ap).toMatchObject({ baseApCost: 8, protectedActionAp: 6, postConditionApCost: 6, finalApCost: 6 });
    expect(out.mp).toMatchObject({ baseMpCost: 8, conditionMpReduction: 6, finalMpCost: 2 });
    expect(out.authored.durationConditions?.conditionSummary.usedCapacity).toBe(0);
    maneuver.composition.conditions.push({ componentKey: "again", order: 2, definition: f.ref("maneuver.condition.performance"), parameters: {} });
    expect(evaluateManeuverCost(r).ok).toBe(false);
  });
  it("rejects Untrained and authored Performance rank overrides", () => {
    const r = copy(f.request("fixture.wo11.maneuver.mana"));
    const payload = r.definitions.definitions.find(d => d.canonicalKey === "fixture.wo11.maneuver.mana")!.payload as unknown as { composition: { conditions: unknown[] } };
    payload.composition.conditions = [{ componentKey: "performance", definition: f.ref("maneuver.condition.performance"), order: 1, parameters: { performanceRank: "MASTER" } }];
    expect(evaluateManeuverCost(r).ok).toBe(false);
  });
});
