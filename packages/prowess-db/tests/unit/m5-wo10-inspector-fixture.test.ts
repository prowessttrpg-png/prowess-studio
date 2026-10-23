import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileSpellCost, evaluateSpellCost } from "@prowess/game";
import { DEFAULT_SPELLS, spellCostCharacter, spellCostFixture } from "../../../prowess-game/src/testing/spell-cost-fixtures.js";

/**
 * M5-WO10 Rules Inspector fixtures — representative final Spell cost traces A–H regenerated from content and the real
 * compiler (apps/studio/tests/integration/m5-wo10-spell-cost-api.test.ts runs them through the existing evaluate endpoint):
 * A Simple · B Affinity-aligned · C Strength + Weakness · D Casting Condition · E Affinity + Conditions · F Somatic ·
 * G Charge · H high-AP. Each fixture exposes base MP, every contribution, each percentage, the net percentage, unrounded
 * MP, the rounding step, final MP, PRO, base AP, AP modifiers, final AP and exact provenance. Set M5_WO10_WRITE_FIXTURE=1
 * to rewrite it deliberately.
 */
const path = resolve(import.meta.dirname, "../../../../apps/studio/tests/integration/fixtures/m5-wo10-spell-cost-plans.json");
const TRACES: readonly [string, string, number, string | null][] = [
  ["A", "fixture.wo10.spell.simple", 4, null],
  ["B", "fixture.wo10.spell.strength", 4, "EXPERT"],
  ["C", "fixture.wo10.spell.strength_weakness", 4, "EXPERT"],
  ["D", "fixture.wo10.spell.half", 4, null],
  ["E", "fixture.wo10.spell.combined", 4, "EXPERT"],
  ["F", "fixture.wo10.spell.somatic", 4, null],
  ["G", "fixture.wo10.spell.charge", 4, null],
  ["H", "fixture.wo10.spell.high", 5, null],
];
describe("M5-WO10 Inspector fixtures explain every final Spell cost", () => {
  it("regenerates stable plans and evaluated cost traces A–H", () => {
    const f = spellCostFixture();
    const build = () =>
      TRACES.map(([trace, key, pro, rank]) => {
        const affinity = DEFAULT_SPELLS[key]!.affinity ?? null;
        const request = f.request(key, spellCostCharacter(pro, affinity === null || rank === null ? null : [f.ref(affinity), rank]));
        const plan = compileSpellCost(request), result = evaluateSpellCost(request);
        if (!plan.ok || !result.ok) throw new Error(JSON.stringify({ plan, result }));
        const { authored: _authored, ...cost } = result.value;
        void _authored;
        return { trace, evaluationKey: `m5-wo10.${trace}`, definition: plan.value.definition, rulesetProvenance: plan.value.rulesetProvenance, plan: plan.value.evaluationPlan, sourceMap: plan.value.sourceMap, steps: plan.value.steps, cost };
      });
    const fresh = JSON.parse(JSON.stringify(build())) as unknown;
    if (process.env.M5_WO10_WRITE_FIXTURE === "1") writeFileSync(path, `${JSON.stringify(fresh)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  }, 180_000);
});
