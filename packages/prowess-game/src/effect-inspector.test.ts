import { describe, expect, it } from "vitest";
import { effectCharacter, effectFixture, effectRequest, maneuverEffectAbility, spellEffectAbility } from "./testing/effect-fixtures.js";
import { validateEffectUse } from "./effect/compile.js";

const run = (f: ReturnType<typeof effectFixture>, composition: Record<string, unknown>, character = effectCharacter()) => {
  const result = validateEffectUse(effectRequest(f, composition, character));
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.value;
};

describe("M5-WO7 Rules Inspector Effect fixtures", () => {
  it("shows Projectile + Attack Effect delivery separately from Effect resolution", () => {
    const f = effectFixture();
    const r = run(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.projectile", { dice: 2 }));
    expect(r.delivery).toEqual({ check: "RANGED_ATTACK_ROLL", interaction: "SAME_ATTACK_ROLL", effectResolution: "ATTACK_ROLL" });
    expect(r.provenance.effect.canonicalKey).toBe("spell.effect.direct_damage");
  });

  it("shows Projectile + Save Effect as delivery then exact Effect Save Profile", () => {
    const f = effectFixture();
    const r = run(f, spellEffectAbility(f, "spell.effect.bind", "spell.targeting.projectile"));
    expect(r.delivery.interaction).toBe("DELIVERY_THEN_SAVE");
    expect(r.validSaves).toEqual(["STR", "PRO"]);
  });

  it("shows Direct Damage PRO scaling validation and selected parameter", () => {
    const f = effectFixture();
    const r = run(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 4 }), effectCharacter({ pro: 4 }));
    expect(r.parameters.find((p) => p.parameter === "dice")?.value).toBe(4);
    expect(r.rules.every((rule) => rule.satisfied)).toBe(true);
  });

  it("shows Maneuver Radius Conversion ownership without moving Save/cost to Targeting", () => {
    const f = effectFixture();
    const r = run(f, maneuverEffectAbility(f, "maneuver.effect.radius_attack_conversion"), effectCharacter({ str: 5, martial: "EXPERT" }));
    expect(r.targetingConversion?.destination.canonicalKey).toBe("maneuver.targeting.radius");
    expect(r.validSaves).toEqual(["AGI", "PRO"]);
    expect(r.costContributions).toEqual([expect.objectContaining({ currency: "AP", amount: 3 })]);
  });

  it("exposes exact Ruleset / EntityVersion provenance for Studio inspection", () => {
    const f = effectFixture();
    const r = run(f, spellEffectAbility(f, "spell.effect.direct_healing"));
    expect(r.provenance.ruleset.rulesetId).toBe(f.ruleset.rulesetId);
    expect(r.provenance.ruleset.manifestId).toBe(f.ruleset.manifestId);
    expect(r.provenance.effect.entityVersionId).toBe(f.ref("spell.effect.direct_healing").entityVersionId);
    expect(r.provenance.targeting.entityVersionId).toBe(f.ref("spell.targeting.single_target").entityVersionId);
  });
});
