import { isValidCanonicalKey } from "./canonical-key.js";

/**
 * The scope of a source-authority declaration (PAS-10 M2-WO4 §8-§9).
 *
 * Source authority can differ by rules domain: a document may be the general
 * authority for a Ruleset (`global`) yet GOVERNING for one narrower domain
 * (`entity_type.spell_effect`). A scope key is machine-readable text — it is not
 * a page or document position, and it never encodes an EntityVersion id.
 *
 * Why this is not just `isValidCanonicalKey`: the canonical-key grammar demands at
 * least two dot-separated segments, so the single word `global` fails it. Rather
 * than weaken CanonicalKey for everyone, this validator accepts exactly two shapes:
 *
 *   - the literal `global`, and
 *   - any value `isValidCanonicalKey` accepts (e.g. `entity_type.spell_effect`,
 *     `magic.spellcasting`, `world.lore`) — so dotted scopes reuse the existing
 *     grammar and there is still no second one.
 *
 * Two structural guards keep positions and ids out: a segment may not be purely
 * numeric (`page.12`) or a 32-character hex string (a hyphen-less id). The scope
 * taxonomy itself is deliberately NOT hard-coded here; later work defines it.
 */
export const GLOBAL_SOURCE_AUTHORITY_SCOPE = "global";
export const MAX_SOURCE_AUTHORITY_SCOPE_KEY_LENGTH = 200;

const NUMERIC_SEGMENT = /^[0-9]+$/;
const HEX_ID_SEGMENT = /^[0-9a-f]{32}$/;

export function isValidSourceAuthorityScopeKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SOURCE_AUTHORITY_SCOPE_KEY_LENGTH) {
    return false;
  }
  if (value === GLOBAL_SOURCE_AUTHORITY_SCOPE) {
    return true;
  }
  if (!isValidCanonicalKey(value)) {
    return false;
  }
  return value.split(".").every((segment) => !NUMERIC_SEGMENT.test(segment) && !HEX_ID_SEGMENT.test(segment));
}
