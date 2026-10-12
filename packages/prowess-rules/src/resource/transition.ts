import { isValidContextKey } from "../context/context-key.js";
import { evaluate } from "../evaluation/evaluate.js";
import { deepFreeze, jsonPointer } from "../internal/plain-data.js";
import { booleanValue, numberValue, stringValue } from "../result/evaluation-value.js";
import type { RuleProvenance } from "../result/provenance.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import type { TraceInput } from "../trace/calculation-trace.js";
import { validationMessage } from "../validation/validation-message.js";
import {
  RESOURCE_CEILINGS,
  RESOURCE_DIAGNOSTIC_CODES,
  RESOURCE_OVERFLOW_POLICIES,
  type ResourceCeiling,
  type ResourceDiagnostic,
  type ResourceDiagnosticCode,
  type ResourceSnapshot,
  type ResourceState,
  type ResourceTransition,
  type ResourceTransitionResult,
} from "./model.js";
import { createResourceSnapshot, getAvailableMaximum, isFiniteNumber, ownRecord, readProvenanceField, zero } from "./snapshot.js";

/**
 * Single-resource transitions (PAS-10 M4-WO7 §26–50, §79, §93–95, §106–109). Each is a pure function of an explicit
 * snapshot and an explicit request, returning a NEW snapshot; nothing is persisted, nothing happens on its own.
 *
 *   SPEND             changes current only; never below minimum; insufficient → applied:false + shortfall (valid)
 *   RESTORE           adds to current up to an explicit ceiling with an explicit overflow policy; never lowers current
 *   SET_CURRENT       explicit value within minimum and the chosen ceiling (nominal by default)
 *   RESERVE_CAPACITY  changes reservedCapacity only — current is untouched, even if it now exceeds availableMaximum
 *   RELEASE_CAPACITY  changes reservedCapacity only — current is NOT restored
 *   REFRESH           raises current to an explicit ceiling; never lowers it (no hidden clamp)
 *
 * Resource kind never changes any of this.
 */

/** What a transition computes: the new current / reservation, or a diagnostic. */
type Computed =
  | { readonly diagnostic: { code: ResourceDiagnosticCode; message: string; field: string } }
  | {
      readonly current: number;
      readonly reservedCapacity: number;
      readonly applied: boolean;
      readonly requestedAmount: number;
      readonly actualAmount: number;
      readonly shortfall: number;
      readonly overflow: number;
      readonly currentAboveCeiling: boolean;
    };

const OPERATION_NAMES: Readonly<Record<ResourceTransition, string>> = {
  SPEND: "resource.spend",
  RESTORE: "resource.restore",
  SET_CURRENT: "resource.set_current",
  RESERVE_CAPACITY: "resource.reserve_capacity",
  RELEASE_CAPACITY: "resource.release_capacity",
  REFRESH: "resource.refresh",
};

const nothing = { shortfall: 0, overflow: 0, currentAboveCeiling: false };

/** The ceiling value for a resource, or a diagnostic for AVAILABLE_MAXIMUM on an unbounded resource. Null = unbounded. */
function ceilingOf(state: ResourceState, ceiling: ResourceCeiling): number | null | "INVALID" {
  if (ceiling === "NOMINAL_MAXIMUM") return state.maximum;
  return state.maximum === null ? "INVALID" : getAvailableMaximum(state);
}

export function toResourceMessages(diagnostics: readonly ResourceDiagnostic[]) {
  return diagnostics.map((d) =>
    validationMessage({ severity: "ERROR", category: "RESOURCE", code: d.code, message: d.message, path: d.path, details: { resourceKey: d.resourceKey } }),
  );
}

/** Replaces one resource in an (already ordered) snapshot, returning a new snapshot. */
export function replaceResource(snapshot: ResourceSnapshot, next: ResourceState): ResourceSnapshot {
  return { resources: snapshot.resources.map((r) => (r.resourceKey === next.resourceKey ? next : r)) };
}

function runTransition(
  transition: ResourceTransition,
  snapshotInput: unknown,
  requestInput: unknown,
  extraFields: readonly string[],
  compute: (state: ResourceState, request: Record<string, unknown>, amount: number | null) => Computed,
  options: { readonly ruleset?: unknown },
  needsAmount: boolean,
): RuleEngineResponse<ResourceTransitionResult> {
  const kind = OPERATION_NAMES[transition];
  return evaluate<ResourceTransitionResult | null>(
    {
      kind,
      evaluate: () => {
        const diagnostics: ResourceDiagnostic[] = [];
        const report = (code: ResourceDiagnosticCode, message: string, field: string | null, resourceKey: string | null = null) =>
          diagnostics.push({ code, message, path: jsonPointer(field === null ? ["request"] : ["request", field]), resourceKey });
        const snapshot = createResourceSnapshot(snapshotInput, ["snapshot"]);
        if (!snapshot.ok) diagnostics.push(...snapshot.diagnostics);

        const fields = ["resourceKey", "provenance", ...(needsAmount ? ["amount"] : []), ...extraFields];
        if (!ownRecord(requestInput, fields)) {
          report(RESOURCE_DIAGNOSTIC_CODES.INVALID_AMOUNT, `the request is a plain object with only ${fields.join(", ")}`, null);
          return { data: null, messages: toResourceMessages(diagnostics) };
        }
        const request = requestInput;
        let amount: number | null = null;
        if (needsAmount) {
          if (!isFiniteNumber(request.amount) || request.amount < 0) report(RESOURCE_DIAGNOSTIC_CODES.INVALID_AMOUNT, "amount must be a finite number ≥ 0 (a negative amount is never reinterpreted)", "amount");
          else amount = zero(request.amount);
        }
        const provenance: RuleProvenance | null | undefined = readProvenanceField(request.provenance);
        if (provenance === undefined) report(RESOURCE_DIAGNOSTIC_CODES.INVALID_AMOUNT, "provenance is malformed", "provenance");
        if (!isValidContextKey(request.resourceKey)) report(RESOURCE_DIAGNOSTIC_CODES.NOT_FOUND, "resourceKey must be an exact context key", "resourceKey");
        if (diagnostics.length > 0 || !snapshot.ok) return { data: null, messages: toResourceMessages(diagnostics) };

        const resourceKey = request.resourceKey as string;
        const before = snapshot.snapshot.resources.find((r) => r.resourceKey === resourceKey);
        if (before === undefined) {
          report(RESOURCE_DIAGNOSTIC_CODES.NOT_FOUND, `resource "${resourceKey}" is not in the snapshot`, "resourceKey", resourceKey);
          return { data: null, messages: toResourceMessages(diagnostics) };
        }
        const c = compute(before, request, amount);
        if ("diagnostic" in c) {
          report(c.diagnostic.code, c.diagnostic.message, c.diagnostic.field, resourceKey);
          return { data: null, messages: toResourceMessages(diagnostics) };
        }
        if (!Number.isFinite(c.current) || !Number.isFinite(c.reservedCapacity)) {
          report(RESOURCE_DIAGNOSTIC_CODES.NON_FINITE_RESULT, `${transition} on "${resourceKey}" produced a non-finite value`, null, resourceKey);
          return { data: null, messages: toResourceMessages(diagnostics) };
        }
        const after: ResourceState = { ...before, current: zero(c.current), reservedCapacity: zero(c.reservedCapacity) };
        const resultingResources = after.current === before.current && after.reservedCapacity === before.reservedCapacity ? snapshot.snapshot : deepFreeze(replaceResource(snapshot.snapshot, after));
        const result: ResourceTransitionResult = {
          transition,
          resourceKey,
          applied: c.applied,
          requestedAmount: zero(c.requestedAmount),
          actualAmount: zero(c.actualAmount),
          shortfall: zero(c.shortfall),
          overflow: zero(c.overflow),
          currentAboveCeiling: c.currentAboveCeiling,
          before,
          after,
          availableMaximumBefore: getAvailableMaximum(before),
          availableMaximumAfter: getAvailableMaximum(after),
          provenance: provenance ?? null,
          resultingResources,
        };
        const optional = (name: string, v: number | null): TraceInput[] => (v === null ? [] : [{ name, value: numberValue(v) }]);
        return {
          data: result,
          trace: [
            {
              key: "resource",
              operation: kind,
              inputs: [
                { name: "resource_key", value: stringValue(resourceKey) },
                { name: "current_before", value: numberValue(before.current) },
                { name: "minimum", value: numberValue(before.minimum) },
                ...optional("maximum", before.maximum),
                { name: "reserved_before", value: numberValue(before.reservedCapacity) },
                ...optional("available_maximum_before", result.availableMaximumBefore),
                { name: "requested", value: numberValue(result.requestedAmount) },
                { name: "applied", value: booleanValue(result.applied) },
                { name: "actual", value: numberValue(result.actualAmount) },
                ...(result.shortfall > 0 ? [{ name: "shortfall", value: numberValue(result.shortfall) }] : []),
                ...(result.overflow > 0 ? [{ name: "overflow", value: numberValue(result.overflow) }] : []),
                { name: "reserved_after", value: numberValue(after.reservedCapacity) },
                ...optional("available_maximum_after", result.availableMaximumAfter),
                { name: "current_after", value: numberValue(after.current) },
              ],
              output: numberValue(after.current),
              provenance: provenance ?? null,
            },
          ],
        };
      },
    },
    { kind, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<ResourceTransitionResult>;
}

export interface ResourceOperationOptions {
  /** The exact RulesetContext the evaluation runs under; recorded as response provenance, never searched. */
  readonly ruleset?: unknown;
}

/** Spends `amount` from current. Never crosses minimum: insufficient → applied:false, shortfall, no change. */
export function spendResource(snapshot: unknown, request: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<ResourceTransitionResult> {
  return runTransition("SPEND", snapshot, request, [], (s, _r, amount) => {
    const a = amount as number;
    const available = s.current - s.minimum;
    if (a <= available) return { ...nothing, current: s.current - a, reservedCapacity: s.reservedCapacity, applied: true, requestedAmount: a, actualAmount: a };
    return { ...nothing, current: s.current, reservedCapacity: s.reservedCapacity, applied: false, requestedAmount: a, actualAmount: 0, shortfall: a - available };
  }, options, true);
}

/**
 * Restores `amount` up to an explicit ceiling (`NOMINAL_MAXIMUM` | `AVAILABLE_MAXIMUM`) with an explicit overflow
 * policy (`CLAMP` restores up to the ceiling; `INVALID` refuses with OUT_OF_BOUNDS). Never lowers current: when current
 * already sits above the ceiling nothing is restorable.
 */
export function restoreResource(snapshot: unknown, request: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<ResourceTransitionResult> {
  return runTransition("RESTORE", snapshot, request, ["ceiling", "overflow"], (s, r, amount) => {
    const a = amount as number;
    if (!(RESOURCE_CEILINGS as readonly unknown[]).includes(r.ceiling)) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_BOUNDARY, message: "ceiling must be NOMINAL_MAXIMUM or AVAILABLE_MAXIMUM", field: "ceiling" } };
    if (!(RESOURCE_OVERFLOW_POLICIES as readonly unknown[]).includes(r.overflow)) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_BOUNDARY, message: "overflow must be CLAMP or INVALID", field: "overflow" } };
    const ceiling = ceilingOf(s, r.ceiling as ResourceCeiling);
    if (ceiling === "INVALID") return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_BOUNDARY, message: "AVAILABLE_MAXIMUM needs a finite maximum", field: "ceiling" } };
    const currentAboveCeiling = ceiling !== null && s.current > ceiling;
    const restorable = ceiling === null ? Number.POSITIVE_INFINITY : Math.max(0, ceiling - s.current);
    const base = { reservedCapacity: s.reservedCapacity, requestedAmount: a, shortfall: 0, currentAboveCeiling };
    if (a <= restorable) return { ...base, current: s.current + a, applied: true, actualAmount: a, overflow: 0 };
    if (r.overflow === "INVALID") {
      return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.OUT_OF_BOUNDS, message: `restoring ${a} exceeds the ${String(r.ceiling)} ceiling (overflow policy INVALID)`, field: "amount" } };
    }
    return { ...base, current: s.current + restorable, applied: true, actualAmount: restorable, overflow: a - restorable };
  }, options, true);
}

/** Sets current to an explicit value within [minimum, ceiling] — the nominal maximum unless AVAILABLE_MAXIMUM is requested. */
export function setResourceCurrent(snapshot: unknown, request: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<ResourceTransitionResult> {
  return runTransition("SET_CURRENT", snapshot, request, ["value", "ceiling"], (s, r) => {
    if (!isFiniteNumber(r.value)) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_AMOUNT, message: "value must be a finite number", field: "value" } };
    const choice = r.ceiling === undefined ? "NOMINAL_MAXIMUM" : r.ceiling;
    if (!(RESOURCE_CEILINGS as readonly unknown[]).includes(choice)) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_BOUNDARY, message: "ceiling must be NOMINAL_MAXIMUM or AVAILABLE_MAXIMUM", field: "ceiling" } };
    const ceiling = ceilingOf(s, choice as ResourceCeiling);
    if (ceiling === "INVALID") return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_BOUNDARY, message: "AVAILABLE_MAXIMUM needs a finite maximum", field: "ceiling" } };
    if (r.value < s.minimum || (ceiling !== null && r.value > ceiling)) {
      return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.OUT_OF_BOUNDS, message: "value must lie between minimum and the chosen ceiling", field: "value" } };
    }
    return { ...nothing, current: r.value, reservedCapacity: s.reservedCapacity, applied: true, requestedAmount: r.value, actualAmount: r.value };
  }, options, false);
}

/** Reserves capacity. Changes reservedCapacity only — current is never touched, even if it now exceeds availableMaximum. */
export function reserveResourceCapacity(snapshot: unknown, request: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<ResourceTransitionResult> {
  return runTransition("RESERVE_CAPACITY", snapshot, request, [], (s, _r, amount) => {
    const a = amount as number;
    if (s.maximum === null) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_RESERVATION, message: "an unbounded resource cannot reserve capacity", field: "resourceKey" } };
    if (s.reservedCapacity + a > s.maximum - s.minimum) {
      return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.RESERVATION_EXCEEDS_CAPACITY, message: "the reservation would exceed maximum − minimum", field: "amount" } };
    }
    return { ...nothing, current: s.current, reservedCapacity: s.reservedCapacity + a, applied: true, requestedAmount: a, actualAmount: a };
  }, options, true);
}

/** Releases reserved capacity. Changes reservedCapacity only — current is NOT restored. */
export function releaseResourceCapacity(snapshot: unknown, request: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<ResourceTransitionResult> {
  return runTransition("RELEASE_CAPACITY", snapshot, request, [], (s, _r, amount) => {
    const a = amount as number;
    if (a > s.reservedCapacity) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.RELEASE_EXCEEDS_RESERVED, message: "cannot release more capacity than is reserved", field: "amount" } };
    return { ...nothing, current: s.current, reservedCapacity: s.reservedCapacity - a, applied: true, requestedAmount: a, actualAmount: a };
  }, options, true);
}

export const RESOURCE_REFRESH_TARGETS = ["TO_NOMINAL_MAXIMUM", "TO_AVAILABLE_MAXIMUM"] as const;
export type ResourceRefreshTarget = (typeof RESOURCE_REFRESH_TARGETS)[number];

/**
 * Explicit, caller-triggered refresh: raises current to the chosen ceiling. Never lowers current — when current already
 * sits at or above the ceiling nothing changes (`currentAboveCeiling` reports the latter). Needs a finite maximum.
 */
export function refreshResource(snapshot: unknown, request: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<ResourceTransitionResult> {
  return runTransition("REFRESH", snapshot, request, ["target"], (s, r) => {
    if (!(RESOURCE_REFRESH_TARGETS as readonly unknown[]).includes(r.target)) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_BOUNDARY, message: "target must be TO_NOMINAL_MAXIMUM or TO_AVAILABLE_MAXIMUM", field: "target" } };
    if (s.maximum === null) return { diagnostic: { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_BOUNDARY, message: "refresh needs a finite maximum to refresh to", field: "target" } };
    const ceiling = (r.target === "TO_NOMINAL_MAXIMUM" ? s.maximum : getAvailableMaximum(s)) as number;
    const raise = Math.max(0, ceiling - s.current);
    return {
      current: s.current + raise,
      reservedCapacity: s.reservedCapacity,
      applied: true,
      requestedAmount: ceiling,
      actualAmount: raise,
      shortfall: 0,
      overflow: 0,
      currentAboveCeiling: s.current > ceiling,
    };
  }, options, false);
}
