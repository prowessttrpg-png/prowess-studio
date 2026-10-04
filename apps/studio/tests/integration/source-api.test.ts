import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createEntity } from "../../app/api/entities/route";
import { POST as createVersion } from "../../app/api/entities/[entityId]/versions/route";
import { POST as createSourceDocument } from "../../app/api/source-documents/route";
import {
  GET as listVersionSources,
  POST as attachSource,
} from "../../app/api/entity-versions/[versionId]/sources/route";
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

describe("Source provenance API (prowess_studio_test only)", () => {
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

  it("creates a SourceDocument, attaches it to a Version, and retrieves the Version's sources", async () => {
    const entity = await createTestEntity("source_flow");
    const version = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "Sourced Rule",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;

    const documentResponse = await createSourceDocument(
      jsonRequest("http://localhost/api/source-documents", "POST", {
        title: "Test API Spellcasting Source",
        sourceType: "DOCUMENT",
      }),
    );
    expect(documentResponse.status).toBe(201);
    const document = (await documentResponse.json()).data;

    const attachResponse = await attachSource(
      jsonRequest(`http://localhost/api/entity-versions/${version.id}/sources`, "POST", {
        sourceDocumentId: document.id,
        sectionLabel: "Direct Damage",
        pageReference: "14-16",
      }),
      routeParams({ versionId: version.id }),
    );
    expect(attachResponse.status).toBe(201);

    const listResponse = await listVersionSources(
      getRequest(`http://localhost/api/entity-versions/${version.id}/sources`),
      routeParams({ versionId: version.id }),
    );
    const body = await listResponse.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      sourceDocumentId: document.id,
      entityVersionId: version.id,
      sectionLabel: "Direct Damage",
      pageReference: "14-16",
    });
  });

  it("returns 404 SOURCE_DOCUMENT.NOT_FOUND when attaching a nonexistent document", async () => {
    const entity = await createTestEntity("source_missing_doc");
    const version = (
      await (
        await createVersion(
          jsonRequest(`http://localhost/api/entities/${entity.id}/versions`, "POST", {
            displayName: "No Source",
          }),
          routeParams({ entityId: entity.id }),
        )
      ).json()
    ).data;

    const response = await attachSource(
      jsonRequest(`http://localhost/api/entity-versions/${version.id}/sources`, "POST", {
        sourceDocumentId: "00000000-0000-4000-8000-000000000000",
      }),
      routeParams({ versionId: version.id }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("SOURCE_DOCUMENT.NOT_FOUND");
  });
});
