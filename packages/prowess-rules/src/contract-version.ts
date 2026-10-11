/**
 * The Rules Engine CONTRACT version (PAS-10 M4-WO1 §41, §82).
 *
 * This versions the shape of the engine's public evaluation contracts — contexts, request, response, messages and
 * trace — so that a stored or transmitted result can say which contract produced it. It is NOT a Prowess Ruleset
 * version (that is `RulesetContext.rulesetVersionLabel` / `release`) and NOT the npm package version.
 *
 * Additive, backward-compatible changes keep this value. A breaking change to any public contract must increment it
 * deliberately, in the Work Order that makes the change. M4-WO1 implements no contract-migration machinery.
 */
export const RULES_ENGINE_CONTRACT_VERSION = 1 as const;

export type RulesEngineContractVersion = typeof RULES_ENGINE_CONTRACT_VERSION;
