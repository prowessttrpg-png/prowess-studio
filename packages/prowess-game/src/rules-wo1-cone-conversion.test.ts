import { describe, expect, it } from "vitest";
import { validateEffectUse } from "./effect/compile.js";
import { EFFECT_REFERENCE_CONTENT } from "./content/core-playtest-v0.1/effects.js";
import { effectCharacter, effectFixture, effectRequest, maneuverEffectAbility } from "./testing/effect-fixtures.js";

/**
 * RULES-WO1 Phase G — Cone Attack Conversion. The Core Playtest states the cone's length as "5 ft × Martial Rank" with the
 * table Trained 5 ft / Expert 10 ft / Master 15 ft, and the Effect requires Martial Expert. The published content
 * authors exactly that meaning (`5 * martial_rank`, the Martial Rank Value source), but names the variable `martial_rank`,
 * which the compiler's Effect reader refuses (Effect formula variables are lowerCamel). The correction is
 * REPRESENTATION ONLY: the same expression, source, rounding, minimum and unit with the variable named `martialRankValue` — exactly what the guided Effect editor produces when the input is
 * replaced with the Martial Rank Value (studio `rules-wo1-component-rules-ui`). It is
 * a new revision in an isolated test Release; the published revision is untouched.
 */
const KEY = "maneuver.effect.cone_attack_conversion";
const published = EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === KEY)!.payload as unknown as { rules: { effect: { formulas: Array<Record<string, unknown>> } } };
const corrected = (() => {
  const p = JSON.parse(JSON.stringify(published)) as typeof published;
  p.rules.effect.formulas = p.rules.effect.formulas.map((f) => ({ ...f, expression: "5 * martialRankValue", variables: [{ variable: "martialRankValue", source: { kind: "MARTIAL_RANK_VALUE" } }] }));
  return p;
})();
const cone = (revise: boolean, martial: string) => {
  const f = effectFixture(revise ? { revise: { [KEY]: corrected as unknown as Record<string, unknown> } } : {});
  return { f, r: validateEffectUse(effectRequest(f, maneuverEffectAbility(f, KEY), effectCharacter({ martial }))) };
};

describe("RULES-WO1 Phase G: Cone Attack Conversion correction (representation only)", () => {
  it("the published revision authors 5 ft × Martial Rank, but its variable name makes it uncompilable", () => {
    expect(published.rules.effect.formulas).toEqual([{ formulaKey: "length", expression: "5 * martial_rank", rounding: "NONE", minimum: 5, unit: "ft", variables: [{ variable: "martial_rank", source: { kind: "MARTIAL_RANK_VALUE" } }] }]);
    const { r } = cone(false, "MASTER");
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.map((p) => [p.code, p.path])).toEqual(expect.arrayContaining([["PROWESS_EFFECT.INVALID_EFFECT_RULES", expect.stringMatching(/formulas\/0\/variables/)]]));
  });

  it("the corrected revision changes only the variable name: same expression shape, source, rounding, minimum and unit", () => {
    const [before] = published.rules.effect.formulas, [after] = corrected.rules.effect.formulas;
    expect({ ...after, expression: undefined, variables: undefined }).toEqual({ ...before, expression: undefined, variables: undefined });
    expect((after!.variables as Array<{ source: unknown }>)[0]!.source).toEqual((before!.variables as Array<{ source: unknown }>)[0]!.source);
    expect(JSON.stringify({ ...corrected, rules: { ...corrected.rules, effect: { ...corrected.rules.effect, formulas: [] } } })).toBe(JSON.stringify({ ...published, rules: { ...published.rules, effect: { ...published.rules.effect, formulas: [] } } }));
  });

  it.each([
    ["EXPERT", 10],
    ["MASTER", 15],
  ])("at Martial %s the cone is %i ft (the source table), on a new revision in an isolated Release", (martial, feet) => {
    const { f, r } = cone(true, martial);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.value.valid).toBe(true);
    expect(r.value.formulaValues).toEqual([{ formulaKey: "length", value: feet, unit: "ft" }]);
    // The isolated Release pins the new revision (revision 2); the published revision is a different, unchanged version.
    expect(f.ref(KEY).entityVersionId).not.toBe(effectFixture().ref(KEY).entityVersionId);
  });

  it("at Martial Trained the Effect is not available (it requires Martial Expert); the 5 ft Trained row is never reached", () => {
    const { r } = cone(true, "TRAINED");
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.value.valid).toBe(false);
    expect(r.value.problems.join(" ")).toMatch(/construction|prerequisite|access/i);
  });
});
