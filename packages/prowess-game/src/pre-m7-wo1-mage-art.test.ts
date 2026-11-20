import { describe, expect, it } from "vitest";
import {
  DEFINITION_ERROR_CODES as C,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_STORAGE_KEY,
  mageArtDomainOf,
  validateStoredProwessDefinition,
  type ProwessOutcome,
} from "./index.js";

/**
 * PRE-M7-WO1 — MAGE_ART payload version 1 (definition/mage-art-payload.ts): authoring and reference of a fixed Mage Art.
 *
 * The contract records only what the Core Playtest Mage Art rules state for every Art (system map §11, s1905–s1913):
 * activation AP / MP, per-turn maintenance AP / MP or a special text cost, the Active Effect window (Contract counts only
 * while casting) and modes (Reinforcement: Object / Weapon). What an Art does is rules text; nothing here is executed and
 * the Character card stays UNAVAILABLE. The registry change is reserved ([]) → [1] with nothing else changed.
 */
const stored = (payload: unknown) => ({
  entityType: "GENERIC_RULE" as const,
  structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 1, systemFamily: "MAGE_ART", definitionKind: "MAGE_ART", payload } },
});
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));
const paths = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.path));

// Illustrative numbers only — the contract is what is under test, not any Art's published costs.
const ART = {
  artKey: "REINFORCEMENT",
  activation: { ap: 1, mp: 2 },
  maintenance: { ap: 0, mp: 1, special: null },
  activeEffect: { counts: "WHILE_MAINTAINED" },
  modes: [
    { modeKey: "OBJECT", name: "Object", activation: null, maintenance: null, rulesText: "Reinforce an object." },
    { modeKey: "WEAPON", name: "Weapon", activation: { ap: 1, mp: 3 }, maintenance: { ap: 0, mp: 1, special: null }, rulesText: "Reinforce a weapon." },
  ],
  source: { locators: ["s1914", "s1905"], conflicts: [] },
};

describe("PRE-M7-WO1 MAGE_ART v1", () => {
  it("the registry activates MAGE_ART at schema version 1 and changes nothing else about it", () => {
    // RULES-WO1 Phase C later adds version 2 alongside 1 (rules-wo1-reference.test.ts); version 1 stays readable.
    expect(PROWESS_DEFINITION_KINDS.MAGE_ART).toEqual({ family: "MAGE_ART", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1, 2] });
  });

  it("accepts a complete Art with modes and returns a detached, normalized payload", () => {
    const input = JSON.parse(JSON.stringify(ART)) as typeof ART;
    const out = validateStoredProwessDefinition(stored(input));
    expect(codes(out)).toEqual([]);
    if (!out.ok || out.value.kind !== "DEFINITION") throw new Error("expected a Definition");
    expect(out.value.definition.payload).toEqual({ ...ART, source: { locators: ["s1905", "s1914"], conflicts: [] } });
    expect(input).toEqual(ART);
    expect(Object.isFrozen(out.value.definition.payload)).toBe(true);
  });

  it("records a special (non-AP/MP) maintenance cost as text and the casting-only Active Effect window", () => {
    const out = validateStoredProwessDefinition(stored({ ...ART, artKey: "CONTRACT", modes: [], maintenance: { ap: 0, mp: 0, special: "Stated in the Art's text." }, activeEffect: { counts: "WHILE_CASTING" } }));
    expect(codes(out)).toEqual([]);
  });

  it.each([
    ["unknown field", { ...ART, cooldown: 3 }, "/prowessDefinition/payload/cooldown"],
    ["missing maintenance", Object.fromEntries(Object.entries(ART).filter(([k]) => k !== "maintenance")), "/prowessDefinition/payload/maintenance"],
    ["negative MP", { ...ART, activation: { ap: 1, mp: -1 } }, "/prowessDefinition/payload/activation/mp"],
    ["fractional AP", { ...ART, activation: { ap: 1.5, mp: 1 } }, "/prowessDefinition/payload/activation/ap"],
    ["empty special", { ...ART, maintenance: { ap: 0, mp: 0, special: " " } }, "/prowessDefinition/payload/maintenance/special"],
    ["unknown window", { ...ART, activeEffect: { counts: "ALWAYS" } }, "/prowessDefinition/payload/activeEffect/counts"],
    ["lowercase key", { ...ART, artKey: "barrier" }, "/prowessDefinition/payload/artKey"],
    ["duplicate mode", { ...ART, modes: [ART.modes[0], ART.modes[0]] }, "/prowessDefinition/payload/modes/1/modeKey"],
    ["mode without name", { ...ART, modes: [{ ...ART.modes[0], name: "" }] }, "/prowessDefinition/payload/modes/0/name"],
    ["modes not a list", { ...ART, modes: {} }, "/prowessDefinition/payload/modes"],
    ["no source section", { ...ART, source: { locators: [], conflicts: [] } }, "/prowessDefinition/payload/source/locators"],
  ])("refuses %s (fails closed with a located problem)", (_name, payload, path) => {
    const out = validateStoredProwessDefinition(stored(payload));
    expect(out.ok).toBe(false);
    expect(codes(out).every((c) => c === C.INVALID_PAYLOAD)).toBe(true);
    expect(paths(out)).toContain(path);
  });

  it("refuses other schema versions and the wrong storage EntityType", () => {
    const v2 = { ...stored(ART), structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 2, systemFamily: "MAGE_ART", definitionKind: "MAGE_ART", payload: ART } } };
    expect(validateStoredProwessDefinition(v2).ok).toBe(false);
    expect(codes(validateStoredProwessDefinition({ ...stored(ART), entityType: "STAT" as never }))).toContain(C.ENTITY_TYPE_MISMATCH);
  });

  it("is authoring and reference only: the Mage Art card domain stays UNAVAILABLE (no play behaviour is invented)", () => {
    const domain = mageArtDomainOf({ rulesetProvenance: {} as never, definitions: [] });
    expect(domain.status).toBe("UNAVAILABLE");
    expect(domain.status === "UNAVAILABLE" && domain.reason).toBe("no Character-facing Mage Art domain exists");
  });
});
