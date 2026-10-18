import { deepFreeze } from "../internal/plain-data.js";

/**
 * Affinity vocabularies (PAS-10 M5-WO4). Each list is a closed CLASSIFICATION — a name for a concept. None carries a
 * number: rank order, Strength discounts, Authority capacities, Weakness percentages and progression steps are all
 * versioned Prowess content (`content/core-playtest-v0.1/affinity.json`), never TypeScript (§35, §144). Nothing in
 * @prowess/game branches on an Affinity identity (EVOCATION …) to produce a mechanic (§3, M5-I148).
 */

/**
 * The Affinity Rank states (§29). Membership only: their ORDER and their mechanical meaning come from the exact
 * AFFINITY_RANK_RULE Definition (§31–§35). NONE is "owned, no trained Affinity benefit" — never the Skill rank
 * UNTRAINED (§30, M5-I120).
 */
export const AFFINITY_RANKS = deepFreeze(["NONE", "TRAINED", "EXPERT", "MASTER"] as const);
export type AffinityRank = (typeof AFFINITY_RANKS)[number];

/** A character's relationship to an owned Affinity. A SECONDARY Affinity is a real, whole Affinity (§45–§46). */
export const AFFINITY_ROLES = deepFreeze(["PRIMARY", "SECONDARY"] as const);
export type AffinityRole = (typeof AFFINITY_ROLES)[number];

/** The two Spell-construction Authorities (s624, s680–s683). Exactly one is chosen explicitly (§105–§106, §115). */
export const SPELL_CONSTRUCTION_AUTHORITIES = deepFreeze(["ARCANE_AUTHORITY", "AFFINITY_AUTHORITY"] as const);
export type SpellConstructionAuthority = (typeof SPELL_CONSTRUCTION_AUTHORITIES)[number];

/** The standard Weakness severity reference scale (s686). Labels only — their percentages are content (§57). */
export const AFFINITY_WEAKNESS_SEVERITIES = deepFreeze(["MINOR", "MODERATE", "MAJOR"] as const);
export type AffinityWeaknessSeverity = (typeof AFFINITY_WEAKNESS_SEVERITIES)[number];

/** How one governing Affinity relates to an Ability's explicit Keywords (§151). Details are always kept (§152). */
export const AFFINITY_ALIGNMENTS = deepFreeze(["STRENGTH", "WEAKNESS", "STRENGTH_AND_WEAKNESS", "NEUTRAL"] as const);
export type AffinityAlignment = (typeof AFFINITY_ALIGNMENTS)[number];

/**
 * Standard Affinity advancement action kinds (s161). The AFFINITY_PROGRESSION Definition says WHICH applies at which
 * Level and with which ranks; this list only names the kinds the progression interpreter understands.
 *
 *   CHOOSE_PRIMARY_AFFINITY — gain the Primary Affinity at the authored starting rank.
 *   RANK_UP                 — raise an owned Affinity (the Primary, or any owned one) from one rank to the next.
 *   GAIN_AFFINITY           — gain a further Affinity at an authored starting rank — or at an UNRESOLVED rank (null),
 *                             which is never executed automatically (M5-SC-035, §49, §160).
 */
export const AFFINITY_ADVANCEMENT_ACTIONS = deepFreeze(["CHOOSE_PRIMARY_AFFINITY", "RANK_UP", "GAIN_AFFINITY"] as const);
export type AffinityAdvancementAction = (typeof AFFINITY_ADVANCEMENT_ACTIONS)[number];

/** Which owned Affinity a RANK_UP may raise. */
export const AFFINITY_RANK_UP_TARGETS = deepFreeze(["PRIMARY", "ANY_OWNED"] as const);
export type AffinityRankUpTarget = (typeof AFFINITY_RANK_UP_TARGETS)[number];

/** How a progression Level offers its options: one REQUIRED grant, or CHOOSE_ONE of several (s161). */
export const AFFINITY_PROGRESSION_MODES = deepFreeze(["REQUIRED", "CHOOSE_ONE"] as const);
export type AffinityProgressionMode = (typeof AFFINITY_PROGRESSION_MODES)[number];

/**
 * The executable Affinity subjects (§2). Alignment is shared by both Ability branches (§6, M5-I145); cost and
 * Authority are Spell construction (§7, §105) — Maneuver cost application belongs to the later Maneuver cost WO (§8).
 */
export const AFFINITY_SUBJECT_KINDS = deepFreeze(["AFFINITY_ALIGNMENT", "SPELL_AFFINITY_COST", "AFFINITY_AUTHORITY", "AFFINITY_ACCESS"] as const);
export type AffinitySubjectKind = (typeof AFFINITY_SUBJECT_KINDS)[number];

/** The explicit numeric cost a Spell Affinity modifier fragment targets (§132): the Spell's LISTED MP. */
export const AFFINITY_COST_TARGETS = deepFreeze(["LISTED_MP_COST"] as const);
export type AffinityCostTarget = (typeof AFFINITY_COST_TARGETS)[number];
