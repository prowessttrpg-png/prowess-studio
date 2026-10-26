import { EFFECT_EXECUTION_CONTENT } from "./effect-execution.js";

/**
 * M5-WO13 active-magic lifecycle policy, pinned in the versioned ABILITY_CONSTRUCTION_RULE so every Active Effect keeps
 * its own Ruleset's rules for its whole lifetime. Authority: the M5-WO13 designer work order (explicit rulings) and the
 * Core Playtest Packet V0.1 MAGIC section — MANA EFFICIENCY ("ME is spent before MP … ME is not a discount"), MANA LOCK
 * ("Locked MP is not spent … maximum MP returns to normal, but current MP does not refill"), CHANNELING SPELLS ("Spend at
 * least 1 AP each round … A character may only Channel one spell at a time"), SUSTAINED SPELLS ("Sustain MP = Total MP ÷
 * Prowess Score, round down, minimum 1 MP per round … 1 AP per round … dismiss as a Free Action"), CONCENTRATION
 * ("Concentration Slots = 1 + 1 per 2 Resolve … Prowess Saving Throw … Base DC 8 … +2 per additional effect").
 *
 * Every program is an M4 Formula executed only by M4. Not authored here (fail closed, never guessed):
 *   manaLock.amount = null      — no exact structured reservation amount exists (M5-SC-052);
 *   channel.mpPaymentTiming = null — Spell MP payment timing while Channeling is not defined (M5-SC-053).
 * The older Chapter statements ("a failed Concentration check ends all Sustained spells"; "Mana Lock capacity returns only
 * if the spell ends normally"; the stat-table "Concentration: +1 per 3 RES") are superseded provenance only.
 */
export const ACTIVE_MAGIC_POLICY = {
  formulas: {
    sustainMp: { expression: "max(1, floor(final_mp / pro))", variables: ["final_mp", "pro"] },
    concentrationSlots: { expression: "1 + floor(res / 2)", variables: ["res"] },
    concentrationDc: { expression: "8 + 2 * max(0, consumers - 1)", variables: ["consumers"] },
  },
  sustainApPerRound: 1,
  sustainMeEligible: true,
  concentrationSaveStat: "PRO",
  dismissal: { INSTANT: "NOT_DISMISSIBLE", ROUNDS: "NOT_DISMISSIBLE", COMBAT: "NOT_DISMISSIBLE", SCENE: "NOT_DISMISSIBLE", MISSION: "NOT_DISMISSIBLE", SUSTAINED: "FREE_ACTION", MANA_LOCK: "NOT_DISMISSIBLE", PERMANENT_BY_SPECIAL_RULE: "NOT_DISMISSIBLE" },
  channel: { requiresConcentration: true, maximumSimultaneous: 1, minimumApPerRound: 1, mpPaymentTiming: null, mpPaymentConflictKey: "M5-SC-053" },
  manaLock: { amount: null, conflictKey: "M5-SC-052" },
  authority: ["M5-WO13", "MANA EFFICIENCY", "MANA LOCK", "CHANNELING SPELLS", "SUSTAINED SPELLS", "CONCENTRATION", "M5-SC-004"],
} as const;

/** The WO12 construction rule, re-authored with the additive WO13 active-magic policy (all earlier content inherited). */
export const ACTIVE_MAGIC_CONTENT = {
  constructionRule: { ...EFFECT_EXECUTION_CONTENT.constructionRule, payload: { ...EFFECT_EXECUTION_CONTENT.constructionRule.payload, activeMagicPolicy: ACTIVE_MAGIC_POLICY } },
};
