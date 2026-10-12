import { describe, expect, it } from "vitest";
import { FORMULA_LIMITS, isValidFormulaIdentifier, parseFormulaExpression, type FormulaNode, type FormulaParseResult } from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";

/**
 * M4-WO3 Formula parser. Guards M4-I26 (Restricted Formula Grammar), M4-I30 (Formula Precedence Is Deterministic) and
 * M4-I33 (Formula AST Is Serializable And Immutable).
 */
const ok = (source: string): FormulaNode => {
  const r = parseFormulaExpression(source);
  if (!r.ok) throw new Error(`${source}: ${JSON.stringify(r.diagnostics)}`);
  return r.ast;
};
const fail = (source: string) => {
  const r = parseFormulaExpression(source);
  if (r.ok) throw new Error(`expected failure: ${source}`);
  return r.diagnostics[0] as NonNullable<Extract<FormulaParseResult, { ok: false }>["diagnostics"][number]>;
};
/** A compact, span-free rendering of a tree, for precedence assertions. */
const shape = (n: FormulaNode): string => {
  switch (n.type) {
    case "NUMBER":
      return String(n.value);
    case "VARIABLE":
      return n.key;
    case "UNARY":
      return `(${n.operator}${shape(n.operand)})`;
    case "BINARY":
      return `(${shape(n.left)} ${n.operator} ${shape(n.right)})`;
    default:
      return `${n.name}(${n.arguments.map(shape).join(", ")})`;
  }
};

describe("M4-I26 number literals", () => {
  it.each([["0", 0], ["1", 1], ["15", 15], ["2.5", 2.5], ["0.25", 0.25], ["007", 7]])("accepts %s", (src, value) => {
    expect(ok(src)).toEqual({ type: "NUMBER", value, startOffset: 0, endOffset: src.length });
  });
  it.each(["NaN", "Infinity"])("treats %s as an opaque identifier, never a number", (src) => expect(ok(src)).toMatchObject({ type: "VARIABLE", key: src }));
  it.each(["0x10", "0b11", "1e5", "1E-3", "1_000", "1.", ".5", "1.5.2", "2a"])("rejects %s", (src) => {
    expect(["FORMULA.INVALID_SYNTAX", "FORMULA.UNKNOWN_TOKEN"]).toContain(fail(src).code);
  });
  it("rejects a literal too large to be finite", () => expect(fail("9".repeat(400)).code).toBe("FORMULA.INVALID_SYNTAX"));
  it("negative numbers are unary minus, not a special token", () => {
    expect(ok("-5")).toEqual({ type: "UNARY", operator: "-", operand: { type: "NUMBER", value: 5, startOffset: 1, endOffset: 2 }, startOffset: 0, endOffset: 2 });
  });
});

describe("M4-I26 identifiers are exact, case-sensitive, opaque keys", () => {
  it.each(["power", "final_mp", "actor.prowess", "weapon.power", "PRO", "_x", "a1.b2.c3", "a.1"])("accepts %s", (key) => {
    expect(isValidFormulaIdentifier(key)).toBe(true);
    expect(ok(key)).toMatchObject({ type: "VARIABLE", key });
  });
  it("PRO, pro and Prowess are three different keys", () => {
    const r = parseFormulaExpression("PRO + pro + Prowess");
    expect(r.ok && r.variables).toEqual(["PRO", "pro", "Prowess"]);
  });
  it.each(["a..b", "a.", "a.__proto__", "constructor", "x.prototype.y", "__proto__"])("rejects %s", (key) => {
    expect(isValidFormulaIdentifier(key)).toBe(false);
    expect(fail(key).code).toBe("FORMULA.INVALID_SYNTAX");
  });
  it("a dotted key is ONE opaque variable — never property access", () => {
    expect(ok("actor.prowess")).toEqual({ type: "VARIABLE", key: "actor.prowess", startOffset: 0, endOffset: 13 });
  });
  it("reports variables once each, in first-reference order", () => {
    const r = parseFormulaExpression("b + a * b - floor(c / a)");
    expect(r.ok && r.variables).toEqual(["b", "a", "c"]);
  });
});

describe("M4-I30 precedence and associativity", () => {
  it.each([
    ["2 + 3 * 4", "(2 + (3 * 4))"],
    ["20 / 5 * 2", "((20 / 5) * 2)"],
    ["10 - 3 - 2", "((10 - 3) - 2)"],
    ["(2 + 3) * 4", "((2 + 3) * 4)"],
    ["-a * b", "((-a) * b)"],
    ["a - -b", "(a - (-b))"],
    ["--5", "(-(-5))"],
    ["-(2 + 3)", "(-(2 + 3))"],
    ["+4", "(+4)"],
    ["1 + floor(a / b)", "(1 + floor((a / b)))"],
    ["max(1, floor(a / b))", "max(1, floor((a / b)))"],
    ["min(c, b, a)", "min(c, b, a)"],
  ])("%s parses as %s", (src, expected) => expect(shape(ok(src))).toBe(expected));
});

describe("whitespace is insignificant and locale-free", () => {
  it("a+b, a + b and a / newline / + / newline / b are the same tree apart from spans", () => {
    const strip = (n: FormulaNode) => shape(n);
    expect(strip(ok("a+b"))).toBe(strip(ok("a + b")));
    expect(strip(ok("a\n+\r\n\tb"))).toBe(strip(ok("a + b")));
  });
  it("non-ASCII whitespace and Unicode operators are unknown tokens — never guessed", () => {
    for (const src of ["2\u00a0+ 3", "2 × 3", "6 ÷ 2", "5 − 2", "a ^ 2", "a % 2"]) expect(fail(src).code, src).toBe("FORMULA.UNKNOWN_TOKEN");
  });
});

describe("functions", () => {
  it("floor(final_mp / prowess) has the expected structure", () => {
    expect(ok("floor(final_mp / prowess)")).toEqual({
      type: "CALL",
      name: "floor",
      arguments: [
        {
          type: "BINARY",
          operator: "/",
          left: { type: "VARIABLE", key: "final_mp", startOffset: 6, endOffset: 14 },
          right: { type: "VARIABLE", key: "prowess", startOffset: 17, endOffset: 24 },
          startOffset: 6,
          endOffset: 24,
        },
      ],
      startOffset: 0,
      endOffset: 25,
    });
  });
  it("whitespace may separate a function name from its parenthesis", () => expect(shape(ok("floor (2.5)"))).toBe("floor(2.5)"));
  it.each(["sqrt(9)", "random()", "Floor(1)", "FLOOR(1)", "Math.floor(1)", "abs(-1)", "round(1)"])("%s is an unknown function", (src) => {
    expect(fail(src).code).toBe("FORMULA.UNKNOWN_FUNCTION");
  });
  it.each(["floor()", "floor(1, 2)", "ceil()", "ceil(1, 2)", "min()", "min(1)", "max(1)"])("%s has invalid arity", (src) => {
    expect(fail(src).code).toBe("FORMULA.INVALID_ARITY");
  });
  it.each(["min(1, 2)", "max(1, 2, 3, 4)", "floor(1)", "ceil(1)"])("%s has valid arity", (src) => expect(parseFormulaExpression(src).ok).toBe(true));
});

describe("invalid syntax, with precise spans", () => {
  it.each([
    ["1 + 2 garbage", 6, 13],
    ["1 +", 3, 3],
    ["(1 + 2", 6, 6],
    ["1 + 2)", 5, 6],
    ["* 2", 0, 1],
    ["1 2", 2, 3],
    ["floor(1,)", 8, 9],
    ["", 0, 0],
    ["a b", 2, 3],
  ])("%s fails at [%i, %i)", (src, start, end) => {
    const d = fail(src);
    expect(d.code).toBe("FORMULA.INVALID_SYNTAX");
    expect([d.startOffset, d.endOffset, d.path]).toEqual([start, end, "/expression"]);
  });
  it("never throws for ordinary invalid input", () => {
    for (const src of ["", ")", "((", ",,", "1 + * 2", "floor(", "max(1,", 42 as unknown as string, null as unknown as string]) {
      expect(() => parseFormulaExpression(src)).not.toThrow();
      expect(parseFormulaExpression(src).ok).toBe(false);
    }
  });
});

describe("complexity limits", () => {
  it("source length", () => {
    expect(fail("1".padEnd(FORMULA_LIMITS.MAX_SOURCE_LENGTH + 1, " ")).code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
    expect(parseFormulaExpression("1".padEnd(FORMULA_LIMITS.MAX_SOURCE_LENGTH, " ")).ok).toBe(true);
  });
  it("token count: a wide, shallow call isolates the token limit (exactly 2,048 parses; 2,050 fails)", () => {
    const call = (n: number) => `min(${Array.from({ length: n }, () => "1").join(",")})`; // 2n + 2 tokens, depth 2
    expect(parseFormulaExpression(call(1023)).ok).toBe(true); // 2,048 tokens
    expect(fail(call(1024)).code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED"); // 2,050 tokens
  });
  it("nesting depth: exactly at the limit parses; one deeper fails; thousands fail cleanly (no stack overflow)", () => {
    const nested = (n: number) => `${"(".repeat(n)}1${")".repeat(n)}`;
    expect(parseFormulaExpression(nested(FORMULA_LIMITS.MAX_NESTING_DEPTH)).ok).toBe(true);
    expect(fail(nested(FORMULA_LIMITS.MAX_NESTING_DEPTH + 1)).code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
    expect(fail(nested(4000)).code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
    expect(fail("-".repeat(4000) + "1").code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
    expect(fail("floor(".repeat(1000) + "1" + ")".repeat(1000)).code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
  });
  it("tree depth bounds long left-associative chains", () => {
    const chain = (n: number) => Array.from({ length: n }, () => "a").join("-");
    expect(parseFormulaExpression(chain(FORMULA_LIMITS.MAX_AST_DEPTH)).ok).toBe(true);
    expect(fail(chain(FORMULA_LIMITS.MAX_AST_DEPTH + 1)).code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
  });
  it("node count", () => {
    const sum = Array.from({ length: 700 }, () => "-1").join("+"); // 700 × (UNARY + NUMBER) + 699 BINARY = 2,099 nodes
    expect(fail(sum).code).toBe("FORMULA.EXPRESSION_LIMIT_EXCEEDED");
  });
});

describe("M4-I33 the AST is plain, serializable, immutable and reproducible", () => {
  it("is plain JSON that round-trips exactly", () => {
    const ast = ok("max(1, floor(a / -b)) + 2.5 * c");
    expect(JSON.parse(JSON.stringify(ast))).toEqual(ast);
  });
  it("is deep-frozen: mutation attempts throw and change nothing", () => {
    const r = parseFormulaExpression("floor(a / b)");
    if (!r.ok) throw new Error("parse");
    const before = JSON.stringify(r);
    expect(Object.isFrozen(r) && Object.isFrozen(r.ast) && Object.isFrozen(r.variables)).toBe(true);
    expect(() => {
      (r.ast as { name: string }).name = "eval";
    }).toThrow(TypeError);
    expect(JSON.stringify(r)).toBe(before);
  });
  it("parsing the same source repeatedly yields deep-equal results", () => {
    assertDeterministic(() => parseFormulaExpression("1 + floor(strength / power) * -2"), { runs: 10 });
    assertDeterministic(() => parseFormulaExpression("1 + * 2"), { runs: 10 });
  });
});
