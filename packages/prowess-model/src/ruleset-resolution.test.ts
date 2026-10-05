import { describe, expect, it } from "vitest";
import {
  flattenInheritanceChain,
  RULESET_RESOLUTION_SOURCES,
  resolutionSourceForDepth,
  type InheritanceLevel,
} from "./ruleset-resolution.js";

// Entities / versions / manifests, as readable names.
const level = (manifestId: string, ...pins: Array<[string, string]>): InheritanceLevel => ({
  manifestId,
  pins: pins.map(([entityId, entityVersionId]) => ({ entityId, entityVersionId })),
});
const view = (results: ReturnType<typeof flattenInheritanceChain>) =>
  results
    .map((r) => `${r.entityId}->${r.entityVersionId}@${r.resolvedFromManifestId}/d${r.resolutionDepth}/${r.source}`)
    .sort();

describe("RULESET_RESOLUTION_SOURCES", () => {
  it("is exactly EXPLICIT and INHERITED, a domain-only distinction", () => {
    expect([...RULESET_RESOLUTION_SOURCES]).toEqual(["EXPLICIT", "INHERITED"]);
    expect(resolutionSourceForDepth(0)).toBe("EXPLICIT");
    expect(resolutionSourceForDepth(1)).toBe("INHERITED");
    expect(resolutionSourceForDepth(7)).toBe("INHERITED");
  });
});

describe("flattenInheritanceChain", () => {
  it("returns nothing for an empty chain and for a chain of empty manifests", () => {
    expect(flattenInheritanceChain([])).toEqual([]);
    expect(flattenInheritanceChain([level("C1"), level("P1")])).toEqual([]);
  });

  it("a manifest with no parent resolves only its own pins, all depth 0 EXPLICIT", () => {
    const out = flattenInheritanceChain([level("C1", ["A", "A1"], ["B", "B1"])]);
    expect(view(out)).toEqual(["A->A1@C1/d0/EXPLICIT", "B->B1@C1/d0/EXPLICIT"]);
    expect(out.every((r) => r.requestedManifestId === "C1")).toBe(true);
  });

  it("an explicit child pin overrides the inherited one; the rest is inherited at depth 1", () => {
    const out = flattenInheritanceChain([level("C1", ["A", "A2"]), level("P1", ["A", "A1"], ["B", "B1"])]);
    expect(view(out)).toEqual(["A->A2@C1/d0/EXPLICIT", "B->B1@P1/d1/INHERITED"]);
  });

  it("resolves across three levels: child > parent > grandparent, with the right depth and source for each", () => {
    // G1: A->A1, B->B1, C->C1   P1: B->B2   C1: C->C2
    const out = flattenInheritanceChain([
      level("C1", ["C", "C2"]),
      level("P1", ["B", "B2"]),
      level("G1", ["A", "A1"], ["B", "B1"], ["C", "C1"]),
    ]);
    expect(view(out)).toEqual(["A->A1@G1/d2/INHERITED", "B->B2@P1/d1/INHERITED", "C->C2@C1/d0/EXPLICIT"]);
  });

  it("the full spec fixture: G{A1,B1} P{B2,C1} C{C2,D1} -> A1, B2, C2, D1 with correct provenance", () => {
    const out = flattenInheritanceChain([
      level("C1", ["C", "C2"], ["D", "D1"]),
      level("P1", ["B", "B2"], ["C", "C1"]),
      level("G1", ["A", "A1"], ["B", "B1"]),
    ]);
    expect(view(out)).toEqual([
      "A->A1@G1/d2/INHERITED",
      "B->B2@P1/d1/INHERITED",
      "C->C2@C1/d0/EXPLICIT",
      "D->D1@C1/d0/EXPLICIT",
    ]);
  });

  it("contains at most one result per Entity — never both A1 and A2", () => {
    const out = flattenInheritanceChain([level("C1", ["A", "A3"]), level("P1", ["A", "A2"]), level("G1", ["A", "A1"])]);
    expect(out).toHaveLength(1);
    expect(out[0]?.entityVersionId).toBe("A3");
  });

  it("treats entity ids case-insensitively when deciding which level already answered", () => {
    const out = flattenInheritanceChain([level("C1", ["aaaa", "V2"]), level("P1", ["AAAA", "V1"])]);
    expect(out).toHaveLength(1);
    expect(out[0]?.entityVersionId).toBe("V2");
  });

  it("does not depend on the order pins are listed within a level, nor mutate its input", () => {
    const levels = [level("C1", ["B", "B2"], ["A", "A2"]), level("P1", ["A", "A1"], ["C", "C1"])];
    const frozen = JSON.stringify(levels);
    const forward = view(flattenInheritanceChain(levels));
    const reversed = view(flattenInheritanceChain([level("C1", ["A", "A2"], ["B", "B2"]), level("P1", ["C", "C1"], ["A", "A1"])]));
    expect(forward).toEqual(reversed);
    expect(JSON.stringify(levels)).toBe(frozen);
  });

  it("records the same requested manifest on every result, however deep the pin came from", () => {
    const out = flattenInheritanceChain([level("C9", ["A", "A1"]), level("P9", ["B", "B1"]), level("G9", ["C", "C1"])]);
    expect(new Set(out.map((r) => r.requestedManifestId))).toEqual(new Set(["C9"]));
    expect(out.map((r) => r.resolutionDepth).sort()).toEqual([0, 1, 2]);
  });
});
