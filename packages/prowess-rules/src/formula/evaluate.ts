import { InputProblems } from "../internal/input-reader.js";
import { clonePlainData, deepFreeze, inspectPlainData, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { evaluate } from "../evaluation/evaluate.js";
import { booleanValue, numberValue, stringValue } from "../result/evaluation-value.js";
import { readProvenance, type RuleProvenance } from "../result/provenance.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import type { TraceInput, TraceStepInput } from "../trace/calculation-trace.js";
import { validationMessage, type ValidationMessageDraft } from "../validation/validation-message.js";
import { FORMULA_NODE_TYPES, isValidFormulaIdentifier, type FormulaNode } from "./ast.js";
import {
  arityRule,
  diagnostic,
  FORMULA_DIAGNOSTIC_CODES,
  FORMULA_LIMITS,
  hasValidArity,
  isFormulaFunctionName,
  type FormulaDiagnostic,
} from "./diagnostics.js";
import { analyzeAst, childrenOf, parseFormulaExpression } from "./parser.js";

/**
 * Formula programs and their evaluation (PAS-10 M4-WO3 §31–58, §64–71, §83–92).
 *
 * Evaluation order is fixed and nothing is implicit:
 *
 *   1. evaluate the expression AST                 → expressionValue
 *   2. explicit result rounding (NONE | FLOOR | CEIL)
 *   3. explicit minimum   (result = max(result, minimum)) — a Formula bound, not the min() function
 *   4. explicit maximum   (result = min(result, maximum))
 *                                                  → finalValue
 *
 * There is no default rounding, no implicit clamp at zero, no prettifying of floating-point results and no unit
 * arithmetic. Arithmetic is IEEE-754 JavaScript number arithmetic on finite values only: every operation's result is
 * checked, division by zero and non-finite results fail closed, and `-0` is normalized to `0` at public boundaries.
 */
export const FORMULA_ROUNDING_MODES = ["NONE", "FLOOR", "CEIL"] as const;
export type FormulaRoundingMode = (typeof FORMULA_ROUNDING_MODES)[number];

/** Opaque unit label grammar: a letter, then letters / digits / `_` / `.` / `-`, at most 64 characters. */
export const FORMULA_UNIT_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * The pure Formula program a caller supplies (§31). Exactly one of `expression` (authored source, never rewritten)
 * or `ast` (a previously parsed AST, re-validated — not trusted) is required. Not a persistent FormulaDefinition: it
 * carries no database identity.
 */
export interface FormulaProgram {
  readonly expression?: string;
  readonly ast?: FormulaNode;
  /** Defaults to NONE: no rounding. Never defaults to FLOOR or CEIL. */
  readonly rounding?: FormulaRoundingMode;
  readonly minimum?: number | null;
  readonly maximum?: number | null;
  /** Opaque label (e.g. a resource or distance name). Carries no mechanics: no conversion, no compatibility check. */
  readonly unit?: string | null;
  readonly provenance?: RuleProvenance | null;
}

/** A validated, immutable program: its AST, variables and explicit configuration. */
export interface ValidatedFormulaProgram {
  readonly ast: FormulaNode;
  readonly variables: readonly string[];
  readonly rounding: FormulaRoundingMode;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly unit: string | null;
  readonly provenance: RuleProvenance | null;
}

export type FormulaProgramValidation =
  | { readonly ok: true; readonly program: ValidatedFormulaProgram }
  | { readonly ok: false; readonly diagnostics: readonly FormulaDiagnostic[] };

export interface FormulaBoundResult {
  readonly bound: number;
  /** Whether the bound changed the value. */
  readonly applied: boolean;
}

/** The data of a successful Formula evaluation (§51–52). */
export interface FormulaResult {
  readonly finalValue: number;
  readonly expressionValue: number;
  readonly rounding: { readonly mode: FormulaRoundingMode; readonly value: number };
  readonly minimum: FormulaBoundResult | null;
  readonly maximum: FormulaBoundResult | null;
  readonly unit: string | null;
  /** The value used for each referenced variable, in first-reference order. Extra bindings never appear here. */
  readonly variables: readonly { readonly key: string; readonly value: number }[];
}

const PROGRAM_FIELDS = ["expression", "ast", "rounding", "minimum", "maximum", "unit", "provenance"];
const zero = (n: number) => (Object.is(n, -0) ? 0 : n);

/** Re-validates a caller-supplied AST (iteratively — its depth is untrusted) and returns a detached frozen copy. */
function validateSuppliedAst(value: unknown): { ok: true; ast: FormulaNode } | { ok: false; diagnostic: FormulaDiagnostic } {
  const bad = (message: string) => ({ ok: false as const, diagnostic: diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, `malformed AST: ${message}`, { path: "/ast" }) });
  if (inspectPlainData(value).length > 0) return bad("not plain JSON data");
  const stack: Array<[unknown, number]> = [[value, 1]];
  let count = 0;
  while (stack.length > 0) {
    const [node, level] = stack.pop() as [unknown, number];
    count += 1;
    if (count > FORMULA_LIMITS.MAX_AST_NODES) return { ok: false, diagnostic: diagnostic(FORMULA_DIAGNOSTIC_CODES.EXPRESSION_LIMIT_EXCEEDED, `AST exceeds ${FORMULA_LIMITS.MAX_AST_NODES} nodes`, { path: "/ast" }) };
    if (level > FORMULA_LIMITS.MAX_AST_DEPTH) return { ok: false, diagnostic: diagnostic(FORMULA_DIAGNOSTIC_CODES.EXPRESSION_LIMIT_EXCEEDED, `AST is deeper than ${FORMULA_LIMITS.MAX_AST_DEPTH} levels`, { path: "/ast" }) };
    if (!isPlainObject(node) || !(FORMULA_NODE_TYPES as readonly unknown[]).includes(node.type)) return bad("unknown node type");
    if (!Number.isInteger(node.startOffset) || !Number.isInteger(node.endOffset)) return bad("node offsets must be integers");
    const fields = (allowed: string[]) => Object.keys(node).every((k) => [...allowed, "type", "startOffset", "endOffset"].includes(k));
    switch (node.type) {
      case "NUMBER":
        if (!fields(["value"]) || typeof node.value !== "number" || !Number.isFinite(node.value)) return bad("NUMBER needs a finite value");
        break;
      case "VARIABLE":
        if (!fields(["key"]) || !isValidFormulaIdentifier(node.key)) return bad("VARIABLE needs a valid identifier key");
        break;
      case "UNARY":
        if (!fields(["operator", "operand"]) || (node.operator !== "+" && node.operator !== "-")) return bad("UNARY needs operator + or -");
        stack.push([node.operand, level + 1]);
        break;
      case "BINARY":
        if (!fields(["operator", "left", "right"]) || !["+", "-", "*", "/"].includes(node.operator as string)) return bad("BINARY needs operator + - * /");
        stack.push([node.right, level + 1], [node.left, level + 1]);
        break;
      default: {
        if (!fields(["name", "arguments"]) || !isFormulaFunctionName(node.name)) {
          return { ok: false, diagnostic: diagnostic(FORMULA_DIAGNOSTIC_CODES.UNKNOWN_FUNCTION, "AST calls a function other than floor, ceil, min, max", { path: "/ast" }) };
        }
        if (!Array.isArray(node.arguments)) return bad("CALL needs an arguments array");
        if (!hasValidArity(node.name, node.arguments.length)) {
          return { ok: false, diagnostic: diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_ARITY, `${node.name} takes ${arityRule(node.name)}`, { path: "/ast" }) };
        }
        for (let k = node.arguments.length - 1; k >= 0; k -= 1) stack.push([node.arguments[k], level + 1]);
      }
    }
  }
  return { ok: true, ast: deepFreeze(clonePlainData(value) as FormulaNode) };
}

/**
 * Validates a Formula program without evaluating it (§103): expression (or AST), rounding, bounds, unit and provenance.
 * Diagnostics are reported in that fixed order. Local to Formula correctness — not the M4-WO8 Validation Engine.
 */
export function validateFormulaProgram(program: unknown): FormulaProgramValidation {
  if (!isPlainObject(program)) {
    return deepFreeze({ ok: false as const, diagnostics: [diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, "a Formula program must be an object", { path: "" })] });
  }
  const out: FormulaDiagnostic[] = [];
  for (const key of Object.keys(program).sort()) {
    if (!PROGRAM_FIELDS.includes(key)) out.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, `unknown field "${key}"`, { path: jsonPointer([key]) }));
  }

  let ast: FormulaNode | null = null;
  let variables: readonly string[] = [];
  const hasExpression = program.expression !== undefined;
  const hasAst = program.ast !== undefined;
  if (hasExpression === hasAst) {
    out.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, "exactly one of expression or ast is required", { path: "" }));
  } else if (hasExpression) {
    const parsed = parseFormulaExpression(program.expression as string);
    if (parsed.ok) ({ ast, variables } = parsed);
    else out.push(...parsed.diagnostics);
  } else {
    const supplied = validateSuppliedAst(program.ast);
    if (supplied.ok) {
      ast = supplied.ast;
      variables = analyzeAst(ast).variables;
    } else out.push(supplied.diagnostic);
  }

  const rounding = program.rounding ?? "NONE";
  if (!(FORMULA_ROUNDING_MODES as readonly unknown[]).includes(rounding)) {
    out.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, `rounding must be one of ${FORMULA_ROUNDING_MODES.join(", ")}`, { path: "/rounding" }));
  }

  const bound = (field: "minimum" | "maximum"): number | null => {
    const v = field === "minimum" ? program.minimum : program.maximum;
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      out.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_BOUNDS, `${field} must be a finite number`, { path: `/${field}` }));
      return null;
    }
    return zero(v);
  };
  const minimum = bound("minimum");
  const maximum = bound("maximum");
  if (minimum !== null && maximum !== null && minimum > maximum) {
    out.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_BOUNDS, `minimum ${minimum} is greater than maximum ${maximum}`, { path: "/minimum" }));
  }

  const unit = program.unit ?? null;
  if (unit !== null && (typeof unit !== "string" || !FORMULA_UNIT_PATTERN.test(unit))) {
    out.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, "unit must be a short label (a letter, then letters, digits, _ . -; at most 64)", { path: "/unit" }));
  }

  const provenanceProblems = new InputProblems();
  const provenance = readProvenance(program.provenance, ["provenance"], provenanceProblems);
  if (provenanceProblems.count > 0) out.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, "provenance is malformed", { path: "/provenance" }));

  if (out.length > 0 || ast === null) return deepFreeze({ ok: false as const, diagnostics: out });
  return deepFreeze({
    ok: true as const,
    program: { ast, variables, rounding: rounding as FormulaRoundingMode, minimum, maximum, unit: unit as string | null, provenance },
  });
}

/** Internal control-flow signal for a fatal numeric failure; never escapes this module. */
class EvaluationStop {
  constructor(readonly diagnostic: FormulaDiagnostic) {}
}

const OPERATION: Record<string, string> = {
  "u+": "formula.unary_plus",
  "u-": "formula.unary_minus",
  "+": "formula.add",
  "-": "formula.subtract",
  "*": "formula.multiply",
  "/": "formula.divide",
};

/** Evaluates one node, returning its value and its trace step. Recursion depth is bounded by MAX_AST_DEPTH. */
function evaluateNode(node: FormulaNode, key: string, values: ReadonlyMap<string, number>): { value: number; step: TraceStepInput } {
  const finite = (value: number, what: string): number => {
    if (!Number.isFinite(value)) {
      throw new EvaluationStop(diagnostic(FORMULA_DIAGNOSTIC_CODES.NON_FINITE_RESULT, `${what} produced a non-finite value`, { startOffset: node.startOffset, endOffset: node.endOffset, path: "/expression" }));
    }
    return zero(value);
  };
  const step = (operation: string, value: number, children: TraceStepInput[] = [], inputs: TraceInput[] = []): { value: number; step: TraceStepInput } => ({
    value,
    step: { key, operation, inputs, output: numberValue(value), children },
  });

  switch (node.type) {
    case "NUMBER":
      return step("formula.number", zero(node.value));
    case "VARIABLE":
      return step("formula.variable", values.get(node.key) as number, [], [{ name: "key", value: stringValue(node.key) }]);
    case "UNARY": {
      const operand = evaluateNode(node.operand, "operand", values);
      const value = finite(node.operator === "-" ? -operand.value : operand.value, "unary operator");
      return step(OPERATION[`u${node.operator}`] as string, value, [operand.step]);
    }
    case "BINARY": {
      const left = evaluateNode(node.left, "left", values);
      const right = evaluateNode(node.right, "right", values);
      let value: number;
      switch (node.operator) {
        case "+":
          value = left.value + right.value;
          break;
        case "-":
          value = left.value - right.value;
          break;
        case "*":
          value = left.value * right.value;
          break;
        default:
          if (right.value === 0) {
            throw new EvaluationStop(diagnostic(FORMULA_DIAGNOSTIC_CODES.DIVISION_BY_ZERO, "division by zero", { startOffset: node.startOffset, endOffset: node.endOffset, path: "/expression" }));
          }
          value = left.value / right.value;
      }
      return step(OPERATION[node.operator] as string, finite(value, `operator ${node.operator}`), [left.step, right.step]);
    }
    default: {
      const args = node.arguments.map((arg, index) => evaluateNode(arg, `arg.${index}`, values));
      const xs = args.map((a) => a.value);
      let value: number;
      switch (node.name) {
        case "floor":
          value = Math.floor(xs[0] as number);
          break;
        case "ceil":
          value = Math.ceil(xs[0] as number);
          break;
        case "min":
          value = Math.min(...xs);
          break;
        default:
          value = Math.max(...xs);
      }
      return step(`formula.${node.name}`, finite(value, node.name), args.map((a) => a.step));
    }
  }
}

/** Checks the bindings of the referenced variables, in first-reference order. Extra bindings are never inspected. */
function bindVariables(
  ast: FormulaNode,
  variables: readonly string[],
  bindings: unknown,
): { ok: true; values: Map<string, number> } | { ok: false; diagnostics: FormulaDiagnostic[] } {
  if (!isPlainObject(bindings)) {
    return { ok: false, diagnostics: [diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_VARIABLE_VALUE, "bindings must be a plain object of finite numbers", { path: "/bindings" })] };
  }
  const firstSpan = new Map<string, FormulaNode>();
  const stack: FormulaNode[] = [ast];
  while (stack.length > 0) {
    const node = stack.pop() as FormulaNode;
    if (node.type === "VARIABLE" && !firstSpan.has(node.key)) firstSpan.set(node.key, node);
    const children = childrenOf(node);
    for (let k = children.length - 1; k >= 0; k -= 1) stack.push(children[k] as FormulaNode);
  }
  const values = new Map<string, number>();
  const problems: FormulaDiagnostic[] = [];
  for (const key of variables) {
    const at = firstSpan.get(key) as FormulaNode;
    const location = { startOffset: at.startOffset, endOffset: at.endOffset, path: jsonPointer(["bindings", key]) };
    const descriptor = Object.getOwnPropertyDescriptor(bindings, key);
    if (descriptor === undefined) {
      problems.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.MISSING_VARIABLE, `no binding for variable "${key}"`, location));
      continue;
    }
    const value: unknown = descriptor.get === undefined ? descriptor.value : undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_VARIABLE_VALUE, `variable "${key}" must be bound to a finite number`, location));
      continue;
    }
    values.set(key, zero(value));
  }
  return problems.length > 0 ? { ok: false, diagnostics: problems } : { ok: true, values };
}

function toMessages(diagnostics: readonly FormulaDiagnostic[], provenance: RuleProvenance | null): ValidationMessageDraft[] {
  return diagnostics.map((d) =>
    validationMessage({
      severity: "ERROR",
      category: "FORMULA",
      code: d.code,
      message: d.message,
      path: d.path,
      provenance,
      details: { startOffset: d.startOffset, endOffset: d.endOffset },
    }),
  );
}

export interface EvaluateFormulaOptions {
  /** The exact RulesetContext (M4-WO2) the evaluation runs under; recorded as response provenance, never searched. */
  readonly ruleset?: unknown;
}

/** The evaluation kind `evaluateFormula` uses on the M4-WO1 boundary. */
export const FORMULA_EVALUATION_KIND = "formula.evaluate";

/**
 * Evaluates one Formula program against explicit variable bindings (§50). Pure and read-only: no input is mutated, and
 * the result is the M4-WO1 `RuleEngineResponse` — SUCCESS with `FormulaResult` data and a Formula-local trace, or
 * INVALID with structured FORMULA.* validation messages (malformed program, missing / non-numeric variable, division
 * by zero, non-finite result). The caller supplies the exact Formula; nothing here looks one up.
 */
export function evaluateFormula(program: unknown, bindings: unknown, options: EvaluateFormulaOptions = {}): RuleEngineResponse<FormulaResult> {
  return evaluate<FormulaResult | null>(
    {
      kind: FORMULA_EVALUATION_KIND,
      evaluate: () => {
        const validated = validateFormulaProgram(program);
        if (!validated.ok) return { data: null, messages: toMessages(validated.diagnostics, null) };
        const p = validated.program;
        const bound = bindVariables(p.ast, p.variables, bindings);
        if (!bound.ok) return { data: null, messages: toMessages(bound.diagnostics, p.provenance) };

        let expression: { value: number; step: TraceStepInput };
        try {
          expression = evaluateNode(p.ast, "expression", bound.values);
        } catch (error) {
          if (error instanceof EvaluationStop) return { data: null, messages: toMessages([error.diagnostic], p.provenance) };
          throw error;
        }

        const steps: TraceStepInput[] = [expression.step];
        const expressionValue = expression.value;
        const rounded = zero(p.rounding === "FLOOR" ? Math.floor(expressionValue) : p.rounding === "CEIL" ? Math.ceil(expressionValue) : expressionValue);
        if (p.rounding !== "NONE") {
          steps.push({
            key: "rounding",
            operation: `formula.round.${p.rounding.toLowerCase()}`,
            inputs: [{ name: "value", value: numberValue(expressionValue) }],
            output: numberValue(rounded),
          });
        }
        let finalValue = rounded;
        const bounded = (name: "minimum" | "maximum", limit: number | null): FormulaBoundResult | null => {
          if (limit === null) return null;
          const before = finalValue;
          const applied = name === "minimum" ? before < limit : before > limit;
          finalValue = applied ? limit : before;
          steps.push({
            key: name,
            operation: `formula.${name}`,
            inputs: [
              { name: "value", value: numberValue(before) },
              { name: "bound", value: numberValue(limit) },
              { name: "applied", value: booleanValue(applied) },
            ],
            output: numberValue(finalValue),
          });
          return { bound: limit, applied };
        };
        const minimum = bounded("minimum", p.minimum);
        const maximum = bounded("maximum", p.maximum);

        return {
          data: {
            finalValue,
            expressionValue,
            rounding: { mode: p.rounding, value: rounded },
            minimum,
            maximum,
            unit: p.unit,
            variables: p.variables.map((key) => ({ key, value: bound.values.get(key) as number })),
          },
          trace: [
            {
              key: "formula",
              operation: FORMULA_EVALUATION_KIND,
              inputs: p.unit === null ? [] : [{ name: "unit", value: stringValue(p.unit) }],
              output: numberValue(finalValue),
              provenance: p.provenance,
              children: steps,
            },
          ],
        };
      },
    },
    { kind: FORMULA_EVALUATION_KIND, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<FormulaResult>;
}
