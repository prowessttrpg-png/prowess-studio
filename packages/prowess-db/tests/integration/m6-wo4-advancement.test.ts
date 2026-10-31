/**
 * PAS-10 M6-WO4 — Character advancement, access & eligibility: database integration. Runs only against prowess_studio_test.
 *
 * Invariants exercised (docs/architecture/m6-invariants.md): M6-I031 exact Release · M6-I032 one Level at a time ·
 * M6-I033 entitlements are content · M6-I034 creation immutable · M6-I035 append-only history · M6-I036 / M6-I037 /
 * M6-I038 effective state derived · M6-I039 derived never persisted · M6-I040 M5 prerequisites reused · M6-I043 no
 * automatic Release migration · M6-I044 one profile builder. Fixture content is test-only (`test.m6wo4db.*`).
 */
import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  advanceCharacter,
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacter,
  getCharacterAccess,
  getCharacterAdvancementContext,
  getCharacterDefinitionEligibility,
  listCharacterEligibleDefinitions,
  previewCharacterAdvancementFor,
  prisma,
  saveCharacterCreation,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, seedCharacterRelease, selOf, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";
import { ADVANCEMENT_RULE_KEY, PLAYTEST_ADVANCEMENT_LEVELS, advancementRulePayload } from "../../../prowess-game/src/testing/advancement-fixtures.js";

const PREFIX = "test.m6wo4db";
let r1: CharacterReleaseWorld;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, String(error)).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}
async function expectDbError(sql: string, pattern: RegExp) {
  await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(pattern);
}

/** A completed Level-1 Character on `world`. */
async function completed(world: CharacterReleaseWorld, name: string) {
  const c = await createCharacter({ name, rulesetReleaseId: world.release.id });
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) });
  return finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
}
const sel = (w: CharacterReleaseWorld, k: string) => selOf(w.pins, k);
/** The player's choices for each Level 2…10 (Level-6 / Level-9 Affinity branches selectable). */
function script(w: CharacterReleaseWorld) {
  return [
    { statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "TRAIN_NEW", skill: sel(w, "skill.arcana") }], affinityChoice: null },
    { statAllocations: { AGI: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { CON: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: sel(w, "skill.arcana") }], affinityChoice: null },
    { statAllocations: { RES: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: sel(w, "test.m6wo3.skill.athletics") }], affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: sel(w, "affinity.conjuration") } },
    { statAllocations: { STR: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { STR: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: sel(w, "skill.arcana") }], affinityChoice: null },
    { statAllocations: { STR: 1 }, skillAdvancements: [{ action: "TRAIN_NEW", skill: sel(w, "test.m6wo3.skill.survival") }], affinityChoice: { optionKey: "GAIN_NEW_AFFINITY", affinity: sel(w, "affinity.divination") } },
    { statAllocations: { STR: 1, PRO: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: sel(w, "test.m6wo3.skill.stealth") }], affinityChoice: null },
  ];
}
async function advanceTo(world: CharacterReleaseWorld, id: string, n: number) {
  let c = await getCharacter(id);
  for (const choices of script(world).slice(c.level - 1, n - 1)) c = await advanceCharacter(id, { expectedLockVersion: c.lockVersion, choices });
  return c;
}
const TABLES = ["characters", "character_stat_allocations", "character_ancestry_stat_choices", "character_skill_ranks", "character_advancements", "character_stat_advancements", "character_skill_advancements", "character_affinity_advancement_choices"];
async function fingerprint(characterId: string) {
  const out: Record<string, unknown> = {};
  out.character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  out.creation = await prisma.character.findUniqueOrThrow({ where: { id: characterId }, include: { statAllocations: true, ancestryStatChoices: true, skillRanks: { orderBy: { id: "asc" } } } });
  out.history = await prisma.characterAdvancement.findMany({ where: { characterId }, orderBy: { toLevel: "asc" }, include: { statAdvancements: { orderBy: { stat: "asc" } }, skillAdvancements: { orderBy: { id: "asc" } }, affinityChoice: true } });
  for (const t of TABLES) out[t] = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${t}"`))[0]!.n;
  return out;
}

describe("M6-WO4 Character advancement (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    r1 = await seedCharacterRelease(PREFIX, "R1", { advancement: true });
  }, 180_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 120_000);

  it("§11 a Draft cannot advance; §91 the Character exposes advancement capability and its present profile", async () => {
    const draft = await createCharacter({ name: "Draft", rulesetReleaseId: r1.release.id });
    await expectCode(advanceCharacter(draft.id, { expectedLockVersion: draft.lockVersion, choices: script(r1)[0] }), CHARACTER_ERROR_CODES.CORE_CREATION_INCOMPLETE);
    await expectCode(getCharacterAdvancementContext(draft.id), CHARACTER_ERROR_CODES.CORE_CREATION_INCOMPLETE);
    expect((await getCharacter(draft.id)).profile).toBeNull();
    const c = await completed(r1, "Ready");
    expect(c.advancementCapability).toEqual({ status: "ADVANCEMENT_READY", missing: [] });
    expect(c.profile).toMatchObject({ level: 1, characterDie: { dieKey: "D4" }, maximumLevel: 10 });
    expect(c.advancementHistory).toEqual([]);
  });

  it("§108–§109 Level 1 → 2 → 3: Stat, Skill, d6, Primary Affinity TRAINED automatically; history persisted (M6-I032)", async () => {
    const c = await completed(r1, "Climber");
    const ctx = await getCharacterAdvancementContext(c.id);
    expect(ctx.next).toMatchObject({ fromLevel: 1, toLevel: 2, statPoints: 1, skillAdvancements: 0, affinity: null });
    expect(ctx.skillOptions.trainNew.map((o) => o.ref.entityVersionId)).toContain(sel(r1, "skill.arcana").entityVersionId);
    const l2 = await advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: script(r1)[0] });
    expect([l2.level, l2.lockVersion]).toEqual([2, c.lockVersion + 1]);
    const l3 = await advanceCharacter(c.id, { expectedLockVersion: l2.lockVersion, choices: script(r1)[1] });
    expect(l3.profile).toMatchObject({ level: 3, characterDie: { dieKey: "D6", faces: 6 } });
    expect(l3.profile?.affinities[0]).toMatchObject({ role: "PRIMARY", rank: "TRAINED", history: [{ level: 3, from: "NONE", to: "TRAINED" }] });
    expect(l3.profile?.skills.find((s) => s.skill.entityId === sel(r1, "skill.arcana").entityId)).toMatchObject({ rankKey: "TRAINED", source: { kind: "ADVANCEMENT", level: 3 } });
    const rows = await prisma.characterAdvancement.findMany({ where: { characterId: c.id }, orderBy: { toLevel: "asc" }, include: { statAdvancements: true, skillAdvancements: true, affinityChoice: true } });
    expect(rows.map((r) => [r.fromLevel, r.toLevel, r.lockVersionBefore])).toEqual([[1, 2, c.lockVersion], [2, 3, l2.lockVersion]]);
    expect(rows[1]?.affinityChoice).toBeNull(); // the Level-3 progression is automatic: no fake choice row (§29)
    expect(rows[1]?.skillAdvancements).toEqual([expect.objectContaining({ action: "TRAIN_NEW", skillEntityVersionId: sel(r1, "skill.arcana").entityVersionId })]);
    expect(l3.advancementHistory.map((h) => h.toLevel)).toEqual([2, 3]);
  });

  it("§110–§114 Level 10 is reached one Level at a time; advancing beyond the Release's maximum fails and changes nothing", async () => {
    const c = await completed(r1, "Veteran");
    const top = await advanceTo(r1, c.id, 10);
    expect(top.profile).toMatchObject({ level: 10, characterDie: { dieKey: "D12" } });
    expect(top.profile?.stats.find((s) => s.stat === "STR")).toMatchObject({ final: 10, mastery: true });
    expect(top.profile?.affinities.map((a) => [a.role, a.rank])).toEqual([["PRIMARY", "TRAINED"], ["SECONDARY", "TRAINED"], ["SECONDARY", "TRAINED"]]);
    const before = await fingerprint(c.id);
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: top.lockVersion, choices: { statAllocations: { AGI: 1 }, skillAdvancements: [], affinityChoice: null } }), CHARACTER_ERROR_CODES.MAX_LEVEL);
    expect((await getCharacterAdvancementContext(c.id)).maximumLevelReached).toBe(true);
    expect(await fingerprint(c.id)).toEqual(before);
  }, 120_000);

  it("§10 / §17 / §115 the server refuses illegal or incomplete advancements; no client Level / rank / derived input", async () => {
    const c = await completed(r1, "Strict");
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: { statAllocations: {}, skillAdvancements: [], affinityChoice: null } }), CHARACTER_ERROR_CODES.ADVANCEMENT_INCOMPLETE);
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: { statAllocations: { PER: 2 }, skillAdvancements: [], affinityChoice: null } }), CHARACTER_ERROR_CODES.INVALID_ADVANCEMENT);
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: { ...script(r1)[0], toLevel: 3 } }), CHARACTER_ERROR_CODES.INVALID_ADVANCEMENT);
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: { ...script(r1)[0], level: 3 } }), CHARACTER_ERROR_CODES.INVALID_ADVANCEMENT);
    const l2 = await advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: script(r1)[0] });
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: l2.lockVersion, choices: { statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "TRAIN_NEW", skill: sel(r1, "test.m6wo3.skill.athletics") }], affinityChoice: null } }), CHARACTER_ERROR_CODES.INVALID_ADVANCEMENT);
    const preview = await previewCharacterAdvancementFor(c.id, { statAllocations: { PRO: 1 }, skillAdvancements: [], affinityChoice: null });
    expect([preview.status, preview.issues.map((i) => i.code)]).toEqual(["INCOMPLETE", ["PROWESS_ADVANCEMENT.SKILL_ADVANCEMENT_REQUIRED"]]);
    expect((await getCharacter(c.id)).level).toBe(2);
  });

  it("§120 concurrent advances with one lockVersion: exactly one wins; the Character advances one Level, not two", async () => {
    const c = await completed(r1, "Racer");
    const results = await Promise.allSettled([0, 1, 2].map(() => advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: script(r1)[0] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) expect(((r as PromiseRejectedResult).reason as DomainError).code).toBe(CHARACTER_ERROR_CODES.STALE_WRITE);
    const after = await getCharacter(c.id);
    expect([after.level, after.lockVersion]).toEqual([2, c.lockVersion + 1]);
    expect(await prisma.characterAdvancement.count({ where: { characterId: c.id } })).toBe(1);
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: script(r1)[1] }), CHARACTER_ERROR_CODES.STALE_WRITE);
  });

  it("§119 a late failure after child rows are written rolls back the whole advancement", async () => {
    const c = await advanceTo(r1, (await completed(r1, "Fragile")).id, 2);
    const before = await fingerprint(c.id);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION m6wo4_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'm6wo4 injected late failure'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER m6wo4_test_fail BEFORE INSERT ON character_skill_advancements FOR EACH ROW EXECUTE FUNCTION m6wo4_test_fail()`);
    try {
      await expect(advanceCharacter(c.id, { expectedLockVersion: c.lockVersion, choices: script(r1)[1] })).rejects.toThrow(/injected late failure/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER m6wo4_test_fail ON character_skill_advancements`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION m6wo4_test_fail()`);
    }
    expect(await fingerprint(c.id)).toEqual(before);
  });

  it("§44–§47 / §97 the database itself: Level only +1 with its advancement row; history append-only; creation frozen", async () => {
    const c = await advanceTo(r1, (await completed(r1, "Guarded")).id, 3);
    await expectDbError(`UPDATE characters SET level = 5 WHERE id = '${c.id}'`, /CHARACTER_LEVEL_GUARD/);
    await expectDbError(`UPDATE characters SET level = 2 WHERE id = '${c.id}'`, /CHARACTER_LEVEL_GUARD/);
    await expectDbError(`UPDATE characters SET level = 4 WHERE id = '${c.id}'`, /CHARACTER_LEVEL_GUARD/);
    await expectDbError(`UPDATE character_advancements SET to_level = 9 WHERE character_id = '${c.id}'`, /CHARACTER_ADVANCEMENT_IMMUTABLE/);
    await expectDbError(`DELETE FROM character_advancements WHERE character_id = '${c.id}'`, /CHARACTER_ADVANCEMENT_IMMUTABLE/);
    const first = await prisma.characterAdvancement.findFirstOrThrow({ where: { characterId: c.id, toLevel: 2 } });
    await expectDbError(`UPDATE character_stat_advancements SET points_spent = 5 WHERE advancement_id = '${first.id}'`, /CHARACTER_ADVANCEMENT_IMMUTABLE/);
    await expectDbError(`INSERT INTO character_stat_advancements (advancement_id, stat, points_spent) VALUES ('${first.id}', 'STR', 1)`, /CHARACTER_ADVANCEMENT_IMMUTABLE/);
    await expectDbError(`INSERT INTO character_advancements (character_id, from_level, to_level, lock_version_before) VALUES ('${c.id}', 5, 6, 1)`, /CHARACTER_ADVANCEMENT_ORDER/);
    await expectDbError(`INSERT INTO character_advancements (character_id, from_level, to_level, lock_version_before) VALUES ('${c.id}', 3, 5, 1)`, /character_advancements_one_level_check/);
    await expectDbError(`UPDATE character_stat_allocations SET points_spent = 9 WHERE character_id = '${c.id}'`, /CHARACTER_CORE_FROZEN/);
    await expectDbError(`UPDATE characters SET ruleset_release_id = gen_random_uuid() WHERE id = '${c.id}'`, /CHARACTER_RELEASE_IMMUTABLE/);
    const draft = await createCharacter({ name: "Draft Level", rulesetReleaseId: r1.release.id });
    await expectDbError(`UPDATE characters SET level = 2 WHERE id = '${draft.id}'`, /CHARACTER_LEVEL_GUARD/);
  });

  it("§121 creation records stay byte-for-byte unchanged across advancements (M6-I034)", async () => {
    const c = await completed(r1, "Steady");
    const creation = async () => prisma.character.findUniqueOrThrow({ where: { id: c.id }, select: { ancestryEntityVersionId: true, primaryAffinityEntityVersionId: true, coreCreationCompletedAt: true, rulesetReleaseId: true, statAllocations: { orderBy: { stat: "asc" } }, ancestryStatChoices: { orderBy: [{ grantKey: "asc" }, { stat: "asc" }] }, skillRanks: { orderBy: { id: "asc" } } } });
    const before = await creation();
    await advanceTo(r1, c.id, 6);
    expect(await creation()).toEqual(before);
  }, 120_000);

  it("§117 cross-Release Skill / Affinity versions are refused; §118 a Character keeps its Release's progression after a newer Release", async () => {
    const c = await advanceTo(r1, (await completed(r1, "Historian")).id, 2);
    const before = await getCharacter(c.id);
    const r2 = await publishNextRelease(r1, ["skill.arcana", "affinity.conjuration", ADVANCEMENT_RULE_KEY], "R2", {
      [ADVANCEMENT_RULE_KEY]: advancementRulePayload(PLAYTEST_ADVANCEMENT_LEVELS.map((l) => ({ ...l, statPoints: 3 }))),
    });
    const after = await getCharacter(c.id);
    expect(after.release.id).toBe(r1.release.id);
    expect(after.profile).toEqual(before.profile);
    // Release 1's schedule still applies (1 Stat Point at Level 3), Release 2's (3) does not.
    const ctx = await getCharacterAdvancementContext(c.id);
    expect(ctx.next).toMatchObject({ toLevel: 3, statPoints: 1, source: expect.objectContaining({ entityVersionId: sel(r1, ADVANCEMENT_RULE_KEY).entityVersionId }) });
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: after.lockVersion, choices: { statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "TRAIN_NEW", skill: sel(r2, "skill.arcana") }], affinityChoice: null } }), CHARACTER_ERROR_CODES.INVALID_ADVANCEMENT);
    const l5 = await advanceTo(r1, c.id, 5);
    const r2Affinity = { ...script(r1)[4], affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: sel(r2, "affinity.conjuration") } };
    await expectCode(advanceCharacter(c.id, { expectedLockVersion: l5.lockVersion, choices: r2Affinity }), CHARACTER_ERROR_CODES.INVALID_ADVANCEMENT);
    expect((await advanceCharacter(c.id, { expectedLockVersion: l5.lockVersion, choices: script(r1)[4] })).level).toBe(6);
  }, 180_000);

  it("§123–§127 access & eligibility come from the profile and exact prerequisites; reading writes nothing", async () => {
    const c = await completed(r1, "Scholar");
    const access1 = await getCharacterAccess(c.id);
    expect(access1.summary.spell.arcaneAuthority).toMatchObject({ rankKey: "UNTRAINED", eligible: false });
    const lore = sel(r1, "test.m6wo4.effect.expert_lore");
    const evo = sel(r1, "test.m6wo4.effect.evocation_trained");
    expect((await getCharacterDefinitionEligibility(c.id, lore)).status).toBe("INELIGIBLE");
    expect((await getCharacterDefinitionEligibility(c.id, evo)).status).toBe("INELIGIBLE");
    const l3 = await advanceTo(r1, c.id, 3);
    expect((await getCharacterDefinitionEligibility(c.id, evo)).status).toBe("ELIGIBLE");
    expect((await getCharacterDefinitionEligibility(c.id, lore)).requirements[0]).toMatchObject({ actual: { rankKey: "TRAINED" }, satisfied: false });
    const preview = await previewCharacterAdvancementFor(c.id, script(r1)[2]);
    expect([preview.status, preview.toLevel]).toEqual(["READY", 4]);
    await advanceTo(r1, c.id, 5);
    expect((await getCharacterDefinitionEligibility(c.id, lore)).status).toBe("ELIGIBLE");
    const listed = await listCharacterEligibleDefinitions(c.id, { definitionKind: "SPELL_EFFECT", includeLocked: true, page: 1, pageSize: 10 });
    expect(listed.items.map((i) => i.status)).toEqual(["ELIGIBLE", "ELIGIBLE"]);
    await expectCode(listCharacterEligibleDefinitions(c.id, { definitionKind: "NOT_A_KIND", page: 1, pageSize: 10 }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    const before = await fingerprint(c.id);
    for (let i = 0; i < 2; i += 1) {
      await getCharacter(c.id);
      await getCharacterAccess(c.id);
      await getCharacterAdvancementContext(c.id);
      await previewCharacterAdvancementFor(c.id, script(r1)[5]);
      await listCharacterEligibleDefinitions(c.id, { definitionKind: "SPELL_EFFECT", page: 1, pageSize: 10 });
    }
    expect(await fingerprint(c.id)).toEqual(before);
    expect(l3.level).toBe(3);
  }, 120_000);
});
