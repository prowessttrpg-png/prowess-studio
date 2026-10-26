/**
 * M5-WO12 Effect-chain execution traces A–H through the EXISTING POST /api/rules/evaluate endpoint (no WO12-only API, no
 * UI, no persistence). Traces come from apps/studio/tests/integration/fixtures/m5-wo12-effect-execution-traces.json,
 * regenerated and required identical by packages/prowess-db/tests/unit/m5-wo12-inspector-fixture.test.ts. Studio never
 * imports @prowess/game: every hit, miss, critical, Save result and trigger verdict below is M4's, replayed from the
 * recorded plan and contexts, and the replay writes nothing (the outcome records are inert).
 * Guard index (docs/architecture/m5-invariants.json): M5-I314.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";

type Core = { requestKey: string; procedure: string; evaluationKey: string; plan: { steps: { operation: string }[] }; contexts: { actor: unknown; runtime: unknown }; outputs: { natural: number | null; total: number | null; success: boolean; criticalHit: boolean | null } };
type Trigger = { evaluationKey: string; plan: { steps: { operation: string }[] }; satisfied: boolean };
type Outcome = { targetKey: string; effectKey: string; groupKey: string | null; result: string; critical: boolean; resolvedBy: string | null; operations: { kind: string }[] };
type Fixture = {
  trace: string;
  key: string;
  inputs: string[];
  execution: { status: string; outcomes: Outcome[]; pendingInputs: unknown[]; targets: { targetKey: string; termination: string | null; nodes: { effectKey: string; status: string }[] }[] | null; groups: { kind: string; targets: { resolution: { requestKey: string | null } }[] }[] | null };
  coreEvaluations: Core[];
  triggerEvaluations: Trigger[];
};
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/m5-wo12-effect-execution-traces.json"), "utf8")) as Fixture[];
const outputValue = (d: Record<string, unknown> | undefined) => (d === undefined ? null : "finalValue" in d ? d.finalValue : "satisfied" in d ? d.satisfied : null);

describe("M5-WO12 Effect-chain execution through POST /api/rules/evaluate (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("covers traces A–H; outcomes are inert records with exact routing (one Powerful Blow roll, no Save after a delivery miss)", () => {
    expect(fixtures.map((f) => f.trace)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    const t = Object.fromEntries(fixtures.map((f) => [f.trace, f]));
    for (const f of fixtures) {
      expect([f.execution.status, f.execution.pendingInputs]).toEqual(["COMPLETE", []]);
      for (const p of [...f.coreEvaluations.map((c) => c.plan), ...f.triggerEvaluations.map((x) => x.plan)]) for (const s of p.steps) expect(["FORMULA", "REQUIREMENT", "KEYWORD", "MODIFIER", "EXPLANATION", "DICE"]).toContain(s.operation);
      for (const o of f.execution.outcomes) for (const op of o.operations) expect(typeof op.kind).toBe("string");
    }
    expect(t.A!.execution.targets![0]!.nodes.map((n) => n.status)).toEqual(["EXECUTED_SUCCESS", "EXECUTED_SUCCESS", "NOT_REACHED"]);
    expect(t.B!.execution.targets!.map((x) => x.termination)).toEqual(["STOP", "SUCCESS_ONLY_FAILURE"]);
    expect([t.D!.coreEvaluations.map((c) => c.procedure), t.D!.execution.targets![0]!.termination, t.D!.execution.outcomes]).toEqual([["ATTACK_ROLL"], "DELIVERY_FAILED", []]);
    expect([t.E!.coreEvaluations.length, t.E!.execution.groups!.map((g) => g.kind)]).toEqual([1, ["POWERFUL_BLOW"]]);
    expect(t.F!.execution.outcomes.map((o) => [o.groupKey, o.critical])).toEqual([["attack1", true], ["attack2", false]]);
    expect([t.G!.inputs.map((k) => k.split(".").pop()), t.G!.coreEvaluations.map((c) => c.procedure)]).toEqual([["save_removal", "save_selection", "saving_throw"], ["SAVING_THROW"]]);
    expect([t.H!.triggerEvaluations.map((x) => x.satisfied), t.H!.execution.targets![0]!.nodes.map((n) => n.status)]).toEqual([[false], ["EXECUTED_FAILURE", "NOT_TRIGGERED", "EXECUTED_SUCCESS"]]);
  });

  it.each(fixtures)("trace $trace: M4 reproduces every core resolution and trigger verdict — writing nothing", async (f) => {
    const rulesetId = await apiRuleset(`wo12${f.trace}`), entity = await entityWithVersions(`wo12${f.trace}`, "WO12"), manifest = await apiManifest(rulesetId, [{ entityId: entity.entity.id, entityVersionId: entity.versions[0]!.id }]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    const names = tables.map((t) => t.table_name), before = await fingerprint(names);
    for (const c of f.coreEvaluations) {
      const r = await call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: c.evaluationKey, actor: c.contexts.actor, runtime: c.contexts.runtime, plan: c.plan });
      expect([r.status, r.data.status], c.requestKey).toEqual([200, "SUCCESS"]);
      const run = r.data.data as { executionStatus: string; steps: { stepKey: string; response: { data: Record<string, unknown> } }[] };
      expect(run.executionStatus).toBe("COMPLETE");
      const values = run.steps.map((s) => outputValue(s.response?.data));
      expect(values, c.requestKey).toContain(c.outputs.success);
      if (c.outputs.total !== null) expect(values, c.requestKey).toContain(c.outputs.total);
      // The outcome the executor emitted is the one M4 produced from the recorded roll — never a caller's claim.
      const resolved = f.execution.outcomes.filter((o) => o.resolvedBy === c.requestKey);
      const effectSuccess = c.procedure === "ATTACK_ROLL" ? c.outputs.success : !c.outputs.success;
      for (const o of resolved) expect(o.result, `${c.requestKey} → ${o.effectKey}`).toBe(effectSuccess ? "SUCCESS" : "FAILURE");
    }
    for (const x of f.triggerEvaluations) {
      const r = await call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: x.evaluationKey, plan: x.plan });
      expect([r.status, r.data.status]).toEqual([200, "SUCCESS"]);
      const run = r.data.data as { steps: { response: { data: { satisfied?: boolean } } }[] };
      expect(run.steps[0]!.response.data.satisfied, x.evaluationKey).toBe(x.satisfied);
    }
    expect(await fingerprint(names)).toEqual(before); // no persistence, no HP / Condition / Resource mutation
  });
});
