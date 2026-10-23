/**
 * M5-WO11 final Maneuver cost traces A–J through the EXISTING POST /api/rules/evaluate endpoint (no WO11-only API, no UI,
 * no persistence). Plans come from apps/studio/tests/integration/fixtures/m5-wo11-maneuver-cost-plans.json, regenerated and
 * required identical by packages/prowess-db/tests/unit/m5-wo11-inspector-fixture.test.ts. Studio never imports
 * @prowess/game: every number below — Base AP, Condition-reduced AP, attack floor, post-Condition AP, final AP, Base MP,
 * Condition MP, final MP — is M4's.
 * Guard index (docs/architecture/m5-invariants.json): M5-I277 · M5-I279.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Ref = { entityVersionId: string; canonicalKey: string };
type Steps = { baseAp: string; baseMp: string; conditionReducedAp: string; attackFloor: string; postConditionAp: string; finalAp: string; conditionMp: string; finalMp: string; explanation: string };
type Fixture = {
  trace: string;
  evaluationKey: string;
  definition: Ref;
  plan: { steps: { stepKey: string; operation: string }[] };
  sourceMap: { entries: { stepKey: string; role: string; definitions: Ref[] }[] };
  steps: Steps;
  cost: {
    structure: { separateAttackResolutions: number; resolutionGroups: { kind: string; actionKeys: string[]; effects: string[] }[] };
    ap: { baseApCost: number; conditionReducedApCost: number; conditionAttackFloor: number; postConditionApCost: number; finalApCost: number; signature: { assigned: boolean }; contributions: { stepKey: string; componentKey: string; definition: Ref }[] };
    mp: { baseMpCost: number; finalMpCost: number; contributions: { stepKey: string; definition: Ref }[] };
  };
};
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/m5-wo11-maneuver-cost-plans.json"), "utf8")) as Fixture[];
/** [Base AP, Condition-reduced AP, attack floor, post-Condition AP, final AP, Base MP, final MP] */
const EXPECTED: Record<string, [number, number, number, number, number, number, number]> = {
  A: [3, 2, 1, 2, 2, 0, 0],
  B: [7, 5, 1, 5, 5, 0, 0],
  C: [5, 2, 2, 2, 2, 0, 0],
  D: [8, 5, 1, 5, 5, 0, 0],
  E: [2, 2, 1, 2, 2, 4, 4],
  F: [4, 4, 1, 4, 4, 8, 5],
  G: [6, 3, 1, 3, 3, 0, 0],
  H: [3, 2, 1, 2, 1, 0, 0],
  I: [4, 2, 2, 2, 1, 0, 0],
  J: [3, 0, 1, 1, 1, 0, 0],
};

describe("M5-WO11 final Maneuver cost through POST /api/rules/evaluate (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("covers traces A–J with existing M4 operations only; Powerful Blow is one resolution; support has none", () => {
    expect(fixtures.map((f) => f.trace)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    for (const f of fixtures) for (const s of f.plan.steps) expect(["FORMULA", "REQUIREMENT", "KEYWORD", "MODIFIER", "EXPLANATION"]).toContain(s.operation);
    const byTrace = Object.fromEntries(fixtures.map((f) => [f.trace, f.cost.structure]));
    expect([byTrace.C!.separateAttackResolutions, byTrace.D!.separateAttackResolutions, byTrace.J!.separateAttackResolutions]).toEqual([2, 1, 0]);
    expect(byTrace.D!.resolutionGroups.map((g) => [g.kind, g.actionKeys, g.effects])).toEqual([["POWERFUL_BLOW", ["attack1", "attack2"], ["effect1"]]]);
  });

  it.each(fixtures)("trace $trace: M4 computes Base AP, Conditions, the attack floor, Signature, final AP and MP — writing nothing", async (f) => {
    const rulesetId = await apiRuleset(`wo11${f.trace}`), entity = await entityWithVersions(`wo11${f.trace}`, "WO11"), manifest = await apiManifest(rulesetId, [{ entityId: entity.entity.id, entityVersionId: entity.versions[0]!.id }]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    const names = tables.map((t) => t.table_name), before = await fingerprint(names);
    const r = await call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: f.evaluationKey, plan: f.plan });
    expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
    expect(await fingerprint(names)).toEqual(before); // no persistence, no Resource mutation
    const run = r.data.data as { executionStatus: string; steps: { stepKey: string; response: { data: { finalValue?: number; finalTargets?: { value: number }[]; sections?: unknown[] } } }[] };
    expect(run.executionStatus).toBe("COMPLETE");
    const data = (k: string) => run.steps.find((s) => s.stepKey === k)!.response.data;
    const target = (k: string) => data(k).finalTargets![0]!.value;
    expect([target(f.steps.baseAp), data(f.steps.conditionReducedAp).finalValue, data(f.steps.attackFloor).finalValue, target(f.steps.postConditionAp), target(f.steps.finalAp), target(f.steps.baseMp), target(f.steps.finalMp)]).toEqual(EXPECTED[f.trace]);
    const c = f.cost;
    expect([c.ap.baseApCost, c.ap.conditionReducedApCost, c.ap.conditionAttackFloor, c.ap.postConditionApCost, c.ap.finalApCost, c.mp.baseMpCost, c.mp.finalMpCost]).toEqual(EXPECTED[f.trace]);
    expect(c.ap.signature.assigned).toBe(["H", "I"].includes(f.trace));
    expect(data(f.steps.explanation).sections!.length).toBeGreaterThan(0);
    for (const x of [...c.ap.contributions, ...c.mp.contributions]) expect(f.sourceMap.entries.find((e) => e.stepKey === x.stepKey)?.definitions.map((d) => d.entityVersionId)).toContain(x.definition.entityVersionId);
  });
});
