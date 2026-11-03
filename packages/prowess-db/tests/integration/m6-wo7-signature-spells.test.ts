/**
 * PAS-10 M6-WO7 — Signature Spell Builder: database integration. Runs only against prowess_studio_test.
 *
 * A Release carrying the M5 Spell components (test content) is published through the ordinary M1 / M2 services; a
 * Character built from it owns Signature Spells: drafts, atomic finalization against the Signature roster, append-only
 * revisions, rebuild, retirement and exact-Release history. Invariants exercised (docs/architecture/m6-invariants.md):
 * M6-I077 Character-owned (never canon) · M6-I078 exact Release-pinned components · M6-I079 prose never creates
 * mechanics · M6-I083 M5-WO10 owns cost · M6-I086 Effect order persists · M6-I089 drafts use no slot · M6-I090
 * finalized Spells use shared capacity · M6-I091 atomic finalization · M6-I092 append-only revisions · M6-I093 invalid
 * rebuilds never replace the current revision · M6-I094 retirement keeps history · M6-I095 no latest component.
 * Fixture content is `test.m6wo7db.*`.
 */
import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCharacter,
  createCharacterSignatureSpell,
  finalizeCharacterCoreCreation,
  finalizeCharacterSignatureSpell,
  getCharacterAbilities,
  getCharacterSheet,
  getCharacterSignatureSpell,
  getSignatureSpellBuilder,
  prisma,
  rebuildCharacterSignatureSpell,
  retireCharacterSignatureSpell,
  saveCharacterCreation,
  updateCharacterSignatureSpellDraft,
  validateCharacterSignatureSpell,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, refOf, seedCharacterRelease, selOf, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";

const PREFIX = "test.m6wo7db";
const TIMEOUT = 120_000;
let world: CharacterReleaseWorld;

async function expectCode(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, String(error)).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  if (message) expect((error as DomainError).message).toMatch(message);
}
/** The worked Character, Trained in the Release's Arcana Skill (the construction rule's Arcane Authority Skill). */
async function caster(name: string, w: CharacterReleaseWorld = world) {
  const c = await createCharacter({ name, rulesetReleaseId: w.release.id });
  const choices = workedChoices(w.pins);
  const candidate = { ...choices, skills: choices.skills.map((s, i) => (i === 2 ? { ...s, skill: selOf(w.pins, "skill.arcana") } : s)) };
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate });
  return finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
}
const use = (key: string, parameters: Record<string, unknown> = {}, w: CharacterReleaseWorld = world) => ({ definition: refOf(w.pins, key), parameters });
const ordered = (componentKey: string, key: string, order: number, parameters: Record<string, unknown> = {}, w: CharacterReleaseWorld = world) => ({ componentKey, ...use(key, parameters, w), order });
/** A complete simple Arcane Spell: Single Target, one Damage Effect (8 listed MP), Instant (§135). */
function simple(name = "Ember Bolt", w: CharacterReleaseWorld = world) {
  return {
    schemaVersion: 1,
    concept: { name, description: "", visualDescription: "", notes: "", narrativeTags: [] },
    authority: "ARCANE_AUTHORITY",
    affinity: null,
    targeting: use("spell.targeting.single_target", {}, w),
    effects: [ordered("effect1", "fixture.wo10.effect.damage", 10, { dice: 1, mp: 8 }, w)],
    effectChain: null,
    traits: [],
    duration: use("spell.duration.instant", {}, w),
    castingConditions: [],
    constructionOptions: { effectSlotsTradedForTraits: 0 },
    additionalAffinityTraits: [],
  };
}
async function finalized(characterId: string, draft: object) {
  const created = await createCharacterSignatureSpell(characterId, { name: (draft as { concept: { name: string } }).concept.name });
  const saved = await updateCharacterSignatureSpellDraft(characterId, created.spell.id, { expectedVersion: created.spell.lockVersion, draft });
  return finalizeCharacterSignatureSpell(characterId, created.spell.id, { expectedVersion: saved.spell.lockVersion });
}

describe("M6-WO7 Signature Spells (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R1", { advancement: true, spells: true });
  }, 900_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("§154 / M6-I089 an incomplete draft persists, reloads and consumes no Signature slot", { timeout: TIMEOUT }, async () => {
    const c = await caster("Drafter");
    const created = await createCharacterSignatureSpell(c.id, { name: "Unfinished" });
    expect(created.spell.status).toBe("DRAFT");
    expect(created.spell.draft?.evaluation?.state).toBe("INCOMPLETE");
    expect(created.spell.draft?.evaluation?.missing).toEqual(["AUTHORITY", "TARGETING", "EFFECTS", "DURATION"]);
    const abilities = await getCharacterAbilities(c.id);
    expect(abilities.signature.used).toBe(0);
    expect(abilities.spells.map((s) => s.state)).toEqual(["INCOMPLETE"]);
    await expectCode(finalizeCharacterSignatureSpell(c.id, created.spell.id, { expectedVersion: created.spell.lockVersion }), CHARACTER_ERROR_CODES.SIGNATURE_SPELL_NOT_FINALIZABLE);
  });

  it("§135 / M6-I083 a simple Arcane Spell finalizes VALID, uses one slot, is exactly priced and reloads identically", { timeout: TIMEOUT }, async () => {
    const c = await caster("Caster");
    const draft = simple();
    const out = await finalized(c.id, draft);
    expect(out.spell.status).toBe("ACTIVE");
    expect(out.spell.current?.revisionNumber).toBe(1);
    const e = out.spell.current!.evaluation!;
    expect(e.state).toBe("VALID");
    expect(e.cost?.baseMp).toBe(11);
    expect(e.cost?.finalMpCost).toBe(11);
    expect(e.cost?.finalApCost).toBe(e.cost?.baseAp);
    expect(e.construction?.signature.candidateUse).toBe(1);
    expect(JSON.parse(JSON.stringify(out.spell.current!.draft))).toEqual(draft);
    const again = await getCharacterSignatureSpell(c.id, out.spell.id);
    expect(again.spell.current!.evaluation).toEqual(e);
    expect((await getCharacterAbilities(c.id)).signature.used).toBe(1);
  });

  it("§94–§95 the Character Sheet lists the current revision of each active Spell compactly; drafts and retired Spells are absent", { timeout: TIMEOUT }, async () => {
    const c = await caster("Sheet Caster");
    expect((await getCharacterSheet(c.id)).signatureSpells).toEqual([]);
    const out = await finalized(c.id, simple("Ember Bolt"));
    await createCharacterSignatureSpell(c.id, { name: "Unfinished" });
    const sheet = await getCharacterSheet(c.id);
    expect(sheet.signatureSpells).toHaveLength(1);
    const line = sheet.signatureSpells[0]!;
    expect([line.id, line.name, line.revisionNumber, line.state, line.finalMpCost, line.finalApCost]).toEqual([out.spell.id, "Ember Bolt", 1, "VALID", 11, out.spell.current!.evaluation!.cost!.finalApCost]);
    expect(line.targeting?.entityVersionId).toBe(refOf(world.pins, "spell.targeting.single_target").entityVersionId);
    expect(line.range?.value).toBe(out.spell.current!.evaluation!.targeting!.range!.value);
    expect(line.effectFamilies).toEqual(["DAMAGE"]);
    expect(sheet.names[line.targeting!.entityVersionId]).toBeDefined();
    await retireCharacterSignatureSpell(c.id, out.spell.id, { expectedVersion: out.spell.lockVersion });
    expect((await getCharacterSheet(c.id)).signatureSpells).toEqual([]);
  });

  it("§6 / M6-I077 finalizing creates no Entity, EntityVersion, ChangeSet or Release and leaves the Character's Release pinned", { timeout: TIMEOUT }, async () => {
    const c = await caster("Canon Check");
    const count = async () => [await prisma.entity.count(), await prisma.entityVersion.count(), await prisma.changeSet.count(), await prisma.rulesetRelease.count()];
    const before = await count();
    await finalized(c.id, simple("Not Canon"));
    expect(await count()).toEqual(before);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).rulesetReleaseId).toBe(world.release.id);
  });

  it("§136 / M6-I086 Effect order and chain persist exactly", { timeout: TIMEOUT }, async () => {
    const c = await caster("Chainer");
    const draft = { ...simple("Chain"), effects: [ordered("damage", "spell.effect.direct_damage", 10, { dice: 1 }), ordered("move", "spell.effect.reposition", 20, { distance: 5 })], effectChain: { failurePolicy: "STOP", nodes: [{ effectKey: "damage", behavior: "SUCCESS_ONLY", branch: null, trigger: null }] } };
    const created = await createCharacterSignatureSpell(c.id, { name: "Chain" });
    const saved = await updateCharacterSignatureSpellDraft(c.id, created.spell.id, { expectedVersion: created.spell.lockVersion, draft });
    const reloaded = await getCharacterSignatureSpell(c.id, saved.spell.id);
    expect(reloaded.spell.draft?.draft?.effects.map((e) => [e.componentKey, e.order])).toEqual([["damage", 10], ["move", 20]]);
    expect(reloaded.spell.draft?.draft?.effectChain).toEqual(draft.effectChain);
  });

  it("§155 / M6-I079 renaming and rewriting prose changes no mechanic", { timeout: TIMEOUT }, async () => {
    const c = await caster("Namer");
    const a = await finalized(c.id, simple("Fireball"));
    const b = await finalized(c.id, { ...simple("Healing Nova"), concept: { name: "Healing Nova", description: "Heals allies with radiant fire", visualDescription: "A 30-ft radius", notes: "Conjuration", narrativeTags: ["holy"] } });
    expect(b.spell.current!.evaluation!.cost).toEqual(a.spell.current!.evaluation!.cost);
    expect(b.spell.current!.evaluation!.keywords).toEqual(a.spell.current!.evaluation!.keywords);
  });

  it("§151 / M6-I092 / M6-I093 an invalid rebuild never replaces Revision 1; a fixed rebuild becomes Revision 2; history is append-only", { timeout: TIMEOUT }, async () => {
    const c = await caster("Rebuilder");
    const r1 = await finalized(c.id, simple("Bolt"));
    const rebuild = await rebuildCharacterSignatureSpell(c.id, r1.spell.id, { expectedVersion: r1.spell.lockVersion });
    expect(rebuild.spell.draft?.draft).toEqual(rebuild.spell.current?.draft);
    const invalid = { ...simple("Bolt"), targeting: use("spell.targeting.radius") };
    const saved = await updateCharacterSignatureSpellDraft(c.id, r1.spell.id, { expectedVersion: rebuild.spell.lockVersion, draft: invalid });
    expect(saved.spell.draft?.evaluation?.state).toBe("INVALID");
    await expectCode(finalizeCharacterSignatureSpell(c.id, r1.spell.id, { expectedVersion: saved.spell.lockVersion }), CHARACTER_ERROR_CODES.SIGNATURE_SPELL_NOT_FINALIZABLE);
    const still = await getCharacterSignatureSpell(c.id, r1.spell.id);
    expect([still.spell.current?.revisionNumber, still.spell.current?.evaluation?.state]).toEqual([1, "VALID"]);
    const fixed = await updateCharacterSignatureSpellDraft(c.id, r1.spell.id, { expectedVersion: still.spell.lockVersion, draft: { ...simple("Bolt"), effects: [ordered("effect1", "fixture.wo10.effect.damage", 10, { dice: 1, mp: 9 })] } });
    const r2 = await finalizeCharacterSignatureSpell(c.id, r1.spell.id, { expectedVersion: fixed.spell.lockVersion });
    expect(r2.spell.current?.revisionNumber).toBe(2);
    expect(r2.history.map((h) => [h.revisionNumber, h.current])).toEqual([[1, false], [2, true]]);
    expect(r2.history[0]!.evaluation?.cost?.finalMpCost).toBe(11);
    expect(r2.history[1]!.evaluation?.cost?.finalMpCost).toBe(12);
    await expect(prisma.$executeRawUnsafe(`UPDATE character_signature_spell_revisions SET revision_number = 9 WHERE id = '${r2.history[0]!.revisionId}'`)).rejects.toThrow(/CHARACTER_SIGNATURE_SPELL_REVISION_IMMUTABLE/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM character_signature_spell_revisions WHERE id = '${r2.history[0]!.revisionId}'`)).rejects.toThrow(/CHARACTER_SIGNATURE_SPELL_REVISION_IMMUTABLE/);
  });

  it("§152 / M6-I094 retirement releases the slot and keeps every revision", { timeout: TIMEOUT }, async () => {
    const c = await caster("Retirer");
    const s = await finalized(c.id, simple("Old Bolt"));
    expect((await getCharacterAbilities(c.id)).signature.used).toBe(1);
    const retired = await retireCharacterSignatureSpell(c.id, s.spell.id, { expectedVersion: s.spell.lockVersion });
    expect(retired.spell.status).toBe("RETIRED");
    expect(retired.history).toHaveLength(1);
    expect((await getCharacterAbilities(c.id)).signature.used).toBe(0);
    await expectCode(updateCharacterSignatureSpellDraft(c.id, s.spell.id, { expectedVersion: retired.spell.lockVersion, draft: simple() }), CHARACTER_ERROR_CODES.SIGNATURE_SPELL_STATE);
  });

  it("§87 a stale draft write is refused (409); the client never submits a derived value", { timeout: TIMEOUT }, async () => {
    const c = await caster("Stale");
    const created = await createCharacterSignatureSpell(c.id, { name: "Race" });
    await updateCharacterSignatureSpellDraft(c.id, created.spell.id, { expectedVersion: created.spell.lockVersion, draft: simple("Race") });
    await expectCode(updateCharacterSignatureSpellDraft(c.id, created.spell.id, { expectedVersion: created.spell.lockVersion, draft: simple("Race 2") }), CHARACTER_ERROR_CODES.STALE_WRITE);
    await expectCode(updateCharacterSignatureSpellDraft(c.id, created.spell.id, { expectedVersion: 2, draft: simple(), finalMpCost: 1 }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    await expectCode(updateCharacterSignatureSpellDraft(c.id, created.spell.id, { expectedVersion: 2, draft: { ...simple(), finalMpCost: 1 } }), CHARACTER_ERROR_CODES.INVALID_SIGNATURE_SPELL);
  });

  it("§153 / M6-I091 two simultaneous finalizations for the last Signature slot: exactly one succeeds", { timeout: 300_000 }, async () => {
    const c = await caster("Racer");
    const capacity = (await getCharacterAbilities(c.id)).signature.capacity!;
    expect(capacity).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < capacity; i += 1) await finalized(c.id, simple(`Filler ${String(i)}`));
    const ready = [];
    for (const n of ["A", "B"]) {
      const created = await createCharacterSignatureSpell(c.id, { name: n });
      ready.push(await updateCharacterSignatureSpellDraft(c.id, created.spell.id, { expectedVersion: created.spell.lockVersion, draft: simple(n) }));
    }
    const results = await Promise.allSettled(ready.map((r) => finalizeCharacterSignatureSpell(c.id, r.spell.id, { expectedVersion: r.spell.lockVersion })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failure.reason as DomainError).code, (failure.reason as DomainError).message).toBe(CHARACTER_ERROR_CODES.SIGNATURE_CAPACITY_EXCEEDED);
    expect((await getCharacterAbilities(c.id)).signature.used).toBe(capacity);
  });

  it("§82 the builder read carries the exact Release catalogs with eligibility (no locked component hidden)", { timeout: TIMEOUT }, async () => {
    const c = await caster("Builder");
    const created = await createCharacterSignatureSpell(c.id, { name: "Look" });
    const view = await getSignatureSpellBuilder(c.id, created.spell.id);
    expect(view.catalog.targeting.map((t) => t.ref.entityVersionId)).toContain(world.pins.get("spell.targeting.single_target")!.entityVersionId);
    expect(view.catalog.effects.find((e) => e.ref.canonicalKey === world.pins.get("spell.effect.cleanse")!.canonicalKey)?.eligibility?.status).toBe("INELIGIBLE");
    expect(view.catalog.arcana.rankKey).toBe("TRAINED");
    expect(view.catalog.performanceCondition.present).toBe(false);
    expect(view.names[world.pins.get("spell.targeting.single_target")!.entityVersionId]).toBeDefined();
  });

  it("§149 / M6-I095 a Spell built on Release 1 keeps Effect v1 after Release 2 revises it", { timeout: 600_000 }, async () => {
    const c = await caster("Historian");
    const s = await finalized(c.id, simple("Pinned"));
    const r2 = await publishNextRelease(world, ["fixture.wo10.effect.damage"], "R2", {
      "fixture.wo10.effect.damage": (pins: Map<string, unknown>) => {
        void pins;
        return null;
      },
    });
    expect(r2.pins.get("fixture.wo10.effect.damage")!.entityVersionId).not.toBe(world.pins.get("fixture.wo10.effect.damage")!.entityVersionId);
    const after = await getCharacterSignatureSpell(c.id, s.spell.id);
    expect(after.spell.current!.draft!.effects[0]!.definition.entityVersionId).toBe(world.pins.get("fixture.wo10.effect.damage")!.entityVersionId);
    expect(after.spell.current!.evaluation!.cost).toEqual(s.spell.current!.evaluation!.cost);
    const v = await validateCharacterSignatureSpell(c.id, s.spell.id, {}).catch((e: unknown) => e);
    expect((v as DomainError).code).toBe(CHARACTER_ERROR_CODES.SIGNATURE_SPELL_STATE);
  });
});
