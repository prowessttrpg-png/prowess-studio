import {
  DomainError,
  ENTITY_ALIAS_ERROR_CODES,
  ENTITY_ERROR_CODES,
  ENTITY_VERSION_ERROR_CODES,
  KEYWORD_ASSIGNMENT_ERROR_CODES,
  KEYWORD_CATEGORY_ERROR_CODES,
  KEYWORD_ERROR_CODES,
  RELATIONSHIP_ERROR_CODES,
  SOURCE_DOCUMENT_ERROR_CODES,
  SOURCE_REFERENCE_ERROR_CODES,
  RULESET_ERROR_CODES,
  RULESET_MANIFEST_ERROR_CODES,
  CANON_POLICY_ERROR_CODES,
  SOURCE_AUTHORITY_ERROR_CODES,
  RULE_CONFLICT_ERROR_CODES,
  CANON_DECISION_ERROR_CODES,
  CHANGE_SET_ERROR_CODES,
} from "@prowess/model";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  apiSuccess,
  apiSuccessList,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  isValidUuid,
  MAX_PAGE_SIZE,
  parsePaginationParams,
  parseUuidParam,
  serializeForApi,
  statusForDomainErrorCode,
  toErrorResponse,
} from "../../src/api/index";
import { parseJsonBody, requireObjectBody } from "../../src/api/request";

/**
 * Every currently-controlled DomainError code, flattened from the real
 * `*_ERROR_CODES` objects — not a hand-typed list that could drift from
 * the actual vocabulary. This is the runtime companion to
 * `errors.ts`'s compile-time `satisfies Record<KnownDomainErrorCode,
 * number>` exhaustiveness check (M1-WO8 patch).
 */
const ALL_KNOWN_DOMAIN_ERROR_CODES = [
  ...Object.values(ENTITY_ERROR_CODES),
  ...Object.values(ENTITY_VERSION_ERROR_CODES),
  ...Object.values(ENTITY_ALIAS_ERROR_CODES),
  ...Object.values(KEYWORD_CATEGORY_ERROR_CODES),
  ...Object.values(KEYWORD_ERROR_CODES),
  ...Object.values(KEYWORD_ASSIGNMENT_ERROR_CODES),
  ...Object.values(RELATIONSHIP_ERROR_CODES),
  ...Object.values(SOURCE_DOCUMENT_ERROR_CODES),
  ...Object.values(SOURCE_REFERENCE_ERROR_CODES),
  ...Object.values(RULESET_ERROR_CODES),
  ...Object.values(RULESET_MANIFEST_ERROR_CODES),
  ...Object.values(CANON_POLICY_ERROR_CODES),
  ...Object.values(SOURCE_AUTHORITY_ERROR_CODES),
  ...Object.values(RULE_CONFLICT_ERROR_CODES),
  ...Object.values(CANON_DECISION_ERROR_CODES),
  ...Object.values(CHANGE_SET_ERROR_CODES),
];

describe("statusForDomainErrorCode", () => {
  it.each([
    ["ENTITY.NOT_FOUND", 404],
    ["ENTITY_VERSION.NOT_FOUND", 404],
    ["ENTITY_ALIAS.NOT_FOUND", 404],
    ["KEYWORD.NOT_FOUND", 404],
    ["RELATIONSHIP.NOT_FOUND", 404],
    ["SOURCE_DOCUMENT.NOT_FOUND", 404],
    ["ENTITY.CANONICAL_KEY_CONFLICT", 409],
    ["ENTITY_VERSION.REVISION_CONFLICT", 409],
    ["ENTITY_VERSION.IMMUTABLE", 409],
    ["ENTITY_VERSION.INVALID_STATUS_TRANSITION", 409],
    ["ENTITY_ALIAS.DUPLICATE", 409],
    ["KEYWORD_ASSIGNMENT.DUPLICATE", 409],
    ["RELATIONSHIP.DUPLICATE", 409],
    ["ENTITY.INVALID_TYPE", 400],
    ["ENTITY_VERSION.INVALID_INPUT", 400],
    ["RELATIONSHIP.INVALID_SOURCE", 400],
    ["RELATIONSHIP.INVALID_TARGET", 400],
    ["RELATIONSHIP.SELF_REFERENCE", 400],
    ["SOURCE_DOCUMENT.INVALID_INPUT", 400],
    ["RULESET.NOT_FOUND", 404],
    ["RULESET.CANONICAL_KEY_CONFLICT", 409],
    ["RULESET.PARENT_CYCLE", 409],
    ["RULESET.INVALID_INPUT", 400],
    ["RULESET.INVALID_PARENT", 400],
    ["RULESET_MANIFEST.NOT_FOUND", 404],
    ["RULESET_MANIFEST.RULESET_NOT_FOUND", 404],
    ["RULESET_MANIFEST.VERSION_CONFLICT", 409],
    ["RULESET_MANIFEST.INVALID_INPUT", 400],
    ["RULESET_MANIFEST.ENTITY_NOT_FOUND", 400],
    ["RULESET_MANIFEST.VERSION_NOT_FOUND", 400],
    ["RULESET_MANIFEST.VERSION_ENTITY_MISMATCH", 400],
    ["RULESET_MANIFEST.DUPLICATE_ENTITY", 400],
    ["RULESET_MANIFEST.INVALID_PARENT_MANIFEST", 400],
    ["RULESET_MANIFEST.INHERITANCE_CYCLE", 500],
    ["CANON_POLICY.NOT_FOUND", 404],
    ["CANON_POLICY.RULESET_NOT_FOUND", 404],
    ["CANON_POLICY.VERSION_CONFLICT", 409],
    ["CANON_POLICY.INVALID_INPUT", 400],
    ["SOURCE_AUTHORITY.SOURCE_NOT_FOUND", 400],
    ["SOURCE_AUTHORITY.INVALID_SCOPE", 400],
    ["SOURCE_AUTHORITY.DUPLICATE_SOURCE_SCOPE", 400],
    ["RULE_CONFLICT.NOT_FOUND", 404],
    ["RULE_CONFLICT.RULESET_NOT_FOUND", 404],
    ["RULE_CONFLICT.ENTITY_NOT_FOUND", 400],
    ["RULE_CONFLICT.INVALID_INPUT", 400],
    ["RULE_CONFLICT.INSUFFICIENT_CANDIDATES", 400],
    ["RULE_CONFLICT.DUPLICATE_CANDIDATE", 400],
    ["RULE_CONFLICT.VERSION_NOT_FOUND", 400],
    ["RULE_CONFLICT.VERSION_ENTITY_MISMATCH", 400],
    ["RULE_CONFLICT.INVALID_SOURCE_REFERENCE", 400],
    ["CANON_DECISION.NOT_FOUND", 404],
    ["CANON_DECISION.CONFLICT_NOT_FOUND", 404],
    ["CANON_DECISION.RULESET_NOT_FOUND", 404],
    ["CANON_DECISION.CONFLICT_ALREADY_DECIDED", 409],
    ["CANON_DECISION.DECISION_CONFLICT", 409],
    ["CANON_DECISION.POLICY_NOT_FOUND", 400],
    ["CANON_DECISION.INVALID_POLICY_CONTEXT", 400],
    ["CANON_DECISION.INVALID_INPUT", 400],
    ["CANON_DECISION.INVALID_CANDIDATE", 400],
    ["CANON_DECISION.INVALID_RESULT_VERSION", 400],
    ["CHANGE_SET.NOT_FOUND", 404],
    ["CHANGE_SET.RULESET_NOT_FOUND", 404],
    ["CHANGE_SET.DECISION_NOT_FOUND", 400],
    ["CHANGE_SET.INVALID_DECISION_CONTEXT", 400],
    ["CHANGE_SET.INVALID_INPUT", 400],
    ["CHANGE_SET.INVALID_OPERATION", 400],
    ["CHANGE_SET.OPERATION_CONFLICT", 400],
    ["CHANGE_SET.ENTITY_NOT_FOUND", 400],
    ["CHANGE_SET.VERSION_NOT_FOUND", 400],
    ["CHANGE_SET.VERSION_ENTITY_MISMATCH", 400],
    ["CHANGE_SET.MANIFEST_NOT_FOUND", 400],
    ["CHANGE_SET.INVALID_MANIFEST_CONTEXT", 400],
  ])("maps %s to %d (documented mapping unchanged by the patch)", (code, expectedStatus) => {
    expect(statusForDomainErrorCode(code)).toBe(expectedStatus);
  });

  it("every currently-controlled DomainError code has an explicit numeric mapping", () => {
    expect(ALL_KNOWN_DOMAIN_ERROR_CODES.length).toBeGreaterThan(0);
    for (const code of ALL_KNOWN_DOMAIN_ERROR_CODES) {
      const status = statusForDomainErrorCode(code);
      expect(status, `expected an explicit mapping for ${code}`).toBeTypeOf("number");
    }
  });

  it("returns undefined (not 400) for an unmapped/unknown code — callers must fail closed to 500", () => {
    expect(statusForDomainErrorCode("SOME_FUTURE.UNMAPPED_CODE")).toBeUndefined();
  });
});

describe("toErrorResponse", () => {
  it("translates a DomainError into the stable error shape at the mapped status", async () => {
    const response = toErrorResponse(new DomainError("ENTITY.NOT_FOUND", "Entity not found: x"));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      code: "ENTITY.NOT_FOUND",
      message: "Entity not found: x",
      field: null,
      details: null,
    });
  });

  it("translates an ApiError into the stable error shape at its own status, including field", async () => {
    const response = toErrorResponse(
      new ApiError("API.INVALID_UUID", "entityId must be a valid UUID", 400, "entityId"),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      code: "API.INVALID_UUID",
      message: "entityId must be a valid UUID",
      field: "entityId",
      details: null,
    });
  });

  it("translates an unknown (non-DomainError, non-ApiError) error into a generic opaque 500", async () => {
    const response = toErrorResponse(new Error("some raw internal failure with a stack trace"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      code: "INTERNAL.UNEXPECTED_ERROR",
      message: "An unexpected server error occurred.",
      field: null,
      details: null,
    });
    expect(JSON.stringify(body)).not.toContain("some raw internal failure");
  });

  it("an artificially unknown DomainError code fails closed to 500, NOT 400 — the M1-WO8 patch's core fix", async () => {
    const response = toErrorResponse(
      new DomainError(
        "SOME_FUTURE.UNMAPPED_CODE",
        "a brand-new error code nobody has assigned an HTTP status to yet",
      ),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      code: "INTERNAL.UNEXPECTED_ERROR",
      message: "An unexpected server error occurred.",
      field: null,
      details: null,
    });
  });

  it("neither 500 path ever leaks the original code, message, or any internal detail", async () => {
    const fromUnmappedDomainError = await toErrorResponse(
      new DomainError("SOME_FUTURE.UNMAPPED_CODE", "sensitive internal detail: user table row 42"),
    ).json();
    const fromRawError = await toErrorResponse(
      new Error("sensitive internal detail: /home/app/secrets.env"),
    ).json();

    for (const body of [fromUnmappedDomainError, fromRawError]) {
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("SOME_FUTURE.UNMAPPED_CODE");
      expect(raw).not.toContain("sensitive internal detail");
      expect(raw).not.toMatch(/P2\d{3}/); // no raw Prisma error codes
      expect(raw.toLowerCase()).not.toContain("prisma");
      expect(raw.toLowerCase()).not.toContain("/home");
      expect(raw.toLowerCase()).not.toContain(".ts:");
    }
  });
});

describe("UUID validation", () => {
  it.each([
    "00000000-0000-4000-8000-000000000000",
    "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  ])("accepts %s", (value) => {
    expect(isValidUuid(value)).toBe(true);
  });

  it.each(["not-a-uuid", "", "12345", "00000000-0000-4000-8000-00000000000"])(
    "rejects %s",
    (value) => {
      expect(isValidUuid(value)).toBe(false);
    },
  );

  it("parseUuidParam returns the value unchanged when valid", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    expect(parseUuidParam(id, "entityId")).toBe(id);
  });

  it("parseUuidParam throws a 400 ApiError naming the field when invalid", () => {
    expect(() => parseUuidParam("not-a-uuid", "entityId")).toThrow(ApiError);
    try {
      parseUuidParam("not-a-uuid", "entityId");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).field).toBe("entityId");
    }
  });
});

describe("pagination parsing", () => {
  it("defaults to page=1, pageSize=25 when absent", () => {
    const result = parsePaginationParams(new URLSearchParams());
    expect(result).toEqual({ page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("parses explicit valid values", () => {
    const result = parsePaginationParams(new URLSearchParams("page=3&pageSize=10"));
    expect(result).toEqual({ page: 3, pageSize: 10 });
  });

  it(`clamps an oversized pageSize down to ${MAX_PAGE_SIZE}`, () => {
    const result = parsePaginationParams(new URLSearchParams("pageSize=10000"));
    expect(result.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it.each(["0", "-1", "abc", "1.5"])("rejects a malformed page value (%s)", (value) => {
    expect(() => parsePaginationParams(new URLSearchParams(`page=${value}`))).toThrow(ApiError);
  });

  it.each(["0", "-1", "abc", "1.5"])("rejects a malformed pageSize value (%s)", (value) => {
    expect(() => parsePaginationParams(new URLSearchParams(`pageSize=${value}`))).toThrow(
      ApiError,
    );
  });
});

describe("serializeForApi", () => {
  it("converts a Date to an ISO 8601 string", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(serializeForApi({ createdAt: date })).toEqual({ createdAt: "2026-01-01T00:00:00.000Z" });
  });

  it("leaves non-Date fields untouched, including nested JSON objects", () => {
    const input = {
      id: "abc-123",
      structuredData: { value: 10, tags: ["a", "b"] },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(serializeForApi(input)).toEqual({
      id: "abc-123",
      structuredData: { value: 10, tags: ["a", "b"] },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("recurses into nested objects (e.g. { entity, latestRevision })", () => {
    const input = {
      entity: { id: "e1", createdAt: new Date("2026-01-01T00:00:00.000Z") },
      latestRevision: { id: "v1", createdAt: new Date("2026-02-01T00:00:00.000Z") },
    };
    expect(serializeForApi(input)).toEqual({
      entity: { id: "e1", createdAt: "2026-01-01T00:00:00.000Z" },
      latestRevision: { id: "v1", createdAt: "2026-02-01T00:00:00.000Z" },
    });
  });

  it("handles null and arrays of objects", () => {
    expect(serializeForApi(null)).toBeNull();
    expect(
      serializeForApi([{ createdAt: new Date("2026-01-01T00:00:00.000Z") }]),
    ).toEqual([{ createdAt: "2026-01-01T00:00:00.000Z" }]);
  });
});

describe("apiSuccess / apiSuccessList response shapes", () => {
  it("wraps a single resource as { data }", async () => {
    const response = apiSuccess({ id: "abc" }, 201);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: "abc" } });
  });

  it("wraps a list as { data, pagination } with totalPages computed", async () => {
    const response = apiSuccessList([{ id: "a" }, { id: "b" }], 1, 25, 60);
    const body = await response.json();
    expect(body.data).toEqual([{ id: "a" }, { id: "b" }]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 25, total: 60, totalPages: 3 });
  });
});

describe("request body parsing", () => {
  it("parseJsonBody parses a valid JSON body", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    await expect(parseJsonBody(request)).resolves.toEqual({ a: 1 });
  });

  it("parseJsonBody throws a 400 ApiError for malformed JSON", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: "{not valid json",
    });
    await expect(parseJsonBody(request)).rejects.toBeInstanceOf(ApiError);
  });

  it("requireObjectBody accepts a plain object and rejects arrays/primitives/null", () => {
    expect(requireObjectBody({ a: 1 })).toEqual({ a: 1 });
    expect(() => requireObjectBody([1, 2])).toThrow(ApiError);
    expect(() => requireObjectBody("a string")).toThrow(ApiError);
    expect(() => requireObjectBody(null)).toThrow(ApiError);
  });
});
