import { evaluateFormula } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { CalculatedValuePayload, CalculatedValuePlacement, CanonStatus, SkillBenefitPayload, ValueFormula } from "../definition/rules-authoring-payload.js";
import { deepFreeze } from "../internal/plain-data.js";
import type { DerivedStatistic, ProwessStat } from "../vocabulary/core.js";
import type { CharacterMechanicalProfile } from "./advancement.js";

/**
 * RULES-WO1 — evaluation of authored CALCULATED_VALUE Definitions and the SKILL_BENEFIT contributions to them.
 *
 * No new arithmetic: every base and every contribution is an M4 Formula run by `evaluateFormula`; this module only
 * binds named game facts to the declared inputs, orders values by their dependencies (a cycle is refused, never
 * broken arbitrarily) and adds contributions to the base. A value whose base the source does not state (base: null)
 * reports `baseStated: false` and its total is ONLY the sum of its contributions — no base is invented.
 */
export const CALCULATED_VALUE_ISSUE_CODES = deepFreeze({
  DUPLICATE_VALUE_KEY: "PROWESS_VALUE.DUPLICATE_VALUE_KEY",
  UNKNOWN_VALUE: "PROWESS_VALUE.UNKNOWN_VALUE",
  DEPENDENCY_CYCLE: "PROWESS_VALUE.DEPENDENCY_CYCLE",
  INPUT_UNAVAILABLE: "PROWESS_VALUE.INPUT_UNAVAILABLE",
  EVALUATION_FAILED: "PROWESS_VALUE.EVALUATION_FAILED",
  UNKNOWN_RANK: "PROWESS_VALUE.UNKNOWN_RANK",
  PREREQUISITES_NOT_EVALUATED: "PROWESS_VALUE.PREREQUISITES_NOT_EVALUATED",
} as const);
const E = CALCULATED_VALUE_ISSUE_CODES;

/** The named game facts a value may read. Absent facts make the reading value unavailable (never zero). */
export interface ValueFacts {
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
  readonly level: number | null;
  readonly derived: Readonly<Partial<Record<DerivedStatistic, number>>>;
  /** The Character's rank in each Skill, by the Skill's Entity id. A Skill not listed is at the ladder's first rank. */
  readonly skillRanks: readonly { readonly skillEntityId: string; readonly rankKey: string }[];
}

export interface AuthoredValue {
  readonly definition: ProwessDefinitionRef | null;
  readonly payload: CalculatedValuePayload;
}
export interface AuthoredBenefit {
  readonly definition: ProwessDefinitionRef | null;
  readonly payload: SkillBenefitPayload;
}

export interface ValueContributionResult {
  readonly benefit: ProwessDefinitionRef | null;
  readonly benefitKey: string;
  readonly contributionKey: string;
  readonly skill: ProwessDefinitionRef;
  readonly minimumRankKey: string;
  /** Whether the Character holds the Skill at the benefit's rank or higher. */
  readonly applies: boolean;
  readonly amount: number | null;
}

export interface CalculatedValueResult {
  readonly valueKey: string;
  readonly definition: ProwessDefinitionRef | null;
  readonly unit: string | null;
  readonly canonStatus: CanonStatus;
  readonly placement: CalculatedValuePlacement;
  readonly note: string | null;
  readonly baseStated: boolean;
  readonly base: number | null;
  readonly contributions: readonly ValueContributionResult[];
  /** base (when stated) + every applying contribution; null when unavailable. */
  readonly total: number | null;
  readonly unavailable: string | null;
}

export interface CalculatedValuesOutcome {
  readonly values: readonly CalculatedValueResult[];
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

type Issue = { code: string; path: string; message: string };

function bindInputs(formula: ValueFormula, facts: ValueFacts, values: ReadonlyMap<string, number | null>): { bindings: Record<string, number> } | { missing: string } {
  const bindings: Record<string, number> = {};
  for (const { variable, source } of formula.variables) {
    let v: number | null | undefined;
    let what: string;
    switch (source.kind) {
      case "STAT":
        v = facts.stats[source.stat];
        what = source.stat;
        break;
      case "LEVEL":
        v = facts.level;
        what = "Level";
        break;
      case "DERIVED":
        v = facts.derived[source.statistic];
        what = source.statistic;
        break;
      case "CALCULATED_VALUE":
        v = values.get(source.valueKey);
        what = source.valueKey;
        break;
      case "CAST_AP":
        v = undefined;
        what = "casting AP";
        break;
      case "TOTAL_MP":
        v = undefined;
        what = "total MP";
        break;
    }
    if (typeof v !== "number") return { missing: what };
    bindings[variable] = v;
  }
  return { bindings };
}

function run(formula: ValueFormula, bindings: Record<string, number>): number | null {
  const out = evaluateFormula({ expression: formula.expression, rounding: formula.rounding, minimum: formula.minimum, maximum: formula.maximum, unit: null }, bindings);
  return out.success && out.data !== null ? out.data.finalValue : null;
}

/** An M4 sum of whole terms (0 terms → 0). */
function sumOf(values: readonly number[]): number | null {
  const names = values.map((_, i) => `t${i}`);
  const out = evaluateFormula({ expression: names.length === 0 ? "0" : names.join(" + "), rounding: "NONE" }, Object.fromEntries(names.map((n, i) => [n, values[i]])));
  return out.success && out.data !== null ? out.data.finalValue : null;
}

/**
 * Evaluates every authored value against `facts`. `ladder` is the Skill rank ladder (explicit order) of the Release;
 * a benefit whose rank is not on it never applies and is reported.
 */
export function evaluateCalculatedValues(request: {
  readonly values: readonly AuthoredValue[];
  readonly benefits: readonly AuthoredBenefit[];
  readonly ladder: readonly { readonly rankKey: string; readonly order: number }[];
  readonly facts: ValueFacts;
}): CalculatedValuesOutcome {
  const issues: Issue[] = [];
  const byKey = new Map<string, AuthoredValue>();
  for (const v of request.values) {
    if (byKey.has(v.payload.valueKey)) issues.push({ code: E.DUPLICATE_VALUE_KEY, path: v.payload.valueKey, message: `more than one published value is named ${v.payload.valueKey}; none of them is shown` });
    byKey.set(v.payload.valueKey, v);
  }
  const duplicated = new Set(issues.map((i) => i.path));
  const ladder = [...request.ladder].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const rankOf = (skillEntityId: string) => {
    const held = request.facts.skillRanks.find((s) => s.skillEntityId === skillEntityId)?.rankKey ?? ladder[0]?.rankKey;
    return ladder.find((r) => r.rankKey === held) ?? null;
  };

  // Contributions per value, in a stable order.
  const contributionsFor = new Map<string, { benefit: AuthoredBenefit; contribution: SkillBenefitPayload["contributions"][number] }[]>();
  for (const benefit of [...request.benefits].sort((a, b) => (a.payload.benefitKey < b.payload.benefitKey ? -1 : a.payload.benefitKey > b.payload.benefitKey ? 1 : 0))) {
    if (!ladder.some((r) => r.rankKey === benefit.payload.minimumRankKey)) issues.push({ code: E.UNKNOWN_RANK, path: benefit.payload.benefitKey, message: `${benefit.payload.benefitKey} names rank ${benefit.payload.minimumRankKey}, which is not on the Skill rank ladder` });
    if (benefit.payload.prerequisites.length > 0) issues.push({ code: E.PREREQUISITES_NOT_EVALUATED, path: benefit.payload.benefitKey, message: `${benefit.payload.benefitKey} has prerequisites beyond its rank; the sheet does not evaluate them yet, so it is not applied` });
    for (const contribution of benefit.payload.contributions) {
      if (!byKey.has(contribution.valueKey)) {
        issues.push({ code: E.UNKNOWN_VALUE, path: `${benefit.payload.benefitKey}.${contribution.contributionKey}`, message: `${benefit.payload.benefitKey} adds to ${contribution.valueKey}, which this Release does not define` });
        continue;
      }
      contributionsFor.set(contribution.valueKey, [...(contributionsFor.get(contribution.valueKey) ?? []), { benefit, contribution }]);
    }
  }

  // Dependency order (base inputs only — contributions read Stats / Level / derived statistics, never values).
  const deps = (v: AuthoredValue) => (v.payload.base?.variables ?? []).flatMap((i) => (i.source.kind === "CALCULATED_VALUE" ? [i.source.valueKey] : []));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const cyclic = new Set<string>();
  const visit = (key: string, path: string[]): void => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") {
      for (const k of path.slice(path.indexOf(key))) cyclic.add(k);
      return;
    }
    state.set(key, "visiting");
    const v = byKey.get(key);
    if (v !== undefined) for (const d of deps(v)) if (byKey.has(d)) visit(d, [...path, d]);
    state.set(key, "done");
    order.push(key);
  };
  for (const key of [...byKey.keys()].sort()) visit(key, [key]);
  for (const key of [...cyclic].sort()) issues.push({ code: E.DEPENDENCY_CYCLE, path: key, message: `${key} depends on itself through other values; it cannot be calculated` });

  const totals = new Map<string, number | null>();
  const results = new Map<string, CalculatedValueResult>();
  for (const key of order) {
    const v = byKey.get(key)!;
    const p = v.payload;
    let unavailable: string | null = duplicated.has(key) ? "more than one published value has this name" : cyclic.has(key) ? "it depends on itself through other values" : null;
    let base: number | null = null;
    if (unavailable === null && p.base !== null) {
      const bound = bindInputs(p.base, request.facts, totals);
      if ("missing" in bound) {
        unavailable = `${bound.missing} is not available for this Character`;
        issues.push({ code: E.INPUT_UNAVAILABLE, path: key, message: `${key}: ${unavailable}` });
      } else {
        base = run(p.base, bound.bindings);
        if (base === null) {
          unavailable = "its calculation could not be evaluated";
          issues.push({ code: E.EVALUATION_FAILED, path: key, message: `${key}: the base Formula could not be evaluated` });
        }
      }
    }
    const contributions: ValueContributionResult[] = (contributionsFor.get(key) ?? []).map(({ benefit, contribution }) => {
      const held = rankOf(benefit.payload.skill.entityId);
      const required = ladder.find((r) => r.rankKey === benefit.payload.minimumRankKey);
      // A benefit with further prerequisites is never applied here: the sheet does not evaluate them yet (R08).
      const gated = benefit.payload.prerequisites.length > 0;
      const applies = !gated && held !== null && required !== undefined && held.order >= required.order;
      let amount: number | null = null;
      if (applies) {
        const bound = bindInputs(contribution.amount, request.facts, totals);
        amount = "missing" in bound ? null : run(contribution.amount, bound.bindings);
        if (amount === null) issues.push({ code: E.EVALUATION_FAILED, path: `${key}.${contribution.contributionKey}`, message: `${benefit.payload.benefitKey}: its contribution to ${key} could not be evaluated` });
      }
      return { benefit: benefit.definition, benefitKey: benefit.payload.benefitKey, contributionKey: contribution.contributionKey, skill: benefit.payload.skill, minimumRankKey: benefit.payload.minimumRankKey, applies, amount };
    });
    if (unavailable === null && contributions.some((c) => c.applies && c.amount === null)) unavailable = "a Skill benefit could not be evaluated";
    // The total is an M4 sum of the stated base (if any) and every applying addition — no arithmetic outside M4.
    const parts = [...(base === null ? [] : [base]), ...contributions.flatMap((c) => (c.applies && c.amount !== null ? [c.amount] : []))];
    const total = unavailable !== null ? null : sumOf(parts);
    totals.set(key, total);
    results.set(key, { valueKey: key, definition: v.definition, unit: p.unit, canonStatus: p.canonStatus, placement: p.placement, note: p.note, baseStated: p.base !== null, base, contributions, total, unavailable });
  }
  return deepFreeze({ values: [...results.keys()].sort().map((k) => results.get(k)!), issues });
}

/** The published CALCULATED_VALUE and SKILL_BENEFIT Definitions of a Release bundle. */
export function authoredValuesOf(bundle: ProwessDefinitionBundle): { values: AuthoredValue[]; benefits: AuthoredBenefit[] } {
  return {
    values: bundle.definitions.filter((d) => d.definitionKind === "CALCULATED_VALUE").map((d) => ({ definition: definitionRefOf(d), payload: d.payload as unknown as CalculatedValuePayload })),
    benefits: bundle.definitions.filter((d) => d.definitionKind === "SKILL_BENEFIT").map((d) => ({ definition: definitionRefOf(d), payload: d.payload as unknown as SkillBenefitPayload })),
  };
}

/** The named facts of one Character, from its mechanical profile (the profile is the only source). */
export function valueFactsOf(profile: CharacterMechanicalProfile): ValueFacts {
  const stats: Partial<Record<ProwessStat, number>> = {};
  for (const s of profile.stats) stats[s.stat] = s.final;
  const derived: Partial<Record<DerivedStatistic, number>> = {};
  for (const d of profile.derivedStatistics) derived[d.statistic] = d.value;
  return { stats, level: profile.level, derived, skillRanks: profile.skills.map((s) => ({ skillEntityId: s.skill.entityId, rankKey: s.rankKey })) };
}

/** Every published calculated value of a Character's exact Release, evaluated for that Character. */
export function calculatedValuesForCharacter(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile }): CalculatedValuesOutcome {
  const { values, benefits } = authoredValuesOf(request.bundle);
  if (values.length === 0) return deepFreeze({ values: [], issues: [] });
  const core = indexCoreDefinitions(request.bundle);
  const ladder = core.ok ? core.value.skillLadder.payload.ranks : [];
  return evaluateCalculatedValues({ values, benefits, ladder, facts: valueFactsOf(request.profile) });
}
