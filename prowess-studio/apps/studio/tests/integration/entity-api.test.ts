/**
 * Entity API route handler tests (PAS-10 M1-WO8 §35) — calls the actual
 * Next.js route handler functions directly against the real
 * `prowess_studio_test` database. See `helpers.ts` for the request-
 * construction helpers.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getEntityDetail } from "../../app/api/entities/[entityId]/route";
import { GET as listEntities, POST as createEntity } from "../../app/api/entities/route";
import { getRequest, jsonRequest, nextCanonicalKey, routeParams } from "./helpers";

const FIXTURE_PREFIX = "test.api";

describe("Entity API (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
  });

  it("POST /api/entities creates an Entity and returns 201 with { data }", async () => {
    const canonicalKey = nextCanonicalKey("create");
    const response = await createEntity(
      jsonRequest("http://localhost/api/entities", "POST", {
        entityType: "GENERIC_RULE",
        canonicalKey,
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.canonicalKey).toBe(canonicalKey);
    expect(body.data.entityType).toBe("GENERIC_RULE");
    expect(typeof body.data.id).toBe("string");
  });

  it("POST /api/entities with a duplicate canonicalKey returns 409 ENTITY.CANONICAL_KEY_CONFLICT", async () => {
    const canonicalKey = nextCanonicalKey("duplicate");
    await createEntity(
      jsonRequest("http://localhost/api/entities", "POST", {
        entityType: "GENERIC_RULE",
        canonicalKey,
      }),
    );

    const response = await createEntity(
      jsonRequest("http://localhost/api/entities", "POST", {
        entityType: "GENERIC_RULE",
        canonicalKey,
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("ENTITY.CANONICAL_KEY_CONFLICT");
    expect(body.field).toBeNull();
    expect(body.details).toBeNull();
  });

  it("GET /api/entities/:entityId retrieves the created Entity", async () => {
    const canonicalKey = nextCanonicalKey("get_by_id");
    const created = await (
      await createEntity(
        jsonRequest("http://localhost/api/entities", "POST", {
          entityType: "GENERIC_RULE",
          canonicalKey,
        }),
      )
    ).json();

    const response = await getEntityDetail(
      getRequest(`http://localhost/api/entities/${created.data.id}`),
      routeParams({ entityId: created.data.id }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(created.data.id);
  });

  it("GET /api/entities/:entityId returns 404 ENTITY.NOT_FOUND for a nonexistent id", async () => {
    const response = await getEntityDetail(
      getRequest("http://localhost/api/entities/00000000-0000-4000-8000-000000000000"),
      routeParams({ entityId: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("ENTITY.NOT_FOUND");
  });

  it("GET /api/entities/:entityId returns 400 for a malformed UUID, never an opaque DB error", async () => {
    const response = await getEntityDetail(
      getRequest("http://localhost/api/entities/not-a-uuid"),
      routeParams({ entityId: "not-a-uuid" }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("API.INVALID_UUID");
    expect(body.field).toBe("entityId");
  });

  describe("GET /api/entities (list)", () => {
    it("filters by exact canonicalKey", async () => {
      const canonicalKey = nextCanonicalKey("list_canonical_key");
      await createEntity(
        jsonRequest("http://localhost/api/entities", "POST", {
          entityType: "GENERIC_RULE",
          canonicalKey,
        }),
      );

      const response = await listEntities(
        getRequest(`http://localhost/api/entities?canonicalKey=${canonicalKey}`),
      );
      const body = await response.json();

      expect(body.data).toHaveLength(1);
      expect(body.data[0].entity.canonicalKey).toBe(canonicalKey);
      expect(body.data[0]).toHaveProperty("latestRevision");
    });

    it("filters by entityType", async () => {
      const keywordKey = nextCanonicalKey("list_type_keyword");
      const ruleKey = nextCanonicalKey("list_type_rule");
      await createEntity(
        jsonRequest("http://localhost/api/entities", "POST", {
          entityType: "KEYWORD",
          canonicalKey: keywordKey,
        }),
      );
      await createEntity(
        jsonRequest("http://localhost/api/entities", "POST", {
          entityType: "GENERIC_RULE",
          canonicalKey: ruleKey,
        }),
      );

      const response = await listEntities(
        getRequest(`http://localhost/api/entities?entityType=KEYWORD&search=${keywordKey}`),
      );
      const body = await response.json();

      expect(body.data.every((item: { entity: { entityType: string } }) => item.entity.entityType === "KEYWORD")).toBe(
        true,
      );
    });

    it("respects pagination (page, pageSize) and returns correct totalPages", async () => {
      const base = nextCanonicalKey("list_pagination");
      for (let i = 0; i < 3; i += 1) {
        await createEntity(
          jsonRequest("http://localhost/api/entities", "POST", {
            entityType: "GENERIC_RULE",
            canonicalKey: `${base}.${i}`,
          }),
        );
      }

      const response = await listEntities(
        getRequest(`http://localhost/api/entities?search=${base}&page=1&pageSize=2`),
      );
      const body = await response.json();

      expect(body.data).toHaveLength(2);
      expect(body.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    });

    it("returns a deterministic response shape with entity + latestRevision: null when no Version exists", async () => {
      const canonicalKey = nextCanonicalKey("list_no_version");
      await createEntity(
        jsonRequest("http://localhost/api/entities", "POST", {
          entityType: "GENERIC_RULE",
          canonicalKey,
        }),
      );

      const response = await listEntities(
        getRequest(`http://localhost/api/entities?canonicalKey=${canonicalKey}`),
      );
      const body = await response.json();

      expect(body.data[0].latestRevision).toBeNull();
    });

    it("rejects a malformed page value with a clean 400, not an unbounded/crashing query", async () => {
      const response = await listEntities(getRequest("http://localhost/api/entities?page=abc"));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("API.INVALID_QUERY");
    });
  });
});
