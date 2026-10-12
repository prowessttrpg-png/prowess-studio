import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateFormula, orderFormulaDependencies, parseFormulaExpression, type FormulaDependencyNode } from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";

/**
 * M4-WO3 dependency ordering and the authored-text security regression set. Guards M4-I35 (Formula Dependency Cycles
 * Are Rejected) and M4-I27 (Authored Formula Text Is Never Executed).
 */
const order = (nodes: FormulaDependencyNode[]) => {
  const r = orderFormulaDependencies(nodes);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.order;
};
const n = (key: string, ...dependencies: string[]): FormulaDependencyNode => ({ key, dependencies });

describe("M4-I35 dependency ordering", () => {
  it("single node, simple chain, branching graph", () => {
    expect(order([n("a")])).toEqual(["a"]);
    expect(order([n("c", "b"), n("b", "a"), n("a")])).toEqual(["a", "b", "c"]);
    // The documented diagram: A → B, A → C, C → D.
    expect(order([n("A", "B", "C"), n("B"), n("C", "D"), n("D")])).toEqual(["B", "D", "C", "A"]);
  });

  it("multiple roots and ties resolve in lexical key order (UTF-16 code units: upper case before lower case)", () => {
    expect(order([n("z"), n("m"), n("a"), n("B")])).toEqual(["B", "a", "m", "z"]);
    expect(order([n("top", "x", "y"), n("y"), n("x")])).toEqual(["x", "y", "top"]);
  });

  it("the order never depends on input order, and repeated dependencies are harmless", () => {
    const nodes = [n("A", "B", "C"), n("B"), n("C", "D", "D"), n("D"), n("E", "A")];
    const expected = order(nodes);
    for (const permutation of [[...nodes].reverse(), [nodes[2], nodes[0], nodes[4], nodes[1], nodes[3]] as FormulaDependencyNode[]]) {
      expect(order(permutation)).toEqual(expected);
    }
    assertDeterministic(() => orderFormulaDependencies(nodes), { inputs: [nodes] });
  });

  it("an unknown dependency fails explicitly — it is never treated as an external variable", () => {
    const r = orderFormulaDependencies([n("a", "zeta", "b"), n("b", "ghost")]);
    expect(!r.ok && r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["FORMULA.UNKNOWN_DEPENDENCY", '"a" depends on "zeta", which is not in the graph'],
      ["FORMULA.UNKNOWN_DEPENDENCY", '"b" depends on "ghost", which is not in the graph'],
    ]);
  });

  it("a self-dependency is a cycle", () => {
    const r = orderFormulaDependencies([n("a", "a")]);
    expect(!r.ok && [r.diagnostics[0]?.code, r.cycle]).toEqual(["FORMULA.DEPENDENCY_CYCLE", ["a", "a"]]);
  });

  it("A → B → C → A is reported as that exact cycle, never broken arbitrarily", () => {
    const r = orderFormulaDependencies([n("A", "B"), n("B", "C"), n("C", "A"), n("D")]);
    expect(r.ok).toBe(false);
    expect(!r.ok && [r.diagnostics.map((d) => d.code), r.cycle]).toEqual([["FORMULA.DEPENDENCY_CYCLE"], ["A", "B", "C", "A"]]);
  });

  it("cycle reporting is deterministic regardless of input order", () => {
    const nodes = [n("x", "y"), n("y", "z"), n("z", "x"), n("w", "x")];
    const a = orderFormulaDependencies(nodes);
    const b = orderFormulaDependencies([...nodes].reverse());
    expect(b).toEqual(a);
    expect(!a.ok && a.cycle).toEqual(["x", "y", "z", "x"]);
  });

  it("malformed graphs: non-array, bad node shape, duplicate keys", () => {
    for (const bad of [null, {}, [{ key: "" , dependencies: [] }], [{ key: "a" }], [{ key: "a", dependencies: [1] }], [{ key: "a", dependencies: [], extra: 1 }]]) {
      const r = orderFormulaDependencies(bad);
      expect(!r.ok && r.diagnostics[0]?.code, JSON.stringify(bad)).toBe("FORMULA.INVALID_DEFINITION");
    }
    const dup = orderFormulaDependencies([n("a"), n("a")]);
    expect(!dup.ok && dup.diagnostics.map((d) => d.path)).toEqual(["/1/key"]);
  });

  it("a moderately large graph (2,000 nodes) orders correctly", () => {
    const chain = Array.from({ length: 2000 }, (_, i) => n(`k${String(i).padStart(4, "0")}`, ...(i === 0 ? [] : [`k${String(i - 1).padStart(4, "0")}`])));
    const result = order([...chain].reverse());
    expect(result).toHaveLength(2000);
    expect(result[0]).toBe("k0000");
    expect(result[1999]).toBe("k1999");
  });
});

describe("M4-I27 authored text is never executed (§100 security regression set)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["process.exit()", "FORMULA.UNKNOWN_FUNCTION"],
    ["require(\"fs\")", "FORMULA.UNKNOWN_TOKEN"],
    ["require(fs)", "FORMULA.UNKNOWN_FUNCTION"],
    ["import(x)", "FORMULA.UNKNOWN_FUNCTION"],
    ["eval(1)", "FORMULA.UNKNOWN_FUNCTION"],
    ["Function(1)", "FORMULA.UNKNOWN_FUNCTION"],
    ["fetch(url)", "FORMULA.UNKNOWN_FUNCTION"],
    ["Math.random()", "FORMULA.UNKNOWN_FUNCTION"],
    ["Math.floor(1)", "FORMULA.UNKNOWN_FUNCTION"],
    ["constructor", "FORMULA.INVALID_SYNTAX"],
    ["__proto__", "FORMULA.INVALID_SYNTAX"],
    ["a.constructor.constructor", "FORMULA.INVALID_SYNTAX"],
    ["x.__proto__.y", "FORMULA.INVALID_SYNTAX"],
    ["a[0]", "FORMULA.UNKNOWN_TOKEN"],
    ["a = 1", "FORMULA.UNKNOWN_TOKEN"],
    ["a ? 1 : 2", "FORMULA.UNKNOWN_TOKEN"],
    ["a > 1", "FORMULA.UNKNOWN_TOKEN"],
    ["a && b", "FORMULA.UNKNOWN_TOKEN"],
    ["2 ** 3", "FORMULA.INVALID_SYNTAX"],
    ["{ a: 1 }", "FORMULA.UNKNOWN_TOKEN"],
    ["() => 1", "FORMULA.UNKNOWN_TOKEN"],
    ["`${1}`", "FORMULA.UNKNOWN_TOKEN"],
    ["'1'", "FORMULA.UNKNOWN_TOKEN"],
    ["1; process.exit()", "FORMULA.UNKNOWN_TOKEN"],
  ])("%s is rejected structurally (%s)", (source, code) => {
    const r = parseFormulaExpression(source);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.diagnostics[0]?.code).toBe(code);
  });

  it("globalThis / this / window / document are only opaque variable keys: unbound they fail; bound they are just numbers", () => {
    for (const key of ["globalThis", "this", "window", "document", "process", "Math"]) {
      expect(evaluateFormula({ expression: key }, {}).errors.map((e) => e.code), key).toEqual(["FORMULA.MISSING_VARIABLE"]);
      expect(evaluateFormula({ expression: `${key} * 2` }, { [key]: 21 }).data?.finalValue, key).toBe(42);
    }
  });

  it("no evaluation path touches the clock, randomness, the network or global code execution", () => {
    const forbidden = (name: string) => () => {
      throw new Error(`${name} must not be called`);
    };
    vi.spyOn(Math, "random").mockImplementation(forbidden("Math.random"));
    vi.spyOn(Date, "now").mockImplementation(forbidden("Date.now"));
    vi.stubGlobal("fetch", forbidden("fetch"));
    vi.stubGlobal("eval", forbidden("eval"));
    vi.stubGlobal("Function", forbidden("Function"));
    const r = evaluateFormula({ expression: "max(1, floor(a / b)) + ceil(-c) - min(a, b)", rounding: "FLOOR", minimum: 0 }, { a: 17, b: 4, c: 1.5 });
    expect(r.success).toBe(true);
    expect(parseFormulaExpression("eval(globalThis)").ok).toBe(false);
  });

  it("a formula cannot reach a binding object's prototype or invoke its getters", () => {
    expect(evaluateFormula({ expression: "toString + 1" }, {}).errors.map((e) => e.code)).toEqual(["FORMULA.MISSING_VARIABLE"]);
    const polluted = JSON.parse('{"a": 1, "__proto__": {"b": 2}}') as Record<string, unknown>;
    expect(evaluateFormula({ expression: "b" }, polluted).success).toBe(false);
  });
});
