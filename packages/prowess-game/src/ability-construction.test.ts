import { describe, expect, it } from "vitest";
import {
  ABILITY_SLOT_KINDS,
  COMPOSITION_ERROR_CODES as K,
  DEFINITION_ERROR_CODES as C,
  createProwessDefinitionBundle,
  createProwessDefinitionEnvelope,
  definitionRefOf,
  implementSameContract,
  isSameExactDefinition,
  shareTargetingSemanticShape,
  validateAbilityComposition,
  type ProwessDefinitionEnvelope,
  type ProwessOutcome,
} from "./index.js";
import { ALL_DEFS, DEFS, envelopeOf, maneuverComposition, refOf, rulesetOf, spellComposition, targetingPayload } from "./testing/fixtures.js";

/**
 * Shared Ability Construction (§205–207, §133–138). Invariants: M5-I015 Definition / Composition separation · M5-I016
 * Composition / Runtime separation · M5-I021 multi-Effect Spells · M5-I022 Targeting decides no outcome · M5-I025 shared
 * framework, branch rules · M5-I031–I036 shared contracts, separate catalogs · M5-I038 no cross-branch interchange ·
 * M5-I039 Affinity-assisted Maneuver stays a Maneuver · M5-I040 Ability Condition ≠ status · M5-I028 frozen detached
 * outputs · M5-I035 shared Duration / Condition / Affinity concepts with branch content · M5-I036 AbilityKind decides catalogs.
 */
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));
const env = (name: keyof typeof DEFS): ProwessDefinitionEnvelope => {
  const out = createProwessDefinitionEnvelope(envelopeOf(name));
  if (!out.ok) throw new Error(JSON.stringify(out.problems));
  return out.value;
};
const fullBundle = () => {
  const out = createProwessDefinitionBundle({ ruleset: rulesetOf(ALL_DEFS), definitions: ALL_DEFS.map((n) => envelopeOf(n, rulesetOf(ALL_DEFS))) });
  if (!out.ok) throw new Error(JSON.stringify(out.problems));
  return out.value;
};

describe("Spell and Maneuver compositions share one construction grammar", () => {
  it("accepts a multi-Effect Spell (Damage + Movement) with ordered Effects, a scoped Trait and a Casting Condition", () => {
    const out = validateAbilityComposition(spellComposition(), { bundle: fullBundle() });
    expect(codes(out)).toEqual([]);
    if (!out.ok) return;
    expect(out.value.abilityKind).toBe("SPELL");
    expect(out.value.effects.map((e) => [e.componentKey, e.order])).toEqual([["damage", 10], ["push", 20]]);
    expect(out.value.traits[0]?.appliesTo).toEqual({ scope: "EFFECT_SPECIFIC", componentKey: "damage" });
    expect(Object.isFrozen(out.value.effects[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(out.value))).toEqual(out.value);
  });

  it("accepts a multi-Effect Maneuver (Shockwave + Trip) — a Maneuver is not exactly one Effect", () => {
    const out = validateAbilityComposition(maneuverComposition(), { bundle: fullBundle() });
    expect(codes(out)).toEqual([]);
    if (out.ok) expect(out.value.effects).toHaveLength(2);
  });

  it("preserves authored Effect order explicitly — not array insertion order", () => {
    const c = spellComposition() as { effects: unknown[] };
    c.effects.reverse();
    const out = validateAbilityComposition(c);
    expect(out.ok && out.value.effects.map((e) => e.componentKey)).toEqual(["damage", "push"]);
    const tie = spellComposition() as { effects: Array<Record<string, unknown>> };
    tie.effects[1]!.order = 10;
    expect(codes(validateAbilityComposition(tie))).toEqual([K.AMBIGUOUS_ORDER]);
  });

  it("AbilityKind is explicit and never inferred — not even from a weapon", () => {
    const c = maneuverComposition();
    delete c.abilityKind;
    expect(codes(validateAbilityComposition({ ...c, weapon: { authored: true } }))).toEqual([K.ABILITY_KIND_REQUIRED]);
    expect(codes(validateAbilityComposition({ ...spellComposition(), abilityKind: "SUMMON" }))).toEqual([K.ABILITY_KIND_REQUIRED]);
    expect(codes(validateAbilityComposition({ ...spellComposition(), branch: maneuverComposition().branch }))).toEqual([K.BRANCH_MISMATCH]);
  });

  it("M5-I039 an Affinity-assisted Maneuver with MP-bearing data remains a Maneuver", () => {
    const out = validateAbilityComposition({ ...maneuverComposition(), authority: { mp: "authored" } });
    expect(out.ok && out.value.abilityKind).toBe("MANEUVER");
    expect(out.ok && out.value.affinity?.definition.definitionKind).toBe("AFFINITY");
  });

  it("branch extensions remain distinct: Spell fields are not legal on a Maneuver and vice versa", () => {
    expect(codes(validateAbilityComposition({ ...maneuverComposition(), branch: { kind: "MANEUVER", sustain: {} } }))).toEqual([K.INVALID_COMPOSITION]);
    expect(codes(validateAbilityComposition({ ...spellComposition(), branch: { kind: "SPELL", foundation: null } }))).toEqual([K.INVALID_COMPOSITION]);
  });
});

describe("catalog separation (§133, §136–137, §206 — M5-I033, M5-I034, M5-I035, M5-I036, M5-I038)", () => {
  const swap = (base: Record<string, unknown>, path: "targeting" | "effects" | "traits" | "conditions" | "duration", ref: unknown) => {
    const c = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    const slot = c[path] as Record<string, unknown> | Array<Record<string, unknown>>;
    if (Array.isArray(slot)) slot[0]!.definition = ref;
    else slot.definition = ref;
    return c;
  };
  it.each([
    ["SPELL_TARGETING in a Maneuver", maneuverComposition, "targeting", "spellRadius"],
    ["SPELL_EFFECT in a Maneuver", maneuverComposition, "effects", "spellDamage"],
    ["SPELL_TRAIT in a Maneuver", maneuverComposition, "traits", "spellFire"],
    ["SPELL_CASTING_CONDITION in a Maneuver", maneuverComposition, "conditions", "spellVerbal"],
    ["SPELL_DURATION in a Maneuver", maneuverComposition, "duration", "spellTimed"],
    ["MANEUVER_TARGETING in a Spell", spellComposition, "targeting", "maneuverRadius"],
    ["MANEUVER_EFFECT in a Spell", spellComposition, "effects", "maneuverShockwave"],
    ["MANEUVER_TRAIT in a Spell", spellComposition, "traits", "maneuverKnockback"],
    ["MANEUVER_CONDITION in a Spell", spellComposition, "conditions", "maneuverStationary"],
  ] as const)("rejects %s even though it satisfies the same shared contract", (_label, base, slot, def) => {
    const ref = refOf(def);
    const expected = ABILITY_SLOT_KINDS[base === spellComposition ? "SPELL" : "MANEUVER"][slot];
    expect(implementSameContract(ref.definitionKind, expected)).toBe(true);
    expect(codes(validateAbilityComposition(swap(base(), slot, ref)))).toEqual([K.CROSS_BRANCH_DEFINITION]);
  });

  it("a Spell Casting Condition and a Maneuver Condition share the ABILITY_CONDITION contract with separate kinds", () => {
    const [s, m] = [env("spellVerbal"), env("maneuverStationary")];
    expect(implementSameContract(s.definitionKind, m.definitionKind)).toBe(true);
    expect(s.definitionKind).not.toBe(m.definitionKind);
  });
});

describe("shared Targeting semantics (§134–135, §207 — M5-I022, M5-I031, M5-I032)", () => {
  it("Spell Radius and Maneuver Radius share semantic shape and geometry contract, never exact identity", () => {
    const [s, m] = [env("spellRadius"), env("maneuverRadius")];
    expect(shareTargetingSemanticShape(s, m)).toBe(true);
    expect(Object.keys(s.payload).sort()).toEqual(Object.keys(m.payload).sort()); // one geometry contract
    expect(isSameExactDefinition(definitionRefOf(s), definitionRefOf(m))).toBe(false);
    expect(definitionRefOf(s).definitionKind).toBe("SPELL_TARGETING");
    expect(definitionRefOf(m).definitionKind).toBe("MANEUVER_TARGETING");
    expect(shareTargetingSemanticShape(s, env("spellDamage"))).toBe(false);
  });

  it("isSameExactDefinition compares every identity field — never shape, contract or key suffix", () => {
    const a = refOf("spellRadius");
    expect(isSameExactDefinition(a, { ...a })).toBe(true);
    for (const field of ["entityId", "entityVersionId", "canonicalKey", "definitionKind", "systemFamily"] as const) {
      expect(isSameExactDefinition(a, { ...a, [field]: refOf("maneuverRadius")[field] }), field).toBe(false);
    }
  });

  it("a Targeting Definition cannot carry an Effect, outcome, Save or resolution — Radius implies nothing", () => {
    const e = envelopeOf("spellRadius");
    for (const smuggled of [{ save: "AGILITY" }, { effects: [] }, { damage: { authored: true } }, { resolution: { mode: "SAVING_THROW" } }, { geometry: { onHit: { healing: 1 } } }]) {
      const payload = { ...targetingPayload("RADIUS"), rules: smuggled };
      expect(codes(createProwessDefinitionEnvelope({ ...e, payload })), JSON.stringify(smuggled)).toContain(C.TARGETING_IMPLIES_OUTCOME);
    }
    const radius = env("spellRadius");
    expect(JSON.stringify(radius.payload)).not.toMatch(/save|damage|healing|effect|resolution|condition/i);
  });

  it("a Composition with Targeting and no Effects is structurally representable and carries no outcome", () => {
    const c = { ...spellComposition(), effects: [], traits: [] };
    const out = validateAbilityComposition(c);
    expect(codes(out)).toEqual([]);
    expect(out.ok && out.value.effects).toEqual([]);
  });
});

describe("Ability Conditions are not statuses (§125, §230 — M5-I040)", () => {
  it("rejects an Ability Condition payload that applies a status to the target", () => {
    const e = envelopeOf("maneuverStationary");
    const payload = { restriction: { restrictionKey: "TARGET_MUST_BE_BLOODIED", data: {} }, tradeoff: {}, rules: { appliesStatus: "BLOODIED" } };
    expect(codes(createProwessDefinitionEnvelope({ ...e, payload }))).toEqual([C.CONDITION_APPLIES_STATUS]);
    const ok = createProwessDefinitionEnvelope({ ...e, payload: { restriction: { restrictionKey: "TARGET_MUST_BE_BLOODIED", data: {} }, tradeoff: {} } });
    expect(ok.ok).toBe(true);
  });
});

describe("Trait scope (§45)", () => {
  it("a scoped Trait must name a component of the right slot; ability-wide names none", () => {
    const withTrait = (appliesTo: unknown) => ({ ...spellComposition(), traits: [{ componentKey: "fire", order: 1, definition: refOf("spellFire"), appliesTo }] });
    expect(codes(validateAbilityComposition(withTrait({ scope: "EFFECT_SPECIFIC", componentKey: "area" })))).toEqual([K.INVALID_TRAIT_TARGET]);
    expect(codes(validateAbilityComposition(withTrait({ scope: "EFFECT_SPECIFIC", componentKey: "nope" })))).toEqual([K.INVALID_TRAIT_TARGET]);
    expect(codes(validateAbilityComposition(withTrait({ scope: "ABILITY_WIDE", componentKey: "damage" })))).toEqual([K.INVALID_TRAIT_TARGET]);
    expect(codes(validateAbilityComposition(withTrait({ scope: "TARGETING", componentKey: "area" })))).toEqual([]);
    // With the exact bundle, the authored scope must equal the Trait Definition's own scope (EFFECT_SPECIFIC).
    expect(codes(validateAbilityComposition(withTrait({ scope: "TARGETING", componentKey: "area" }), { bundle: fullBundle() }))).toEqual([K.INVALID_TRAIT_TARGET]);
  });
});

describe("layer separation (§138–139 — M5-I015, M5-I016)", () => {
  it("changing a Composition parameter never mutates the canonical Definition", () => {
    const bundle = fullBundle();
    const before = JSON.stringify(bundle);
    const c = spellComposition() as { targeting: { parameters: Record<string, unknown> } };
    c.targeting.parameters.radius = 99;
    const out = validateAbilityComposition(c, { bundle });
    expect(out.ok).toBe(true);
    expect(JSON.stringify(bundle)).toBe(before);
    expect(Object.isFrozen(bundle.definitions[0]?.payload)).toBe(true);
  });

  it("a Composition holds no runtime state, and runtime changes never mutate a saved Composition", () => {
    expect(codes(validateAbilityComposition({ ...spellComposition(), currentMp: 10 }))).toEqual([K.INVALID_COMPOSITION]);
    const saved = validateAbilityComposition(spellComposition());
    if (!saved.ok) throw new Error("fixture");
    const snapshot = JSON.stringify(saved.value);
    const runtime = { mp: 20, reserved: 0 };
    runtime.mp = runtime.mp - 5; // runtime spending lives outside the Composition
    expect(JSON.stringify(saved.value)).toBe(snapshot);
    expect(() => {
      (saved.value.effects as unknown as unknown[]).push({});
    }).toThrow();
  });

  it("references must resolve exactly in the supplied bundle", () => {
    const c = spellComposition() as { targeting: { definition: unknown } };
    c.targeting.definition = refOf("spellRadius", 1000); // a version the Ruleset does not pin
    expect(codes(validateAbilityComposition(c, { bundle: fullBundle() }))).toEqual([K.UNRESOLVED_REFERENCE]);
  });
});
