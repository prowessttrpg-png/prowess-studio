/**
 * The one shared serialization helper for every API response (PAS-10
 * M1-WO8 §31). Recursively converts every `Date` instance to an ISO 8601
 * string and leaves everything else untouched — branded domain id types
 * (`EntityId`, `KeywordDefinitionId`, etc.) are already plain strings at
 * runtime, so they need no special handling; JSON fields
 * (`structuredData`, relationship `metadata`) are already JSON-safe plain
 * values and pass straight through.
 *
 * Deliberately one generic function rather than a hand-written serializer
 * per domain type (`serializeEntity`, `serializeEntityVersion`, ...): with
 * ~10 different response shapes (including nested ones like `{ entity,
 * latestRevision }` or `{ relationship, counterpart }`), a generic
 * recursive walk is both less code and less risk of a typo silently
 * dropping or mis-naming a field — every route gets the exact same,
 * verified-by-construction behavior.
 *
 * Recurses into plain objects and arrays only; a `Date` is detected and
 * converted before the generic-object branch would otherwise try to
 * recurse into its own internal fields.
 */
export function serializeForApi<T>(value: T): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeForApi(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = serializeForApi(nested);
    }
    return result;
  }
  return value;
}
