import type { JsonObject } from "@prowess/model";
import { evaluateRequirement } from "@prowess/rules";

/**
 * Character comparisons through the frozen M4 Requirement engine (PAS-10 M6-WO4). Every "at least this rank / this
 * score" question the advancement and eligibility layers ask is a structured M4 Requirement — the same predicate
 * kinds (RANK_AT_LEAST, ENTITY_OWNED, NUMERIC_COMPARE, ALL) M5 Ability construction compiles — evaluated by M4 against
 * explicit facts. Nothing here orders ranks or compares scores itself.
 */
export interface RankFact {
  readonly key: string;
  readonly rankKey: string;
  readonly order: number;
}

const emptyFacts = (): JsonObject => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });

/** M4's verdict for `requirement` over `facts`; null when M4 refuses the requirement or the facts (fail closed). */
export function requirementMet(requirement: JsonObject, facts: { readonly ranks?: readonly RankFact[]; readonly numeric?: readonly { readonly key: string; readonly value: number }[]; readonly ownedEntityIds?: readonly string[] }): boolean | null {
  const response = evaluateRequirement(requirement, {
    ...emptyFacts(),
    ranks: (facts.ranks ?? []).map((r) => ({ key: r.key, rankKey: r.rankKey, order: r.order, provenance: null })),
    numeric: (facts.numeric ?? []).map((n) => ({ key: n.key, value: n.value, provenance: null })),
    ownedEntityIds: facts.ownedEntityIds === undefined ? null : [...facts.ownedEntityIds],
  });
  if (!response.success || response.data === null) return null;
  return response.data.satisfied;
}

/** RANK_AT_LEAST: `actual` (a rank on an ordered ladder) is at least `required`. */
export function rankAtLeast(factKey: string, actual: { readonly rankKey: string; readonly order: number }, required: { readonly rankKey: string; readonly order: number }): boolean | null {
  return requirementMet({ kind: "RANK_AT_LEAST", factKey, requiredRankKey: required.rankKey, requiredOrder: required.order, provenance: null }, { ranks: [{ key: factKey, rankKey: actual.rankKey, order: actual.order }] });
}

/** NUMERIC_COMPARE `value operator expected`. */
export function numericCompare(factKey: string, value: number, operator: "<=" | ">=" | "==", expected: number): boolean | null {
  return requirementMet({ kind: "NUMERIC_COMPARE", factKey, operator, expected, provenance: null }, { numeric: [{ key: factKey, value }] });
}
