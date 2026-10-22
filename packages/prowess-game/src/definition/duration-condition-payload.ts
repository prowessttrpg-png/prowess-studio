import { validateRequirement, type RequirementNode } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import type { PathSegment } from "../internal/plain-data.js";
import { Problems, own, readRecord, readEnum, isToken, isExactLabel } from "../internal/problems.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";
import { readEffectParameterRules, readEffectCosts, type EffectParameterRule, type EffectCostRule, type EffectRules } from "./effect-payload.js";
import type { AbilityConditionDefinitionPayload, CostContribution } from "./payload.js";
import type { DurationConcept } from "../vocabulary/construction.js";

export const DURATION_CONDITION_ERRORS = Object.freeze({ INVALID: "PROWESS_DURATION_CONDITION.INVALID", PARAMETER: "PROWESS_DURATION_CONDITION.PARAMETER", RELEVANCE: "PROWESS_DURATION_CONDITION.RELEVANCE", DEFERRED: "PROWESS_DURATION_CONDITION.DEFERRED", REFERENCE: "PROWESS_DURATION_CONDITION.REFERENCE", CAP: "PROWESS_DURATION_CONDITION.CAP" });
const E = DURATION_CONDITION_ERRORS.INVALID;
export interface ComponentAvailability { readonly availability: "EXECUTABLE" | "DEFERRED"; readonly deferralKey: string | null; }
export interface RuntimeRequirement {
  readonly requirementKey: string;
  readonly requirement: RequirementNode;
  /** Inert future input bindings. WO9 never evaluates encounter facts. */
  readonly parameters: readonly string[];
  /** Exact subjects for ownership/material requirements; resolved in the same historical Ruleset. */
  readonly references: readonly ProwessDefinitionRef[];
}
export interface DurationRules extends ComponentAvailability {
  readonly branch: "SPELL" | "MANEUVER";
  readonly requirements: RequirementNode;
  readonly futureRuntime: { readonly sustain: boolean; readonly manaLock: boolean; readonly concentration: "NONE" | "WO13"; readonly "persists": boolean };
  readonly costStatus: "UNLISTED" | "AUTHORED";
}
export interface ConditionRules extends ComponentAvailability {
  readonly branch: "SPELL" | "MANEUVER";
  readonly parameters: readonly EffectParameterRule[];
  readonly applicability: RequirementNode;
  readonly runtimeRequirements: readonly RuntimeRequirement[];
  readonly dependencies: readonly ProwessDefinitionRef[];
  readonly consumesSlot: boolean;
  readonly slotExemption: string | null;
  readonly choice: { readonly kind: "ALL" } | { readonly kind: "CHOOSE_ONE"; readonly parameter: string };
  readonly incompatibleRestrictions: readonly string[];
}
export type ConditionModifier = "MP_PERCENT_REDUCTION" | "AP_REDUCTION" | "MP_REDUCTION" | "AP_COMMITMENT";
export interface ConditionContribution { readonly cost: EffectCostRule; readonly modifier: ConditionModifier; readonly option: string | null; }

function requirement(v: unknown, at: readonly PathSegment[], p: Problems): RequirementNode | null {
  const out = validateRequirement(v);
  if (!out.ok) { p.add(E, at, "a validated M4 Requirement contract is required; prose is inert"); return null; }
  return out.requirement;
}
function availability(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): ComponentAvailability | null {
  const a = readEnum(own(r, "availability"), ["EXECUTABLE", "DEFERRED"] as const, [...at, "availability"], p, E, "availability");
  const d = own(r, "deferralKey");
  if (a === "EXECUTABLE" ? d !== null : !isExactLabel(d)) p.add(E, [...at, "deferralKey"], "only deferred content names an explicit unresolved rule");
  return a ? { availability: a, deferralKey: d as string | null } : null;
}
export function readDurationRules(v: unknown, branch: "SPELL" | "MANEUVER" | null, mode: DurationConcept, at: readonly PathSegment[], p: Problems): DurationRules | null {
  const before = p.count, fields = ["branch", "availability", "deferralKey", "requirements", "futureRuntime", "costStatus"];
  const r = readRecord(v, at, p, E, fields, fields); if (!r) return null;
  const b = readEnum(own(r, "branch"), ["SPELL", "MANEUVER"] as const, [...at, "branch"], p, E, "Duration branch"), a = availability(r, at, p);
  if (b !== branch) p.add(E, at, "Duration branch must match its permanent Definition kind");
  const req = requirement(own(r, "requirements"), [...at, "requirements"], p);
  const f = readRecord(own(r, "futureRuntime"), [...at, "futureRuntime"], p, E, ["sustain", "manaLock", "concentration", "persists"], ["sustain", "manaLock", "concentration", "persists"]);
  const expected = { sustain: mode === "SUSTAINED", manaLock: mode === "MANA_LOCK", concentration: mode === "SUSTAINED" ? "WO13" as const : "NONE" as const, "persists": mode !== "INSTANT" };
  if (f && Object.keys(expected).some(k => own(f, k) !== expected[k as keyof typeof expected])) p.add(E, [...at, "futureRuntime"], "metadata must agree with the selected Duration; future runtime is never executed");
  const costStatus = readEnum(own(r, "costStatus"), ["UNLISTED", "AUTHORED"] as const, [...at, "costStatus"], p, E, "listed cost status");
  // Permanent is fail-closed unless an exact independently authored prerequisite authorizes it.
  if (mode === "PERMANENT_BY_SPECIAL_RULE" && a?.availability === "EXECUTABLE" && req?.kind === "ALL" && req.children.length === 0) p.add(E, at, "Permanent requires an explicit nonempty access requirement");
  return p.count > before || !b || !a || !req || !f || !costStatus ? null : { branch: b, ...a, requirements: req, futureRuntime: expected, costStatus };
}
export function readDurationCosts(costs: readonly CostContribution[], rules: DurationRules, mode: DurationConcept, at: readonly PathSegment[], p: Problems): EffectCostRule[] {
  if (rules.costStatus === "UNLISTED" && costs.length) p.add(E, at, "UNLISTED is not a zero-cost grant and cannot carry authored costs");
  if (rules.costStatus === "AUTHORED" && !costs.length) p.add(E, at, "AUTHORED costs must name their exact contributions");
  const parameters: EffectParameterRule[] = mode === "ROUNDS" ? [{ parameter: "rounds", kind: "COUNT", minimum: 1, maximum: null, increment: 1, default: null, allowed: [] }] : [];
  return readEffectCosts(costs, { parameters } as unknown as EffectRules, at, p);
}
export function readConditionRules(v: unknown, branch: "SPELL" | "MANEUVER" | null, at: readonly PathSegment[], p: Problems): ConditionRules | null {
  const before = p.count, fields = ["branch", "availability", "deferralKey", "parameters", "applicability", "runtimeRequirements", "dependencies", "consumesSlot", "slotExemption", "choice", "incompatibleRestrictions"];
  const r = readRecord(v, at, p, E, fields, fields); if (!r) return null;
  const b = readEnum(own(r, "branch"), ["SPELL", "MANEUVER"] as const, [...at, "branch"], p, E, "Condition branch"), a = availability(r, at, p);
  if (b !== branch) p.add(E, at, "Condition branch must match its permanent Definition kind");
  const parameters = readEffectParameterRules(own(r, "parameters"), [...at, "parameters"], p);
  const applicability = requirement(own(r, "applicability"), [...at, "applicability"], p);
  const runtimeRequirements: RuntimeRequirement[] = [], rr = own(r, "runtimeRequirements");
  if (!Array.isArray(rr) || !rr.length) p.add(E, [...at, "runtimeRequirements"], "an Ability Condition must retain an enforceable runtime restriction contract");
  else rr.forEach((v, i) => {
    const q = readRecord(v, [...at, "runtimeRequirements", i], p, E, ["requirementKey", "requirement", "parameters", "references"], ["requirementKey", "requirement", "parameters"]); if (!q) return;
    const k = own(q, "requirementKey"), ps = own(q, "parameters"), req = requirement(own(q, "requirement"), [...at, "runtimeRequirements", i, "requirement"], p);
    const refs: ProwessDefinitionRef[] = [], raw = own(q, "references") ?? [];
    if (!Array.isArray(raw)) p.add(E, at, "runtime subjects use exact references");
    else raw.forEach((value, j) => { const ref = readDefinitionRef(value, [...at, "runtimeRequirements", i, "references", j], p, E); if (ref) refs.push(ref); });
    if (!isToken(k) || runtimeRequirements.some(x => x.requirementKey === k) || !Array.isArray(ps) || !ps.every(x => parameters.some(y => y.parameter === x)) || new Set(ps).size !== ps.length) p.add(E, [...at, "runtimeRequirements", i], "unique requirement key and declared parameter references required");
    else if (req) runtimeRequirements.push({ requirementKey: k, requirement: req, parameters: ps as string[], references: refs });
  });
  const dependencies: ProwessDefinitionRef[] = [], rawDeps = own(r, "dependencies");
  if (!Array.isArray(rawDeps)) p.add(E, [...at, "dependencies"], "dependencies are exact Definition references");
  else rawDeps.forEach((x, i) => { const d = readDefinitionRef(x, [...at, "dependencies", i], p, E); if (d) { if (dependencies.some(q => q.entityId === d.entityId)) p.add(E, at, "duplicate dependency"); else dependencies.push(d); } });
  const consumesSlot = own(r, "consumesSlot"), slotExemption = own(r, "slotExemption");
  if (typeof consumesSlot !== "boolean" || (consumesSlot ? slotExemption !== null : !isExactLabel(slotExemption))) p.add(E, [...at, "consumesSlot"], "slot exemption requires an explicit authored rule; normal selections consume one slot");
  const cr = own(r, "choice") as Record<string, unknown> | undefined, k = cr && own(cr, "kind");
  const choice = readRecord(cr, [...at, "choice"], p, E, k === "ALL" ? ["kind"] : ["kind", "parameter"], k === "ALL" ? ["kind"] : ["kind", "parameter"]);
  let selectedChoice: ConditionRules["choice"] = { kind: "ALL" };
  if (k === "CHOOSE_ONE" && choice) {
    const q = parameters.find(x => x.parameter === own(choice, "parameter"));
    if (!q || q.kind !== "TOKEN" || q.default !== null) p.add(E, [...at, "choice"], "AP-or-MP needs an explicit TOKEN selection with no default");
    else selectedChoice = { kind: "CHOOSE_ONE", parameter: q.parameter };
  } else if (k !== "ALL") p.add(E, [...at, "choice"], "supported choice discriminant required");
  const ir = own(r, "incompatibleRestrictions");
  if (!Array.isArray(ir) || !ir.every(isToken) || new Set(ir).size !== ir.length) p.add(E, [...at, "incompatibleRestrictions"], "unique restriction tokens required");
  return p.count > before || !b || !a || !applicability ? null : { branch: b, ...a, parameters, applicability, runtimeRequirements, dependencies, consumesSlot: consumesSlot as boolean, slotExemption: slotExemption as string | null, choice: selectedChoice, incompatibleRestrictions: [...ir as string[]].sort() };
}
/** Reuse the permanent WO7 listed-cost grammar; only the contribution's meaning and OR-selection are added. */
export function readConditionContributions(payload: AbilityConditionDefinitionPayload, rules: ConditionRules, at: readonly PathSegment[], p: Problems): ConditionContribution[] {
  const out: ConditionContribution[] = [];
  const choiceParameter = rules.choice.kind === "CHOOSE_ONE" ? rules.choice.parameter : null;
  payload.costContributions.forEach((c, i) => {
    const q = readRecord(c.data, [...at, i], p, E, ["kind", "amount", "parameter", "includedUnits", "amounts", "modifier", "option"], ["kind", "modifier"]); if (!q) return;
    const modifier = readEnum(own(q, "modifier"), ["MP_PERCENT_REDUCTION", "AP_REDUCTION", "MP_REDUCTION", "AP_COMMITMENT"] as const, [...at, i, "modifier"], p, E, "listed contribution meaning"), option = own(q, "option") ?? null;
    if ((rules.choice.kind === "CHOOSE_ONE" ? !rules.parameters.find(x => x.parameter === choiceParameter)?.allowed.includes(option as string) : option !== null)) p.add(E, [...at, i, "option"], "every OR benefit names exactly one permitted selection; ALL benefits have no option");
    if (modifier && c.currency !== (modifier === "MP_PERCENT_REDUCTION" || modifier === "MP_REDUCTION" ? "MP" : "AP")) p.add(E, [...at, i], "currency must agree with contribution meaning");
    if (rules.branch === "MANEUVER" && (modifier === "MP_PERCENT_REDUCTION" || modifier === "AP_COMMITMENT")) p.add(E, [...at, i], "Maneuver Conditions expose listed AP or MP reductions only");
    const data = Object.fromEntries(Object.entries(q).filter(([k]) => k !== "modifier" && k !== "option")) as JsonObject;
    const costs = readEffectCosts([{ ...c, data }], { parameters: rules.parameters } as EffectRules, [...at, i], p);
    for (const cost of costs) {
      if (cost.kind === "PER_SELECTION" && Object.keys(cost.amounts).sort().join() !== rules.parameters.find(x => x.parameter === cost.parameter)!.allowed.slice().sort().join()) p.add(E, at, "every allowed selection needs one exact listed value");
      if (modifier) out.push({ cost, modifier, option: option as string | null });
    }
  });
  if (rules.choice.kind === "CHOOSE_ONE") for (const option of rules.parameters.find(x => x.parameter === choiceParameter)!.allowed) {
    const benefits = out.filter(x => x.option === option);
    if (benefits.length !== 1) p.add(E, at, "each OR option must offer exactly one listed benefit");
    if (["AP", "MP"].includes(option) && benefits.some(x => x.cost.currency !== option)) p.add(E, at, "an AP-or-MP option must match its explicit currency");
  }
  if (rules.branch === "MANEUVER" && rules.choice.kind === "ALL" && new Set(out.map(x => x.cost.currency)).size > 1) p.add(E, at, "alternative Maneuver AP/MP reductions require an explicit OR choice");
  if (rules.availability === "DEFERRED" && out.length) p.add(E, at, "discretionary or conflicting benefits remain non-executable");
  return out;
}
