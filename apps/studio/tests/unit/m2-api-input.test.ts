// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/api/errors";
import { objectArray, optString, optUuid, queryEnum, queryString, queryUuid, readStrictBody, reqEnum, reqString, requireNoBody, reqUuid, strictObject, strictQuery, uuidArray } from "../../src/api/m2/input";
import { paginatedList } from "../../src/api/m2/list";

/** PAS-10 M2-WO9 §5, §46, §47, §91: shape-only request reading and list serialization for the M2 API. */
const U = "11111111-1111-4111-8111-111111111111";
const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a 400 ApiError");
};
const req = (body: string | undefined) => new Request("http://localhost/x", { method: "POST", body });

describe("strict body reading", () => {
  it("accepts only allowed keys; an unknown or forbidden key (status, releaseNumber) is a 400 naming the field", () => {
    expect(strictObject({ name: "x" }, ["name"])).toEqual({ name: "x" });
    for (const k of ["status", "releaseNumber", "manifestHash"]) {
      expect(fail(() => strictObject({ name: "x", [k]: 1 }, ["name"]))).toMatchObject({ code: "API.INVALID_BODY", status: 400, field: k });
    }
    for (const bad of [null, [], "s", 3]) expect(fail(() => strictObject(bad, []))).toMatchObject({ code: "API.INVALID_BODY", status: 400 });
  });
  it("malformed JSON is a controlled 400 without parser detail; a non-object body is a 400", async () => {
    const e = await readStrictBody(req("{ nope"), []).catch((x: unknown) => x as ApiError);
    expect(e).toMatchObject({ code: "API.INVALID_BODY", status: 400 });
    expect((e as ApiError).message).not.toMatch(/Unexpected|SyntaxError|position/);
    await expect(readStrictBody(req("[1]"), [])).rejects.toMatchObject({ status: 400 });
  });
  it("named command routes accept no body or {} only", async () => {
    await expect(requireNoBody(req(undefined))).resolves.toBeUndefined();
    await expect(requireNoBody(req("{}"))).resolves.toBeUndefined();
    await expect(requireNoBody(req('{"status":"APPROVED"}'))).rejects.toMatchObject({ field: "status" });
    await expect(requireNoBody(req("nope"))).rejects.toMatchObject({ code: "API.INVALID_BODY" });
  });
  it("field readers check presence, type, UUID format and controlled vocabularies; null stays null", () => {
    expect(reqString({ a: "x" }, "a")).toBe("x");
    expect(fail(() => reqString({ a: 1 }, "a")).field).toBe("a");
    expect(optString({}, "a")).toBeUndefined();
    expect(optString({ a: null }, "a")).toBeNull();
    expect(reqUuid({ a: U }, "a")).toBe(U);
    expect(fail(() => reqUuid({ a: "x" }, "a")).field).toBe("a");
    expect(optUuid({ a: null }, "a")).toBeNull();
    expect(reqEnum({ a: "B" }, "a", ["A", "B"])).toBe("B");
    expect(fail(() => reqEnum({ a: "b" }, "a", ["A", "B"])).field).toBe("a");
    expect(uuidArray({ a: [U] }, "a")).toEqual([U]);
    expect(fail(() => uuidArray({ a: [U, "x"] }, "a")).field).toBe("a");
    expect(fail(() => uuidArray({ a: U }, "a")).field).toBe("a");
    expect(objectArray({ a: [{ id: U }] }, "a", ["id"], (o, at) => reqUuid(o, "id", at))).toEqual([U]);
    expect(fail(() => objectArray({ a: [{ id: U, x: 1 }] }, "a", ["id"], (o) => o)).field).toBe("x");
    expect(fail(() => objectArray({ a: "x" }, "a", [], (o) => o)).field).toBe("a");
  });
});

describe("strict query reading", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("unknown parameters, malformed UUIDs, unknown enum values and missing required values are 400s", () => {
    expect(() => strictQuery(q("page=1"), ["page"])).not.toThrow();
    expect(fail(() => strictQuery(q("winner=1"), ["page"]))).toMatchObject({ code: "API.INVALID_QUERY", field: "winner" });
    expect(queryUuid(q(""), "id")).toBeUndefined();
    expect(fail(() => queryUuid(q("id=x"), "id")).field).toBe("id");
    expect(fail(() => queryUuid(q(""), "id", true)).field).toBe("id");
    expect(queryEnum(q("s=A"), "s", ["A"])).toBe("A");
    expect(fail(() => queryEnum(q("s=a"), "s", ["A"])).field).toBe("s");
    expect(queryString(q("k=global"), "k")).toBe("global");
    expect(fail(() => queryString(q("k="), "k")).field).toBe("k");
  });
});

describe("paginatedList", () => {
  it("pages over the service's ordered result with the M1 envelope and serializes Dates to ISO strings", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ n: i, at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)), none: null }));
    const body = await paginatedList(items, new URLSearchParams("page=2&pageSize=25")).json();
    expect(body.pagination).toEqual({ page: 2, pageSize: 25, total: 30, totalPages: 2 });
    expect(body.data.map((x: { n: number }) => x.n)).toEqual([25, 26, 27, 28, 29]);
    expect(body.data[0]).toEqual({ n: 25, at: "2026-01-01T00:00:25.000Z", none: null });
    expect(() => paginatedList(items, new URLSearchParams("pageSize=0"))).toThrow(ApiError);
  });
});
