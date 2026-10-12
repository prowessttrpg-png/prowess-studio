import { isValidContextKey } from "../context/context-key.js";
import { canonicalJson } from "../internal/canonical-json.js";
import { InputProblems } from "../internal/input-reader.js";
import { deepFreeze, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { readProvenance, type RuleProvenance } from "../result/provenance.js";
import {
  RESOURCE_DIAGNOSTIC_CODES,
  RESOURCE_KINDS,
  RESOURCE_LIMITS,
  type ResourceDiagnostic,
  type ResourceDiagnosticCode,
  type ResourceKind,
  type ResourceSnapshot,
  type ResourceState,
} from "./model.js";

/**
 * ResourceSnapshot construction (PAS-10 M4-WO7 §12–25, §99–105, §114–118). Strict plain data: own data properties
 * only, getters never invoked, unknown fields rejected, every number finite (maximum may be null), -0 → 0. Identical
 * duplicate states collapse; conflicting states for one resourceKey fail closed — never "last write wins". Output is
 * a detached, deep-frozen snapshot ordered by resourceKey; the caller's objects are never frozen or changed.
 */
export type ResourceSnapshotOutcome =
  | { readonly ok: true; readonly snapshot: ResourceSnapshot }
  | { readonly ok: false; readonly diagnostics: readonly ResourceDiagnostic[] };

export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const zero = (n: number) => (Object.is(n, -0) ? 0 : n);
export const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A plain object whose keys are all own data properties within `allowed` (getters are never invoked). */
export function ownRecord(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.keys(value).every((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return allowed.includes(k) && d !== undefined && d.get === undefined && d.set === undefined;
  });
}

export function readProvenanceField(value: unknown): RuleProvenance | null | undefined {
  const problems = new InputProblems();
  const p = readProvenance(value, [], problems);
  return problems.count > 0 ? undefined : p;
}

/** The derived available maximum: `maximum − reservedCapacity`, or null for an unbounded resource. Pure. */
export function getAvailableMaximum(resource: Pick<ResourceState, "maximum" | "reservedCapacity">): number | null {
  return resource.maximum === null ? null : zero(resource.maximum - resource.reservedCapacity);
}

const STATE_FIELDS = ["resourceKey", "kind", "current", "minimum", "maximum", "reservedCapacity", "provenance"];

/** Checks one resource state's invariants. Returns the problem, or null. */
export function stateProblem(s: Pick<ResourceState, "current" | "minimum" | "maximum" | "reservedCapacity">): { code: ResourceDiagnosticCode; message: string } | null {
  if (s.maximum !== null && s.minimum > s.maximum) return { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, message: "minimum must not exceed maximum" };
  if (s.current < s.minimum) return { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, message: "current is below minimum" };
  if (s.maximum !== null && s.current > s.maximum) return { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, message: "current is above the nominal maximum" };
  if (s.reservedCapacity < 0) return { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, message: "reservedCapacity must not be negative" };
  if (s.maximum === null && s.reservedCapacity !== 0) return { code: RESOURCE_DIAGNOSTIC_CODES.INVALID_RESERVATION, message: "an unbounded resource cannot reserve capacity" };
  if (s.maximum !== null && s.reservedCapacity > s.maximum - s.minimum) {
    return { code: RESOURCE_DIAGNOSTIC_CODES.RESERVATION_EXCEEDS_CAPACITY, message: "reservedCapacity must not exceed maximum − minimum" };
  }
  return null;
}

/** Validates and normalizes `{ resources: ResourceState[] }`. `base` prefixes diagnostic paths. */
export function createResourceSnapshot(input: unknown, base: readonly (string | number)[] = []): ResourceSnapshotOutcome {
  const diagnostics: ResourceDiagnostic[] = [];
  const report = (code: ResourceDiagnosticCode, message: string, path: readonly (string | number)[], resourceKey: string | null = null) =>
    diagnostics.push({ code, message, path: jsonPointer([...base, ...path]), resourceKey });
  const fail = () => deepFreeze({ ok: false as const, diagnostics });

  if (!ownRecord(input, ["resources"]) || !Array.isArray(input.resources)) {
    report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, "a resource snapshot is { resources: ResourceState[] } — plain data only", []);
    return fail();
  }
  if (input.resources.length > RESOURCE_LIMITS.MAX_RESOURCES) {
    report(RESOURCE_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `at most ${RESOURCE_LIMITS.MAX_RESOURCES} resources`, ["resources"]);
    return fail();
  }

  const states: ResourceState[] = [];
  input.resources.forEach((r: unknown, i: number) => {
    const at = ["resources", i];
    if (!ownRecord(r, STATE_FIELDS)) return void report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, `a resource is a plain object with only ${STATE_FIELDS.join(", ")}`, at);
    if (!isValidContextKey(r.resourceKey)) return void report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, "resourceKey must be an exact context key", [...at, "resourceKey"]);
    const key = r.resourceKey;
    if (!(RESOURCE_KINDS as readonly unknown[]).includes(r.kind)) return void report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, `kind must be one of ${RESOURCE_KINDS.join(", ")}`, [...at, "kind"], key);
    for (const field of ["current", "minimum"] as const) {
      if (!isFiniteNumber(r[field])) return void report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, `${field} must be a finite number`, [...at, field], key);
    }
    if (r.maximum !== null && !isFiniteNumber(r.maximum)) return void report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, "maximum must be a finite number or null (unbounded)", [...at, "maximum"], key);
    const reserved = r.reservedCapacity === undefined ? 0 : r.reservedCapacity;
    if (!isFiniteNumber(reserved)) return void report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, "reservedCapacity must be a finite number", [...at, "reservedCapacity"], key);
    const provenance = readProvenanceField(r.provenance);
    if (provenance === undefined) return void report(RESOURCE_DIAGNOSTIC_CODES.INVALID_STATE, "provenance is malformed", [...at, "provenance"], key);
    const state: ResourceState = {
      resourceKey: key,
      kind: r.kind as ResourceKind,
      current: zero(r.current as number),
      minimum: zero(r.minimum as number),
      maximum: r.maximum === null ? null : zero(r.maximum as number),
      reservedCapacity: zero(reserved),
      provenance,
    };
    const problem = stateProblem(state);
    if (problem !== null) return void report(problem.code, problem.message, at, key);
    states.push(state);
  });

  const byKey = new Map<string, ResourceState[]>();
  for (const s of states) byKey.set(s.resourceKey, [...(byKey.get(s.resourceKey) ?? []), s]);
  const resources: ResourceState[] = [];
  for (const key of [...byKey.keys()].sort(byCodeUnit)) {
    const variants = byKey.get(key) as ResourceState[];
    if (new Set(variants.map((v) => canonicalJson(v))).size > 1) {
      report(RESOURCE_DIAGNOSTIC_CODES.DUPLICATE_KEY, `resourceKey "${key}" is supplied with conflicting state`, ["resources"], key);
      continue;
    }
    resources.push(variants[0] as ResourceState); // identical duplicates collapse
  }
  if (diagnostics.length > 0) return fail();
  return deepFreeze({ ok: true as const, snapshot: { resources } });
}
