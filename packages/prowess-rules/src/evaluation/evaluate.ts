import { isValidContextKey } from "../context/context-key.js";
import { CONTEXT_FAMILIES, readEvaluationRequest, suppliedContextFamilies, type ContextFamily, type EvaluationRequest } from "../context/evaluation-request.js";
import { RULE_ENGINE_ERROR_CODES, RulesEngineError, toEngineErrors, type EngineErrorInput } from "../errors/engine-error.js";
import { InputProblems } from "../internal/input-reader.js";
import { clonePlainData, deepFreeze, inspectPlainData, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { rulesetProvenanceOf, type RulesetProvenance } from "../result/provenance.js";
import { assembleResponse, type RuleEngineResponse, type RuleMessage } from "../result/rule-engine-response.js";
import { buildTrace, EMPTY_TRACE, type CalculationTrace, type TraceStepInput } from "../trace/calculation-trace.js";
import { validationMessage, type ValidationMessageDraft } from "../validation/validation-message.js";

/**
 * The generic pure evaluation boundary (PAS-10 M4-WO1 §3, §14, §39, §49).
 *
 * Every later engine subsystem (Formula, Requirement, Modifier, Resource, Validation) plugs an `EvaluationDefinition`
 * into `evaluate` instead of inventing its own request, response, message or trace handling. `evaluate` is a plain
 * function — no engine class, no registry, no global or module-level mutable state (§39–40, §77):
 *
 *  1. reads and normalizes the caller's request (structure only); a malformed request → ERROR (`INVALID_INPUT` /
 *     `NON_FINITE_NUMBER`) and the evaluator never runs
 *  2. checks the request's kind and the context families the definition requires → `MISSING_CONTEXT`
 *  3. deep-freezes the normalized request and hands it to the evaluator: the evaluator works on a detached, immutable
 *     copy, so neither the caller's input nor the rules can be mutated (§14, §49) — evaluation is PREVIEW only
 *  4. checks the evaluator's output (plain serializable data, well-formed messages and trace), numbers every message
 *     in emission order and derives the status
 *
 * A `RulesEngineError` thrown by the evaluator becomes an ERROR response. Any OTHER exception is a defect and is
 * re-thrown unchanged — it is never disguised as an engine error or as rule invalidity.
 *
 * Nothing here reads a clock, draws a random number, touches the network, a database or a file, or executes authored
 * text (§28–31, §84). The same input always yields a deep-equal response.
 */
export interface EvaluatorOutput<T> {
  readonly data: T;
  readonly messages?: readonly ValidationMessageDraft[];
  readonly trace?: readonly TraceStepInput[];
}

export interface EvaluationDefinition<T> {
  /** The evaluation kind this definition handles; a request of another kind is rejected. */
  readonly kind: string;
  /** Context families the evaluator cannot run without. Others may be absent (null). */
  readonly requires?: readonly ContextFamily[];
  /** The pure evaluator. Receives a frozen, normalized request; must return plain data. */
  readonly evaluate: (request: EvaluationRequest) => EvaluatorOutput<T>;
}

function engineFailure<T>(errors: readonly EngineErrorInput[], evaluationKind: string | null, ruleset: RulesetProvenance | null): RuleEngineResponse<T> {
  return deepFreeze(
    assembleResponse<T>({ evaluationKind, messages: toEngineErrors(errors), data: null, trace: EMPTY_TRACE, ruleset }),
  );
}

function invariantError(message: string, details: EngineErrorInput["details"] = null): EngineErrorInput {
  return { code: RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, message, path: null, details };
}

function checkDefinition(definition: EvaluationDefinition<unknown>): EngineErrorInput | null {
  if (definition === null || typeof definition !== "object") return invariantError("evaluation definition is not an object");
  if (!isValidContextKey(definition.kind)) return invariantError("evaluation definition has an invalid kind");
  if (typeof definition.evaluate !== "function") return invariantError("evaluation definition has no evaluate function");
  const requires = definition.requires ?? [];
  if (!Array.isArray(requires) || requires.some((f) => !(CONTEXT_FAMILIES as readonly string[]).includes(f))) {
    return invariantError("evaluation definition requires an unknown context family");
  }
  return null;
}

function checkOutput<T>(output: unknown): { data: T; messages: ValidationMessageDraft[]; trace: CalculationTrace } {
  if (!isPlainObject(output) || !("data" in output)) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "the evaluator returned no { data } output");
  }
  const unknownFields = Object.keys(output).filter((k) => !["data", "messages", "trace"].includes(k)).sort();
  if (unknownFields.length > 0) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "the evaluator returned unknown output fields", { details: { unknownFields } });
  }
  const dataProblems = inspectPlainData(output.data, ["data"]);
  if (output.data === undefined || dataProblems.length > 0) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "the evaluator returned data that is not plain serializable data", {
      details: { problems: dataProblems.map((d) => ({ path: d.path, reason: d.reason })) },
    });
  }
  const rawMessages: unknown = output.messages ?? [];
  if (!Array.isArray(rawMessages)) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "the evaluator returned messages that are not an array");
  }
  // Re-check every message: a draft is only a type, and an evaluator could have built one by hand.
  const messages = rawMessages.map((m: unknown) => {
    if (!isPlainObject(m)) throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "an evaluator emitted a non-object message");
    const input = Object.fromEntries(Object.entries(m).filter(([key]) => key !== "kind"));
    return validationMessage(input as unknown as Parameters<typeof validationMessage>[0]);
  });
  const rawTrace: unknown = output.trace ?? [];
  if (!Array.isArray(rawTrace)) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "the evaluator returned a trace that is not an array");
  }
  return { data: clonePlainData(output.data as T), messages, trace: buildTrace(rawTrace as TraceStepInput[]) };
}

export function evaluate<T>(definition: EvaluationDefinition<T>, input: unknown): RuleEngineResponse<T> {
  const definitionProblem = checkDefinition(definition as EvaluationDefinition<unknown>);
  if (definitionProblem !== null) return engineFailure<T>([definitionProblem], null, null);

  const problems = new InputProblems();
  const request = readEvaluationRequest(input, [], problems);
  if (problems.count > 0 || request === null) {
    const rawKind = isPlainObject(input) && isValidContextKey(input.kind) ? input.kind : null;
    return engineFailure<T>(problems.list, rawKind, null);
  }

  const frozen = deepFreeze(request);
  const ruleset = frozen.ruleset === null ? null : rulesetProvenanceOf(frozen.ruleset);

  if (frozen.kind !== definition.kind) {
    return engineFailure<T>(
      [{ code: RULE_ENGINE_ERROR_CODES.INVALID_INPUT, message: `this evaluation handles "${definition.kind}"`, path: jsonPointer(["kind"]), details: { expectedKind: definition.kind } }],
      frozen.kind,
      ruleset,
    );
  }

  const supplied = suppliedContextFamilies(frozen);
  const missing = CONTEXT_FAMILIES.filter((family) => (definition.requires ?? []).includes(family) && !supplied.includes(family));
  if (missing.length > 0) {
    return engineFailure<T>(
      missing.map((family) => ({
        code: RULE_ENGINE_ERROR_CODES.MISSING_CONTEXT,
        message: `the ${family} context is required`,
        path: jsonPointer([family.toLowerCase()]),
        details: { family },
      })),
      frozen.kind,
      ruleset,
    );
  }

  let checked: { data: T; messages: ValidationMessageDraft[]; trace: CalculationTrace };
  try {
    checked = checkOutput<T>(definition.evaluate(frozen));
  } catch (error) {
    if (error instanceof RulesEngineError) return engineFailure<T>([error.toInput()], frozen.kind, ruleset);
    throw error;
  }

  const messages: RuleMessage[] = checked.messages.map((draft, ordinal) => ({ ...draft, ordinal }));
  return deepFreeze(assembleResponse<T>({ evaluationKind: frozen.kind, messages, data: checked.data, trace: checked.trace, ruleset }));
}
