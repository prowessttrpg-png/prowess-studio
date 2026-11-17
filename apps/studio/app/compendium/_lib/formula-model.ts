import { parseFormulaExpression, type FormulaNode } from "@prowess/rules";

/**
 * PRE-M7-WO1 — the guided view of an authored M4 Formula (presentation; the server is the authority).
 *
 * The expression is parsed with the SAME M4 parser the engine uses. Its top-level sum is shown as a list of
 * CONTRIBUTIONS (terms joined by + / −); each term is classified only so ordinary controls can edit it:
 *   CONSTANT n · INPUT x · SCALED n × x · DIVIDED x ÷ n (optionally floor / ceil) · OTHER (any other sub-expression).
 * Editing rebuilds the expression with a precedence-aware printer and is accepted ONLY when the result parses back to
 * exactly the intended AST — so a guided edit can never change precedence or evaluation semantics. An expression that
 * the guided view cannot represent losslessly is never flattened or rewritten: the editor offers the advanced (raw,
 * still M4-parsed and server-validated) expression instead.
 *
 * Nothing here evaluates a Formula. Values and validity come from the server (authoring validation and the preview).
 */

export type FormulaTerm =
  | { readonly sign: 1 | -1; readonly kind: "CONSTANT"; readonly value: number }
  | { readonly sign: 1 | -1; readonly kind: "INPUT"; readonly variable: string }
  | { readonly sign: 1 | -1; readonly kind: "SCALED"; readonly variable: string; readonly factor: number }
  | { readonly sign: 1 | -1; readonly kind: "DIVIDED"; readonly variable: string; readonly divisor: number; readonly rounding: "floor" | "ceil" | null }
  | { readonly sign: 1 | -1; readonly kind: "OTHER"; readonly node: FormulaNode };

export type GuidedFormula = { readonly ok: true; readonly terms: readonly FormulaTerm[] } | { readonly ok: false; readonly reason: string };

/** Structural AST equality, ignoring source offsets (the semantic identity of an expression). */
export function sameAst(a: FormulaNode, b: FormulaNode): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "NUMBER":
      return a.value === (b as typeof a).value;
    case "VARIABLE":
      return a.key === (b as typeof a).key;
    case "UNARY":
      return a.operator === (b as typeof a).operator && sameAst(a.operand, (b as typeof a).operand);
    case "BINARY":
      return a.operator === (b as typeof a).operator && sameAst(a.left, (b as typeof a).left) && sameAst(a.right, (b as typeof a).right);
    case "CALL": {
      const c = b as typeof a;
      return a.name === c.name && a.arguments.length === c.arguments.length && a.arguments.every((x, i) => sameAst(x, c.arguments[i] as FormulaNode));
    }
  }
}

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
const precedenceOf = (n: FormulaNode) => (n.type === "BINARY" ? (PRECEDENCE[n.operator] as number) : n.type === "UNARY" ? 3 : 4);
const num = (v: number) => (Object.is(v, -0) ? "0" : String(v));

/** Prints an AST so that it parses back to the same AST (left-associative binary operators, minimal parentheses). */
export function printFormula(n: FormulaNode): string {
  switch (n.type) {
    case "NUMBER":
      return num(n.value);
    case "VARIABLE":
      return n.key;
    case "UNARY": {
      const inner = printFormula(n.operand);
      return `${n.operator}${precedenceOf(n.operand) < 3 ? `(${inner})` : inner}`;
    }
    case "CALL":
      return `${n.name}(${n.arguments.map(printFormula).join(", ")})`;
    case "BINARY": {
      const p = PRECEDENCE[n.operator] as number;
      const left = printFormula(n.left);
      const right = printFormula(n.right);
      const l = precedenceOf(n.left) < p ? `(${left})` : left;
      // Right operand of an equal-precedence operator needs parentheses (a - (b + c), a / (b * c)).
      const r = precedenceOf(n.right) <= p ? `(${right})` : right;
      return `${l} ${n.operator} ${r}`;
    }
  }
}

function classify(node: FormulaNode, sign: 1 | -1): FormulaTerm {
  if (node.type === "NUMBER") return { sign, kind: "CONSTANT", value: node.value };
  if (node.type === "VARIABLE") return { sign, kind: "INPUT", variable: node.key };
  if (node.type === "BINARY" && node.operator === "*") {
    if (node.left.type === "NUMBER" && node.right.type === "VARIABLE") return { sign, kind: "SCALED", variable: node.right.key, factor: node.left.value };
    if (node.right.type === "NUMBER" && node.left.type === "VARIABLE") return { sign, kind: "SCALED", variable: node.left.key, factor: node.right.value };
  }
  if (node.type === "BINARY" && node.operator === "/" && node.left.type === "VARIABLE" && node.right.type === "NUMBER") return { sign, kind: "DIVIDED", variable: node.left.key, divisor: node.right.value, rounding: null };
  if (node.type === "CALL" && (node.name === "floor" || node.name === "ceil") && node.arguments.length === 1) {
    const a = node.arguments[0] as FormulaNode;
    if (a.type === "BINARY" && a.operator === "/" && a.left.type === "VARIABLE" && a.right.type === "NUMBER") return { sign, kind: "DIVIDED", variable: a.left.key, divisor: a.right.value, rounding: node.name };
  }
  return { sign, kind: "OTHER", node };
}

/** The top-level contributions of an AST: the left spine of + / − is split; anything else is one term. */
function split(node: FormulaNode, sign: 1 | -1, out: FormulaTerm[]): void {
  if (node.type === "BINARY" && (node.operator === "+" || node.operator === "-")) {
    split(node.left, sign, out);
    const rightSign = (node.operator === "-" ? -sign : sign) as 1 | -1;
    const r = node.right;
    // A parenthesised sum on the right stays ONE term (its inner signs are not distributed).
    out.push(classify(r, rightSign));
    return;
  }
  out.push(classify(node, sign));
}

export function termExpression(t: FormulaTerm): string {
  switch (t.kind) {
    case "CONSTANT":
      return num(t.value);
    case "INPUT":
      return t.variable;
    case "SCALED":
      return `${num(t.factor)} * ${t.variable}`;
    case "DIVIDED":
      return t.rounding === null ? `${t.variable} / ${num(t.divisor)}` : `${t.rounding}(${t.variable} / ${num(t.divisor)})`;
    case "OTHER": {
      const s = printFormula(t.node);
      return t.node.type === "BINARY" && (t.node.operator === "+" || t.node.operator === "-") ? `(${s})` : s;
    }
  }
}

/** Joins terms back into one expression. No terms → the neutral constant 0 (a valid rule, never a missing one). */
export function buildExpression(terms: readonly FormulaTerm[]): string {
  if (terms.length === 0) return "0";
  return terms
    .map((t, i) => {
      const body = termExpression(t);
      if (i === 0) return t.sign === -1 ? (t.kind === "CONSTANT" || t.kind === "INPUT" ? `-${body}` : `-(${body})`) : body;
      return `${t.sign === -1 ? "-" : "+"} ${body}`;
    })
    .join(" ");
}

/** The guided view of `expression`, or why it cannot be shown losslessly. */
export function guidedFormula(expression: string): GuidedFormula {
  const parsed = parseFormulaExpression(expression);
  if (!parsed.ok) return { ok: false, reason: parsed.diagnostics.map((d) => d.message).join("; ") };
  const terms: FormulaTerm[] = [];
  // A leading unary minus on the whole expression is one negative term.
  if (parsed.ast.type === "UNARY" && parsed.ast.operator === "-") terms.push(classify(parsed.ast.operand, -1));
  else split(parsed.ast, 1, terms);
  const rebuilt = parseFormulaExpression(buildExpression(terms));
  if (!rebuilt.ok || !sameAst(rebuilt.ast, parsed.ast)) return { ok: false, reason: "this expression's structure cannot be shown as a list of contributions without changing it" };
  return { ok: true, terms };
}

/**
 * Applies a guided edit: the new expression is accepted only if it parses, and — for a pure presentation change — only
 * if `intended` (when given) is the AST it produces. Returns the new expression or the parse problem.
 */
export function applyTerms(terms: readonly FormulaTerm[]): { ok: true; expression: string; variables: readonly string[] } | { ok: false; reason: string } {
  const expression = buildExpression(terms);
  const parsed = parseFormulaExpression(expression);
  if (!parsed.ok) return { ok: false, reason: parsed.diagnostics.map((d) => d.message).join("; ") };
  return { ok: true, expression, variables: parsed.variables };
}

/** Every variable the terms read (first-use order). */
export function variablesOf(expression: string): readonly string[] {
  const parsed = parseFormulaExpression(expression);
  return parsed.ok ? parsed.variables : [];
}

/** Literal division by zero in a guided term (the engine refuses it at evaluation; say so before saving). */
export function termHazards(terms: readonly FormulaTerm[]): string[] {
  const out: string[] = [];
  terms.forEach((t, i) => {
    if (t.kind === "DIVIDED" && t.divisor === 0) out.push(`Contribution ${i + 1} divides by zero.`);
  });
  return out;
}
