import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCharacterSignatureManeuver,
  createCharacterSignatureSpell,
  finalizeCharacterSignatureManeuver,
  finalizeCharacterSignatureSpell,
  getCharacterAbilities,
  getCharacterActionDirectory,
  getCharacterAttacks,
  getCharacterCardLibrary,
  getCharacterSignatureManeuver,
  prisma,
  retireCharacterSignatureManeuver,
  updateCharacterSignatureManeuverDraft,
  updateCharacterSignatureSpellDraft,
  updateCharacterWeaponLoadout,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, seedCharacterRelease, selOf, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";
import { martialCharacter, maneuverDraft, spellDraft } from "../fixtures/m6-wo8-maneuvers";

/**
 * PAS-10 M6-WO9 Phase B — the read-only Character Card Library and Action Directory services over real PostgreSQL:
 * cards are projected from the existing WO6 / WO7 / WO8 authorities for the Character's exact Release (current, draft,
 * historical and retired revisions; the current loadout), Mage Arts stay UNAVAILABLE, and a read writes nothing.
 */
const PREFIX = "test.m6wo9db";
const TIMEOUT = 300_000;
let world: CharacterReleaseWorld;

async function finalizedManeuver(characterId: string, draft: ReturnType<typeof maneuverDraft>) {
  const row = await createCharacterSignatureManeuver(characterId, { name: draft.concept.name });
  const ready = await updateCharacterSignatureManeuverDraft(characterId, row.maneuver.id, { expectedVersion: row.maneuver.lockVersion, draft });
  return finalizeCharacterSignatureManeuver(characterId, row.maneuver.id, { expectedVersion: ready.maneuver.lockVersion });
}
async function finalizedSpell(characterId: string) {
  const s0 = await createCharacterSignatureSpell(characterId, { name: "Card Spell" });
  const s = await updateCharacterSignatureSpellDraft(characterId, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: spellDraft(world, "Card Spell") });
  return finalizeCharacterSignatureSpell(characterId, s.spell.id, { expectedVersion: s.spell.lockVersion });
}
const counts = async () => [
  await prisma.entity.count(),
  await prisma.entityVersion.count(),
  await prisma.rulesetRelease.count(),
  await prisma.characterSignatureAbility.count(),
  await prisma.characterSignatureSpellRevision.count(),
  await prisma.characterSignatureManeuverRevision.count(),
];

describe("M6-WO9 Character Card Library and Action Directory (read-only services)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R1", { advancement: true, weapons: true, spells: true, maneuvers: true });
  }, 900_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("projects every card family from the existing authorities, for the exact Release, without writing anything", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Card Holder");
    const maneuver = await finalizedManeuver(c.id, maneuverDraft(world, attack));
    const spell = await finalizedSpell(c.id);
    const before = await counts();
    const lockBefore = (await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).lockVersion;
    const lib = await getCharacterCardLibrary(c.id);
    expect(await counts()).toEqual(before);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).lockVersion).toBe(lockBefore);
    expect(lib.contractVersion).toBe(1);
    expect(lib.release.id).toBe(world.release.id);

    // Signature Spell: the M6-WO7 evaluation's own cost, CURRENT revision identity.
    const abilities = await getCharacterAbilities(c.id);
    const spellEntry = lib.spells.find((s) => s.abilityId === spell.spell.id)!;
    const spellCard = spellEntry.current!.card!;
    const summary = abilities.spells.find((s) => s.id === spell.spell.id)!.current!.evaluation!;
    expect(spellCard.provenance.ability).toEqual({ kind: "SPELL", abilityId: spell.spell.id, revisionNumber: 1, revisionRole: "CURRENT" });
    expect(spellCard.costs.mp).toEqual({ status: "AVAILABLE", value: summary.cost!.finalMpCost });
    expect(spellCard.costs.ap).toEqual({ status: "AVAILABLE", value: summary.cost!.finalApCost });
    expect(spellCard.provenance.characterReleaseId).toBe(world.release.id);
    expect(spellCard.name).toBe("Card Spell");

    // Signature Maneuver: the M6-WO8 evaluation's own prices.
    const maneuverCard = lib.maneuvers.find((m) => m.abilityId === maneuver.maneuver.id)!.current!.card!;
    expect(maneuverCard.costs.ap).toEqual({ status: "AVAILABLE", value: maneuver.maneuver.current!.evaluation!.cost!.ap.finalApCost });
    expect(maneuverCard.costs.mp).toEqual({ status: "AVAILABLE", value: maneuver.maneuver.current!.evaluation!.cost!.mp.finalMpCost });

    // Weapons and Attacks: exactly the Attack Library of the current loadout.
    const attacks = await getCharacterAttacks(c.id);
    expect(lib.attacks.map((a) => a.section.attackKey)).toEqual([...(attacks.library.unarmed?.attacks ?? []), ...(attacks.library.mainHand?.attacks ?? [])].map((a) => a.attackKey));
    for (const card of lib.attacks) {
      const a = [...(attacks.library.unarmed?.attacks ?? []), ...(attacks.library.mainHand?.attacks ?? [])].find((x) => x.attackKey === card.section.attackKey)!;
      expect(card.costs.ap).toEqual({ status: "AVAILABLE", value: a.apCost });
      expect(card.section.damage.map((d) => d.final)).toEqual(a.damage.map((d) => d.final?.expression ?? null));
      expect(card.name).toBe(attacks.names[card.section.attack.entityVersionId]);
    }
    expect(lib.weapons.map((w) => w.section.equipped.hand)).toEqual(["UNARMED", "MAIN_HAND"]);
    expect(lib.loadout).toEqual({ version: attacks.loadoutVersion, status: "VALID" });

    // General Actions: every pinned ACTION; nothing invented; no test-free improvement exists in this Release.
    expect(lib.actions.status).toBe("READY");
    expect(lib.actions.cards.length).toBe(13);
    for (const card of lib.actions.cards) {
      expect(card.section.eligibility).toEqual({ status: "NO_REQUIREMENTS" });
      expect(card.section.improvements).toEqual([]);
    }
    // Mage Arts: UNAVAILABLE, no card fabricated.
    expect(lib.mageArts.domain.status).toBe("UNAVAILABLE");
    expect(lib.mageArts.cards).toEqual([]);
  });

  it("retired Abilities are presented as HISTORICAL; earlier revisions remain in history", { timeout: TIMEOUT }, async () => {
    const { character: c, attack } = await martialCharacter(world, "Card Retiree");
    const first = await finalizedManeuver(c.id, maneuverDraft(world, attack));
    const retired = await retireCharacterSignatureManeuver(c.id, first.maneuver.id, { expectedVersion: first.maneuver.lockVersion });
    expect(retired.maneuver.status).toBe("RETIRED");
    const lib = await getCharacterCardLibrary(c.id);
    const entry = lib.maneuvers.find((m) => m.abilityId === first.maneuver.id)!;
    expect(entry.status).toBe("RETIRED");
    expect(entry.current?.card?.provenance.ability?.revisionRole).toBe("HISTORICAL");
    expect(entry.history).toEqual([]);
    expect((await getCharacterSignatureManeuver(c.id, first.maneuver.id)).history).toHaveLength(1);
  });

  it("is loadout-aware: changing the loadout changes the Weapon and Attack cards on the next read", { timeout: TIMEOUT }, async () => {
    const { character: c, loadoutVersion } = await martialCharacter(world, "Card Swapper");
    const one = await getCharacterCardLibrary(c.id);
    await updateCharacterWeaponLoadout(c.id, { expectedVersion: loadoutVersion, mainHand: selOf(world.pins, "weapon.long_blade"), mainHandGrip: "TWO_HANDED", offHand: null });
    const two = await getCharacterCardLibrary(c.id);
    const main = (lib: typeof one) => lib.attacks.filter((a) => a.section.equipped.hand === "MAIN_HAND").map((a) => [a.section.equipped.grip, a.section.damage[0]?.final]);
    expect(main(one).every(([grip]) => grip === "ONE_HANDED")).toBe(true);
    expect(main(two).every(([grip]) => grip === "TWO_HANDED")).toBe(true);
    expect(main(two)).not.toEqual(main(one));
  });

  it("the Action Directory read equals the library's directory and never writes", { timeout: TIMEOUT }, async () => {
    const { character: c } = await martialCharacter(world, "Card Actor");
    const before = await counts();
    const view = await getCharacterActionDirectory(c.id);
    const lib = await getCharacterCardLibrary(c.id);
    expect(await counts()).toEqual(before);
    expect(view.directory).toEqual(lib.actions);
    expect(view.directory.cards.map((card) => card.name)).toEqual(view.directory.cards.map((card) => view.names[card.section.action.entityVersionId] ?? card.section.action.canonicalKey));
  });
});
