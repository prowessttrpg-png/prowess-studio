/**
 * M7-WO1 — Encounter foundation: HTTP-level integration proof through the REAL route handlers against prowess_studio_test.
 * Proves the closed request contract (unknown body fields and query keys, derived values, malformed ids), the status
 * mapping of every refusal, create / command idempotency over HTTP, exact-Release compatibility, forged cross-encounter
 * ids, archived read-only behaviour, and that reads write nothing.
 */
import { randomUUID } from "node:crypto";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Encounters from "../../app/api/encounters/route";
import * as Encounter from "../../app/api/encounters/[encounterId]/route";
import * as Commands from "../../app/api/encounters/[encounterId]/commands/route";
import * as Candidates from "../../app/api/encounters/[encounterId]/characters/route";
import * as Events from "../../app/api/encounters/[encounterId]/events/route";
import { call } from "./m2-api-harness";
import { cleanupCharacterWorlds, seedCharacterWorld, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX_A = "test.m7wo1apia";
const PREFIX_B = "test.m7wo1apib";
let a: CharacterWorld;
let b: CharacterWorld;
let hero: string;
let rogue: string;
let stranger: string;
let draft: string;
const p = (encounterId: string) => ({ encounterId });
async function completed(w: CharacterWorld, name: string) {
  const c = (await call(Characters.POST, "POST", "/api/characters", {}, { name, concept: null, rulesetReleaseId: w.release.id })).data;
  const saved = (await call(Creation.PUT, "PUT", "/x", { characterId: c.id }, { expectedLockVersion: c.lockVersion, candidate: workedChoices(w.pins) })).data;
  return ((await call(Finalize.POST, "POST", "/x", { characterId: c.id }, { expectedLockVersion: saved.lockVersion })).data as { id: string }).id;
}
async function create(name: string, w = a) {
  return call(Encounters.POST, "POST", "/api/encounters", {}, { name, rulesetReleaseId: w.release.id, idempotencyKey: randomUUID() });
}
async function command(id: string, cmd: unknown, expectedVersion?: number, idempotencyKey: string = randomUUID()) {
  const v = expectedVersion ?? (await call(Encounter.GET, "GET", "/x", p(id))).data.version;
  return call(Commands.POST, "POST", "/x", p(id), { command: cmd, expectedVersion: v, idempotencyKey });
}
const counts = async () => [await prisma.encounter.count(), await prisma.encounterSide.count(), await prisma.encounterParticipant.count(), await prisma.encounterEvent.count(), await prisma.characterPlayRuntime.count(), await prisma.characterResourceState.count()];

describe("M7-WO1 Encounter API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
    await cleanupCharacterWorlds(PREFIX_A);
    await cleanupCharacterWorlds(PREFIX_B);
    a = await seedCharacterWorld(PREFIX_A, "R1");
    b = await seedCharacterWorld(PREFIX_B, "R1");
    hero = await completed(a, "Hero API");
    rogue = await completed(a, "Rogue API");
    stranger = await completed(b, "Stranger API");
    draft = (await call(Characters.POST, "POST", "/api/characters", {}, { name: "Draft API", concept: null, rulesetReleaseId: a.release.id })).data.id;
  }, 600_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX_A);
    await cleanupCharacterWorlds(PREFIX_B);
  }, 600_000);

  it("creates, prepares and reopens an encounter; a retried create returns the same encounter (201 then 200)", async () => {
    const key = randomUUID();
    const body = { name: "Gate Watch", notes: "Dusk", rulesetReleaseId: a.release.id, idempotencyKey: key };
    const first = await call(Encounters.POST, "POST", "/api/encounters", {}, body);
    expect(first.status).toBe(201);
    const again = await call(Encounters.POST, "POST", "/api/encounters", {}, body);
    expect([again.status, again.data.replayed, again.data.encounter.id]).toEqual([200, true, first.data.encounter.id]);
    const id = first.data.encounter.id as string;
    const side = (await command(id, { kind: "ADD_SIDE", name: "Watch" })).data.encounter.sides[0];
    await command(id, { kind: "ADD_PARTICIPANT", characterId: hero, sideId: side.id });
    await command(id, { kind: "ADD_PARTICIPANT", characterId: rogue, sideId: side.id });
    const read = await call(Encounter.GET, "GET", "/x", p(id));
    expect(read.status).toBe(200);
    expect(read.data).toMatchObject({ name: "Gate Watch", notes: "Dusk", version: 4, readiness: { state: "PREPARED", combat: { available: false } } });
    expect(read.data.participants.map((x: { character: { name: string } }) => x.character.name)).toEqual(["Hero API", "Rogue API"]);
    const list = await call(Encounters.GET, "GET", "/api/encounters?q=gate%20watch&status=PREPARATION");
    expect(list.data.map((r: { id: string }) => r.id)).toContain(id);
  });

  it("refuses unknown body fields, unknown query keys, derived values and malformed ids", async () => {
    const id = (await create("Strict")).data.encounter.id as string;
    const before = await counts();
    expect((await call(Encounters.POST, "POST", "/api/encounters", {}, { name: "x", rulesetReleaseId: a.release.id, idempotencyKey: randomUUID(), status: "ARCHIVED" })).status).toBe(400);
    expect((await call(Encounters.POST, "POST", "/api/encounters", {}, { name: "x", rulesetReleaseId: a.release.id })).status).toBe(400);
    expect((await call(Commands.POST, "POST", "/x", p(id), { command: { kind: "ADD_SIDE", name: "x" }, expectedVersion: 1, idempotencyKey: randomUUID(), readiness: "PREPARED" })).status).toBe(400);
    expect((await command(id, { kind: "ADD_SIDE", name: "x", ordinal: 3 })).body.error?.code).toBe("ENCOUNTER.INVALID_INPUT");
    expect((await command(id, { kind: "START_COMBAT" })).status).toBe(400);
    expect((await call(Encounter.GET, "GET", "/x?refresh=1", p(id))).status).toBe(400);
    expect((await call(Encounters.GET, "GET", "/api/encounters?status=ACTIVE")).status).toBe(400);
    expect((await call(Encounter.GET, "GET", "/x", p("not-a-uuid"))).status).toBe(400);
    expect((await call(Encounter.GET, "GET", "/x", p(randomUUID()))).body.error?.code).toBe("ENCOUNTER.NOT_FOUND");
    expect((await call(Encounters.POST, "POST", "/api/encounters", {}, { name: "x", rulesetReleaseId: randomUUID(), idempotencyKey: randomUUID() })).status).toBe(404);
    expect(await counts()).toEqual(before);
  });

  it("maps every roster refusal: other Release, draft, duplicate, missing, forged side, stale, reused key", async () => {
    const id = (await create("Refusals")).data.encounter.id as string;
    const other = (await create("Elsewhere")).data.encounter.id as string;
    const foreignSide = (await command(other, { kind: "ADD_SIDE", name: "Theirs" })).data.encounter.sides[0].id as string;
    await command(id, { kind: "ADD_PARTICIPANT", characterId: hero, sideId: null });
    const before = await counts();
    const cases: Array<[unknown, number, string]> = [
      [{ kind: "ADD_PARTICIPANT", characterId: stranger, sideId: null }, 409, "ENCOUNTER.CHARACTER_RELEASE_MISMATCH"],
      [{ kind: "ADD_PARTICIPANT", characterId: draft, sideId: null }, 409, "ENCOUNTER.CHARACTER_NOT_ELIGIBLE"],
      [{ kind: "ADD_PARTICIPANT", characterId: hero, sideId: null }, 409, "ENCOUNTER.DUPLICATE_PARTICIPANT"],
      [{ kind: "ADD_PARTICIPANT", characterId: randomUUID(), sideId: null }, 404, "ENCOUNTER.CHARACTER_NOT_FOUND"],
      [{ kind: "ADD_PARTICIPANT", characterId: rogue, sideId: foreignSide }, 404, "ENCOUNTER.SIDE_NOT_FOUND"],
      [{ kind: "REMOVE_SIDE", sideId: foreignSide }, 404, "ENCOUNTER.SIDE_NOT_FOUND"],
      [{ kind: "REMOVE_PARTICIPANT", participantId: randomUUID() }, 404, "ENCOUNTER.PARTICIPANT_NOT_FOUND"],
    ];
    for (const [cmd, status, code] of cases) {
      const r = await command(id, cmd);
      expect([r.status, r.body.error?.code], JSON.stringify(cmd)).toEqual([status, code]);
    }
    expect((await command(id, { kind: "ADD_SIDE", name: "Late" }, 1)).body.error?.code).toBe("ENCOUNTER.STALE_WRITE");
    const key = randomUUID();
    expect((await command(id, { kind: "ADD_SIDE", name: "Once" }, undefined, key)).status).toBe(200);
    const replay = await command(id, { kind: "ADD_SIDE", name: "Once" }, 2, key);
    expect([replay.status, replay.data.replayed]).toEqual([200, true]);
    expect((await command(id, { kind: "ADD_SIDE", name: "Other" }, 3, key)).body.error?.code).toBe("ENCOUNTER.IDEMPOTENCY_CONFLICT");
    const after = await counts();
    // Only the one committed ADD_SIDE (a side row and an event) changed anything.
    expect(after.map((n, i) => n - before[i]!)).toEqual([0, 1, 0, 1, 0, 0]);
  });

  it("candidates carry the server's eligibility; history reads back newest first; reads write nothing", async () => {
    const id = (await create("Lookup")).data.encounter.id as string;
    await command(id, { kind: "ADD_PARTICIPANT", characterId: hero, sideId: null });
    const before = await counts();
    const found = (await call(Candidates.GET, "GET", "/x?q=API", p(id))).data.candidates as Array<{ id: string; eligibility: string; reason: string | null }>;
    expect(found.find((c) => c.id === hero)?.eligibility).toBe("ALREADY_MEMBER");
    expect(found.find((c) => c.id === rogue)?.eligibility).toBe("ELIGIBLE");
    expect(found.find((c) => c.id === draft)?.eligibility).toBe("NOT_COMPLETE");
    expect(found.find((c) => c.id === stranger)?.eligibility).toBe("OTHER_RELEASE");
    expect((await call(Candidates.GET, "GET", "/x?q=a&q=b", p(id))).status).toBe(400);
    const history = (await call(Events.GET, "GET", "/x?limit=10", p(id))).data.events as Array<{ kind: string }>;
    expect(history.map((e) => e.kind)).toEqual(["PARTICIPANT_ADDED", "ENCOUNTER_CREATED"]);
    expect((await call(Events.GET, "GET", "/x?limit=abc", p(id))).status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it("an archived encounter is read-only over HTTP and keeps its history", async () => {
    const id = (await create("Closed")).data.encounter.id as string;
    await command(id, { kind: "ADD_PARTICIPANT", characterId: rogue, sideId: null });
    const archived = await command(id, { kind: "ARCHIVE" });
    expect(archived.data.encounter).toMatchObject({ status: "ARCHIVED", readiness: { state: "ARCHIVED" } });
    const refused = await command(id, { kind: "ADD_SIDE", name: "After" });
    expect([refused.status, refused.body.error?.code]).toEqual([409, "ENCOUNTER.ARCHIVED"]);
    const read = await call(Encounter.GET, "GET", "/x", p(id));
    expect(read.data.participants).toHaveLength(1);
    expect(read.data.recentEvents[0].kind).toBe("ENCOUNTER_ARCHIVED");
  });
});
