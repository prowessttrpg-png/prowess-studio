import { describe, expect, it, vi } from "vitest";
import { EFFECT_EXECUTION_ERROR_CODES as K, compileAbilityExecution, executeAbilityResolution } from "./ability/effect-execution.js";
import { compileManeuverCost } from "./ability/maneuver-cost.js";
import { copy, setPath } from "./testing/duration-condition-fixtures.js";
import { attackInput, choiceInput, executionFixture, executionKeyOf, runExecution, saveInput, type SpellChainSpec } from "./testing/effect-execution-fixtures.js";
import { uuid } from "./testing/fixtures.js";

vi.setConfig({ testTimeout: 180_000 });

/**
 * M5-WO12 contracts and negative controls: authored chain validity (exact Effect Uses, acyclic forward branches, structured
 * triggers), explicit and bound runtime inputs (no success claims, no forged or foreign inputs, legal Save choices only),
 * exact-Ruleset history, fail-closed unresolved routing, the state-mutation / runtime boundaries, plain-data safety,
 * immutability, serialization and determinism.
 * Guard index (docs/architecture/m5-invariants.json): M5-I294 · M5-I296 · M5-I302 · M5-I303 · M5-I306 · M5-I309 · M5-I310 ·
 * M5-I313 · M5-I314 · M5-I315.
 */
const F = executionFixture();
const one = [{ targetKey: "goblin" }];
const codes = (o: { ok: boolean; problems?: readonly { code: string }[] }) => (o.ok ? [] : o.problems!.map((q) => q.code));
const chainSpell = (chain: Record<string, unknown>, effects: SpellChainSpec["effects"] = [["effect1", "strike"], ["effect2", "mend"], ["effect3", "hex"]]) => executionFixture({ spells: { "fixture.wo12.spell.x": { effects, chain } } });

describe("authored chains: exact Effect Uses, acyclic, structured (M5-I294, M5-I296, M5-I302–I303)", () => {
  it.each([
    ["a branch destination named by display text", { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "BRANCH", branch: { success: "Mend Wounds", failure: "effect3" } }] }, /exact Effect Use of this Spell/],
    ["a dangling / cross-Ability destination", { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "BRANCH", branch: { success: "effect9", failure: "effect3" } }] }, /exact Effect Use of this Spell/],
    ["a backward destination (a cycle)", { failurePolicy: "STOP", nodes: [{ effectKey: "effect2", behavior: "BRANCH", branch: { success: "effect1", failure: "effect3" } }] }, /later in authored order/],
    ["a self destination", { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "BRANCH", branch: { success: "effect1", failure: "effect2" } }] }, /later in authored order/],
    ["an unknown Chain Behavior", { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "LOOP" }] }, /unknown Chain Behavior/],
    ["a node named by display name", { failurePolicy: "STOP", nodes: [{ effectKey: "Strike", behavior: "STOP" }] }, /exact Effect Use of this Spell/],
    ["a prose trigger", { failurePolicy: "STOP", nodes: [{ effectKey: "effect2", behavior: "STOP", trigger: "after you hit them really hard" }] }, /structured M4 requirement/],
    ["a trigger reading a later Effect", { failurePolicy: "STOP", nodes: [{ effectKey: "effect2", behavior: "STOP", trigger: { kind: "NUMERIC_COMPARE", factKey: "chain.effect3.success", operator: "==", expected: 1, provenance: null } }] }, /EARLIER exact Effect Use/],
    ["a trigger reading an undeclared fact", { failurePolicy: "STOP", nodes: [{ effectKey: "effect2", behavior: "STOP", trigger: { kind: "NUMERIC_COMPARE", factKey: "hp.current", operator: "<", expected: 5, provenance: null } }] }, /unknown chain fact/],
    ["branch data on a non-BRANCH node", { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "CONTINUE", branch: { success: "effect2", failure: "effect3" } }] }, /only BRANCH declares destinations/],
    ["one destination owned by two branches", { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "BRANCH", branch: { success: "effect2", failure: "effect3" } }, { effectKey: "effect2", behavior: "BRANCH", branch: { success: "effect3", failure: "effect4" } }] }, /more than one branch|exact Effect Use/],
  ])("%s is refused when the Spell is authored", (_l, chain, message) => {
    expect(() => chainSpell(chain)).toThrow(message);
  });

  it("the executed node identity is the exact Effect Use: routing reads componentKey / branch keys only", () => {
    const plan = compileAbilityExecution(F.ability("fixture.wo12.spell.branch"));
    expect(plan.ok && plan.value.chain!.nodes.map((n) => [n.effectKey, n.definition.canonicalKey, n.branch, n.successor, n.branchDestination])).toEqual([["effect1", "fixture.wo12.effect.strike", { success: "effect2a", failure: "effect2b" }, null, false], ["effect2a", "fixture.wo12.effect.mend", null, null, true], ["effect2b", "fixture.wo12.effect.hex", null, null, true]]);
  });
});

describe("explicit, bound runtime inputs (M5-I306, M5-I313)", () => {
  const request = () => F.ability("fixture.wo12.spell.stop");
  const key = "wo12.exec.goblin.effect.effect1.attack_roll";
  it("a bare success claim is not an input; neither is an unknown field on a roll", () => {
    const ek = executionKeyOf(request());
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: one, inputs: [{ requestKey: key, kind: "ATTACK_ROLL", executionKey: ek, success: true }] } }))).toContain(K.UNKNOWN_INPUT);
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: one, inputs: [{ ...attackInput(ek, key, 6), success: true }] } }))).toContain(K.UNKNOWN_INPUT);
  });

  it("inputs for another plan, another target, another Effect or another kind are refused", () => {
    const ek = executionKeyOf(request());
    const other = executionKeyOf(F.ability("fixture.wo12.spell.continue"));
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: one, inputs: [attackInput(other, key, 6)] } }))).toEqual([K.UNKNOWN_INPUT]);
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: one, inputs: [attackInput(ek, "wo12.exec.orc.effect.effect1.attack_roll", 6)] } }))).toEqual([K.UNKNOWN_INPUT]);
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: one, inputs: [attackInput(ek, "wo12.exec.goblin.effect.effect9.attack_roll", 6)] } }))).toEqual([K.UNKNOWN_INPUT]);
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: one, inputs: [{ ...saveInput(ek, key.replace("attack_roll", "saving_throw"), 6) }] } }))).toEqual([K.UNKNOWN_INPUT]);
  });

  it("a roll the Character Die cannot produce is refused; a Save choice outside the legal options is refused", () => {
    const ek = executionKeyOf(request());
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: one, inputs: [attackInput(ek, key, 7)] } }))).toContain(K.INVALID_INPUT);
    const choice = F.ability("fixture.wo12.spell.target_choice"), ck = executionKeyOf(choice);
    expect(codes(executeAbilityResolution({ ...choice, execution: { targets: one, inputs: [choiceInput(ck, "wo12.exec.goblin.effect.effect1.save_selection", "SAVE_SELECTION", "STR")] } }))).toEqual([K.INVALID_INPUT]);
  });

  it("the engine never chooses for a person: an unanswered Save choice stays PENDING_INPUT", () => {
    const r = runExecution(F.ability("fixture.wo12.spell.target_choice"), { targets: one, inputs: [] });
    expect([r.status, r.pendingInputs.map((q) => [q.kind, q.by]), r.outcomes]).toEqual(["PENDING_INPUT", [["SAVE_SELECTION", "DEFENDER"]], []]);
  });

  it("a valid input for a request this run never reaches is reported unused, not consumed", () => {
    const req = F.ability("fixture.wo12.spell.success_only"), ek = executionKeyOf(req);
    const r = runExecution(req, { targets: one, inputs: [attackInput(ek, "wo12.exec.goblin.effect.effect1.attack_roll", 1), saveInput(ek, "wo12.exec.goblin.effect.effect2.saving_throw", 1)] });
    expect([r.status, r.unusedInputs]).toEqual(["COMPLETE", ["wo12.exec.goblin.effect.effect2.saving_throw"]]);
  });

  it("targets beyond the exact Targeting limit, duplicate targets and missing Maneuver group targets are refused", () => {
    expect(codes(executeAbilityResolution({ ...request(), execution: { targets: [{ targetKey: "a" }, { targetKey: "b" }], inputs: [] } }))).toEqual([K.INVALID_TARGETS]);
    expect(codes(executeAbilityResolution({ ...F.ability("fixture.wo12.spell.multi"), execution: { targets: [{ targetKey: "a" }, { targetKey: "a" }], inputs: [] } }))).toContain(K.INVALID_TARGETS);
    expect(codes(executeAbilityResolution({ ...F.ability("fixture.wo11.maneuver.basic"), execution: { targets: one, inputs: [] } }))).toContain(K.INVALID_TARGETS);
    expect(codes(executeAbilityResolution({ ...F.ability("fixture.wo11.maneuver.basic"), execution: { targets: [{ targetKey: "a" }, { targetKey: "b" }], groupTargets: [{ groupKey: "attack1", targetKeys: ["a", "b"] }], inputs: [] } }))).toEqual([K.INVALID_TARGETS]);
  });
});

describe("fail-closed runtime rules and policy", () => {
  it("M5-SC-050: a CONSTRUCTION_CHOICE Save with several Saves has no authored runtime selection", () => {
    expect(compileAbilityExecution(F.ability("fixture.wo12.spell.construction_choice"))).toMatchObject({ ok: false, problems: [{ code: K.UNRESOLVED_RUNTIME_RULE }] });
  });

  it("M5-SC-049: a Trait TRIGGER modification has no exact chain semantics", () => {
    const trait = copy(F.bundle.definitions.find((d) => d.canonicalKey === "fixture.trait.spell")!.payload) as Record<string, unknown>;
    setPath(trait, "rules/trait/modifications", [{ kind: "TRIGGER", event: "ON_HIT" }]);
    setPath(trait, "rules/trait/parameters", []);
    const g = executionFixture({ revise: { "fixture.trait.spell": trait }, spells: { "fixture.wo12.spell.traited": { effects: [["effect1", "strike"]], chain: null, traits: [["fixture.trait.spell", "effect1"]] } } });
    const out = compileAbilityExecution(g.ability("fixture.wo12.spell.traited"));
    expect(out.ok ? [] : out.problems.map((q) => [q.code, q.message.slice(0, 10)])).toEqual([[K.UNRESOLVED_RUNTIME_RULE, "M5-SC-049:"]]);
  });

  it("a Ruleset without the execution policy is refused (routing defaults are never assumed)", () => {
    expect(codes(compileAbilityExecution(executionFixture({ policy: null }).ability("fixture.wo12.spell.stop")))).toEqual([K.MISSING_POLICY]);
  });

  it("an INVALID authored Ability is never executed", () => {
    const r = copy(F.ability("fixture.wo12.spell.stop"));
    (r.character as { skillRanks: { skillKey: string; rankKey: string }[] }).skillRanks = [];
    expect(codes(compileAbilityExecution(r))).toContain(K.INVALID_ABILITY);
  });
});

describe("Maneuver groups match the WO11 attachment structure (M5-I309–I310)", () => {
  it.each(["fixture.wo11.maneuver.basic", "fixture.wo11.maneuver.multi", "fixture.wo11.maneuver.powerful_blow", "fixture.wo11.maneuver.mixed", "fixture.wo11.maneuver.different", "fixture.wo11.maneuver.support"])("%s", (key) => {
    const exec = compileAbilityExecution(F.ability(key)), cost = compileManeuverCost({ ...F.ability(key), signatureManeuver: false });
    expect(exec.ok && cost.ok).toBe(true);
    if (!exec.ok || !cost.ok) return;
    expect(exec.value.groups!.map((g) => [g.groupKey, g.kind, g.actionKeys, g.effects.map((e) => e.effectKey)])).toEqual(cost.value.structure.resolutionGroups.map((g) => [g.groupKey, g.kind, g.actionKeys, g.effects]));
  });
});

describe("exact Ruleset history (M5-I315)", () => {
  const R2 = uuid(9301), M2 = uuid(9302);
  it("R1 Spell routes SUCCESS_ONLY; an R2 version routing CONTINUE never leaks into R1", () => {
    const revised = copy(F.rowPayload("fixture.wo12.spell.success_only")) as Record<string, unknown>;
    setPath(revised, "composition/branch/effectChain", { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "CONTINUE" }, { effectKey: "effect2", behavior: "STOP" }] });
    const g = executionFixture({ rulesetId: R2, manifestId: M2, revise: { "fixture.wo12.spell.success_only": revised } });
    const exec = (f: typeof F) => { const r = f.ability("fixture.wo12.spell.success_only"), ek = executionKeyOf(r); return runExecution(r, { targets: one, inputs: [attackInput(ek, "wo12.exec.goblin.effect.effect1.attack_roll", 1), saveInput(ek, "wo12.exec.goblin.effect.effect2.saving_throw", 1)] }); };
    const [r1, r2, again] = [exec(F), exec(g), exec(F)];
    expect([r1.targets![0]!.termination, r2.targets![0]!.termination]).toEqual(["SUCCESS_ONLY_FAILURE", "STOP"]);
    expect(again).toEqual(r1);
    expect(compileAbilityExecution({ ...F.ability("fixture.wo12.spell.success_only"), ruleset: g.ruleset }).ok).toBe(false);
    expect(compileAbilityExecution({ ...F.ability("fixture.wo12.spell.success_only"), definitions: g.bundle }).ok).toBe(false);
  });
});

describe("state-mutation boundary, safety, immutability, determinism (M5-I314–I315)", () => {
  it("outcomes are inert authored operations; no HP / Armor / position / Condition / resource state exists in the result", () => {
    const req = F.ability("fixture.wo12.spell.continue"), ek = executionKeyOf(req);
    const r = runExecution(req, { targets: one, inputs: [attackInput(ek, "wo12.exec.goblin.effect.effect1.attack_roll", 6)] });
    expect(r.outcomes.map((o) => o.operations.map((x) => x.kind))).toEqual([["DAMAGE"], ["HEAL"]]);
    expect(JSON.stringify({ ...r, coreEvaluations: null, triggerEvaluations: null })).not.toMatch(/currentHp|hpAfter|position|statusConditions|apRemaining|mpRemaining|"RESOURCE"/);
  });

  it.each([
    ["a getter", () => { const r = F.ability("fixture.wo12.spell.stop") as Record<string, unknown>; Object.defineProperty(r, "execution", { get: () => ({ targets: one, inputs: [] }), enumerable: true }); return r; }],
    ["a function", () => ({ ...F.ability("fixture.wo12.spell.stop"), execution: { targets: one, inputs: [() => true] } })],
    ["an unsafe __proto__ key", () => JSON.parse(JSON.stringify({ ...F.ability("fixture.wo12.spell.stop"), execution: { targets: one, inputs: [] } }).replace('"execution":{', '"execution":{"__proto__":{"polluted":1},')) as Record<string, unknown>],
  ])("%s is refused safely", (_l, build) => {
    expect(executeAbilityResolution(build()).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("inputs are never mutated; outputs are deep-frozen; equal requests give deep-equal JSON-safe traces", () => {
    const req = F.ability("fixture.wo12.spell.multi"), ek = executionKeyOf(req);
    const full = { ...req, execution: { targets: [{ targetKey: "a" }, { targetKey: "b" }], inputs: [attackInput(ek, "wo12.exec.a.effect.effect1.attack_roll", 5), attackInput(ek, "wo12.exec.b.effect.effect1.attack_roll", 1)] } };
    const before = JSON.stringify(full);
    const a = executeAbilityResolution(full), b = executeAbilityResolution(JSON.parse(before));
    expect(JSON.stringify(full)).toBe(before);
    expect(a.ok && b.ok && Object.isFrozen(a.value) && Object.isFrozen(a.value.outcomes)).toBe(true);
    expect(a).toEqual(b);
    expect(a.ok && JSON.parse(JSON.stringify(a.value))).toEqual(a.ok && a.value);
  });
});
