import { describe, expect, it } from "vitest";
import {
  isValidEntityAlias,
  MAX_ENTITY_ALIAS_LENGTH,
  normalizeEntityAlias,
} from "./entity-alias.js";
import { EntityAliasId } from "./ids.js";

describe("normalizeEntityAlias", () => {
  it("matches the exact example from the spec", () => {
    expect(normalizeEntityAlias("  Direct   Damage ")).toBe("direct damage");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeEntityAlias("  Ward  ")).toBe("ward");
  });

  it("collapses repeated internal whitespace to a single space", () => {
    expect(normalizeEntityAlias("Silver    Company")).toBe("silver company");
    expect(normalizeEntityAlias("Silver\t\tCompany")).toBe("silver company");
    expect(normalizeEntityAlias("Silver\n\nCompany")).toBe("silver company");
  });

  it("lowercases using locale-aware case folding", () => {
    expect(normalizeEntityAlias("EMISSION")).toBe("emission");
    expect(normalizeEntityAlias("Evocation")).toBe("evocation");
  });

  it("lowercases using locale-INDEPENDENT Unicode casing, not the host's default locale", () => {
    // normalizeEntityAlias's output is a persisted database lookup/
    // uniqueness key, so it must be identical regardless of which locale
    // the host JS runtime happens to default to. The classic example:
    // Turkish locale lowercases "I" to "ı" (dotless i, U+0131) instead of
    // the ASCII "i" every other locale produces — if normalizeEntityAlias
    // ever used `.toLocaleLowerCase()` with no explicit locale, the same
    // alias text could normalize differently on a Turkish-locale host than
    // on any other host, silently breaking lookup/duplicate-detection
    // across environments. This asserts our actual (locale-independent)
    // output, AND explicitly contrasts it against the known Turkish-locale
    // result to prove the two genuinely differ — i.e. that this isn't an
    // accidental non-difference on whatever locale this test happens to
    // run under.
    expect(normalizeEntityAlias("I")).toBe("i");
    expect(normalizeEntityAlias("DIRECT DAMAGE")).toBe("direct damage");

    const turkishLocaleResult = "I".toLocaleLowerCase("tr-TR");
    expect(turkishLocaleResult).not.toBe(normalizeEntityAlias("I"));
    expect(turkishLocaleResult).toBe("ı");
  });

  it("preserves Unicode characters rather than stripping or transliterating them", () => {
    // Accented Latin.
    expect(normalizeEntityAlias("Ménage")).toBe("ménage");
    // Non-Latin script (Japanese) — case folding is a no-op, but the
    // characters themselves must survive untouched.
    expect(normalizeEntityAlias("　魔法　")).toBe("魔法");
    // Cyrillic.
    expect(normalizeEntityAlias("  Огонь  ")).toBe("огонь");
  });

  it("normalizes combining-character sequences to their precomposed NFC form", () => {
    const decomposed = "e\u0301"; // "e" + combining acute accent
    const precomposed = "\u00e9"; // "é" as a single codepoint
    expect(normalizeEntityAlias(decomposed)).toBe(normalizeEntityAlias(precomposed));
  });

  it("does not collapse visually-distinct full-width characters the way NFKC would", () => {
    // A deliberate NFC-vs-NFKC check: NFKC would fold "Ａ" (fullwidth A,
    // U+FF21) down to ASCII "A"; NFC leaves it as its own distinct
    // character (just lowercased). This confirms the conservative choice
    // documented in entity-alias.ts's doc comment is actually in effect.
    const fullwidthA = "\uFF21";
    expect(normalizeEntityAlias(fullwidthA)).not.toBe("a");
  });

  it("is idempotent — normalizing an already-normalized value changes nothing", () => {
    const once = normalizeEntityAlias("  Direct   Damage ");
    expect(normalizeEntityAlias(once)).toBe(once);
  });
});

describe("isValidEntityAlias", () => {
  it.each([
    "Direct Damage",
    "Ward",
    "O'Brien's Blessing",
    "Silver Company (Mercenaries)",
    "Attack-of-Opportunity",
    "魔法",
  ])("accepts %j", (value) => {
    expect(isValidEntityAlias(value)).toBe(true);
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["\t\n", "tabs/newlines only"],
    [undefined, "undefined"],
    [null, "null"],
    [42, "a number"],
  ] as Array<[unknown, string]>)("rejects %j (%s)", (value) => {
    expect(isValidEntityAlias(value)).toBe(false);
  });

  it(`rejects an alias longer than ${MAX_ENTITY_ALIAS_LENGTH} characters`, () => {
    const tooLong = "a".repeat(MAX_ENTITY_ALIAS_LENGTH + 1);
    expect(isValidEntityAlias(tooLong)).toBe(false);
  });

  it(`accepts an alias exactly ${MAX_ENTITY_ALIAS_LENGTH} characters long`, () => {
    const exact = "a".repeat(MAX_ENTITY_ALIAS_LENGTH);
    expect(isValidEntityAlias(exact)).toBe(true);
  });
});

describe("EntityAliasId", () => {
  it("brands a UUID string without changing its runtime representation", () => {
    const id = EntityAliasId.of("33333333-3333-3333-3333-333333333333");
    expect(id).toBe("33333333-3333-3333-3333-333333333333");
  });
});
