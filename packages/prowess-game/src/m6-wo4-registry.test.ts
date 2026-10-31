import { describe, expect, it } from "vitest";
import { PROWESS_DEFINITION_KINDS } from "./index.js";
import { ADVANCEMENT_PAYLOAD_KINDS } from "./definition/advancement-payload.js";
import certified from "./testing/m6-wo4-registry-baseline.json";

/**
 * PAS-10 M6-WO4 — registry change guard. Every Prowess Definition kind specification that existed at the M6-WO4 base
 * commit (after M6-WO3) is byte-for-byte equal to its certified form (src/testing/m6-wo4-registry-baseline.json); the
 * ONLY change is the new CHARACTER_ADVANCEMENT_RULE (CHARACTER family, v1). The Character Die and Affinity progression
 * kinds are untouched — WO4 never duplicates them. Invariants: M6-I033, M6-I038.
 */
const baseline = certified as unknown as {
  baseCommit: string;
  kinds: Record<string, { family: string; branch: string | null; contract: string | null; entityTypes: string[]; schemaVersions: number[] }>;
};
const current = JSON.parse(JSON.stringify(PROWESS_DEFINITION_KINDS)) as typeof baseline.kinds;

describe("M6-WO4 registry characterization", () => {
  it("is pinned to the M6-WO4 base commit and the 41 certified pre-WO4 kinds", () => {
    expect(baseline.baseCommit).toBe("77f9430f68caf60babfb0c54496090d5ace11f86");
    expect(Object.keys(baseline.kinds)).toHaveLength(41);
  });

  it("every pre-WO4 kind is byte-for-byte unchanged (CHARACTER_DIE_PROGRESSION and AFFINITY_PROGRESSION included)", () => {
    for (const [kind, spec] of Object.entries(baseline.kinds)) expect(JSON.stringify(current[kind]), kind).toBe(JSON.stringify(spec));
    expect(Object.keys(baseline.kinds).filter((k) => !(k in current))).toEqual([]);
  });

  it("the only new kind is CHARACTER_ADVANCEMENT_RULE: CHARACTER family, no shared contract, v1", () => {
    expect(Object.keys(current).filter((k) => !(k in baseline.kinds))).toEqual(["CHARACTER_ADVANCEMENT_RULE"]);
    expect(current.CHARACTER_ADVANCEMENT_RULE).toEqual({ family: "CHARACTER", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect([...ADVANCEMENT_PAYLOAD_KINDS]).toEqual(["CHARACTER_ADVANCEMENT_RULE"]);
  });
});
