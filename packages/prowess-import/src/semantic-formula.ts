/**
 * Formula statement recognition for `prowess.semantic-foundation@1` (PAS-10 M3-WO5).
 *
 * Structural parsing ONLY: it splits an authored statement into left-hand text, expression and qualifiers, and checks
 * that the expression is well-formed in a small grammar. It never evaluates anything, never produces executable code
 * (no eval, no Function constructor), and never resolves a term: "Final MP" and "PRO" stay unresolved source tokens.
 *
 * Grammar (whitespace-insensitive):
 *   expression := term (("+" | "-" | "−") term)*
 *   term       := factor (("*" | "/" | "×" | "÷") factor)*
 *   factor     := ["-" | "−"] primary
 *   primary    := NUMBER [UNIT] | FUNCTION "(" expression ("," expression)* ")" | IDENTIFIER | "(" expression ")"
 *   FUNCTION   := floor | ceil | min | max                 (followed by "(")
 *   IDENTIFIER := one or more words (letter-initial, Unicode) separated by single spaces, e.g. "Final MP"
 *   UNIT       := a single word directly after a number, e.g. "15 ft" (kept verbatim; never converted)
 * A recognized expression must contain at least one operator or function — "X = 5" is not a formula.
 * Qualifiers: comma-separated after the expression at parenthesis depth 0, each one of
 *   minimum N | maximum N | min N | max N | rounded down | rounded up | round down | round up
 * — preserved verbatim, never applied. Anything else makes the statement unrecognized (precision over recall).
 */
export interface FormulaParse {
  leftHandText: string | null;
  expressionText: string;
  /** The authored expression with ×→*, ÷→/, −→- and single spaces. The authored text is kept separately. */
  normalizedExpressionText: string;
  qualifiers: string[];
  /** Unresolved identifier terms in first-occurrence order. */
  terms: string[];
  functions: string[];
  operators: string[];
  quantities: Array<{ value: string; unit: string | null }>;
}

type Tok =
  | { t: "NUM"; v: string; unit: string | null }
  | { t: "IDENT"; v: string }
  | { t: "FUNC"; v: string }
  | { t: "OP"; v: string }
  | { t: "LP" }
  | { t: "RP" }
  | { t: "COMMA" };

const FUNCTIONS = new Set(["floor", "ceil", "min", "max"]);
const QUALIFIER = /^(?:(?:minimum|maximum|min|max)\s+-?\d+(?:\.\d+)?|round(?:ed)?\s+(?:down|up))$/iu;

function lex(text: string): Tok[] | null {
  const raw: Array<{ t: "NUM" | "WORD" | "OP" | "LP" | "RP" | "COMMA"; v: string; spaceBefore: boolean }> = [];
  let i = 0;
  let space = false;
  while (i < text.length) {
    const c = text[i] as string;
    if (/\s/.test(c)) {
      space = true;
      i += 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(text.slice(i));
    const word = /^\p{L}[\p{L}\p{N}_'’]*/u.exec(text.slice(i));
    if (num) {
      raw.push({ t: "NUM", v: num[0], spaceBefore: space });
      i += num[0].length;
    } else if (word) {
      raw.push({ t: "WORD", v: word[0], spaceBefore: space });
      i += word[0].length;
    } else if ("+-−*/×÷".includes(c)) {
      raw.push({ t: "OP", v: c, spaceBefore: space });
      i += 1;
    } else if (c === "(") {
      raw.push({ t: "LP", v: c, spaceBefore: space });
      i += 1;
    } else if (c === ")") {
      raw.push({ t: "RP", v: c, spaceBefore: space });
      i += 1;
    } else if (c === ",") {
      raw.push({ t: "COMMA", v: c, spaceBefore: space });
      i += 1;
    } else return null; // any other character (":", "?", "/" in a URL path, "%", …) is outside the grammar
    space = false;
  }
  const out: Tok[] = [];
  for (let k = 0; k < raw.length; k += 1) {
    const r = raw[k] as (typeof raw)[number];
    if (r.t === "NUM") {
      const next = raw[k + 1];
      const after = raw[k + 2];
      if (next && next.t === "WORD" && next.spaceBefore && !(after && after.t === "WORD") && !FUNCTIONS.has(next.v.toLowerCase())) {
        out.push({ t: "NUM", v: r.v, unit: next.v });
        k += 1;
      } else out.push({ t: "NUM", v: r.v, unit: null });
    } else if (r.t === "WORD") {
      if (FUNCTIONS.has(r.v.toLowerCase()) && raw[k + 1]?.t === "LP") {
        out.push({ t: "FUNC", v: r.v });
        continue;
      }
      let v = r.v;
      while (raw[k + 1]?.t === "WORD" && raw[k + 1]?.spaceBefore && !(FUNCTIONS.has((raw[k + 1] as { v: string }).v.toLowerCase()) && raw[k + 2]?.t === "LP")) {
        k += 1;
        v += ` ${(raw[k] as { v: string }).v}`;
      }
      out.push({ t: "IDENT", v });
    } else if (r.t === "OP") out.push({ t: "OP", v: r.v });
    else if (r.t === "LP") out.push({ t: "LP" });
    else if (r.t === "RP") out.push({ t: "RP" });
    else out.push({ t: "COMMA" });
  }
  return out;
}

/** Recursive-descent validation. Returns false for anything outside the grammar. */
function wellFormed(tokens: Tok[]): boolean {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (set: string) => {
    const t = peek();
    return t !== undefined && t.t === "OP" && set.includes(t.v);
  };
  const expression = (): boolean => {
    if (!term()) return false;
    while (isOp("+-−")) {
      p += 1;
      if (!term()) return false;
    }
    return true;
  };
  const term = (): boolean => {
    if (!factor()) return false;
    while (isOp("*/×÷")) {
      p += 1;
      if (!factor()) return false;
    }
    return true;
  };
  const factor = (): boolean => {
    if (isOp("-−")) p += 1;
    return primary();
  };
  const primary = (): boolean => {
    const t = peek();
    if (!t) return false;
    if (t.t === "NUM" || t.t === "IDENT") {
      p += 1;
      return true;
    }
    if (t.t === "FUNC") {
      p += 1;
      if (peek()?.t !== "LP") return false;
      p += 1;
      if (!expression()) return false;
      while (peek()?.t === "COMMA") {
        p += 1;
        if (!expression()) return false;
      }
      if (peek()?.t !== "RP") return false;
      p += 1;
      return true;
    }
    if (t.t === "LP") {
      p += 1;
      if (!expression() || peek()?.t !== "RP") return false;
      p += 1;
      return true;
    }
    return false;
  };
  return expression() && p === tokens.length;
}

/** Splits at the first comma at parenthesis depth 0: [expression, qualifier list]. */
function splitQualifiers(rhs: string): [string, string[]] {
  let depth = 0;
  for (let i = 0; i < rhs.length; i += 1) {
    const c = rhs[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) return [rhs.slice(0, i), rhs.slice(i + 1).split(",").map((q) => q.trim())];
  }
  return [rhs, []];
}

const LEFT_HAND = /^\p{L}[\p{L}\p{N}_'’-]*(?: \p{L}[\p{L}\p{N}_'’-]*){0,5}$/u;

/** Parses an expression (with optional trailing qualifiers). Null when outside the grammar or trivial. */
export function parseExpression(rhs: string): Omit<FormulaParse, "leftHandText"> | null {
  const [expr, qualifiers] = splitQualifiers(rhs);
  const expressionText = expr.trim();
  if (expressionText.length === 0 || qualifiers.some((q) => !QUALIFIER.test(q))) return null;
  const tokens = lex(expressionText);
  if (!tokens || tokens.length === 0 || !wellFormed(tokens)) return null;
  const functions = tokens.filter((t): t is { t: "FUNC"; v: string } => t.t === "FUNC").map((t) => t.v);
  const operators = tokens.filter((t): t is { t: "OP"; v: string } => t.t === "OP").map((t) => t.v);
  if (functions.length === 0 && operators.length === 0) return null; // "X = 5" is not a formula
  const terms: string[] = [];
  for (const t of tokens) if (t.t === "IDENT" && !terms.includes(t.v)) terms.push(t.v);
  return {
    expressionText,
    normalizedExpressionText: expressionText.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\s+/g, " "),
    qualifiers,
    terms,
    functions,
    operators,
    quantities: tokens.filter((t): t is { t: "NUM"; v: string; unit: string | null } => t.t === "NUM").map((t) => ({ value: t.v, unit: t.unit })),
  };
}

/**
 * Parses an assignment "Left Hand = expression[, qualifiers]". Exactly one "=", a left-hand side of 1–6 plain words,
 * and a recognized expression; otherwise null (URLs, prose equalities, malformed or empty sides are rejected).
 */
export function parseAssignment(statement: string): FormulaParse | null {
  const eq = statement.indexOf("=");
  if (eq < 0 || statement.indexOf("=", eq + 1) >= 0) return null;
  const leftHandText = statement.slice(0, eq).trim();
  if (!LEFT_HAND.test(leftHandText)) return null;
  const rhs = parseExpression(statement.slice(eq + 1));
  return rhs ? { leftHandText, ...rhs } : null;
}
