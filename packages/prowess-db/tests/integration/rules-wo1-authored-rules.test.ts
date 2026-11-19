import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  createAuthoredDefinition,
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacterSheet,
  getStatImpacts,
  prisma,
  previewAuthoredRules,
  proposeDefinitionChangeSet,
  publishRulesetRelease,
  saveCharacterCreation,
  submitAuthoredRevisionForReview,
  submitChangeSetForReview,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, seedCharacterRelease, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";

/**
 * RULES-WO1 — authored rules end to end over real PostgreSQL, in an ISOLATED test Ruleset (`test.rw1.*`).
 *
 *   1. A NEW calculated value "Carry Capacity" is created from Strength as a Draft (labelled TEST_ONLY — the rulebook
 *      states no Carry formula). Strength's "What this affects" does not list it yet (Drafts are not Release content).
 *   2. The authored-rule preview evaluates it in an in-memory candidate (the Draft ADDED to the Release's pins) and
 *      writes nothing; the published side has no such value.
 *   3. It is reviewed, proposed and published as Release 2 through M2. A new R2 Character's sheet shows it in the Carry
 *      slot, labelled TEST_ONLY; Strength's impacts in R2 list it; the R1 Character and R1 are unchanged.
 *   4. The Concentration rule preview (owner override): RES 6 → 3 points; a 5 AP cast → 2 AP upkeep; 0 / 1 / 2 points
 *      → 2 / 1 / 0 AP still paid; and it states that play does not use it.
 */
const PREFIX = "test.rw1";
const TIMEOUT = 600_000;
let r1: CharacterReleaseWorld;

const CARRY = {
  valueKey: "CARRY_CAPACITY",
  unit: "lb",
  canonStatus: "TEST_ONLY",
  placement: "CARRY_MAXIMUM_LOAD",
  base: { expression: "25 * str", rounding: "NONE", minimum: 0, maximum: null, unit: null, variables: [{ variable: "str", source: { kind: "STAT", stat: "STR" } }] },
  note: "Test-only placeholder: the Core Playtest packet states no Carry Capacity formula.",
  source: null,
};
const CONCENTRATION = {
  ruleKey: "CONCENTRATION",
  canonStatus: "OWNER_PROVIDED",
  capacity: { expression: "1 + floor(res / 3)", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [{ variable: "res", source: { kind: "STAT", stat: "RES" } }] },
  sustainedSpellUpkeepAp: { expression: "max(1, floor(cast_ap / 2))", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [{ variable: "cast_ap", source: { kind: "CAST_AP" } }] },
  allocation: { apCoveredPerPoint: 1, maySplitAcrossEffects: true, mayStackOnOneEffect: true, uncoveredApPaid: true, waivesMpUpkeep: false, waivesManaLock: false, pointsReturnWhenEffectEnds: true },
  openQuestions: [{ questionKey: "REASSIGNMENT", question: "Can points be reassigned while an Effect continues?" }],
  note: "Owner override of the Core Playtest Concentration rule.",
  source: null,
};
const def = (family: string, kind: string, payload: unknown) => ({ schemaVersion: 1, systemFamily: family, definitionKind: kind, payload });
const sample = (over: Record<string, unknown> = {}) => ({ level: 1, stats: { STR: 4, AGI: 3, CON: 3, PER: 3, RES: 6, PRO: 3 }, skillRanks: [], effects: [], ...over });

async function character(world: CharacterReleaseWorld, name: string) {
  const c = await createCharacter({ name, rulesetReleaseId: world.release.id });
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) as never });
  return finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
}

beforeAll(async () => {
  assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  await cleanupCharacterWorlds(PREFIX);
  r1 = await seedCharacterRelease(PREFIX, "R1", { advancement: true });
}, TIMEOUT);
afterAll(async () => {
  await cleanupCharacterWorlds(PREFIX);
}, TIMEOUT);

describe("RULES-WO1 authored rules end to end", () => {
  let carryEntity = "";
  let carryDraft = "";

  it("creates a TEST_ONLY Carry Capacity value from Strength as a Draft and previews it in an isolated candidate", async () => {
    const created = await createAuthoredDefinition({ definitionKind: "CALCULATED_VALUE", canonicalKey: `${PREFIX}.value.carry_capacity_${Date.now()}`, displayName: "Carry Capacity", prowessDefinition: def("CHARACTER", "CALCULATED_VALUE", CARRY) });
    carryEntity = created.entity.id;
    carryDraft = created.version.id;
    expect(created.version.status).toBe("DRAFT");
    // Not Release content yet.
    expect((await getStatImpacts(r1.release.id, "STR")).impacts.some((i) => i.definition?.entityId === carryEntity)).toBe(false);
    const counts = async () => [await prisma.rulesetRelease.count(), await prisma.rulesetManifest.count(), await prisma.entityVersion.count()];
    const before = await counts();
    const p = await previewAuthoredRules({ releaseId: r1.release.id, drafts: [carryDraft], sample: sample() });
    expect(p.overlay).toEqual([{ entityId: carryEntity, entityVersionId: carryDraft, revisionNumber: 1, status: "DRAFT", mode: "ADDED" }]);
    expect(p.published.values).toEqual([]);
    expect(p.candidate.values).toHaveLength(1);
    expect(p.candidate.values[0]).toMatchObject({ valueKey: "CARRY_CAPACITY", displayName: "Carry Capacity", canonStatus: "TEST_ONLY", total: 100, unit: "lb", baseStated: true });
    expect(await counts()).toEqual(before);
    await expect(previewAuthoredRules({ releaseId: r1.release.id, drafts: [carryDraft], sample: { ...sample(), stats: { STR: 4 } } })).rejects.toThrow(/AGI/);
  }, TIMEOUT);

  it("publishes it as Release 2 through review: a new R2 Character's sheet shows it labelled; R1 and its Character are unchanged", async () => {
    const veteran = await character(r1, "Rw1 Veteran");
    const sheetBefore = await getCharacterSheet(veteran.id);
    expect(sheetBefore.mechanics.carry.maximumLoad.value).toBeNull();
    const rowsBefore = JSON.stringify(await prisma.character.findUniqueOrThrow({ where: { id: veteran.id } }));

    await submitAuthoredRevisionForReview(carryDraft);
    const cs = await proposeDefinitionChangeSet(carryDraft, { rulesetId: r1.rulesetId, name: "Carry Capacity (test-only)" });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    await transitionEntityVersionStatus(carryDraft, "APPROVED");
    const release2 = await publishRulesetRelease({ rulesetId: r1.rulesetId, baseManifestId: r1.release.manifestId, canonPolicyId: r1.policyId, changeSetId: cs.id, versionLabel: "R2" });
    const r2: CharacterReleaseWorld = { ...r1, release: { id: release2.id, manifestId: release2.manifestId, releaseNumber: release2.releaseNumber } };

    const newcomer = await character(r2, "Rw1 Newcomer");
    const sheet = await getCharacterSheet(newcomer.id);
    const str = sheet.mechanics.stats.find((s) => s.stat === "STR")!.total;
    expect(sheet.mechanics.carry.maximumLoad).toMatchObject({ value: 25 * str, unit: "lb", unavailable: null });
    expect(sheet.mechanics.calculatedValues?.map((v) => [v.valueKey, v.canonStatus, v.total])).toEqual([["CARRY_CAPACITY", "TEST_ONLY", 25 * str]]);
    // Strength's "What this affects" in R2 lists the new value, editable, labelled in game terms.
    const impact = (await getStatImpacts(r2.release.id, "STR")).impacts.find((i) => i.definition?.entityId === carryEntity);
    expect(impact).toMatchObject({ roleLabel: "Calculated value", editable: true, direct: true });

    // R1 is unchanged: the veteran's sheet and stored rows are byte-identical.
    const sheetAfter = await getCharacterSheet(veteran.id);
    expect(sheetAfter.mechanics.carry.maximumLoad.value).toBeNull();
    expect("calculatedValues" in sheetAfter.mechanics).toBe(false);
    expect(JSON.stringify(sheetAfter.mechanics)).toBe(JSON.stringify(sheetBefore.mechanics));
    expect(JSON.stringify(await prisma.character.findUniqueOrThrow({ where: { id: veteran.id } }))).toBe(rowsBefore);
  }, TIMEOUT);

  it("previews the owner's Concentration override with the confirmed examples and never claims play uses it", async () => {
    const created = await createAuthoredDefinition({ definitionKind: "CONCENTRATION_RULE", canonicalKey: `${PREFIX}.rule.concentration_${Date.now()}`, displayName: "Concentration", prowessDefinition: def("ABILITY", "CONCENTRATION_RULE", CONCENTRATION) });
    for (const [points, payable] of [[0, 2], [1, 1], [2, 0]] as const) {
      const p = await previewAuthoredRules({ releaseId: r1.release.id, drafts: [created.version.id], sample: sample({ effects: [{ label: "Sustained Spell", castAp: 5, assignedPoints: points }] }) });
      const c = p.candidate.concentration[0]!;
      expect(c.displayName).toBe("Concentration");
      expect(c.preview).toMatchObject({ capacity: 3, appliesInPlay: false, mpUpkeepStillPaid: true, manaLockStillApplies: true });
      expect(c.preview.effects[0]).toMatchObject({ upkeepAp: 2, payableAp: payable });
      expect(p.published.concentration).toEqual([]);
    }
  }, TIMEOUT);
});
