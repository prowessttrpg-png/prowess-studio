import { describe, expect, it } from "vitest";
import { isSourceDocumentType, SOURCE_DOCUMENT_TYPES } from "./source-document-type.js";
import { isSourceAuthorityStatus, SOURCE_AUTHORITY_STATUSES } from "./source-authority-status.js";

describe("SourceDocumentType", () => {
  it.each(SOURCE_DOCUMENT_TYPES)("accepts %s as a valid SourceDocumentType", (value) => {
    expect(isSourceDocumentType(value)).toBe(true);
  });

  it.each(["document", "", "PDF", "DOCX"])("rejects %s", (value) => {
    expect(isSourceDocumentType(value)).toBe(false);
  });

  it("is exactly DOCUMENT, WEB, and OTHER — no more, no fewer", () => {
    expect([...SOURCE_DOCUMENT_TYPES].sort()).toEqual(["DOCUMENT", "OTHER", "WEB"].sort());
  });
});

describe("SourceAuthorityStatus", () => {
  it.each(SOURCE_AUTHORITY_STATUSES)("accepts %s as a valid SourceAuthorityStatus", (value) => {
    expect(isSourceAuthorityStatus(value)).toBe(true);
  });

  it.each(["governing", "", "ACTIVE", "DRAFT"])("rejects %s", (value) => {
    expect(isSourceAuthorityStatus(value)).toBe(false);
  });

  it("includes the complete PAS-08 Canon Manager authority vocabulary", () => {
    const required = [
      "GOVERNING",
      "CURRENT_PRIMARY",
      "CURRENT_SUPPLEMENTAL",
      "PLAYTEST_REFERENCE",
      "HISTORICAL",
      "SUPERSEDED",
      "REFERENCE_ONLY",
      "UNRESOLVED",
    ];
    expect([...SOURCE_AUTHORITY_STATUSES].sort()).toEqual(required.sort());
  });
});
