import { describe, expect, it } from "vitest";
import * as rules from "./index.js";

/** M4-WO1 §76: the public export surface is intentional. Internal readers, guards and test helpers stay private. */
describe("@prowess/rules public surface", () => {
  it("exports exactly the approved runtime values", () => {
    expect(Object.keys(rules).sort()).toEqual(
      [
        "CONTEXT_FAMILIES",
        "CONTEXT_KEY_PATTERN",
        "EMPTY_TRACE",
        "EVALUATION_VALUE_TYPES",
        "MAX_CONTEXT_KEY_LENGTH",
        "RULES_ENGINE_CONTRACT_VERSION",
        "RULE_ENGINE_ERROR_CODES",
        "RULE_ENGINE_ERROR_NAMESPACE",
        "RULE_ENGINE_RESPONSE_STATUSES",
        "RulesEngineError",
        "VALIDATION_CATEGORIES",
        "VALIDATION_CODE_PATTERN",
        "VALIDATION_SEVERITIES",
        "booleanValue",
        "buildTrace",
        "createActorContext",
        "createBuildContext",
        "createEvaluationRequest",
        "createRulesetContext",
        "createRuntimeContext",
        "deriveResponseStatus",
        "evaluate",
        "findResolvedRule",
        "findResolvedRuleByCanonicalKey",
        "flattenTrace",
        "identifierValue",
        "isRuleEngineErrorCode",
        "isRulesEngineError",
        "isSuccessStatus",
        "isValidContextKey",
        "isValidValidationCode",
        "listValue",
        "numberValue",
        "provenanceOf",
        "rulesetProvenanceOf",
        "stringValue",
        "suppliedContextFamilies",
        "validationMessage",
        // M4-WO3 Formula Engine
        "FORMULA_DIAGNOSTIC_CODES",
        "FORMULA_EVALUATION_KIND",
        "FORMULA_FUNCTIONS",
        "FORMULA_IDENTIFIER_PATTERN",
        "FORMULA_LIMITS",
        "FORMULA_ROUNDING_MODES",
        "FORMULA_UNIT_PATTERN",
        "evaluateFormula",
        "isValidFormulaIdentifier",
        "orderFormulaDependencies",
        "parseFormulaExpression",
        "validateFormulaProgram",
        // M4-WO4 Keyword Resolution
        "KEYWORD_RESOLUTION_DIAGNOSTIC_CODES",
        "KEYWORD_RESOLUTION_KIND",
        "findResolvedKeywordByCanonicalKey",
        "findResolvedKeywordById",
        "hasKeywordByCanonicalKey",
        "hasKeywordById",
        "resolveKeywords",
        // M4-WO5 Requirement Engine
        "REQUIREMENT_DIAGNOSTIC_CODES",
        "REQUIREMENT_EVALUATION_KIND",
        "REQUIREMENT_GROUP_KINDS",
        "REQUIREMENT_LIMITS",
        "REQUIREMENT_NUMERIC_OPERATORS",
        "REQUIREMENT_PREDICATE_KINDS",
        "createRequirementFacts",
        "evaluateRequirement",
        "validateRequirement",
        // M4-WO6 Modifier Engine
        "MODIFIER_BOUNDARY_POLICIES",
        "MODIFIER_DIAGNOSTIC_CODES",
        "MODIFIER_EVALUATION_KIND",
        "MODIFIER_LIMITS",
        "MODIFIER_NUMERIC_OPERATIONS",
        "MODIFIER_OPERATIONS",
        "MODIFIER_OUTCOME_STATUSES",
        "MODIFIER_SIGNAL_OPERATIONS",
        "MODIFIER_STACKING_POLICIES",
        "MODIFIER_STEP_OPERATIONS",
        "MODIFIER_TARGET_KINDS",
        "evaluateModifiers",
        "validateModifiers",
        // M4-WO7 Resource Engine Foundation
        "PAYMENT_MODES",
        "RESOURCE_CEILINGS",
        "RESOURCE_DIAGNOSTIC_CODES",
        "RESOURCE_KINDS",
        "RESOURCE_LIMITS",
        "RESOURCE_OVERFLOW_POLICIES",
        "RESOURCE_REFRESH_TARGETS",
        "RESOURCE_TRANSITIONS",
        "applyResourcePayment",
        "createResourceSnapshot",
        "getAvailableMaximum",
        "previewResourcePayment",
        "refreshResource",
        "releaseResourceCapacity",
        "reserveResourceCapacity",
        "restoreResource",
        "setResourceCurrent",
        "spendResource",
        // M4-WO8 Validation Engine
        "VALIDATION_CHECK_OUTCOMES",
        "VALIDATION_DIAGNOSTIC_CODES",
        "VALIDATION_EVALUATION_KIND",
        "VALIDATION_LIMITS",
        "evaluateValidation",
        // M4-WO9 Calculation Trace & Explanation Engine
        "EXPLANATION_BUILD_KIND",
        "EXPLANATION_CONTRIBUTION_KINDS",
        "EXPLANATION_DIAGNOSTIC_CODES",
        "EXPLANATION_LEVELS",
        "EXPLANATION_LIMITS",
        "EXPLANATION_PROJECT_KIND",
        "EXPLANATION_STATUSES",
        "EXPLANATION_STATUS_LABELS",
        "buildExplanation",
        "projectExplanation",
        // M4-WO10 Rules Evaluation Orchestration
        "EVALUATION_BLOCK_REASONS",
        "EVALUATION_CONTEXT_FAMILIES",
        "EVALUATION_OPERATIONS",
        "EVALUATION_OPERATION_INPUT_FIELDS",
        "EVALUATION_RUN_EXECUTION_STATUSES",
        "EVALUATION_STEP_EXECUTION_STATUSES",
        "ORCHESTRATION_DIAGNOSTIC_CODES",
        "ORCHESTRATION_EVALUATION_KIND",
        "ORCHESTRATION_LIMITS",
        "orchestrateRulesEvaluation",
      ].sort(),
    );
  });

  it("the engine contract version is a contract version, not a Ruleset version", () => {
    expect(rules.RULES_ENGINE_CONTRACT_VERSION).toBe(1);
  });

  it("exports no engine class, registry or internal helper", () => {
    for (const name of Object.keys(rules)) {
      expect(name).not.toMatch(/^(RulesEngine|Engine)$|Registry|inspectPlainData|canonicalJson|deepFreeze|assertDeterministic|InputProblems|read[A-Z]/);
      // M4-WO3: the lexer, AST walker and internal evaluator stay private; there is no mutable Formula class.
      expect(name).not.toMatch(/tokenize|Lexer|Parser$|analyzeAst|childrenOf|evaluateNode|bindVariables|^Formula[A-Z]?\w*Engine$|^Formula$/);
      // M4-WO4: aggregation internals stay private; no registry, merge, removal or string-only Keyword API.
      expect(name).not.toMatch(/aggregate|KeywordRegistry|merge|remove|suppress|negate|^resolveKeywordStrings$/i);
      // M4-WO5: no engine class, fact index, callback / CUSTOM evaluator or rank ladder is public.
      expect(name).not.toMatch(/RequirementEngine|indexFacts|evaluatePredicate|evaluateNode|CUSTOM|RANK_LADDER|isValidFactKey|isExactLabel/);
      // M4-WO6: no engine class; the WO5 prepared-facts path and modifier internals stay private.
      expect(name).not.toMatch(/ModifierEngine|prepareRequirementFacts|evaluateValidatedRequirement|validateModifiersWithIndex|operationFamily|^numeric$/);
      // M4-WO7: no engine class, allocation internals or effective-cost helper is public.
      expect(name).not.toMatch(/ResourceEngine|allocatePayment|replaceResource|runTransition|effectiveCost|effective_cost/i);
      // M4-WO8: no engine class, validator registry or source-reading internals are public.
      expect(name).not.toMatch(/ValidationEngine|ValidatorRegistry|registerValidator|readSourceResponse/);
      // M4-WO9: no engine class, builder, template language or trace internals are public.
      expect(name).not.toMatch(/ExplanationEngine|ExplanationBuilder|projectTrace|factsOf|nodeStatus|template|renderText/i);
      // M4-WO10: no orchestrator class, operation registry, dispatch internals or pointer helpers are public.
      expect(name).not.toMatch(/RulesOrchestrator|registerOperation|OperationRegistry|^dispatch$|validatePlan|parsePointer|readAt|writeAt/);
    }
  });
});
