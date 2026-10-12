import { describe, expect, it } from "vitest";
import {
  createRulesetContext,
  evaluateFormula,
  flattenTrace,
  parseFormulaExpression,
  validateFormulaProgram,
  type FormulaProgram,
  type RuleEngineResponse,
  type FormulaResult,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO3 Formula evaluation. Guards M4-I28 (Variable Binding Is Exact), M4-I29 (Rounding Is Explicit), M4-I31
 * (Division By Zero Fails Closed), M4-I32 (Non-Finite Values Never Escape Evaluation), M4-I34 (Formula Evaluation Is
 * Deterministic), M4-I36 (Formula Provenance Is Preserved), M4-I37 (Formula Evaluation Is Read-Only), M4-I38 (Formula
 * Trace Ordering Is Deterministic) and M4-I39 (Units Have No Implicit Mechanics).
 *
 * Prowess-shaped numbers below are generic arithmetic examples only; the engine does not know what they mean.
 */
const value = (expression: string, bindings: Record<string, unknown> = {}, extra: Partial<FormulaProgram> = {}) => {
  const r = evaluateFormula({ expression, ...extra }, bindings);
  if (!r.success) throw new Error(`${expression}: ${JSON.stringify(r.errors)}`);
  return (r.data as FormulaResult).finalValue;
};
const codes = (r: RuleEngineResponse<FormulaResult>) => r.errors.map((e) => e.code);
const invalid = (expression: string, bindings: Record<string, unknown> = {}, extra: Partial<FormulaProgram> = {}) => {
  const r = evaluateFormula({ expression, ...extra }, bindings);
  expect([r.status, r.success, r.data]).toEqual(["INVALID", false, null]);
  return r;
};

describe("arithmetic semantics", () => {
  it.each([
    ["2 + 3", 5],
    ["2 - 7", -5],
    ["6 * 7", 42],
    ["5 / 2", 2.5],
    ["2 + 3 * 4", 14],
    ["20 / 5 * 2", 8],
    ["10 - 3 - 2", 5],
    ["(2 + 3) * 4", 20],
    ["--5", 5],
    ["-(2 + 3)", -5],
    ["+4", 4],
    ["floor(-1.2)", -2],
    ["ceil(-1.2)", -1],
    ["floor(1.9)", 1],
    ["ceil(1.1)", 2],
    ["min(3, -1, 2)", -1],
    ["max(3, -1, 2)", 3],
    ["max(1, floor(7 / 2))", 3],
    ["floor(17 / 4)", 4],
    ["1 + floor(10 / 2)", 6],
    ["15 * 4", 60],
  ])("%s = %s", (src, expected) => expect(value(src)).toBe(expected));

  it("division is real division, never implicit integer division", () => expect(value("7 / 2")).toBe(3.5));
  it("negative results are valid — there is no implicit minimum of zero", () => expect(value("1 - 10")).toBe(-9));
  it("floating-point results are never prettified (IEEE-754)", () => expect(value("0.1 + 0.2")).toBe(0.1 + 0.2));
});

describe("M4-I28 exact variable binding", () => {
  it("binds exact keys, including dotted and upper-case keys", () => {
    expect(value("floor(final_mp / prowess)", { final_mp: 17, prowess: 4 })).toBe(4);
    expect(value("actor.prowess * 2", { "actor.prowess": 3 })).toBe(6);
    expect(value("PRO + pro", { PRO: 10, pro: 1 })).toBe(11);
  });

  it("a missing variable fails closed — never 0, null, a default or a near match", () => {
    for (const bindings of [{}, { finalMp: 17 }, { FINAL_MP: 17 }, { final_mp_: 17 }, { "x.final_mp": 17 }]) {
      const r = invalid("final_mp", bindings);
      expect(codes(r)).toEqual(["FORMULA.MISSING_VARIABLE"]);
      expect(r.errors[0]).toMatchObject({ kind: "VALIDATION", category: "FORMULA", path: "/bindings/final_mp", details: { startOffset: 0, endOffset: 8 } });
    }
  });

  it("non-number bindings are rejected, never coerced", () => {
    for (const bad of ["4", true, null, [4], { v: 4 }, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined]) {
      expect(codes(invalid("x", { x: bad })), String(bad)).toEqual(["FORMULA.INVALID_VARIABLE_VALUE"]);
    }
  });

  it("bindings must be a plain object; getters are never invoked", () => {
    expect(codes(invalid("x", new Map([["x", 1]]) as never))).toEqual(["FORMULA.INVALID_VARIABLE_VALUE"]);
    let called = false;
    const sneaky = Object.defineProperty({}, "x", { enumerable: true, get: () => ((called = true), 1) });
    expect(codes(invalid("x", sneaky))).toEqual(["FORMULA.INVALID_VARIABLE_VALUE"]);
    expect(called).toBe(false);
  });

  it("inherited properties are never bindings: Object.prototype members are missing, non-plain objects are rejected", () => {
    for (const key of ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf"]) {
      expect(codes(invalid(key, {})), key).toEqual(["FORMULA.MISSING_VARIABLE"]);
    }
    expect(codes(invalid("x", Object.create({ x: 5 }) as Record<string, unknown>))).toEqual(["FORMULA.INVALID_VARIABLE_VALUE"]);
  });

  it("reports every binding problem in first-reference order before evaluating anything", () => {
    const r = invalid("b + a / c", { a: "1", c: 0 });
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([
      ["FORMULA.MISSING_VARIABLE", "/bindings/b"],
      ["FORMULA.INVALID_VARIABLE_VALUE", "/bindings/a"],
    ]);
  });

  it("extra bindings are accepted and ignored: they change no result, trace or variable list — even malformed ones", () => {
    const lean = evaluateFormula({ expression: "a * 2" }, { a: 3 });
    const extra = evaluateFormula({ expression: "a * 2" }, { z: Number.NaN, a: 3, other: "x", nested: { deep: 1 } });
    expect(extra).toEqual(lean);
    expect(lean.data?.variables).toEqual([{ key: "a", value: 3 }]);
  });

  it("binding insertion order never matters; variables are listed in expression order", () => {
    const a = evaluateFormula({ expression: "b - a" }, { a: 1, b: 5 });
    const b = evaluateFormula({ expression: "b - a" }, { b: 5, a: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.data?.variables.map((v) => v.key)).toEqual(["b", "a"]);
  });
});

describe("M4-I31 / M4-I32 fail-closed numerics", () => {
  it("division by zero fails closed with a span, including -0 and computed zeros", () => {
    for (const [src, bindings] of [["1 / 0", {}], ["1 / -0", {}], ["a / (b - b)", { a: 1, b: 2 }], ["0 / 0", {}]] as const) {
      const r = invalid(src, bindings);
      expect(codes(r), src).toEqual(["FORMULA.DIVISION_BY_ZERO"]);
      expect(r.errors[0]?.details).toMatchObject({ startOffset: expect.any(Number), endOffset: expect.any(Number) });
    }
  });

  it("a non-finite intermediate result stops evaluation", () => {
    expect(codes(invalid("big * big", { big: 1e308 }))).toEqual(["FORMULA.NON_FINITE_RESULT"]);
    expect(codes(invalid("big + big", { big: Number.MAX_VALUE }))).toEqual(["FORMULA.NON_FINITE_RESULT"]);
    expect(codes(invalid("small / tiny", { small: 1e308, tiny: 1e-308 }))).toEqual(["FORMULA.NON_FINITE_RESULT"]);
  });

  it("after a fatal failure no rounding or bounds are applied to a non-existent value", () => {
    const r = invalid("1 / 0", {}, { rounding: "FLOOR", minimum: 1, maximum: 5 });
    expect(r.trace.steps).toEqual([]);
    expect(codes(r)).toEqual(["FORMULA.DIVISION_BY_ZERO"]);
  });

  it("-0 never escapes: expression, rounding and final values are +0", () => {
    const r = evaluateFormula({ expression: "-0 * a", rounding: "CEIL" }, { a: 0.5 });
    const d = r.data as FormulaResult;
    for (const n of [d.expressionValue, d.rounding.value, d.finalValue]) expect(Object.is(n, 0)).toBe(true);
    expect(Object.is(evaluateFormula({ expression: "ceil(-0.5)" }, {}).data?.finalValue, 0)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("-0");
  });

  it("nothing non-finite ever appears anywhere in a response", () => {
    for (const src of ["1/0", "a*a", "ceil(-0.4)", "max(a, -a)"]) {
      const r = evaluateFormula({ expression: src }, { a: 1e300 });
      expect(JSON.stringify(r)).not.toMatch(/null,"warnings".*Infinity|NaN|Infinity/);
    }
  });
});

describe("M4-I29 explicit rounding and bounds: expression → rounding → minimum → maximum", () => {
  it("no rounding unless configured: NONE is the default and keeps fractions", () => {
    const r = evaluateFormula({ expression: "17 / 4" }, {});
    expect(r.data).toMatchObject({ expressionValue: 4.25, rounding: { mode: "NONE", value: 4.25 }, finalValue: 4.25 });
  });

  it("FLOOR and CEIL keep expressionValue distinct from finalValue", () => {
    expect(evaluateFormula({ expression: "17 / 4", rounding: "FLOOR" }, {}).data).toMatchObject({ expressionValue: 4.25, rounding: { mode: "FLOOR", value: 4 }, finalValue: 4 });
    expect(evaluateFormula({ expression: "17 / 4", rounding: "CEIL" }, {}).data).toMatchObject({ expressionValue: 4.25, rounding: { mode: "CEIL", value: 5 }, finalValue: 5 });
    expect(value("-1.2", {}, { rounding: "FLOOR" })).toBe(-2);
    expect(value("-1.2", {}, { rounding: "CEIL" })).toBe(-1);
  });

  it("bounds apply AFTER rounding: 0.8 → FLOOR → minimum 1 = 1 (not 0.8, not 0)", () => {
    const r = evaluateFormula({ expression: "0.8", rounding: "FLOOR", minimum: 1 }, {});
    expect(r.data).toMatchObject({ expressionValue: 0.8, rounding: { value: 0 }, minimum: { bound: 1, applied: true }, maximum: null, finalValue: 1 });
  });

  it("minimum then maximum, each reported with whether it changed the value", () => {
    expect(evaluateFormula({ expression: "12.7", rounding: "CEIL", minimum: 1, maximum: 10 }, {}).data).toMatchObject({
      rounding: { value: 13 },
      minimum: { bound: 1, applied: false },
      maximum: { bound: 10, applied: true },
      finalValue: 10,
    });
    expect(value("3", {}, { minimum: 3, maximum: 3 })).toBe(3);
    expect(value("-50", {}, { minimum: -10 })).toBe(-10);
  });

  it("the bound is not the min() function: both may coexist in one Formula", () => {
    expect(value("min(a, 5)", { a: 0 }, { minimum: 2 })).toBe(2);
  });

  it("invalid configuration fails before evaluation, never silently fixed", () => {
    expect(codes(invalid("1", {}, { minimum: 5, maximum: 2 }))).toEqual(["FORMULA.INVALID_BOUNDS"]);
    expect(codes(invalid("1", {}, { minimum: Number.NaN }))).toEqual(["FORMULA.INVALID_BOUNDS"]);
    expect(codes(invalid("1", {}, { maximum: Number.POSITIVE_INFINITY }))).toEqual(["FORMULA.INVALID_BOUNDS"]);
    for (const mode of ["NEAREST", "ROUND", "floor", "TRUNC"]) expect(codes(invalid("1", {}, { rounding: mode as never })), mode).toEqual(["FORMULA.INVALID_DEFINITION"]);
  });
});

describe("program validation (local to Formula correctness)", () => {
  it("accepts a valid program and returns its AST and variables", () => {
    const v = validateFormulaProgram({ expression: "floor(a / b)", rounding: "FLOOR", minimum: 0, unit: "AP" });
    expect(v.ok && { vars: v.program.variables, rounding: v.program.rounding, unit: v.program.unit }).toEqual({ vars: ["a", "b"], rounding: "FLOOR", unit: "AP" });
  });

  it("reports every problem in fixed order: fields, expression, rounding, bounds, unit, provenance", () => {
    const v = validateFormulaProgram({ expression: "1 +", rounding: "SOMETIMES", minimum: 3, maximum: 1, unit: "two words", provenance: { entityId: "nope" }, extra: 1 });
    expect(!v.ok && v.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["FORMULA.INVALID_DEFINITION", "/extra"],
      ["FORMULA.INVALID_SYNTAX", "/expression"],
      ["FORMULA.INVALID_DEFINITION", "/rounding"],
      ["FORMULA.INVALID_BOUNDS", "/minimum"],
      ["FORMULA.INVALID_DEFINITION", "/unit"],
      ["FORMULA.INVALID_DEFINITION", "/provenance"],
    ]);
  });

  it("requires exactly one of expression or ast", () => {
    expect(validateFormulaProgram({}).ok).toBe(false);
    const parsed = parseFormulaExpression("1");
    expect(validateFormulaProgram({ expression: "1", ast: parsed.ok ? parsed.ast : null }).ok).toBe(false);
    expect(validateFormulaProgram(null).ok).toBe(false);
  });

  it("evaluates a pre-parsed AST without reparsing, identically to the source path", () => {
    const parsed = parseFormulaExpression("max(1, floor(a / b))");
    if (!parsed.ok) throw new Error("parse");
    expect(evaluateFormula({ ast: parsed.ast }, { a: 9, b: 2 }).data).toEqual(evaluateFormula({ expression: "max(1, floor(a / b))" }, { a: 9, b: 2 }).data);
  });

  it("a supplied AST is re-validated, never trusted", () => {
    const hostile: unknown[] = [
      { type: "CALL", name: "eval", arguments: [], startOffset: 0, endOffset: 1 },
      { type: "CALL", name: "floor", arguments: [], startOffset: 0, endOffset: 1 },
      { type: "VARIABLE", key: "__proto__", startOffset: 0, endOffset: 1 },
      { type: "NUMBER", value: Number.POSITIVE_INFINITY, startOffset: 0, endOffset: 1 },
      { type: "BINARY", operator: "**", left: { type: "NUMBER", value: 1, startOffset: 0, endOffset: 1 }, right: { type: "NUMBER", value: 1, startOffset: 0, endOffset: 1 }, startOffset: 0, endOffset: 1 },
      { type: "CODE", source: "process.exit()", startOffset: 0, endOffset: 1 },
      { type: "NUMBER", value: 1, startOffset: 0, endOffset: 1, extra: "x" },
    ];
    for (const ast of hostile) expect(validateFormulaProgram({ ast }).ok, JSON.stringify(ast)).toBe(false);
    let deep: unknown = { type: "NUMBER", value: 1, startOffset: 0, endOffset: 1 };
    for (let i = 0; i < 600; i += 1) deep = { type: "UNARY", operator: "-", operand: deep, startOffset: 0, endOffset: 1 };
    const v = validateFormulaProgram({ ast: deep });
    expect(!v.ok && v.diagnostics[0]?.code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
    const cyclic: Record<string, unknown> = { type: "UNARY", operator: "-", startOffset: 0, endOffset: 1 };
    cyclic.operand = cyclic;
    expect(validateFormulaProgram({ ast: cyclic }).ok).toBe(false);
  });

  it("malformed programs and authored text are VALIDATION failures, never engine errors", () => {
    for (const program of [{ expression: "1 +" }, { expression: "eval(1)" }, { expression: 7 }, null, "1 + 1"]) {
      const r = evaluateFormula(program, {});
      expect(r.status).toBe("INVALID");
      expect(r.errors.every((e) => e.kind === "VALIDATION" && e.category === "FORMULA" && e.code.startsWith("FORMULA."))).toBe(true);
    }
  });
});

describe("M4-I39 units are opaque labels with no mechanics", () => {
  it("carries the label through unchanged and never alters the number", () => {
    const withUnit = evaluateFormula({ expression: "a + b", unit: "AP" }, { a: 2, b: 3 });
    const without = evaluateFormula({ expression: "a + b" }, { a: 2, b: 3 });
    expect(withUnit.data?.unit).toBe("AP");
    expect(withUnit.data?.finalValue).toBe(without.data?.finalValue);
    expect(withUnit.trace.steps[0]?.inputs).toEqual([{ name: "unit", value: { type: "STRING", value: "AP" } }]);
  });
  it("performs no conversion or compatibility check between labels", () => {
    for (const unit of ["feet", "meters", "HP", "MP", "unit.example", "x-1"]) expect(value("3 * 2", {}, { unit })).toBe(6);
  });
  it("rejects a malformed label as configuration, not as arithmetic", () => {
    for (const unit of ["", "two words", "7up", "x".repeat(65), 5]) expect(codes(invalid("1", {}, { unit: unit as never }))).toEqual(["FORMULA.INVALID_DEFINITION"]);
  });
});

describe("M4-I38 Formula-local trace mirrors the AST, in authored order", () => {
  it("floor(total / divisor) with 17 and 4", () => {
    const r = evaluateFormula({ expression: "floor(total / divisor)" }, { total: 17, divisor: 4 });
    const flat = flattenTrace(r.trace).map((s) => [s.path, s.key, s.operation, s.output && "value" in s.output ? s.output.value : null]);
    expect(flat).toEqual([
      ["1", "formula", "formula.evaluate", 4],
      ["1.1", "expression", "formula.floor", 4],
      ["1.1.1", "arg.0", "formula.divide", 4.25],
      ["1.1.1.1", "left", "formula.variable", 17],
      ["1.1.1.2", "right", "formula.variable", 4],
    ]);
    expect(flattenTrace(r.trace)[3]?.inputs).toEqual([{ name: "key", value: { type: "STRING", value: "total" } }]);
  });

  it("rounding, minimum and maximum steps follow the expression, in that order", () => {
    const r = evaluateFormula({ expression: "0.8", rounding: "FLOOR", minimum: 1, maximum: 10 }, {});
    expect(r.trace.steps[0]?.children.map((s) => [s.key, s.operation])).toEqual([
      ["expression", "formula.number"],
      ["rounding", "formula.round.floor"],
      ["minimum", "formula.minimum"],
      ["maximum", "formula.maximum"],
    ]);
  });

  it("min / max arguments keep their authored order in the trace (never re-sorted)", () => {
    const r = evaluateFormula({ expression: "min(c, a, b)" }, { a: 2, b: 3, c: 1 });
    const args = r.trace.steps[0]?.children[0]?.children ?? [];
    expect(args.map((s) => [s.key, s.inputs[0]?.value])).toEqual([
      ["arg.0", { type: "STRING", value: "c" }],
      ["arg.1", { type: "STRING", value: "a" }],
      ["arg.2", { type: "STRING", value: "b" }],
    ]);
  });

  it("is machine-readable data — no prose explanations, no markup", () => {
    const r = evaluateFormula({ expression: "a / 2" }, { a: 3 });
    expect(flattenTrace(r.trace).every((s) => s.explanation === null)).toBe(true);
  });
});

describe("M4-I36 provenance is preserved", () => {
  const provenance = { entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", rulesetId: IDS.ruleset, manifestId: IDS.manifest };

  it("attaches the Formula's provenance once, at the root trace step", () => {
    const r = evaluateFormula({ expression: "a + 1", provenance }, { a: 1 });
    const flat = flattenTrace(r.trace);
    expect(flat[0]?.provenance).toEqual(provenance);
    expect(flat.slice(1).every((s) => s.provenance === null)).toBe(true);
  });

  it("carries it on Formula failure messages, and records the exact RulesetContext without searching it", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    const r = evaluateFormula({ expression: "a / 0", provenance }, { a: 1 }, { ruleset: ctx.value });
    expect(r.errors[0]?.kind === "VALIDATION" && r.errors[0].provenance).toEqual(provenance);
    expect(r.ruleset).toMatchObject({ rulesetId: IDS.ruleset, manifestId: IDS.manifest });
    expect(evaluateFormula({ expression: "1" }, {}).ruleset).toBeNull();
  });
});

describe("M4-I34 / M4-I37 deterministic and read-only", () => {
  it("same Formula + bindings + RulesetContext → byte-identical result, messages and trace; inputs untouched (and frozen)", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    const program = { expression: "max(1, floor(total / divisor)) + -bonus", rounding: "CEIL" as const, minimum: 0, unit: "AP", provenance: { entityId: IDS.entityA, entityVersionId: null, canonicalKey: null, rulesetId: null, manifestId: null } };
    const bindings = { total: 17, divisor: 4, bonus: 0.5, unused: 9 };
    const r = assertDeterministic(() => evaluateFormula(program, bindings, { ruleset: ctx.value }), { inputs: [program, bindings, ctx.value], runs: 10 });
    expect(r.data?.finalValue).toBe(4);
    const failing = { expression: "a / b" };
    assertDeterministic(() => evaluateFormula(failing, { a: 1, b: 0 }), { inputs: [failing], runs: 10 });
  });

  it("a parsed AST used as input is not mutated, and results are immutable", () => {
    const parsed = parseFormulaExpression("a * 2");
    if (!parsed.ok) throw new Error("parse");
    const before = JSON.stringify(parsed.ast);
    const r = evaluateFormula({ ast: parsed.ast }, { a: 4 });
    expect(JSON.stringify(parsed.ast)).toBe(before);
    expect(Object.isFrozen(r) && Object.isFrozen(r.data) && Object.isFrozen(r.data?.variables)).toBe(true);
    expect(() => {
      (r.data as { finalValue: number }).finalValue = 99;
    }).toThrow(TypeError);
  });

  it("is JSON-serializable end to end", () => {
    const r = evaluateFormula({ expression: "floor(a / 3)", rounding: "NONE", maximum: 100 }, { a: 10 });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe("performance sanity (no SLA)", () => {
  it("1,000 ordinary evaluations and a near-limit expression complete", () => {
    for (let i = 0; i < 1000; i += 1) expect(evaluateFormula({ expression: "1 + floor(strength / power)" }, { strength: i, power: 3 }).success).toBe(true);
    const wide = `max(${Array.from({ length: 400 }, (_, i) => `v${i % 10} * ${i}`).join(", ")})`; // 1,604 tokens, 1,201 nodes
    const bindings = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`v${i}`, i]));
    const r = evaluateFormula({ expression: wide }, bindings);
    expect(r.success).toBe(true);
    expect(r.trace.stepCount).toBe(1202); // root + one step per AST node
  });
});
