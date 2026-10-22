import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileAbilityDefinition } from "@prowess/game";
import { abilityDefinitionFixture } from "../../../prowess-game/src/testing/ability-definition-fixtures.js";
const path = resolve(import.meta.dirname, "../../../../apps/studio/tests/integration/fixtures/m5-wo8-ability-plans.json");
describe("WO8 Inspector fixtures are compiled by the permanent domain package", () => {
  it("regenerates exact M4 plans, selected Traits, and source maps", () => {
    const f = abilityDefinitionFixture();
    const build = () => ["fixture.spell.multi", "fixture.maneuver.multi"].map(key => {
      const p = compileAbilityDefinition(f.request(key)); if (!p.ok) throw new Error(JSON.stringify(p.problems));
      return { evaluationKey: key, plan: p.value.evaluationPlan, sourceMap: p.value.sourceMap, definition: p.value.definition, traits: p.value.traits, actions: p.value.actions, explanationStepKey: p.value.explanationStepKey };
    });
    const fresh = JSON.parse(JSON.stringify(build()));
    if (process.env.M5_WO8_WRITE_FIXTURE === "1") writeFileSync(path, `${JSON.stringify(fresh)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  }, 60_000);
});
