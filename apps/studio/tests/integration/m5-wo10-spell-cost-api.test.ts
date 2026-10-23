/**
 * M5-WO10 final Spell cost traces A–H through the EXISTING POST /api/rules/evaluate endpoint (no WO10-only API, no UI, no
 * persistence). Plans come from apps/studio/tests/integration/fixtures/m5-wo10-spell-cost-plans.json, regenerated and
 * required identical by packages/prowess-db/tests/unit/m5-wo10-inspector-fixture.test.ts. Studio never imports
 * @prowess/game: every number below — base MP, net percentage, unrounded MP, final MP, base AP, final AP — is M4's.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Ref = { entityVersionId: string; canonicalKey: string };
type Steps = { baseMp: string; netPercent: string; unroundedMp: string; finalMp: string; baseAp: string; finalAp: string; explanation: string };
type Fixture = {
  trace: string;
  evaluationKey: string;
  definition: Ref;
  plan: { steps: { stepKey: string; operation: string }[] };
  sourceMap: { entries: { stepKey: string; role: string; definitions: Ref[] }[] };
  steps: Steps;
  cost: { mp: { baseMpCost: number; contributions: { stepKey: string; definition: Ref }[] }; netCostPercent: number; unroundedFinalMpCost: number; finalMpCost: number; ap: { pro: number; baseApCost: number; finalApCost: number }; rounding: { stepKey: string } };
};
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/m5-wo10-spell-cost-plans.json"), "utf8")) as Fixture[];
const EXPECTED: Record<string, [number, number, number, number, number, number]> = {
  A: [13, 100, 13, 13, 3, 3],
  B: [20, 80, 16, 16, 4, 4],
  C: [20, 90, 18, 18, 4, 4],
  D: [15, 90, 13.5, 14, 3, 3],
  E: [20, 80, 16, 16, 4, 4],
  F: [17, 100, 17, 17, 4, 3],
  G: [20, 90, 18, 18, 4, 5],
  H: [36, 100, 36, 36, 7, 7],
};

describe("M5-WO10 final Spell cost through POST /api/rules/evaluate (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("covers traces A–H with existing M4 operations only", () => {
    expect(fixtures.map((f) => f.trace)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    for (const f of fixtures) for (const s of f.plan.steps) expect(["FORMULA", "REQUIREMENT", "KEYWORD", "MODIFIER", "EXPLANATION"]).toContain(s.operation);
  });

  it.each(fixtures)("trace $trace: M4 computes base MP, ONE net %, unrounded, the single rounding, base AP and final AP — writing nothing", async (f) => {
    const rulesetId = await apiRuleset(`wo10${f.trace}`), entity = await entityWithVersions(`wo10${f.trace}`, "WO10"), manifest = await apiManifest(rulesetId, [{ entityId: entity.entity.id, entityVersionId: entity.versions[0]!.id }]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    const names = tables.map((t) => t.table_name), before = await fingerprint(names);
    const r = await call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: f.evaluationKey, plan: f.plan });
    expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
    expect(await fingerprint(names)).toEqual(before); // no persistence, no Resource mutation
    const run = r.data.data as { executionStatus: string; steps: { stepKey: string; response: { success: boolean; ruleset: unknown; data: { finalValue?: number; finalTargets?: { value: number }[]; level?: string; sections?: unknown[] } } }[] };
    expect(run.executionStatus).toBe("COMPLETE");
    const data = (k: string) => run.steps.find((s) => s.stepKey === k)!.response.data;
    const target = (k: string) => data(k).finalTargets![0]!.value;
    expect([target(f.steps.baseMp), target(f.steps.netPercent), data(f.steps.unroundedMp).finalValue, data(f.steps.finalMp).finalValue, data(f.steps.baseAp).finalValue, target(f.steps.finalAp)]).toEqual(EXPECTED[f.trace]);
    expect([f.cost.mp.baseMpCost, f.cost.netCostPercent, f.cost.unroundedFinalMpCost, f.cost.finalMpCost, f.cost.ap.baseApCost, f.cost.ap.finalApCost]).toEqual(EXPECTED[f.trace]);
    expect(f.cost.rounding.stepKey).toBe(f.steps.finalMp);
    expect(f.sourceMap.entries.filter((e) => e.role === "spell-final-mp-rounding").map((e) => e.stepKey)).toEqual([f.steps.finalMp]);
    const explanation = data(f.steps.explanation);
    expect(explanation.sections!.length).toBeGreaterThan(0);
    for (const c of f.cost.mp.contributions) expect(f.sourceMap.entries.find((e) => e.stepKey === c.stepKey)?.definitions.map((d) => d.entityVersionId)).toContain(c.definition.entityVersionId);
  });
});
