/**
 * PAS-10 M6-WO6 — Weapon & Attack Library: database integration. Runs only against prowess_studio_test.
 *
 * The approved baseline catalog (content file) is published through the ordinary M1 / M2 services, a Character is
 * built from that exact Release, and its Weapon loadout is equipped, validated and persisted. Invariants exercised
 * (docs/architecture/m6-invariants.md): M6-I064 exact Release-scoped refs · M6-I066 the loadout never mutates Release
 * identity · M6-I067 two-handed occupies both hands · M6-I068 explicit Versatile grip · M6-I069 shield modifiers are
 * derived · M6-I072 Unarmed is derived · M6-I073 no ammunition runtime state · M6-I074 previews never spend ·
 * M6-I076 no latest lookup. Fixture content is `test.m6wo6db.*`.
 */
import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacter,
  getCharacterAttacks,
  getCharacterSheet,
  getCharacterWeapons,
  getReferenceAttackLibrary,
  getReferenceWeaponLibrary,
  prisma,
  saveCharacterCreation,
  updateCharacterSheetNotes,
  updateCharacterWeaponLoadout,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, refOf, seedCharacterRelease, selOf, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";
import { WEAPON_DEFINITIONS, resolveContentRefs } from "../../../prowess-game/src/testing/weapon-fixtures.js";

const PREFIX = "test.m6wo6db";
let world: CharacterReleaseWorld;

async function expectCode(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, String(error)).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  if (message) expect((error as DomainError).message).toMatch(message);
}
/** The worked Character; `martial` swaps the free Arcana Skill for the Release's Martial Skill (Trained). */
async function completed(name: string, w: CharacterReleaseWorld = world, martial = false) {
  const c = await createCharacter({ name, rulesetReleaseId: w.release.id });
  const choices = workedChoices(w.pins);
  const candidate = martial ? { ...choices, skills: choices.skills.map((s, i) => (i === 2 ? { ...s, skill: selOf(w.pins, "skill.martial") } : s)) } : choices;
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate });
  return finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
}
const put = (id: string, body: Record<string, unknown>) => updateCharacterWeaponLoadout(id, body);
const W = (key: string, w: CharacterReleaseWorld = world) => selOf(w.pins, key);
const dice = (a: { damage: readonly { final: { expression: string } | null }[] }) => a.damage.map((d) => d.final?.expression ?? "—").join("|");

describe("M6-WO6 Weapon loadout & Character Attack Library (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R1", { advancement: true, weapons: true });
  }, 600_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("the published Release is Weapon- and Attack-Library ready; an empty loadout reads as None / None with Unarmed available", async () => {
    const c = await completed("Empty Hands");
    const weapons = await getCharacterWeapons(c.id);
    expect(weapons.capability).toEqual({ weaponLibrary: { status: "WEAPON_LIBRARY_READY", missing: [] }, attackLibrary: { status: "ATTACK_LIBRARY_READY", missing: [] } });
    expect(weapons.loadout).toEqual({ version: 0, status: "VALID", issues: [], mainHand: null, offHand: null });
    expect(weapons.options).toHaveLength(43);
    expect(weapons.options.find((o) => o.weapon.canonicalKey === world.pins.get("weapon.light_shield")!.canonicalKey)).toMatchObject({ equippable: false, reasons: ["requires Martial TRAINED (has Martial UNTRAINED)"] });
    expect(weapons.names[world.pins.get("weapon.long_blade")!.entityVersionId]).toBe("Long Blade");
    const attacks = await getCharacterAttacks(c.id);
    expect(attacks.library.martialRank).toBe("UNTRAINED");
    expect(attacks.library.unarmed?.attacks.map((a) => `${a.moveKey} ${dice(a)}`)).toEqual(["BASIC_STRIKE 1d4"]);
    expect([attacks.library.mainHand, attacks.library.offHand]).toEqual([null, null]);
    expect(await prisma.characterWeaponLoadout.count({ where: { characterId: c.id } })).toBe(0);
  }, 120_000);

  it("§165 equip Long Blade two-handed → Slash / Stab / Bash preview at STR 6 → persists exactly → reload", async () => {
    const c = await completed("Blade");
    const after = await put(c.id, { expectedVersion: 0, mainHand: W("weapon.long_blade"), mainHandGrip: "TWO_HANDED", offHand: null });
    expect(after.loadout).toMatchObject({ version: 1, status: "VALID", mainHand: { grip: "TWO_HANDED", occupies: ["MAIN_HAND", "OFF_HAND"], scalingModel: "POWER", power: 6 }, offHand: null });
    const row = await prisma.characterWeaponLoadout.findUniqueOrThrow({ where: { characterId: c.id } });
    expect(row).toMatchObject({ mainHandEntityId: W("weapon.long_blade").entityId, mainHandEntityVersionId: W("weapon.long_blade").entityVersionId, mainHandGrip: "TWO_HANDED", offHandEntityId: null, offHandEntityVersionId: null, lockVersion: 1 });
    const attacks = await getCharacterAttacks(c.id);
    expect(attacks.library.mainHand?.attacks.map((a) => `${a.moveKey} ${dice(a)}`)).toEqual(["SLASH 2d10", "STAB 2d8", "BASH 2d6"]);
    expect(attacks.names[attacks.library.mainHand!.attacks[0]!.attack.entityVersionId]).toBe("Long Blade — Slash");
    expect((await getCharacterWeapons(c.id)).loadout.version).toBe(1);
  }, 120_000);

  it("M6-I071 stale loadout writes are 409 STALE_WRITE — never a silent overwrite", async () => {
    const c = await completed("Stale");
    await put(c.id, { expectedVersion: 0, mainHand: W("weapon.short_blade"), mainHandGrip: null, offHand: null });
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: W("weapon.light_axe"), mainHandGrip: null, offHand: null }), CHARACTER_ERROR_CODES.STALE_WRITE);
    await expectCode(put(c.id, { expectedVersion: 5, mainHand: null, mainHandGrip: null, offHand: null }), CHARACTER_ERROR_CODES.STALE_WRITE);
    const ok = await put(c.id, { expectedVersion: 1, mainHand: null, mainHandGrip: null, offHand: null });
    expect(ok.loadout).toMatchObject({ version: 2, mainHand: null, offHand: null });
  }, 120_000);

  it("strict input: the client never submits Power, damage, Attacks or bonuses; ids must be exact pairs", async () => {
    const c = await completed("Strict");
    for (const extra of [{ power: 9 }, { damage: "4d8" }, { attacks: [] }, { armorBonus: 3 }, { dodgeBonus: 1 }, { roundsLoaded: 6 }]) {
      await expectCode(put(c.id, { expectedVersion: 0, mainHand: null, mainHandGrip: null, offHand: null, ...extra }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    }
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: { entityId: W("weapon.long_blade").entityId }, mainHandGrip: null, offHand: null }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: "Long Blade", mainHandGrip: null, offHand: null }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    await expectCode(put(c.id, { expectedVersion: -1, mainHand: null, mainHandGrip: null, offHand: null }), CHARACTER_ERROR_CODES.INVALID_INPUT);
    expect(await prisma.characterWeaponLoadout.count({ where: { characterId: c.id } })).toBe(0);
  }, 120_000);

  it("illegal loadouts are 422 INVALID_LOADOUT with the reason, and nothing is written", async () => {
    const c = await completed("Illegal");
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: W("weapon.spear"), mainHandGrip: null, offHand: W("weapon.short_blade") }), CHARACTER_ERROR_CODES.INVALID_LOADOUT, /occupies both hands/);
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: W("weapon.long_blade"), mainHandGrip: null, offHand: null }), CHARACTER_ERROR_CODES.INVALID_LOADOUT, /grip is explicit/);
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: null, mainHandGrip: null, offHand: W("weapon.light_shield") }), CHARACTER_ERROR_CODES.INVALID_LOADOUT, /requires Martial TRAINED/);
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: W("weapon.unarmed_master"), mainHandGrip: null, offHand: null }), CHARACTER_ERROR_CODES.INVALID_LOADOUT, /intrinsic/);
    await expectCode(put(c.id, { expectedVersion: 0, mainHand: { entityId: W("weapon.long_blade").entityId, entityVersionId: W("weapon.rifle").entityVersionId }, mainHandGrip: "ONE_HANDED", offHand: null }), CHARACTER_ERROR_CODES.INVALID_LOADOUT, /not a coherent Weapon pinned/);
    expect(await prisma.characterWeaponLoadout.count({ where: { characterId: c.id } })).toBe(0);
  }, 120_000);

  it("M6-I066 equipping never touches the Character row, creation, advancement history, sheet notes or Possessions", async () => {
    const c = await completed("Untouched");
    await updateCharacterSheetNotes(c.id, { expectedVersion: 0, actionNotes: "a", characterNotes: "b", companyPac: null, possessions: [{ category: "Gear", item: "Long Blade (katana)", weight: "3" }] });
    const before = await prisma.character.findUniqueOrThrow({ where: { id: c.id }, include: { statAllocations: true, skillRanks: true, advancements: true } });
    const notes = await prisma.characterSheetNotes.findUniqueOrThrow({ where: { characterId: c.id } });
    await put(c.id, { expectedVersion: 0, mainHand: W("weapon.rifle"), mainHandGrip: null, offHand: null });
    await put(c.id, { expectedVersion: 1, mainHand: W("weapon.handgun"), mainHandGrip: null, offHand: W("weapon.short_blade") });
    expect(await prisma.character.findUniqueOrThrow({ where: { id: c.id }, include: { statAllocations: true, skillRanks: true, advancements: true } })).toEqual(before);
    expect(await prisma.characterSheetNotes.findUniqueOrThrow({ where: { characterId: c.id } })).toEqual(notes);
    expect((await getCharacter(c.id)).release.id).toBe(world.release.id);
  }, 120_000);

  it("§166 / M6-I069 a Light Shield raises the sheet's Armor and Dodge while equipped; removing it restores both — nothing stored", async () => {
    const c = await completed("Shieldbearer", world, true);
    const base = (await getCharacterSheet(c.id)).mechanics.combat;
    await put(c.id, { expectedVersion: 0, mainHand: W("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: W("weapon.light_shield") });
    const sheet = await getCharacterSheet(c.id);
    expect([sheet.mechanics.combat.armor.value! - base.armor.value!, sheet.mechanics.combat.dodge.value! - base.dodge.value!, sheet.mechanics.combat.movement.value! - base.movement.value!]).toEqual([1, 1, 0]);
    expect(sheet.equipment).toMatchObject({ available: true, loadoutVersion: 1, mainHand: { grip: "ONE_HANDED" }, offHand: { equipmentRole: "SHIELD" } });
    expect(sheet.weaponAttacks.filter((a) => a.hand === "OFF_HAND").map((a) => a.moveKey)).toEqual(["SHIELD_BASH", "SHOVE"]);
    expect(sheet.dualWield.available).toBe(false);
    await put(c.id, { expectedVersion: 1, mainHand: W("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null });
    expect((await getCharacterSheet(c.id)).mechanics.combat).toEqual(base);
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(`select column_name from information_schema.columns where table_name = 'character_weapon_loadouts' order by column_name`);
    expect(columns.map((x) => x.column_name)).toEqual(["character_id", "lock_version", "main_hand_entity_id", "main_hand_entity_version_id", "main_hand_grip", "off_hand_entity_id", "off_hand_entity_version_id", "updated_at"]);
  }, 120_000);

  it("§167 the Rifle: static damage, Loading / Reload / Loud as data, Single / Burst / Auto, no Power", async () => {
    const c = await completed("Rifleman");
    await put(c.id, { expectedVersion: 0, mainHand: W("weapon.rifle"), mainHandGrip: null, offHand: null });
    const lib = (await getCharacterAttacks(c.id)).library;
    expect(lib.mainHand?.attacks.map((a) => `${a.moveKey} ${a.apCost} ${dice(a)} ${a.resolution.mode}`)).toEqual(["SINGLE_SHOT 2 1d12 ATTACK_ROLL", "BURST 2 2d12 ATTACK_ROLL", "AUTO_FIRE 3 1d12 SAVING_THROW"]);
    expect(lib.mainHand?.attacks.every((a) => a.damage.every((d) => d.power === null && d.scaling === "STATIC"))).toBe(true);
    const weapons = await getCharacterWeapons(c.id);
    expect(weapons.loadout.mainHand?.properties.map((p) => `${p.traitKey}${JSON.stringify(p.parameters)}`)).toEqual(['AMMO{}', 'LOADING{"capacity":12}', 'RELOAD{"ap":3}', 'LOUD{"radius_feet":200}', "RECOIL{}"]);
  }, 120_000);

  it("§89–§91 / §94 the Rules Reference Weapon Library of the exact Release: 47 profiles, 141 Attacks, names from exact revisions", async () => {
    const lib = await getReferenceWeaponLibrary(world.rulesetId, world.release.id);
    expect([lib.weapons.length, lib.excluded.length, lib.traits.length, lib.issues.length]).toEqual([47, 0, 38, 0]);
    const blade = lib.weapons.find((w) => w.weapon.entityVersionId === W("weapon.long_blade").entityVersionId)!;
    expect(blade).toMatchObject({ displayName: "Long Blade", revisionNumber: 1, payload: { familyKey: "LONG_BLADE", category: "BALANCED", handedness: "VERSATILE", scalingModel: "POWER", power: 6 } });
    expect(blade.moveset.map((a) => [a.displayName, a.payload.apCost, a.scaling])).toEqual([["Long Blade — Slash", 2, "POWER"], ["Long Blade — Stab", 2, "POWER"], ["Long Blade — Bash", 1, "POWER"]]);
    expect(blade.weaponProperties.map((u) => u.displayName)).toEqual(["Reinforced", "Brace"]);
    const attacks = await getReferenceAttackLibrary(world.rulesetId, world.release.id);
    expect(attacks.attacks).toHaveLength(141);
    expect(attacks.attacks.find((a) => a.attack.entityVersionId === W("attack.heavy_shield.bash").entityVersionId)?.weapons.map((w) => w.displayName)).toEqual(["Heavy Shield"]);
    const other = await seedCharacterRelease(`${PREFIX}.other`, "X1", {});
    await expect(getReferenceWeaponLibrary(other.rulesetId, world.release.id)).rejects.toMatchObject({ code: "COMPENDIUM_REFERENCE.RELEASE_NOT_IN_RULESET" });
    const empty = await getReferenceWeaponLibrary(other.rulesetId, other.release.id);
    expect([empty.weapons.length, empty.capability.weaponLibrary.status]).toEqual([0, "NO_WEAPONS"]);
  }, 300_000);

  it("§168 / M6-I076 a Character on Release 1 keeps the exact Release 1 Weapon and Attack after Release 2 revises them", async () => {
    const r1Character = await completed("Old Release");
    await put(r1Character.id, { expectedVersion: 0, mainHand: W("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null });
    const slash = WEAPON_DEFINITIONS.find((d) => d.canonicalKey === "attack.long_blade.slash")!.payload;
    const blade = WEAPON_DEFINITIONS.find((d) => d.canonicalKey === "weapon.long_blade")!.payload;
    const r2 = await publishNextRelease(world, ["attack.long_blade.slash", "weapon.long_blade"], "R2", {
      "attack.long_blade.slash": { ...slash, damageProfiles: [{ profileKey: "slashing", dice: { count: 1, sides: 10 }, damageType: "SLASHING" }] },
      "weapon.long_blade": (pins: Map<string, unknown>) => resolveContentRefs(blade, (k) => refOf(pins as never, k)),
    });
    const old = await getCharacterAttacks(r1Character.id);
    expect(old.release.id).toBe(world.release.id);
    expect(old.library.mainHand?.attacks[0]?.attack.entityVersionId).toBe(world.pins.get("attack.long_blade.slash")!.entityVersionId);
    expect(old.library.mainHand?.attacks[0]?.damage[0]?.base.expression).toBe("1d8");
    const r2Character = await completed("New Release", r2);
    await expectCode(put(r2Character.id, { expectedVersion: 0, mainHand: W("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null }), CHARACTER_ERROR_CODES.INVALID_LOADOUT, /not a coherent Weapon pinned/);
    await put(r2Character.id, { expectedVersion: 0, mainHand: W("weapon.long_blade", r2), mainHandGrip: "ONE_HANDED", offHand: null });
    expect((await getCharacterAttacks(r2Character.id)).library.mainHand?.attacks[0]?.damage[0]?.base.expression).toBe("1d10");
    // The R1 Character cannot equip the R2 revision either (cross-Release).
    await expectCode(put(r1Character.id, { expectedVersion: 1, mainHand: W("weapon.long_blade", r2), mainHandGrip: "ONE_HANDED", offHand: null }), CHARACTER_ERROR_CODES.INVALID_LOADOUT);
  }, 300_000);

  it("database integrity: a half pair, a grip on an empty hand, an unknown grip and a non-positive version are refused by CHECK constraints", async () => {
    const c = await completed("Checks");
    const id = c.id;
    const lb = W("weapon.long_blade");
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "character_weapon_loadouts" ("character_id", "main_hand_entity_id") VALUES ('${id}', '${lb.entityId}')`)).rejects.toThrow(/main_hand_pair_check/);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "character_weapon_loadouts" ("character_id", "main_hand_grip") VALUES ('${id}', 'TWO_HANDED')`)).rejects.toThrow(/grip_check/);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "character_weapon_loadouts" ("character_id", "main_hand_entity_id", "main_hand_entity_version_id", "main_hand_grip") VALUES ('${id}', '${lb.entityId}', '${lb.entityVersionId}', 'THREE_HANDED')`)).rejects.toThrow(/grip_check/);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "character_weapon_loadouts" ("character_id", "lock_version") VALUES ('${id}', 0)`)).rejects.toThrow(/lock_version_check/);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "character_weapon_loadouts" ("character_id", "main_hand_entity_id", "main_hand_entity_version_id") VALUES ('${id}', '${lb.entityId}', '${W("weapon.rifle").entityVersionId}')`)).rejects.toThrow(/main_hand_fkey/);
  }, 120_000);
});
