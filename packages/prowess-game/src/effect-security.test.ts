import { describe, expect, it } from "vitest";
import { compileEffectUse, validateEffectUse } from "./effect/compile.js";
import { EFFECT_REFERENCE_CONTENT } from "./content/core-playtest-v0.1/effects.js";
import { effectCharacter, effectFixture, effectRequest, spellEffectAbility } from "./testing/effect-fixtures.js";

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rejected = (value: unknown) => expect(compileEffectUse(value).ok).toBe(false);

describe("M5-WO7 Effect input safety", () => {
  it("rejects functions and getters rather than invoking them", () => {
    const f = effectFixture();
    const base = effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage"));
    rejected({ ...base, extra: () => 1 });
    let touched = false;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "contractVersion", { enumerable: true, get() { touched = true; return 1; } });
    rejected(hostile);
    expect(touched).toBe(false);
  });

  it("rejects cyclic, unsafe-prototype and non-finite values", () => {
    const f = effectFixture();
    const cycle = effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage")) as Record<string, unknown>;
    cycle.loop = cycle;
    rejected(cycle);

    const proto = Object.create({ polluted: true }) as Record<string, unknown>;
    Object.assign(proto, effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage")));
    rejected(proto);

    const nan = effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: Number.NaN }));
    rejected(nan);
    const infinity = effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: Number.POSITIVE_INFINITY }));
    rejected(infinity);
  });

  it("rejects negative / invalid scaling parameter quantities", () => {
    const f = effectFixture();
    rejected(effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: -1 })));
    rejected(effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 1.5 })));
  });

  it("rejects unknown Spell Effect families and malformed Save Profiles", () => {
    const direct = EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === "spell.effect.direct_damage")!.payload as unknown as Record<string, unknown>;
    const badFamily = effectFixture({ revise: { "spell.effect.direct_damage": { ...cloneJson(direct), effectFamily: "UNKNOWN_FAMILY" } } });
    rejected(effectRequest(badFamily, spellEffectAbility(badFamily, "spell.effect.direct_damage")));

    const bind = EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === "spell.effect.bind")!.payload as unknown as Record<string, unknown>;
    const malformed = cloneJson(bind) as { rules: { effect: { saveProfile: unknown } } } & Record<string, unknown>;
    malformed.rules.effect.saveProfile = { validSaves: ["NOT_A_SAVE"], selectionPolicy: "FIXED" };
    const badSave = effectFixture({ revise: { "spell.effect.bind": malformed } });
    rejected(effectRequest(badSave, spellEffectAbility(badSave, "spell.effect.bind")));
  });

  it("rejects unsafe outcome data and invalid Formula scaling", () => {
    const direct = EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === "spell.effect.direct_damage")!.payload as unknown as Record<string, unknown>;
    const outcome = cloneJson(direct) as { outcomes: Array<{ data: { operations: unknown } }> } & Record<string, unknown>;
    outcome.outcomes[0]!.data.operations = [{ kind: "EXECUTE_ARBITRARY_CODE", data: {} }];
    const badOutcome = effectFixture({ revise: { "spell.effect.direct_damage": outcome } });
    rejected(effectRequest(badOutcome, spellEffectAbility(badOutcome, "spell.effect.direct_damage")));

    const scaled = cloneJson(direct) as { rules: { effect: { formulas: unknown[] } } } & Record<string, unknown>;
    scaled.rules.effect.formulas = [{ formulaKey: "bad", expression: "unknown(5)", variables: [] }];
    const badFormula = effectFixture({ revise: { "spell.effect.direct_damage": scaled } });
    rejected(effectRequest(badFormula, spellEffectAbility(badFormula, "spell.effect.direct_damage")));
  });
});

describe("M5-WO7 Effect determinism and Ruleset isolation", () => {
  it("produces deep-equal results for the same exact inputs", () => {
    const f = effectFixture();
    const request = effectRequest(f, spellEffectAbility(f, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 3 }), effectCharacter({ pro: 4 }));
    const a = validateEffectUse(request);
    const b = validateEffectUse(request);
    expect(a).toEqual(b);
  });

  it("keeps concurrent R1/R2 Effect evaluation isolated", async () => {
    const r1 = effectFixture({ rulesetId: "87210000-0000-4000-8000-000000000001", manifestId: "87220000-0000-4000-8000-000000000001" });
    const source = r1.bundle.definitions.find((d) => d.canonicalKey === "spell.effect.direct_damage")!.payload as Record<string, unknown>;
    const r2 = effectFixture({ rulesetId: "87310000-0000-4000-8000-000000000001", manifestId: "87320000-0000-4000-8000-000000000001", revise: { "spell.effect.direct_damage": { ...cloneJson(source), costContributions: [{ contributionKey: "effect.damage.dice", currency: "MP", data: { kind: "PER_UNIT", parameter: "dice", amount: 11, includedUnits: 0 } }] } } });
    const [a, b] = await Promise.all([
      Promise.resolve(validateEffectUse(effectRequest(r1, spellEffectAbility(r1, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 2 })))),
      Promise.resolve(validateEffectUse(effectRequest(r2, spellEffectAbility(r2, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 2 })))),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const amount = (r: typeof a.value) => { const c = r.costContributions[0]; return c && "amount" in c ? c.amount : null; };
    expect([amount(a.value), amount(b.value)]).toEqual([4, 11]);
    expect(a.value.provenance.ruleset.rulesetId).not.toBe(b.value.provenance.ruleset.rulesetId);
  });
});
