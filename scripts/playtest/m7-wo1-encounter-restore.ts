import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertRunningAgainstTestDatabase, commandEncounter, commitCharacterPlayOperation, createCharacter, createEncounter, finalizeCharacterCoreCreation,
  getCharacterPlayWorkspace, getEncounter, prisma, saveCharacterCreation,
} from "../../packages/prowess-db/src/index";
import { workedChoices } from "../../packages/prowess-db/tests/fixtures/m6-wo3-character-release";
import { preparePlaytestRelease } from "../../packages/prowess-db/tests/fixtures/m6-wo12-playtest";

/**
 * M7-WO1 E11–E12 — encounters are workspace state that survives a restart and a whole-workspace restore.
 *
 *   source : a fresh disposable DB; the WO12 test Release; two completed Characters (one with a standalone combat running
 *            in its own Play Workspace); one prepared encounter (two sides, both Characters) and one archived encounter.
 *            The encounter views and every Character-owned row are recorded.
 *   resume : a NEW process — on the same DB (restart) or on an independent DB restored from the desktop workspace backup —
 *            must read identical encounters, memberships, Release references and Character state, and the archived
 *            encounter must still be read-only (database guard), writing nothing.
 */
const [role, runId, directory] = process.argv.slice(2);
assert(role && runId && directory, "Usage: m7-wo1-encounter-restore.ts source|resume <run-id> <directory>");
assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
const statePath = () => path.join(directory!, "m7-wo1-encounter-state.json");

async function characterRows(characterId: string) {
  const [character, playState, resources, runtime, events] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId } }),
    prisma.characterPlayState.findUnique({ where: { characterId } }),
    prisma.characterResourceState.findMany({ where: { characterId }, orderBy: { resourceKey: "asc" } }),
    prisma.characterPlayRuntime.findUnique({ where: { characterId } }),
    prisma.characterPlayEvent.findMany({ where: { characterId }, orderBy: { sequence: "asc" } }),
  ]);
  return JSON.parse(JSON.stringify({ character, playState, resources, runtime, events })) as unknown;
}
const viewJson = async (id: string) => JSON.parse(JSON.stringify(await getEncounter(id))) as unknown;

async function source() {
  assert.equal(await prisma.encounter.count(), 0, "Use a fresh disposable source database");
  const { world } = await preparePlaytestRelease(runId!);
  const complete = async (name: string) => {
    const c = await createCharacter({ name, rulesetReleaseId: world.release.id });
    const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) as never });
    return (await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion })).id;
  };
  const a = await complete("Restore Alpha");
  const b = await complete("Restore Beta");
  const v = (await getCharacterPlayWorkspace(b)).versions;
  await commitCharacterPlayOperation(b, { operation: { kind: "TIMING", event: "BEGIN_COMBAT" }, idempotencyKey: randomUUID(), expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
  const before = { a: await characterRows(a), b: await characterRows(b) };

  const run = async (id: string, command: unknown) => commandEncounter(id, { command, expectedVersion: (await getEncounter(id)).version, idempotencyKey: randomUUID() });
  const prepared = (await createEncounter({ name: "Restore: Bridge", notes: "Kept across restore", rulesetReleaseId: world.release.id, idempotencyKey: randomUUID() })).encounter;
  const heroes = (await run(prepared.id, { kind: "ADD_SIDE", name: "Heroes" })).encounter.sides[0]!;
  const raiders = (await run(prepared.id, { kind: "ADD_SIDE", name: "Raiders" })).encounter.sides[1]!;
  await run(prepared.id, { kind: "ADD_PARTICIPANT", characterId: a, sideId: heroes.id });
  await run(prepared.id, { kind: "ADD_PARTICIPANT", characterId: b, sideId: raiders.id });
  const archived = (await createEncounter({ name: "Restore: Archived", rulesetReleaseId: world.release.id, idempotencyKey: randomUUID() })).encounter;
  await run(archived.id, { kind: "ADD_PARTICIPANT", characterId: a, sideId: null });
  await run(archived.id, { kind: "ARCHIVE" });

  // Roster edits changed no Character-owned row.
  assert.deepEqual({ a: await characterRows(a), b: await characterRows(b) }, before, "roster edits leave every Character row unchanged");
  await mkdir(directory!, { recursive: true });
  const state = { releaseId: world.release.id, characters: { a, b }, encounters: { prepared: prepared.id, archived: archived.id }, views: { prepared: await viewJson(prepared.id), archived: await viewJson(archived.id) }, rows: before };
  await writeFile(statePath(), JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ stage: "source", releaseId: world.release.id, encounters: 2, participants: 3, events: await prisma.encounterEvent.count() }));
}

async function resume() {
  const state = JSON.parse(await readFile(statePath(), "utf8")) as { releaseId: string; characters: { a: string; b: string }; encounters: { prepared: string; archived: string }; views: Record<string, unknown>; rows: Record<string, unknown> };
  const counts = async () => [await prisma.encounter.count(), await prisma.encounterSide.count(), await prisma.encounterParticipant.count(), await prisma.encounterEvent.count()];
  const before = await counts();
  assert.deepEqual(await viewJson(state.encounters.prepared), state.views.prepared, "the prepared encounter reads identically");
  assert.deepEqual(await viewJson(state.encounters.archived), state.views.archived, "the archived encounter reads identically");
  assert.deepEqual({ a: await characterRows(state.characters.a), b: await characterRows(state.characters.b) }, state.rows, "Character state is identical");
  const prepared = (await getEncounter(state.encounters.prepared)) as { release: { id: string }; readiness: { state: string; warnings: Array<{ code: string }> } };
  assert.equal(prepared.release.id, state.releaseId, "the exact Release reference is kept");
  assert.equal(prepared.readiness.state, "PREPARED");
  assert(prepared.readiness.warnings.some((w) => w.code === "STANDALONE_COMBAT_ACTIVE"), "Beta's standalone combat is still reported, untouched");
  await assert.rejects(prisma.encounter.update({ where: { id: state.encounters.archived }, data: { name: "x" } }), /ENCOUNTER_ARCHIVED/, "the archived freeze survives");
  await assert.rejects(prisma.encounterEvent.updateMany({ where: { encounterId: state.encounters.prepared }, data: { summary: "x" } }), /ENCOUNTER_EVENT_IMMUTABLE/, "history stays append-only");
  assert.deepEqual(await counts(), before, "reading writes nothing");
  console.log(JSON.stringify({ stage: "resume", database: new URL(process.env.DATABASE_URL!).pathname.slice(1), unchanged: true, encounters: before[0], participants: before[2], events: before[3] }));
}

try {
  if (role === "source") await source();
  else if (role === "resume") await resume();
  else throw new Error(`unknown role ${role}`);
} finally {
  await prisma.$disconnect();
}
