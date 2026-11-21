import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  createAuthoredDefinition,
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacterSheet,
  createSourceDocument,
  getStatImpacts,
  ingestSourceSnapshot,
  listAuthoringOptions,
  lookupSourceSections,
  prisma,
  previewReferenceDefinition,
  previewAuthoredRules,
  proposeDefinitionChangeSet,
  publishRulesetRelease,
  saveCharacterCreation,
  submitAuthoredRevisionForReview,
  submitChangeSetForReview,
  transitionEntityVersionStatus,
  updateAuthoredDraftDefinition,
  createChangeSet,
  getCharacterActionDirectory,
  materializeProwessDefinitionsFromRelease,
  createKeywordDefinition,
  changeKeywordPresentation,
  getKeywordUsage,
  getKeywordDefinition,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { docx } from "../fixtures/prowess-structure-fixtures";
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

  it("Phase C: an Armor Draft previews through the contract; sections are found by title; values and ranks are offered by name", async () => {
    const heavy = { armorKey: "HEAVY_PLATE", category: "HEAVY", armorValue: 5, strengthRequirement: 5, maxAgiForDodge: 5, movementPenaltyFeet: 5, stealth: "DISADVANTAGE", notes: [], source: { locators: ["s1"], conflicts: [] } };
    const armor = await createAuthoredDefinition({ definitionKind: "ARMOR", canonicalKey: `${PREFIX}.armor.heavy_${Date.now()}`, displayName: "Heavy Plate (test)", prowessDefinition: def("EQUIPMENT", "ARMOR", heavy) });
    const before = await prisma.entityVersion.count();
    const p = await previewReferenceDefinition({ entityVersionId: armor.version.id, sample: { stats: { AGI: 8, STR: 4 } } });
    expect(p.result).toMatchObject({ agiCountedForDodge: 5, agiCapped: true, meetsStrengthRequirement: false, appliesInPlay: false });
    expect(await prisma.entityVersion.count()).toBe(before);
    await expect(previewReferenceDefinition({ entityVersionId: carryDraft, sample: {} })).rejects.toThrow(/has no reference preview/);

    const document = await createSourceDocument({ title: `${PREFIX} rulebook`, sourceType: "DOCUMENT" });
    const { snapshot } = await ingestSourceSnapshot(document.id, docx({ title: "rw1", blocks: [{ kind: "heading", level: 1, text: "ARMOR" }, { kind: "p", text: "Armor text." }, { kind: "heading", level: 2, text: "LIGHT ARMOR" }, { kind: "p", text: "Light." }, { kind: "heading", level: 1, text: "CONCENTRATION" }, { kind: "p", text: "Points." }] }), { label: "rw1", originalFilename: "rw1.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const found = await lookupSourceSections({ snapshotId: snapshot.id, q: "armor", locators: ["s0", "s9"] });
    expect(found.matches.map((m) => [m.locator, m.title, m.parentTitle])).toEqual([["s0", "ARMOR", null], ["s1", "LIGHT ARMOR", "ARMOR"]]);
    expect(found.known.map((k) => k.title)).toEqual(["ARMOR"]);
    expect(found.unknown).toEqual(["s9"]);
    await expect(lookupSourceSections({ locators: ["208"] })).rejects.toThrow(/section keys/);

    expect((await listAuthoringOptions("calculatedValues")).some((o) => o.token === "CARRY_CAPACITY")).toBe(true);
    expect((await listAuthoringOptions("skillRanks")).map((o) => o.token)).toEqual(expect.arrayContaining(["TRAINED"]));
  }, TIMEOUT);

  it("Phase D (R19/R20): every new reference kind round-trips losslessly; a stale save and an invalid table are refused and write nothing", async () => {
    const SRC = { locators: ["s1"], conflicts: [] };
    const athletics = r1.pins.get("test.m6wo3.skill.athletics")!;
    const skillRef = { entityId: athletics.entityId, entityVersionId: athletics.entityVersionId, canonicalKey: athletics.canonicalKey, definitionKind: "SKILL", systemFamily: "SKILL" };
    const rows = [{ from: 1, to: 2, result: "No public combat." }, { from: 3, to: 4, result: "Hidden clause." }];
    const cases: Array<[string, string, number, Record<string, unknown>]> = [
      ["EQUIPMENT", "ARMOR", 1, { armorKey: "RT_PLATE", category: "MEDIUM", armorValue: 3, strengthRequirement: null, maxAgiForDodge: null, movementPenaltyFeet: 0, stealth: "NORMAL", notes: ["Illustrative."], source: SRC }],
      ["CONDITION", "STATUS_CONDITION", 1, { conditionKey: "RT_BURNING", effects: [{ effectKey: "DOT", text: "Takes damage over time." }], duration: { model: "ROUNDS", rounds: 2, text: null }, removal: ["Put out the flames."], ongoingTiming: "START_OF_TURN", stacking: "REFRESHES_DURATION", triggers: [{ triggerKey: "BURN", when: "START_OF_TURN", resistStat: null, text: "Takes the ongoing damage." }, { triggerKey: "CATCH", when: "ON_FAILED_SAVE", resistStat: "AGI", text: "Catches fire on a failed AGI Save." }], source: SRC }],
      ["SUMMON", "SUMMON_TYPE", 1, { summonKey: "RT_FUSION", engine: "FUSION", tiers: [{ tierKey: "TIER_1", label: "Tier 1", baseMp: 10, dieFaces: null, staticValue: null, hp: null, armor: null, resolve: null, radiusFeet: null, size: null, traitSlots: 1 }], castingAp: null, sustainMode: "NONE", sustainMp: null, sustainApPerRound: null, countsTowardConcentration: null, maxActive: null, actionEconomy: "Merges with the caster.", ownership: { actionModel: "SELF_BOUND", actsWhen: "CASTER_TURN", baseAp: null, apOwner: "CASTER", hpOwner: "CASTER", mpOwner: "CASTER", counterActions: null, dismissal: "FREE_ACTION" }, restrictions: [{ restrictionKey: "NO_EXTRA", kind: "NO_EXTRA_ACTIONS", text: "Gains no extra actions." }], openQuestions: ["Does it count toward Concentration?"], source: SRC }],
      ["SUMMON", "SUMMON_TRAIT", 1, { traitKey: "RT_PULSE", engines: ["TOTEM", "FUSION"], costs: [{ tierKey: "TIER_1", mp: 5 }], forbidden: false, effect: "Illustrative.", source: SRC }],
      ["MISSION", "MISSION_RULE", 1, { ruleKey: "RT_CLAUSES", shape: "ROLL_TABLE", rollTable: { dieCount: 1, dieFaces: 4, rows }, clock: null, intel: null, points: null, relatedRules: [], source: SRC }],
      ["CORE", "REFERENCE_RULE", 1, { ruleKey: "RT_GRAPPLE", shape: "POINTS", rollTable: null, clock: null, intel: null, points: ["Movement becomes 0."], relatedRules: [], source: SRC }],
      ["SPELL", "METAMAGIC", 1, { metamagicKey: "RT_EXTEND", form: "OPTION", mp: 2, ap: null, otherCost: null, effect: "Illustrative.", restrictions: [], source: SRC }],
      ["CHARACTER", "JOB_TEMPLATE", 1, { jobKey: "RT_WARRIOR", role: "Front line.", suggestedStats: ["STR"], suggestedSkills: [skillRef], startingEquipment: [], features: [], source: SRC }],
    ];
    for (const [family, kind, schemaVersion, payload] of cases) {
      const created = await createAuthoredDefinition({ definitionKind: kind, canonicalKey: `${PREFIX}.rt.${kind.toLowerCase()}_${Date.now()}`, displayName: `${kind} round trip`, prowessDefinition: { schemaVersion, systemFamily: family, definitionKind: kind, payload } });
      expect(created.validation?.status, kind).toBe("PASS");
      const stored = await prisma.entityVersion.findUniqueOrThrow({ where: { id: created.version.id } });
      expect((stored.structuredData as { prowessDefinition: { payload: unknown } }).prowessDefinition.payload, `${kind} is stored exactly as authored`).toEqual(payload);
    }

    // A linked Mission rule, then a stale save (loaded before another save) is refused and changes nothing.
    const grapple = await createAuthoredDefinition({ definitionKind: "REFERENCE_RULE", canonicalKey: `${PREFIX}.rt.link_${Date.now()}`, displayName: "Cover (test)", prowessDefinition: def("CORE", "REFERENCE_RULE", cases[5]![3]) });
    const link = { entityId: grapple.entity.id, entityVersionId: grapple.version.id, canonicalKey: grapple.entity.canonicalKey, definitionKind: "REFERENCE_RULE", systemFamily: "CORE" };
    const mission = await createAuthoredDefinition({ definitionKind: "MISSION_RULE", canonicalKey: `${PREFIX}.rt.mission_${Date.now()}`, displayName: "Clauses (test)", prowessDefinition: def("MISSION", "MISSION_RULE", { ...cases[4]![3], relatedRules: [link] }) });
    expect(mission.validation?.status).toBe("PASS");
    const loadedAt = mission.version.updatedAt.toISOString();
    const first = await updateAuthoredDraftDefinition(mission.version.id, { expectedUpdatedAt: loadedAt, changeType: "MECHANICAL_PATCH", changeSummary: "first save", prowessDefinition: def("MISSION", "MISSION_RULE", { ...cases[4]![3], relatedRules: [link], rollTable: { dieCount: 1, dieFaces: 4, rows: [{ from: 1, to: 4, result: "One clause." }] } }) });
    const afterFirst = await prisma.entityVersion.findUniqueOrThrow({ where: { id: mission.version.id } });
    await expect(updateAuthoredDraftDefinition(mission.version.id, { expectedUpdatedAt: loadedAt, changeType: "MECHANICAL_PATCH", changeSummary: "stale", prowessDefinition: def("MISSION", "MISSION_RULE", { ...cases[4]![3], relatedRules: [] }) })).rejects.toThrow(/changed after it was loaded/);
    expect(await prisma.entityVersion.findUniqueOrThrow({ where: { id: mission.version.id } })).toEqual(afterFirst);
    expect(first.version.updatedAt.toISOString()).not.toBe(loadedAt);

    // An invalid table (a gap at 3): a Draft may hold work in progress, but validation FAILS with the row and the expected
    // number, and the Draft cannot be submitted for review — so it can never reach a Release.
    const gap = { ...cases[4]![3], rollTable: { dieCount: 1, dieFaces: 4, rows: [rows[0], { from: 4, to: 4, result: "x" }] } };
    const saved = await updateAuthoredDraftDefinition(mission.version.id, { expectedUpdatedAt: first.version.updatedAt.toISOString(), changeType: "MECHANICAL_PATCH", changeSummary: "gap", prowessDefinition: def("MISSION", "MISSION_RULE", gap) });
    expect(saved.validation?.status).toBe("FAIL");
    expect(saved.validation?.issues.map((i) => i.message).join(" ")).toMatch(/continue at 3/);
    const changeSetsBefore = await prisma.changeSet.count();
    await expect(submitAuthoredRevisionForReview(mission.version.id)).rejects.toThrow();
    expect((await prisma.entityVersion.findUniqueOrThrow({ where: { id: mission.version.id } })).status).toBe("DRAFT");
    expect(await prisma.changeSet.count()).toBe(changeSetsBefore);
  }, TIMEOUT);

  it("Phase D (R08): a published Skill benefit decides eligible and ineligible Characters, applies its bonuses and grants its Action; an R1 Character is unchanged", async () => {
    const veteran = await character(r1, "Rw1 Skill Veteran");
    const veteranSheet = JSON.stringify((await getCharacterSheet(veteran.id)).mechanics);
    const veteranDirectory = JSON.stringify(await getCharacterActionDirectory(veteran.id));
    const bundle = (await materializeProwessDefinitionsFromRelease(r1.release.id)).bundle;
    const sprintPin = r1.pins.get("action.sprint")!;
    const sprint = bundle.definitions.find((d) => d.entityId === sprintPin.entityId)!;
    const sprintRef = { entityId: sprint.entityId, entityVersionId: sprint.entityVersionId, canonicalKey: sprint.canonicalKey, definitionKind: "ACTION", systemFamily: sprint.systemFamily };
    const athletics = r1.pins.get("test.m6wo3.skill.athletics")!;
    const skill = { entityId: athletics.entityId, entityVersionId: athletics.entityVersionId, canonicalKey: athletics.canonicalKey, definitionKind: "SKILL", systemFamily: "SKILL" };
    const SRC = { locators: ["s52"], conflicts: [] };
    const five = { expression: "5", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [] };
    const stamp = Date.now();
    const defs: Array<[string, string, Record<string, unknown>]> = [
      ["CHARACTER", "CALCULATED_VALUE", { valueKey: "LEAP_DISTANCE", unit: "ft", canonStatus: "TEST_ONLY", placement: "ADDITIONAL_VALUES", base: null, note: "Test-only value for the R08 proof.", source: null }],
      ["SKILL", "SKILL_BENEFIT", { benefitKey: "STRONG_LEAP", skill, minimumRankKey: "TRAINED", contributions: [{ contributionKey: "ALWAYS", valueKey: "LEAP_DISTANCE", amount: five, condition: null }, { contributionKey: "UPHILL", valueKey: "LEAP_DISTANCE", amount: five, condition: { conditionKey: "UPHILL", text: "only when leaping uphill (illustrative)" } }], grantedActions: [sprintRef], prerequisiteGroups: [{ groupKey: "STRONG", mode: "ALL", prerequisites: [{ prerequisiteKey: "STR_5", kind: "STAT_AT_LEAST", stat: "STR", minimum: 5 }] }], writtenBenefit: "Strong leapers add 5 ft and gain Sprint (illustrative).", source: SRC }],
    ];
    const operations = [];
    for (const [family, kind, payload] of defs) {
      const created = await createAuthoredDefinition({ definitionKind: kind, canonicalKey: `${PREFIX}.r08.${kind.toLowerCase()}_${stamp}`, displayName: `${kind} (R08 test)`, prowessDefinition: def(family, kind, payload) });
      expect(created.validation?.status, kind).toBe("PASS");
      await submitAuthoredRevisionForReview(created.version.id);
      await transitionEntityVersionStatus(created.version.id, "APPROVED");
      operations.push({ operationType: "PIN_ENTITY_VERSION" as const, targetEntityId: created.entity.id, toEntityVersionId: created.version.id, targetManifestId: null, description: `R08 ${kind}` });
    }
    const latest = await prisma.rulesetRelease.findFirstOrThrow({ where: { rulesetId: r1.rulesetId }, orderBy: { releaseNumber: "desc" } });
    const cs = await createChangeSet(r1.rulesetId, { canonDecisionId: null, name: "R08 Skill benefit", description: null, operations });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    const rel = await publishRulesetRelease({ rulesetId: r1.rulesetId, baseManifestId: latest.manifestId, canonPolicyId: r1.policyId, changeSetId: cs.id, versionLabel: `R08-${stamp}` });
    const rw: CharacterReleaseWorld = { ...r1, release: { id: rel.id, manifestId: rel.manifestId, releaseNumber: rel.releaseNumber } };

    // Eligible: STR allocation 3 (+2 Orcani) = 5. Ineligible: STR allocation 1 (+2) = 3 — the same Skill rank.
    const strong = await character(rw, "Rw1 Strong");
    const c = await createCharacter({ name: "Rw1 Light", rulesetReleaseId: rw.release.id });
    const choices = { ...workedChoices(rw.pins), statAllocations: { STR: 1, AGI: 5, CON: 3, PER: 2, RES: 2, PRO: 2 } };
    const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: choices as never });
    const light = await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });

    const strongSheet = (await getCharacterSheet(strong.id)).mechanics;
    const lightSheet = (await getCharacterSheet(light.id)).mechanics;
    expect(strongSheet.stats.find((x) => x.stat === "STR")!.total).toBeGreaterThanOrEqual(5);
    expect(lightSheet.stats.find((x) => x.stat === "STR")!.total).toBeLessThan(5);
    expect(strongSheet.skillBenefits?.map((b) => [b.benefitKey, b.rankMet, b.eligibility, b.status])).toEqual([["STRONG_LEAP", true, "ELIGIBLE", "GRANTED"]]);
    expect(lightSheet.skillBenefits?.map((b) => [b.benefitKey, b.rankMet, b.eligibility, b.status])).toEqual([["STRONG_LEAP", true, "INELIGIBLE", "INELIGIBLE"]]);
    const leap = (m: typeof strongSheet) => m.calculatedValues!.find((v) => v.valueKey === "LEAP_DISTANCE")!;
    expect(leap(strongSheet).total).toBe(5); // the situational +5 is shown with its condition, never added
    expect(leap(strongSheet).contributions.map((x) => [x.contributionKey, x.applies, x.amount, x.condition?.conditionKey ?? null])).toEqual([["ALWAYS", true, 5, null], ["UPHILL", true, 5, "UPHILL"]]);
    expect(leap(lightSheet).total).toBe(0);
    const card = (id: string) => getCharacterActionDirectory(id).then((d) => (d as unknown as { directory: { cards: Array<{ section: { action: { entityId: string }; grantedBySkills?: Array<{ benefitKey: string; status: string }> } }> } }).directory.cards.find((x) => x.section.action.entityId === sprint.entityId)!);
    expect((await card(strong.id)).section.grantedBySkills).toEqual([expect.objectContaining({ benefitKey: "STRONG_LEAP", status: "GRANTED" })]);
    expect((await card(light.id)).section.grantedBySkills).toEqual([expect.objectContaining({ benefitKey: "STRONG_LEAP", status: "INELIGIBLE" })]);

    // A Character pinned to the earlier Release is unchanged — sheet and Action Directory byte-identical.
    expect(JSON.stringify((await getCharacterSheet(veteran.id)).mechanics)).toBe(veteranSheet);
    expect(JSON.stringify(await getCharacterActionDirectory(veteran.id))).toBe(veteranDirectory);
  }, TIMEOUT);

  it("Phase D (R09): a Keyword's presentation is edited safely — key and category never change; a stale edit is refused and writes nothing", async () => {
    const kw = await createKeywordDefinition({ canonicalKey: `${PREFIX}.keyword.rt_${Date.now()}` as never, name: "Ember (test)", categoryId: null, description: null });
    const usage = await getKeywordUsage(kw.id);
    expect(usage).toEqual({ entityAssignments: 0, versionAssignments: 0, definitionRevisions: 0, releases: 0 });
    const changed = await changeKeywordPresentation(kw.id, { expected: { name: "Ember (test)", description: null, deprecated: false }, name: "Cinder (test)", description: "Renamed for readability.", deprecated: true });
    expect(changed).toMatchObject({ id: kw.id, canonicalKey: kw.canonicalKey, categoryId: null, name: "Cinder (test)", description: "Renamed for readability.", deprecated: true });
    const before = await getKeywordDefinition(kw.id);
    // Stale: the editor still holds the original values — refused, nothing written.
    await expect(changeKeywordPresentation(kw.id, { expected: { name: "Ember (test)", description: null, deprecated: false }, name: "Ash (test)", description: null, deprecated: false })).rejects.toThrow(/changed after it was loaded/);
    expect(await getKeywordDefinition(kw.id)).toEqual(before);
    // Only presentation fields exist in the edit: an attempt to pass a key or category is not part of the service input.
    await expect(changeKeywordPresentation(kw.id, { expected: { name: "Cinder (test)", description: "Renamed for readability.", deprecated: true }, name: " ", description: null, deprecated: false })).rejects.toThrow(/name is required/);
    expect(await getKeywordDefinition(kw.id)).toEqual(before);
  }, TIMEOUT);
});
