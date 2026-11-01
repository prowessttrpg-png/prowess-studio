/**
 * PAS-10 M6-WO5 — Digital Character Sheet: HTTP-level integration proof. Every call goes through a REAL route handler
 * against prowess_studio_test; the capable Release is seeded by tests/integration/fixtures/m6-wo3-character-world.ts.
 *
 * Invariants exercised: M6-I045 one read model from the profile · M6-I046 derived values are read-only (no client
 * maximum / die / score) · M6-I047 mutable play state with its own concurrency · M6-I050 nondestructive portrait framing ·
 * M6-I051 safe portrait handling (type, size, decode, protected serving) · M6-I053 creation untouched.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Sheet from "../../app/api/characters/[characterId]/sheet/route";
import * as PlayState from "../../app/api/characters/[characterId]/play-state/route";
import * as Notes from "../../app/api/characters/[characterId]/notes/route";
import * as Portrait from "../../app/api/characters/[characterId]/portrait/route";
import * as PortraitImage from "../../app/api/characters/[characterId]/portrait/image/route";
import * as Framing from "../../app/api/characters/[characterId]/portrait-transform/route";
import { call } from "./m2-api-harness";
import { PORTRAIT_PNG_48x64, PORTRAIT_WEBP_10x10 } from "../fixtures/m6-wo5-portraits";
import { cleanupCharacterWorlds, seedCharacterWorld, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo5api";
let w: CharacterWorld;
const p = (characterId: string) => ({ characterId });

async function completed(name: string) {
  const c = (await call(Characters.POST, "POST", "/api/characters", {}, { name, concept: null, rulesetReleaseId: w.release.id })).data;
  const saved = (await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: c.lockVersion, candidate: workedChoices(w.pins) })).data;
  return (await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: saved.lockVersion })).data;
}
async function upload(characterId: string, bytes: Uint8Array | null, type: string, expectedVersion: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  if (bytes !== null) form.set("file", new Blob([Buffer.from(bytes)], { type }), "portrait");
  form.set("expectedVersion", expectedVersion);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const response = await Portrait.POST(new Request("http://localhost/x", { method: "POST", body: form }), { params: Promise.resolve(p(characterId)) });
  const json = (await response.json()) as { data?: { portrait: Record<string, unknown> }; code?: string };
  return { status: response.status, data: json.data, code: json.code };
}
const png = async () => PORTRAIT_PNG_48x64;

describe("M6-WO5 Character Sheet API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    w = await seedCharacterWorld(PREFIX, "R1", { advancement: true });
  }, 180_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 120_000);

  it("GET sheet: one read model, strict query, Draft refused, read-only", async () => {
    const c = await completed("Sheet");
    const r = await call(Sheet.GET, "GET", "/x", p(c.id));
    expect(r.status).toBe(200);
    expect(r.data.identity).toMatchObject({ id: c.id, level: 1, status: "CORE_COMPLETE" });
    expect(r.data.mechanics.combat.characterDie.dieKey).toBe("D4");
    expect(r.data.resources.map((x: { resourceKey: string }) => x.resourceKey).sort()).toEqual(["AP", "COUNTER_ACTION", "HP", "ME", "MP"]);
    expect((await call(Sheet.GET, "GET", "/x?latest=true", p(c.id))).status).toBe(400);
    const draft = (await call(Characters.POST, "POST", "/api/characters", {}, { name: "Draft", concept: null, rulesetReleaseId: w.release.id })).data;
    const refused = await call(Sheet.GET, "GET", "/x", p(draft.id));
    expect([refused.status, refused.body.error?.code]).toEqual([409, "CHARACTER.CORE_CREATION_INCOMPLETE"]);
    expect(await prisma.characterPlayState.count({ where: { characterId: c.id } })).toBe(0);
  });

  it("PUT play-state: only current values; client maximums / die / scores / Level refused; stale 409; illegal 422", async () => {
    const c = await completed("Player");
    const sheet = (await call(Sheet.GET, "GET", "/x", p(c.id))).data;
    const maxHp = sheet.resources.find((r: { resourceKey: string }) => r.resourceKey === "HP").maximum as number;
    for (const extra of [{ maximumHp: 99 }, { characterDie: "D12" }, { level: 5 }, { skillScores: {} }]) {
      expect((await call(PlayState.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, resources: { HP: 1 }, ...extra })).status).toBe(400);
    }
    for (const resources of [{ MAXIMUM_HP: 99 }, { HP: maxHp + 1 }, { HP: -1 }, { HP: "5" }]) {
      const r = await call(PlayState.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, resources });
      expect([r.status, r.body.error?.code]).toEqual([422, "CHARACTER.INVALID_PLAY_STATE"]);
    }
    const ok = await call(PlayState.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, resources: { HP: maxHp - 2, AP: 0 } });
    expect(ok.status).toBe(200);
    expect(ok.data.playStateVersion).toBe(1);
    expect(ok.data.resources.find((r: { resourceKey: string }) => r.resourceKey === "HP")).toMatchObject({ current: maxHp - 2, maximum: maxHp });
    const stale = await call(PlayState.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, resources: { HP: 1 } });
    expect([stale.status, stale.body.error?.code]).toEqual([409, "CHARACTER.STALE_WRITE"]);
  });

  it("PUT notes: strict body, text stored verbatim, mechanics unchanged", async () => {
    const c = await completed("Scribe");
    const before = (await call(Sheet.GET, "GET", "/x", p(c.id))).data;
    expect((await call(Notes.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, actionNotes: "", characterNotes: "", possessions: [], level: 9 })).status).toBe(400);
    const r = await call(Notes.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, companyPac: "Dockside PAC", actionNotes: "Max HP is 500", characterNotes: "Owes the harbormaster", possessions: [{ category: "Gear", item: "Lantern", weight: "1" }] });
    expect(r.status).toBe(200);
    expect(r.data.notes).toMatchObject({ actionNotes: "Max HP is 500", characterNotes: "Owes the harbormaster", version: 1 });
    expect(r.data.identity.companyPac).toBe("Dockside PAC");
    expect(r.data.mechanics).toEqual(before.mechanics);
    const invalid = await call(Notes.PUT, "PUT", "/x", p(c.id), { expectedVersion: 1, actionNotes: "", characterNotes: "", possessions: "rope" });
    expect([invalid.status, invalid.body.error?.code]).toEqual([422, "CHARACTER.INVALID_SHEET_NOTES"]);
  });

  it("portrait: upload, protected image serving, framing, stale, replace, remove; unsafe / oversized / unknown fields refused", async () => {
    const c = await completed("Portrait");
    const source = await png();
    const svg = await upload(c.id, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml", "0");
    expect([svg.status, svg.code]).toEqual([422, "CHARACTER.INVALID_PORTRAIT"]);
    const lying = await upload(c.id, source, "image/jpeg", "0");
    expect([lying.status, lying.code]).toEqual([422, "CHARACTER.INVALID_PORTRAIT"]);
    expect((await upload(c.id, source, "image/png", "0", { zoom: "2" })).status).toBe(400);
    expect((await upload(c.id, null, "image/png", "0")).status).toBe(400);
    const big = await Portrait.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(20 * 1024 * 1024) }, body: "--x--" }), { params: Promise.resolve(p(c.id)) });
    expect(big.status).toBe(413);

    const up = await upload(c.id, source, "image/png", "0");
    expect(up.status).toBe(200);
    expect(up.data?.portrait).toMatchObject({ hasImage: true, mimeType: "image/png", width: 48, height: 64, zoom: 1, version: 1 });
    const url = new URL(`http://localhost${up.data?.portrait.imageUrl as string}`);
    const image = await PortraitImage.GET(new Request(url), { params: Promise.resolve(p(c.id)) });
    expect(image.status).toBe(200);
    expect([image.headers.get("content-type"), image.headers.get("x-content-type-options"), image.headers.get("content-security-policy")]).toEqual(["image/png", "nosniff", "default-src 'none'; sandbox"]);
    expect(image.headers.get("cache-control")).toMatch(/^private/);
    expect(Buffer.from(await image.arrayBuffer()).equals(Buffer.from(source))).toBe(true);

    const framed = await call(Framing.PUT, "PUT", "/x", p(c.id), { expectedVersion: 1, zoom: 2.5, offsetX: 0.3, offsetY: -0.6 });
    expect(framed.data.portrait).toMatchObject({ zoom: 2.5, offsetX: 0.3, offsetY: -0.6, version: 2 });
    expect((await call(Framing.PUT, "PUT", "/x", p(c.id), { expectedVersion: 1, zoom: 1, offsetX: 0, offsetY: 0 })).status).toBe(409);
    expect((await call(Framing.PUT, "PUT", "/x", p(c.id), { expectedVersion: 2, zoom: 1, offsetX: 2, offsetY: 0 })).status).toBe(422);
    expect((await call(Framing.PUT, "PUT", "/x", p(c.id), { expectedVersion: 2, zoom: 1, offsetX: 0, offsetY: 0, crop: { x: 0 } })).status).toBe(400);
    const after = await PortraitImage.GET(new Request(url), { params: Promise.resolve(p(c.id)) });
    expect(Buffer.from(await after.arrayBuffer()).equals(Buffer.from(source))).toBe(true); // framing never rewrites the source

    const replaced = await upload(c.id, PORTRAIT_WEBP_10x10, "image/webp", "2");
    expect(replaced.data?.portrait).toMatchObject({ mimeType: "image/webp", zoom: 1, version: 3 });
    const removed = await Portrait.DELETE(new Request("http://localhost/x?expectedVersion=3", { method: "DELETE" }), { params: Promise.resolve(p(c.id)) });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { data: { portrait: unknown } }).data.portrait).toMatchObject({ hasImage: false, imageUrl: null, version: 4 });
    expect((await PortraitImage.GET(new Request(url), { params: Promise.resolve(p(c.id)) })).status).toBe(404);
  });

  it("sheet writes never change the Character row, its creation rows or its history", async () => {
    const c = await completed("Untouched");
    const fingerprint = async () => prisma.character.findUniqueOrThrow({ where: { id: c.id }, include: { statAllocations: { orderBy: { stat: "asc" } }, skillRanks: { orderBy: { id: "asc" } }, advancements: true } });
    const before = await fingerprint();
    await call(PlayState.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, resources: { HP: 1 } });
    await call(Notes.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, actionNotes: "a", characterNotes: "b", possessions: [] });
    await upload(c.id, await png(), "image/png", "0");
    expect(await fingerprint()).toEqual(before);
  });
});
