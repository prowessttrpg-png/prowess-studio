/**
 * PAS-10 M6-WO7 — Signature Spell Builder: HTTP-level integration proof. Every call goes through a REAL route handler
 * against prowess_studio_test; the Release carrying the M5 Spell test components is seeded by
 * tests/integration/fixtures/m6-wo3-character-world.ts (`spells: true`).
 *
 * Invariants exercised: M6-I077 Character-owned (no Compendium row) · M6-I079 prose never creates mechanics · M6-I083
 * M5-WO10 owns cost · M6-I089 drafts use no slot · M6-I090 finalized Spells use shared capacity · M6-I092 append-only
 * revisions · M6-I093 invalid rebuilds never replace the current revision · M6-I094 retirement keeps history.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Sheet from "../../app/api/characters/[characterId]/sheet/route";
import * as Abilities from "../../app/api/characters/[characterId]/abilities/route";
import * as Spells from "../../app/api/characters/[characterId]/spells/route";
import * as Spell from "../../app/api/characters/[characterId]/spells/[spellId]/route";
import * as Builder from "../../app/api/characters/[characterId]/spells/[spellId]/builder/route";
import * as Draft from "../../app/api/characters/[characterId]/spells/[spellId]/draft/route";
import * as Validate from "../../app/api/characters/[characterId]/spells/[spellId]/validate/route";
import * as FinalizeSpell from "../../app/api/characters/[characterId]/spells/[spellId]/finalize/route";
import * as Rebuild from "../../app/api/characters/[characterId]/spells/[spellId]/rebuild/route";
import * as Retire from "../../app/api/characters/[characterId]/spells/[spellId]/retire/route";
import { call } from "./m2-api-harness";
import { cleanupCharacterWorlds, seedCharacterWorld, selOf, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo7api";
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

/** A completed Character Trained in the Release's Arcana Skill (the construction rule's Arcane Authority Skill). */
async function caster(name: string) {
  const c = (await call(Characters.POST, "POST", "/api/characters", {}, { name, concept: null, rulesetReleaseId: w.release.id })).data;
  const choices = workedChoices(w.pins);
  const candidate = { ...choices, skills: choices.skills.map((s, i) => (i === 2 ? { ...s, skill: selOf(w.pins, "skill.arcana") } : s)) };
  const saved = (await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: c.lockVersion, candidate })).data;
  return (await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: saved.lockVersion })).data as { id: string };
}

describe("M6-WO7 Signature Spell API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    w = await seedCharacterWorld(PREFIX, "R1", { advancement: true, spells: true });
  }, 900_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("the full lifecycle over HTTP: create → draft → validate → finalize → rebuild (invalid kept out) → Revision 2 → retire", async () => {
    const c = await caster("Lifecycle");
    const before = [await prisma.entity.count(), await prisma.entityVersion.count(), await prisma.rulesetRelease.count()];
    const created = await call(Spells.POST, "POST", "/x", p(c.id), { name: "Ember Bolt" });
    expect(created.status).toBe(201);
    const id = created.data.spell.id as string;
    expect([created.data.spell.status, created.data.spell.state, created.data.signature.used]).toEqual(["DRAFT", "INCOMPLETE", 0]);
    const draft = await call(Draft.PUT, "PUT", "/x", p(c.id, id), { expectedVersion: created.data.spell.lockVersion, draft: simple("Ember Bolt") });
    expect(draft.status).toBe(200);
    expect(draft.data.spell.draft.evaluation.state).toBe("VALID");
    expect(draft.data.spell.draft.evaluation.cost.finalMpCost).toBe(11);
    const v = await call(Validate.POST, "POST", "/x", p(c.id, id), { expectedVersion: draft.data.spell.lockVersion });
    expect([v.status, v.data.evaluation.state]).toEqual([200, "VALID"]);
    const fin = await call(FinalizeSpell.POST, "POST", "/x", p(c.id, id), { expectedVersion: draft.data.spell.lockVersion });
    expect([fin.status, fin.data.spell.status, fin.data.spell.current.revisionNumber, fin.data.signature.used]).toEqual([200, "ACTIVE", 1, 1]);
    // Rebuild with an invalid composition: Revision 1 stays current and finalizing is refused (422).
    const rb = await call(Rebuild.POST, "POST", "/x", p(c.id, id), { expectedVersion: fin.data.spell.lockVersion });
    const bad = { ...simple("Ember Bolt"), targeting: { definition: ref("spell.targeting.radius"), parameters: {} } };
    const badSaved = await call(Draft.PUT, "PUT", "/x", p(c.id, id), { expectedVersion: rb.data.spell.lockVersion, draft: bad });
    expect(badSaved.data.spell.draft.evaluation.state).toBe("INVALID");
    const refused = await call(FinalizeSpell.POST, "POST", "/x", p(c.id, id), { expectedVersion: badSaved.data.spell.lockVersion });
    expect([refused.status, refused.body.error?.code]).toEqual([422, "CHARACTER.SIGNATURE_SPELL_NOT_FINALIZABLE"]);
    expect((await call(Spell.GET, "GET", "/x", p(c.id, id))).data.spell.current.revisionNumber).toBe(1);
    // Fix the rebuild (add the reference Trait): Revision 2 becomes current; Revision 1 is history.
    const fixed = { ...simple("Ember Bolt"), traits: [{ componentKey: "trait1", order: 1, definition: ref("fixture.wo10.trait.flat"), parameters: {}, appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: "effect1" } }] };
    const fixedSaved = await call(Draft.PUT, "PUT", "/x", p(c.id, id), { expectedVersion: badSaved.data.spell.lockVersion, draft: fixed });
    const fin2 = await call(FinalizeSpell.POST, "POST", "/x", p(c.id, id), { expectedVersion: fixedSaved.data.spell.lockVersion });
    expect(fin2.data.spell.current.revisionNumber).toBe(2);
    expect(fin2.data.spell.current.evaluation.cost.finalMpCost).toBe(13);
    expect(fin2.data.history.map((h: { revisionNumber: number; current: boolean }) => [h.revisionNumber, h.current])).toEqual([
      [1, false],
      [2, true],
    ]);
    const retired = await call(Retire.POST, "POST", "/x", p(c.id, id), { expectedVersion: fin2.data.spell.lockVersion });
    expect([retired.data.spell.status, retired.data.signature.used, retired.data.history.length]).toEqual(["RETIRED", 0, 2]);
    expect([await prisma.entity.count(), await prisma.entityVersion.count(), await prisma.rulesetRelease.count()]).toEqual(before);
  }, 180_000);

  it("strict bodies: derived values, unknown fields, malformed drafts and bad ids are refused; stale writes are 409", async () => {
    const c = await caster("Strict");
    const created = (await call(Spells.POST, "POST", "/x", p(c.id), { name: "Strict" })).data;
    const id = created.spell.id as string;
    expect((await call(Spells.POST, "POST", "/x", p(c.id), { name: "X", finalMpCost: 1 })).status).toBe(400);
    for (const extra of [{ finalMpCost: 3 }, { capacity: 9 }, { signatureSlots: 2 }, { sustainMp: 0 }]) expect((await call(Draft.PUT, "PUT", "/x", p(c.id, id), { expectedVersion: created.spell.lockVersion, draft: simple("Strict"), ...extra })).status, JSON.stringify(extra)).toBe(400);
    for (const draft of [{ ...simple("Strict"), finalMpCost: 3 }, { ...simple("Strict"), schemaVersion: 2 }, { ...simple("Strict"), effects: [{ componentKey: "effect1", order: 1, definition: { canonicalKey: "spell.effect.direct_damage" }, parameters: {} }] }])
      expect((await call(Draft.PUT, "PUT", "/x", p(c.id, id), { expectedVersion: created.spell.lockVersion, draft })).status, JSON.stringify(draft).slice(0, 80)).toBe(400);
    const ok = await call(Draft.PUT, "PUT", "/x", p(c.id, id), { expectedVersion: created.spell.lockVersion, draft: simple("Strict") });
    expect(ok.status).toBe(200);
    expect((await call(Draft.PUT, "PUT", "/x", p(c.id, id), { expectedVersion: created.spell.lockVersion, draft: simple("Strict") })).status).toBe(409);
    expect((await call(Spell.GET, "GET", "/x", p(c.id, "not-a-uuid"))).status).toBe(400);
    expect((await call(Spell.GET, "GET", "/x", p(c.id, "00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    // A Spell belongs to its Character only.
    const other = await caster("Other");
    expect((await call(Spell.GET, "GET", "/x", p(other.id, id))).status).toBe(404);
  }, 180_000);

  it("the builder read is one consolidated view of the exact Release; Abilities and the Sheet list finalized Spells", async () => {
    const c = await caster("Reader");
    const created = (await call(Spells.POST, "POST", "/x", p(c.id), { name: "Reader" })).data;
    const b = await call(Builder.GET, "GET", "/x", p(c.id, created.spell.id));
    expect(b.status).toBe(200);
    expect(Object.keys(b.data).sort()).toEqual(["catalog", "character", "history", "names", "release", "signature", "spell", "stats"]);
    expect(b.data.release.id).toBe(w.release.id);
    const releaseVersions = new Set([...w.pins.values()].map((x) => x.entityVersionId));
    for (const list of ["targeting", "effects", "traits", "durations", "castingConditions"]) {
      expect(b.data.catalog[list].length, list).toBeGreaterThan(0);
      for (const o of b.data.catalog[list] as Array<{ ref: { entityVersionId: string } }>) expect(releaseVersions.has(o.ref.entityVersionId), list).toBe(true);
    }
    expect((b.data.catalog.effects as Array<{ eligibility: { status: string } | null }>).some((o) => o.eligibility?.status === "INELIGIBLE")).toBe(true); // locked stays visible
    await call(Draft.PUT, "PUT", "/x", p(c.id, created.spell.id), { expectedVersion: created.spell.lockVersion, draft: simple("Reader") });
    const ab = await call(Abilities.GET, "GET", "/x", p(c.id));
    expect(ab.data.spells.map((s: { status: string }) => s.status)).toEqual(["DRAFT"]);
    expect((await call(Sheet.GET, "GET", "/x", p(c.id))).data.signatureSpells).toEqual([]);
    const spell = (await call(Spell.GET, "GET", "/x", p(c.id, created.spell.id))).data.spell;
    await call(FinalizeSpell.POST, "POST", "/x", p(c.id, created.spell.id), { expectedVersion: spell.lockVersion });
    const sheet = (await call(Sheet.GET, "GET", "/x", p(c.id))).data;
    expect(sheet.signatureSpells.map((s: { name: string; finalMpCost: number }) => [s.name, s.finalMpCost])).toEqual([["Reader", 11]]);
  }, 180_000);
});
