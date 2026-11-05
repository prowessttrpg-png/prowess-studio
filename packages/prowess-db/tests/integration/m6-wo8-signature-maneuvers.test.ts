/** Permanent WO8 invariants exercised below: M6-I100 M6-I102 M6-I110 M6-I111 M6-I112 M6-I113 M6-I114 M6-I118 M6-I119 M6-I120 M6-I122. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHARACTER_ERROR_CODES as E, DomainError } from "@prowess/model";
import { createCharacterSignatureManeuver, finalizeCharacterSignatureManeuver, getCharacterSignatureManeuver, getSignatureManeuverBuilder, updateCharacterSignatureManeuverDraft, rebuildCharacterSignatureManeuver, retireCharacterSignatureManeuver, validateCharacterSignatureManeuver, createCharacterSignatureSpell, finalizeCharacterSignatureSpell, updateCharacterSignatureSpellDraft, getCharacterAbilities, getCharacterSignatureSpell, updateCharacterWeaponLoadout, prisma } from "../../src/index";
import { finalizeSignatureManeuver } from "../../src/character/signature-maneuver-repository";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, refOf, seedCharacterRelease, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";
import { martialCharacter, maneuverDraft, spellDraft } from "../fixtures/m6-wo8-maneuvers";

const PREFIX = "test.m6wo8db", TIMEOUT = 300_000;
let world: CharacterReleaseWorld;
const expectCode = async (promise: Promise<unknown>, code: string) => { const error = await promise.then(() => null, e => e); expect(error).toBeInstanceOf(DomainError); expect((error as DomainError).code, String(error)).toBe(code); };
async function ready(characterId: string, draft: ReturnType<typeof maneuverDraft>) { const row = await createCharacterSignatureManeuver(characterId, { name: draft.concept.name }); return updateCharacterSignatureManeuverDraft(characterId, row.maneuver.id, { expectedVersion: row.maneuver.lockVersion, draft }); }
async function finalized(characterId: string, draft: ReturnType<typeof maneuverDraft>) { const row = await ready(characterId, draft); return finalizeCharacterSignatureManeuver(characterId, row.maneuver.id, { expectedVersion: row.maneuver.lockVersion }); }
describe("M6-WO8 Character Maneuvers — real PostgreSQL lifecycle and shared races", () => {
  beforeAll(async () => { assertRunningAgainstTestDatabase(getTestDatabaseUrl()); console.info("WO8 DB fixture cleanup starting"); await cleanupCharacterWorlds(PREFIX); console.info("WO8 DB exact test Release seeding"); world = await seedCharacterRelease(PREFIX, "R1", { advancement: true, weapons: true, spells: true, maneuvers: true }); console.info("WO8 DB exact test Release ready"); }, 900_000);
  afterAll(async () => { await cleanupCharacterWorlds(PREFIX); }, 300_000);
  it("persists incomplete drafts without a slot or canonical content write", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Drafter");
    const before = [await prisma.entity.count(), await prisma.entityVersion.count(), await prisma.rulesetRelease.count()];
    const row = await createCharacterSignatureManeuver(c.id, { name: "Draft" });
    expect(row.maneuver).toMatchObject({ status: "DRAFT", current: null, state: "INCOMPLETE" });
    expect((await getCharacterAbilities(c.id)).signature.used).toBe(0);
    expect([await prisma.entity.count(), await prisma.entityVersion.count(), await prisma.rulesetRelease.count()]).toEqual(before);
    await expectCode(finalizeCharacterSignatureManeuver(c.id, row.maneuver.id, { expectedVersion: 1 }), E.SIGNATURE_MANEUVER_NOT_FINALIZABLE);
  });
  it("finalizes exact WO6 choices into the separate current Maneuver history and reloads server prices", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Finalizer"), row = await finalized(c.id, maneuverDraft(world, attack));
    expect(row.maneuver.current?.evaluation?.state).toMatch(/^VALID/);
    expect(row.maneuver.current?.evaluation?.cost?.ap.finalApCost).toBe(2);
    expect(row.maneuver.current?.evaluation?.cost?.mp.finalMpCost).toBe(5);
    const db = await prisma.characterSignatureAbility.findUniqueOrThrow({ where: { id: row.maneuver.id } });
    expect(db.currentRevisionId).toBeNull(); expect(db.currentManeuverRevisionId).toBe(row.maneuver.current!.revisionId);
    const rev = await prisma.characterSignatureManeuverRevision.findUniqueOrThrow({ where: { id: db.currentManeuverRevisionId! } });
    expect(rev.payload).toEqual(maneuverDraft(world, attack)); expect(rev.characterReleaseId).toBe(world.release.id);
    expect((await getCharacterSignatureManeuver(c.id, row.maneuver.id)).maneuver.current?.draft).toEqual(rev.payload);
  });
  it("preserves the current revision through an invalid rebuild, appends on success, and retires without deleting history", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Rebuilder"), first = await finalized(c.id, maneuverDraft(world, attack));
    const rebuild = await rebuildCharacterSignatureManeuver(c.id, first.maneuver.id, { expectedVersion: first.maneuver.lockVersion });
    const bad = await updateCharacterSignatureManeuverDraft(c.id, first.maneuver.id, { expectedVersion: rebuild.maneuver.lockVersion, draft: { ...maneuverDraft(world, attack), effects: [], effectAttachments: [] } });
    await expectCode(finalizeCharacterSignatureManeuver(c.id, first.maneuver.id, { expectedVersion: bad.maneuver.lockVersion }), E.SIGNATURE_MANEUVER_NOT_FINALIZABLE);
    expect((await getCharacterSignatureManeuver(c.id, first.maneuver.id)).maneuver.current?.revisionId).toBe(first.maneuver.current!.revisionId);
    const fixed = await updateCharacterSignatureManeuverDraft(c.id, first.maneuver.id, { expectedVersion: bad.maneuver.lockVersion, draft: maneuverDraft(world, attack, "Revised") });
    const next = await finalizeCharacterSignatureManeuver(c.id, first.maneuver.id, { expectedVersion: fixed.maneuver.lockVersion });
    expect(next.history).toHaveLength(2);
    const retired = await retireCharacterSignatureManeuver(c.id, first.maneuver.id, { expectedVersion: next.maneuver.lockVersion });
    expect(retired.history).toHaveLength(2); expect(retired.signature.used).toBe(0); expect(retired.maneuver.status).toBe("RETIRED");
  });
  it("enforces header kind, current ownership and append-only histories in PostgreSQL", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Integrity"), row = await finalized(c.id, maneuverDraft(world, attack));
    const other = await createCharacterSignatureManeuver(c.id, { name: "Other" }), id = row.maneuver.current!.revisionId;
    await expect(prisma.characterSignatureManeuverRevision.update({ where: { id }, data: { payload: {} } })).rejects.toThrow(/IMMUTABLE/);
    await expect(prisma.characterSignatureManeuverRevision.delete({ where: { id } })).rejects.toThrow(/IMMUTABLE/);
    await expect(prisma.characterSignatureAbility.update({ where: { id: other.maneuver.id }, data: { currentManeuverRevisionId: id } })).rejects.toThrow();
    await expect(prisma.characterSignatureAbility.update({ where: { id: row.maneuver.id }, data: { abilityKind: "SPELL" } })).rejects.toThrow();
    await expect(prisma.characterSignatureSpellRevision.create({ data: { abilityId: row.maneuver.id, revisionNumber: 1, characterReleaseId: world.release.id, payload: {} } })).rejects.toThrow(/REVISION_KIND/);
    await expectCode(getCharacterSignatureSpell(c.id, row.maneuver.id), E.SIGNATURE_SPELL_NOT_FOUND);
  });
  it("refuses stale CAS, caller prices, cross-kind components and shared targeting overrides", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Strict"), row = await ready(c.id, maneuverDraft(world, attack));
    await expectCode(updateCharacterSignatureManeuverDraft(c.id, row.maneuver.id, { expectedVersion: 1, draft: maneuverDraft(world, attack) }), E.STALE_WRITE);
    await expectCode(validateCharacterSignatureManeuver(c.id, row.maneuver.id, { expectedVersion: 1 }), E.STALE_WRITE);
    for (const draft of [{ ...maneuverDraft(world, attack), apCost: 0 }, { ...maneuverDraft(world, attack), targeting: {} }, { ...maneuverDraft(world, attack), effects: [{ componentKey: "effect", order: 1, definition: refOf(world.pins, "spell.effect.direct_damage"), parameters: {} }] }]) await expectCode(updateCharacterSignatureManeuverDraft(c.id, row.maneuver.id, { expectedVersion: row.maneuver.lockVersion, draft }), E.INVALID_SIGNATURE_MANEUVER);
  });
  it("uses ONE last-slot lock for simultaneous Spell and Maneuver finalization", { timeout: 600_000 }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Cross-kind racer"), capacity = (await getCharacterAbilities(c.id)).signature.capacity!;
    for (let i = 1; i < capacity; i++) await finalized(c.id, maneuverDraft(world, attack, `Filler ${i}`));
    const m = await ready(c.id, maneuverDraft(world, attack, "Maneuver contender"));
    const s0 = await createCharacterSignatureSpell(c.id, { name: "Spell contender" }), s = await updateCharacterSignatureSpellDraft(c.id, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: spellDraft(world) });
    const results = await Promise.allSettled([finalizeCharacterSignatureManeuver(c.id, m.maneuver.id, { expectedVersion: m.maneuver.lockVersion }), finalizeCharacterSignatureSpell(c.id, s.spell.id, { expectedVersion: s.spell.lockVersion })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(r => r.status === "rejected") as PromiseRejectedResult; expect((rejection.reason as DomainError).code).toBe(E.SIGNATURE_CAPACITY_EXCEEDED);
    const all = await getCharacterAbilities(c.id); expect(all.signature.used).toBe(capacity); expect(all.spells.length).toBe(1); expect(all.maneuvers.length).toBe(capacity);
  });
  it("reevaluates equipment availability without substituting or mutating authored Attack identity", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Equipment"), row = await finalized(c.id, maneuverDraft(world, attack));
    await updateCharacterWeaponLoadout(c.id, { expectedVersion: 1, mainHand: null, mainHandGrip: null, offHand: null });
    const changed = await getCharacterSignatureManeuver(c.id, row.maneuver.id);
    expect(changed.maneuver.current?.draft).toEqual(row.maneuver.current?.draft); expect(changed.maneuver.current?.revisionId).toBe(row.maneuver.current?.revisionId);
    expect(changed.maneuver.current?.evaluation?.issues[0]?.code).toBe("SIGNATURE_MANEUVER.ATTACK_UNAVAILABLE");
    const raw = await finalizeSignatureManeuver({ characterId: c.id, abilityId: row.maneuver.id, expected: row.maneuver.lockVersion, characterLockVersion: c.lockVersion, characterReleaseId: world.release.id, weaponLoadoutVersion: 1, decide: () => { throw new Error("stale equipment must fail before evaluation"); } });
    expect(raw.outcome).toBe("character_changed");
  });
  it("builds Master Move → Attack → Block with globally scoped capacities and exact 7 AP / 9 MP base", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Master", true), d = maneuverDraft(world, attack);
    const draft = { ...d, actions: [{ componentKey: "move", order: 1, source: { kind: "FOUNDATION", definition: refOf(world.pins, "fixture.wo11.action.move") } }, { ...d.actions[0]!, order: 2 }, { componentKey: "block", order: 3, source: { kind: "FOUNDATION", definition: refOf(world.pins, "fixture.wo11.action.block") } }], traits: [{ componentKey: "trait", order: 1, definition: refOf(world.pins, "test.wo8.trait.block_addition"), parameters: {}, appliesTo: { scope: "ACTION_SPECIFIC", componentKey: "block" } }] } as ReturnType<typeof maneuverDraft>;
    const row = await finalized(c.id, draft), cost = row.maneuver.current!.evaluation!.cost!;
    expect(cost.ap).toMatchObject({ baseApCost: 7, protectedActionAp: 5, finalApCost: 6 }); expect(cost.mp.finalMpCost).toBe(9);
    const builder = await getSignatureManeuverBuilder(c.id, row.maneuver.id); expect(builder.catalog.martial.maximumActionBlocks).toBe(3);
    expect(builder.catalog.actions.filter(a => a.category === "MOVEMENT").some(a => a.available)).toBe(true);
  });
  it("keeps exact Release 1 component prices after a later Release revises them", { timeout: 600_000 }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Historian"), row = await finalized(c.id, maneuverDraft(world, attack));
    const source = await prisma.entityVersion.findUniqueOrThrow({ where: { id: world.pins.get("test.wo8.effect.enhancement")!.entityVersionId } });
    const data = source.structuredData as { prowessDefinition: { payload: Record<string, unknown> } };
    const revised = { ...data.prowessDefinition.payload, costContributions: [{ contributionKey: "enhancement.ap", currency: "AP", data: { kind: "FIXED", amount: 9 } }, { contributionKey: "enhancement.mp", currency: "MP", data: { kind: "FIXED", amount: 20 } }] };
    const r2 = await publishNextRelease(world, ["test.wo8.effect.enhancement"], "R2", { "test.wo8.effect.enhancement": revised });
    expect(r2.pins.get("test.wo8.effect.enhancement")!.entityVersionId).not.toBe(world.pins.get("test.wo8.effect.enhancement")!.entityVersionId);
    const after = await getCharacterSignatureManeuver(c.id, row.maneuver.id); expect(after.release.id).toBe(world.release.id); expect(after.maneuver.current?.evaluation?.cost?.ap.finalApCost).toBe(row.maneuver.current?.evaluation?.cost?.ap.finalApCost);
    const newer = await martialCharacter(r2, "New Release");
    const changed = await finalized(newer.character.id, maneuverDraft(r2, newer.attack));
    expect(changed.maneuver.current?.evaluation?.cost?.ap.finalApCost).toBe(10);
    expect(changed.maneuver.current?.evaluation?.cost?.mp.finalMpCost).toBe(20);
  });
});
