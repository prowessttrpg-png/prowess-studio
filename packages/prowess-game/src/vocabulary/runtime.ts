import { deepFreeze } from "../internal/plain-data.js";

/**
 * Runtime resource, action-economy, movement and combat-timing vocabulary (PAS-10 M5-WO3). These lists are IDENTITIES
 * and timing names only. Every number — capacities, AP costs, multipliers, refresh targets, payment order, the Surprise
 * round — is versioned Definition content (`content/core-playtest-v0.1/runtime-resources.json`, plus the WO2 derived
 * statistics), executed by M4's Formula, Requirement and Resource engines.
 */

/**
 * The core runtime Resources (M5-I080): five distinct pools plus the WO3 movement-allowance tracker. Each is its own
 * RESOURCE Definition; none is ever stored as a combination of another (no "Current Mana = MP + ME").
 */
export const RUNTIME_RESOURCE_KEYS = deepFreeze(["HP", "MP", "ME", "AP", "COUNTER_ACTION", "MOVEMENT_ALLOWANCE"] as const);
export type RuntimeResourceKey = (typeof RUNTIME_RESOURCE_KEYS)[number];

/**
 * The exact M4 resource / RuntimeContext key of each runtime Resource. M4 resource keys are lowercase dotted context
 * keys; this table is the only place the two spellings meet, so no code case-folds a Resource token.
 */
export const RESOURCE_CONTEXT_KEYS = deepFreeze({
  HP: "resource.hp",
  MP: "resource.mp",
  ME: "resource.me",
  AP: "resource.ap",
  COUNTER_ACTION: "resource.counter_action",
  MOVEMENT_ALLOWANCE: "resource.movement_allowance",
} as const satisfies Record<RuntimeResourceKey, string>);

/** Where a Resource's maximum comes from: a WO2 derived statistic, or none (an explicitly unbounded tracker). */
export const RESOURCE_MAXIMUM_SOURCES = deepFreeze(["DERIVED", "UNBOUNDED"] as const);
export type ResourceMaximumSource = (typeof RESOURCE_MAXIMUM_SOURCES)[number];

/**
 * Combat timing events (s50, s423, s428, s431). A ROUND contains side phases; a creature's TURN is its acting window
 * inside its side's phase. HP and MP have no timing behaviour at all (M5-I082, M5-I083).
 */
export const COMBAT_TIMING_EVENTS = deepFreeze(["START_OF_ROUND", "START_OF_TURN", "END_OF_TURN", "END_OF_ROUND"] as const);
export type CombatTimingEvent = (typeof COMBAT_TIMING_EVENTS)[number];

/** What an expiry sets a Resource to. Only the Resource's own minimum exists — expiry never invents a value. */
export const RESOURCE_EXPIRY_TARGETS = deepFreeze(["MINIMUM"] as const);
export type ResourceExpiryTarget = (typeof RESOURCE_EXPIRY_TARGETS)[number];

/** How a Resource may be spent: directly through a generic transition, or only through a payment of an ACTION cost. */
export const RESOURCE_SPENDING = deepFreeze(["DIRECT", "PAYMENT_ONLY", "NONE"] as const);
export type ResourceSpending = (typeof RESOURCE_SPENDING)[number];

/** The generic, caller-requested transitions (refresh / expiry happen only at their authored timing). */
export const RESOURCE_TRANSITION_OPERATIONS = deepFreeze(["SPEND", "RESTORE", "RESERVE_CAPACITY", "RELEASE_CAPACITY"] as const);
export type ResourceTransitionOperation = (typeof RESOURCE_TRANSITION_OPERATIONS)[number];

/**
 * Payment policies. A RESOURCE Definition lists the policies it pays and in which explicit order; a payment collects
 * exactly the Resources that list its policy. ME pays an ME_ELIGIBLE_MAGICAL_COST before MP (s646); a plain
 * MAGICAL_COST is paid from MP only — ME eligibility is never assumed (M5-I090).
 */
export const PAYMENT_POLICIES = deepFreeze(["ACTION_POINT_COST", "COUNTER_ACTION_COST", "MAGICAL_COST", "ME_ELIGIBLE_MAGICAL_COST"] as const);
export type PaymentPolicy = (typeof PAYMENT_POLICIES)[number];

/** Restrictions on USING a Resource. SURPRISED: a surprised creature cannot use it during the first `throughRound` rounds (s51, s424). */
export const RESOURCE_USAGE_RESTRICTIONS = deepFreeze(["SURPRISED"] as const);
export type ResourceUsageRestriction = (typeof RESOURCE_USAGE_RESTRICTIONS)[number];

/**
 * ACTION AP cost models (s44, s432): FIXED (Move 1), RANGE (Grapple 1–2), MINIMUM (Interact 1 or more), VARIABLE
 * (Cast Spell, Skill Action — determined by the spell / skill), NONE (a Counter Action reaction spends no AP, s47).
 */
export const ACTION_COST_MODELS = deepFreeze(["FIXED", "RANGE", "MINIMUM", "VARIABLE", "NONE"] as const);
export type ActionCostModel = (typeof ACTION_COST_MODELS)[number];

/** What determines a VARIABLE AP cost — metadata naming the later system that calculates it. */
export const VARIABLE_COST_DETERMINERS = deepFreeze(["SPELL", "SKILL_ACTION"] as const);
export type VariableCostDeterminer = (typeof VARIABLE_COST_DETERMINERS)[number];

/** When an ACTION is taken: during the creature's own turn, or outside it in response to a trigger (s47, s434). */
export const ACTION_TIMINGS = deepFreeze(["OWN_TURN", "OUTSIDE_OWN_TURN"] as const);
export type ActionTiming = (typeof ACTION_TIMINGS)[number];

/** Creature Sizes (s442). Tactical identity and occupied space only — never a movement value (M5-I108, M5-SC-033). */
export const CREATURE_SIZES = deepFreeze(["SMALL", "MEDIUM", "LARGE", "HUGE", "MASSIVE"] as const);
export type CreatureSize = (typeof CREATURE_SIZES)[number];

/** Terrain kinds with an authored Movement-allowance cost. HAZARDOUS effects (s440) are later Effect / Condition work. */
export const TERRAIN_KINDS = deepFreeze(["NORMAL", "DIFFICULT"] as const);
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** The combat round sequence (s50, s423), in order. */
export const COMBAT_ROUND_SEQUENCE = deepFreeze(["DETERMINE_SURPRISE", "ROLL_INITIATIVE", "FIRST_SIDE_ACTS", "NEXT_SIDE_ACTS", "END_OF_ROUND", "REFRESH_AND_REPEAT"] as const);
export type CombatRoundStep = (typeof COMBAT_ROUND_SEQUENCE)[number];

/**
 * How creatures inside one side phase order their actions (s53, s429). Initiative orders SIDES only; inside a phase the
 * side chooses — there are no individual Initiative slots and no automatic sort (M5-I101).
 */
export const SIDE_PHASE_ORDER_POLICY = "CHOSEN_BY_SIDE" as const;

/** RuntimeContext `state` keys the WO3 runtime builder writes. */
export const RUNTIME_STATE_KEYS = deepFreeze({
  ROUND: "combat.round",
  /** 1 when the creature is surprised in this encounter, 0 otherwise (a numeric Requirement fact). */
  SURPRISED: "combat.surprised",
} as const);

/** The roll-signal ruling: presence-based, non-stacking, cancelling (M5-SC-032 designer ruling, M5-WO3). */
export const ROLL_SIGNAL_RULING = "M5-SC-032" as const;
