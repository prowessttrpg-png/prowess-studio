import { isPlainObject } from "../internal/plain-data.js";
import { ORCHESTRATION_LIMITS } from "./model.js";

/**
 * RFC 6901 JSON Pointers for bindings (PAS-10 M4-WO10 §25–28, §91–97). `""` is the root. Tokens unescape `~1` → `/` and
 * `~0` → `~` (any other `~` is invalid); `__proto__`, `prototype` and `constructor` are rejected; array indexes are
 * canonical non-negative integers (no `-`, no leading zeros, no wildcard). Reads use OWN DATA properties only — a
 * getter is never invoked and nothing inherited is ever reached. No JSONPath, no query, no transform.
 */
const DANGEROUS: readonly string[] = ["__proto__", "prototype", "constructor"];
const INDEX = /^(0|[1-9][0-9]*)$/;

/** Parses a pointer into tokens, or null when it is not a safe pointer. */
export function parsePointer(pointer: unknown): string[] | null {
  if (typeof pointer !== "string" || pointer.length > ORCHESTRATION_LIMITS.MAX_POINTER_LENGTH) return null;
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  const raw = pointer.slice(1).split("/");
  if (raw.length > ORCHESTRATION_LIMITS.MAX_POINTER_TOKENS) return null;
  const tokens: string[] = [];
  for (const token of raw) {
    if (/~[^01]|~$/.test(token)) return null;
    const unescaped = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (DANGEROUS.includes(unescaped)) return null;
    tokens.push(unescaped);
  }
  return tokens;
}

/** One step into a container, own data properties only. */
function child(container: unknown, token: string): { found: true; value: unknown } | { found: false } {
  if (Array.isArray(container)) {
    if (!INDEX.test(token)) return { found: false };
    const index = Number(token);
    if (index >= container.length) return { found: false };
    const d = Object.getOwnPropertyDescriptor(container, token);
    return d !== undefined && "value" in d ? { found: true, value: d.value } : { found: false };
  }
  if (!isPlainObject(container)) return { found: false };
  const d = Object.getOwnPropertyDescriptor(container, token);
  return d !== undefined && "value" in d ? { found: true, value: d.value } : { found: false };
}

/**
 * Reads the exact value at `tokens`. `found: false` means the path does not exist; `found: true, value: null` means
 * it exists and holds null — the two are never confused.
 */
export function readAt(root: unknown, tokens: readonly string[]): { found: true; value: unknown } | { found: false } {
  let current: unknown = root;
  for (const token of tokens) {
    const next = child(current, token);
    if (!next.found) return next;
    current = next.value;
  }
  return { found: true, value: current };
}

/**
 * Whether `tokens` addresses a writable position in `template`: its parent exists and is an object (any own key may be
 * set) or an array (the index must already exist — no append, no holes).
 */
export function isWritableTarget(template: unknown, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const parent = readAt(template, tokens.slice(0, -1));
  if (!parent.found) return false;
  const last = tokens[tokens.length - 1] as string;
  if (Array.isArray(parent.value)) return INDEX.test(last) && Number(last) < parent.value.length;
  return isPlainObject(parent.value);
}

/** Writes `value` at `tokens` inside a DETACHED, mutable copy (the caller's template is never touched). */
export function writeAt(detached: unknown, tokens: readonly string[], value: unknown): void {
  const parent = readAt(detached, tokens.slice(0, -1)) as { found: true; value: Record<string, unknown> | unknown[] };
  const last = tokens[tokens.length - 1] as string;
  if (Array.isArray(parent.value)) parent.value[Number(last)] = value;
  else Object.defineProperty(parent.value, last, { value, enumerable: true, writable: true, configurable: true });
}

/** True when one target is the other or contains it (`/a` and `/a/b`). */
export function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
