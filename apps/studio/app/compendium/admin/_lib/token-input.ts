/**
 * RULES-WO1: authors type names in plain words; the stored token is derived as they type ("Tier 1" → "TIER_1").
 * The result is shown in the field itself, so nothing is set silently, and an already-valid token is left unchanged.
 * Trailing separators are kept while typing (so a space can be followed by the next word) and trimmed on blur.
 */
export function asToken(typed: string, final = false): string {
  const t = typed.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+/, "");
  return final ? t.replace(/_+$/, "") : t;
}
