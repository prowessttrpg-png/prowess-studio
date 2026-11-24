import { evaluateFormula } from "@prowess/rules";
import type { ConcentrationRulePayload, ValueFormula } from "../definition/rules-authoring-payload.js";
import { deepFreeze } from "../internal/plain-data.js";
import type { ProwessStat } from "../vocabulary/core.js";

/**
 * RULES-WO1 — a PREVIEW of an authored CONCENTRATION_RULE: capacity for given Stats, the AP upkeep of each Sustained
 * Spell for its casting AP, and how assigned Concentration points cover that upkeep. Pure; reads only the rule and the
 * sample inputs. It is NOT the combat rule: nothing in play reads a CONCENTRATION_RULE in RULES-WO1, and the preview
 * says so (`appliesInPlay: false`). What the rule leaves open (reassignment, saves, refunds, Summon / Mage Art cases)
 * is returned as written questions — never decided here.
 */
export const CONCENTRATION_PREVIEW_ISSUE_CODES = deepFreeze({
  INPUT_UNAVAILABLE: "PROWESS_CONCENTRATION.INPUT_UNAVAILABLE",
  EVALUATION_FAILED: "PROWESS_CONCENTRATION.EVALUATION_FAILED",
  OVER_CAPACITY: "PROWESS_CONCENTRATION.OVER_CAPACITY",
  SPLIT_NOT_ALLOWED: "PROWESS_CONCENTRATION.SPLIT_NOT_ALLOWED",
  STACK_NOT_ALLOWED: "PROWESS_CONCENTRATION.STACK_NOT_ALLOWED",
  INVALID_SAMPLE: "PROWESS_CONCENTRATION.INVALID_SAMPLE",
} as const);
const E = CONCENTRATION_PREVIEW_ISSUE_CODES;

export interface ConcentrationPreviewEffect {
  readonly label: string;
  readonly castAp: number;
  readonly assignedPoints: number;
}
export interface ConcentrationPreviewResult {
  readonly capacity: number | null;
  readonly assignedPoints: number;
  readonly freePoints: number | null;
  readonly effects: readonly {
    readonly label: string;
    readonly castAp: number;
    readonly upkeepAp: number | null;
    readonly assignedPoints: number;
    readonly coveredAp: number | null;
    readonly payableAp: number | null;
  }[];
  readonly totalPayableAp: number | null;
  /** MP upkeep and Mana Lock are separate costs this rule does not waive (unless the rule says it does). */
  readonly mpUpkeepStillPaid: boolean;
  readonly manaLockStillApplies: boolean;
  readonly openQuestions: readonly string[];
  readonly appliesInPlay: false;
  readonly issues: readonly { readonly code: string; readonly message: string }[];
}

function run(formula: ValueFormula, bindings: Record<string, number>): number | null {
  const out = evaluateFormula({ expression: formula.expression, rounding: formula.rounding, minimum: formula.minimum, maximum: formula.maximum, unit: null }, bindings);
  return out.success && out.data !== null ? out.data.finalValue : null;
}

/** One M4 Formula over named whole numbers (every arithmetic step of the preview goes through M4). */
function m4(expression: string, bindings: Record<string, number>): number | null {
  const out = evaluateFormula({ expression, rounding: "NONE" }, bindings);
  return out.success && out.data !== null ? out.data.finalValue : null;
}
const sumOf = (values: readonly number[]): number | null => {
  const names = values.map((_, i) => `t${i}`);
  return m4(names.length === 0 ? "0" : names.join(" + "), Object.fromEntries(names.map((n, i) => [n, values[i] as number])));
};

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function previewConcentration(request: {
  readonly rule: ConcentrationRulePayload;
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
  readonly level: number | null;
  readonly effects: readonly ConcentrationPreviewEffect[];
}): ConcentrationPreviewResult {
  const { rule } = request;
  const issues: { code: string; message: string }[] = [];
  const capBindings: Record<string, number> = {};
  let capMissing: string | null = null;
  for (const { variable, source } of rule.capacity.variables) {
    const v = source.kind === "STAT" ? request.stats[source.stat] : source.kind === "LEVEL" ? request.level : undefined;
    if (typeof v !== "number") capMissing = source.kind === "STAT" ? source.stat : "Level";
    else capBindings[variable] = v;
  }
  let capacity: number | null = null;
  if (capMissing !== null) issues.push({ code: E.INPUT_UNAVAILABLE, message: `capacity needs ${capMissing}` });
  else {
    capacity = run(rule.capacity, capBindings);
    if (capacity === null) issues.push({ code: E.EVALUATION_FAILED, message: "the capacity Formula could not be evaluated" });
  }

  const coverage = rule.allocation.apCoveredPerPoint;
  const effects = request.effects.map((e) => {
    if (!isCount(e.castAp) || !isCount(e.assignedPoints)) {
      issues.push({ code: E.INVALID_SAMPLE, message: `${e.label}: casting AP and assigned points are whole numbers of at least 0` });
      return { label: e.label, castAp: e.castAp, upkeepAp: null, assignedPoints: e.assignedPoints, coveredAp: null, payableAp: null };
    }
    const bindings: Record<string, number> = {};
    for (const { variable } of rule.sustainedSpellUpkeepAp.variables) bindings[variable] = e.castAp;
    const upkeepAp = run(rule.sustainedSpellUpkeepAp, bindings);
    if (upkeepAp === null) issues.push({ code: E.EVALUATION_FAILED, message: `${e.label}: the upkeep Formula could not be evaluated` });
    if (e.assignedPoints > 1 && !rule.allocation.mayStackOnOneEffect) issues.push({ code: E.STACK_NOT_ALLOWED, message: `${e.label}: this rule does not allow more than one point on one Effect` });
    const coveredAp = upkeepAp === null ? null : m4("min(upkeep, points * coverage)", { upkeep: upkeepAp, points: e.assignedPoints, coverage });
    const payableAp = upkeepAp === null || coveredAp === null ? null : rule.allocation.uncoveredApPaid ? m4("upkeep - covered", { upkeep: upkeepAp, covered: coveredAp }) : 0;
    return { label: e.label, castAp: e.castAp, upkeepAp, assignedPoints: e.assignedPoints, coveredAp, payableAp };
  });
  const assignedPoints = sumOf(effects.flatMap((e) => (isCount(e.assignedPoints) ? [e.assignedPoints] : []))) ?? 0;
  if (!rule.allocation.maySplitAcrossEffects && effects.filter((e) => e.assignedPoints > 0).length > 1) issues.push({ code: E.SPLIT_NOT_ALLOWED, message: "this rule does not allow points to be split across Effects" });
  if (capacity !== null && assignedPoints > capacity) issues.push({ code: E.OVER_CAPACITY, message: `${assignedPoints} points are assigned but the capacity is ${capacity}` });
  const totalPayableAp = effects.every((e) => e.payableAp !== null) ? sumOf(effects.map((e) => e.payableAp as number)) : null;
  return deepFreeze({
    capacity,
    assignedPoints,
    freePoints: capacity === null ? null : m4("capacity - assigned", { capacity, assigned: assignedPoints }),
    effects,
    totalPayableAp,
    mpUpkeepStillPaid: !rule.allocation.waivesMpUpkeep,
    manaLockStillApplies: !rule.allocation.waivesManaLock,
    openQuestions: rule.openQuestions.map((q) => q.question),
    appliesInPlay: false as const,
    issues,
  });
}
