import type { ProwessDefinitionRef } from "../definition/envelope.js";

/** Governed authoring candidate only. Not imported by runtime/catalogs and never automatically published.
 * A content author must select an exact approved Performance Skill and publish both this Condition and the
 * construction-rule policy extension in a NEW Release. Historical Releases are not rewritten. */
export const M6_WO8_COST_EXTENSION = { version: "M6-WO8-A", floor: "COMMITTED_ACTION_AP" } as const;
export function performanceConditionCandidate(skill: ProwessDefinitionRef) {
  if (skill.definitionKind !== "SKILL") throw new Error("An exact approved Performance Skill is required");
  return {
    keywords: [], parameters: {}, compatibility: [], tradeoff: {},
    restriction: { restrictionKey: "PERFORMANCE", data: {} },
    costContributions: [{ contributionKey: "performance.mp", currency: "MP", data: { kind: "PER_SELECTION", parameter: "performanceRank", amounts: { TRAINED: 2, EXPERT: 4, MASTER: 6 }, modifier: "MP_REDUCTION" } }],
    rules: {
      construction: { prerequisites: [{ prerequisiteKey: "PERFORMANCE_TRAINED", kind: "SKILL_RANK_AT_LEAST", skillKey: skill.canonicalKey, minimumRank: "TRAINED" }], stacking: { stackable: false } },
      condition: {
        branch: "MANEUVER", availability: "EXECUTABLE", deferralKey: null,
        parameters: [{ parameter: "performanceRank", kind: "TOKEN", allowed: ["TRAINED", "EXPERT", "MASTER"], default: null }],
        applicability: { kind: "NUMERIC_COMPARE", factKey: "mechanic.present", operator: "==", expected: 1 },
        runtimeRequirements: [{ requirementKey: "PERFORMANCE_ESTABLISHED", requirement: { kind: "NUMERIC_COMPARE", factKey: "runtime.performanceEstablishedBeforeActivation", operator: "==", expected: 1 }, parameters: [], references: [skill] }],
        dependencies: [], consumesSlot: false, slotExemption: "PERFORMANCE_OBLIGATORY", choice: { kind: "ALL" }, incompatibleRestrictions: [],
        performance: { version: "M6-WO8-A", skill, rankParameter: "performanceRank", preparationApByRank: { TRAINED: 1, EXPERT: 1, MASTER: 0 } },
      },
    },
  };
}
