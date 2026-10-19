import { describe, expect, it } from "vitest";
import {
  constructionFixture,
  constructionProfile,
  maneuverComposition,
  spellComposition,
  CONSTRUCTION_COMPONENTS,
} from "./testing/ability-construction-fixtures.js";
import { compileConstructionWith, runConstruction } from "./testing/ability-construction-run.js";

const subject = (
  composition: Record<string, unknown>,
  character: Record<string, unknown>,
  options: { readonly exemption?: string | null; readonly accessGrants?: readonly Record<string, unknown>[] } = {},
) => ({
  kind: "ABILITY_CONSTRUCTION",
  subjectKey: "build.test",
  composition,
  character,
  signature: { exemption: options.exemption === undefined || options.exemption === null ? null : { sourceKey: options.exemption } },
  accessGrants: options.accessGrants ?? [],
});

const legal = (result: ReturnType<typeof runConstruction>) => result.reading.legal;
const capacity = (result: ReturnType<typeof runConstruction>) => result.plan.outputs.capacity;

describe("M5-WO5 shared Ability Construction goldens", () => {
  it("M5-I156: Spell construction accepts Arcane Trained+ without requiring an Affinity Authority path", () => {
    const f = constructionFixture();
    const r = runConstruction(subject(spellComposition(f, { authority: "ARCANE_AUTHORITY", affinity: null }), constructionProfile(f, { arcane: "TRAINED" })), f);
    expect(legal(r)).toBe(true);
    expect(capacity(r)).toMatchObject({ authority: "ARCANE_AUTHORITY", authorityRank: "TRAINED", baseEffectCapacity: 1, baseTraitCapacity: 1 });
  });

  it("M5-I156: a relevant Trained Affinity can construct a Spell with no Arcane training", () => {
    const f = constructionFixture();
    const character = constructionProfile(f, { arcane: "UNTRAINED", affinities: [{ key: "affinity.evocation", rank: "TRAINED", role: "PRIMARY" }] });
    const r = runConstruction(subject(spellComposition(f, { authority: "AFFINITY_AUTHORITY", effects: ["spellDamage"] }), character), f);
    expect(legal(r)).toBe(true);
    expect(capacity(r)).toMatchObject({ authority: "AFFINITY_AUTHORITY", authorityRank: "TRAINED", castingConditionCapacity: 0 });
  });

  it("M5-I156: no Trained Arcane and no Trained governing Affinity cannot construct a Spell", () => {
    const f = constructionFixture();
    const arcane = runConstruction(subject(spellComposition(f, { authority: "ARCANE_AUTHORITY", affinity: null }), constructionProfile(f)), f);
    expect(legal(arcane)).toBe(false);
    const affinity = runConstruction(
      subject(
        spellComposition(f, { authority: "AFFINITY_AUTHORITY" }),
        constructionProfile(f, { affinities: [{ key: "affinity.evocation", rank: "NONE", role: "PRIMARY" }] }),
      ),
      f,
    );
    expect(legal(affinity)).toBe(false);
  });

  it("Affinity Authority requires every component to be aligned or explicitly granted access", () => {
    const f = constructionFixture();
    const character = constructionProfile(f, { affinities: [{ key: "affinity.evocation", rank: "TRAINED", role: "PRIMARY" }] });
    const blocked = runConstruction(subject(spellComposition(f, { authority: "AFFINITY_AUTHORITY", effects: ["spellPlain"] }), character), f);
    expect(legal(blocked)).toBe(false);
    const allowed = runConstruction(
      subject(spellComposition(f, { authority: "AFFINITY_AUTHORITY", effects: ["spellPlain"] }), character, {
        accessGrants: [{ componentKey: "effect1", sourceKey: "rule.special_affinity_access" }],
      }),
      f,
    );
    expect(legal(allowed)).toBe(true);
  });

  it("Arcane Authority capacity is 1/2/3 Effects and 1/2/3 base Traits", () => {
    for (const [rank, effects, traits] of [["TRAINED", 1, 1], ["EXPERT", 2, 2], ["MASTER", 3, 3]] as const) {
      const f = constructionFixture();
      const r = runConstruction(subject(spellComposition(f, { authority: "ARCANE_AUTHORITY", affinity: null }), constructionProfile(f, { arcane: rank })), f);
      expect(capacity(r).baseEffectCapacity).toBe(effects);
      expect(capacity(r).baseTraitCapacity).toBe(traits);
    }
  });

  it("Trait exchange is Spell-only, one unused Effect for one Trait, and a Spell retains one Effect", () => {
    const f = constructionFixture();
    const expert = runConstruction(
      subject(
        spellComposition(f, { authority: "ARCANE_AUTHORITY", affinity: null, traitTrades: 1, effects: ["spellDamage"], traits: ["spellTrait", "spellTrait", "spellTrait"] }),
        constructionProfile(f, { arcane: "EXPERT" }),
      ),
      f,
    );
    expect(legal(expert)).toBe(true);
    expect(capacity(expert)).toMatchObject({ traitTrades: 1, effectSlotsUsed: 1, traitSlotsUsed: 3 });

    const trained = runConstruction(
      subject(spellComposition(f, { authority: "ARCANE_AUTHORITY", affinity: null, traitTrades: 1 }), constructionProfile(f, { arcane: "TRAINED" })),
      f,
    );
    expect(legal(trained)).toBe(false);

    const master = runConstruction(
      subject(
        spellComposition(f, { authority: "ARCANE_AUTHORITY", affinity: null, traitTrades: 2, effects: ["spellDamage"], traits: ["spellTrait", "spellTrait", "spellTrait", "spellTrait", "spellTrait"] }),
        constructionProfile(f, { arcane: "MASTER" }),
      ),
      f,
    );
    expect(legal(master)).toBe(true);
  });

  it("M5-I157: Casting Condition capacity comes only from Arcane Rank regardless of Spell Authority", () => {
    const f = constructionFixture();
    const character = constructionProfile(f, { arcane: "TRAINED", affinities: [{ key: "affinity.evocation", rank: "MASTER", role: "PRIMARY" }] });
    const one = runConstruction(
      subject(spellComposition(f, { authority: "AFFINITY_AUTHORITY", conditions: ["spellCondition"] }), character),
      f,
    );
    expect(legal(one)).toBe(true);
    expect(capacity(one).castingConditionCapacity).toBe(1);

    const two = runConstruction(
      subject(spellComposition(f, { authority: "AFFINITY_AUTHORITY", conditions: ["spellCondition", "spellCondition"] }), character),
      f,
    );
    expect(legal(two)).toBe(false);

    const noArcane = runConstruction(
      subject(
        spellComposition(f, { authority: "AFFINITY_AUTHORITY", conditions: ["spellCondition"] }),
        constructionProfile(f, { arcane: "UNTRAINED", affinities: [{ key: "affinity.evocation", rank: "MASTER", role: "PRIMARY" }] }),
      ),
      f,
    );
    expect(legal(noArcane)).toBe(false);
  });

  it("Martial Rank is the Martial Skill rank: Trained/Expert/Master Rank Value and Effect/Condition capacity 1/2/3", () => {
    for (const [rank, count] of [["TRAINED", 1], ["EXPERT", 2], ["MASTER", 3]] as const) {
      const f = constructionFixture();
      const effects = Array.from({ length: count }, () => "maneuverEffect" as const);
      const conditions = Array.from({ length: count }, () => "maneuverCondition" as const);
      const r = runConstruction(subject(maneuverComposition(f, { effects, conditions }), constructionProfile(f, { martial: rank })), f);
      expect(legal(r)).toBe(true);
      expect(capacity(r).maneuverConditionCapacity).toBe(count);
    }
    const f = constructionFixture();
    expect(legal(runConstruction(subject(maneuverComposition(f), constructionProfile(f, { martial: "UNTRAINED" })), f))).toBe(false);
  });

  it("every permanent candidate consumes exactly one Signature slot unless an explicit authored exemption exists", () => {
    const f = constructionFixture();
    expect(legal(runConstruction(subject(spellComposition(f, { affinity: null }), constructionProfile(f, { arcane: "TRAINED", prowess: 4, signatureSlotsUsed: 3 })), f))).toBe(true);
    expect(legal(runConstruction(subject(spellComposition(f, { affinity: null }), constructionProfile(f, { arcane: "TRAINED", prowess: 4, signatureSlotsUsed: 4 })), f))).toBe(false);
    expect(
      legal(
        runConstruction(
          subject(spellComposition(f, { affinity: null }), constructionProfile(f, { arcane: "TRAINED", prowess: 4, signatureSlotsUsed: 4 }), { exemption: "rule.temporary_copy_slot_exemption" }),
          f,
        ),
      ),
    ).toBe(true);
  });

  it("stacking is Definition-opt-in: stacks share one Effect slot but obey their authored limit", () => {
    const payload = CONSTRUCTION_COMPONENTS.spellDamage.payload;
    const f = constructionFixture({
      revise: {
        "spell.effect.wo5_damage": {
          ...payload,
          rules: { ...(payload.rules as Record<string, unknown>), stacking: { stackable: true, limit: { kind: "FIXED", maximum: 2 } } },
        },
      },
    });
    const two = runConstruction(
      subject(spellComposition(f, { affinity: null, effects: ["spellDamage", "spellDamage"] }), constructionProfile(f, { arcane: "TRAINED" })),
      f,
    );
    expect(legal(two)).toBe(true);
    expect(capacity(two).effectSlotsUsed).toBe(1);
    expect(two.plan.outputs.stackGroups[0]).toMatchObject({ stackable: true, slotCount: 1, limit: 2 });

    const three = runConstruction(
      subject(spellComposition(f, { affinity: null, effects: ["spellDamage", "spellDamage", "spellDamage"] }), constructionProfile(f, { arcane: "TRAINED" })),
      f,
    );
    expect(legal(three)).toBe(false);
  });

  it("a non-stackable repeated Effect consumes a slot for every use", () => {
    const f = constructionFixture();
    const r = runConstruction(
      subject(spellComposition(f, { affinity: null, effects: ["spellDamage", "spellDamage"] }), constructionProfile(f, { arcane: "TRAINED" })),
      f,
    );
    expect(capacity(r).effectSlotsUsed).toBe(2);
    expect(legal(r)).toBe(false);
  });

  it("component Skill/Affinity prerequisites compile as M4 Requirements instead of hidden access checks", () => {
    const payload = CONSTRUCTION_COMPONENTS.spellDamage.payload;
    const f = constructionFixture({
      revise: {
        "spell.effect.wo5_damage": {
          ...payload,
          rules: { ...(payload.rules as Record<string, unknown>), accessRequirements: { kind: "SKILL_RANK", skillKey: "skill.arcana", minimumRank: "EXPERT" } },
        },
      },
    });
    const trained = runConstruction(subject(spellComposition(f, { affinity: null }), constructionProfile(f, { arcane: "TRAINED" })), f);
    expect(legal(trained)).toBe(false);
    const expert = runConstruction(subject(spellComposition(f, { affinity: null }), constructionProfile(f, { arcane: "EXPERT" })), f);
    expect(legal(expert)).toBe(true);
    expect(expert.plan.outputs.componentRequirementStepKeys).toHaveLength(1);
  });

  it("construction arithmetic is emitted as M4 Formula/Requirement steps, not precomputed compiler totals", () => {
    const f = constructionFixture();
    const compiled = compileConstructionWith(
      subject(spellComposition(f, { authority: "ARCANE_AUTHORITY", affinity: null, traitTrades: 1, effects: ["spellDamage"], traits: ["spellTrait", "spellTrait", "spellTrait"] }), constructionProfile(f, { arcane: "EXPERT" })),
      f,
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const operations = compiled.value.evaluationPlan.steps.map((step) => step.operation);
    expect(operations).toContain("FORMULA");
    expect(operations).toContain("REQUIREMENT");
    expect(compiled.value.evaluationPlan.steps.some((step) => step.operation === "MODIFIER" || step.operation.startsWith("RESOURCE_"))).toBe(false);
  });
});
