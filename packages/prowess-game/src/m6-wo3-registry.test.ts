import { describe, expect, it } from "vitest";
import { PROWESS_DEFINITION_KINDS } from "./index.js";
import { SKILL_RANK_LADDER_KEY } from "./index.js";
import { CHARACTER_PAYLOAD_KINDS } from "./definition/character-payload.js";
import certified from "./testing/m6-wo3-registry-baseline.json";

/**
 * PAS-10 M6-WO3 §84 — registry change guard. Every Prowess Definition kind specification that existed at the M6-WO3
 * base commit is byte-for-byte equal to its certified form (src/testing/m6-wo3-registry-baseline.json) EXCEPT the
 * three approved changes: ANCESTRY reserved → v1, SKILL reserved → v1, and the new CHARACTER_CREATION_RULE (CHARACTER
 * family, v1). Any other registry change fails here. Invariant: M6-I029.
 */
const baseline = certified as unknown as {
  baseCommit: string;
  kinds: Record<string, { family: string; branch: string | null; contract: string | null; entityTypes: string[]; schemaVersions: number[] }>;
};
const current = JSON.parse(JSON.stringify(PROWESS_DEFINITION_KINDS)) as typeof baseline.kinds;

describe("M6-WO3 registry characterization (§10, §84)", () => {
  it("is pinned to the M6-WO3 base commit and the certified 40 pre-WO3 kinds", () => {
    expect(baseline.baseCommit).toBe("89b0834020dcdc6f8ffc9a1483eeb871b5625077");
    expect(Object.keys(baseline.kinds)).toHaveLength(40);
  });

  it("every pre-WO3 kind except ANCESTRY and SKILL is byte-for-byte unchanged", () => {
    for (const [kind, spec] of Object.entries(baseline.kinds)) {
      if (kind === "ANCESTRY" || kind === "SKILL") continue;
      expect(JSON.stringify(current[kind]), kind).toBe(JSON.stringify(spec));
    }
  });

  it("ANCESTRY and SKILL change ONLY from reserved ([]) to schema version 1", () => {
    for (const kind of ["ANCESTRY", "SKILL"]) {
      const before = baseline.kinds[kind]!;
      expect(before.schemaVersions, kind).toEqual([]);
      expect(current[kind], kind).toEqual({ ...before, schemaVersions: [1] });
    }
  });

  it("the only new kind is CHARACTER_CREATION_RULE: CHARACTER family, no shared contract, v1", () => {
    // Kinds added by LATER Work Orders are characterized by their own registry tests (M6-WO4: m6-wo4-registry.test.ts).
    const later = ["CHARACTER_ADVANCEMENT_RULE"];
    const added = Object.keys(current).filter((k) => !(k in baseline.kinds) && !later.includes(k));
    expect(added).toEqual(["CHARACTER_CREATION_RULE"]);
    expect(current.CHARACTER_CREATION_RULE).toEqual({ family: "CHARACTER", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(Object.keys(baseline.kinds).filter((k) => !(k in current))).toEqual([]);
  });

  it("the character payload readers cover exactly the three activated kinds; Skill ranks reuse the certified ladder", () => {
    expect([...CHARACTER_PAYLOAD_KINDS].sort()).toEqual(["ANCESTRY", "CHARACTER_CREATION_RULE", "SKILL"]);
    expect(SKILL_RANK_LADDER_KEY).toBe("SKILL");
  });
});
