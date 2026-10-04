import { describe, expect, it } from "vitest";
import { isValidKeywordName, MAX_KEYWORD_NAME_LENGTH } from "./keyword-definition.js";
import { KeywordCategoryId, KeywordDefinitionId } from "./ids.js";

describe("isValidKeywordName", () => {
  it.each(["Damage", "Fire", "Sustained (Zone)", "Mage's Art"])("accepts %j", (value) => {
    expect(isValidKeywordName(value)).toBe(true);
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    [undefined, "undefined"],
    [null, "null"],
    [42, "a number"],
  ] as Array<[unknown, string]>)("rejects %j (%s)", (value) => {
    expect(isValidKeywordName(value)).toBe(false);
  });

  it(`rejects a name longer than ${MAX_KEYWORD_NAME_LENGTH} characters`, () => {
    expect(isValidKeywordName("a".repeat(MAX_KEYWORD_NAME_LENGTH + 1))).toBe(false);
  });

  it(`accepts a name exactly ${MAX_KEYWORD_NAME_LENGTH} characters long`, () => {
    expect(isValidKeywordName("a".repeat(MAX_KEYWORD_NAME_LENGTH))).toBe(true);
  });
});

describe("KeywordCategoryId / KeywordDefinitionId", () => {
  it("brand UUID strings without changing their runtime representation", () => {
    expect(KeywordCategoryId.of("44444444-4444-4444-4444-444444444444")).toBe(
      "44444444-4444-4444-4444-444444444444",
    );
    expect(KeywordDefinitionId.of("55555555-5555-5555-5555-555555555555")).toBe(
      "55555555-5555-5555-5555-555555555555",
    );
  });
});
