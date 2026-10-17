/**
 * Plain-data guards for the @prowess/game boundary (PAS-10 M5-WO1 §145–147).
 *
 * The same contract as @prowess/rules' internal guards (M4-WO1 §32–33), duplicated deliberately: those helpers are
 * internal to the frozen M4 package and are not part of its public surface (M5-WO1 §73), so M5 does not reach into
 * them. Every public @prowess/game input and output is plain JSON data — `null`, booleans, FINITE numbers, strings,
 * arrays and plain objects; no accessor, function, symbol, class instance, cycle or prototype-polluting key.
 */
/** Keys that are never accepted in caller-supplied keyed collections (prototype-pollution guard). */
export const FORBIDDEN_OBJECT_KEYS: readonly string[] = deepFreeze(["__proto__", "constructor", "prototype"]);

export type PlainDataProblemKind = "NON_FINITE_NUMBER" | "NOT_PLAIN_DATA";

export interface PlainDataProblem {
  readonly kind: PlainDataProblemKind;
  readonly path: string;
  readonly reason: string;
}

export type PathSegment = string | number;

/** RFC 6901 JSON Pointer for a sequence of segments: `["actor", "stats", "stat.power"]` → `/actor/stats/stat.power`. */
export function jsonPointer(segments: readonly PathSegment[]): string {
  return segments.map((s) => `/${String(s).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Reject accessors and non-plain arrays before any caller-overridable method is used. Cycles are visited once. */
export function hasUnsafeDataProperties(value: unknown, deep = false): boolean {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === null || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      const names = Object.getOwnPropertyNames(item);
      if (Object.getPrototypeOf(item) !== Array.prototype || Object.getOwnPropertySymbols(item).length > 0 || names.length !== item.length + 1 || names.some(key => key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) return true;
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
      if (!("value" in descriptor)) return true;
      if (deep) pending.push(descriptor.value);
    }
  }
  return false;
}

/**
 * Every reason `value` is not plain JSON data, in deterministic (depth-first, key-sorted) order. An empty list means
 * the value is safe to serialize, to copy and to compare by value.
 */
export function inspectPlainData(value: unknown, path: readonly PathSegment[] = []): PlainDataProblem[] {
  const problems: PlainDataProblem[] = [];
  const ancestors: object[] = [];

  const visit = (v: unknown, at: readonly PathSegment[]): void => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        problems.push({ kind: "NON_FINITE_NUMBER", path: jsonPointer(at), reason: `${String(v)} is not a finite number` });
      }
      return;
    }
    if (typeof v !== "object") {
      problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer(at), reason: `a ${typeof v} is not plain data` });
      return;
    }
    if (ancestors.includes(v)) {
      problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer(at), reason: "circular reference" });
      return;
    }
    if (Array.isArray(v)) {
      if (hasUnsafeDataProperties(v)) {
        problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer(at), reason: "accessors or non-plain array properties are not plain data" });
        return;
      }
      ancestors.push(v);
      for (let i = 0; i < v.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (descriptor === undefined) problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer([...at, i]), reason: "sparse array hole" });
        else if (!("value" in descriptor)) problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer([...at, i]), reason: "accessor properties are not plain data" });
        else visit(descriptor.value, [...at, i]);
      }
      ancestors.pop();
      return;
    }
    if (!isPlainObject(v)) {
      problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer(at), reason: "non-plain object is not plain data" });
      return;
    }
    if (Object.getOwnPropertySymbols(v).length > 0) {
      problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer(at), reason: "symbol-keyed properties are not plain data" });
    }
    ancestors.push(v);
    for (const key of Object.keys(v).sort()) {
      if (FORBIDDEN_OBJECT_KEYS.includes(key)) {
        problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer([...at, key]), reason: `the key "${key}" is not allowed` });
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (descriptor !== undefined && (descriptor.get !== undefined || descriptor.set !== undefined)) {
        problems.push({ kind: "NOT_PLAIN_DATA", path: jsonPointer([...at, key]), reason: "accessor properties are not plain data" });
        continue;
      }
      visit(v[key], [...at, key]);
    }
    ancestors.pop();
  };

  visit(value, path);
  return problems;
}

/**
 * A detached copy of already-inspected plain data, with object keys in sorted order and `-0` normalized to `0` (JSON
 * cannot represent `-0`, so keeping it would make an in-memory result and its serialized form disagree).
 */
export function clonePlainData<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return (typeof value === "number" && Object.is(value, -0) ? 0 : value) as T;
  }
  if (Array.isArray(value)) return value.map((item: unknown) => clonePlainData(item)) as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = clonePlainData((value as Record<string, unknown>)[key]);
  return out as T;
}

/** Recursively freezes plain data in place and returns it. Normalized contexts and results are immutable values. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Canonical JSON of plain data: object keys in code-unit order at every depth, arrays in their own order. Used to
 * compare two plain values for exact equality (a receipt's Ruleset provenance and Resource state), never to hash.
 */
export function canonicalJsonOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v: unknown) => canonicalJsonOf(v)).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonOf(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
