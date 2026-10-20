import { describe, expect, it } from "vitest";
import { compileAbilityTargeting } from "./targeting/compile.js";
import { COMPOSITION_ERROR_CODES as M, TARGETING_ERROR_CODES as T } from "./definition/codes.js";
import { codes } from "./testing/core-run.js";
import { T_FIXTURE, maneuverWith, measureOf, runTargeting, spellWith, targetingRequest } from "./testing/targeting-fixtures.js";

/**
 * M5-WO6 golden fixtures (PAS-10 M5-WO6 §129–§148). Every distance is produced by an M4 FORMULA step over authored
 * content; every bound by an M4 REQUIREMENT. @prowess/game only chose and wired the operations.
 *
 * Guard index (docs/architecture/m5-invariants.json): M5-I159 Targeting decides where / how, never outcome · M5-I160 no
 * Attack Roll / Save / Save Stat from Targeting · M5-I161 one Targeting slot shared by every Effect · M5-I162 Spell and
 * Maneuver Targeting stay distinct families · M5-I163 Projectile canonical, base MP deferred (M5-SC-039) · M5-I164
 * Trigger / Glyph-Anchor are add-ons · M5-I165 default Spell Range 15 ft × PER · M5-I166 range ≠ area · M5-I167 Line
 * length 15 ft × PRO, width deferred (M5-SC-040) · M5-I168 Cone 10 ft × PRO · M5-I169 Radius / Zone / Aura 5 ft × PRO ·
 * M5-I173 Maneuver Radius = Martial Rank Base × STR · M5-I174 no STR-band table · M5-I175 geometry through M4 Formula.
 */
const F = T_FIXTURE();
const spell = (key: string, stats: Record<string, number> = { PER: 4, PRO: 4, STR: 4 }, parameters: Record<string, unknown> = {}) => runTargeting(targetingRequest(F, spellWith(F, `spell.targeting.${key}`, { parameters }), { stats }));
const maneuver = (key: string, martial: string, stats: Record<string, number>, parameters: Record<string, unknown> = {}) => runTargeting(targetingRequest(F, maneuverWith(F, `maneuver.targeting.${key}`, { parameters }), { stats, martial }));
const noResolution = (r: ReturnType<typeof spell>) => {
  const text = JSON.stringify([r.plan.evaluationPlan, r.result]);
  expect(text).not.toMatch(/ATTACK_ROLL|SAVING_THROW|attackRoll|savingThrow|saveStat|"save"|AGILITY|damage|healing/i);
};

describe("§129–§130 / M5-I165–I169 Spell range and area — content Formulas executed by M4", () => {
  it("§129 PER 4 → default Spell Range 60 ft; PRO 4 → Line 60 · Cone 40 · Radius 20 · Zone 20 · Aura 20 ft", () => {
    expect(spell("single_target").result.range).toEqual({ model: "DEFAULT_SPELL_RANGE", value: 60, baseRange: 60, unit: "ft", ruleText: null });
    expect(measureOf(spell("line"), "LENGTH")?.value).toBe(60);
    expect(measureOf(spell("cone"), "LENGTH")?.value).toBe(40);
    for (const k of ["radius", "zone", "aura"]) expect(measureOf(spell(k), "RADIUS")?.value, k).toBe(20);
  });

  it("§130 / M5-I166 PER 5, PRO 3 Radius: placement Range 75 ft and Radius 15 ft are two separate values", () => {
    const r = spell("radius", { PER: 5, PRO: 3 });
    expect([r.result.range.value, measureOf(r, "RADIUS")?.value]).toEqual([75, 15]);
    const rangeStep = r.plan.evaluationPlan.steps.find((s) => s.stepKey === r.plan.outputs.range.stepKey);
    const radiusStep = r.plan.evaluationPlan.steps.find((s) => s.stepKey === r.plan.outputs.measures[0]?.stepKey);
    expect(rangeStep?.stepKey).not.toBe(radiusStep?.stepKey);
  });

  it("§24 / §202 default Spell Range reuses the WO2 BASE_RANGE statistic (15 × PER) — one rule, not two", () => {
    const r = spell("single_target", { PER: 7, PRO: 4 });
    expect([r.result.range.baseRange, r.result.range.value]).toEqual([105, 105]);
    expect(r.plan.sourceMap.entries.find((e) => e.stepKey === r.plan.outputs.range.baseRangeStepKey)?.definitions.map((d) => d.canonicalKey)).toEqual(["core.derived.base_range"]);
  });

  it("§64 a range extension is a declared STEPS parameter: +2 steps → +30 ft, listed at +2 MP per 15 ft (never priced here)", () => {
    const r = spell("single_target", { PER: 4, PRO: 4 }, { rangeExtension: 2 });
    expect(r.result.range.value).toBe(90);
    expect(r.result.cost.scaling).toEqual([{ contributionKey: "targeting.range_extension", kind: "PER_STEP", currency: "MP", parameter: "rangeExtension", amount: 2, step: { size: 15, unit: "ft" }, values: null, selected: 2 }]);
  });

  it("§137 PRO 3 → Cone 30 ft · §138 PRO 6 → Radius 30 ft · §139 PRO 5 → Zone 25 ft (no Duration inferred) · §140 PRO 4 → Aura 20 ft", () => {
    expect(measureOf(spell("cone", { PER: 4, PRO: 3 }), "LENGTH")?.value).toBe(30);
    expect(measureOf(spell("radius", { PER: 4, PRO: 6 }), "RADIUS")?.value).toBe(30);
    const zone = spell("zone", { PER: 4, PRO: 5 });
    expect(measureOf(zone, "RADIUS")?.value).toBe(25);
    expect(JSON.stringify([zone.result.geometry, zone.result.range, zone.result.targetCount, zone.result.cost, zone.plan.evaluationPlan])).not.toMatch(/duration|rounds|sustain|manaLock/i);
    const aura = spell("aura", { PER: 4, PRO: 4 });
    expect([measureOf(aura, "RADIUS")?.value, aura.result.source, aura.result.placement]).toEqual([20, { source: "CASTER", selection: "DEFAULT", allowed: ["CASTER", "SUMMON", "OBJECT", "ANCHOR"] }, "FOLLOWS_SOURCE"]);
  });

  it("§136 / M5-I167 PRO 4 Line: length 60 ft; width is the authored rule text, DEFERRED_PENDING_CANON (M5-SC-040) — no number", () => {
    const r = spell("line");
    expect(measureOf(r, "WIDTH")).toEqual({ measure: "WIDTH", status: "DEFERRED_PENDING_CANON", value: null, unit: null, conflictKey: "M5-SC-040", ruleText: "5 ft wide per 2 Prowess" });
    expect(r.result.deferred).toEqual([{ field: "geometry.width", status: "DEFERRED_PENDING_CANON", conflictKey: "M5-SC-040" }]);
    expect(r.plan.evaluationPlan.steps.filter((s) => s.stepKey.endsWith("geometry.width"))).toEqual([]);
    expect(r.result.cost.scaling.map((s) => [s.parameter, s.amount, s.step])).toEqual([["lengthExtension", 3, { size: 10, unit: "ft" }], ["widthExtension", 4, { size: 5, unit: "ft" }]]);
  });
});

describe("§131–§135 / §143–§144 Self, Touch, Single, Multi, Projectile — and Targeting never resolves", () => {
  it("§131 SELF: base 0 MP, one target (the caster), range model SELF, no area, no Attack Roll", () => {
    const r = spell("self");
    expect([r.result.cost.base, r.result.targetCount.count, r.result.range.model, r.result.geometry, r.result.validTargets]).toEqual([{ status: "LISTED", currency: "MP", amount: 0, contributionKey: "targeting.base" }, 1, "SELF", [], ["SELF"]]);
    noResolution(r);
  });

  it("§132 TOUCH: base 1 MP, one target; an unwilling target never makes Targeting add an Attack Roll step", () => {
    const r = spell("touch");
    expect([r.result.cost.base, r.result.targetCount.count, r.result.range.model, r.result.deliveryFamily]).toEqual([{ status: "LISTED", currency: "MP", amount: 1, contributionKey: "targeting.base" }, 1, "TOUCH", "DIRECT_ATTACK_DELIVERY"]);
    expect(r.plan.evaluationPlan.steps.map((s) => s.operation)).toEqual([]);
    noResolution(r);
  });

  it("§133 / §144 SINGLE_TARGET at PER 4: base 3 MP, range 60 ft, one target — and no Attack Roll", () => {
    const r = spell("single_target");
    expect([r.result.cost.base.status === "LISTED" && r.result.cost.base.amount, r.result.range.value, r.result.targetCount]).toEqual([3, 60, { kind: "ONE", count: 1, minimum: null, status: "FIXED", satisfied: true }]);
    expect([r.result.lineOfSight, r.result.lineOfEffect, r.result.cover]).toEqual(["REQUIRED", "REQUIRED", "EXPOSED_TO_RESOLUTION"]);
    noResolution(r);
  });

  it("§134 MULTI_TARGET, targetCount 3: stays MULTI_TARGET, each target addressable, no chain resolution; +1 target listed at +3 MP", () => {
    const r = spell("multi_target", { PER: 4, PRO: 4 }, { targetCount: 3 });
    expect([r.result.status, r.result.targeting.semanticShape, r.result.targetCount]).toEqual(["VALID", "MULTI_TARGET", { kind: "SELECTED", count: 3, minimum: 2, status: "SELECTED", satisfied: true }]);
    expect(r.result.cost.scaling.find((s) => s.kind === "PER_ADDITIONAL_TARGET")).toEqual(expect.objectContaining({ amount: 3, selected: 3 }));
    expect(JSON.stringify(r.plan)).not.toMatch(/chain|EFFECT_CHAIN/i);
  });

  it("§41–§42 Multi-Target: no invented base count; an explicit count of 1 is INVALID by an M4 Requirement", () => {
    expect(spell("multi_target").result.targetCount).toEqual({ kind: "SELECTED", count: null, minimum: 2, status: "NOT_SELECTED", satisfied: true });
    const one = spell("multi_target", { PER: 4, PRO: 4 }, { targetCount: 1 });
    expect([one.result.status, one.result.problems]).toEqual(["INVALID", ["cardinality.targetCount"]]);
  });

  it("§135 / M5-I163 PROJECTILE at PER 4: one target, range 60 ft, base cost DEFERRED_PENDING_CANON (M5-SC-039) — no invented 2 MP", () => {
    const r = spell("projectile");
    expect([r.result.targeting.semanticShape, r.result.targetCount.count, r.result.range.value]).toEqual(["PROJECTILE", 1, 60]);
    expect(r.result.cost.base).toEqual({ status: "DEFERRED_PENDING_CANON", currency: "MP", conflictKey: "M5-SC-039", contributionKey: "targeting.base" });
    expect(r.result.deferred).toEqual([{ field: "cost.base", status: "DEFERRED_PENDING_CANON", conflictKey: "M5-SC-039" }]);
    noResolution(r);
  });

  it("§45 Projectile and Single Target share one-target cardinality but are distinct exact Definitions", () => {
    const [p, s] = [spell("projectile"), spell("single_target")];
    expect(p.result.targeting.definition.entityId).not.toBe(s.result.targeting.definition.entityId);
    expect([p.result.targeting.semanticShape, s.result.targeting.semanticShape]).toEqual(["PROJECTILE", "SINGLE_TARGET"]);
  });

  it("§143 / M5-I160 Radius Targeting alone produces no Save Profile, Save Stat or Agility Save", () => {
    noResolution(spell("radius"));
  });

  it("§148 known Targeting base contributions: Self 0 · Touch 1 · Single 3 · Multi 5 · Line 5 · Cone 5 · Radius 6 · Zone 8 · Aura 6 · Projectile deferred", () => {
    const base = (k: string) => {
      const b = spell(k, { PER: 4, PRO: 4 }, k === "multi_target" ? { targetCount: 2 } : {}).result.cost.base;
      return b.status === "LISTED" ? b.amount : b.status;
    };
    expect(["self", "touch", "single_target", "multi_target", "line", "cone", "radius", "zone", "aura", "projectile"].map(base)).toEqual([0, 1, 3, 5, 5, 5, 6, 8, 6, "DEFERRED_PENDING_CANON"]);
  });
});

describe("§141–§142 / M5-I164 Trigger-Based and Glyph / Anchor are add-ons", () => {
  it("§141 a base SPELL_TARGETING TRIGGERED is not a canonical base Targeting Type", () => {
    expect(codes(compileAbilityTargeting(targetingRequest(F, spellWith(F, "spell.targeting.legacy_trigger"))))).toEqual([T.TARGETING_ADD_ON_AS_BASE]);
  });
  it("§142 a base SPELL_TARGETING ANCHOR is an add-on category only", () => {
    expect(codes(compileAbilityTargeting(targetingRequest(F, spellWith(F, "spell.targeting.legacy_anchor"))))).toEqual([T.TARGETING_ADD_ON_AS_BASE]);
  });
});

describe("§145–§147 / M5-I162 / M5-I173–I174 Maneuver Radius and branch separation", () => {
  it("§90 / §145 Maneuver Radius = Martial Rank Base × STR: Trained 4 → 20 · Expert 4 → 40 · Master 4 → 60 · Master 10 → 150 · Expert 5 → 50 ft", () => {
    const radius = (martial: string, str: number) => measureOf(maneuver("radius", martial, { STR: str }, { originMode: "THROWN_IMPACT" }), "RADIUS")?.value;
    expect([radius("TRAINED", 4), radius("EXPERT", 4), radius("MASTER", 4), radius("MASTER", 10), radius("EXPERT", 5)]).toEqual([20, 40, 60, 150, 50]);
  });

  it("§91 / M5-I174 the superseded STR bands are never executed: Trained STR 2 → 10 ft (not 5), STR 7 → 35 ft (not 15)", () => {
    const radius = (str: number) => measureOf(maneuver("radius", "TRAINED", { STR: str }), "RADIUS")?.value;
    expect([radius(2), radius(7)]).toEqual([10, 35]);
  });

  it("a Martial rank with no authored base (UNTRAINED) emits no radius — nothing guessed", () => {
    expect(measureOf(maneuver("radius", "UNTRAINED", { STR: 4 }), "RADIUS")).toEqual({ measure: "RADIUS", status: "NOT_AUTHORED_AT_RANK", value: null, unit: null, conflictKey: null, ruleText: null });
  });

  it("§146 same semantic RADIUS, different exact Definitions and formulas: Spell PRO 5 → 25 ft; Maneuver Expert STR 5 → 50 ft", () => {
    const s = spell("radius", { PER: 4, PRO: 5, STR: 5 });
    const m = maneuver("radius", "EXPERT", { PRO: 5, STR: 5 });
    expect([measureOf(s, "RADIUS")?.value, measureOf(m, "RADIUS")?.value]).toEqual([25, 50]);
    expect([s.result.targeting.definitionKind, m.result.targeting.definitionKind]).toEqual(["SPELL_TARGETING", "MANEUVER_TARGETING"]);
    const programs = [s, m].map((r) => (r.plan.evaluationPlan.steps.find((x) => x.stepKey.endsWith("geometry.radius"))?.input.program as { expression: string }).expression);
    expect(programs).toEqual(["5 * pro", "rank_base * str"]);
  });

  it("§147 a SPELL_TARGETING Radius inside a Maneuver composition fails with the existing CROSS_BRANCH_DEFINITION", () => {
    const m = maneuverWith(F, "maneuver.targeting.radius");
    (m as { targeting: unknown }).targeting = { componentKey: "targeting", definition: F.ref("spell.targeting.radius"), parameters: {} };
    expect(codes(compileAbilityTargeting(targetingRequest(F, m, { martial: "EXPERT" })))).toContain(M.CROSS_BRANCH_DEFINITION);
  });

  it("§82–§83 / M5-I172 Maneuver Targeting carries no cost and no Save Profile; the Radius origin is chosen explicitly or left to the Effect", () => {
    const r = maneuver("radius", "EXPERT", { STR: 5 });
    expect([r.result.cost, r.result.origin]).toEqual([{ base: { status: "NOT_APPLICABLE" }, scaling: [] }, { mode: null, selection: "EFFECT_DECIDED", allowed: ["THROWN_IMPACT", "RANGED_IMPACT", "PROJECTILE_IMPACT", "PERFORMER"] }]);
    expect(maneuver("radius", "EXPERT", { STR: 5 }, { originMode: "PERFORMER" }).result.origin.selection).toBe("EXPLICIT");
    noResolution(r);
  });

  it("§78 / §84 a Foundation's normal Targeting is explicit content: weapon attack + SINGLE_TARGET compatible; + RADIUS needs the Conversion Effect (an explicit modifier)", () => {
    expect(maneuver("single_target", "TRAINED", { STR: 4 }).result.compatibility.find((c) => c.componentKey === "foundation")?.status).toBe("COMPATIBLE");
    const radius = maneuver("radius", "EXPERT", { STR: 4 });
    expect([radius.result.status, radius.result.compatibility.find((c) => c.componentKey === "foundation")?.status]).toEqual(["INVALID", "INCOMPATIBLE"]);
    const converted = runTargeting(targetingRequest(F, maneuverWith(F, "maneuver.targeting.radius"), { martial: "EXPERT" }, { targetingModifiers: [{ componentKey: "foundation", sourceKey: "maneuver.effect.radius_conversion" }] }));
    expect([converted.result.status, converted.result.compatibility.find((c) => c.componentKey === "foundation")?.status]).toEqual(["VALID", "MODIFIED_BY_EXPLICIT_RULE"]);
  });

  it("§94–§95 Chain and Zone geometry are Effect-defined: no jump count, no damage, no duration in Targeting", () => {
    const chain = maneuver("chain", "MASTER", { STR: 4 });
    const zone = maneuver("zone", "MASTER", { STR: 4 });
    expect([chain.result.targetCount.kind, chain.result.geometry, zone.result.geometry.map((g) => g.status), zone.result.range.model]).toEqual(["CHAIN", [], ["EFFECT_DEFINED"], "EFFECT_DEFINED"]);
  });
});

describe("§72–§77 / M5-I161 / M5-I171 shared Targeting and exact compatibility", () => {
  const withEffects = (targetingKey: string, effects: string[]) => runTargeting(targetingRequest(F, spellWith(F, targetingKey, { effects })));
  it("every Effect of a multi-Effect Spell is checked against the ONE Spell Targeting (by exact key or semantic token)", () => {
    const r = withEffects("spell.targeting.radius", ["spell.effect.test_burst", "spell.effect.test_plain"]);
    expect(r.result.compatibility.filter((c) => c.status !== "NOT_DECLARED").map((c) => [c.componentKey, c.status])).toEqual([["effect1", "COMPATIBLE"]]);
    const bad = withEffects("spell.targeting.single_target", ["spell.effect.test_burst"]);
    expect([bad.result.status, bad.result.problems]).toEqual(["INVALID", ["compatibility.effect1"]]);
    expect(withEffects("spell.targeting.projectile", ["spell.effect.test_bolt"]).result.status).toBe("VALID");
  });

  it("a semantic token never matches a different exact identity: RADIUS ≠ radius_area by name; an exact key never matches by substring", () => {
    const r = withEffects("spell.targeting.cone", ["spell.effect.test_burst", "spell.effect.test_bolt"]);
    expect(r.result.compatibility.filter((c) => c.status !== "NOT_DECLARED").map((c) => [c.componentKey, c.status])).toEqual([["effect1", "INCOMPATIBLE"], ["effect2", "INCOMPATIBLE"]]);
  });
});
