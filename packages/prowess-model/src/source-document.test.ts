import { describe, expect, it } from "vitest";
import {
  isValidSourceDocumentTitle,
  MAX_SOURCE_DOCUMENT_TITLE_LENGTH,
} from "./source-document.js";
import { SourceDocumentId, SourceReferenceId } from "./ids.js";

describe("isValidSourceDocumentTitle", () => {
  it.each([
    "Test Spellcasting Source",
    "Core Playtest Spellcasting",
    "Appendix A: Modular Spell Design",
  ])("accepts %j", (value) => {
    expect(isValidSourceDocumentTitle(value)).toBe(true);
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    [undefined, "undefined"],
    [null, "null"],
    [42, "a number"],
  ] as Array<[unknown, string]>)("rejects %j (%s)", (value) => {
    expect(isValidSourceDocumentTitle(value)).toBe(false);
  });

  it(`rejects a title longer than ${MAX_SOURCE_DOCUMENT_TITLE_LENGTH} characters`, () => {
    expect(isValidSourceDocumentTitle("a".repeat(MAX_SOURCE_DOCUMENT_TITLE_LENGTH + 1))).toBe(
      false,
    );
  });

  it(`accepts a title exactly ${MAX_SOURCE_DOCUMENT_TITLE_LENGTH} characters long`, () => {
    expect(isValidSourceDocumentTitle("a".repeat(MAX_SOURCE_DOCUMENT_TITLE_LENGTH))).toBe(true);
  });
});

describe("SourceDocumentId / SourceReferenceId", () => {
  it("brand UUID strings without changing their runtime representation", () => {
    expect(SourceDocumentId.of("77777777-7777-7777-7777-777777777777")).toBe(
      "77777777-7777-7777-7777-777777777777",
    );
    expect(SourceReferenceId.of("88888888-8888-8888-8888-888888888888")).toBe(
      "88888888-8888-8888-8888-888888888888",
    );
  });
});
