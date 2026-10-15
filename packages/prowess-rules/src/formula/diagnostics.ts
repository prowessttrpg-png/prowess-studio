import { deepFreeze } from "../internal/plain-data.js";
/**
 * Formula diagnostics, limits and function vocabulary (PAS-10 M4-WO3 §17–18, §59–61).
 *
 * A Formula diagnostic describes bad AUTHORED or CONFIGURED input — malformed syntax, a missing variable, division by
 * zero. It is a rule outcome, surfaced as a VALIDATION message (category FORMULA) — never an engine error. The
 * `RULE_ENGINE.*` vocabulary stays reserved for genuine engine / invariant failures (§60).
 */
export const FORMULA_DIAGNOSTIC_CODES = deepFreeze({
  /** The text is not a well-formed expression (incl. trailing input and non-finite literals). */
  INVALID_SYNTAX: "FORMULA.INVALID_SYNTAX",
  /** A character that begins no token of the grammar (e.g. `^`, `%`, `÷`, `×`, `−`, a quote). */
  UNKNOWN_TOKEN: "FORMULA.UNKNOWN_TOKEN",
  /** A call to anything other than floor / ceil / min / max. */
  UNKNOWN_FUNCTION: "FORMULA.UNKNOWN_FUNCTION",
  /** floor / ceil need exactly 1 argument; min / max need at least 2. */
  INVALID_ARITY: "FORMULA.INVALID_ARITY",
  /** Source, token, node or nesting limits exceeded. */
  EXPRESSION_LIMIT_EXCEEDED: "FORMULA.EXPRESSION_LIMIT_EXCEEDED",
  /** A Formula program (or a supplied AST) is malformed: unknown field, bad rounding mode, bad unit, bad shape. */
  INVALID_DEFINITION: "FORMULA.INVALID_DEFINITION",
  /** minimum / maximum are not finite numbers, or minimum > maximum. */
  INVALID_BOUNDS: "FORMULA.INVALID_BOUNDS",
  /** A referenced variable has no binding. Never replaced by a default. */
  MISSING_VARIABLE: "FORMULA.MISSING_VARIABLE",
  /** A binding is not a finite number (no coercion of strings, booleans or null), or bindings are not an object. */
  INVALID_VARIABLE_VALUE: "FORMULA.INVALID_VARIABLE_VALUE",
  /** A divisor evaluated to zero. */
  DIVISION_BY_ZERO: "FORMULA.DIVISION_BY_ZERO",
  /** An operation produced NaN or ±Infinity. */
  NON_FINITE_RESULT: "FORMULA.NON_FINITE_RESULT",
  /** A dependency node names a key that is not in the supplied graph. */
  UNKNOWN_DEPENDENCY: "FORMULA.UNKNOWN_DEPENDENCY",
  /** The dependency graph contains a cycle. Never broken arbitrarily. */
  DEPENDENCY_CYCLE: "FORMULA.DEPENDENCY_CYCLE",
} as const);

export type FormulaDiagnosticCode = (typeof FORMULA_DIAGNOSTIC_CODES)[keyof typeof FORMULA_DIAGNOSTIC_CODES];

/**
 * One structured Formula diagnostic. Offsets are JavaScript string UTF-16 code-unit offsets into the expression
 * source (`endOffset` exclusive), or null when the diagnostic is not about a location in the source.
 */
export interface FormulaDiagnostic {
  readonly code: FormulaDiagnosticCode;
  readonly message: string;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  /** Where in the Formula input the problem is (RFC 6901 JSON Pointer), e.g. `/expression`, `/bindings/power`. */
  readonly path: string | null;
}

/** Deterministic complexity limits (§61, §63). Constants, tested at their boundaries. */
export const FORMULA_LIMITS = deepFreeze({
  /** Maximum expression length in UTF-16 code units. */
  MAX_SOURCE_LENGTH: 8192,
  /** Maximum number of tokens. */
  MAX_TOKENS: 2048,
  /** Maximum number of AST nodes. */
  MAX_AST_NODES: 2048,
  /** Maximum nesting of parentheses, function calls and unary operators while parsing. */
  MAX_NESTING_DEPTH: 64,
  /**
   * Maximum depth of the resulting AST. Long left-associative chains (`1 + 1 + … + 1`) do not nest while parsing but
   * do deepen the tree; this bounds evaluation recursion regardless of how depth arose.
   */
  MAX_AST_DEPTH: 512,
} as const);

/** The only callable functions (§17, §49), with their arity rules (§18). Exact lowercase names. */
export const FORMULA_FUNCTIONS = deepFreeze(["floor", "ceil", "min", "max"] as const);
export type FormulaFunctionName = (typeof FORMULA_FUNCTIONS)[number];

export function isFormulaFunctionName(value: unknown): value is FormulaFunctionName {
  return typeof value === "string" && (FORMULA_FUNCTIONS as readonly string[]).includes(value);
}

/** Arity check: floor / ceil exactly 1; min / max at least 2. */
export function hasValidArity(name: FormulaFunctionName, count: number): boolean {
  return name === "floor" || name === "ceil" ? count === 1 : count >= 2;
}

export function arityRule(name: FormulaFunctionName): string {
  return name === "floor" || name === "ceil" ? "exactly 1 argument" : "at least 2 arguments";
}

export function diagnostic(
  code: FormulaDiagnosticCode,
  message: string,
  location: { startOffset?: number | null; endOffset?: number | null; path?: string | null } = {},
): FormulaDiagnostic {
  return {
    code,
    message,
    startOffset: location.startOffset ?? null,
    endOffset: location.endOffset ?? null,
    path: location.path ?? null,
  };
}
