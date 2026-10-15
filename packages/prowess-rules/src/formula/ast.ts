import { deepFreeze } from "../internal/plain-data.js";
import type { FormulaFunctionName } from "./diagnostics.js";

/**
 * The Formula AST (PAS-10 M4-WO3 §21–25): a discriminated union of plain, JSON-serializable, deep-frozen objects — no
 * class instances, functions, Maps or cycles. Every node carries its source span as UTF-16 code-unit offsets into the
 * expression (`startOffset` inclusive, `endOffset` exclusive). The AST is the canonical parsed form; the authored
 * source string is never rewritten (§81–82).
 */
export type FormulaNode = FormulaNumberNode | FormulaVariableNode | FormulaUnaryNode | FormulaBinaryNode | FormulaCallNode;

export interface FormulaNumberNode {
  readonly type: "NUMBER";
  readonly value: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

/** An opaque, exact variable key. A dotted key such as `actor.prowess` is ONE key — never property access (§101). */
export interface FormulaVariableNode {
  readonly type: "VARIABLE";
  readonly key: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface FormulaUnaryNode {
  readonly type: "UNARY";
  readonly operator: "+" | "-";
  readonly operand: FormulaNode;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface FormulaBinaryNode {
  readonly type: "BINARY";
  readonly operator: "+" | "-" | "*" | "/";
  readonly left: FormulaNode;
  readonly right: FormulaNode;
  readonly startOffset: number;
  readonly endOffset: number;
}

/** A call to one of the four built-in functions. `arguments` keep their authored order (§89). */
export interface FormulaCallNode {
  readonly type: "CALL";
  readonly name: FormulaFunctionName;
  readonly arguments: readonly FormulaNode[];
  readonly startOffset: number;
  readonly endOffset: number;
}

export const FORMULA_NODE_TYPES = deepFreeze(["NUMBER", "VARIABLE", "UNARY", "BINARY", "CALL"] as const);

/**
 * Formula identifier grammar (§14–15, §101–102): ASCII letter or `_`, then letters / digits / `_`, optionally followed
 * by further `.`-separated segments of letters / digits / `_` — `power`, `final_mp`, `actor.prowess`, `PRO`. Exact and
 * case-sensitive: `PRO`, `pro` and `Prowess` are three different keys. No empty segment, no trailing dot, no
 * whitespace. A segment equal to `__proto__`, `constructor` or `prototype` is rejected (the M4-WO1 prototype-safety
 * policy), so a key can never address an object prototype.
 */
const FORMULA_IDENTIFIER_PATTERN_INTERNAL = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
/** Read-only grammar metadata; validation keeps a separate private matcher. */
export const FORMULA_IDENTIFIER_PATTERN = deepFreeze(new RegExp(FORMULA_IDENTIFIER_PATTERN_INTERNAL));

const FORBIDDEN_SEGMENTS: readonly string[] = ["__proto__", "constructor", "prototype"];

export function isValidFormulaIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    FORMULA_IDENTIFIER_PATTERN_INTERNAL.test(value) &&
    !value.split(".").some((segment) => FORBIDDEN_SEGMENTS.includes(segment))
  );
}
