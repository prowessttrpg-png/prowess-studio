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
      ].sort(),
    );
  });

  it("the engine contract version is a contract version, not a Ruleset version", () => {
    expect(rules.RULES_ENGINE_CONTRACT_VERSION).toBe(1);
  });

  it("exports no engine class, registry or internal helper", () => {
    for (const name of Object.keys(rules)) expect(name).not.toMatch(/^(RulesEngine|Engine)$|Registry|inspectPlainData|canonicalJson|deepFreeze|assertDeterministic|InputProblems|read[A-Z]/);
  });
});
