/**
 * Structural readers for caller-supplied evaluation input (PAS-10 M4-WO1 §57). Internal — not exported.
 *
 * Each reader takes `unknown`, checks SHAPE only (types, finite numbers, identifier and key grammar, duplicates in
 * set-like collections, unknown fields) and records every problem with a JSON Pointer path, in the deterministic order
 * the input is walked. None of them knows any game rule, and none performs Requirement or rule validation.
 *
 * Normalization policy:
 *  - keyed collections (objects) are semantically unordered → rebuilt with sorted keys, so insertion order never
 *    changes a normalized context (§53);
 *  - set-like lists (keywords, tags, conditions, entity references) are semantically unordered → sorted, and a
 *    duplicate member is an error rather than silently dropped;
 *  - explicitly ordered lists (build components, active runtime effects) keep the caller's order;
 *  - UUIDs are lowercased (UUIDs are case-insensitive; PostgreSQL emits lowercase), everything else is kept verbatim.
 */
import { isEntityType, isValidCanonicalKey, isUuidString, type CanonicalKey, type EntityId, type EntityType, type EntityVersionId } from "@prowess/model";
import { isValidContextKey, MAX_CONTEXT_KEY_LENGTH } from "../context/context-key.js";
import type { ContextScalar, EntityVersionReference } from "../context/shared.js";
import { RULE_ENGINE_ERROR_CODES, type EngineErrorInput } from "../errors/engine-error.js";
import { isPlainObject, jsonPointer, type PathSegment, type PlainDataProblem } from "./plain-data.js";

export const MAX_TEXT_LENGTH = 10_000;

export class InputProblems {
  readonly list: EngineErrorInput[] = [];

  invalid(at: readonly PathSegment[], message: string): void {
    this.list.push({ code: RULE_ENGINE_ERROR_CODES.INVALID_INPUT, message, path: jsonPointer(at) });
  }

  nonFinite(at: readonly PathSegment[], value: number): void {
    this.list.push({
      code: RULE_ENGINE_ERROR_CODES.NON_FINITE_NUMBER,
      message: `${String(value)} is not a finite number`,
      path: jsonPointer(at),
      details: { value: String(value) },
    });
  }

  /** Records a plain-data problem already located by a JSON Pointer (see `inspectPlainData`). */
  plainData(problem: PlainDataProblem): void {
    this.list.push({
      code: problem.kind === "NON_FINITE_NUMBER" ? RULE_ENGINE_ERROR_CODES.NON_FINITE_NUMBER : RULE_ENGINE_ERROR_CODES.INVALID_INPUT,
      message: problem.reason,
      path: problem.path,
    });
  }

  get count(): number {
    return this.list.length;
  }
}

const describe = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "object" ? "a non-plain object" : `a ${typeof value}`;

/** A plain object with only `allowed` fields (unknown fields are errors) and every `required` field present. */
export function readRecord(
  value: unknown,
  at: readonly PathSegment[],
  p: InputProblems,
  allowed: readonly string[],
  required: readonly string[] = [],
): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    p.invalid(at, `expected an object, got ${describe(value)}`);
    return null;
  }
  for (const key of Object.keys(value).sort()) {
    if (!allowed.includes(key)) p.invalid([...at, key], `unknown field "${key}"`);
  }
  for (const key of required) {
    if (value[key] === undefined) p.invalid([...at, key], `"${key}" is required`);
  }
  return value;
}

export function readFiniteNumber(value: unknown, at: readonly PathSegment[], p: InputProblems): number | null {
  if (typeof value !== "number") {
    p.invalid(at, `expected a number, got ${describe(value)}`);
    return null;
  }
  if (!Number.isFinite(value)) {
    p.nonFinite(at, value);
    return null;
  }
  return Object.is(value, -0) ? 0 : value;
}

export function readPositiveInteger(value: unknown, at: readonly PathSegment[], p: InputProblems): number | null {
  const n = readFiniteNumber(value, at, p);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 1) {
    p.invalid(at, "expected a positive integer");
    return null;
  }
  return n;
}

export function readScalar(value: unknown, at: readonly PathSegment[], p: InputProblems): ContextScalar | null {
  if (typeof value === "number") return readFiniteNumber(value, at, p);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_TEXT_LENGTH) {
      p.invalid(at, `string exceeds ${MAX_TEXT_LENGTH} characters`);
      return null;
    }
    return value;
  }
  p.invalid(at, `expected a number, string or boolean, got ${describe(value)}`);
  return null;
}

export function readText(value: unknown, at: readonly PathSegment[], p: InputProblems, max = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    p.invalid(at, "expected a non-empty string");
    return null;
  }
  if (value.length > max) {
    p.invalid(at, `string exceeds ${max} characters`);
    return null;
  }
  return value;
}

/** `undefined` and `null` both mean "absent" on input; absence is always `null` in normalized output. */
export function readOptionalText(value: unknown, at: readonly PathSegment[], p: InputProblems, max = MAX_TEXT_LENGTH): string | null {
  return value === undefined || value === null ? null : readText(value, at, p, max);
}

export function readContextKey(value: unknown, at: readonly PathSegment[], p: InputProblems): string | null {
  if (!isValidContextKey(value)) {
    p.invalid(at, `expected a context key (lowercase dotted segments, at most ${MAX_CONTEXT_KEY_LENGTH} characters)`);
    return null;
  }
  return value;
}

export function readUuid(value: unknown, at: readonly PathSegment[], p: InputProblems): string | null {
  if (!isUuidString(value)) {
    p.invalid(at, "expected a UUID");
    return null;
  }
  return value.toLowerCase();
}

export function readOptionalUuid(value: unknown, at: readonly PathSegment[], p: InputProblems): string | null {
  return value === undefined || value === null ? null : readUuid(value, at, p);
}

export function readCanonicalKey(value: unknown, at: readonly PathSegment[], p: InputProblems): CanonicalKey | null {
  if (typeof value !== "string" || !isValidCanonicalKey(value)) {
    p.invalid(at, "expected a canonical key");
    return null;
  }
  return value as CanonicalKey;
}

export function readEntityType(value: unknown, at: readonly PathSegment[], p: InputProblems): EntityType | null {
  if (typeof value !== "string" || !isEntityType(value)) {
    p.invalid(at, "expected a known EntityType");
    return null;
  }
  return value;
}

/** A keyed collection (`{ [contextKey]: value }`), rebuilt with sorted keys. `undefined` → `{}`. */
function readKeyed<T>(
  value: unknown,
  at: readonly PathSegment[],
  p: InputProblems,
  readValue: (v: unknown, at: readonly PathSegment[], p: InputProblems) => T | null,
): Record<string, T> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    p.invalid(at, `expected an object keyed by context keys, got ${describe(value)}`);
    return {};
  }
  const out: Record<string, T> = {};
  for (const key of Object.keys(value).sort()) {
    if (readContextKey(key, [...at, key], p) === null) continue;
    const read = readValue(value[key], [...at, key], p);
    if (read !== null) out[key] = read;
  }
  return out;
}

export function readKeyedNumbers(value: unknown, at: readonly PathSegment[], p: InputProblems): Record<string, number> {
  return readKeyed(value, at, p, readFiniteNumber);
}

export function readKeyedScalars(value: unknown, at: readonly PathSegment[], p: InputProblems): Record<string, ContextScalar> {
  return readKeyed(value, at, p, readScalar);
}

/** A set of context keys: sorted, duplicates are errors. `undefined` → `[]`. */
export function readKeySet(value: unknown, at: readonly PathSegment[], p: InputProblems): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    p.invalid(at, `expected an array of context keys, got ${describe(value)}`);
    return [];
  }
  const seen = new Set<string>();
  value.forEach((item, i) => {
    const key = readContextKey(item, [...at, i], p);
    if (key === null) return;
    if (seen.has(key)) p.invalid([...at, i], `duplicate member "${key}"`);
    seen.add(key);
  });
  return [...seen].sort();
}

export function readEntityVersionReference(value: unknown, at: readonly PathSegment[], p: InputProblems): EntityVersionReference | null {
  const r = readRecord(value, at, p, ["entityId", "entityVersionId"], ["entityId", "entityVersionId"]);
  if (r === null) return null;
  const entityId = readUuid(r.entityId, [...at, "entityId"], p);
  const entityVersionId = readUuid(r.entityVersionId, [...at, "entityVersionId"], p);
  if (entityId === null || entityVersionId === null) return null;
  return { entityId: entityId as EntityId, entityVersionId: entityVersionId as EntityVersionId };
}

export function readOptionalEntityVersionReference(value: unknown, at: readonly PathSegment[], p: InputProblems): EntityVersionReference | null {
  return value === undefined || value === null ? null : readEntityVersionReference(value, at, p);
}

const compareRefs = (a: EntityVersionReference, b: EntityVersionReference): number =>
  a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : a.entityVersionId < b.entityVersionId ? -1 : a.entityVersionId > b.entityVersionId ? 1 : 0;

/** A set of exact references: sorted by (entityId, entityVersionId); an identical pair twice is an error. */
export function readEntityVersionReferenceSet(value: unknown, at: readonly PathSegment[], p: InputProblems): EntityVersionReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    p.invalid(at, `expected an array of entity version references, got ${describe(value)}`);
    return [];
  }
  const out: EntityVersionReference[] = [];
  const seen = new Set<string>();
  value.forEach((item, i) => {
    const ref = readEntityVersionReference(item, [...at, i], p);
    if (ref === null) return;
    const id = `${ref.entityId}/${ref.entityVersionId}`;
    if (seen.has(id)) {
      p.invalid([...at, i], "duplicate entity version reference");
      return;
    }
    seen.add(id);
    out.push(ref);
  });
  return out.sort(compareRefs);
}

/** An explicitly ORDERED list of keyed items whose `key` must be unique; the caller's order is preserved. */
export function readOrderedKeyedList<T extends { readonly key: string }>(
  value: unknown,
  at: readonly PathSegment[],
  p: InputProblems,
  readItem: (v: unknown, at: readonly PathSegment[], p: InputProblems) => T | null,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    p.invalid(at, `expected an array, got ${describe(value)}`);
    return [];
  }
  const out: T[] = [];
  const seen = new Set<string>();
  value.forEach((item, i) => {
    const read = readItem(item, [...at, i], p);
    if (read === null) return;
    if (seen.has(read.key)) {
      p.invalid([...at, i, "key"], `duplicate key "${read.key}"`);
      return;
    }
    seen.add(read.key);
    out.push(read);
  });
  return out;
}
