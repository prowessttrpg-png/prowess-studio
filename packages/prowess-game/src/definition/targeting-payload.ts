import type { JsonObject } from "@prowess/model";
import { validateFormulaProgram } from "@prowess/rules";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import type { TargetingSemanticShape } from "../vocabulary/construction.js";
import { DERIVED_STATISTICS, PROWESS_STATS, type DerivedStatistic, type ProwessStat } from "../vocabulary/core.js";
import {
  AURA_SOURCES,
  RADIUS_MEASURE,
  SPELL_TARGETING_COST_CURRENCY,
  BASE_TARGETING_SHAPES,
  COVER_POLICIES,
  DELIVERY_FAMILIES,
  SIGHT_POLICIES,
  TARGET_CARDINALITY_KINDS,
  TARGET_CATEGORIES,
  TARGETING_COST_KINDS,
  TARGETING_MEASURES,
  TARGETING_MEASURE_STATUSES,
  TARGETING_ORIGIN_MODES,
  TARGETING_PARAMETER_KINDS,
  TARGETING_PLACEMENT_MODELS,
  TARGETING_RANGE_MODELS,
  TARGETING_VARIABLE_SOURCES,
  type AuraSource,
  type CoverPolicy,
  type DeliveryFamily,
  type SightPolicy,
  type TargetCategory,
  type TargetingMeasure,
  type TargetingOriginMode,
  type TargetingParameterKind,
  type TargetingPlacementModel,
  type TargetingRangeModel,
} from "../vocabulary/targeting.js";
import { TARGETING_ERROR_CODES as T } from "./codes.js";

/**
 * The typed `rules.targeting` sub-contract of a SPELL_TARGETING / MANEUVER_TARGETING Definition (PAS-10 M5-WO6 §53–§54,
 * §109–§110). It lives inside the existing versioned TARGETING payload (no schema change, no new kind) and states WHERE /
 * WHO / HOW FAR / WHAT SHAPE / HOW MANY / FROM WHERE / PLACEMENT — never WHAT HAPPENS (§4, M5-I159). Every distance is an
 * authored M4 Formula; an unresolved canon value is an explicit DEFERRED_PENDING_CANON entry, never a number (§119).
 *
 * The LISTED Targeting cost contributions stay on the payload's existing `costContributions` surface (§61) and are
 * typed here: BASE / BASE_DEFERRED / PER_STEP / PER_ADDITIONAL_TARGET / PER_SELECTION. A MANEUVER_TARGETING Definition
 * carries none: the Targeting Conversion Effect owns the cost (§82, M5-I172).
 */

export type TargetingVariableDeclaration =
  | { readonly variable: string; readonly source: { readonly kind: "STAT"; readonly stat: ProwessStat } }
  | { readonly variable: string; readonly source: { readonly kind: "DERIVED"; readonly statistic: DerivedStatistic } }
  | { readonly variable: string; readonly source: { readonly kind: "PARAMETER"; readonly parameter: string } }
  | { readonly variable: string; readonly source: { readonly kind: "SKILL_RANK_TABLE"; readonly table: string } };

/** An authored M4 Formula program and the declared source of each of its variables (§100, §103). */
export interface TargetingFormula {
  readonly expression: string;
  readonly rounding: "NONE" | "FLOOR" | "CEIL";
  readonly minimum: number | null;
  readonly unit: string;
  readonly variables: readonly TargetingVariableDeclaration[];
}

export type TargetingMeasureRule =
  | { readonly measure: TargetingMeasure; readonly valueStatus: "FORMULA"; readonly formula: TargetingFormula }
  | { readonly measure: TargetingMeasure; readonly valueStatus: "DEFERRED_PENDING_CANON"; readonly conflictKey: string; readonly ruleText: string }
  | { readonly measure: TargetingMeasure; readonly valueStatus: "EFFECT_DEFINED" };

export interface TargetingParameterRule {
  readonly parameter: string;
  readonly kind: TargetingParameterKind;
  /** COUNT / STEPS: the smallest legal value (checked by an M4 REQUIREMENT). */
  readonly minimum: number | null;
  /** STEPS / FLAG / TOKEN: the authored value when the use omits the parameter (COUNT has none: it is chosen explicitly). */
  readonly default: number | boolean | string | null;
  /** TOKEN: the exact allowed values. */
  readonly allowed: readonly string[];
}

export interface TargetingRankTable {
  readonly tableKey: string;
  readonly skillKey: string;
  readonly entries: readonly { readonly rankKey: string; readonly value: number }[];
}

export type TargetingCardinality =
  | { readonly kind: "ONE" }
  | { readonly kind: "SELECTED"; readonly parameter: string; readonly minimum: number }
  | { readonly kind: "AREA" }
  | { readonly kind: "CHAIN" };

export interface TargetingRules {
  readonly deliveryFamily: DeliveryFamily;
  readonly cardinality: TargetingCardinality;
  readonly validTargets: readonly TargetCategory[];
  readonly range: { readonly model: TargetingRangeModel; readonly formula: TargetingFormula | null; readonly ruleText: string | null };
  readonly measures: readonly TargetingMeasureRule[];
  readonly origin: { readonly modes: readonly TargetingOriginMode[]; readonly default: TargetingOriginMode | null; readonly sources: readonly AuraSource[]; readonly defaultSource: AuraSource | null };
  readonly placement: TargetingPlacementModel;
  readonly lineOfSight: SightPolicy;
  readonly lineOfEffect: SightPolicy;
  readonly cover: CoverPolicy;
  /** Explicit structured metadata for Traits that modify a radius (Widen Area, M5-SC-024, owned by WO8). Never inferred. */
  readonly radiusCapable: boolean;
  readonly parameters: readonly TargetingParameterRule[];
  readonly rankTables: readonly TargetingRankTable[];
}

export type TargetingCostRule =
  | { readonly contributionKey: string; readonly kind: "BASE"; readonly currency: string; readonly amount: number }
  | { readonly contributionKey: string; readonly kind: "BASE_DEFERRED"; readonly currency: string; readonly conflictKey: string }
  | { readonly contributionKey: string; readonly kind: "PER_STEP"; readonly currency: string; readonly parameter: string; readonly amount: number; readonly step: { readonly size: number; readonly unit: string } }
  | { readonly contributionKey: string; readonly kind: "PER_ADDITIONAL_TARGET"; readonly currency: string; readonly parameter: string; readonly amount: number }
  | { readonly contributionKey: string; readonly kind: "PER_SELECTION"; readonly currency: string; readonly parameter: string; readonly amount: number; readonly values: readonly (string | boolean)[] };

const RULE_FIELDS = ["deliveryFamily", "cardinality", "validTargets", "range", "measures", "origin", "placement", "lineOfSight", "lineOfEffect", "cover", "radiusCapable", "parameters", "rankTables"];
const RULE_REQUIRED = ["deliveryFamily", "cardinality", "validTargets", "range", "measures", "origin", "placement", "lineOfSight", "lineOfEffect", "cover", "radiusCapable", "parameters"];
const CONFLICT_KEY = /^M5-SC-\d{3}$/;
const PARAMETER_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

const nonNegative = (value: unknown, at: readonly PathSegment[], p: Problems, what: string): number | null => {
  const n = readSafeInteger(value, at, p, T.INVALID_TARGETING_RULES, what);
  if (n !== null && n < 0) {
    p.add(T.INVALID_TARGETING_RULES, at, `${what} is a non-negative safe integer`);
    return null;
  }
  return n;
};

const text = (value: unknown, at: readonly PathSegment[], p: Problems, what: string): string | null => {
  if (typeof value === "string" && value.trim().length > 0) return value;
  p.add(T.INVALID_TARGETING_RULES, at, `${what} is non-empty authored rule text`);
  return null;
};

function readTokens<V extends string>(value: unknown, allowed: readonly V[], at: readonly PathSegment[], p: Problems, what: string, allowEmpty = false): V[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    p.add(T.INVALID_TARGETING_RULES, at, `${what} is a ${allowEmpty ? "" : "non-empty "}array of tokens`);
    return [];
  }
  const out: V[] = [];
  value.forEach((v: unknown, i: number) => {
    const t = readEnum(v, allowed, [...at, i], p, T.INVALID_TARGETING_RULES, what);
    if (t !== null && out.includes(t)) p.add(T.INVALID_TARGETING_RULES, [...at, i], `${what} ${t} is listed twice`);
    else if (t !== null) out.push(t);
  });
  return out;
}

function readParameters(value: unknown, at: readonly PathSegment[], p: Problems): TargetingParameterRule[] {
  if (!Array.isArray(value)) {
    p.add(T.INVALID_TARGETING_RULES, at, "parameters is an array of declared Targeting parameters (possibly empty)");
    return [];
  }
  const out: TargetingParameterRule[] = [];
  value.forEach((raw: unknown, i: number) => {
    const r = readRecord(raw, [...at, i], p, T.INVALID_TARGETING_RULES, ["parameter", "kind", "minimum", "default", "allowed"], ["parameter", "kind"]);
    if (r === null) return;
    const parameter = own(r, "parameter");
    const kind = readEnum(own(r, "kind"), TARGETING_PARAMETER_KINDS, [...at, i, "kind"], p, T.INVALID_TARGETING_RULES, "parameter kind");
    if (typeof parameter !== "string" || !PARAMETER_NAME.test(parameter) || out.some((x) => x.parameter === parameter)) {
      p.add(T.INVALID_TARGETING_RULES, [...at, i, "parameter"], "parameter is a unique lowerCamel name");
      return;
    }
    if (kind === null) return;
    const rawMin = own(r, "minimum");
    const rawDefault = own(r, "default");
    const rawAllowed = own(r, "allowed");
    let minimum: number | null = null;
    let def: TargetingParameterRule["default"] = null;
    let allowed: string[] = [];
    if (kind === "COUNT" || kind === "STEPS") {
      minimum = rawMin === undefined ? null : nonNegative(rawMin, [...at, i, "minimum"], p, "minimum");
      if (kind === "STEPS") def = nonNegative(rawDefault, [...at, i, "default"], p, "a STEPS default");
      else if (rawDefault !== undefined) p.add(T.INVALID_TARGETING_RULES, [...at, i, "default"], "a COUNT parameter has no default: the use chooses it explicitly (§41)");
      if (rawAllowed !== undefined) p.add(T.INVALID_TARGETING_RULES, [...at, i, "allowed"], "allowed is for TOKEN parameters");
    } else if (kind === "FLAG") {
      if (typeof rawDefault !== "boolean") p.add(T.INVALID_TARGETING_RULES, [...at, i, "default"], "a FLAG default is an explicit boolean");
      else def = rawDefault;
      if (rawMin !== undefined || rawAllowed !== undefined) p.add(T.INVALID_TARGETING_RULES, [...at, i], "a FLAG has no minimum or allowed list");
    } else {
      if (!Array.isArray(rawAllowed) || rawAllowed.length === 0 || !rawAllowed.every(isToken)) p.add(T.INVALID_TARGETING_RULES, [...at, i, "allowed"], "a TOKEN parameter lists its exact allowed tokens");
      else allowed = [...(rawAllowed as string[])];
      if (rawDefault !== undefined && rawDefault !== null && (typeof rawDefault !== "string" || !allowed.includes(rawDefault))) p.add(T.INVALID_TARGETING_RULES, [...at, i, "default"], "a TOKEN default is null or one of its allowed tokens");
      else def = (rawDefault as string | null | undefined) ?? null;
      if (rawMin !== undefined) p.add(T.INVALID_TARGETING_RULES, [...at, i, "minimum"], "a TOKEN has no minimum");
    }
    out.push({ parameter, kind, minimum, default: def, allowed });
  });
  return out;
}

function readRankTables(value: unknown, at: readonly PathSegment[], p: Problems): TargetingRankTable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    p.add(T.INVALID_TARGETING_RULES, at, "rankTables is an array of { tableKey, skillKey, entries }");
    return [];
  }
  const out: TargetingRankTable[] = [];
  value.forEach((raw: unknown, i: number) => {
    const r = readRecord(raw, [...at, i], p, T.INVALID_TARGETING_RULES, ["tableKey", "skillKey", "entries"], ["tableKey", "skillKey", "entries"]);
    if (r === null) return;
    const tableKey = own(r, "tableKey");
    const skillKey = own(r, "skillKey");
    if (!isToken(tableKey) || out.some((t) => t.tableKey === tableKey)) p.add(T.INVALID_TARGETING_RULES, [...at, i, "tableKey"], "tableKey is a unique SCREAMING_SNAKE token");
    if (!isExactCanonicalKey(skillKey)) p.add(T.INVALID_TARGETING_RULES, [...at, i, "skillKey"], "skillKey is the exact canonical key of the Skill whose rank selects the row");
    const rawEntries = own(r, "entries");
    const entries: { rankKey: string; value: number }[] = [];
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) p.add(T.INVALID_TARGETING_RULES, [...at, i, "entries"], "entries is a non-empty array of { rankKey, value }");
    else
      rawEntries.forEach((e: unknown, j: number) => {
        const er = readRecord(e, [...at, i, "entries", j], p, T.INVALID_TARGETING_RULES, ["rankKey", "value"], ["rankKey", "value"]);
        if (er === null) return;
        const rankKey = own(er, "rankKey");
        const v = nonNegative(own(er, "value"), [...at, i, "entries", j, "value"], p, "a rank-table value");
        if (!isToken(rankKey) || entries.some((x) => x.rankKey === rankKey)) p.add(T.INVALID_TARGETING_RULES, [...at, i, "entries", j, "rankKey"], "rankKey is a rank token, authored once");
        else if (v !== null) entries.push({ rankKey, value: v });
      });
    if (isToken(tableKey) && isExactCanonicalKey(skillKey)) out.push({ tableKey, skillKey, entries });
  });
  return out;
}

function readFormula(value: unknown, at: readonly PathSegment[], p: Problems, parameters: readonly TargetingParameterRule[], tables: readonly TargetingRankTable[]): TargetingFormula | null {
  const r = readRecord(value, at, p, T.INVALID_TARGETING_RULES, ["expression", "rounding", "minimum", "unit", "variables"], ["expression", "rounding", "unit", "variables"]);
  if (r === null) return null;
  const before = p.count;
  const expression = own(r, "expression");
  const rounding = readEnum(own(r, "rounding"), ["NONE", "FLOOR", "CEIL"] as const, [...at, "rounding"], p, T.INVALID_TARGETING_RULES, "explicit rounding");
  const rawMin = own(r, "minimum");
  const minimum = rawMin === undefined || rawMin === null ? null : readSafeInteger(rawMin, [...at, "minimum"], p, T.INVALID_TARGETING_RULES, "minimum");
  const unit = own(r, "unit");
  if (unit !== "ft") p.add(T.INVALID_TARGETING_RULES, [...at, "unit"], "Targeting distances are authored in ft");
  const program = validateFormulaProgram({ expression, rounding: rounding ?? "NONE", minimum, maximum: null, unit: "ft" });
  if (typeof expression !== "string" || !program.ok) {
    p.add(T.INVALID_TARGETING_RULES, [...at, "expression"], "expression must be a valid M4 Formula program (validated by @prowess/rules)");
    return null;
  }
  const rawVariables = own(r, "variables");
  const variables: TargetingVariableDeclaration[] = [];
  if (!Array.isArray(rawVariables)) p.add(T.INVALID_TARGETING_RULES, [...at, "variables"], "variables is an array of { variable, source }");
  else
    rawVariables.forEach((v: unknown, i: number) => {
      const d = readRecord(v, [...at, "variables", i], p, T.INVALID_TARGETING_RULES, ["variable", "source"], ["variable", "source"]);
      if (d === null) return;
      const variable = own(d, "variable");
      const source = own(d, "source");
      if (typeof variable !== "string" || variables.some((x) => x.variable === variable)) {
        p.add(T.INVALID_TARGETING_RULES, [...at, "variables", i, "variable"], "each variable is declared exactly once");
        return;
      }
      const sAt = [...at, "variables", i, "source"];
      if (!isPlainObject(source)) {
        p.add(T.INVALID_TARGETING_RULES, sAt, "a variable source is { kind, … }");
        return;
      }
      const kind = readEnum(own(source, "kind"), TARGETING_VARIABLE_SOURCES, [...sAt, "kind"], p, T.INVALID_TARGETING_RULES, "variable source kind");
      if (kind === "STAT") {
        const s = readRecord(source, sAt, p, T.INVALID_TARGETING_RULES, ["kind", "stat"], ["kind", "stat"]);
        const stat = s === null ? null : readEnum(own(s, "stat"), PROWESS_STATS, [...sAt, "stat"], p, T.INVALID_TARGETING_RULES, "Stat");
        if (stat !== null) variables.push({ variable, source: { kind, stat } });
      } else if (kind === "DERIVED") {
        const s = readRecord(source, sAt, p, T.INVALID_TARGETING_RULES, ["kind", "statistic"], ["kind", "statistic"]);
        const statistic = s === null ? null : readEnum(own(s, "statistic"), DERIVED_STATISTICS, [...sAt, "statistic"], p, T.INVALID_TARGETING_RULES, "derived statistic");
        if (statistic !== null) variables.push({ variable, source: { kind, statistic } });
      } else if (kind === "PARAMETER") {
        const s = readRecord(source, sAt, p, T.INVALID_TARGETING_RULES, ["kind", "parameter"], ["kind", "parameter"]);
        const parameter = s === null ? null : own(s, "parameter");
        const declared = parameters.find((x) => x.parameter === parameter);
        if (declared === undefined || declared.kind !== "STEPS") p.add(T.INVALID_TARGETING_RULES, [...sAt, "parameter"], "a Formula reads only a declared STEPS parameter (which has an authored default)");
        else variables.push({ variable, source: { kind, parameter: declared.parameter } });
      } else if (kind === "SKILL_RANK_TABLE") {
        const s = readRecord(source, sAt, p, T.INVALID_TARGETING_RULES, ["kind", "table"], ["kind", "table"]);
        const table = s === null ? null : own(s, "table");
        if (!tables.some((t) => t.tableKey === table)) p.add(T.INVALID_TARGETING_RULES, [...sAt, "table"], "a rank-table variable names a rankTables entry of this Definition");
        else variables.push({ variable, source: { kind, table: table as string } });
      }
    });
  const used = program.program.variables;
  const declared = variables.map((v) => v.variable);
  for (const name of used) if (!declared.includes(name)) p.add(T.INVALID_TARGETING_RULES, [...at, "variables"], `Formula variable "${name}" has no declared source`);
  for (const name of declared) if (!used.includes(name)) p.add(T.INVALID_TARGETING_RULES, [...at, "variables"], `declared variable "${name}" is not used by the expression`);
  if (p.count > before || rounding === null) return null;
  return { expression, rounding, minimum, unit: "ft", variables };
}

function readMeasures(value: unknown, at: readonly PathSegment[], p: Problems, parameters: readonly TargetingParameterRule[], tables: readonly TargetingRankTable[]): TargetingMeasureRule[] {
  if (!Array.isArray(value)) {
    p.add(T.INVALID_TARGETING_RULES, at, "measures is an array of area measures (possibly empty)");
    return [];
  }
  const out: TargetingMeasureRule[] = [];
  value.forEach((raw: unknown, i: number) => {
    if (!isPlainObject(raw)) {
      p.add(T.INVALID_TARGETING_RULES, [...at, i], "a measure is { measure, valueStatus, … }");
      return;
    }
    const measure = readEnum(own(raw, "measure"), TARGETING_MEASURES, [...at, i, "measure"], p, T.INVALID_TARGETING_RULES, "measure");
    // `valueStatus` (not `status`: "status" is a forbidden Targeting key — a Targeting never applies a status, §108).
    const status = readEnum(own(raw, "valueStatus"), TARGETING_MEASURE_STATUSES, [...at, i, "valueStatus"], p, T.INVALID_TARGETING_RULES, "measure value status");
    if (measure === null || status === null) return;
    if (out.some((m) => m.measure === measure)) {
      p.add(T.INVALID_TARGETING_RULES, [...at, i, "measure"], `measure ${measure} is authored once`);
      return;
    }
    if (status === "FORMULA") {
      const r = readRecord(raw, [...at, i], p, T.INVALID_TARGETING_RULES, ["measure", "valueStatus", "formula"], ["measure", "valueStatus", "formula"]);
      const formula = r === null ? null : readFormula(own(r, "formula"), [...at, i, "formula"], p, parameters, tables);
      if (formula !== null) out.push({ measure, valueStatus: status, formula });
    } else if (status === "DEFERRED_PENDING_CANON") {
      // §30, §119: an unresolved value is explicit — the conflict and the authored rule text, never a guessed number.
      const r = readRecord(raw, [...at, i], p, T.INVALID_TARGETING_RULES, ["measure", "valueStatus", "conflictKey", "ruleText"], ["measure", "valueStatus", "conflictKey", "ruleText"]);
      if (r === null) return;
      const conflictKey = own(r, "conflictKey");
      const ruleText = text(own(r, "ruleText"), [...at, i, "ruleText"], p, "ruleText");
      if (typeof conflictKey !== "string" || !CONFLICT_KEY.test(conflictKey)) p.add(T.INVALID_TARGETING_RULES, [...at, i, "conflictKey"], "a deferred measure cites its open source conflict (M5-SC-###)");
      else if (ruleText !== null) out.push({ measure, valueStatus: status, conflictKey, ruleText });
    } else {
      if (readRecord(raw, [...at, i], p, T.INVALID_TARGETING_RULES, ["measure", "valueStatus"], ["measure", "valueStatus"]) !== null) out.push({ measure, valueStatus: status });
    }
  });
  return out;
}

/**
 * Reads `rules.targeting` of a TARGETING payload (§53–§54). `branch` enforces the branch rules: DEFAULT_SPELL_RANGE is a
 * Spell range, FOUNDATION_RANGE a Maneuver range. Errors are Definition defects.
 */
export function readTargetingRules(raw: unknown, semanticShape: TargetingSemanticShape | null, branch: "SPELL" | "MANEUVER" | null, at: readonly PathSegment[], p: Problems): TargetingRules | null {
  const before = p.count;
  if (semanticShape !== null && !(BASE_TARGETING_SHAPES as readonly string[]).includes(semanticShape)) {
    p.add(T.TARGETING_ADD_ON_AS_BASE, [...at.slice(0, -2), "semanticShape"], `${semanticShape} is a Targeting ADD-ON (designer ruling M5-SC-029), never a base Targeting Type with executable Targeting rules`);
  }
  const r = readRecord(raw, at, p, T.INVALID_TARGETING_RULES, RULE_FIELDS, RULE_REQUIRED);
  if (r === null) return null;
  const deliveryFamily = readEnum(own(r, "deliveryFamily"), DELIVERY_FAMILIES, [...at, "deliveryFamily"], p, T.INVALID_TARGETING_RULES, "delivery family");
  const parameters = readParameters(own(r, "parameters"), [...at, "parameters"], p);
  const rankTables = readRankTables(own(r, "rankTables"), [...at, "rankTables"], p);

  // Cardinality (§37–§45, §94). A Multi-Target count is chosen explicitly by the use: no invented base count (§41).
  let cardinality: TargetingCardinality | null = null;
  const rc = own(r, "cardinality");
  const cKind = isPlainObject(rc) ? readEnum(own(rc, "kind"), TARGET_CARDINALITY_KINDS, [...at, "cardinality", "kind"], p, T.INVALID_TARGETING_RULES, "cardinality kind") : null;
  if (!isPlainObject(rc)) p.add(T.INVALID_TARGETING_RULES, [...at, "cardinality"], "cardinality is { kind, … }");
  else if (cKind === "SELECTED") {
    const c = readRecord(rc, [...at, "cardinality"], p, T.INVALID_TARGETING_RULES, ["kind", "parameter", "minimum"], ["kind", "parameter", "minimum"]);
    const minimum = c === null ? null : nonNegative(own(c, "minimum"), [...at, "cardinality", "minimum"], p, "minimum");
    const declared = c === null ? undefined : parameters.find((x) => x.parameter === own(c, "parameter"));
    if (c !== null && (declared === undefined || declared.kind !== "COUNT")) p.add(T.INVALID_TARGETING_RULES, [...at, "cardinality", "parameter"], "a SELECTED cardinality reads a declared COUNT parameter");
    else if (minimum !== null && minimum < 2) p.add(T.INVALID_TARGETING_RULES, [...at, "cardinality", "minimum"], "several individually chosen targets means at least 2 (§42)");
    else if (declared !== undefined && minimum !== null) cardinality = { kind: "SELECTED", parameter: declared.parameter, minimum };
  } else if (cKind !== null && readRecord(rc, [...at, "cardinality"], p, T.INVALID_TARGETING_RULES, ["kind"], ["kind"]) !== null) cardinality = { kind: cKind };

  const validTargets = readTokens(own(r, "validTargets"), TARGET_CATEGORIES, [...at, "validTargets"], p, "valid target category");

  // Range (§24–§27): the model is explicit; a distance, when there is one, is an authored Formula.
  let range: TargetingRules["range"] | null = null;
  const rr = own(r, "range");
  const model = isPlainObject(rr) ? readEnum(own(rr, "model"), TARGETING_RANGE_MODELS, [...at, "range", "model"], p, T.INVALID_TARGETING_RULES, "range model") : null;
  if (!isPlainObject(rr)) p.add(T.INVALID_TARGETING_RULES, [...at, "range"], "range is { model, … }");
  else if (model !== null) {
    const withFormula = model === "DEFAULT_SPELL_RANGE" || model === "FIXED";
    const withText = model === "SPECIAL";
    const g = readRecord(rr, [...at, "range"], p, T.INVALID_TARGETING_RULES, withFormula ? ["model", "formula"] : withText ? ["model", "ruleText"] : ["model"], withFormula ? ["model", "formula"] : withText ? ["model", "ruleText"] : ["model"]);
    const formula = g !== null && withFormula ? readFormula(own(g, "formula"), [...at, "range", "formula"], p, parameters, rankTables) : null;
    const ruleText = g !== null && withText ? text(own(g, "ruleText"), [...at, "range", "ruleText"], p, "ruleText") : null;
    if (model === "DEFAULT_SPELL_RANGE" && formula !== null && !formula.variables.some((v) => v.source.kind === "DERIVED" && v.source.statistic === "BASE_RANGE")) {
      p.add(T.INVALID_TARGETING_RULES, [...at, "range", "formula"], "DEFAULT_SPELL_RANGE reads the WO2 BASE_RANGE statistic (15 ft × PER) — never a second, contradictory range formula (§202)");
    }
    if (model === "DEFAULT_SPELL_RANGE" && branch === "MANEUVER") p.add(T.INVALID_TARGETING_RULES, [...at, "range", "model"], "default Spell Range is a Spell range model");
    if (model === "FOUNDATION_RANGE" && branch === "SPELL") p.add(T.INVALID_TARGETING_RULES, [...at, "range", "model"], "Foundation range is a Maneuver range model");
    if (g !== null) range = { model, formula, ruleText };
  }

  const measures = readMeasures(own(r, "measures"), [...at, "measures"], p, parameters, rankTables);

  // Origin (§36, §46–§50, §86–§92) and Aura sources.
  let origin: TargetingRules["origin"] | null = null;
  const o = readRecord(own(r, "origin"), [...at, "origin"], p, T.INVALID_TARGETING_RULES, ["modes", "default", "sources", "defaultSource"], ["modes", "default"]);
  if (o !== null) {
    const modes = readTokens(own(o, "modes"), TARGETING_ORIGIN_MODES, [...at, "origin", "modes"], p, "origin mode");
    const d = own(o, "default");
    const def = d === null ? null : readEnum(d, modes, [...at, "origin", "default"], p, T.INVALID_TARGETING_RULES, "default origin (one of the listed modes, or null when the owning Effect decides)");
    const sources = own(o, "sources") === undefined ? [] : readTokens(own(o, "sources"), AURA_SOURCES, [...at, "origin", "sources"], p, "Aura source");
    const ds = own(o, "defaultSource");
    const defaultSource = ds === undefined || ds === null ? null : readEnum(ds, sources, [...at, "origin", "defaultSource"], p, T.INVALID_TARGETING_RULES, "default Aura source (one of the listed sources)");
    if (sources.length > 0 && defaultSource === null) p.add(T.INVALID_TARGETING_RULES, [...at, "origin", "defaultSource"], "an authored source list names its default source");
    origin = { modes, default: def, sources, defaultSource };
  }
  const placement = readEnum(own(r, "placement"), TARGETING_PLACEMENT_MODELS, [...at, "placement"], p, T.INVALID_TARGETING_RULES, "placement model");
  const lineOfSight = readEnum(own(r, "lineOfSight"), SIGHT_POLICIES, [...at, "lineOfSight"], p, T.INVALID_TARGETING_RULES, "Line of Sight policy");
  const lineOfEffect = readEnum(own(r, "lineOfEffect"), SIGHT_POLICIES, [...at, "lineOfEffect"], p, T.INVALID_TARGETING_RULES, "Line of Effect policy");
  const cover = readEnum(own(r, "cover"), COVER_POLICIES, [...at, "cover"], p, T.INVALID_TARGETING_RULES, "cover policy");
  const radiusCapable = own(r, "radiusCapable");
  if (typeof radiusCapable !== "boolean") p.add(T.INVALID_TARGETING_RULES, [...at, "radiusCapable"], "radiusCapable is an explicit boolean (never inferred from a name, §71)");
  else if (radiusCapable !== measures.some((m) => m.measure === RADIUS_MEASURE)) p.add(T.INVALID_TARGETING_RULES, [...at, "radiusCapable"], "radiusCapable is true exactly when the Definition authors a RADIUS measure");

  if (p.count > before || deliveryFamily === null || cardinality === null || range === null || origin === null || placement === null || lineOfSight === null || lineOfEffect === null || cover === null) return null;
  return { deliveryFamily, cardinality, validTargets, range, measures, origin, placement, lineOfSight, lineOfEffect, cover, radiusCapable: radiusCapable as boolean, parameters, rankTables };
}

/**
 * Types the LISTED Targeting cost contributions of a Definition that authors `rules.targeting` (§20–§23, §61–§67). A
 * Spell Targeting carries exactly one BASE or BASE_DEFERRED contribution in MP; a Maneuver Targeting carries none.
 */
export function readTargetingCosts(contributions: readonly { contributionKey: string; currency: string; data: JsonObject }[], rules: TargetingRules, branch: "SPELL" | "MANEUVER" | null, at: readonly PathSegment[], p: Problems): TargetingCostRule[] | null {
  const before = p.count;
  if (branch === "MANEUVER") {
    if (contributions.length > 0) p.add(T.MANEUVER_TARGETING_COST, at, "a MANEUVER_TARGETING Definition carries no cost: the Targeting Conversion Maneuver Effect owns its AP / MP (§82, M5-I172)");
    return p.count > before ? null : [];
  }
  const out: TargetingCostRule[] = [];
  contributions.forEach((c, i) => {
    const cAt = [...at, i, "data"];
    const kind = readEnum(own(c.data as Record<string, unknown>, "kind"), TARGETING_COST_KINDS, [...cAt, "kind"], p, T.INVALID_TARGETING_RULES, "Targeting cost kind");
    if (c.currency !== SPELL_TARGETING_COST_CURRENCY) p.add(T.INVALID_TARGETING_RULES, [...at, i, "currency"], "a Spell Targeting contribution is listed in MP (never ME, §63)");
    const param = (name: unknown, kinds: readonly TargetingParameterKind[]) => {
      const d = rules.parameters.find((x) => x.parameter === name);
      if (d === undefined || !kinds.includes(d.kind)) p.add(T.INVALID_TARGETING_RULES, [...cAt, "parameter"], `the contribution scales a declared ${kinds.join(" / ")} parameter`);
      return d;
    };
    if (kind === "BASE") {
      const d = readRecord(c.data, cAt, p, T.INVALID_TARGETING_RULES, ["kind", "amount"], ["kind", "amount"]);
      const amount = d === null ? null : nonNegative(own(d, "amount"), [...cAt, "amount"], p, "amount");
      if (amount !== null) out.push({ contributionKey: c.contributionKey, kind, currency: c.currency, amount });
    } else if (kind === "BASE_DEFERRED") {
      const d = readRecord(c.data, cAt, p, T.INVALID_TARGETING_RULES, ["kind", "conflictKey"], ["kind", "conflictKey"]);
      const conflictKey = d === null ? null : own(d, "conflictKey");
      if (typeof conflictKey !== "string" || !CONFLICT_KEY.test(conflictKey)) p.add(T.INVALID_TARGETING_RULES, [...cAt, "conflictKey"], "a deferred base cost cites its open source conflict (M5-SC-###)");
      else out.push({ contributionKey: c.contributionKey, kind, currency: c.currency, conflictKey });
    } else if (kind === "PER_STEP") {
      const d = readRecord(c.data, cAt, p, T.INVALID_TARGETING_RULES, ["kind", "parameter", "amount", "step"], ["kind", "parameter", "amount", "step"]);
      if (d === null) return;
      const declared = param(own(d, "parameter"), ["STEPS"]);
      const amount = nonNegative(own(d, "amount"), [...cAt, "amount"], p, "amount");
      const s = readRecord(own(d, "step"), [...cAt, "step"], p, T.INVALID_TARGETING_RULES, ["size", "unit"], ["size", "unit"]);
      const size = s === null ? null : nonNegative(own(s, "size"), [...cAt, "step", "size"], p, "step size");
      if (s !== null && own(s, "unit") !== "ft") p.add(T.INVALID_TARGETING_RULES, [...cAt, "step", "unit"], "a scaling step is authored in ft");
      if (declared !== undefined && amount !== null && size !== null) out.push({ contributionKey: c.contributionKey, kind, currency: c.currency, parameter: declared.parameter, amount, step: { size, unit: "ft" } });
    } else if (kind === "PER_ADDITIONAL_TARGET") {
      const d = readRecord(c.data, cAt, p, T.INVALID_TARGETING_RULES, ["kind", "parameter", "amount"], ["kind", "parameter", "amount"]);
      if (d === null) return;
      const declared = param(own(d, "parameter"), ["COUNT"]);
      const amount = nonNegative(own(d, "amount"), [...cAt, "amount"], p, "amount");
      if (declared !== undefined && amount !== null) out.push({ contributionKey: c.contributionKey, kind, currency: c.currency, parameter: declared.parameter, amount });
    } else if (kind === "PER_SELECTION") {
      const d = readRecord(c.data, cAt, p, T.INVALID_TARGETING_RULES, ["kind", "parameter", "amount", "values"], ["kind", "parameter", "amount", "values"]);
      if (d === null) return;
      const declared = param(own(d, "parameter"), ["FLAG", "TOKEN"]);
      const amount = nonNegative(own(d, "amount"), [...cAt, "amount"], p, "amount");
      const values = own(d, "values");
      const ok = Array.isArray(values) && values.length > 0 && values.every((v: unknown) => (declared?.kind === "FLAG" ? v === true : typeof v === "string" && (declared?.allowed ?? []).includes(v) && v !== declared?.default));
      if (!ok) p.add(T.INVALID_TARGETING_RULES, [...cAt, "values"], "values lists the selections that cost (true for a FLAG; non-default allowed tokens for a TOKEN)");
      else if (declared !== undefined && amount !== null) out.push({ contributionKey: c.contributionKey, kind, currency: c.currency, parameter: declared.parameter, amount, values: [...(values as (string | boolean)[])] });
    }
  });
  const bases = out.filter((c) => c.kind === "BASE" || c.kind === "BASE_DEFERRED");
  if (p.count === before && bases.length !== 1) p.add(T.INVALID_TARGETING_RULES, at, "a Spell Targeting Definition lists exactly one BASE (or BASE_DEFERRED) contribution");
  return p.count > before ? null : out;
}
