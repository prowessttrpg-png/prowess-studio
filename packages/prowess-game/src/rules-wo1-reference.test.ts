import { describe, expect, it } from "vitest";
import {
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_STORAGE_KEY,
  SUMMON_ENGINES,
  previewArmor,
  previewMageArtScaling,
  previewMissionTable,
  previewReload,
  previewSummonCosts,
  previewSummonEconomy,
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
  triggers: [{ triggerKey: "BURN", when: "START_OF_TURN", resistStat: null, text: "Takes the ongoing Fire damage." }],
  source: { locators: ["s501"], conflicts: [] },
};
const formula = (expression: string, variables: Array<{ variable: string; source: Record<string, unknown> }>, rounding = "FLOOR", minimum: number | null = 1) => ({ expression, rounding, minimum, maximum: null, unit: null, variables });
// Mage Art scaling fixtures (illustrative values shaped like the source's level tables and Stat formulas).
const ATTACK_BONUS: Parameters<typeof previewMageArtScaling>[0]["scaling"][number] & { text: string } = { scalingKey: "ATTACK_BONUS", label: "Attack bonus", unit: null, byLevel: [{ fromLevel: 1, toLevel: 3, value: 1 }, { fromLevel: 4, toLevel: 6, value: 2 }, { fromLevel: 7, toLevel: 9, value: 3 }, { fromLevel: 10, toLevel: 10, value: 4 }], formula: null, text: "Bonus to Attack Rolls by Level." };
const RADIUS: Parameters<typeof previewMageArtScaling>[0]["scaling"][number] & { text: string } = { scalingKey: "RADIUS", label: "Radius", unit: "ft", byLevel: null, formula: { expression: "15 * res", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [{ variable: "res", source: { kind: "STAT", stat: "RES" } }] }, text: "15 ft × Resolve." };
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
  ownership: { actionModel: "PASSIVE", actsWhen: "AUTOMATIC_AT_TRIGGER", baseAp: null, apOwner: "NONE", hpOwner: "SUMMON", mpOwner: "NONE", counterActions: false, dismissal: "FREE_ACTION" },
  restrictions: [{ restrictionKey: "NO_ACTIONS", kind: "NO_ACTIONS_WITHOUT_TRAIT", text: "A Totem with no emitted Effect does nothing except exist." }],
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
  relatedRules: [],
  source: { locators: ["s2236"], conflicts: [] },
};
export const SIX_CLOCK = { ruleKey: "STANDARD_CLOCK", shape: "CLOCK", rollTable: null, clock: { segments: 6, visibility: "EITHER", advancesWhen: ["A Mission Turn passes."], escalations: [{ atSegment: 2, text: "First warning." }, { atSegment: 4, text: "Major complication." }, { atSegment: 6, text: "Clock completes." }] }, intel: null, points: null, relatedRules: [], source: { locators: ["s2214"], conflicts: [] } };

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

describe("RULES-WO1 SUMMON_TYPE — every engine is authorable (R15)", () => {
  // Illustrative test configurations (not canon numbers): one per engine, each with its own sustain model.
  const ENGINE_CASES = [
    ["SUMMON_ENTITY", "SUSTAINED", "Acts on the caster's turn."],
    ["TOTEM", "SUSTAINED_OR_PERIODIC", "Stationary; acts on the caster's turn."],
    ["PERSISTENT_CONSTRUCT", "NONE", "Persists until destroyed."],
    ["BOUND_SUMMON", "PERIODIC", "Bound to an object; called with an action."],
    ["MANIFESTED_ENTITY", "SUSTAINED", "Manifests in an area."],
    ["FUSION", "SUSTAINED", "Merges with the caster."],
    ["EQUIPMENT_SUMMONING", "NONE", "Creates an item the caster wields."],
  ] as const;
  it.each(ENGINE_CASES)("%s validates, keeps its engine and previews its casting cost", (engine, sustainMode, actionEconomy) => {
    const none = sustainMode === "NONE";
    const payload = { ...TOTEM, summonKey: `TEST_${engine}`, engine, sustainMode, actionEconomy, sustainMp: none ? null : TOTEM.sustainMp, sustainApPerRound: none ? null : 1 };
    const result = validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TYPE", payload));
    expect(codes(result)).toEqual([]);
    expect(previewSummonCosts({ summon: payload as unknown as Parameters<typeof previewSummonCosts>[0]["summon"], tierKey: "TIER_1", totalMp: null, stats: { PRO: 4 } })).toMatchObject({ castingAp: 3, appliesInPlay: false });
  });
  it("covers exactly the seven engines of the rulebook", () => {
    expect([...SUMMON_ENGINES].sort()).toEqual(["BOUND_SUMMON", "EQUIPMENT_SUMMONING", "FUSION", "MANIFESTED_ENTITY", "PERSISTENT_CONSTRUCT", "SUMMON_ENTITY", "TOTEM"]);
  });
});

describe("RULES-WO1 MISSION_RULE linked rules (R16)", () => {
  const ruleRef = (kind: "REFERENCE_RULE" | "MISSION_RULE" | "SKILL", n: number) => ({
    entityId: `00000000-0000-4000-8000-00000000000${n}`,
    entityVersionId: `00000000-0000-4000-8000-00000000010${n}`,
    canonicalKey: `test.rw1.linked_${n}`,
    definitionKind: kind,
    systemFamily: kind === "REFERENCE_RULE" ? "CORE" : kind === "MISSION_RULE" ? "MISSION" : "SKILL",
  });
  it("links a Mission table to the exact reference and Mission rules it points to", () => {
    const linked = { ...CLAUSES, relatedRules: [ruleRef("REFERENCE_RULE", 1), ruleRef("MISSION_RULE", 2)] };
    expect(codes(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", linked)))).toEqual([]);
  });
  it.each([
    ["a link to another kind", [ruleRef("SKILL", 3)], "/prowessDefinition/payload/relatedRules/0/definitionKind"],
    ["the same rule twice", [ruleRef("REFERENCE_RULE", 1), ruleRef("REFERENCE_RULE", 1)], "/prowessDefinition/payload/relatedRules/1"],
    ["a link without its exact version", [{ ...ruleRef("REFERENCE_RULE", 1), entityVersionId: "latest" }], "/prowessDefinition/payload/relatedRules/0/entityVersionId"],
  ])("refuses %s", (_l, relatedRules, path) => expect(paths(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", { ...CLAUSES, relatedRules })))).toContain(path));
  it("requires the linked-rules list (empty when there are none)", () => {
    const without = Object.fromEntries(Object.entries(CLAUSES).filter(([k]) => k !== "relatedRules"));
    expect(paths(validateStoredProwessDefinition(stored("MISSION", "MISSION_RULE", without)))).toContain("/prowessDefinition/payload/relatedRules");
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
    const v2 = { ...v1, modes: [{ ...v1.modes[0], scaling: [ATTACK_BONUS, RADIUS] }], grantedBenefits: [{ benefitKey: "NO_SUFFOCATION", kind: "IMMUNITY", subject: "Suffocation", text: "Immune to Suffocation (illustrative)." }], maintenanceExceptions: [{ exceptionKey: "PACT", kind: "ACTIVE_EFFECT_ONLY_WHILE_CASTING", text: "Counts as an Active Effect only while casting (illustrative)." }] };
    const out = validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", v2, 2));
    expect(codes(out)).toEqual([]);
    expect(paths(validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", v1, 2)))).toContain("/prowessDefinition/payload/grantedBenefits");
  });
  it("Phase D: Mage Art scaling is a contiguous level table or a Formula, and previews at a Level through M4", () => {
    expect(previewMageArtScaling({ scaling: [ATTACK_BONUS, RADIUS], level: 5, stats: { RES: 4 } }).values.map((v) => [v.scalingKey, v.value])).toEqual([["ATTACK_BONUS", 2], ["RADIUS", 60]]);
    expect(previewMageArtScaling({ scaling: [RADIUS], level: 5, stats: {} }).values[0]).toMatchObject({ value: null, reason: "RES is needed" });
    const v1 = { artKey: "FOCUS", activation: { ap: 1, mp: 6 }, maintenance: { ap: 1, mp: 4, special: null }, activeEffect: { counts: "WHILE_MAINTAINED" }, source: { locators: ["s1905"], conflicts: [] } };
    const art = (scaling: unknown[], extra: Record<string, unknown> = {}) => ({ ...v1, modes: [{ modeKey: "FOCUS", name: "Focus", activation: null, maintenance: null, rulesText: "Illustrative.", scaling }], grantedBenefits: [], maintenanceExceptions: [], ...extra });
    const gap = { ...ATTACK_BONUS, byLevel: [{ fromLevel: 1, toLevel: 3, value: 1 }, { fromLevel: 5, toLevel: 10, value: 2 }] };
    expect(paths(validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", art([gap]), 2)))).toContain("/prowessDefinition/payload/modes/0/scaling/0/byLevel/1/fromLevel");
    const both = { ...ATTACK_BONUS, formula: RADIUS.formula };
    expect(paths(validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", art([both]), 2)))).toContain("/prowessDefinition/payload/modes/0/scaling/0/byLevel");
    const unnamed = art([], { grantedBenefits: [{ benefitKey: "X", kind: "ADVANTAGE", subject: null, text: "Advantage." }] });
    expect(paths(validateStoredProwessDefinition(stored("MAGE_ART", "MAGE_ART", unnamed, 2)))).toContain("/prowessDefinition/payload/grantedBenefits/0/subject");
  });
});

describe("RULES-WO1 Phase D — Condition triggers, Summon ownership, ammunition and modifications", () => {
  it("a Condition's triggers name when they act; a failed-Save trigger names its Save", () => {
    const shocked = { ...BURNING, conditionKey: "SHOCKED", triggers: [{ triggerKey: "ON_HIT", when: "ON_HIT", resistStat: null, text: "Applied on a hit." }, { triggerKey: "RESIST", when: "ON_FAILED_SAVE", resistStat: "RES", text: "Applied on a failed RES Save." }] };
    expect(codes(validateStoredProwessDefinition(stored("CONDITION", "STATUS_CONDITION", shocked)))).toEqual([]);
    const noSave = { ...shocked, triggers: [{ triggerKey: "RESIST", when: "ON_FAILED_SAVE", resistStat: null, text: "x" }] };
    expect(paths(validateStoredProwessDefinition(stored("CONDITION", "STATUS_CONDITION", noSave)))).toContain("/prowessDefinition/payload/triggers/0/resistStat");
    expect(paths(validateStoredProwessDefinition(stored("CONDITION", "STATUS_CONDITION", { ...BURNING, triggers: [{ triggerKey: "X", when: "ON_SNEEZE", resistStat: null, text: "x" }] })))).toContain("/prowessDefinition/payload/triggers/0/when");
  });
  it.each([
    ["a PASSIVE Summon with AP", { actionModel: "PASSIVE", actsWhen: "AUTOMATIC_AT_TRIGGER", baseAp: 2, apOwner: "NONE", hpOwner: "SUMMON", mpOwner: "NONE", counterActions: false, dismissal: "FREE_ACTION" }, "/prowessDefinition/payload/ownership/baseAp"],
    ["a DEPENDENT Summon with its own AP", { actionModel: "DEPENDENT", actsWhen: "CASTER_TURN", baseAp: null, apOwner: "SUMMON", hpOwner: "SUMMON", mpOwner: "NONE", counterActions: false, dismissal: "FREE_ACTION" }, "/prowessDefinition/payload/ownership/apOwner"],
    ["an INDEPENDENT Summon without AP", { actionModel: "INDEPENDENT", actsWhen: "CASTER_TURN", baseAp: null, apOwner: "SUMMON", hpOwner: "SUMMON", mpOwner: "NONE", counterActions: false, dismissal: "FREE_ACTION" }, "/prowessDefinition/payload/ownership/apOwner"],
    ["a SPLIT_RESOURCE Summon that splits nothing", { actionModel: "SPLIT_RESOURCE", actsWhen: "CASTER_TURN", baseAp: 2, apOwner: "SUMMON", hpOwner: "SUMMON", mpOwner: "NONE", counterActions: false, dismissal: "FREE_ACTION" }, "/prowessDefinition/payload/ownership/actionModel"],
  ])("Summon ownership refuses %s", (_l, ownership, path) => expect(paths(validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TYPE", { ...TOTEM, ownership })))).toContain(path));
  it("an Independent Summon Entity owns 2 AP and acts on the caster's turn; the preview says who pays", () => {
    const entity = { ...TOTEM, summonKey: "ENTITY", engine: "SUMMON_ENTITY", sustainMode: "SUSTAINED", ownership: { actionModel: "INDEPENDENT", actsWhen: "CASTER_TURN", baseAp: 2, apOwner: "SUMMON", hpOwner: "SUMMON", mpOwner: "NONE", counterActions: false, dismissal: "FREE_ACTION" } };
    expect(codes(validateStoredProwessDefinition(stored("SUMMON", "SUMMON_TYPE", entity)))).toEqual([]);
    expect(previewSummonEconomy({ summon: entity })).toMatchObject({ summonApPerRound: 2, usesCasterAp: false, casterSustainApPerRound: 1, appliesInPlay: false });
    const fusion = { ...TOTEM, ownership: { actionModel: "SELF_BOUND", actsWhen: "CASTER_TURN", baseAp: null, apOwner: "CASTER", hpOwner: "CASTER", mpOwner: "CASTER", counterActions: null, dismissal: "FREE_ACTION" } };
    expect(previewSummonEconomy({ summon: fusion })).toMatchObject({ summonApPerRound: null, usesCasterAp: true });
  });
  it("ammunition and modifications validate; the reload preview splits Reload AP across turns and applies fitted modifications", () => {
    const rounds = { ammoKey: "STANDARD_ROUNDS", weaponFamilies: ["RIFLE"], perAttack: 1, burstPerAttack: 3, effect: "Standard ammunition (illustrative).", notes: [], source: { locators: ["s3636"], conflicts: [] } };
    expect(codes(validateStoredProwessDefinition(stored("EQUIPMENT", "AMMUNITION", rounds)))).toEqual([]);
    expect(paths(validateStoredProwessDefinition(stored("EQUIPMENT", "AMMUNITION", { ...rounds, weaponFamilies: [] })))).toContain("/prowessDefinition/payload/weaponFamilies");
    const mag = { modificationKey: "EXTENDED_MAGAZINE", weaponFamilies: ["RIFLE"], slotCost: 1, changes: [{ changeKey: "MORE", kind: "LOADING", amount: 4, text: "+4 Loading." }, { changeKey: "SLOWER", kind: "RELOAD_AP", amount: 1, text: "+1 Reload AP." }], requirements: [], source: { locators: ["s3639"], conflicts: [] } };
    expect(codes(validateStoredProwessDefinition(stored("EQUIPMENT", "WEAPON_MODIFICATION", mag)))).toEqual([]);
    expect(paths(validateStoredProwessDefinition(stored("EQUIPMENT", "WEAPON_MODIFICATION", { ...mag, changes: [{ changeKey: "X", kind: "TO_HIT", amount: null, text: "x" }] })))).toContain("/prowessDefinition/payload/changes/0/amount");
    // Loading (12), Reload 3 AP; fitted: +4 Loading, +1 Reload AP → 16 shots, 5 Burst shots; 4 AP over 2 turns (3 + 1).
    expect(previewReload({ loading: 12, reloadAp: 3, apPerTurn: 3, ammunition: rounds, modifications: [mag] })).toMatchObject({ loading: 16, reloadAp: 4, attacksBeforeReload: 16, burstAttacksBeforeReload: 5, turnsToReload: 2, apSplit: [3, 1], appliesInPlay: false });
    expect(previewReload({ loading: 20, reloadAp: 5, apPerTurn: 3, ammunition: null, modifications: [] })).toMatchObject({ turnsToReload: 2, apSplit: [3, 2] });
  });
});
