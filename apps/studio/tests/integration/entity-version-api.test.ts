/**
 * EntityVersion API route handler tests (PAS-10 M1-WO8 §35) — proves the
 * HTTP layer preserves every lifecycle rule established in M1-WO2/M1-WO3.
 */
import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createEntity } from "../../app/api/entities/route";
import {
  GET as listVersions,
  POST as createVersion,
} from "../../app/api/entities/[entityId]/versions/route";
import {
  GET as getVersionDetail,
  PATCH as patchVersion,
} from "../../app/api/entity-versions/[versionId]/route";
import { POST as transitionStatus } from "../../app/api/entity-versions/[versionId]/status/route";
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

describe("EntityVersion API (prowess_studio_test only)", () => {
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

  it("POST .../versions creates a revision without accepting a caller-supplied revisionNumber", async () => {
    const entity = await createTestEntity("version_create");
    const response = await createVersion(
      jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
        displayName: "Rev 1",
        revisionNumber: 999, // must be ignored — allocation is automatic
      }),
      routeParams({ entityId: entity.id }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.revisionNumber).toBe(1);
    expect(body.data.entityId).toBe(entity.id);
  });

  it("GET .../versions lists revisions ordered revisionNumber ASC, uncollapsed", async () => {
    const entity = await createTestEntity("version_list");
    await createVersion(
      jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
        displayName: "Rev 1",
      }),
      routeParams({ entityId: entity.id }),
    );
    await createVersion(
      jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
        displayName: "Rev 2",
      }),
      routeParams({ entityId: entity.id }),
    );

    const response = await listVersions(
      getRequest(`http://localhost/api/entities/${entity.id}/versions`),
      routeParams({ entityId: entity.id }),
    );
    const body = await response.json();

    expect(body.data.map((v: { revisionNumber: number }) => v.revisionNumber)).toEqual([1, 2]);
  });

  it("GET /api/entity-versions/:versionId returns the full representation", async () => {
    const entity = await createTestEntity("version_detail");
    const created = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Detail Test",
            structuredData: { value: 10 },
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;

    const response = await getVersionDetail(
      getRequest(`http://localhost/api/entity-versions/${created.id}`),
      routeParams({ versionId: created.id }),
    );
    const body = await response.json();

    expect(body.data).toMatchObject({
      id: created.id,
      entityId: entity.id,
      revisionNumber: 1,
      status: "DRAFT",
      displayName: "Detail Test",
      structuredData: { value: 10 },
    });
    expect(body.data).toHaveProperty("createdAt");
    expect(body.data).toHaveProperty("updatedAt");
  });

  it("PATCH updates DRAFT content, accepting only allowed fields", async () => {
    const entity = await createTestEntity("version_patch_draft");
    const created = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Before",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;

    const response = await patchVersion(
      jsonRequest(`http://localhost/api/entity-versions/${created.id}`, "PATCH", {
        displayName: "After",
        // Protected fields, even if sent, must have no effect:
        id: "00000000-0000-4000-8000-000000000000",
        revisionNumber: 999,
        status: "CANON",
      }),
      routeParams({ versionId: created.id }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.displayName).toBe("After");
    expect(body.data.id).toBe(created.id);
    expect(body.data.revisionNumber).toBe(1);
    expect(body.data.status).toBe("DRAFT");
  });

  it("PATCH on a non-DRAFT Version returns 409 ENTITY_VERSION.IMMUTABLE", async () => {
    const entity = await createTestEntity("version_patch_immutable");
    const created = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Protected",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;
    await transitionStatus(
      jsonRequest(`http://localhost/api/entity-versions/${created.id}/status`, "POST", {
        status: "IN_REVIEW",
      }),
      routeParams({ versionId: created.id }),
    );

    const response = await patchVersion(
      jsonRequest(`http://localhost/api/entity-versions/${created.id}`, "PATCH", {
        displayName: "Should not apply",
      }),
      routeParams({ versionId: created.id }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ENTITY_VERSION.IMMUTABLE");
  });

  it("POST .../status performs a valid transition", async () => {
    const entity = await createTestEntity("version_status_valid");
    const created = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Transition Me",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;

    const response = await transitionStatus(
      jsonRequest(`http://localhost/api/entity-versions/${created.id}/status`, "POST", {
        status: "IN_REVIEW",
      }),
      routeParams({ versionId: created.id }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("IN_REVIEW");
  });

  it("POST .../status with an invalid transition returns 409 ENTITY_VERSION.INVALID_STATUS_TRANSITION", async () => {
    const entity = await createTestEntity("version_status_invalid");
    const created = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Invalid Transition",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;

    const response = await transitionStatus(
      jsonRequest(`http://localhost/api/entity-versions/${created.id}/status`, "POST", {
        status: "CANON",
      }),
      routeParams({ versionId: created.id }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ENTITY_VERSION.INVALID_STATUS_TRANSITION");
  });
});
