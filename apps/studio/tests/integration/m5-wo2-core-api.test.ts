/**
 * M5-WO2 §207 / §210 — WO2-generated M4 plans through the EXISTING POST /api/rules/evaluate endpoint (no new endpoint).
 * The plans are the committed fixture tests/integration/fixtures/m5-wo2-core-plans.json, which
 * packages/prowess-db/tests/unit/m5-wo2-inspector-fixture.test.ts regenerates from canonical content and requires to be
 * identical. Studio never imports @prowess/game (M5-I017): the browser and API see only M4 plans and responses.
 *
 * Proves the Rules Inspector inputs render for WO2 plans: Formula values, Requirement outcomes, the Modifier roll signal,
 * per-step traces, rule provenance, and a DETAILED explanation with its SUMMARY projection — with no database write.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectExplanation } from "@prowess/rules";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Fixture = { evaluationKey: string; actor: unknown; runtime: unknown; plan: unknown; outputs?: Record<string, string | null> };
const FIXTURES = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/m5-wo2-core-plans.json"), "utf8")) as { characterDc: Fixture; attack: Fixture };
const evaluate = (body: unknown) => call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, body);
type Step = { stepKey: string; operation?: string; executionStatus: string; response: { status: string; data: Record<string, unknown> | null; trace: unknown; ruleset: unknown; errors: unknown[] } | null };
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
const data = (run: Run, stepKey: string | null | undefined) => run.steps.find((s) => s.stepKey === stepKey)?.response?.data as Record<string, unknown>;

describe("M5-WO2 plans through POST /api/rules/evaluate and the Rules Inspector contract (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("§109 Character DC 12 evaluates through the existing endpoint with a DETAILED explanation and SUMMARY projection; no write", async () => {
    const m = await manifest("m5wo2dc");
    const tables = await allTables();
    const before = await fingerprint(tables);
    const f = FIXTURES.characterDc;
    const r = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: m.id }, evaluationKey: f.evaluationKey, actor: f.actor, runtime: f.runtime, plan: f.plan });
    expect(await fingerprint(tables)).toEqual(before);
    expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
    const run = r.data.data as Run;
    expect(run.executionStatus).toBe("COMPLETE");
    const value = (fragment: string) => data(run, `prowess:DERIVED_STATISTICS:inspector:${fragment}`).finalValue;
    expect([value("derived.HALF_CHARACTER_DIE"), value("derived.CHARACTER_DC_RESOLVE_BONUS"), value("bonuses.CHARACTER_DC"), value("derived.CHARACTER_DC")]).toEqual([4, 2, 1, 12]);
    const dc = run.steps.find((s) => s.stepKey === "prowess:DERIVED_STATISTICS:inspector:derived.CHARACTER_DC");
    expect(dc?.response?.trace).toBeTruthy();
    expect(JSON.stringify(dc?.response)).toContain("core.derived.character_dc");
    const detailed = data(run, "inspector.explanation");
    expect(detailed.level).toBe("DETAILED");
    expect(JSON.stringify(detailed)).toContain("derived.CHARACTER_DC_RESOLVE_BONUS");
    expect(run.steps.find((s) => s.stepKey === "inspector.summary")?.response).toEqual(projectExplanation(detailed, "SUMMARY"));
  });

  it("§129 / §131 Advantage Attack Roll: natural 5 kept, total 12 hits Dodge 11, no critical; Stat Mastery signal empty below Level 10", async () => {
    const m = await manifest("m5wo2atk");
    const f = FIXTURES.attack;
    const o = f.outputs ?? {};
    const r = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: m.id }, evaluationKey: f.evaluationKey, actor: f.actor, runtime: f.runtime, plan: f.plan });
    expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
    const run = r.data.data as Run;
    expect([data(run, o.natural).finalValue, data(run, o.total).finalValue, data(run, o.success).satisfied, data(run, o.criticalThreat).satisfied, data(run, o.criticalHit).satisfied]).toEqual([5, 12, true, false, false]);
    expect((data(run, o.statMasterySignal).finalTargets as unknown[])[0]).toEqual({ targetKey: "roll.mode_signal", kind: "ROLL_SIGNAL", advantage: [], disadvantage: [] });
    expect(data(run, o.success).outcome).toMatchObject({ kind: "NUMERIC_COMPARE", expected: { operator: ">=", value: 11 } });
    for (const s of run.steps) expect(s.response?.ruleset, s.stepKey).toEqual(r.data.ruleset);
  });

  it("the endpoint resolves the ruleset itself; the plan cannot add a Prowess endpoint or bypass exact selection", async () => {
    const f = FIXTURES.attack;
    const r = await evaluate({ ruleset: { kind: "RULESET", rulesetId: "00000000-0000-4000-8000-000000000001" }, evaluationKey: f.evaluationKey, actor: f.actor, runtime: f.runtime, plan: f.plan });
    expect(r.status).toBe(400);
  });
});
