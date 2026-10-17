/**
 * M5-WO3 §104 / §216 — WO3-generated M4 runtime plans through the EXISTING POST /api/rules/evaluate endpoint (no new
 * endpoint, no persistence). The plans are the committed fixture tests/integration/fixtures/m5-wo3-runtime-plans.json,
 * which packages/prowess-db/tests/unit/m5-wo3-inspector-fixture.test.ts regenerates from canonical content and requires
 * to be identical. Studio never imports @prowess/game (M5-I017): the browser and API see only M4 plans and responses.
 *
 * Proves the Rules Inspector inputs render for WO3 plans — AP before / Action cost / AP after, ME and MP before / listed
 * cost / ME payment / MP payment / after, the Surprise availability Requirement, per-step traces and rule provenance —
 * all from M4's own responses, with no database write (M5-I105).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectExplanation } from "@prowess/rules";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Payment = { costKey: string; policy: string; listedAmount: number; preview: string; apply: string };
type Fixture = { evaluationKey: string; actor: unknown; runtime: unknown; plan: unknown; outputs: { payments: Payment[]; resources: Record<string, string>; availability: { resourceKey: string; stepKey: string }[] } };
const FIXTURES = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/m5-wo3-runtime-plans.json"), "utf8")) as { actionPoints: Fixture; mana: Fixture; surpriseRound: Fixture };
const evaluate = (body: unknown) => call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, body);
type Step = { stepKey: string; executionStatus: string; response: { status: string; data: Record<string, unknown> | null; trace: unknown; ruleset: unknown } | null };
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
const data = (run: Run, stepKey: string) => run.steps.find((s) => s.stepKey === stepKey)?.response?.data as Record<string, unknown>;
const run = async (label: string, f: Fixture) => {
  const m = await manifest(label);
  const tables = await allTables();
  const before = await fingerprint(tables);
  const r = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: m.id }, evaluationKey: f.evaluationKey, actor: f.actor, runtime: f.runtime, plan: f.plan });
  expect(await fingerprint(tables)).toEqual(before); // M5-I105: evaluation writes nothing
  expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
  const result = r.data.data as Run;
  expect(result.executionStatus).toBe("COMPLETE");
  // Every rule-evaluating step ran under the endpoint's exact ruleset (a SUMMARY projection evaluates no rule).
  for (const s of result.steps.filter((x) => x.stepKey !== "inspector.summary")) expect(s.response?.ruleset, s.stepKey).toEqual(r.data.ruleset);
  return result;
};

describe("M5-WO3 runtime plans through POST /api/rules/evaluate and the Rules Inspector contract (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("§104 / §106 AP 5, Balanced Attack lists 2 → AP 3; the explanation exposes AP before, cost and AP after from M4", async () => {
    const f = FIXTURES.actionPoints;
    const result = await run("m5wo3ap", f);
    const payment = data(result, f.outputs.payments[0]!.apply);
    expect([payment.listedAmount, payment.canPay, payment.shortfall]).toEqual([2, true, 0]);
    expect(payment.allocations).toEqual([expect.objectContaining({ resourceKey: "resource.ap", currentBefore: 5, amountPaid: 2, currentAfter: 3 })]);
    const detailed = data(result, "inspector.explanation");
    expect(detailed.level).toBe("DETAILED");
    const text = JSON.stringify(detailed);
    for (const name of ["listed_amount", "current_before", "paid", "current_after"]) expect(text).toContain(name);
    expect(text).toContain("resource.ap");
    expect(result.steps.find((s) => s.stepKey === "inspector.summary")?.response).toEqual(projectExplanation(detailed, "SUMMARY"));
    expect(JSON.stringify(payment)).toContain("action.attack.balanced");
  });

  it("§104 / §111 listed 8, ME 5, MP 18 → ME 5 then MP 3; listed cost stays 8; explanation from M4's payment trace", async () => {
    const f = FIXTURES.mana;
    const result = await run("m5wo3mana", f);
    const payment = data(result, f.outputs.payments[0]!.apply);
    expect(payment.listedAmount).toBe(8);
    expect((payment.allocations as Array<Record<string, unknown>>).map((a) => [a.resourceKey, a.currentBefore, a.amountPaid, a.currentAfter])).toEqual([
      ["resource.me", 5, 5, 0],
      ["resource.mp", 18, 3, 15],
    ]);
    expect(JSON.stringify(payment)).not.toMatch(/effectiveCost|discount/i);
    expect(JSON.stringify(data(result, "inspector.explanation"))).toContain("resource.mp");
  });

  it("§125 Round 1, surprised: Counter Action refreshed to 1 but unavailable; ME refreshed to 5", async () => {
    const f = FIXTURES.surpriseRound;
    const result = await run("m5wo3surprise", f);
    const availability = data(result, f.outputs.availability[0]!.stepKey);
    expect(availability.satisfied).toBe(false);
    const final = data(result, Object.values(f.outputs.resources)[0]!).resultingResources as { resources: { resourceKey: string; current: number }[] };
    expect(final.resources.map((r) => [r.resourceKey, r.current])).toEqual([
      ["resource.counter_action", 1],
      ["resource.me", 5],
    ]);
  });

  it("the endpoint resolves the ruleset itself; a runtime plan cannot add an endpoint or bypass exact selection", async () => {
    const f = FIXTURES.actionPoints;
    const r = await evaluate({ ruleset: { kind: "RULESET", rulesetId: "00000000-0000-4000-8000-000000000001" }, evaluationKey: f.evaluationKey, actor: f.actor, runtime: f.runtime, plan: f.plan });
    expect(r.status).toBe(400);
  });
});
