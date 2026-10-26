import { describe, expect, it, vi } from "vitest";
import type { AbilityExecutionResult, ExecutionInputRequest } from "./ability/effect-execution.js";
import { attackInput, choiceInput, executionFixture, executionKeyOf, runExecution, saveInput } from "./testing/effect-execution-fixtures.js";

vi.setConfig({ testTimeout: 180_000 });

/**
 * M5-WO12 goldens — EFFECT CHAIN EXECUTION & RUNTIME RESOLUTION ROUTING. Every hit, miss, critical and Save result is a
 * WO2 core resolution evaluated by M4 from an explicit roll; every trigger is an M4 REQUIREMENT. Outcomes are emitted, never
 * applied. Guard index (docs/architecture/m5-invariants.json): M5-I295 · M5-I297 · M5-I298 · M5-I299 · M5-I300 · M5-I301 ·
 * M5-I303 · M5-I304 · M5-I305 · M5-I306 · M5-I307 · M5-I308 · M5-I309 · M5-I310 · M5-I311 · M5-I312 · M5-I313.
 */
const F = executionFixture();
const HIT = 5, CRIT = 6, MISS = 1, SAVE_OK = 6, SAVE_FAIL = 1;
type Answer = (q: ExecutionInputRequest) => Record<string, unknown> | null;
/** Execute, answer every pending request with the scripted responder, re-execute until COMPLETE (deterministic resume). */
function play(key: string, targets: Record<string, unknown>[], answer: Answer, extra: Record<string, unknown> = {}, martial = "MASTER") {
  const request = F.ability(key, martial);
  const ek = executionKeyOf(request);
  let inputs: Record<string, unknown>[] = [];
  const asked: ExecutionInputRequest[] = [];
  for (let round = 0; round < 8; round += 1) {
    const r = runExecution(request, { targets, inputs, ...extra });
    if (r.status === "COMPLETE") return { result: r, asked, inputs, request, ek };
    const next = r.pendingInputs.filter((q) => !inputs.some((i) => i.requestKey === q.requestKey));
    if (!next.length) throw new Error(`stuck: ${JSON.stringify(r.pendingInputs)}`);
    for (const q of next) {
      asked.push(q);
      const a = answer(q);
      if (a === null) throw new Error(`no scripted answer for ${q.requestKey}`);
      inputs = [...inputs, { ...a, requestKey: q.requestKey, executionKey: ek }];
    }
  }
  throw new Error("did not complete");
}
const roll = (natural: number): Answer => (q) => (q.kind === "ATTACK_ROLL" ? attackInput("", "", natural) : q.kind === "SAVING_THROW" ? saveInput("", "", natural) : null);
const by = (map: Record<string, number>): Answer => (q) => {
  const n = map[`${q.targetKey}.${q.scope}.${q.kind}`] ?? map[`${q.scope}.${q.kind}`] ?? map[q.kind];
  return n === undefined ? null : q.kind === "ATTACK_ROLL" ? attackInput("", "", n) : saveInput("", "", n);
};
const one = [{ targetKey: "goblin" }];
const statuses = (r: AbilityExecutionResult, target = 0) => r.targets![target]!.nodes.map((n) => [n.effectKey, n.status]);
const ops = (r: AbilityExecutionResult) => r.outcomes.map((o) => [o.targetKey, o.effectKey, o.outcomeKey]);

describe("Chain Behaviors (M5-I295, M5-I297–I301)", () => {
  it("STOP — hit: Effect 1 SUCCESS emitted, chain stops; miss: Effect 1 FAILURE emitted, chain stops", () => {
    const hit = play("fixture.wo12.spell.stop", one, roll(HIT)).result, miss = play("fixture.wo12.spell.stop", one, roll(MISS)).result;
    expect([ops(hit), hit.targets![0]!.termination]).toEqual([[["goblin", "effect1", "SUCCESS"]], "STOP"]);
    expect([ops(miss), miss.targets![0]!.termination]).toEqual([[["goblin", "effect1", "FAILURE"]], "STOP"]);
    expect(miss.outcomes[0]!.operations.map((o) => o.kind)).toEqual(["NO_EFFECT"]);
  });

  it("SUCCESS_ONLY — success reaches Effect 2; failure terminates before it", () => {
    const a = play("fixture.wo12.spell.success_only", one, by({ ATTACK_ROLL: HIT, SAVING_THROW: SAVE_FAIL })).result;
    const b = play("fixture.wo12.spell.success_only", one, roll(MISS)).result;
    expect(statuses(a)).toEqual([["effect1", "EXECUTED_SUCCESS"], ["effect2", "EXECUTED_SUCCESS"]]);
    expect([statuses(b), b.targets![0]!.termination]).toEqual([[["effect1", "EXECUTED_FAILURE"], ["effect2", "NOT_REACHED"]], "SUCCESS_ONLY_FAILURE"]);
  });

  it("FAILURE_ONLY — failure reaches Effect 2; success terminates", () => {
    const a = play("fixture.wo12.spell.failure_only", one, roll(MISS)).result, b = play("fixture.wo12.spell.failure_only", one, roll(HIT)).result;
    expect(statuses(a)).toEqual([["effect1", "EXECUTED_FAILURE"], ["effect2", "EXECUTED_SUCCESS"]]);
    expect([statuses(b), b.targets![0]!.termination]).toEqual([[["effect1", "EXECUTED_SUCCESS"], ["effect2", "NOT_REACHED"]], "FAILURE_ONLY_SUCCESS"]);
  });

  it("CONTINUE — Effect 2 resolves after Effect 1 SUCCESS and after FAILURE; Effect 1 keeps its own result", () => {
    for (const [n, r1] of [[HIT, "EXECUTED_SUCCESS"], [MISS, "EXECUTED_FAILURE"]] as const) {
      const r = play("fixture.wo12.spell.continue", one, roll(n)).result;
      expect(statuses(r)).toEqual([["effect1", r1], ["effect2", "EXECUTED_SUCCESS"]]);
      expect(r.targets![0]!.termination).toBe("STOP");
    }
  });

  it("BRANCH — exactly one exact destination executes (success → 2A, failure → 2B); never both", () => {
    const s = play("fixture.wo12.spell.branch", one, by({ ATTACK_ROLL: HIT })).result;
    const f = play("fixture.wo12.spell.branch", one, by({ ATTACK_ROLL: MISS, SAVING_THROW: SAVE_FAIL })).result;
    expect([statuses(s), s.targets![0]!.termination]).toEqual([[["effect1", "EXECUTED_SUCCESS"], ["effect2a", "EXECUTED_SUCCESS"], ["effect2b", "NOT_REACHED"]], "BRANCH_END"]);
    expect([statuses(f), f.targets![0]!.termination]).toEqual([[["effect1", "EXECUTED_FAILURE"], ["effect2a", "NOT_REACHED"], ["effect2b", "EXECUTED_SUCCESS"]], "BRANCH_END"]);
    expect(s.targets![0]!.nodes[0]!.transition).toEqual({ behavior: "BRANCH", next: "effect2a" });
  });

  it("an Effect with no listed behavior follows the ruled default (M5-SC-014): failure ends the chain", () => {
    const r = play("fixture.wo12.spell.ruled_default", one, roll(MISS)).result;
    expect([statuses(r), r.targets![0]!.termination]).toEqual([[["effect1", "EXECUTED_FAILURE"], ["effect2", "NOT_REACHED"]], "SUCCESS_ONLY_FAILURE"]);
  });
});

describe("Triggers — Trigger > Position (M5-I303)", () => {
  it("a false trigger is NOT_TRIGGERED: no SUCCESS / FAILURE outcome, and the next reachable Effect still resolves", () => {
    const r = play("fixture.wo12.spell.trigger", one, by({ ATTACK_ROLL: MISS, SAVING_THROW: SAVE_FAIL })).result;
    expect(statuses(r)).toEqual([["effect1", "EXECUTED_FAILURE"], ["effect2", "NOT_TRIGGERED"], ["effect3", "EXECUTED_SUCCESS"]]);
    expect(r.outcomes.some((o) => o.effectKey === "effect2")).toBe(false);
    expect(r.targets![0]!.nodes[1]!.trigger).toMatchObject({ evaluated: true, satisfied: false });
    expect(r.triggerEvaluations.map((t) => [t.nodeKey, t.satisfied])).toEqual([["effect2", false]]);
    const t = play("fixture.wo12.spell.trigger", one, by({ ATTACK_ROLL: HIT, SAVING_THROW: SAVE_FAIL })).result;
    expect(statuses(t)).toEqual([["effect1", "EXECUTED_SUCCESS"], ["effect2", "EXECUTED_SUCCESS"], ["effect3", "EXECUTED_SUCCESS"]]);
  });

  it("a trigger reading a runtime target fact waits for it (PENDING_INPUT), then reads the explicit fact", () => {
    const pending = runExecution(F.ability("fixture.wo12.spell.target_fact"), { targets: one, inputs: [] });
    expect([pending.status, pending.pendingInputs.map((q) => [q.kind, q.options])]).toEqual(["PENDING_INPUT", [["TARGET_FACT", ["target.bloodied"]]]]);
    const no = runExecution(F.ability("fixture.wo12.spell.target_fact"), { targets: [{ targetKey: "goblin", facts: { numeric: [{ key: "target.bloodied", value: 0 }] } }], inputs: [] });
    expect(statuses(no)).toEqual([["effect1", "EXECUTED_SUCCESS"], ["effect2", "NOT_TRIGGERED"]]);
  });
});

describe("Effect success normalization (M5-I304–I305)", () => {
  it("Saving Throw: target fails → Effect SUCCESS; target succeeds → Effect FAILURE", () => {
    const a = play("fixture.wo12.spell.projectile_save", one, by({ ATTACK_ROLL: HIT, SAVING_THROW: SAVE_FAIL })).result;
    const b = play("fixture.wo12.spell.projectile_save", one, by({ ATTACK_ROLL: HIT, SAVING_THROW: SAVE_OK })).result;
    expect([ops(a), ops(b)]).toEqual([[["goblin", "effect1", "SUCCESS"]], [["goblin", "effect1", "FAILURE"]]]);
    expect(a.coreEvaluations.map((c) => [c.procedure, c.stat])).toEqual([["ATTACK_ROLL", null], ["SAVING_THROW", "RES"]]);
  });

  it("a defender-chosen Save asks the DEFENDER with the exact profile options, then rolls that Save", () => {
    const r = play("fixture.wo12.spell.target_choice", one, (q) => (q.kind === "SAVE_SELECTION" ? choiceInput("", "", "SAVE_SELECTION", "CON") : saveInput("", "", SAVE_FAIL)));
    expect(r.asked.map((q) => [q.kind, q.by, q.options])).toEqual([["SAVE_SELECTION", "DEFENDER", ["AGI", "CON"]], ["SAVING_THROW", "DEFENDER", ["CON"]]]);
    expect(r.result.coreEvaluations[0]!.stat).toBe("CON");
  });
});

describe("multi-target isolation (M5-I307)", () => {
  it("Target A succeeds and continues; Target B fails and terminates — independent cursors, deterministic order", () => {
    const r = play("fixture.wo12.spell.multi", [{ targetKey: "a" }, { targetKey: "b" }], by({ "a.effect.effect1.ATTACK_ROLL": HIT, "b.effect.effect1.ATTACK_ROLL": MISS })).result;
    expect(r.targets!.map((t) => [t.targetKey, t.nodes.map((n) => n.status), t.termination])).toEqual([["a", ["EXECUTED_SUCCESS", "EXECUTED_SUCCESS"], "STOP"], ["b", ["EXECUTED_FAILURE", "NOT_REACHED"], "SUCCESS_ONLY_FAILURE"]]);
    expect(ops(r)).toEqual([["a", "effect1", "SUCCESS"], ["a", "effect2", "SUCCESS"], ["b", "effect1", "FAILURE"]]);
  });
});

describe("Projectile delivery (M5-I308)", () => {
  it("delivery hit + ATTACK_ROLL Effect: the SAME roll resolves the Effect — one Attack request, never two", () => {
    const r = play("fixture.wo12.spell.projectile_attack", one, roll(CRIT));
    expect(r.asked.map((q) => q.scope)).toEqual(["delivery"]);
    expect(r.result.targets![0]!.delivery).toMatchObject({ status: "HIT", critical: true });
    expect(r.result.outcomes[0]).toMatchObject({ effectKey: "effect1", result: "SUCCESS", critical: true, resolvedBy: r.asked[0]!.requestKey });
  });

  it("delivery hit + Save Effect: delivery Attack, then the Effect-owned Save", () => {
    const r = play("fixture.wo12.spell.projectile_save", one, by({ ATTACK_ROLL: HIT, SAVING_THROW: SAVE_FAIL }));
    expect(r.asked.map((q) => [q.scope, q.kind])).toEqual([["delivery", "ATTACK_ROLL"], ["effect.effect1", "SAVING_THROW"]]);
  });

  it("delivery miss: the Save is never requested, the Automatic Effect never applies; the trace records DELIVERY_FAILED", () => {
    for (const key of ["fixture.wo12.spell.projectile_save", "fixture.wo12.spell.projectile_auto"]) {
      const r = play(key, one, roll(MISS));
      expect(r.asked.map((q) => q.scope)).toEqual(["delivery"]);
      expect([r.result.targets![0]!.delivery.status, statuses(r.result), r.result.targets![0]!.termination, r.result.outcomes]).toEqual(["MISS", [["effect1", "NOT_DELIVERED"]], "DELIVERY_FAILED", []]);
    }
  });
});

describe("Maneuver resolution groups (M5-I309–I312)", () => {
  const maneuver = (key: string, groups: Record<string, string[]>, answer: Answer, martial = "MASTER") =>
    play(key, [{ targetKey: "goblin" }, { targetKey: "orc" }], answer, { groupTargets: Object.entries(groups).map(([groupKey, targetKeys]) => ({ groupKey, targetKeys })) }, martial);

  it("separate Attacks: one Attack resolution each; Armor Break sees only Attack A's result; A's critical stays with A", () => {
    const r = maneuver("fixture.wo12.maneuver.crit", { attack1: ["goblin"], attack2: ["goblin"] }, by({ "group.attack1.ATTACK_ROLL": CRIT, "group.attack2.ATTACK_ROLL": MISS }));
    expect(r.asked.map((q) => q.scope)).toEqual(["group.attack1", "group.attack2"]);
    expect(r.result.outcomes.map((o) => [o.groupKey, o.effectKey, o.result, o.critical])).toEqual([["attack1", "effect1", "SUCCESS", true], ["attack2", "effect2", "FAILURE", false]]);
  });

  it("Powerful Blow: ONE Attack request; its attached Effect executes once per target, inheriting that one result", () => {
    const r = maneuver("fixture.wo11.maneuver.powerful_blow", { "powerful_blow.attack1.attack2": ["goblin"] }, roll(HIT));
    expect(r.asked.map((q) => [q.scope, q.kind])).toEqual([["group.powerful_blow.attack1.attack2", "ATTACK_ROLL"]]);
    expect(r.result.groups![0]).toMatchObject({ kind: "POWERFUL_BLOW", actionKeys: ["attack1", "attack2"] });
    expect(r.result.outcomes.map((o) => [o.effectKey, o.result])).toEqual([["effect1", "SUCCESS"]]);
  });

  it("repeated Attacks without Powerful Blow are two Attack Rolls; each group may strike a different target", () => {
    const r = maneuver("fixture.wo11.maneuver.multi", { attack1: ["goblin"], attack2: ["orc"] }, by({ "goblin.group.attack1.ATTACK_ROLL": HIT, "orc.group.attack2.ATTACK_ROLL": MISS }));
    expect(r.asked.map((q) => [q.targetKey, q.scope])).toEqual([["goblin", "group.attack1"], ["orc", "group.attack2"]]);
    expect(r.result.outcomes.map((o) => [o.targetKey, o.groupKey, o.effectKey, o.result])).toEqual([["goblin", "attack1", "effect1", "SUCCESS"]]);
  });

  it("inherited resolution: the attached Effect succeeds from the Attack hit — no extra roll", () => {
    const r = maneuver("fixture.wo11.maneuver.basic", { attack1: ["goblin"] }, roll(HIT));
    expect([r.asked.length, r.result.outcomes.map((o) => [o.effectKey, o.result, o.resolvedBy])]).toEqual([1, [["effect1", "SUCCESS", r.asked[0]!.requestKey]]]);
  });

  it("Save replacement: no Attack Roll is requested; the Martial Save resolves the group; no critical exists", () => {
    const r = maneuver("fixture.wo12.maneuver.line", { attack1: ["goblin"] }, (q) => (q.kind === "SAVE_SELECTION" ? choiceInput("", "", "SAVE_SELECTION", "PER") : saveInput("", "", SAVE_FAIL)));
    expect(r.asked.map((q) => q.kind)).toEqual(["SAVE_SELECTION", "SAVING_THROW"]);
    expect(r.result.outcomes.map((o) => [o.effectKey, o.result, o.critical])).toEqual([["effect1", "SUCCESS", false], ["effect2", "SUCCESS", false]]);
  });

  it("support action: an Automatic Effect on a non-attack action resolves with no roll", () => {
    const r = maneuver("fixture.wo11.maneuver.support", { action1: ["goblin"] }, () => null);
    expect([r.asked, r.result.outcomes.map((o) => [o.effectKey, o.result])]).toEqual([[], [["effect1", "SUCCESS"]]]);
  });
});

describe("Martial Save control (M5-I313)", () => {
  const save = (key: string, martial: string, choices: Record<string, string>) =>
    play(key, [{ targetKey: "goblin" }], (q) => (q.kind === "SAVING_THROW" ? saveInput("", "", SAVE_FAIL) : choices[q.kind] ? choiceInput("", "", q.kind as "SAVE_REMOVAL" | "SAVE_SELECTION", choices[q.kind]!) : null), { groupTargets: [{ groupKey: "attack1", targetKeys: ["goblin"] }] }, martial);
  it("TRAINED — the defender chooses from the full profile", () => {
    const r = save("fixture.wo12.maneuver.sweep", "TRAINED", { SAVE_SELECTION: "PRO" });
    expect(r.asked.map((q) => [q.kind, q.by, q.options])).toEqual([["SAVE_SELECTION", "DEFENDER", ["AGI", "PRO"]], ["SAVING_THROW", "DEFENDER", ["PRO"]]]);
  });
  it("EXPERT — the attacker removes one, then the defender chooses from the rest (or the last Save stands)", () => {
    const line = save("fixture.wo12.maneuver.line", "EXPERT", { SAVE_REMOVAL: "AGI", SAVE_SELECTION: "PER" });
    expect(line.asked.map((q) => [q.kind, q.by, q.options])).toEqual([["SAVE_REMOVAL", "ATTACKER", ["AGI", "PRO", "PER"]], ["SAVE_SELECTION", "DEFENDER", ["PRO", "PER"]], ["SAVING_THROW", "DEFENDER", ["PER"]]]);
    const sweep = save("fixture.wo12.maneuver.sweep", "EXPERT", { SAVE_REMOVAL: "AGI" });
    expect(sweep.asked.map((q) => [q.kind, q.options])).toEqual([["SAVE_REMOVAL", ["AGI", "PRO"]], ["SAVING_THROW", ["PRO"]]]);
  });
  it("MASTER — the attacker chooses the Save the defender must use", () => {
    const r = save("fixture.wo12.maneuver.line", "MASTER", { SAVE_SELECTION: "PRO" });
    expect(r.asked.map((q) => [q.kind, q.by, q.options])).toEqual([["SAVE_SELECTION", "ATTACKER", ["AGI", "PRO", "PER"]], ["SAVING_THROW", "DEFENDER", ["PRO"]]]);
  });
});

describe("pending input and deterministic resume (M5-I306)", () => {
  it("a missing roll is PENDING_INPUT with a stable key — never a fabricated failure; resuming equals a complete-input run", () => {
    const request = F.ability("fixture.wo12.spell.success_only");
    const first = runExecution(request, { targets: one, inputs: [] });
    expect([first.status, first.outcomes, first.targets![0]!.nodes[0]!.status, first.pendingInputs.map((q) => q.requestKey)]).toEqual(["PENDING_INPUT", [], "PENDING_INPUT", ["wo12.exec.goblin.effect.effect1.attack_roll"]]);
    const played = play("fixture.wo12.spell.success_only", one, by({ ATTACK_ROLL: HIT, SAVING_THROW: SAVE_FAIL }));
    expect(runExecution(request, { targets: one, inputs: played.inputs })).toEqual(played.result);
  });
});
