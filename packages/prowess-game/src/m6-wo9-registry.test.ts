import { describe, expect, it } from "vitest";
import { PROWESS_DEFINITION_KINDS } from "./index.js";
import { ACTION_IMPROVEMENT_PAYLOAD_KINDS } from "./definition/action-improvement-payload.js";
import certified from "./testing/m6-wo9-registry-baseline.json";

/** Kinds added by the LATER RULES-WO1 Work Order, characterized by rules-wo1-authoring.test.ts. */
const RULES_WO1_KINDS: readonly string[] = ["CALCULATED_VALUE", "SKILL_BENEFIT", "CONCENTRATION_RULE", "METAMAGIC", "JOB_TEMPLATE", "REFERENCE_RULE", "AMMUNITION", "WEAPON_MODIFICATION"];
/** Reserved kinds a LATER Work Order (RULES-WO1 Phase C) activated: ONLY their schemaVersions change (rules-wo1-reference.test.ts). */
const RULES_WO1_ACTIVATED: readonly string[] = ["ARMOR", "STATUS_CONDITION", "SUMMON_TYPE", "SUMMON_TRAIT", "MISSION_RULE"];

/**
 * PAS-10 M6-WO9 Phase B — registry change guard (decision C1). Every Prowess Definition kind specification that existed
 * at the accepted Phase A checkpoint is byte-for-byte unchanged (src/testing/m6-wo9-registry-baseline.json); the ONLY
 * change is the additive ACTION_IMPROVEMENT kind. ACTION itself — and with it every historical ACTION Definition — is
 * untouched, and MAGE_ART stays reserved.
 */
const baseline = certified as unknown as {
  baseCommit: string;
  kinds: Record<string, { family: string; branch: string | null; contract: string | null; entityTypes: string[]; schemaVersions: number[] }>;
};
const current = JSON.parse(JSON.stringify(PROWESS_DEFINITION_KINDS)) as typeof baseline.kinds;

describe("M6-WO9 registry characterization (Phase B, decision C1)", () => {
  it("is pinned to the accepted Phase A checkpoint and its 43 kinds", () => {
    expect(baseline.baseCommit).toBe("cac67673a4e0fbf61e9996c86293864ae28a2758");
    expect(Object.keys(baseline.kinds)).toHaveLength(43);
  });

  it("every pre-Phase-B kind is byte-for-byte unchanged — ACTION included, MAGE_ART still reserved", () => {
    // MAGE_ART was reserved at this checkpoint; a LATER Work Order (PRE-M7-WO1) changes ONLY its schemaVersions [] → [1].
    expect(baseline.kinds.MAGE_ART?.schemaVersions).toEqual([]);
    for (const [kind, spec] of Object.entries(baseline.kinds)) if (kind !== "MAGE_ART" && !RULES_WO1_ACTIVATED.includes(kind)) expect(JSON.stringify(current[kind]), kind).toBe(JSON.stringify(spec));
    // PRE-M7-WO1 changed MAGE_ART [] → [1]; RULES-WO1 Phase C adds version 2 ([1, 2]) and activates the listed reserved kinds.
    expect(current.MAGE_ART).toEqual({ ...baseline.kinds.MAGE_ART, schemaVersions: [1, 2] });
    for (const kind of RULES_WO1_ACTIVATED) expect({ ...current[kind], schemaVersions: baseline.kinds[kind]!.schemaVersions }, kind).toEqual(baseline.kinds[kind]);
  });

  it("the only new kind is ACTION_IMPROVEMENT: ACTION_ECONOMY family, no shared contract, GENERIC_RULE storage, v1", () => {
    expect(Object.keys(current).filter((k) => !(k in baseline.kinds) && !RULES_WO1_KINDS.includes(k))).toEqual(["ACTION_IMPROVEMENT"]);
    expect(current.ACTION_IMPROVEMENT).toEqual({ family: "ACTION_ECONOMY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect([...ACTION_IMPROVEMENT_PAYLOAD_KINDS]).toEqual(["ACTION_IMPROVEMENT"]);
  });
});
