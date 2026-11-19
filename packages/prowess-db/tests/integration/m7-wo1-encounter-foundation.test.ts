import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commandEncounter,
  commitCharacterPlayOperation,
  createCharacter,
  createEncounter,
  finalizeCharacterCoreCreation,
  getCharacterPlayWorkspace,
  getEncounter,
  listEncounterCandidates,
  listEncounterEvents,
  listEncounters,
  prisma,
  saveCharacterCreation,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, seedCharacterRelease, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";

/**
 * M7-WO1 Encounter foundation and roster — PostgreSQL proof of E03–E11 at the service / database layer:
 *   - an encounter keeps ONE exact Release; only completed Characters on that Release join (revalidated on every command);
 *   - sides and memberships keep integrity server-side, including forged cross-encounter ids (and at the database);
 *   - one compare-and-set per command: concurrent writers produce ONE version transition; retries replay, never repeat;
 *   - a failure after an intermediate write rolls the whole command back;
 *   - reads, readiness and refused commands write nothing; roster edits never touch a Character's state;
 *   - an archived encounter is a read-only historical record (service and database).
 */
const PREFIX = "test.m7wo1enc";
const TIMEOUT = 600_000;
let r1: CharacterReleaseWorld;
let r2: CharacterReleaseWorld;
let alpha: string; // completed, R1
let beta: string; // completed, R1 (standalone combat started)
let gamma: string; // completed, R1
let draft: string; // DRAFT, R1
let other: string; // completed, R2

async function completed(world: CharacterReleaseWorld, name: string) {
  const c = await createCharacter({ name, rulesetReleaseId: world.release.id });
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) as never });
  return (await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion })).id;
}
const key = () => randomUUID();
async function create(name = `Skirmish ${randomUUID().slice(0, 6)}`, world = r1) {
  return (await createEncounter({ name, rulesetReleaseId: world.release.id, idempotencyKey: key() })).encounter;
}
async function run(id: string, command: Record<string, unknown>, expectedVersion?: number, idempotencyKey = key()) {
  const v = expectedVersion ?? (await getEncounter(id)).version;
  return commandEncounter(id, { command, expectedVersion: v, idempotencyKey });
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

/** Every encounter row as stored (for "nothing changed"). */
async function encounterFingerprint(id: string) {
  return JSON.stringify(
    await prisma.encounter.findUnique({ where: { id }, include: { sides: { orderBy: { id: "asc" } }, participants: { orderBy: { id: "asc" } }, events: { orderBy: { sequence: "asc" } } } }),
  );
}
/** Everything a Character owns that roster edits must never touch: its row, sheet play state, runtime and play events. */
async function characterFingerprint(characterId: string) {
  const [character, playState, resources, runtime, events, advancements] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId } }),
    prisma.characterPlayState.findUnique({ where: { characterId } }),
    prisma.characterResourceState.findMany({ where: { characterId }, orderBy: { resourceKey: "asc" } }),
    prisma.characterPlayRuntime.findUnique({ where: { characterId } }),
    prisma.characterPlayEvent.findMany({ where: { characterId }, orderBy: { sequence: "asc" } }),
    prisma.characterAdvancement.findMany({ where: { characterId }, orderBy: { fromLevel: "asc" } }),
  ]);
  return JSON.stringify({ character, playState, resources, runtime, events, advancements });
}
const tableCounts = async () => [await prisma.encounter.count(), await prisma.encounterSide.count(), await prisma.encounterParticipant.count(), await prisma.encounterEvent.count()];

beforeAll(async () => {
  assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  await cleanupCharacterWorlds(PREFIX);
  r1 = await seedCharacterRelease(PREFIX, "R1", { advancement: true });
  alpha = await completed(r1, "Alpha M7");
  beta = await completed(r1, "Beta M7");
  gamma = await completed(r1, "Gamma M7");
  draft = (await createCharacter({ name: "Draft M7", rulesetReleaseId: r1.release.id })).id;
  r2 = await publishNextRelease(r1, [[...r1.pins.keys()].find((k) => k.includes("ancestry"))!], "R2");
  other = await completed(r2, "Other Release M7");
  // Beta has a STANDALONE combat running in its own Play Workspace (M6-WO10) — roster edits must never change it.
  const v = (await getCharacterPlayWorkspace(beta)).versions;
  await commitCharacterPlayOperation(beta, { operation: { kind: "TIMING", event: "BEGIN_COMBAT" }, idempotencyKey: key(), expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
}, TIMEOUT);
afterAll(async () => {
  await cleanupCharacterWorlds(PREFIX);
}, TIMEOUT);

describe("M7-WO1 encounter foundation (PostgreSQL)", () => {
  it("E03 an encounter with named sides and two compatible Characters is created, then reopened intact", async () => {
    const created = await createEncounter({ name: "  Bridge Ambush  ", notes: "Night, rain.", rulesetReleaseId: r1.release.id, idempotencyKey: key() });
    const e = created.encounter;
    expect(created).toMatchObject({ committed: true, replayed: false });
    expect(e).toMatchObject({ name: "Bridge Ambush", notes: "Night, rain.", status: "PREPARATION", version: 1, release: { id: r1.release.id, releaseNumber: r1.release.releaseNumber } });
    expect(e.readiness).toMatchObject({ state: "NOT_PREPARED", combat: { available: false } });
    expect(e.readiness.blocking.map((b) => b.code).sort()).toEqual(["EMPTY_ROSTER", "NO_SIDES"]);
    const heroes = (await run(e.id, { kind: "ADD_SIDE", name: "Heroes" })).encounter.sides[0]!;
    const raiders = (await run(e.id, { kind: "ADD_SIDE", name: "Raiders" })).encounter.sides[1]!;
    await run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: heroes.id });
    const last = await run(e.id, { kind: "ADD_PARTICIPANT", characterId: gamma, sideId: raiders.id });
    expect(last.encounter.version).toBe(5);
    expect(last.encounter.readiness).toMatchObject({ state: "PREPARED", blocking: [], combat: { available: false } });

    const reopened = await getEncounter(e.id);
    expect(reopened.sides.map((s) => [s.name, s.ordinal, s.participantIds.length])).toEqual([["Heroes", 1, 1], ["Raiders", 2, 1]]);
    expect(reopened.participants.map((p) => [p.character.name, p.sideId])).toEqual([["Alpha M7", heroes.id], ["Gamma M7", raiders.id]]);
    expect(reopened.recentEvents.map((x) => x.kind)).toEqual(["PARTICIPANT_ADDED", "PARTICIPANT_ADDED", "SIDE_ADDED", "SIDE_ADDED", "ENCOUNTER_CREATED"]);
    expect(reopened.recentEvents.map((x) => x.encounterVersion)).toEqual([5, 4, 3, 2, 1]);
    const listed = await listEncounters({ page: 1, pageSize: 50, search: "bridge amb" });
    expect(listed.items.find((x) => x.id === e.id)).toMatchObject({ sideCount: 2, participantCount: 2, status: "PREPARATION" });
  }, TIMEOUT);

  it("E04 same-Release joins succeed; a different-Release join fails and changes neither Character nor encounter", async () => {
    const e = await create();
    const side = (await run(e.id, { kind: "ADD_SIDE", name: "Party" })).encounter.sides[0]!;
    await run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: side.id });
    const before = [await encounterFingerprint(e.id), await characterFingerprint(other), await characterFingerprint(alpha)];
    expect(await code(run(e.id, { kind: "ADD_PARTICIPANT", characterId: other, sideId: side.id }))).toBe("ENCOUNTER.CHARACTER_RELEASE_MISMATCH");
    expect([await encounterFingerprint(e.id), await characterFingerprint(other), await characterFingerprint(alpha)]).toEqual(before);
    // The candidate search explains the mismatch instead of hiding it; the R2 Character can join an R2 encounter.
    const candidates = (await listEncounterCandidates(e.id, { search: "M7" })).candidates;
    expect(candidates.find((c) => c.id === other)).toMatchObject({ eligibility: "OTHER_RELEASE" });
    expect(candidates.find((c) => c.id === other)!.reason).toMatch(/Release 2/);
    expect(candidates.find((c) => c.id === alpha)).toMatchObject({ eligibility: "ALREADY_MEMBER" });
    expect(candidates.find((c) => c.id === gamma)).toMatchObject({ eligibility: "ELIGIBLE" });
    const onR2 = await create("R2 encounter", r2);
    expect((await run(onR2.id, { kind: "ADD_PARTICIPANT", characterId: other, sideId: null })).encounter.participants).toHaveLength(1);
    expect(await code(run(onR2.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: null }))).toBe("ENCOUNTER.CHARACTER_RELEASE_MISMATCH");
    // The database refuses it too, whatever a caller sends (exact Release identity, not a name).
    await expect(prisma.encounterParticipant.create({ data: { encounterId: e.id, rulesetReleaseId: r1.release.id, characterId: other } })).rejects.toThrow(/ENCOUNTER_PARTICIPANT_RELEASE/);
    await expect(prisma.encounterParticipant.create({ data: { encounterId: e.id, rulesetReleaseId: r2.release.id, characterId: other } })).rejects.toThrow(/encounter_participants_encounter_id_ruleset_release_id_fkey/);
  }, TIMEOUT);

  it("E05 duplicate, incomplete, missing and malformed Character references are refused", async () => {
    const e = await create();
    await run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: null });
    const before = await encounterFingerprint(e.id);
    expect(await code(run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: null }))).toBe("ENCOUNTER.DUPLICATE_PARTICIPANT");
    expect(await code(run(e.id, { kind: "ADD_PARTICIPANT", characterId: draft, sideId: null }))).toBe("ENCOUNTER.CHARACTER_NOT_ELIGIBLE");
    expect(await code(run(e.id, { kind: "ADD_PARTICIPANT", characterId: randomUUID(), sideId: null }))).toBe("ENCOUNTER.CHARACTER_NOT_FOUND");
    expect(await code(run(e.id, { kind: "ADD_PARTICIPANT", characterId: "not-an-id", sideId: null }))).toBe("ENCOUNTER.INVALID_INPUT");
    expect(await code(run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha }))).toBe("ENCOUNTER.INVALID_INPUT");
    expect(await encounterFingerprint(e.id)).toBe(before);
    expect((await listEncounterCandidates(e.id, { search: "Draft M7" })).candidates.find((c) => c.id === draft)).toMatchObject({ eligibility: "NOT_COMPLETE" });
    await expect(prisma.encounterParticipant.create({ data: { encounterId: e.id, rulesetReleaseId: r1.release.id, characterId: alpha } })).rejects.toThrow(/encounter_participants_encounter_id_character_id_key/);
  }, TIMEOUT);

  it("E06 move / remove memberships and remove sides with server-side integrity, including forged cross-encounter ids", async () => {
    const a = await create();
    const b = await create();
    const a1 = (await run(a.id, { kind: "ADD_SIDE", name: "One" })).encounter.sides[0]!;
    const a2 = (await run(a.id, { kind: "ADD_SIDE", name: "Two" })).encounter.sides[1]!;
    const foreign = (await run(b.id, { kind: "ADD_SIDE", name: "Foreign" })).encounter.sides[0]!;
    const bMember = (await run(b.id, { kind: "ADD_PARTICIPANT", characterId: gamma, sideId: foreign.id })).encounter.participants[0]!;
    const p = (await run(a.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: a1.id })).encounter.participants[0]!;
    const before = [await encounterFingerprint(a.id), await encounterFingerprint(b.id)];
    expect(await code(run(a.id, { kind: "ADD_PARTICIPANT", characterId: gamma, sideId: foreign.id }))).toBe("ENCOUNTER.SIDE_NOT_FOUND");
    expect(await code(run(a.id, { kind: "MOVE_PARTICIPANT", participantId: p.id, sideId: foreign.id }))).toBe("ENCOUNTER.SIDE_NOT_FOUND");
    expect(await code(run(a.id, { kind: "RENAME_SIDE", sideId: foreign.id, name: "Mine" }))).toBe("ENCOUNTER.SIDE_NOT_FOUND");
    expect(await code(run(a.id, { kind: "REMOVE_SIDE", sideId: foreign.id }))).toBe("ENCOUNTER.SIDE_NOT_FOUND");
    expect(await code(run(a.id, { kind: "REMOVE_PARTICIPANT", participantId: bMember.id }))).toBe("ENCOUNTER.PARTICIPANT_NOT_FOUND");
    expect(await code(run(a.id, { kind: "MOVE_PARTICIPANT", participantId: bMember.id, sideId: a1.id }))).toBe("ENCOUNTER.PARTICIPANT_NOT_FOUND");
    expect(await code(run(a.id, { kind: "REMOVE_SIDE", sideId: a1.id }))).toBe("ENCOUNTER.SIDE_NOT_EMPTY");
    expect(await code(run(a.id, { kind: "ADD_SIDE", name: "one" }))).toBe("ENCOUNTER.DUPLICATE_SIDE_NAME");
    expect([await encounterFingerprint(a.id), await encounterFingerprint(b.id)]).toEqual(before);
    // The database refuses a cross-encounter side whatever the caller does (composite key).
    await expect(prisma.encounterParticipant.update({ where: { id: p.id }, data: { sideId: foreign.id } })).rejects.toThrow(/encounter_participants_side_id_encounter_id_fkey/);
    await expect(prisma.encounterSide.update({ where: { id: a1.id }, data: { encounterId: b.id } })).rejects.toThrow(/ENCOUNTER_SIDE_IDENTITY|encounter_sides/);

    await run(a.id, { kind: "MOVE_PARTICIPANT", participantId: p.id, sideId: a2.id });
    let now = await getEncounter(a.id);
    expect(now.participants[0]!.sideId).toBe(a2.id);
    await run(a.id, { kind: "MOVE_PARTICIPANT", participantId: p.id, sideId: null });
    now = await getEncounter(a.id);
    expect(now.readiness.blocking.map((x) => x.code)).toContain("UNASSIGNED_PARTICIPANT");
    await run(a.id, { kind: "REMOVE_SIDE", sideId: a2.id });
    await run(a.id, { kind: "REMOVE_PARTICIPANT", participantId: p.id });
    now = await getEncounter(a.id);
    expect(now.sides.map((s) => s.name)).toEqual(["One"]);
    expect(now.participants).toEqual([]);
    // Meaningful history: every change is recorded with names, in order.
    expect((await listEncounterEvents(a.id, {})).events.map((x) => x.kind)).toEqual(["PARTICIPANT_REMOVED", "SIDE_REMOVED", "PARTICIPANT_MOVED", "PARTICIPANT_MOVED", "PARTICIPANT_ADDED", "SIDE_ADDED", "SIDE_ADDED", "ENCOUNTER_CREATED"]);
    expect((await listEncounterEvents(a.id, { limit: 1 })).events[0]!.record).toMatchObject({ characterId: alpha, characterName: "Alpha M7", sideId: null });
  }, TIMEOUT);

  it("E07 conflicting edits never overwrite silently; retries never duplicate records or events", async () => {
    const e = await create();
    // Two commands from the same version, concurrently: exactly one version transition.
    const results = await Promise.allSettled([run(e.id, { kind: "ADD_SIDE", name: "North" }, 1), run(e.id, { kind: "ADD_SIDE", name: "South" }, 1)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(["ENCOUNTER.STALE_WRITE"]);
    const after = await getEncounter(e.id);
    expect([after.version, after.sides.length, (await listEncounterEvents(e.id, {})).events.length]).toEqual([2, 1, 2]);
    // A stale version is refused with the current version named; nothing is written.
    expect(await code(run(e.id, { kind: "ADD_SIDE", name: "East" }, 1))).toBe("ENCOUNTER.STALE_WRITE");
    // A retried command (same key, same body) replays the original event and applies nothing again.
    const k = key();
    const first = await run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: null }, 2, k);
    const again = await run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: null }, 2, k);
    expect(again).toMatchObject({ replayed: true, event: { id: first.event.id } });
    expect([(await getEncounter(e.id)).participants.length, (await listEncounterEvents(e.id, {})).events.length, (await getEncounter(e.id)).version]).toEqual([1, 3, 3]);
    // The same key with a different request, or for another encounter, is refused.
    expect(await code(run(e.id, { kind: "ADD_SIDE", name: "West" }, 3, k))).toBe("ENCOUNTER.IDEMPOTENCY_CONFLICT");
    const elsewhere = await create();
    expect(await code(run(elsewhere.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: null }, 1, k))).toBe("ENCOUNTER.IDEMPOTENCY_CONFLICT");
    // Concurrent retries of the same command: one commit, one event.
    const k2 = key();
    const both = await Promise.all([run(e.id, { kind: "ADD_SIDE", name: "Twice" }, 3, k2), run(e.id, { kind: "ADD_SIDE", name: "Twice" }, 3, k2)]);
    expect(both.map((r) => r.event.id)[0]).toBe(both[1]!.event.id);
    expect((await getEncounter(e.id)).sides.filter((s) => s.name === "Twice")).toHaveLength(1);
    // A retried CREATE returns the same encounter (no duplicate encounter or event), even concurrently.
    const ck = key();
    const body = { name: `Retry ${randomUUID().slice(0, 6)}`, rulesetReleaseId: r1.release.id, idempotencyKey: ck };
    const creates = await Promise.all([createEncounter(body), createEncounter(body), createEncounter(body)]);
    expect(new Set(creates.map((c) => c.encounter.id)).size).toBe(1);
    expect(await prisma.encounter.count({ where: { name: body.name } })).toBe(1);
    expect(await code(createEncounter({ ...body, name: "Different" }))).toBe("ENCOUNTER.IDEMPOTENCY_CONFLICT");
  }, TIMEOUT);

  it("E07 a failure after an intermediate write rolls the whole command back", async () => {
    const e = await create();
    const side = (await run(e.id, { kind: "ADD_SIDE", name: "Solo" })).encounter.sides[0]!;
    const before = await encounterFingerprint(e.id);
    // A real database failure at the LAST step (the event insert), after the version claim and the membership insert.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION m7_wo1_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.encounter_id = '${e.id}' THEN RAISE EXCEPTION 'M7_WO1_INJECTED_FAILURE'; END IF; RETURN NEW; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER m7_wo1_fail_event BEFORE INSERT ON encounter_events FOR EACH ROW EXECUTE FUNCTION m7_wo1_fail_event()`);
    try {
      expect(await code(run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: side.id }))).not.toBe("OK");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER m7_wo1_fail_event ON encounter_events`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION m7_wo1_fail_event()`);
    }
    expect(await encounterFingerprint(e.id)).toBe(before);
    expect((await getEncounter(e.id)).version).toBe(2);
  }, TIMEOUT);

  it("E08 reads, readiness and refused commands leave stored state unchanged; derived or unknown inputs are refused", async () => {
    const e = await create();
    await run(e.id, { kind: "ADD_PARTICIPANT", characterId: beta, sideId: null });
    const before = [await tableCounts(), await encounterFingerprint(e.id), await characterFingerprint(beta)];
    await getEncounter(e.id);
    await listEncounters({ page: 1, pageSize: 10 });
    await listEncounterCandidates(e.id, { search: "M7" });
    await listEncounterEvents(e.id, { limit: 5 });
    for (const bad of [
      { kind: "ADD_SIDE", name: "x", readiness: "PREPARED" },
      { kind: "ADD_SIDE" },
      { kind: "START_COMBAT" },
      { kind: "ARCHIVE", status: "ARCHIVED" },
      { kind: "UPDATE_METADATA", name: "", notes: null },
      { kind: "ADD_SIDE", name: "x".repeat(81) },
    ])
      expect(await code(run(e.id, bad)), JSON.stringify(bad)).toBe("ENCOUNTER.INVALID_INPUT");
    expect(await code(commandEncounter(e.id, { command: { kind: "ARCHIVE" }, expectedVersion: "2", idempotencyKey: key() }))).toBe("ENCOUNTER.INVALID_INPUT");
    expect(await code(commandEncounter(e.id, { command: { kind: "ARCHIVE" }, expectedVersion: 2, idempotencyKey: "retry-1" }))).toBe("ENCOUNTER.INVALID_INPUT");
    expect(await code(getEncounter(randomUUID()))).toBe("ENCOUNTER.NOT_FOUND");
    expect(await code(createEncounter({ name: "x", rulesetReleaseId: randomUUID(), idempotencyKey: key() }))).toBe("ENCOUNTER.RELEASE_NOT_FOUND");
    expect([await tableCounts(), await encounterFingerprint(e.id), await characterFingerprint(beta)]).toEqual(before);
  }, TIMEOUT);

  it("E09 roster operations leave Character resources, play state, Release, Active Magic and play events unchanged", async () => {
    const before = await Promise.all([alpha, beta, gamma].map(characterFingerprint));
    const e = await create();
    const s1 = (await run(e.id, { kind: "ADD_SIDE", name: "A" })).encounter.sides[0]!;
    const s2 = (await run(e.id, { kind: "ADD_SIDE", name: "B" })).encounter.sides[1]!;
    for (const c of [alpha, beta, gamma]) await run(e.id, { kind: "ADD_PARTICIPANT", characterId: c, sideId: s1.id });
    const view = await getEncounter(e.id);
    const b = view.participants.find((p) => p.character.id === beta)!;
    // Beta's standalone combat is shown as a warning, never reset, ended or adopted by the encounter.
    expect(b.standalone).toMatchObject({ readable: true, combatActive: true });
    expect(view.readiness.warnings.map((w) => w.code)).toContain("STANDALONE_COMBAT_ACTIVE");
    await run(e.id, { kind: "MOVE_PARTICIPANT", participantId: b.id, sideId: s2.id });
    await run(e.id, { kind: "RENAME_SIDE", sideId: s2.id, name: "Bravo" });
    await run(e.id, { kind: "REMOVE_PARTICIPANT", participantId: view.participants[0]!.id });
    await run(e.id, { kind: "UPDATE_METADATA", name: "Renamed", notes: "n" });
    await run(e.id, { kind: "ARCHIVE" });
    expect(await Promise.all([alpha, beta, gamma].map(characterFingerprint))).toEqual(before);
    expect((await getCharacterPlayWorkspace(beta)).workspace).toBeTruthy();
  }, TIMEOUT);

  it("E10 an archived encounter keeps inspectable history and refuses ordinary edits (service and database)", async () => {
    const e = await create("Archived skirmish");
    const side = (await run(e.id, { kind: "ADD_SIDE", name: "Kept" })).encounter.sides[0]!;
    await run(e.id, { kind: "ADD_PARTICIPANT", characterId: gamma, sideId: side.id });
    const archived = (await run(e.id, { kind: "ARCHIVE" })).encounter;
    expect(archived).toMatchObject({ status: "ARCHIVED", readiness: { state: "ARCHIVED" } });
    expect(archived.archivedAt).not.toBeNull();
    const before = await encounterFingerprint(e.id);
    for (const c of [{ kind: "ADD_SIDE", name: "Late" }, { kind: "REMOVE_PARTICIPANT", participantId: archived.participants[0]!.id }, { kind: "UPDATE_METADATA", name: "Changed" }, { kind: "ARCHIVE" }])
      expect(await code(run(e.id, c)), c.kind).toBe("ENCOUNTER.ARCHIVED");
    await expect(prisma.encounter.update({ where: { id: e.id }, data: { name: "direct" } })).rejects.toThrow(/ENCOUNTER_ARCHIVED/);
    await expect(prisma.encounterParticipant.delete({ where: { id: archived.participants[0]!.id } })).rejects.toThrow(/ENCOUNTER_ARCHIVED/);
    await expect(prisma.encounterSide.create({ data: { encounterId: e.id, name: "x", ordinal: 9 } })).rejects.toThrow(/ENCOUNTER_ARCHIVED/);
    await expect(prisma.encounter.delete({ where: { id: e.id } })).rejects.toThrow(/ENCOUNTER_NO_DELETE/);
    await expect(prisma.encounterEvent.updateMany({ where: { encounterId: e.id }, data: { summary: "x" } })).rejects.toThrow(/ENCOUNTER_EVENT_IMMUTABLE/);
    expect(await encounterFingerprint(e.id)).toBe(before);
    const history = await getEncounter(e.id);
    expect(history.participants.map((p) => p.character.name)).toEqual(["Gamma M7"]);
    expect(history.recentEvents[0]).toMatchObject({ kind: "ENCOUNTER_ARCHIVED" });
    expect((await listEncounters({ page: 1, pageSize: 50, status: "ARCHIVED", search: "Archived skirmish" })).items.map((i) => i.id)).toContain(e.id);
  }, TIMEOUT);

  it("E11 a new database connection (restart) reads the same encounter and memberships", async () => {
    const e = await create("Persisted");
    const side = (await run(e.id, { kind: "ADD_SIDE", name: "Stay" })).encounter.sides[0]!;
    await run(e.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: side.id });
    const before = await getEncounter(e.id);
    await prisma.$disconnect();
    await prisma.$connect();
    const after = await getEncounter(e.id);
    expect({ ...after, readiness: null }).toEqual({ ...before, readiness: null });
    expect(after.readiness).toEqual(before.readiness);
  }, TIMEOUT);
});
