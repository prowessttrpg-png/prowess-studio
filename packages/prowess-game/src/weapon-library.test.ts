import { describe, expect, it } from "vitest";
import {
  WEAPON_LIBRARY_ERROR_CODES as W,
  WEAPON_LOADOUT_ERROR_CODES as L,
  buildCharacterAttackLibrary,
  buildCharacterMechanicalProfile,
  buildCharacterSheetMechanics,
  equipmentContextOf,
  getWeaponCapability,
  indexWeaponLibrary,
  previewAttackDamage,
  previewDualWieldSequence,
  resolveWeaponLoadout,
  type CharacterAttack,
  type CharacterMechanicalProfile,
  type WeaponLoadoutChoice,
} from "./index";
import { martialProfile, weaponFixture, withStats, type WeaponFixture } from "./testing/weapon-fixtures";

/**
 * PAS-10 M6-WO6 — the Weapon & Attack Library over the approved baseline catalog (content file), the Character
 * Attack Library, damage preview goldens (§149–§154), Unarmed (§156), Shields (§152), loadouts (§155), properties
 * (§163), identity (§157), history (§158) and area Attacks (§162).
 * Invariants: M6-I057 … M6-I074, M6-I076.
 */
/** Profiles are rebuilt by replaying committed advancement (M6-WO4) — heavy on slow CI hosts (see M6-WO4 timeout fix). */
const WEAPON_TEST_TIMEOUT_MS = 30_000;
const f = weaponFixture();
const sel = (key: string) => f.sel(key);
const loadout = (main: string | null, grip: "ONE_HANDED" | "TWO_HANDED" | null = null, off: string | null = null): WeaponLoadoutChoice => ({ mainHand: main === null ? null : sel(main), mainHandGrip: grip, offHand: off === null ? null : sel(off) });
const worked = martialProfile(f, "UNTRAINED");
const lib = (profile: CharacterMechanicalProfile, l: WeaponLoadoutChoice, fixture: WeaponFixture = f) => buildCharacterAttackLibrary({ bundle: fixture.bundle, characterProfile: profile, loadout: l });
const finals = (attacks: readonly CharacterAttack[] | undefined) => (attacks ?? []).map((a) => `${a.moveKey} ${a.damage.map((d) => d.final?.expression ?? d.status).join("|")}`);

describe("Release Library coherence (§15, §95, §97)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  const index = indexWeaponLibrary(f.bundle);

  it("the baseline Release is coherent: 47 Weapon profiles, every Moveset exact and pinned, both capabilities READY", () => {
    expect(index.issues).toEqual([]);
    expect(index.excluded).toEqual([]);
    expect(index.weapons).toHaveLength(47);
    expect(getWeaponCapability(f.bundle, index)).toEqual({ weaponLibrary: { status: "WEAPON_LIBRARY_READY", missing: [] }, attackLibrary: { status: "ATTACK_LIBRARY_READY", missing: [] } });
  });

  it("M6-I057 / M6-I064 every Move is an exact ATTACK pinned in the same Release", () => {
    for (const w of index.weapons) {
      expect(w.attacks.map((a) => a.ref)).toEqual(w.payload.moveset);
      for (const a of w.attacks) expect(f.bundle.definitions.some((d) => d.entityId === a.ref.entityId && d.entityVersionId === a.ref.entityVersionId && d.definitionKind === "ATTACK")).toBe(true);
    }
  });

  it("a Moveset naming an Attack this Release does not pin (cross-Release / unresolved) excludes the Weapon (fail closed)", () => {
    const crossRelease = weaponFixture({ revision: ["attack.long_blade.bash"] });
    // A Weapon payload naming the OTHER revision of Bash than the Release pins:
    const stale = crossRelease.ref("attack.long_blade.bash");
    const drift = weaponFixture({ revise: { "weapon.long_blade": (p) => ({ ...p, moveset: [{ $ref: "attack.long_blade.slash" }, { $ref: "attack.long_blade.stab" }, stale] }) } });
    const i = indexWeaponLibrary(drift.bundle);
    expect(i.issues.map((x) => x.code)).toEqual([W.UNRESOLVED_REFERENCE]);
    expect(i.excluded.map((r) => r.canonicalKey)).toEqual(["weapon.long_blade"]);
  });

  it("an Attack of another family, a repeated move key, a wrong-kind trait rule and HYBRID scaling gaps are each refused", () => {
    const family = weaponFixture({ revise: { "weapon.long_blade": (p) => ({ ...p, moveset: [{ $ref: "attack.long_blade.slash" }, { $ref: "attack.heavy_blade.slash" }] }) } });
    expect(indexWeaponLibrary(family.bundle).issues.map((x) => x.code)).toEqual([W.FAMILY_MISMATCH, W.DUPLICATE_MOVE]);
    const rule = weaponFixture({ revise: { "weapon.long_blade": (p) => ({ ...p, versatileRule: { traitRef: { $ref: "equipment.trait.reach" }, parameters: {} } }) } });
    expect(indexWeaponLibrary(rule.bundle).issues.map((x) => x.code)).toEqual([W.RULE_CONTRACT]);
    const hybrid = weaponFixture({ revise: { "attack.arc_bow.mana_arrow": (p) => ({ ...p, scaling: null }) } });
    expect(indexWeaponLibrary(hybrid.bundle).issues.map((x) => x.code)).toEqual([W.HYBRID_SCALING]);
    const inherited = weaponFixture({ revise: { "attack.long_blade.slash": (p) => ({ ...p, scaling: "STATIC" }) } });
    expect(indexWeaponLibrary(inherited.bundle).issues.map((x) => x.code)).toEqual([W.HYBRID_SCALING]);
  });

  it("Auto is a Saving Throw (never an Attack Roll) and Burst carries its exact Accuracy −2 — enforced against the trait contract", () => {
    const roll = weaponFixture({ revise: { "attack.smg.suppress": (p) => ({ ...p, resolution: { mode: "ATTACK_ROLL", onMiss: "NO_DAMAGE" } }) } });
    expect(indexWeaponLibrary(roll.bundle).issues.map((x) => x.code)).toEqual([W.RESOLUTION_CONTRACT]);
    const inverted = weaponFixture({ revise: { "attack.rifle.auto_fire": (p) => ({ ...p, resolution: { ...(p.resolution as object), onFailure: "HALF", onSuccess: "FULL" } }) } });
    expect(indexWeaponLibrary(inverted.bundle).issues.map((x) => x.code)).toEqual([W.RESOLUTION_CONTRACT]);
    const burst = weaponFixture({ revise: { "attack.rifle.burst": (p) => ({ ...p, accuracyModifier: 0 }) } });
    expect(indexWeaponLibrary(burst.bundle).issues.map((x) => x.code)).toEqual([W.RESOLUTION_CONTRACT]);
  });

  it("a Release with no Weapons is still valid; the capability reports Weapon selection unavailable", () => {
    const bare = weaponFixture();
    const stripped = { ...bare.bundle, definitions: bare.bundle.definitions.filter((d) => !["WEAPON", "ATTACK"].includes(d.definitionKind)) };
    const cap = getWeaponCapability(stripped);
    expect(cap.weaponLibrary.status).toBe("NO_WEAPONS");
    expect(cap.attackLibrary.status).toBe("MISSING_REQUIRED_CONTENT");
    expect(cap.attackLibrary.missing.map((m) => m.requirement)).toEqual(["UNARMED", "UNARMED", "UNARMED", "UNARMED"]);
  });
});

describe("damage preview goldens (§25–§31, §149–§151, M6-I060 … M6-I063)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  it("§149 Long Blade at STR 6, one-handed: Slash 2d8 · Stab 2d6 · Bash 2d4; two-handed: 2d10 · 2d8 · 2d6", () => {
    expect(worked.constructionContext.stats.STR).toBe(6);
    expect(finals(lib(worked, loadout("weapon.long_blade", "ONE_HANDED")).mainHand?.attacks)).toEqual(["SLASH 2d8", "STAB 2d6", "BASH 2d4"]);
    expect(finals(lib(worked, loadout("weapon.long_blade", "TWO_HANDED")).mainHand?.attacks)).toEqual(["SLASH 2d10", "STAB 2d8", "BASH 2d6"]);
  });

  it("§25 Long Blade Slash scales 1d8 / 2d8 / 3d8 at STR 5 / 6 / 12 (multiplier = 1 + floor(STR ÷ Power))", () => {
    for (const [str, expected] of [[5, "1d8"], [6, "2d8"], [12, "3d8"]] as const) {
      const a = lib(withStats(worked, { STR: str }), loadout("weapon.long_blade", "ONE_HANDED")).mainHand?.attacks[0];
      expect(a?.damage[0]?.final?.expression).toBe(expected);
      expect(a?.damage[0]?.power).toMatchObject({ authored: 6, adjusted: 6, minimum: 2, scalingStat: "STR", statScore: str });
    }
  });

  it("§150 / M6-I061 a STATIC firearm never scales: Handgun Single Shot at STR 10 is 1d8, with no Power", () => {
    const a = lib(withStats(worked, { STR: 10 }), loadout("weapon.handgun")).mainHand?.attacks[0];
    expect(a?.damage[0]).toMatchObject({ scaling: "STATIC", final: { expression: "1d8" }, power: null, multiplier: null });
    expect(a?.damage[0]?.steps.map((s) => s.detail)).toContain("Static damage — STR scaling not applied");
  });

  it("§151 / M6-I062 the full base expression repeats: Heavy Blade Slash 2d6 at STR 5 (Power 5) is 4d6", () => {
    const a = lib(withStats(worked, { STR: 5 }), loadout("weapon.heavy_blade")).mainHand?.attacks[0];
    expect(a?.damage[0]).toMatchObject({ base: { expression: "2d6" }, multiplier: 2, final: { expression: "4d6" } });
  });

  it("§27 / M6-I063 Effective Power never falls below the Release's minimum 2 (the M4 multiplier reads max(minimum, Power))", () => {
    const index = indexWeaponLibrary(f.bundle);
    const blade = index.weapons.find((w) => w.ref.canonicalKey === "weapon.long_blade")!;
    const weak = { ...blade, payload: { ...blade.payload, power: 1 } };
    const out = previewAttackDamage({ weapon: weak, attack: blade.attacks[0]!, profile: blade.attacks[0]!.payload.damageProfiles[0]!, grip: "ONE_HANDED", stats: { STR: 6 } });
    expect(out).toMatchObject({ multiplier: 4, final: { expression: "4d8" } });
  });

  it("§31 a multi-die Versatile base fails closed — the step is never guessed", () => {
    const multi = weaponFixture({ revise: { "attack.long_blade.slash": (p) => ({ ...p, damageProfiles: [{ profileKey: "slashing", dice: { count: 2, sides: 6 }, damageType: "SLASHING" }] }) } });
    const a = lib(martialProfile(multi, "UNTRAINED"), loadout("weapon.long_blade", "TWO_HANDED"), multi).mainHand?.attacks[0];
    expect(a?.damage[0]).toMatchObject({ status: "FAIL_CLOSED", final: null });
    expect(a?.damage[0]?.reason).toMatch(/multi-die/);
    // One-handed, the same authored 2d6 still previews normally.
    expect(lib(martialProfile(multi, "UNTRAINED"), loadout("weapon.long_blade", "ONE_HANDED"), multi).mainHand?.attacks[0]?.damage[0]?.final?.expression).toBe("4d6");
  });

  it("§30 the Versatile step precedes Power: two-handed 1d8 → 1d10, then ×2 → 2d10 (never 2d8 stepped to 2d10 after)", () => {
    const d = lib(worked, loadout("weapon.long_blade", "TWO_HANDED")).mainHand?.attacks[0]?.damage[0];
    expect(d?.steps.map((s) => s.step)).toEqual(["BASE", "VERSATILE_STEP", "POWER_MULTIPLIER", "REPEATED_DICE"]);
    expect(d).toMatchObject({ gripAdjusted: { expression: "1d10" }, final: { expression: "2d10" } });
  });

  it("§29 HYBRID Weapons use each Attack's explicit scaling: Arc Bow Power-scaled, Pulse Cannon STATIC", () => {
    expect(lib(worked, loadout("weapon.arc_bow")).mainHand?.attacks.map((a) => a.damage[0]?.scaling)).toEqual(["POWER", "POWER", "POWER"]);
    const pulse = lib(withStats(worked, { STR: 12 }), loadout("weapon.pulse_cannon")).mainHand?.attacks;
    expect(finals(pulse)).toEqual(["PULSE_SHOT 2d8", "OVERCHARGE 3d8", "SHOCK_BURST 2d6"]);
    expect(pulse?.map((a) => a.damage[0]?.power)).toEqual([null, null, null]);
  });

  it("§23 selectable damage profiles are all previewed, never auto-selected (Flexible Quick Lash S / B; Improvised B / P / S)", () => {
    const index = indexWeaponLibrary(f.bundle);
    const lash = index.weapons.find((w) => w.ref.canonicalKey === "weapon.flexible_weapon")!.attacks[0]!;
    expect(lash.payload.damageProfiles.map((d) => d.damageType)).toEqual(["SLASHING", "BLUDGEONING"]);
    const improv = index.weapons.find((w) => w.ref.canonicalKey === "weapon.improvised_heavy")!;
    expect(improv.attacks.map((a) => a.payload.damageProfiles.map((d) => d.damageType).join("/"))).toEqual(["BLUDGEONING/PIERCING/SLASHING", "BLUDGEONING/PIERCING/SLASHING", "BLUDGEONING/PIERCING/SLASHING"]);
    expect(improv.weaponProperties).toEqual([]);
  });

  it("M6-I058 the Move owns its AP: Long Blade Slash 2 / Bash 1; Polearm Thrust 3 / Hook 2 — never from the category", () => {
    const ap = (w: string) => lib(martialProfile(f, "UNTRAINED"), loadout(w)).mainHand?.attacks.map((a) => `${a.moveKey}:${a.apCost}`);
    expect(lib(worked, loadout("weapon.long_blade", "ONE_HANDED")).mainHand?.attacks.map((a) => `${a.moveKey}:${a.apCost}`)).toEqual(["SLASH:2", "STAB:2", "BASH:1"]);
    expect(ap("weapon.polearm")).toEqual(["SLASH:3", "THRUST:3", "HOOK:2", "HAFT_BASH:2"]);
  });
});

describe("ranges, resolution and properties (§19–§20, §32–§38, §162–§163)", () => {
  it("ranges: melee 5 ft, Reach 10 ft, ranged = feet per point × Stat (PER 3 / STR 6), Line / Cone lengths, Blast areas", () => {
    const r = (w: string, i: number, g: "ONE_HANDED" | "TWO_HANDED" | null = null) => lib(worked, loadout(w, g)).mainHand?.attacks[i]?.range;
    expect(r("weapon.long_blade", 0, "ONE_HANDED")).toMatchObject({ mode: "MELEE", reachFeet: 5 });
    expect(r("weapon.spear", 0)).toMatchObject({ mode: "MELEE", reachFeet: 10 });
    expect(r("weapon.staff", 3)).toMatchObject({ mode: "MELEE", reachFeet: 10 });
    expect(r("weapon.staff", 1)).toMatchObject({ mode: "MELEE", reachFeet: 5 });
    expect(r("weapon.rifle", 0)).toMatchObject({ mode: "RANGED_MULTIPLIER", rangeFeet: 120, basis: { stat: "PER", statScore: 3, feetPerPoint: 40 } });
    expect(r("weapon.javelin", 0)).toMatchObject({ mode: "RANGED_MULTIPLIER", rangeFeet: 60, basis: { stat: "STR", statScore: 6 } });
    expect(r("weapon.rifle", 2)).toMatchObject({ mode: "LINE", lengthFeet: 10 });
    expect(r("weapon.shotgun", 2)).toMatchObject({ mode: "CONE", lengthFeet: 15 });
    expect(r("weapon.launcher", 1)).toMatchObject({ mode: "RANGED_MULTIPLIER", area: { shape: "BLAST", radiusFeet: 10 } });
    expect(r("weapon.handgun", 1)).toMatchObject({ mode: "CLOSE", reachFeet: 5 });
  });

  it("§162 SMG Suppress / Rifle Auto Fire are AGI Saving Throws vs the attacker's Character DC (full / half), distinct from Attack Rolls", () => {
    const smg = lib(worked, loadout("weapon.smg")).mainHand?.attacks;
    expect(smg?.map((a) => a.resolution.mode)).toEqual(["ATTACK_ROLL", "ATTACK_ROLL", "SAVING_THROW"]);
    expect(smg?.[2]?.resolution).toEqual({ mode: "SAVING_THROW", savingThrowStat: "AGI", dc: "ATTACKER_CHARACTER_DC", onFailure: "FULL", onSuccess: "HALF" });
    expect(lib(worked, loadout("weapon.rifle")).mainHand?.attacks[2]?.resolution.mode).toBe("SAVING_THROW");
  });

  it("§38 only Scatter Cone authors half damage on a miss; Burst keeps its listed damage with Accuracy −2 (no extra die)", () => {
    const shotgun = lib(worked, loadout("weapon.shotgun")).mainHand?.attacks;
    expect(shotgun?.map((a) => (a.resolution.mode === "ATTACK_ROLL" ? a.resolution.onMiss : null))).toEqual(["NO_DAMAGE", "NO_DAMAGE", "HALF"]);
    const rifle = lib(worked, loadout("weapon.rifle")).mainHand?.attacks;
    expect(rifle?.[1]).toMatchObject({ moveKey: "BURST", accuracyModifier: -2, damage: [{ final: { expression: "2d12" } }] });
    expect(rifle?.[0]?.accuracyModifier).toBe(0);
  });

  it("§163 executable properties carry exact contracts; reference-only properties are preserved and named as not executed", () => {
    const index = indexWeaponLibrary(f.bundle);
    const contract = (key: string) => index.traits.find((t) => t.payload.traitKey === key)?.payload;
    expect(contract("REACH")).toMatchObject({ executionStatus: "EXECUTABLE", contract: { kind: "REACH", reachFeet: 10 } });
    expect(contract("CLOSE")).toMatchObject({ executionStatus: "EXECUTABLE", contract: { kind: "CLOSE_QUARTERS", usableWhileGrappled: true, usableInTightSpaces: true } });
    expect(contract("PIERCE")).toMatchObject({ executionStatus: "EXECUTABLE", contract: { kind: "ARMOR_PIERCE", amountParameter: "amount" } });
    expect(contract("SWEEP")).toMatchObject({ contract: { kind: "POST_HIT_SAVE", savingThrowStats: ["STR", "PRO", "AGI"], dc: "ATTACKER_CHARACTER_DC", onFailure: { kind: "APPLY_CONDITION", conditionKey: "TRIPPED" } } });
    expect(contract("HOOK")).toMatchObject({ contract: { kind: "POST_HIT_SAVE", onFailure: { kind: "PULL", feet: 5, destination: "TOWARD_ATTACKER_OR_ADJACENT" } } });
    expect(contract("VERSATILE")).toMatchObject({ contract: { kind: "DIE_STEP", order: "BEFORE_POWER", multiDie: "FAIL_CLOSED" } });
    for (const key of ["RECOIL", "PRECISION", "LOUD", "AMMO", "LOADING", "RELOAD", "STAGGER", "CLEAVE", "BREACH_STRUCTURE"]) expect(contract(key), key).toMatchObject({ executionStatus: "REFERENCE_ONLY", contract: null });
    const stab = lib(worked, loadout("weapon.long_blade", "ONE_HANDED")).mainHand?.attacks[1];
    expect(stab?.moveProperties.map((u) => [u.traitKey, u.parameters])).toEqual([["PIERCE", { amount: 1 }]]);
    expect(stab?.notExecuted).toEqual(["REINFORCED", "BRACE"]);
  });

  it("M6-I073 Ammo / Loading / Reload / Loud are authored data only; Crossbows are never Loud", () => {
    const props = (w: string) => indexWeaponLibrary(f.bundle).weapons.find((x) => x.ref.canonicalKey === w)!.weaponProperties.map((u) => (Object.keys(u.parameters).length ? `${u.traitKey}${JSON.stringify(u.parameters)}` : u.traitKey));
    expect(props("weapon.rifle")).toEqual(["AMMO", 'LOADING{"capacity":12}', 'RELOAD{"ap":3}', 'LOUD{"radius_feet":200}', "RECOIL"]);
    expect(props("weapon.heavy_machine_gun")).toContain('RECOIL{"amount":2}');
    for (const w of ["weapon.light_crossbow", "weapon.heavy_crossbow"]) expect(props(w).some((p) => p.startsWith("LOUD"))).toBe(false);
  });
});

describe("Unarmed (§56–§59, §156, M6-I072)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  it.each([
    ["UNTRAINED", 8, ["BASIC_STRIKE 1d4"]],
    ["TRAINED", 7, ["LIGHT_STRIKE 1d4", "HEAVY_STRIKE 1d6", "SLAM 1d8"]],
    ["EXPERT", 6, ["LIGHT_STRIKE 2d6", "HEAVY_STRIKE 2d8", "SLAM 2d10"]],
    ["MASTER", 5, ["LIGHT_STRIKE 2d8", "HEAVY_STRIKE 2d10", "SLAM 2d12"]],
  ] as const)("%s Martial: Power %d and its exact Moves (STR 6)", (rank, power, moves) => {
    const l = lib(martialProfile(f, rank), loadout(null));
    expect(l.martialRank).toBe(rank);
    expect(finals(l.unarmed?.attacks)).toEqual(moves);
    expect(l.unarmed?.attacks[0]?.damage[0]?.power?.authored).toBe(power);
    expect(l.unarmed?.attacks.every((a) => a.hand === "UNARMED")).toBe(true);
  });

  it("Expert grants the Grapple rule as reference text (never executed); Master Moves keep Reinforced", () => {
    expect(lib(martialProfile(f, "EXPERT"), loadout(null)).unarmed?.grantedFeatures.map((g) => [g.featureKey, g.executionStatus])).toEqual([["UNARMED_GRAPPLE", "REFERENCE_ONLY"]]);
    expect(lib(martialProfile(f, "MASTER"), loadout(null)).unarmed?.attacks.map((a) => a.moveProperties.map((u) => u.traitKey))).toEqual([["REINFORCED"], ["REINFORCED"], ["REINFORCED"]]);
  });

  it("Unarmed is never equipped in a hand", () => {
    const r = resolveWeaponLoadout({ bundle: f.bundle, profile: worked, loadout: loadout("weapon.unarmed_untrained") });
    expect(r.issues.map((i) => i.code)).toEqual([L.NOT_EQUIPPABLE]);
  });
});

describe("loadouts (§68–§77, §155, M6-I066 … M6-I068)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  const master = martialProfile(f, "MASTER");
  const status = (p: CharacterMechanicalProfile, l: WeaponLoadoutChoice) => {
    const r = resolveWeaponLoadout({ bundle: f.bundle, profile: p, loadout: l });
    return [r.status, ...r.issues.map((i) => i.code)];
  };
  it("one-handed + empty; one-handed + one-handed; Weapon + Shield; two-handed; Versatile one- and two-handed", () => {
    expect(status(worked, loadout("weapon.short_blade"))).toEqual(["VALID"]);
    expect(status(master, loadout("weapon.short_blade", null, "weapon.light_axe"))).toEqual(["VALID"]);
    expect(status(master, loadout("weapon.long_blade", "ONE_HANDED", "weapon.light_shield"))).toEqual(["VALID"]);
    const two = resolveWeaponLoadout({ bundle: f.bundle, profile: worked, loadout: loadout("weapon.spear") });
    expect([two.status, two.mainHand?.grip, two.mainHand?.occupies]).toEqual(["VALID", "TWO_HANDED", ["MAIN_HAND", "OFF_HAND"]]);
    expect(resolveWeaponLoadout({ bundle: f.bundle, profile: worked, loadout: loadout("weapon.long_blade", "ONE_HANDED") }).mainHand?.occupies).toEqual(["MAIN_HAND"]);
    expect(resolveWeaponLoadout({ bundle: f.bundle, profile: worked, loadout: loadout("weapon.long_blade", "TWO_HANDED") }).mainHand?.occupies).toEqual(["MAIN_HAND", "OFF_HAND"]);
  });
  it("M6-I067 / M6-I068 a two-handed Weapon or grip leaves no Off hand; a Versatile grip is explicit; a Two-Handed Weapon is never Off-hand", () => {
    expect(status(master, loadout("weapon.spear", null, "weapon.light_shield"))).toEqual(["INVALID", L.HANDS]);
    expect(status(master, loadout("weapon.long_blade", "TWO_HANDED", "weapon.short_blade"))).toEqual(["INVALID", L.HANDS]);
    expect(status(worked, loadout("weapon.long_blade"))).toEqual(["INVALID", L.GRIP]);
    expect(status(worked, loadout("weapon.spear", "ONE_HANDED"))).toEqual(["INVALID", L.GRIP]);
    expect(status(worked, loadout(null, null, "weapon.spear"))).toEqual(["INVALID", L.HANDS]);
  });
  it("requirements through M4: Shields need their Martial rank (+ STR 5 for Heavy); the Heavy Bow needs STR 4", () => {
    expect(status(worked, loadout(null, null, "weapon.light_shield"))).toEqual(["INVALID", L.REQUIREMENT]);
    expect(status(martialProfile(f, "TRAINED"), loadout(null, null, "weapon.light_shield"))).toEqual(["VALID"]);
    expect(status(martialProfile(f, "EXPERT"), loadout(null, null, "weapon.heavy_shield"))).toEqual(["INVALID", L.REQUIREMENT]);
    expect(status(withStats(master, { STR: 4 }), loadout(null, null, "weapon.heavy_shield"))).toEqual(["INVALID", L.REQUIREMENT]);
    expect(status(master, loadout(null, null, "weapon.heavy_shield"))).toEqual(["VALID"]);
    expect(status(withStats(worked, { STR: 3 }), loadout("weapon.heavy_bow"))).toEqual(["INVALID", L.REQUIREMENT]);
    expect(status(withStats(worked, { STR: 4 }), loadout("weapon.heavy_bow"))).toEqual(["VALID"]);
  });
  it("M6-I064 / M6-I066 a selection must be the exact pair this Release pins — another revision or another Release is refused", () => {
    const r2 = weaponFixture({ revision: ["weapon.long_blade"] });
    expect(status(worked, { mainHand: r2.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null })).toEqual(["INVALID", L.NOT_PINNED]);
    expect(status(worked, { mainHand: { entityId: sel("weapon.long_blade").entityId, entityVersionId: sel("weapon.short_blade").entityVersionId }, mainHandGrip: "ONE_HANDED", offHand: null })).toEqual(["INVALID", L.NOT_PINNED]);
  });
  it("a profile with no authored handedness (Flexible Weapon, Sling, Energy Melee, Improvised) is shown but never equipped by guess", () => {
    for (const w of ["weapon.flexible_weapon", "weapon.sling", "weapon.energy_melee_weapon", "weapon.improvised_light"]) expect(status(worked, loadout(w)), w).toEqual(["INVALID", L.NOT_EQUIPPABLE]);
  });
});

describe("Shields feed the ONE profile (§61–§67, §152, M6-I069)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  const master = martialProfile(f, "MASTER");
  const sheet = (p: CharacterMechanicalProfile) => buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile: p }).combat;

  it("§152 Heavy Shield: Armor +3, Dodge −1, Movement −5 while equipped; unequipped, the profile is byte-identical to before", () => {
    const r = resolveWeaponLoadout({ bundle: f.bundle, profile: master, loadout: loadout(null, null, "weapon.heavy_shield") });
    const equipped = martialProfile(f, "MASTER", equipmentContextOf(r));
    const before = sheet(master);
    const after = sheet(equipped);
    expect([after.armor.value! - before.armor.value!, after.dodge.value! - before.dodge.value!, after.movement.value! - before.movement.value!]).toEqual([3, -1, -5]);
    expect(equipped.equipment?.armor).toMatchObject({ base: before.armor.value, total: before.armor.value! + 3 });
    const removed = martialProfile(f, "MASTER", equipmentContextOf(resolveWeaponLoadout({ bundle: f.bundle, profile: master, loadout: loadout(null) })));
    expect(JSON.stringify(removed)).toBe(JSON.stringify(master));
    expect("equipment" in master).toBe(false);
  });

  it("Light Shield: Armor +1 and Dodge +1; a Weapon with no modifiers changes no derived value", () => {
    const trained = martialProfile(f, "TRAINED");
    const shield = martialProfile(f, "TRAINED", equipmentContextOf(resolveWeaponLoadout({ bundle: f.bundle, profile: trained, loadout: loadout("weapon.long_blade", "ONE_HANDED", "weapon.light_shield") })));
    expect([sheet(shield).armor.value! - sheet(trained).armor.value!, sheet(shield).dodge.value! - sheet(trained).dodge.value!, sheet(shield).movement.value! - sheet(trained).movement.value!]).toEqual([1, 1, 0]);
    const blade = martialProfile(f, "TRAINED", equipmentContextOf(resolveWeaponLoadout({ bundle: f.bundle, profile: trained, loadout: loadout("weapon.long_blade", "ONE_HANDED") })));
    expect(blade.derivedStatistics).toEqual(trained.derivedStatistics);
  });

  it("the equipment bonuses are named, sourced explicit bonuses — never stored totals", () => {
    const equipped = martialProfile(f, "MASTER", equipmentContextOf(resolveWeaponLoadout({ bundle: f.bundle, profile: master, loadout: loadout(null, null, "weapon.heavy_shield") })));
    expect(equipped.equipment?.explicitBonuses.map((b) => [b.bonusKey, b.appliesTo, b.value, b.category, b.sourceKey])).toEqual([
      ["equipment_off_hand_shield_dodge", "DODGE", -1, "EQUIPMENT", "weapon.heavy_shield"],
      ["equipment_off_hand_shield_movement", "MOVEMENT", -5, "EQUIPMENT", "weapon.heavy_shield"],
    ]);
  });
});

describe("Dual Wield (§50–§55, §153–§154, M6-I070 … M6-I071)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  const trained = martialProfile(f, "TRAINED");
  const expert = martialProfile(f, "EXPERT");
  it("§153 Short Blade Stab (1 AP) + Long Blade Bash (1 AP) → 1 AP; two separate exact Attacks; Power per category", () => {
    const l = lib(expert, loadout("weapon.long_blade", "ONE_HANDED", "weapon.short_blade"));
    expect(l.dualWield.available).toBe(true);
    const seq = l.dualWield.sequences.find((s) => s.attacks[0].moveKey === "BASH" && s.attacks[1].moveKey === "STAB")!;
    expect(seq).toMatchObject({ apCost: 1, powerfulBlow: false, sequenceIndex: 0 });
    expect(seq.attacks[0].attack).not.toEqual(seq.attacks[1].attack);
    expect(seq.attacks.map((a) => a.damage[0]?.power?.adjusted)).toEqual([8, 8]); // Balanced 6 + 2, Light 7 + 1
  });
  it("§154 mixed AP: Short Blade Slash (1) + Long Blade Slash (2) → 2 AP, never 3", () => {
    const l = lib(expert, loadout("weapon.long_blade", "ONE_HANDED", "weapon.short_blade"));
    expect(l.dualWield.sequences.find((s) => s.attacks[0].moveKey === "SLASH" && s.attacks[1].moveKey === "SLASH")?.apCost).toBe(2);
  });
  it("§52 each additional sequence adds +1 cumulative Power when given an explicit index", () => {
    const l = lib(expert, loadout("weapon.long_blade", "ONE_HANDED", "weapon.short_blade"));
    const [a, b] = [l.mainHand!.attacks[0]!, l.offHand!.attacks[0]!];
    const third = previewDualWieldSequence({ bundle: f.bundle, profile: expert, loadout: l.loadout, mainAttack: a.attack, offAttack: b.attack, sequenceIndex: 2 });
    expect(third?.attacks.map((x) => x.damage[0]?.power?.adjusted)).toEqual([10, 10]);
  });
  it("requirements per category: Light needs Trained; Balanced needs Expert and STR 5", () => {
    expect(lib(trained, loadout("weapon.short_blade", null, "weapon.light_axe")).dualWield.available).toBe(true);
    const balanced = lib(trained, loadout("weapon.long_blade", "ONE_HANDED", "weapon.short_blade")).dualWield;
    expect(balanced.available).toBe(false);
    expect(balanced.reasons.join(" ")).toMatch(/Martial EXPERT/);
    expect(lib(withStats(expert, { STR: 4 }), loadout("weapon.long_blade", "ONE_HANDED", "weapon.short_blade")).dualWield.reasons.join(" ")).toMatch(/STR 5/);
  });
  it("§61 / §75 a Shield + Weapon is never Dual Wielding", () => {
    const l = lib(trained, loadout("weapon.short_blade", null, "weapon.light_shield"));
    expect(l.loadout.status).toBe("VALID");
    expect(l.dualWield.available).toBe(false);
    expect(l.dualWield.sequences).toEqual([]);
    expect(l.offHand?.attacks.map((a) => a.moveKey)).toEqual(["SHIELD_BASH", "SHOVE"]);
  });
  it("§53 a STATIC Weapon's damage is untouched by the Dual Wield Power adjustment", () => {
    const l = lib(trained, loadout("weapon.short_blade", null, "weapon.handgun"));
    const seq = l.dualWield.sequences[0]!;
    expect(seq.attacks[1].damage[0]).toMatchObject({ scaling: "STATIC", power: null, final: { expression: "1d8" } });
    expect(l.dualWield.hands.map((h) => h.powerAdjustmentApplies)).toEqual([true, false]);
  });
});

describe("identity, history and purity (§13, §96, §157–§158, M6-I065, M6-I074, M6-I076)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  it("§157 Long Blade Bash ≠ Heavy Shield Bash: same move key, different exact Attacks", () => {
    const master = martialProfile(f, "MASTER");
    const l = lib(master, loadout("weapon.long_blade", "ONE_HANDED", "weapon.heavy_shield"));
    const a = l.mainHand!.attacks.find((x) => x.moveKey === "BASH")!;
    const b = l.offHand!.attacks.find((x) => x.moveKey === "BASH")!;
    expect(a.attack.entityId).not.toBe(b.attack.entityId);
    expect(a.attackKey).not.toBe(b.attackKey);
    expect(a.damage[0]?.base.expression).toBe("1d4");
    expect(b.damage[0]?.base.expression).toBe("1d8");
  });
  it("§158 a Character on Release 1 keeps Long Blade Slash v1 when Release 2 revises it", () => {
    const r2 = weaponFixture({ revision: ["attack.long_blade.slash", "weapon.long_blade"], revise: { "attack.long_blade.slash": (p) => ({ ...p, damageProfiles: [{ profileKey: "slashing", dice: { count: 1, sides: 10 }, damageType: "SLASHING" }] }) } });
    const p2 = martialProfile(r2, "UNTRAINED");
    expect(lib(worked, loadout("weapon.long_blade", "ONE_HANDED")).mainHand?.attacks[0]?.damage[0]?.base.expression).toBe("1d8");
    expect(lib(p2, { mainHand: r2.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null }, r2).mainHand?.attacks[0]?.damage[0]?.base.expression).toBe("1d10");
    expect(r2.ref("attack.long_blade.slash").entityVersionId).not.toBe(f.ref("attack.long_blade.slash").entityVersionId);
  });
  it("M6-I074 the Library is pure: deterministic, deep-frozen, JSON-safe, inputs untouched, nothing spent or rolled", () => {
    const before = JSON.stringify(worked);
    const a = lib(worked, loadout("weapon.rifle"));
    const b = lib(worked, loadout("weapon.rifle"));
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(JSON.stringify(worked)).toBe(before);
    expect(JSON.stringify(a)).not.toMatch(/"rolls"|"spent"|"remaining"|"hp"/i);
  });
  it("an invalid loadout yields no hand Attacks but Unarmed stays available", () => {
    const l = lib(worked, loadout("weapon.spear", null, "weapon.short_blade"));
    expect(l.loadout.status).toBe("INVALID");
    expect([l.mainHand, l.offHand]).toEqual([null, null]);
    expect(l.unarmed?.attacks).toHaveLength(1);
  });
});

describe("profile without equipment is unchanged (§67)", () => {
  it("the M6-WO4 builder called without equipment returns exactly what it returned before WO6", () => {
    const plain = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level: 1, history: [] } });
    const nullCtx = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation: f.creation, level: 1, history: [] }, equipment: null });
    expect(JSON.stringify(nullCtx)).toBe(JSON.stringify(plain));
    expect(Object.keys(plain.profile!)).not.toContain("equipment");
  });
});
