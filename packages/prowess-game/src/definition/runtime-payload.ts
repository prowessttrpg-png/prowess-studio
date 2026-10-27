import type { JsonObject } from "@prowess/model";
import { RESOURCE_CEILINGS, RESOURCE_KINDS, RESOURCE_OVERFLOW_POLICIES, RESOURCE_REFRESH_TARGETS, type ResourceCeiling, type ResourceKind, type ResourceOverflowPolicy, type ResourceRefreshTarget } from "@prowess/rules";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { DERIVED_STATISTICS, type DerivedStatistic } from "../vocabulary/core.js";
import {
  ACTION_COST_MODELS,
  ACTION_TIMINGS,
  COMBAT_TIMING_EVENTS,
  CREATURE_SIZES,
  PAYMENT_POLICIES,
  RESOURCE_EXPIRY_TARGETS,
  RESOURCE_SPENDING,
  RESOURCE_USAGE_RESTRICTIONS,
  RUNTIME_RESOURCE_KEYS,
  TERRAIN_KINDS,
  VARIABLE_COST_DETERMINERS,
  type ActionCostModel,
  type ActionTiming,
  type CombatTimingEvent,
  type CreatureSize,
  type PaymentPolicy,
  type ResourceExpiryTarget,
  type ResourceSpending,
  type ResourceUsageRestriction,
  type RuntimeResourceKey,
  type TerrainKind,
  type VariableCostDeterminer,
} from "../vocabulary/runtime.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readFormula, readSource, type CoreDefinitionSource, type CoreFormula } from "./core-payload.js";

/**
 * Version-1 payload contracts of the M5-WO3 runtime kinds: RESOURCE, ACTION, CREATURE_SIZE and TERRAIN (PAS-10 M5-WO3
 * §166–169). Every number is authored content; every Formula is an M4 expression validated by M4 itself. The readers
 * check structure, closed vocabularies and comparisons only — they perform no arithmetic, and a Definition never holds
 * a runtime CURRENT value (§20, M5-I081).
 */

/** A Resource's maximum: the exact WO2 derived capacity statistic, or explicitly none (an unbounded tracker). */
export type ResourceMaximum = { readonly source: "DERIVED"; readonly statistic: DerivedStatistic } | { readonly source: "UNBOUNDED" };

/** Raises current to a ceiling at one timing event (M4 REFRESH never lowers current, so nothing banks above it). */
export interface ResourceRefreshRule {
  readonly timing: CombatTimingEvent;
  readonly target: ResourceRefreshTarget;
}

/** Sets current to the Resource's minimum at one timing event, unless an explicit rule preserves it (when allowed). */
export interface ResourceExpiryRule {
  readonly timing: CombatTimingEvent;
  readonly setTo: ResourceExpiryTarget;
  readonly preservableByExplicitRule: boolean;
}

/** How an explicit restoration (healing, a movement grant) is bounded. Null = no generic restoration exists. */
export interface ResourceRestoration {
  readonly ceiling: ResourceCeiling;
  readonly overflow: ResourceOverflowPolicy;
}

/** This Resource pays costs of `policy`, at explicit position `order` among the Resources that pay that policy. */
export interface ResourcePaymentEligibility {
  readonly policy: PaymentPolicy;
  readonly order: number;
}

/** A restriction on USING the Resource — e.g. SURPRISED through round 1 (s51, s424). Never a spend or a removal. */
export interface ResourceUsageRestrictionRule {
  readonly restrictionKey: ResourceUsageRestriction;
  readonly throughRound: number;
}

export interface ResourceDefinitionPayload {
  readonly resourceKey: RuntimeResourceKey;
  readonly m4Kind: ResourceKind;
  readonly minimum: number;
  readonly maximum: ResourceMaximum;
  readonly refresh: readonly ResourceRefreshRule[];
  readonly expiry: readonly ResourceExpiryRule[];
  readonly spending: ResourceSpending;
  readonly restoration: ResourceRestoration | null;
  readonly supportsReservation: boolean;
  readonly payment: readonly ResourcePaymentEligibility[];
  readonly usageRestrictions: readonly ResourceUsageRestrictionRule[];
  /** Whether reaching the minimum is exposed as an explicit depletion fact (0 HP; Downed itself is deferred). */
  readonly exposesDepletion: boolean;
  readonly rules: JsonObject;
  readonly source: CoreDefinitionSource;
}

/** An ACTION's AP cost model (s44, s432). Amounts are content; a VARIABLE cost is supplied by the system that owns it. */
export type ActionPointCost =
  | { readonly model: "FIXED"; readonly amount: number }
  | { readonly model: "RANGE"; readonly minimum: number; readonly maximum: number }
  | { readonly model: "MINIMUM"; readonly minimum: number }
  | { readonly model: "VARIABLE"; readonly determinedBy: VariableCostDeterminer }
  | { readonly model: "NONE" };

/** A non-AP cost of an action, paid through a payment policy (a Counter Action reaction pays COUNTER_ACTION_COST 1). */
export interface ActionResourceCost {
  readonly costKey: string;
  readonly policy: PaymentPolicy;
  readonly amount: number;
}

export interface ActionDefinitionPayload {
  readonly actionKey: string;
  readonly timing: ActionTiming;
  readonly actionPointCost: ActionPointCost;
  readonly otherCosts: readonly ActionResourceCost[];
  /** Movement allowance the action grants once its costs are paid: an M4 Formula over DERIVED statistics only. */
  readonly movementGrant: { readonly formula: CoreFormula } | null;
  /** Whether using the action needs an explicit trigger (a Counter Action reaction, s47, s434). */
  readonly requiresTrigger: boolean;
  /** Specific weapons, spells, maneuvers and features may change the cost (s44, s432) — only by an explicit rule. */
  readonly costOverridableByExplicitRule: boolean;
  readonly rules: JsonObject;
  readonly source: CoreDefinitionSource;
}

/**
 * A Size's tactical identity (s442). `occupiedSpaceFeet` is the space as written (one dimension "5 ft", or two "10 ft ×
 * 10 ft"); `orLarger` marks "or larger". `baseMovement` is the Size's authored Base Movement in feet (designer ruling
 * M5-SC-033: Small / Medium 5, Large 10, Huge 15), or null where canon has no value yet (Massive — M5-SC-036). It is
 * explicit content; occupied space is never read as Base Movement (M5-I076, M5-I108, M5-I113). (M5-WO3 named this field
 * `movementAdjustment` and required null; M5-WO4 renamed it; the post-WO4 ruling gives it values.)
 */
export interface CreatureSizeDefinitionPayload {
  readonly sizeKey: CreatureSize;
  readonly occupiedSpaceFeet: readonly number[];
  readonly orLarger: boolean;
  readonly baseMovement: { readonly feet: number } | null;
  readonly rules: JsonObject;
  readonly source: CoreDefinitionSource;
}

/** A terrain kind's Movement-allowance cost: an M4 Formula over the MOVEMENT_DISTANCE moved (s437, s439). */
export interface TerrainDefinitionPayload {
  readonly terrainKey: TerrainKind;
  readonly allowanceCost: CoreFormula;
  readonly rules: JsonObject;
  readonly source: CoreDefinitionSource;
}

const RUNTIME_PAYLOAD_FIELDS = Object.freeze({
  RESOURCE: ["resourceKey", "m4Kind", "minimum", "maximum", "refresh", "expiry", "spending", "restoration", "supportsReservation", "payment", "usageRestrictions", "exposesDepletion", "rules", "source"],
  ACTION: ["actionKey", "timing", "actionPointCost", "otherCosts", "movementGrant", "requiresTrigger", "costOverridableByExplicitRule", "rules", "source"],
  CREATURE_SIZE: ["sizeKey", "occupiedSpaceFeet", "orLarger", "baseMovement", "rules", "source"],
  TERRAIN: ["terrainKey", "allowanceCost", "rules", "source"],
} as const);
export type RuntimePayloadKind = keyof typeof RUNTIME_PAYLOAD_FIELDS;
const RUNTIME_PAYLOAD_KINDS = Object.freeze(Object.keys(RUNTIME_PAYLOAD_FIELDS) as RuntimePayloadKind[]);
export const isRuntimePayloadKind = (kind: string): kind is RuntimePayloadKind => (RUNTIME_PAYLOAD_KINDS as readonly string[]).includes(kind);

function readBoolean(value: unknown, at: readonly PathSegment[], p: Problems, what: string): boolean | null {
  if (typeof value === "boolean") return value;
  p.add(C.INVALID_PAYLOAD, at, `${what} is an explicit boolean`);
  return null;
}

function readNonNegative(value: unknown, at: readonly PathSegment[], p: Problems, what: string): number | null {
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < 0) {
    p.add(C.INVALID_PAYLOAD, at, `${what} must not be negative`);
    return null;
  }
  return n;
}

function readRules(value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  if (!isPlainObject(value)) {
    p.add(C.INVALID_PAYLOAD, at, "rules is a plain object of authored data");
    return null;
  }
  return value as JsonObject;
}

/** An array whose entries are read by `read`; problems recorded; null entries dropped. */
function readList<T>(value: unknown, at: readonly PathSegment[], p: Problems, what: string, read: (item: unknown, at: PathSegment[]) => T | null): T[] | null {
  if (!Array.isArray(value)) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is an array`);
    return null;
  }
  return value.flatMap((item: unknown, i: number) => {
    const out = read(item, [...at, i]);
    return out === null ? [] : [out];
  });
}

function readResource(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): ResourceDefinitionPayload | null {
  const before = p.count;
  const resourceKey = readEnum(own(r, "resourceKey"), RUNTIME_RESOURCE_KEYS, [...at, "resourceKey"], p, C.INVALID_PAYLOAD, "runtime Resource");
  const m4Kind = readEnum(own(r, "m4Kind"), RESOURCE_KINDS, [...at, "m4Kind"], p, C.INVALID_PAYLOAD, "M4 resource kind");
  const minimum = readNonNegative(own(r, "minimum"), [...at, "minimum"], p, "minimum");

  let maximum: ResourceMaximum | null = null;
  const rawMaximum = own(r, "maximum");
  const source = isPlainObject(rawMaximum) ? own(rawMaximum, "source") : undefined;
  if (source === "DERIVED") {
    const m = readRecord(rawMaximum, [...at, "maximum"], p, C.INVALID_PAYLOAD, ["source", "statistic"], ["source", "statistic"]);
    const statistic = m === null ? null : readEnum(own(m, "statistic"), DERIVED_STATISTICS, [...at, "maximum", "statistic"], p, C.INVALID_PAYLOAD, "derived capacity statistic");
    if (statistic !== null) maximum = { source, statistic };
  } else if (source === "UNBOUNDED") {
    if (readRecord(rawMaximum, [...at, "maximum"], p, C.INVALID_PAYLOAD, ["source"], ["source"]) !== null) maximum = { source };
  } else p.add(C.INVALID_PAYLOAD, [...at, "maximum"], "maximum is { source: DERIVED, statistic } or { source: UNBOUNDED }");

  const refresh = readList(own(r, "refresh"), [...at, "refresh"], p, "refresh", (item, iat) => {
    const e = readRecord(item, iat, p, C.INVALID_PAYLOAD, ["timing", "target"], ["timing", "target"]);
    const timing = e === null ? null : readEnum(own(e, "timing"), COMBAT_TIMING_EVENTS, [...iat, "timing"], p, C.INVALID_PAYLOAD, "refresh timing");
    const target = e === null ? null : readEnum(own(e, "target"), RESOURCE_REFRESH_TARGETS, [...iat, "target"], p, C.INVALID_PAYLOAD, "refresh target");
    return timing === null || target === null ? null : { timing, target };
  });
  const expiry = readList(own(r, "expiry"), [...at, "expiry"], p, "expiry", (item, iat) => {
    const e = readRecord(item, iat, p, C.INVALID_PAYLOAD, ["timing", "setTo", "preservableByExplicitRule"], ["timing", "setTo", "preservableByExplicitRule"]);
    const timing = e === null ? null : readEnum(own(e, "timing"), COMBAT_TIMING_EVENTS, [...iat, "timing"], p, C.INVALID_PAYLOAD, "expiry timing");
    const setTo = e === null ? null : readEnum(own(e, "setTo"), RESOURCE_EXPIRY_TARGETS, [...iat, "setTo"], p, C.INVALID_PAYLOAD, "expiry target");
    const preservable = e === null ? null : readBoolean(own(e, "preservableByExplicitRule"), [...iat, "preservableByExplicitRule"], p, "preservableByExplicitRule");
    return timing === null || setTo === null || preservable === null ? null : { timing, setTo, preservableByExplicitRule: preservable };
  });
  // One behaviour per timing event: a Resource never both refreshes and expires at the same instant.
  const timings = [...(refresh ?? []).map((x) => x.timing), ...(expiry ?? []).map((x) => x.timing)];
  if (new Set(timings).size !== timings.length) p.add(C.INVALID_PAYLOAD, [...at, "refresh"], "a Resource has at most one refresh or expiry rule per timing event");

  const spending = readEnum(own(r, "spending"), RESOURCE_SPENDING, [...at, "spending"], p, C.INVALID_PAYLOAD, "spending");
  let restoration: ResourceRestoration | null = null;
  const rawRestoration = own(r, "restoration");
  if (rawRestoration !== null) {
    const e = readRecord(rawRestoration, [...at, "restoration"], p, C.INVALID_PAYLOAD, ["ceiling", "overflow"], ["ceiling", "overflow"]);
    const ceiling = e === null ? null : readEnum(own(e, "ceiling"), RESOURCE_CEILINGS, [...at, "restoration", "ceiling"], p, C.INVALID_PAYLOAD, "restoration ceiling");
    const overflow = e === null ? null : readEnum(own(e, "overflow"), RESOURCE_OVERFLOW_POLICIES, [...at, "restoration", "overflow"], p, C.INVALID_PAYLOAD, "overflow policy");
    if (ceiling !== null && overflow !== null) restoration = { ceiling, overflow };
  }
  const supportsReservation = readBoolean(own(r, "supportsReservation"), [...at, "supportsReservation"], p, "supportsReservation");
  if (supportsReservation === true && maximum !== null && maximum.source === "UNBOUNDED") p.add(C.INVALID_PAYLOAD, [...at, "supportsReservation"], "an unbounded Resource cannot reserve capacity");
  if (maximum !== null && maximum.source === "UNBOUNDED" && (refresh ?? []).length > 0) p.add(C.INVALID_PAYLOAD, [...at, "refresh"], "an unbounded Resource has no maximum to refresh to");

  const payment = readList(own(r, "payment"), [...at, "payment"], p, "payment", (item, iat) => {
    const e = readRecord(item, iat, p, C.INVALID_PAYLOAD, ["policy", "order"], ["policy", "order"]);
    const policy = e === null ? null : readEnum(own(e, "policy"), PAYMENT_POLICIES, [...iat, "policy"], p, C.INVALID_PAYLOAD, "payment policy");
    const order = e === null ? null : readNonNegative(own(e, "order"), [...iat, "order"], p, "payment order");
    return policy === null || order === null ? null : { policy, order };
  });
  if (payment !== null && new Set(payment.map((x) => x.policy)).size !== payment.length) p.add(C.INVALID_PAYLOAD, [...at, "payment"], "each payment policy is listed once");
  if (payment !== null && payment.length > 0 && spending === "NONE") p.add(C.INVALID_PAYLOAD, [...at, "spending"], "a Resource that pays a cost is spendable");

  const usageRestrictions = readList(own(r, "usageRestrictions"), [...at, "usageRestrictions"], p, "usageRestrictions", (item, iat) => {
    const e = readRecord(item, iat, p, C.INVALID_PAYLOAD, ["restrictionKey", "throughRound"], ["restrictionKey", "throughRound"]);
    const restrictionKey = e === null ? null : readEnum(own(e, "restrictionKey"), RESOURCE_USAGE_RESTRICTIONS, [...iat, "restrictionKey"], p, C.INVALID_PAYLOAD, "usage restriction");
    const throughRound = e === null ? null : readSafeInteger(own(e, "throughRound"), [...iat, "throughRound"], p, C.INVALID_PAYLOAD, "throughRound");
    if (throughRound !== null && throughRound < 1) p.add(C.INVALID_PAYLOAD, [...iat, "throughRound"], "rounds are numbered from 1");
    return restrictionKey === null || throughRound === null ? null : { restrictionKey, throughRound };
  });
  if (usageRestrictions !== null && usageRestrictions.length > 0 && spending === "DIRECT") {
    p.add(C.INVALID_PAYLOAD, [...at, "spending"], "a usage-restricted Resource is spent only through a payment that checks its restrictions (PAYMENT_ONLY)");
  }
  const exposesDepletion = readBoolean(own(r, "exposesDepletion"), [...at, "exposesDepletion"], p, "exposesDepletion");
  const rules = readRules(own(r, "rules"), [...at, "rules"], p);
  const src = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || resourceKey === null || m4Kind === null || minimum === null || maximum === null || refresh === null || expiry === null || spending === null) return null;
  if (supportsReservation === null || payment === null || usageRestrictions === null || exposesDepletion === null || rules === null || src === null) return null;
  return { resourceKey, m4Kind, minimum, maximum, refresh, expiry, spending, restoration, supportsReservation, payment, usageRestrictions, exposesDepletion, rules, source: src };
}

function readActionPointCost(value: unknown, at: readonly PathSegment[], p: Problems): ActionPointCost | null {
  const model: ActionCostModel | null = isPlainObject(value) ? readEnum(own(value, "model"), ACTION_COST_MODELS, [...at, "model"], p, C.INVALID_PAYLOAD, "AP cost model") : (p.add(C.INVALID_PAYLOAD, at, "actionPointCost is { model, … }"), null);
  switch (model) {
    case "FIXED": {
      const e = readRecord(value, at, p, C.INVALID_PAYLOAD, ["model", "amount"], ["model", "amount"]);
      const amount = e === null ? null : readNonNegative(own(e, "amount"), [...at, "amount"], p, "amount");
      return amount === null ? null : { model, amount };
    }
    case "RANGE": {
      const e = readRecord(value, at, p, C.INVALID_PAYLOAD, ["model", "minimum", "maximum"], ["model", "minimum", "maximum"]);
      const minimum = e === null ? null : readNonNegative(own(e, "minimum"), [...at, "minimum"], p, "minimum");
      const maximum = e === null ? null : readNonNegative(own(e, "maximum"), [...at, "maximum"], p, "maximum");
      if (minimum !== null && maximum !== null && !(minimum < maximum)) p.add(C.INVALID_PAYLOAD, at, "a RANGE cost has minimum below maximum (otherwise it is FIXED)");
      return minimum === null || maximum === null || !(minimum < maximum) ? null : { model, minimum, maximum };
    }
    case "MINIMUM": {
      const e = readRecord(value, at, p, C.INVALID_PAYLOAD, ["model", "minimum"], ["model", "minimum"]);
      const minimum = e === null ? null : readNonNegative(own(e, "minimum"), [...at, "minimum"], p, "minimum");
      return minimum === null ? null : { model, minimum };
    }
    case "VARIABLE": {
      const e = readRecord(value, at, p, C.INVALID_PAYLOAD, ["model", "determinedBy"], ["model", "determinedBy"]);
      const determinedBy = e === null ? null : readEnum(own(e, "determinedBy"), VARIABLE_COST_DETERMINERS, [...at, "determinedBy"], p, C.INVALID_PAYLOAD, "variable cost determiner");
      return determinedBy === null ? null : { model, determinedBy };
    }
    case "NONE":
      return readRecord(value, at, p, C.INVALID_PAYLOAD, ["model"], ["model"]) === null ? null : { model };
    default:
      return null;
  }
}

function readAction(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): ActionDefinitionPayload | null {
  const before = p.count;
  const actionKey = own(r, "actionKey");
  if (!isToken(actionKey)) p.add(C.INVALID_PAYLOAD, [...at, "actionKey"], "actionKey is a SCREAMING_SNAKE token");
  const timing = readEnum(own(r, "timing"), ACTION_TIMINGS, [...at, "timing"], p, C.INVALID_PAYLOAD, "action timing");
  const actionPointCost = readActionPointCost(own(r, "actionPointCost"), [...at, "actionPointCost"], p);
  const otherCosts = readList(own(r, "otherCosts"), [...at, "otherCosts"], p, "otherCosts", (item, iat) => {
    const e = readRecord(item, iat, p, C.INVALID_PAYLOAD, ["costKey", "policy", "amount"], ["costKey", "policy", "amount"]);
    const costKey = e === null ? null : own(e, "costKey");
    if (e !== null && !isToken(costKey)) p.add(C.INVALID_PAYLOAD, [...iat, "costKey"], "costKey is a SCREAMING_SNAKE token");
    const policy = e === null ? null : readEnum(own(e, "policy"), PAYMENT_POLICIES, [...iat, "policy"], p, C.INVALID_PAYLOAD, "payment policy");
    const amount = e === null ? null : readNonNegative(own(e, "amount"), [...iat, "amount"], p, "amount");
    if (policy === "ACTION_POINT_COST") p.add(C.INVALID_PAYLOAD, [...iat, "policy"], "the AP cost is the action's actionPointCost, never an other cost");
    return !isToken(costKey) || policy === null || amount === null || policy === "ACTION_POINT_COST" ? null : { costKey, policy, amount };
  });
  if (otherCosts !== null && new Set(otherCosts.map((c) => c.costKey)).size !== otherCosts.length) p.add(C.INVALID_PAYLOAD, [...at, "otherCosts"], "each costKey is unique");
  let movementGrant: ActionDefinitionPayload["movementGrant"] = null;
  const rawGrant = own(r, "movementGrant");
  if (rawGrant !== null) {
    const g = readRecord(rawGrant, [...at, "movementGrant"], p, C.INVALID_PAYLOAD, ["formula"], ["formula"]);
    const formula = g === null ? null : readFormula(own(g, "formula"), [...at, "movementGrant", "formula"], p, ["DERIVED"]);
    if (formula !== null) movementGrant = { formula };
  }
  const requiresTrigger = readBoolean(own(r, "requiresTrigger"), [...at, "requiresTrigger"], p, "requiresTrigger");
  if (timing === "OUTSIDE_OWN_TURN" && requiresTrigger === false) p.add(C.INVALID_PAYLOAD, [...at, "requiresTrigger"], "an action outside the creature's own turn is used only when a trigger allows it (s47, s434)");
  const overridable = readBoolean(own(r, "costOverridableByExplicitRule"), [...at, "costOverridableByExplicitRule"], p, "costOverridableByExplicitRule");
  const rules = readRules(own(r, "rules"), [...at, "rules"], p);
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || timing === null || actionPointCost === null || otherCosts === null || requiresTrigger === null || overridable === null || rules === null || source === null) return null;
  return { actionKey: actionKey as string, timing, actionPointCost, otherCosts, movementGrant, requiresTrigger, costOverridableByExplicitRule: overridable, rules, source };
}

function readCreatureSize(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): CreatureSizeDefinitionPayload | null {
  const before = p.count;
  const sizeKey = readEnum(own(r, "sizeKey"), CREATURE_SIZES, [...at, "sizeKey"], p, C.INVALID_PAYLOAD, "creature Size");
  const space = readList(own(r, "occupiedSpaceFeet"), [...at, "occupiedSpaceFeet"], p, "occupiedSpaceFeet", (item, iat) => {
    const n = readSafeInteger(item, iat, p, C.INVALID_PAYLOAD, "occupied space (feet)");
    if (n !== null && n < 1) p.add(C.INVALID_PAYLOAD, iat, "occupied space is positive");
    return n !== null && n >= 1 ? n : null;
  });
  if (space !== null && (space.length < 1 || space.length > 2)) p.add(C.INVALID_PAYLOAD, [...at, "occupiedSpaceFeet"], "occupied space is written with one or two dimensions (s442)");
  const orLarger = readBoolean(own(r, "orLarger"), [...at, "orLarger"], p, "orLarger");
  // M5-SC-033 RESOLVED_BY_DESIGNER (post-WO4): an explicit positive Base Movement in feet, or null while canon is pending.
  const rawBase = own(r, "baseMovement");
  let baseMovement: { feet: number } | null = null;
  if (rawBase !== null) {
    const b = readRecord(rawBase, [...at, "baseMovement"], p, C.INVALID_PAYLOAD, ["feet"], ["feet"]);
    const feet = b === null ? null : readSafeInteger(own(b, "feet"), [...at, "baseMovement", "feet"], p, C.INVALID_PAYLOAD, "baseMovement feet");
    if (feet !== null && feet < 1) p.add(C.INVALID_PAYLOAD, [...at, "baseMovement", "feet"], "a Base Movement is a positive number of feet");
    else if (feet !== null) baseMovement = { feet };
  }
  const rules = readRules(own(r, "rules"), [...at, "rules"], p);
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || sizeKey === null || space === null || orLarger === null || rules === null || source === null) return null;
  return { sizeKey, occupiedSpaceFeet: space, orLarger, baseMovement, rules, source };
}

function readTerrain(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): TerrainDefinitionPayload | null {
  const before = p.count;
  const terrainKey = readEnum(own(r, "terrainKey"), TERRAIN_KINDS, [...at, "terrainKey"], p, C.INVALID_PAYLOAD, "terrain kind");
  const allowanceCost = readFormula(own(r, "allowanceCost"), [...at, "allowanceCost"], p, ["MOVEMENT_DISTANCE"]);
  if (allowanceCost !== null && allowanceCost.variables.filter((v) => v.source.kind === "MOVEMENT_DISTANCE").length !== 1) {
    p.add(C.INVALID_PAYLOAD, [...at, "allowanceCost"], "a terrain cost reads the distance moved exactly once");
  }
  const rules = readRules(own(r, "rules"), [...at, "rules"], p);
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || terrainKey === null || allowanceCost === null || rules === null || source === null) return null;
  return { terrainKey, allowanceCost, rules, source };
}

/** Validates a version-1 payload of a WO3 runtime kind. Returns the canonical payload, or null with problems recorded. */
export function readRuntimePayload(kind: RuntimePayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const fields: readonly string[] = RUNTIME_PAYLOAD_FIELDS[kind];
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, fields, fields);
  if (r === null) return null;
  const readers = { RESOURCE: readResource, ACTION: readAction, CREATURE_SIZE: readCreatureSize, TERRAIN: readTerrain } as const;
  return readers[kind](r, at, p) as unknown as JsonObject | null;
}
