import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompendiumApiError,
  getEntity,
  getEntityRelationships,
  listEntities,
  listEntityAliases,
  resolveSourceDocuments,
  type SourceDocumentDto,
  type SourceReferenceDto,
} from "../../app/compendium/_lib/api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Compendium API client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("success parsing", () => {
    it("getEntity unwraps { data } into the plain Entity", async () => {
      const entity = { id: "e1", entityType: "GENERIC_RULE", canonicalKey: "test.x" };
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: entity }));

      await expect(getEntity("e1")).resolves.toEqual(entity);
      expect(fetchMock).toHaveBeenCalledWith("/api/entities/e1");
    });

    it("listEntities unwraps { data, pagination } into { items, page, pageSize, total, totalPages }", async () => {
      const items = [{ entity: { id: "e1" }, latestRevision: null }];
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: items, pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }),
      );

      const result = await listEntities({});
      expect(result).toEqual({ items, page: 1, pageSize: 25, total: 1, totalPages: 1 });
    });

    it("getEntityRelationships returns the { outgoing, incoming } shape unmodified", async () => {
      const relationships = { outgoing: [{ relationship: {}, counterpart: {} }], incoming: [] };
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: relationships }));

      await expect(getEntityRelationships("e1")).resolves.toEqual(relationships);
    });
  });

  describe("error parsing", () => {
    it("throws CompendiumApiError with the server's code/message/field on a non-2xx response", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { code: "ENTITY.NOT_FOUND", message: "Entity not found: e1", field: null, details: null },
          404,
        ),
      );

      const attempt = getEntity("e1");
      await expect(attempt).rejects.toBeInstanceOf(CompendiumApiError);
      await expect(attempt.catch((e: CompendiumApiError) => e)).resolves.toMatchObject({
        code: "ENTITY.NOT_FOUND",
        status: 404,
        field: null,
        message: "Entity not found: e1",
      });
    });

    it("wraps a network-level failure (fetch rejects) as a CompendiumApiError, not a raw exception", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const attempt = getEntity("e1");
      await expect(attempt).rejects.toBeInstanceOf(CompendiumApiError);
      await expect(attempt.catch((e: CompendiumApiError) => e.code)).resolves.toBe("NETWORK_ERROR");
    });

    it("never leaks a raw server error shape or stack trace into the thrown error's own fields", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            code: "INTERNAL.UNEXPECTED_ERROR",
            message: "An unexpected server error occurred.",
            field: null,
            details: null,
          },
          500,
        ),
      );

      const error = await getEntity("e1").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CompendiumApiError);
      const apiError = error as CompendiumApiError;
      const serialized = JSON.stringify({ code: apiError.code, message: apiError.message });
      expect(serialized.toLowerCase()).not.toContain("prisma");
      expect(serialized.toLowerCase()).not.toContain(".ts:");
    });
  });

  describe("query parameter construction", () => {
    it("omits undefined/empty params and includes only the ones supplied", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
      );

      await listEntities({ search: "damage", entityType: "SPELL_EFFECT", page: 2 });

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      const query = new URL(calledUrl, "http://localhost").searchParams;
      expect(query.get("search")).toBe("damage");
      expect(query.get("entityType")).toBe("SPELL_EFFECT");
      expect(query.get("page")).toBe("2");
      expect(query.has("status")).toBe(false);
      expect(query.has("canonicalKey")).toBe(false);
    });

    it("calls the bare endpoint with no query string when no params are given", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
      );
      await listEntities({});
      expect(fetchMock).toHaveBeenCalledWith("/api/entities");
    });
  });

  describe("pagination pass-through", () => {
    it("surfaces the server's exact pagination fields without recomputing them", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: [], pagination: { page: 3, pageSize: 10, total: 42, totalPages: 5 } }),
      );
      const result = await listEntities({ page: 3, pageSize: 10 });
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
      expect(result.total).toBe(42);
      expect(result.totalPages).toBe(5);
    });
  });

  describe("resolveSourceDocuments", () => {
    it("fetches each distinct SourceDocument once, in parallel, deduplicated", async () => {
      const refs: SourceReferenceDto[] = [
        {
          id: "r1",
          sourceDocumentId: "doc1",
          entityVersionId: "v1",
          sectionLabel: null,
          pageReference: null,
          sourceExcerptNote: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "r2",
          sourceDocumentId: "doc1",
          entityVersionId: "v1",
          sectionLabel: null,
          pageReference: null,
          sourceExcerptNote: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "r3",
          sourceDocumentId: "doc2",
          entityVersionId: "v1",
          sectionLabel: null,
          pageReference: null,
          sourceExcerptNote: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      const doc1: SourceDocumentDto = {
        id: "doc1",
        title: "Doc One",
        sourceType: "DOCUMENT",
        versionLabel: null,
        authorityStatus: null,
        fileReference: null,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const doc2: SourceDocumentDto = { ...doc1, id: "doc2", title: "Doc Two" };
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: doc1 }));
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: doc2 }));

      const result = await resolveSourceDocuments(refs);

      expect(fetchMock).toHaveBeenCalledTimes(2); // not 3 — doc1 fetched once despite 2 references
      expect(result.get("doc1")?.title).toBe("Doc One");
      expect(result.get("doc2")?.title).toBe("Doc Two");
    });

    it("returns an empty map for an empty reference list without calling fetch", async () => {
      const result = await resolveSourceDocuments([]);
      expect(result.size).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("listEntityAliases", () => {
    it("returns the plain alias array", async () => {
      const aliases = [{ id: "a1", alias: "Old Name" }];
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: aliases }));
      await expect(listEntityAliases("e1")).resolves.toEqual(aliases);
    });
  });
});
