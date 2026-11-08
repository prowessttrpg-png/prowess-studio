import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitCharacterPlayOperation,
  createCharacter,
  createCharacterSignatureManeuver,
  createCharacterSignatureSpell,
  finalizeCharacterCoreCreation,
  finalizeCharacterSignatureManeuver,
  finalizeCharacterSignatureSpell,
  getCharacter,
  getCharacterAbilities,
  getCharacterAttacks,
  getCharacterCardLibrary,
  getCharacterPlayWorkspace,
  getCharacterSheet,
  getCharacterWeapons,
  listCharacterPlayEvents,
  listCharacters,
  prisma,
  saveCharacterCreation,
  updateCharacterProfile,
  updateCharacterSignatureManeuverDraft,
  updateCharacterSignatureSpellDraft,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, refOf, seedCharacterRelease, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";
import { maneuverDraft, martialCharacter, spellDraft } from "../fixtures/m6-wo8-maneuvers";

/**
 * PAS-10 M6-WO11 — Character Library / Save / Load over real PostgreSQL. Acceptance rows L01 L04 L05 L06 L08 L09 L10:
 * the Library filter is ONE predicate applied before pagination (stable, deterministic, literal search); reopening reads
 * back exactly what the owning services persisted (draft choices, completed sheet, loadout, exact ability revisions,
 * play runtime, resources and history); every read path is write-free (a byte-level fingerprint of every Character table
 * is unchanged); a partial creation save keeps its acknowledged half; a lost play response is retried idempotently;
 * pre-WO11 Characters stay pinned when a newer Release appears, and an unreadable stored reference is reported, never
 * repaired.
 */
const PREFIX = "test.m6wo11db";
const TIMEOUT = 600_000;
let world: CharacterReleaseWorld;
const TAG = `Lib${Date.now().toString(36)}`;

const MODELS = [
  "character",
  "characterStatAllocation",
  "characterAncestryStatChoice",
  "characterSkillRank",
  "characterAdvancement",
  "characterStatAdvancement",
  "characterSkillAdvancement",
  "characterAffinityAdvancementChoice",
  "characterPlayState",
  "characterResourceState",
  "characterSheetNotes",
  "characterPortrait",
  "characterWeaponLoadout",
  "characterSignatureAbility",
  "characterSignatureSpellRevision",
  "characterSignatureManeuverRevision",
  "characterPlayRuntime",
  "characterPlayEvent",
] as const;
/** Every row of every Character table, plus the Release / Definition tables' sizes — a byte-level read-only witness. */
async function fingerprint(): Promise<string> {
  const db = prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>;
  const tables: Record<string, string[]> = {};
  for (const m of MODELS) tables[m] = (await db[m]!.findMany()).map((r) => JSON.stringify(r)).sort();
  return JSON.stringify({ tables, releases: await prisma.rulesetRelease.count(), versions: await prisma.entityVersion.count() });
}
async function commit(id: string, operation: unknown, key = randomUUID()) {
  const v = (await getCharacterPlayWorkspace(id)).versions;
  return commitCharacterPlayOperation(id, { operation, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
}
/** A Sustained Signature Spell of the test world (the maintenance-eligible test Effect) — it becomes M5-WO13 Active Magic. */
const wardDraft = (w: CharacterReleaseWorld, name: string) => ({ ...spellDraft(w, name), effects: [{ componentKey: "effect1", order: 1, definition: refOf(w.pins, "fixture.wo9.effect.maintenance"), parameters: { amount: 1 } }], duration: { definition: refOf(w.pins, "spell.duration.sustained"), parameters: {} } });
async function answered(id: string, operation: { inputs: unknown[] } & Record<string, unknown>) {
  const first = await commit(id, operation);
  if (first.committed || first.outcome?.status !== "PENDING_INPUT") return first;
  const answers = (first.outcome.pending as Array<{ requestKey: string; kind: string }>).map((q) => (q.kind === "ATTACK_ROLL" ? { requestKey: q.requestKey, kind: "ATTACK_ROLL", roll: { mode: "NORMAL", rolls: [4], source: "PHYSICAL" }, targetDodge: 5 } : { requestKey: q.requestKey, kind: "SAVING_THROW", roll: { mode: "NORMAL", rolls: [1], source: "PHYSICAL" }, defender: { level: 1, stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3 } } }));
  return commit(id, { ...operation, inputs: answers });
}
const resource = (view: Awaited<ReturnType<typeof getCharacterPlayWorkspace>>, key: string) => view.workspace.resources.find((r) => r.resourceKey === key)?.current ?? null;

async function allPages(filter: { search?: string; status?: string }, pageSize: number) {
  const first = await listCharacters({ page: 1, pageSize, ...filter });
  const pages = Math.max(1, Math.ceil(first.total / pageSize));
  const ids: string[] = [...first.items.map((i) => i.id)];
  for (let p = 2; p <= pages; p += 1) ids.push(...(await listCharacters({ page: p, pageSize, ...filter })).items.map((i) => i.id));
  return { total: first.total, ids, pages };
}

describe("M6-WO11 Character Library / Save / Load (PostgreSQL)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R1", { advancement: true, weapons: true, spells: true, maneuvers: true });
  }, 1_200_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("M6-I173 L01 search / status filter apply to the whole collection before paging; totals match rows; ties break by id", { timeout: TIMEOUT }, async () => {
    // 51 tagged Drafts + 2 completed + literal-punctuation names, so one match sits outside the default first page.
    const created: string[] = [];
    for (let i = 0; i < 51; i += 1) created.push((await createCharacter({ name: `${TAG} Draft ${String(i).padStart(2, "0")}`, rulesetReleaseId: world.release.id })).id);
    const complete: string[] = [];
    for (const n of ["Done A", "Done B"]) {
      const c = await createCharacter({ name: `${TAG} ${n}`, rulesetReleaseId: world.release.id });
      const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) });
      complete.push((await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion })).id);
    }
    const percent = (await createCharacter({ name: `${TAG} 100% Pure`, rulesetReleaseId: world.release.id })).id;
    const under = (await createCharacter({ name: `${TAG} Under_Score`, rulesetReleaseId: world.release.id })).id;
    const slash = (await createCharacter({ name: `${TAG} Back\\Slash`, rulesetReleaseId: world.release.id })).id;
    // Ties: ten rows share one exact updatedAt; the id tie-breaker must order them deterministically.
    const tie = new Date("2030-01-01T00:00:00.000Z");
    await prisma.character.updateMany({ where: { id: { in: created.slice(0, 10) } }, data: { updatedAt: tie } });

    // Search (case-insensitive, literal) over the whole collection, then paged.
    const tagged = await allPages({ search: TAG.toLowerCase() }, 10);
    expect(tagged.total).toBe(56);
    expect(new Set(tagged.ids).size).toBe(56);
    expect(tagged.ids.sort()).toEqual([...created, ...complete, percent, under, slash].sort());
    const target = created[50]!;
    const unfilteredFirst = await listCharacters({ page: 1, pageSize: 50 });
    const outside = (await allPages({}, 50)).ids.indexOf(target);
    expect((await listCharacters({ page: 1, pageSize: 50, search: `${TAG} Draft 50` })).items.map((i) => i.id)).toEqual([target]);
    expect(outside).toBeGreaterThanOrEqual(0);
    // Paging the unfiltered collection: no omission, no duplicate, the last page holds the remainder.
    const all = await allPages({}, 7);
    expect(new Set(all.ids).size).toBe(all.ids.length);
    expect(all.ids.length).toBe(all.total);
    expect(all.total).toBe(unfilteredFirst.total);
    expect((await listCharacters({ page: all.pages, pageSize: 7 })).items.length).toBe(all.total - (all.pages - 1) * 7);
    expect((await listCharacters({ page: all.pages + 1, pageSize: 7 })).items).toEqual([]);
    // Tied rows: id ascending within the tie, and the same order on every read.
    const tied = all.ids.filter((id) => created.slice(0, 10).includes(id));
    expect(tied).toEqual([...created.slice(0, 10)].sort());
    expect((await allPages({}, 7)).ids).toEqual(all.ids);
    // Status filter uses the same predicate for count and rows.
    const drafts = await allPages({ search: TAG, status: "DRAFT" }, 20);
    const done = await allPages({ search: TAG, status: "CORE_COMPLETE" }, 20);
    expect([drafts.total, drafts.ids.length, done.total, done.ids.length]).toEqual([54, 54, 2, 2]);
    expect(done.ids.sort()).toEqual([...complete].sort());
    expect((await listCharacters({ page: 1, pageSize: 50, search: TAG, status: "ALL" })).total).toBe(56);
    // Literal punctuation: % and _ are name text, never wildcards.
    expect((await listCharacters({ page: 1, pageSize: 50, search: `${TAG} 100%` })).items.map((i) => i.id)).toEqual([percent]);
    expect((await listCharacters({ page: 1, pageSize: 50, search: "%" })).items.map((i) => i.id)).toEqual([percent]);
    expect((await listCharacters({ page: 1, pageSize: 50, search: `${TAG} Under_` })).items.map((i) => i.id)).toEqual([under]);
    expect((await listCharacters({ page: 1, pageSize: 50, search: `${TAG} Under Score` })).total).toBe(0);
    expect((await listCharacters({ page: 1, pageSize: 50, search: "_" })).items.map((i) => i.id)).toEqual([under]);
    expect((await listCharacters({ page: 1, pageSize: 50, search: "\\" })).items.map((i) => i.id)).toEqual([slash]);
    expect((await listCharacters({ page: 1, pageSize: 50, search: `${TAG} back\\slash` })).items.map((i) => i.id)).toEqual([slash]);
    // Empty / whitespace-only search is no filter; an unmatched search is an empty, total-0 page.
    expect((await listCharacters({ page: 1, pageSize: 50, search: "   " })).total).toBe(unfilteredFirst.total);
    expect(await listCharacters({ page: 1, pageSize: 50, search: `${TAG} nobody` })).toMatchObject({ items: [], total: 0 });
    // Invalid filter values are refused by the service as well (the API also refuses them).
    await expect(listCharacters({ page: 1, pageSize: 50, status: "ARCHIVED" })).rejects.toMatchObject({ code: "CHARACTER.INVALID_INPUT" });
    await expect(listCharacters({ page: 1, pageSize: 50, search: "x".repeat(121) })).rejects.toMatchObject({ code: "CHARACTER.INVALID_INPUT" });
  });

  it("M6-I175 L08 a creation save whose second write fails keeps the acknowledged profile; the retry saves only the choices", { timeout: TIMEOUT }, async () => {
    const c = await createCharacter({ name: `${TAG} Partial`, rulesetReleaseId: world.release.id });
    // The wizard's two writes: profile (acknowledged, version 2) …
    const profiled = await updateCharacterProfile(c.id, { expectedLockVersion: c.lockVersion, name: `${TAG} Partial Renamed`, concept: "A wandering scout" });
    expect(profiled.lockVersion).toBe(c.lockVersion + 1);
    // … then the choices at the version the client loaded with (its acknowledgement was not adopted) → refused, nothing written.
    const before = await fingerprint();
    await expect(saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) })).rejects.toMatchObject({ code: "CHARACTER.STALE_WRITE" });
    expect(await fingerprint()).toBe(before);
    const stored = await getCharacter(c.id);
    expect([stored.name, stored.concept, stored.lockVersion, stored.choices.ancestry]).toEqual([`${TAG} Partial Renamed`, "A wandering scout", profiled.lockVersion, null]);
    // The retry at the acknowledged version saves only the outstanding choices; reopening shows both.
    const retried = await saveCharacterCreation(c.id, { expectedLockVersion: profiled.lockVersion, candidate: workedChoices(world.pins) });
    const reopened = await getCharacter(c.id);
    expect(reopened.lockVersion).toBe(retried.lockVersion);
    expect(reopened.name).toBe(`${TAG} Partial Renamed`);
    expect(reopened.choices.ancestry).toEqual(workedChoices(world.pins).ancestry);
    expect(reopened.status).toBe("DRAFT");
  });

  it("M6-I174 M6-I176 L04 L05 L06 L09 a configured Character reopens exactly; play resumes identically; every read is write-free", { timeout: TIMEOUT }, async () => {
    // L04 — loadout, a finalized Signature Spell and Signature Maneuver.
    const { character: c, attack } = await martialCharacter(world, `${TAG} Resumer`);
    const s0 = await createCharacterSignatureSpell(c.id, { name: "Resume Bolt" });
    const s1 = await updateCharacterSignatureSpellDraft(c.id, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: spellDraft(world, "Resume Bolt") });
    const spell = await finalizeCharacterSignatureSpell(c.id, s1.spell.id, { expectedVersion: s1.spell.lockVersion });
    const m0 = await createCharacterSignatureManeuver(c.id, { name: "Resume Strike" });
    const m1 = await updateCharacterSignatureManeuverDraft(c.id, m0.maneuver.id, { expectedVersion: m0.maneuver.lockVersion, draft: maneuverDraft(world, attack, "Resume Strike") });
    const maneuver = await finalizeCharacterSignatureManeuver(c.id, m1.maneuver.id, { expectedVersion: m1.maneuver.lockVersion });
    // A second spell left as a DRAFT: reopening must never finalize it.
    const d0 = await createCharacterSignatureSpell(c.id, { name: "Unfinished" });
    // A completed Character that never entered play.
    const { character: idle } = await martialCharacter(world, `${TAG} Idle`);

    const w0 = await createCharacterSignatureSpell(c.id, { name: "Resume Ward" });
    const w1 = await updateCharacterSignatureSpellDraft(c.id, w0.spell.id, { expectedVersion: w0.spell.lockVersion, draft: wardDraft(world, "Resume Ward") });
    const ward = await finalizeCharacterSignatureSpell(c.id, w1.spell.id, { expectedVersion: w1.spell.lockVersion });

    // L05 / L09 — a legal WO10 sequence: timing, a paid Move whose response is "lost" and retried, spent movement, and a
    // Sustained Spell that becomes Active Magic.
    for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }]) expect((await commit(c.id, op)).committed).toBe(true);
    const fullAp = resource(await getCharacterPlayWorkspace(c.id), "AP")!;
    const key = randomUUID();
    const v = (await getCharacterPlayWorkspace(c.id)).versions;
    const body = { operation: { kind: "GENERAL_ACTION", actionKey: "MOVE" }, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion };
    const accepted = await commitCharacterPlayOperation(c.id, body);
    expect(accepted.committed).toBe(true);
    // The client never saw that response; it retries the IDENTICAL request with the SAME key.
    const retried = await commitCharacterPlayOperation(c.id, body);
    expect(retried).toMatchObject({ committed: true, replayed: true });
    expect(retried.event!.id).toBe(accepted.event!.id);
    expect(await prisma.characterPlayEvent.count({ where: { characterId: c.id, idempotencyKey: key } })).toBe(1);
    expect(resource(await getCharacterPlayWorkspace(c.id), "AP")).toBe(fullAp - 1);
    await expect(commitCharacterPlayOperation(c.id, { ...body, operation: { kind: "NOTE", text: "different body", category: "GENERAL" } })).rejects.toMatchObject({ code: "CHARACTER.PLAY_IDEMPOTENCY_CONFLICT" });
    expect((await commit(c.id, { kind: "MOVEMENT", segments: [{ distance: 5, terrainKey: "NORMAL" }] })).committed).toBe(true);
    const cast = await answered(c.id, { kind: "SPELL", abilityId: ward.spell.id, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] });
    expect(cast.committed, JSON.stringify(cast.outcome?.reasons)).toBe(true);
    const magic = (await getCharacterPlayWorkspace(c.id)).workspace.activeMagic.state;
    expect(magic?.effects.map((e) => e.status)).toEqual(["ACTIVE"]);

    // Record the committed state, then reopen everything twice: identical, and the database is byte-for-byte unchanged.
    const witness = await fingerprint();
    const open = async () => {
      const library = await listCharacters({ page: 1, pageSize: 50, search: TAG });
      const view = await getCharacterPlayWorkspace(c.id);
      return {
        row: library.items.find((i) => i.id === c.id),
        character: await getCharacter(c.id),
        sheet: await getCharacterSheet(c.id),
        weapons: await getCharacterWeapons(c.id),
        attacks: await getCharacterAttacks(c.id),
        abilities: await getCharacterAbilities(c.id),
        cards: await getCharacterCardLibrary(c.id),
        play: { versions: view.versions, runtime: view.workspace.runtime, resources: view.workspace.resources, recentEvents: view.recentEvents },
        events: await listCharacterPlayEvents(c.id, { before: undefined, limit: 100 }),
        idleSheet: await getCharacterSheet(idle.id),
        idlePlay: await getCharacterPlayWorkspace(idle.id),
      };
    };
    const first = await open();
    const second = await open();
    expect(second).toEqual(first);
    expect(await fingerprint()).toBe(witness);

    // What survived: the exact loadout and Attack, the exact ability revisions and lifecycle states, cards on those sources.
    expect(first.row).toMatchObject({ id: c.id, status: "CORE_COMPLETE", release: { id: world.release.id } });
    expect(first.attacks.library.mainHand!.attacks.map((a) => a.attackKey)).toContain(attack.attackKey);
    const abilities = first.abilities as unknown as { spells: Array<{ id: string; status: string; currentRevisionNumber: number | null }>; maneuvers?: Array<{ id: string; status: string; currentRevisionNumber: number | null }> };
    expect(JSON.stringify(abilities)).toContain(spell.spell.id);
    expect(JSON.stringify(abilities)).toContain(maneuver.maneuver.id);
    expect(JSON.stringify(abilities)).toContain(d0.spell.id);
    expect((await prisma.characterSignatureAbility.findUniqueOrThrow({ where: { id: d0.spell.id } })).status).toBe("DRAFT");
    expect(JSON.stringify(first.cards)).toContain(spell.spell.id);
    // Play: spent AP / movement and the resolved cast are exactly the committed state; history order is stable.
    expect(first.play.runtime.combat).toMatchObject({ active: true, phase: "ROUND", turn: "ACTIVE" });
    expect(first.play.runtime.movement.segments).toHaveLength(1);
    expect(first.events.events.map((e) => e.operationKind)).toEqual(["SPELL", "MOVEMENT", "GENERAL_ACTION", "TIMING", "TIMING", "TIMING"]);
    expect(first.events.events[2]!.id).toBe(accepted.event!.id);
    expect((first.play.runtime.activeMagic as { effects: Array<{ status: string }> } | null)?.effects.map((e) => e.status)).toEqual(["ACTIVE"]);
    expect(first.play.versions.runtimeVersion).toBe(6);
    // The Character that never entered play opens with the WO10 empty state and writes nothing.
    expect(first.idlePlay.versions).toEqual({ runtimeVersion: 0, playStateVersion: 0 });
    expect(first.idlePlay.workspace.recorded).toBe(false);
    expect(await prisma.characterPlayRuntime.count({ where: { characterId: idle.id } })).toBe(0);
  });

  it("M6-I174 M6-I177 L10 pre-WO11 Characters keep their exact Release after a newer one; unknown ids and unreadable references change nothing", { timeout: TIMEOUT }, async () => {
    // Characters written exactly as before WO11 (same services, same schema — WO11 adds no storage).
    const draft = await createCharacter({ name: `${TAG} Old Draft`, rulesetReleaseId: world.release.id });
    const draftSaved = await saveCharacterCreation(draft.id, { expectedLockVersion: draft.lockVersion, candidate: { ...workedChoices(world.pins), primaryAffinity: null } });
    const { character: done } = await martialCharacter(world, `${TAG} Old Complete`);
    for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }]) expect((await commit(done.id, op)).committed).toBe(true);
    const before = { draft: await getCharacter(draft.id), done: await getCharacter(done.id), sheet: await getCharacterSheet(done.id) };
    // A newer Release revises the Ancestry; nothing about these Characters moves to it.
    const r2 = await publishNextRelease(world, ["test.m6wo3.ancestry.orcani"], "1.1.0");
    expect(r2.release.id).not.toBe(world.release.id);
    const witness = await fingerprint();
    const after = { draft: await getCharacter(draft.id), done: await getCharacter(done.id), sheet: await getCharacterSheet(done.id) };
    expect(after).toEqual(before);
    expect(after.draft.release.id).toBe(world.release.id);
    expect(after.draft.lockVersion).toBe(draftSaved.lockVersion);
    expect(after.draft.choices.ancestry).toEqual(workedChoices(world.pins).ancestry);
    expect(after.done.release.id).toBe(world.release.id);
    expect((await listCharacters({ page: 1, pageSize: 50, search: `${TAG} Old` })).items.map((i) => i.release.id)).toEqual([world.release.id, world.release.id]);
    // Unknown id → the existing NOT_FOUND, nothing written.
    await expect(getCharacter(randomUUID())).rejects.toMatchObject({ code: "CHARACTER.NOT_FOUND" });
    await expect(getCharacterPlayWorkspace(randomUUID())).rejects.toMatchObject({ code: "CHARACTER.NOT_FOUND" });
    expect(await fingerprint()).toBe(witness);
    // An inconsistent stored reference (play state naming another Character) is reported, never repaired or repinned.
    const row = await prisma.characterPlayRuntime.findUniqueOrThrow({ where: { characterId: done.id } });
    await prisma.characterPlayRuntime.update({ where: { characterId: done.id }, data: { state: { ...(row.state as object), characterId: randomUUID() } } });
    const broken = await fingerprint();
    await expect(getCharacterPlayWorkspace(done.id)).rejects.toMatchObject({ code: "CHARACTER.PLAY_STATE_UNREADABLE" });
    expect(await fingerprint()).toBe(broken);
  });
});
