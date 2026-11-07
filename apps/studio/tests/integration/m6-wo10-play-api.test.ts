/**
 * PAS-10 M6-WO10 — Character Play Workspace: HTTP-level integration proof. Every call goes through the REAL route
 * handlers against prowess_studio_test (Release seeded by fixtures/m6-wo3-character-world.ts). Proves: the workspace is
 * the requested Character's own; reads and previews write nothing; the input contract is closed (client-supplied
 * mechanics, unknown body fields and query parameters, malformed ids are refused); a commit changes resources only through
 * the server; retries are idempotent; stale and reused keys conflict; cross-Character Ability references are refused; the
 * ledger reads back newest first.
 */
import { randomUUID } from "node:crypto";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Spells from "../../app/api/characters/[characterId]/spells/route";
import * as Draft from "../../app/api/characters/[characterId]/spells/[spellId]/draft/route";
import * as FinalizeSpell from "../../app/api/characters/[characterId]/spells/[spellId]/finalize/route";
import * as Play from "../../app/api/characters/[characterId]/play/route";
import * as Preview from "../../app/api/characters/[characterId]/play/preview/route";
import * as Operations from "../../app/api/characters/[characterId]/play/operations/route";
import * as Events from "../../app/api/characters/[characterId]/play/events/route";
import { call } from "./m2-api-harness";
import { cleanupCharacterWorlds, seedCharacterWorld, selOf, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo10api";
let w: CharacterWorld;
const p = (characterId: string, spellId?: string): Record<string, string> => (spellId === undefined ? { characterId } : { characterId, spellId });
const ref = (key: string) => {
  const x = w.pins.get(key)!;
  return { entityId: x.entityId, entityVersionId: x.entityVersionId, canonicalKey: x.canonicalKey, definitionKind: x.definitionKind, systemFamily: x.systemFamily };
};
const simple = (name: string) => ({
  schemaVersion: 1,
  concept: { name, description: "", visualDescription: "", notes: "", narrativeTags: [] },
  authority: "ARCANE_AUTHORITY",
  affinity: null,
  targeting: { definition: ref("spell.targeting.single_target"), parameters: {} },
  effects: [{ componentKey: "effect1", order: 1, definition: ref("fixture.wo10.effect.damage"), parameters: { dice: 1, mp: 8 } }],
  effectChain: null,
  traits: [],
  duration: { definition: ref("spell.duration.instant"), parameters: {} },
  castingConditions: [],
  constructionOptions: { effectSlotsTradedForTraits: 0 },
  additionalAffinityTraits: [],
});
async function character(name: string) {
  const c = (await call(Characters.POST, "POST", "/api/characters", {}, { name, concept: null, rulesetReleaseId: w.release.id })).data;
  const choices = workedChoices(w.pins);
  const candidate = { ...choices, skills: choices.skills.map((s, i) => (i === 2 ? { ...s, skill: selOf(w.pins, "skill.arcana") } : s)) };
  const saved = (await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: c.lockVersion, candidate })).data;
  return (await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: saved.lockVersion })).data as { id: string };
}
async function finalizedSpell(characterId: string, name: string) {
  const created = (await call(Spells.POST, "POST", "/x", p(characterId), { name })).data;
  const draft = (await call(Draft.PUT, "PUT", "/x", p(characterId, created.spell.id), { expectedVersion: created.spell.lockVersion, draft: simple(name) })).data;
  return (await call(FinalizeSpell.POST, "POST", "/x", p(characterId, created.spell.id), { expectedVersion: draft.spell.lockVersion })).data;
}
const counts = async () => [await prisma.characterPlayRuntime.count(), await prisma.characterPlayEvent.count(), await prisma.characterPlayState.count(), await prisma.entityVersion.count(), await prisma.rulesetRelease.count()];
async function view(id: string) {
  return (await call(Play.GET, "GET", "/x", p(id))).data;
}
async function commit(id: string, operation: unknown, key = randomUUID()) {
  const v = (await view(id)).versions;
  return call(Operations.POST, "POST", "/x", p(id), { operation, idempotencyKey: key, expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
}
const resource = (data: { workspace: { resources: { resourceKey: string; current: number }[] } }, key: string) => data.workspace.resources.find((r) => r.resourceKey === key)!.current;
const INTO_TURN = [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }];

describe("M6-WO10 Character Play Workspace API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    w = await seedCharacterWorld(PREFIX, "R1", { advancement: true, spells: true });
  }, 900_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("GET returns the requested Character's own workspace for its exact Release and writes nothing; ids and queries are strict", async () => {
    const a = await character("Play Owner");
    const before = await counts();
    const res = await call(Play.GET, "GET", "/x", p(a.id));
    expect(res.status).toBe(200);
    expect(await counts()).toEqual(before);
    expect(res.data.character.id).toBe(a.id);
    expect(res.data.workspace.runtime.releaseId).toBe(w.release.id);
    expect(res.data.versions).toEqual({ runtimeVersion: 0, playStateVersion: 0 });
    expect(res.data.workspace.timing.legal).toEqual(["BEGIN_COMBAT"]);
    expect((await call(Play.GET, "GET", "/x?refresh=1", p(a.id))).status).toBe(400);
    expect((await call(Play.GET, "GET", "/x", p("not-a-uuid"))).status).toBe(400);
    expect((await call(Play.GET, "GET", "/x", p(randomUUID()))).status).toBe(404);
  });

  it("preview evaluates server-side without writing; client-supplied mechanics and unknown fields are refused", async () => {
    const a = await character("Play Previewer");
    const before = await counts();
    const ok = await call(Preview.POST, "POST", "/x", p(a.id), { operation: { kind: "TIMING", event: "BEGIN_COMBAT" }, expectedRuntimeVersion: 0, expectedPlayStateVersion: 0 });
    expect(ok.status).toBe(200);
    expect(ok.data.outcome.status).toBe("COMMITTABLE");
    expect(await counts()).toEqual(before);
    for (const operation of [{ kind: "GENERAL_ACTION", actionKey: "MOVE", apCost: 0 }, { kind: "MANUAL_ADJUSTMENT", resourceKey: "HP", after: 3, maximum: 99 }, { kind: "TIMING", event: "START_TURN", refreshTo: 9 }])
      expect((await call(Preview.POST, "POST", "/x", p(a.id), { operation, expectedRuntimeVersion: 0, expectedPlayStateVersion: 0 })).body.error?.code, JSON.stringify(operation)).toBe("CHARACTER.INVALID_PLAY_OPERATION");
    expect((await call(Preview.POST, "POST", "/x", p(a.id), { operation: { kind: "NOTE", category: "GENERAL", text: "x" }, expectedRuntimeVersion: 0, expectedPlayStateVersion: 0, result: "SUCCESS" })).status).toBe(400);
    expect((await call(Preview.POST, "POST", "/x", p(a.id), { operation: { kind: "NOTE", category: "GENERAL", text: "x" }, expectedRuntimeVersion: 3, expectedPlayStateVersion: 0 })).status).toBe(409);
    expect(await counts()).toEqual(before);
  });

  it("commit changes resources only on the server, once; a retry replays; a stale or reused key conflicts", async () => {
    const a = await character("Play Committer");
    for (const op of INTO_TURN) expect((await commit(a.id, op)).data.committed).toBe(true);
    const ready = await view(a.id);
    const apBefore = resource(ready, "AP");
    const key = randomUUID();
    const body = { operation: { kind: "GENERAL_ACTION", actionKey: "MOVE" }, idempotencyKey: key, expectedRuntimeVersion: ready.versions.runtimeVersion, expectedPlayStateVersion: ready.versions.playStateVersion };
    const first = await call(Operations.POST, "POST", "/x", p(a.id), body);
    expect(first.status).toBe(200);
    expect(first.data.committed).toBe(true);
    expect(resource(first.data.workspace, "AP")).toBe(apBefore - 1);
    const retry = await call(Operations.POST, "POST", "/x", p(a.id), body);
    expect(retry.data.replayed).toBe(true);
    expect(retry.data.event.id).toBe(first.data.event.id);
    expect(resource(retry.data.workspace, "AP")).toBe(apBefore - 1);
    expect((await call(Operations.POST, "POST", "/x", p(a.id), { ...body, operation: { kind: "GENERAL_ACTION", actionKey: "SPRINT" } })).body.error?.code).toBe("CHARACTER.PLAY_IDEMPOTENCY_CONFLICT");
    expect((await call(Operations.POST, "POST", "/x", p(a.id), { ...body, idempotencyKey: randomUUID() })).status).toBe(409); // stale versions
    expect((await call(Operations.POST, "POST", "/x", p(a.id), { ...body, idempotencyKey: "not-a-uuid" })).status).toBe(400);
    // A refused operation commits nothing and says why.
    const refused = await commit(a.id, { kind: "TIMING", event: "START_TURN" });
    expect(refused.data.committed).toBe(false);
    expect(refused.data.outcome.reasons[0].code).toBe("PLAY.TIMING_SEQUENCE");
  });

  it("an Ability reference is scoped to its own Character; the ledger reads back newest first; event queries are strict", async () => {
    const a = await character("Play Caster A");
    const b = await character("Play Caster B");
    const spell = await finalizedSpell(a.id, "Owner Bolt");
    for (const op of INTO_TURN) await commit(b.id, op);
    const foreign = await commit(b.id, { kind: "SPELL", abilityId: spell.spell.id, revisionNumber: 1, targets: [{ targetKey: "t1" }], inputs: [] });
    expect(foreign.data.committed).toBe(false);
    expect(foreign.data.outcome.reasons[0].code).toBe("PLAY.UNKNOWN_ABILITY");
    const events = await call(Events.GET, "GET", "/x?limit=2", p(b.id));
    expect(events.status).toBe(200);
    expect(events.data.events.map((e: { sequence: number }) => e.sequence)).toEqual([3, 2]);
    expect(events.data.events.every((e: { rulesetReleaseId: string }) => e.rulesetReleaseId === w.release.id)).toBe(true);
    expect((await call(Events.GET, "GET", "/x?limit=abc", p(b.id))).status).toBe(400);
    expect((await call(Events.GET, "GET", "/x?order=asc", p(b.id))).status).toBe(400);
    expect((await call(Events.GET, "GET", "/x", p(a.id))).data.events).toEqual([]);
  });
});
