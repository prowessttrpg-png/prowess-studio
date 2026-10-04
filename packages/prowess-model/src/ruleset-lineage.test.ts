import { describe, expect, it } from "vitest";
import { checkParentAssignment } from "./ruleset-lineage.js";

/** Builds a parentOf() from child -> parent pairs; anything absent is a root. */
const lineage = (pairs: Record<string, string | null>) => (id: string) => pairs[id] ?? null;

describe("checkParentAssignment (cycle detection)", () => {
  it("rejects a Ruleset parenting itself: A -> A", () => {
    expect(checkParentAssignment("A", "A", lineage({}))).toEqual({ kind: "self" });
  });

  it("rejects a two-node cycle: A parent B, then B parent A", () => {
    // B already has parent A; making B the parent of A closes the loop.
    expect(checkParentAssignment("A", "B", lineage({ B: "A" })).kind).toBe("cycle");
  });

  it("rejects a deeper cycle: chain A <- B <- C, then C as A's parent", () => {
    const parentOf = lineage({ B: "A", C: "B" });
    const result = checkParentAssignment("A", "C", parentOf);
    expect(result.kind).toBe("cycle");
    expect(result).toMatchObject({ path: ["C", "B", "A"] });
  });

  it("accepts a valid re-parenting that does not loop (C under A while B also under A)", () => {
    expect(checkParentAssignment("C", "A", lineage({ B: "A", C: "B" }))).toEqual({ kind: "ok" });
  });

  it("accepts a root parent and an unrelated chain", () => {
    expect(checkParentAssignment("X", "Y", lineage({}))).toEqual({ kind: "ok" });
    expect(checkParentAssignment("X", "Z", lineage({ Z: "Y", Y: "W" }))).toEqual({ kind: "ok" });
  });

  it("terminates (and refuses) when the data ALREADY contains a loop that does not involve the ruleset", () => {
    // P <-> Q is a pre-existing loop; attaching X beneath it must not spin forever.
    const result = checkParentAssignment("X", "P", lineage({ P: "Q", Q: "P" }));
    expect(result.kind).toBe("cycle");
  });

  it("handles a long chain without recursion limits", () => {
    const pairs: Record<string, string> = {};
    for (let i = 1; i < 5000; i += 1) pairs[`n${i}`] = `n${i - 1}`;
    expect(checkParentAssignment("n0", "n4999", lineage(pairs)).kind).toBe("cycle");
    expect(checkParentAssignment("fresh", "n4999", lineage(pairs)).kind).toBe("ok");
  });

  it("treats undefined like a root (parentOf may return undefined for unknown ids)", () => {
    expect(checkParentAssignment("A", "B", () => undefined)).toEqual({ kind: "ok" });
  });
});
