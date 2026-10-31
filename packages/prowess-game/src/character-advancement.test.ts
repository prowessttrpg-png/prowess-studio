import { describe, expect, it } from "vitest";
import {
  CHARACTER_ADVANCEMENT_ERROR_CODES as E,
  buildCharacterMechanicalProfile,
  getCharacterCapability,
  previewCharacterAdvancement,
  type AdvancementChoices,
  type CharacterMechanicalProfile,
  type CommittedAdvancement,
} from "./character/advancement";
import { characterAccessSummary, evaluateComponentEligibility, listComponentEligibility } from "./character/eligibility";
import { readStoredProwessDefinition } from "./definition/storage";
import { PROWESS_DEFINITION_KINDS } from "./vocabulary/families";
import { ADVANCEMENT_RULE_KEY, PLAYTEST_ADVANCEMENT_LEVELS, advancementFixture, advancementRulePayload, type AdvancementFixture } from "./testing/advancement-fixtures";

/**
 * PAS-10 M6-WO4 — Character advancement, the CharacterMechanicalProfile and Character access / eligibility (pure layer).
 * Invariants: M6-I031 exact Release · M6-I032 one Level at a time · M6-I033 entitlements are content · M6-I034 creation
 * immutable · M6-I036 Stats · M6-I037 Skill ranks · M6-I038 Affinity profile · M6-I039 derived values recalculated ·
 * M6-I040 M5 prerequisites reused · M6-I041 eligibility ≠ legality · M6-I042 no Rules Text · M6-I044 one profile builder.
 */
/**
 * Per-test ceiling for the cases that replay a long progression (Levels 6, 9 and 10 rebuild and M5-validate every
 * earlier Level). They run ~5 s on slower CI runners, just over Vitest's 5 s default; 15 s gives runner headroom while
 * still catching a hang or a major performance regression. Every other test keeps the default.
 */
const HEAVY_ADVANCEMENT_TEST_TIMEOUT_MS = 15_000;
const none: AdvancementChoices = { statAllocations: {}, skillAdvancements: [], affinityChoice: null };
const stats = (s: Record<string, number>): AdvancementChoices => ({ ...none, statAllocations: s });
const train = (f: AdvancementFixture, key: string) => ({ action: "TRAIN_NEW", skill: f.sel(key) });
const upgrade = (f: AdvancementFixture, key: string) => ({ action: "UPGRADE", skill: f.sel(key) });

/** The scripted progression L2 → L10 used across the suite (choices only; levels are the server's). */
function script(f: AdvancementFixture, l6: "PRIMARY_EXPERT" | "GAIN_SECONDARY_TRAINED" = "PRIMARY_EXPERT", l9: "GAIN_NEW_AFFINITY" | "UPGRADE_AFFINITY_RANK" | "PROMOTE_EXPERT_TO_MASTER" = "GAIN_NEW_AFFINITY"): AdvancementChoices[] {
  return [
    stats({ PER: 1 }),
    { ...stats({ PRO: 1 }), skillAdvancements: [train(f, "skill.arcana")] },
    stats({ AGI: 1 }),
    { ...stats({ CON: 1 }), skillAdvancements: [upgrade(f, "skill.arcana")] },
    { ...stats({ RES: 1 }), skillAdvancements: [upgrade(f, "test.m6wo3.skill.athletics")], affinityChoice: l6 === "PRIMARY_EXPERT" ? { optionKey: l6, affinity: null } : { optionKey: l6, affinity: f.sel("affinity.conjuration") } },
    stats({ STR: 1 }),
    { ...stats({ STR: 1 }), skillAdvancements: [upgrade(f, "skill.arcana")] },
    {
      ...stats({ STR: 1 }),
      skillAdvancements: [train(f, "test.m6wo3.skill.survival")],
      affinityChoice: l9 === "GAIN_NEW_AFFINITY" ? { optionKey: l9, affinity: f.sel("affinity.divination") } : { optionKey: l9, affinity: f.sel(l9 === "PROMOTE_EXPERT_TO_MASTER" ? "affinity.evocation" : "affinity.conjuration") },
    },
    { ...stats({ STR: 1, PRO: 1 }), skillAdvancements: [upgrade(f, "test.m6wo3.skill.stealth")] },
  ];
}

/** Advances through `choices` one Level at a time via previews, returning the committed history. */
function advance(f: AdvancementFixture, choices: readonly AdvancementChoices[]): { history: CommittedAdvancement[]; level: number } {
  const history: CommittedAdvancement[] = [];
  let level = 1;
  for (const c of choices) {
    const preview = previewCharacterAdvancement({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level, history }, choices: c });
    expect(preview.issues, `Level ${level} → ${preview.toLevel}`).toEqual([]);
    expect(preview.status).toBe("READY");
    history.push(preview.record as CommittedAdvancement);
    level = preview.toLevel as number;
  }
  return { history, level };
}
const profileAt = (f: AdvancementFixture, n: number, l6?: Parameters<typeof script>[1], l9?: Parameters<typeof script>[2]): CharacterMechanicalProfile => {
  const { history, level } = advance(f, script(f, l6, l9).slice(0, n));
  const out = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level, history } });
  expect(out.issues).toEqual([]);
  return out.profile as CharacterMechanicalProfile;
};
const derived = (p: CharacterMechanicalProfile, s: string) => p.derivedStatistics.find((d) => d.statistic === s)?.value;
const stat = (p: CharacterMechanicalProfile, s: string) => p.stats.find((x) => x.stat === s)?.final;
const skillRank = (p: CharacterMechanicalProfile, key: string) => p.skills.find((s) => s.skill.canonicalKey === key)?.rankKey;
const preview = (f: AdvancementFixture, n: number, choices: unknown) => {
  const { history, level } = advance(f, script(f).slice(0, n));
  return previewCharacterAdvancement({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level, history }, choices });
};
const codes = (p: { issues: readonly { code: string }[] }) => p.issues.map((i) => i.code);

describe("M6-WO4 CHARACTER_ADVANCEMENT_RULE contract (M6-I033)", () => {
  it("is a CHARACTER kind at schema version 1; the payload reader fails closed", () => {
    expect(PROWESS_DEFINITION_KINDS.CHARACTER_ADVANCEMENT_RULE).toEqual({ family: "CHARACTER", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    const f = advancementFixture();
    const read = (payload: unknown) => readStoredProwessDefinition({ ruleset: f.ruleset, rule: f.ruleset.rules[0]!, structuredData: { prowessDefinition: { schemaVersion: 1, systemFamily: "CHARACTER", definitionKind: "CHARACTER_ADVANCEMENT_RULE", payload } } });
    expect(read(advancementRulePayload()).ok).toBe(true);
    expect(read({ ...advancementRulePayload(), characterDie: [] }).ok).toBe(false);
    expect(read(advancementRulePayload([{ level: 3, statPoints: 1, skillAdvancements: 0 }, { level: 2, statPoints: 1, skillAdvancements: 0 }])).ok).toBe(false);
    expect(read(advancementRulePayload([{ level: 2, statPoints: -1, skillAdvancements: 0 }])).ok).toBe(false);
    expect(read(advancementRulePayload([{ level: 2, statPoints: 1.5, skillAdvancements: 0 }])).ok).toBe(false);
    expect(read(advancementRulePayload([])).ok).toBe(false);
  });

  it("capability distinguishes creation-ready from advancement-ready and lists every missing requirement (§91–§92)", () => {
    expect(getCharacterCapability(advancementFixture().bundle).advancement).toEqual({ status: "ADVANCEMENT_READY", missing: [] });
    const missing = getCharacterCapability(advancementFixture({ omitAdvancementRule: true }).bundle);
    expect(missing.creation.status).toBe("READY");
    expect(missing.advancement.status).toBe("MISSING_REQUIRED_CONTENT");
    expect(missing.advancement.missing.map((m) => m.requirement)).toContain("CHARACTER_ADVANCEMENT_RULE");
  });

  it("cross-Definition coherence: the advancement Levels must be exactly the Character Die progression's (§8–§9)", () => {
    const gap = getCharacterCapability(advancementFixture({ levels: PLAYTEST_ADVANCEMENT_LEVELS.filter((l) => l.level !== 7) }).bundle).advancement;
    expect(gap.status).toBe("MISSING_REQUIRED_CONTENT");
    expect(gap.missing.map((m) => m.requirement)).toContain("CHARACTER_ADVANCEMENT_RULE");
    const beyond = getCharacterCapability(advancementFixture({ levels: [...PLAYTEST_ADVANCEMENT_LEVELS, { level: 11, statPoints: 1, skillAdvancements: 0 }] }).bundle).advancement;
    expect(beyond.status).toBe("MISSING_REQUIRED_CONTENT");
  });
});

describe("M6-WO4 Level advancement (§108–§114, M6-I032)", () => {
  const f = advancementFixture();

  it("Level 1 → 2: +1 Stat, no Skill, no Affinity, d4 stays; derived values recalculate", () => {
    const p = preview(f, 0, stats({ PER: 1 }));
    expect(p.status).toBe("READY");
    expect([p.fromLevel, p.toLevel]).toEqual([1, 2]);
    expect(p.entitlements).toMatchObject({ statPoints: 1, skillAdvancements: 0, affinity: null, characterDie: { before: { dieKey: "D4" }, after: { dieKey: "D4" } } });
    expect(stat(p.before!, "PER")).toBe(3);
    expect(stat(p.after!, "PER")).toBe(4);
    expect(p.after!.derivedStatistics).not.toEqual(p.before!.derivedStatistics);
    expect(p.record).toEqual({ toLevel: 2, statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null });
  });

  it("Level 2 → 3: +1 Stat, one Skill, d4 → d6, Primary Affinity NONE → TRAINED automatically (no choice persisted)", () => {
    const p = preview(f, 1, { ...stats({ PRO: 1 }), skillAdvancements: [train(f, "skill.arcana")] });
    expect(p.status).toBe("READY");
    expect(p.entitlements?.characterDie).toMatchObject({ before: { dieKey: "D4" }, after: { dieKey: "D6", faces: 6 } });
    expect(p.entitlements?.affinity).toMatchObject({ automatic: true, mode: "REQUIRED" });
    expect(p.before?.affinities[0]?.rank).toBe("NONE");
    expect(p.after?.affinities[0]).toMatchObject({ role: "PRIMARY", rank: "TRAINED" });
    expect(skillRank(p.after!, "skill.arcana")).toBe("TRAINED");
    expect(p.record?.affinityChoice).toBeNull();
    // An explicit choice at an automatic step is refused.
    expect(codes(preview(f, 1, { ...stats({ PRO: 1 }), skillAdvancements: [train(f, "skill.arcana")], affinityChoice: { optionKey: "PRIMARY_TRAINED", affinity: null } }))).toContain(E.AFFINITY_CHOICE_NOT_ALLOWED);
  });

  it("Level 5: d8, +1 Stat, one Skill, no Affinity step", () => {
    const p = preview(f, 3, script(f)[3]!);
    expect(p.entitlements).toMatchObject({ toLevel: 5, statPoints: 1, skillAdvancements: 1, affinity: null, characterDie: { after: { dieKey: "D8" } } });
    expect(p.status).toBe("READY");
  });

  it("Level 6: an exact Affinity branch choice — both authored branches are legal; others are not", { timeout: HEAVY_ADVANCEMENT_TEST_TIMEOUT_MS }, () => {
    const expert = profileAt(f, 5, "PRIMARY_EXPERT");
    expect(expert.affinities).toEqual([expect.objectContaining({ role: "PRIMARY", rank: "EXPERT" })]);
    const secondary = profileAt(f, 5, "GAIN_SECONDARY_TRAINED");
    expect(secondary.affinities.map((a) => [a.role, a.rank, a.affinity.canonicalKey, a.acquisition.level])).toEqual([
      ["PRIMARY", "TRAINED", "affinity.evocation", 1],
      ["SECONDARY", "TRAINED", "affinity.conjuration", 6],
    ]);
    const base = { ...stats({ RES: 1 }), skillAdvancements: [upgrade(f, "test.m6wo3.skill.athletics")] };
    expect(codes(preview(f, 4, base))).toEqual([E.AFFINITY_CHOICE_REQUIRED]);
    expect(codes(preview(f, 4, { ...base, affinityChoice: { optionKey: "PROMOTE_EXPERT_TO_MASTER", affinity: f.sel("affinity.evocation") } }))).toContain(E.AFFINITY_OPTION_ILLEGAL);
    expect(codes(preview(f, 4, { ...base, affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: f.sel("affinity.evocation") } }))).toContain(E.AFFINITY_ALREADY_OWNED);
  });

  it("Level 9: d12, the advanced Affinity option; a newly gained Affinity starts at TRAINED", { timeout: HEAVY_ADVANCEMENT_TEST_TIMEOUT_MS }, () => {
    const p = profileAt(f, 8, "PRIMARY_EXPERT", "GAIN_NEW_AFFINITY");
    expect(p.characterDie).toEqual({ dieKey: "D12", faces: 12 });
    expect(p.affinities.find((a) => a.affinity.canonicalKey === "affinity.divination")).toMatchObject({ rank: "TRAINED", role: "SECONDARY", acquisition: { level: 9, optionKey: "GAIN_NEW_AFFINITY" } });
    const master = profileAt(f, 8, "PRIMARY_EXPERT", "PROMOTE_EXPERT_TO_MASTER");
    expect(master.affinities[0]).toMatchObject({ rank: "MASTER", history: [{ level: 3, from: "NONE", to: "TRAINED" }, { level: 6, from: "TRAINED", to: "EXPERT" }, { level: 9, from: "EXPERT", to: "MASTER" }] });
    const upgraded = profileAt(f, 8, "GAIN_SECONDARY_TRAINED", "UPGRADE_AFFINITY_RANK");
    expect(upgraded.affinities.find((a) => a.affinity.canonicalKey === "affinity.conjuration")?.rank).toBe("EXPERT");
  });

  it("Level 10: +2 Stat Points, one Skill, no Affinity step, d12; Stat Mastery is derived at the Release's thresholds", { timeout: HEAVY_ADVANCEMENT_TEST_TIMEOUT_MS }, () => {
    const p9 = profileAt(f, 8);
    expect(p9.stats.find((s) => s.stat === "STR")).toMatchObject({ final: 9, mastery: false });
    const p = preview(f, 8, script(f)[8]!);
    expect(p.entitlements).toMatchObject({ toLevel: 10, statPoints: 2, skillAdvancements: 1, affinity: null, characterDie: { before: { dieKey: "D12" }, after: { dieKey: "D12" } } });
    const after = p.after!;
    expect(after.stats.find((s) => s.stat === "STR")).toMatchObject({ final: 10, creation: 3, advancement: 4, mastery: true });
    expect(after.stats.find((s) => s.stat === "AGI")?.mastery).toBe(false);
    expect(codes(preview(f, 8, { ...script(f)[8]!, statAllocations: { STR: 1 } }))).toEqual([E.STAT_POINTS_UNSPENT]);
  });

  it("the maximum Level comes from content: advancing past it is MAX_LEVEL", () => {
    const top = profileAt(f, 9);
    expect([top.level, top.maximumLevel]).toEqual([10, 10]);
    const p = preview(f, 9, none);
    expect(p.status).toBe("MAX_LEVEL");
    expect(p.record).toBeNull();
    const short = advancementFixture({ levels: PLAYTEST_ADVANCEMENT_LEVELS.slice(0, 2) });
    expect(getCharacterCapability(short.bundle).advancement.status).toBe("MISSING_REQUIRED_CONTENT");
  });

  it("history must advance exactly one Level per record (no skip, no repeat, no decrement)", () => {
    const { history } = advance(f, script(f).slice(0, 3));
    const build = (h: CommittedAdvancement[], level: number) => buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level, history: h } });
    expect(build(history, 4).profile?.level).toBe(4);
    expect(codes(build([history[0]!, { ...history[1]!, toLevel: 4 }], 4))).toContain(E.HISTORY_INVALID);
    // A skip whose record is itself legal for the Level it names (Level 2 → 4 with Level 4's choices) is still refused.
    expect(codes(build([history[0]!, history[2]!], 4))).toEqual([E.HISTORY_INVALID]);
    expect(codes(build([history[0]!, history[0]!], 3))).toContain(E.HISTORY_INVALID);
    expect(codes(build(history, 3))).toContain(E.HISTORY_INVALID);
  });
});

describe("M6-WO4 Stat Points (§17–§19, M6-I036)", () => {
  const f = advancementFixture();
  it("must equal the entitlement; negatives, fractions and unknown Stats are refused; maximum from the STAT Definition", () => {
    expect(codes(preview(f, 0, none))).toEqual([E.STAT_POINTS_UNSPENT]);
    expect(codes(preview(f, 0, stats({ PER: 2 })))).toContain(E.STAT_POINTS_EXCEEDED);
    expect(codes(preview(f, 0, stats({ PER: -1, AGI: 2 })))).toContain(E.INVALID_STAT_ALLOCATION);
    expect(codes(preview(f, 0, stats({ PER: 0.5 })))).toContain(E.INVALID_STAT_ALLOCATION);
    expect(codes(preview(f, 0, stats({ LUCK: 1 })))).toContain(E.INVALID_STAT_ALLOCATION);
    const p9 = advance(f, script(f).slice(0, 8));
    const atTen = previewCharacterAdvancement({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level: p9.level, history: p9.history }, choices: { ...script(f)[8]!, statAllocations: { STR: 2 } } });
    expect(atTen.issues).toContainEqual(expect.objectContaining({ code: E.STAT_OUT_OF_RANGE, path: "statAllocations.STR", source: expect.objectContaining({ canonicalKey: "core.stat.str" }) }));
  });

  it("effective Stat = baseline + Ancestry + creation + Σ advancement — the creation record is untouched (M6-I034)", () => {
    const p = profileAt(f, 9);
    expect(p.stats.map((s) => [s.stat, s.baseline, s.ancestry, s.creation, s.advancement, s.final])).toEqual([
      ["STR", 1, 2, 3, 4, 10],
      ["AGI", 1, 1, 3, 1, 6],
      ["CON", 1, 0, 3, 1, 5],
      ["PER", 1, 0, 2, 1, 4],
      ["RES", 1, 0, 2, 1, 4],
      ["PRO", 1, 1, 2, 2, 6],
    ]);
    expect(f.creation.statAllocations).toEqual({ STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 });
  });
});

describe("M6-WO4 Skill advancement (§20–§27, §115, M6-I037)", () => {
  const f = advancementFixture();
  const at3 = (skillAdvancements: unknown[]) => preview(f, 1, { ...stats({ PRO: 1 }), skillAdvancements });
  it("new → TRAINED, TRAINED → EXPERT → MASTER, MASTER refused; ranks come from the exact ladder", () => {
    const p = profileAt(f, 7);
    expect(p.skills.find((s) => s.skill.canonicalKey === "skill.arcana")).toMatchObject({
      rankKey: "MASTER",
      source: { kind: "ADVANCEMENT", level: 3 },
      history: [
        { level: 3, action: "TRAIN_NEW", fromRankKey: "UNTRAINED", toRankKey: "TRAINED" },
        { level: 5, action: "UPGRADE", fromRankKey: "TRAINED", toRankKey: "EXPERT" },
        { level: 8, action: "UPGRADE", fromRankKey: "EXPERT", toRankKey: "MASTER" },
      ],
    });
    expect(p.skills.find((s) => s.skill.canonicalKey === "test.m6wo3.skill.athletics")).toMatchObject({ rankKey: "EXPERT", source: { kind: "ANCESTRY", grantKey: "orcani_upbringing", level: 1 } });
    const { history, level } = advance(f, script(f).slice(0, 8));
    const again = previewCharacterAdvancement({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level, history }, choices: { ...script(f)[8]!, skillAdvancements: [upgrade(f, "skill.arcana")] } });
    expect(codes(again)).toContain(E.SKILL_ALREADY_MASTER);
  });

  it("duplicate training, upgrading an untrained Skill, two advancements of one Skill, wrong counts", () => {
    expect(codes(at3([train(f, "test.m6wo3.skill.athletics")]))).toContain(E.SKILL_ALREADY_TRAINED);
    expect(codes(at3([upgrade(f, "skill.martial")]))).toContain(E.SKILL_NOT_TRAINED);
    expect(codes(at3([]))).toEqual([E.SKILL_ADVANCEMENT_REQUIRED]);
    expect(codes(at3([train(f, "skill.arcana"), train(f, "skill.martial")]))).toContain(E.SKILL_ADVANCEMENT_EXCEEDED);
    expect(codes(preview(f, 0, { ...stats({ PER: 1 }), skillAdvancements: [train(f, "skill.arcana")] }))).toContain(E.SKILL_ADVANCEMENT_EXCEEDED);
    expect(codes(at3([{ action: "RETRAIN", skill: f.sel("skill.arcana") }]))).toContain(E.INVALID_CHOICES);
    // A Release that grants two Skill advancements at Level 2 still advances one Skill at most once per Level.
    const two = advancementFixture({ levels: PLAYTEST_ADVANCEMENT_LEVELS.map((l) => (l.level === 2 ? { ...l, skillAdvancements: 2 } : l)) });
    const twice = previewCharacterAdvancement({ bundle: two.bundle, ruleset: two.ruleset, character: { creation: two.creation, level: 1, history: [] }, choices: { ...stats({ PER: 1 }), skillAdvancements: [train(two, "skill.arcana"), upgrade(two, "skill.arcana")] } });
    expect(codes(twice)).toEqual([E.DUPLICATE_SKILL_ADVANCEMENT]);
  });

  it("exact pins only: a non-SKILL, another revision, an unknown Entity", () => {
    expect(codes(at3([train(f, "affinity.conjuration")]))).toContain(E.WRONG_DEFINITION_KIND);
    const r2 = advancementFixture({ revision: ["skill.arcana"] });
    expect(codes(at3([{ action: "TRAIN_NEW", skill: r2.sel("skill.arcana") }]))).toContain(E.CROSS_RELEASE_SELECTION);
    expect(codes(at3([{ action: "TRAIN_NEW", skill: { entityId: "00000000-0000-4000-8000-000000099999", entityVersionId: "00000000-0000-4000-8000-000000099998" } }]))).toContain(E.CROSS_RELEASE_SELECTION);
  });
});

describe("M6-WO4 Affinity progression (§28–§34, §116, M6-I038)", () => {
  const f = advancementFixture();
  it("every progression Level's profile passes the existing M5 validators (persisted choices alone are not proof)", { timeout: 60_000 }, () => {
    for (let n = 0; n <= 9; n += 1) {
      const p = profileAt(f, n, "GAIN_SECONDARY_TRAINED", "UPGRADE_AFFINITY_RANK");
      expect(p.affinityProfile.affinities.length).toBe(p.affinities.length);
    }
  });
  it("a gained Affinity must be an exact executable Affinity of this Release (no cross-Release, no latest)", () => {
    const base = { ...stats({ RES: 1 }), skillAdvancements: [upgrade(f, "test.m6wo3.skill.athletics")] };
    const r2 = advancementFixture({ revision: ["affinity.conjuration"] });
    expect(codes(preview(f, 4, { ...base, affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: r2.sel("affinity.conjuration") } }))).toContain(E.CROSS_RELEASE_SELECTION);
    expect(codes(preview(f, 4, { ...base, affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: f.sel("skill.arcana") } }))).toContain(E.WRONG_DEFINITION_KIND);
    expect(codes(preview(f, 4, { ...base, affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: null } }))).toEqual([E.AFFINITY_CHOICE_REQUIRED]);
    expect(codes(preview(f, 1, { ...stats({ PRO: 1 }), skillAdvancements: [train(f, "skill.arcana")], level: 3 }))).toContain(E.INVALID_CHOICES);
  });
});

describe("M6-WO4 profile and history (§12, §118, §121–§122, M6-I031, M6-I034, M6-I039)", () => {
  it("is deterministic and rebuilt from creation + history; creation inputs are not mutated", () => {
    const f = advancementFixture();
    const before = JSON.stringify(f.creation);
    const a = profileAt(f, 5);
    const b = profileAt(f, 5);
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(JSON.stringify(f.creation)).toBe(before);
    expect(a).toMatchObject({ level: 6, characterDie: { dieKey: "D8" } });
    expect(a.constructionContext.skillRanks).toContainEqual({ skillKey: "skill.arcana", rankKey: "EXPERT" });
    expect(derived(a, "SIGNATURE_ABILITY_SLOTS")).toBe(a.signatureCapacity);
  });

  it("resolves entirely under the exact Release it is given (another Release's revisions do not substitute)", () => {
    const f = advancementFixture();
    const { history, level } = advance(f, script(f).slice(0, 3));
    const r2 = advancementFixture({ revision: ["skill.arcana"], rulesetId: "00000000-0000-4000-8000-000000009001" });
    const other = buildCharacterMechanicalProfile({ bundle: r2.bundle, ruleset: r2.ruleset, character: { creation: f.creation, level, history } });
    expect(other.profile).toBeNull();
    expect(codes(other)).toContain(E.HISTORY_INVALID);
  });

  it("derived values and Signature capacity follow PRO through the Release's own Formulas", () => {
    const f = advancementFixture();
    const l2 = profileAt(f, 1);
    const l3 = profileAt(f, 2);
    expect(stat(l3, "PRO")).toBe(5);
    expect(l3.signatureCapacity).not.toBe(l2.signatureCapacity);
  });
});

describe("M6-WO4 access and eligibility (§51–§66, §123–§127, M6-I040–M6-I042)", () => {
  const f = advancementFixture();
  const elig = (p: CharacterMechanicalProfile, key: string) => evaluateComponentEligibility({ bundle: f.bundle, profile: p, definition: f.sel(key) });

  it("Arcana EXPERT requirement: INELIGIBLE at TRAINED, ELIGIBLE at EXPERT — same exact Definition, same Release", () => {
    const l3 = profileAt(f, 2);
    const l5 = profileAt(f, 4);
    const before = elig(l3, "test.m6wo4.effect.expert_lore");
    expect(before.status).toBe("INELIGIBLE");
    expect(before.requirements).toEqual([expect.objectContaining({ kind: "SKILL_RANK_AT_LEAST", required: expect.objectContaining({ skillKey: "skill.arcana", rankKey: "EXPERT" }), actual: { rankKey: "TRAINED", owned: true }, satisfied: false })]);
    expect(elig(l5, "test.m6wo4.effect.expert_lore").status).toBe("ELIGIBLE");
  });

  it("Affinity rank requirement: Primary NONE → INELIGIBLE before Level 3, ELIGIBLE after the automatic progression", () => {
    expect(elig(profileAt(f, 1), "test.m6wo4.effect.evocation_trained").status).toBe("INELIGIBLE");
    expect(elig(profileAt(f, 2), "test.m6wo4.effect.evocation_trained").status).toBe("ELIGIBLE");
  });

  it("unrelated progress never satisfies another requirement (Martial ≠ Arcana; another Affinity ≠ the named one)", () => {
    const p = profileAt(f, 8);
    expect(elig(p, "test.m6wo4.effect.martial_expert").status).toBe("INELIGIBLE");
    expect(elig(p, "test.m6wo4.effect.conjuration_trained").status).toBe("INELIGIBLE");
    expect(elig(profileAt(f, 5, "GAIN_SECONDARY_TRAINED"), "test.m6wo4.effect.conjuration_trained").status).toBe("ELIGIBLE");
  });

  it("no structured prerequisite → ELIGIBLE with no requirements (Rules Text is never read); exact pins only", () => {
    const p = profileAt(f, 0);
    expect(elig(p, "test.m6wo4.effect.open")).toMatchObject({ status: "ELIGIBLE", requirements: [] });
    const r2 = advancementFixture({ revision: ["test.m6wo4.effect.expert_lore"] });
    expect(evaluateComponentEligibility({ bundle: f.bundle, profile: p, definition: r2.sel("test.m6wo4.effect.expert_lore") }).status).toBe("UNRESOLVED");
    expect(elig(p, ADVANCEMENT_RULE_KEY).status).toBe("UNRESOLVED");
  });

  it("listing reuses one fact set; access summary reports Arcane / Martial / Affinity Authority and Signature capacity", () => {
    const p = profileAt(f, 4);
    const list = listComponentEligibility({ bundle: f.bundle, profile: p, definitionKind: "SPELL_EFFECT" });
    expect(list.map((x) => [x.definition?.canonicalKey, x.status])).toEqual([
      ["test.m6wo4.effect.conjuration_trained", "INELIGIBLE"],
      ["test.m6wo4.effect.evocation_trained", "ELIGIBLE"],
      ["test.m6wo4.effect.expert_lore", "ELIGIBLE"],
      ["test.m6wo4.effect.open", "ELIGIBLE"],
    ]);
    const summary = characterAccessSummary({ bundle: f.bundle, profile: p });
    expect(summary.status).toBe("RESOLVED");
    expect(summary.spell.arcaneAuthority).toMatchObject({ skillKey: "skill.arcana", rankKey: "EXPERT", minimumRankKey: "TRAINED", eligible: true });
    expect(summary.maneuver.martial).toMatchObject({ skillKey: "skill.martial", rankKey: "UNTRAINED", eligible: false });
    expect(summary.spell.affinityAuthorities).toEqual([expect.objectContaining({ rank: "TRAINED", eligible: true })]);
    expect(summary.signatureCapacity).toBe(p.signatureCapacity);
  });

  it("the advancement preview reports access changes (read-only projection)", () => {
    const p = preview(f, 3, script(f)[3]!);
    expect(p.accessChanges?.tracks).toContainEqual(expect.objectContaining({ track: "ARCANE_AUTHORITY", before: "TRAINED", after: "EXPERT" }));
    expect(p.accessChanges?.newlyEligible.map((d) => d.canonicalKey)).toEqual(["test.m6wo4.effect.expert_lore"]);
    const l3 = preview(f, 1, script(f)[1]!);
    expect(l3.accessChanges?.newlyEligible.map((d) => d.canonicalKey)).toEqual(["test.m6wo4.effect.evocation_trained"]);
  });
});
