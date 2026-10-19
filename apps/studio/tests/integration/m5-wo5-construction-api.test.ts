/**
 * M5-WO5 — shared ability construction plans through the EXISTING POST /api/rules/evaluate endpoint (no new endpoint,
 * no persistence). The plans are the committed fixture tests/integration/fixtures/m5-wo5-construction-plans.json, which
 * packages/prowess-db/tests/unit/m5-wo5-inspector-fixture.test.ts regenerates from canonical construction content and
 * requires to be identical. Studio never imports @prowess/game (M5-I017): the API sees only M4 plans and responses.
 *
 * Proves the Rules Inspector inputs for construction: access, capacity Formulas, capacity comparisons, Casting
 * Condition capacity from Arcane Rank (M5-I157), Martial capacity (M5-I158) and Signature slots — all from M4's own
 * responses, with no database write.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Outputs = { capacity: { remainingEffectsStep: string; effectiveTraitsStep: string; maximumTradesStep: string | null }; signature: { capacityStep: string; projectedStep: string; availableStep: string } };
type Fixture = { evaluationKey: string; plan: { steps: Array<{ stepKey: string; operation: string }> }; outputs: Outputs };
const FIXTURES = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/m5-wo5-construction-plans.json"), "utf8")) as { valid: Fixture; invalid: Fixture };
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
const step = (run: Run, suffix: string) => run.steps.find((s) => s.stepKey.endsWith(`:${suffix}`) || s.stepKey === suffix)?.response?.data as Record<string, unknown>;
const value = (run: Run, stepKey: string) => (step(run, stepKey) as { finalValue: number }).finalValue;
const run = async (label: string, f: Fixture) => {
  const m = await manifest(label);
  const tables = await allTables();
  const before = await fingerprint(tables);
  const r = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: m.id }, evaluationKey: f.evaluationKey, plan: f.plan });
  expect(await fingerprint(tables)).toEqual(before); // construction evaluation writes nothing
  expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
  const result = r.data.data as Run;
  expect(result.executionStatus).toBe("COMPLETE");
  for (const s of result.steps) expect(s.response?.ruleset, s.stepKey).toEqual(r.data.ruleset);
  return result;
};

describe("M5-WO5 construction plans through POST /api/rules/evaluate (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("plans use only existing M4 operations (KEYWORD / FORMULA / REQUIREMENT)", () => {
    for (const f of [FIXTURES.valid, FIXTURES.invalid]) for (const s of f.plan.steps) expect(["KEYWORD", "FORMULA", "REQUIREMENT"]).toContain(s.operation);
  });

  it("M5-I156 / M5-I157 Arcane Expert Spell: 2 of 2 Effects, 1 of 2 Casting Conditions, Signature 2 of 4 — every rule satisfied, numbers from M4", async () => {
    const f = FIXTURES.valid;
    const result = await run("m5wo5valid", f);
    expect(value(result, f.outputs.capacity.remainingEffectsStep)).toBe(2);
    expect(value(result, f.outputs.capacity.effectiveTraitsStep)).toBe(2);
    expect(value(result, f.outputs.capacity.maximumTradesStep!)).toBe(1);
    expect([value(result, f.outputs.signature.capacityStep), value(result, f.outputs.signature.projectedStep), value(result, f.outputs.signature.availableStep)]).toEqual([4, 2, 2]);
    const requirements = result.steps.filter((s) => f.plan.steps.find((p) => p.stepKey === s.stepKey)?.operation === "REQUIREMENT");
    expect(requirements.length).toBeGreaterThan(5);
    for (const s of requirements) expect((s.response?.data as { satisfied: boolean }).satisfied, s.stepKey).toBe(true);
    expect((step(result, "capacity.conditions") as { outcome: Record<string, unknown> }).outcome).toEqual(expect.objectContaining({ kind: "NUMERIC_COMPARE", actual: { value: 1 }, expected: { operator: "<=", value: 2 } })); // Casting Conditions from Arcane Expert
  });

  it("M5-I158 Martial Trained Maneuver with 2 Effects is INVALID on Effect capacity only — a valid result, not corruption", async () => {
    const f = FIXTURES.invalid;
    const result = await run("m5wo5invalid", f);
    expect(value(result, f.outputs.capacity.remainingEffectsStep)).toBe(1);
    expect(f.outputs.capacity.maximumTradesStep).toBeNull(); // no Maneuver exchange
    const failing = result.steps.filter((s) => (s.response?.data as { satisfied?: boolean } | null)?.satisfied === false).map((s) => s.stepKey.split(":").pop());
    expect(failing).toEqual(["capacity.effects"]);
  });

  it("the endpoint resolves the ruleset itself; a construction plan cannot bypass exact selection", async () => {
    const r = await evaluate({ ruleset: { kind: "RULESET", rulesetId: "00000000-0000-4000-8000-000000000001" }, evaluationKey: FIXTURES.valid.evaluationKey, plan: FIXTURES.valid.plan });
    expect(r.status).toBe(400);
  });
});
