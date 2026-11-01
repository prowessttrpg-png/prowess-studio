import { describe, expect, it } from "vitest";
import {
  WEAPON_BRIDGE_ERROR_CODES as B,
  bindWeaponAttackToManeuver,
  buildCharacterAttackLibrary,
  indexWeaponLibrary,
  type CharacterAttack,
  type CharacterMechanicalProfile,
  type WeaponAttackBinding,
} from "./index";
import { compileManeuverCost } from "./ability/maneuver-cost.js";
import { AUTHORED_ABILITY_ERROR_CODES as A, readFoundationProfile } from "./definition/authored-ability-payload.js";
import { Problems } from "./internal/problems.js";
import { maneuverCostFixture, runManeuverCost } from "./testing/maneuver-cost-fixtures.js";
import { martialProfile, weaponFixture, withStats } from "./testing/weapon-fixtures";

/**
 * PAS-10 M6-WO6 §83–§85, §159–§161 — the ONE adapter from a Character Weapon Attack to the exact M5-WO11 Attack
 * contract, validated by M5's own readers, and Powerful Blow unchanged (M5-WO11 compiles the bridged foundations).
 * Invariants: M6-I070 · M6-I071 · M6-I075.
 */
const WEAPON_TEST_TIMEOUT_MS = 30_000;
const f = weaponFixture();
const index = indexWeaponLibrary(f.bundle);
const M = maneuverCostFixture();
const targeting = { componentKey: "targeting", definition: M.ref("maneuver.targeting.single_target"), parameters: {} };
const master = martialProfile(f, "MASTER");
const attacksOf = (profile: CharacterMechanicalProfile, main: string, grip: "ONE_HANDED" | "TWO_HANDED" | null = null, off: string | null = null) => {
  const l = buildCharacterAttackLibrary({ bundle: f.bundle, characterProfile: profile, loadout: { mainHand: f.sel(main), mainHandGrip: grip, offHand: off === null ? null : f.sel(off) } });
  return { main: l.mainHand?.attacks ?? [], off: l.offHand?.attacks ?? [] };
};
const bind = (attack: CharacterAttack, profileKey?: string) => bindWeaponAttackToManeuver({ index, attack, damageProfileKey: profileKey ?? (attack.damage[0]?.profileKey as string), targeting });
const ok = (attack: CharacterAttack): WeaponAttackBinding => {
  const out = bind(attack);
  if (!out.ok) throw new Error(JSON.stringify(out.problems));
  return out.value;
};

describe("M5-WO11 Attack bridge (§83–§85, §159, §161, M6-I075)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  it("§159 Long Blade Stab keeps its exact Weapon + Attack, 2 AP, 1d6 Piercing base, Power 6, Pierce 1 and provenance", () => {
    const stab = attacksOf(master, "weapon.long_blade", "ONE_HANDED").main.find((a) => a.moveKey === "STAB")!;
    const b = ok(stab);
    expect(b.weapon).toEqual(f.ref("weapon.long_blade"));
    expect(b.attack).toEqual(f.ref("attack.long_blade.stab"));
    expect([b.apCost, b.mpCost, b.scaling, b.power]).toEqual([2, 0, "POWER", 6]);
    expect(b.damageProfile).toEqual({ profileKey: "piercing", damageType: "PIERCING", base: "1d6", rolled: "1d6" });
    expect(b.moveProperties.map((u) => [u.traitKey, u.parameters])).toEqual([["PIERCE", { amount: 1 }]]);
    expect(b.provenance).toEqual({ rulesetId: f.bundle.rulesetProvenance.rulesetId, manifestId: f.bundle.rulesetProvenance.manifestId, releaseId: null });
    expect(b.foundation).toEqual({ category: "MELEE", targeting, range: { kind: "WEAPON_RANGE", feet: 5 }, resolution: { mode: "ATTACK_ROLL", stat: "PER" }, damage: { kind: "WEAPON", weaponKey: "weapon.long_blade", baseDice: "1d6", power: 6, stat: "STR", enchantments: [] } });
    expect((b.foundationPayload as { costContributions: unknown[] }).costContributions).toEqual([{ contributionKey: "foundation.ap", currency: "AP", data: { kind: "FIXED", amount: 2 } }]);
  });

  it("§161 Rifle Single Shot keeps STATIC damage — no Power, no scaling Stat — its range, Pierce and requirements; STR never scales it", () => {
    for (const str of [6, 12]) {
      const shot = attacksOf(withStats(master, { STR: str }), "weapon.rifle").main[0]!;
      const b = ok(shot);
      expect(b.scaling).toBe("STATIC");
      expect(b.power).toBeNull();
      expect(b.foundation.damage).toEqual({ kind: "WEAPON", scaling: "STATIC", weaponKey: "weapon.rifle", baseDice: "1d12", power: null, stat: null, enchantments: [] });
      expect(b.foundation.range.feet).toBe(shot.range.rangeFeet);
      expect(shot.range.basis).toMatchObject({ stat: "PER", feetPerPoint: 40 });
      expect(b.moveProperties.map((u) => u.traitKey)).toEqual(["PIERCE"]);
      expect(b.apCost).toBe(2);
    }
  });

  it("the bridged STATIC foundation is a valid M5 foundation; M5 still refuses a STATIC shape with a fake Power or Stat", () => {
    const b = ok(attacksOf(master, "weapon.rifle").main[0]!);
    const p = new Problems();
    expect(readFoundationProfile({ attack: b.rulesAttack }, [], p)).not.toBeNull();
    for (const fake of [{ power: 0 }, { stat: "STR" }, { scaling: "DYNAMIC" }]) {
      const q = new Problems();
      const damage = { ...(b.rulesAttack as { damage: object }).damage, ...fake };
      expect(readFoundationProfile({ attack: { ...b.rulesAttack, damage } }, [], q), JSON.stringify(fake)).toBeNull();
      expect(q.list.map((x) => x.code)).toContain(A.FOUNDATION);
    }
  });

  it("Saving Throw (Auto), area (Line / Cone) and deferred-resolution Attacks are refused with a structured reason — never coerced", () => {
    const smg = attacksOf(master, "weapon.smg").main;
    const cone = attacksOf(master, "weapon.shotgun").main[2]!;
    const pulse = attacksOf(master, "weapon.pulse_cannon").main[2]!;
    for (const a of [smg[2]!, cone, pulse]) {
      const out = bind(a);
      expect(out.ok, a.moveKey).toBe(false);
      if (!out.ok) expect(out.problems.map((x) => x.code)).toEqual([B.NOT_REPRESENTABLE]);
    }
    expect(bind(smg[0]!).ok).toBe(true);
    const unknown = bind(smg[0]!, "fire");
    expect(unknown.ok ? [] : unknown.problems.map((x) => x.code)).toEqual([B.UNKNOWN_PROFILE]);
  });

  it("a two-handed Versatile grip binds the stepped die it actually rolls, and keeps the authored base", () => {
    const slash = attacksOf(master, "weapon.long_blade", "TWO_HANDED").main[0]!;
    expect(ok(slash).damageProfile).toMatchObject({ base: "1d8", rolled: "1d10" });
    expect(ok(slash).foundation.damage.baseDice).toBe("1d10");
  });

  it("a Dual Wield Attack binds with its adjusted Power and its own AP — each Weapon keeps its own binding (M6-I070)", () => {
    const l = buildCharacterAttackLibrary({ bundle: f.bundle, characterProfile: master, loadout: { mainHand: f.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: f.sel("weapon.short_blade") } });
    const seq = l.dualWield.sequences.find((s) => s.attacks[0].moveKey === "SLASH" && s.attacks[1].moveKey === "STAB")!;
    const [a, b] = seq.attacks.map(ok);
    expect([a!.attack, b!.attack]).toEqual([f.ref("attack.long_blade.slash"), f.ref("attack.short_blade.stab")]);
    expect([a!.power, b!.power, a!.apCost, b!.apCost]).toEqual([8, 8, 2, 1]);
  });
});

describe("Powerful Blow stays M5-WO11 (§55, §160, M6-I071)", { timeout: WEAPON_TEST_TIMEOUT_MS }, () => {
  const bladeAttacks = attacksOf(master, "weapon.long_blade", "ONE_HANDED", "weapon.heavy_shield");
  const slash = ok(bladeAttacks.main.find((a) => a.moveKey === "SLASH")!);
  const stab = ok(bladeAttacks.main.find((a) => a.moveKey === "STAB")!);
  const bladeBash = ok(bladeAttacks.main.find((a) => a.moveKey === "BASH")!);
  const shieldBash = ok(bladeAttacks.off.find((a) => a.moveKey === "BASH")!);
  const rifle = ok(attacksOf(master, "weapon.rifle").main[0]!);
  // The M5-WO11 reference fixture with its foundations authored FROM the bridge (each its own exact foundation Definition).
  const G = maneuverCostFixture({
    revise: {
      "fixture.wo11.attack.longsword": slash.foundationPayload as Record<string, unknown>,
      "fixture.wo11.attack.shield_bash": stab.foundationPayload as Record<string, unknown>,
      "fixture.wo11.attack.light": bladeBash.foundationPayload as Record<string, unknown>,
      "fixture.wo11.attack.heavy": shieldBash.foundationPayload as Record<string, unknown>,
      "fixture.wo11.attack.unpriced": rifle.foundationPayload as Record<string, unknown>,
    },
    maneuvers: {
      "fixture.wo6.pb.same": { actions: [["attack1", "attack.longsword"], ["attack2", "attack.longsword"]], effects: [["effect1", "push", ["attack1", "attack2"]]], powerfulBlow: ["attack1", "attack2"] },
      "fixture.wo6.pb.slash_stab": { actions: [["attack1", "attack.longsword"], ["attack2", "attack.shield_bash"]], effects: [["effect1", "push", ["attack1", "attack2"]]], powerfulBlow: ["attack1", "attack2"] },
      "fixture.wo6.pb.bash_bash": { actions: [["attack1", "attack.light"], ["attack2", "attack.heavy"]], effects: [["effect1", "push", ["attack1", "attack2"]]], powerfulBlow: ["attack1", "attack2"] },
      "fixture.wo6.static": { actions: [["attack1", "attack.unpriced"]], effects: [["effect1", "push", ["attack1"]]] },
    },
  });
  const problems = (key: string) => {
    const r = compileManeuverCost(G.request(key));
    return r.ok ? [] : r.problems.map((q) => q.code);
  };

  it("two uses of the SAME exact Long Blade Slash form a Powerful Blow (one resolution, the Move's own 2 AP each)", () => {
    const run = runManeuverCost(G.request("fixture.wo6.pb.same") as Record<string, unknown>);
    const group = run.plan.structure.resolutionGroups.find((g) => g.kind === "POWERFUL_BLOW")!;
    expect(group.repetitions).toBe(2);
    expect(group.inheritedRequirements).toEqual([{ kind: "WEAPON", weaponKey: "weapon.long_blade", attack: G.ref("fixture.wo11.attack.longsword"), grantsConditionDiscount: false, consumesConditionSlot: false, status: "REQUIREMENT_CONTRACT_ONLY" }]);
    expect(run.plan.structure.separateAttackResolutions).toBe(1);
  });

  it("Long Blade Slash + Long Blade Stab cannot; Long Blade Bash + Heavy Shield Bash (same display name) cannot", () => {
    expect(problems("fixture.wo6.pb.slash_stab")).toContain(A.FOUNDATION);
    expect(problems("fixture.wo6.pb.bash_bash")).toContain(A.FOUNDATION);
  });

  it("a STATIC bridged foundation compiles in M5 unchanged: its Move AP prices it and no Power is invented", () => {
    const run = runManeuverCost(G.request("fixture.wo6.static") as Record<string, unknown>);
    const foundation = run.result.ap.contributions.find((c) => c.source === "FOUNDATION") as unknown as Record<string, unknown>;
    expect(foundation.definition).toEqual(G.ref("fixture.wo11.attack.unpriced"));
    expect(foundation.value).toBe(2);
    expect(run.result.ap.baseApCost).toBe(3); // the Rifle Move's own 2 AP + the reference push Effect's 1 AP
    expect(JSON.stringify(run.plan)).not.toMatch(/"power":\s*[0-9]/);
  });
});
