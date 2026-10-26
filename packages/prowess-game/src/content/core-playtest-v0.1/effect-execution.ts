import { MANEUVER_COST_CONTENT } from "./maneuver-cost.js";

/**
 * M5-WO12 Effect Chain execution policy, pinned in the versioned ABILITY_CONSTRUCTION_RULE so a Ruleset carries its own
 * routing rules. Authority: designer ruling M5-SC-014 (an Effect with no listed Chain Behavior: failure ends the chain);
 * Core Playtest Packet V0.1 "EFFECT CHAINS" (s639–s642: Continue / Success Only / Failure Only / Stop / Branch; each
 * target resolves the chain separately) and "Save Restriction by Martial Rank" (Trained: the defender chooses from the full
 * Save Profile; Expert: the attacker removes one Save option; Master: the attacker chooses the Save).
 */
export const EFFECT_EXECUTION_POLICY = {
  defaultChainBehavior: "SUCCESS_ONLY",
  martialSkillKey: "skill.martial",
  martialSaveControl: { TRAINED: "DEFENDER_CHOOSES", EXPERT: "ATTACKER_REMOVES_ONE", MASTER: "ATTACKER_CHOOSES" },
  authority: ["M5-SC-014", "s639", "s640", "s642", "Maneuvers §5 Save Restriction by Martial Rank"],
} as const;

/** The WO11 construction rule, re-authored with the additive WO12 execution policy (all earlier content inherited). */
export const EFFECT_EXECUTION_CONTENT = {
  constructionRule: { ...MANEUVER_COST_CONTENT.constructionRule, payload: { ...MANEUVER_COST_CONTENT.constructionRule.payload, effectExecutionPolicy: EFFECT_EXECUTION_POLICY } },
};
