/** Existing generic evaluation/Inspector API, using plans compiled by @prowess/game in the permanent DB fixture test. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";
type Ref = { entityVersionId: string };
type Fixture = { evaluationKey: string; plan: unknown; explanationStepKey: string; definition: Ref; durationConditions: { duration: { definition: Ref; costStatus: string }; conditions: { definition: Ref; runtimeRequirements: { status: string }[]; listedContributions: unknown[] }[]; conditionSummary: { usedCapacity: number; maximumCapacity: number; spellMpPercent: { maximum: number }; maneuverAp: { maximum: number }; costStage: string } }; sourceMap: { entries: { definitions: Ref[] }[] } };
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/m5-wo9-ability-plans.json"), "utf8")) as Fixture[];
describe("WO9 authored Duration and Conditions through POST /api/rules/evaluate", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!)); afterAll(cleanupM2Api);
  it.each(fixtures)("inspects $evaluationKey using M4, without writing state", async f => {
    const rulesetId = await apiRuleset("wo9"), entity = await entityWithVersions("wo9", "WO9"), manifest = await apiManifest(rulesetId, [{ entityId: entity.entity.id, entityVersionId: entity.versions[0]!.id }]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    const names = tables.map(t => t.table_name), before = await fingerprint(names);
    // Generic M4 execution context is server-materialized here. Exact domain R1/R2 isolation is verified by the DB history test.
    const r = await call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: f.evaluationKey, plan: f.plan });
    expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]); expect(await fingerprint(names)).toEqual(before);
    const run = r.data.data as { executionStatus: string; steps: { stepKey: string; response: { success: boolean; ruleset: unknown; data: { level?: string; sections?: unknown[]; finalValue?: number } } }[] };
    expect(run.executionStatus).toBe("COMPLETE"); for (const step of run.steps) { expect(step.response.success).toBe(true); expect(step.response.ruleset).toEqual(r.data.ruleset); }
    const explanation = run.steps.find(s => s.stepKey === f.explanationStepKey)!.response.data; expect(explanation.level).toBe("DETAILED"); expect(explanation.sections!.length).toBeGreaterThan(0);
    const cited = new Set(f.sourceMap.entries.flatMap(e => e.definitions.map(d => d.entityVersionId)));
    expect(cited.has(f.definition.entityVersionId)).toBe(true); expect(cited.has(f.durationConditions.duration.definition.entityVersionId)).toBe(true);
    for (const c of f.durationConditions.conditions) { expect(cited.has(c.definition.entityVersionId)).toBe(true); expect(c.listedContributions).toBeInstanceOf(Array); expect(c.runtimeRequirements.every(q => q.status === "REQUIREMENT_CONTRACT_ONLY")).toBe(true); }
    expect(f.durationConditions.conditionSummary).toMatchObject({ spellMpPercent: { maximum: 30 }, maneuverAp: { maximum: 3 }, costStage: "LISTED_COMPONENT_CONTRIBUTIONS_ONLY" });
  });
});
