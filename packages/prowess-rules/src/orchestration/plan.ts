import { canonicalJson } from "../internal/canonical-json.js";
import { clonePlainData, hasUnsafeDataProperties, inspectPlainData, isPlainObject } from "../internal/plain-data.js";
import { isExactLabel } from "../requirement/validate.js";
import {
  EVALUATION_CONTEXT_FAMILIES,
  EVALUATION_OPERATIONS,
  EVALUATION_OPERATION_INPUT_FIELDS,
  ORCHESTRATION_DIAGNOSTIC_CODES,
  ORCHESTRATION_LIMITS,
  type EvaluationContextFamily,
  type EvaluationOperation,
  type EvaluationReference,
  type OrchestrationDiagnosticCode,
} from "./model.js";
import { isWritableTarget, overlaps, parsePointer } from "./pointer.js";

/**
 * Static plan validation (PAS-10 M4-WO10 §14–35, §44, §102, §140). EVERYTHING statically knowable is checked BEFORE
 * any step runs, and every problem is reported:
 *
 *  - plan / step / binding shape (plain data only — no functions, getters, prototypes, cycles; no step-level context
 *    or Ruleset override field exists, so one is rejected as an unknown field)
 *  - exact step identity (identical duplicates collapse; conflicting ones fail closed)
 *  - the closed operation vocabulary and each operation's named input fields
 *  - binding targets: safe pointers into an existing position of the step's own input, never the root, no two
 *    targets equal or nested in one another (no last-write-wins)
 *  - references: safe pointers; a STEP reference must name a step that runs STRICTLY EARLIER — so self references,
 *    forward references and therefore dependency cycles are impossible by construction
 *  - designations (primary / validation / explanation) and limits
 */
export interface PlannedBinding {
  readonly target: string;
  readonly targetTokens: readonly string[];
  readonly source: EvaluationReference;
  readonly sourceTokens: readonly string[];
}

export interface PlannedStep {
  readonly stepKey: string;
  readonly order: number;
  readonly operation: EvaluationOperation;
  /** A detached clone of the caller's template. */
  readonly input: Record<string, unknown>;
  /** Canonical order: by target (code units). */
  readonly bindings: readonly PlannedBinding[];
}

export interface ValidatedPlan {
  /** Execution order: order, then stepKey (code units). */
  readonly steps: readonly PlannedStep[];
  readonly primaryStepKey: string | null;
  readonly validationStepKey: string | null;
  readonly explanationStepKey: string | null;
}

export interface PlanProblem {
  readonly code: OrchestrationDiagnosticCode;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A plain object whose keys are all own data properties within `allowed` (getters are never invoked). */
function ownRecord(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value) || hasUnsafeDataProperties(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const disallowed = Object.keys(value).filter((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return !allowed.includes(k) || d === undefined || d.get !== undefined || d.set !== undefined;
  });
  return disallowed.length === 0;
}

function safelyPlain(value: unknown): boolean {
  try {
    return inspectPlainData(value).length === 0;
  } catch {
    return false;
  }
}

const PLAN_FIELDS = ["steps", "primaryStepKey", "validationStepKey", "explanationStepKey"];
const STEP_FIELDS = ["stepKey", "order", "operation", "input", "bindings"];

export function validatePlan(plan: unknown): { ok: true; plan: ValidatedPlan } | { ok: false; problems: readonly PlanProblem[] } {
  const problems: PlanProblem[] = [];
  const report = (code: OrchestrationDiagnosticCode, message: string, path: readonly (string | number)[]) => problems.push({ code, message, path });
  const fail = () => ({ ok: false as const, problems });

  if (!ownRecord(plan, PLAN_FIELDS) || !Array.isArray(plan.steps)) {
    report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_PLAN, `a plan is a plain { ${PLAN_FIELDS.join(", ")} } with a steps array`, ["plan"]);
    return fail();
  }
  if (plan.steps.length > ORCHESTRATION_LIMITS.MAX_STEPS) {
    report(ORCHESTRATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `a plan may have at most ${ORCHESTRATION_LIMITS.MAX_STEPS} steps`, ["plan", "steps"]);
    return fail();
  }
  if (hasUnsafeDataProperties(plan.steps)) {
    report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_PLAN, "step arrays require own plain data entries only", ["plan", "steps"]);
    return fail();
  }
  let totalBindings = 0;
  const read: (PlannedStep & { signature: string; at: (string | number)[] })[] = [];

  plan.steps.forEach((s: unknown, i: number) => {
    const at = ["plan", "steps", i];
    if (!ownRecord(s, STEP_FIELDS) || !isExactLabel(s.stepKey) || typeof s.order !== "number" || !Number.isSafeInteger(s.order)) {
      return void report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_STEP, `a step is { ${STEP_FIELDS.join(", ")} } with an exact stepKey and integer order (no step-level context)`, at);
    }
    if (!(EVALUATION_OPERATIONS as readonly unknown[]).includes(s.operation)) {
      return void report(ORCHESTRATION_DIAGNOSTIC_CODES.UNKNOWN_OPERATION, `operation must be one of ${EVALUATION_OPERATIONS.join(", ")}`, [...at, "operation"]);
    }
    const operation = s.operation as EvaluationOperation;
    const allowed = EVALUATION_OPERATION_INPUT_FIELDS[operation];
    if (!ownRecord(s.input, allowed) || !safelyPlain(s.input)) {
      return void report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_INPUT, `${operation} input is a plain-data object with only ${allowed.join(", ")}`, [...at, "input"]);
    }
    const rawBindings: unknown = s.bindings ?? [];
    if (!Array.isArray(rawBindings)) return void report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_BINDING, "bindings must be an array", [...at, "bindings"]);
    if (rawBindings.length > ORCHESTRATION_LIMITS.MAX_BINDINGS_PER_STEP) {
      return void report(ORCHESTRATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `a step may have at most ${ORCHESTRATION_LIMITS.MAX_BINDINGS_PER_STEP} bindings`, [...at, "bindings"]);
    }
    totalBindings += rawBindings.length;

    if (hasUnsafeDataProperties(rawBindings)) {
      return void report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_BINDING, "binding arrays require own plain data entries only", [...at, "bindings"]);
    }
    const bindings: PlannedBinding[] = [];
    let stepOk = true;
    rawBindings.forEach((b: unknown, j: number) => {
      const bat = [...at, "bindings", j];
      const bad = (code: OrchestrationDiagnosticCode, message: string, path = bat) => {
        stepOk = false;
        report(code, message, path);
      };
      if (!ownRecord(b, ["target", "source"])) return bad(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_BINDING, "a binding is { target, source } — no transform, expression or callback");
      const targetTokens = parsePointer(b.target);
      if (targetTokens === null || targetTokens.length === 0) return bad(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_POINTER, "target must be a safe non-root JSON Pointer", [...bat, "target"]);
      if (!allowed.includes(targetTokens[0] as string) || !isWritableTarget(s.input, targetTokens)) {
        return bad(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_POINTER, "target must address an existing position inside this step's input (its parent must exist)", [...bat, "target"]);
      }
      const src = b.source;
      let source: EvaluationReference;
      if (ownRecord(src, ["kind", "context", "pointer"]) && src.kind === "CONTEXT" && (EVALUATION_CONTEXT_FAMILIES as readonly unknown[]).includes(src.context)) {
        source = { kind: "CONTEXT", context: src.context as EvaluationContextFamily, pointer: src.pointer as string };
      } else if (ownRecord(src, ["kind", "stepKey", "pointer"]) && src.kind === "STEP" && isExactLabel(src.stepKey)) {
        source = { kind: "STEP", stepKey: src.stepKey, pointer: src.pointer as string };
      } else {
        return bad(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_BINDING, "source is { kind: CONTEXT, context, pointer } or { kind: STEP, stepKey, pointer }", [...bat, "source"]);
      }
      const sourceTokens = parsePointer(source.pointer);
      if (sourceTokens === null) return bad(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_POINTER, "source pointer must be a safe JSON Pointer (\"\" is the root)", [...bat, "source", "pointer"]);
      bindings.push({ target: b.target as string, targetTokens, source, sourceTokens });
    });

    // Exact targets: none equal, none nested in another (no last-write-wins).
    const sorted = [...bindings].sort((x, y) => byCodeUnit(x.target, y.target));
    for (let a = 0; a < sorted.length; a += 1) {
      for (let c = a + 1; c < sorted.length && (sorted[c] as PlannedBinding).target.startsWith((sorted[a] as PlannedBinding).target); c += 1) {
        if (overlaps((sorted[a] as PlannedBinding).targetTokens, (sorted[c] as PlannedBinding).targetTokens)) {
          stepOk = false;
          report(ORCHESTRATION_DIAGNOSTIC_CODES.BINDING_TARGET_CONFLICT, `targets "${(sorted[a] as PlannedBinding).target}" and "${(sorted[c] as PlannedBinding).target}" overlap`, [...at, "bindings"]);
        }
      }
    }
    if (!stepOk) return;
    read.push({
      stepKey: s.stepKey as string,
      order: s.order as number,
      operation,
      input: clonePlainData(s.input) as Record<string, unknown>,
      bindings: sorted,
      signature: canonicalJson({ order: s.order, operation, input: s.input, bindings: sorted.map((x) => ({ target: x.target, source: x.source })) }),
      at,
    });
  });
  if (totalBindings > ORCHESTRATION_LIMITS.MAX_TOTAL_BINDINGS) {
    report(ORCHESTRATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `a plan may have at most ${ORCHESTRATION_LIMITS.MAX_TOTAL_BINDINGS} bindings`, ["plan", "steps"]);
  }

  // Exact step identity, sorted: identical collapse, conflicting fail closed.
  const groups = new Map<string, typeof read>();
  for (const r of read) groups.set(r.stepKey, [...(groups.get(r.stepKey) ?? []), r]);
  const unique: typeof read = [];
  for (const key of [...groups.keys()].sort(byCodeUnit)) {
    const members = groups.get(key) as typeof read;
    if (new Set(members.map((m) => m.signature)).size > 1) report(ORCHESTRATION_DIAGNOSTIC_CODES.DUPLICATE_STEP, `stepKey "${key}" is supplied with conflicting content`, ["plan", "steps"]);
    else unique.push(members[0] as (typeof read)[number]);
  }

  // Execution order; then references may only point strictly backwards (no self / forward reference, no cycle).
  const ordered = unique.sort((a, b) => a.order - b.order || byCodeUnit(a.stepKey, b.stepKey));
  const position = new Map(ordered.map((s, i) => [s.stepKey, i]));
  ordered.forEach((s, i) => {
    for (const b of s.bindings) {
      if (b.source.kind !== "STEP") continue;
      const p = position.get(b.source.stepKey);
      if (p === undefined) report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_REFERENCE, `step "${s.stepKey}" references unknown step "${b.source.stepKey}"`, [...s.at, "bindings"]);
      else if (p >= i) report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_REFERENCE, `step "${s.stepKey}" references "${b.source.stepKey}", which does not run earlier (self / forward references are impossible)`, [...s.at, "bindings"]);
    }
  });

  const designation = (field: "primaryStepKey" | "validationStepKey" | "explanationStepKey", operation: EvaluationOperation | null): string | null => {
    const v = plan[field];
    if (v === undefined || v === null) return null;
    const step = typeof v === "string" ? ordered.find((s) => s.stepKey === v) : undefined;
    if (step === undefined) {
      report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_DESIGNATION, `${field} must name a step of this plan`, ["plan", field]);
      return null;
    }
    if (operation !== null && step.operation !== operation) report(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_DESIGNATION, `${field} must name a ${operation} step`, ["plan", field]);
    return v as string;
  };
  const primaryStepKey = designation("primaryStepKey", null);
  const validationStepKey = designation("validationStepKey", "VALIDATION");
  const explanationStepKey = designation("explanationStepKey", "EXPLANATION");

  if (problems.length > 0) return fail();
  return {
    ok: true,
    plan: {
      steps: ordered.map(({ signature: _s, at: _a, ...step }) => (void [_s, _a], step)),
      primaryStepKey,
      validationStepKey,
      explanationStepKey,
    },
  };
}
