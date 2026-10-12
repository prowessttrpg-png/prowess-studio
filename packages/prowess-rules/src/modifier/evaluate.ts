import { evaluate } from "../evaluation/evaluate.js";
import { canonicalJson } from "../internal/canonical-json.js";
import { isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { numberValue, stringValue } from "../result/evaluation-value.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import { evaluateValidatedRequirement, prepareRequirementFacts, type PreparedRequirementFacts } from "../requirement/evaluate.js";
import type { TraceInput, TraceStepInput } from "../trace/calculation-trace.js";
import { validationMessage, type ValidationCategory } from "../validation/validation-message.js";
import {
  MODIFIER_DIAGNOSTIC_CODES,
  type ModifierDefinition,
  type ModifierDiagnostic,
  type ModifierEvaluationResult,
  type ModifierOperation,
  type ModifierOutcome,
  type ModifierTarget,
  type ModifierTargetState,
  type ModifierValue,
} from "./model.js";
import { validateModifiersWithIndex } from "./validate.js";

/**
 * Modifier evaluation (PAS-10 M4-WO6 §16–33, §43–60, §88–92).
 *
 *  1. validate the request (targets, modifiers, conditions' structure) — any problem → INVALID
 *  2. evaluate EVERY modifier condition through M4-WO5 against facts prepared once — an invalid condition anywhere →
 *     INVALID; a false condition is a normal SKIPPED_CONDITION outcome, never a diagnostic
 *  3. resolve UNIQUE stacking among applicable modifiers — identical duplicates collapse (DEDUPLICATED), different ones
 *     are a STACKING_CONFLICT; there is no strongest / highest / latest winner
 *  4. apply the applicable modifiers one by one in the explicit order (phaseOrder, priority, order, modifierKey),
 *     recording before / after for each — no rounding, no percentage combining, no dice semantics
 *
 * Read-only: no target, modifier, fact, KeywordSet or context is changed; nothing is paid, spent or reserved.
 */

const OPERATION_NAMES: Readonly<Record<ModifierOperation, string>> = {
  ADD: "modifier.add",
  SUBTRACT: "modifier.subtract",
  MULTIPLY: "modifier.multiply",
  DIVIDE: "modifier.divide",
  SET: "modifier.set",
  MIN: "modifier.min",
  MAX: "modifier.max",
  INCREASE_PERCENT: "modifier.increase_percent",
  REDUCE_PERCENT: "modifier.reduce_percent",
  STEP_UP: "modifier.step_up",
  STEP_DOWN: "modifier.step_down",
  ADVANTAGE: "modifier.advantage",
  DISADVANTAGE: "modifier.disadvantage",
};

const CATEGORY: Readonly<Record<string, ValidationCategory>> = {
  [MODIFIER_DIAGNOSTIC_CODES.INVALID_CONDITION]: "REQUIREMENT",
  [MODIFIER_DIAGNOSTIC_CODES.INVALID_OPERAND]: "PARAMETER",
  [MODIFIER_DIAGNOSTIC_CODES.DIVISION_BY_ZERO]: "PARAMETER",
  [MODIFIER_DIAGNOSTIC_CODES.NON_FINITE_RESULT]: "PARAMETER",
  [MODIFIER_DIAGNOSTIC_CODES.STEP_OUT_OF_RANGE]: "PARAMETER",
};

const zero = (n: number) => (Object.is(n, -0) ? 0 : n);
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure arithmetic for one numeric operation. Exactly the documented formula; nothing rounds. */
function numeric(operation: ModifierOperation, current: number, operand: number): number {
  switch (operation) {
    case "ADD":
      return current + operand;
    case "SUBTRACT":
      return current - operand;
    case "MULTIPLY":
      return current * operand;
    case "DIVIDE":
      return current / operand;
    case "SET":
      return operand;
    case "MIN":
      return Math.min(current, operand);
    case "MAX":
      return Math.max(current, operand);
    case "INCREASE_PERCENT":
      return current * (1 + operand / 100);
    default:
      return current * (1 - operand / 100);
  }
}

/** Mutable per-target working state — internal to one evaluation, never exposed. */
type Working =
  | { kind: "NUMERIC"; value: number; failed: boolean }
  | { kind: "ORDERED"; position: number; steps: readonly string[]; boundaryPolicy: "CLAMP" | "INVALID"; failed: boolean }
  | { kind: "ROLL_SIGNAL"; advantage: string[]; disadvantage: string[]; failed: boolean };

const valueOf = (w: Working): ModifierValue =>
  w.kind === "NUMERIC" ? w.value : w.kind === "ORDERED" ? (w.steps[w.position] as string) : { advantage: w.advantage.length, disadvantage: w.disadvantage.length };

const traceValue = (v: ModifierValue): TraceInput["value"] => (typeof v === "number" ? numberValue(v) : typeof v === "string" ? stringValue(v) : stringValue(`advantage:${v.advantage} disadvantage:${v.disadvantage}`));

function toMessages(diagnostics: readonly ModifierDiagnostic[]) {
  return diagnostics.map((d) =>
    validationMessage({
      severity: "ERROR",
      category: CATEGORY[d.code] ?? "STRUCTURE",
      code: d.code,
      message: d.message,
      path: d.path,
      provenance: d.provenance,
      details: { modifierKey: d.modifierKey, requirementCode: d.requirementCode },
    }),
  );
}

export interface EvaluateModifiersOptions {
  /** The exact RulesetContext the evaluation runs under; recorded as response provenance, never searched. */
  readonly ruleset?: unknown;
}

/** The evaluation kind `evaluateModifiers` uses on the M4-WO1 boundary. */
export const MODIFIER_EVALUATION_KIND = "modifier.evaluate";

/**
 * Evaluates `{ targets, modifiers, facts? }` (§58). SUCCESS carries the initial targets, final targets and every
 * modifier's outcome in application order; INVALID carries MODIFIER.* diagnostics. Facts are only needed by
 * conditions; they are the M4-WO5 RequirementFacts input.
 */
export function evaluateModifiers(request: unknown, options: EvaluateModifiersOptions = {}): RuleEngineResponse<ModifierEvaluationResult> {
  return evaluate<ModifierEvaluationResult | null>(
    {
      kind: MODIFIER_EVALUATION_KIND,
      evaluate: () => {
        const validated = validateModifiersWithIndex(request);
        if (!validated.ok) return { data: null, messages: toMessages(validated.diagnostics) };
        const { targets, modifiers } = validated.request;
        const at = (m: ModifierDefinition) => ["modifiers", validated.inputIndex.get(m.modifierKey) as number];
        const rawFacts = isPlainObject(request) ? (Object.getOwnPropertyDescriptor(request, "facts")?.value as unknown) : undefined;

        // 2. Conditions: facts prepared once; every condition evaluated, in application order.
        const diagnostics: ModifierDiagnostic[] = [];
        let prepared: PreparedRequirementFacts | null = null;
        if (rawFacts !== undefined || modifiers.some((m) => m.condition !== null)) {
          const p = prepareRequirementFacts(rawFacts ?? {}, ["facts"]);
          if (p.ok) prepared = p.prepared;
          else
            for (const d of p.diagnostics) {
              diagnostics.push({ code: MODIFIER_DIAGNOSTIC_CODES.INVALID_CONDITION, message: d.message, path: d.path, modifierKey: null, requirementCode: d.code, provenance: null });
            }
        }
        const conditionSatisfied = new Map<string, boolean>();
        const conditionStep = new Map<string, TraceStepInput>();
        if (prepared !== null) {
          for (const m of modifiers) {
            if (m.condition === null) continue;
            const r = evaluateValidatedRequirement(m.condition, prepared, [...at(m), "condition"]);
            conditionStep.set(m.modifierKey, r.step);
            if (r.evaluation !== null) conditionSatisfied.set(m.modifierKey, r.evaluation.satisfied);
            for (const d of r.diagnostics) {
              diagnostics.push({ code: MODIFIER_DIAGNOSTIC_CODES.INVALID_CONDITION, message: d.message, path: d.path, modifierKey: m.modifierKey, requirementCode: d.code, provenance: d.provenance });
            }
          }
        }
        if (diagnostics.length > 0) return { data: null, messages: toMessages(diagnostics) };
        const applicable = (m: ModifierDefinition) => m.condition === null || conditionSatisfied.get(m.modifierKey) === true;

        // 3. UNIQUE stacking among applicable modifiers: identical content (all but modifierKey) collapses; different conflicts.
        const deduplicatedBy = new Map<string, string>();
        const groups = new Map<string, ModifierDefinition[]>();
        for (const m of modifiers) {
          if (m.stacking.policy !== "UNIQUE" || !applicable(m)) continue;
          groups.set(m.stacking.stackingKey, [...(groups.get(m.stacking.stackingKey) ?? []), m]);
        }
        for (const stackingKey of [...groups.keys()].sort(byCodeUnit)) {
          const members = groups.get(stackingKey) as ModifierDefinition[];
          // Identity of content: every field except the modifierKey itself.
          const signatures = new Set(members.map((m) => canonicalJson(Object.fromEntries(Object.entries(m).filter(([field]) => field !== "modifierKey")))));
          if (signatures.size > 1) {
            diagnostics.push({
              code: MODIFIER_DIAGNOSTIC_CODES.STACKING_CONFLICT,
              message: `UNIQUE stackingKey "${stackingKey}" is claimed by different applicable modifiers: ${members.map((m) => m.modifierKey).join(", ")}`,
              path: jsonPointer(["modifiers"]),
              modifierKey: null,
              requirementCode: null,
              provenance: null,
            });
            continue;
          }
          const [first, ...duplicates] = members; // application order: the first applies
          for (const d of duplicates) deduplicatedBy.set(d.modifierKey, (first as ModifierDefinition).modifierKey);
        }
        if (diagnostics.length > 0) return { data: null, messages: toMessages(diagnostics) };

        // 4. Apply in the explicit order.
        const state = new Map<string, Working>(
          targets.map((t): [string, Working] =>
            t.kind === "NUMERIC"
              ? [t.targetKey, { kind: "NUMERIC", value: t.value, failed: false }]
              : t.kind === "ORDERED"
                ? [t.targetKey, { kind: "ORDERED", position: t.steps.indexOf(t.currentKey), steps: t.steps, boundaryPolicy: t.boundaryPolicy, failed: false }]
                : [t.targetKey, { kind: "ROLL_SIGNAL", advantage: [], disadvantage: [], failed: false }],
          ),
        );
        const outcomes: ModifierOutcome[] = [];
        for (const m of modifiers) {
          const w = state.get(m.targetKey) as Working;
          if (w.failed) continue;
          const before = valueOf(w);
          const status = !applicable(m) ? "SKIPPED_CONDITION" : deduplicatedBy.has(m.modifierKey) ? "DEDUPLICATED" : "APPLIED";
          if (status === "APPLIED") {
            const failHere = (code: ModifierDiagnostic["code"], message: string) => {
              w.failed = true;
              diagnostics.push({ code, message, path: jsonPointer(at(m)), modifierKey: m.modifierKey, requirementCode: null, provenance: m.provenance });
            };
            if (w.kind === "NUMERIC") {
              const next = numeric(m.operation, w.value, m.operand as number);
              if (!Number.isFinite(next)) failHere(MODIFIER_DIAGNOSTIC_CODES.NON_FINITE_RESULT, `${m.operation} on "${m.targetKey}" produced a non-finite value`);
              else w.value = zero(next);
            } else if (w.kind === "ORDERED") {
              const target = w.position + (m.operation === "STEP_UP" ? 1 : -1) * (m.operand as number);
              const last = w.steps.length - 1;
              if (target >= 0 && target <= last) w.position = target;
              else if (w.boundaryPolicy === "CLAMP") w.position = target < 0 ? 0 : last;
              else failHere(MODIFIER_DIAGNOSTIC_CODES.STEP_OUT_OF_RANGE, `${m.operation} ${String(m.operand)} leaves the ladder of "${m.targetKey}" (boundaryPolicy INVALID)`);
            } else if (m.operation === "ADVANTAGE") w.advantage.push(m.modifierKey);
            else w.disadvantage.push(m.modifierKey);
            if (w.failed) continue;
          }
          outcomes.push({
            modifierKey: m.modifierKey,
            targetKey: m.targetKey,
            operation: m.operation,
            operand: m.operand,
            phase: m.phase,
            priority: m.priority,
            order: m.order,
            status,
            before,
            after: valueOf(w),
            condition: m.condition === null ? null : { satisfied: conditionSatisfied.get(m.modifierKey) === true },
            deduplicatedBy: deduplicatedBy.get(m.modifierKey) ?? null,
            stacking: m.stacking,
            source: m.source,
            provenance: m.provenance,
          });
        }
        if (diagnostics.length > 0) return { data: null, messages: toMessages(diagnostics) };

        const finalTargets: ModifierTargetState[] = targets.map((t) => {
          const w = state.get(t.targetKey) as Working;
          if (w.kind === "NUMERIC") return { targetKey: t.targetKey, kind: "NUMERIC", value: w.value };
          if (w.kind === "ORDERED") return { targetKey: t.targetKey, kind: "ORDERED", currentKey: w.steps[w.position] as string, position: w.position };
          return { targetKey: t.targetKey, kind: "ROLL_SIGNAL", advantage: [...w.advantage], disadvantage: [...w.disadvantage] };
        });
        return { data: { initialTargets: targets, finalTargets, outcomes }, trace: traceOf(targets, finalTargets, outcomes, conditionStep) };
      },
    },
    { kind: MODIFIER_EVALUATION_KIND, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<ModifierEvaluationResult>;
}

/** Trace: per target (targetKey order) → per phase (phase order) → modifiers in exact application order. */
function traceOf(
  targets: readonly ModifierTarget[],
  finals: readonly ModifierTargetState[],
  outcomes: readonly ModifierOutcome[],
  conditionStep: ReadonlyMap<string, TraceStepInput>,
): TraceStepInput[] {
  return [
    {
      key: "modifiers",
      operation: MODIFIER_EVALUATION_KIND,
      children: targets.map((t, ti) => {
        const mine = outcomes.filter((o) => o.targetKey === t.targetKey);
        const phases: { phaseKey: string; phaseOrder: number; items: ModifierOutcome[] }[] = [];
        for (const o of mine) {
          const lastPhase = phases[phases.length - 1];
          if (lastPhase !== undefined && lastPhase.phaseKey === o.phase.phaseKey) lastPhase.items.push(o);
          else phases.push({ phaseKey: o.phase.phaseKey, phaseOrder: o.phase.phaseOrder, items: [o] });
        }
        const final = finals[ti] as ModifierTargetState;
        const initial: ModifierValue = t.kind === "NUMERIC" ? t.value : t.kind === "ORDERED" ? t.currentKey : { advantage: 0, disadvantage: 0 };
        const finalValue: ModifierValue = final.kind === "NUMERIC" ? final.value : final.kind === "ORDERED" ? final.currentKey : { advantage: final.advantage.length, disadvantage: final.disadvantage.length };
        return {
          key: `target.${ti}`,
          operation: "modifier.target",
          inputs: [
            { name: "target_key", value: stringValue(t.targetKey) },
            { name: "initial", value: traceValue(initial) },
          ],
          output: traceValue(finalValue),
          children: phases.map((p, pi) => ({
            key: `phase.${pi}`,
            operation: "modifier.phase",
            inputs: [
              { name: "phase_key", value: stringValue(p.phaseKey) },
              { name: "phase_order", value: numberValue(p.phaseOrder) },
            ],
            children: p.items.map((o, oi) => {
              const condition = conditionStep.get(o.modifierKey);
              return {
                key: `modifier.${oi}`,
                operation: OPERATION_NAMES[o.operation],
                inputs: [
                  { name: "modifier_key", value: stringValue(o.modifierKey) },
                  { name: "status", value: stringValue(o.status) },
                  { name: "before", value: traceValue(o.before) },
                  ...(o.operand === null ? [] : [{ name: "operand", value: numberValue(o.operand) }]),
                ],
                output: traceValue(o.after),
                provenance: o.provenance,
                ...(condition === undefined ? {} : { children: [condition] }),
              };
            }),
          })),
        };
      }),
    },
  ];
}
