import { describe, expect, it } from "vitest";
import { indexWeaponLibrary, type AttackEntry, type ResolvedTraitUse, type WeaponEntry } from "./index";
import { WEAPON_CONTENT, weaponFixture } from "./testing/weapon-fixtures";

/**
 * PAS-10 M6-WO6 §185–§186 — the approved baseline catalog is complete and exact. The expected table below is an
 * INDEPENDENT transcription of the Work Order (§57, §62–§64, §99–§137): it is never generated from the content file, so a
 * changed, missing, extra or silently replaced Weapon / Attack / value fails here.
 *
 * Encoding — Weapon: `CATEGORY HANDEDNESS SCALING POWER | properties`. Attack: `MOVE AP[+MP] dice:types range [extras]`
 * where range is M<reach> (melee), C<reach> (Close), R:<Stat>:<feet per point>[:B<blast>], L<length> (Line), K<length>
 * (Cone); extras are Move properties (KEY or KEY=value), SAVE (AGI Saving Throw), MISS=HALF, DEFERRED, ACC<n> and, for
 * HYBRID Weapons, ~POWER / ~STATIC.
 */
type Expected = readonly [key: string, weapon: string, properties: string, attacks: readonly string[]];
const EXPECTED: readonly Expected[] = [
  ["unarmed_untrained", "- - POWER 8", "", ["BASIC_STRIKE 1 1d4:B M5 CLOSE"]],
  ["unarmed_trained", "- - POWER 7", "", ["LIGHT_STRIKE 1 1d4:B M5", "HEAVY_STRIKE 2 1d6:B M5", "SLAM 3 1d8:B M5"]],
  ["unarmed_expert", "- - POWER 6", "", ["LIGHT_STRIKE 1 1d6:B M5", "HEAVY_STRIKE 2 1d8:B M5", "SLAM 3 1d10:B M5"]],
  ["unarmed_master", "- - POWER 5", "", ["LIGHT_STRIKE 1 1d8:B M5 REINFORCED", "HEAVY_STRIKE 2 1d10:B M5 REINFORCED", "SLAM 3 1d12:B M5 REINFORCED"]],
  ["light_shield", "LIGHT ONE_HANDED POWER 7", "", ["SHIELD_BASH 1 1d4:B M5 CLOSE", "SHOVE 1 1d4:B M5 PUSH"]],
  ["balanced_shield", "BALANCED ONE_HANDED POWER 6", "", ["SHIELD_BASH 2 1d6:B M5", "SHOVE 2 1d4:B M5 PUSH", "SHIELD_SLAM 2 1d8:B M5"]],
  ["heavy_shield", "HEAVY ONE_HANDED POWER 5", "", ["BASH 2 1d8:B M5", "SLAM 3 1d10:B M5 STAGGER", "SHIELD_RUSH 3 1d8:B M5 PUSH"]],
  ["short_blade", "LIGHT ONE_HANDED POWER 7", "CONCEALABLE SILENT CLOSE THROWN", ["STAB 1 1d4:P M5", "SLASH 1 1d4:S M5", "THROW 1 1d4:P M5 THROWN"]],
  ["short_sword", "LIGHT VERSATILE POWER 7", "CONCEALABLE", ["SLASH 1 1d4:S M5", "STAB 1 1d6:P M5", "GUARD_BASH 1 1d4:B M5 CLOSE"]],
  ["light_axe", "LIGHT ONE_HANDED POWER 7", "THROWN", ["CHOP 1 1d6:S M5", "THROW 1 1d6:S M5 THROWN", "HOOK 1 1d4:S M5 HOOK"]],
  ["long_blade", "BALANCED VERSATILE POWER 6", "REINFORCED BRACE", ["SLASH 2 1d8:S M5", "STAB 2 1d6:P M5 PIERCE=1", "BASH 1 1d4:B M5 CLOSE"]],
  ["blunt_weapon", "BALANCED ONE_HANDED POWER 6", "REINFORCED", ["BASH 2 1d8:B M5", "CRUSH 2 1d10:B M5 STAGGER", "QUICK_STRIKE 1 1d4:B M5 CLOSE"]],
  ["battle_axe", "BALANCED ONE_HANDED POWER 6", "CLEAVE", ["CHOP 2 1d8:S M5", "CLEAVE 2 1d6:S M5 CLEAVE", "HOOK 1 1d4:S M5 HOOK"]],
  ["staff", "BALANCED TWO_HANDED POWER 6", "REINFORCED BRACE", ["QUICK_STRIKE 1 1d4:B M5 CLOSE", "STAFF_STRIKE 2 1d8:B M5", "SWEEP 2 1d6:B M5 SWEEP", "THRUST 2 1d6:B M5 REACH"]],
  ["flexible_weapon", "BALANCED - POWER 6", "FLEXIBLE REACH", ["QUICK_LASH 1 1d4:S/B M5", "LASH 2 1d6:S/B M5 REACH", "WRAP 2 1d4:B M5 HOOK", "SWEEPING_LASH 2 1d6:B M5 SWEEP"]],
  ["flail", "BALANCED ONE_HANDED POWER 6", "", ["QUICK_STRIKE 1 1d4:B M5 CLOSE", "SWING 2 1d8:B M5", "CRUSH 2 1d10:B M5", "HOOK 2 1d6:B M5 HOOK"]],
  ["spear", "BALANCED TWO_HANDED POWER 6", "REACH BRACE", ["THRUST 2 1d8:P M5 PIERCE=1", "SWEEP 2 1d6:B M5 SWEEP", "BUTT_STRIKE 1 1d4:B M5 CLOSE"]],
  ["polearm", "HEAVY TWO_HANDED POWER 5", "REACH BRACE", ["SLASH 3 1d8:S M5 CLEAVE", "THRUST 3 1d10:P M5 PIERCE=1", "HOOK 2 1d6:S M5 HOOK", "HAFT_BASH 2 1d6:B M5 CLOSE"]],
  ["heavy_axe", "HEAVY TWO_HANDED POWER 5", "CLEAVE", ["CHOP 3 1d12:S M5", "CLEAVE 3 1d10:S M5 CLEAVE", "BASH 2 1d6:B M5 CLOSE"]],
  ["heavy_blade", "HEAVY TWO_HANDED POWER 5", "REINFORCED", ["SLASH 3 2d6:S M5", "STAB 3 1d10:P M5 PIERCE=1", "BASH 2 1d6:B M5 CLOSE"]],
  ["heavy_blunt_weapon", "HEAVY TWO_HANDED POWER 5", "REINFORCED", ["SMASH 3 1d12:B M5 STAGGER", "CRUSH 3 3d4:B M5", "BASH 2 1d8:B M5 CLOSE", "SHOCKWAVE_SLAM 3 1d10:B M5 SHOCKWAVE=5"]],
  ["thrown_blade", "LIGHT ONE_HANDED POWER 7", "CONCEALABLE SILENT THROWN AMMO", ["THROW 1 1d4:P R:STR:5", "TRICK_THROW 2 1d4:P R:STR:5 FLEXIBLE"]],
  ["thrown_axe", "BALANCED ONE_HANDED POWER 6", "THROWN AMMO", ["THROW 2 1d6:S R:STR:5", "HOOK_THROW 2 1d4:S R:STR:5 HOOK"]],
  ["javelin", "BALANCED ONE_HANDED POWER 6", "THROWN AMMO", ["THROW 2 1d8:P R:STR:10 PIERCE=1", "IMPALE 3 1d10:P R:STR:10 PIERCE=1"]],
  ["thrown_disc", "LIGHT ONE_HANDED POWER 7", "THROWN FLEXIBLE", ["THROW 1 1d6:S R:STR:10", "CURVE_THROW 2 1d6:S R:STR:10 FLEXIBLE", "SWEEPING_THROW 2 1d6:S R:STR:10 CLEAVE"]],
  ["sling", "LIGHT - POWER 7", "AMMO SILENT", ["QUICK_SHOT 1 1d4:B R:PER:15", "POWER_SHOT 2 1d6:B R:PER:20", "LOB 2 1d4:B R:PER:20"]],
  ["heavy_thrown_weapon", "HEAVY TWO_HANDED POWER 5", "THROWN", ["HEAVY_THROW 3 1d10:P/S R:STR:15", "IMPALE 3 1d12:P R:STR:15 PIERCE=2", "DRAG 3 1d8:P R:STR:10 HOOK"]],
  ["light_bow", "LIGHT TWO_HANDED POWER 7", "AMMO SILENT", ["QUICK_SHOT 1 1d4:P R:PER:15", "DRAW_SHOT 2 1d6:P R:PER:20"]],
  ["balanced_bow", "BALANCED TWO_HANDED POWER 6", "AMMO SILENT", ["QUICK_SHOT 2 1d6:P R:PER:20", "FULL_DRAW 2 1d8:P R:PER:30 PIERCE=1", "CHARGED_DRAW 3 1d10:P R:PER:30 PIERCE=1"]],
  ["heavy_bow", "HEAVY TWO_HANDED POWER 5", "AMMO SILENT", ["HEAVY_SHOT 3 1d10:P R:PER:35 PIERCE=1", "FULL_DRAW 3 1d12:P R:PER:40 PIERCE=2", "BRACED_SHOT 3 2d6:P R:PER:40 PIERCE=2 STATIONARY"]],
  ["handgun", "LIGHT ONE_HANDED STATIC -", "AMMO LOADING=6 RELOAD=2 LOUD=100 RECOIL", ["SINGLE_SHOT 1 1d8:P R:PER:30", "CLOSE_SHOT 1 1d6:P C5 CLOSE", "BURST_FIRE 2 2d8:P R:PER:30 BURST ACC-2"]],
  ["smg", "LIGHT ONE_HANDED STATIC -", "AMMO LOADING=15 RELOAD=2 LOUD=100 RECOIL AUTO", ["SINGLE_SHOT 1 1d6:P R:PER:20", "BURST 2 2d6:P R:PER:20 BURST ACC-2", "SUPPRESS 2 1d6:P L10 AUTO SUPPRESS SAVE"]],
  ["rifle", "BALANCED TWO_HANDED STATIC -", "AMMO LOADING=12 RELOAD=3 LOUD=200 RECOIL", ["SINGLE_SHOT 2 1d12:P R:PER:40 PIERCE=1", "BURST 2 2d12:P R:PER:40 BURST ACC-2", "AUTO_FIRE 3 1d12:P L10 AUTO SAVE"]],
  ["shotgun", "BALANCED TWO_HANDED STATIC -", "AMMO LOADING=5 RELOAD=3 LOUD=200 RECOIL", ["BLAST_SHOT 2 3d4:P R:PER:15 SPREAD", "BREACH_SHOT 2 2d6:P C5 CLOSE ARMOR_PRESSURE", "SCATTER_CONE 3 3d4:P K15 SPREAD MISS=HALF"]],
  ["sniper_rifle", "HEAVY TWO_HANDED STATIC -", "AMMO LOADING=4 RELOAD=4 LOUD=400 RECOIL PRECISION", ["BODY_SHOT 2 1d12:P R:PER:60 PIERCE=2", "AIMED_SHOT 3 2d12:P R:PER:100 PIERCE=4 PRECISION", "BRACED_SHOT 3 2d12:P R:PER:120 PIERCE=4 PRECISION STATIONARY"]],
  ["heavy_machine_gun", "HEAVY TWO_HANDED STATIC -", "AMMO LOADING=20 RELOAD=5 LOUD=400 RECOIL=2 AUTO", ["HEAVY_BURST 3 3d8:P R:PER:60 BURST ACC-2", "SUPPRESSIVE_FIRE 3 2d8:P L15 AUTO SUPPRESS SAVE", "BRACED_FIRE 3 3d8:P R:PER:80 STATIONARY"]],
  ["light_crossbow", "BALANCED TWO_HANDED STATIC -", "AMMO LOADING=1 RELOAD=2 PRECISION", ["SNAP_SHOT 2 1d8:P R:PER:40", "AIMED_BOLT 2 1d10:P R:PER:50 PIERCE=2", "BRACED_BOLT 3 1d10:P R:PER:60 PIERCE=2 STATIONARY"]],
  ["heavy_crossbow", "HEAVY TWO_HANDED STATIC -", "AMMO LOADING=1 RELOAD=3 PRECISION", ["HEAVY_BOLT 3 1d12:P R:PER:60 PIERCE=2", "PENETRATING_BOLT 3 2d6:P R:PER:70 PIERCE=3", "BRACED_SHOT 3 2d6:P R:PER:80 PIERCE=3 STATIONARY"]],
  ["launcher", "HEAVY TWO_HANDED STATIC -", "AMMO LOADING=4 RELOAD=4 LOUD=600 RECOIL EXPLOSIVE", ["IMPACT_ROUND 3 2d8:P R:PER:40 PIERCE=2", "BLAST_ROUND 3 2d6:FIRE R:PER:40:B10", "AIRBURST 3 2d6:FIRE R:PER:50:B10", "BREACH_ROUND 3 3d6:P R:PER:30 PIERCE=4"]],
  ["heavy_explosive_weapon", "HEAVY TWO_HANDED STATIC -", "AMMO LOADING=1 RELOAD=4 LOUD=800 RECOIL=2 EXPLOSIVE", ["ROCKET 3 3d8:FIRE R:PER:60:B10", "ANTI_ARMOR_ROUND 3 2d10:P R:PER:60 PIERCE=5", "HEAVY_BLAST 4 3d8:FIRE R:PER:50:B15", "BREACHING_ROCKET 3 3d6:B R:PER:40 BREACH_STRUCTURE"]],
  ["arc_bow", "BALANCED TWO_HANDED HYBRID 5", "AMMO HYBRID CONDUIT", ["MANA_ARROW 2 1d10:P R:PER:30 ~POWER", "OVERDRAW 3 1d10:P R:PER:35 OVERDRAW=1/3 ~POWER", "ARC_SHOT 2 1d8:ENERGY R:PER:25 FLEXIBLE ~POWER"]],
  ["mana_chakram", "LIGHT ONE_HANDED HYBRID 6", "HYBRID RETURN_CURVE", ["THROW 1 1d8:S R:PER:10 RETURN_CURVE ~POWER", "CURVING_CUT 2 1d8:S R:PER:10 FLEXIBLE ~POWER", "INFUSED_THROW 2+1MP 1d8:ELEMENTAL R:PER:10 ELEMENTAL_INFUSED ~POWER"]],
  ["pulse_cannon", "HEAVY TWO_HANDED HYBRID -", "HYBRID AMMO_CORE LOADING=6 RELOAD=4 LOUD=400", ["PULSE_SHOT 3 2d8:ENERGY R:PER:40 PIERCE=2 ~STATIC", "OVERCHARGE 3+2MP 3d8:ENERGY R:PER:40 ~STATIC", "SHOCK_BURST 3 2d6:SHOCK K10 SHOCKWAVE DEFERRED ~STATIC"]],
  ["energy_melee_weapon", "BALANCED - HYBRID 6", "HYBRID CONDUIT", ["ENERGY_CUT 2 1d8:ENERGY M5 ~POWER", "PULSE_THRUST 2 1d6:ENERGY M5 PIERCE=1 ~POWER", "GUARD_STRIKE 1 1d4:B M5 CLOSE ~POWER", "DISCHARGE 3+1MP 1d10:ENERGY M5 PIERCE=1 ~POWER"]],
  ["improvised_light", "LIGHT - POWER 7", "", ["STRIKE 1 1d4:B/P/S M5", "THROW 1 1d4:B/P/S M5"]],
  ["improvised_balanced", "BALANCED - POWER 6", "", ["STRIKE 2 1d6:B/P/S M5", "HEAVY_SWING 2 1d8:B/P/S M5", "THROW 2 1d4:B/P/S M5"]],
  ["improvised_heavy", "HEAVY - POWER 5", "", ["HEAVY_STRIKE 3 1d10:B/P/S M5", "SMASH 3 1d12:B/P/S M5", "SHOVE_DROP 2 1d6:B/P/S M5"]],
];

const TYPE: Record<string, string> = { SLASHING: "S", PIERCING: "P", BLUDGEONING: "B", FIRE: "FIRE", ENERGY: "ENERGY", SHOCK: "SHOCK", ELEMENTAL: "ELEMENTAL" };
const use = (u: ResolvedTraitUse) => {
  const values = Object.keys(u.parameters).sort((a, b) => (a < b ? -1 : 1)).map((k) => u.parameters[k]);
  return values.length === 0 ? u.traitKey : `${u.traitKey}=${values.join("/")}`;
};
function encodeAttack(w: WeaponEntry, a: AttackEntry): string {
  const p = a.payload;
  const t = p.targeting;
  const range = t.mode === "MELEE" ? `M${t.reachFeet}` : t.mode === "CLOSE" ? `C${t.reachFeet}` : t.mode === "LINE" ? `L${t.lengthFeet}` : t.mode === "CONE" ? `K${t.lengthFeet}` : `R:${t.stat}:${t.feetPerPoint}${t.area === null ? "" : `:B${t.area.radiusFeet}`}`;
  const dice = `${p.damageProfiles[0]!.dice.count}d${p.damageProfiles[0]!.dice.sides}:${p.damageProfiles.map((d) => TYPE[d.damageType]).join("/")}`;
  const extras = [
    ...a.moveProperties.map(use),
    ...(p.resolution.mode === "SAVING_THROW" ? ["SAVE"] : []),
    ...(p.resolution.mode === "ATTACK_ROLL" && p.resolution.onMiss !== "NO_DAMAGE" ? [`MISS=${p.resolution.onMiss}`] : []),
    ...(p.resolution.mode === "DEFERRED" ? ["DEFERRED"] : []),
    ...(p.accuracyModifier === 0 ? [] : [`ACC${p.accuracyModifier}`]),
    ...(w.payload.scalingModel === "HYBRID" ? [`~${String(p.scaling)}`] : []),
  ];
  return [p.moveKey, p.mpCost === 0 ? `${p.apCost}` : `${p.apCost}+${p.mpCost}MP`, dice, range, ...extras].join(" ");
}

describe("approved baseline catalog completeness (§185–§186)", () => {
  const f = weaponFixture();
  const index = indexWeaponLibrary(f.bundle);
  const byKey = new Map<string, WeaponEntry>(index.weapons.map((w) => [w.ref.canonicalKey as string, w]));

  it("the catalog is source content data with exactly the approved profiles — none missing, none extra, none replaced", () => {
    expect(WEAPON_CONTENT.workOrder).toBe("M6-WO6");
    expect([...byKey.keys()].sort()).toEqual(EXPECTED.map(([k]) => `weapon.${k}`).sort());
    expect(index.weapons).toHaveLength(47);
    expect(index.weapons.flatMap((w) => w.attacks)).toHaveLength(141);
    expect(index.traits).toHaveLength(38);
    expect(EXPECTED.flatMap(([, , , a]) => a)).toHaveLength(141);
  });

  it.each(EXPECTED)("%s matches the Work Order exactly (category, handedness, scaling, Power, properties, every Move)", (key, weapon, properties, attacks) => {
    const w = byKey.get(`weapon.${key}`);
    expect(w, key).toBeDefined();
    const p = w!.payload;
    expect(`${p.category ?? "-"} ${p.handedness ?? "-"} ${p.scalingModel} ${p.power ?? "-"}`).toBe(weapon);
    expect(w!.weaponProperties.map(use).join(" ")).toBe(properties);
    expect(w!.attacks.map((a) => encodeAttack(w!, a))).toEqual(attacks);
    // Every Moveset entry is an exact pinned ATTACK of the same family, in authored order.
    expect(w!.attacks.map((a) => a.ref)).toEqual(p.moveset);
    for (const a of w!.attacks) expect(a.payload.weaponFamilyKey).toBe(p.familyKey);
  });

  it("Shields: requirements, while-equipped modifiers and Special Features exactly as approved (§62–§64)", () => {
    const shield = (k: string) => byKey.get(`weapon.${k}`)!.payload;
    const reqs = (k: string) => shield(k).requirements.map((r) => (r.kind === "MARTIAL_RANK_AT_LEAST" ? `Martial ${r.minimumRank}` : `${r.stat} ${r.minimum}`));
    const mods = (k: string) => shield(k).equippedModifiers.map((m) => `${m.target} ${m.value}`);
    expect([reqs("light_shield"), mods("light_shield"), shield("light_shield").grantedFeatures.map((g) => g.featureKey)]).toEqual([["Martial TRAINED"], ["ARMOR 1", "DODGE 1"], ["DEFLECT_SHOT"]]);
    expect([reqs("balanced_shield"), mods("balanced_shield"), shield("balanced_shield").grantedFeatures.map((g) => g.featureKey)]).toEqual([["Martial EXPERT"], ["ARMOR 2"], ["BRACE_WALL"]]);
    expect([reqs("heavy_shield"), mods("heavy_shield"), shield("heavy_shield").grantedFeatures.map((g) => g.featureKey)]).toEqual([["Martial MASTER", "STR 5"], ["ARMOR 3", "DODGE -1", "MOVEMENT -5"], ["FULL_GUARD"]]);
    for (const k of ["light_shield", "balanced_shield", "heavy_shield"]) expect(shield(k).equipmentRole).toBe("SHIELD");
    expect(index.weapons.filter((w) => w.payload.equipmentRole === "SHIELD")).toHaveLength(3);
  });

  it("other requirements: only the Heavy Bow (STR 4) among non-Shield Weapons", () => {
    expect(index.weapons.filter((w) => w.payload.equipmentRole === "WEAPON" && w.payload.requirements.length > 0).map((w) => [w.ref.canonicalKey, w.payload.requirements])).toEqual([["weapon.heavy_bow", [{ requirementKey: "strength", kind: "STAT_AT_LEAST", stat: "STR", minimum: 4 }]]]);
  });

  it("Unarmed profiles by Martial rank; Improvised profiles carry no property (§138); STATIC Weapons author no Power", () => {
    expect(index.weapons.filter((w) => w.payload.profileKind === "UNARMED").map((w) => w.payload.martialRankKey)).toEqual(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"]);
    for (const w of index.weapons.filter((x) => x.payload.profileKind === "IMPROVISED")) expect(w.attacks.flatMap((a) => a.moveProperties)).toEqual([]);
    for (const w of index.weapons.filter((x) => x.payload.scalingModel === "STATIC")) expect([w.payload.power, w.payload.scalingRule], w.ref.canonicalKey).toEqual([null, null]);
  });
});
