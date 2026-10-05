import { describe, expect, it } from "vitest";
import { resolveAuthorityFromDeclarations, SOURCE_AUTHORITY_RESOLUTION_SOURCES } from "./source-authority-resolution.js";

const resolve = (requestedScopeKey: string, exact: Parameters<typeof resolveAuthorityFromDeclarations>[0]["exact"], global: Parameters<typeof resolveAuthorityFromDeclarations>[0]["global"]) =>
  resolveAuthorityFromDeclarations({ policyId: "P1", sourceDocumentId: "SA", requestedScopeKey, exact, global });

describe("SOURCE_AUTHORITY_RESOLUTION_SOURCES", () => {
  it("is exactly EXACT, GLOBAL_FALLBACK, UNRESOLVED — a domain-only distinction", () => {
    expect([...SOURCE_AUTHORITY_RESOLUTION_SOURCES]).toEqual(["EXACT", "GLOBAL_FALLBACK", "UNRESOLVED"]);
  });
});

describe("resolveAuthorityFromDeclarations (exact -> global -> UNRESOLVED, inside ONE policy)", () => {
  it("an exact declaration answers EXACT, and beats the global one", () => {
    expect(resolve("entity_type.spell_effect", "GOVERNING", "CURRENT_SUPPLEMENTAL")).toEqual({
      policyId: "P1",
      sourceDocumentId: "SA",
      requestedScopeKey: "entity_type.spell_effect",
      resolvedScopeKey: "entity_type.spell_effect",
      authorityStatus: "GOVERNING",
      source: "EXACT",
    });
  });

  it("with no exact declaration, a specific scope falls back to global — and says so", () => {
    expect(resolve("entity_type.skill", null, "CURRENT_SUPPLEMENTAL")).toMatchObject({
      resolvedScopeKey: "global",
      authorityStatus: "CURRENT_SUPPLEMENTAL",
      source: "GLOBAL_FALLBACK",
      requestedScopeKey: "entity_type.skill",
    });
  });

  it("a request for global itself answers EXACT, never GLOBAL_FALLBACK", () => {
    expect(resolve("global", "CURRENT_PRIMARY", null)).toMatchObject({ resolvedScopeKey: "global", source: "EXACT" });
  });

  it("with nothing declared, the answer is UNRESOLVED with no resolved scope", () => {
    expect(resolve("entity_type.skill", null, null)).toMatchObject({ resolvedScopeKey: null, authorityStatus: "UNRESOLVED", source: "UNRESOLVED" });
    expect(resolve("global", null, null)).toMatchObject({ resolvedScopeKey: null, authorityStatus: "UNRESOLVED", source: "UNRESOLVED" });
  });

  it("a request for global never consults the 'global' input as a fallback (it IS the exact lookup)", () => {
    // If only the fallback value were set, a global request must still be UNRESOLVED: nothing is declared at global.
    expect(resolve("global", null, "GOVERNING")).toMatchObject({ source: "UNRESOLVED", resolvedScopeKey: null });
  });

  it("a declaration that is itself UNRESOLVED still counts as the exact answer and blocks the global fallback", () => {
    expect(resolve("entity_type.skill", "UNRESOLVED", "GOVERNING")).toMatchObject({ source: "EXACT", authorityStatus: "UNRESOLVED", resolvedScopeKey: "entity_type.skill" });
  });

  it("every status in the vocabulary round-trips through EXACT unchanged (no ranking, no reinterpretation)", () => {
    for (const status of ["GOVERNING", "CURRENT_PRIMARY", "CURRENT_SUPPLEMENTAL", "PLAYTEST_REFERENCE", "HISTORICAL", "SUPERSEDED", "REFERENCE_ONLY", "UNRESOLVED"] as const) {
      expect(resolve("global", status, null).authorityStatus).toBe(status);
    }
  });
});
