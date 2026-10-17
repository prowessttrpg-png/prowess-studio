import { describe, expect, it } from "vitest";
import {
  ABILITY_SLOT_KINDS,
  CANONICAL_AFFINITIES,
  COMPONENT_COMPILERS,
  COST_CURRENCIES,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_KIND_NAMES,
  PROWESS_SYSTEM_FAMILIES,
  TERMINOLOGY_CATEGORIES,
  TERMINOLOGY_INVENTORY,
  legacyTermFor,
} from "./index.js";

/**
 * Vocabulary and terminology inventory (§81–83, §150–151). Invariants: M5-I001 Core Playtest is the primary source ·
 * M5-I002 unresolved ambiguity is preserved, not normalized · M5-I026 Summoning grants no unauthored capability ·
 * M5-I035 shared concepts with branch-specific content · M5-I037 Evocation canonical, Emission legacy.
 */
const byTerm = (term: string) => TERMINOLOGY_INVENTORY.filter((e) => e.term === term);

describe("terminology inventory", () => {
  it("covers every required category (§150) with at least one entry", () => {
    for (const category of TERMINOLOGY_CATEGORIES) {
      expect(TERMINOLOGY_INVENTORY.some((e) => e.category === category), category).toBe(true);
    }
  });

  it("M5-I037 Evocation is CANONICAL by designer clarification; Emission is LEGACY with canonical Evocation", () => {
    expect(byTerm("Evocation")).toEqual([expect.objectContaining({ status: "CANONICAL", token: "EVOCATION", authority: "DESIGNER_CLARIFICATION", conflictKey: "M5-SC-001" })]);
    expect(byTerm("Emission")).toEqual([expect.objectContaining({ status: "LEGACY", canonicalTerm: "Evocation", token: null, conflictKey: "M5-SC-001" })]);
    expect(legacyTermFor("EMISSION")).toEqual({ term: "Emission", canonicalTerm: "Evocation" });
    expect(legacyTermFor("Evocation")).toBeNull();
    expect(CANONICAL_AFFINITIES).toEqual(["EVOCATION", "CONJURATION", "TRANSMUTATION", "DIVINATION", "ENHANCEMENT", "MANIPULATION"]);
    expect(CANONICAL_AFFINITIES as readonly string[]).not.toContain("EMISSION");
  });

  it("M5-I002 / M5-I041 Player Dice / Die is LEGACY for Character Dice / Die (designer ruling M5-SC-002, M5-WO2) — never canonical", () => {
    expect(byTerm("Player Dice")).toEqual([expect.objectContaining({ status: "LEGACY", token: null, canonicalTerm: "Character Dice", conflictKey: "M5-SC-002" })]);
    expect(byTerm("Player Die")).toEqual([expect.objectContaining({ status: "LEGACY", token: null, canonicalTerm: "Character Die", conflictKey: "M5-SC-002" })]);
    expect(byTerm("Character Die")[0]?.status).toBe("CANONICAL");
    // Context-specific dice stay SYSTEM_SPECIFIC rather than being merged.
    for (const term of ["Summon Dice", "Commitment Die", "Bound Dice"]) expect(byTerm(term)[0]?.status, term).toBe("SYSTEM_SPECIFIC");
  });

  it("other unresolved source inconsistencies stay unresolved (Arcane / Arcana Rank, Maneuver Traits); WO2 rulings resolve Dodge / Evasion (M5-I056) and Advantage; WO3 resolves Base Movement", () => {
    expect(byTerm("Dodge")[0]?.status).toBe("CANONICAL");
    expect(byTerm("Evasion")[0]).toEqual(expect.objectContaining({ status: "LEGACY", canonicalTerm: "Dodge" }));
    expect(byTerm("Advantage")[0]?.status).toBe("CANONICAL");
    expect(byTerm("Accuracy")[0]?.status).toBe("CANONICAL");
    // M5-SC-006 RESOLVED_BY_DESIGNER in M5-WO3 (M5-I075; M5-I073 superseded).
    expect(byTerm("Base Movement")).toEqual([expect.objectContaining({ status: "CANONICAL", token: "BASE_MOVEMENT", authority: "DESIGNER_CLARIFICATION", conflictKey: "M5-SC-006" })]);
    for (const term of ["Final Movement", "Movement Allowance", "Creature Size", "Action Points", "Counter Action", "Mana Efficiency", "Mana Points", "Dodge Action"]) expect(byTerm(term)[0]?.status, term).toBe("CANONICAL");
    expect(byTerm("Dodge Action")[0]?.token).not.toBe(byTerm("Dodge")[0]?.token);
    for (const term of ["Arcane Rank", "Arcana Rank", "Maneuver Traits"]) {
      expect(byTerm(term)[0]?.status, term).toBe("UNRESOLVED");
      expect(byTerm(term)[0]?.conflictKey, term).toMatch(/^M5-SC-\d{3}$/);
    }
  });

  it("every LEGACY entry names a CANONICAL replacement and every UNRESOLVED entry cites a conflict", () => {
    for (const e of TERMINOLOGY_INVENTORY) {
      if (e.status === "LEGACY") expect(byTerm(e.canonicalTerm ?? "").some((c) => c.status === "CANONICAL"), e.term).toBe(true);
      if (e.status === "UNRESOLVED") expect(e.conflictKey, e.term).not.toBeNull();
      if (e.status !== "LEGACY") expect(e.canonicalTerm, e.term).toBeNull();
    }
  });

  it("is deep-frozen plain data", () => {
    expect(Object.isFrozen(TERMINOLOGY_INVENTORY) && Object.isFrozen(TERMINOLOGY_INVENTORY[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(TERMINOLOGY_INVENTORY))).toEqual(TERMINOLOGY_INVENTORY);
  });
});

describe("system families and Definition kinds", () => {
  it("every kind belongs to a known family, and branch kinds belong to their branch family", () => {
    for (const kind of PROWESS_DEFINITION_KIND_NAMES) {
      const spec = PROWESS_DEFINITION_KINDS[kind];
      expect(PROWESS_SYSTEM_FAMILIES, kind).toContain(spec.family);
      if (spec.branch !== null) expect(spec.family, kind).toBe(spec.branch);
      expect(spec.entityTypes.length, kind).toBeGreaterThan(0);
    }
  });

  it("M5-I035 / M5-I036 every Ability slot has a distinct kind per branch, implementing the same shared contract", () => {
    for (const slot of ["targeting", "effects", "traits", "duration", "conditions"] as const) {
      const [spell, maneuver] = [ABILITY_SLOT_KINDS.SPELL[slot], ABILITY_SLOT_KINDS.MANEUVER[slot]];
      expect(spell).not.toBe(maneuver);
      expect(PROWESS_DEFINITION_KINDS[spell].contract).toBe(PROWESS_DEFINITION_KINDS[maneuver].contract);
      expect([PROWESS_DEFINITION_KINDS[spell].branch, PROWESS_DEFINITION_KINDS[maneuver].branch]).toEqual(["SPELL", "MANEUVER"]);
    }
    expect(ABILITY_SLOT_KINDS.SPELL.foundation).toBeNull();
  });

  it("M5-I026 Summoning grants no unauthored capability: summon kinds are reserved, with no payload contract and no compiler", () => {
    for (const kind of ["SUMMON_TYPE", "SUMMON_TRAIT", "SUMMON_ACTION_MODEL"] as const) {
      expect(PROWESS_DEFINITION_KINDS[kind].schemaVersions).toEqual([]);
      expect(COMPONENT_COMPILERS[kind]).toBeNull();
    }
  });

  it("Mana Efficiency is never a cost currency (M5-I023)", () => {
    expect(COST_CURRENCIES as readonly string[]).not.toContain("ME");
  });

  it("M5-I001 the vocabulary is sourced from the Core Playtest audit (authority recorded on every entry)", () => {
    expect(new Set(TERMINOLOGY_INVENTORY.map((e) => e.authority))).toEqual(new Set(["CORE_PLAYTEST_V0_1", "DESIGNER_CLARIFICATION", "SOURCE_AUDIT"]));
    expect(TERMINOLOGY_INVENTORY.filter((e) => e.authority === "DESIGNER_CLARIFICATION").map((e) => e.term).sort()).toEqual(["Accuracy", "Advantage", "Base Movement", "Disadvantage", "Dodge", "Emission", "Evasion", "Evocation", "Final Movement", "Movement Allowance", "Player Dice", "Player Die"]);
  });
});
