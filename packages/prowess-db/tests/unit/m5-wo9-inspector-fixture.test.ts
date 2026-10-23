import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileAbilityDefinition, evaluateAbilityDefinition } from "@prowess/game";
import { durationConditionFixture, WO9_REFERENCE_KEYS } from "../../../prowess-game/src/testing/duration-condition-fixtures.js";
const path = resolve(import.meta.dirname, "../../../../apps/studio/tests/integration/fixtures/m5-wo9-ability-plans.json");
describe("WO9 Inspector fixtures retain exact Duration/Condition sources, parameters, requirements and listed contribution stage", () => {
  it("regenerates stable permanent M4 plans and actual evaluated cap/capacity results", () => {
    const f = durationConditionFixture();
    const build = () => [WO9_REFERENCE_KEYS[1]!, WO9_REFERENCE_KEYS[8]!].map(key => {
      const p = compileAbilityDefinition(f.request(key)), r = evaluateAbilityDefinition(f.request(key)); if (!p.ok || !r.ok) throw new Error(JSON.stringify({ p, r }));
      return { evaluationKey: key, plan: p.value.evaluationPlan, sourceMap: p.value.sourceMap, definition: p.value.definition, rulesetProvenance: p.value.rulesetProvenance, durationConditions: r.value.durationConditions, explanationStepKey: p.value.explanationStepKey };
    });
    const fresh = JSON.parse(JSON.stringify(build()));
    if (process.env.M5_WO9_WRITE_FIXTURE === "1") writeFileSync(path, `${JSON.stringify(fresh)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(fresh); expect(build()).toEqual(fresh);
  }, 60_000);
});
