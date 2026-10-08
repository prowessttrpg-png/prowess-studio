import { DomainError, SOURCE_REFERENCE_ERROR_CODES } from "@prowess/model";
import { describe, expect, it } from "vitest";
import { mapSourceReferenceRemovalError } from "../../src/source-reference/removal-errors";

/** PAS-10 M2-WO12 F2: only the known evidence-reference refusal is translated; everything else fails closed. */
describe("mapSourceReferenceRemovalError", () => {
  const p2003 = (constraint: string) => Object.assign(new Error(`Foreign key constraint violated on the constraint: \`${constraint}\``), { code: "P2003", meta: { constraint } });

  it("maps a P2003 on rule_conflict_candidates_source_reference_fkey to SOURCE_REFERENCE.IN_USE", () => {
    const mapped = mapSourceReferenceRemovalError(p2003("rule_conflict_candidates_source_reference_fkey"), "ref-1");
    expect(mapped).toBeInstanceOf(DomainError);
    expect((mapped as DomainError).code).toBe(SOURCE_REFERENCE_ERROR_CODES.IN_USE);
  });
  it("returns any OTHER P2003, and any non-P2003 error, unchanged (generic 500 boundary)", () => {
    for (const e of [p2003("some_other_fkey"), Object.assign(new Error("x"), { code: "P2002" }), new Error("boom"), "weird", null]) {
      expect(mapSourceReferenceRemovalError(e, "ref-1")).toBe(e);
    }
  });
});
