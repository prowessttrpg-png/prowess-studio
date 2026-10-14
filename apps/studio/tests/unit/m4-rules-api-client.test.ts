import { afterEach, describe, expect, it, vi } from "vitest";
import { runRulesEvaluation, type RulesEvaluationRequest } from "../../src/api-client/rules";
import { GovernanceApiError } from "../../src/api-client/http";

afterEach(() => vi.unstubAllGlobals());
describe("WO11 typed HTTP client — exact request and response", () => {
  it.each(["MANIFEST", "RELEASE"] as const)("preserves %s selector, null contexts and all child data", async kind => {
    const request: RulesEvaluationRequest = { ruleset: kind === "MANIFEST" ? { kind, manifestId: "m" } : { kind, releaseId: "r" }, evaluationKey: "x", actor: null, build: null, runtime: null, plan: { steps: [] } };
    const exact = { status: "SUCCESS", success: true, data: { executionStatus: "PARTIAL", steps: [{ response: { status: "INVALID", data: null } }] }, trace: { steps: [], stepCount: 0 }, errors: [], warnings: [], info: [] };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: exact }) });
    vi.stubGlobal("fetch", fetcher);
    expect(await runRulesEvaluation(request)).toBe(exact);
    expect(fetcher).toHaveBeenCalledWith("/api/rules/evaluate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  });
  it.each([400, 404, 409, 500])("preserves centralized safe transport errors (%s)", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ code: "SAFE.CODE", message: "Safe server message", field: null }) }));
    await expect(runRulesEvaluation({} as RulesEvaluationRequest)).rejects.toMatchObject({ code: "SAFE.CODE", message: "Safe server message", status });
  });
  it("network and malformed response failures use the existing transport boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private network details")));
    await expect(runRulesEvaluation({} as RulesEvaluationRequest)).rejects.toMatchObject({ code: "NETWORK_ERROR", message: "Could not reach the server." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    await expect(runRulesEvaluation({} as RulesEvaluationRequest)).rejects.toBeInstanceOf(GovernanceApiError);
  });
});
