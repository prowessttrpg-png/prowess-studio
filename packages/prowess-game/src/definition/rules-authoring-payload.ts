import { validateFormulaProgram } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { deepFreeze, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { DERIVED_STATISTICS, PROWESS_STATS, type DerivedStatistic, type ProwessStat } from "../vocabulary/core.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";
import { readPrerequisite, type ActionImprovementPrerequisite } from "./action-improvement-payload.js";

/**
 * RULES-WO1 — the authored-rule contracts that let a designer add a game value, a Skill rank benefit and the
 * Concentration rule WITHOUT a new engine:
 *
 *   - CALCULATED_VALUE v1 (CHARACTER): one authored value (e.g. Carry Capacity, Throw Distance) — an M4 Formula over
 *     named game inputs, a unit, an explicit canon status and where it is shown. The base may be "not stated" (null):
 *     the value is then shown as the sum of its contributions with that fact stated, never with an invented base.
 *   - SKILL_BENEFIT v1 (SKILL): one benefit a Skill grants from a rank onward — contributions to calculated values,
 *     granted Actions (exact references) and the written benefit.
 *   - CONCENTRATION_RULE v1 (ABILITY): the confirmed Concentration override (capacity, sustained-Spell AP upkeep, how
 *     allocated points cover upkeep) and its explicitly OPEN questions. Reference and preview only — nothing in combat
 *     reads it in RULES-WO1.
 *
 * Every expression is validated by M4 (`validateFormulaProgram`); every variable has exactly one declared source.
 */
export const RULES_AUTHORING_PAYLOAD_KINDS = deepFreeze(["CALCULATED_VALUE", "SKILL_BENEFIT", "CONCENTRATION_RULE"] as const);
export type RulesAuthoringPayloadKind = (typeof RULES_AUTHORING_PAYLOAD_KINDS)[number];
export const isRulesAuthoringPayloadKind = (kind: string): kind is RulesAuthoringPayloadKind => (RULES_AUTHORING_PAYLOAD_KINDS as readonly string[]).includes(kind);

/** CANONICAL = from the source; OWNER_PROVIDED = a designer ruling / override; TEST_ONLY = a labelled placeholder. */
export const CANON_STATUSES = deepFreeze(["CANONICAL", "OWNER_PROVIDED", "TEST_ONLY"] as const);
export type CanonStatus = (typeof CANON_STATUSES)[number];
/** Where a calculated value is shown on the Character sheet. */
export const CALCULATED_VALUE_PLACEMENTS = deepFreeze(["CARRY_MAXIMUM_LOAD", "ADDITIONAL_VALUES", "REFERENCE_ONLY"] as const);
export type CalculatedValuePlacement = (typeof CALCULATED_VALUE_PLACEMENTS)[number];

export type ValueInputSource =
  | { readonly kind: "STAT"; readonly stat: ProwessStat }
  | { readonly kind: "LEVEL" }
  | { readonly kind: "DERIVED"; readonly statistic: DerivedStatistic }
  | { readonly kind: "CALCULATED_VALUE"; readonly valueKey: string }
  | { readonly kind: "CAST_AP" }
  | { readonly kind: "TOTAL_MP" };
export type ValueInputKind = ValueInputSource["kind"];
export const VALUE_INPUT_KINDS = deepFreeze(["STAT", "LEVEL", "DERIVED", "CALCULATED_VALUE", "CAST_AP", "TOTAL_MP"] as const satisfies readonly ValueInputKind[]);
/** The input kinds each Formula of these contracts accepts — exactly what the readers below allow at that field. */
export const VALUE_BASE_INPUT_KINDS = deepFreeze(["STAT", "LEVEL", "DERIVED", "CALCULATED_VALUE"] as const satisfies readonly ValueInputKind[]);
export const BENEFIT_AMOUNT_INPUT_KINDS = deepFreeze(["STAT", "LEVEL", "DERIVED"] as const satisfies readonly ValueInputKind[]);
export const CONCENTRATION_CAPACITY_INPUT_KINDS = deepFreeze(["STAT", "LEVEL"] as const satisfies readonly ValueInputKind[]);
export const CONCENTRATION_UPKEEP_INPUT_KINDS = deepFreeze(["CAST_AP"] as const satisfies readonly ValueInputKind[]);
/** RULES-WO1 Phase C: a Summon engine's casting / sustain cost reads its total MP and the caster's Stats. */
export const SUMMON_COST_INPUT_KINDS = deepFreeze(["STAT", "TOTAL_MP"] as const satisfies readonly ValueInputKind[]);
/** RULES-WO1 Phase C: a Summon engine's active-Summon limit reads only the caster's Stats. */
export const SUMMON_LIMIT_INPUT_KINDS = deepFreeze(["STAT"] as const satisfies readonly ValueInputKind[]);

export interface ValueFormula {
  readonly expression: string;
  readonly rounding: "NONE" | "FLOOR" | "CEIL";
  readonly minimum: number | null;
  readonly maximum: number | null;
  /** Display unit of this Formula's result (shape-compatible with the core Formula the Studio editor edits). */
  readonly unit: string | null;
  readonly variables: readonly { readonly variable: string; readonly source: ValueInputSource }[];
}

export interface CalculatedValuePayload {
  readonly valueKey: string;
  readonly unit: string | null;
  readonly canonStatus: CanonStatus;
  readonly placement: CalculatedValuePlacement;
  /** null = the source states no base value; the value is then only the sum of its contributions. */
  readonly base: ValueFormula | null;
  /** Required unless CANONICAL: why the value is not canonical (owner ruling, test placeholder, open question). */
  readonly note: string | null;
  /** Required when CANONICAL. */
  readonly source: CoreDefinitionSource | null;
}

export interface SkillBenefitContribution {
  readonly contributionKey: string;
  readonly valueKey: string;
  readonly amount: ValueFormula;
  /** A situational bonus ("when throwing"): computed and shown with its condition, never added to the total. */
  readonly condition: { readonly conditionKey: string; readonly text: string } | null;
}
/** Prerequisite groups (R08): every group must hold; a group holds when ALL (or ANY) of its prerequisites are met. */
export const SKILL_BENEFIT_GROUP_MODES = deepFreeze(["ALL", "ANY"] as const);
export interface SkillBenefitPrerequisiteGroup {
  readonly groupKey: string;
  readonly mode: (typeof SKILL_BENEFIT_GROUP_MODES)[number];
  readonly prerequisites: readonly ActionImprovementPrerequisite[];
}
export interface SkillBenefitPayload {
  readonly benefitKey: string;
  readonly skill: ProwessDefinitionRef;
  /** The benefit applies at this rank of the Skill ladder and every higher rank. */
  readonly minimumRankKey: string;
  readonly contributions: readonly SkillBenefitContribution[];
  readonly grantedActions: readonly ProwessDefinitionRef[];
  /** Further prerequisites beyond the rank (Level, Stat, another Skill's rank, an Affinity rank) in the Action-improvement
   *  grammar, grouped. Empty = the rank is the only requirement. */
  readonly prerequisiteGroups: readonly SkillBenefitPrerequisiteGroup[];
  readonly writtenBenefit: string;
  readonly source: CoreDefinitionSource;
}

export interface ConcentrationAllocation {
  /** AP of upkeep one allocated point covers per round. */
  readonly apCoveredPerPoint: number;
  readonly maySplitAcrossEffects: boolean;
  readonly mayStackOnOneEffect: boolean;
  /** Upkeep AP not covered by points is still paid. */
  readonly uncoveredApPaid: boolean;
  readonly waivesMpUpkeep: boolean;
  readonly waivesManaLock: boolean;
  /** Points stay occupied while assigned and return when the Effect ends. */
  readonly pointsReturnWhenEffectEnds: boolean;
}
export interface ConcentrationRulePayload {
  readonly ruleKey: string;
  readonly canonStatus: CanonStatus;
  /** Concentration capacity (points), from the Character's Stats. */
  readonly capacity: ValueFormula;
  /** Per-round AP upkeep of a Sustained Spell, from its casting AP. */
  readonly sustainedSpellUpkeepAp: ValueFormula;
  readonly allocation: ConcentrationAllocation;
  /** Questions the ruling deliberately leaves open (never inferred). */
  readonly openQuestions: readonly { readonly questionKey: string; readonly question: string }[];
  readonly note: string | null;
  readonly source: CoreDefinitionSource | null;
}

const MAX_TEXT = 4000;
const VARIABLE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function readText(value: unknown, at: readonly PathSegment[], p: Problems, what: string, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is ${nullable ? "null or " : ""}non-empty text of at most ${MAX_TEXT} characters`);
    return null;
  }
  return value;
}

function readInputSource(value: unknown, at: readonly PathSegment[], p: Problems, allowed: readonly ValueInputKind[]): ValueInputSource | null {
  if (!isPlainObject(value)) {
    p.add(C.INVALID_PAYLOAD, at, "an input source is { kind, … }");
    return null;
  }
  const kind = readEnum(own(value, "kind"), allowed, [...at, "kind"], p, C.INVALID_PAYLOAD, "input source kind");
  if (kind === null) return null;
  switch (kind) {
    case "STAT": {
      const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind", "stat"], ["kind", "stat"]);
      const stat = r === null ? null : readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, C.INVALID_PAYLOAD, "Stat");
      return stat === null ? null : { kind, stat };
    }
    case "DERIVED": {
      const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind", "statistic"], ["kind", "statistic"]);
      const statistic = r === null ? null : readEnum(own(r, "statistic"), DERIVED_STATISTICS, [...at, "statistic"], p, C.INVALID_PAYLOAD, "derived statistic");
      return statistic === null ? null : { kind, statistic };
    }
    case "CALCULATED_VALUE": {
      const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind", "valueKey"], ["kind", "valueKey"]);
      const valueKey = r === null ? null : own(r, "valueKey");
      if (r !== null && !isToken(valueKey)) p.add(C.INVALID_PAYLOAD, [...at, "valueKey"], "valueKey names a calculated value (SCREAMING_SNAKE token)");
      return isToken(valueKey) ? { kind, valueKey } : null;
    }
    default:
      return readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind"], ["kind"]) === null ? null : { kind };
  }
}

/** An M4 Formula whose every variable has exactly one declared input source of an allowed kind. */
export function readValueFormula(value: unknown, at: readonly PathSegment[], p: Problems, allowed: readonly ValueInputKind[]): ValueFormula | null {
  const FIELDS = ["expression", "rounding", "minimum", "maximum", "unit", "variables"];
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS, FIELDS);
  if (r === null) return null;
  const before = p.count;
  const expression = own(r, "expression");
  const rounding = readEnum(own(r, "rounding"), ["NONE", "FLOOR", "CEIL"] as const, [...at, "rounding"], p, C.INVALID_PAYLOAD, "explicit rounding");
  const bound = (field: "minimum" | "maximum"): number | null => {
    const v = own(r, field);
    return v === null ? null : readSafeInteger(v, [...at, field], p, C.INVALID_PAYLOAD, field);
  };
  const minimum = bound("minimum");
  const maximum = bound("maximum");
  if (minimum !== null && maximum !== null && minimum > maximum) p.add(C.INVALID_PAYLOAD, [...at, "maximum"], "maximum is at least minimum");
  const rawUnit = own(r, "unit");
  if (!(rawUnit === null || (typeof rawUnit === "string" && rawUnit.trim() !== "" && rawUnit.length <= 32))) p.add(C.INVALID_PAYLOAD, [...at, "unit"], "unit is null or short text (ft, lb …)");
  const unit = typeof rawUnit === "string" ? rawUnit : null;
  const program = validateFormulaProgram({ expression, rounding: rounding ?? "NONE", minimum, maximum, unit });
  if (typeof expression !== "string" || !program.ok) {
    p.add(C.INVALID_FORMULA, [...at, "expression"], "expression must be a valid M4 Formula program (validated by @prowess/rules)");
    return null;
  }
  const inputs: { variable: string; source: ValueInputSource }[] = [];
  const raw = own(r, "variables");
  if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, "variables"], "variables is an array of { variable, source }");
  else
    raw.forEach((v: unknown, i: number) => {
      const d = readRecord(v, [...at, "variables", i], p, C.INVALID_PAYLOAD, ["variable", "source"], ["variable", "source"]);
      if (d === null) return;
      const variable = own(d, "variable");
      if (typeof variable !== "string" || !VARIABLE_PATTERN.test(variable) || inputs.some((x) => x.variable === variable)) {
        p.add(C.INVALID_PAYLOAD, [...at, "variables", i, "variable"], "each input variable is a lowercase identifier declared exactly once");
        return;
      }
      const source = readInputSource(own(d, "source"), [...at, "variables", i, "source"], p, allowed);
      if (source !== null) inputs.push({ variable, source });
    });
  const used = program.program.variables;
  for (const name of used) if (!inputs.some((x) => x.variable === name)) p.add(C.INVALID_FORMULA, [...at, "variables"], `Formula variable "${name}" has no declared input`);
  for (const x of inputs) if (!used.includes(x.variable)) p.add(C.INVALID_FORMULA, [...at, "variables"], `declared input "${x.variable}" is not used by the expression`);
  if (p.count > before || rounding === null) return null;
  return { expression, rounding, minimum, maximum, unit, variables: inputs };
}

function readCanon(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): { canonStatus: CanonStatus | null; note: string | null; source: CoreDefinitionSource | null } {
  const canonStatus = readEnum(own(r, "canonStatus"), CANON_STATUSES, [...at, "canonStatus"], p, C.INVALID_PAYLOAD, "canon status");
  const note = readText(own(r, "note"), [...at, "note"], p, "note", true);
  const rawSource = own(r, "source");
  const source = rawSource === null ? null : readSource(rawSource, [...at, "source"], p);
  if (canonStatus === "CANONICAL" && rawSource === null) p.add(C.INVALID_PAYLOAD, [...at, "source"], "a CANONICAL rule cites its source sections");
  if (canonStatus !== null && canonStatus !== "CANONICAL" && note === null) p.add(C.INVALID_PAYLOAD, [...at, "note"], `a ${canonStatus} rule states why it is not canonical`);
  return { canonStatus, note, source };
}

function readCalculatedValue(value: unknown, at: readonly PathSegment[], p: Problems): CalculatedValuePayload | null {
  const FIELDS = ["valueKey", "unit", "canonStatus", "placement", "base", "note", "source"];
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS, FIELDS);
  if (r === null) return null;
  const before = p.count;
  const valueKey = own(r, "valueKey");
  if (!isToken(valueKey)) p.add(C.INVALID_PAYLOAD, [...at, "valueKey"], "valueKey is a SCREAMING_SNAKE token");
  const rawUnit = own(r, "unit");
  if (!(rawUnit === null || (typeof rawUnit === "string" && rawUnit.trim() !== "" && rawUnit.length <= 32))) p.add(C.INVALID_PAYLOAD, [...at, "unit"], "unit is null or short text (ft, lb …)");
  const placement = readEnum(own(r, "placement"), CALCULATED_VALUE_PLACEMENTS, [...at, "placement"], p, C.INVALID_PAYLOAD, "placement");
  const rawBase = own(r, "base");
  const base = rawBase === null ? null : readValueFormula(rawBase, [...at, "base"], p, VALUE_BASE_INPUT_KINDS);
  if (base !== null && base.variables.some((x) => x.source.kind === "CALCULATED_VALUE" && x.source.valueKey === valueKey)) p.add(C.INVALID_FORMULA, [...at, "base", "variables"], "a value never reads itself");
  const canon = readCanon(r, at, p);
  if (p.count > before || canon.canonStatus === null || placement === null) return null;
  return { valueKey: valueKey as string, unit: rawUnit as string | null, canonStatus: canon.canonStatus, placement, base, note: canon.note, source: canon.source };
}

function readSkillBenefit(value: unknown, at: readonly PathSegment[], p: Problems): SkillBenefitPayload | null {
  const FIELDS = ["benefitKey", "skill", "minimumRankKey", "contributions", "grantedActions", "prerequisiteGroups", "writtenBenefit", "source"];
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS, FIELDS);
  if (r === null) return null;
  const before = p.count;
  const benefitKey = own(r, "benefitKey");
  if (!isToken(benefitKey)) p.add(C.INVALID_PAYLOAD, [...at, "benefitKey"], "benefitKey is a SCREAMING_SNAKE token");
  const skill = readDefinitionRef(own(r, "skill"), [...at, "skill"], p, C.INVALID_PAYLOAD);
  if (skill !== null && skill.definitionKind !== "SKILL") p.add(C.INVALID_PAYLOAD, [...at, "skill", "definitionKind"], "a Skill benefit belongs to an exact SKILL Definition");
  const minimumRankKey = own(r, "minimumRankKey");
  if (!isToken(minimumRankKey)) p.add(C.INVALID_PAYLOAD, [...at, "minimumRankKey"], "minimumRankKey is an exact rank token of the Skill rank ladder");
  const contributions: SkillBenefitContribution[] = [];
  const rawC = own(r, "contributions");
  if (!Array.isArray(rawC)) p.add(C.INVALID_PAYLOAD, [...at, "contributions"], "contributions is an array (empty = no numeric contribution)");
  else
    rawC.forEach((x: unknown, i: number) => {
      const cat = [...at, "contributions", i];
      const c = readRecord(x, cat, p, C.INVALID_PAYLOAD, ["contributionKey", "valueKey", "amount", "condition"], ["contributionKey", "valueKey", "amount", "condition"]);
      if (c === null) return;
      const contributionKey = own(c, "contributionKey");
      const valueKey = own(c, "valueKey");
      if (!isToken(contributionKey) || contributions.some((y) => y.contributionKey === contributionKey)) p.add(C.INVALID_PAYLOAD, [...cat, "contributionKey"], "contributionKey is a unique SCREAMING_SNAKE token");
      if (!isToken(valueKey)) p.add(C.INVALID_PAYLOAD, [...cat, "valueKey"], "valueKey names the calculated value this adds to");
      const amount = readValueFormula(own(c, "amount"), [...cat, "amount"], p, BENEFIT_AMOUNT_INPUT_KINDS);
      let condition: SkillBenefitContribution["condition"] = null;
      const rawCond = own(c, "condition");
      if (rawCond !== null) {
        const q = readRecord(rawCond, [...cat, "condition"], p, C.INVALID_PAYLOAD, ["conditionKey", "text"], ["conditionKey", "text"]);
        const conditionKey = q === null ? null : own(q, "conditionKey");
        const text = q === null ? null : readText(own(q, "text"), [...cat, "condition", "text"], p, "condition text", false);
        if (q !== null && !isToken(conditionKey)) p.add(C.INVALID_PAYLOAD, [...cat, "condition", "conditionKey"], "conditionKey is a SCREAMING_SNAKE token");
        if (q !== null && isToken(conditionKey) && text !== null) condition = { conditionKey, text };
      }
      if (amount !== null && isToken(contributionKey) && isToken(valueKey) && (rawCond === null || condition !== null)) contributions.push({ contributionKey, valueKey, amount, condition });
    });
  const grantedActions: ProwessDefinitionRef[] = [];
  const rawA = own(r, "grantedActions");
  if (!Array.isArray(rawA)) p.add(C.INVALID_PAYLOAD, [...at, "grantedActions"], "grantedActions is an array of exact ACTION references");
  else
    rawA.forEach((x: unknown, i: number) => {
      const ref = readDefinitionRef(x, [...at, "grantedActions", i], p, C.INVALID_PAYLOAD);
      if (ref === null) return;
      if (ref.definitionKind !== "ACTION") p.add(C.INVALID_PAYLOAD, [...at, "grantedActions", i, "definitionKind"], "a granted Action is an exact ACTION Definition");
      else if (grantedActions.some((y) => y.entityId === ref.entityId)) p.add(C.INVALID_PAYLOAD, [...at, "grantedActions", i], "each Action is granted once");
      else grantedActions.push(ref);
    });
  const prerequisiteGroups: SkillBenefitPrerequisiteGroup[] = [];
  const rawG = own(r, "prerequisiteGroups");
  const taken: string[] = [];
  if (!Array.isArray(rawG)) p.add(C.INVALID_PAYLOAD, [...at, "prerequisiteGroups"], "prerequisiteGroups is an array (empty = only the rank)");
  else
    rawG.forEach((g: unknown, gi: number) => {
      const gat = [...at, "prerequisiteGroups", gi];
      const gr = readRecord(g, gat, p, C.INVALID_PAYLOAD, ["groupKey", "mode", "prerequisites"], ["groupKey", "mode", "prerequisites"]);
      if (gr === null) return;
      const groupKey = own(gr, "groupKey");
      if (!isToken(groupKey) || prerequisiteGroups.some((y) => y.groupKey === groupKey)) p.add(C.INVALID_PAYLOAD, [...gat, "groupKey"], "groupKey is a unique SCREAMING_SNAKE token");
      const mode = readEnum(own(gr, "mode"), SKILL_BENEFIT_GROUP_MODES, [...gat, "mode"], p, C.INVALID_PAYLOAD, "group mode");
      const rawP = own(gr, "prerequisites");
      const prerequisites: ActionImprovementPrerequisite[] = [];
      if (!Array.isArray(rawP) || rawP.length === 0) p.add(C.INVALID_PAYLOAD, [...gat, "prerequisites"], "a prerequisite group lists at least one prerequisite");
      else
        rawP.forEach((x: unknown, i: number) => {
          const q = readPrerequisite(x, taken, [...gat, "prerequisites", i], p);
          if (q !== null) {
            prerequisites.push(q);
            taken.push(q.prerequisiteKey);
          }
        });
      if (isToken(groupKey) && mode !== null) prerequisiteGroups.push({ groupKey, mode, prerequisites });
    });
  const writtenBenefit = readText(own(r, "writtenBenefit"), [...at, "writtenBenefit"], p, "writtenBenefit", false);
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || skill === null || writtenBenefit === null || source === null) return null;
  return { benefitKey: benefitKey as string, skill, minimumRankKey: minimumRankKey as string, contributions, grantedActions, prerequisiteGroups, writtenBenefit, source };
}

function readConcentrationRule(value: unknown, at: readonly PathSegment[], p: Problems): ConcentrationRulePayload | null {
  const FIELDS = ["ruleKey", "canonStatus", "capacity", "sustainedSpellUpkeepAp", "allocation", "openQuestions", "note", "source"];
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS, FIELDS);
  if (r === null) return null;
  const before = p.count;
  const ruleKey = own(r, "ruleKey");
  if (!isToken(ruleKey)) p.add(C.INVALID_PAYLOAD, [...at, "ruleKey"], "ruleKey is a SCREAMING_SNAKE token");
  const capacity = readValueFormula(own(r, "capacity"), [...at, "capacity"], p, CONCENTRATION_CAPACITY_INPUT_KINDS);
  const upkeep = readValueFormula(own(r, "sustainedSpellUpkeepAp"), [...at, "sustainedSpellUpkeepAp"], p, CONCENTRATION_UPKEEP_INPUT_KINDS);
  const AFIELDS = ["apCoveredPerPoint", "maySplitAcrossEffects", "mayStackOnOneEffect", "uncoveredApPaid", "waivesMpUpkeep", "waivesManaLock", "pointsReturnWhenEffectEnds"];
  const a = readRecord(own(r, "allocation"), [...at, "allocation"], p, C.INVALID_PAYLOAD, AFIELDS, AFIELDS);
  let allocation: ConcentrationAllocation | null = null;
  if (a !== null) {
    const coverage = readSafeInteger(own(a, "apCoveredPerPoint"), [...at, "allocation", "apCoveredPerPoint"], p, C.INVALID_PAYLOAD, "apCoveredPerPoint");
    if (coverage !== null && coverage < 1) p.add(C.INVALID_PAYLOAD, [...at, "allocation", "apCoveredPerPoint"], "a point covers at least 1 AP");
    const flags: Record<string, boolean> = {};
    for (const f of AFIELDS.slice(1)) {
      const v = own(a, f);
      if (typeof v !== "boolean") p.add(C.INVALID_PAYLOAD, [...at, "allocation", f], `${f} is an explicit boolean`);
      else flags[f] = v;
    }
    if (coverage !== null && Object.keys(flags).length === AFIELDS.slice(1).length) allocation = { apCoveredPerPoint: coverage, ...(flags as Omit<ConcentrationAllocation, "apCoveredPerPoint">) };
  }
  const openQuestions: { questionKey: string; question: string }[] = [];
  const rawQ = own(r, "openQuestions");
  if (!Array.isArray(rawQ)) p.add(C.INVALID_PAYLOAD, [...at, "openQuestions"], "openQuestions is an array of { questionKey, question }");
  else
    rawQ.forEach((x: unknown, i: number) => {
      const q = readRecord(x, [...at, "openQuestions", i], p, C.INVALID_PAYLOAD, ["questionKey", "question"], ["questionKey", "question"]);
      if (q === null) return;
      const questionKey = own(q, "questionKey");
      const question = readText(own(q, "question"), [...at, "openQuestions", i, "question"], p, "question", false);
      if (!isToken(questionKey) || openQuestions.some((y) => y.questionKey === questionKey)) p.add(C.INVALID_PAYLOAD, [...at, "openQuestions", i, "questionKey"], "questionKey is a unique SCREAMING_SNAKE token");
      else if (question !== null) openQuestions.push({ questionKey, question });
    });
  const canon = readCanon(r, at, p);
  if (p.count > before || capacity === null || upkeep === null || allocation === null || canon.canonStatus === null) return null;
  return { ruleKey: ruleKey as string, canonStatus: canon.canonStatus, capacity, sustainedSpellUpkeepAp: upkeep, allocation, openQuestions, note: canon.note, source: canon.source };
}

/** Validates `value` as the version-1 payload of a RULES-WO1 kind (the caller checked the version). */
export function readRulesAuthoringPayload(kind: RulesAuthoringPayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const out = kind === "CALCULATED_VALUE" ? readCalculatedValue(value, at, p) : kind === "SKILL_BENEFIT" ? readSkillBenefit(value, at, p) : readConcentrationRule(value, at, p);
  return out as unknown as JsonObject | null;
}
