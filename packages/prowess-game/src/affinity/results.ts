import { findResolvedKeywordById, type ResolvedKeywordSet } from "@prowess/rules";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, own, type ProwessOutcome } from "../internal/problems.js";
import { AFFINITY_ERROR_CODES as A, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { AbilityComponentContract } from "../vocabulary/families.js";
import type { AffinityAlignment, AffinityCostTarget, AffinityRank, AffinityRole, AffinityWeaknessSeverity, SpellConstructionAuthority } from "../vocabulary/affinity.js";
import type { CanonicalAffinity } from "../vocabulary/construction.js";
import type { AffinityCompiledRule, ProwessAffinityCompiledPlan } from "./compile.js";

/**
 * Reading an evaluated Affinity plan (PAS-10 M5-WO4 §78, §131, §151–§156). Every value is COPIED from an M4 step
 * response: whether a rule matched (an M4 Requirement), which exact Keyword matched and who contributed it (the M4
 * KEYWORD set, looked up through M4's own exact query), the selected highest Weakness (an M4 MAX), and each cost value
 * before / after (M4 modifier outcomes). The reader never recomputes, rounds or re-derives a number (§99, §127).
 * This is a pure structural reading — not a second RuleEngineResponse contract (§153).
 */
export interface AffinityKeywordSource {
  readonly componentKey: string;
  readonly contract: AbilityComponentContract | null;
  readonly definition: ProwessDefinitionRef | null;
}

export interface AffinityMatchedKeyword {
  readonly keywordId: string;
  readonly canonicalKey: string;
  /** Every explicit contributor of this Keyword, in M4 contributor order (§66, §150). */
  readonly contributors: readonly AffinityKeywordSource[];
}

export interface AffinityRuleMatch {
  readonly ruleKey: string;
  readonly matchAny: readonly string[];
  readonly matched: boolean;
  readonly matchedKeywords: readonly AffinityMatchedKeyword[];
}

export interface AffinityWeaknessMatch extends AffinityRuleMatch {
  readonly activationPenaltyPercent: number;
  readonly severity: AffinityWeaknessSeverity | null;
}

/** The pure Affinity alignment result (§78). Every matched rule is kept even when only one penalty applies (§92, §152). */
export interface AffinityAlignmentResult {
  readonly governingAffinity: { readonly affinity: ProwessDefinitionRef; readonly identity: CanonicalAffinity; readonly rank: AffinityRank; readonly role: AffinityRole; readonly rankRule: ProwessDefinitionRef };
  readonly alignment: AffinityAlignment;
  readonly strengths: readonly AffinityRuleMatch[];
  readonly weaknesses: readonly AffinityWeaknessMatch[];
  /** The Strength discount M4 actually applied (SPELL_AFFINITY_COST only; 0 when unmatched or at rank NONE). */
  readonly effectiveStrengthDiscountPercent: number | null;
  /** The highest matched Weakness percentage M4 selected (SPELL_AFFINITY_COST only; 0 when none matched). */
  readonly selectedWeaknessPercent: number | null;
  readonly issues: readonly string[];
}

/**
 * One percentage modifier's M4 outcome on the NET cost percentage (designer ruling M5-SC-028): `before` / `after` are
 * percentages of the listed cost (100 = full price), never MP.
 */
export interface AffinityCostStage {
  readonly modifierKey: string;
  readonly operation: string;
  readonly percent: number;
  readonly applied: boolean;
  readonly before: number;
  readonly after: number;
}

/** The Affinity-adjusted listed cost (§79, §133). Not final MP: Casting Conditions and final rounding come later (§98). */
export interface AffinityCostReading {
  readonly costTarget: AffinityCostTarget;
  readonly baseCost: number;
  readonly strength: AffinityCostStage | null;
  readonly weakness: AffinityCostStage | null;
  /** The combined Affinity percentage of the listed cost M4 computed (e.g. 90 = a net −10%), applied once (M5-SC-028). */
  readonly netCostPercent: number;
  /** Listed cost × net ÷ 100, unrounded — final rounding (normal, once) belongs to the end of Spell creation. */
  readonly affinityAdjustedCost: number;
}

export interface AffinityAuthorityReading {
  readonly authority: SpellConstructionAuthority;
  readonly minimumRank: AffinityRank;
  readonly rankSatisfied: boolean;
  /** Null at a rank that grants no Authority capacity (NONE). */
  readonly effectCapacity: { readonly capacity: number; readonly count: number; readonly satisfied: boolean } | null;
  readonly traitCapacity: { readonly capacity: number; readonly count: number; readonly satisfied: boolean } | null;
  readonly effectAccess: readonly { readonly componentKey: string; readonly satisfied: boolean; readonly granted: string | null }[];
  /** Every Requirement satisfied. A failure is a valid result, never an engine error; nothing is truncated (§193). */
  readonly valid: boolean;
}

export interface AffinityAccessReading {
  readonly requirementKey: string;
  readonly affinity: ProwessDefinitionRef;
  readonly minimumRank: AffinityRank;
  readonly satisfied: boolean;
}

export interface AffinityRunReading {
  readonly alignment: AffinityAlignmentResult | null;
  readonly cost: AffinityCostReading | null;
  readonly authority: AffinityAuthorityReading | null;
  readonly access: readonly AffinityAccessReading[];
}

/** Reads every named output of `plan` from an M4 EvaluationRun of exactly that plan. Fails closed on a foreign / incomplete run. */
export function readAffinityRun(input: { readonly plan: ProwessAffinityCompiledPlan; readonly run: unknown }): ProwessOutcome<AffinityRunReading> {
  const p = new Problems();
  if (!checkPlainData(input.run, ["run"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const steps = isPlainObject(input.run) ? own(input.run, "steps") : undefined;
  if (!Array.isArray(steps)) {
    p.add(A.INCOMPLETE_RUN, ["run"], "an EvaluationRun has a steps array");
    return finish(p, () => null as never);
  }
  const planned = new Set(input.plan.evaluationPlan.steps.map((s) => s.stepKey));
  const ran = new Set(steps.map((s: unknown) => (isPlainObject(s) ? own(s, "stepKey") : null)));
  if (planned.size !== ran.size || ![...planned].every((k) => ran.has(k))) p.add(A.INCOMPLETE_RUN, ["run", "steps"], "the run is not an evaluation of exactly this plan");
  const data = (stepKey: string): Record<string, unknown> | null => {
    const step = steps.find((s: unknown) => isPlainObject(s) && own(s, "stepKey") === stepKey) as Record<string, unknown> | undefined;
    const response = step === undefined ? undefined : own(step, "response");
    const value = isPlainObject(response) && own(response, "success") === true ? own(response, "data") : undefined;
    if (step === undefined || own(step, "executionStatus") !== "EXECUTED" || !isPlainObject(value)) {
      p.add(A.INCOMPLETE_RUN, ["run", "steps"], `step ${stepKey} did not execute successfully`);
      return null;
    }
    return value;
  };
  if (p.count > 0) return finish(p, () => null as never);
  const o = input.plan.outputs;

  const keywordSet = (stepKey: string | null): ResolvedKeywordSet | null => (stepKey === null ? null : (data(stepKey) as unknown as ResolvedKeywordSet | null));
  const sourceOf = (componentKey: string): AffinityKeywordSource => {
    const c = o.contributors.find((x) => x.componentKey === componentKey);
    return { componentKey, contract: c?.contract ?? null, definition: c?.definition ?? null };
  };
  const set = keywordSet(o.keywords);
  /** A rule's M4 outcome: satisfied, plus each KEYWORD_PRESENT leaf M4 found present, with its exact contributors. */
  const ruleMatch = (rule: AffinityCompiledRule): AffinityRuleMatch | null => {
    const d = data(rule.stepKey);
    if (d === null) return null;
    const outcome = own(d, "outcome") as Record<string, unknown>;
    const leaves = (own(outcome, "children") as Record<string, unknown>[]) ?? [];
    const matchedKeywords: AffinityMatchedKeyword[] = [];
    for (const leaf of leaves) {
      if (own(leaf, "satisfied") !== true) continue;
      const keywordId = own(own(leaf, "expected") as Record<string, unknown>, "keywordId") as string;
      const resolved = set === null ? null : findResolvedKeywordById(set, keywordId);
      if (resolved === null) continue;
      matchedKeywords.push({ keywordId, canonicalKey: resolved.keyword.canonicalKey, contributors: resolved.contributors.map((c) => sourceOf(c.source.sourceKey)) });
    }
    return { ruleKey: rule.ruleKey, matchAny: rule.matchAny, matched: own(d, "satisfied") === true, matchedKeywords };
  };

  let alignment: AffinityAlignmentResult | null = null;
  let cost: AffinityCostReading | null = null;
  if (o.governing !== null && o.keywords !== null && input.plan.subject.kind !== "AFFINITY_AUTHORITY") {
    const strengths = o.strengths.flatMap((s) => {
      const m = ruleMatch(s);
      return m === null ? [] : [m];
    });
    const weaknesses = o.weaknesses.flatMap((w) => {
      const m = ruleMatch(w);
      return m === null ? [] : [{ ...m, activationPenaltyPercent: w.activationPenaltyPercent, severity: w.severity }];
    });
    const anyStrength = strengths.some((s) => s.matched);
    const anyWeakness = weaknesses.some((w) => w.matched);
    let effectiveStrengthDiscountPercent: number | null = null;
    let selectedWeaknessPercent: number | null = null;
    if (o.cost !== null) {
      const c = o.cost;
      const d = data(c.stepKey);
      const net = data(c.netStepKey);
      const outcomes = net === null ? [] : (own(net, "outcomes") as Record<string, unknown>[]);
      const netTargets = net === null ? [] : (own(net, "finalTargets") as Record<string, unknown>[]);
      const finalTargets = d === null ? [] : (own(d, "finalTargets") as Record<string, unknown>[]);
      const stage = (modifierKey: string | null): AffinityCostStage | null => {
        if (modifierKey === null) return null;
        const x = outcomes.find((y) => own(y, "modifierKey") === modifierKey);
        if (x === undefined) return null;
        return { modifierKey, operation: own(x, "operation") as string, percent: own(x, "operand") as number, applied: own(x, "status") === "APPLIED", before: own(x, "before") as number, after: own(x, "after") as number };
      };
      const strength = stage(c.strengthModifierKey);
      const weakness = stage(c.weaknessModifierKey);
      const selection = o.weaknessSelection === null ? null : data(o.weaknessSelection);
      effectiveStrengthDiscountPercent = strength !== null && strength.applied ? strength.percent : 0;
      selectedWeaknessPercent = selection === null ? 0 : (own((own(selection, "finalTargets") as Record<string, unknown>[])[0] as Record<string, unknown>, "value") as number);
      const target = finalTargets.find((t) => own(t, "targetKey") === c.targetKey);
      const netTarget = netTargets[0];
      if (target !== undefined && netTarget !== undefined) cost = { costTarget: c.costTarget, baseCost: c.baseCost, strength, weakness, netCostPercent: own(netTarget, "value") as number, affinityAdjustedCost: own(target, "value") as number };
    }
    alignment = {
      governingAffinity: o.governing,
      alignment: anyStrength && anyWeakness ? "STRENGTH_AND_WEAKNESS" : anyStrength ? "STRENGTH" : anyWeakness ? "WEAKNESS" : "NEUTRAL",
      strengths,
      weaknesses,
      effectiveStrengthDiscountPercent,
      selectedWeaknessPercent,
      issues: [],
    };
  }

  let authority: AffinityAuthorityReading | null = null;
  if (o.authority !== null) {
    const a = o.authority;
    const satisfied = (stepKey: string) => own(data(stepKey) ?? {}, "satisfied") === true;
    const effectCapacity = a.effectCapacity === null ? null : { capacity: a.effectCapacity.capacity, count: a.effectCapacity.count, satisfied: satisfied(a.effectCapacity.stepKey) };
    const traitCapacity = a.traitCapacity === null ? null : { capacity: a.traitCapacity.capacity, count: a.traitCapacity.count, satisfied: satisfied(a.traitCapacity.stepKey) };
    const effectAccess = a.effectAccess.map((x) => ({ componentKey: x.componentKey, satisfied: satisfied(x.stepKey), granted: x.granted }));
    const rankSatisfied = satisfied(a.rankStep);
    authority = {
      authority: a.authority,
      minimumRank: a.minimumRank,
      rankSatisfied,
      effectCapacity,
      traitCapacity,
      effectAccess,
      valid: rankSatisfied && effectCapacity !== null && effectCapacity.satisfied && traitCapacity !== null && traitCapacity.satisfied && effectAccess.every((x) => x.satisfied),
    };
  }
  const access = o.access.map((x) => ({ requirementKey: x.requirementKey, affinity: x.affinity, minimumRank: x.minimumRank, satisfied: own(data(x.stepKey) ?? {}, "satisfied") === true }));
  return finish(p, () => deepFreeze({ alignment, cost, authority, access }));
}
