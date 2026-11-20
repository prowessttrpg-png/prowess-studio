import { describe, expect, it } from "vitest";
import {
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_STORAGE_KEY,
  previewArmor,
  previewMissionTable,
  previewSummonCosts,
  previewThreatClock,
  validateStoredProwessDefinition,
  type ProwessOutcome,
} from "./index.js";
import { characterFixture } from "./testing/character-fixtures.js";

/**
 * RULES-WO1 Phase C — reference rule families: ARMOR, STATUS_CONDITION, SUMMON_TYPE, SUMMON_TRAIT, MISSION_RULE,
 * METAMAGIC, JOB_TEMPLATE (v1) and MAGE_ART v2. Authoring, validation, reference and preview only — nothing here is
 * executed in play. Numbers are the Core Playtest packet's published examples where one exists (Armor categories, the
 * Totem tier table, the 6-segment clock, the d20 contract-clause table); everything else is labelled illustrative.
 */
const stored = (family: string, kind: string, payload: unknown, schemaVersion = 1) => ({
  entityType: "GENERIC_RULE" as const,
  structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion, systemFamily: family, definitionKind: kind, payload } },
});
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));
const paths = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.path));
const SRC = { locators: ["s540"], conflicts: [] };
const f0 = characterFixture();

export const HEAVY = { armorKey: "HEAVY_PLATE", category: "HEAVY", armorValue: 5, strengthRequirement: 5, maxAgiForDodge: 5, movementPenaltyFeet: 5, stealth: "DISADVANTAGE", notes: ["Front-line survival."], source: SRC };
export const BURNING = {
  conditionKey: "BURNING",
  effects: [{ effectKey: "DAMAGE_OVER_TIME", text: "Takes damage over time." }],
  duration: { model: "UNTIL_REMOVED", rounds: null, text: null },
  removal: ["An action to put out the flames (illustrative)."],
  ongoingTiming: "START_OF_TURN",
  stacking: "DOES_NOT_STACK",
  source: { locators: ["s501"], conflicts: [] },
};
const formula = (expression: string, variables: Array<{ variable: string; source: Record<string, unknown> }>, rounding = "FLOOR", minimum: number | null = 1) => ({ expression, rounding, minimum, maximum: null, unit: null, variables });
export const TOTEM = {
  summonKey: "TOTEM",
  engine: "TOTEM",
  tiers: [
    { tierKey: "TIER_1", label: "Tier 1", baseMp: 12, dieFaces: 4, staticValue: 2, hp: 10, armor: 2, resolve: 2, radiusFeet: 10, size: "Small", traitSlots: null },
    { tierKey: "TIER_2", label: "Tier 2", baseMp: 22, dieFaces: 6, staticValue: 3, hp: 20, armor: 4, resolve: 3, radiusFeet: 15, size: "Medium", traitSlots: null },
  ],
  castingAp: formula("total_mp / pro", [{ variable: "total_mp", source: { kind: "TOTAL_MP" } }, { variable: "pro", source: { kind: "STAT", stat: "PRO" } }]),
  sustainMode: "SUSTAINED_OR_PERIODIC",
  sustainMp: formula("total_mp / pro", [{ variable: "total_mp", source: { kind: "TOTAL_MP" } }, { variable: "pro", source: { kind: "STAT", stat: "PRO" } }]),
  sustainApPerRound: 1,
  countsTowardConcentration: null,
  maxActive: null,
  actionEconomy: "Resolves automatically on its timing.",
  restrictions: [],
  openQuestions: ["How Totems use the Concentration override (Q-03)."],
  source: { locators: ["s1324"], conflicts: [] },
};
export const CLAUSES = {
  ruleKey: "CONTRACT_CLAUSES",
  shape: "ROLL_TABLE",
  rollTable: { dieCount: 1, dieFaces: 20, rows: [{ from: 1, to: 1, result: "No civilian casualties." }, { from: 2, to: 19, result: "(other clauses — illustrative grouping)" }, { from: 20, to: 20, result: "Hidden clause. Roll again and conceal it until discovered." }] },
  clock: null,
  intel: null,
  points: null,
  source: { locators: ["s2236"], conflicts: [] },
};
export const SIX_CLOCK = { ruleKey: "STANDARD_CLOCK", shape: "CLOCK", rollTable: null, clock: { segments: 6, visibility: "EITHER", advancesWhen: ["A Mission Turn passes."], escalations: [{ atSegment: 2, text: "First warning." }, { atSegment: 4, text: "Major complication." }, { atSegment: 6, text: "Clock completes." }] }, intel: null, points: null, source: { locators: ["s2214"], conflicts: [] } };

describe("RULES-WO1 Phase C registry", () => {
  it("activates the reserved reference kinds at version 1, adds METAMAGIC and JOB_TEMPLATE, and MAGE_ART reads versions 1 and 2", () => {
    for (const [kind, family] of [["ARMOR", "EQUIPMENT"], ["STATUS_CONDITION", "CONDITION"], ["SUMMON_TYPE", "SUMMON"], ["SUMMON_TRAIT", "SUMMON"], ["MISSION_RULE", "MISSION"], ["METAMAGIC", "SPELL"], ["JOB_TEMPLATE", "CHARACTER"], ["REFERENCE_RULE", "CORE"]] as const) {
      expect(PROWESS_DEFINITION_KINDS[kind], kind).toEqual({ family, branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    }
    expect(PROWESS_DEFINITION_KINDS.SUMMON_ACTION_MODEL.schemaVersions).toEqual([]); // the action economy is a field of SUMMON_TYPE
    expect(PROWESS_DEFINITION_KINDS.MAGE_ART.schemaVersions).toEqual([1, 2]);
  });
});

describe("RULES-WO1 ARMOR v1", () => {
  it("accepts Heavy Armor as published and previews its AGI cap, Strength requirement and penalties", () => {
    expect(codes(validateStoredProwessDefinition(stored("EQUIPMENT", "ARMOR", HEAVY)))).toEqual([]);
    expect(previewArmor({ armor: HEAVY, stats: { AGI: 8, STR: 5 } })).toMatchObject({ agiCountedForDodge: 5, agiCapped: true, meetsStrengthRequirement: true, movementPenaltyFeet: 5, stealthDisadvantage: true, appliesInPlay: false });
    expect(previewArmor({ armor: HEAVY, stats: { AGI: 4, STR: 3 } })).toMatchObject({ agiCountedForDodge: 4, agiCapped: false, meetsStrengthRequirement: false });
    expect(previewArmor({ armor: { ...HEAVY, maxAgiForDodge: null, strengthRequirement: null }, stats: { AGI: 9 } })).toMatchObject({ agiCountedForDodge: 9, meetsStrengthRequirement: true });
  });
  it.each([
    ["an unknown category", { ...HEAVY, category: "POWERED" }, "/prowessDefinition/payload/category"],
    ["a negative Armor value", { ...HEAVY, armorValue: -1 }, "/prowessDefinition/payload/armorValue"],
    ["an unknown field", { ...HEAVY, weight: 40 }, "/prowessDefinition/payload/weight"],
  ])("refuses %s", (_l, payload, path) => expect(paths(validateStoredProwessDefinition(stored("EQUIPMENT", "ARMOR", payload)))).toContain(path));
});

describe("RULES-WO1 STATUS_CONDITION v1", () => {
  it("accepts a Condition with effect, duration, removal, timing and stacking", () => {
    expect(codes(validateStoredProwessDefinition(stored("CONDITION", "STATUS_CONDITION", BURNING)))).toEqual([]);
    expect(codes(validateStoredProwessDefinition(stored("CONDITION", "STATUS_CONDITION", { ...BURNING, duration: { model: "ROUNDS", rounds: 2, text: null } })))).toEqual([]);
  });
  it.each([
    ["no effect", { ...BURNING, effects: [] }, "/prowessDefinition/payload/effects"],
    ["no removal method", { ...BURNING, removal: [] }, "/prowessDefinition/payload/removal"],
    ["ROUNDS without a number", { ...BURNING, duration: { model: "ROUNDS", rounds: null, text: null } }, "/prowessDefinition/payload/duration/rounds"],
    ["SPECIAL without text", { ...BURNING, duration: { model: "SPECIAL", rounds: null, text: null } }, "/prowessDefinition/payload/duration/text"],
  ])("refuses %s", (_l, payload, path) => expect(paths(validateStoredProwessDefinition(stored("CONDITION", "STATUS_CONDITION", payload)))).toContain(path));
});

describe("RULES-WO1 SUMMON_TYPE / SUMMON_TRAIT v1", () => {
  it("accepts the Totem engine with its published tier rows and previews costs through M4", () => {
    expect(codes(validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TYPE", TOTEM)))).toEqual([]);
    // Tier 2: 22 MP; PRO 4 → casting AP floor(22 / 4) = 5; sustain MP 5; 1 AP per round.
    expect(previewSummonCosts({ summon: TOTEM as unknown as Parameters<typeof previewSummonCosts>[0]["summon"], tierKey: "TIER_2", totalMp: null, stats: { PRO: 4 } })).toMatchObject({ totalMp: 22, castingAp: 5, sustainMp: 5, sustainApPerRound: 1, countsTowardConcentration: null, appliesInPlay: false });
    // Minimum 1: 12 MP at PRO 20 → 1.
    expect(previewSummonCosts({ summon: TOTEM as unknown as Parameters<typeof previewSummonCosts>[0]["summon"], tierKey: "TIER_1", totalMp: null, stats: { PRO: 20 } }).castingAp).toBe(1);
    expect(previewSummonCosts({ summon: TOTEM as unknown as Parameters<typeof previewSummonCosts>[0]["summon"], tierKey: "TIER_1", totalMp: null, stats: {} }).castingAp).toBeNull();
  });
  it("refuses an engine without sustain that states a sustain cost, and a duplicate tier", () => {
    expect(paths(validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TYPE", { ...TOTEM, sustainMode: "NONE" })))).toContain("/prowessDefinition/payload/sustainMode");
    expect(paths(validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TYPE", { ...TOTEM, tiers: [TOTEM.tiers[0], TOTEM.tiers[0]] })))).toContain("/prowessDefinition/payload/tiers/1/tierKey");
  });
  it("accepts a Summon trait with per-tier costs and refuses one with no engine", () => {
    const trait = { traitKey: "WARDING_PULSE", engines: ["TOTEM"], costs: [{ tierKey: "TIER_1", mp: 5 }], forbidden: false, effect: "Illustrative trait.", source: { locators: ["s1369"], conflicts: [] } };
    expect(codes(validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TRAIT", trait)))).toEqual([]);
    expect(paths(validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TRAIT", { ...trait, engines: [] })))).toContain("/prowessDefinition/payload/engines");
  });
});

describe("RULES-WO1 MISSION_RULE v1", () => {
  it("a die-range table must cover every roll exactly once; lookup previews a roll", () => {
    expect(codes(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", CLAUSES)))).toEqual([]);
    expect(previewMissionTable({ table: CLAUSES.rollTable, roll: 20 }).result).toMatch(/Hidden clause/);
    const gap = { ...CLAUSES, rollTable: { ...CLAUSES.rollTable, rows: [CLAUSES.rollTable.rows[0], CLAUSES.rollTable.rows[2]] } };
    expect(paths(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", gap)))).toContain("/prowessDefinition/payload/rollTable/rows/1/from");
    const short = { ...CLAUSES, rollTable: { ...CLAUSES.rollTable, rows: [{ from: 1, to: 19, result: "x" }] } };
    expect(paths(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", short)))).toContain("/prowessDefinition/payload/rollTable/rows");
  });
  it("a Threat Clock's escalations are inside the clock and in order; the preview lists those reached", () => {
    expect(codes(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", SIX_CLOCK)))).toEqual([]);
    expect(previewThreatClock({ clock: SIX_CLOCK.clock, filled: 4 })).toMatchObject({ complete: false, reached: ["First warning.", "Major complication."] });
    const late = { ...SIX_CLOCK, clock: { ...SIX_CLOCK.clock, escalations: [{ atSegment: 7, text: "x" }] } };
    expect(paths(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", late)))).toContain("/prowessDefinition/payload/clock/escalations/0/atSegment");
    const mixed = { ...SIX_CLOCK, rollTable: CLAUSES.rollTable };
    expect(paths(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", mixed)))).toContain("/prowessDefinition/payload/rollTable");
  });
  it("Intel tokens and reference rules are text", () => {
    expect(codes(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", { ...SIX_CLOCK, ruleKey: "INTEL", shape: "INTEL", clock: null, intel: { uses: ["Reveal one hidden clock."] } })))).toEqual([]);
    expect(codes(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", { ...SIX_CLOCK, ruleKey: "FAIL_FORWARD", shape: "POINTS", clock: null, points: ["Failure changes the situation."] })))).toEqual([]);
  });
});

describe("RULES-WO1 REFERENCE_RULE v1 (gameplay tables and written rules)", () => {
  it("accepts a d20 table and written points, and refuses a Threat Clock", () => {
    expect(codes(validateStoredProwessDefinition(stored("CORE", "REFERENCE_RULE", { ...CLAUSES, ruleKey: "COVER" })))).toEqual([]);
    expect(codes(validateStoredProwessDefinition(stored("CORE", "REFERENCE_RULE", { ...SIX_CLOCK, ruleKey: "GRAPPLE", shape: "POINTS", clock: null, points: ["Movement becomes 0."] })))).toEqual([]);
    expect(paths(validateStoredProwessDefinition(stored("CORE", "REFERENCE_RULE", SIX_CLOCK)))).toContain("/prowessDefinition/payload/shape");
  });
});

describe("RULES-WO1 METAMAGIC, JOB_TEMPLATE, MAGE_ART v2", () => {
  it("accepts a Metamagic option", () => {
    expect(codes(validateStoredProwessDefinition(stored("SPELL", "METAMAGIC", { metamagicKey: "EXTEND", form: "OPTION", mp: 2, ap: null, otherCost: null, effect: "Illustrative.", restrictions: [], source: { locators: ["s689"], conflicts: [] } })))).toEqual([]);
  });
  it("accepts an optional Job template with exact Skill references and refuses a non-Skill", () => {
    const job = { jobKey: "WARRIOR", role: "Front line.", suggestedStats: ["STR", "CON"], suggestedSkills: [f0.ref("test.m6wo3.skill.athletics")], startingEquipment: ["A weapon."], features: [], source: { locators: ["s131"], conflicts: [] } };
    expect(codes(validateStoredProwessDefinition(stored("CHARACTER", "JOB_TEMPLATE", job)))).toEqual([]);
    expect(paths(validateStoredProwessDefinition(stored("CHARACTER", "JOB_TEMPLATE", { ...job, suggestedSkills: [f0.ref("affinity.evocation")] })))).toContain("/prowessDefinition/payload/suggestedSkills/0/definitionKind");
  });
  it("MAGE_ART v2 adds scaling, benefits and exceptions; v1 is still accepted unchanged", () => {
    const v1 = { artKey: "BARRIER", activation: { ap: 1, mp: 2 }, maintenance: { ap: 0, mp: 1, special: null }, activeEffect: { counts: "WHILE_MAINTAINED" }, modes: [{ modeKey: "WARD", name: "Ward", activation: null, maintenance: null, rulesText: "Illustrative." }], source: { locators: ["s1905"], conflicts: [] } };
    expect(codes(validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", v1, 1)))).toEqual([]);
    const v2 = { ...v1, modes: [{ ...v1.modes[0], scaling: [{ stepKey: "D1", label: "Domain 1", text: "Illustrative." }] }], grantedBenefits: ["Illustrative benefit."], maintenanceExceptions: [] };
    const out = validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", v2, 2));
    expect(codes(out)).toEqual([]);
    expect(paths(validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", v1, 2)))).toContain("/prowessDefinition/payload/grantedBenefits");
  });
});
