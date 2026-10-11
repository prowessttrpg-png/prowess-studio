/**
 * Canonical JSON for plain Rules Engine data: object keys sorted by UTF-16 code unit, arrays in their given order, no
 * insignificant whitespace, `-0` written as `0`.
 *
 * A deliberately tiny, independent implementation (PAS-10 M4-WO1 §43). @prowess/import already has canonical JSON for
 * M3, but @prowess/rules must not depend on the import layer, and no cross-domain consumer yet justifies moving that
 * helper into a lower shared package. Internal: used by the determinism test helper, not part of the public surface.
 * M4-WO1 introduces no evaluation fingerprint (§42) — nothing consumes one yet.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: a ${typeof value} is not plain data`);
  }
}
