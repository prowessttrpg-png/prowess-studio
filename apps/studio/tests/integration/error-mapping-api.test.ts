/**
 * HTTP error regression tests (PAS-10 M1-WO8 §36) — proves each of the
 * Work Order's explicitly-named DomainError codes actually serializes to
 * the documented HTTP status THROUGH A REAL ROUTE, not just via the
 * standalone `statusForDomainErrorCode` unit tests in
 * apps/studio/tests/unit/api-helpers.test.ts. No raw Prisma code may
 * appear in any response body.
 */
import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createEntity } from "../../app/api/entities/route";
import { GET as getEntityDetail } from "../../app/api/entities/[entityId]/route";
import { POST as createVersion } from "../../app/api/entities/[entityId]/versions/route";
import { POST as transitionStatus } from "../../app/api/entity-versions/[versionId]/status/route";
import { PATCH as patchVersion } from "../../app/api/entity-versions/[versionId]/route";
import { POST as createRelationship } from "../../app/api/relationships/route";
import { POST as createKeyword } from "../../app/api/keywords/route";
import { POST as assignEntityKeyword } from "../../app/api/entities/[entityId]/keywords/route";
import { GET as getSourceDocument } from "../../app/api/source-documents/[sourceDocumentId]/route";
import { getRequest, jsonRequest, nextCanonicalKey, routeParams } from "./helpers";
import { cleanupFixtures } from "./cleanup";

const FIXTURE_PREFIX = "test.api";
const NONEXISTENT_ID = "00000000-0000-4000-8000-000000000000";

async function createTestEntity(label: string) {
  const response = await createEntity(
    jsonRequest("http://localhost/api/entities", "POST", {
      entityType: "GENERIC_RULE",
      canonicalKey: nextCanonicalKey(label),
    }),
  );
  return (await response.json()).data;
}

async function assertCleanErrorBody(response: Response, expectedCode: string): Promise<void> {
  const body = await response.json();
  expect(body.code).toBe(expectedCode);
  expect(typeof body.message).toBe("string");
  expect("field" in body).toBe(true);
  expect("details" in body).toBe(true);
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/P2\d{3}/); // no raw Prisma error codes (P2002, P2025, ...)
  expect(raw.toLowerCase()).not.toContain("prisma");
  expect(raw.toLowerCase()).not.toContain("at /home");
  expect(raw.toLowerCase()).not.toContain(".ts:");
}

describe("HTTP error regression (prowess_studio_test only)", () => {
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

  it("ENTITY.NOT_FOUND -> 404", async () => {
    const response = await getEntityDetail(
      getRequest(`http://localhost/api/entities/${NONEXISTENT_ID}`),
      routeParams({ entityId: NONEXISTENT_ID }),
    );
    expect(response.status).toBe(404);
    await assertCleanErrorBody(response, "ENTITY.NOT_FOUND");
  });

  it("ENTITY.CANONICAL_KEY_CONFLICT -> 409", async () => {
    const canonicalKey = nextCanonicalKey("conflict");
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
    await assertCleanErrorBody(response, "ENTITY.CANONICAL_KEY_CONFLICT");
  });

  it("ENTITY_VERSION.IMMUTABLE -> 409", async () => {
    const entity = await createTestEntity("error_immutable");
    const version = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Immutable Test",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;
    await transitionStatus(
      jsonRequest(`http://localhost/api/entity-versions/${version.id}/status`, "POST", {
        status: "IN_REVIEW",
      }),
      routeParams({ versionId: version.id }),
    );

    const response = await patchVersion(
      jsonRequest(`http://localhost/api/entity-versions/${version.id}`, "PATCH", {
        displayName: "Blocked",
      }),
      routeParams({ versionId: version.id }),
    );
    expect(response.status).toBe(409);
    await assertCleanErrorBody(response, "ENTITY_VERSION.IMMUTABLE");
  });

  it("ENTITY_VERSION.INVALID_STATUS_TRANSITION -> 409 (documented choice, see docs/api/entity-api.md)", async () => {
    const entity = await createTestEntity("error_invalid_transition");
    const version = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Invalid Transition Test",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;

    const response = await transitionStatus(
      jsonRequest(`http://localhost/api/entity-versions/${version.id}/status`, "POST", {
        status: "CANON",
      }),
      routeParams({ versionId: version.id }),
    );
    expect(response.status).toBe(409);
    await assertCleanErrorBody(response, "ENTITY_VERSION.INVALID_STATUS_TRANSITION");
  });

  it("RELATIONSHIP.INVALID_SOURCE -> 400", async () => {
    const b = await createTestEntity("error_rel_invalid_source");
    const response = await createRelationship(
      jsonRequest("http://localhost/api/relationships", "POST", {
        sourceEntityId: NONEXISTENT_ID,
        targetEntityId: b.id,
        relationshipType: "REQUIRES",
      }),
    );
    expect(response.status).toBe(400);
    await assertCleanErrorBody(response, "RELATIONSHIP.INVALID_SOURCE");
  });

  it("KEYWORD_ASSIGNMENT.DUPLICATE -> 409", async () => {
    const entity = await createTestEntity("error_kw_duplicate");
    const keywordResponse = await createKeyword(
      jsonRequest("http://localhost/api/keywords", "POST", {
        canonicalKey: nextCanonicalKey("kw.error_duplicate"),
        name: "Error Duplicate Keyword",
      }),
    );
    const keyword = (await keywordResponse.json()).data;
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
    await assertCleanErrorBody(response, "KEYWORD_ASSIGNMENT.DUPLICATE");
  });

  it("SOURCE_DOCUMENT.NOT_FOUND -> 404", async () => {
    const response = await getSourceDocument(
      getRequest(`http://localhost/api/source-documents/${NONEXISTENT_ID}`),
      routeParams({ sourceDocumentId: NONEXISTENT_ID }),
    );
    expect(response.status).toBe(404);
    await assertCleanErrorBody(response, "SOURCE_DOCUMENT.NOT_FOUND");
  });
});
