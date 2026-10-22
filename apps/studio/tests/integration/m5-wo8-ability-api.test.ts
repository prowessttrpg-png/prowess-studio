/** WO8 uses the existing M4 API/Inspector contract; Studio imports no Prowess rules. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";
type Fixture = { evaluationKey: string; plan: unknown; explanationStepKey: string; definition: { entityVersionId: string }; traits: { definition: { entityVersionId: string }; scope: unknown; costs: unknown[] }[]; actions: unknown[]; sourceMap: { entries: { definitions: { entityVersionId: string }[] }[] } };
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/m5-wo8-ability-plans.json"), "utf8")) as Fixture[];
describe("WO8 authored ability M4 plans through POST /api/rules/evaluate", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);
  it.each(fixtures)("inspects $evaluationKey with exact Trait and authored Definition sources, without persistence", async f => {
    const rulesetId = await apiRuleset("wo8"), entity = await entityWithVersions("wo8", "WO8"), manifest = await apiManifest(rulesetId, [{ entityId: entity.entity.id, entityVersionId: entity.versions[0]!.id }]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    const names = tables.map(t => t.table_name), before = await fingerprint(names);
    const r = await call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: f.evaluationKey, plan: f.plan });
    expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]); expect(await fingerprint(names)).toEqual(before);
    const run = r.data.data as { executionStatus: string; steps: { stepKey: string; response: { success: boolean; ruleset: unknown; data: { level?: string; sections?: unknown[] } } }[] };
    expect(run.executionStatus).toBe("COMPLETE");
    for (const step of run.steps) { expect(step.response.success).toBe(true); expect(step.response.ruleset).toEqual(r.data.ruleset); }
    const explanation = run.steps.find(s => s.stepKey === f.explanationStepKey)!.response.data;
    expect(explanation.level).toBe("DETAILED"); expect(explanation.sections!.length).toBeGreaterThan(0);
    const cited = new Set(f.sourceMap.entries.flatMap(e => e.definitions.map(d => d.entityVersionId)));
    expect(cited.has(f.definition.entityVersionId)).toBe(true);
    for (const trait of f.traits) { expect(cited.has(trait.definition.entityVersionId)).toBe(true); expect(trait.scope).toBeTruthy(); expect(trait.costs).toBeInstanceOf(Array); }
  });
});
