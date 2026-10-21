import type { JsonObject } from "@prowess/model";
import { validateFormulaProgram } from "@prowess/rules";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";
import type { CostContribution, EffectDefinitionPayload } from "./payload.js";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { DURATION_CONCEPTS, type DurationConcept, type ResolutionMode } from "../vocabulary/construction.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import type { TargetCategory } from "../vocabulary/targeting.js";
import {
  EFFECT_ATTACK_TYPES,
  EFFECT_COST_KINDS,
  EFFECT_OUTCOME_KEYS,
  EFFECT_OUTCOME_OPERATIONS,
  EFFECT_RESOLUTION_POLICIES,
  EFFECT_SAVE_SELECTION_POLICIES,
  EFFECT_SUBFAMILIES,
  SPELL_EFFECT_FAMILIES,
  TARGETING_DELIVERY_CHECKS,
  type EffectAttackType,
  type EffectOutcomeOperation,
  type EffectResolutionPolicy,
  type EffectSaveSelectionPolicy,
  type EffectSubfamily,
  type SpellEffectFamily,
  type TargetingDeliveryCheck,
} from "../vocabulary/effect.js";

export const EFFECT_ERROR_CODES = Object.freeze({
  INVALID_EFFECT_RULES: "PROWESS_EFFECT.INVALID_EFFECT_RULES",
  INVALID_EFFECT_COST: "PROWESS_EFFECT.INVALID_EFFECT_COST",
  EFFECT_RULE_MISSING: "PROWESS_EFFECT.EFFECT_RULE_MISSING",
  SPELL_EFFECT_RESOLUTION_REQUIRED: "PROWESS_EFFECT.SPELL_EFFECT_RESOLUTION_REQUIRED",
  INVALID_INHERITED_RESOLUTION: "PROWESS_EFFECT.INVALID_INHERITED_RESOLUTION",
  INVALID_OUTCOMES: "PROWESS_EFFECT.INVALID_OUTCOMES",
  INVALID_DELIVERY_RULE: "PROWESS_EFFECT.INVALID_DELIVERY_RULE",
} as const);
const E = EFFECT_ERROR_CODES;
const TARGETS = ["SELF", "CREATURE", "OBJECT", "POINT", "SPACE", "AREA", "SOURCE"] as const satisfies readonly TargetCategory[];
const PARAM = /^[a-z][A-Za-z0-9]{0,63}$/;

export type EffectLimit = { readonly kind: "FIXED"; readonly value: number } | { readonly kind: "STAT"; readonly stat: ProwessStat };
export interface EffectParameterRule { readonly parameter: string; readonly kind: "COUNT" | "TOKEN" | "FLAG"; readonly minimum: number | null; readonly maximum: EffectLimit | null; readonly increment: number | null; readonly default: number | string | boolean | null; readonly allowed: readonly string[]; }
export type EffectFormulaVariable = { readonly variable: string; readonly source: { readonly kind: "STAT"; readonly stat: ProwessStat } | { readonly kind: "PARAMETER"; readonly parameter: string } | { readonly kind: "MARTIAL_RANK_VALUE" } };
export interface EffectFormula { readonly formulaKey: string; readonly expression: string; readonly rounding: "NONE" | "FLOOR" | "CEIL"; readonly minimum: number | null; readonly unit: string | null; readonly variables: readonly EffectFormulaVariable[]; }
export interface EffectSaveProfile { readonly validSaves: readonly ProwessStat[]; readonly selectionPolicy: EffectSaveSelectionPolicy; }
export interface EffectDurationPolicy { readonly allowed: readonly DurationConcept[]; readonly default: DurationConcept | null; readonly sustainEligible: boolean; readonly manaLockEligible: boolean; }
export interface EffectRules { readonly branch: "SPELL" | "MANEUVER"; readonly effectSubfamily: EffectSubfamily | null; readonly targetCategories: readonly TargetCategory[]; readonly resolutionPolicy: EffectResolutionPolicy; readonly attackType: EffectAttackType | null; readonly saveProfile: EffectSaveProfile | null; readonly parameters: readonly EffectParameterRule[]; readonly formulas: readonly EffectFormula[]; readonly duration: EffectDurationPolicy; readonly targetingConversion: { readonly destination: ProwessDefinitionRef } | null; readonly restrictions: readonly string[]; }
export type EffectCostRule = { readonly contributionKey: string; readonly kind: "FIXED"; readonly currency: "AP" | "MP"; readonly amount: number } | { readonly contributionKey: string; readonly kind: "PER_UNIT"; readonly currency: "AP" | "MP"; readonly parameter: string; readonly amount: number; readonly includedUnits: number } | { readonly contributionKey: string; readonly kind: "PER_SELECTION"; readonly currency: "AP" | "MP"; readonly parameter: string; readonly amounts: Readonly<Record<string, number>> };
export interface EffectOutcomeReading { readonly outcomeKey: "SUCCESS" | "FAILURE"; readonly operations: readonly { readonly kind: EffectOutcomeOperation; readonly data: JsonObject }[]; }
export interface TargetingDeliveryRule { readonly check: TargetingDeliveryCheck; }

const integer = (v: unknown, at: readonly PathSegment[], p: Problems, what: string, positive = false): number | null => { const n = readSafeInteger(v, at, p, E.INVALID_EFFECT_RULES, what); if (n !== null && (n < 0 || (positive && n === 0))) { p.add(E.INVALID_EFFECT_RULES, at, `${what} is ${positive ? "positive" : "non-negative"}`); return null; } return n; };
const limit = (v: unknown, at: readonly PathSegment[], p: Problems): EffectLimit | null => {
  if (v == null) return null;
  const r = readRecord(v, at, p, E.INVALID_EFFECT_RULES, ["kind", "value", "stat"], ["kind"]); if (!r) return null;
  const k = readEnum(own(r, "kind"), ["FIXED", "STAT"] as const, [...at, "kind"], p, E.INVALID_EFFECT_RULES, "limit kind");
  if (k === "FIXED") { const value = integer(own(r, "value"), [...at, "value"], p, "maximum"); return value === null ? null : { kind: k, value }; }
  if (k === "STAT") { const stat = readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, E.INVALID_EFFECT_RULES, "limit Stat"); return stat === null ? null : { kind: k, stat }; }
  return null;
};
function parameters(v: unknown, at: readonly PathSegment[], p: Problems): EffectParameterRule[] {
  if (!Array.isArray(v)) { p.add(E.INVALID_EFFECT_RULES, at, "parameters is an array"); return []; }
  const out: EffectParameterRule[] = [];
  v.forEach((x, i) => {
    const q = readRecord(x, [...at, i], p, E.INVALID_EFFECT_RULES, ["parameter", "kind", "minimum", "maximum", "increment", "default", "allowed"], ["parameter", "kind"]); if (!q) return;
    const name = own(q, "parameter"); const kind = readEnum(own(q, "kind"), ["COUNT", "TOKEN", "FLAG"] as const, [...at, i, "kind"], p, E.INVALID_EFFECT_RULES, "parameter kind");
    if (typeof name !== "string" || !PARAM.test(name) || out.some((e) => e.parameter === name)) { p.add(E.INVALID_EFFECT_RULES, [...at, i, "parameter"], "unique lowerCamel parameter"); return; }
    if (!kind) return;
    if (kind === "COUNT") {
      const minimum = own(q, "minimum") == null ? null : integer(own(q, "minimum"), [...at, i, "minimum"], p, "minimum");
      const maximum = limit(own(q, "maximum"), [...at, i, "maximum"], p);
      const increment = own(q, "increment") == null ? 1 : integer(own(q, "increment"), [...at, i, "increment"], p, "increment", true);
      const d = own(q, "default"); const def = d == null ? null : integer(d, [...at, i, "default"], p, "default");
      out.push({ parameter: name, kind, minimum, maximum, increment, default: def, allowed: [] }); return;
    }
    if (kind === "FLAG") { const d = own(q, "default"); if (typeof d !== "boolean") p.add(E.INVALID_EFFECT_RULES, [...at, i, "default"], "FLAG default is boolean"); out.push({ parameter: name, kind, minimum: null, maximum: null, increment: null, default: typeof d === "boolean" ? d : null, allowed: [] }); return; }
    const a = own(q, "allowed"); const allowed = Array.isArray(a) ? a.filter((e): e is string => isToken(e)) : [];
    if (!Array.isArray(a) || allowed.length !== a.length || allowed.length === 0 || new Set(allowed).size !== allowed.length) p.add(E.INVALID_EFFECT_RULES, [...at, i, "allowed"], "TOKEN allowed is a non-empty unique token list");
    const d = own(q, "default"); if (d != null && (typeof d !== "string" || !allowed.includes(d))) p.add(E.INVALID_EFFECT_RULES, [...at, i, "default"], "TOKEN default is allowed");
    out.push({ parameter: name, kind, minimum: null, maximum: null, increment: null, default: typeof d === "string" && allowed.includes(d) ? d : null, allowed });
  }); return out;
}
function formulas(v: unknown, declared: readonly EffectParameterRule[], at: readonly PathSegment[], p: Problems): EffectFormula[] {
  if (!Array.isArray(v)) { p.add(E.INVALID_EFFECT_RULES, at, "formulas is an array"); return []; }
  const out: EffectFormula[] = [];
  v.forEach((x, i) => {
    const q = readRecord(x, [...at, i], p, E.INVALID_EFFECT_RULES, ["formulaKey", "expression", "rounding", "minimum", "unit", "variables"], ["formulaKey", "expression", "variables"]); if (!q) return;
    const formulaKey = own(q, "formulaKey"); const expression = own(q, "expression"); const rounding = readEnum(own(q, "rounding") ?? "NONE", ["NONE", "FLOOR", "CEIL"] as const, [...at, i, "rounding"], p, E.INVALID_EFFECT_RULES, "rounding");
    const minimum = own(q, "minimum") == null ? null : readSafeInteger(own(q, "minimum"), [...at, i, "minimum"], p, E.INVALID_EFFECT_RULES, "minimum"); const unit = own(q, "unit");
    if (typeof formulaKey !== "string" || !/^[a-z][A-Za-z0-9_.-]*$/.test(formulaKey) || out.some((f) => f.formulaKey === formulaKey)) p.add(E.INVALID_EFFECT_RULES, [...at, i, "formulaKey"], "unique formula key");
    const vr = own(q, "variables"); const vars: EffectFormulaVariable[] = [];
    if (!Array.isArray(vr)) p.add(E.INVALID_EFFECT_RULES, [...at, i, "variables"], "variables is an array"); else vr.forEach((raw, j) => {
      const d = readRecord(raw, [...at, i, "variables", j], p, E.INVALID_EFFECT_RULES, ["variable", "source"], ["variable", "source"]); if (!d) return; const variable = own(d, "variable"); const s = own(d, "source");
      if (typeof variable !== "string" || !PARAM.test(variable) || !isPlainObject(s)) { p.add(E.INVALID_EFFECT_RULES, [...at, i, "variables", j], "valid variable/source"); return; }
      const k = readEnum(own(s, "kind"), ["STAT", "PARAMETER", "MARTIAL_RANK_VALUE"] as const, [...at, i, "variables", j, "source", "kind"], p, E.INVALID_EFFECT_RULES, "source kind");
      if (k === "STAT") { const stat = readEnum(own(s, "stat"), PROWESS_STATS, [...at, i, "variables", j, "source", "stat"], p, E.INVALID_EFFECT_RULES, "Stat"); if (stat) vars.push({ variable, source: { kind: k, stat } }); }
      else if (k === "PARAMETER") { const parameter = own(s, "parameter"); if (typeof parameter !== "string" || !declared.some((e) => e.parameter === parameter && e.kind === "COUNT")) p.add(E.INVALID_EFFECT_RULES, [...at, i, "variables", j, "source", "parameter"], "declared COUNT parameter"); else vars.push({ variable, source: { kind: k, parameter } }); }
      else if (k) vars.push({ variable, source: { kind: k } });
    });
    const pr = validateFormulaProgram({ expression, rounding: rounding ?? "NONE", minimum, maximum: null, unit: typeof unit === "string" ? unit : null });
    if (typeof expression !== "string" || !pr.ok) p.add(E.INVALID_EFFECT_RULES, [...at, i, "expression"], "valid M4 Formula");
    else if ([...pr.program.variables].sort().join() !== vars.map((e) => e.variable).sort().join()) p.add(E.INVALID_EFFECT_RULES, [...at, i, "variables"], "variables exactly match M4 Formula variables");
    if (typeof formulaKey === "string" && typeof expression === "string" && rounding) out.push({ formulaKey, expression, rounding, minimum, unit: typeof unit === "string" ? unit : null, variables: vars });
  }); return out;
}
function duration(v: unknown, at: readonly PathSegment[], p: Problems): EffectDurationPolicy | null {
  const r = readRecord(v, at, p, E.INVALID_EFFECT_RULES, ["allowed", "default", "sustainEligible", "manaLockEligible"], ["allowed", "default", "sustainEligible", "manaLockEligible"]); if (!r) return null;
  const a = own(r, "allowed"); const allowed = Array.isArray(a) ? a.map((e, i) => readEnum(e, DURATION_CONCEPTS, [...at, "allowed", i], p, E.INVALID_EFFECT_RULES, "Duration")).filter((e): e is DurationConcept => e !== null) : [];
  if (allowed.length === 0 || new Set(allowed).size !== allowed.length) p.add(E.INVALID_EFFECT_RULES, [...at, "allowed"], "non-empty unique Duration list");
  const d = own(r, "default"); const def = d === null ? null : readEnum(d, DURATION_CONCEPTS, [...at, "default"], p, E.INVALID_EFFECT_RULES, "default Duration"); if (def && !allowed.includes(def)) p.add(E.INVALID_EFFECT_RULES, [...at, "default"], "default is allowed");
  const sustainEligible = own(r, "sustainEligible"), manaLockEligible = own(r, "manaLockEligible"); if (typeof sustainEligible !== "boolean" || typeof manaLockEligible !== "boolean") p.add(E.INVALID_EFFECT_RULES, at, "duration flags are boolean");
  return typeof sustainEligible === "boolean" && typeof manaLockEligible === "boolean" ? { allowed, default: def, sustainEligible, manaLockEligible } : null;
}
function saves(v: unknown, at: readonly PathSegment[], p: Problems): EffectSaveProfile | null {
  if (v == null) return null; const r = readRecord(v, at, p, E.INVALID_EFFECT_RULES, ["validSaves", "selectionPolicy"], ["validSaves", "selectionPolicy"]); if (!r) return null;
  const a = own(r, "validSaves"); const validSaves = Array.isArray(a) ? a.map((e, i) => readEnum(e, PROWESS_STATS, [...at, "validSaves", i], p, E.INVALID_EFFECT_RULES, "Save")).filter((e): e is ProwessStat => e !== null) : [];
  const selectionPolicy = readEnum(own(r, "selectionPolicy"), EFFECT_SAVE_SELECTION_POLICIES, [...at, "selectionPolicy"], p, E.INVALID_EFFECT_RULES, "Save policy"); if (validSaves.length === 0 || new Set(validSaves).size !== validSaves.length) p.add(E.INVALID_EFFECT_RULES, [...at, "validSaves"], "non-empty unique saves"); if (selectionPolicy === "FIXED" && validSaves.length !== 1) p.add(E.INVALID_EFFECT_RULES, [...at, "validSaves"], "FIXED has one Save");
  return selectionPolicy ? { validSaves, selectionPolicy } : null;
}

export function readEffectRules(v: unknown, effectFamily: string, branch: "SPELL" | "MANEUVER", resolution: EffectDefinitionPayload["resolution"], at: readonly PathSegment[], p: Problems): EffectRules | null {
  const before = p.count; const fields = ["branch", "effectSubfamily", "targetCategories", "resolutionPolicy", "attackType", "saveProfile", "parameters", "formulas", "duration", "targetingConversion", "restrictions"];
  const r = readRecord(v, at, p, E.INVALID_EFFECT_RULES, fields, ["branch", "resolutionPolicy", "parameters", "formulas", "duration"]); if (!r) return null;
  const authoredBranch = readEnum(own(r, "branch"), ["SPELL", "MANEUVER"] as const, [...at, "branch"], p, E.INVALID_EFFECT_RULES, "branch"); if (authoredBranch && authoredBranch !== branch) p.add(E.INVALID_EFFECT_RULES, [...at, "branch"], "branch matches Definition kind");
  if (branch === "SPELL" && !(SPELL_EFFECT_FAMILIES as readonly string[]).includes(effectFamily)) p.add(E.INVALID_EFFECT_RULES, at, `Spell Effect family is one of ${SPELL_EFFECT_FAMILIES.join(", ")}`);
  const sr = own(r, "effectSubfamily"); const effectSubfamily = sr == null ? null : readEnum(sr, EFFECT_SUBFAMILIES, [...at, "effectSubfamily"], p, E.INVALID_EFFECT_RULES, "subfamily");
  if (branch === "SPELL" && effectSubfamily === "CLEANSE" && effectFamily !== "HEALING") p.add(E.INVALID_EFFECT_RULES, [...at, "effectSubfamily"], "CLEANSE is HEALING");
  if (branch === "SPELL" && ["MOVEMENT", "COUNTERSPELL", "DETECTION"].includes(effectSubfamily ?? "") && effectFamily !== "UTILITY") p.add(E.INVALID_EFFECT_RULES, [...at, "effectSubfamily"], `${effectSubfamily} is UTILITY`);
  if (branch === "SPELL" && effectSubfamily === "FORCED_MOVEMENT" && effectFamily !== "CONTROL") p.add(E.INVALID_EFFECT_RULES, [...at, "effectSubfamily"], "FORCED_MOVEMENT is CONTROL");
  const ta = own(r, "targetCategories"); const targetCategories = ta == null ? [] : Array.isArray(ta) ? ta.map((e, i) => readEnum(e, TARGETS, [...at, "targetCategories", i], p, E.INVALID_EFFECT_RULES, "target category")).filter((e): e is TargetCategory => e !== null) : [];
  const resolutionPolicy = readEnum(own(r, "resolutionPolicy"), EFFECT_RESOLUTION_POLICIES, [...at, "resolutionPolicy"], p, E.INVALID_EFFECT_RULES, "resolution policy");
  if (branch === "SPELL" && resolution === null) p.add(E.SPELL_EFFECT_RESOLUTION_REQUIRED, [...at, "resolutionPolicy"], "executable Spell Effect has resolution");
  if (resolutionPolicy === "INHERIT_ABILITY" && (branch !== "MANEUVER" || resolution !== null)) p.add(E.INVALID_INHERITED_RESOLUTION, [...at, "resolutionPolicy"], "inherit is explicit Maneuver-only with null structural resolution");
  if (resolutionPolicy === "OWN" && resolution === null) p.add(E.INVALID_INHERITED_RESOLUTION, [...at, "resolutionPolicy"], "OWN requires resolution");
  const ar = own(r, "attackType"); const attackType = ar == null ? null : readEnum(ar, EFFECT_ATTACK_TYPES, [...at, "attackType"], p, E.INVALID_EFFECT_RULES, "attack type"); const saveProfile = saves(own(r, "saveProfile"), [...at, "saveProfile"], p); const mode: ResolutionMode | null = resolution?.mode ?? null;
  if (mode === "ATTACK_ROLL" && attackType === null) p.add(E.INVALID_EFFECT_RULES, [...at, "attackType"], "Attack Effect identifies attack type"); if (mode !== "ATTACK_ROLL" && attackType !== null) p.add(E.INVALID_EFFECT_RULES, [...at, "attackType"], "attackType only on ATTACK_ROLL"); if (mode === "SAVING_THROW" && !saveProfile) p.add(E.INVALID_EFFECT_RULES, [...at, "saveProfile"], "Save Effect owns Save Profile"); if (mode !== "SAVING_THROW" && saveProfile) p.add(E.INVALID_EFFECT_RULES, [...at, "saveProfile"], "Save Profile only on SAVING_THROW");
  const ps = parameters(own(r, "parameters"), [...at, "parameters"], p); const fs = formulas(own(r, "formulas"), ps, [...at, "formulas"], p); const du = duration(own(r, "duration"), [...at, "duration"], p);
  let targetingConversion: { destination: ProwessDefinitionRef } | null = null; const cv = own(r, "targetingConversion"); if (cv != null) { const q = readRecord(cv, [...at, "targetingConversion"], p, E.INVALID_EFFECT_RULES, ["destination"], ["destination"]); const ref = q ? readDefinitionRef(own(q, "destination"), [...at, "targetingConversion", "destination"], p, E.INVALID_EFFECT_RULES) : null; if (branch !== "MANEUVER" || effectSubfamily !== "TARGETING_CONVERSION" || (ref && ref.definitionKind !== "MANEUVER_TARGETING")) p.add(E.INVALID_EFFECT_RULES, [...at, "targetingConversion"], "Maneuver Targeting Conversion owns exact MANEUVER_TARGETING destination"); else if (ref) targetingConversion = { destination: ref }; }
  const rr = own(r, "restrictions"); const restrictions = rr == null ? [] : Array.isArray(rr) ? rr.filter((e): e is string => isToken(e)) : []; if (rr != null && (!Array.isArray(rr) || restrictions.length !== rr.length || new Set(restrictions).size !== restrictions.length)) p.add(E.INVALID_EFFECT_RULES, [...at, "restrictions"], "unique restriction tokens");
  return p.count > before || !authoredBranch || !resolutionPolicy || !du ? null : { branch: authoredBranch, effectSubfamily, targetCategories, resolutionPolicy, attackType, saveProfile, parameters: ps, formulas: fs, duration: du, targetingConversion, restrictions };
}

export function readEffectCosts(value: readonly CostContribution[], rules: EffectRules, at: readonly PathSegment[], p: Problems): EffectCostRule[] {
  const out: EffectCostRule[] = []; value.forEach((c, i) => {
    if (c.currency !== "AP" && c.currency !== "MP") { p.add(E.INVALID_EFFECT_COST, [...at, i, "currency"], "Effect cost currency is AP or MP; ME is payment only"); return; }
    const d = readRecord(c.data, [...at, i, "data"], p, E.INVALID_EFFECT_COST, ["kind", "amount", "parameter", "includedUnits", "amounts"], ["kind"]); if (!d) return; const kind = readEnum(own(d, "kind"), EFFECT_COST_KINDS, [...at, i, "data", "kind"], p, E.INVALID_EFFECT_COST, "cost kind");
    if (kind === "FIXED") { const amount = integer(own(d, "amount"), [...at, i, "data", "amount"], p, "amount"); if (amount !== null) out.push({ contributionKey: c.contributionKey, kind, currency: c.currency, amount }); return; }
    const parameter = own(d, "parameter"); const pr = typeof parameter === "string" ? rules.parameters.find((e) => e.parameter === parameter) : undefined; if (!pr) { p.add(E.INVALID_EFFECT_COST, [...at, i, "data", "parameter"], "scaled cost names parameter"); return; }
    if (kind === "PER_UNIT") { if (pr.kind !== "COUNT") p.add(E.INVALID_EFFECT_COST, [...at, i, "data", "parameter"], "PER_UNIT uses COUNT"); const amount = integer(own(d, "amount"), [...at, i, "data", "amount"], p, "amount"); const includedUnits = own(d, "includedUnits") == null ? 0 : integer(own(d, "includedUnits"), [...at, i, "data", "includedUnits"], p, "included units"); if (amount !== null && includedUnits !== null) out.push({ contributionKey: c.contributionKey, kind, currency: c.currency, parameter: pr.parameter, amount, includedUnits }); return; }
    const a = own(d, "amounts"); const amounts: Record<string, number> = {}; if (!isPlainObject(a) || pr.kind !== "TOKEN") p.add(E.INVALID_EFFECT_COST, [...at, i, "data", "amounts"], "PER_SELECTION uses TOKEN amounts map"); else Object.keys(a).sort().forEach((k) => { const n = integer(a[k], [...at, i, "data", "amounts", k], p, "amount"); if (isToken(k) && n !== null) amounts[k] = n; }); if (pr.kind === "TOKEN") out.push({ contributionKey: c.contributionKey, kind: "PER_SELECTION", currency: c.currency, parameter: pr.parameter, amounts });
  }); return out;
}

export function readEffectOutcomes(value: EffectDefinitionPayload["outcomes"], at: readonly PathSegment[], p: Problems): EffectOutcomeReading[] {
  const out: EffectOutcomeReading[] = []; value.forEach((o, i) => { const key = readEnum(o.outcomeKey, EFFECT_OUTCOME_KEYS, [...at, i, "outcomeKey"], p, E.INVALID_OUTCOMES, "outcome key"); const raw = own(o.data as Record<string, unknown>, "operations"); const operations: { kind: EffectOutcomeOperation; data: JsonObject }[] = []; if (!Array.isArray(raw) || raw.length === 0) p.add(E.INVALID_OUTCOMES, [...at, i, "data", "operations"], "non-empty structured operations"); else raw.forEach((x, j) => { const q = readRecord(x, [...at, i, "data", "operations", j], p, E.INVALID_OUTCOMES, ["kind", "data"], ["kind"]); if (!q) return; const kind = readEnum(own(q, "kind"), EFFECT_OUTCOME_OPERATIONS, [...at, i, "data", "operations", j, "kind"], p, E.INVALID_OUTCOMES, "operation"); const d = own(q, "data"); if (kind && (d == null || isPlainObject(d))) operations.push({ kind, data: (d ?? {}) as JsonObject }); else if (d != null && !isPlainObject(d)) p.add(E.INVALID_OUTCOMES, [...at, i, "data", "operations", j, "data"], "plain JSON object"); }); if (key) out.push({ outcomeKey: key, operations }); }); if (!out.some((e) => e.outcomeKey === "SUCCESS")) p.add(E.INVALID_OUTCOMES, at, "SUCCESS outcome required"); return out;
}

export function readTargetingDeliveryRule(v: unknown, at: readonly PathSegment[], p: Problems): TargetingDeliveryRule | null { if (v == null) return null; const r = readRecord(v, at, p, E.INVALID_DELIVERY_RULE, ["check"], ["check"]); if (!r) return null; const check = readEnum(own(r, "check"), TARGETING_DELIVERY_CHECKS, [...at, "check"], p, E.INVALID_DELIVERY_RULE, "delivery check"); return check ? { check } : null; }
export function isSpellEffectFamily(value: string): value is SpellEffectFamily { return (SPELL_EFFECT_FAMILIES as readonly string[]).includes(value); }
