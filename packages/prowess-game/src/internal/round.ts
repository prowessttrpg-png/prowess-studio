/**
 * Combat round ordinal infrastructure (PAS-10 M6-WO10). The Play runtime numbers the rounds of one combat 1, 2, 3 … so
 * that authored round-bounded rules (a usage restriction "through round 1") can be read against it. This is sequence
 * bookkeeping — never a Resource amount, cost, capacity, distance or roll — and it is the only arithmetic the Play
 * runtime performs itself; every game value is computed by M4 from the pinned Definitions.
 */
export function nextRoundOrdinal(previous: number | null): number {
  return previous === null ? 1 : previous + 1;
}
