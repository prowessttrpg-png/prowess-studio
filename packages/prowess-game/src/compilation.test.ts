import { describe, expect, it } from "vitest";
import { orchestrateRulesEvaluation } from "@prowess/rules";
import {
  COMPILATION_ERROR_CODES as X,
  COMPONENT_COMPILERS,
  COMPOSITION_ERROR_CODES as K,
  PROWESS_COMPILATION_CONTRACT_VERSION,
  compileProwessAbility,
  compiledStepKey,
  createProwessDefinitionBundle,
  validateAbilityComposition,
  type ProwessOutcome,
} from "./index.js";
import { assembleCompiledPlan } from "./compilation/assemble.js";
import { ALL_DEFS, MANIFEST_B, RULESET_B, envelopeOf, maneuverComposition, refOf, rulesetOf, spellComposition } from "./testing/fixtures.js";

/**
 * The Prowess → M4 compilation contract (§93–109, §210). Invariants: M5-I010 exact versions only · M5-I011 emits M4
 * EvaluationPlans · M5-I012 no hidden calculation · M5-I013 deterministic step identity & order · M5-I014 source map ·
 * M5-I029 determinism · M5-I028 no input mutation.
 */
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));
const ruleset = rulesetOf(ALL_DEFS);
const bundle = (() => {
  const out = createProwessDefinitionBundle({ ruleset, definitions: ALL_DEFS.map((n) => envelopeOf(n, ruleset)) });
  if (!out.ok) throw new Error(JSON.stringify(out.problems));
  return out.value;
})();
const request = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
  subject: { kind: "SPELL", composition: spellComposition() },
  definitions: JSON.parse(JSON.stringify(bundle)) as unknown,
  ruleset: JSON.parse(JSON.stringify(ruleset)) as unknown,
  ...overrides,
});

describe("compileProwessAbility — the WO1 contract", () => {
  it("compiles an exact Spell and an exact Maneuver to M4 EvaluationPlans; WO1 registers no mechanics, so zero steps", () => {
    for (const [kind, composition] of [["SPELL", spellComposition()], ["MANEUVER", maneuverComposition()]] as const) {
      const out = compileProwessAbility(request({ subject: { kind, composition } }));
      expect(codes(out)).toEqual([]);
      if (!out.ok) continue;
      expect(out.value.contractVersion).toBe(1);
      expect(out.value.subject.kind).toBe(kind);
      expect(out.value.rulesetProvenance).toEqual(bundle.rulesetProvenance);
      expect(out.value.evaluationPlan.steps).toEqual([]);
      expect(out.value.sourceMap.entries).toEqual([]);
      // The output IS an M4 plan: M4 orchestration accepts it as-is.
      const run = orchestrateRulesEvaluation({ evaluationKey: "m5.wo1.contract", contexts: { ruleset }, plan: out.value.evaluationPlan });
      expect(run.success).toBe(true);
    }
    expect(Object.values(COMPONENT_COMPILERS).every((c) => c === null)).toBe(true);
  });

  it("requires an explicit supported contract version", () => {
    expect(codes(compileProwessAbility(request({ contractVersion: 2 })))).toEqual([X.UNSUPPORTED_CONTRACT_VERSION]);
    const missing = request() as Record<string, unknown>;
    delete missing.contractVersion;
    expect(codes(compileProwessAbility(missing))).toContain(X.INVALID_REQUEST);
  });

  it("requires an explicit subject kind that equals the Composition's AbilityKind", () => {
    expect(codes(compileProwessAbility(request({ subject: { kind: "MANEUVER", composition: spellComposition() } })))).toEqual([X.SUBJECT_MISMATCH]);
    expect(codes(compileProwessAbility(request({ subject: { kind: "ABILITY", composition: spellComposition() } })))).toEqual([X.INVALID_REQUEST]);
    const c = spellComposition();
    delete c.abilityKind;
    expect(codes(compileProwessAbility(request({ subject: { kind: "SPELL", composition: c } })))).toEqual([K.ABILITY_KIND_REQUIRED]);
  });

  it("requires the exact bundle of the exact ruleset — re-validated, never trusted by shape", () => {
    const other = rulesetOf(ALL_DEFS, { rulesetId: RULESET_B, manifestId: MANIFEST_B });
    expect(codes(compileProwessAbility(request({ ruleset: other })))).toContain("PROWESS_BUNDLE.RULESET_MISMATCH");
    const forged = { ...bundle, rulesetProvenance: { ...bundle.rulesetProvenance, manifestId: MANIFEST_B } };
    expect(codes(compileProwessAbility(request({ definitions: forged })))).toEqual([X.BUNDLE_RULESET_MISMATCH]);
    expect(codes(compileProwessAbility(request({ definitions: { ...bundle, definitions: [...bundle.definitions, { ...bundle.definitions[0], entityVersionId: "00000000-0000-4000-8000-000000007777" }] } })))).toContain("PROWESS_BUNDLE.NOT_PINNED");
  });

  it("every Composition reference must resolve exactly — no latest / current fallback", () => {
    const c = spellComposition() as { effects: Array<Record<string, unknown>> };
    c.effects[0]!.definition = refOf("spellDamage", 1000);
    expect(codes(compileProwessAbility(request({ subject: { kind: "SPELL", composition: c } })))).toEqual([K.UNRESOLVED_REFERENCE]);
  });

  it("does not mutate its input, and equal requests give deep-equal frozen JSON-safe plans", () => {
    const input = request();
    const snapshot = JSON.stringify(input);
    const a = compileProwessAbility(input);
    const b = compileProwessAbility(request());
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(Object.isFrozen(input)).toBe(false);
    expect(a).toEqual(b);
    expect(a.ok && Object.isFrozen(a.value.evaluationPlan)).toBe(true);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("validates optional Actor / Build / Runtime contexts with M4's own constructors", () => {
    expect(codes(compileProwessAbility(request({ actor: { stats: { divisor: "x" } } })))).toEqual([X.INVALID_REQUEST]);
  });
});

describe("plan assembly — the kernel later component compilers use", () => {
  const composition = (() => {
    const out = validateAbilityComposition(spellComposition(), { bundle });
    if (!out.ok) throw new Error("fixture");
    return out.value;
  })();
  // Neutral FORMULA operations whose program is authored data (not Prowess math). The compiler only copies it.
  const fragments = [
    {
      fragmentKey: "second",
      order: 20,
      operation: "FORMULA",
      input: { program: { expression: "x + y" }, variables: { x: 0, y: 2 } },
      bindings: [{ target: "/variables/x", source: { kind: "FRAGMENT", fragmentKey: "first", pointer: "/data/finalValue" } }],
      role: "derived-example",
      componentKeys: ["damage", "fire"],
      definitions: [refOf("spellDamage"), refOf("spellFire")],
    },
    {
      fragmentKey: "first",
      order: 10,
      operation: "FORMULA",
      input: { program: { expression: "a" }, variables: { a: 0 } },
      bindings: [{ target: "/variables/a", source: { kind: "CONTEXT", context: "ACTOR", pointer: "/stats/value" } }],
      role: "authored-example",
      componentKeys: ["area"],
      definitions: [refOf("spellRadius")],
    },
  ];

  it("derives deterministic step keys, explicit order, M4 bindings and a one-to-one source map", () => {
    const out = assembleCompiledPlan({ composition, bundle, fragments });
    expect(codes(out)).toEqual([]);
    if (!out.ok) return;
    const key = (f: string) => compiledStepKey("SPELL", "composition.spell.example", f);
    expect(out.value.evaluationPlan.steps.map((s) => [s.stepKey, s.order])).toEqual([[key("first"), 10], [key("second"), 20]]);
    expect(out.value.evaluationPlan.steps[1]?.bindings[0]).toEqual({ target: "/variables/x", source: { kind: "STEP", stepKey: key("first"), pointer: "/data/finalValue" } });
    expect(out.value.sourceMap.entries.map((e) => [e.stepKey, e.role, e.componentKeys, e.definitions.map((d) => d.canonicalKey)])).toEqual([
      [key("first"), "authored-example", ["area"], ["spell.targeting.radius"]],
      [key("second"), "derived-example", ["damage", "fire"], ["spell.effect.direct_damage", "spell.trait.fire_conversion"]],
    ]);
    expect(assembleCompiledPlan({ composition, bundle, fragments: [...fragments].reverse() })).toEqual(out);

    // M4 — not the compiler — calculates: the compiled plan runs under the exact context and M4 produces 7 + 2.
    const run = orchestrateRulesEvaluation({ evaluationKey: "m5.wo1.assembly", contexts: { ruleset, actor: { stats: { value: 7 } } }, plan: out.value.evaluationPlan });
    expect(run.success).toBe(true);
    const second = run.data?.steps.find((s) => s.stepKey === key("second"));
    expect((second?.response?.data as { finalValue?: number } | undefined)?.finalValue).toBe(9);
    // …and the plan itself contains no computed result.
    expect(JSON.stringify(out.value.evaluationPlan)).not.toContain("9");
  });

  it("rejects unmapped steps, foreign Definitions, duplicate keys and forward references", () => {
    const one = fragments[1]!;
    expect([...new Set(codes(assembleCompiledPlan({ composition, bundle, fragments: [{ ...one, componentKeys: [] }] })))]).toEqual([X.UNMAPPED_SOURCE]);
    expect(codes(assembleCompiledPlan({ composition, bundle, fragments: [{ ...one, definitions: [refOf("spellDamage")] }] }))).toEqual([X.UNMAPPED_SOURCE]);
    expect(codes(assembleCompiledPlan({ composition, bundle, fragments: [{ ...one, definitions: [refOf("maneuverRadius")] }] }))).toEqual([X.UNMAPPED_SOURCE]);
    expect(codes(assembleCompiledPlan({ composition, bundle, fragments: [one, one] }))).toEqual([X.DUPLICATE_STEP]);
    expect(codes(assembleCompiledPlan({ composition, bundle, fragments: [{ ...fragments[0]!, order: 5 }, one] }))).toEqual([X.UNKNOWN_STEP_REFERENCE]);
    expect(codes(assembleCompiledPlan({ composition, bundle, fragments: [{ ...one, operation: "SPELL_COST" }] }))).toEqual([X.INVALID_FRAGMENT]);
    expect(codes(assembleCompiledPlan({ composition, bundle, fragments: [{ ...one, order: 1.5 }] }))).toEqual([X.INVALID_FRAGMENT]);
  });
});

describe("M4 resource semantics carried forward through compiled plans (§140–141)", () => {
  const composition = (() => {
    const out = validateAbilityComposition(spellComposition(), { bundle });
    if (!out.ok) throw new Error("fixture");
    return out.value;
  })();
  const snapshot = {
    resources: [
      { resourceKey: "r.me", kind: "TEMPORARY_POOL", current: 6, minimum: 0, maximum: 10, reservedCapacity: 0 },
      { resourceKey: "r.mp", kind: "POOL", current: 20, minimum: 0, maximum: 20, reservedCapacity: 0 },
    ],
  };
  const run = (fragment: Record<string, unknown>) => {
    const plan = assembleCompiledPlan({ composition, bundle, fragments: [{ fragmentKey: "f", order: 1, bindings: [], role: "resource-example", componentKeys: ["damage"], definitions: [refOf("spellDamage")], ...fragment }] });
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const result = orchestrateRulesEvaluation({ evaluationKey: "m5.wo1.resources", contexts: { ruleset }, plan: plan.value.evaluationPlan });
    return { plan: plan.value, data: result.data?.steps[0]?.response?.data as Record<string, unknown> };
  };

  it("M5-I023 Mana Efficiency is payment, not cost reduction: listed 17 stays 17 while ME 6 + MP 11 pay it", () => {
    const { plan, data } = run({
      operation: "RESOURCE_PAYMENT_APPLY",
      input: { snapshot, payment: { costKey: "cost.example", listedAmount: 17, sources: [{ resourceKey: "r.me", order: 10 }, { resourceKey: "r.mp", order: 20 }] } },
    });
    expect(data.listedAmount).toBe(17);
    expect((data.allocations as Array<{ resourceKey: string; amountPaid: number }>).map((a) => [a.resourceKey, a.amountPaid])).toEqual([["r.me", 6], ["r.mp", 11]]);
    // The compiled plan carries the authored listed amount only — no reduced / effective cost exists anywhere.
    expect(JSON.stringify(plan)).not.toMatch(/effective|discount|reduced|"11"|:11\b/i);
  });

  it("M5-I024 Mana Lock maps to reserved capacity: reserving never spends current MP", () => {
    const { data } = run({ operation: "RESOURCE_RESERVE_CAPACITY", input: { snapshot, request: { resourceKey: "r.mp", amount: 5 } } });
    const { before, after } = data as { before: { current: number; reservedCapacity: number }; after: { current: number; reservedCapacity: number } };
    expect([before.current, before.reservedCapacity]).toEqual([20, 0]);
    expect([after.current, after.reservedCapacity]).toEqual([20, 5]); // capacity reserved; nothing spent
  });
});
