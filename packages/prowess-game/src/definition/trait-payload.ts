import type { JsonObject } from "@prowess/model";
import { deepFreeze, type PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, own, readEnum, readRecord } from "../internal/problems.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";
import { readEffectParameterRules, readEffectCosts, type EffectParameterRule, type EffectCostRule } from "./effect-payload.js";
import type { CostContribution } from "./payload.js";
import type { TraitScope } from "../vocabulary/construction.js";

export const TRAIT_FAMILIES = deepFreeze(["SHARED", "SPELL", "MANEUVER"] as const);
export const TRAIT_MODIFICATIONS = deepFreeze(["DAMAGE_TYPE", "TARGETING_MEASURE", "RESOLUTION", "TRIGGER", "COST"] as const);
export const TRAIT_ERROR_CODES = deepFreeze({ INVALID: "PROWESS_TRAIT.INVALID", MISSING_RULE: "PROWESS_TRAIT.MISSING_RULE", INCOMPATIBLE: "PROWESS_TRAIT.INCOMPATIBLE", PARAMETER: "PROWESS_TRAIT.PARAMETER", CAPACITY_UNRESOLVED: "PROWESS_TRAIT.CAPACITY_UNRESOLVED" });
export type TraitFamily = typeof TRAIT_FAMILIES[number];
export type TraitModification =
  | { readonly kind: "DAMAGE_TYPE"; readonly parameter: string }
  | { readonly kind: "TARGETING_MEASURE"; readonly parameter: string; readonly measure: "RADIUS" | "RANGE" | "LENGTH" | "WIDTH"; readonly operation: "ADD" | "MULTIPLY" | "SET" }
  | { readonly kind: "RESOLUTION"; readonly mode: "ATTACK_ROLL" | "SAVING_THROW" | "AUTOMATIC"; readonly validSaves: readonly string[] }
  | { readonly kind: "TRIGGER"; readonly event: "ON_HIT" | "ON_MISS" | "ON_DELIVERY" | "ON_ENTRY" }
  | { readonly kind: "COST"; readonly parameter: string; readonly currency: "AP" | "MP"; readonly operation: "ADD" | "MULTIPLY" | "SET" };
export interface TraitRules {
  readonly family: TraitFamily;
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly EffectParameterRule[];
  readonly modifications: readonly TraitModification[];
  readonly effectFamilies: readonly string[];
  readonly foundationCategories: readonly string[];
  readonly incompatibleTraits: readonly string[];
  /** Null = ordinary access; a specific Affinity must additionally match a Strength, never a Weakness. */
  readonly affinity: ProwessDefinitionRef | null;
}
const E = TRAIT_ERROR_CODES.INVALID;
const strings = (v: unknown, at: readonly PathSegment[], p: Problems, canonical = false): string[] => {
  if (!Array.isArray(v) || !v.every(x => typeof x === "string" && (canonical ? isExactCanonicalKey(x) : /^[A-Z][A-Z0-9_]*$/.test(x))) || new Set(v).size !== v.length) { p.add(E, at, "unique exact keys/tokens required"); return []; }
  return [...v].sort() as string[];
};
/** Additive typed rules.trait: legacy WO1 Traits remain readable but are not executable without this contract. */
export function readTraitRules(value: unknown, family: "SPELL" | "MANEUVER" | null, scope: TraitScope, at: readonly PathSegment[], p: Problems): TraitRules | null {
  const before = p.count;
  const fields = ["family", "name", "description", "parameters", "modifications", "effectFamilies", "foundationCategories", "incompatibleTraits", "affinity"];
  const r = readRecord(value, at, p, E, fields, fields); if (!r) return null;
  const f = readEnum(own(r, "family"), TRAIT_FAMILIES, [...at, "family"], p, E, "Trait family");
  if (f && f !== (family ?? "SHARED")) p.add(E, [...at, "family"], "Trait family must agree with its exact Definition kind");
  const name = own(r, "name"), description = own(r, "description");
  if (typeof name !== "string" || !name.trim() || typeof description !== "string") p.add(E, at, "name and description are inert text metadata");
  const parameters = readEffectParameterRules(own(r, "parameters"), [...at, "parameters"], p);
  const stacks = parameters.find(q => q.parameter === "stacks");
  if (stacks && (stacks.kind !== "COUNT" || (stacks.default !== null && stacks.default !== 1) || (stacks.minimum !== null && stacks.minimum < 1))) p.add(E, [...at, "parameters"], "stacks uses the permanent positive COUNT contract and default of one (or an explicit required selection)");
  const raw = own(r, "modifications"); const modifications: TraitModification[] = [];
  if (!Array.isArray(raw) || raw.length === 0) p.add(E, [...at, "modifications"], "at least one explicit modification required; Traits cannot author Effect outcomes");
  else raw.forEach((v, i) => {
    const a = [...at, "modifications", i];
    const k = v !== null && typeof v === "object" ? own(v as Record<string, unknown>, "kind") : null;
    const kind = readEnum(k, TRAIT_MODIFICATIONS, [...a, "kind"], p, E, "modification"); if (!kind) return;
    const allowed = kind === "RESOLUTION" ? ["kind", "mode", "validSaves"] : kind === "TRIGGER" ? ["kind", "event"] : kind === "DAMAGE_TYPE" ? ["kind", "parameter"] : kind === "COST" ? ["kind", "parameter", "currency", "operation"] : ["kind", "parameter", "measure", "operation"];
    const q = readRecord(v, a, p, E, allowed, allowed); if (!q) return;
    if (kind === "RESOLUTION") {
      if (scope !== "RESOLUTION") p.add(E, a, "resolution modification requires a selected resolution scope");
      const mode = readEnum(own(q, "mode"), ["ATTACK_ROLL", "SAVING_THROW", "AUTOMATIC"] as const, [...a, "mode"], p, E, "resolution");
      const validSaves = strings(own(q, "validSaves"), [...a, "validSaves"], p);
      if (validSaves.some(s => !["STR", "AGI", "PRO", "PER", "CON", "RES"].includes(s)) || (mode === "SAVING_THROW" ? validSaves.length === 0 : validSaves.length !== 0)) p.add(E, a, "Save resolution has explicit valid Saves only");
      if (mode) modifications.push({ kind, mode, validSaves }); return;
    }
    if (kind === "TRIGGER") {
      const event = readEnum(own(q, "event"), ["ON_HIT", "ON_MISS", "ON_DELIVERY", "ON_ENTRY"] as const, [...a, "event"], p, E, "trigger event");
      if (event) modifications.push({ kind, event }); return;
    }
    const parameter = own(q, "parameter"); const rule = parameters.find(x => x.parameter === parameter);
    if (!rule || (kind === "DAMAGE_TYPE" ? rule.kind !== "TOKEN" : rule.kind !== "COUNT")) { p.add(E, [...a, "parameter"], "modification names a declared parameter of the supported type"); return; }
    if (kind === "DAMAGE_TYPE") {
      if (scope !== "EFFECT_SPECIFIC") p.add(E, a, "damage type conversion modifies one selected Effect");
      modifications.push({ kind, parameter: rule.parameter }); return;
    }
    const operation = readEnum(own(q, "operation"), ["ADD", "MULTIPLY", "SET"] as const, [...a, "operation"], p, E, "modifier operation");
    if (kind === "COST") {
      const currency = readEnum(own(q, "currency"), ["AP", "MP"] as const, [...a, "currency"], p, E, "currency");
      if (currency && operation) modifications.push({ kind, parameter: rule.parameter, currency, operation });
    } else {
      if (scope !== "TARGETING") p.add(E, a, "geometry modifications require TARGETING scope");
      const measure = readEnum(own(q, "measure"), ["RADIUS", "RANGE", "LENGTH", "WIDTH"] as const, [...a, "measure"], p, E, "measure");
      if (measure && operation) modifications.push({ kind, parameter: rule.parameter, measure, operation });
    }
  });
  const effectFamilies = strings(own(r, "effectFamilies"), [...at, "effectFamilies"], p);
  const foundationCategories = strings(own(r, "foundationCategories"), [...at, "foundationCategories"], p);
  const incompatibleTraits = strings(own(r, "incompatibleTraits"), [...at, "incompatibleTraits"], p, true);
  const affinity = own(r, "affinity") === null ? null : readDefinitionRef(own(r, "affinity"), [...at, "affinity"], p, E);
  if (affinity && affinity.definitionKind !== "AFFINITY") p.add(E, [...at, "affinity"], "exact Affinity Definition required");
  return p.count > before || !f ? null : { family: f, name: name as string, description: description as string, parameters, modifications, effectFamilies, foundationCategories, incompatibleTraits, affinity };
}
/** Listed contributions reuse WO7's parameterized cost grammar; no final Ability cost or payment is computed. */
export function readTraitCosts(costs: readonly CostContribution[], rules: TraitRules, at: readonly PathSegment[], p: Problems): EffectCostRule[] {
  return readEffectCosts(costs, { parameters: rules.parameters } as Parameters<typeof readEffectCosts>[1], at, p);
}
export type TraitSelectedModification = { readonly definition: ProwessDefinitionRef; readonly componentKey: string; readonly targetComponentKey: string | null; readonly modification: TraitModification; readonly selected: number | string | boolean | null };
export type TraitDefinitionData = JsonObject;
