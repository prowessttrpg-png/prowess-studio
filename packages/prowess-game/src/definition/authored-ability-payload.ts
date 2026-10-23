import type { JsonObject } from "@prowess/model";
import { clonePlainData, deepFreeze, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { readDefinitionRef } from "./envelope.js";
import { validateAbilityComposition, type ComponentUse, type OrderedComponentUse, type SpellComposition, type TraitUse, type ManeuverComposition } from "../construction/composition.js";
import { TRAIT_SCOPES, type TraitScope } from "../vocabulary/construction.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";

export const AUTHORED_ABILITY_ERROR_CODES = deepFreeze({ INVALID: "PROWESS_ABILITY.INVALID_DEFINITION", REFERENCE: "PROWESS_ABILITY.INVALID_REFERENCE", FOUNDATION: "PROWESS_ABILITY.INVALID_FOUNDATION", DURATION: "PROWESS_ABILITY.INVALID_DURATION", INCOMPLETE_RUN: "PROWESS_ABILITY.INCOMPLETE_RUN" });
const E = AUTHORED_ABILITY_ERROR_CODES.INVALID;
export interface SpellDefinitionPayload {
  readonly name: string;
  readonly description: string;
  readonly composition: SpellComposition;
  /** Separate from normal slots/exchanges. Non-empty allocations require an authoritative capacity grant. */
  readonly additionalAffinityTraits: readonly string[];
  readonly constructionOptions: { readonly effectSlotsTradedForTraits: number };
}
export interface ManeuverDefinitionPayload {
  readonly name: string;
  readonly description: string;
  /** Targeting and foundation are derived from actions, never selected in this authored object. */
  readonly composition: Omit<ManeuverComposition, "targeting" | "branch">;
  readonly actions: readonly OrderedComponentUse[];
  readonly effectAttachments: readonly { readonly effectKey: string; readonly actionKeys: readonly string[] }[];
  readonly powerfulBlow: { readonly actionKeys: readonly string[] } | null;
}
export type AuthoredAbilityPayload = SpellDefinitionPayload | ManeuverDefinitionPayload;
export interface AttackFoundationProfile {
  readonly category: "MELEE" | "RANGED";
  readonly targeting: ComponentUse;
  readonly range: { readonly kind: "WEAPON_RANGE"; readonly feet: number };
  readonly resolution: { readonly mode: "ATTACK_ROLL"; readonly stat: ProwessStat };
  readonly damage: { readonly kind: "WEAPON"; readonly weaponKey: string; readonly baseDice: string; readonly power: number; readonly stat: ProwessStat; readonly enchantments: readonly string[] };
}

/** A non-attack Maneuver foundation (Move, Run, Sprint, Block, Guard): an exact action with its own Targeting and NO Attack
 * resolution, damage profile or weapon requirement. It contributes its authored AP and never counts as an attack. */
export interface ActionFoundationProfile {
  readonly category: "MOVEMENT" | "DEFENSE";
  readonly targeting: ComponentUse;
  readonly range: null;
  readonly resolution: { readonly mode: "NONE" };
  readonly damage: null;
}
export type FoundationProfile = AttackFoundationProfile | ActionFoundationProfile;
export const isAttackFoundation = (profile: FoundationProfile): profile is AttackFoundationProfile => profile.resolution.mode === "ATTACK_ROLL";

function text(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems) {
  const name = own(r, "name"), description = own(r, "description");
  if (typeof name !== "string" || !name.trim() || typeof description !== "string") p.add(E, at, "name and description are inert text metadata");
  return { name: name as string, description: description as string };
}
function labels(v: unknown, at: readonly PathSegment[], p: Problems): string[] {
  if (!Array.isArray(v) || !v.every(isExactLabel) || new Set(v).size !== v.length) { p.add(E, at, "unique exact labels required"); return []; }
  return [...v] as string[];
}
function use(v: unknown, at: readonly PathSegment[], p: Problems, ordered: boolean, trait = false): OrderedComponentUse | TraitUse | null {
  const fields = ["componentKey", "definition", "parameters", ...(ordered ? ["order"] : []), ...(trait ? ["appliesTo"] : [])];
  const r = readRecord(v, at, p, E, fields, fields); if (!r) return null;
  const componentKey = own(r, "componentKey"), parameters = own(r, "parameters");
  if (!isExactLabel(componentKey) || !isPlainObject(parameters)) p.add(E, at, "an exact component key and plain parameter selections are required");
  const definition = readDefinitionRef(own(r, "definition"), [...at, "definition"], p, E);
  const order = ordered ? readSafeInteger(own(r, "order"), [...at, "order"], p, E, "order") : 0;
  let appliesTo: TraitUse["appliesTo"] = { scope: "ABILITY_WIDE", componentKey: null };
  if (trait) {
    const a = readRecord(own(r, "appliesTo"), [...at, "appliesTo"], p, E, ["scope", "componentKey"], ["scope", "componentKey"]);
    const scope = a ? readEnum(own(a, "scope"), TRAIT_SCOPES, [...at, "appliesTo", "scope"], p, E, "scope") : null;
    const key = a ? own(a, "componentKey") : null;
    if (scope === "ABILITY_WIDE" ? key !== null : !isExactLabel(key)) p.add(E, at, "Trait scope names exactly its selected component");
    if (scope) appliesTo = { scope, componentKey: key as string | null };
  }
  return !definition || order === null ? null : { componentKey: componentKey as string, definition, parameters: parameters as JsonObject, order, ...(trait ? { appliesTo } : {}) };
}
function ordered(v: unknown, at: readonly PathSegment[], p: Problems, trait = false): OrderedComponentUse[] {
  if (!Array.isArray(v)) { p.add(E, at, "ordered component array required"); return []; }
  const result = v.flatMap((x, i) => { const u = use(x, [...at, i], p, true, trait); return u ? [u] : []; });
  if (new Set(result.map(x => x.componentKey)).size !== result.length || new Set(result.map(x => x.order)).size !== result.length) p.add(E, at, "component keys and authored orders are unique within the slot");
  return result.sort((a, b) => a.order === b.order ? a.componentKey < b.componentKey ? -1 : 1 : a.order < b.order ? -1 : 1);
}
function optionalUse(v: unknown, at: readonly PathSegment[], p: Problems): ComponentUse | null {
  if (v === null) return null;
  const u = use(v, at, p, false); if (!u) return null;
  return { componentKey: u.componentKey, definition: u.definition, parameters: u.parameters };
}
export function readAuthoredAbilityPayload(kind: "SPELL_DEFINITION" | "MANEUVER_DEFINITION", v: unknown, at: readonly PathSegment[], p: Problems): AuthoredAbilityPayload | null {
  const before = p.count;
  const fields = kind === "SPELL_DEFINITION" ? ["name", "description", "composition", "additionalAffinityTraits", "constructionOptions"] : ["name", "description", "composition", "actions", "effectAttachments", "powerfulBlow"];
  const r = readRecord(v, at, p, E, fields, fields.filter(f => f !== "constructionOptions")); if (!r) return null;
  const metadata = text(r, at, p);
  if (kind === "SPELL_DEFINITION") {
    const c = validateAbilityComposition(own(r, "composition"));
    if (!c.ok) for (const x of c.problems) p.list.push({ ...x, path: `${at.length ? `/${at.join("/")}` : ""}/composition${x.path}` });
    else {
      if (c.value.abilityKind !== "SPELL") p.add(E, at, "SPELL_DEFINITION contains only a Spell composition");
      const authority = c.value.authority;
      if (!authority || Object.keys(authority).join() !== "authority" || !["ARCANE_AUTHORITY", "AFFINITY_AUTHORITY"].includes(String(authority.authority))) p.add(E, [...at, "composition", "authority"], "one explicit Spell authority is required");
      if (c.value.branch.kind === "SPELL" && (c.value.branch.sustain !== null || c.value.branch.concentration !== null || Object.keys(c.value.branch.data).length)) p.add(E, at, "runtime Sustain/Concentration and executable branch data are not WO8 authored configuration");
      if (c.value.branch.kind === "SPELL" && c.value.branch.effectChain !== null) {
        const chain = readRecord(c.value.branch.effectChain, [...at, "composition", "branch", "effectChain"], p, E, ["failurePolicy"], ["failurePolicy"]);
        if (chain) readEnum(chain.failurePolicy, ["STOP", "CONTINUE"] as const, at, p, E, "structural failure policy");
      }
    }
    const options = own(r, "constructionOptions");
    const selected = options === undefined ? { effectSlotsTradedForTraits: 0 } : readRecord(options, [...at, "constructionOptions"], p, E, ["effectSlotsTradedForTraits"], ["effectSlotsTradedForTraits"]);
    const trades = selected ? readSafeInteger(selected.effectSlotsTradedForTraits, [...at, "constructionOptions", "effectSlotsTradedForTraits"], p, E, "Effect slots traded") : null;
    if (trades !== null && trades < 0) p.add(E, [...at, "constructionOptions"], "trade count is non-negative");
    const constructionOptions = { effectSlotsTradedForTraits: trades ?? 0 };
    const additionalAffinityTraits = labels(own(r, "additionalAffinityTraits"), [...at, "additionalAffinityTraits"], p);
    return p.count > before || !c.ok ? null : { ...metadata, composition: c.value as SpellComposition, additionalAffinityTraits, constructionOptions };
  }
  const raw = readRecord(own(r, "composition"), [...at, "composition"], p, E, ["compositionKey", "abilityKind", "affinity", "authority", "keywords", "effects", "traits", "duration", "conditions"], ["compositionKey", "abilityKind", "affinity", "authority", "keywords", "effects", "traits", "duration", "conditions"]);
  if (!raw) return null;
  if (own(raw, "abilityKind") !== "MANEUVER" || own(raw, "authority") !== null || !isExactLabel(own(raw, "compositionKey"))) p.add(E, at, "Maneuver kind is explicit and never uses Spell Authority");
  const composition = {
    compositionKey: own(raw, "compositionKey") as string, abilityKind: "MANEUVER" as const,
    affinity: optionalUse(own(raw, "affinity"), [...at, "composition", "affinity"], p), authority: null,
    keywords: labels(own(raw, "keywords"), [...at, "composition", "keywords"], p).sort(),
    effects: ordered(own(raw, "effects"), [...at, "composition", "effects"], p),
    traits: ordered(own(raw, "traits"), [...at, "composition", "traits"], p, true) as TraitUse[],
    duration: optionalUse(own(raw, "duration"), [...at, "composition", "duration"], p),
    conditions: ordered(own(raw, "conditions"), [...at, "composition", "conditions"], p),
  };
  const actions = ordered(own(r, "actions"), [...at, "actions"], p);
  if (!actions.length || actions.some(x => x.definition.definitionKind !== "MANEUVER_FOUNDATION")) p.add(E, [...at, "actions"], "one or more exact Maneuver foundations required");
  const keys = [...composition.effects, ...composition.traits, ...composition.conditions, ...actions, ...(composition.duration ? [composition.duration] : [])].map(x => x.componentKey);
  if (new Set(keys).size !== keys.length || keys.includes("targeting")) p.add(E, at, "all component keys are unique; targeting is reserved for inherited delivery");
  const effectAttachments: { effectKey: string; actionKeys: string[] }[] = []; const rawAttachments = own(r, "effectAttachments");
  if (!Array.isArray(rawAttachments)) p.add(E, [...at, "effectAttachments"], "explicit attachments required");
  else rawAttachments.forEach((x, i) => {
    const a = [...at, "effectAttachments", i]; const q = readRecord(x, a, p, E, ["effectKey", "actionKeys"], ["effectKey", "actionKeys"]); if (!q) return;
    const effectKey = own(q, "effectKey"), actionKeys = labels(own(q, "actionKeys"), [...a, "actionKeys"], p);
    if (!composition.effects.some(e => e.componentKey === effectKey) || !actionKeys.length || actionKeys.some(k => !actions.some(x => x.componentKey === k)) || effectAttachments.some(x => x.effectKey === effectKey)) p.add(E, a, "attachment names one Effect and exact committed actions");
    else effectAttachments.push({ effectKey: effectKey as string, actionKeys: actionKeys.sort() });
  });
  if (composition.effects.some(e => !effectAttachments.some(a => a.effectKey === e.componentKey))) p.add(E, at, "every Maneuver Effect has an explicit attachment");
  let powerfulBlow: ManeuverDefinitionPayload["powerfulBlow"] = null;
  if (own(r, "powerfulBlow") !== null) {
    const q = readRecord(own(r, "powerfulBlow"), [...at, "powerfulBlow"], p, E, ["actionKeys"], ["actionKeys"]);
    if (q) {
      const actionKeys = labels(own(q, "actionKeys"), [...at, "powerfulBlow", "actionKeys"], p);
      if (actionKeys.length < 2 || actionKeys.some(k => !actions.some(x => x.componentKey === k))) p.add(E, at, "Powerful Blow commits at least two explicit actions; it is not an Effect");
      powerfulBlow = { actionKeys };
    }
  }
  return p.count > before ? null : { ...metadata, composition, actions, effectAttachments: effectAttachments.sort((a, b) => a.effectKey < b.effectKey ? -1 : 1), powerfulBlow };
}

export function readAttackFoundationProfile(v: unknown, at: readonly PathSegment[], p: Problems): AttackFoundationProfile | null {
  const before = p.count, C = AUTHORED_ABILITY_ERROR_CODES.FOUNDATION;
  const r = readRecord(v, at, p, C, ["category", "targeting", "range", "resolution", "damage"], ["category", "targeting", "range", "resolution", "damage"]); if (!r) return null;
  const category = readEnum(own(r, "category"), ["MELEE", "RANGED"] as const, [...at, "category"], p, C, "attack category");
  const targeting = optionalUse(own(r, "targeting"), [...at, "targeting"], p);
  if (!targeting || targeting.definition.definitionKind !== "MANEUVER_TARGETING" || targeting.componentKey !== "targeting") p.add(C, at, "foundation owns its exact Maneuver targeting");
  const range = readRecord(own(r, "range"), [...at, "range"], p, C, ["kind", "feet"], ["kind", "feet"]);
  const feet = range ? readSafeInteger(range.feet, [...at, "range", "feet"], p, C, "weapon range") : null;
  if (!range || range.kind !== "WEAPON_RANGE" || feet === null || feet < 0) p.add(C, at, "range is inherited from an explicit non-negative weapon profile");
  const resolution = readRecord(own(r, "resolution"), [...at, "resolution"], p, C, ["mode", "stat"], ["mode", "stat"]);
  const stat = resolution ? readEnum(resolution.stat, PROWESS_STATS, at, p, C, "attack Stat") : null;
  if (resolution?.mode !== "ATTACK_ROLL") p.add(C, at, "ordinary foundation has its own Attack Roll");
  const damage = readRecord(own(r, "damage"), [...at, "damage"], p, C, ["kind", "weaponKey", "baseDice", "power", "stat", "enchantments"], ["kind", "weaponKey", "baseDice", "power", "stat", "enchantments"]);
  const damageStat = damage ? readEnum(damage.stat, PROWESS_STATS, at, p, C, "weapon scaling Stat") : null;
  if (!damage || damage.kind !== "WEAPON" || !isExactLabel(damage.weaponKey) || typeof damage.baseDice !== "string" || !/^[1-9][0-9]*d(4|6|8|10|12|20)$/.test(damage.baseDice) || !Number.isSafeInteger(damage.power) || (damage.power as number) < 0) p.add(C, at, "ordinary Maneuver damage retains weapon base dice, Power and Stat; never Spell Character Dice");
  const enchantments = labels(damage?.enchantments, [...at, "damage", "enchantments"], p);
  return p.count > before || !category || !targeting || feet === null || !stat || !damage || !damageStat ? null : { category, targeting, range: { kind: "WEAPON_RANGE", feet }, resolution: { mode: "ATTACK_ROLL", stat }, damage: { kind: "WEAPON", weaponKey: damage.weaponKey as string, baseDice: damage.baseDice as string, power: damage.power as number, stat: damageStat, enchantments } };
}
export function readActionFoundationProfile(v: unknown, at: readonly PathSegment[], p: Problems): ActionFoundationProfile | null {
  const before = p.count, C = AUTHORED_ABILITY_ERROR_CODES.FOUNDATION;
  const r = readRecord(v, at, p, C, ["category", "targeting"], ["category", "targeting"]); if (!r) return null;
  const category = readEnum(own(r, "category"), ["MOVEMENT", "DEFENSE"] as const, [...at, "category"], p, C, "non-attack action category");
  const targeting = optionalUse(own(r, "targeting"), [...at, "targeting"], p);
  if (!targeting || targeting.definition.definitionKind !== "MANEUVER_TARGETING" || targeting.componentKey !== "targeting") p.add(C, at, "a non-attack action owns its exact Maneuver targeting");
  return p.count > before || !category || !targeting ? null : { category, targeting, range: null, resolution: { mode: "NONE" }, damage: null };
}
/** A foundation is EITHER an exact Attack (`rules.attack`) OR an exact non-attack action (`rules.action`) — never both, never neither. */
export function readFoundationProfile(rules: Readonly<Record<string, unknown>>, at: readonly PathSegment[], p: Problems): FoundationProfile | null {
  const attack = own(rules, "attack"), action = own(rules, "action");
  if ((attack === undefined) === (action === undefined)) { p.add(AUTHORED_ABILITY_ERROR_CODES.FOUNDATION, at, "a foundation is exactly one Attack or one non-attack action"); return null; }
  return attack !== undefined ? readAttackFoundationProfile(attack, at, p) : readActionFoundationProfile(action, at, p);
}
export function validateAuthoredAbilityDefinition(kind: "SPELL_DEFINITION" | "MANEUVER_DEFINITION", input: unknown): ProwessOutcome<AuthoredAbilityPayload> {
  const p = new Problems(); if (!checkPlainData(input, [], p, E)) return finish(p, () => null as never);
  const value = readAuthoredAbilityPayload(kind, input, [], p); return finish(p, () => clonePlainData(value!));
}
export function serializeAuthoredAbilityDefinition(kind: "SPELL_DEFINITION" | "MANEUVER_DEFINITION", input: unknown): ProwessOutcome<string> {
  const r = validateAuthoredAbilityDefinition(kind, input); return r.ok ? { ok: true, value: JSON.stringify(clonePlainData(r.value)) } : r;
}
export function deserializeAuthoredAbilityDefinition(kind: "SPELL_DEFINITION" | "MANEUVER_DEFINITION", input: string): ProwessOutcome<AuthoredAbilityPayload> {
  try { return validateAuthoredAbilityDefinition(kind, JSON.parse(input)); } catch { const p = new Problems(); p.add(E, [], "valid JSON required"); return finish(p, () => null as never); }
}
export type AuthoredTraitScope = TraitScope;
