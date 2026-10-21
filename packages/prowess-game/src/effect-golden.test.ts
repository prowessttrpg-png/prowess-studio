import { describe, expect, it } from "vitest";
import { evaluateAbilityTargeting } from "./targeting/compile.js";
import { validateEffectUse } from "./effect/compile.js";
import { keywordCatalog } from "./testing/affinity-fixtures.js";
import { effectCharacter, effectFixture, effectRequest, maneuverEffectAbility, spellEffectAbility } from "./testing/effect-fixtures.js";

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const targeting = (f: ReturnType<typeof effectFixture>, composition: Record<string, unknown>, character = effectCharacter()) => {
  const targetingCharacter = { stats: character.stats, skillRanks: character.skillRanks };
  const r = evaluateAbilityTargeting({ contractVersion: 1, subjectKey: "wo7.targeting", composition, definitions: f.bundle, ruleset: f.ruleset, character: targetingCharacter, keywords: keywordCatalog() });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
};
const effect = (f: ReturnType<typeof effectFixture>, composition: Record<string, unknown>, character = effectCharacter()) => {
  const r = validateEffectUse(effectRequest(f, composition, character));
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
};

describe("M5-WO7 Projectile designer ruling", () => {
  it("Projectile costs 3 MP and uses the caster's applicable Range", () => {
    const f = effectFixture();
    const c = spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.projectile", { dice: 1 });
    const t = targeting(f, c, effectCharacter({ per: 4 }));
    expect(t.cost.base).toEqual(expect.objectContaining({ status: "LISTED", currency: "MP", amount: 3 }));
    expect(t.range.value).toBe(60);
  });

  it("Projectile + Attack Effect has one delivery attack, reused as Effect resolution", () => {
    const f = effectFixture();
    const r = effect(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.projectile", { dice: 1 }));
    expect(r.delivery).toEqual({ check: "RANGED_ATTACK_ROLL", interaction: "SAME_ATTACK_ROLL", effectResolution: "ATTACK_ROLL" });
  });

  it("Projectile + Save Effect is delivery attack then the Effect-owned Save", () => {
    const f = effectFixture();
    const r = effect(f, spellEffectAbility(f, "spell.effect.bind", "spell.targeting.projectile"));
    expect(r.delivery).toEqual({ check: "RANGED_ATTACK_ROLL", interaction: "DELIVERY_THEN_SAVE", effectResolution: "SAVING_THROW" });
    expect(r.validSaves).toEqual(["STR", "PRO"]);
  });

  it("Projectile + Automatic Effect still requires successful delivery", () => {
    const f = effectFixture();
    const r = effect(f, spellEffectAbility(f, "spell.effect.direct_healing", "spell.targeting.projectile"));
    expect(r.delivery).toEqual({ check: "RANGED_ATTACK_ROLL", interaction: "DELIVERY_THEN_AUTOMATIC", effectResolution: "AUTOMATIC" });
  });
});

describe("M5-WO7 Spell Line designer ruling", () => {
  it.each([[1, 10, 5], [2, 20, 5], [3, 30, 10], [4, 40, 10], [6, 60, 15], [10, 100, 25]])("PRO %i => %i ft long and %i ft wide", (pro, length, width) => {
    const f = effectFixture();
    const c = spellEffectAbility(f, "spell.effect.detect_mana", "spell.targeting.line");
    const t = targeting(f, c, effectCharacter({ pro }));
    const m = (name: string) => t.geometry.find((g) => g.measure === name)?.value;
    expect([m("LENGTH"), m("WIDTH")]).toEqual([length, width]);
  });
});

describe("M5-WO7 Effect contracts", () => {
  it("Direct Healing rejects Cone because compatibility is exact", () => {
    const f = effectFixture();
    const r = effect(f, spellEffectAbility(f, "spell.effect.direct_healing", "spell.targeting.cone"));
    expect([r.valid, r.targetingStatus]).toEqual([false, "INCOMPATIBLE"]);
  });

  it("Cleanse is Healing/Cleanse and does not imply HP restoration", () => {
    const f = effectFixture();
    const r = effect(f, spellEffectAbility(f, "spell.effect.cleanse"));
    expect([r.effect.family, r.effect.subfamily]).toEqual(["HEALING", "CLEANSE"]);
    expect(JSON.stringify(r.outcomes)).not.toMatch(/"HEAL"/);
  });

  it("Movement and Counterspell remain Utility subfamilies", () => {
    const f = effectFixture();
    const movement = effect(f, spellEffectAbility(f, "spell.effect.reposition"));
    const interference = effect(f, spellEffectAbility(f, "spell.effect.dispel"));
    expect([[movement.effect.family, movement.effect.subfamily], [interference.effect.family, interference.effect.subfamily]]).toEqual([["UTILITY", "MOVEMENT"], ["UTILITY", "COUNTERSPELL"]]);
  });

  it("Elemental conversion explicitly inherits Ability resolution and creates no extra roll", () => {
    const f = effectFixture();
    const r = effect(f, maneuverEffectAbility(f, "maneuver.effect.elemental_damage_conversion", "maneuver.targeting.single_target", { damageType: "LIGHTNING" }));
    expect([r.resolution, r.resolutionPolicy, r.delivery.interaction]).toEqual([null, "INHERIT_ABILITY", "NONE"]);
    expect(r.costContributions).toEqual([expect.objectContaining({ currency: "MP", kind: "FIXED", amount: 4 })]);
  });

  it("Radius Conversion owns +3 AP, AGI/PRO Save Profile and exact Radius destination; Targeting owns geometry", () => {
    const f = effectFixture();
    const r = effect(f, maneuverEffectAbility(f, "maneuver.effect.radius_attack_conversion"), effectCharacter({ str: 5, martial: "EXPERT" }));
    expect(r.costContributions).toEqual([expect.objectContaining({ currency: "AP", kind: "FIXED", amount: 3 })]);
    expect(r.validSaves).toEqual(["AGI", "PRO"]);
    expect(r.targetingConversion?.destination.canonicalKey).toBe("maneuver.targeting.radius");
    const radiusComposition = maneuverEffectAbility(f, "maneuver.effect.radius_attack_conversion", "maneuver.targeting.radius");
    const target = radiusComposition.targeting as { parameters: Record<string, unknown> };
    target.parameters = { originMode: "THROWN_IMPACT" };
    const t = targeting(f, radiusComposition, effectCharacter({ str: 5, martial: "EXPERT" }));
    expect(t.geometry.find((g) => g.measure === "RADIUS")?.value).toBe(50);
    expect(JSON.stringify(t)).not.toMatch(/"amount":3.*AP|AGI.*PRO/);
  });
});

describe("M5-WO7 historical reproducibility", () => {
  it("keeps WO6 historical Projectile/Line assumptions reproducible while current canon is amended", () => {
    const old = effectFixture({ currentCanon: false });
    const current = effectFixture({ currentCanon: true });
    const oldProjectile = targeting(old, spellEffectAbility(old, "spell.effect.direct_damage", "spell.targeting.projectile", { dice: 1 }));
    const currentProjectile = targeting(current, spellEffectAbility(current, "spell.effect.direct_damage", "spell.targeting.projectile", { dice: 1 }));
    expect([oldProjectile.cost.base.status, currentProjectile.cost.base.status]).toEqual(["DEFERRED_PENDING_CANON", "LISTED"]);
    expect(currentProjectile.cost.base).toEqual(expect.objectContaining({ amount: 3 }));
  });

  it("pins Effect EntityVersions: publishing a revised R2 does not alter R1 evaluation", () => {
    const r1 = effectFixture({ rulesetId: "87010000-0000-4000-8000-000000000001", manifestId: "87020000-0000-4000-8000-000000000001" });
    const c1 = spellEffectAbility(r1, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 2 });
    const a = effect(r1, c1);
    const source = r1.bundle.definitions.find((d) => d.canonicalKey === "spell.effect.direct_damage")!.payload as Record<string, unknown>;
    const r2 = effectFixture({ rulesetId: "87110000-0000-4000-8000-000000000001", manifestId: "87120000-0000-4000-8000-000000000001", revise: { "spell.effect.direct_damage": { ...cloneJson(source), costContributions: [{ contributionKey: "effect.damage.dice", currency: "MP", data: { kind: "PER_UNIT", parameter: "dice", amount: 9, includedUnits: 0 } }] } } });
    const b = effect(r2, spellEffectAbility(r2, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 2 }));
    const again = effect(r1, c1);
    expect(again).toEqual(a);
    const aCost = a.costContributions[0];
    const bCost = b.costContributions[0];
    expect(aCost && "amount" in aCost ? aCost.amount : null).toBe(4);
    expect(bCost && "amount" in bCost ? bCost.amount : null).toBe(9);
    expect(a.provenance.effect.entityVersionId).not.toBe(b.provenance.effect.entityVersionId);
  });
});