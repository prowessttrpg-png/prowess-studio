import { describe, expect, it } from "vitest";
import { PROWESS_DEFINITION_KINDS } from "./index.js";
import { EQUIPMENT_PAYLOAD_KINDS } from "./definition/equipment-payload.js";
import certified from "./testing/m6-wo6-registry-baseline.json";

/**
 * PAS-10 M6-WO6 §6–§7 — registry change guard. Every Prowess Definition kind specification that existed at the M6-WO6
 * base commit (M6-WO5 merged) is byte-for-byte equal to its certified form (src/testing/m6-wo6-registry-baseline.json)
 * EXCEPT the three approved changes: WEAPON reserved → v1, EQUIPMENT_TRAIT reserved → v1 and the new ATTACK (EQUIPMENT
 * family, GENERIC_RULE, v1). ARMOR stays reserved. Invariants: M6-I057, M6-I064.
 */
const baseline = certified as unknown as {
  baseCommit: string;
  kinds: Record<string, { family: string; branch: string | null; contract: string | null; entityTypes: string[]; schemaVersions: number[] }>;
};
const current = JSON.parse(JSON.stringify(PROWESS_DEFINITION_KINDS)) as typeof baseline.kinds;

describe("M6-WO6 registry characterization (§6–§7)", () => {
  it("is pinned to the M6-WO6 base commit and the 42 certified pre-WO6 kinds", () => {
    expect(baseline.baseCommit).toBe("3cedeab83bb3890bc5b7cc4855b37e9e946094d9");
    expect(Object.keys(baseline.kinds)).toHaveLength(42);
  });

  it("every pre-WO6 kind except WEAPON and EQUIPMENT_TRAIT is byte-for-byte unchanged — ARMOR stays reserved", () => {
    for (const [kind, spec] of Object.entries(baseline.kinds)) {
      if (kind === "WEAPON" || kind === "EQUIPMENT_TRAIT") continue;
      expect(JSON.stringify(current[kind]), kind).toBe(JSON.stringify(spec));
    }
    expect(current.ARMOR).toEqual({ family: "EQUIPMENT", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [] });
  });

  it("WEAPON and EQUIPMENT_TRAIT change ONLY from reserved ([]) to schema version 1", () => {
    for (const kind of ["WEAPON", "EQUIPMENT_TRAIT"]) {
      expect(baseline.kinds[kind]!.schemaVersions, kind).toEqual([]);
      expect(current[kind], kind).toEqual({ ...baseline.kinds[kind], schemaVersions: [1] });
    }
  });

  it("the only new kind is ATTACK: EQUIPMENT family, no shared contract, GENERIC_RULE storage, v1", () => {
    expect(Object.keys(current).filter((k) => !(k in baseline.kinds))).toEqual(["ATTACK"]);
    expect(current.ATTACK).toEqual({ family: "EQUIPMENT", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(Object.keys(baseline.kinds).filter((k) => !(k in current))).toEqual([]);
    expect([...EQUIPMENT_PAYLOAD_KINDS]).toEqual(["WEAPON", "ATTACK", "EQUIPMENT_TRAIT"]);
  });
});
