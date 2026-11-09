import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  commitCharacterPlayOperation,
  createAuthoredRevision,
  createCharacterSignatureSpell,
  finalizeCharacterSignatureSpell,
  getCharacterAbilities,
  getCharacterPlayWorkspace,
  getCharacterSheet,
  getCharacterSignatureSpell,
  listCharacters,
  prisma,
  proposeDefinitionChangeSet,
  publishRulesetRelease,
  submitAuthoredRevisionForReview,
  submitChangeSetForReview,
  transitionEntityVersionStatus,
  updateAuthoredDraftDefinition,
  updateCharacterSignatureSpellDraft,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { publishNextRelease, refOf, type CharacterReleaseWorld, type Pin } from "../fixtures/m6-wo3-character-release";
import { martialCharacter, spellDraft } from "../fixtures/m6-wo8-maneuvers";
import { cleanupPlaytestWorlds, fingerprint, playtestStatus, preparePlaytestRelease, REVISED_CONTENT_KEY, runPrefix } from "../fixtures/m6-wo12-playtest";

/**
 * PAS-10 M6-WO12 — the playtest vertical slice at the service level over real PostgreSQL (the browser journey proves the
 * same path through the UI; this suite pins the guarantees the journey depends on, and is what the WO12 mutation
 * controls' behaviour rests on):
 *
 *   M6-I180  the preparation command is run-scoped and repeatable (and refuses a malformed run id)
 *   M6-I181  a ChangeSet pinning an IN_REVIEW revision cannot be published; the reviewer's lifecycle approval (the
 *            endpoint the WO12 Canon Manager control calls) makes the same ChangeSet publishable
 *   M6-I182  a Character's Signature Spell is priced, cast and recorded on its PINNED Release — a newer Release never
 *            switches it
 *   M6-I183  an ability revision cannot be substituted at play time (nothing is written)
 *   M6-I184  a lost commit acknowledgement retried with the same key replays the original event (no double charge)
 *   M6-I185  resuming (Library, Sheet, Abilities, Spell, Play) writes nothing
 * Content is test-only (`test.m6wo12.<run>.*`).
 */
const TIMEOUT = 600_000;
const RUN = `dbit${Date.now().toString(36)}`;
let world: CharacterReleaseWorld;
let release2: CharacterReleaseWorld;
let revisedPin: Pin;
let characterId = "";
let wardId = "";

async function commit(id: string, operation: unknown, key = randomUUID()) {
  const v = (await getCharacterPlayWorkspace(id)).versions;
  return commitCharacterPlayOperation(id, { operation, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
}
const wardDraft = (w: CharacterReleaseWorld, name: string) => ({ ...spellDraft(w, name), targeting: { definition: refOf(w.pins, "spell.targeting.self"), parameters: {} }, effects: [{ componentKey: "effect1", order: 1, definition: refOf(w.pins, REVISED_CONTENT_KEY), parameters: { amount: 1 } }], duration: { definition: refOf(w.pins, "spell.duration.sustained"), parameters: {} } });
/** Every row of the Character's own tables — a byte-level read-only witness scoped to this suite's Character. */
async function witness(id: string): Promise<string> {
  const c = { where: { characterId: id } };
  const set = async (q: Promise<unknown[]>) => (await q).map((x) => JSON.stringify(x)).sort();
  return JSON.stringify({
    character: await prisma.character.findUnique({ where: { id } }),
    skills: await set(prisma.characterSkillRank.findMany(c)),
    resources: await set(prisma.characterResourceState.findMany(c)),
    play: await prisma.characterPlayState.findUnique(c),
    runtime: await prisma.characterPlayRuntime.findUnique(c),
    events: await set(prisma.characterPlayEvent.findMany(c)),
    loadout: await prisma.characterWeaponLoadout.findUnique(c),
    abilities: await set(prisma.characterSignatureAbility.findMany(c)),
    spellRevisions: await set(prisma.characterSignatureSpellRevision.findMany({ where: { ability: { characterId: id } } })),
    releases: await prisma.rulesetRelease.count({ where: { rulesetId: world.rulesetId } }),
  });
}

beforeAll(async () => {
  assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  world = (await preparePlaytestRelease(RUN)).world;
}, TIMEOUT);
afterAll(async () => {
  await cleanupPlaytestWorlds(RUN);
}, TIMEOUT);

describe("M6-WO12 playtest vertical slice — service level", () => {
  it("M6-I180 the preparation is run-scoped and repeatable, and refuses a malformed run id", async () => {
    const again = await preparePlaytestRelease(RUN); // the same run again: the previous world is removed first
    world = again.world;
    expect(await prisma.ruleset.count({ where: { canonicalKey: { startsWith: `${runPrefix(RUN)}.` } } })).toBe(1);
    const status = (await playtestStatus()).filter((r) => r.runId === RUN);
    expect(status).toEqual([{ runId: RUN, ruleset: `M6-WO12 Playtest ${RUN}`, releases: 1, characters: 0, changeSets: 0 }]);
    expect(again.summary.revised.entityId).toBe(world.pins.get(REVISED_CONTENT_KEY)!.entityId);
    await expect(preparePlaytestRelease("Not A Run")).rejects.toThrow(/run id/);
    await expect(cleanupPlaytestWorlds("x")).rejects.toThrow(/run id/);
  }, TIMEOUT);

  it("M6-I180 an unrelated run cannot invalidate read evidence or delete another run's Character or history", async () => {
    const otherRun = RUN + "b";
    const { character } = await martialCharacter(world, "Surviving Character");
    expect((await commit(character.id, { kind: "NOTE", category: "GENERAL", text: "Surviving event" })).committed).toBe(true);
    const before = await fingerprint(character.id, world.rulesetId);
    const globalCount = await prisma.entityVersion.count();
    try {
      await preparePlaytestRelease(otherRun);
      expect(await prisma.entityVersion.count()).toBeGreaterThan(globalCount);
      expect(await fingerprint(character.id, world.rulesetId)).toBe(before);
      await expect(cleanupPlaytestWorlds("")).rejects.toThrow(/run id/);
    } finally {
      await cleanupPlaytestWorlds(otherRun);
    }
    expect(await fingerprint(character.id, world.rulesetId)).toBe(before);
    expect((await commit(character.id, { kind: "NOTE", category: "GENERAL", text: "New protected event" })).committed).toBe(true);
    expect(await fingerprint(character.id, world.rulesetId)).not.toBe(before);
  }, TIMEOUT);

  it("M6-I181 an IN_REVIEW revision cannot be published; the reviewer's lifecycle approval makes the same ChangeSet publishable", async () => {
    const base = world.pins.get(REVISED_CONTENT_KEY)!;
    const draft = await createAuthoredRevision(base.entityId, { baseVersionId: base.entityVersionId, changeType: "MECHANICAL_CHANGE", changeSummary: "Playtest: 3 MP" });
    const stored = draft.structuredData as { prowessDefinition: { payload: { costContributions: Array<{ data: Record<string, unknown> }> } } };
    const def = structuredClone(stored.prowessDefinition) as { payload: { costContributions: Array<{ data: Record<string, unknown> }> } };
    expect(def.payload.costContributions[0]!.data.amount).toBe(4);
    def.payload.costContributions[0]!.data.amount = 3;
    const saved = await updateAuthoredDraftDefinition(draft.id, { expectedUpdatedAt: draft.updatedAt.toISOString(), displayName: `Steady Ward Effect (${RUN})`, prowessDefinition: def });
    expect(saved.validation?.status).toBe("PASS");
    await submitAuthoredRevisionForReview(draft.id);
    const cs = await proposeDefinitionChangeSet(draft.id, { rulesetId: world.rulesetId, name: `Cheaper ward ${RUN}` });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    const publish = () => publishRulesetRelease({ rulesetId: world.rulesetId, baseManifestId: world.release.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: "R2" });
    await expect(publish()).rejects.toThrow(/would pin editable EntityVersion\(s\): .*\(IN_REVIEW\)/);
    expect(await prisma.rulesetRelease.count({ where: { rulesetId: world.rulesetId } })).toBe(1);
    await transitionEntityVersionStatus(draft.id, "APPROVED"); // POST /api/entity-versions/:id/status { status: "APPROVED" }
    const r2 = await publish();
    expect(r2.releaseNumber).toBe(2);
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: r2.manifestId, entityId: base.entityId } });
    expect(entry.entityVersionId).toBe(draft.id);
    revisedPin = { ...base, entityVersionId: draft.id };
    const pins = new Map(world.pins);
    pins.set(REVISED_CONTENT_KEY, revisedPin);
    release2 = { ...world, release: { id: r2.id, manifestId: r2.manifestId, releaseNumber: r2.releaseNumber }, pins };
  }, TIMEOUT);

  it("M6-I182 the Signature Spell is priced, cast and recorded on the PINNED Release; a newer Release never switches it", async () => {
    const { character } = await martialCharacter(release2, `Ilsa ${RUN}`);
    characterId = character.id;
    const s0 = await createCharacterSignatureSpell(characterId, { name: `Ward ${RUN}` });
    const s1 = await updateCharacterSignatureSpellDraft(characterId, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: wardDraft(release2, `Ward ${RUN}`) as never });
    expect(s1.spell.draft?.evaluation?.cost?.finalMpCost).toBe(3); // Release 2's authored price (Release 1: 4)
    const fin = await finalizeCharacterSignatureSpell(characterId, s1.spell.id, { expectedVersion: s1.spell.lockVersion });
    wardId = fin.spell.id;
    // A newer Release (3) revises the same Effect again (MP 3 → 2). The Character stays on Release 2.
    const payload = structuredClone(((await prisma.entityVersion.findUniqueOrThrow({ where: { id: revisedPin.entityVersionId } })).structuredData as { prowessDefinition: { payload: { costContributions: Array<{ data: Record<string, unknown> }> } } }).prowessDefinition.payload);
    payload.costContributions[0]!.data.amount = 2;
    const r3 = await publishNextRelease(release2, [REVISED_CONTENT_KEY], "R3", { [REVISED_CONTENT_KEY]: payload });
    expect(r3.release.releaseNumber).toBe(3);
    const detail = await getCharacterSignatureSpell(characterId, wardId);
    expect(detail.spell.current?.evaluation?.cost?.finalMpCost).toBe(3);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).rulesetReleaseId).toBe(release2.release.id);
    for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }]) expect((await commit(characterId, op)).committed).toBe(true);
    const before = (await getCharacterPlayWorkspace(characterId)).workspace.resources;
    const me = (rs: typeof before) => rs.find((r) => r.resourceKey === "ME")!.current;
    const cast = await commit(characterId, { kind: "SPELL", abilityId: wardId, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] });
    expect(cast.committed).toBe(true);
    const after = (await getCharacterPlayWorkspace(characterId)).workspace.resources;
    expect(me(before) - me(after)).toBe(3); // ME pays the pinned price first: 3, never Release 3's 2
    const events = await prisma.characterPlayEvent.findMany({ where: { characterId } });
    expect(events.every((e) => e.rulesetReleaseId === release2.release.id)).toBe(true);
  }, TIMEOUT);

  it("M6-I183 (V04) an unmet construction prerequisite and a full Signature capacity are refused at finalize, writing no revision", async () => {
    const { character } = await martialCharacter(release2, `Capacity ${RUN}`);
    const id = character.id;
    const finalize = async (name: string, draft: unknown) => {
      const s0 = await createCharacterSignatureSpell(id, { name });
      const s1 = await updateCharacterSignatureSpellDraft(id, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: draft as never });
      return finalizeCharacterSignatureSpell(id, s1.spell.id, { expectedVersion: s1.spell.lockVersion });
    };
    // Cleanse requires Expert Arcane Authority; the Level 1 Character is Trained.
    const cleanse = { ...spellDraft(release2, "Cleanse"), effects: [{ componentKey: "effect1", order: 1, definition: refOf(release2.pins, "spell.effect.cleanse"), parameters: {} }] };
    await expect(finalize(`Cleanse ${RUN}`, cleanse)).rejects.toThrow(/not finaliz|prerequisite|Expert|INVALID/i);
    const capacity = (await getCharacterAbilities(id)).signature.capacity!;
    expect(capacity).toBeGreaterThan(0);
    for (let i = 0; i < capacity; i += 1) await finalize(`Bolt ${i} ${RUN}`, spellDraft(release2, `Bolt ${i}`));
    expect((await getCharacterAbilities(id)).signature.used).toBe(capacity);
    const before = await prisma.characterSignatureSpellRevision.count({ where: { ability: { characterId: id } } });
    await expect(finalize(`One too many ${RUN}`, spellDraft(release2, "One too many"))).rejects.toThrow(/capacity|Signature/i);
    expect(await prisma.characterSignatureSpellRevision.count({ where: { ability: { characterId: id } } })).toBe(before);
  }, TIMEOUT);

  it("M6-I183 an ability revision cannot be substituted at play time; nothing is written", async () => {
    const before = await witness(characterId);
    const out = await commit(characterId, { kind: "SPELL", abilityId: wardId, revisionNumber: 2, targets: [{ targetKey: "self" }], inputs: [] });
    expect(out.committed).toBe(false);
    expect(JSON.stringify(out.outcome)).toMatch(/REVISION_CHANGED|current revision is r1, not r2/);
    expect(await witness(characterId)).toBe(before);
  }, TIMEOUT);

  it("M6-I184 a lost acknowledgement retried with the same key replays the original event; nothing is charged twice", async () => {
    const key = randomUUID();
    const v = (await getCharacterPlayWorkspace(characterId)).versions;
    const body = { operation: { kind: "GENERAL_ACTION", actionKey: "MOVE" }, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion };
    const first = await commitCharacterPlayOperation(characterId, body);
    expect(first.committed).toBe(true);
    const afterFirst = await witness(characterId);
    const retry = await commitCharacterPlayOperation(characterId, body); // the browser never saw `first`
    expect(retry.replayed).toBe(true);
    expect(retry.event?.id).toBe(first.event?.id);
    expect(await witness(characterId)).toBe(afterFirst);
    expect(await prisma.characterPlayEvent.count({ where: { characterId, idempotencyKey: key } })).toBe(1);
  }, TIMEOUT);

  it("M6-I185 resuming — Library, Sheet, Abilities, Spell and Play, twice — writes nothing and reads back the same state", async () => {
    const before = await witness(characterId);
    const reads = async () => JSON.stringify({ play: (await getCharacterPlayWorkspace(characterId)).versions, magic: (await getCharacterPlayWorkspace(characterId)).workspace.activeMagic });
    const first = await reads();
    await listCharacters({ page: 1, pageSize: 25, search: `Ilsa ${RUN}`, status: "ALL" });
    await getCharacterSheet(characterId);
    await getCharacterAbilities(characterId);
    await getCharacterSignatureSpell(characterId, wardId);
    expect(await reads()).toBe(first);
    expect(await witness(characterId)).toBe(before);
  }, TIMEOUT);
});
