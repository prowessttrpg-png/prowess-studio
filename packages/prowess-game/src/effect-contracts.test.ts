import { describe, expect, it } from "vitest";
import { compileEffectUse, validateEffectUse } from "./effect/compile.js";
import { EFFECT_REFERENCE_CONTENT } from "./content/core-playtest-v0.1/effects.js";
import { SPELL_EFFECT_FAMILIES } from "./vocabulary/effect.js";
import { effectCharacter, effectFixture, effectRequest, maneuverEffectAbility, spellEffectAbility } from "./testing/effect-fixtures.js";

const codes = (x: { ok: boolean; problems?: readonly { code: string }[] }) => x.ok ? [] : (x.problems ?? []).map((p) => p.code);

describe("M5-WO7 Effect grammar", () => {
  it("has exactly the seven canonical Spell Effect families and no Movement/Cleanse/Interference top-level family", () => {
    expect(SPELL_EFFECT_FAMILIES).toEqual(["DAMAGE", "HEALING", "BUFF", "DEBUFF", "CONTROL", "UTILITY", "SUMMONING"]);
    expect(SPELL_EFFECT_FAMILIES).not.toContain("MOVEMENT");
    expect(SPELL_EFFECT_FAMILIES).not.toContain("CLEANSE");
    expect(SPELL_EFFECT_FAMILIES).not.toContain("SPELL_INTERFERENCE");
  });

  it("authors Cleanse under Healing and Movement/Counterspell under Utility", () => {
    const by = (key: string) => EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === key)!.payload as any;
    expect([by("spell.effect.cleanse").effectFamily, by("spell.effect.cleanse").rules.effect.effectSubfamily]).toEqual(["HEALING", "CLEANSE"]);
    expect([by("spell.effect.reposition").effectFamily, by("spell.effect.reposition").rules.effect.effectSubfamily]).toEqual(["UTILITY", "MOVEMENT"]);
    expect([by("spell.effect.dispel").effectFamily, by("spell.effect.dispel").rules.effect.effectSubfamily]).toEqual(["UTILITY", "COUNTERSPELL"]);
  });

  it("keeps Spell and Maneuver Effects branch-specific", () => {
    const f = effectFixture();
    const spell = spellEffectAbility(f, "spell.effect.direct_damage");
    const crossed = structuredClone(spell) as any;
    crossed.effects[0].definition = f.ref("maneuver.effect.elemental_damage_conversion");
    expect(codes(compileEffectUse(effectRequest(f, crossed)))).not.toEqual([]);
  });

  it("requires an explicit Spell resolution and explicit Maneuver inheritance", () => {
    const f = effectFixture({ revise: { "spell.effect.direct_damage": { ...(EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === "spell.effect.direct_damage")!.payload as any), resolution: null } } });
    expect(codes(compileEffectUse(effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage")))).toString()).toContain("SPELL_EFFECT_RESOLUTION_REQUIRED");
    const ok = validateEffectUse(effectRequest(effectFixture(), maneuverEffectAbility(effectFixture(), "maneuver.effect.elemental_damage_conversion")));
    expect(ok.ok).toBe(false); // exact bundle identity is intentionally mixed and must fail closed
  });

  it("rejects character-dice scaling above PRO per Effect, not by summing separate Effects", () => {
    const f = effectFixture();
    const bad = validateEffectUse(effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 5 }), effectCharacter({ pro: 4 })));
    expect(bad.ok && bad.value.valid).toBe(false);
    const good = validateEffectUse(effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 4 }), effectCharacter({ pro: 4 })));
    expect(good.ok && good.value.valid).toBe(true);
  });

  it("stores listed AP/MP contributions but never ME or final Ability cost", () => {
    const f = effectFixture();
    const r = validateEffectUse(effectRequest(f, maneuverEffectAbility(f, "maneuver.effect.zone_carve")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.costContributions.map((c) => [c.currency, c.kind, "amount" in c ? c.amount : null])).toEqual([["AP", "FIXED", 3], ["MP", "FIXED", 8]]);
    expect(JSON.stringify(r.value)).not.toMatch(/finalCost|manaEfficiency|spendMP|spendAP/i);
  });

  it("does not imply elemental Conditions from damage conversion", () => {
    const p = EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === "maneuver.effect.elemental_damage_conversion")!.payload as any;
    expect(p.rules.effect.restrictions).toContain("DAMAGE_TYPE_ONLY_NO_IMPLICIT_CONDITION");
    expect(JSON.stringify(p.outcomes)).not.toMatch(/Burning|Shocked|Poisoned|Mana Drain/i);
  });

  it("is JSON-safe and does not mutate exact inputs", () => {
    const f = effectFixture();
    const request = effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 2 }));
    const before = JSON.stringify(request);
    const r = validateEffectUse(request);
    expect(JSON.stringify(request)).toBe(before);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(JSON.stringify(r.value))).toEqual(r.value);
  });
});
