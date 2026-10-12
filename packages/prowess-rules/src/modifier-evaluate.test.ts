import { describe, expect, it } from "vitest";
import {
  createRulesetContext,
  evaluateModifiers,
  flattenTrace,
  MODIFIER_LIMITS,
  resolveKeywords,
  validateModifiers,
  type ModifierEvaluationResult,
  type ModifierTargetState,
  type ResolvedKeywordSet,
  type RuleEngineResponse,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO6 Modifier Engine. Guards M4-I65 (Modifiers Transform Explicit Targets Only), M4-I66 (Modifier Ordering Is
 * Explicit And Deterministic), M4-I67 (Modifier Phases Are Data), M4-I68 (Modifier Conditions Reuse Requirement Engine),
 * M4-I69 (False Conditions Skip Without Error), M4-I70 (Numeric Modifiers Never Round Implicitly), M4-I71 (Percentage
 * Modifiers Apply Sequentially), M4-I72 (Modifier Stacking Has No Hidden Winner), M4-I73 (Ordered Steps Use Explicit
 * Ladders), M4-I74 (Advantage / Disadvantage Are Signals, Not Roll Semantics), M4-I75 (Modifier Evaluation Has No Side
 * Effects), M4-I76 (Modifier Inputs / Outputs Are Immutable), M4-I77 (Modifier Provenance Is Preserved), M4-I78
 * (Modifier Evaluation Is Deterministic) and M4-I79 (Listed Cost And Runtime Payment Remain Distinct).
 *
 * Target / phase names are neutral test data; the engine attaches no meaning to them.
 */
type Mod = Record<string, unknown>;
const P = (phaseKey: string, phaseOrder: number) => ({ phaseKey, phaseOrder });
const m = (modifierKey: string, operation: string, operand: number | undefined, extra: Mod = {}): Mod => ({
  modifierKey,
  targetKey: "t.value",
  operation,
  ...(operand === undefined ? {} : { operand }),
  phase: P("p", 1),
  priority: 0,
  order: 0,
  ...extra,
});
const num = (value: number, targetKey = "t.value") => ({ targetKey, kind: "NUMERIC", value });
const ladder = (currentKey: string, boundaryPolicy = "CLAMP", targetKey = "t.value") => ({ targetKey, kind: "ORDERED", currentKey, steps: ["A", "B", "C", "D"], boundaryPolicy });
const signals = (targetKey = "t.value") => ({ targetKey, kind: "ROLL_SIGNAL" });

const ok = (r: RuleEngineResponse<ModifierEvaluationResult>) => {
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.data as ModifierEvaluationResult;
};
const final = (targets: unknown[], modifiers: Mod[], facts?: unknown): ModifierTargetState => ok(evaluateModifiers({ targets, modifiers, ...(facts === undefined ? {} : { facts }) })).finalTargets[0] as ModifierTargetState;
const value = (start: number, ...modifiers: Mod[]) => (final([num(start)], modifiers) as { value: number }).value;
const codes = (request: unknown) => evaluateModifiers(request).errors.map((e) => e.code);

describe("numeric operations (each independently)", () => {
  it.each([
    ["ADD", 10, 5, 15],
    ["SUBTRACT", 10, 15, -5],
    ["MULTIPLY", 10, -2.5, -25],
    ["DIVIDE", 10, 4, 2.5],
    ["SET", 10, 3, 3],
    ["MIN", 10, 7, 7],
    ["MIN", 5, 7, 5],
    ["MAX", 10, 7, 10],
    ["MAX", 5, 7, 7],
    ["INCREASE_PERCENT", 100, 25, 125],
    ["REDUCE_PERCENT", 100, 15, 85],
  ] as const)("%s: %s with %s → %s", (operation, start, operand, expected) => expect(value(start, m("x", operation, operand))).toBe(expected));

  it("handles zero, negatives, fractions and large finite values exactly", () => {
    expect(value(0, m("x", "ADD", 0))).toBe(0);
    expect(value(-3.5, m("x", "MULTIPLY", -2))).toBe(7);
    expect(value(0.1, m("x", "ADD", 0.2))).toBe(0.1 + 0.2);
    expect(value(1e300, m("x", "MULTIPLY", 1e8))).toBe(1e308);
  });

  it("MIN / MAX are literal Math.min / Math.max — not 'floor' or 'cap' reinterpretations", () => {
    expect(value(10, m("x", "MIN", 100))).toBe(10);
    expect(value(10, m("x", "MAX", -100))).toBe(10);
  });

  it("-0 normalizes to 0 in outcomes and final targets", () => {
    const r = ok(evaluateModifiers({ targets: [num(0)], modifiers: [m("x", "MULTIPLY", -1)] }));
    expect(Object.is((r.finalTargets[0] as { value: number }).value, 0)).toBe(true);
    expect(Object.is(r.outcomes[0]?.after, 0)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("-0");
  });

  it("division by zero and non-finite results fail closed — no Infinity / NaN escapes", () => {
    expect(codes({ targets: [num(10)], modifiers: [m("x", "DIVIDE", 0)] })).toEqual(["MODIFIER.DIVISION_BY_ZERO"]);
    expect(codes({ targets: [num(1e308)], modifiers: [m("x", "MULTIPLY", 10)] })).toEqual(["MODIFIER.NON_FINITE_RESULT"]);
    expect(codes({ targets: [num(1e308)], modifiers: [m("x", "INCREASE_PERCENT", 1e300)] })).toEqual(["MODIFIER.NON_FINITE_RESULT"]);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "5", null]) {
      expect(codes({ targets: [num(10)], modifiers: [m("x", "ADD", bad as number)] }), String(bad)).toEqual(["MODIFIER.INVALID_OPERAND"]);
    }
    expect(JSON.stringify(evaluateModifiers({ targets: [num(1e308)], modifiers: [m("x", "MULTIPLY", 10)] }))).not.toMatch(/Infinity|NaN/);
  });
});

describe("M4-I70 / M4-I71 no implicit rounding; percentages apply sequentially", () => {
  it("17 reduced by 10% is 15.3, not 15", () => expect(value(17, m("x", "REDUCE_PERCENT", 10))).toBeCloseTo(15.3, 12));
  it("0%, 100%, >100% and fractional percentages are plain math (no clamp at zero)", () => {
    expect(value(80, m("x", "REDUCE_PERCENT", 0))).toBe(80);
    expect(value(80, m("x", "REDUCE_PERCENT", 100))).toBe(0);
    expect(value(80, m("x", "REDUCE_PERCENT", 150))).toBe(-40);
    expect(value(80, m("x", "INCREASE_PERCENT", 12.5))).toBe(90);
    expect(codes({ targets: [num(1)], modifiers: [m("x", "REDUCE_PERCENT", -5)] })).toEqual(["MODIFIER.INVALID_OPERAND"]);
  });
  it("100 − 10% − 10% = 81 (each applied to the running value), never 80", () => {
    expect(value(100, m("a", "REDUCE_PERCENT", 10, { order: 1 }), m("b", "REDUCE_PERCENT", 10, { order: 2 }))).toBe(81);
    expect(value(100, m("a", "INCREASE_PERCENT", 10, { order: 1 }), m("b", "INCREASE_PERCENT", 10, { order: 2 }))).toBeCloseTo(121, 12);
  });
  it("multiple ADDs stack with an outcome each", () => {
    const r = ok(evaluateModifiers({ targets: [num(1)], modifiers: [m("a", "ADD", 2, { order: 1 }), m("b", "ADD", 3, { order: 2 })] }));
    expect(r.outcomes.map((o) => [o.modifierKey, o.before, o.after])).toEqual([["a", 1, 3], ["b", 3, 6]]);
  });
});

describe("M4-I66 / M4-I67 explicit ordering: phaseOrder, priority, order, modifierKey", () => {
  it("the documented generic pipeline: 100 → ADD 20 → −25% → MAX 50 = 90", () => {
    const r = ok(evaluateModifiers({
      targets: [num(100, "t.cost")],
      modifiers: [
        { ...m("max", "MAX", 50, { phase: P("p30", 30) }), targetKey: "t.cost" },
        { ...m("add", "ADD", 20, { phase: P("p10", 10) }), targetKey: "t.cost" },
        { ...m("reduce", "REDUCE_PERCENT", 25, { phase: P("p20", 20) }), targetKey: "t.cost" },
      ],
    }));
    expect(r.outcomes.map((o) => [o.modifierKey, o.before, o.after])).toEqual([["add", 100, 120], ["reduce", 120, 90], ["max", 90, 90]]);
  });

  it("operations do not commute: ADD 5 then MULTIPLY 2 = 30; MULTIPLY 2 then ADD 5 = 25", () => {
    expect(value(10, m("a", "ADD", 5, { phase: P("p1", 1) }), m("b", "MULTIPLY", 2, { phase: P("p2", 2) }))).toBe(30);
    expect(value(10, m("a", "ADD", 5, { phase: P("p2", 2) }), m("b", "MULTIPLY", 2, { phase: P("p1", 1) }))).toBe(25);
  });

  it("each sort level decides only when the levels before it tie", () => {
    const order = (mods: Mod[]) => ok(evaluateModifiers({ targets: [num(0)], modifiers: mods })).outcomes.map((o) => o.modifierKey);
    // phaseOrder beats priority beats order beats modifierKey
    expect(order([m("z", "ADD", 1, { phase: P("early", 1), priority: 9, order: 9 }), m("a", "ADD", 1, { phase: P("late", 2), priority: 0, order: 0 })])).toEqual(["z", "a"]);
    expect(order([m("z", "ADD", 1, { priority: 1, order: 9 }), m("a", "ADD", 1, { priority: 2, order: 0 })])).toEqual(["z", "a"]);
    expect(order([m("z", "ADD", 1, { order: 1 }), m("a", "ADD", 1, { order: 2 })])).toEqual(["z", "a"]);
    expect(order([m("b", "ADD", 1), m("B", "ADD", 1), m("a", "ADD", 1)])).toEqual(["B", "a", "b"]); // code-unit tie-breaker
    expect(order([m("x", "ADD", 1, { priority: -5 }), m("y", "ADD", 1, { priority: 5 })])).toEqual(["x", "y"]);
  });

  it("input array order never controls application", () => {
    const mods = [m("a", "SET", 7, { order: 3 }), m("b", "MULTIPLY", 3, { order: 1 }), m("c", "ADD", 2, { order: 2 }), m("d", "SUBTRACT", 1, { phase: P("q", 0) })];
    const forward = JSON.stringify(evaluateModifiers({ targets: [num(4)], modifiers: mods }));
    expect(JSON.stringify(evaluateModifiers({ targets: [num(4)], modifiers: [...mods].reverse() }))).toBe(forward);
    expect(JSON.stringify(evaluateModifiers({ targets: [num(4)], modifiers: [mods[2], mods[0], mods[3], mods[1]] }))).toBe(forward);
  });

  it("SET under STACK: the later SET (by the sort tuple) wins, by explicit order — not a conflict", () => {
    expect(value(1, m("a", "SET", 5, { order: 2 }), m("b", "SET", 9, { order: 1 }))).toBe(5);
  });

  it("one phaseKey with two phaseOrders is a PHASE_CONFLICT; phase names carry no behaviour", () => {
    expect(codes({ targets: [num(1)], modifiers: [m("a", "ADD", 1, { phase: P("base", 1) }), m("b", "ADD", 1, { phase: P("base", 2) })] })).toEqual(["MODIFIER.PHASE_CONFLICT"]);
    expect(value(1, m("a", "ADD", 1, { phase: P("FINAL", 1) }), m("b", "MULTIPLY", 10, { phase: P("BASE", 2) }))).toBe(20);
  });
});

describe("M4-I73 ordered steps over caller-supplied ladders", () => {
  const step = (current: string, policy: string, ...mods: Mod[]) => final([ladder(current, policy)], mods) as { currentKey: string; position: number };

  it("STEP_UP / STEP_DOWN, single and multiple, in explicit order", () => {
    expect(step("B", "CLAMP", m("a", "STEP_UP", 1)).currentKey).toBe("C");
    expect(step("C", "CLAMP", m("a", "STEP_DOWN", 2)).currentKey).toBe("A");
    expect(step("B", "CLAMP", m("a", "STEP_UP", 1, { order: 1 }), m("b", "STEP_DOWN", 2, { order: 2 }))).toEqual({ targetKey: "t.value", kind: "ORDERED", currentKey: "A", position: 0 });
  });

  it("CLAMP stays at the nearest end; INVALID fails closed", () => {
    expect(step("D", "CLAMP", m("a", "STEP_UP", 3)).currentKey).toBe("D");
    expect(step("A", "CLAMP", m("a", "STEP_DOWN", 1)).currentKey).toBe("A");
    expect(codes({ targets: [ladder("D", "INVALID")], modifiers: [m("a", "STEP_UP", 1)] })).toEqual(["MODIFIER.STEP_OUT_OF_RANGE"]);
    expect(codes({ targets: [ladder("A", "INVALID")], modifiers: [m("a", "STEP_DOWN", 1)] })).toEqual(["MODIFIER.STEP_OUT_OF_RANGE"]);
  });

  it("any ladder works — nothing is built in", () => {
    const t = { targetKey: "t.value", kind: "ORDERED", currentKey: "small", steps: ["tiny", "small", "large"], boundaryPolicy: "CLAMP" };
    expect((final([t], [m("a", "STEP_UP", 1)]) as { currentKey: string }).currentKey).toBe("large");
  });

  it("ladder and step validation", () => {
    for (const bad of [
      { ...ladder("Z") },
      { ...ladder("b") },
      { ...ladder("B"), steps: ["A", "B", "B"] },
      { ...ladder("B"), steps: [] },
      { ...ladder("B"), boundaryPolicy: "WRAP" },
      { targetKey: "t.value", kind: "ORDERED", currentKey: "B", steps: ["A", "B"] },
    ]) {
      expect(codes({ targets: [bad], modifiers: [] }), JSON.stringify(bad)).toEqual(["MODIFIER.INVALID_TARGET"]);
    }
    for (const operand of [0, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codes({ targets: [ladder("B")], modifiers: [m("a", "STEP_UP", operand)] }), String(operand)).toEqual(["MODIFIER.INVALID_OPERAND"]);
    }
  });
});

describe("M4-I74 Advantage / Disadvantage are signals only", () => {
  it("collected in application order, counted, never cancelled or resolved", () => {
    const f = final([signals()], [m("adv1", "ADVANTAGE", undefined, { order: 1 }), m("dis1", "DISADVANTAGE", undefined, { order: 2 }), m("adv2", "ADVANTAGE", undefined, { order: 3 })]);
    expect(f).toEqual({ targetKey: "t.value", kind: "ROLL_SIGNAL", advantage: ["adv1", "adv2"], disadvantage: ["dis1"] });
  });

  it("one of each; no dice, kept die or net result anywhere in the output", () => {
    const r = ok(evaluateModifiers({ targets: [signals()], modifiers: [m("a", "ADVANTAGE", undefined), m("d", "DISADVANTAGE", undefined)] }));
    expect(r.finalTargets[0]).toEqual({ targetKey: "t.value", kind: "ROLL_SIGNAL", advantage: ["a"], disadvantage: ["d"] });
    expect(JSON.stringify(r)).not.toMatch(/"(net|dice|kept|roll|cancel\w*)"/i);
    expect(r.outcomes.map((o) => o.after)).toEqual([{ advantage: 1, disadvantage: 0 }, { advantage: 1, disadvantage: 1 }]);
  });

  it("signals take no operand", () => {
    expect(codes({ targets: [signals()], modifiers: [m("a", "ADVANTAGE", 2)] })).toEqual(["MODIFIER.INVALID_OPERAND"]);
    expect(codes({ targets: [signals()], modifiers: [{ ...m("a", "ADVANTAGE", undefined), operand: null }] })).toEqual(["MODIFIER.INVALID_OPERAND"]);
  });
});

describe("M4-I65 explicit targets only; family mismatches fail closed", () => {
  it("a missing target is never created — not even by SET", () => {
    expect(codes({ targets: [], modifiers: [m("a", "SET", 1)] })).toEqual(["MODIFIER.INVALID_TARGET"]);
    expect(codes({ targets: [num(1, "t.other")], modifiers: [m("a", "ADD", 1)] })).toEqual(["MODIFIER.INVALID_TARGET"]);
  });

  it("target keys are exact: case, aliases and near-misses are different targets", () => {
    for (const key of ["T.value", "t.Value", "t.value2", "value"]) expect(codes({ targets: [num(1)], modifiers: [{ ...m("a", "ADD", 1), targetKey: key }] }), key).toEqual(["MODIFIER.INVALID_TARGET"]);
  });

  it("ADD on ORDERED, STEP_UP on NUMERIC, ADVANTAGE on NUMERIC are TARGET_TYPE_MISMATCH", () => {
    expect(codes({ targets: [ladder("B")], modifiers: [m("a", "ADD", 1)] })).toEqual(["MODIFIER.TARGET_TYPE_MISMATCH"]);
    expect(codes({ targets: [num(1)], modifiers: [m("a", "STEP_UP", 1)] })).toEqual(["MODIFIER.TARGET_TYPE_MISMATCH"]);
    expect(codes({ targets: [num(1)], modifiers: [m("a", "ADVANTAGE", undefined)] })).toEqual(["MODIFIER.TARGET_TYPE_MISMATCH"]);
  });

  it("modifiers on target A never affect target B", () => {
    const r = ok(evaluateModifiers({ targets: [num(1, "t.a"), num(100, "t.b")], modifiers: [{ ...m("x", "ADD", 5), targetKey: "t.a" }] }));
    expect(r.finalTargets).toEqual([{ targetKey: "t.a", kind: "NUMERIC", value: 6 }, { targetKey: "t.b", kind: "NUMERIC", value: 100 }]);
  });

  it("one invalid modifier makes the whole evaluation INVALID, reporting every problem across targets", () => {
    const r = evaluateModifiers({
      targets: [num(1e308, "t.a"), ladder("D", "INVALID", "t.b")],
      modifiers: [{ ...m("x", "MULTIPLY", 10), targetKey: "t.a" }, { ...m("y", "STEP_UP", 1), targetKey: "t.b" }],
    });
    expect([r.status, r.data]).toEqual(["INVALID", null]);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([["MODIFIER.NON_FINITE_RESULT", "/modifiers/0"], ["MODIFIER.STEP_OUT_OF_RANGE", "/modifiers/1"]]);
  });
});

describe("M4-I68 / M4-I69 conditions go through M4-WO5", () => {
  const cond = { kind: "NUMERIC_COMPARE", factKey: "actor.level", operator: ">=", expected: 5 };

  it("true → APPLIED; false → SKIPPED_CONDITION with no error, warning or info; invalid → INVALID", () => {
    const run = (level: number) => evaluateModifiers({ targets: [num(10)], modifiers: [m("bonus", "ADD", 5, { condition: cond })], facts: { numeric: [{ key: "actor.level", value: level }] } });
    const yes = run(7);
    expect([yes.status, (yes.data?.finalTargets[0] as { value: number }).value, yes.data?.outcomes[0]?.status, yes.data?.outcomes[0]?.condition]).toEqual(["SUCCESS", 15, "APPLIED", { satisfied: true }]);
    const no = run(3);
    expect([no.status, no.errors, no.warnings, no.info]).toEqual(["SUCCESS", [], [], []]);
    expect(no.data?.outcomes[0]).toMatchObject({ status: "SKIPPED_CONDITION", before: 10, after: 10, condition: { satisfied: false } });
    const bad = evaluateModifiers({ targets: [num(10)], modifiers: [m("bonus", "ADD", 5, { condition: cond })] });
    expect(bad.errors.map((e) => [e.code, e.path, (e.details as { requirementCode: string }).requirementCode])).toEqual([["MODIFIER.INVALID_CONDITION", "/modifiers/0/condition", "REQUIREMENT.MISSING_FACT"]]);
  });

  it("every condition is evaluated: all invalid conditions are reported, even after an earlier one", () => {
    const r = evaluateModifiers({
      targets: [num(1)],
      modifiers: [m("a", "ADD", 1, { order: 1, condition: { ...cond, factKey: "missing.one" } }), m("b", "ADD", 1, { order: 2, condition: cond }), m("c", "ADD", 1, { order: 3, condition: { ...cond, factKey: "missing.two" } })],
      facts: { numeric: [{ key: "actor.level", value: 9 }] },
    });
    expect(r.errors.map((e) => (e.details as { modifierKey: string }).modifierKey)).toEqual(["a", "c"]);
  });

  it("a malformed condition tree is an invalid modifier (WO5's own validation), with the Requirement code kept", () => {
    const r = evaluateModifiers({ targets: [num(1)], modifiers: [m("a", "ADD", 1, { condition: { kind: "ALL", children: [] } })] });
    expect(r.errors.map((e) => [e.code, (e.details as { requirementCode: string }).requirementCode, e.path])).toEqual([["MODIFIER.INVALID_CONDITION", "REQUIREMENT.INVALID_DEFINITION", "/modifiers/0/condition/children"]]);
  });

  it("Keyword conditions use the WO4 KeywordSet through WO5", () => {
    const fire = { keywordId: "60000000-0000-4000-8000-000000000001", canonicalKey: "keyword.fire", categoryId: null };
    const keywords = resolveKeywords([{ keyword: fire, source: { sourceType: "test.source", sourceKey: "s" } }]).data as ResolvedKeywordSet;
    const mods = [m("a", "INCREASE_PERCENT", 10, { condition: { kind: "KEYWORD_PRESENT", keywordId: fire.keywordId } })];
    expect((final([num(100)], mods, { keywords }) as { value: number }).value).toBeCloseTo(110, 12);
    expect((final([num(100)], mods, { keywords: resolveKeywords([]).data }) as { value: number }).value).toBe(100);
  });
});

describe("M4-I72 stacking without a hidden winner", () => {
  const unique = (key: string) => ({ stacking: { policy: "UNIQUE", stackingKey: key } });

  it("STACK applies all — even sharing a stackingKey-like label", () => {
    expect(value(0, m("a", "ADD", 1, { order: 1 }), m("b", "ADD", 2, { order: 2 }))).toBe(3);
    expect(value(0, m("a", "ADD", 1, { stacking: { policy: "STACK" } }), m("b", "ADD", 2, { stacking: { policy: "STACK" } }))).toBe(3);
  });

  it("UNIQUE identical duplicates: the first in order applies, the rest are DEDUPLICATED (provenance kept)", () => {
    const src = { source: { sourceType: "test.trait", sourceKey: "t1" } };
    const r = ok(evaluateModifiers({ targets: [num(10)], modifiers: [m("z", "ADD", 5, { ...unique("g"), ...src }), m("a", "ADD", 5, { ...unique("g"), ...src })] }));
    expect(r.outcomes.map((o) => [o.modifierKey, o.status, o.deduplicatedBy, o.source?.sourceKey])).toEqual([["a", "APPLIED", null, "t1"], ["z", "DEDUPLICATED", "a", "t1"]]);
    expect((r.finalTargets[0] as { value: number }).value).toBe(15);
  });

  it("UNIQUE different modifiers fail closed — never the higher, later, higher-priority or newer one", () => {
    for (const pair of [
      [m("a", "ADD", 5, unique("g")), m("b", "ADD", 6, unique("g"))],
      [m("a", "ADD", 5, unique("g")), m("b", "ADD", 5, { ...unique("g"), priority: 9 })],
      [m("a", "SET", 5, unique("g")), m("b", "SET", 6, unique("g"))],
      [m("a", "ADD", 5, unique("g")), m("b", "ADD", 5, { ...unique("g"), source: { sourceType: "test.source", sourceKey: "other" } })],
    ]) {
      expect(codes({ targets: [num(1)], modifiers: pair })).toEqual(["MODIFIER.STACKING_CONFLICT"]);
    }
  });

  it("UNIQUE only counts APPLICABLE modifiers: a skipped one does not conflict", () => {
    const cond = { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">", expected: 100 };
    expect((final([num(1)], [m("a", "ADD", 5, unique("g")), m("b", "ADD", 6, { ...unique("g"), condition: cond })], { numeric: [{ key: "f", value: 1 }] }) as { value: number }).value).toBe(6);
  });

  it("UNIQUE without a stackingKey, or an unknown policy, is invalid", () => {
    expect(codes({ targets: [num(1)], modifiers: [m("a", "ADD", 1, { stacking: { policy: "UNIQUE" } })] })).toEqual(["MODIFIER.INVALID_DEFINITION"]);
    expect(codes({ targets: [num(1)], modifiers: [m("a", "ADD", 1, { stacking: { policy: "HIGHEST_WINS" } })] })).toEqual(["MODIFIER.INVALID_DEFINITION"]);
  });
});

describe("definitions are strict data", () => {
  it.each([
    ["CUSTOM operation", { ...m("a", "ADD", 1), operation: "CUSTOM" }],
    ["game-specific operation", { ...m("a", "ADD", 1), operation: "AFFINITY_DISCOUNT" }],
    ["callback field", { ...m("a", "ADD", 1), apply: "v => v * 2" }],
    ["missing phase", { ...m("a", "ADD", 1), phase: undefined }],
    ["fractional priority", { ...m("a", "ADD", 1), priority: 1.5 }],
    ["string order", { ...m("a", "ADD", 1), order: "1" }],
    ["blank modifierKey", { ...m("a", "ADD", 1), modifierKey: " " }],
  ])("%s → INVALID_DEFINITION", (_label, modifier) => expect(codes({ targets: [num(1)], modifiers: [modifier] })).toEqual(["MODIFIER.INVALID_DEFINITION"]));

  it("functions and getters are rejected without being invoked", () => {
    let called = false;
    const sneaky = { ...m("a", "ADD", 1) };
    Object.defineProperty(sneaky, "operand", { enumerable: true, get: () => ((called = true), 1) });
    expect(codes({ targets: [num(1)], modifiers: [sneaky] })).toEqual(["MODIFIER.INVALID_DEFINITION"]);
    expect(codes({ targets: [num(1)], modifiers: [{ ...m("a", "ADD", 1), operand: () => 1 }] })).toEqual(["MODIFIER.INVALID_OPERAND"]); // a function is not a finite number
    expect(called).toBe(false);
  });

  it("duplicate modifierKey: identical collapses; conflicting is DUPLICATE_KEY (independent of order)", () => {
    expect(value(1, m("a", "ADD", 1), m("a", "ADD", 1))).toBe(2);
    expect(codes({ targets: [num(1)], modifiers: [m("a", "ADD", 1), m("a", "ADD", 2)] })).toEqual(["MODIFIER.DUPLICATE_KEY"]);
    expect(codes({ targets: [num(1)], modifiers: [m("a", "ADD", 2), m("a", "ADD", 1)] })).toEqual(["MODIFIER.DUPLICATE_KEY"]);
    expect(codes({ targets: [num(1), num(2)], modifiers: [] })).toEqual(["MODIFIER.DUPLICATE_KEY"]);
  });

  it("limits: targets, modifiers and ladder steps", () => {
    expect(codes({ targets: Array.from({ length: MODIFIER_LIMITS.MAX_TARGETS + 1 }, (_, i) => num(1, `t.k${i}`)), modifiers: [] })).toEqual(["MODIFIER.LIMIT_EXCEEDED"]);
    expect(codes({ targets: [num(1)], modifiers: Array.from({ length: MODIFIER_LIMITS.MAX_MODIFIERS + 1 }, (_, i) => m(`k${i}`, "ADD", 1)) })).toEqual(["MODIFIER.LIMIT_EXCEEDED"]);
    const steps = Array.from({ length: MODIFIER_LIMITS.MAX_STEPS_PER_TARGET + 1 }, (_, i) => `s${i}`);
    expect(codes({ targets: [{ targetKey: "t.value", kind: "ORDERED", currentKey: "s0", steps, boundaryPolicy: "CLAMP" }], modifiers: [] })).toEqual(["MODIFIER.LIMIT_EXCEEDED"]);
    expect(validateModifiers({ targets: [{ targetKey: "t.value", kind: "ORDERED", currentKey: "s0", steps: steps.slice(0, MODIFIER_LIMITS.MAX_STEPS_PER_TARGET), boundaryPolicy: "CLAMP" }], modifiers: [] }).ok).toBe(true);
  });
});

describe("M4-I77 provenance, outcomes and trace", () => {
  const provenance = { entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", rulesetId: null, manifestId: null };
  const condProv = { entityId: IDS.entityB, entityVersionId: null, canonicalKey: null, rulesetId: null, manifestId: null };

  it("every outcome says which modifier, where from, and why it applied or was skipped", () => {
    const r = ok(evaluateModifiers({
      targets: [num(100)],
      modifiers: [
        m("add", "ADD", 20, { order: 1, provenance, source: { sourceType: "test.trait", sourceKey: "t4", sourceId: "row-9" } }),
        m("skip", "MULTIPLY", 2, { order: 2, condition: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">", expected: 5, provenance: condProv } }),
      ],
      facts: { numeric: [{ key: "f", value: 1 }] },
    }));
    expect(r.outcomes[0]).toMatchObject({ modifierKey: "add", status: "APPLIED", before: 100, after: 120, provenance, source: { sourceType: "test.trait", sourceKey: "t4", sourceId: "row-9" }, condition: null });
    expect(r.outcomes[1]).toMatchObject({ modifierKey: "skip", status: "SKIPPED_CONDITION", before: 120, after: 120, provenance: null, condition: { satisfied: false } });
  });

  it("trace: target → phase → modifiers in exact application order; condition subtree keeps its own provenance", () => {
    const r = evaluateModifiers({
      targets: [num(100, "t.cost")],
      modifiers: [
        { ...m("reduce", "REDUCE_PERCENT", 25, { phase: P("discount", 20), provenance }), targetKey: "t.cost" },
        { ...m("add", "ADD", 20, { phase: P("base", 10), condition: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">=", expected: 0, provenance: condProv } }), targetKey: "t.cost" },
      ],
      facts: { numeric: [{ key: "f", value: 1 }] },
    });
    const flat = flattenTrace(r.trace);
    expect(flat.map((s) => [s.path, s.operation, s.output])).toEqual([
      ["1", "modifier.evaluate", null],
      ["1.1", "modifier.target", { type: "NUMBER", value: 90, unit: null }],
      ["1.1.1", "modifier.phase", null],
      ["1.1.1.1", "modifier.add", { type: "NUMBER", value: 120, unit: null }],
      ["1.1.1.1.1", "requirement.numeric_compare", { type: "BOOLEAN", value: true }],
      ["1.1.2", "modifier.phase", null],
      ["1.1.2.1", "modifier.reduce_percent", { type: "NUMBER", value: 90, unit: null }],
    ]);
    expect(flat[4]?.provenance).toEqual(condProv);
    expect(flat[6]?.provenance).toEqual(provenance);
    expect(flat[6]?.inputs.map((i) => i.name)).toEqual(["modifier_key", "status", "before", "operand"]);
  });

  it("an exact RulesetContext is recorded and never searched", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    expect(evaluateModifiers({ targets: [num(1)], modifiers: [] }, { ruleset: ctx.value }).ruleset?.rulesetId).toBe(IDS.ruleset);
  });
});

describe("M4-I75 / M4-I76 / M4-I78 read-only, immutable, deterministic", () => {
  const keywords = () => resolveKeywords([{ keyword: { keywordId: "60000000-0000-4000-8000-000000000001", canonicalKey: "keyword.fire", categoryId: null }, source: { sourceType: "test.source", sourceKey: "s" } }]).data as ResolvedKeywordSet;
  const request = () => ({
    targets: [num(100, "t.b"), ladder("B", "CLAMP", "t.a"), signals("t.c")],
    modifiers: [
      { ...m("x", "REDUCE_PERCENT", 10, { order: 2 }), targetKey: "t.b" },
      { ...m("y", "ADD", 5, { order: 1, condition: { kind: "KEYWORD_PRESENT", canonicalKey: "keyword.fire" } }), targetKey: "t.b" },
      { ...m("z", "STEP_UP", 1), targetKey: "t.a" },
      { ...m("w", "ADVANTAGE", undefined), targetKey: "t.c" },
    ],
    facts: { numeric: [{ key: "n", value: 1 }], keywords: keywords() },
  });

  it("same request → byte-identical response; targets, modifiers, conditions, facts and KeywordSet untouched (and frozen)", () => {
    const req = request();
    const r = assertDeterministic(() => evaluateModifiers(req), { inputs: [req], runs: 8 });
    expect(r.data?.finalTargets.map((t) => t.targetKey)).toEqual(["t.a", "t.b", "t.c"]);
  });

  it("shuffling targets, modifiers and fact entries changes nothing", () => {
    const a = request();
    const b = request();
    b.targets.reverse();
    b.modifiers.reverse();
    b.facts.numeric.reverse();
    expect(JSON.stringify(evaluateModifiers(b))).toBe(JSON.stringify(evaluateModifiers(a)));
  });

  it("results are deep-frozen, serializable and detached; the caller's facts object is not frozen or changed", () => {
    const req = request();
    const r = evaluateModifiers(req);
    expect(Object.isFrozen(r.data?.outcomes[0]) && Object.isFrozen(r.data?.finalTargets)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(Object.isFrozen(req.facts) || Object.isFrozen(req.modifiers)).toBe(false);
    const before = JSON.stringify(r);
    (req.targets[0] as unknown as { value: number }).value = -1;
    expect(JSON.stringify(r)).toBe(before);
  });

  it("M4-I79: a listed value stays the listed value — modifiers never pay, reserve or rewrite a payment", () => {
    // A listed-cost pipeline yields 17; nothing in the result represents payment from any resource.
    const r = ok(evaluateModifiers({ targets: [num(20, "t.listed")], modifiers: [{ ...m("x", "SUBTRACT", 3), targetKey: "t.listed" }] }));
    expect(r.finalTargets).toEqual([{ targetKey: "t.listed", kind: "NUMERIC", value: 17 }]);
    expect(JSON.stringify(r)).not.toMatch(/"(paid|payment|reserved|spent|remaining)"/i);
    expect(Object.keys(r).sort()).toEqual(["finalTargets", "initialTargets", "outcomes"]);
  });

  it("large-pipeline sanity: 5,000 modifiers over 50 targets and 10 phases, deterministic and correctly ordered", () => {
    const targets = Array.from({ length: 50 }, (_, i) => num(1000, `t.k${String(i).padStart(2, "0")}`));
    const modifiers = Array.from({ length: 5000 }, (_, i) => ({
      ...m(`mod${String(i).padStart(4, "0")}`, i % 3 === 0 ? "ADD" : i % 3 === 1 ? "SUBTRACT" : "MULTIPLY", i % 3 === 2 ? 1 : 2, { phase: P(`ph${i % 10}`, i % 10), order: i }),
      targetKey: `t.k${String(i % 50).padStart(2, "0")}`,
    }));
    const r = assertDeterministic(() => evaluateModifiers({ targets, modifiers }), { inputs: [targets, modifiers], runs: 2 });
    const outcomes = (r.data as ModifierEvaluationResult).outcomes;
    expect(outcomes).toHaveLength(5000);
    const tuples = outcomes.map((o) => [o.phase.phaseOrder, o.priority, o.order]);
    expect(tuples).toEqual([...tuples].sort((x, y) => (x[0] as number) - (y[0] as number) || (x[2] as number) - (y[2] as number)));
    expect(JSON.stringify(evaluateModifiers({ targets: [...targets].reverse(), modifiers: [...modifiers].reverse() }).data)).toBe(JSON.stringify(r.data));
  });
});
