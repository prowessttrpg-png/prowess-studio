/**
 * Deterministic canonical JSON (PAS-10 M3-WO2) — the serialization every import fingerprint hashes.
 *
 * Rules (documented, versioned with the fingerprint formats):
 *   - object keys are sorted recursively by UTF-16 code unit (`<` comparison) — no locale, no collation;
 *   - array order is preserved (a reordered array is different content);
 *   - strings are emitted exactly as JSON.stringify escapes them — no trimming, no case folding, and NO Unicode
 *     normalization (NFC / NFKC): "é" precomposed and "e + combining accent" are different content;
 *   - numbers are emitted as JSON.stringify emits them (so 1, 1.0 and 1e0 are the same number; -0 is emitted as 0);
 *     NaN / Infinity are not JSON and are rejected;
 *   - explicit null is preserved and is distinct from an absent key;
 *   - `undefined`, functions, symbols, bigint, and non-plain objects (Date, Map, class instances) are rejected
 *     rather than silently dropped or coerced, so two callers cannot disagree about what was hashed.
 * No whitespace is emitted.
 */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function canonicalJson(value: unknown): string {
  return serialize(value, "$");
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path}: ${String(value)} is not a JSON number`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v, i) => serialize(v, `${path}[${i}]`)).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new CanonicalJsonError(`${path}: only plain objects are JSON objects`);
      }
      const entries = Object.keys(value as Record<string, unknown>)
        .sort(compareKeys)
        .map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key], `${path}.${key}`)}`);
      return `{${entries.join(",")}}`;
    }
    default:
      throw new CanonicalJsonError(`${path}: ${typeof value} is not a JSON value`);
  }
}

/** Parses then re-serializes: the canonical form of an already-JSON string. */
export function canonicalizeJsonText(text: string): string {
  return canonicalJson(JSON.parse(text) as unknown);
}
