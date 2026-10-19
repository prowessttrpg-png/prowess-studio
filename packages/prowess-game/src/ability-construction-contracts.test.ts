import { describe, expect, it } from "vitest";
import { compileAbilityConstruction } from "./construction/legality.js";
import {
  CONSTRUCTION_MANIFEST_2,
  CONSTRUCTION_RULESET_2,
  constructionFixture,
  constructionKeywordCatalog,
  constructionProfile,
  spellComposition,
} from "./testing/ability-construction-fixtures.js";
import { compileConstructionWith, runConstruction } from "./testing/ability-construction-run.js";

const subject = (composition: Record<string, unknown>, character: Record<string, unknown>) => ({
  kind: "ABILITY_CONSTRUCTION",
  subjectKey: "build.contract",
  composition,
  character,
  signature: { exemption: null },
  accessGrants: [],
});

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cleanRequest = () => {
  const f = constructionFixture();
  return {
    f,
    request: {
      contractVersion: 1,
      subject: subject(spellComposition(f, { affinity: null }), constructionProfile(f, { arcane: "TRAINED" })),
      definitions: f.bundle,
      ruleset: f.ruleset,
      keywords: constructionKeywordCatalog(),
    } as Record<string, unknown>,
  };
};

describe("M5-WO5 Ability Construction contracts", () => {
  it("is deterministic and JSON-safe for the same exact Ruleset / Definition / character / composition input", () => {
    const f = constructionFixture();
    const request = {
      contractVersion: 1,
      subject: subject(spellComposition(f, { affinity: null }), constructionProfile(f, { arcane: "EXPERT" })),
      definitions: f.bundle,
      ruleset: f.ruleset,
      keywords: constructionKeywordCatalog(),
    };
    const a = compileAbilityConstruction(request);
    const b = compileAbilityConstruction(json(request));
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("detaches compiled outputs from later caller mutation", () => {
    const f = constructionFixture();
    const composition = spellComposition(f, { affinity: null }) as Record<string, unknown>;
    const character = constructionProfile(f, { arcane: "EXPERT" });
    const out = compileConstructionWith(subject(composition, character), f);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const before = JSON.stringify(out.value);
    (composition.effects as unknown[]).push({ componentKey: "evil", order: 999 });
    character.prowess = 1;
    expect(JSON.stringify(out.value)).toBe(before);
    expect(Object.isFrozen(out.value)).toBe(true);
  });

  it("rejects unsafe / non-plain input rather than executing getters or functions", () => {
    const { request: getterRequest } = cleanRequest();
    let getterCalls = 0;
    Object.defineProperty(getterRequest.subject as object, "evil", { enumerable: true, get: () => (getterCalls += 1) });
    const getterResult = compileAbilityConstruction(getterRequest);
    expect(getterResult.ok).toBe(false);
    expect(getterCalls).toBe(0);

    // Build a separate clean request for the function case. Never stringify/clone the getter-bearing object: doing so
    // would execute the getter in the test itself and invalidate the side-effect safety assertion.
    const { request: functionRequest } = cleanRequest();
    functionRequest.bad = () => 1;
    const functionResult = compileAbilityConstruction(functionRequest);
    expect(functionResult.ok).toBe(false);
  });

  it("fails exact-Ruleset mixing instead of resolving by canonical key or latest/current", () => {
    const r1 = constructionFixture();
    const r2 = constructionFixture({ rulesetId: CONSTRUCTION_RULESET_2, manifestId: CONSTRUCTION_MANIFEST_2 });
    const request = {
      contractVersion: 1,
      subject: subject(spellComposition(r1, { affinity: null }), constructionProfile(r1, { arcane: "TRAINED" })),
      definitions: r1.bundle,
      ruleset: r2.ruleset,
      keywords: constructionKeywordCatalog(),
    };
    expect(compileAbilityConstruction(request).ok).toBe(false);
  });

  it("historical R1 construction remains identical after a later R2 changes exact construction capacity content", () => {
    const r1 = constructionFixture();
    const s1 = subject(spellComposition(r1, { affinity: null }), constructionProfile(r1, { arcane: "EXPERT" }));
    const first = runConstruction(s1, r1);

    const baseRule = r1.bundle.definitions.find((d) => d.canonicalKey === "ability.construction_rule");
    expect(baseRule).toBeDefined();
    const payload = json(baseRule!.payload) as { ranks: Array<{ rank: string; arcane: { effectCapacity: number } }> };
    const expert = payload.ranks.find((x) => x.rank === "EXPERT")!;
    expert.arcane.effectCapacity = 1;
    const r2 = constructionFixture({
      rulesetId: CONSTRUCTION_RULESET_2,
      manifestId: CONSTRUCTION_MANIFEST_2,
      revise: { "ability.construction_rule": payload as unknown as Record<string, unknown> },
    });
    const secondR1 = runConstruction(s1, r1);
    expect(secondR1).toEqual(first);

    const r2Result = runConstruction(
      subject(spellComposition(r2, { affinity: null, effects: ["spellDamage", "spellHealing"] }), constructionProfile(r2, { arcane: "EXPERT" })),
      r2,
    );
    expect(r2Result.reading.legal).toBe(false);
    expect(first.plan.rulesetProvenance.rulesetId).not.toBe(r2Result.plan.rulesetProvenance.rulesetId);
  });

  it("two exact Rulesets evaluate side by side without shared mutable construction state", async () => {
    const r1 = constructionFixture();
    const baseRule = r1.bundle.definitions.find((d) => d.canonicalKey === "ability.construction_rule")!;
    const changed = json(baseRule.payload) as { ranks: Array<{ rank: string; arcane: { traitCapacity: number } }> };
    changed.ranks.find((x) => x.rank === "TRAINED")!.arcane.traitCapacity = 2;
    const r2 = constructionFixture({ rulesetId: CONSTRUCTION_RULESET_2, manifestId: CONSTRUCTION_MANIFEST_2, revise: { "ability.construction_rule": changed as unknown as Record<string, unknown> } });

    const [a, b] = await Promise.all([
      Promise.resolve(runConstruction(subject(spellComposition(r1, { affinity: null }), constructionProfile(r1, { arcane: "TRAINED" })), r1)),
      Promise.resolve(runConstruction(subject(spellComposition(r2, { affinity: null }), constructionProfile(r2, { arcane: "TRAINED" })), r2)),
    ]);
    expect(a.plan.outputs.capacity.baseTraitCapacity).toBe(1);
    expect(b.plan.outputs.capacity.baseTraitCapacity).toBe(2);
  });
});
