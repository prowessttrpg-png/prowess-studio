/**
 * PAS-10 M6-WO6 — Weapon & Attack Library: HTTP-level integration proof. Every call goes through a REAL route handler
 * against prowess_studio_test; the Release carrying the approved baseline Weapon catalog (content file) is seeded by
 * tests/integration/fixtures/m6-wo3-character-world.ts.
 *
 * Invariants exercised: M6-I064 exact Release-scoped refs · M6-I066 the loadout never mutates Release identity ·
 * M6-I067 two-handed occupies both hands · M6-I069 shield modifiers are derived · M6-I074 previews never spend ·
 * M6-I076 no latest lookup.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Characters from "../../app/api/characters/route";
import * as Creation from "../../app/api/characters/[characterId]/creation/route";
import * as Finalize from "../../app/api/characters/[characterId]/finalize/route";
import * as Sheet from "../../app/api/characters/[characterId]/sheet/route";
import * as Weapons from "../../app/api/characters/[characterId]/weapons/route";
import * as Attacks from "../../app/api/characters/[characterId]/attacks/route";
import * as Loadout from "../../app/api/characters/[characterId]/weapon-loadout/route";
import * as RefWeapons from "../../app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/weapons/route";
import * as RefAttacks from "../../app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/attacks/route";
import { call } from "./m2-api-harness";
import { cleanupCharacterWorlds, seedCharacterWorld, selOf, workedChoices, type CharacterWorld } from "./fixtures/m6-wo3-character-world";

const PREFIX = "test.m6wo6api";
let w: CharacterWorld;
const p = (characterId: string) => ({ characterId });
const W = (key: string) => selOf(w.pins, key);

async function completed(name: string, martial = false) {
  const c = (await call(Characters.POST, "POST", "/api/characters", {}, { name, concept: null, rulesetReleaseId: w.release.id })).data;
  const choices = workedChoices(w.pins);
  const candidate = martial ? { ...choices, skills: choices.skills.map((s, i) => (i === 2 ? { ...s, skill: selOf(w.pins, "skill.martial") } : s)) } : choices;
  const saved = (await call(Creation.PUT, "PUT", "/x", p(c.id), { expectedLockVersion: c.lockVersion, candidate })).data;
  return (await call(Finalize.POST, "POST", "/x", p(c.id), { expectedLockVersion: saved.lockVersion })).data;
}

describe("M6-WO6 Weapon & Attack API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanupCharacterWorlds(PREFIX);
    w = await seedCharacterWorld(PREFIX, "R1", { advancement: true, weapons: true });
  }, 600_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("GET weapons / attacks: empty loadout, Unarmed available, strict query, read-only", async () => {
    const c = await completed("Reader");
    const weapons = await call(Weapons.GET, "GET", "/x", p(c.id));
    expect(weapons.status).toBe(200);
    expect(weapons.data.loadout).toEqual({ version: 0, status: "VALID", issues: [], mainHand: null, offHand: null });
    expect(weapons.data.capability.weaponLibrary.status).toBe("WEAPON_LIBRARY_READY");
    const attacks = await call(Attacks.GET, "GET", "/x", p(c.id));
    expect(attacks.data.library.unarmed.attacks.map((a: { moveKey: string }) => a.moveKey)).toEqual(["BASIC_STRIKE"]);
    expect((await call(Weapons.GET, "GET", "/x?latest=1", p(c.id))).status).toBe(400);
    expect((await call(Attacks.GET, "GET", "/x", p("not-a-uuid"))).status).toBe(400);
    expect(await prisma.characterWeaponLoadout.count({ where: { characterId: c.id } })).toBe(0);
  }, 120_000);

  it("PUT weapon-loadout: equip Long Blade two-handed → previews 2d10 / 2d8 / 2d6; stale → 409; illegal → 422; derived fields → 400", async () => {
    const c = await completed("Equipper");
    const ok = await call(Loadout.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, mainHand: W("weapon.long_blade"), mainHandGrip: "TWO_HANDED", offHand: null });
    expect(ok.status).toBe(200);
    expect(ok.data.loadout).toMatchObject({ version: 1, mainHand: { grip: "TWO_HANDED", power: 6 } });
    const lib = (await call(Attacks.GET, "GET", "/x", p(c.id))).data.library;
    expect(lib.mainHand.attacks.map((a: { moveKey: string; damage: { final: { expression: string } }[] }) => `${a.moveKey} ${a.damage[0]!.final.expression}`)).toEqual(["SLASH 2d10", "STAB 2d8", "BASH 2d6"]);
    expect((await call(Loadout.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, mainHand: null, mainHandGrip: null, offHand: null })).status).toBe(409);
    const illegal = await call(Loadout.PUT, "PUT", "/x", p(c.id), { expectedVersion: 1, mainHand: W("weapon.spear"), mainHandGrip: null, offHand: W("weapon.short_blade") });
    expect([illegal.status, illegal.body.error?.code]).toEqual([422, "CHARACTER.INVALID_LOADOUT"]);
    for (const extra of [{ power: 9 }, { damage: "4d8" }, { armorBonus: 1 }, { attacks: [] }]) expect((await call(Loadout.PUT, "PUT", "/x", p(c.id), { expectedVersion: 1, mainHand: null, mainHandGrip: null, offHand: null, ...extra })).status, JSON.stringify(extra)).toBe(400);
    expect((await call(Weapons.GET, "GET", "/x", p(c.id))).data.loadout.version).toBe(1);
  }, 120_000);

  it("the Sheet reflects the loadout: Shield Armor / Dodge while equipped, Weapon Attack rows, no Dual Wield with a Shield", async () => {
    const c = await completed("Sheet Shield", true);
    const before = (await call(Sheet.GET, "GET", "/x", p(c.id))).data;
    expect(before.equipment).toMatchObject({ available: true, mainHand: null, offHand: null, loadoutVersion: 0 });
    expect(before.weaponAttacks.map((a: { hand: string }) => a.hand)).toEqual(["UNARMED", "UNARMED", "UNARMED"]);
    await call(Loadout.PUT, "PUT", "/x", p(c.id), { expectedVersion: 0, mainHand: W("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: W("weapon.light_shield") });
    const after = (await call(Sheet.GET, "GET", "/x", p(c.id))).data;
    expect(after.mechanics.combat.armor.value - before.mechanics.combat.armor.value).toBe(1);
    expect(after.mechanics.combat.dodge.value - before.mechanics.combat.dodge.value).toBe(1);
    expect(after.weaponAttacks.filter((a: { hand: string }) => a.hand === "MAIN_HAND").map((a: { moveKey: string }) => a.moveKey)).toEqual(["SLASH", "STAB", "BASH"]);
    expect(after.dualWield.available).toBe(false);
    expect(after.names[W("weapon.light_shield").entityVersionId]).toBe("Light Shield");
  }, 120_000);

  it("Rules Reference: the exact Release's Weapon and Attack Libraries; a Release of another Ruleset is refused", async () => {
    const lib = await call(RefWeapons.GET, "GET", "/x", { rulesetId: w.rulesetId, releaseId: w.release.id });
    expect(lib.status).toBe(200);
    expect(lib.data.weapons).toHaveLength(47);
    expect(lib.data.capability.attackLibrary.status).toBe("ATTACK_LIBRARY_READY");
    const attacks = await call(RefAttacks.GET, "GET", "/x", { rulesetId: w.rulesetId, releaseId: w.release.id });
    expect(attacks.data.attacks).toHaveLength(141);
    const other = await seedCharacterWorld(`${PREFIX}.other`, "X1");
    const wrong = await call(RefWeapons.GET, "GET", "/x", { rulesetId: other.rulesetId, releaseId: w.release.id });
    expect([wrong.status, wrong.body.error?.code]).toEqual([404, "COMPENDIUM_REFERENCE.RELEASE_NOT_IN_RULESET"]);
    expect((await call(RefWeapons.GET, "GET", "/x?release=latest", { rulesetId: w.rulesetId, releaseId: w.release.id })).status).toBe(400);
  }, 300_000);
});
