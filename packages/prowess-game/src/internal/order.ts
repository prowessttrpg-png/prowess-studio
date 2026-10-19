/**
 * Plan-position infrastructure (PAS-10 M5-WO3). A compiled M4 plan runs its steps by explicit integer `order`; a chain
 * of N runtime steps needs N increasing positions. This is the ONLY arithmetic the runtime compiler performs, and it is
 * plan layout — never a game value: no Resource amount, cost, capacity or movement distance ever passes through here.
 */
export const RUNTIME_ORDER = Object.freeze({
  /** Usage-restriction (Surprise) Requirement steps. */
  AVAILABILITY: 1500,
  /** The runtime Resource chain: one block of `STRIDE` positions per chain link. */
  CHAIN: 2000,
  STRIDE: 10,
  /** Exposed depletion facts read the chain's final state. */
  DEPLETION: 900000,
});

/** The position of link `index` of the runtime chain, plus `offset` (< STRIDE) for a link's own pre-steps. */
export function chainOrder(index: number, offset = 0): number {
  return RUNTIME_ORDER.CHAIN + index * RUNTIME_ORDER.STRIDE + offset;
}

/** The position of availability Requirement `index`. */
export function availabilityOrder(index: number): number {
  return RUNTIME_ORDER.AVAILABILITY + index;
}

/**
 * M5-WO4 Affinity plan layout. Every step of one block shares the block's position (M4 breaks ties by stepKey), and
 * every binding reads a strictly earlier block — so no position arithmetic is needed at all.
 */
export const AFFINITY_ORDER = Object.freeze({
  /** The whole Ability's exact Keyword contributions → one M4 KEYWORD step. */
  KEYWORDS: 100,
  /** One REQUIREMENT per Strength rule / per Weakness rule of the governing Affinity. */
  STRENGTHS: 200,
  WEAKNESSES: 300,
  /** M4 MAX modifiers select the highest matched Weakness percentage. */
  WEAKNESS_SELECTION: 400,
  /** The net Affinity cost percentage: 100 − Strength discount + selected Weakness penalty (designer ruling M5-SC-028). */
  NET_PERCENT: 450,
  /** The listed cost × net percentage ÷ 100 — applied ONCE (M5-SC-028); never rounded here. */
  COST: 500,
  /** Affinity Authority: rank floor and Effect / Trait capacity Requirements. */
  AUTHORITY: 600,
  /** Per-Effect Keyword sets for Affinity Authority specialization. */
  EFFECT_KEYWORDS: 700,
  EFFECT_ACCESS: 800,
  /** Affinity access Requirements (Trait / Effect / Maneuver prerequisites). */
  ACCESS: 900,
});
