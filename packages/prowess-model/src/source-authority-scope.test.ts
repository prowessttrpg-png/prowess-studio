import { describe, expect, it } from "vitest";
import { isValidCanonicalKey } from "./canonical-key.js";
import {
  GLOBAL_SOURCE_AUTHORITY_SCOPE,
  isValidSourceAuthorityScopeKey,
  MAX_SOURCE_AUTHORITY_SCOPE_KEY_LENGTH,
} from "./source-authority-scope.js";

describe("isValidSourceAuthorityScopeKey", () => {
  it("accepts the literal 'global' — which the canonical-key grammar alone rejects", () => {
    expect(GLOBAL_SOURCE_AUTHORITY_SCOPE).toBe("global");
    expect(isValidCanonicalKey("global")).toBe(false); // why a narrow validator exists at all
    expect(isValidSourceAuthorityScopeKey("global")).toBe(true);
  });

  it.each(["entity_type.spell_effect", "entity_type.skill", "magic.spellcasting", "world.lore", "a.b.c_d.e1"])(
    "accepts the dotted canonical-key shape %s (reusing the existing grammar)",
    (key) => {
      expect(isValidCanonicalKey(key)).toBe(true);
      expect(isValidSourceAuthorityScopeKey(key)).toBe(true);
    },
  );

  it.each(["Global", "GLOBAL", " global", "global ", "single", "entity type.spell", "entity-type.spell", "a..b", ".a", "a.", "", "a.B"])(
    "rejects %j",
    (key) => {
      expect(isValidSourceAuthorityScopeKey(key)).toBe(false);
    },
  );

  it("rejects page / document positions: a purely numeric segment", () => {
    for (const key of ["page.12", "source.12", "ch.3.p.44", "12.page"]) expect(isValidSourceAuthorityScopeKey(key), key).toBe(false);
  });

  it("rejects anything that encodes an id: a 32-hex segment, or a hyphenated UUID", () => {
    expect(isValidSourceAuthorityScopeKey("entity_version.0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isValidSourceAuthorityScopeKey("entity_version.11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("accepts a segment that merely CONTAINS digits (5e, v2, p12 are taxonomy words, not positions)", () => {
    for (const key of ["edition.5e", "rules.v2", "magic.tier_3"]) expect(isValidSourceAuthorityScopeKey(key), key).toBe(true);
  });

  it("rejects non-strings and over-long keys", () => {
    for (const value of [null, undefined, 5, {}, ["global"]]) expect(isValidSourceAuthorityScopeKey(value)).toBe(false);
    expect(isValidSourceAuthorityScopeKey(`a.${"b".repeat(MAX_SOURCE_AUTHORITY_SCOPE_KEY_LENGTH)}`)).toBe(false);
  });
});
