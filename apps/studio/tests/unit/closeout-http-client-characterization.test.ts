import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompendiumApiError, getEntity, listEntities } from "../../app/compendium/_lib/api-client";
import { GovernanceApiError, apiGet, apiList, apiPost, query } from "../../src/api-client/http";

/**
 * M5-CLOSEOUT-02 R8 characterization — written and passing BEFORE the two Studio HTTP clients shared a transport. Pins
 * the exact `fetch` call shapes, error types, codes, messages, statuses and fields of both clients, including their
 * deliberate differences, so consolidation cannot silently change API semantics.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (body: string, status = 200) => new Response(body, { status });
const caught = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
};
const shape = (e: unknown) => {
  const x = e as { name: string; code?: string; message: string; status?: number; field?: string | null; constructor: { name: string } };
  return { type: x.constructor.name, name: x.name, code: x.code, message: x.message, status: x.status, field: x.field };
};

describe("M5-CLOSEOUT-02 Studio HTTP client characterization", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetch call shapes: Compendium passes the path alone; governance passes method / headers / body", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ data: [] })));
    await getEntity("e1");
    await listEntities({ page: 2, search: "", keyword: "k" });
    await apiGet("/api/x");
    await apiList("/api/y");
    await apiPost("/api/z", { a: 1 });
    await apiPost("/api/w");
    expect(fetchMock.mock.calls).toEqual([
      ["/api/entities/e1"],
      ["/api/entities?page=2&keyword=k"],
      ["/api/x", { method: "GET", headers: undefined, body: undefined }],
      ["/api/y", { method: "GET", headers: undefined, body: undefined }],
      ["/api/z", { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' }],
      ["/api/w", { method: "POST", headers: undefined, body: undefined }],
    ]);
  });

  it("success values", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: "e1" } }));
    expect(await getEntity("e1")).toEqual({ id: "e1" });
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: 1 }], pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 } }));
    expect(await listEntities({})).toEqual({ items: [{ id: 1 }], page: 1, pageSize: 1, total: 1, totalPages: 1 });
    fetchMock.mockResolvedValueOnce(json({ data: null }));
    expect(await apiGet("/api/x")).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ data: [1, 2] }));
    expect(await apiList("/api/x")).toEqual({ items: [1, 2], pagination: null });
    fetchMock.mockResolvedValueOnce(json({ data: { ok: true } }, 201));
    expect(await apiPost("/api/x", {})).toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(json({ notData: 1 }));
    expect(await getEntity("e1")).toBeUndefined();
  });

  it("network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(shape(await caught(getEntity("e1")))).toEqual({ type: "CompendiumApiError", name: "CompendiumApiError", code: "NETWORK_ERROR", message: "Could not reach the server.", status: 0, field: null });
    expect(shape(await caught(listEntities({})))).toEqual({ type: "CompendiumApiError", name: "CompendiumApiError", code: "NETWORK_ERROR", message: "Could not reach the server.", status: 0, field: null });
    expect(shape(await caught(apiGet("/api/x")))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "NETWORK_ERROR", message: "Could not reach the server.", status: 0, field: null });
    expect(shape(await caught(apiPost("/api/x", {})))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "NETWORK_ERROR", message: "Could not reach the server.", status: 0, field: null });
  });

  it("unreadable bodies: Compendium reports NETWORK_ERROR, listEntities lets the parse error through, governance reports INVALID_RESPONSE", async () => {
    fetchMock.mockResolvedValueOnce(text("<html>", 502));
    expect(shape(await caught(getEntity("e1")))).toEqual({ type: "CompendiumApiError", name: "CompendiumApiError", code: "NETWORK_ERROR", message: "The server returned an unreadable response.", status: 502, field: null });
    fetchMock.mockResolvedValueOnce(text("<html>", 200));
    const raw = await caught(listEntities({}));
    expect(raw).toBeInstanceOf(SyntaxError);
    expect(raw).not.toBeInstanceOf(CompendiumApiError);
    fetchMock.mockResolvedValueOnce(text("<html>", 503));
    expect(shape(await caught(apiGet("/api/x")))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "INVALID_RESPONSE", message: "The server returned an unreadable response.", status: 503, field: null });
  });

  it("error bodies: Compendium passes the server body through; governance normalizes and checks shape", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "ENTITY.NOT_FOUND", message: "nope", field: "id", details: null }, 404));
    expect(shape(await caught(getEntity("e1")))).toEqual({ type: "CompendiumApiError", name: "CompendiumApiError", code: "ENTITY.NOT_FOUND", message: "nope", status: 404, field: "id" });
    fetchMock.mockResolvedValueOnce(json({ message: 7 }, 500));
    expect(shape(await caught(getEntity("e1")))).toEqual({ type: "CompendiumApiError", name: "CompendiumApiError", code: undefined, message: "7", status: 500, field: undefined });
    fetchMock.mockResolvedValueOnce(json({ code: "X.Y", message: "bad", field: "f" }, 422));
    expect(shape(await caught(listEntities({})))).toEqual({ type: "CompendiumApiError", name: "CompendiumApiError", code: "X.Y", message: "bad", status: 422, field: "f" });
    fetchMock.mockResolvedValueOnce(json({ code: "X.Y", message: "bad", field: "f" }, 422));
    expect(shape(await caught(apiGet("/api/x")))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "X.Y", message: "bad", status: 422, field: "f" });
    fetchMock.mockResolvedValueOnce(json({ code: 1, message: null }, 500));
    expect(shape(await caught(apiGet("/api/x")))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "UNKNOWN_ERROR", message: "The request failed.", status: 500, field: null });
    fetchMock.mockResolvedValueOnce(json([1], 200));
    expect(shape(await caught(apiGet("/api/x")))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "INVALID_RESPONSE", message: "The server returned an unexpected response shape.", status: 200, field: null });
    fetchMock.mockResolvedValueOnce(json({ nope: 1 }, 200));
    expect(shape(await caught(apiGet("/api/x")))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "INVALID_RESPONSE", message: "The server response had no data.", status: 200, field: null });
    fetchMock.mockResolvedValueOnce(json({ data: {} }, 200));
    expect(shape(await caught(apiList("/api/x")))).toEqual({ type: "GovernanceApiError", name: "GovernanceApiError", code: "INVALID_RESPONSE", message: "Expected a list.", status: 200, field: null });
  });

  it("query strings", () => {
    expect(query({ a: 1, b: "", c: undefined, d: null, e: "x y" })).toBe("?a=1&e=x+y");
    expect(query({})).toBe("");
  });
});
