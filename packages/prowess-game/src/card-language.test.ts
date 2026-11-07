import { describe, expect, it, vi } from "vitest";
import type { AbilityExecutionResult, ExecutionInputRequest, ProwessAbilityExecutionPlan } from "./ability/effect-execution.js";
import { compileAbilityExecution } from "./ability/effect-execution.js";
import { attackInput, executionFixture, executionKeyOf, runExecution, saveInput } from "./testing/effect-execution-fixtures.js";
import { maneuverRulesOf, spellRulesOf, type ChainStepSemantics, type SpellChainRules } from "./card/semantics.js";
import { operationPhrase, outcomePhrase, renderManeuverRules, renderSpellRules, savingThrowPhrase, type LanguageContext } from "./card/language.js";

/**
 * PAS-10 M6-WO9 Phase A — the Card Rules semantic model and the Card Rules Language, proven against the REAL M5-WO12
 * golden worlds: the semantic model is built from each compiled execution plan, and its predicted path (which Effects
 * resolve, with which result, and how the chain ends) is checked against the actual M5 executor for every behavior,
 * delivery and group scenario. Wording is asserted on top of semantics (not snapshots alone).
 */
vi.setConfig({ testTimeout: 180_000 });
const F = executionFixture();
const HIT = 5, MISS = 1, SAVE_OK = 6, SAVE_FAIL = 1;
const ctx: LanguageContext = { labelOf: (r) => r.canonicalKey.split(".").at(-1)!, actionLabel: (k) => k };
const planOf = (key: string, martial = "MASTER"): ProwessAbilityExecutionPlan => {
  const out = compileAbilityExecution(F.ability(key, martial));
  if (!out.ok) throw new Error(JSON.stringify(out.problems));
  return out.value;
};
const spellRules = (key: string): SpellChainRules => {
  const p = planOf(key);
  return spellRulesOf({ chain: p.chain!, delivery: p.delivery, targets: { kind: p.targetLimit.kind, count: p.targetLimit.maximum }, traits: [] });
};
type Answer = (q: ExecutionInputRequest) => Record<string, unknown> | null;
function play(key: string, targets: Record<string, unknown>[], answer: Answer, extra: Record<string, unknown> = {}): AbilityExecutionResult {
  const request = F.ability(key);
  const ek = executionKeyOf(request);
  let inputs: Record<string, unknown>[] = [];
  for (let round = 0; round < 8; round += 1) {
    const r = runExecution(request, { targets, inputs, ...extra });
    if (r.status === "COMPLETE") return r;
    for (const q of r.pendingInputs.filter((x) => !inputs.some((i) => i.requestKey === x.requestKey))) inputs = [...inputs, { ...answer(q)!, requestKey: q.requestKey, executionKey: ek }];
  }
  throw new Error("did not complete");
}
/** Every check of the scenario: "SUCCESS" → the Effect succeeds (hit / defender's save fails); "FAILURE" → it fails. */
const scenario = (effect: "SUCCESS" | "FAILURE", delivery: "HIT" | "MISS" = "HIT"): Answer => (q) => {
  if (q.kind === "ATTACK_ROLL") return attackInput("", "", q.scope === "delivery" ? (delivery === "HIT" ? HIT : MISS) : effect === "SUCCESS" ? HIT : MISS);
  if (q.kind === "SAVING_THROW") return saveInput("", "", effect === "SUCCESS" ? SAVE_FAIL : SAVE_OK);
  return null;
};
/** The path the SEMANTIC MODEL predicts for a scenario (no executor involved). */
function predict(rules: SpellChainRules, effect: "SUCCESS" | "FAILURE", delivery: "HIT" | "MISS" = "HIT") {
  const executed: [string, string][] = [];
  let cursor = rules.start, end = "END";
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const s: ChainStepSemantics = rules.steps.find((x) => x.effectKey === cursor)!;
    if (rules.delivery !== null && delivery === "MISS" && !(s.check.kind === "ATTACK_ROLL" && s.check.reusesDelivery)) { end = "DELIVERY_FAILED"; break; }
    const result = s.check.kind === "AUTOMATIC" ? "SUCCESS" : s.check.kind === "ATTACK_ROLL" && s.check.reusesDelivery ? (delivery === "HIT" ? "SUCCESS" : "FAILURE") : effect;
    executed.push([s.effectKey, result]);
    const next = result === "SUCCESS" ? s.afterSuccess : s.afterFailure;
    if (next.kind === "END") { end = next.termination === "END_OF_CHAIN" ? "END" : next.termination; cursor = null; } else cursor = next.effectKey;
  }
  return { executed, end };
}
const actual = (r: AbilityExecutionResult) => ({ executed: r.outcomes.map((o) => [o.effectKey, o.outcomeKey]), end: ["END_OF_CHAIN", "BRANCH_END"].includes(r.targets![0]!.termination!) ? "END" : r.targets![0]!.termination });

describe("semantic model ≡ M5-WO12 executor (all five Chain Behaviors, delivery, per-target)", () => {
  const plain = ["stop", "success_only", "failure_only", "continue", "branch", "ruled_default"].map((k) => `fixture.wo12.spell.${k}`);
  for (const key of plain)
    for (const effect of ["SUCCESS", "FAILURE"] as const)
      it(`${key} — every check ${effect}: the predicted Effects, results and ending match the executor`, () => {
        expect(predict(spellRules(key), effect)).toEqual(actual(play(key, [{ targetKey: "goblin" }], scenario(effect))));
      });
  for (const key of ["projectile_attack", "projectile_save", "projectile_auto"].map((k) => `fixture.wo12.spell.${k}`))
    for (const delivery of ["HIT", "MISS"] as const)
      it(`${key} — delivery ${delivery}: NOT_DELIVERED is predicted exactly where the executor stops`, () => {
        expect(predict(spellRules(key), "SUCCESS", delivery)).toEqual(actual(play(key, [{ targetKey: "goblin" }], scenario("SUCCESS", delivery))));
      });
  it("each Behavior maps to its exact transitions", () => {
    const t = (key: string, i = 0) => {
      const s = spellRules(`fixture.wo12.spell.${key}`).steps[i]!;
      return [s.behavior, s.afterSuccess, s.afterFailure];
    };
    expect(t("stop")).toEqual(["STOP", { kind: "END", termination: "STOP" }, { kind: "END", termination: "STOP" }]);
    expect(t("success_only")).toEqual(["SUCCESS_ONLY", { kind: "EFFECT", effectKey: "effect2" }, { kind: "END", termination: "SUCCESS_ONLY_FAILURE" }]);
    expect(t("failure_only")).toEqual(["FAILURE_ONLY", { kind: "END", termination: "FAILURE_ONLY_SUCCESS" }, { kind: "EFFECT", effectKey: "effect2" }]);
    expect(t("continue")).toEqual(["CONTINUE", { kind: "EFFECT", effectKey: "effect2" }, { kind: "EFFECT", effectKey: "effect2" }]);
    expect(t("branch")).toEqual(["BRANCH", { kind: "EFFECT", effectKey: "effect2a" }, { kind: "EFFECT", effectKey: "effect2b" }]);
  });
  it("multiple targets: the chain is stated per target and resolved per target", () => {
    const rules = spellRules("fixture.wo12.spell.multi");
    expect(rules.perTarget).toBe(true);
    expect(renderSpellRules(rules, ctx).blocks[0]!.text).toContain("Resolve the chain below separately for each target.");
  });
});

describe("Card Rules Language — resolution wording (decision C4)", () => {
  it("Attack Roll: 'Make an Attack Roll …; on a hit … on a miss …' with the authored outcomes", () => {
    const rules = spellRules("fixture.wo12.spell.stop");
    const s = rules.steps[0]!;
    expect(s.check).toEqual({ kind: "ATTACK_ROLL", reusesDelivery: false });
    const text = renderSpellRules(rules, ctx).blocks.find((b) => b.key === "step.effect1")!.text;
    expect(text).toContain("Make an Attack Roll against the target.");
    expect(text).toContain(`On a hit, ${outcomePhrase(s.onEffectSuccess, ctx)}.`);
    expect(text).toContain(`On a miss, ${outcomePhrase(s.onEffectFailure, ctx)}.`);
    expect(text).toContain("Then the Spell ends for this target.");
  });

  it("Saving Throw: the Effect SUCCEEDS when the defender's save FAILS; each authored outcome sits on the right side", () => {
    const rules = spellRules("fixture.wo12.spell.success_only");
    const s = rules.steps[1]!;
    expect(s.check).toMatchObject({ kind: "SAVING_THROW", effectSucceedsWhen: "DEFENDER_SAVE_FAILS", effectFailsWhen: "DEFENDER_SAVE_SUCCEEDS" });
    const text = renderSpellRules(rules, ctx).blocks.find((b) => b.key === "step.effect2")!.text;
    expect(text).toContain(`${savingThrowPhrase((s.check as { flow: Parameters<typeof savingThrowPhrase>[0] }).flow).replace(/^t/, "T")}.`);
    expect(text).toContain(`If the save fails, the Effect succeeds: ${outcomePhrase(s.onEffectSuccess, ctx)}.`);
    expect(text).toContain(`If the save succeeds, the Effect fails: ${outcomePhrase(s.onEffectFailure, ctx)}.`);
    // The executor agrees: a FAILED defender save emits the SUCCESS outcome.
    const r = play("fixture.wo12.spell.success_only", [{ targetKey: "goblin" }], scenario("SUCCESS"));
    expect(r.outcomes.find((o) => o.effectKey === "effect2")!.outcomeKey).toBe("SUCCESS");
    // A successful save does NOT necessarily negate: the authored FAILURE operations are stated, never assumed.
    expect(s.onEffectFailure.authored).toBe(true);
  });

  it("Save flows: fixed stat and defender choice are worded from the exact flow", () => {
    expect(savingThrowPhrase({ kind: "FIXED", stat: "RES" })).toBe("the target makes a RES Saving Throw");
    const choice = spellRules("fixture.wo12.spell.target_choice").steps[0]!.check;
    expect(choice).toMatchObject({ kind: "SAVING_THROW", flow: { kind: "DEFENDER_CHOOSES", stats: ["AGI", "CON"] } });
    expect(savingThrowPhrase((choice as { flow: Parameters<typeof savingThrowPhrase>[0] }).flow)).toBe("the target makes a Saving Throw, choosing AGI or CON");
  });

  it("Automatic: no roll is fabricated", () => {
    const rules = spellRules("fixture.wo12.spell.failure_only");
    const text = renderSpellRules(rules, ctx).blocks.find((b) => b.key === "step.effect2")!.text;
    expect(rules.steps[1]!.check).toEqual({ kind: "AUTOMATIC" });
    expect(text).toContain(`No roll — it applies automatically: ${outcomePhrase(rules.steps[1]!.onEffectSuccess, ctx)}.`);
    expect(text).not.toMatch(/Attack Roll|Saving Throw/);
  });

  it("delivery: Effects reusing the delivery roll fail on a miss; every other Effect is NOT_DELIVERED (not a failure)", () => {
    const rules = spellRules("fixture.wo12.spell.projectile_attack");
    expect(rules.delivery).toEqual({ check: "RANGED_ATTACK_ROLL", reusedBy: ["effect1"], onMiss: "NOT_DELIVERED" });
    const text = renderSpellRules(rules, ctx).blocks.find((b) => b.kind === "DELIVERY")!.text;
    expect(text).toBe("Make a ranged Attack Roll to deliver the Spell to the target. On a miss, Effect 1 uses this roll and fails on a miss; every other Effect is not delivered — not a failure — and the chain ends for that target.");
    expect(renderSpellRules(rules, ctx).blocks.find((b) => b.key === "step.effect1")!.text).toContain("This Effect uses the delivery Attack Roll: on a hit,");
  });
});

describe("triggers: NOT_TRIGGERED is never a failure; unknown conditions fail closed", () => {
  it("a chain-result trigger reads as a condition with its not-triggered path", () => {
    const rules = spellRules("fixture.wo12.spell.trigger");
    const s = rules.steps[1]!;
    expect(s.trigger).toEqual({ kind: "EFFECT_RESULT", effectKey: "effect1", result: "SUCCEEDED", negated: false });
    expect(s.notTriggered).toEqual({ kind: "EFFECT", effectKey: "effect3" });
    expect(renderSpellRules(rules, ctx).blocks.find((b) => b.key === "step.effect2")!.text).toContain("Only if Effect 1 succeeded; otherwise it is not triggered — not a failure — and the chain moves on to Effect 3.");
  });
  it("an explicit target fact is named as a runtime fact, never interpreted", () => {
    const s = spellRules("fixture.wo12.spell.target_fact").steps[1]!;
    expect(s.trigger).toEqual({ kind: "TARGET_FACT", factKey: "target.bloodied", operator: "==", expected: 1 });
    expect(renderSpellRules(spellRules("fixture.wo12.spell.target_fact"), ctx).status).toBe("COMPLETE");
  });
  it("a trigger the language cannot word faithfully is marked unresolved and points to the Inspector", () => {
    const p = planOf("fixture.wo12.spell.trigger");
    const nodes = p.chain!.nodes.map((n) => (n.effectKey === "effect2" ? { ...n, trigger: { kind: "RANK_AT_LEAST", factKey: "target.rank", requiredRankKey: "EXPERT", requiredOrder: 2, provenance: null } as never } : n));
    const rules = spellRulesOf({ chain: { start: p.chain!.start, nodes }, delivery: null, targets: { kind: "ONE", count: 1 }, traits: [] });
    expect(rules.unresolved.map((u) => u.code)).toEqual(["CARD.UNDESCRIBED_TRIGGER"]);
    const out = renderSpellRules(rules, ctx);
    expect(out.status).toBe("PARTIAL");
    expect(out.blocks.map((b) => b.text).join(" ")).toContain("a condition this card cannot word faithfully (see the Rules Inspector)");
  });
});

describe("operations are worded from evaluated parameters and authored data only", () => {
  it("parameters named by the operation come from the evaluation; unknown authored data is listed, never dropped", () => {
    const op = { kind: "DAMAGE", facts: [{ key: "dice", value: 2, from: "PARAMETER" as const }, { key: "damageType", value: "FIRE", from: "PARAMETER" as const }, { key: "extra", value: "ZONE_EDGE", from: "AUTHORED" as const }], missingParameters: [] };
    expect(operationPhrase(op, ctx)).toBe("deal 2 Character Dice of Fire damage (Extra: Zone Edge)");
    expect(operationPhrase({ kind: "DAMAGE", facts: [], missingParameters: ["dice"] }, ctx)).toBe("deal damage [unresolved parameter: dice]");
    expect(operationPhrase({ kind: "FOUNDATION_DAMAGE", facts: [{ key: "fraction", value: 0.5, from: "AUTHORED" }], missingParameters: [] }, ctx)).toBe("deal half of the Attack's damage");
    expect(operationPhrase({ kind: "SUMMON", facts: [{ key: "contract", value: "STRUCTURAL_ONLY", from: "AUTHORED" }], missingParameters: [] }, ctx)).toContain("runtime is deferred");
  });
});

describe("decision C2 — the target-selection hook (test-only presentation fixture)", () => {
  it("an explicit selection restriction changes the target phrase; without it the phrase is unchanged", () => {
    const p = planOf("fixture.wo12.spell.multi");
    const base = { chain: p.chain!, delivery: null, targets: { kind: "SELECTED", count: 2 }, traits: [] };
    const plain = renderSpellRules(spellRulesOf(base), ctx).blocks[0]!.text;
    const hook = { kind: "SELECTED_CREATURES_ONLY" as const, source: { entityId: "t", entityVersionId: "tv", canonicalKey: "test.presentation.selective_trait", definitionKind: "SPELL_TRAIT", systemFamily: "SPELL" } as never };
    const selective = renderSpellRules(spellRulesOf({ ...base, targetSelection: hook }), ctx).blocks[0]!.text;
    expect(plain).not.toContain("only creatures you select");
    expect(selective).toContain("Selective_trait: within the area, only creatures you select are affected.");
  });
});

describe("Maneuvers: independent resolution groups (never one Spell chain)", () => {
  const groups = (key: string) => {
    const p = planOf(key);
    expect(p.chain).toBeNull();
    return maneuverRulesOf({ groups: p.groups!, traits: [] });
  };
  it("each group has its own resolution; attached Effects depend on their group only", () => {
    const rules = groups("fixture.wo12.maneuver.crit");
    expect(rules.groups.map((g) => [g.groupKey, g.check.kind, g.effects.map((e) => [e.effectKey, e.check])])).toEqual([
      ["attack1", "ATTACK_ROLL", [["effect1", { kind: "GROUP", groupKey: "attack1" }]]],
      ["attack2", "ATTACK_ROLL", [["effect2", { kind: "GROUP", groupKey: "attack2" }]]],
    ]);
    const text = renderManeuverRules(rules, ctx);
    expect(text.blocks[0]!.text).toContain("Maneuver Actions never form one Spell Effect Chain");
    expect(text.blocks.filter((b) => b.kind === "GROUP")).toHaveLength(2);
    expect(text.blocks.map((b) => b.text).join(" ")).not.toMatch(/continue to Effect|the Spell ends/);
  });
  it("a Martial Save replaces the group's Attack Roll and keeps the exact Save sides", () => {
    const rules = groups("fixture.wo12.maneuver.sweep");
    expect(rules.groups[0]!.check).toMatchObject({ kind: "SAVING_THROW", replacedBy: "effect1" });
    const text = renderManeuverRules(rules, ctx).blocks.find((b) => b.kind === "GROUP")!.text;
    expect(text).toContain("Instead of an Attack Roll, the target makes");
    expect(text).toContain("If the group's save fails, the Effect succeeds:");
  });
  it("group semantics match the executor: a miss emits only the group's FAILURE outcomes, per group", () => {
    const r = play("fixture.wo12.maneuver.crit", [{ targetKey: "goblin" }], (q) => (q.kind === "ATTACK_ROLL" ? attackInput("", "", q.scope.endsWith("attack1") ? HIT : MISS) : null), { groupTargets: [{ groupKey: "attack1", targetKeys: ["goblin"] }, { groupKey: "attack2", targetKeys: ["goblin"] }] });
    expect(r.outcomes.map((o) => [o.groupKey, o.effectKey, o.outcomeKey])).toEqual([
      ["attack1", "effect1", "SUCCESS"],
      ["attack2", "effect2", "FAILURE"],
    ]);
  });
});
