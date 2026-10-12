import { isValidFormulaIdentifier } from "./ast.js";
import { diagnostic, FORMULA_DIAGNOSTIC_CODES, FORMULA_LIMITS, type FormulaDiagnostic } from "./diagnostics.js";

/**
 * A purpose-built, single-pass lexer (PAS-10 M4-WO3 §12, §19–20, §26, §65). It reads the source one UTF-16 code unit
 * at a time with explicit character-class checks — no JavaScript or TypeScript parser, no regular-expression rewriting
 * of the source, no locale-dependent API. Internal to the formula module.
 *
 * Tokens: NUMBER, IDENTIFIER, the ASCII operators `+ - * /`, `(`, `)`, `,`, and END.
 *  - NUMBER   `digits` or `digits.digits`. No sign (negation is unary minus), no exponent, no hex / binary / octal,
 *             no separators, no leading or trailing dot. A number immediately followed by a letter, `_` or `.` is
 *             malformed (so `1e5`, `0x10`, `1_000`, `1.5.2` are rejected, not split).
 *  - IDENTIFIER  see `FORMULA_IDENTIFIER_PATTERN`; scanned greedily, then validated.
 *  - Whitespace is space, tab, line feed and carriage return; it only separates tokens.
 * Anything else — including `×`, `÷`, `−`, `^`, `%`, quotes, brackets and non-ASCII whitespace — is UNKNOWN_TOKEN:
 * the engine never guesses what an authored symbol meant (§19).
 */
export type FormulaTokenType = "NUMBER" | "IDENTIFIER" | "PLUS" | "MINUS" | "STAR" | "SLASH" | "LPAREN" | "RPAREN" | "COMMA" | "END";

export interface FormulaToken {
  readonly type: FormulaTokenType;
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

const SINGLE: Readonly<Record<string, FormulaTokenType>> = {
  "+": "PLUS",
  "-": "MINUS",
  "*": "STAR",
  "/": "SLASH",
  "(": "LPAREN",
  ")": "RPAREN",
  ",": "COMMA",
};

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c) || c === ".";
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

export type LexResult = { readonly ok: true; readonly tokens: readonly FormulaToken[] } | { readonly ok: false; readonly diagnostic: FormulaDiagnostic };

export function tokenizeFormula(source: string): LexResult {
  const fail = (code: FormulaDiagnostic["code"], message: string, startOffset: number, endOffset: number): LexResult => ({
    ok: false,
    diagnostic: diagnostic(code, message, { startOffset, endOffset, path: "/expression" }),
  });
  if (source.length > FORMULA_LIMITS.MAX_SOURCE_LENGTH) {
    return fail(FORMULA_DIAGNOSTIC_CODES.EXPRESSION_LIMIT_EXCEEDED, `expression exceeds ${FORMULA_LIMITS.MAX_SOURCE_LENGTH} characters`, 0, source.length);
  }

  const tokens: FormulaToken[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    if (tokens.length >= FORMULA_LIMITS.MAX_TOKENS) {
      return fail(FORMULA_DIAGNOSTIC_CODES.EXPRESSION_LIMIT_EXCEEDED, `expression exceeds ${FORMULA_LIMITS.MAX_TOKENS} tokens`, i, source.length);
    }
    const start = i;
    const single = SINGLE[c];
    if (single !== undefined) {
      tokens.push({ type: single, text: c, startOffset: start, endOffset: start + 1 });
      i += 1;
      continue;
    }
    if (isDigit(c)) {
      while (i < source.length && isDigit(source.charAt(i))) i += 1;
      if (source.charAt(i) === ".") {
        i += 1;
        if (!isDigit(source.charAt(i))) return fail(FORMULA_DIAGNOSTIC_CODES.INVALID_SYNTAX, "a decimal point must be followed by digits", start, i);
        while (i < source.length && isDigit(source.charAt(i))) i += 1;
      }
      if (i < source.length && isIdentPart(source.charAt(i))) {
        let end = i;
        while (end < source.length && isIdentPart(source.charAt(end))) end += 1;
        return fail(FORMULA_DIAGNOSTIC_CODES.INVALID_SYNTAX, "malformed number (no exponents, hex, separators or trailing identifier characters)", start, end);
      }
      const text = source.slice(start, i);
      if (!Number.isFinite(Number(text))) return fail(FORMULA_DIAGNOSTIC_CODES.INVALID_SYNTAX, "number literal is not finite", start, i);
      tokens.push({ type: "NUMBER", text, startOffset: start, endOffset: i });
      continue;
    }
    if (isIdentStart(c)) {
      while (i < source.length && isIdentPart(source.charAt(i))) i += 1;
      const text = source.slice(start, i);
      if (!isValidFormulaIdentifier(text)) {
        return fail(FORMULA_DIAGNOSTIC_CODES.INVALID_SYNTAX, `"${text}" is not a valid identifier (dotted segments must be non-empty; __proto__ / constructor / prototype are not allowed)`, start, i);
      }
      tokens.push({ type: "IDENTIFIER", text, startOffset: start, endOffset: i });
      continue;
    }
    const codePoint = source.codePointAt(i) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    return fail(FORMULA_DIAGNOSTIC_CODES.UNKNOWN_TOKEN, `unexpected character "${source.slice(i, i + width)}" (U+${codePoint.toString(16).toUpperCase().padStart(4, "0")})`, i, i + width);
  }
  tokens.push({ type: "END", text: "", startOffset: source.length, endOffset: source.length });
  return { ok: true, tokens };
}
