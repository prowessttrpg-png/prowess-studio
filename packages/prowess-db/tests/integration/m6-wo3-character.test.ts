/**
 * PAS-10 M6-WO3 — Character domain: database integration. Runs only against prowess_studio_test.
 *
 * Invariants exercised (docs/architecture/m6-invariants.md): M6-I021 exact Release pin · M6-I022 Release isolation ·
 * M6-I023 derived state recalculated, never stored · M6-I024 Characters are not EntityVersions · M6-I025 finalization
 * freeze · M6-I026 atomic optimistic concurrency · M6-I027 published content only · M6-I028 Level 1 server-owned ·
 * M6-I030 no automatic Release migration. Fixture content is test-only (`test.m6wo3db.*`).
 */
import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacter,
  getCharacterCreationContext,
  getReleaseCharacterCreationCapability,
  listCharacters,
  prisma,
  saveCharacterCreation,
  updateCharacterProfile,
  validateCharacterCandidate,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, seedCharacterRelease, selOf, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";

const PREFIX = "test.m6wo3db";
let r1: CharacterReleaseWorld;
let r2: CharacterReleaseWorld;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, String(error)).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

const value = (c: Awaited<ReturnType<typeof getCharacter>>, statistic: string) => c.resolution.derivedPreview?.find((d) => d.statistic === statistic)?.value;
const TABLES = ["characters", "character_stat_allocations", "character_ancestry_stat_choices", "character_skill_ranks", "entities", "entity_versions", "ruleset_releases", "ruleset_manifest_entries"];
async function fingerprint() {
  const out: Record<string, string> = {};
  for (const t of TABLES) out[t] = (await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t`))[0]!.h;
  return out;
}

describe("M6-WO3 Character domain (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    r1 = await seedCharacterRelease(PREFIX, "R1");
  }, 120_000);

  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 120_000);

  it("§8 the seeded Release is Character-Creation capable; the context lists only its pinned options", async () => {
    const capability = await getReleaseCharacterCreationCapability(r1.release.id);
    expect([capability.status, capability.missing]).toEqual(["READY", []]);
    const c = await createCharacter({ name: "Context Probe", rulesetReleaseId: r1.release.id });
    const ctx = await getCharacterCreationContext(c.id);
    expect(ctx.ancestries.map((a) => a.ref.entityVersionId)).toEqual([selOf(r1.pins, "test.m6wo3.ancestry.orcani").entityVersionId]);
    expect(ctx.skills).toHaveLength(5);
    expect(ctx.affinities.filter((a) => a.executable)).toHaveLength(6);
    expect(ctx.creationRule?.payload).toEqual(expect.objectContaining({ statPointBudget: 15, freeTrainedSkillCount: 2 }));
    expect(ctx.characterDie).toEqual({ level: 1, dieKey: "D4", faces: 4 });
    expect(ctx.stats.map((s) => [s.stat, s.minimum, s.maximum])).toEqual(expect.arrayContaining([["STR", 1, 10]]));
  });

  it("§91 the worked Orcani Character: create → save → finalize; exact selections and the M5 / M4 derived preview", async () => {
    const created = await createCharacter({ name: "Grosh", concept: "Ex-caravan guard", rulesetReleaseId: r1.release.id });
    expect([created.level, created.status, created.lockVersion, created.release.id]).toEqual([1, "DRAFT", 1, r1.release.id]);
    expect(created.resolution.status).toBe("INCOMPLETE");
    const saved = await saveCharacterCreation(created.id, { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    expect([saved.lockVersion, saved.resolution.status, saved.resolution.issues]).toEqual([2, "READY", []]);
    expect(saved.choices.skills.map((s) => s.rankKey)).toEqual(["TRAINED", "TRAINED", "TRAINED"]);
    expect([value(saved, "MAXIMUM_HP"), value(saved, "MAXIMUM_MP"), value(saved, "SIGNATURE_ABILITY_SLOTS"), value(saved, "DODGE")]).toEqual([14, 7, 4, 8]);
    const done = await finalizeCharacterCoreCreation(created.id, { expectedLockVersion: 2 });
    expect([done.status, done.lockVersion, done.coreCreationCompletedAt]).toEqual(["CORE_COMPLETE", 3, expect.any(Date)]);
    expect(done.resolution.resolved.primaryAffinity?.entityVersionId).toBe(selOf(r1.pins, "affinity.evocation").entityVersionId);
    expect(done.names[selOf(r1.pins, "test.m6wo3.ancestry.orcani").entityVersionId]).toBe("Orcani (test)");
    // M6-I023: no derived value is a column; only inputs are stored.
    const row = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM characters WHERE id = $1::uuid`, created.id);
    expect(Object.keys(row[0]!).sort()).toEqual(["ancestry_entity_id", "ancestry_entity_version_id", "concept", "core_creation_completed_at", "created_at", "id", "level", "lock_version", "name", "primary_affinity_entity_id", "primary_affinity_entity_version_id", "ruleset_release_id", "updated_at"].sort());
    const list = await listCharacters({ page: 1, pageSize: 100 });
    expect(list.items.find((i) => i.id === created.id)).toEqual(expect.objectContaining({ name: "Grosh", level: 1, status: "CORE_COMPLETE", release: expect.objectContaining({ id: r1.release.id, releaseNumber: 1, versionLabel: "R1" }) }));
  });

  it("§99 finalization freezes mechanics (service AND database guard); the profile stays editable", async () => {
    const c = await createCharacter({ name: "Frozen", rulesetReleaseId: r1.release.id });
    await saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: 2 });
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 3, candidate: workedChoices(r1.pins) }), CHARACTER_ERROR_CODES.CORE_FROZEN);
    await expectCode(finalizeCharacterCoreCreation(c.id, { expectedLockVersion: 3 }), CHARACTER_ERROR_CODES.CORE_FROZEN);
    // Bypassing the service does not help: the database refuses mechanical changes of a completed Character.
    await expect(prisma.characterStatAllocation.updateMany({ where: { characterId: c.id, stat: "STR" }, data: { pointsSpent: 9 } })).rejects.toThrow(/CHARACTER_CORE_FROZEN/);
    await expect(prisma.character.update({ where: { id: c.id }, data: { ancestryEntityId: null, ancestryEntityVersionId: null } })).rejects.toThrow(/CHARACTER_CORE_FROZEN/);
    const renamed = await updateCharacterProfile(c.id, { expectedLockVersion: 3, name: "Frozen the Second", concept: "Renamed after completion" });
    expect([renamed.name, renamed.concept, renamed.lockVersion, renamed.resolution.status]).toEqual(["Frozen the Second", "Renamed after completion", 4, "READY"]);
  });

  it("§6 the Release is immutable from creation (database guard); §72 no client Level / derived inputs", async () => {
    const c = await createCharacter({ name: "Pinned", rulesetReleaseId: r1.release.id });
    const other = await seedCharacterRelease(PREFIX, "OTHER");
    await expect(prisma.character.update({ where: { id: c.id }, data: { rulesetReleaseId: other.release.id } })).rejects.toThrow(/CHARACTER_RELEASE_IMMUTABLE/);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...workedChoices(r1.pins), level: 5 } }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...workedChoices(r1.pins), maximumHp: 99 } }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    await expectCode(createCharacter({ name: "x", rulesetReleaseId: "not-a-uuid" }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    await expectCode(createCharacter({ name: " ", rulesetReleaseId: r1.release.id }), CHARACTER_ERROR_CODES.INVALID_INPUT);
  }, 120_000);

  it("§94–§96 the server refuses illegal builds (ERROR) and allows incomplete drafts; finalization needs READY", async () => {
    const c = await createCharacter({ name: "Rules Lawyer", rulesetReleaseId: r1.release.id });
    const w = workedChoices(r1.pins);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...w, statAllocations: { ...w.statAllocations, STR: 4 } } }), CHARACTER_ERROR_CODES.INVALID_CREATION);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...w, statAllocations: { ...w.statAllocations, STR: -1 } } }), CHARACTER_ERROR_CODES.INVALID_CREATION);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...w, statAllocations: { STR: 9, AGI: 2, CON: 2, PER: 1, RES: 1, PRO: 0 } } }), CHARACTER_ERROR_CODES.INVALID_CREATION);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...w, skills: [...w.skills, { skill: selOf(r1.pins, "test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null }] } }), CHARACTER_ERROR_CODES.INVALID_CREATION);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...w, primaryAffinity: selOf(r1.pins, "test.m6wo3.skill.arcana") } }), CHARACTER_ERROR_CODES.INVALID_CREATION);
    // An under-budget draft saves; finalization refuses it.
    const draft = await saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...w, statAllocations: { ...w.statAllocations, PRO: 0 } } });
    expect(draft.resolution.status).toBe("INCOMPLETE");
    await expectCode(finalizeCharacterCoreCreation(c.id, { expectedLockVersion: 2 }), CHARACTER_ERROR_CODES.CREATION_INCOMPLETE);
    // Validate an unsaved candidate: side-effect free.
    const before = await fingerprint();
    expect((await validateCharacterCandidate(c.id, w)).status).toBe("READY");
    expect(await fingerprint()).toEqual(before);
  });

  it("§97 concurrent saves with one lockVersion: exactly one wins, no partial child rows", async () => {
    const c = await createCharacter({ name: "Race", rulesetReleaseId: r1.release.id });
    const w = workedChoices(r1.pins);
    const variants = [w, { ...w, statAllocations: { STR: 2, AGI: 4, CON: 3, PER: 2, RES: 2, PRO: 2 } }, { ...w, statAllocations: { STR: 4, AGI: 2, CON: 3, PER: 2, RES: 2, PRO: 2 } }];
    const results = await Promise.allSettled(variants.map((candidate) => saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate })));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) expect(((r as PromiseRejectedResult).reason as DomainError).code).toBe(CHARACTER_ERROR_CODES.STALE_WRITE);
    const after = await getCharacter(c.id);
    expect(after.lockVersion).toBe(2);
    const winner = (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof getCharacter>>>).value;
    expect(after.choices).toEqual(winner.choices);
    expect(Object.values(after.choices.statAllocations).reduce((a, b) => a + b, 0)).toBe(15);
    await expectCode(saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: w }), CHARACTER_ERROR_CODES.STALE_WRITE);
  });

  it("§98 a late failure inside a save rolls everything back (Character, allocations, choices, Skills, Affinity)", async () => {
    const c = await createCharacter({ name: "Rollback", rulesetReleaseId: r1.release.id });
    const w = workedChoices(r1.pins);
    const first = await saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: { ...w, primaryAffinity: selOf(r1.pins, "affinity.conjuration"), statAllocations: { ...w.statAllocations, PRO: 1 } } });
    const before = await fingerprint();
    // A test-only trigger fails the LAST step (Skill rows) after the claim, allocations and choices were rewritten.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION m6wo3_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected late failure'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER m6wo3_test_fail BEFORE INSERT ON character_skill_ranks FOR EACH ROW WHEN (NEW.character_id = '${c.id}'::uuid) EXECUTE FUNCTION m6wo3_test_fail()`);
    try {
      await expect(saveCharacterCreation(c.id, { expectedLockVersion: 2, candidate: w })).rejects.toThrow(/injected late failure/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER m6wo3_test_fail ON character_skill_ranks`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION m6wo3_test_fail()`);
    }
    expect(await fingerprint()).toEqual(before);
    const after = await getCharacter(c.id);
    expect([after.lockVersion, after.choices]).toEqual([2, first.choices]);
  });

  it("§92 / §93 / M6-I030 a newer Release never changes a Character; another Release's revisions are refused", async () => {
    const c = await createCharacter({ name: "Historian", rulesetReleaseId: r1.release.id });
    await saveCharacterCreation(c.id, { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: 2 });
    const before = await getCharacter(c.id);
    r2 = await publishNextRelease(r1, ["test.m6wo3.skill.stealth", "test.m6wo3.skill.athletics", "affinity.evocation", "test.m6wo3.ancestry.orcani"], "R2");
    expect(r2.release.releaseNumber).toBe(2);
    const after = await getCharacter(c.id);
    expect(after).toEqual(before);
    expect(after.release.id).toBe(r1.release.id);
    // Cross-Release: a Release-1 Character submitting Release-2 revisions (same Entities, same canonical keys) is refused.
    const d = await createCharacter({ name: "Cross", rulesetReleaseId: r1.release.id });
    for (const key of ["test.m6wo3.skill.stealth", "affinity.evocation", "test.m6wo3.ancestry.orcani"]) {
      const w = workedChoices(r1.pins);
      const bad = key === "affinity.evocation" ? { ...w, primaryAffinity: selOf(r2.pins, key) } : key === "test.m6wo3.ancestry.orcani" ? { ...w, ancestry: selOf(r2.pins, key) } : { ...w, skills: [w.skills[0], { skill: selOf(r2.pins, key), sourceKind: "FREE", sourceGrantKey: null }, w.skills[2]] };
      const result = await validateCharacterCandidate(d.id, bad);
      expect(result.issues.map((i) => i.code), key).toContain("PROWESS_CHARACTER.NOT_IN_RELEASE");
      await expectCode(saveCharacterCreation(d.id, { expectedLockVersion: 1, candidate: bad }), CHARACTER_ERROR_CODES.INVALID_CREATION);
    }
    // A Release-2 Character builds from Release-2 revisions (revised Ancestry: Base HP 12).
    const e = await createCharacter({ name: "Modern", rulesetReleaseId: r2.release.id });
    const saved = await saveCharacterCreation(e.id, { expectedLockVersion: 1, candidate: workedChoices(r2.pins) });
    expect([saved.resolution.status, value(saved, "MAXIMUM_HP")]).toEqual(["READY", 16]);
  }, 180_000);

  it("§100 / M6-I023 reading a Character recalculates and writes nothing", async () => {
    const list = await listCharacters({ page: 1, pageSize: 5 });
    const before = await fingerprint();
    for (const item of list.items) {
      await getCharacter(item.id);
      await getCharacterCreationContext(item.id);
    }
    expect(await fingerprint()).toEqual(before);
  });
});
