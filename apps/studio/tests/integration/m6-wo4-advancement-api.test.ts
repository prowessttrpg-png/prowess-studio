/**
 * PAS-10 M6-WO4 — Character advancement, access & eligibility: HTTP-level integration proof. Every call goes through a
 * REAL route handler against the real prowess_studio_test database; the capable Release (with a Character Advancement
 * Rule and an Ability Construction Rule) is seeded by tests/integration/fixtures/m6-wo3-character-world.ts.
 *
 * Invariants exercised: M6-I031 exact Release · M6-I032 one Level per commit · M6-I035 append-only history ·
 * M6-I039 derived values recalculated · M6-I040 eligibility from structured prerequisites · M6-I043 no automatic migration.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Character from "../../app/api/characters/[characterId]/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Advancement from "../../app/api/characters/[characterId]/advancement/route";
import * as Preview from "../../app/api/characters/[characterId]/advancement/preview/route";
import * as Advance from "../../app/api/characters/[characterId]/advance/route";
import * as Access from "../../app/api/characters/[characterId]/access/route";
import * as Eligible from "../../app/api/characters/[characterId]/eligible-definitions/route";
import { call } from "./m2-api-harness";
import { ADVANCEMENT_RULE_KEY, advancementRulePayload, cleanupCharacterWorlds, publishNextRelease, seedCharacterWorld, selOf, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo4api";
let w: CharacterWorld;
const p = (characterId: string) => ({ characterId });

async function completed(name: string) {
  const c = (await call(Characters.POST, "POST", "/api/characters", {}, { name, concept: null, rulesetReleaseId: w.release.id })).data;
  const saved = (await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: c.lockVersion, candidate: workedChoices(w.pins) })).data;
  return (await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: saved.lockVersion })).data;
}
const l2 = { statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null };
const l3 = () => ({ statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "TRAIN_NEW", skill: selOf(w.pins, "skill.arcana") }], affinityChoice: null });

describe("M6-WO4 Character advancement API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    w = await seedCharacterWorld(PREFIX, "R1", { advancement: true });
  }, 180_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 120_000);

  it("a Draft cannot advance (409 CORE_CREATION_INCOMPLETE); a completed Character reads its context", async () => {
    const draft = (await call(Characters.POST, "POST", "/api/characters", {}, { name: "Draft", concept: null, rulesetReleaseId: w.release.id })).data;
    const refused = await call(Advance.POST, "POST", "/x", p(draft.id), { expectedLockVersion: draft.lockVersion, choices: l2 });
    expect([refused.status, refused.body.error?.code]).toEqual([409, "CHARACTER.CORE_CREATION_INCOMPLETE"]);
    const c = await completed("Context");
    const ctx = await call(Advancement.GET, "GET", "/x", p(c.id));
    expect(ctx.status).toBe(200);
    expect(ctx.data.next).toMatchObject({ fromLevel: 1, toLevel: 2, statPoints: 1, skillAdvancements: 0, affinity: null });
    expect(ctx.data.profile).toMatchObject({ level: 1, maximumLevel: 10 });
    expect(ctx.data.release.id).toBe(w.release.id);
  });

  it("preview is side-effect free; advance accepts only expectedLockVersion + choices and commits one Level", async () => {
    const c = await completed("Climber");
    const pv = await call(Preview.POST, "POST", "/x", p(c.id), { choices: l2 });
    expect([pv.status, pv.data.status, pv.data.toLevel]).toEqual([200, "READY", 2]);
    expect(pv.data.statPoints).toEqual({ granted: 1, spent: 1, remaining: 0 });
    expect(await prisma.characterAdvancement.count({ where: { characterId: c.id } })).toBe(0);
    for (const extra of [{ level: 2 }, { toLevel: 2 }, { derived: {} }]) {
      expect((await call(Advance.POST, "POST", "/x", p(c.id), { expectedLockVersion: c.lockVersion, choices: l2, ...extra })).status).toBe(400);
    }
    const smuggled = await call(Advance.POST, "POST", "/x", p(c.id), { expectedLockVersion: c.lockVersion, choices: { ...l2, toLevel: 5 } });
    expect([smuggled.status, smuggled.body.error?.code]).toEqual([422, "CHARACTER.INVALID_ADVANCEMENT"]);
    const incomplete = await call(Advance.POST, "POST", "/x", p(c.id), { expectedLockVersion: c.lockVersion, choices: { statAllocations: {}, skillAdvancements: [], affinityChoice: null } });
    expect([incomplete.status, incomplete.body.error?.code]).toEqual([409, "CHARACTER.ADVANCEMENT_INCOMPLETE"]);
    const done = await call(Advance.POST, "POST", "/x", p(c.id), { expectedLockVersion: c.lockVersion, choices: l2 });
    expect(done.status).toBe(200);
    expect([done.data.level, done.data.lockVersion, done.data.profile.level]).toEqual([2, c.lockVersion + 1, 2]);
    expect(done.data.advancementHistory).toEqual([expect.objectContaining({ fromLevel: 1, toLevel: 2, statAllocations: { PER: 1 } })]);
    const stale = await call(Advance.POST, "POST", "/x", p(c.id), { expectedLockVersion: c.lockVersion, choices: l2 });
    expect([stale.status, stale.body.error?.code]).toEqual([409, "CHARACTER.STALE_WRITE"]);
    const level3 = await call(Advance.POST, "POST", "/x", p(c.id), { expectedLockVersion: done.data.lockVersion, choices: l3() });
    expect(level3.data.profile).toMatchObject({ level: 3, characterDie: { dieKey: "D6" } });
    expect(level3.data.profile.affinities[0]).toMatchObject({ role: "PRIMARY", rank: "TRAINED" });
  });

  it("access and eligibility change with the profile — from the exact structured prerequisite", async () => {
    const c = await completed("Scholar");
    const kind = (k: string, locked = true) => call(Eligible.GET, "GET", `/x?definitionKind=${k}${locked ? "&includeLocked=true" : ""}&page=1&pageSize=10`, p(c.id));
    const before = await kind("SPELL_EFFECT");
    expect(before.status).toBe(200);
    expect(before.data.map((d: { status: string }) => d.status)).toEqual(["INELIGIBLE"]);
    expect(before.data[0].requirements[0]).toMatchObject({ kind: "SKILL_RANK_AT_LEAST", required: { rankKey: "EXPERT" }, actual: { rankKey: "UNTRAINED", owned: false }, satisfied: false });
    expect((await kind("SPELL_EFFECT", false)).data).toEqual([]);
    expect((await kind("NOT_A_KIND")).status).toBe(400);
    const access = await call(Access.GET, "GET", "/x", p(c.id));
    expect(access.data.summary.spell.arcaneAuthority).toMatchObject({ rankKey: "UNTRAINED", eligible: false });
    let cur = (await call(Character.GET, "GET", "/x", p(c.id))).data;
    for (const choices of [l2, l3(), { statAllocations: { AGI: 1 }, skillAdvancements: [], affinityChoice: null }, { statAllocations: { CON: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: selOf(w.pins, "skill.arcana") }], affinityChoice: null }]) {
      cur = (await call(Advance.POST, "POST", "/x", p(c.id), { expectedLockVersion: cur.lockVersion, choices })).data;
    }
    expect(cur.level).toBe(5);
    expect((await kind("SPELL_EFFECT", false)).data.map((d: { status: string }) => d.status)).toEqual(["ELIGIBLE"]);
    expect((await call(Access.GET, "GET", "/x", p(c.id))).data.summary.spell.arcaneAuthority).toMatchObject({ rankKey: "EXPERT", eligible: true });
  }, 120_000);

  it("a newer Release with a different schedule never changes an existing Character's progression", async () => {
    const c = await completed("Historian");
    const before = (await call(Character.GET, "GET", "/x", p(c.id))).data;
    const r2 = await publishNextRelease(w, [ADVANCEMENT_RULE_KEY], "R2", { [ADVANCEMENT_RULE_KEY]: advancementRulePayload(() => 3) });
    const after = (await call(Character.GET, "GET", "/x", p(c.id))).data;
    expect(after.release.id).toBe(w.release.id);
    expect(after.profile).toEqual(before.profile);
    const ctx = (await call(Advancement.GET, "GET", "/x", p(c.id))).data;
    expect(ctx.next).toMatchObject({ statPoints: 1, source: expect.objectContaining({ entityVersionId: selOf(w.pins, ADVANCEMENT_RULE_KEY).entityVersionId }) });
    expect(r2.release.id).not.toBe(w.release.id);
  }, 120_000);

  it("reads are read-only", async () => {
    const c = await completed("Reader");
    const snapshot = async () => ({
      c: await prisma.character.findUniqueOrThrow({ where: { id: c.id } }),
      a: await prisma.characterAdvancement.count({ where: { characterId: c.id } }),
    });
    const before = await snapshot();
    for (let i = 0; i < 2; i += 1) {
      await call(Advancement.GET, "GET", "/x", p(c.id));
      await call(Preview.POST, "POST", "/x", p(c.id), { choices: l2 });
      await call(Access.GET, "GET", "/x", p(c.id));
      await call(Eligible.GET, "GET", "/x?definitionKind=SPELL_EFFECT&page=1&pageSize=10", p(c.id));
    }
    expect(await snapshot()).toEqual(before);
  });
});
