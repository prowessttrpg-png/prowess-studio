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
