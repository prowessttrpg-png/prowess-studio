import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_ERROR_CODES as E,
  buildCharacterMechanicalProfile,
  buildCharacterSheetMechanics,
  previewCharacterAdvancement,
  validateSheetPlayState,
  type AdvancementChoices,
  type CharacterMechanicalProfile,
  type CommittedAdvancement,
} from "./index";
import { advancementFixture, type AdvancementFixture } from "./testing/advancement-fixtures";
import type { FixtureRow } from "./testing/character-fixtures";

/**
 * PAS-10 M6-WO5 §109–§113 — the mechanical Character Sheet is a read-only projection of the ONE
 * CharacterMechanicalProfile (M6-WO4) under the Character's exact Release: Stat totals and Saves, Core Values & Combat,
 * resource maximums, Skill scores with T / E / M markers (every Release Skill, Performance included when pinned),
 * Affinity Strengths / Weaknesses / Authority, and fail-closed play-state validation.
 * Invariants: M6-I045 the sheet consumes the canonical profile · M6-I046 derived values are read-only projections ·
 * M6-I052 exact-Release scope.
 */
const none: AdvancementChoices = { statAllocations: {}, skillAdvancements: [], affinityChoice: null };
const performance: FixtureRow = { canonicalKey: "test.m6wo5.skill.performance", definitionKind: "SKILL", schemaVersion: 1, payload: { ladderKey: "SKILL", source: { locators: ["s29"], conflicts: [] } } };

function profileAfter(f: AdvancementFixture, choices: readonly AdvancementChoices[]): CharacterMechanicalProfile {
  const history: CommittedAdvancement[] = [];
  let level = 1;
  for (const c of choices) {
    const p = previewCharacterAdvancement({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level, history }, choices: c });
    expect(p.issues).toEqual([]);
    history.push(p.record as CommittedAdvancement);
    level = p.toLevel as number;
  }
  const built = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level, history } });
  expect(built.issues).toEqual([]);
  return built.profile as CharacterMechanicalProfile;
}
const L6 = (f: AdvancementFixture): AdvancementChoices[] => [
  { ...none, statAllocations: { PER: 1 } },
  { ...none, statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "TRAIN_NEW", skill: f.sel("skill.arcana") }] },
  { ...none, statAllocations: { AGI: 1 } },
  { ...none, statAllocations: { CON: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: f.sel("skill.arcana") }] },
  { statAllocations: { RES: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: f.sel("skill.arcana") }], affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: f.sel("affinity.conjuration") } },
];

describe("M6-WO5 mechanical sheet (§16–§30, M6-I045, M6-I046)", () => {
  const f = advancementFixture({ extra: [performance] });
  const profile = profileAfter(f, []);
  const sheet = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile });

  it("Stat totals are the profile's; each Save is the Release's SAVING_THROW total without the die (no Studio arithmetic)", () => {
    expect(sheet.issues).toEqual([]);
    expect(sheet.stats.map((s) => s.stat)).toEqual(["STR", "AGI", "CON", "PER", "RES", "PRO"]);
    for (const s of sheet.stats) {
      expect(s.total).toBe(profile.stats.find((x) => x.stat === s.stat)?.final);
      // The published Saving Throw total is natural + chosen Stat + bonuses (no bonuses here).
      expect(s.savingThrow.value).toBe(s.total);
      expect(s.savingThrow.source?.canonicalKey).toBe("core.resolution.saving_throw");
    }
  });

  it("Core Values & Combat read the profile's derived values; Initiative runs the INITIATIVE procedure", () => {
    const d = (k: string) => profile.derivedStatistics.find((x) => x.statistic === k)?.value;
    const c = sheet.combat;
    expect(c.characterDie).toEqual(profile.characterDie);
    expect([c.characterDc.value, c.accuracy.value, c.armor.value, c.dodge.value, c.movement.value, c.range.value]).toEqual([d("CHARACTER_DC"), d("ACCURACY"), d("STRENGTH_ARMOR"), d("DODGE"), d("MOVEMENT"), d("BASE_RANGE")]);
    expect([c.movement.unit, c.range.unit]).toEqual(["ft", "ft"]);
    const stat = (s: string) => profile.stats.find((x) => x.stat === s)?.final as number;
    expect(c.initiative.value).toBe(stat("PER") / 2 + stat("AGI") / 2); // the published total minus the die
    expect(c.initiative.source?.canonicalKey).toBe("core.resolution.initiative");
  });

  it("values the Release defines no rule for are unavailable with a reason, never guessed", () => {
    for (const v of [sheet.combat.concentration.maximum, sheet.attunement.maximum, sheet.attunement.used, sheet.carry.currentWeight, sheet.carry.maximumLoad]) {
      expect(v.value).toBeNull();
      expect(v.unavailable).toMatch(/defines no rule/);
    }
  });

  it("resources are the RESOURCE Definitions with a derived maximum; maximums come from the profile", () => {
    const keys = sheet.resources.map((r) => r.resourceKey).sort();
    expect(keys).toEqual(["AP", "COUNTER_ACTION", "HP", "ME", "MP"]);
    for (const r of sheet.resources) {
      expect(r.maximum).toBe(profile.derivedStatistics.find((d) => d.statistic === r.maximumSource)?.value);
      expect(r.minimum).toBe(0);
    }
  });

  it("every Release Skill appears (Performance included) with its rank's published bonus and T / E / M markers", () => {
    const names = sheet.skills.map((s) => s.skill.canonicalKey);
    expect(names).toContain("test.m6wo5.skill.performance");
    const perf = sheet.skills.find((s) => s.skill.canonicalKey === "test.m6wo5.skill.performance");
    expect(perf).toMatchObject({ rankKey: "UNTRAINED", score: 0, attemptAllowed: false, ranks: [{ rankKey: "TRAINED", held: false }, { rankKey: "EXPERT", held: false }, { rankKey: "MASTER", held: false }] });
    const athletics = sheet.skills.find((s) => s.skill.canonicalKey === "test.m6wo3.skill.athletics");
    expect(athletics).toMatchObject({ rankKey: "TRAINED", score: 2, ranks: [{ rankKey: "TRAINED", held: true }, { rankKey: "EXPERT", held: false }, { rankKey: "MASTER", held: false }] });
  });
});

describe("M6-WO5 advanced Character sheet (§113, §117)", () => {
  const f = advancementFixture();
  const profile = profileAfter(f, L6(f));
  const sheet = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile });

  it("reflects the advanced profile: Level 6 die, Arcana MASTER (score and markers), a second Affinity", () => {
    expect(sheet.combat.characterDie).toEqual(profile.characterDie);
    const arcana = sheet.skills.find((s) => s.skill.canonicalKey === f.ref("skill.arcana").canonicalKey);
    expect(arcana).toMatchObject({ rankKey: "MASTER", score: 6, ranks: [{ held: true }, { held: true }, { held: true }] });
    expect(sheet.affinities.map((a) => [a.role, a.rank])).toEqual([
      ["PRIMARY", "TRAINED"],
      ["SECONDARY", "TRAINED"],
    ]);
  });

  it("Affinity Strengths / Weaknesses are the exact pinned AFFINITY payloads; Authority from the access summary", () => {
    for (const a of sheet.affinities) {
      const envelope = f.bundle.definitions.find((d) => d.entityVersionId === a.affinity.entityVersionId);
      const payload = envelope?.payload as { strengths: unknown[]; weaknesses: unknown[] };
      expect(a.strengths).toEqual(payload.strengths);
      expect(a.weaknesses).toEqual(payload.weaknesses);
      expect(a.strengths.length + a.weaknesses.length).toBeGreaterThan(3);
      expect(a.authority).toMatchObject({ minimumRank: expect.any(String), eligible: expect.any(Boolean) });
    }
  });

  it("is deterministic and leaves the profile untouched", () => {
    const again = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile });
    expect(again).toEqual(sheet);
    expect(Object.isFrozen(sheet)).toBe(true);
  });
});

describe("M6-WO5 play-state validation (§31–§33, §86, M6-I047)", () => {
  const f = advancementFixture();
  const profile = profileAfter(f, []);
  const { resources } = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile });
  const max = (k: string) => resources.find((r) => r.resourceKey === k)?.maximum as number;
  const codes = (values: unknown) => validateSheetPlayState({ resources, values }).map((i) => i.code);

  it("accepts whole numbers within [minimum, derived maximum] for any subset of the sheet resources", () => {
    expect(codes({ HP: 0, MP: max("MP"), AP: 1, COUNTER_ACTION: 0, ME: max("ME") })).toEqual([]);
    expect(codes({ HP: max("HP") })).toEqual([]);
  });

  it("fails closed: no overheal, no negative, no fractions, no unknown or derived keys", () => {
    expect(codes({ HP: max("HP") + 1 })).toEqual([E.ABOVE_MAXIMUM]);
    expect(codes({ AP: -1 })).toEqual([E.BELOW_MINIMUM]);
    expect(codes({ MP: 1.5 })).toEqual([E.NOT_A_WHOLE_NUMBER]);
    expect(codes({ MAXIMUM_HP: 99, MOVEMENT_ALLOWANCE: 3 })).toEqual([E.NOT_A_SHEET_RESOURCE, E.NOT_A_SHEET_RESOURCE]);
    expect(codes([1, 2])).toEqual([E.NOT_A_SHEET_RESOURCE]);
  });
});
