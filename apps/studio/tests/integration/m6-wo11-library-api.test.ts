/**
 * PAS-10 M6-WO11 — Character Library / Save / Load: HTTP-level proof through the REAL route handlers against
 * prowess_studio_test. L11: the unfiltered list keeps the exact WO3 contract; `q` / `status` filter the whole
 * collection before pagination; punctuation is literal; an empty search is no filter; unknown keys, repeated or invalid
 * values are 400 API.INVALID_QUERY. L07 (API): a stale second-tab profile save is a 409 that leaves the first tab's
 * value in place. L06 (API): Library, Character, Sheet and Play reads write nothing.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Character from "../../app/api/characters/[characterId]/route";
import * as Profile from "../../app/api/characters/[characterId]/profile/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Sheet from "../../app/api/characters/[characterId]/sheet/route";
import * as Play from "../../app/api/characters/[characterId]/play/route";
import { call } from "./m2-api-harness";
import { cleanupCharacterWorlds, seedCharacterWorld, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo11api";
const TAG = `ApiLib${Date.now().toString(36)}`;
let w: CharacterWorld;
const p = (characterId: string) => ({ characterId });
type Page = { pagination: { page: number; pageSize: number; total: number; totalPages: number }; error?: { code: string } };
const list = async (qs: string) => {
  const r = await call(Characters.GET, "GET", `/api/characters${qs}`);
  return { ...r, body: r.body as unknown as Page & Record<string, unknown> };
};
const counts = async () => [await prisma.character.count(), await prisma.characterPlayRuntime.count(), await prisma.characterPlayEvent.count(), await prisma.characterPlayState.count(), await prisma.characterResourceState.count(), (await prisma.character.findMany({ select: { id: true, lockVersion: true, updatedAt: true }, orderBy: { id: "asc" } })).map((c) => `${c.id}:${c.lockVersion}:${c.updatedAt.toISOString()}`).join(",")];

describe("M6-WO11 Character Library API (prowess_studio_test only)", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    w = await seedCharacterWorld(PREFIX, "R1", { advancement: true, spells: true });
    for (const name of ["Alpha", "alpha twin", "Bravo (scout)", "50% off", "Under_Score"]) ids[name] = (await call(Characters.POST, "POST", "/api/characters", {}, { name: `${TAG} ${name}`, concept: null, rulesetReleaseId: w.release.id })).data.id;
    const c = (await call(Characters.POST, "POST", "/api/characters", {}, { name: `${TAG} Complete`, concept: null, rulesetReleaseId: w.release.id })).data;
    const saved = (await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: c.lockVersion, candidate: workedChoices(w.pins) })).data;
    ids.Complete = (await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: saved.lockVersion })).data.id;
  }, 900_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("M6-I173 L11 the unfiltered request is the WO3 contract; q and status filter before paging", async () => {
    const plain = await list("?page=1&pageSize=50");
    expect(plain.status).toBe(200);
    expect(Object.keys(plain.body).sort()).toEqual(["data", "error", "pagination"].sort());
    expect(Object.keys(plain.data[0]).sort()).toEqual(["id", "level", "name", "release", "status", "updatedAt"]);
    expect((await list("")).body.pagination).toMatchObject({ page: 1, pageSize: 25 });
    const tagged = await list(`?q=${encodeURIComponent(TAG.toUpperCase())}&pageSize=2`);
    expect(tagged.body.pagination).toMatchObject({ total: 6, totalPages: 3, page: 1, pageSize: 2 });
    expect(tagged.data).toHaveLength(2);
    const page3 = await list(`?q=${encodeURIComponent(TAG)}&pageSize=2&page=3`);
    expect(page3.data).toHaveLength(2);
    expect((await list(`?q=${encodeURIComponent(TAG)}&pageSize=2&page=4`)).data).toEqual([]);
    expect((await list(`?q=${encodeURIComponent(`${TAG} alpha`)}`)).data.map((x: { id: string }) => x.id).sort()).toEqual([ids.Alpha, ids["alpha twin"]].sort());
    expect((await list(`?q=${encodeURIComponent(`${TAG} Bravo (`)}`)).data.map((x: { id: string }) => x.id)).toEqual([ids["Bravo (scout)"]]);
    expect((await list(`?q=${encodeURIComponent(`${TAG} 50%`)}`)).data.map((x: { id: string }) => x.id)).toEqual([ids["50% off"]]);
    expect((await list(`?q=${encodeURIComponent(`${TAG} Under_`)}`)).data.map((x: { id: string }) => x.id)).toEqual([ids.Under_Score]);
    expect((await list(`?q=${encodeURIComponent(TAG)}&status=CORE_COMPLETE`)).data.map((x: { id: string }) => x.id)).toEqual([ids.Complete]);
    expect((await list(`?q=${encodeURIComponent(TAG)}&status=DRAFT`)).body.pagination.total).toBe(5);
    expect((await list(`?q=${encodeURIComponent(TAG)}&status=ALL`)).body.pagination.total).toBe(6);
    expect((await list("?q=%20%20&pageSize=1")).body.pagination.total).toBe(plain.body.pagination.total);
    expect((await list(`?q=${encodeURIComponent(`${TAG} nobody`)}`)).body.pagination).toMatchObject({ total: 0 });
  });

  it("M6-I173 L11 invalid parameters are refused with the existing API.INVALID_QUERY convention", async () => {
    for (const qs of ["?status=ARCHIVED", "?status=draft", "?sort=name", "?q=a&q=b", "?status=DRAFT&status=ALL", `?q=${"x".repeat(121)}`, "?page=0", "?pageSize=abc"]) {
      const r = await list(qs);
      expect(r.status, qs).toBe(400);
      expect(r.body.error?.code, qs).toBe("API.INVALID_QUERY");
    }
  });

  it("M6-I175 M6-I174 L07 L06 a stale second-tab save is a conflict that keeps the first tab's value; reads write nothing", async () => {
    const id = ids.Alpha!;
    const loaded = (await call(Character.GET, "GET", "/x", p(id))).data;
    const a = await call(Profile.PUT, "PUT", "/x", p(id), { expectedLockVersion: loaded.lockVersion, name: `${TAG} Alpha`, concept: "tab A" });
    expect(a.status).toBe(200);
    const b = await call(Profile.PUT, "PUT", "/x", p(id), { expectedLockVersion: loaded.lockVersion, name: `${TAG} Alpha`, concept: "tab B" });
    expect(b.status).toBe(409);
    expect(b.body.error?.code).toBe("CHARACTER.STALE_WRITE");
    expect((await call(Character.GET, "GET", "/x", p(id))).data).toMatchObject({ concept: "tab A", lockVersion: a.data.lockVersion });
    const before = await counts();
    await list(`?q=${encodeURIComponent(TAG)}`);
    await call(Character.GET, "GET", "/x", p(id));
    await call(Character.GET, "GET", "/x", p(ids.Complete!));
    await call(Sheet.GET, "GET", "/x", p(ids.Complete!));
    const play = await call(Play.GET, "GET", "/x", p(ids.Complete!));
    expect(play.status, JSON.stringify(play.body.error)).toBe(200);
    expect(play.data.versions).toEqual({ runtimeVersion: 0, playStateVersion: 0 });
    expect(await counts()).toEqual(before);
  });
});
