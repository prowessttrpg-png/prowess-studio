// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFormulaExpression, type FormulaNode } from "@prowess/rules";
import { describe, expect, it } from "vitest";
import { applyTerms, buildExpression, guidedFormula, printFormula, sameAst, termHazards, type FormulaTerm } from "../../app/compendium/_lib/formula-model";

/**
 * PRE-M7-WO1 C08 — the guided Formula view round-trips the full supported expression without changing precedence or
 * evaluation semantics, and refuses (rather than rewrites) what it cannot show as contributions.
 */
const ROOT = path.resolve(process.cwd(), "../..");
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

describe("PRE-M7-WO1 guided Formula model", () => {
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
    expect(applyTerms([{ ...t, divisor: 2 }])).toEqual({ ok: true, expression: "floor(str / 2)", variables: ["str"] });
    expect(applyTerms([{ ...t, variable: "con" }])).toEqual({ ok: true, expression: "floor(con / 3)", variables: ["con"] });
    expect(applyTerms([t, { sign: 1, kind: "DIVIDED", variable: "per", divisor: 4, rounding: "floor" }])).toEqual({ ok: true, expression: "floor(str / 3) + floor(per / 4)", variables: ["str", "per"] });
    expect(applyTerms([t, { sign: -1, kind: "CONSTANT", value: 1 }])).toMatchObject({ expression: "floor(str / 3) - 1" });
    expect(applyTerms([])).toEqual({ ok: true, expression: "0", variables: [] });
    expect(termHazards([{ ...t, divisor: 0 }])).toEqual(["Contribution 1 divides by zero."]);
  });

  it("W1-FORMULA an unparsable expression is reported, never coerced", () => {
    expect(guidedFormula("floor(str / ")).toMatchObject({ ok: false });
    expect(guidedFormula("str $ 3")).toMatchObject({ ok: false });
  });
});
