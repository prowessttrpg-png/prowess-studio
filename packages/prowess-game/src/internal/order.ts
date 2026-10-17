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
