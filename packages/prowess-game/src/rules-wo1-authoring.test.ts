import { describe, expect, it } from "vitest";
import {
  CALCULATED_VALUE_ISSUE_CODES as V,
  DEFINITION_ERROR_CODES as C,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_STORAGE_KEY,
  buildCharacterMechanicalProfile,
  buildCharacterSheetMechanics,
  evaluateCalculatedValues,
  previewConcentration,
  validateStoredProwessDefinition,
  type CalculatedValuePayload,
  type CharacterMechanicalProfile,
  type ConcentrationRulePayload,
  type ProwessOutcome,
  type SkillBenefitPayload,
} from "./index.js";
import { advancementFixture, type AdvancementFixture } from "./testing/advancement-fixtures.js";
import { buildActionDirectory } from "./card/action.js";
import { characterFixture, type FixtureRow } from "./testing/character-fixtures.js";

/**
 * RULES-WO1 — authored rules without a new engine: CALCULATED_VALUE, SKILL_BENEFIT and CONCENTRATION_RULE (v1).
 *
 * Numbers marked TEST_ONLY are labelled placeholders that prove the pipeline, never canon (no Carry Capacity formula
 * exists in the Core Playtest packet — RULES-WO1 Q-05). The Concentration numbers are the owner's confirmed override
 * (OV-01 to OV-03): capacity 1 + floor(RES / 3); sustained-Spell upkeep max(1, floor(cast AP / 2)); one point covers 1 AP.
 */
const stored = (family: string, kind: string, payload: unknown) => ({
  entityType: "GENERIC_RULE" as const,
  structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 1, systemFamily: family, definitionKind: kind, payload } },
});
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));
const paths = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.path));

const f0 = characterFixture();
const ATHLETICS = f0.ref("test.m6wo3.skill.athletics");

export const CARRY: CalculatedValuePayload = {
  valueKey: "CARRY_CAPACITY",
  unit: "lb",
  canonStatus: "TEST_ONLY",
  placement: "CARRY_MAXIMUM_LOAD",
  base: { expression: "25 * str", rounding: "NONE", minimum: 0, maximum: null, unit: null, variables: [{ variable: "str", source: { kind: "STAT", stat: "STR" } }] },
  note: "Test-only placeholder: the Core Playtest packet states no Carry Capacity formula.",
  source: null,
};
export const THROW: CalculatedValuePayload = {
  valueKey: "THROW_DISTANCE",
  unit: "ft",
  canonStatus: "OWNER_PROVIDED",
  placement: "ADDITIONAL_VALUES",
  base: null,
  note: "The base Throw Distance is not stated in the source; only the Athletics benefits are.",
  source: null,
};
const benefit = (over: Partial<SkillBenefitPayload> = {}): SkillBenefitPayload => ({
  benefitKey: "ATHLETICS_TRAINED_THROW",
  skill: ATHLETICS,
  minimumRankKey: "TRAINED",
  contributions: [{ contributionKey: "PER_STR", valueKey: "THROW_DISTANCE", amount: { expression: "5 * str", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [{ variable: "str", source: { kind: "STAT", stat: "STR" } }] }, condition: null }],
  grantedActions: [],
  prerequisiteGroups: [],
  writtenBenefit: "Increase Throw Distance by 5 ft per STR.",
  source: { locators: ["s52"], conflicts: [] },
  ...over,
});
const EXPERT_THROW = benefit({
  benefitKey: "ATHLETICS_EXPERT_THROW",
  minimumRankKey: "EXPERT",
  contributions: [{ contributionKey: "BASE_PLUS_FIVE", valueKey: "THROW_DISTANCE", amount: { expression: "5", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [] }, condition: null }],
  writtenBenefit: "+5 to Base Throw Distance.",
});
export const CONCENTRATION: ConcentrationRulePayload = {
  ruleKey: "CONCENTRATION",
  canonStatus: "OWNER_PROVIDED",
  capacity: { expression: "1 + floor(res / 3)", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [{ variable: "res", source: { kind: "STAT", stat: "RES" } }] },
  sustainedSpellUpkeepAp: { expression: "max(1, floor(cast_ap / 2))", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [{ variable: "cast_ap", source: { kind: "CAST_AP" } }] },
  allocation: { apCoveredPerPoint: 1, maySplitAcrossEffects: true, mayStackOnOneEffect: true, uncoveredApPaid: true, waivesMpUpkeep: false, waivesManaLock: false, pointsReturnWhenEffectEnds: true },
  openQuestions: [
    { questionKey: "REASSIGNMENT", question: "Can points be reassigned while an Effect continues, and at what cost and timing?" },
    { questionKey: "SAVE", question: "Does a Concentration save still apply, and how?" },
  ],
  note: "Owner override of the Core Playtest Concentration rule (confirmed ruling).",
  source: null,
};

describe("RULES-WO1 registry: three additive kinds, nothing else changed", () => {
  it("CALCULATED_VALUE (CHARACTER), SKILL_BENEFIT (SKILL), CONCENTRATION_RULE (ABILITY) at version 1", () => {
    expect(PROWESS_DEFINITION_KINDS.CALCULATED_VALUE).toEqual({ family: "CHARACTER", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(PROWESS_DEFINITION_KINDS.SKILL_BENEFIT).toEqual({ family: "SKILL", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(PROWESS_DEFINITION_KINDS.CONCENTRATION_RULE).toEqual({ family: "ABILITY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
  });
});

describe("RULES-WO1 CALCULATED_VALUE v1", () => {
  it("accepts a labelled test-only value and a value whose base is not stated", () => {
    expect(codes(validateStoredProwessDefinition(stored("CHARACTER", "CALCULATED_VALUE", CARRY)))).toEqual([]);
    expect(codes(validateStoredProwessDefinition(stored("CHARACTER", "CALCULATED_VALUE", THROW)))).toEqual([]);
  });

  it.each([
    ["a non-canonical value must say why", { ...CARRY, note: null }, "/prowessDefinition/payload/note"],
    ["a canonical value must cite its source", { ...CARRY, canonStatus: "CANONICAL", source: null }, "/prowessDefinition/payload/source"],
    ["an undeclared Formula variable", { ...CARRY, base: { ...CARRY.base!, expression: "25 * str + con" } }, "/prowessDefinition/payload/base/variables"],
    ["an unused input", { ...CARRY, base: { ...CARRY.base!, expression: "25" } }, "/prowessDefinition/payload/base/variables"],
    ["an invalid M4 expression", { ...CARRY, base: { ...CARRY.base!, expression: "25 ** str" } }, "/prowessDefinition/payload/base/expression"],
    ["a value reading itself", { ...CARRY, base: { ...CARRY.base!, expression: "c", unit: null, variables: [{ variable: "c", source: { kind: "CALCULATED_VALUE", valueKey: "CARRY_CAPACITY" } }] } }, "/prowessDefinition/payload/base/variables"],
    ["casting AP is not a Character input", { ...CARRY, base: { ...CARRY.base!, expression: "a", unit: null, variables: [{ variable: "a", source: { kind: "CAST_AP" } }] } }, "/prowessDefinition/payload/base/variables/0/source/kind"],
    ["an unknown placement", { ...CARRY, placement: "BACKPACK" }, "/prowessDefinition/payload/placement"],
    ["minimum above maximum", { ...CARRY, base: { ...CARRY.base!, minimum: 10, maximum: 5 } }, "/prowessDefinition/payload/base/maximum"],
  ])("refuses %s", (_label, payload, path) => {
    const out = validateStoredProwessDefinition(stored("CHARACTER", "CALCULATED_VALUE", payload));
    expect(out.ok).toBe(false);
    expect(paths(out)).toContain(path);
  });

  it("refuses an invalid expression with the M4 Formula code", () => {
    expect(codes(validateStoredProwessDefinition(stored("CHARACTER", "CALCULATED_VALUE", { ...CARRY, base: { ...CARRY.base!, expression: "floor(" } })))).toContain(C.INVALID_FORMULA);
  });
});

describe("RULES-WO1 SKILL_BENEFIT v1", () => {
  it("accepts a Skill benefit with a value contribution", () => {
    expect(codes(validateStoredProwessDefinition(stored("SKILL", "SKILL_BENEFIT", benefit())))).toEqual([]);
  });
  it.each([
    ["a benefit of a non-Skill", benefit({ skill: f0.ref("affinity.evocation") }), "/prowessDefinition/payload/skill/definitionKind"],
    ["a granted non-Action", benefit({ grantedActions: [ATHLETICS] }), "/prowessDefinition/payload/grantedActions/0/definitionKind"],
    ["an empty written benefit", benefit({ writtenBenefit: " " }), "/prowessDefinition/payload/writtenBenefit"],
    ["a contribution reading another value", benefit({ contributions: [{ contributionKey: "X", valueKey: "THROW_DISTANCE", amount: { expression: "c", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [{ variable: "c", source: { kind: "CALCULATED_VALUE", valueKey: "CARRY_CAPACITY" } }] }, condition: null }] }), "/prowessDefinition/payload/contributions/0/amount/variables/0/source/kind"],
  ])("refuses %s", (_label, payload, path) => {
    const out = validateStoredProwessDefinition(stored("SKILL", "SKILL_BENEFIT", payload));
    expect(paths(out)).toContain(path);
  });
  it("R08: carries grouped prerequisites (the Action-improvement grammar, ALL / ANY) and refuses malformed ones", () => {
    const groups = [
      { groupKey: "STRONG", mode: "ALL", prerequisites: [{ prerequisiteKey: "STR_3", kind: "STAT_AT_LEAST", stat: "STR", minimum: 3 }, { prerequisiteKey: "LEVEL_2", kind: "LEVEL_AT_LEAST", minimum: 2 }] },
      { groupKey: "TRAINED_ELSEWHERE", mode: "ANY", prerequisites: [{ prerequisiteKey: "SURVIVAL", kind: "SKILL_RANK_AT_LEAST", skillKey: "test.m6wo3.skill.survival", minimumRank: "TRAINED" }, { prerequisiteKey: "STEALTH", kind: "SKILL_RANK_AT_LEAST", skillKey: "test.m6wo3.skill.stealth", minimumRank: "TRAINED" }] },
    ];
    expect(codes(validateStoredProwessDefinition(stored("SKILL", "SKILL_BENEFIT", { ...benefit(), prerequisiteGroups: groups })))).toEqual([]);
    const bad = (g: unknown) => paths(validateStoredProwessDefinition(stored("SKILL", "SKILL_BENEFIT", { ...benefit(), prerequisiteGroups: g })));
    expect(bad([{ groupKey: "G", mode: "ALL", prerequisites: [{ prerequisiteKey: "X", kind: "STAT_AT_LEAST", stat: "LUCK", minimum: 3 }] }])).toContain("/prowessDefinition/payload/prerequisiteGroups/0/prerequisites/0/stat");
    expect(bad([{ groupKey: "G", mode: "SOME", prerequisites: [{ prerequisiteKey: "X", kind: "LEVEL_AT_LEAST", minimum: 2 }] }])).toContain("/prowessDefinition/payload/prerequisiteGroups/0/mode");
    expect(bad([{ groupKey: "G", mode: "ALL", prerequisites: [] }])).toContain("/prowessDefinition/payload/prerequisiteGroups/0/prerequisites");
    // A prerequisite name is unique across the benefit's groups.
    expect(bad([{ groupKey: "A", mode: "ALL", prerequisites: [{ prerequisiteKey: "X", kind: "LEVEL_AT_LEAST", minimum: 2 }] }, { groupKey: "B", mode: "ALL", prerequisites: [{ prerequisiteKey: "X", kind: "LEVEL_AT_LEAST", minimum: 3 }] }])).toContain("/prowessDefinition/payload/prerequisiteGroups/1/prerequisites/0/prerequisiteKey");
  });
  it("R08: a situational addition carries its condition", () => {
    const situational = benefit({ contributions: [{ contributionKey: "THROWING", valueKey: "THROW_DISTANCE", amount: { expression: "5", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [] }, condition: { conditionKey: "WHEN_THROWING_UPHILL", text: "Only when throwing uphill (illustrative)." } }] });
    expect(codes(validateStoredProwessDefinition(stored("SKILL", "SKILL_BENEFIT", situational)))).toEqual([]);
    const blank = { ...situational, contributions: [{ ...situational.contributions[0]!, condition: { conditionKey: "X", text: " " } }] };
    expect(paths(validateStoredProwessDefinition(stored("SKILL", "SKILL_BENEFIT", blank)))).toContain("/prowessDefinition/payload/contributions/0/condition/text");
  });
});

describe("RULES-WO1 CONCENTRATION_RULE v1", () => {
  it("accepts the confirmed override and keeps its open questions", () => {
    const out = validateStoredProwessDefinition(stored("ABILITY", "CONCENTRATION_RULE", CONCENTRATION));
    expect(codes(out)).toEqual([]);
  });
  it("refuses a capacity that reads casting AP and an upkeep that reads a Stat", () => {
    const bad = { ...CONCENTRATION, capacity: CONCENTRATION.sustainedSpellUpkeepAp, sustainedSpellUpkeepAp: CONCENTRATION.capacity };
    const p = paths(validateStoredProwessDefinition(stored("ABILITY", "CONCENTRATION_RULE", bad)));
    expect(p).toContain("/prowessDefinition/payload/capacity/variables/0/source/kind");
    expect(p).toContain("/prowessDefinition/payload/sustainedSpellUpkeepAp/variables/0/source/kind");
  });

  it("preview: RES 6 → capacity 3; a 5 AP cast → 2 AP upkeep; 0 / 1 / 2 points → 2 / 1 / 0 AP payable", () => {
    expect(previewConcentration({ rule: CONCENTRATION, stats: { RES: 6 }, level: null, effects: [] }).capacity).toBe(3);
    for (const [points, payable] of [[0, 2], [1, 1], [2, 0]] as const) {
      const out = previewConcentration({ rule: CONCENTRATION, stats: { RES: 6 }, level: null, effects: [{ label: "Sustained Spell", castAp: 5, assignedPoints: points }] });
      expect(out.effects[0]).toMatchObject({ upkeepAp: 2, coveredAp: 2 - payable, payableAp: payable });
      expect(out.issues).toEqual([]);
    }
  });
  it("preview: upkeep is at least 1 AP; points split across Effects; over-capacity is reported; MP upkeep and Mana Lock remain", () => {
    const out = previewConcentration({ rule: CONCENTRATION, stats: { RES: 6 }, level: null, effects: [{ label: "A", castAp: 1, assignedPoints: 1 }, { label: "B", castAp: 8, assignedPoints: 3 }] });
    expect(out.effects.map((e) => e.upkeepAp)).toEqual([1, 4]);
    expect(out.effects.map((e) => e.payableAp)).toEqual([0, 1]);
    expect(out.issues.map((i) => i.code)).toEqual(["PROWESS_CONCENTRATION.OVER_CAPACITY"]);
    expect(out.mpUpkeepStillPaid).toBe(true);
    expect(out.manaLockStillApplies).toBe(true);
    expect(out.appliesInPlay).toBe(false);
    expect(out.openQuestions).toHaveLength(2);
  });
  it("the old rule (1 + floor(RES / 2), flat 1 AP) gives different numbers — the preview reads the authored rule only", () => {
    const old = { ...CONCENTRATION, capacity: { ...CONCENTRATION.capacity, expression: "1 + floor(res / 2)" }, sustainedSpellUpkeepAp: { ...CONCENTRATION.sustainedSpellUpkeepAp, expression: "1 + 0 * cast_ap" } };
    const out = previewConcentration({ rule: old, stats: { RES: 6 }, level: null, effects: [{ label: "S", castAp: 5, assignedPoints: 0 }] });
    expect(out.capacity).toBe(4);
    expect(out.effects[0]!.upkeepAp).toBe(1);
  });
});

describe("RULES-WO1 evaluation: values, Skill benefits and the Character sheet", () => {
  const ladder = [
    { rankKey: "UNTRAINED", order: 0 },
    { rankKey: "TRAINED", order: 1 },
    { rankKey: "EXPERT", order: 2 },
  ];
  const facts = (rank: string | null) => ({ stats: { STR: 4 }, level: 1, derived: {}, skillRanks: rank === null ? [] : [{ skillEntityId: ATHLETICS.entityId, rankKey: rank }] });
  const values = [
    { definition: null, payload: CARRY },
    { definition: null, payload: THROW },
  ];
  const benefits = [
    { definition: null, payload: benefit() },
    { definition: null, payload: EXPERT_THROW },
  ];

  it("Throw Distance: no base is invented; Trained adds 5 ft per STR; Expert adds a further 5", () => {
    const at = (rank: string | null) => evaluateCalculatedValues({ values, benefits, ladder, facts: facts(rank) }).values.find((v) => v.valueKey === "THROW_DISTANCE")!;
    expect(at(null)).toMatchObject({ baseStated: false, base: null, total: 0 });
    expect(at("TRAINED")).toMatchObject({ baseStated: false, total: 20 });
    expect(at("EXPERT")).toMatchObject({ total: 25 });
    expect(at("EXPERT").contributions.map((c) => [c.benefitKey, c.applies, c.amount])).toEqual([
      ["ATHLETICS_EXPERT_THROW", true, 5],
      ["ATHLETICS_TRAINED_THROW", true, 20],
    ]);
  });

  it("R08: a gated benefit applies only when the caller decided it is eligible; undecided never applies", () => {
    const gated = benefit({ prerequisiteGroups: [{ groupKey: "G", mode: "ALL", prerequisites: [{ prerequisiteKey: "STR_3", kind: "STAT_AT_LEAST", stat: "STR", minimum: 3 }] }] });
    const at = (eligibility?: Map<string, "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED">) => evaluateCalculatedValues({ values, benefits: [{ definition: null, payload: gated }], ladder, facts: facts("TRAINED"), eligibility });
    expect(at(new Map([["ATHLETICS_TRAINED_THROW", "ELIGIBLE"]])).values.find((v) => v.valueKey === "THROW_DISTANCE")!.total).toBe(20);
    expect(at(new Map([["ATHLETICS_TRAINED_THROW", "INELIGIBLE"]])).values.find((v) => v.valueKey === "THROW_DISTANCE")!.total).toBe(0);
    const undecided = at();
    expect(undecided.values.find((v) => v.valueKey === "THROW_DISTANCE")!.contributions[0]).toMatchObject({ applies: false, eligibility: "UNRESOLVED" });
    expect(undecided.issues.map((i) => i.code)).toEqual([V.PREREQUISITES_NOT_EVALUATED]);
  });

  it("R08: a conditional bonus is computed and shown with its condition, never added to the total", () => {
    const situational = benefit({ benefitKey: "ATHLETICS_UPHILL", contributions: [{ contributionKey: "UPHILL", valueKey: "THROW_DISTANCE", amount: { expression: "5", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [] }, condition: { conditionKey: "UPHILL", text: "Only uphill." } }] });
    const out = evaluateCalculatedValues({ values, benefits: [{ definition: null, payload: benefit() }, { definition: null, payload: situational }], ladder, facts: facts("TRAINED") });
    const t = out.values.find((v) => v.valueKey === "THROW_DISTANCE")!;
    expect(t.total).toBe(20);
    expect(t.contributions.map((c) => [c.benefitKey, c.applies, c.amount, c.condition?.conditionKey ?? null])).toEqual([
      ["ATHLETICS_TRAINED_THROW", true, 20, null],
      ["ATHLETICS_UPHILL", true, 5, "UPHILL"],
    ]);
  });

  it("a value reading another value is evaluated after it; a cycle is refused, not broken", () => {
    const half: CalculatedValuePayload = { ...CARRY, valueKey: "HALF_LOAD", placement: "ADDITIONAL_VALUES", base: { expression: "c / 2", rounding: "FLOOR", minimum: null, maximum: null, unit: null, variables: [{ variable: "c", source: { kind: "CALCULATED_VALUE", valueKey: "CARRY_CAPACITY" } }] } };
    const ok = evaluateCalculatedValues({ values: [{ definition: null, payload: half }, ...values], benefits: [], ladder, facts: facts(null) });
    expect(ok.values.find((v) => v.valueKey === "HALF_LOAD")!.total).toBe(50);
    const a: CalculatedValuePayload = { ...half, valueKey: "A", base: { ...half.base!, unit: null, variables: [{ variable: "c", source: { kind: "CALCULATED_VALUE", valueKey: "B" } }] } };
    const b: CalculatedValuePayload = { ...half, valueKey: "B", base: { ...half.base!, unit: null, variables: [{ variable: "c", source: { kind: "CALCULATED_VALUE", valueKey: "A" } }] } };
    const cyc = evaluateCalculatedValues({ values: [{ definition: null, payload: a }, { definition: null, payload: b }], benefits: [], ladder, facts: facts(null) });
    expect(cyc.values.map((v) => v.total)).toEqual([null, null]);
    expect(cyc.issues.map((i) => i.code)).toEqual([V.DEPENDENCY_CYCLE, V.DEPENDENCY_CYCLE]);
  });

  it("a missing input makes the value unavailable — never zero", () => {
    const out = evaluateCalculatedValues({ values, benefits: [], ladder, facts: { ...facts(null), stats: {} } });
    expect(out.values.find((v) => v.valueKey === "CARRY_CAPACITY")).toMatchObject({ total: null, unavailable: "STR is not available for this Character" });
  });

  const rows = (): FixtureRow[] => [
    { canonicalKey: "test.rules_wo1.value.carry_capacity", definitionKind: "CALCULATED_VALUE", schemaVersion: 1, payload: CARRY as unknown as Record<string, unknown> },
    { canonicalKey: "test.rules_wo1.value.throw_distance", definitionKind: "CALCULATED_VALUE", schemaVersion: 1, payload: THROW as unknown as Record<string, unknown> },
    { canonicalKey: "test.rules_wo1.benefit.athletics_trained_throw", definitionKind: "SKILL_BENEFIT", schemaVersion: 1, payload: benefit() as unknown as Record<string, unknown> },
  ];
  const profileOf = (f: AdvancementFixture): CharacterMechanicalProfile => {
    const built = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level: 1, history: [] } });
    expect(built.issues).toEqual([]);
    return built.profile as CharacterMechanicalProfile;
  };

  it("the sheet shows the published Carry value in the Carry slot and lists every calculated value", () => {
    const f = advancementFixture({ extra: rows() });
    const profile = profileOf(f);
    const str = profile.stats.find((s) => s.stat === "STR")!.final;
    const sheet = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile });
    expect(sheet.carry.maximumLoad).toMatchObject({ value: 25 * str, unit: "lb", unavailable: null });
    expect(sheet.carry.maximumLoad.source?.canonicalKey).toBe("test.rules_wo1.value.carry_capacity");
    expect(sheet.calculatedValues?.map((v) => [v.valueKey, v.canonStatus, v.total])).toEqual([
      ["CARRY_CAPACITY", "TEST_ONLY", 25 * str],
      ["THROW_DISTANCE", "OWNER_PROVIDED", 5 * str],
    ]);
    expect(sheet.issues).toEqual([]);
  });

  it("R08: eligible and ineligible Characters — prerequisite groups decide each benefit; Action grants reach the sheet and the Action Directory", () => {
    const sprint = f0.ref("action.sprint");
    const grant = (key: string, rank: string, groups: unknown[]): FixtureRow => ({ canonicalKey: `test.rules_wo1.benefit.${key.toLowerCase()}`, definitionKind: "SKILL_BENEFIT", schemaVersion: 1, payload: { ...benefit({ benefitKey: key, minimumRankKey: rank, grantedActions: [sprint] }), contributions: [], prerequisiteGroups: groups } as unknown as Record<string, unknown> });
    const strAtLeast = (n: number) => ({ prerequisiteKey: `STR_${n}`, kind: "STAT_AT_LEAST", stat: "STR", minimum: n });
    const f = advancementFixture({ extra: [...rows(), grant("EASY", "TRAINED", [{ groupKey: "G", mode: "ALL", prerequisites: [strAtLeast(1)] }]), grant("HARD", "TRAINED", [{ groupKey: "G", mode: "ALL", prerequisites: [strAtLeast(99)] }]), grant("EITHER", "TRAINED", [{ groupKey: "G", mode: "ANY", prerequisites: [strAtLeast(99), { prerequisiteKey: "LEVEL_1", kind: "LEVEL_AT_LEAST", minimum: 1 }] }]), grant("EXPERT_ONLY", "EXPERT", [])] });
    const profile = profileOf(f);
    const sheet = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile });
    const byKey = Object.fromEntries((sheet.skillBenefits ?? []).map((b) => [b.benefitKey, b]));
    expect(byKey.EASY).toMatchObject({ rankMet: true, eligibility: "ELIGIBLE", status: "GRANTED" });
    expect(byKey.HARD).toMatchObject({ rankMet: true, eligibility: "INELIGIBLE", status: "INELIGIBLE" });
    expect(byKey.HARD!.groups[0]!.prerequisites[0]).toMatchObject({ prerequisiteKey: "STR_99", satisfied: false });
    expect(byKey.EITHER).toMatchObject({ eligibility: "ELIGIBLE", status: "GRANTED" });
    expect(byKey.EXPERT_ONLY).toMatchObject({ rankMet: false, status: "RANK_NOT_REACHED" });
    expect(byKey.EASY!.grantedActions).toEqual([{ action: sprint, state: "PINNED", actionKey: expect.any(String) }]);
    const card = buildActionDirectory({ bundle: f.bundle, profile, context: { characterId: "00000000-0000-4000-8000-0000000000c1", characterReleaseId: "00000000-0000-4000-8000-0000000000a1", rulesetProvenance: f.bundle.rulesetProvenance, names: {} } }).cards.find((c) => c.section.action.entityId === sprint.entityId)!;
    expect(card.section.grantedBySkills?.map((g) => [g.benefitKey, g.status])).toEqual([["EASY", "GRANTED"], ["EITHER", "GRANTED"], ["EXPERT_ONLY", "RANK_NOT_REACHED"], ["HARD", "INELIGIBLE"]]);
    // The earlier Release (no Skill benefits): no skillBenefits key and the same card without grants.
    const earlier = advancementFixture();
    const earlierProfile = profileOf(earlier);
    expect("skillBenefits" in buildCharacterSheetMechanics({ bundle: earlier.bundle, ruleset: earlier.ruleset, profile: earlierProfile })).toBe(false);
    const earlierCard = buildActionDirectory({ bundle: earlier.bundle, profile: earlierProfile, context: { characterId: "00000000-0000-4000-8000-0000000000c1", characterReleaseId: "00000000-0000-4000-8000-0000000000a1", rulesetProvenance: earlier.bundle.rulesetProvenance, names: {} } }).cards.find((c) => c.section.actionKey === card.section.actionKey)!;
    expect("grantedBySkills" in earlierCard.section).toBe(false);
  });

  it("without published values the sheet is exactly as before (no calculatedValues key; Carry unavailable)", () => {
    const f = advancementFixture();
    const sheet = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile: profileOf(f) });
    expect("calculatedValues" in sheet).toBe(false);
    expect(sheet.carry.maximumLoad.unavailable).toBe("Carry & Weight: this Release defines no rule for it yet");
  });
});
