import { describe, expect, it } from "vitest";
import { CanonicalKey, isValidCanonicalKey } from "./canonical-key.js";

describe("isValidCanonicalKey", () => {
  it.each([
    "stat.strength",
    "skill.arcana",
    "resource.mana_efficiency",
    "spell.effect.damage.direct",
    "a.b.c.d.e",
    "resource123.value_2",
  ])("accepts %s", (value) => {
    expect(isValidCanonicalKey(value)).toBe(true);
  });

  it.each([
    ["Direct Damage", "spaces and uppercase"],
    ["Spell Effect Damage", "spaces and uppercase"],
    ["SPELL.DAMAGE", "uppercase"],
    ["spell..damage", "empty segment (double separator)"],
    ["spell", "single segment — not namespace-aware"],
    [".spell.damage", "leading separator"],
    ["spell.damage.", "trailing separator"],
    ["spell.dam age", "embedded space"],
    ["spell.dam-age", "hyphen not a permitted character"],
    ["", "empty string"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidCanonicalKey(value)).toBe(false);
  });
});

describe("CanonicalKey.parse", () => {
  it("returns the value, branded, for a valid key", () => {
    expect(CanonicalKey.parse("stat.strength")).toBe("stat.strength");
  });

  it("throws a TypeError for an invalid key", () => {
    expect(() => CanonicalKey.parse("Not Valid")).toThrow(TypeError);
  });
});
