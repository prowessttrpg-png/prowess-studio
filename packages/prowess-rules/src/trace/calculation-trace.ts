import { RULE_ENGINE_ERROR_CODES, RulesEngineError } from "../errors/engine-error.js";
import { InputProblems, MAX_TEXT_LENGTH, readContextKey, readOptionalText, readRecord } from "../internal/input-reader.js";
import { isValidContextKey } from "../context/context-key.js";
import { deepFreeze, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { readEvaluationValue, type EvaluationValue } from "../result/evaluation-value.js";
import { readProvenance, type RuleProvenance } from "../result/provenance.js";

/**
 * The common calculation trace contract (PAS-10 M4-WO1 §23–27), rendered later by Studio and explained by M4-WO9.
 * Structured data only: no HTML, no React element, no display formatting (§26).
 *
 * Deterministic identity and order (§24–25, §55) — no random UUID, no timestamp:
 *  - steps are ordered exactly as the evaluator produced them (evaluation order); siblings never get re-sorted
 *  - `key`      evaluator-chosen stable step key, unique among its siblings
 *  - `path`     hierarchical position, 1-based: `"1"`, `"1.2"`, `"1.2.1"`
 *  - `ordinal`  0-based pre-order position across the whole trace
 * So identical evaluation inputs always produce an identical trace, byte for byte once serialized.
 *
 * A step can carry, where known: the generic `operation` and `phase` (context keys — no operation semantics exist
 * yet), ordered named `inputs`, an `output`, the `provenance` of the rule applied, a `modifierSource` (the rule that
 * modified the value, for M4-WO6), a plain-text `explanation`, and child sub-steps.
 */
export interface TraceInput {
  readonly name: string;
  readonly value: EvaluationValue;
}

export interface TraceStep {
  readonly ordinal: number;
  readonly path: string;
  readonly key: string;
  readonly operation: string;
  readonly phase: string | null;
  /** Explicitly ORDERED (operand order can matter); names unique within the step. */
  readonly inputs: readonly TraceInput[];
  readonly output: EvaluationValue | null;
  readonly provenance: RuleProvenance | null;
  readonly modifierSource: RuleProvenance | null;
  /** Plain text for a human reader. Never markup, never the machine contract. */
  readonly explanation: string | null;
  readonly children: readonly TraceStep[];
}

export interface CalculationTrace {
  readonly steps: readonly TraceStep[];
  /** Total number of steps at every depth. */
  readonly stepCount: number;
}

/** What an evaluator supplies for one step; `ordinal` and `path` are assigned when the trace is built. */
export interface TraceStepInput {
  readonly key: string;
  readonly operation: string;
  readonly phase?: string | null;
  readonly inputs?: readonly TraceInput[];
  readonly output?: EvaluationValue | null;
  readonly provenance?: RuleProvenance | null;
  readonly modifierSource?: RuleProvenance | null;
  readonly explanation?: string | null;
  readonly children?: readonly TraceStepInput[];
}

export const EMPTY_TRACE: CalculationTrace = deepFreeze({ steps: [], stepCount: 0 });

const STEP_FIELDS = ["key", "operation", "phase", "inputs", "output", "provenance", "modifierSource", "explanation", "children"];

/**
 * Builds the immutable trace from step inputs, assigning `path` and `ordinal` deterministically. Malformed step input
 * (bad key, duplicate sibling key, non-finite value, unknown field) is an evaluator defect → throws
 * `RULE_ENGINE.INVARIANT_VIOLATION` listing every problem.
 */
export function buildTrace(steps: readonly TraceStepInput[]): CalculationTrace {
  const p = new InputProblems();
  let ordinal = 0;

  const readStep = (value: unknown, at: readonly PathSegment[], parentPath: string, index: number): TraceStep | null => {
    const r = readRecord(value, at, p, STEP_FIELDS, ["key", "operation"]);
    if (r === null) return null;
    const path = parentPath === "" ? String(index + 1) : `${parentPath}.${index + 1}`;
    const stepOrdinal = ordinal;
    ordinal += 1;
    const key = readContextKey(r.key, [...at, "key"], p);
    const operation = readContextKey(r.operation, [...at, "operation"], p);
    const phase = r.phase === undefined || r.phase === null ? null : readContextKey(r.phase, [...at, "phase"], p);

    const inputs: TraceInput[] = [];
    if (r.inputs !== undefined) {
      if (!Array.isArray(r.inputs)) p.invalid([...at, "inputs"], "expected an ordered array of named inputs");
      else {
        const names = new Set<string>();
        r.inputs.forEach((item: unknown, i: number) => {
          const ir = readRecord(item, [...at, "inputs", i], p, ["name", "value"], ["name", "value"]);
          if (ir === null) return;
          const name = readContextKey(ir.name, [...at, "inputs", i, "name"], p);
          const v = readEvaluationValue(ir.value, [...at, "inputs", i, "value"], p);
          if (name !== null && names.has(name)) p.invalid([...at, "inputs", i, "name"], `duplicate input name "${name}"`);
          if (name !== null) names.add(name);
          if (name !== null && v !== null) inputs.push({ name, value: v });
        });
      }
    }
    const output = r.output === undefined || r.output === null ? null : readEvaluationValue(r.output, [...at, "output"], p);
    const provenance = readProvenance(r.provenance, [...at, "provenance"], p);
    const modifierSource = readProvenance(r.modifierSource, [...at, "modifierSource"], p);
    const explanation = readOptionalText(r.explanation, [...at, "explanation"], p, MAX_TEXT_LENGTH);
    const children = readSteps(r.children, [...at, "children"], path);
    if (key === null || operation === null) return null;
    return { ordinal: stepOrdinal, path, key, operation, phase, inputs, output, provenance, modifierSource, explanation, children };
  };

  const readSteps = (value: unknown, at: readonly PathSegment[], parentPath: string): TraceStep[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      p.invalid(at, "expected an ordered array of trace steps");
      return [];
    }
    const out: TraceStep[] = [];
    const keys = new Set<string>();
    value.forEach((item: unknown, i: number) => {
      const step = readStep(item, [...at, i], parentPath, i);
      // Checked on the raw key so a duplicate is reported even when the step has other problems.
      const rawKey: unknown = isPlainObject(item) ? item.key : undefined;
      if (isValidContextKey(rawKey)) {
        if (keys.has(rawKey)) p.invalid([...at, i, "key"], `duplicate sibling step key "${rawKey}"`);
        keys.add(rawKey);
      }
      if (step !== null) out.push(step);
    });
    return out;
  };

  const built = readSteps(steps, ["trace"], "");
  if (p.count > 0) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "an evaluator produced a malformed calculation trace", {
      details: { problems: p.list.map((problem) => ({ path: problem.path ?? null, message: problem.message })) },
    });
  }
  return deepFreeze({ steps: built, stepCount: ordinal });
}

/** Every step of a trace in deterministic pre-order (the `ordinal` order). */
export function flattenTrace(trace: CalculationTrace): TraceStep[] {
  const out: TraceStep[] = [];
  const visit = (steps: readonly TraceStep[]): void => {
    for (const step of steps) {
      out.push(step);
      visit(step.children);
    }
  };
  visit(trace.steps);
  return out;
}
