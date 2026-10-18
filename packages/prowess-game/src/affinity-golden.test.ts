import { describe, expect, it } from "vitest";
import { buildExplanation } from "@prowess/rules";
import { DERIVED_STATISTICS } from "./vocabulary/core.js";
import { runCore } from "./testing/core-run.js";
import { payForAction, resources, runRuntime, runtimeCharacter } from "./testing/runtime-run.js";
import { abilityOf, affinityFixture, AFFINITY_MANIFEST_2, AFFINITY_RULESET_2, type AffinityFixture, type ProfileEntry, type SpellSpec } from "./testing/affinity-fixtures.js";
import { runAffinity } from "./testing/affinity-run.js";

/**
 * M5-WO4 GOLDEN fixtures (PAS-10 M5-WO4 §175–§198). Every number asserted here was produced by the frozen M4 engine — the
 * KEYWORD set, the Strength / Weakness REQUIREMENTs, the MAX Weakness selection and the ordered REDUCE_PERCENT /
 * INCREASE_PERCENT on the listed cost — from the canonical Affinity content file. @prowess/game only chose and wired
 * the operations.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I111 / M5-I112 Movement and Sprint · M5-I117–I118
 * progression (see contracts) · M5-I121 rank discount · M5-I122 one Strength discount · M5-I123 exact Keywords ·
 * M5-I124 / M5-I125 / M5-I126 Weakness percentages, highest only, all visible · M5-I127 / M5-I128 both, Strength first ·
 * M5-I129 no rounding · M5-I130 Weakness never prohibits · M5-I131 / M5-I132 contributors · M5-I136–I141 Authority and
 * access · M5-I146 / M5-I147 historical reproducibility · M5-I150 determinism and isolation.
 * Guard index (docs/architecture/m5-invariants.json): M5-I111 · M5-I112 · M5-I117 · M5-I121 · M5-I122 · M5-I123 · M5-I124 · M5-I125 · M5-I126 · M5-I127 · M5-I128 · M5-I129 · M5-I130 · M5-I131 · M5-I132 · M5-I136 · M5-I137 · M5-I138 · M5-I139 · M5-I140 · M5-I141 · M5-I145 · M5-I146 · M5-I147 · M5-I150.
 */
const F = affinityFixture();
const evocation = (rank: string): ProfileEntry[] => [{ affinity: "affinity.evocation", rank, role: "PRIMARY" }];
const cost = (spec: SpellSpec, baseCost: number, profile: readonly ProfileEntry[], f: AffinityFixture = F) =>
  runAffinity({ kind: "SPELL_AFFINITY_COST", subjectKey: "golden", composition: abilityOf(f, spec), costTarget: "LISTED_MP_COST", baseCost }, { profile }, f);
const finalCost = (r: ReturnType<typeof cost>) => r.reading.cost?.affinityAdjustedCost;

describe("§175–§177 Movement / Sprint carry-forward (post-WO3 designer amendment — M5-I111, M5-I112)", () => {
  it("§175 Base Movement 5 ft, AGI 4 → Movement 20 ft (M4 FORMULA over canonical content)", () => {
    const r = runCore({ kind: "DERIVED_STATISTICS", subjectKey: "move", statistics: ["BASE_MOVEMENT", "MOVEMENT"] }, runtimeCharacter({ AGI: 4 }));
    expect([r.derived("BASE_MOVEMENT"), r.derived("MOVEMENT")]).toEqual([5, 20]);
  });

  it("§176 Movement 20 ft → Sprint 80 ft; a second Sprint is again Movement × 4 (never × 4 × 4)", () => {
    const agi4 = runtimeCharacter({ AGI: 4 });
    // AGI 4 has AP Capacity 4, so the second Sprint is paid from a state holding 3 AP and the first grant's 80 ft.
    const grants: number[] = [];
    let allowance = 0;
    for (const ap of [4, 3]) {
      const { confirmation } = payForAction({ actionKey: "SPRINT", window: "OWN_TURN" }, { character: agi4, resources: resources(["AP", ap], ["MOVEMENT_ALLOWANCE", allowance]) });
      expect(confirmation.status).toBe("PAID");
      const after = runRuntime({ kind: "ACTION_FOLLOW_ON", subjectKey: "after", receipt: confirmation }, { character: agi4, resources: confirmation.resources });
      grants.push(after.reading.movementGrant as number);
      allowance = after.current("MOVEMENT_ALLOWANCE") as number;
    }
    expect(grants).toEqual([80, 80]);
    expect(allowance).toBe(160); // linear: 80 + 80, never 20 × 4 × 4
  });

  it("§177 no TOTAL_MOVEMENT / FINAL_MOVEMENT statistic exists; Sprint reads MOVEMENT itself", () => {
    expect(DERIVED_STATISTICS as readonly string[]).toEqual(expect.arrayContaining(["BASE_MOVEMENT", "MOVEMENT"]));
    expect(DERIVED_STATISTICS as readonly string[]).not.toContain("TOTAL_MOVEMENT");
    expect(DERIVED_STATISTICS as readonly string[]).not.toContain("FINAL_MOVEMENT");
  });
});

describe("§178 Affinity Rank Strength discount NONE 0% · TRAINED 10% · EXPERT 20% · MASTER 30% (M5-I121)", () => {
  it.each([
    ["NONE", 0, 100],
    ["TRAINED", 10, 90],
    ["EXPERT", 20, 80],
    ["MASTER", 30, 70],
  ])("%s → −%i%% (100 → %i)", (rank, percent, after) => {
    const r = cost({ effects: ["directDamage"] }, 100, evocation(rank));
    expect(r.reading.alignment?.effectiveStrengthDiscountPercent).toBe(percent);
    expect(finalCost(r)).toBe(after);
  });
});

describe("§179–§180 Affinity Authority capacity TRAINED 1 · EXPERT 2 · MASTER 3 Effects / base Traits (M5-I137, M5-I138)", () => {
  it.each([
    ["TRAINED", 1],
    ["EXPERT", 2],
    ["MASTER", 3],
  ])("%s → %i", (rank, capacity) => {
    const r = runAffinity({ kind: "AFFINITY_AUTHORITY", subjectKey: "cap", composition: abilityOf(F, { authority: { authority: "AFFINITY_AUTHORITY" }, effects: ["directDamage"] }) }, { profile: evocation(rank) });
    expect([r.reading.authority?.effectCapacity?.capacity, r.reading.authority?.traitCapacity?.capacity]).toEqual([capacity, capacity]);
    expect(r.reading.authority?.valid).toBe(true);
  });
});

describe("§181–§190 Spell MP Affinity fragment (listed cost — Strength once, highest Weakness once, Strength first, no rounding)", () => {
  it("§181 Evocation Expert, DIRECT_DAMAGE, base 20 → 16", () => {
    const r = cost({ effects: ["directDamage"] }, 20, evocation("EXPERT"));
    expect(finalCost(r)).toBe(16);
    expect(r.reading.alignment?.alignment).toBe("STRENGTH");
  });

  it("§182 DIRECT_DAMAGE + AREA_EFFECT (Radius Targeting contributes AREA_EFFECT explicitly) → 16, never 12.8 (M5-I122)", () => {
    const r = cost({ targeting: "radiusArea", effects: ["directDamage"] }, 20, evocation("EXPERT"));
    expect(r.reading.alignment?.strengths.filter((s) => s.matched).map((s) => s.ruleKey)).toEqual(["DIRECT_DAMAGE", "AREA_EFFECT"]);
    expect(finalCost(r)).toBe(16);
    expect(finalCost(r)).not.toBe(12.8);
    expect(r.reading.cost?.strength).toEqual(expect.objectContaining({ operation: "REDUCE_PERCENT", percent: 20, applied: true, before: 20, after: 16 }));
  });

  it("§183 Evocation, HEALING, base 20 → +30% → 26", () => {
    const r = cost({ effects: ["healing"] }, 20, evocation("TRAINED"));
    expect([r.reading.alignment?.selectedWeaknessPercent, finalCost(r)]).toEqual([30, 26]);
    expect(r.reading.alignment?.alignment).toBe("WEAKNESS");
  });

  it("§184 / §93 HEALING + BUFF → +30% only; the +20% match stays visible (M5-I125, M5-I126)", () => {
    const r = cost({ effects: ["healing", "buff"] }, 20, evocation("TRAINED"));
    expect(r.reading.alignment?.weaknesses.filter((w) => w.matched).map((w) => [w.ruleKey, w.activationPenaltyPercent])).toEqual([
      ["HEALING", 30],
      ["BUFF_OR_DEBUFF", 20],
    ]);
    expect(r.reading.alignment?.selectedWeaknessPercent).toBe(30);
    expect(finalCost(r)).toBe(26);
    expect(r.reading.cost?.weakness).toEqual(expect.objectContaining({ operation: "INCREASE_PERCENT", percent: 30, applied: true, before: 20, after: 26 }));
  });

  it("§185 / §95 Evocation Expert DIRECT_DAMAGE + HEALING, base 100 → 80 → 104 — sequential, never netted to 110 (M5-I127, M5-I128)", () => {
    const r = cost({ effects: ["directDamage", "healing"] }, 100, evocation("EXPERT"));
    expect(r.reading.alignment?.alignment).toBe("STRENGTH_AND_WEAKNESS");
    expect(r.reading.cost?.strength).toEqual(expect.objectContaining({ before: 100, after: 80 }));
    expect(r.reading.cost?.weakness).toEqual(expect.objectContaining({ before: 80, after: 104 }));
    expect(finalCost(r)).toBe(104);
    expect(finalCost(r)).not.toBe(110);
  });

  it("§186 base 17, Evocation Trained −10% → 15.3 exactly; the Affinity stage never rounds (M5-I129)", () => {
    const r = cost({ effects: ["directDamage"] }, 17, evocation("TRAINED"));
    expect(finalCost(r)).toBe(15.3);
  });

  it("§187 Divination PERSISTENT_EFFECT +15% exactly (never coerced to 10 or 20) → 115", () => {
    const r = cost({ affinity: "affinity.divination", effects: ["persistent"] }, 100, [{ affinity: "affinity.divination", rank: "TRAINED", role: "PRIMARY" }]);
    expect(r.reading.alignment?.weaknesses.find((w) => w.matched)).toEqual(expect.objectContaining({ ruleKey: "PERSISTENT_EFFECT", activationPenaltyPercent: 15, severity: null }));
    expect(r.reading.alignment?.selectedWeaknessPercent).toBe(15);
    // M4 percentage arithmetic is IEEE-754 binary floating point: 100 × (1 + 15/100) = 114.99999999999999. The value is
    // exactly what M4 produced; WO4 rounds nothing (rounding is the later cost pipeline — M5-SC-028).
    expect(finalCost(r)).toBeCloseTo(115, 10);
    expect(finalCost(r)).toBe(100 * (1 + 15 / 100));
    expect([110, 120]).not.toContain(finalCost(r));
  });

  it("§188 Level 1 Evocation Primary at rank NONE: Strength matched, discount 0% → 20 (M5-I117, M5-I121)", () => {
    const r = cost({ effects: ["directDamage"] }, 20, evocation("NONE"));
    expect(r.reading.alignment?.strengths.find((s) => s.ruleKey === "DIRECT_DAMAGE")?.matched).toBe(true);
    expect(r.reading.alignment?.effectiveStrengthDiscountPercent).toBe(0);
    expect(finalCost(r)).toBe(20);
  });

  it("§189 rank NONE still carries the Weakness identity: HEALING → 26", () => {
    expect(finalCost(cost({ effects: ["healing"] }, 20, evocation("NONE")))).toBe(26);
  });

  it("§190 / §103–§104 NEUTRAL content: no Strength, no Weakness, cost unchanged", () => {
    const r = cost({ effects: ["light"] }, 20, evocation("MASTER"));
    expect(r.reading.alignment?.alignment).toBe("NEUTRAL");
    expect(finalCost(r)).toBe(20);
    expect(r.reading.cost?.strength?.applied).toBe(false);
    expect(r.reading.cost?.weakness?.applied).toBe(false);
  });

  it("§101 / §130 a Weakness changes cost; it never makes the composition invalid (M5-I130)", () => {
    const r = cost({ effects: ["healing", "buff"] }, 40, evocation("MASTER"));
    expect(r.run.executionStatus).toBe("COMPLETE");
    expect(r.run.steps.every((s) => s.response?.success === true)).toBe(true);
    expect(r.reading.alignment?.issues).toEqual([]);
    expect(finalCost(r)).toBe(52);
  });
});

describe("§191 / §54 / §64 exact Keyword identity only (M5-I123, M5-I132)", () => {
  it("§191 a different Keyword identity whose display name reads “direct damage” does not match DIRECT_DAMAGE", () => {
    const r = cost({ effects: ["lookalike"] }, 20, evocation("EXPERT"));
    expect(r.reading.alignment?.alignment).toBe("NEUTRAL");
    expect(finalCost(r)).toBe(20);
  });

  it("§63–§64 a Radius Targeting contributes AREA_EFFECT only when its Definition says so; RADIUS geometry alone never does", () => {
    const plain = cost({ targeting: "radiusPlain", effects: ["light"] }, 20, evocation("EXPERT"));
    const area = cost({ targeting: "radiusArea", effects: ["light"] }, 20, evocation("EXPERT"));
    expect([plain.reading.alignment?.alignment, finalCost(plain)]).toEqual(["NEUTRAL", 20]);
    expect([area.reading.alignment?.alignment, finalCost(area)]).toEqual(["STRENGTH", 16]);
    expect(area.reading.alignment?.strengths.find((s) => s.matched)?.matchedKeywords[0]?.contributors).toEqual([
      expect.objectContaining({ componentKey: "targeting", contract: "TARGETING", definition: expect.objectContaining({ canonicalKey: "spell.targeting.radius_area" }) }),
    ]);
  });

  it("§65 a Trait-added Strength Keyword aligns; a Trait-added Weakness Keyword triggers the Weakness (M5-I131)", () => {
    const strength = cost({ effects: ["light"], traits: [{ trait: "areaTrait", appliesTo: "effect1" }] }, 20, evocation("EXPERT"));
    const weakness = cost({ effects: ["directDamage"], traits: [{ trait: "healingTrait", appliesTo: "effect1" }] }, 100, evocation("EXPERT"));
    expect(finalCost(strength)).toBe(16);
    expect(weakness.reading.alignment?.weaknesses.find((w) => w.matched)?.matchedKeywords[0]?.contributors[0]).toEqual(expect.objectContaining({ componentKey: "trait1", contract: "TRAIT" }));
    expect(finalCost(weakness)).toBe(104);
  });
});

describe("§131 / §156 explanation through M4 — no separate Affinity explanation engine", () => {
  it("base 20 · Evocation Expert · DIRECT_DAMAGE −20% → 16 · HEALING +30% → 20.8, each with its exact source Definition", () => {
    const r = cost({ effects: ["directDamage", "healing"] }, 20, evocation("EXPERT"));
    const a = r.reading.alignment;
    expect(a?.governingAffinity).toEqual(expect.objectContaining({ identity: "EVOCATION", rank: "EXPERT" }));
    expect(a?.strengths.find((s) => s.matched)?.matchedKeywords[0]).toEqual(
      expect.objectContaining({ canonicalKey: "keyword.direct_damage", contributors: [expect.objectContaining({ definition: expect.objectContaining({ canonicalKey: "spell.effect.direct_damage" }) })] }),
    );
    expect(a?.weaknesses.find((w) => w.matched)?.matchedKeywords[0]).toEqual(
      expect.objectContaining({ canonicalKey: "keyword.healing", contributors: [expect.objectContaining({ definition: expect.objectContaining({ canonicalKey: "spell.effect.healing" }) })] }),
    );
    expect([r.reading.cost?.strength?.after, r.reading.cost?.weakness?.after]).toEqual([16, 20.8]);
    const step = (key: string | null) => r.run.steps.find((s) => s.stepKey === key)?.response;
    const explanation = buildExplanation({
      explanationKey: "affinity.cost",
      contributions: [
        { contributionKey: "keywords", order: 1, kind: "KEYWORD", response: step(r.plan.outputs.keywords) },
        { contributionKey: "strength", order: 2, kind: "REQUIREMENT", response: step(r.plan.outputs.strengths[0]?.stepKey ?? null) },
        { contributionKey: "weakness", order: 3, kind: "MODIFIER", response: step(r.plan.outputs.weaknessSelection) },
        { contributionKey: "cost", order: 4, kind: "MODIFIER", response: step(r.plan.outputs.cost?.stepKey ?? null) },
      ],
    });
    expect(explanation.success).toBe(true);
  });
});

describe("§192–§196 Affinity Authority and access", () => {
  const authority = (rank: string, effects: SpellSpec["effects"], extra: Record<string, unknown> = {}, authorityData: Record<string, unknown> = { authority: "AFFINITY_AUTHORITY" }) =>
    runAffinity({ kind: "AFFINITY_AUTHORITY", subjectKey: "auth", composition: abilityOf(F, { authority: authorityData, effects }), ...extra }, { profile: evocation(rank) }).reading.authority;

  it("§192 Evocation Expert, Affinity Authority, 2 Effects within the Strengths → valid", () => {
    const a = authority("EXPERT", ["directDamage", "directDamage"]);
    expect(a).toEqual(expect.objectContaining({ authority: "AFFINITY_AUTHORITY", rankSatisfied: true, valid: true }));
    expect(a?.effectCapacity).toEqual({ capacity: 2, count: 2, satisfied: true });
  });

  it("§193 Evocation Expert, 3 Effects → capacity not satisfied — a valid result, nothing truncated", () => {
    const a = authority("EXPERT", ["directDamage", "directDamage", "directDamage"]);
    expect(a?.effectCapacity).toEqual({ capacity: 2, count: 3, satisfied: false });
    expect(a?.valid).toBe(false);
    expect(a?.effectAccess).toHaveLength(3);
  });

  it("§194 Arcana Expert + Affinity Expert under Affinity Authority → 2 Effects, never 4 (M5-I139)", () => {
    const a = authority("EXPERT", ["directDamage", "directDamage"], {}, { authority: "AFFINITY_AUTHORITY", arcanaRank: "EXPERT" });
    expect(a?.effectCapacity?.capacity).toBe(2);
    expect(authority("EXPERT", ["directDamage", "directDamage", "directDamage", "directDamage"], {}, { authority: "AFFINITY_AUTHORITY", arcanaRank: "EXPERT" })?.effectCapacity?.satisfied).toBe(false);
  });

  it("§107 / §38 rank NONE governs no Affinity Authority: rank floor not met, no capacity", () => {
    const a = authority("NONE", ["directDamage"]);
    expect([a?.rankSatisfied, a?.effectCapacity, a?.traitCapacity, a?.valid]).toEqual([false, null, null, false]);
  });

  it("§110–§112 a Weakness Effect is accepted with its penalty; a NEUTRAL Effect needs an explicit access grant", () => {
    expect(authority("TRAINED", ["healing"])?.effectAccess).toEqual([{ componentKey: "effect1", satisfied: true, granted: null }]);
    expect(authority("TRAINED", ["light"])?.effectAccess).toEqual([{ componentKey: "effect1", satisfied: false, granted: null }]);
    expect(authority("TRAINED", ["light"], { accessGrants: [{ componentKey: "effect1", sourceKey: "feature.test_access" }] })?.effectAccess).toEqual([{ componentKey: "effect1", satisfied: true, granted: "feature.test_access" }]);
  });

  const access = (owned: readonly ProfileEntry[], minimumRank: string, extra: Record<string, unknown> = {}) =>
    runAffinity({ kind: "AFFINITY_ACCESS", subjectKey: "trait", requirements: [{ requirementKey: "TRAIT_ACCESS", affinity: F.ref("affinity.evocation"), minimumRank, requiredKeywords: [] }], ...extra }, { profile: owned }).reading.access;

  it("§195 Trait requires Evocation Expert; character owns Evocation Expert → satisfied", () => {
    expect(access(evocation("EXPERT"), "EXPERT")).toEqual([expect.objectContaining({ requirementKey: "TRAIT_ACCESS", satisfied: true })]);
  });

  it("§196 Trait requires Evocation Expert; character owns Evocation Trained → not satisfied (not engine corruption)", () => {
    const r = runAffinity({ kind: "AFFINITY_ACCESS", subjectKey: "trait", requirements: [{ requirementKey: "TRAIT_ACCESS", affinity: F.ref("affinity.evocation"), minimumRank: "EXPERT", requiredKeywords: [] }] }, { profile: evocation("TRAINED") });
    expect(r.reading.access[0]?.satisfied).toBe(false);
    expect(r.run.steps.every((s) => s.response?.success === true)).toBe(true);
  });

  it("an unowned Affinity prerequisite is simply not satisfied; a Keyword prerequisite reads the Ability's explicit Keywords", () => {
    expect(access([{ affinity: "affinity.conjuration", rank: "MASTER", role: "PRIMARY" }], "TRAINED")[0]?.satisfied).toBe(false);
    const withKeyword = (effects: SpellSpec["effects"]) =>
      runAffinity(
        { kind: "AFFINITY_ACCESS", subjectKey: "kw", composition: abilityOf(F, { effects }), requirements: [{ requirementKey: "AREA_ACCESS", affinity: F.ref("affinity.evocation"), minimumRank: "TRAINED", requiredKeywords: ["keyword.direct_damage"] }] },
        { profile: evocation("TRAINED") },
      ).reading.access[0]?.satisfied;
    expect([withKeyword(["directDamage"]), withKeyword(["light"])]).toEqual([true, false]);
  });

  it("§121 Maneuver access reuses Affinity identity, rank and Keyword alignment (no Spell Effect identity)", () => {
    const r = runAffinity({ kind: "AFFINITY_ALIGNMENT", subjectKey: "m", composition: abilityOf(F, { kind: "MANEUVER", effects: ["maneuverStrike"] }) }, { profile: evocation("TRAINED") });
    expect(r.plan.subject.abilityKind).toBe("MANEUVER");
    expect(r.reading.alignment?.alignment).toBe("STRENGTH");
    expect(r.reading.cost).toBeNull();
  });
});

describe("§197–§198 historical reproducibility and Ruleset isolation (M5-I146, M5-I147, M5-I150)", () => {
  const evocationV1 = F.bundle.definitions.find((d) => d.canonicalKey === "affinity.evocation")?.payload as Record<string, unknown>;
  // R2 pins a NEW EntityVersion of Evocation whose test Strength content differs (DIRECT_DAMAGE no longer a Strength).
  const r2 = () =>
    affinityFixture({
      rulesetId: AFFINITY_RULESET_2,
      manifestId: AFFINITY_MANIFEST_2,
      revise: {
        "affinity.evocation": { ...evocationV1, strengths: [{ strengthKey: "AREA_EFFECT", matchAny: ["keyword.area_effect"] }] },
        "affinity.rank_rule": { ...(F.bundle.definitions.find((d) => d.canonicalKey === "affinity.rank_rule")?.payload as Record<string, unknown>), ranks: [
          { rank: "NONE", order: 0, strengthDiscountPercent: 0, authority: null },
          { rank: "TRAINED", order: 1, strengthDiscountPercent: 15, authority: { effectCapacity: 1, traitCapacity: 1 } },
          { rank: "EXPERT", order: 2, strengthDiscountPercent: 25, authority: { effectCapacity: 2, traitCapacity: 2 } },
          { rank: "MASTER", order: 3, strengthDiscountPercent: 35, authority: { effectCapacity: 3, traitCapacity: 3 } },
        ] },
      },
    });

  it("§197 R1 (Evocation v1: DIRECT_DAMAGE Strength, Expert 20%) gives the same result and provenance before and after R2 exists", () => {
    const before = cost({ effects: ["directDamage"] }, 20, evocation("EXPERT"));
    const other = r2();
    const later = cost({ effects: ["directDamage"] }, 20, evocation("EXPERT"));
    expect(JSON.parse(JSON.stringify(later))).toEqual(JSON.parse(JSON.stringify(before)));
    expect(finalCost(later)).toBe(16);
    expect(other.ref("affinity.evocation").entityVersionId).not.toBe(F.ref("affinity.evocation").entityVersionId);
    expect(other.ref("affinity.evocation").entityId).toBe(F.ref("affinity.evocation").entityId);
  });

  it("§198 R1 and R2 evaluated together each use their own exact Affinity Definition and rank rule", () => {
    const f2 = r2();
    const runs = [
      cost({ effects: ["directDamage"], targeting: "radiusArea" }, 100, evocation("EXPERT")),
      cost({ effects: ["directDamage"], targeting: "radiusArea" }, 100, evocation("EXPERT"), f2),
      cost({ effects: ["directDamage"] }, 100, evocation("EXPERT")),
      cost({ effects: ["directDamage"] }, 100, evocation("EXPERT"), f2),
    ];
    expect(runs.map(finalCost)).toEqual([80, 75, 80, 100]);
    expect(runs.map((r) => r.plan.rulesetProvenance.rulesetId)).toEqual([F.ruleset.rulesetId, f2.ruleset.rulesetId, F.ruleset.rulesetId, f2.ruleset.rulesetId]);
    expect(runs[1]?.reading.alignment?.governingAffinity.affinity.entityVersionId).toBe(f2.ref("affinity.evocation").entityVersionId);
  });
});
