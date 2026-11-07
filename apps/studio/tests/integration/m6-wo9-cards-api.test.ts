/**
 * PAS-10 M6-WO9 Phase C — Card Library and Action Directory: HTTP-level integration proof. Every call goes through the
 * REAL read-only route handlers against prowess_studio_test (Release seeded by fixtures/m6-wo3-character-world.ts).
 * Proves: the cards are the server's projections for the requested Character's exact Release (another Character sees
 * its own cards only), Signature Spell values equal the WO7 Abilities read, history and retirement are kept apart, bad
 * ids are refused, unknown query parameters are refused, and reads write nothing.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Abilities from "../../app/api/characters/[characterId]/abilities/route";
import * as Spells from "../../app/api/characters/[characterId]/spells/route";
import * as Draft from "../../app/api/characters/[characterId]/spells/[spellId]/draft/route";
import * as FinalizeSpell from "../../app/api/characters/[characterId]/spells/[spellId]/finalize/route";
import * as Retire from "../../app/api/characters/[characterId]/spells/[spellId]/retire/route";
import * as Cards from "../../app/api/characters/[characterId]/cards/route";
import * as Actions from "../../app/api/characters/[characterId]/actions/route";
import { call } from "./m2-api-harness";
import { cleanupCharacterWorlds, seedCharacterWorld, selOf, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo9api";
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
async function caster(name: string) {
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
const counts = async () => [await prisma.entity.count(), await prisma.entityVersion.count(), await prisma.rulesetRelease.count(), await prisma.characterSignatureAbility.count(), await prisma.characterSignatureSpellRevision.count()];

describe("M6-WO9 Card Library / Action Directory API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    w = await seedCharacterWorld(PREFIX, "R1", { advancement: true, spells: true });
  }, 900_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("returns the requested Character's own cards for its exact Release, equal to the WO7 evaluation, and writes nothing", async () => {
    const a = await caster("Card Owner");
    const b = await caster("Other Character");
    const spell = await finalizedSpell(a.id, "Owner Bolt");
    await finalizedSpell(b.id, "Other Bolt");
    const before = await counts();
    const res = await call(Cards.GET, "GET", "/x", p(a.id));
    expect(res.status).toBe(200);
    expect(await counts()).toEqual(before);
    const lib = res.data;
    expect(lib.character.id).toBe(a.id);
    expect(lib.release.id).toBe(w.release.id);
    expect(lib.spells.map((s: { abilityId: string }) => s.abilityId)).toEqual([spell.spell.id]);
    const card = lib.spells[0].current.card;
    expect(card.provenance.characterId).toBe(a.id);
    expect(card.provenance.characterReleaseId).toBe(w.release.id);
    expect(card.provenance.ability).toEqual({ kind: "SPELL", abilityId: spell.spell.id, revisionNumber: 1, revisionRole: "CURRENT" });
    const abilities = (await call(Abilities.GET, "GET", "/x", p(a.id))).data;
    const evaluation = abilities.spells[0].current.evaluation;
    expect(card.costs.mp).toEqual({ status: "AVAILABLE", value: evaluation.cost.finalMpCost });
    expect(card.costs.ap).toEqual({ status: "AVAILABLE", value: evaluation.cost.finalApCost });
    // The other Character's Spell never appears.
    expect(JSON.stringify(lib)).not.toContain("Other Bolt");
    expect(lib.mageArts.domain.status).toBe("UNAVAILABLE");
    expect(lib.actions.status).toBe("READY");
  }, 240_000);

  it("a retired Spell is presented as a HISTORICAL revision, never current", async () => {
    const c = await caster("Retiree");
    const spell = await finalizedSpell(c.id, "Faded Bolt");
    await call(Retire.POST, "POST", "/x", p(c.id, spell.spell.id), { expectedVersion: spell.spell.lockVersion });
    const lib = (await call(Cards.GET, "GET", "/x", p(c.id))).data;
    expect(lib.spells[0].status).toBe("RETIRED");
    expect(lib.spells[0].current.card.provenance.ability.revisionRole).toBe("HISTORICAL");
  }, 240_000);

  it("the Action Directory lists the Release's ACTION Definitions with no invented prerequisites, and writes nothing", async () => {
    const c = await caster("Directory Reader");
    const before = await counts();
    const res = await call(Actions.GET, "GET", "/x", p(c.id));
    expect(res.status).toBe(200);
    expect(await counts()).toEqual(before);
    const keys = res.data.directory.cards.map((card: { section: { action: { canonicalKey: string }; eligibility: unknown; improvements: unknown[] } }) => {
      expect(card.section.eligibility).toEqual({ status: "NO_REQUIREMENTS" });
      expect(card.section.improvements).toEqual([]);
      return card.section.action.canonicalKey;
    });
    expect(keys.length).toBe(13);
    expect(keys.every((k: string) => k.startsWith(`${PREFIX}.action_`))).toBe(true);
  }, 240_000);

  it("refuses malformed ids (400), unknown Characters (404) and any query parameter (no client-supplied values)", async () => {
    for (const route of [Cards.GET, Actions.GET]) {
      expect((await call(route, "GET", "/x", p("not-a-uuid"))).status).toBe(400);
      expect((await call(route, "GET", "/x", p("00000000-0000-4000-8000-00000000dead"))).status).toBe(404);
      const c = await caster("Strict Reader");
      expect((await call(route, "GET", "/x?ap=0", p(c.id))).status).toBe(400);
    }
  }, 240_000);
});
