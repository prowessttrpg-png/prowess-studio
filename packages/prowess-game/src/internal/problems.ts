import { deepFreeze, inspectPlainData, jsonPointer, isPlainObject, hasUnsafeDataProperties, type PathSegment } from "./plain-data.js";

/**
 * Structured, deterministic problem reporting for @prowess/game (PAS-10 M5-WO1 §87, §144). Every pure-domain
 * validation returns an outcome — never throws for bad caller data — and every problem carries a namespaced code, an
 * RFC 6901 path and a message. Problems are reported in the order checks run, which is fixed by the code, so the same
 * input always yields the same list.
 */
export interface ProwessProblem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ProwessOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly ProwessProblem[] };

export class Problems {
  readonly list: ProwessProblem[] = [];
  get count(): number {
    return this.list.length;
  }
  add(code: string, at: readonly PathSegment[], message: string): void {
    this.list.push({ code, path: jsonPointer(at), message });
  }
}

export function finish<T>(p: Problems, build: () => T): ProwessOutcome<T> {
  if (p.count > 0) return deepFreeze({ ok: false as const, problems: p.list });
  return deepFreeze({ ok: true as const, value: build() });
}

/** Rejects non-plain data (getters, functions, cycles, unsafe keys, non-finite numbers) before anything reads it. */
export function checkPlainData(value: unknown, at: readonly PathSegment[], p: Problems, code: string): boolean {
  if (value !== null && typeof value === "object" && hasUnsafeDataProperties(value, true)) {
    p.add(code, at, "accessors, symbols or non-plain array properties are not plain data");
    return false;
  }
  const problems = inspectPlainData(value, at);
  for (const problem of problems) p.list.push({ code, path: problem.path, message: problem.reason });
  return problems.length === 0;
}

/** Reads an own data property without invoking any caller-overridable code. */
export function own(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

/** A plain object whose keys are all in `allowed` and that has every key in `required`. */
export function readRecord(
  value: unknown,
  at: readonly PathSegment[],
  p: Problems,
  code: string,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    p.add(code, at, "expected a plain object");
    return null;
  }
  let ok = true;
  for (const key of Object.keys(value).sort()) {
    if (!allowed.includes(key)) {
      p.add(code, [...at, key], `unknown field "${key}" (allowed: ${allowed.join(", ")})`);
      ok = false;
    }
  }
  for (const key of required) {
    if (own(value, key) === undefined) {
      p.add(code, [...at, key], `"${key}" is required`);
      ok = false;
    }
  }
  return ok ? value : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANONICAL_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const MAX_LABEL_LENGTH = 200;

/** Lowercase UUID only — exact identity is never case-folded or trimmed into shape. */
export const isExactUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const PROTOTYPE_SEGMENTS: readonly string[] = ["__proto__", "constructor", "prototype"];
/**
 * The @prowess/model canonical-key grammar, matched exactly (no case folding). A segment that names an object prototype
 * is never a key (the M4-WO1 prototype-safety policy), so a key can never address one when used as a context key.
 */
export const isExactCanonicalKey = (value: unknown): value is string =>
  typeof value === "string" && CANONICAL_KEY_PATTERN.test(value) && !value.split(".").some((segment) => PROTOTYPE_SEGMENTS.includes(segment));
/** A non-empty, untrimmed-free label (the @prowess/rules "exact label" rule). */
export const isExactLabel = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_LABEL_LENGTH && value.trim() === value;
/** A SCREAMING_SNAKE vocabulary token. */
export const isToken = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);

export function readEnum<T extends string>(value: unknown, allowed: readonly T[], at: readonly PathSegment[], p: Problems, code: string, what: string): T | null {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  p.add(code, at, `unknown ${what} ${JSON.stringify(value)} (known: ${allowed.join(", ")})`);
  return null;
}

export function readSafeInteger(value: unknown, at: readonly PathSegment[], p: Problems, code: string, what: string): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  p.add(code, at, `${what} must be an explicit safe integer`);
  return null;
}
