import type { JsonValue } from "@prowess/model";
import type { RulesetContext } from "../context/ruleset-context.js";
import { evaluate } from "../evaluation/evaluate.js";
import { buildExplanation } from "../explanation/build.js";
import { evaluateFormula } from "../formula/evaluate.js";
import { clonePlainData, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { resolveKeywords } from "../keyword/resolve.js";
import { evaluateModifiers } from "../modifier/evaluate.js";
import { evaluateRequirement } from "../requirement/evaluate.js";
import { isExactLabel } from "../requirement/validate.js";
import { applyResourcePayment, previewResourcePayment } from "../resource/payment.js";
import { refreshResource, releaseResourceCapacity, reserveResourceCapacity, restoreResource, setResourceCurrent, spendResource } from "../resource/transition.js";
import { numberValue, stringValue } from "../result/evaluation-value.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import type { TraceStepInput } from "../trace/calculation-trace.js";
import { evaluateValidation } from "../validation-engine/evaluate.js";
import { validationMessage } from "../validation/validation-message.js";
import {
  ORCHESTRATION_DIAGNOSTIC_CODES,
  type EvaluationBlockedBinding,
  type EvaluationContextFamily,
  type EvaluationOperation,
  type EvaluationRun,
  type EvaluationStepResult,
} from "./model.js";
import { validatePlan, type PlannedStep } from "./plan.js";
import { readAt, writeAt } from "./pointer.js";

/**
 * orchestrateRulesEvaluation (PAS-10 M4-WO10 §10–71, §99–123). Pure. One exact RulesetContext (required) and the
 * optional Actor / Build / Runtime contexts are validated ONCE by the M4-WO1 boundary; every step reads those same
 * frozen contexts and every primitive receives that same `ruleset` — no step can override them.
 *
 * Execution, in order (order, then stepKey):
 *  1. each binding is resolved by EXACT COPY: a context value, or a prior step's response (whole response at `""`, or
 *     a value such as `/data/finalValue`). A missing context, a path that does not exist, or a blocked dependency makes
 *     the value unavailable. `null` at an existing path is a real value.
 *  2. if any binding is unavailable the step is BLOCKED — its primitive never runs; otherwise its detached input gets
 *     the copied values and its primitive runs through a static adapter.
 * Nothing else blocks a step: a child's INVALID response, a false Requirement, canPay:false or a skipped modifier are
 * results, not failures; unrelated later steps always continue. The orchestration response describes the PLAN's
 * validity; each child's own response is stored exactly.
 */

/** The static, closed dispatch: one adapter per operation, each a direct call of one public primitive. */
function dispatch(operation: EvaluationOperation, input: Readonly<Record<string, unknown>>, ruleset: RulesetContext): RuleEngineResponse<unknown> {
  const options = { ruleset };
  switch (operation) {
    case "FORMULA":
      return evaluateFormula(input.program, input.variables, options);
    case "KEYWORD":
      return resolveKeywords(input.contributions, options);
    case "REQUIREMENT":
      return evaluateRequirement(input.requirement, input.facts, options);
    case "MODIFIER":
      return evaluateModifiers(input.request, options);
    case "RESOURCE_SPEND":
      return spendResource(input.snapshot, input.request, options);
    case "RESOURCE_RESTORE":
      return restoreResource(input.snapshot, input.request, options);
    case "RESOURCE_SET_CURRENT":
      return setResourceCurrent(input.snapshot, input.request, options);
    case "RESOURCE_RESERVE_CAPACITY":
      return reserveResourceCapacity(input.snapshot, input.request, options);
    case "RESOURCE_RELEASE_CAPACITY":
      return releaseResourceCapacity(input.snapshot, input.request, options);
    case "RESOURCE_REFRESH":
      return refreshResource(input.snapshot, input.request, options);
    case "RESOURCE_PAYMENT_PREVIEW":
      return previewResourcePayment(input.snapshot, input.payment, options);
    case "RESOURCE_PAYMENT_APPLY":
      return applyResourcePayment(input.snapshot, input.payment, options);
    case "VALIDATION":
      return evaluateValidation(input.request, options);
    case "EXPLANATION":
      return buildExplanation(input.input, options);
  }
}

export interface OrchestrateRulesEvaluationInput {
  readonly evaluationKey: string;
  readonly contexts: {
    /** The exact, already-resolved RulesetContext (resolved server-side; never accepted from a network client). */
    readonly ruleset: unknown;
    readonly actor?: unknown;
    readonly build?: unknown;
    readonly runtime?: unknown;
  };
  readonly plan: unknown;
}

/** The evaluation kind the orchestrator uses on the M4-WO1 boundary. */
export const ORCHESTRATION_EVALUATION_KIND = "rules.orchestrate";

const ownValue = (value: unknown, key: string): unknown => {
  if (!isPlainObject(value)) return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d !== undefined && "value" in d ? d.value : undefined;
};

export function orchestrateRulesEvaluation(input: unknown): RuleEngineResponse<EvaluationRun> {
  const contexts = ownValue(input, "contexts");
  const shapeOk = isPlainObject(input) && Object.keys(input).every((k) => ["evaluationKey", "contexts", "plan"].includes(k)) && isPlainObject(contexts);
  return evaluate<EvaluationRun | null>(
    {
      kind: ORCHESTRATION_EVALUATION_KIND,
      requires: ["RULESET"],
      evaluate: (request) => {
        const invalid = (code: string, message: string, path: readonly (string | number)[]) =>
          validationMessage({ severity: "ERROR", category: "STRUCTURE", code, message, path: jsonPointer(path) });
        const evaluationKey = ownValue(input, "evaluationKey");
        if (!shapeOk || !isExactLabel(evaluationKey) || !isPlainObject(contexts) || !Object.keys(contexts).every((k) => ["ruleset", "actor", "build", "runtime"].includes(k))) {
          return { data: null, messages: [invalid(ORCHESTRATION_DIAGNOSTIC_CODES.INVALID_REQUEST, "the request is { evaluationKey: exact label, contexts: { ruleset, actor?, build?, runtime? }, plan }", [])] };
        }
        const validated = validatePlan(ownValue(input, "plan"));
        if (!validated.ok) return { data: null, messages: validated.problems.map((p) => invalid(p.code, p.message, p.path)) };

        // ONE exact set of contexts for the whole run (frozen and normalized by M4-WO1).
        const ruleset = request.ruleset as RulesetContext;
        const contextOf: Readonly<Record<EvaluationContextFamily, unknown>> = { RULESET: request.ruleset, ACTOR: request.actor, BUILD: request.build, RUNTIME: request.runtime };
        const results = new Map<string, EvaluationStepResult>();
        const steps: EvaluationStepResult[] = [];

        for (const step of validated.plan.steps) {
          const blockedBy: EvaluationBlockedBinding[] = [];
          const values: { tokens: readonly string[]; value: unknown }[] = [];
          for (const b of step.bindings) {
            const block = (reason: EvaluationBlockedBinding["reason"]) => blockedBy.push({ target: b.target, reason, source: b.source });
            if (b.source.kind === "CONTEXT") {
              const root = contextOf[b.source.context];
              if (root === null || root === undefined) {
                block("CONTEXT_UNAVAILABLE");
                continue;
              }
              const found = readAt(root, b.sourceTokens);
              if (found.found) values.push({ tokens: b.targetTokens, value: found.value });
              else block("REFERENCE_NOT_FOUND");
              continue;
            }
            const prior = results.get(b.source.stepKey) as EvaluationStepResult;
            if (prior.response === null) {
              block("DEPENDENCY_BLOCKED");
              continue;
            }
            const found = readAt(prior.response, b.sourceTokens);
            if (found.found) values.push({ tokens: b.targetTokens, value: found.value });
            else block("DEPENDENCY_VALUE_UNAVAILABLE");
          }
          const result: EvaluationStepResult =
            blockedBy.length > 0
              ? { stepKey: step.stepKey, order: step.order, operation: step.operation, executionStatus: "BLOCKED", response: null, blockedBy }
              : { stepKey: step.stepKey, order: step.order, operation: step.operation, executionStatus: "EXECUTED", response: run(step, values, ruleset), blockedBy: [] };
          results.set(step.stepKey, result);
          steps.push(result);
        }

        const runData: EvaluationRun = {
          evaluationKey,
          executionStatus: steps.every((s) => s.executionStatus === "EXECUTED") ? "COMPLETE" : "PARTIAL",
          primaryStepKey: validated.plan.primaryStepKey,
          validationStepKey: validated.plan.validationStepKey,
          explanationStepKey: validated.plan.explanationStepKey,
          steps,
        };
        const trace: TraceStepInput[] = [
          {
            key: "orchestration",
            operation: ORCHESTRATION_EVALUATION_KIND,
            children: steps.map((s, i) => ({
              key: `step.${i}`,
              operation: "orchestration.step",
              inputs: [
                { name: "step_key", value: stringValue(s.stepKey) },
                { name: "operation", value: stringValue(s.operation) },
                { name: "execution_status", value: stringValue(s.executionStatus) },
                { name: "bindings", value: numberValue((validated.plan.steps[i] as PlannedStep).bindings.length) },
                ...(s.response === null ? [] : [{ name: "response_status", value: stringValue(s.response.status) }]),
              ],
            })),
          },
        ];
        return { data: runData, trace };
      },
    },
    { kind: ORCHESTRATION_EVALUATION_KIND, ruleset: ownValue(contexts, "ruleset"), actor: ownValue(contexts, "actor"), build: ownValue(contexts, "build"), runtime: ownValue(contexts, "runtime") },
  ) as RuleEngineResponse<EvaluationRun>;
}

/** Applies the exact copied values to a DETACHED copy of the template and runs the step's primitive. */
function run(step: PlannedStep, values: readonly { tokens: readonly string[]; value: unknown }[], ruleset: RulesetContext): RuleEngineResponse<JsonValue> {
  const input = clonePlainData(step.input) as Record<string, unknown>;
  for (const { tokens, value } of values) writeAt(input, tokens, clonePlainData(value));
  return dispatch(step.operation, input, ruleset) as RuleEngineResponse<JsonValue>;
}
