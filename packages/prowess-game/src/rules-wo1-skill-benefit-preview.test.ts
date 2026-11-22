import { describe, expect, it } from "vitest";
import {
  authoredValuesOf,
  benefitEligibilityOf,
  buildCharacterMechanicalProfile,
  calculatedValuesForCharacter,
  evaluateCalculatedValues,
  indexCoreDefinitions,
  skillBenefitsForCharacter,
  skillBenefitsForSample,
  type CharacterMechanicalProfile,
  type SkillBenefitSample,
} from "./index.js";
import { advancementFixture, type AdvancementFixture } from "./testing/advancement-fixtures.js";
import { characterFixture, type FixtureRow } from "./testing/character-fixtures.js";

/**
 * RULES-WO1 Phase F (R08) — the authoring preview of Skill benefits uses EXACTLY the Character sheet's evaluation. A
 * sample built from a real Character's profile (Level, final Stats, Skill ranks, Affinity ranks) gives the same benefit
 * results — rank, ALL / ANY prerequisite groups, Affinity-rank prerequisites, granted Actions — and the same calculated
 * values as that Character's sheet. Inputs a sample leaves out are reported, and read exactly as for a Character.
 */
const CARRY = {
  valueKey: "CARRY_CAPACITY",
  unit: "lb",
  canonStatus: "TEST_ONLY",
  placement: "CARRY_MAXIMUM_LOAD",
  base: { expression: "25 * str", rounding: "NONE", minimum: 0, maximum: null, unit: null, variables: [{ variable: "str", source: { kind: "STAT", stat: "STR" } }] },
  note: "Test-only placeholder: the Core Playtest packet states no Carry Capacity formula.",
  source: null,
};
const THROW = { valueKey: "THROW_DISTANCE", unit: "ft", canonStatus: "OWNER_PROVIDED", placement: "ADDITIONAL_VALUES", base: null, note: "The base is not stated in the source.", source: null };
const probe = characterFixture();
const ATHLETICS = probe.ref("test.m6wo3.skill.athletics");
const EVOCATION = probe.ref("affinity.evocation");
const CONJURATION = probe.ref("affinity.conjuration");
const SPRINT = probe.ref("action.sprint");

const grant = (key: string, rank: string, groups: unknown[], contributions: unknown[] = []): FixtureRow => ({
  canonicalKey: `test.rules_wo1f.benefit.${key.toLowerCase()}`,
  definitionKind: "SKILL_BENEFIT",
  schemaVersion: 1,
  payload: { benefitKey: key, skill: ATHLETICS, minimumRankKey: rank, writtenBenefit: `${key} benefit`, contributions, grantedActions: [SPRINT], prerequisiteGroups: groups, source: { locators: ["s52"], conflicts: [] } },
});
const stat = (n: number) => ({ prerequisiteKey: `STR_${n}`, kind: "STAT_AT_LEAST", stat: "STR", minimum: n });
const level = (n: number) => ({ prerequisiteKey: `LEVEL_${n}`, kind: "LEVEL_AT_LEAST", minimum: n });
const affinity = (ref: typeof EVOCATION, key: string, rank: string) => ({ prerequisiteKey: `${key}_${rank}`, kind: "AFFINITY_RANK_AT_LEAST", affinity: ref, minimumRank: rank });
const skillRank = (rank: string) => ({ prerequisiteKey: `ATHLETICS_${rank}`, kind: "SKILL_RANK_AT_LEAST", skillKey: ATHLETICS.canonicalKey, minimumRank: rank });
const throwBonus = [{ contributionKey: "THROW_BONUS", valueKey: "THROW_DISTANCE", amount: { expression: "5", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [] }, condition: null }];

const ROWS: FixtureRow[] = [
  { canonicalKey: "test.rules_wo1f.value.carry", definitionKind: "CALCULATED_VALUE", schemaVersion: 1, payload: CARRY },
  { canonicalKey: "test.rules_wo1f.value.throw", definitionKind: "CALCULATED_VALUE", schemaVersion: 1, payload: THROW },
  grant("EVOCATION_GATED", "TRAINED", [{ groupKey: "AFFINITY", mode: "ALL", prerequisites: [affinity(EVOCATION, "EVOCATION", "NONE")] }], throwBonus),
  grant("CONJURATION_GATED", "TRAINED", [{ groupKey: "AFFINITY", mode: "ALL", prerequisites: [affinity(CONJURATION, "CONJURATION", "TRAINED")] }], throwBonus),
  grant("ANY_OF", "TRAINED", [{ groupKey: "EITHER", mode: "ANY", prerequisites: [stat(99), affinity(EVOCATION, "EVOCATION", "NONE")] }]),
  grant("ALL_OF", "TRAINED", [{ groupKey: "BOTH", mode: "ALL", prerequisites: [level(1), stat(99)] }]),
  grant("TWO_GROUPS", "TRAINED", [
    { groupKey: "FIRST", mode: "ALL", prerequisites: [level(1), skillRank("TRAINED")] },
    { groupKey: "SECOND", mode: "ANY", prerequisites: [stat(1), stat(99)] },
  ]),
  grant("EXPERT_ONLY", "EXPERT", []),
];

function world(): { f: AdvancementFixture; profile: CharacterMechanicalProfile } {
  const f = advancementFixture({ extra: ROWS });
  const built = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level: 1, history: [] } });
  expect(built.issues).toEqual([]);
  return { f, profile: built.profile as CharacterMechanicalProfile };
}
/** The sample a preview author would enter for this Character. */
const sampleOf = (p: CharacterMechanicalProfile): SkillBenefitSample => ({
  level: p.level,
  stats: Object.fromEntries(p.stats.map((s) => [s.stat, s.final])),
  skillRanks: p.skills.map((s) => ({ skillEntityId: s.skill.entityId, rankKey: s.rankKey })),
  affinityRanks: p.affinities.map((a) => ({ affinityEntityId: a.affinity.entityId, rankKey: a.rank })),
});

describe("RULES-WO1 Phase F: the Skill-benefit preview agrees with the Character sheet", () => {
  it("a sample of a real Character gives the sheet's benefit results: eligible and ineligible, ALL / ANY groups, Affinity ranks, granted Actions", () => {
    const { f, profile } = world();
    const sheet = skillBenefitsForCharacter({ bundle: f.bundle, profile });
    const preview = skillBenefitsForSample({ bundle: f.bundle, sample: sampleOf(profile) });
    expect(preview.problems).toEqual([]);
    expect(preview.benefits).toEqual(sheet);
    const status = Object.fromEntries(preview.benefits.map((b) => [b.benefitKey, b.status]));
    // The worked Character holds Athletics (Trained) and Evocation (its primary Affinity, at its first rank), and not Conjuration.
    expect(status).toEqual({ ALL_OF: "INELIGIBLE", ANY_OF: "GRANTED", CONJURATION_GATED: "INELIGIBLE", EVOCATION_GATED: "GRANTED", EXPERT_ONLY: "RANK_NOT_REACHED", TWO_GROUPS: "GRANTED" });
    const byKey = Object.fromEntries(preview.benefits.map((b) => [b.benefitKey, b]));
    expect(byKey.ANY_OF!.groups[0]!.prerequisites.map((q) => q.satisfied)).toEqual([false, true]);
    expect(byKey.ALL_OF!.groups[0]!.prerequisites.map((q) => q.satisfied)).toEqual([true, false]);
    expect(byKey.TWO_GROUPS!.groups.map((g) => [g.groupKey, g.mode, g.satisfied])).toEqual([["FIRST", "ALL", true], ["SECOND", "ANY", true]]);
    expect(byKey.EVOCATION_GATED!.grantedActions).toEqual([{ action: SPRINT, state: "PINNED", actionKey: expect.any(String) }]);
    // Every input the benefits read was supplied, except Conjuration, which this Character does not own: reported, and
    // read as not owned — the sheet's own reading.
    expect(preview.inputs.filter((i) => !i.supplied).map((i) => [i.input, i.subject?.canonicalKey, i.readAs])).toEqual([["AFFINITY_RANK", CONJURATION.canonicalKey, "NOT_OWNED"]]);
  });

  it("the calculated values gated by those benefits match the sheet exactly (an ineligible benefit adds nothing)", () => {
    const { f, profile } = world();
    const sheet = calculatedValuesForCharacter({ bundle: f.bundle, profile });
    const preview = skillBenefitsForSample({ bundle: f.bundle, sample: sampleOf(profile) });
    const { values, benefits } = authoredValuesOf(f.bundle);
    const core = indexCoreDefinitions(f.bundle);
    const ladder = core.ok ? core.value.skillLadder.payload.ranks : [];
    const derived = Object.fromEntries(profile.derivedStatistics.map((d) => [d.statistic, d.value]));
    const facts = { stats: sampleOf(profile).stats, level: profile.level, derived, skillRanks: sampleOf(profile).skillRanks };
    const fromPreview = evaluateCalculatedValues({ values, benefits, ladder, facts, eligibility: benefitEligibilityOf(preview.benefits) });
    expect(fromPreview).toEqual(sheet);
    const throwing = fromPreview.values.find((v) => v.valueKey === "THROW_DISTANCE")!;
    expect(throwing.contributions.filter((c) => c.contributionKey === "THROW_BONUS").map((c) => [c.benefitKey, c.applies])).toEqual([["CONJURATION_GATED", false], ["EVOCATION_GATED", true]]);
    // Without the eligibility (the defect this fixes) both gated bonuses are undecided and neither applies — not the sheet.
    expect(evaluateCalculatedValues({ values, benefits, ladder, facts })).not.toEqual(sheet);
  });

  it("an input the sample leaves out is reported specifically and read exactly as for a Character (untrained / not owned)", () => {
    const { f, profile } = world();
    const full = sampleOf(profile);
    const preview = skillBenefitsForSample({ bundle: f.bundle, sample: { ...full, affinityRanks: [], skillRanks: [] } });
    const missing = preview.inputs.filter((i) => !i.supplied).map((i) => [i.input, i.subject?.canonicalKey ?? null, i.readAs]);
    expect(missing).toEqual(
      expect.arrayContaining([
        ["SKILL_RANK", ATHLETICS.canonicalKey, "UNTRAINED_FIRST_RANK"],
        ["AFFINITY_RANK", EVOCATION.canonicalKey, "NOT_OWNED"],
        ["AFFINITY_RANK", CONJURATION.canonicalKey, "NOT_OWNED"],
      ]),
    );
    expect(Object.fromEntries(preview.benefits.map((b) => [b.benefitKey, b.status]))).toMatchObject({ EVOCATION_GATED: "RANK_NOT_REACHED", ANY_OF: "RANK_NOT_REACHED" });
    // Raising the sample's Conjuration rank (an input only the sample supplies) turns that benefit on; nothing else moves.
    const withConjuration = skillBenefitsForSample({ bundle: f.bundle, sample: { ...full, affinityRanks: [...full.affinityRanks, { affinityEntityId: CONJURATION.entityId, rankKey: "TRAINED" }] } });
    expect(withConjuration.benefits.find((b) => b.benefitKey === "CONJURATION_GATED")!.status).toBe("GRANTED");
  });

  it("a sample naming content this Release does not pin is reported, never silently dropped", () => {
    const { f, profile } = world();
    const preview = skillBenefitsForSample({ bundle: f.bundle, sample: { ...sampleOf(profile), affinityRanks: [{ affinityEntityId: "00000000-0000-4000-8000-00000000dead", rankKey: "TRAINED" }] } });
    expect(preview.problems).toEqual([expect.stringMatching(/does not pin as an executable Affinity/)]);
  });
});
