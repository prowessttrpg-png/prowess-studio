/**
 * PAS-10 M6-WO3 — Character API: HTTP-level integration proof. Every call goes through a REAL route handler against the
 * real prowess_studio_test database. The published, Character-Creation-capable Release is seeded by
 * tests/integration/fixtures/m6-wo3-character-world.ts (public @prowess/db services; test-only canonical keys — never
 * game canon).
 *
 * Proves: strict create input (no Level / derived values / composition), server-set Level 1, exact Release pin,
 * capability READY vs MISSING_REQUIRED_CONTENT, side-effect-free validate, Save & Continue with lockVersion (stale →
 * 409), illegal build → 422, finalize → frozen (409) while the profile stays editable, cross-Release selections
 * rejected, Release reproducibility after a newer Release, and read-only reads.
 *
 * Invariants exercised: M6-I021 exact Release pin · M6-I022 Release isolation · M6-I025 finalization freeze · M6-I026
 * optimistic concurrency · M6-I028 server-owned Level 1 · M6-I030 no automatic Release migration.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Character from "../../app/api/characters/[characterId]/route";
import * as Profile from "../../app/api/characters/[characterId]/profile/route";
import * as Context from "../../app/api/characters/[characterId]/creation-context/route";
import * as Validate from "../../app/api/characters/[characterId]/validate/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Capability from "../../app/api/character-creation/releases/[releaseId]/capability/route";
import { call } from "./m2-api-harness";
import { cleanupCharacterWorlds, publishNextRelease, seedCharacterWorld, selOf, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo3api";
let r1: CharacterWorld;
let r2: CharacterWorld;

async function create(name: string, releaseId = r1.release.id) {
  return call(Characters.POST, "POST", "/api/characters", {}, { name, concept: "A test concept", rulesetReleaseId: releaseId });
}
const p = (characterId: string) => ({ characterId });

describe("M6-WO3 Character API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    r1 = await seedCharacterWorld(PREFIX, "R1");
  }, 120_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 120_000);

  it("capability is READY for the fixture Release and 404 for an unknown Release", async () => {
    const ok = await call(Capability.GET, "GET", "/x", { releaseId: r1.release.id });
    expect(ok.status).toBe(200);
    expect(ok.data.status).toBe("READY");
    expect(ok.data.missing).toEqual([]);
    expect(ok.data.release.id).toBe(r1.release.id);
    const missing = await call(Capability.GET, "GET", "/x", { releaseId: "00000000-0000-4000-8000-000000000000" });
    expect(missing.status).toBe(404);
  });

  it("create accepts only name / concept / exact Release; Level is set by the server (§22, §72)", async () => {
    for (const extra of [{ level: 5 }, { maximumHp: 99 }, { rulesetId: r1.rulesetId }, { manifest: [] }]) {
      const bad = await call(Characters.POST, "POST", "/api/characters", {}, { name: "X", concept: null, rulesetReleaseId: r1.release.id, ...extra });
      expect(bad.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await call(Characters.POST, "POST", "/api/characters", {}, { name: "   ", concept: null, rulesetReleaseId: r1.release.id })).status).toBe(400);
    const created = await create("Grukk");
    expect(created.status).toBe(201);
    expect(created.data.level).toBe(1);
    expect(created.data.status).toBe("DRAFT");
    expect(created.data.release.id).toBe(r1.release.id);
    expect(created.data.lockVersion).toBe(1);
    const row = await prisma.character.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(row.rulesetReleaseId).toBe(r1.release.id);
  });

  it("creation context comes from the exact Release; validate is side-effect free", async () => {
    const c = (await create("Context")).data;
    const ctx = await call(Context.GET, "GET", "/x", p(c.id));
    expect(ctx.status).toBe(200);
    expect(ctx.data.release.id).toBe(r1.release.id);
    expect(ctx.data.capability.status).toBe("READY");
    expect(ctx.data.ancestries.map((a: { ref: { entityVersionId: string } }) => a.ref.entityVersionId)).toEqual([r1.pins.get("test.m6wo3.ancestry.orcani")?.entityVersionId ?? expect.any(String)]);
    expect(ctx.data.skills.length).toBe(5);
    expect(ctx.data.stats.length).toBe(6);
    const before = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    const v = await call(Validate.POST, "POST", "/x", p(c.id), { candidate: workedChoices(r1.pins) });
    expect(v.status).toBe(200);
    expect(v.data.status).toBe("READY");
    expect(v.data.resolved.level).toBe(1);
    const derived = Object.fromEntries((v.data.derivedPreview as Array<{ statistic: string; value: number }>).map((d) => [d.statistic, d.value]));
    expect(derived.MAXIMUM_HP).toBe(14);
    expect(derived.MAXIMUM_MP).toBe(7);
    expect(derived.SIGNATURE_ABILITY_SLOTS).toBe(4);
    const after = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toEqual(before);
    expect(await prisma.characterSkillRank.count({ where: { characterId: c.id } })).toBe(0);
  });

  it("Save & Continue uses lockVersion (stale → 409); an illegal build is 422; derived inputs are rejected", async () => {
    const c = (await create("Saver")).data;
    const saved = await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    expect(saved.status).toBe(200);
    expect(saved.data.lockVersion).toBe(2);
    const stale = await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("CHARACTER.STALE_WRITE");
    const over = { ...workedChoices(r1.pins), statAllocations: { STR: 9, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 } };
    const illegal = await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 2, candidate: over });
    expect(illegal.status).toBe(422);
    expect(illegal.body.error?.code).toBe("CHARACTER.INVALID_CREATION");
    const smuggled = await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 2, candidate: { ...workedChoices(r1.pins), level: 3 } });
    expect(smuggled.status).toBe(400);
    const extraTop = await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 2, candidate: workedChoices(r1.pins), maximumHp: 40 });
    expect(extraTop.status).toBe(400);
    expect((await call(Character.GET, "GET", "/x", p(c.id))).data.lockVersion).toBe(2);
  });

  it("finalize freezes the build; the profile stays editable (§37–§39, §99)", async () => {
    const c = (await create("Finisher")).data;
    const incomplete = await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: 1 });
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.error?.code).toBe("CHARACTER.CREATION_INCOMPLETE");
    await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    const done = await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: 2 });
    expect(done.status).toBe(200);
    expect(done.data.status).toBe("CORE_COMPLETE");
    const frozen = await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: done.data.lockVersion, candidate: workedChoices(r1.pins) });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error?.code).toBe("CHARACTER.CORE_FROZEN");
    const renamed = await call(Profile.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: done.data.lockVersion, name: "Grukk the Finished", concept: null });
    expect(renamed.status).toBe(200);
    expect(renamed.data.name).toBe("Grukk the Finished");
    expect(renamed.data.resolution.derivedPreview).toEqual(done.data.resolution.derivedPreview);
    const list = await call(Characters.GET, "GET", "/api/characters");
    expect(list.status).toBe(200);
    const row = (list.data as Array<{ id: string; level: number; status: string; release: { id: string } }>).find((x) => x.id === c.id);
    expect(row).toMatchObject({ level: 1, status: "CORE_COMPLETE", release: { id: r1.release.id } });
  });

  it("a newer Release never changes an existing Character; its content is rejected for an R1 Character (§92, §93)", async () => {
    const c = (await create("Historian")).data;
    await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    const before = (await call(Character.GET, "GET", "/x", p(c.id))).data;
    r2 = await publishNextRelease(r1, ["test.m6wo3.skill.stealth", "affinity.evocation", "test.m6wo3.ancestry.orcani"], "R2");
    const after = (await call(Character.GET, "GET", "/x", p(c.id))).data;
    expect(after.release.id).toBe(r1.release.id);
    expect(after.resolution).toEqual(before.resolution);
    expect(after.choices).toEqual(before.choices);
    // R2 Skill / Affinity / Ancestry revisions — same Entities, same canonical keys — are not legal for this R1 Character.
    const crossSkill = workedChoices(r1.pins);
    crossSkill.skills[1] = { skill: selOf(r2.pins, "test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null };
    const crossAffinity = { ...workedChoices(r1.pins), primaryAffinity: selOf(r2.pins, "affinity.evocation") };
    const crossAncestry = { ...workedChoices(r1.pins), ancestry: selOf(r2.pins, "test.m6wo3.ancestry.orcani") };
    for (const candidate of [crossSkill, crossAffinity, crossAncestry]) {
      const v = await call(Validate.POST, "POST", "/x", p(c.id), { candidate });
      expect(v.data.status).toBe("INVALID");
      expect((v.data.issues as Array<{ code: string }>).map((i) => i.code)).toContain("PROWESS_CHARACTER.NOT_IN_RELEASE");
      const s = await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: after.lockVersion, candidate });
      expect(s.status).toBe(422);
    }
    // A Character created on R2 resolves R2 content (Orcani revision: Base HP 12 → Maximum HP 16).
    const c2 = (await create("Newcomer", r2.release.id)).data;
    const v2 = await call(Validate.POST, "POST", "/x", p(c2.id), { candidate: workedChoices(r2.pins) });
    expect(v2.data.status).toBe("READY");
    expect((v2.data.derivedPreview as Array<{ statistic: string; value: number }>).find((d) => d.statistic === "MAXIMUM_HP")?.value).toBe(16);
  }, 120_000);

  it("reads are read-only (§100)", async () => {
    const c = (await create("Reader")).data;
    await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: 1, candidate: workedChoices(r1.pins) });
    const snapshot = async () => ({
      c: await prisma.character.findUniqueOrThrow({ where: { id: c.id } }),
      s: await prisma.characterSkillRank.findMany({ where: { characterId: c.id }, orderBy: { id: "asc" } }),
      a: await prisma.characterStatAllocation.findMany({ where: { characterId: c.id }, orderBy: { stat: "asc" } }),
    });
    const before = await snapshot();
    for (let i = 0; i < 3; i += 1) {
      expect((await call(Character.GET, "GET", "/x", p(c.id))).status).toBe(200);
      expect((await call(Context.GET, "GET", "/x", p(c.id))).status).toBe(200);
      expect((await call(Validate.POST, "POST", "/x", p(c.id), { candidate: workedChoices(r1.pins) })).status).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("unknown or malformed Character ids are 404 / 400", async () => {
    expect((await call(Character.GET, "GET", "/x", p("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await call(Character.GET, "GET", "/x", p("not-a-uuid"))).status).toBe(400);
  });
});
