import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileManeuverCost, evaluateManeuverCost } from "@prowess/game";
import { maneuverCostCharacter, maneuverCostFixture } from "../../../prowess-game/src/testing/maneuver-cost-fixtures.js";

/**
 * M5-WO11 Rules Inspector fixtures — representative final Maneuver cost traces A–J regenerated from content and the real
 * compiler (apps/studio/tests/integration/m5-wo11-maneuver-cost-api.test.ts runs them through the existing evaluate
 * endpoint): A basic single attack · B high-AP · C separate multi-attack · D Powerful Blow · E AP/MP option · F MP-bearing
 * · G Condition-capped · H Signature · I Signature multi-attack · J support / non-attack. Each fixture exposes Base AP,
 * every contribution (per component use), the cost options, the Conditions (listed / effective / cap), the attack
 * resolution count and floor, post-Condition AP, the Signature, final AP, Base / final MP, the attachment structure and
 * exact provenance. Set M5_WO11_WRITE_FIXTURE=1 to rewrite it deliberately.
 */
const path = resolve(import.meta.dirname, "../../../../apps/studio/tests/integration/fixtures/m5-wo11-maneuver-cost-plans.json");
const TRACES: readonly [string, string, boolean, string | null][] = [
  ["A", "fixture.wo11.maneuver.basic", false, null],
  ["B", "fixture.wo11.maneuver.high", false, null],
  ["C", "fixture.wo11.maneuver.multi", false, null],
  ["D", "fixture.wo11.maneuver.powerful_blow", false, null],
  ["E", "fixture.wo11.maneuver.option_mp", false, null],
  ["F", "fixture.wo11.maneuver.mana", false, null],
  ["G", "fixture.wo11.maneuver.capped", false, null],
  ["H", "fixture.wo11.maneuver.basic", true, null],
  ["I", "fixture.wo11.maneuver.signature_multi", true, null],
  ["J", "fixture.wo11.maneuver.support", false, null],
];
describe("M5-WO11 Inspector fixtures explain every final Maneuver cost", () => {
  it("regenerates stable plans and evaluated cost traces A–J", () => {
    const f = maneuverCostFixture();
    const build = () =>
      TRACES.map(([trace, key, signature, rank]) => {
        const request = f.request(key, signature, maneuverCostCharacter(rank === null ? null : [f.ref("affinity.transmutation"), rank]));
        const plan = compileManeuverCost(request), result = evaluateManeuverCost(request);
        if (!plan.ok || !result.ok) throw new Error(JSON.stringify({ plan, result }));
        const { authored: _authored, ...cost } = result.value;
        void _authored;
        return { trace, evaluationKey: `m5-wo11.${trace}`, definition: plan.value.definition, rulesetProvenance: plan.value.rulesetProvenance, plan: plan.value.evaluationPlan, sourceMap: plan.value.sourceMap, steps: plan.value.steps, cost };
      });
    const fresh = JSON.parse(JSON.stringify(build())) as unknown;
    if (process.env.M5_WO11_WRITE_FIXTURE === "1") writeFileSync(path, `${JSON.stringify(fresh)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  }, 300_000);
});
