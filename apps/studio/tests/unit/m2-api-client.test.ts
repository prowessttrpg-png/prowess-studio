import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuleset, getRuleset, GovernanceApiError, listRulesets, resolveEntity, verifyReleaseHash } from "../../src/api-client";

/** PAS-10 M2-WO10 §84: the client decodes envelopes and preserves domain codes; fetch is mocked at the boundary. */
const respond = (status: number, body: unknown) => vi.fn(async (_input?: unknown, _init?: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

describe("governance API client", () => {
  it("decodes a successful { data } envelope and calls a relative /api URL", async () => {
    const fetchMock = respond(200, { data: { id: "r1", name: "Core" } });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getRuleset("r1")).resolves.toEqual({ id: "r1", name: "Core" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/rulesets/r1");
  });
  it("decodes a list envelope with pagination", async () => {
    vi.stubGlobal("fetch", respond(200, { data: [{ id: "a" }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }));
    await expect(listRulesets({ status: "DRAFT" })).resolves.toEqual({ items: [{ id: "a" }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
  });
  it("returns the created resource for a 201 POST and sends JSON", async () => {
    const fetchMock = respond(201, { data: { id: "new", status: "DRAFT" } });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createRuleset({ name: "x" })).resolves.toEqual({ id: "new", status: "DRAFT" });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST", body: JSON.stringify({ name: "x" }) });
  });
  it("preserves the domain error code, status and field", async () => {
    vi.stubGlobal("fetch", respond(409, { code: "RULESET_RELEASE.STALE_CHANGE_SET", message: "stale", field: null, details: null }));
    const error = await getRuleset("r1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GovernanceApiError);
    expect(error).toMatchObject({ code: "RULESET_RELEASE.STALE_CHANGE_SET", status: 409 });
  });
  it("turns an unreadable or malformed payload into INVALID_RESPONSE, and a network failure into NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", respond(200, "<html>"));
    await expect(getRuleset("r1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    vi.stubGlobal("fetch", respond(200, { nope: true }));
    await expect(getRuleset("r1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    vi.stubGlobal("fetch", respond(200, { data: "not a list" }));
    await expect(listRulesets()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(getRuleset("r1")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
  it("a 200 null resolution and a 200 hash mismatch are RESULTS, not errors", async () => {
    vi.stubGlobal("fetch", respond(200, { data: { resolution: null } }));
    await expect(resolveEntity("m", "e")).resolves.toEqual({ resolution: null });
    vi.stubGlobal("fetch", respond(200, { data: { releaseId: "r", valid: false, storedHash: "a", computedHash: "b" } }));
    await expect(verifyReleaseHash("r")).resolves.toMatchObject({ valid: false });
  });
});
