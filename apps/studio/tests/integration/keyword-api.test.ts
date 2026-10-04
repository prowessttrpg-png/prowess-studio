import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createEntity } from "../../app/api/entities/route";
import { POST as createVersion } from "../../app/api/entities/[entityId]/versions/route";
import { POST as transitionStatus } from "../../app/api/entity-versions/[versionId]/status/route";
import { GET as listKeywords, POST as createKeyword } from "../../app/api/keywords/route";
import {
  GET as listEntityKeywords,
  POST as assignEntityKeyword,
} from "../../app/api/entities/[entityId]/keywords/route";
import {
  GET as listVersionKeywords,
  POST as assignVersionKeyword,
} from "../../app/api/entity-versions/[versionId]/keywords/route";
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

async function createTestKeyword(label: string) {
  const response = await createKeyword(
    jsonRequest("http://localhost/api/keywords", "POST", {
      canonicalKey: nextCanonicalKey(`kw.${label}`),
      name: label,
    }),
  );
  return (await response.json()).data;
}

describe("Keyword API (prowess_studio_test only)", () => {
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

  it("GET /api/keywords lists KeywordDefinitions", async () => {
    const keyword = await createTestKeyword("list_test");
    const response = await listKeywords(getRequest("http://localhost/api/keywords"));
    const body = await response.json();
    expect(body.data.some((k: { id: string }) => k.id === keyword.id)).toBe(true);
  });

  it("assigns a Keyword to an Entity and lists it", async () => {
    const entity = await createTestEntity("kw_entity_assign");
    const keyword = await createTestKeyword("entity_assign");

    await assignEntityKeyword(
      jsonRequest(`http://localhost/api/entities/${entity.id}/keywords`, "POST", {
        keywordId: keyword.id,
      }),
      routeParams({ entityId: entity.id }),
    );

    const response = await listEntityKeywords(
      getRequest(`http://localhost/api/entities/${entity.id}/keywords`),
      routeParams({ entityId: entity.id }),
    );
    const body = await response.json();
    expect(body.data.map((a: { keyword: { id: string } }) => a.keyword.id)).toEqual([keyword.id]);
  });

  describe("Version-level Keyword assignment lifecycle protection", () => {
    it("allows assignment while DRAFT, and rejects it once protected", async () => {
      const entity = await createTestEntity("kw_version_lifecycle");
      const keyword = await createTestKeyword("version_lifecycle");
      const version = (
        await (
          await createVersion(
            jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
              displayName: "Lifecycle Test",
            }),
            routeParams({ entityId: entity.id }),
          )
        ).json()
      ).data;

      const draftAssign = await assignVersionKeyword(
        jsonRequest(`http://localhost/api/entity-versions/${version.id}/keywords`, "POST", {
          keywordId: keyword.id,
        }),
        routeParams({ versionId: version.id }),
      );
      expect(draftAssign.status).toBe(201);

      await transitionStatus(
        jsonRequest(`http://localhost/api/entity-versions/${version.id}/status`, "POST", {
          status: "IN_REVIEW",
        }),
        routeParams({ versionId: version.id }),
      );

      const otherKeyword = await createTestKeyword("version_lifecycle_other");
      const protectedAssign = await assignVersionKeyword(
        jsonRequest(`http://localhost/api/entity-versions/${version.id}/keywords`, "POST", {
          keywordId: otherKeyword.id,
        }),
        routeParams({ versionId: version.id }),
      );

      expect(protectedAssign.status).toBe(409);
      expect((await protectedAssign.json()).code).toBe("ENTITY_VERSION.IMMUTABLE");

      // Reading remains allowed regardless of status.
      const listResponse = await listVersionKeywords(
        getRequest(`http://localhost/api/entity-versions/${version.id}/keywords`),
        routeParams({ versionId: version.id }),
      );
      expect((await listResponse.json()).data).toHaveLength(1);
    });
  });

  it("duplicate Keyword assignment returns 409 KEYWORD_ASSIGNMENT.DUPLICATE", async () => {
    const entity = await createTestEntity("kw_entity_duplicate");
    const keyword = await createTestKeyword("entity_duplicate");
    await assignEntityKeyword(
      jsonRequest(`http://localhost/api/entities/${entity.id}/keywords`, "POST", {
        keywordId: keyword.id,
      }),
      routeParams({ entityId: entity.id }),
    );

    const response = await assignEntityKeyword(
      jsonRequest(`http://localhost/api/entities/${entity.id}/keywords`, "POST", {
        keywordId: keyword.id,
      }),
      routeParams({ entityId: entity.id }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("KEYWORD_ASSIGNMENT.DUPLICATE");
  });
});
