import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createEntity } from "../../app/api/entities/route";
import {
  GET as listAliases,
  POST as createAlias,
} from "../../app/api/entities/[entityId]/aliases/route";
import { GET as searchAliases } from "../../app/api/entity-aliases/search/route";
import { getRequest, jsonRequest, nextCanonicalKey, routeParams } from "./helpers";
import { cleanupFixtures } from "./cleanup";

const FIXTURE_PREFIX = "test.api";

async function createTestEntity(label: string) {
  const response = await createEntity(
    jsonRequest("http://localhost/api/entities", "POST", {
      entityType: "GENERIC_RULE",
      canonicalKey: nextCanonicalKey(label),
    }),
  );
  return (await response.json()).data;
}

describe("EntityAlias API (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await cleanupFixtures({
      entityPrefix: FIXTURE_PREFIX,
      keywordPrefix: FIXTURE_PREFIX,
      documentTitlePrefix: "Test API ",
    });
  });

  it("creates and lists aliases for an Entity", async () => {
    const entity = await createTestEntity("alias_create");

    await createAlias(
      jsonRequest(`http://localhost/api/entities/${entity.id}/aliases`, "POST", {
        alias: "Old Name",
      }),
      routeParams({ entityId: entity.id }),
    );

    const response = await listAliases(
      getRequest(`http://localhost/api/entities/${entity.id}/aliases`),
      routeParams({ entityId: entity.id }),
    );
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].alias).toBe("Old Name");
  });

  it("GET /api/entity-aliases/search returns an ambiguous result as an array of multiple matches", async () => {
    const entityA = await createTestEntity("alias_ambiguous_a");
    const entityB = await createTestEntity("alias_ambiguous_b");
    const sharedAlias = `Shared-${nextCanonicalKey("x")}`;
    await createAlias(
      jsonRequest(`http://localhost/api/entities/${entityA.id}/aliases`, "POST", {
        alias: sharedAlias,
      }),
      routeParams({ entityId: entityA.id }),
    );
    await createAlias(
      jsonRequest(`http://localhost/api/entities/${entityB.id}/aliases`, "POST", {
        alias: sharedAlias,
      }),
      routeParams({ entityId: entityB.id }),
    );

    const response = await searchAliases(
      getRequest(`http://localhost/api/entity-aliases/search?alias=${encodeURIComponent(sharedAlias)}`),
    );
    const body = await response.json();

    expect(body.data).toHaveLength(2);
    const matchedEntityIds = body.data.map((m: { entity: { id: string } }) => m.entity.id).sort();
    expect(matchedEntityIds).toEqual([entityA.id, entityB.id].sort());
  });

  it("search with a missing query parameter returns a clean 400", async () => {
    const response = await searchAliases(getRequest("http://localhost/api/entity-aliases/search"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("API.INVALID_QUERY");
  });
});
