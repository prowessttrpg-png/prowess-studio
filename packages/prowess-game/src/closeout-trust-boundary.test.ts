import { describe, expect, it, vi } from "vitest";
import { createBundleWithinCheckedRequest, createProwessDefinitionBundle } from "./bundle/bundle.js";
import { compileAbilityDefinition } from "./ability/compile.js";
import { evaluateSpellCost } from "./ability/spell-cost.js";
import { compileCoreResolution } from "./core/compile.js";
import { activeMagicFixture } from "./testing/active-magic-fixtures.js";

vi.setConfig({ testTimeout: 900_000 });

/**
 * M5-CLOSEOUT-02 R1/R3 trust-boundary characterization (written and passing BEFORE bundle reuse existed). Whatever
 * the engine reuses internally, a caller must observe: the factory's exact bundle and a JSON reconstruction of it give
 * deep-equal outcomes; anything reconstructed, re-shaped, mutated or mixed is validated in full and refused exactly as
 * before; no flag in caller data changes validation; and nested compilers called directly still refuse unsafe data.
 */
const f = activeMagicFixture();
const L = activeMagicFixture({ manaLock: { kind: "FIXED", amount: 12 }, heavyMp: 17 });
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const spell = (): Record<string, unknown> => {
  const { execution: _e, ...rest } = { ...f.ability("fixture.wo13.spell.sustained"), definitions: f.bundle, ruleset: f.ruleset } as Record<string, unknown>;
  void _e;
  return rest;
};

describe("M5-CLOSEOUT-02 trust boundary", () => {
  it("the factory's exact bundle and its JSON reconstruction give deep-equal outcomes, repeatedly", () => {
    const exact = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: f.bundle.definitions });
    const rebuilt = createProwessDefinitionBundle({ ruleset: json(f.ruleset), definitions: json(f.bundle.definitions) });
    expect(exact).toEqual(rebuilt);
    expect(createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: f.bundle.definitions })).toEqual(exact);
    expect(Object.isFrozen(exact)).toBe(true);
    const a = compileAbilityDefinition(spell());
    expect(compileAbilityDefinition({ ...spell(), definitions: json(f.bundle) })).toEqual(a);
    expect(compileAbilityDefinition(spell())).toEqual(a);
  });

  it("the same exact definitions under another Ruleset are refused, not reused", () => {
    const other = { ...json(f.ruleset), rulesetId: "00000000-0000-4000-8000-00000000abcd" };
    const foreign = createProwessDefinitionBundle({ ruleset: other, definitions: f.bundle.definitions });
    expect(foreign).toEqual(createProwessDefinitionBundle({ ruleset: other, definitions: json(f.bundle.definitions) }));
    expect(foreign.ok).toBe(false);
    expect(evaluateSpellCost({ ...spell(), ruleset: other })).toEqual(evaluateSpellCost({ ...spell(), ruleset: other, definitions: json(f.bundle) }));
    expect(evaluateSpellCost({ ...spell(), ruleset: other }).ok).toBe(false);
    // a context with the same identity but different content is a different input: still compared in full
    expect(createProwessDefinitionBundle({ ruleset: L.ruleset, definitions: f.bundle.definitions })).toEqual(createProwessDefinitionBundle({ ruleset: L.ruleset, definitions: json(f.bundle.definitions) }));
  });

  it("a shape-alike reconstruction carrying a tampered definition is validated in full and refused", () => {
    const tampered = json(f.bundle) as unknown as { definitions: Record<string, unknown>[] };
    tampered.definitions[1] = { ...tampered.definitions[1], entityVersionId: "00000000-0000-4000-8000-0000000fffff" };
    const out = compileAbilityDefinition({ ...spell(), definitions: tampered });
    expect(out.ok).toBe(false);
    const legacy = json(f.bundle) as unknown as { definitions: { payload: Record<string, unknown> }[] };
    legacy.definitions[2]!.payload.note = "Emission";
    expect(compileAbilityDefinition({ ...spell(), definitions: legacy }).ok).toBe(false);
  });

  it("caller-supplied trust markers change nothing", () => {
    const tampered = json(f.bundle) as unknown as { definitions: Record<string, unknown>[] };
    tampered.definitions[1] = { ...tampered.definitions[1], entityVersionId: "00000000-0000-4000-8000-0000000fffff" };
    const marked = { ...tampered, validated: true, trusted: true, sealed: true };
    expect(compileAbilityDefinition({ ...spell(), definitions: marked }).ok).toBe(false);
    expect(compileAbilityDefinition({ ...spell(), definitions: { ...f.bundle, validated: true } })).toEqual(compileAbilityDefinition({ ...spell(), definitions: { ...json(f.bundle), validated: true } }));
    expect(createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: f.bundle.definitions, validated: true }).ok).toBe(false);
  });

  it("an exact factory bundle inside an otherwise unsafe request is still refused at every boundary", () => {
    const withGetter = { ...spell() };
    Object.defineProperty(withGetter, "actor", { get: () => ({}), enumerable: true });
    expect(compileAbilityDefinition(withGetter).ok).toBe(false);
    expect(evaluateSpellCost(withGetter).ok).toBe(false);
    expect(compileCoreResolution({ ...withGetter }).ok).toBe(false);
    const cyclic = (definitions: unknown): Record<string, unknown> => {
      const c: Record<string, unknown> = { ...spell(), definitions };
      c.self = c;
      return c;
    };
    expect(compileAbilityDefinition(cyclic(f.bundle))).toEqual(compileAbilityDefinition(cyclic(json(f.bundle))));
    expect(compileAbilityDefinition(cyclic(f.bundle)).ok).toBe(false);
    const shared = { ...spell(), extra: f.bundle.definitions[0] };
    expect(compileAbilityDefinition(shared)).toEqual(compileAbilityDefinition({ ...spell(), definitions: json(f.bundle), extra: json(f.bundle.definitions[0]) }));
  });

  it("a frozen look-alike that was never produced by the factory is not trusted", () => {
    const lookalike = Object.freeze(json(f.bundle.definitions).map((d: object) => Object.freeze(d)));
    expect(createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: lookalike })).toEqual(createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: json(f.bundle.definitions) }));
    const badFrozen = Object.freeze([...json(f.bundle.definitions), { not: "an envelope" }]);
    expect(createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: badFrozen }).ok).toBe(false);
  });

  it("R3: the internal continuation equals the public factory for clean input and falls back to its exact problems otherwise", () => {
    const defs = json(f.bundle.definitions);
    expect(createBundleWithinCheckedRequest(json(f.ruleset), defs, true)).toEqual(createProwessDefinitionBundle({ ruleset: json(f.ruleset), definitions: defs }));
    expect(createBundleWithinCheckedRequest(f.ruleset, defs, false)).toEqual(createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: defs }));
    const getter = json(f.ruleset) as unknown as Record<string, unknown>;
    Object.defineProperty(getter, "rulesetId", { get: () => "x", enumerable: true });
    expect(createBundleWithinCheckedRequest(getter, defs, false)).toEqual(createProwessDefinitionBundle({ ruleset: getter, definitions: defs }));
    const nan = { ...json(f.ruleset), extra: Number.NaN };
    expect(createBundleWithinCheckedRequest(nan, defs, false)).toEqual(createProwessDefinitionBundle({ ruleset: nan, definitions: defs }));
    expect(createBundleWithinCheckedRequest(nan, defs, false).ok).toBe(false);
    const tampered = json(f.bundle.definitions) as unknown as Record<string, unknown>[];
    tampered[0] = { ...tampered[0], canonicalKey: "fixture.other.key" };
    expect(createBundleWithinCheckedRequest(f.ruleset, tampered, false)).toEqual(createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: tampered }));
    expect(createBundleWithinCheckedRequest(f.ruleset, tampered, false).ok).toBe(false);
  });
});
