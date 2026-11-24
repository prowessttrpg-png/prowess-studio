import { describe, expect, it } from "vitest";
import { previewTargetingMeasures } from "./reference/preview.js";
import { TARGETING_CONTENT, T_FIXTURE, maneuverWith, measureOf, runTargeting, targetingRequest } from "./testing/targeting-fixtures.js";

/**
 * RULES-WO1 Phase H — the Targeting distance preview binds the same Formula, rank-table row and default choices as the
 * Maneuver builder's Targeting compiler, through M4: Maneuver Radius = Martial Rank Base (5 / 10 / 15) × STR.
 */
const KEY = "maneuver.targeting.radius";
const stored = TARGETING_CONTENT.definitions.find((d) => d.canonicalKey === KEY)!;
const raw = () => JSON.parse(JSON.stringify((stored.payload as { rules: { targeting: unknown } }).rules.targeting));
const preview = (stats: Record<string, number>, ranks: Record<string, string>) => {
  const out = previewTargetingMeasures({ targeting: raw(), shape: "RADIUS", branch: "MANEUVER", stats, ranks, parameters: {}, derived: {} });
  if (!out.ok) throw new Error(out.problems.join("; "));
  return out;
};

describe("RULES-WO1 Phase H: Targeting distance preview (Maneuver Radius)", () => {
  it("keeps the published table and calculation: 5 / 10 / 15 ft per STR from the Martial rank", () => {
    const t = raw() as { rankTables: unknown; measures: Array<{ formula: { expression: string } }> };
    expect(t.rankTables).toEqual([{ tableKey: "MARTIAL_RANK_BASE", skillKey: "skill.martial", entries: [{ rankKey: "TRAINED", value: 5 }, { rankKey: "EXPERT", value: 10 }, { rankKey: "MASTER", value: 15 }] }]);
    expect(t.measures[0]!.formula.expression).toBe("rank_base * str");
  });

  it.each([
    ["TRAINED", 4, 20],
    ["EXPERT", 4, 40],
    ["MASTER", 4, 60],
    ["MASTER", 3, 45],
  ])("Martial %s with STR %i → %i ft, exactly what the Maneuver builder's Targeting compiler gives", (martial, str, feet) => {
    expect(preview({ STR: str }, { "skill.martial": martial }).measures[0]).toMatchObject({ measure: "RADIUS", status: "FORMULA", value: feet, unit: "ft", reason: null });
    const F = T_FIXTURE();
    const r = runTargeting(targetingRequest(F, maneuverWith(F, KEY), { martial, stats: { STR: str } }), F);
    expect(measureOf(r, "RADIUS")?.value).toBe(feet);
  });

  it("names a missing input instead of guessing (no rank, no STR)", () => {
    expect(preview({ STR: 4 }, {}).measures[0]).toMatchObject({ value: null, reason: "a rank in skill.martial is needed" });
    expect(preview({}, { "skill.martial": "EXPERT" }).measures[0]).toMatchObject({ value: null, reason: "STR is needed" });
  });

  it("refuses a Targeting the M5 reader refuses (the preview never evaluates invalid content)", () => {
    const bad = raw();
    bad.radiusCapable = false;
    const out = previewTargetingMeasures({ targeting: bad, shape: "RADIUS", branch: "MANEUVER", stats: { STR: 4 }, ranks: { "skill.martial": "EXPERT" }, parameters: {}, derived: {} });
    expect(out.ok).toBe(false);
  });
});
