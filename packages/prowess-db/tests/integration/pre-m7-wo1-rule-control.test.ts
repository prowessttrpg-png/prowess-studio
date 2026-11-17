import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  createAuthoredRevision,
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacterSheet,
  getRuleUsage,
  getStatImpacts,
  prisma,
  previewRuleCandidate,
  proposeDefinitionChangeSet,
  publishRulesetRelease,
  saveCharacterCreation,
  submitAuthoredRevisionForReview,
  submitChangeSetForReview,
  transitionEntityVersionStatus,
  updateAuthoredDraftDefinition,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, seedCharacterRelease, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";

/**
 * PRE-M7-WO1 — editable Stat impacts and rules over real PostgreSQL (acceptance C06–C11, service level). An ISOLATED
 * test Ruleset (`test.pm7rule.*`, never the shipped content) carries the core fixture's `STRENGTH_ARMOR = floor(str / 3)`.
 * From Strength's impacts the owning DERIVED_STAT is revised through the ordinary authoring service, previewed with the
 * shared engine (writing nothing), reviewed, proposed and published as Release 2 through M2. A Release-1 Character is
 * untouched; a Release-2 Character uses the new rule.
 */
const PREFIX = "test.pm7rule";
const TIMEOUT = 600_000;
let r1: CharacterReleaseWorld;
let armorEntity = "";
let armorR1Version = "";

type Formula = { expression: string; rounding: string; minimum: number | null; maximum: number | null; unit: string | null; variables: Array<{ variable: string; source: Record<string, unknown> }> };
type Stored = { schemaVersion: number; systemFamily: string; definitionKind: string; payload: { statistic: string; formula: Formula; bonusTarget: unknown; source: unknown } };
const ex = (label: string, STR: number) => ({ label, level: 1, stats: { STR, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3 }, baseHp: 10, baseMp: 4 });
const valueOf = (o: { values: ReadonlyArray<{ statistic: string; value: number | null }> }, s: string) => o.values.find((v) => v.statistic === s)?.value;

async function draftWith(formula: Partial<Formula>, base = armorR1Version) {
  const draft = await createAuthoredRevision(armorEntity, { baseVersionId: base, changeType: "MECHANICAL_CHANGE", changeSummary: "PRE-M7-WO1 test" });
  const stored = structuredClone((draft.structuredData as { prowessDefinition: Stored }).prowessDefinition);
  stored.payload.formula = { ...stored.payload.formula, ...formula };
  const saved = await updateAuthoredDraftDefinition(draft.id, { expectedUpdatedAt: draft.updatedAt.toISOString(), prowessDefinition: stored });
  return { draft: saved.version, validation: saved.validation };
}
async function character(world: CharacterReleaseWorld, name: string) {
  const c = await createCharacter({ name, rulesetReleaseId: world.release.id });
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) as never });
  return finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
}

beforeAll(async () => {
  assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  await cleanupCharacterWorlds(PREFIX);
  r1 = await seedCharacterRelease(PREFIX, "R1", { advancement: true });
  const pin = [...r1.pins.entries()].find(([k]) => k === "core.derived.strength_armor");
  if (pin === undefined) throw new Error("the core fixture has no core.derived.strength_armor");
  armorEntity = pin[1].entityId;
  armorR1Version = pin[1].entityVersionId;
}, TIMEOUT);
afterAll(async () => {
  await cleanupCharacterWorlds(PREFIX);
}, TIMEOUT);

describe("PRE-M7-WO1 Stat impacts and rule control", () => {
  it("C06 Strength's impacts are the ACTUAL rules that read STR in this exact Release, direct and indirect", async () => {
    const impacts = await getStatImpacts(r1.release.id, "STR");
    expect(impacts.payload).toMatchObject({ stat: "STR" });
    const armor = impacts.impacts.find((i) => i.token === "STRENGTH_ARMOR");
    expect(armor).toMatchObject({ role: "DERIVED_STAT", direct: true, depth: 1 });
    expect(armor!.definition).toMatchObject({ entityId: armorEntity, entityVersionId: armorR1Version });
    expect(armor!.reads).toEqual([{ from: "STAT:STR", via: "FORMULA_VARIABLE", path: "/formula/variables/0", variable: "str", expression: "floor(str / 3)" }]);
    // CHOSEN_STAT procedures (a Saving Throw with the chosen Stat) depend on every Stat.
    expect(impacts.impacts.some((i) => i.role === "CORE_RESOLUTION" && i.reads.some((r) => r.via === "CHOSEN_STAT"))).toBe(true);
    // AGI has an indirect dependent: BASE_AP_CAPACITY reads AP_AGILITY_BONUS which reads AGI.
    const agi = await getStatImpacts(r1.release.id, "AGI");
    const indirect = agi.impacts.find((i) => i.token === "BASE_AP_CAPACITY");
    expect(indirect).toMatchObject({ direct: false, depth: 2 });
    expect(indirect!.through.map((t) => t.token)).toEqual(["AP_AGILITY_BONUS"]);
    const usage = await getRuleUsage(r1.release.id, armorEntity);
    expect(usage!.reads).toEqual([{ from: "STAT:STR", via: "FORMULA_VARIABLE", variable: "str" }]);
    await expect(getStatImpacts(r1.release.id, "LUCK")).rejects.toThrow(/Not a Stat/);
  }, TIMEOUT);

  it("C07–C09 change / replace / add / remove a contribution as Draft revisions; previews use the shared engine and write nothing", async () => {
    const before = await prisma.rulesetRelease.count({ where: { rulesetId: r1.rulesetId } });
    // Remove the Strength contribution: a valid NEUTRAL rule (the statistic stays; its value is the constant 0).
    const removed = await draftWith({ expression: "0", variables: [] });
    expect(removed.validation?.status).toBe("PASS");
    // Replace the input: CON instead of STR. Add a contribution: + floor(per / 4). Change the divisor: / 2.
    const replaced = await draftWith({ expression: "floor(con / 3)", variables: [{ variable: "con", source: { kind: "STAT", stat: "CON" } }] });
    const added = await draftWith({ expression: "floor(str / 3) + floor(per / 4)", variables: [{ variable: "str", source: { kind: "STAT", stat: "STR" } }, { variable: "per", source: { kind: "STAT", stat: "PER" } }] });
    const divisor = await draftWith({ expression: "floor(str / 2)" });
    for (const d of [replaced, added, divisor]) expect(d.validation?.status).toBe("PASS");
    const examples = [ex("STR 2", 2), ex("STR 3", 3), ex("STR 5", 5), ex("STR 6", 6), ex("STR 8", 8)];
    const preview = await previewRuleCandidate({ releaseId: r1.release.id, drafts: [removed.draft.id], examples });
    expect(preview.substitutions).toEqual([{ entityId: armorEntity, from: armorR1Version, to: removed.draft.id, toRevision: removed.draft.revisionNumber, toStatus: "DRAFT" }]);
    // floor(str / 3) around the threshold: 2→0, 3→1, 5→1, 6→2, 8→2; the candidate is 0 for every example.
    expect(preview.examples.map((e) => valueOf(e.published, "STRENGTH_ARMOR"))).toEqual([0, 1, 1, 2, 2]);
    expect(preview.examples.map((e) => valueOf(e.candidate, "STRENGTH_ARMOR"))).toEqual([0, 0, 0, 0, 0]);
    expect(preview.changed).toEqual(["STRENGTH_ARMOR"]);
    const half = await previewRuleCandidate({ releaseId: r1.release.id, drafts: [divisor.draft.id], examples });
    expect(half.examples.map((e) => valueOf(e.candidate, "STRENGTH_ARMOR"))).toEqual([1, 1, 2, 3, 4]);
    const sum = await previewRuleCandidate({ releaseId: r1.release.id, drafts: [added.draft.id], examples: [ex("STR 6 PER 3", 6)] });
    expect(valueOf(sum.examples[0]!.candidate, "STRENGTH_ARMOR")).toBe(2); // floor(6/3) + floor(3/4)
    const con = await previewRuleCandidate({ releaseId: r1.release.id, drafts: [replaced.draft.id], examples: [ex("CON 3", 2)] });
    expect(valueOf(con.examples[0]!.candidate, "STRENGTH_ARMOR")).toBe(1);
    // Preview is never a write: no Release, ChangeSet or status changed.
    expect(await prisma.rulesetRelease.count({ where: { rulesetId: r1.rulesetId } })).toBe(before);
    expect((await prisma.entityVersion.findUniqueOrThrow({ where: { id: removed.draft.id } })).status).toBe("DRAFT");
  }, TIMEOUT);

  it("C08 an undeclared input, an unused declaration and a self-referencing / cyclic rule are refused meaningfully", async () => {
    const undeclared = await draftWith({ expression: "floor(dex / 3)", variables: [] });
    expect(undeclared.validation?.status).toBe("FAIL");
    expect(undeclared.validation?.issues.map((i) => i.message)).toContain('Formula variable "dex" has no declared source');
    const unused = await draftWith({ expression: "1", variables: [{ variable: "str", source: { kind: "STAT", stat: "STR" } }] });
    expect(unused.validation?.status).toBe("FAIL");
    expect(unused.validation?.issues.map((i) => i.message)).toContain('declared variable "str" is not used by the expression');
    const self = await draftWith({ expression: "armor + 1", variables: [{ variable: "armor", source: { kind: "DERIVED", statistic: "STRENGTH_ARMOR" } }] });
    const p = await previewRuleCandidate({ releaseId: r1.release.id, drafts: [self.draft.id], examples: [ex("STR 3", 3)] });
    expect(p.candidateProblems.join(" ")).toMatch(/cycle: DERIVED:STRENGTH_ARMOR → DERIVED:STRENGTH_ARMOR/);
    expect(p.examples[0]!.candidate.ok).toBe(false);
    expect(p.examples[0]!.published.ok).toBe(true);
    await expect(previewRuleCandidate({ releaseId: r1.release.id, drafts: [], examples: [{ ...ex("bad", 3), stats: { STR: 3 } }] })).rejects.toThrow(/AGI/);
  }, TIMEOUT);

  it("C10–C11 publish the removal as Release 2 through review; the R1 Character is unchanged and a new R2 Character uses R2", async () => {
    const veteran = await character(r1, "Pm7 Veteran");
    const sheetBefore = await getCharacterSheet(veteran.id);
    const r1Armor = sheetBefore.mechanics.combat.armor.value;
    expect(r1Armor).toBe(Math.floor(sheetBefore.mechanics.stats.find((s) => s.stat === "STR")!.total / 3));
    const rowsBefore = JSON.stringify(await prisma.character.findUniqueOrThrow({ where: { id: veteran.id } }));
    const { draft } = await draftWith({ expression: "0", variables: [] });
    await submitAuthoredRevisionForReview(draft.id);
    const cs = await proposeDefinitionChangeSet(draft.id, { rulesetId: r1.rulesetId, name: "Strength no longer grants Armor (test)" });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    const publish = () => publishRulesetRelease({ rulesetId: r1.rulesetId, baseManifestId: r1.release.manifestId, canonPolicyId: r1.policyId, changeSetId: cs.id, versionLabel: "R2" });
    await expect(publish()).rejects.toThrow(/IN_REVIEW/); // review authority stays with the lifecycle
    await transitionEntityVersionStatus(draft.id, "APPROVED");
    const release2 = await publish();
    const pins = new Map(r1.pins);
    pins.set("core.derived.strength_armor", { ...pins.get("core.derived.strength_armor")!, entityVersionId: draft.id });
    const r2: CharacterReleaseWorld = { ...r1, release: { id: release2.id, manifestId: release2.manifestId, releaseNumber: release2.releaseNumber }, pins };
    const impacts2 = await getStatImpacts(r2.release.id, "STR");
    expect(impacts2.impacts.some((i) => i.token === "STRENGTH_ARMOR")).toBe(false); // R2's armor rule no longer reads STR
    expect((await getStatImpacts(r1.release.id, "STR")).impacts.some((i) => i.token === "STRENGTH_ARMOR")).toBe(true);
    const newcomer = await character(r2, "Pm7 Newcomer");
    expect((await getCharacterSheet(newcomer.id)).mechanics.combat.armor.value).toBe(0);
    const sheetAfter = await getCharacterSheet(veteran.id);
    expect(sheetAfter.mechanics.combat.armor.value).toBe(r1Armor);
    expect(sheetAfter.release.id).toBe(r1.release.id);
    expect(JSON.stringify(await prisma.character.findUniqueOrThrow({ where: { id: veteran.id } }))).toBe(rowsBefore);
  }, TIMEOUT);
});
