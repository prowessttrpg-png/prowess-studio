import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeMatches,
  completeImportReview,
  createImportBatch,
  extractImportBatch,
  getReviewSummary,
  GovernanceApiError,
  listBatchCandidates,
  listConflictSignals,
  listSourceSnapshots,
  submitDecision,
} from "../../src/api-client";

/** PAS-10 M3-WO8 §78 — the Import API client: routes, methods, query encoding, bodies, envelopes and errors. */
const respond = (status: number, body: unknown) => vi.fn(async (_input?: unknown, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());
const call = (m: ReturnType<typeof respond>, i = 0) => ({ url: String(m.mock.calls[i]![0]), init: m.mock.calls[i]![1] ?? {} });

describe("Import API client", () => {
  it("GETs relative /api/import URLs with encoded queries and decodes pagination", async () => {
    const f = respond(200, { data: [{ id: "c1" }], pagination: { page: 3, pageSize: 25, total: 60, totalPages: 3 } });
    vi.stubGlobal("fetch", f);
    await expect(listBatchCandidates("b/1", { page: 3, pageSize: 25 })).resolves.toEqual({ items: [{ id: "c1" }], pagination: { page: 3, pageSize: 25, total: 60, totalPages: 3 } });
    expect(call(f)).toMatchObject({ url: "/api/import/batches/b%2F1/candidates?page=3&pageSize=25" });
    expect(call(f).init.method).toBe("GET");
    await listSourceSnapshots("d1");
    expect(call(f, 1).url).toBe("/api/import/source-snapshots?sourceDocumentId=d1");
    await listConflictSignals("b1", "r1");
    expect(call(f, 2).url).toBe("/api/import/batches/b1/conflicts?matchRunId=r1");
  });

  it("an optional matchRunId is only sent when given", async () => {
    const f = respond(200, { data: { totalCandidates: 0 } });
    vi.stubGlobal("fetch", f);
    await getReviewSummary("b1");
    await getReviewSummary("b1", "r1");
    expect([call(f).url, call(f, 1).url]).toEqual(["/api/import/batches/b1/review-summary", "/api/import/batches/b1/review-summary?matchRunId=r1"]);
  });

  it("commands POST exactly their bodies; extraction and completion send none", async () => {
    const f = respond(201, { data: { batch: { id: "b1" }, created: true } });
    vi.stubGlobal("fetch", f);
    await createImportBatch({ sourceSnapshotId: "s1", label: "L", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1" });
    expect(call(f)).toMatchObject({ url: "/api/import/batches", init: { method: "POST" } });
    expect(JSON.parse(String(call(f).init.body))).toEqual({ sourceSnapshotId: "s1", label: "L", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1" });
    await extractImportBatch("b1");
    await completeImportReview("b1");
    expect([call(f, 1).url, call(f, 1).init.body, call(f, 2).url, call(f, 2).init.body]).toEqual(["/api/import/batches/b1/extract", undefined, "/api/import/batches/b1/complete-review", undefined]);
    await analyzeMatches("b1");
    expect([call(f, 3).url, call(f, 3).init.body]).toEqual(["/api/import/batches/b1/match-runs", "{}"]);
    await submitDecision("c1", { candidateFingerprint: "f".repeat(64), decisionType: "APPROVE_SEMANTIC" });
    expect(call(f, 4).url).toBe("/api/import/candidates/c1/decisions");
    expect(Object.keys(JSON.parse(String(call(f, 4).init.body)))).toEqual(["candidateFingerprint", "decisionType"]);
  });

  it("keeps the controlled domain error code, status and field", async () => {
    vi.stubGlobal("fetch", respond(409, { code: "IMPORT_DECISION.INVALID_TRANSITION", message: "no", field: null, details: null }));
    const error = await submitDecision("c1", { candidateFingerprint: "x", decisionType: "REJECT" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GovernanceApiError);
    expect(error).toMatchObject({ code: "IMPORT_DECISION.INVALID_TRANSITION", status: 409 });
    vi.stubGlobal("fetch", respond(400, { code: "API.INVALID_BODY", message: "bad", field: "status", details: null }));
    await expect(createImportBatch({ sourceSnapshotId: "s", label: "l", scope: { type: "SNAPSHOT" }, extractorKey: "k", extractorVersion: "1" })).rejects.toMatchObject({ code: "API.INVALID_BODY", field: "status" });
  });
});
