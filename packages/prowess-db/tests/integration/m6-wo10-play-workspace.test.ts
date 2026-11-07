import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitCharacterPlayOperation,
  createCharacterSignatureSpell,
  finalizeCharacterSignatureSpell,
  getCharacterPlayWorkspace,
  getCharacterSheet,
  listCharacterPlayEvents,
  previewCharacterPlayOperation,
  prisma,
  updateCharacterPlayState,
  updateCharacterSignatureSpellDraft,
} from "../../src/index";
import { commitPlayOperation } from "../../src/character/play-repository";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, seedCharacterRelease, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";
import { martialCharacter, spellDraft } from "../fixtures/m6-wo8-maneuvers";

/**
 * PAS-10 M6-WO10 — Character Play Workspace persistence over real PostgreSQL (verification D): reads never write; one
 * commit atomically writes the sheet's current values, the runtime row and ONE append-only ledger event; retries are
 * idempotent; stale and concurrent submissions never spend twice; a failed step rolls everything back; the committed
 * state survives reload; the ledger is immutable at the database level.
 */
const PREFIX = "test.m6wo10db";
const TIMEOUT = 300_000;
let world: CharacterReleaseWorld;

const counts = async () => [await prisma.characterPlayRuntime.count(), await prisma.characterPlayEvent.count(), await prisma.characterPlayState.count(), await prisma.characterResourceState.count(), await prisma.entityVersion.count(), await prisma.rulesetRelease.count()];
async function versions(id: string) {
  return (await getCharacterPlayWorkspace(id)).versions;
}
async function commit(id: string, operation: unknown, key = randomUUID()) {
  const v = await versions(id);
  return commitCharacterPlayOperation(id, { operation, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
}
const ap = async (id: string) => (await getCharacterSheet(id)).resources.find((r) => r.resourceKey === "AP")!.current;

describe("M6-WO10 Character Play Workspace persistence", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R1", { advancement: true, weapons: true, spells: true, maneuvers: true });
  }, 900_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("M6-I154 reads and previews never write; a preview never creates a runtime or sheet row", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Play Reader");
    const before = await counts();
    const view = await getCharacterPlayWorkspace(c.id);
    expect(view.versions).toEqual({ runtimeVersion: 0, playStateVersion: 0 });
    expect(view.workspace.recorded).toBe(false);
    expect(view.workspace.runtime.releaseId).toBe(world.release.id);
    const p = await previewCharacterPlayOperation(c.id, { operation: { kind: "TIMING", event: "BEGIN_COMBAT" }, expectedRuntimeVersion: 0, expectedPlayStateVersion: 0 });
    expect(p.outcome.status).toBe("COMMITTABLE");
    expect(await counts()).toEqual(before);
  });

  it("M6-I151 M6-I155 a commit writes the sheet values, the runtime and one event atomically; the sheet reads the same AP", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Play Mover");
    for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }]) expect((await commit(c.id, op)).committed).toBe(true);
    const full = await ap(c.id);
    const moved = await commit(c.id, { kind: "GENERAL_ACTION", actionKey: "MOVE" });
    expect(moved.committed).toBe(true);
    expect(await ap(c.id)).toBe(full! - 1);
    const view = await getCharacterPlayWorkspace(c.id);
    expect(view.workspace.resources.find((r) => r.resourceKey === "AP")!.current).toBe(full! - 1);
    expect(view.workspace.resources.find((r) => r.resourceKey === "MOVEMENT_ALLOWANCE")!.current).toBeGreaterThan(0);
    const events = await prisma.characterPlayEvent.findMany({ where: { characterId: c.id }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => [e.sequence, e.operationKind, e.classification, e.runtimeVersion])).toEqual([[1, "TIMING", "RULES_EXECUTED", 1], [2, "TIMING", "RULES_EXECUTED", 2], [3, "TIMING", "RULES_EXECUTED", 3], [4, "GENERAL_ACTION", "RULES_EXECUTED", 4]]);
    expect(events.every((e) => e.rulesetReleaseId === world.release.id)).toBe(true);
    // The runtime row holds no sheet resource (one authority): only the runtime-only trackers and timing.
    const row = await prisma.characterPlayRuntime.findUniqueOrThrow({ where: { characterId: c.id } });
    expect(Object.keys(row.state as object).sort()).toEqual(["activeMagic", "advancementCount", "characterId", "combat", "contractVersion", "movement", "movementAllowance", "releaseId", "reservedMp", "rulesetProvenance"]);
    // Recovery after reload: the next read returns exactly the committed state (nothing refreshed or advanced).
    expect((await getCharacterPlayWorkspace(c.id)).workspace.runtime).toEqual(row.state);
  });

  it("M6-I156 an idempotent retry returns the original event without paying again; a reused key with another operation conflicts", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Play Retrier");
    for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }]) await commit(c.id, op);
    const v = await versions(c.id);
    const key = randomUUID();
    const op = { kind: "GENERAL_ACTION", actionKey: "MOVE" };
    const first = await commitCharacterPlayOperation(c.id, { operation: op, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
    const afterFirst = await ap(c.id);
    const retry = await commitCharacterPlayOperation(c.id, { operation: op, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
    expect(retry.replayed).toBe(true);
    expect(retry.event!.id).toBe(first.event!.id);
    expect(await ap(c.id)).toBe(afterFirst);
    expect(await prisma.characterPlayEvent.count({ where: { characterId: c.id } })).toBe(4);
    await expect(commitCharacterPlayOperation(c.id, { operation: { kind: "GENERAL_ACTION", actionKey: "SPRINT" }, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion })).rejects.toMatchObject({ code: "CHARACTER.PLAY_IDEMPOTENCY_CONFLICT" });
  });

  it("M6-I157 stale versions and a Character Sheet edit in between fail safely; concurrent submissions spend AP once", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Play Racer");
    for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }]) await commit(c.id, op);
    const v = await versions(c.id);
    // The Character Sheet stays a valid editor: its edit changes the version the Play Workspace evaluated.
    const sheet = await getCharacterSheet(c.id);
    await updateCharacterPlayState(c.id, { expectedVersion: sheet.playStateVersion, resources: { HP: 3 } });
    await expect(commitCharacterPlayOperation(c.id, { operation: { kind: "GENERAL_ACTION", actionKey: "MOVE" }, idempotencyKey: randomUUID(), expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion })).rejects.toMatchObject({ code: "CHARACTER.STALE_WRITE" });
    expect((await getCharacterSheet(c.id)).resources.find((r) => r.resourceKey === "HP")!.current).toBe(3);
    const fresh = await versions(c.id);
    const before = await ap(c.id);
    const submit = () => commitCharacterPlayOperation(c.id, { operation: { kind: "GENERAL_ACTION", actionKey: "MOVE" }, idempotencyKey: randomUUID(), expectedRuntimeVersion: fresh.runtimeVersion, expectedPlayStateVersion: fresh.playStateVersion });
    const results = await Promise.allSettled([submit(), submit(), submit()]);
    expect(results.filter((r) => r.status === "fulfilled" && r.value.committed).length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "CHARACTER.STALE_WRITE")).toBe(true);
    expect(await ap(c.id)).toBe(before! - 1);
  });

  it("M6-I155 a failing step rolls the whole commit back: no resource change persists without its runtime and event", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Play Rollback");
    await commit(c.id, { kind: "TIMING", event: "BEGIN_COMBAT" });
    const v = await versions(c.id);
    const sheetBefore = await getCharacterSheet(c.id);
    const out = await commitPlayOperation({
      characterId: c.id,
      rulesetReleaseId: world.release.id,
      expectedRuntimeVersion: v.runtimeVersion + 5, // wrong: the runtime compare-and-set fails AFTER the sheet write
      expectedPlayStateVersion: v.playStateVersion,
      resources: { values: [{ resourceKey: "HP", current: 1 }], initial: sheetBefore.resources.flatMap((r) => (r.current === null ? [] : [{ resourceKey: r.resourceKey, current: r.current }])) },
      state: { probe: true },
      event: { idempotencyKey: randomUUID(), requestHash: "0".repeat(64), operationKind: "MANUAL_ADJUSTMENT", classification: "MANUAL_ADJUSTMENT", summary: "probe", record: {} },
    });
    expect(out).toEqual({ outcome: "stale", which: "RUNTIME" });
    const sheetAfter = await getCharacterSheet(c.id);
    expect(sheetAfter.playStateVersion).toBe(sheetBefore.playStateVersion);
    expect(sheetAfter.resources.find((r) => r.resourceKey === "HP")!.current).toBe(sheetBefore.resources.find((r) => r.resourceKey === "HP")!.current);
    expect(await prisma.characterPlayEvent.count({ where: { characterId: c.id } })).toBe(1);
  });

  it("M6-I169 the ledger is append-only and pinned to the runtime's Release; history pages newest first", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Play Historian");
    await commit(c.id, { kind: "TIMING", event: "BEGIN_COMBAT" });
    await commit(c.id, { kind: "NOTE", category: "GM_ADJUDICATION", text: "The GM rules the bridge collapses." });
    await commit(c.id, { kind: "MANUAL_ADJUSTMENT", resourceKey: "HP", after: 4, reason: "fell from the bridge" });
    const e = await prisma.characterPlayEvent.findFirstOrThrow({ where: { characterId: c.id, sequence: 1 } });
    await expect(prisma.characterPlayEvent.update({ where: { id: e.id }, data: { summary: "rewritten" } })).rejects.toThrow(/IMMUTABLE/);
    await expect(prisma.characterPlayEvent.delete({ where: { id: e.id } })).rejects.toThrow(/IMMUTABLE/);
    await expect(prisma.characterPlayRuntime.update({ where: { characterId: c.id }, data: { rulesetReleaseId: randomUUID() } })).rejects.toThrow();
    const page = await listCharacterPlayEvents(c.id, { before: null, limit: 2 });
    expect(page.events.map((x) => [x.sequence, x.classification])).toEqual([[3, "MANUAL_ADJUSTMENT"], [2, "NOTE"]]);
    expect((page.events[0]!.record as { inputs: unknown }).inputs).toMatchObject({ before: expect.any(Number), after: 4, reason: "fell from the bridge", source: "PLAYER_GM_PROVIDED" });
    expect((await listCharacterPlayEvents(c.id, { before: 2, limit: 50 })).events.map((x) => x.sequence)).toEqual([1]);
  });

  it("M6-I158 M6-I164 a Signature Spell pending input pays nothing; the complete cast commits once with exact revision provenance", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Play Caster");
    const s0 = await createCharacterSignatureSpell(c.id, { name: "Play Spell" });
    const s1 = await updateCharacterSignatureSpellDraft(c.id, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: spellDraft(world, "Play Spell") });
    const spell = await finalizeCharacterSignatureSpell(c.id, s1.spell.id, { expectedVersion: s1.spell.lockVersion });
    for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }]) await commit(c.id, op);
    const view = await getCharacterPlayWorkspace(c.id);
    const entry = view.workspace.spells.find((s) => s.abilityId === spell.spell.id)!;
    expect(entry.revisionNumber).toBe(1);
    const cast = { kind: "SPELL", abilityId: spell.spell.id, revisionNumber: 1, targets: [{ targetKey: "goblin" }], inputs: [] as unknown[] };
    const pending = await commit(c.id, cast);
    expect(pending.committed).toBe(false);
    expect(pending.outcome!.status).toBe("PENDING_INPUT");
    const eventsBefore = await prisma.characterPlayEvent.count({ where: { characterId: c.id } });
    const q = pending.outcome!.pending[0] as { requestKey: string; kind: string };
    const answer = q.kind === "ATTACK_ROLL" ? { requestKey: q.requestKey, kind: "ATTACK_ROLL", roll: { mode: "NORMAL", rolls: [4], source: "PHYSICAL" }, targetDodge: 5 } : { requestKey: q.requestKey, kind: "SAVING_THROW", roll: { mode: "NORMAL", rolls: [1], source: "PHYSICAL" }, defender: { level: 1, stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3 } } };
    const done = await commit(c.id, { ...cast, inputs: [answer] });
    if (!done.committed) expect(done.outcome!.reasons).toEqual([]);
    expect(done.committed).toBe(true);
    expect(await prisma.characterPlayEvent.count({ where: { characterId: c.id } })).toBe(eventsBefore + 1);
    expect((done.event!.record as { source: unknown }).source).toMatchObject({ kind: "CHARACTER_SIGNATURE_SPELL", signatureAbilityId: spell.spell.id, revisionNumber: 1 });
    expect(done.event!.operationKind).toBe("SPELL");
  });
});
