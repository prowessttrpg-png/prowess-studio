import { describe, expect, it, vi } from "vitest";
import { maneuverCostCharacter, maneuverCostFixture, runManeuverCost, type ManeuverCostRun } from "./testing/maneuver-cost-fixtures.js";

vi.setConfig({ testTimeout: 120_000 });

/**
 * M5-WO11 goldens — FINAL MANEUVER COST, ATTACK FLOORS & SIGNATURE REDUCTION. Base Actions + Maneuver Effects −
 * Conditions; every number is computed by M4 from the exact authored Maneuver and its exact component Definitions.
 * Guard index (docs/architecture/m5-invariants.json): M5-I261 · M5-I262 · M5-I263 · M5-I264 · M5-I265 · M5-I266 ·
 * M5-I267 · M5-I268 · M5-I269 · M5-I270 · M5-I271 · M5-I272 · M5-I273 · M5-I274 · M5-I275 · M5-I276 · M5-I279 ·
 * M5-I283 · M5-I284 · M5-I286 · M5-I287 · M5-I288 · M5-I289 · M5-I291 · M5-I292 · M5-I293.
 */
const F = maneuverCostFixture();
const cache = new Map<string, ManeuverCostRun>();
const cost = (key: string, signature = false, character?: Record<string, unknown>): ManeuverCostRun => {
  const id = `${key}:${String(signature)}:${JSON.stringify(character ?? null)}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const out = runManeuverCost(F.request(key, signature, character));
  cache.set(id, out);
  return out;
};
/** [Base AP, effective Condition AP, Condition-reduced AP, attack floor, post-Condition AP, final AP, Base MP, Condition MP, final MP] */
const line = (r: ManeuverCostRun) => [r.result.ap.baseApCost, r.result.ap.conditions.effectiveApReduction, r.result.ap.conditionReducedApCost, r.result.ap.conditionAttackFloor, r.result.ap.postConditionApCost, r.result.ap.finalApCost, r.result.mp.baseMpCost, r.result.mp.conditionMpReduction, r.result.mp.finalMpCost];
const expert = () => maneuverCostCharacter([F.ref("affinity.transmutation"), "EXPERT"]);

describe("Base AP and Base MP (M5-I261–I264)", () => {
  it("A — Balanced Attack 2 + Push 1 − Stationary 1 → Base 3, 2 AP, 0 MP", () => {
    const r = cost("fixture.wo11.maneuver.basic");
    expect(r.result.status).toBe("VALID");
    expect(line(r)).toEqual([3, 1, 2, 1, 2, 2, 0, 0, 0]);
    expect(r.result.ap.contributions.map((c) => [c.source, c.componentKey, c.value])).toEqual([["FOUNDATION", "attack1", 2], ["EFFECT", "effect1", 1]]);
  });

  it("every contribution names its exact component use, Definition, Ruleset and M4 step", () => {
    const r = cost("fixture.wo11.maneuver.basic");
    for (const c of [...r.result.ap.contributions, ...r.result.mp.contributions]) {
      expect(F.bundle.definitions.some((d) => d.entityVersionId === c.definition.entityVersionId)).toBe(true);
      const entry = r.plan.sourceMap.entries.find((e) => e.stepKey === c.stepKey)!;
      expect(entry.definitions.map((d) => d.entityVersionId)).toContain(c.definition.entityVersionId);
      expect(entry.componentKeys).toContain(c.componentKey);
    }
    expect(r.result.rulesetProvenance).toEqual(F.bundle.rulesetProvenance);
  });

  it("Base MP is the sum of mana-bearing components only — an AP-only Maneuver has 0 MP, never MP derived from AP", () => {
    expect(cost("fixture.wo11.maneuver.high").result.mp).toMatchObject({ baseMpCost: 0, finalMpCost: 0, contributions: [] });
  });
});

describe("cost options and AND costs (M5-I265–I266)", () => {
  it("E — '+1 AP OR +4 MP' with AP chosen → +1 AP, +0 MP; with MP chosen → +0 AP, +4 MP; never both", () => {
    const a = cost("fixture.wo11.maneuver.option_ap"), m = cost("fixture.wo11.maneuver.option_mp");
    expect([a.result.ap.baseApCost, a.result.mp.baseMpCost]).toEqual([3, 0]);
    expect([m.result.ap.baseApCost, m.result.mp.baseMpCost]).toEqual([2, 4]);
    expect(m.result.costOptions).toEqual([expect.objectContaining({ componentKey: "effect1", parameter: "costOption", selected: "MP", options: [{ option: "AP", amounts: { AP: 1, MP: 0 } }, { option: "MP", amounts: { AP: 0, MP: 4 } }] })]);
  });

  it("F — '+2 AP AND +8 MP' applies both currencies; No Counter Action (MP chosen) −3 MP → 4 AP, 5 MP", () => {
    const r = cost("fixture.wo11.maneuver.mana");
    expect(line(r)).toEqual([4, 0, 4, 1, 4, 4, 8, 3, 5]);
    expect(r.result.mp.conditionReductions.map((c) => [c.componentKey, c.selectedOption, c.value])).toEqual([["condition1", "MP", 3]]);
  });
});

describe("Effect-specific Affinity cost rule (never a Spell percentage)", () => {
  it("Elemental fixture: 5 MP, Expert relevant Affinity −2 → 3 MP, applied once; no Spell Affinity percentage", () => {
    const r = cost("fixture.wo11.maneuver.elemental", false, expert());
    expect(r.result.mp.baseMpCost).toBe(3);
    const c = r.result.mp.contributions[0]!;
    expect(c).toMatchObject({ rule: "FIXED_AFFINITY_ADJUSTED", value: 3, affinity: { listedAmount: 5, minimum: 2 } });
    expect(r.plan.evaluationPlan.steps.some((s) => s.stepKey.includes(".affinity.") && JSON.stringify(s.input).includes("PERCENT"))).toBe(false);
  });

  it("no relevant Affinity → 5 MP; Master → never below the component minimum 2 MP", () => {
    expect(cost("fixture.wo11.maneuver.elemental").result.mp.baseMpCost).toBe(5);
    expect(cost("fixture.wo11.maneuver.elemental", false, maneuverCostCharacter([F.ref("affinity.transmutation"), "MASTER"])).result.mp.baseMpCost).toBe(2);
  });
});

describe("Conditions (M5-I267–I269)", () => {
  it("B — Heavy 3 + Knockback 2 + Armor Break 2 = 7 − 2 → 5 AP (3 AP is not a cap)", () => {
    expect(line(cost("fixture.wo11.maneuver.high"))).toEqual([7, 2, 5, 1, 5, 5, 0, 0, 0]);
  });

  it("G — Unaware 2 + Stationary 1 reach the 3 AP cap: 6 → 3 AP", () => {
    expect(line(cost("fixture.wo11.maneuver.capped"))).toEqual([6, 3, 3, 1, 3, 3, 0, 0, 0]);
  });

  it("over-cap: listed −2 −1 −1 = −4 is consumed as WO9's effective −3 (and WO9 keeps the selection INVALID)", () => {
    const r = cost("fixture.wo11.maneuver.over_cap");
    expect(r.result.ap.conditions).toEqual({ listedApReduction: 4, effectiveApReduction: 3, maximumApReduction: 3 });
    expect(r.result.ap.finalApCost).toBe(3);
    expect(r.result.status).toBe("INVALID");
    expect(r.result.problems.map((q) => q.path)).toEqual(["wo9.maneuverAp.listedMaximum"]);
  });

  it("final MP never becomes negative: Base 2 MP − 3 MP → 0 MP (never −1)", () => {
    const r = cost("fixture.wo11.maneuver.mp_floor", false, maneuverCostCharacter([F.ref("affinity.transmutation"), "MASTER"]));
    expect([r.result.mp.baseMpCost, r.result.mp.conditionMpReduction, r.result.mp.finalMpCost]).toEqual([2, 3, 0]);
  });
});

describe("attack-resolution floor and Powerful Blow (M5-I270–I272, M5-I286–I293)", () => {
  it("C — two SEPARATE Longsword Strikes + Push: 5 − 3 = 2, floor 2 → 2 AP; two resolutions", () => {
    const r = cost("fixture.wo11.maneuver.multi");
    expect(line(r)).toEqual([5, 3, 2, 2, 2, 2, 0, 0, 0]);
    expect(r.result.structure.resolutionGroups.map((g) => [g.groupKey, g.kind, g.effects])).toEqual([["attack1", "ATTACK", ["effect1"]], ["attack2", "ATTACK", []]]);
  });

  it("D — Powerful Blow Heavy ×2 = 6 + Knockback 2 = 8 − 3 → 5 AP: ONE resolution, floor 1 (never 6, never 2)", () => {
    const r = cost("fixture.wo11.maneuver.powerful_blow");
    expect(line(r)).toEqual([8, 3, 5, 1, 5, 5, 0, 0, 0]);
    expect(r.result.ap.contributions.filter((c) => c.source === "FOUNDATION").map((c) => [c.componentKey, c.value])).toEqual([["attack1", 3], ["attack2", 3]]);
    expect(r.result.structure.separateAttackResolutions).toBe(1);
    expect(r.result.structure.resolutionGroups).toEqual([expect.objectContaining({ kind: "POWERFUL_BLOW", actionKeys: ["attack1", "attack2"], repetitions: 2, effects: ["effect1"] })]);
    expect(r.result.authored.powerfulBlow).toEqual({ actionKeys: ["attack1", "attack2"], damageSource: "COMBINED_COMMITTED_ATTACKS", attachedEffectsResolve: "ONCE" });
  });

  it("an Effect attached to a Powerful Blow is ONE instance: Armor Break +2 once, never ×2", () => {
    const r = cost("fixture.wo11.maneuver.mixed");
    expect(r.result.ap.contributions.filter((c) => c.componentKey === "effect1").map((c) => c.value)).toEqual([2]);
    expect(r.plan.ability.effects.filter((e) => e.plan.subject.componentKey === "effect1").length).toBe(2); // two compiled views
  });

  it("mixed — Powerful Blow Longsword ×2 (4) + Armor Break 2 + Shield Bash 1 = 7 − 3 = 4; two resolutions, floor 2", () => {
    const r = cost("fixture.wo11.maneuver.mixed");
    expect(line(r)).toEqual([7, 3, 4, 2, 4, 4, 0, 0, 0]);
    expect(r.result.structure.resolutionGroups.map((g) => [g.kind, g.actionKeys, g.effects])).toEqual([["POWERFUL_BLOW", ["attack1", "attack2"], ["effect1"]], ["ATTACK", ["attack3"], []]]);
  });

  it("different Attacks keep independent attachment sets: Armor Break on the Longsword only", () => {
    const r = cost("fixture.wo11.maneuver.different");
    const groups = r.result.structure.resolutionGroups;
    expect(groups.find((g) => g.groupKey === "attack1")!.effects).toEqual(["effect1"]);
    expect(groups.find((g) => g.groupKey === "attack2")!.effects).toEqual([]);
    expect(r.result.ap.baseApCost).toBe(5);
  });

  it("each Attack carries its own weapon requirement automatically: no Condition, no discount, no slot", () => {
    const r = cost("fixture.wo11.maneuver.different");
    expect(r.result.structure.resolutionGroups.map((g) => g.inheritedRequirements.map((q) => [q.weaponKey, q.grantsConditionDiscount, q.consumesConditionSlot]))).toEqual([[["fixture.weapon.longsword", false, false]], [["fixture.weapon.shield", false, false]]]);
    expect(r.result.authored.durationConditions?.conditionSummary.usedCapacity).toBe(0);
    expect(r.result.ap.conditions.effectiveApReduction).toBe(0);
  });

  it("J — support (Block 2 + Guard 1 = 3 − 3 = 0) keeps the universal minimum 1 AP; zero attack resolutions", () => {
    const r = cost("fixture.wo11.maneuver.support");
    expect(line(r)).toEqual([3, 3, 0, 1, 1, 1, 0, 0, 0]);
    expect(r.result.structure.separateAttackResolutions).toBe(0);
    expect(r.result.structure.resolutionGroups.map((g) => [g.kind, g.inheritedRequirements])).toEqual([["ACTION", []]]);
  });
});

describe("Signature Maneuver (M5-I273–I276)", () => {
  it("H — Signature reduces the post-Condition AP by exactly 1: Longsword 2 + Mana-Wrapped (MP) = 2 → 1 AP; its 4 MP untouched", () => {
    const r = cost("fixture.wo11.maneuver.option_mp", true);
    expect([r.result.ap.postConditionApCost, r.result.ap.finalApCost, r.result.mp.finalMpCost]).toEqual([2, 1, 4]);
    expect(r.result.ap.signature).toEqual({ assigned: true, reduction: 1, applied: true });
  });

  it("I — Signature applies AFTER the attack floor and may bypass it: 4 − 2 = 2 (floor 2) → 1 AP", () => {
    const r = cost("fixture.wo11.maneuver.signature_multi", true);
    expect(line(r)).toEqual([4, 2, 2, 2, 2, 1, 0, 0, 0]);
    expect(cost("fixture.wo11.maneuver.signature_multi").result.ap.finalApCost).toBe(2);
  });

  it("Signature is not a Condition: no slot, not inside the 3 AP cap; and never below 1 AP", () => {
    const r = cost("fixture.wo11.maneuver.support", true);
    expect(r.result.ap.conditions.effectiveApReduction).toBe(3);
    expect(r.result.authored.durationConditions?.conditionSummary.usedCapacity).toBe(3);
    expect(r.result.ap.finalApCost).toBe(1);
  });

  it("Base AP is preserved for Commitment scaling: Base 5 − 3 − Signature 1 = 1 AP, Base AP still 5", () => {
    const r = cost("fixture.wo11.maneuver.commitment", true);
    expect([r.result.ap.baseApCost, r.result.ap.finalApCost]).toEqual([5, 1]);
    expect(r.plan.steps.baseAp).not.toBe(r.plan.steps.finalAp);
  });

  it("the phases are explicit M4 steps in order: base → Condition-reduced → floor → post-Condition → Signature → minimum", () => {
    const r = cost("fixture.wo11.maneuver.signature_multi", true);
    const order = (k: string) => r.plan.evaluationPlan.steps.find((s) => s.stepKey === k)!.order;
    const s = r.plan.steps;
    expect([order(s.baseAp), order(s.conditionReducedAp), order(s.attackFloor), order(s.postConditionAp), order(s.finalAp)]).toEqual([...[order(s.baseAp), order(s.conditionReducedAp), order(s.attackFloor), order(s.postConditionAp), order(s.finalAp)]].sort((a, b) => a - b));
    const mods = (r.plan.evaluationPlan.steps.find((x) => x.stepKey === s.finalAp)!.input as { request: { modifiers: { modifierKey: string; operation: string; phase: { phaseOrder: number } }[] } }).request.modifiers;
    expect(mods.map((m) => [m.modifierKey, m.operation, m.phase.phaseOrder])).toEqual([["maneuver.signature", "SUBTRACT", 1], ["maneuver.minimum_ap", "MAX", 2]]);
  });
});
