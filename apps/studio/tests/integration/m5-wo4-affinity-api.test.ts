/**
 * M5-WO4 §172 / §281 — WO4-generated M4 Affinity plans through the EXISTING POST /api/rules/evaluate endpoint (no new
 * endpoint, no persistence). The plans are the committed fixture tests/integration/fixtures/m5-wo4-affinity-plans.json,
 * which packages/prowess-db/tests/unit/m5-wo4-inspector-fixture.test.ts regenerates from canonical Affinity content and
 * requires to be identical. Studio never imports @prowess/game (M5-I017): the browser and API see only M4 plans and
 * responses.
 *
 * Proves the Rules Inspector inputs render for Affinity plans — base cost, Strength discount, after-Strength, Weakness
 * penalty, after-Affinity, the matched Keywords with their contributing Definitions, the access Requirement, per-step
 * traces and rule provenance — all from M4's own responses, with no database write (M5-I146, §173).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectExplanation } from "@prowess/rules";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Outputs = {
  keywords: string | null;
  weaknessSelection: string | null;
  cost: { stepKey: string; netStepKey: string; baseCost: number } | null;
  strengths: { ruleKey: string; stepKey: string }[];
  weaknesses: { ruleKey: string; stepKey: string }[];
  access: { requirementKey: string; stepKey: string }[];
};
type Fixture = { evaluationKey: string; plan: unknown; outputs: Outputs };
const FIXTURES = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/m5-wo4-affinity-plans.json"), "utf8")) as { cost: Fixture; access: Fixture };
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
  const r = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: m.id }, evaluationKey: f.evaluationKey, plan: f.plan });
  expect(await fingerprint(tables)).toEqual(before); // §173: evaluation writes nothing — no rank, choice or canon change
  expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
  const result = r.data.data as Run;
  expect(result.executionStatus).toBe("COMPLETE");
  for (const s of result.steps.filter((x) => x.stepKey !== "inspector.summary")) expect(s.response?.ruleset, s.stepKey).toEqual(r.data.ruleset);
  return result;
};

describe("M5-WO4 Affinity plans through POST /api/rules/evaluate and the Rules Inspector contract (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("§156 / M5-I155 base 20 → Evocation Expert Strength −20% + Healing Weakness +30% → net 110% → 22, explained from M4's modifier trace", async () => {
    const f = FIXTURES.cost;
    const result = await run("m5wo4cost", f);
    const net = data(result, f.outputs.cost!.netStepKey) as { outcomes: Array<Record<string, unknown>>; finalTargets: Array<{ value: number }> };
    expect(net.outcomes.map((o) => [o.modifierKey, o.operation, o.operand, o.status, o.before, o.after])).toEqual([
      ["affinity.strength_discount", "SUBTRACT", 20, "APPLIED", 100, 80],
      ["affinity.weakness_penalty", "ADD", 30, "APPLIED", 80, 110],
    ]);
    const cost = data(result, f.outputs.cost!.stepKey) as { outcomes: Array<Record<string, unknown>>; finalTargets: Array<{ value: number }> };
    expect(cost.outcomes.map((o) => [o.modifierKey, o.operation, o.operand, o.before, o.after])).toEqual([
      ["affinity.net_cost_multiplier", "MULTIPLY", 110, 20, 2200],
      ["affinity.percent_scale", "DIVIDE", 100, 2200, 22],
    ]);
    expect(cost.finalTargets[0]?.value).toBe(22);
    const selection = data(result, f.outputs.weaknessSelection!) as { finalTargets: Array<{ value: number }> };
    expect(selection.finalTargets[0]?.value).toBe(30);
    const keywords = data(result, f.outputs.keywords!) as { keywords: Array<{ keyword: { canonicalKey: string }; contributors: Array<{ source: { sourceKey: string; provenance: { canonicalKey: string } } }> }> };
    expect(keywords.keywords.map((k) => [k.keyword.canonicalKey, k.contributors.map((c) => c.source.provenance.canonicalKey)])).toEqual([
      ["keyword.direct_damage", ["spell.effect.direct_damage"]],
      ["keyword.healing", ["spell.effect.healing"]],
    ]);
    const detailed = data(result, "inspector.explanation");
    expect(detailed.level).toBe("DETAILED");
    const text = JSON.stringify(detailed);
    expect(text).toContain("affinity.strength_discount");
    expect(text).toContain("affinity.weakness_penalty");
    expect(result.steps.find((s) => s.stepKey === "inspector.summary")?.response).toEqual(projectExplanation(detailed, "SUMMARY"));
    expect(JSON.stringify(cost)).not.toMatch(/rounding|"AP"|mana_efficiency/i);
  });

  it("§195–§196 a Trait requiring Evocation Expert is not satisfied for Evocation Trained — a valid result, not corruption", async () => {
    const f = FIXTURES.access;
    const result = await run("m5wo4access", f);
    const access = data(result, f.outputs.access[0]!.stepKey);
    expect(access.satisfied).toBe(false);
    const leaves = (access.outcome as { children: Array<Record<string, unknown>> }).children;
    expect(leaves.map((l) => [l.kind, l.satisfied, l.actual, l.expected])).toEqual([
      ["ENTITY_OWNED", true, { owned: true }, expect.anything()],
      ["RANK_AT_LEAST", false, { order: 1, rankKey: "TRAINED" }, { order: 2, rankKey: "EXPERT" }],
    ]);
  });

  it("the endpoint resolves the ruleset itself; an Affinity plan cannot add an endpoint or bypass exact selection", async () => {
    const f = FIXTURES.cost;
    const r = await evaluate({ ruleset: { kind: "RULESET", rulesetId: "00000000-0000-4000-8000-000000000001" }, evaluationKey: f.evaluationKey, plan: f.plan });
    expect(r.status).toBe(400);
  });
});
