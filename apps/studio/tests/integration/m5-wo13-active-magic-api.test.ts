/**
 * M5-WO13 active-magic traces A–F through the EXISTING POST /api/rules/evaluate endpoint (no WO13-only API, no UI, no
 * persistence). Traces come from apps/studio/tests/integration/fixtures/m5-wo13-active-magic-traces.json, regenerated and
 * required identical by packages/prowess-db/tests/unit/m5-wo13-inspector-fixture.test.ts. Studio never imports
 * @prowess/game: every Sustain MP, Concentration capacity and DC, every AP / ME / MP change and Mana Lock reservation, and
 * every Concentration Save below is M4's, replayed from the recorded plan and contexts — and the replay writes nothing.
 * Guard index (docs/architecture/m5-invariants.json): M5-I323 · M5-I335.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Plan = { steps: { stepKey: string; operation: string }[] };
type Change = { subjectKey: string; resourceKey: string; operation: string; amount: number; before: number; after: number; reservedAfter: number; runtimeSubjectKey: string };
type Transition = {
  event: string;
  status: string;
  state: { effects: { activeEffectKey: string; status: string; endReason: string | null }[]; channel: unknown };
  resourceChanges: Change[];
  formulaEvaluations: { stepKey: string; role: string; plan: Plan; value: number }[];
  runtimeEvaluations: { subjectKey: string; plan: Plan; contexts: { actor: unknown; runtime: unknown } }[];
  concentration: { capacity: number; used: number; test: { dc: number; result: string | null; core: { evaluationKey: string; plan: Plan; contexts: { actor: unknown; runtime: unknown }; total: number | null } | null } | null };
  channelResult: { status: string; readyToResolve: boolean } | null;
};
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/m5-wo13-active-magic-traces.json"), "utf8")) as { trace: string; transitions: Transition[] }[];
const CONTEXT_KEY: Record<string, string> = { AP: "resource.ap", ME: "resource.me", MP: "resource.mp" };

describe("M5-WO13 active magic through POST /api/rules/evaluate (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("covers traces A–F with existing M4 operations only; the lifecycle outcomes are exact", () => {
    expect(fixtures.map((f) => f.trace)).toEqual(["A", "B", "C", "D", "E", "F"]);
    const t = Object.fromEntries(fixtures.map((f) => [f.trace, f.transitions]));
    for (const f of fixtures) for (const x of f.transitions) for (const p of [...x.formulaEvaluations.map((e) => e.plan), ...x.runtimeEvaluations.map((e) => e.plan)]) for (const s of p.steps) expect(["FORMULA", "REQUIREMENT", "MODIFIER", "EXPLANATION", "RESOURCE_SPEND", "RESOURCE_RESTORE", "RESOURCE_RESERVE_CAPACITY", "RESOURCE_RELEASE_CAPACITY", "RESOURCE_SET_CURRENT", "RESOURCE_REFRESH", "RESOURCE_PAYMENT_PREVIEW", "RESOURCE_PAYMENT_APPLY"]).toContain(s.operation);
    expect(t.A![1]!.resourceChanges.map((c) => [c.resourceKey, c.operation, c.amount, c.before, c.after])).toEqual([["AP", "SPEND", 1, 3, 2], ["ME", "PAYMENT", 3, 3, 0], ["MP", "PAYMENT", 1, 20, 19]]);
    expect(t.B!.map((x) => x.state.effects[0]!.status)).toEqual(["ACTIVE", "ACTIVE", "ACTIVE", "ENDED"]);
    expect(t.C!.map((x) => x.resourceChanges.map((c) => [c.operation, c.amount, c.before, c.after, c.reservedAfter]))).toEqual([[["RESERVE_CAPACITY", 12, 40, 40, 12]], [["RELEASE_CAPACITY", 12, 16, 16, 0]]]);
    expect(t.D![2]!.state.effects.map((e) => [e.activeEffectKey, e.status, e.endReason])).toEqual([["A", "ACTIVE", null], ["B", "ENDED", "CONCENTRATION_FAILED"]]);
    expect([t.E![3]!.channelResult, t.F![2]!.channelResult!.status]).toEqual([expect.objectContaining({ status: "COMPLETE", readyToResolve: true }), "FAILED"]);
  });

  it.each(fixtures)("trace $trace: M4 reproduces every Formula, WO3 resource plan and Concentration Save — writing nothing", async (f) => {
    const rulesetId = await apiRuleset(`wo13${f.trace}`), entity = await entityWithVersions(`wo13${f.trace}`, "WO13"), manifest = await apiManifest(rulesetId, [{ entityId: entity.entity.id, entityVersionId: entity.versions[0]!.id }]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    const names = tables.map((t) => t.table_name), before = await fingerprint(names);
    const evaluate = async (body: Record<string, unknown>) => {
      const r = await call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, ...body });
      expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
      return r.data.data as { executionStatus: string; steps: { stepKey: string; response: { data: Record<string, unknown> | null } }[] };
    };
    for (const x of f.transitions) {
      for (const e of x.formulaEvaluations) {
        const run = await evaluate({ evaluationKey: e.stepKey, plan: e.plan });
        expect(run.steps[0]!.response.data!.finalValue, e.stepKey).toBe(e.value);
      }
      for (const e of x.runtimeEvaluations) {
        const run = await evaluate({ evaluationKey: e.subjectKey, actor: e.contexts.actor, runtime: e.contexts.runtime, plan: e.plan });
        expect(run.executionStatus).toBe("COMPLETE");
        const results = run.steps.flatMap((s) => ((s.response.data?.resultingResources as { resources?: { resourceKey: string; current: number; reservedCapacity: number }[] } | undefined)?.resources ?? []));
        for (const c of x.resourceChanges.filter((c) => c.runtimeSubjectKey === e.subjectKey)) expect(results.some((r) => r.resourceKey === CONTEXT_KEY[c.resourceKey] && r.current === c.after), `${e.subjectKey} ${c.resourceKey}`).toBe(true);
      }
      const core = x.concentration.test?.core;
      if (core) {
        const run = await evaluate({ evaluationKey: core.evaluationKey, actor: core.contexts.actor, runtime: core.contexts.runtime, plan: core.plan });
        const values = run.steps.map((s) => s.response.data?.finalValue ?? s.response.data?.satisfied);
        expect(values).toContain(x.concentration.test!.result === "SUCCESS");
        expect(values).toContain(core.total);
      }
    }
    expect(await fingerprint(names)).toEqual(before); // no persistence, no HP / Condition / Resource row mutation
  });
});
