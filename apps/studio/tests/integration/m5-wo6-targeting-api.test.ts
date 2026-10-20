/**
 * M5-WO6 §123 / §192 — Targeting plans through the EXISTING POST /api/rules/evaluate endpoint (no new endpoint, no
 * persistence). The plans are the committed fixture tests/integration/fixtures/m5-wo6-targeting-plans.json, which
 * packages/prowess-db/tests/unit/m5-wo6-inspector-fixture.test.ts regenerates from canonical Targeting content and
 * requires to be identical. Studio never imports @prowess/game (M5-I017): the API sees only M4 plans and responses, and
 * every Rules Inspector number below (range, radius, the Multi-Target bound) comes from M4 — no browser-side math.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Outputs = {
  range: { stepKey: string | null; baseRangeStepKey: string | null };
  measures: { measure: string; status: string; stepKey: string | null }[];
  cardinality: { stepKey: string | null };
  cost: { base: { status: string; amount?: number; conflictKey?: string } };
};
type Fixture = { evaluationKey: string; plan: { steps: { stepKey: string; operation: string }[] }; outputs: Outputs; sourceMap: { entries: { stepKey: string; definitions: { canonicalKey: string }[] }[] } };
const FIXTURES = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/m5-wo6-targeting-plans.json"), "utf8")) as { spellRadius: Fixture; maneuverRadius: Fixture; multiTarget: Fixture };
const evaluate = (body: unknown) => call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, body);
type Step = { stepKey: string; executionStatus: string; response: { status: string; data: Record<string, unknown> | null; ruleset: unknown } | null };
type Run = { executionStatus: string; steps: Step[] };

async function allTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  return rows.map((r) => r.table_name);
}
async function manifest(label: string) {
  const rulesetId = await apiRuleset(label);
  const a = await entityWithVersions(`${label}A`, "A1");
  return apiManifest(rulesetId, [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }]);
}
const data = (run: Run, stepKey: string | null) => run.steps.find((s) => s.stepKey === stepKey)?.response?.data as Record<string, unknown>;
const run = async (label: string, f: Fixture) => {
  const m = await manifest(label);
  const tables = await allTables();
  const before = await fingerprint(tables);
  const r = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: m.id }, evaluationKey: f.evaluationKey, plan: f.plan });
  expect(await fingerprint(tables)).toEqual(before); // §122: Targeting evaluation writes nothing
  expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
  const result = r.data.data as Run;
  expect(result.executionStatus).toBe("COMPLETE");
  for (const s of result.steps) expect(s.response?.ruleset, s.stepKey).toEqual(r.data.ruleset);
  return result;
};

describe("M5-WO6 Targeting plans through POST /api/rules/evaluate (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("plans use only existing M4 operations (FORMULA / REQUIREMENT / KEYWORD)", () => {
    for (const f of [FIXTURES.spellRadius, FIXTURES.maneuverRadius, FIXTURES.multiTarget]) for (const s of f.plan.steps) expect(["FORMULA", "REQUIREMENT", "KEYWORD"]).toContain(s.operation);
  });

  it("M5-I165–I166 Spell Radius at PER 5 / PRO 3: BASE_RANGE 75 → range 75 ft and radius 15 ft as separate M4 steps; 6 MP listed", async () => {
    const f = FIXTURES.spellRadius;
    const result = await run("m5wo6spell", f);
    const radius = f.outputs.measures.find((m) => m.measure === "RADIUS")!;
    expect([data(result, f.outputs.range.baseRangeStepKey).finalValue, data(result, f.outputs.range.stepKey).finalValue, data(result, radius.stepKey).finalValue]).toEqual([75, 75, 15]);
    expect(f.outputs.cost.base).toEqual({ status: "LISTED", currency: "MP", amount: 6, contributionKey: "targeting.base" });
    expect(f.sourceMap.entries.find((e) => e.stepKey === f.outputs.range.stepKey)?.definitions.map((d) => d.canonicalKey)).toEqual(["spell.targeting.radius", "core.derived.base_range"]);
  });

  it("M5-I173 Maneuver Radius at Martial EXPERT / STR 5 = 50 ft through M4; no cost on Maneuver Targeting", async () => {
    const f = FIXTURES.maneuverRadius;
    const result = await run("m5wo6maneuver", f);
    const radius = f.outputs.measures.find((m) => m.measure === "RADIUS")!;
    expect(data(result, radius.stepKey).finalValue).toBe(50);
    expect(f.outputs.cost.base).toEqual({ status: "NOT_APPLICABLE" });
    expect(f.sourceMap.entries.find((e) => e.stepKey === radius.stepKey)?.definitions.map((d) => d.canonicalKey)).toEqual(["maneuver.targeting.radius", "core.rank_ladder.skill"]);
  });

  it("an explicit Multi-Target count of 1 is a valid INVALID result decided by an M4 Requirement — not corruption", async () => {
    const f = FIXTURES.multiTarget;
    const result = await run("m5wo6multi", f);
    expect((data(result, f.outputs.cardinality.stepKey) as { satisfied: boolean }).satisfied).toBe(false);
  });

  it("the endpoint resolves the ruleset itself; a Targeting plan cannot bypass exact selection", async () => {
    const r = await evaluate({ ruleset: { kind: "RULESET", rulesetId: "00000000-0000-4000-8000-000000000001" }, evaluationKey: FIXTURES.spellRadius.evaluationKey, plan: FIXTURES.spellRadius.plan });
    expect(r.status).toBe(400);
  });
});
