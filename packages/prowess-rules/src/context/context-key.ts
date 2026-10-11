import { FORBIDDEN_OBJECT_KEYS } from "../internal/plain-data.js";

/**
 * The grammar of every caller-chosen key inside an evaluation context: stat / rank / resource / property keys,
 * keyword and tag keys, component and effect keys, evaluation kinds, trace step keys and unit labels.
 *
 * One or more lowercase alphanumeric-or-underscore segments separated by single periods: `power`, `stat.power`,
 * `resource.primary`, `keyword.fire`. Looser than a canonical key (a single segment is allowed) because a context key
 * names a slot in caller-supplied data, not an Entity. The grammar is generic on purpose: no Prowess stat, resource or
 * keyword is known to the engine (PAS-10 M4-WO1 §11, §46). `__proto__`, `constructor` and `prototype` are rejected so a
 * keyed collection can never reach an object prototype.
 */
export const CONTEXT_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** Upper bound on a context key's length — a structural sanity limit, not a semantic one. */
export const MAX_CONTEXT_KEY_LENGTH = 200;

export function isValidContextKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_CONTEXT_KEY_LENGTH &&
    CONTEXT_KEY_PATTERN.test(value) &&
    !FORBIDDEN_OBJECT_KEYS.includes(value)
  );
}
