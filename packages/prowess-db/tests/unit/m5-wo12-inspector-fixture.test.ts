import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { attackInput, choiceInput, executionFixture, playExecution, saveInput, type ExecutionAnswer } from "../../../prowess-game/src/testing/effect-execution-fixtures.js";

/**
 * M5-WO12 Rules Inspector fixtures — representative Effect-chain execution traces regenerated from content and the real
 * executor (apps/studio/tests/integration/m5-wo12-effect-execution-api.test.ts replays every WO2 core resolution and every
 * trigger REQUIREMENT through the existing evaluate endpoint): A Spell BRANCH (hit → success path) · B multi-target
 * isolation (A hits and continues, B misses and terminates) · C Projectile delivery hit then the Effect-owned Save · D
 * Projectile delivery miss (no Save requested, DELIVERY_FAILED) · E Powerful Blow (ONE Attack request) · F separate
 * Attacks with a scoped critical · G Martial EXPERT Save control (attacker removes, defender selects) · H false trigger
 * (NOT_TRIGGERED, traversal continues). Set M5_WO12_WRITE_FIXTURE=1 to rewrite it deliberately.
 */
const path = resolve(import.meta.dirname, "../../../../apps/studio/tests/integration/fixtures/m5-wo12-effect-execution-traces.json");
const HIT = 5, CRIT = 6, MISS = 1, SAVE_FAIL = 1;
const by = (map: Record<string, number>): ExecutionAnswer => (q) => {
  const n = map[`${q.targetKey}.${q.scope}.${q.kind}`] ?? map[`${q.scope}.${q.kind}`] ?? map[q.kind];
  return n === undefined ? null : q.kind === "ATTACK_ROLL" ? attackInput("", "", n) : saveInput("", "", n);
};
const one = [{ targetKey: "goblin" }];
const groups = (g: Record<string, string[]>) => ({ groupTargets: Object.entries(g).map(([groupKey, targetKeys]) => ({ groupKey, targetKeys })) });
type Trace = [string, string, string, Record<string, unknown>[], ExecutionAnswer, Record<string, unknown>];
const TRACES: readonly Trace[] = [
  ["A", "fixture.wo12.spell.branch", "MASTER", one, by({ ATTACK_ROLL: HIT }), {}],
  ["B", "fixture.wo12.spell.multi", "MASTER", [{ targetKey: "a" }, { targetKey: "b" }], by({ "a.effect.effect1.ATTACK_ROLL": HIT, "b.effect.effect1.ATTACK_ROLL": MISS }), {}],
  ["C", "fixture.wo12.spell.projectile_save", "MASTER", one, by({ ATTACK_ROLL: HIT, SAVING_THROW: SAVE_FAIL }), {}],
  ["D", "fixture.wo12.spell.projectile_save", "MASTER", one, by({ ATTACK_ROLL: MISS }), {}],
  ["E", "fixture.wo11.maneuver.powerful_blow", "MASTER", one, by({ ATTACK_ROLL: HIT }), groups({ "powerful_blow.attack1.attack2": ["goblin"] })],
  ["F", "fixture.wo12.maneuver.crit", "MASTER", one, by({ "group.attack1.ATTACK_ROLL": CRIT, "group.attack2.ATTACK_ROLL": MISS }), groups({ attack1: ["goblin"], attack2: ["goblin"] })],
  ["G", "fixture.wo12.maneuver.line", "EXPERT", one, (q) => (q.kind === "SAVING_THROW" ? saveInput("", "", SAVE_FAIL) : q.kind === "SAVE_REMOVAL" ? choiceInput("", "", "SAVE_REMOVAL", "AGI") : q.kind === "SAVE_SELECTION" ? choiceInput("", "", "SAVE_SELECTION", "PER") : null), groups({ attack1: ["goblin"] })],
  ["H", "fixture.wo12.spell.trigger", "MASTER", one, by({ ATTACK_ROLL: MISS, SAVING_THROW: SAVE_FAIL }), {}],
];
describe("M5-WO12 Inspector fixtures explain every Effect-chain execution", () => {
  it("regenerates stable execution traces A–H with every M4 core and trigger plan", () => {
    const f = executionFixture();
    const build = () =>
      TRACES.map(([trace, key, martial, targets, answer, extra]) => {
        const { result, inputs } = playExecution(f.ability(key, martial), targets, answer, extra);
        const { coreEvaluations, triggerEvaluations, ...rest } = result;
        return { trace, key, inputs: inputs.map((i) => i.requestKey), execution: rest, coreEvaluations, triggerEvaluations };
      });
    const fresh = JSON.parse(JSON.stringify(build())) as unknown;
    if (process.env.M5_WO12_WRITE_FIXTURE === "1") writeFileSync(path, `${JSON.stringify(fresh)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  }, 600_000);
});
