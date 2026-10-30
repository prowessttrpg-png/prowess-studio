import { describe, expect, it } from "vitest";
import { CHARACTER_CREATION_ERROR_CODES as E, getCharacterCreationCapability, validateCharacterCreation } from "./character/creation";
import { readStoredProwessDefinition } from "./definition/storage";
import { PROWESS_DEFINITION_KINDS } from "./vocabulary/families";
import { TEST_ANCESTRY_KEY, TEST_RULE_KEY, ancestryPayload, characterFixture, creationRulePayload, workedCandidate, type CharacterFixture } from "./testing/character-fixtures";

/**
 * PAS-10 M6-WO3 — Character creation contracts and the pure creation validator / M5-derived preview. Every number the
 * preview asserts was produced by the frozen M4 orchestrator from the fixture Release's own DERIVED_STAT Definitions.
 * Invariants: M6-I022 (selections must be pinned by the Release), M6-I023 (derived values are computed, not inputs),
 * M6-I029 (M4 / M5 own every calculation).
 */
const run = (f: CharacterFixture, candidate: unknown) => validateCharacterCreation({ bundle: f.bundle, ruleset: f.ruleset, candidate: candidate as never });
const codes = (r: ReturnType<typeof run>) => r.issues.map((i) => i.code);
const value = (r: ReturnType<typeof run>, statistic: string) => r.derivedPreview?.find((d) => d.statistic === statistic)?.value;

describe("M6-WO3 registry activation", () => {
  it("ANCESTRY and SKILL are version 1; CHARACTER_CREATION_RULE is a CHARACTER kind at version 1", () => {
    expect(PROWESS_DEFINITION_KINDS.ANCESTRY).toEqual({ family: "ANCESTRY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(PROWESS_DEFINITION_KINDS.SKILL).toEqual({ family: "SKILL", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(PROWESS_DEFINITION_KINDS.CHARACTER_CREATION_RULE).toEqual({ family: "CHARACTER", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
  });

  it("the payload readers fail closed on malformed character content", () => {
    const f = characterFixture();
    const read = (definitionKind: string, payload: unknown) => {
      const rule = f.ruleset.rules[0]!;
      return readStoredProwessDefinition({ ruleset: f.ruleset, rule, structuredData: { prowessDefinition: { schemaVersion: 1, systemFamily: (PROWESS_DEFINITION_KINDS as Record<string, { family: string }>)[definitionKind]!.family, definitionKind, payload } } });
    };
    const bad: Array<[string, unknown]> = [
      ["CHARACTER_CREATION_RULE", creationRulePayload({ statPointBudget: 1.5 })],
      ["CHARACTER_CREATION_RULE", creationRulePayload({ requiredAncestryCount: 2 })],
      ["CHARACTER_CREATION_RULE", creationRulePayload({ startingSkillRankKey: "trained" })],
      ["SKILL", { ladderKey: "SKILL" }],
      ["ANCESTRY", ancestryPayload(f.ref, { baseHp: -1 })],
      ["ANCESTRY", ancestryPayload(f.ref, { statGrants: [{ grantKey: "a", kind: "CHOOSE_DISTINCT", count: 3, amount: 1, allowedStats: ["STR", "AGI"] }] })],
      ["ANCESTRY", ancestryPayload(f.ref, { statGrants: [{ grantKey: "a", kind: "FIXED", stat: "LUCK", amount: 1 }] })],
      ["ANCESTRY", ancestryPayload(f.ref, { skillGrants: [{ grantKey: "s", rankKey: "TRAINED", selectionKind: "FIXED", count: 2, options: [f.ref("test.m6wo3.skill.athletics")] }] })],
      ["ANCESTRY", ancestryPayload(f.ref, { skillGrants: [{ grantKey: "s", rankKey: "TRAINED", selectionKind: "CHOOSE_FROM", count: 1, options: [f.ref("affinity.evocation")] }] })],
      ["ANCESTRY", ancestryPayload(f.ref, { skillGrants: [{ grantKey: "s", rankKey: "TRAINED", selectionKind: "CHOOSE_ANY", count: 1, options: [f.ref("test.m6wo3.skill.athletics")] }] })],
    ];
    for (const [kind, payload] of bad) expect(read(kind, payload).ok, JSON.stringify(payload)).toBe(false);
    expect(read("CHARACTER_CREATION_RULE", creationRulePayload()).ok).toBe(true);
    expect(read("SKILL", { ladderKey: "SKILL", source: { locators: ["s29"], conflicts: [] } }).ok).toBe(true);
  });
});

describe("M6-WO3 Character creation capability", () => {
  it("a complete Release is READY; missing content is enumerated", () => {
    expect(getCharacterCreationCapability(characterFixture().bundle)).toEqual({ status: "READY", missing: [] });
    const partial = getCharacterCreationCapability(characterFixture({ omit: [TEST_RULE_KEY, TEST_ANCESTRY_KEY, "core.stat.str"] }).bundle);
    expect(partial.status).toBe("MISSING_REQUIRED_CONTENT");
    expect(partial.missing.map((m) => m.requirement)).toEqual(expect.arrayContaining(["CHARACTER_CREATION_RULE", "CORE_CHARACTER_CONTENT", "ANCESTRY"]));
    const noAffinity = characterFixture({ omit: ["affinity.evocation", "affinity.conjuration", "affinity.transmutation", "affinity.divination", "affinity.enhancement", "affinity.manipulation"] });
    expect(getCharacterCreationCapability(noAffinity.bundle).missing.map((m) => m.requirement)).toEqual(["AFFINITY"]);
  });
});

describe("M6-WO3 worked Character (Orcani test fixture)", () => {
  it("validates READY and previews derived values through M5 Definitions and M4 Formulas", () => {
    const f = characterFixture();
    const r = run(f, workedCandidate(f));
    expect(r.issues).toEqual([]);
    expect(r.status).toBe("READY");
    expect(r.resolved.level).toBe(1);
    expect(r.resolved.characterDie).toEqual({ dieKey: "D4", faces: 4 });
    expect(Object.fromEntries(r.resolved.stats.map((s) => [s.stat, [s.baseline, s.ancestry, s.allocated, s.final]]))).toEqual({
      STR: [1, 2, 3, 6], AGI: [1, 1, 3, 5], CON: [1, 0, 3, 4], PER: [1, 0, 2, 3], RES: [1, 0, 2, 3], PRO: [1, 1, 2, 4],
    });
    expect(r.resolved.pointsSpent).toBe(15);
    expect(r.resolved.skills.map((s) => [s.skill.canonicalKey, s.rankKey, s.sourceKind])).toEqual([
      ["test.m6wo3.skill.athletics", "TRAINED", "ANCESTRY"],
      ["test.m6wo3.skill.stealth", "TRAINED", "FREE"],
      ["test.m6wo3.skill.arcana", "TRAINED", "FREE"],
    ]);
    expect(r.resolved.primaryAffinity?.canonicalKey).toBe("affinity.evocation");
    // Base HP 10 + CON 4; Base MP 4 + RES 3; Signature slots = PRO; Dodge = d4/2 + AGI + floor(PER/3).
    expect([value(r, "MAXIMUM_HP"), value(r, "MAXIMUM_MP"), value(r, "SIGNATURE_ABILITY_SLOTS"), value(r, "DODGE"), value(r, "CHARACTER_DC")]).toEqual([14, 7, 4, 8, 7]);
    expect(r.derivedPreview?.find((d) => d.statistic === "MAXIMUM_HP")?.definition.canonicalKey).toBe("core.derived.maximum_hp");
  });

  it("is pure and deterministic: equal inputs give deep-equal frozen results; the input is not mutated", () => {
    const f = characterFixture();
    const c = workedCandidate(f);
    const snapshot = JSON.stringify(c);
    const a = run(f, c);
    expect(run(f, c)).toEqual(a);
    expect(JSON.stringify(c)).toBe(snapshot);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("a draft may be incomplete; nothing chosen is INCOMPLETE, not INVALID", () => {
    const r = run(characterFixture(), { ancestry: null, ancestryStatChoices: [], statAllocations: {}, skills: [], primaryAffinity: null });
    expect(r.status).toBe("INCOMPLETE");
    expect(r.issues.every((i) => i.severity === "INCOMPLETE")).toBe(true);
    expect(codes(r)).toEqual(expect.arrayContaining([E.ANCESTRY_REQUIRED, E.STAT_BUDGET_UNSPENT, E.FREE_SKILLS_INCOMPLETE, E.PRIMARY_AFFINITY_REQUIRED]));
  });
});

describe("M6-WO3 Stat budget and bounds", () => {
  const f = characterFixture();
  const withStats = (statAllocations: Record<string, unknown>) => ({ ...workedCandidate(f), statAllocations });
  it("exactly the budget is READY; under budget is INCOMPLETE (draft only); over budget is INVALID", () => {
    expect(run(f, withStats({ STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 })).status).toBe("READY");
    const under = run(f, withStats({ STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 1 }));
    expect([under.status, codes(under)]).toEqual(["INCOMPLETE", [E.STAT_BUDGET_UNSPENT]]);
    expect(codes(run(f, withStats({ STR: 3, AGI: 3, CON: 3, PER: 3, RES: 2, PRO: 2 })))).toContain(E.STAT_BUDGET_EXCEEDED);
  });
  it("negative, fractional and unknown allocations are refused", () => {
    expect(codes(run(f, withStats({ STR: -1, AGI: 6, CON: 3, PER: 3, RES: 2, PRO: 2 })))).toContain(E.INVALID_STAT_ALLOCATION);
    expect(codes(run(f, withStats({ STR: 2.5, AGI: 3.5, CON: 3, PER: 2, RES: 2, PRO: 2 })))).toContain(E.INVALID_STAT_ALLOCATION);
    expect(codes(run(f, withStats({ LUCK: 1, STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 1 })))).toContain(E.INVALID_STAT_ALLOCATION);
  });
  it("a final Stat above the Release STAT maximum is refused (Ancestry +2 counts once)", () => {
    const r = run(f, withStats({ STR: 8, AGI: 2, CON: 2, PER: 1, RES: 1, PRO: 1 }));
    expect(r.issues).toContainEqual(expect.objectContaining({ code: E.STAT_OUT_OF_RANGE, path: "statAllocations.STR", source: expect.objectContaining({ canonicalKey: "core.stat.str" }) }));
    expect(run(f, withStats({ STR: 7, AGI: 3, CON: 2, PER: 1, RES: 1, PRO: 1 })).resolved.stats.find((s) => s.stat === "STR")?.final).toBe(10);
  });
  it("Ancestry Stat choices: exact count, distinct, allowed only", () => {
    const base = workedCandidate(f);
    expect(codes(run(f, { ...base, ancestryStatChoices: [{ grantKey: "orcani_versatility", stat: "AGI" }] }))).toEqual([E.STAT_CHOICE_INCOMPLETE, E.STAT_BUDGET_UNSPENT].slice(0, 1));
    expect(codes(run(f, { ...base, ancestryStatChoices: [{ grantKey: "orcani_versatility", stat: "AGI" }, { grantKey: "orcani_versatility", stat: "AGI" }] }))).toContain(E.INVALID_STAT_CHOICE);
    expect(codes(run(f, { ...base, ancestryStatChoices: [{ grantKey: "orcani_versatility", stat: "STR" }, { grantKey: "orcani_versatility", stat: "AGI" }] }))).toContain(E.INVALID_STAT_CHOICE);
    expect(codes(run(f, { ...base, ancestryStatChoices: [...base.ancestryStatChoices, { grantKey: "orcani_versatility", stat: "CON" }] }))).toContain(E.INVALID_STAT_CHOICE);
    expect(codes(run(f, { ...base, ancestryStatChoices: [{ grantKey: "orcani_strength", stat: "STR" }, ...base.ancestryStatChoices] }))).toContain(E.INVALID_STAT_CHOICE);
  });
});

describe("M6-WO3 starting Skills", () => {
  const f = characterFixture();
  const base = workedCandidate(f);
  const skill = (key: string, sourceKind = "FREE", sourceGrantKey: string | null = null) => ({ skill: f.sel(key), sourceKind, sourceGrantKey });
  it("choose-from-list: only listed exact revisions; exactly the grant count", () => {
    expect(codes(run(f, { ...base, skills: [skill("test.m6wo3.skill.stealth", "ANCESTRY", "orcani_upbringing"), base.skills[1], base.skills[2]] }))).toContain(E.SKILL_NOT_OFFERED);
    expect(codes(run(f, { ...base, skills: [base.skills[0], skill("test.m6wo3.skill.survival", "ANCESTRY", "orcani_upbringing"), base.skills[1], base.skills[2]] }))).toContain(E.SKILL_GRANT_EXCEEDED);
    expect(codes(run(f, { ...base, skills: [base.skills[1], base.skills[2]] }))).toEqual([E.SKILL_GRANT_INCOMPLETE]);
  });
  it("fixed and choose-any grants", () => {
    const fx = characterFixture({ ancestry: { skillGrants: [{ grantKey: "fixed", rankKey: "TRAINED", selectionKind: "FIXED", count: 1, options: [characterFixture().ref("test.m6wo3.skill.survival")] }, { grantKey: "any", rankKey: "TRAINED", selectionKind: "CHOOSE_ANY", count: 1, options: [] }] } });
    const c = { ...workedCandidate(fx), skills: [{ skill: fx.sel("test.m6wo3.skill.survival"), sourceKind: "ANCESTRY", sourceGrantKey: "fixed" }, { skill: fx.sel("test.m6wo3.skill.perception"), sourceKind: "ANCESTRY", sourceGrantKey: "any" }, { skill: fx.sel("test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null }, { skill: fx.sel("test.m6wo3.skill.arcana"), sourceKind: "FREE", sourceGrantKey: null }] };
    expect(run(fx, c).status).toBe("READY");
  });
  it("free Skill count is exact; duplicates never stack", () => {
    expect(codes(run(f, { ...base, skills: [...base.skills, skill("test.m6wo3.skill.perception")] }))).toContain(E.FREE_SKILLS_EXCEEDED);
    expect(codes(run(f, { ...base, skills: [base.skills[0], base.skills[1]] }))).toEqual([E.FREE_SKILLS_INCOMPLETE]);
    expect(codes(run(f, { ...base, skills: [base.skills[0], skill("test.m6wo3.skill.athletics"), base.skills[2]] }))).toContain(E.DUPLICATE_SKILL);
  });
  it("a non-SKILL selection, another revision, or an Entity outside the Release is refused", () => {
    expect(codes(run(f, { ...base, skills: [base.skills[0], { ...base.skills[1], skill: f.sel("affinity.evocation") }, base.skills[2]] }))).toContain(E.WRONG_DEFINITION_KIND);
    const newer = characterFixture({ revision: ["test.m6wo3.skill.stealth"] });
    expect(codes(run(f, { ...base, skills: [base.skills[0], { ...base.skills[1], skill: newer.sel("test.m6wo3.skill.stealth") }, base.skills[2]] }))).toContain(E.NOT_IN_RELEASE);
    expect(codes(run(f, { ...base, skills: [base.skills[0], { ...base.skills[1], skill: { entityId: "00000000-0000-4000-8000-000000099999", entityVersionId: "00000000-0000-4000-8000-000000099998" } }, base.skills[2]] }))).toContain(E.NOT_IN_RELEASE);
  });
});

describe("M6-WO3 Primary Affinity and cross-Release selections", () => {
  const f = characterFixture();
  const base = workedCandidate(f);
  it("exactly one executable Affinity of this Release", () => {
    expect(codes(run(f, { ...base, primaryAffinity: null }))).toEqual([E.PRIMARY_AFFINITY_REQUIRED]);
    expect(codes(run(f, { ...base, primaryAffinity: f.sel("test.m6wo3.skill.athletics") }))).toContain(E.WRONG_DEFINITION_KIND);
    const v1 = characterFixture({ extra: [{ canonicalKey: "test.m6wo3.affinity.identity_only", definitionKind: "AFFINITY", schemaVersion: 1, payload: { affinity: "EVOCATION" } }] });
    expect(codes(run(v1, { ...workedCandidate(v1), primaryAffinity: v1.sel("test.m6wo3.affinity.identity_only") }))).toContain(E.AFFINITY_NOT_EXECUTABLE);
    expect(codes(run(f, { ...base, primaryAffinity: [f.sel("affinity.evocation"), f.sel("affinity.conjuration")] }))).toContain(E.INVALID_CANDIDATE);
  });
  it("a selection naming another Release's revision is refused even with the same canonical key", () => {
    const r2 = characterFixture({ revision: [TEST_ANCESTRY_KEY, "affinity.evocation"] });
    expect(codes(run(f, { ...base, ancestry: r2.sel(TEST_ANCESTRY_KEY) }))).toContain(E.NOT_IN_RELEASE);
    expect(codes(run(f, { ...base, primaryAffinity: r2.sel("affinity.evocation") }))).toContain(E.NOT_IN_RELEASE);
    // And Release 2's own candidate is READY there.
    expect(run(r2, workedCandidate(r2)).status).toBe("READY");
  });
});
