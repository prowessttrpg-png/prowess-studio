/**
 * @prowess/rules — the pure Rules Engine foundation (PAS-10 M4-WO1).
 *
 * Evaluates exact, caller-supplied rule material. Depends only on @prowess/model. No persistence, no UI, no framework,
 * no import layer, no clock, no randomness, no network, no authored-code execution. See
 * docs/architecture/m4-rules-engine-core.md.
 *
 * The public surface is intentionally explicit (no `export *`): internal readers, plain-data guards and the
 * determinism test helper are not exported.
 */
export { RULES_ENGINE_CONTRACT_VERSION, type RulesEngineContractVersion } from "./contract-version.js";

export {
  RULE_ENGINE_ERROR_CODES,
  RULE_ENGINE_ERROR_NAMESPACE,
  RulesEngineError,
  isRuleEngineErrorCode,
  isRulesEngineError,
  type EngineError,
  type EngineErrorInput,
  type RuleEngineErrorCode,
} from "./errors/engine-error.js";

export { CONTEXT_KEY_PATTERN, MAX_CONTEXT_KEY_LENGTH, isValidContextKey } from "./context/context-key.js";
export type { ContextOutcome, ContextScalar, EntityVersionReference } from "./context/shared.js";
export {
  createRulesetContext,
  findResolvedRule,
  findResolvedRuleByCanonicalKey,
  type ResolvedRuleReference,
  type RulesetContext,
  type RulesetReleaseIdentity,
} from "./context/ruleset-context.js";
export {
  createActorContext,
  createBuildContext,
  createRuntimeContext,
  type ActorContext,
  type BuildComponent,
  type BuildContext,
  type RuntimeContext,
  type RuntimeEffect,
} from "./context/evaluation-contexts.js";
export {
  CONTEXT_FAMILIES,
  createEvaluationRequest,
  suppliedContextFamilies,
  type ContextFamily,
  type EvaluationRequest,
} from "./context/evaluation-request.js";

export {
  EVALUATION_VALUE_TYPES,
  booleanValue,
  identifierValue,
  listValue,
  numberValue,
  stringValue,
  type EvaluationValue,
  type EvaluationValueType,
} from "./result/evaluation-value.js";
export { provenanceOf, rulesetProvenanceOf, type RuleProvenance, type RulesetProvenance } from "./result/provenance.js";
export {
  RULE_ENGINE_RESPONSE_STATUSES,
  deriveResponseStatus,
  isSuccessStatus,
  type RuleEngineResponse,
  type RuleEngineResponseStatus,
  type RuleMessage,
} from "./result/rule-engine-response.js";

export {
  VALIDATION_CATEGORIES,
  VALIDATION_CODE_PATTERN,
  VALIDATION_SEVERITIES,
  isValidValidationCode,
  validationMessage,
  type ValidationCategory,
  type ValidationMessage,
  type ValidationMessageDraft,
  type ValidationMessageInput,
  type ValidationSeverity,
} from "./validation/validation-message.js";

export {
  EMPTY_TRACE,
  buildTrace,
  flattenTrace,
  type CalculationTrace,
  type TraceInput,
  type TraceStep,
  type TraceStepInput,
} from "./trace/calculation-trace.js";

export { evaluate, type EvaluationDefinition, type EvaluatorOutput } from "./evaluation/evaluate.js";
