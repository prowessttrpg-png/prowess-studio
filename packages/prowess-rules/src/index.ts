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

// M4-WO3 Formula Engine: a restricted, purpose-built expression language evaluated as data — never executed as code.
export {
  FORMULA_DIAGNOSTIC_CODES,
  FORMULA_FUNCTIONS,
  FORMULA_LIMITS,
  type FormulaDiagnostic,
  type FormulaDiagnosticCode,
  type FormulaFunctionName,
} from "./formula/diagnostics.js";
export {
  FORMULA_IDENTIFIER_PATTERN,
  isValidFormulaIdentifier,
  type FormulaBinaryNode,
  type FormulaCallNode,
  type FormulaNode,
  type FormulaNumberNode,
  type FormulaUnaryNode,
  type FormulaVariableNode,
} from "./formula/ast.js";
export { parseFormulaExpression, type FormulaParseFailure, type FormulaParseResult, type FormulaParseSuccess } from "./formula/parser.js";
export {
  FORMULA_EVALUATION_KIND,
  FORMULA_ROUNDING_MODES,
  FORMULA_UNIT_PATTERN,
  evaluateFormula,
  validateFormulaProgram,
  type EvaluateFormulaOptions,
  type FormulaBoundResult,
  type FormulaProgram,
  type FormulaProgramValidation,
  type FormulaResult,
  type FormulaRoundingMode,
  type ValidatedFormulaProgram,
} from "./formula/evaluate.js";
export { orderFormulaDependencies, type FormulaDependencyNode, type FormulaDependencyOrder } from "./formula/dependency.js";

// M4-WO4 Keyword Resolution: Keywords are metadata / rule hooks — exact identity, provenance, membership; no mechanics.
export {
  KEYWORD_RESOLUTION_DIAGNOSTIC_CODES,
  KEYWORD_RESOLUTION_KIND,
  resolveKeywords,
  type KeywordContribution,
  type KeywordContributionSource,
  type KeywordContributor,
  type KeywordReference,
  type KeywordResolutionDiagnosticCode,
  type ResolveKeywordsOptions,
  type ResolvedKeyword,
  type ResolvedKeywordSet,
} from "./keyword/resolve.js";
export { findResolvedKeywordByCanonicalKey, findResolvedKeywordById, hasKeywordByCanonicalKey, hasKeywordById } from "./keyword/query.js";

// M4-WO5 Requirement Engine: explicit Requirement trees over explicit facts — satisfied, unsatisfied (a normal result)
// or invalid; ALL / ANY / NONE always evaluate every child.
export {
  REQUIREMENT_DIAGNOSTIC_CODES,
  REQUIREMENT_GROUP_KINDS,
  REQUIREMENT_LIMITS,
  REQUIREMENT_NUMERIC_OPERATORS,
  REQUIREMENT_PREDICATE_KINDS,
  type EntityOwnedPredicate,
  type KeywordPresentPredicate,
  type NumericComparePredicate,
  type RankAtLeastPredicate,
  type RequirementDiagnostic,
  type RequirementDiagnosticCode,
  type RequirementEvaluation,
  type RequirementGroup,
  type RequirementGroupKind,
  type RequirementGroupOutcome,
  type RequirementLeafOutcome,
  type RequirementNode,
  type RequirementNumericOperator,
  type RequirementOutcome,
  type RequirementPredicate,
  type RequirementPredicateKind,
  type SetContainsPredicate,
} from "./requirement/model.js";
export { validateRequirement, type RequirementValidation } from "./requirement/validate.js";
export { createRequirementFacts, type NumericFact, type RankFact, type RequirementFacts, type RequirementFactsOutcome, type SetFact } from "./requirement/facts.js";
export { REQUIREMENT_EVALUATION_KIND, evaluateRequirement, type EvaluateRequirementOptions } from "./requirement/evaluate.js";

// M4-WO6 Modifier Engine: explicit modifier pipelines over explicit targets — ordered, conditional (via M4-WO5),
// stacking without hidden winners, no rounding, no payment, Advantage / Disadvantage as signals only.
export {
  MODIFIER_BOUNDARY_POLICIES,
  MODIFIER_DIAGNOSTIC_CODES,
  MODIFIER_LIMITS,
  MODIFIER_NUMERIC_OPERATIONS,
  MODIFIER_OPERATIONS,
  MODIFIER_OUTCOME_STATUSES,
  MODIFIER_SIGNAL_OPERATIONS,
  MODIFIER_STACKING_POLICIES,
  MODIFIER_STEP_OPERATIONS,
  MODIFIER_TARGET_KINDS,
  type ModifierBoundaryPolicy,
  type ModifierDefinition,
  type ModifierDiagnostic,
  type ModifierDiagnosticCode,
  type ModifierEvaluationResult,
  type ModifierOperation,
  type ModifierOutcome,
  type ModifierOutcomeStatus,
  type ModifierPhase,
  type ModifierSource,
  type ModifierStacking,
  type ModifierTarget,
  type ModifierTargetKind,
  type ModifierTargetState,
  type ModifierValue,
  type NumericTarget,
  type OrderedTarget,
  type RollSignalTarget,
} from "./modifier/model.js";
export { validateModifiers, type ModifierRequest, type ModifierValidation } from "./modifier/validate.js";
export { MODIFIER_EVALUATION_KIND, evaluateModifiers, type EvaluateModifiersOptions } from "./modifier/evaluate.js";

// M4-WO7 Resource Engine Foundation: explicit runtime resource state and pure transitions. Listed cost is never
// rewritten by payment; insufficient resources are a valid outcome; reservation never spends, release never restores.
export {
  PAYMENT_MODES,
  RESOURCE_CEILINGS,
  RESOURCE_DIAGNOSTIC_CODES,
  RESOURCE_KINDS,
  RESOURCE_LIMITS,
  RESOURCE_OVERFLOW_POLICIES,
  RESOURCE_TRANSITIONS,
  type PaymentAllocation,
  type PaymentMode,
  type PaymentRequest,
  type PaymentResult,
  type PaymentSource,
  type ResourceCeiling,
  type ResourceDiagnostic,
  type ResourceDiagnosticCode,
  type ResourceKind,
  type ResourceOverflowPolicy,
  type ResourceSnapshot,
  type ResourceState,
  type ResourceTransition,
  type ResourceTransitionResult,
} from "./resource/model.js";
export { createResourceSnapshot, getAvailableMaximum, type ResourceSnapshotOutcome } from "./resource/snapshot.js";
export {
  RESOURCE_REFRESH_TARGETS,
  refreshResource,
  releaseResourceCapacity,
  reserveResourceCapacity,
  restoreResource,
  setResourceCurrent,
  spendResource,
  type ResourceOperationOptions,
  type ResourceRefreshTarget,
} from "./resource/transition.js";
export { applyResourcePayment, previewResourcePayment } from "./resource/payment.js";

// M4-WO8 Validation Engine: combines exact subsystem responses and explicit caller-decided checks into one M4-WO1
// response. Consumes results; never recalculates, reclassifies or auto-corrects them.
export {
  VALIDATION_CHECK_OUTCOMES,
  VALIDATION_DIAGNOSTIC_CODES,
  VALIDATION_LIMITS,
  type ValidationCheck,
  type ValidationCheckOutcome,
  type ValidationCheckResult,
  type ValidationDiagnosticCode,
  type ValidationSource,
  type ValidationSourceResult,
  type ValidationSummary,
} from "./validation-engine/model.js";
export { VALIDATION_EVALUATION_KIND, evaluateValidation, type EvaluateValidationOptions } from "./validation-engine/evaluate.js";

// M4-WO9 Calculation Trace & Explanation Engine: a deterministic, machine-readable VIEW over exact completed results
// and their WO1 traces. Explanation describes calculation; it never performs it.
export {
  EXPLANATION_CONTRIBUTION_KINDS,
  EXPLANATION_DIAGNOSTIC_CODES,
  EXPLANATION_LEVELS,
  EXPLANATION_LIMITS,
  EXPLANATION_STATUSES,
  EXPLANATION_STATUS_LABELS,
  type ExplanationContribution,
  type ExplanationContributionKind,
  type ExplanationDocument,
  type ExplanationFact,
  type ExplanationInput,
  type ExplanationLevel,
  type ExplanationNode,
  type ExplanationSection,
  type ExplanationStatus,
} from "./explanation/model.js";
export { EXPLANATION_BUILD_KIND, buildExplanation, type BuildExplanationOptions } from "./explanation/build.js";
export { EXPLANATION_PROJECT_KIND, projectExplanation } from "./explanation/project.js";

// M4-WO10 Rules Evaluation Orchestration: runs an explicit plain-data EvaluationPlan of existing primitives under one
// exact set of contexts, copying exact values between steps. Adds no mechanics.
export {
  EVALUATION_BLOCK_REASONS,
  EVALUATION_CONTEXT_FAMILIES,
  EVALUATION_OPERATIONS,
  EVALUATION_OPERATION_INPUT_FIELDS,
  EVALUATION_RUN_EXECUTION_STATUSES,
  EVALUATION_STEP_EXECUTION_STATUSES,
  ORCHESTRATION_DIAGNOSTIC_CODES,
  ORCHESTRATION_LIMITS,
  type EvaluationBinding,
  type EvaluationBlockReason,
  type EvaluationBlockedBinding,
  type EvaluationContextFamily,
  type EvaluationOperation,
  type EvaluationPlan,
  type EvaluationReference,
  type EvaluationRun,
  type EvaluationRunExecutionStatus,
  type EvaluationStep,
  type EvaluationStepExecutionStatus,
  type EvaluationStepResult,
  type OrchestrationDiagnosticCode,
} from "./orchestration/model.js";
export { ORCHESTRATION_EVALUATION_KIND, orchestrateRulesEvaluation, type OrchestrateRulesEvaluationInput } from "./orchestration/orchestrate.js";
