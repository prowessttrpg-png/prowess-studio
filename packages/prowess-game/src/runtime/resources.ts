import { createRuntimeContext, type ResourceSnapshot, type RuntimeContext } from "@prowess/rules";
import { deepFreeze } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, own, readRecord, readEnum, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { DEFINITION_ERROR_CODES as C, RUNTIME_ERROR_CODES as R } from "../definition/codes.js";
import { RESOURCE_CONTEXT_KEYS, RUNTIME_RESOURCE_KEYS, RUNTIME_STATE_KEYS, type RuntimeResourceKey } from "../vocabulary/runtime.js";
import type { RuntimeDefinitionIndex } from "./definitions.js";

/**
 * Runtime Resource state (PAS-10 M5-WO3 §22, §97–98, §170). CURRENT values (and reserved MP capacity) are runtime INPUT
 * supplied by the caller — never stored in a Definition, never persisted by evaluation. MAXIMUM values are never
 * supplied: they are the exact WO2 capacity statistics, evaluated by M4 inside every runtime plan (maximum ≠ current,
 * M5-I081). The same shape comes back out of an evaluated plan, as a new detached value.
 */
export interface ProwessRuntimeResourceState {
  readonly resourceKey: RuntimeResourceKey;
  readonly current: number;
  /** Reserved capacity (Mana Lock style) — only for a Resource whose Definition supports reservation. */
  readonly reservedCapacity: number;
}

export interface ProwessRuntimeResources {
  /** One entry per supplied Resource, in RUNTIME_RESOURCE_KEYS order. */
  readonly resources: readonly ProwessRuntimeResourceState[];
}

/** Where the creature stands in combat timing: the round number (from 1) and whether it was surprised (s51, s424). */
export interface CombatTiming {
  readonly round: number;
  readonly surprised: boolean;
}

const RESOURCE_FIELDS = ["resourceKey", "current", "reservedCapacity"];

/**
 * Validates caller-supplied runtime Resources against the exact RESOURCE Definitions: plain data only (no getters,
 * functions, cycles, unsafe keys or non-finite numbers), each Resource at most once, current never below the
 * Definition's minimum (negative values refused), reservation only where the Definition supports it. Never clamps,
 * rounds or repairs a value. Current above maximum is diagnosed by M4 itself when the plan runs.
 */
export function validateRuntimeResources(value: unknown, index: RuntimeDefinitionIndex): ProwessOutcome<ProwessRuntimeResources> {
  const p = new Problems();
  if (!checkPlainData(value, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(value, [], p, R.INVALID_RESOURCE_STATE, ["resources"], ["resources"]);
  if (r === null) return finish(p, () => null as never);
  const raw = own(r, "resources");
  const states = new Map<RuntimeResourceKey, ProwessRuntimeResourceState>();
  if (!Array.isArray(raw)) p.add(R.INVALID_RESOURCE_STATE, ["resources"], "resources is an array of { resourceKey, current, reservedCapacity? }");
  else
    raw.forEach((item: unknown, i: number) => {
      const at = ["resources", i];
      const e = readRecord(item, at, p, R.INVALID_RESOURCE_STATE, RESOURCE_FIELDS, ["resourceKey", "current"]);
      if (e === null) return;
      const resourceKey = readEnum(own(e, "resourceKey"), RUNTIME_RESOURCE_KEYS, [...at, "resourceKey"], p, R.INVALID_RESOURCE_STATE, "runtime Resource");
      if (resourceKey === null) return;
      if (states.has(resourceKey)) {
        p.add(R.INVALID_RESOURCE_STATE, [...at, "resourceKey"], `${resourceKey} is supplied twice`);
        return;
      }
      const definition = index.resources[resourceKey].payload;
      const current = own(e, "current");
      if (typeof current !== "number" || !Number.isFinite(current)) {
        p.add(R.INVALID_RESOURCE_STATE, [...at, "current"], "current is a finite number");
        return;
      }
      if (current < definition.minimum) {
        p.add(R.NEGATIVE_RESOURCE_VALUE, [...at, "current"], `${resourceKey} current ${current} is below its minimum ${definition.minimum}`);
        return;
      }
      const rawReserved = own(e, "reservedCapacity");
      const reservedCapacity = rawReserved === undefined ? 0 : readSafeInteger(rawReserved, [...at, "reservedCapacity"], p, R.INVALID_RESOURCE_STATE, "reservedCapacity");
      if (reservedCapacity === null) return;
      if (reservedCapacity < 0) p.add(R.NEGATIVE_RESOURCE_VALUE, [...at, "reservedCapacity"], "reserved capacity is never negative");
      else if (reservedCapacity !== 0 && !definition.supportsReservation) {
        p.add(R.TRANSITION_NOT_SUPPORTED, [...at, "reservedCapacity"], `${resourceKey} does not support reserved capacity (${index.resources[resourceKey].ref.canonicalKey})`);
      } else states.set(resourceKey, { resourceKey, current, reservedCapacity });
    });
  return finish(p, () => deepFreeze({ resources: RUNTIME_RESOURCE_KEYS.flatMap((key) => (states.has(key) ? [states.get(key) as ProwessRuntimeResourceState] : [])) }));
}

/** Validates a combat-timing position: an integer round from 1 and an explicit surprised flag. */
export function validateCombatTiming(value: unknown): ProwessOutcome<CombatTiming> {
  const p = new Problems();
  if (!checkPlainData(value, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(value, [], p, R.INVALID_TIMING, ["round", "surprised"], ["round", "surprised"]);
  if (r === null) return finish(p, () => null as never);
  const round = readSafeInteger(own(r, "round"), ["round"], p, R.INVALID_TIMING, "round");
  if (round !== null && round < 1) p.add(R.INVALID_TIMING, ["round"], "rounds are numbered from 1");
  const surprised = own(r, "surprised");
  if (typeof surprised !== "boolean") p.add(R.INVALID_TIMING, ["surprised"], "surprised is an explicit boolean (the GM determines Surprise, s51)");
  return finish(p, () => ({ round: round as number, surprised: surprised as boolean }));
}

/**
 * The M4 RuntimeContext of a runtime plan: each supplied Resource's current value under its exact resource key, the
 * reserved capacity of every reservation-capable Resource, and the combat timing as numeric state. Values are copied,
 * never combined.
 */
export function buildRuntimeContext(input: { readonly resources: ProwessRuntimeResources; readonly index: RuntimeDefinitionIndex; readonly combat?: CombatTiming | null }): ProwessOutcome<RuntimeContext> {
  const p = new Problems();
  const resourceValues: Record<string, number> = {};
  const reservedCapacity: Record<string, number> = {};
  for (const state of input.resources.resources) {
    resourceValues[RESOURCE_CONTEXT_KEYS[state.resourceKey]] = state.current;
    if (input.index.resources[state.resourceKey].payload.supportsReservation) reservedCapacity[RESOURCE_CONTEXT_KEYS[state.resourceKey]] = state.reservedCapacity;
  }
  const state: Record<string, number> = {};
  if (input.combat !== undefined && input.combat !== null) {
    state[RUNTIME_STATE_KEYS.ROUND] = input.combat.round;
    state[RUNTIME_STATE_KEYS.SURPRISED] = input.combat.surprised ? 1 : 0;
  }
  const created = createRuntimeContext({ resourceValues, reservedCapacity, activeEffects: [], conditions: [], state });
  if (!created.ok) p.add(R.INVALID_RESOURCE_STATE, [], "the runtime Resources do not form a valid M4 RuntimeContext");
  return finish(p, () => (created as { ok: true; value: RuntimeContext }).value);
}

/**
 * Reads runtime Resource state back out of M4 resource snapshots (a transition's or payment's `resultingResources`):
 * exact copies of `current` and `reservedCapacity`, keyed back to the Prowess Resource. Nothing is recomputed; the
 * `base` state supplies every Resource the snapshots do not mention. Returns a NEW detached value.
 */
export function runtimeResourcesFromSnapshots(base: ProwessRuntimeResources, snapshots: readonly ResourceSnapshot[]): ProwessRuntimeResources {
  const byContextKey = new Map<string, { current: number; reservedCapacity: number }>();
  for (const snapshot of snapshots) for (const s of snapshot.resources) byContextKey.set(s.resourceKey, { current: s.current, reservedCapacity: s.reservedCapacity });
  const out = new Map<RuntimeResourceKey, ProwessRuntimeResourceState>(base.resources.map((s) => [s.resourceKey, s]));
  for (const key of RUNTIME_RESOURCE_KEYS) {
    const hit = byContextKey.get(RESOURCE_CONTEXT_KEYS[key]);
    if (hit !== undefined) out.set(key, { resourceKey: key, current: hit.current, reservedCapacity: hit.reservedCapacity });
  }
  return deepFreeze({ resources: RUNTIME_RESOURCE_KEYS.flatMap((key) => (out.has(key) ? [out.get(key) as ProwessRuntimeResourceState] : [])) });
}
