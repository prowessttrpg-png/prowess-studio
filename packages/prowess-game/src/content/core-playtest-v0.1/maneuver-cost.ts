import { DURATION_CONDITION_CONTENT } from "./duration-conditions.js";

/**
 * M5-WO11 final Maneuver cost policy (Core Playtest Packet V0.1 "Building a Maneuver": Base Actions + Maneuver Effects −
 * Conditions; Cost Rules: Minimum AP 1, Attack Floor, 3 AP Is Not a Cap; Signature Maneuver: reduce the final AP cost by
 * 1, minimum 1 AP; designer ruling M5-SC-025: Maneuver Condition AP reduction ≤ 3). Authored as content and pinned in the
 * versioned ABILITY_CONSTRUCTION_RULE so a Ruleset carries its own exact Maneuver cost rule.
 *
 * No Spell semantics: no MP ÷ PRO, no percentage netting, no final rounding, no Affinity percentage.
 */
export const MANEUVER_COST_POLICY = {
  signatureApReduction: 1,
  minimumAp: 1,
  minimumMp: 0,
  /** Exact component costs that are genuinely not executable yet. Never priced; the final cost fails closed. */
  unresolvedComponentCosts: [{ canonicalKey: "maneuver.effect.elemental_damage_conversion", conflictKey: "M5-SC-048" }],
  /** Restrictions an Attack already imposes on itself (its weapon): restating one as a Condition is never a discount. */
  inherentRestrictionKeys: ["WEAPON_LOCK"],
  formulas: {
    contribution: { expression: "max(0, units - included) * rate", variables: ["units", "included", "rate"] },
    affinityAdjusted: { expression: "max(minimum, amount - reduction)", variables: ["minimum", "amount", "reduction"] },
    conditionReduced: { expression: "base - reduction", variables: ["base", "reduction"] },
    attackFloor: { expression: "max(minimum, attacks)", variables: ["minimum", "attacks"] },
  },
  authority: ["M5-SC-025", "s2020", "s2094", "s21729", "s22270"],
} as const;

/** The WO9 construction rule, re-authored with the additive Maneuver cost policy (all WO5 / WO9 content inherited). */
export const MANEUVER_COST_CONTENT = {
  constructionRule: { ...DURATION_CONDITION_CONTENT.constructionRule, payload: { ...DURATION_CONDITION_CONTENT.constructionRule.payload, maneuverCostPolicy: MANEUVER_COST_POLICY } },
};
