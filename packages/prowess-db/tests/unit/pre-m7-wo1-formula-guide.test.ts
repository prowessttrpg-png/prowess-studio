// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFormulaExpression, type FormulaNode } from "@prowess/rules";
import { buildExpression, guidedFormula, printFormula, rebuildFromTerms, sameAst, termHazards, type FormulaTerm } from "../../src/compendium-rules/formula-presentation";
import { describe, expect, it } from "vitest";
import { formulaGuide } from "../../src/compendium-rules/formula-guide";

/**
 * PRE-M7-WO1 C08 — the guided Formula view round-trips the full supported expression without changing precedence or
 * evaluation semantics, and refuses (rather than rewrites) what it cannot show as contributions.
 */
const ROOT = path.resolve(import.meta.dirname, "../../../..");
const ast = (e: string): FormulaNode => {
  const p = parseFormulaExpression(e);
  if (!p.ok) throw new Error(`${e}: ${p.diagnostics.map((d) => d.message).join("; ")}`);
  return p.ast;
};

/** Every authored Formula expression in the shipped core content (derived statistics and procedure totals). */
function contentExpressions(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      const r = v as Record<string, unknown>;
      if (typeof r.expression === "string") out.push(r.expression);
      Object.values(r).forEach(walk);
    }
  };
  for (const f of ["core-resolution.json", "runtime-resources.json"]) walk(JSON.parse(readFileSync(path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1", f), "utf8")));
  return [...new Set(out)];
}

describe("PRE-M7-WO1 guided Formula model (server-side; the Studio never parses a Formula)", () => {
  const corpus = [
    ...contentExpressions(),
    "a - (b + c)",
    "a - (b - c)",
    "a / (b * c)",
    "(a + b) * c",
    "-x + 3",
    "a - -b",
    "-floor(str / 3)",
    "max(0, floor(str / 3) - 1)",
    "2 * (str + agi)",
    "min(a, b) + max(c, 1) * 2",
    "1.5 * per",
    "ceil(con / 4) + 0",
  ];

  it("W1-FORMULA every corpus expression prints back to the same AST (precedence and associativity preserved)", () => {
    expect(corpus.length).toBeGreaterThan(20);
    for (const e of corpus) expect(sameAst(ast(printFormula(ast(e))), ast(e)), e).toBe(true);
  });

  it("W1-FORMULA the guided view is lossless: rebuilding its terms reproduces the identical AST, or it declines", () => {
    for (const e of corpus) {
      const g = guidedFormula(e);
      if (g.ok) expect(sameAst(ast(buildExpression(g.terms)), ast(e)), e).toBe(true);
      else expect(g.reason, e).toMatch(/cannot be shown|expected|unexpected/);
    }
    expect(guidedFormula("floor(str / 3)")).toEqual({ ok: true, terms: [{ sign: 1, kind: "DIVIDED", variable: "str", divisor: 3, rounding: "floor" }] });
    const dodge = guidedFormula("half_character_die + agi + perception_bonus + bonuses");
    expect(dodge.ok && dodge.terms.map((t) => t.kind)).toEqual(["INPUT", "INPUT", "INPUT", "INPUT"]);
    expect(guidedFormula("15 * per")).toEqual({ ok: true, terms: [{ sign: 1, kind: "SCALED", variable: "per", factor: 15 }] });
    const nested = guidedFormula("a - (b + c)");
    expect(nested.ok && nested.terms[1]).toMatchObject({ sign: -1, kind: "OTHER" });
  });

  it("W1-FORMULA guided edits: change a divisor, replace an input, add and remove contributions; removing all is the neutral 0", () => {
    const g = guidedFormula("floor(str / 3)");
    if (!g.ok) throw new Error("expected guided");
    const t = g.terms[0] as Extract<FormulaTerm, { kind: "DIVIDED" }>;
    expect(rebuildFromTerms([{ ...t, divisor: 2 }])).toEqual({ ok: true, expression: "floor(str / 2)", variables: ["str"] });
    expect(rebuildFromTerms([{ ...t, variable: "con" }])).toEqual({ ok: true, expression: "floor(con / 3)", variables: ["con"] });
    expect(rebuildFromTerms([t, { sign: 1, kind: "DIVIDED", variable: "per", divisor: 4, rounding: "floor" }])).toEqual({ ok: true, expression: "floor(str / 3) + floor(per / 4)", variables: ["str", "per"] });
    expect(rebuildFromTerms([t, { sign: -1, kind: "CONSTANT", value: 1 }])).toMatchObject({ expression: "floor(str / 3) - 1" });
    expect(rebuildFromTerms([])).toEqual({ ok: true, expression: "0", variables: [] });
    expect(termHazards([{ ...t, divisor: 0 }])).toEqual(["Contribution 1 divides by zero."]);
  });

  it("W1-FORMULA an unparsable expression is reported, never coerced", () => {
    expect(guidedFormula("floor(str / ")).toMatchObject({ ok: false });
    expect(guidedFormula("str $ 3")).toMatchObject({ ok: false });
  });

  it("W1-FORMULA the Studio operations: describe, compose, rename and name — validated input, no database", () => {
    const d = formulaGuide({ op: "describe", expression: "floor(str / 3)", sources: [{ kind: "STAT", stat: "STR" }] }) as { description: { guided: { ok: boolean; terms: Array<{ text: string }> }; sourceLabels: string[] } };
    expect(d.description.guided.ok).toBe(true);
    expect(d.description.guided.terms[0]!.text).toBe("floor(str / 3)");
    expect(d.description.sourceLabels).toEqual(["Stat STR"]);
    expect(formulaGuide({ op: "compose", terms: [] })).toMatchObject({ ok: true, expression: "0", variables: [] });
    expect(formulaGuide({ op: "compose", terms: [{ sign: 1, kind: "DIVIDED", variable: "str", divisor: 2, rounding: "floor" }, { sign: -1, kind: "OTHER", text: "a + b" }] })).toMatchObject({ ok: true, expression: "floor(str / 2) - (a + b)" });
    expect(formulaGuide({ op: "rename", expression: "floor(str / 3) + str", from: "str", to: "con" })).toMatchObject({ ok: true, expression: "floor(con / 3) + con" });
    expect(formulaGuide({ op: "name", source: { kind: "STAT", stat: "STR" }, taken: ["str"] })).toEqual({ variable: "str_2", label: "Stat STR" });
    expect(() => formulaGuide({ op: "compose", terms: [{ sign: 2, kind: "INPUT", variable: "x" }] })).toThrow(/sign/);
    expect(formulaGuide({ op: "compose", terms: [{ sign: 1, kind: "OTHER", text: "x $ 1" }] })).toMatchObject({ ok: false, reason: expect.stringMatching(/does not parse/) });
    expect(() => formulaGuide({ op: "describe", expression: "x".repeat(2001) })).toThrow(/at most/);
    expect(() => formulaGuide({ op: "eval" })).toThrow(/op is/);
  });
});
