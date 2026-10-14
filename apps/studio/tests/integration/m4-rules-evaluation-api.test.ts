/**
 * M4-WO10 — POST /api/rules/evaluate over real HTTP handlers and a real test database (PAS-10 M4-WO10 §128–139, §184).
 * Guards M4-I155 (HTTP Evaluation Is Stateless), M4-I156 (HTTP Ruleset Selection Requires Exact Manifest Or Release
 * Identity), M4-I157 (HTTP Callers Cannot Forge Resolved Ruleset Context), M4-I158 (Rules Evaluation Performs No
 * Database Writes), M4-I161 (Evaluation History Is Reproducible From Exact Inputs) and M4-I162 (Listed Cost And
 * Runtime Payment Remain Distinct Across Orchestration). Executable fixtures use neutral names only.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiPolicy, apiRuleset } from "./m2-flow";
import * as R from "./m2-routes";

const evaluate = (body: unknown) => call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, body);

/** Every table in the public schema — the read-only proof covers the whole database, not a chosen list. */
async function allTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  return rows.map((r) => r.table_name);
}

const snapshot = {
  resources: [
    { resourceKey: "r.temp", kind: "TEMPORARY_POOL", current: 6, minimum: 0, maximum: 10, reservedCapacity: 0 },
    { resourceKey: "r.primary", kind: "POOL", current: 20, minimum: 0, maximum: 20, reservedCapacity: 0 },
  ],
};
const fromStep = (target: string, stepKey: string, pointer: string) => ({ target, source: { kind: "STEP", stepKey, pointer } });

/** The generic vertical slice: 17 is authored only as its summands; every later value flows through bindings. */
const plan = {
  primaryStepKey: "listed",
  validationStepKey: "validation",
  explanationStepKey: "explanation",
  steps: [
    { stepKey: "base", order: 10, operation: "FORMULA", input: { program: { expression: "a + b" }, variables: { a: 10, b: 7 } } },
    { stepKey: "listed", order: 20, operation: "MODIFIER", input: { request: { targets: [{ targetKey: "t.listed", kind: "NUMERIC", value: 0 }], modifiers: [] } }, bindings: [fromStep("/request/targets/0/value", "base", "/data/finalValue")] },
    {
      stepKey: "derived",
      order: 30,
      operation: "FORMULA",
      input: { program: { expression: "listed / divisor", rounding: "FLOOR" }, variables: { listed: 0, divisor: 0 } },
      bindings: [fromStep("/variables/listed", "listed", "/data/finalTargets/0/value"), { target: "/variables/divisor", source: { kind: "CONTEXT", context: "ACTOR", pointer: "/stats/divisor" } }],
    },
    {
      stepKey: "payment",
      order: 40,
      operation: "RESOURCE_PAYMENT_APPLY",
      input: { snapshot, payment: { costKey: "cost.example", listedAmount: 0, sources: [{ resourceKey: "r.temp", order: 10 }, { resourceKey: "r.primary", order: 20 }] } },
      bindings: [fromStep("/payment/listedAmount", "listed", "/data/finalTargets/0/value")],
    },
    {
      stepKey: "validation",
      order: 50,
      operation: "VALIDATION",
      input: { request: { sources: [{ sourceKey: "derived", order: 1, response: null }, { sourceKey: "payment", order: 2, response: null }] } },
      bindings: [fromStep("/request/sources/0/response", "derived", ""), fromStep("/request/sources/1/response", "payment", "")],
    },
    {
      stepKey: "explanation",
      order: 60,
      operation: "EXPLANATION",
      input: {
        input: {
          explanationKey: "vertical-slice",
          contributions: [
            { contributionKey: "listed", order: 1, kind: "MODIFIER", response: null },
            { contributionKey: "derived", order: 2, kind: "FORMULA", response: null },
            { contributionKey: "payment", order: 3, kind: "RESOURCE", response: null },
            { contributionKey: "validation", order: 4, kind: "VALIDATION", response: null },
          ],
        },
      },
      bindings: [
        fromStep("/input/contributions/0/response", "listed", ""),
        fromStep("/input/contributions/1/response", "derived", ""),
        fromStep("/input/contributions/2/response", "payment", ""),
        fromStep("/input/contributions/3/response", "validation", ""),
      ],
    },
  ],
};
const actor = { stats: { divisor: 4 } };

type Run = { evaluationKey: string; executionStatus: string; steps: Array<{ stepKey: string; executionStatus: string; response: { status: string; data: Record<string, unknown> | null; ruleset: Record<string, unknown> | null; errors: Array<{ code: string }> } | null }> };
const stepData = (run: Run, key: string) => run.steps.find((s) => s.stepKey === key)?.response?.data as Record<string, unknown>;

async function manifestFixture(label: string) {
  const rulesetId = await apiRuleset(label);
  const a = await entityWithVersions(`${label}A`, "A1", "A2");
  const manifest = await apiManifest(rulesetId, [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }]);
  return { rulesetId, a, manifest };
}

describe("M4-WO10 API — POST /api/rules/evaluate (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("vertical slice on an exact Manifest: 17 → 4, payment 6 + 11, primary left 9, listed still 17 — no database write", async () => {
    const { manifest } = await manifestFixture("slice");
    const tables = await allTables();
    const before = await fingerprint(tables);
    const r = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: "slice", actor, plan });
    expect(await fingerprint(tables)).toEqual(before);
    expect([r.status, r.data.status, r.data.success]).toEqual([200, "SUCCESS", true]);
    const run = r.data.data as Run;
    expect([run.executionStatus, run.steps.map((s) => s.response?.status)]).toEqual(["COMPLETE", ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]]);
    expect(stepData(run, "base").finalValue).toBe(17);
    expect((stepData(run, "listed").finalTargets as Array<{ value: number }>)[0]?.value).toBe(17);
    expect(stepData(run, "derived").finalValue).toBe(4);
    const pay = stepData(run, "payment") as { listedAmount: number; allocations: Array<{ amountPaid: number }>; resultingResources: { resources: Array<{ resourceKey: string; current: number }> } };
    expect([pay.listedAmount, pay.allocations.map((a) => a.amountPaid), pay.resultingResources.resources.find((x) => x.resourceKey === "r.primary")?.current]).toEqual([17, [6, 11], 9]);
    const doc = stepData(run, "explanation") as { sections: Array<{ sectionKey: string; facts: Array<{ factKey: string; value: unknown }> }> };
    expect(doc.sections.find((s) => s.sectionKey === "payment")?.facts.find((f) => f.factKey === "listedAmount")?.value).toBe(17);
    expect(JSON.stringify(r.data)).not.toMatch(/effective|reduced to|netCost/i);
    // The exact Manifest context, server-resolved, on the run and on every child.
    expect(r.data.ruleset).toMatchObject({ manifestId: manifest.id, manifestHash: null, release: null });
    for (const s of run.steps) expect(s.response?.ruleset).toEqual(r.data.ruleset);
  });

  it("M4-I161: an exact Manifest evaluation is reproducible after newer Manifests, Versions and Releases exist", async () => {
    const { rulesetId, a, manifest } = await manifestFixture("history");
    const body = { ruleset: { kind: "MANIFEST", manifestId: manifest.id }, evaluationKey: "history", actor, plan };
    const first = await evaluate(body);
    await apiManifest(rulesetId, [{ entityId: a.entity.id, entityVersionId: a.versions[1]!.id }]);
    await entityWithVersions("historyLater", "L1");
    await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: manifest.id, canonPolicyId: (await apiPolicy(rulesetId)).id, versionLabel: "later" });
    const again = await evaluate(body);
    expect(again.data).toEqual(first.data);
  });

  it("an exact Release: hash verified first, evaluated against its frozen composition, reproducible after a later Release", async () => {
    const { rulesetId, a, manifest } = await manifestFixture("release");
    const policy = await apiPolicy(rulesetId);
    const rel = (await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "r1" })).data;
    const body = { ruleset: { kind: "RELEASE", releaseId: rel.id }, evaluationKey: "release", actor, plan };
    const tables = await allTables();
    const before = await fingerprint(tables);
    const first = await evaluate(body);
    expect(await fingerprint(tables)).toEqual(before);
    expect(first.status).toBe(200);
    expect(first.data.ruleset).toMatchObject({ manifestId: rel.manifestId, manifestHash: rel.manifestHash, release: { releaseId: rel.id, releaseNumber: rel.releaseNumber, versionLabel: "r1" } });
    const later = await apiManifest(rulesetId, [{ entityId: a.entity.id, entityVersionId: a.versions[1]!.id }]);
    await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: later.id, canonPolicyId: policy.id, versionLabel: "r2" });
    expect((await evaluate(body)).data).toEqual(first.data);
    // Manifest and Release modes keep their own exact provenance.
    const manifestMode = await evaluate({ ...body, ruleset: { kind: "MANIFEST", manifestId: manifest.id } });
    expect(manifestMode.data.ruleset).toMatchObject({ manifestId: manifest.id, release: null });
  });

  it("a tampered Release is refused (409) before any orchestration", async () => {
    const { rulesetId, a, manifest } = await manifestFixture("tamper");
    const rel = (await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: manifest.id, canonPolicyId: (await apiPolicy(rulesetId)).id, versionLabel: "t" })).data;
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: rel.manifestId } });
    try {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${a.versions[1]!.id}::uuid WHERE id = ${entry.id}::uuid`;
      const r = await evaluate({ ruleset: { kind: "RELEASE", releaseId: rel.id }, evaluationKey: "tamper", plan });
      expect([r.status, r.body.error?.code]).toEqual([409, "RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE"]);
      expect(r.data).toBeUndefined();
    } finally {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
    }
  });

  it("rule outcomes are HTTP 200: an INVALID child, canPay:false, a PARTIAL run and an INVALID plan", async () => {
    const { manifest } = await manifestFixture("outcomes");
    const ruleset = { kind: "MANIFEST", manifestId: manifest.id };
    const partial = await evaluate({
      ruleset,
      evaluationKey: "partial",
      plan: {
        steps: [
          { stepKey: "a", order: 1, operation: "FORMULA", input: { program: { expression: "1 / 0" }, variables: {} } },
          { stepKey: "b", order: 2, operation: "FORMULA", input: { program: { expression: "x" }, variables: { x: 0 } }, bindings: [fromStep("/variables/x", "a", "/data/finalValue")] },
          { stepKey: "c", order: 3, operation: "RESOURCE_PAYMENT_PREVIEW", input: { snapshot, payment: { costKey: "c", listedAmount: 999, sources: [{ resourceKey: "r.temp", order: 1 }] } } },
        ],
      },
    });
    expect([partial.status, partial.data.status]).toEqual([200, "SUCCESS"]);
    const run = partial.data.data as Run;
    expect([run.executionStatus, run.steps.map((s) => [s.executionStatus, s.response?.status ?? null])]).toEqual(["PARTIAL", [["EXECUTED", "INVALID"], ["BLOCKED", null], ["EXECUTED", "SUCCESS"]]]);
    expect(run.steps[0]?.response?.errors[0]?.code).toBe("FORMULA.DIVISION_BY_ZERO");
    expect(stepData(run, "c").canPay).toBe(false);
    const invalidPlan = await evaluate({ ruleset, evaluationKey: "bad", plan: { steps: [{ stepKey: "a", order: 1, operation: "SPELL_COST", input: {} }] } });
    expect([invalidPlan.status, invalidPlan.data.status, invalidPlan.data.errors[0]?.code]).toEqual([200, "INVALID", "ORCHESTRATION.UNKNOWN_OPERATION"]);
  });

  it("M4-I156 / M4-I157: only an exact Manifest or Release selector — no id alone, latest, hash, number, label or resolved context", async () => {
    const { rulesetId, manifest } = await manifestFixture("strict");
    const base = { evaluationKey: "strict", plan: { steps: [] } };
    for (const ruleset of [
      { rulesetId },
      { kind: "MANIFEST", manifestId: manifest.id, releaseId: manifest.id },
      { kind: "MANIFEST" },
      { kind: "MANIFEST", manifestId: manifest.id, manifestHash: "a".repeat(64) },
      { kind: "RELEASE", releaseId: manifest.id, releaseNumber: 1 },
      { kind: "RELEASE", releaseId: manifest.id, versionLabel: "x" },
      { kind: "CURRENT", rulesetId },
      { kind: "LATEST", rulesetId },
      { kind: "MANIFEST", manifestId: "not-a-uuid" },
      { current: true },
      "latest",
    ]) {
      const r = await evaluate({ ...base, ruleset });
      expect([r.status, r.body.error?.code], JSON.stringify(ruleset)).toEqual([400, "API.INVALID_BODY"]);
    }
    const resolved = await evaluate({ ...base, ruleset: { kind: "MANIFEST", manifestId: manifest.id }, resolvedRuleset: { rulesetId, manifestId: manifest.id } });
    expect([resolved.status, resolved.body.error?.field]).toEqual([400, "resolvedRuleset"]);
    for (const field of ["latest", "status", "persist", "commit", "applyToCharacter", "manifestHash", "releaseNumber"]) {
      const r = await evaluate({ ...base, ruleset: { kind: "MANIFEST", manifestId: manifest.id }, [field]: true });
      expect([r.status, r.body.error?.field], field).toEqual([400, field]);
    }
  });

  it("transport errors: malformed JSON, wrong JSON types and missing fields are 400; unknown Manifest / Release are 404", async () => {
    const { manifest } = await manifestFixture("transport");
    const ruleset = { kind: "MANIFEST", manifestId: manifest.id };
    expect((await evaluate("{ not json")).status).toBe(400);
    expect((await evaluate([])).status).toBe(400);
    expect((await evaluate({ ruleset, evaluationKey: "x" })).body.error?.field).toBe("plan");
    expect((await evaluate({ ruleset, evaluationKey: 1, plan: { steps: [] } })).status).toBe(400);
    expect((await evaluate({ ruleset, evaluationKey: "x", plan: { steps: [] }, actor: [1] })).body.error?.field).toBe("actor");
    const missingManifest = await evaluate({ ruleset: { kind: "MANIFEST", manifestId: "00000000-0000-4000-8000-0000000000ff" }, evaluationKey: "x", plan: { steps: [] } });
    const missingRelease = await evaluate({ ruleset: { kind: "RELEASE", releaseId: "00000000-0000-4000-8000-0000000000ff" }, evaluationKey: "x", plan: { steps: [] } });
    expect([missingManifest.status, missingRelease.status]).toEqual([404, 404]);
  });

  it("the route exposes POST only (no PATCH / PUT / DELETE / GET, no commit)", () => {
    expect(Object.keys(Evaluate).sort()).toEqual(["POST"]);
  });
});
