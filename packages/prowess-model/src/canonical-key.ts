/**
 * Canonical-key validation (PAS-10 M1-WO1 §5).
 *
 * A canonical key is the stable, machine-readable identity string for an
 * Entity — e.g. `spell.effect.damage.direct`, `resource.mana_efficiency`,
 * `stat.strength`. It must never encode a version number, a source
 * document location, a page number, or a book chapter: changing visible
 * terminology in the future must never require changing a canonical key,
 * and changing a canonical key must never be how content gets versioned —
 * that's what `EntityVersion` (M1-WO2) is for.
 *
 * Shape: two or more lowercase, alphanumeric-and-underscore segments,
 * separated by single periods — `segment.segment` at minimum, with as many
 * further `.segment`s as a namespace needs. Deliberately unopinionated
 * about *which* namespaces exist (no subsystem names are hardcoded here) —
 * only the grammar is enforced, so future namespaces (stat.*, skill.*,
 * race.*, ...) need no change to this file.
 */

const CANONICAL_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

/**
 * Whether `value` is a syntactically valid canonical key. Pure shape
 * validation only — it says nothing about whether the key is actually
 * registered to an Entity (see `@prowess/db`'s
 * `findEntityByCanonicalKey`).
 *
 * Rejects (non-exhaustive — see the test suite for the full matrix):
 *   - "Direct Damage"        (spaces, uppercase)
 *   - "SPELL.DAMAGE"         (uppercase)
 *   - "spell..damage"        (empty segment)
 *   - "spell"                (single segment — not namespace-aware)
 *   - ".spell.damage" / "spell.damage."  (leading/trailing separator)
 */
export function isValidCanonicalKey(value: string): boolean {
  return CANONICAL_KEY_PATTERN.test(value);
}

/** A canonical key, branded once validated — see `CanonicalKey.parse`. */
declare const canonicalKeyBrand: unique symbol;
export type CanonicalKey = string & { readonly [canonicalKeyBrand]: "CanonicalKey" };

export const CanonicalKey = {
  /**
   * Validates and brands `value`, throwing if it isn't a syntactically
   * valid canonical key. Prefer this at domain/application boundaries over
   * calling `isValidCanonicalKey` and casting by hand.
   */
  parse(value: string): CanonicalKey {
    if (!isValidCanonicalKey(value)) {
      throw new TypeError(`Not a valid canonical key: ${JSON.stringify(value)}`);
    }
    return value as CanonicalKey;
  },
};
