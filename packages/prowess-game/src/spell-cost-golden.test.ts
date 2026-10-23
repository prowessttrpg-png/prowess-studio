import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SPELLS, runSpellCost, spellCostCharacter, spellCostFixture, type SpellCostRun } from "./testing/spell-cost-fixtures.js";

vi.setConfig({ testTimeout: 60_000 });

/**
 * M5-WO10 goldens — FINAL SPELL COST, PERCENTAGE NETTING & AP DERIVATION (designer ruling M5-SC-028; M5-SC-021). Every
 * number is computed by M4 from the exact authored Spell and its exact component Definitions.
 * Guard index (docs/architecture/m5-invariants.json): M5-I243 · M5-I244 · M5-I245 · M5-I246 · M5-I247 · M5-I248 · M5-I249 ·
 * M5-I250 · M5-I251 · M5-I252 · M5-I257 · M5-I259.
 */
const F = spellCostFixture();
const cache = new Map<string, SpellCostRun>();
const cost = (key: string, pro = 4, rank = "EXPERT"): SpellCostRun => {
  const id = `${key}:${String(pro)}:${rank}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const affinity = DEFAULT_SPELLS[key]!.affinity ?? null;
  const out = runSpellCost(F.request(key, spellCostCharacter(pro, affinity === null ? null : [F.ref(affinity), rank])));
  cache.set(id, out);
  return out;
};
const summary = (r: SpellCostRun) => [r.result.status, r.result.mp.baseMpCost, r.result.netCostPercent, r.result.unroundedFinalMpCost, r.result.finalMpCost];
const pct = (r: SpellCostRun, source: string) => r.result.percentageContributions.find((q) => q.source === source);

describe("constructed base MP (M5-I243–I244)", () => {
  it("Simple Spell: Targeting 3 + Effect 8 + Trait 2 + Duration 0 = 13 MP; net 100% → 13 MP (trace A)", () => {
    const r = cost("fixture.wo10.spell.simple");
    expect(summary(r)).toEqual(["VALID", 13, 100, 13, 13]);
    expect(r.result.mp.contributions.map((c) => [c.source, c.contributionKey, c.operation, c.value])).toEqual([
      ["TARGETING", "targeting.base", "ADD_MP", 3],
      ["TARGETING", "targeting.range_extension", "ADD_MP", 0], // the declared range extension, 0 steps selected
      ["EFFECT", "effect.wo10.mp", "ADD_MP", 8],
      ["TRAIT", "trait.wo10.flat", "ADD_MP", 2],
    ]);
    expect(r.result.castingConditions).toEqual({ listedPercent: 0, effectivePercent: 0, maximumPercent: 30 });
  });

  it("Effect scaling: canonical Direct Damage, 3 Character Dice × 4 MP + Single Target 3 = 15 MP", () => {
    const r = cost("fixture.wo10.spell.dice");
    expect(summary(r)).toEqual(["VALID", 15, 100, 15, 15]);
    expect(r.result.mp.contributions.find((c) => c.source === "EFFECT")).toMatchObject({ contributionKey: "effect.damage.dice", rule: "PER_UNIT", selected: 3, value: 12 });
  });

  it("an exact Trait COST/ADD modification is a structured flat contribution (2 stacks → +2 MP)", () => {
    const r = cost("fixture.wo10.spell.stackable");
    expect(summary(r)).toEqual(["VALID", 10, 100, 10, 10]);
    expect(r.result.mp.contributions.find((c) => c.rule === "COST_ADD")).toMatchObject({ source: "TRAIT", selected: 2, value: 2 });
  });

  it("every contribution names its exact component, Definition, Ruleset and M4 step", () => {
    const r = cost("fixture.wo10.spell.simple");
    for (const c of r.result.mp.contributions) {
      expect(F.bundle.definitions.some((d) => d.entityVersionId === c.definition.entityVersionId)).toBe(true);
      const entry = r.plan.sourceMap.entries.find((e) => e.stepKey === c.stepKey)!;
      expect(entry.definitions.map((d) => d.entityVersionId)).toContain(c.definition.entityVersionId);
    }
    expect(r.result.rulesetProvenance).toEqual(F.bundle.rulesetProvenance);
  });
});

describe("one net percentage, applied once; one normal rounding (M5-SC-028, M5-I245–I249, M5-I259)", () => {
  it("15 MP with Verbal −10% → 13.5 → 14 MP (normal rounding), never 13 (trace D)", () => {
    expect(summary(cost("fixture.wo10.spell.half"))).toEqual(["VALID", 15, 90, 13.5, 14]);
  });

  it("the legacy example 13 × 0.9 = 11.7 is 12 MP now — never the floor-rounded 11", () => {
    expect(summary(cost("fixture.wo10.spell.legacy"))).toEqual(["VALID", 13, 90, 11.7, 12]);
  });

  it("Expert Strength −20% on 20 MP → 80% → 16 MP (trace B)", () => {
    const r = cost("fixture.wo10.spell.strength");
    expect(summary(r)).toEqual(["VALID", 20, 80, 16, 16]);
    expect(pct(r, "AFFINITY_STRENGTH")).toMatchObject({ operation: "SUBTRACT", percent: 20, applied: true });
  });

  it.each([
    ["TRAINED", 90, 18],
    ["EXPERT", 80, 16],
    ["MASTER", 70, 14],
  ])("Strength at %s uses the WO4 rank discount: net %i%% → %i MP", (rank, net, mp) => {
    const r = cost("fixture.wo10.spell.strength", 4, rank);
    expect([r.result.netCostPercent, r.result.finalMpCost]).toEqual([net, mp]);
  });

  it("Expert Strength −20% + Minor Weakness +10% → ONE net 90% → 18 MP (trace C)", () => {
    const r = cost("fixture.wo10.spell.strength_weakness");
    expect(summary(r)).toEqual(["VALID", 20, 90, 18, 18]);
    expect([pct(r, "AFFINITY_STRENGTH")?.percent, pct(r, "AFFINITY_WEAKNESS")?.percent]).toEqual([20, 10]);
  });

  it("Strength −20% + Weakness +10% + Verbal −10% → 80% → 16 MP — not 20 × .8 × 1.1 × .9 = 15.84 (trace E)", () => {
    const r = cost("fixture.wo10.spell.combined");
    expect(summary(r)).toEqual(["VALID", 20, 80, 16, 16]);
    expect(r.result.percentageContributions.map((q) => [q.source, q.operation, q.percent])).toEqual([
      ["AFFINITY_STRENGTH", "SUBTRACT", 20],
      ["AFFINITY_WEAKNESS", "ADD", 10],
      ["CASTING_CONDITIONS", "SUBTRACT", 10],
    ]);
  });

  it("listed Conditions −10% −15% −20% = 45% are consumed as the WO9 EFFECTIVE 30% — never 45%, never a rank cap", () => {
    const r = cost("fixture.wo10.spell.cap");
    expect(r.result.castingConditions).toEqual({ listedPercent: 45, effectivePercent: 30, maximumPercent: 30 });
    expect(summary(r)).toEqual(["VALID", 20, 70, 14, 14]);
    expect(pct(r, "CASTING_CONDITIONS")?.percent).toBe(30);
  });

  it("the plan has exactly one net-percentage step, one unrounded application and one rounding step; nothing else rounds", () => {
    const r = cost("fixture.wo10.spell.combined");
    const wo10 = r.plan.evaluationPlan.steps.filter((s) => s.stepKey.startsWith("wo10."));
    const role = (x: string) => r.plan.sourceMap.entries.filter((e) => e.role === x).length;
    expect([role("spell-net-cost-percent"), role("spell-unrounded-final-mp"), role("spell-final-mp-rounding")]).toEqual([1, 1, 1]);
    const rounding = wo10.filter((s) => s.operation === "FORMULA" && /floor|ceil/.test(JSON.stringify(s.input)));
    expect(rounding.map((s) => s.stepKey)).toEqual([r.result.rounding.stepKey, r.plan.steps.baseAp]);
    for (const s of wo10) expect((s.input as { program?: { rounding?: string } }).program?.rounding ?? "NONE").toBe("NONE");
    expect(r.result.rounding).toEqual({ mode: "NORMAL_HALF_UP_ONCE", stepKey: r.plan.steps.finalMp });
  });

  it("Affinity is consumed exactly once: the WO4 listed-cost and WO4 net steps are never in the Spell cost plan", () => {
    const r = cost("fixture.wo10.spell.strength");
    const roles = r.plan.sourceMap.entries.map((e) => e.role);
    expect(roles).not.toContain("spell-affinity-listed-mp");
    expect(roles).not.toContain("affinity-net-cost-percent");
    expect(roles.filter((x) => x === "spell-net-cost-percent")).toHaveLength(1);
    expect(r.result.finalMpCost).toBe(16); // 20 × 80% once — a double application would give 12.8 → 13
  });

  it("equivalent condition ordering gives identical net, unrounded and final MP", () => {
    const g = spellCostFixture({ spells: { "fixture.wo10.spell.reordered": { mp: 17, conditions: [["limited_use", { period: "COMBAT" }], ["anchored"], ["verbal"]] } } });
    const a = runSpellCost(g.request("fixture.wo10.spell.cap"));
    const b = runSpellCost(g.request("fixture.wo10.spell.reordered"));
    expect([b.result.netCostPercent, b.result.unroundedFinalMpCost, b.result.finalMpCost]).toEqual([a.result.netCostPercent, a.result.unroundedFinalMpCost, a.result.finalMpCost]);
  });
});

describe("AP derivation (M5-I250–I252)", () => {
  it("17 MP, PRO 4 → floor(4.25) = 4 AP", () => {
    expect(cost("fixture.wo10.spell.ap").result.ap).toEqual({ pro: 4, baseApCost: 4, modifiers: [], finalApCost: 4 });
  });

  it("14 MP, PRO 4 → floor(3.5) = 3 AP: the AP division rounds DOWN, never normally to 4", () => {
    const r = cost("fixture.wo10.spell.half");
    expect([r.result.finalMpCost, r.result.ap.baseApCost, r.result.ap.finalApCost]).toEqual([14, 3, 3]);
  });

  it("Somatic −1 AP applies after base AP: 17 MP, PRO 4 → 4 − 1 = 3 AP (trace F)", () => {
    expect(cost("fixture.wo10.spell.somatic").result.ap).toEqual({ pro: 4, baseApCost: 4, modifiers: [{ contributionKey: "somatic.ap", operation: "SUBTRACT_AP", value: 1, applied: true }], finalApCost: 3 });
  });

  it("2 MP, PRO 5 → floor 0 → base minimum 1; Somatic cannot go below 1 AP", () => {
    const r = cost("fixture.wo10.spell.minimum", 5);
    expect([r.result.finalMpCost, r.result.ap.baseApCost, r.result.ap.finalApCost]).toEqual([2, 1, 1]);
  });

  it("36 MP, PRO 5 → 7 AP: no 3 AP cap (trace H)", () => {
    const r = cost("fixture.wo10.spell.high", 5);
    expect([r.result.finalMpCost, r.result.ap.baseApCost, r.result.ap.finalApCost]).toEqual([36, 7, 7]);
  });

  it("Charge: its −10% joins the single net (20 → 18 MP) and its +1 AP applies after base AP (4 + 1 = 5); no Channeling (trace G)", () => {
    const r = cost("fixture.wo10.spell.charge");
    expect(summary(r)).toEqual(["VALID", 20, 90, 18, 18]);
    expect(r.result.ap).toEqual({ pro: 4, baseApCost: 4, modifiers: [{ contributionKey: "charge.ap", operation: "ADD_AP", value: 1, applied: true }], finalApCost: 5 });
  });

  it("AP is derived from the FINAL MP step only (never pre-modifier MP) and divides by the caster's exact PRO", () => {
    const r = cost("fixture.wo10.spell.half");
    const baseAp = r.plan.evaluationPlan.steps.find((s) => s.stepKey === r.plan.steps.baseAp)!;
    expect(baseAp.bindings.map((b) => (b.source as { stepKey: string }).stepKey)).toEqual([r.plan.steps.finalMp]);
    expect((baseAp.input as { variables: { pro: number } }).variables.pro).toBe(4);
    expect([r.result.finalMpCost, r.result.ap.baseApCost]).toEqual([14, 3]); // floor(14 / 4), not floor(15 / 4) = 3 nor 13.5 / 4
  });
});
