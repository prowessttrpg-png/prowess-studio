import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createEntity } from "../../app/api/entities/route";
import { GET as getRelationships } from "../../app/api/entities/[entityId]/relationships/route";
import { POST as createRelationship } from "../../app/api/relationships/route";
import { getRequest, jsonRequest, nextCanonicalKey, routeParams } from "./helpers";

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

describe("EntityRelationship API (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    const entities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const ids = entities.map((e) => e.id);
    await prisma.entityRelationship.deleteMany({
      where: { OR: [{ sourceEntityId: { in: ids } }, { targetEntityId: { in: ids } }] },
    });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
  });

  it("creates a relationship and retrieves it on both the outgoing and incoming sides", async () => {
    const a = await createTestEntity("rel_a");
    const b = await createTestEntity("rel_b");

    const createResponse = await createRelationship(
      jsonRequest("http://localhost/api/relationships", "POST", {
        sourceEntityId: a.id,
        targetEntityId: b.id,
        relationshipType: "REQUIRES",
      }),
    );
    expect(createResponse.status).toBe(201);

    const aRelationships = await (
      await getRelationships(
        getRequest(`http://localhost/api/entities/${a.id}/relationships`),
        routeParams({ entityId: a.id }),
      )
    ).json();
    const bRelationships = await (
      await getRelationships(
        getRequest(`http://localhost/api/entities/${b.id}/relationships`),
        routeParams({ entityId: b.id }),
      )
    ).json();

    expect(aRelationships.data.outgoing).toHaveLength(1);
    expect(aRelationships.data.outgoing[0].counterpart.id).toBe(b.id);
    expect(aRelationships.data.incoming).toHaveLength(0);
    expect(bRelationships.data.incoming).toHaveLength(1);
    expect(bRelationships.data.incoming[0].counterpart.id).toBe(a.id);
    expect(bRelationships.data.outgoing).toHaveLength(0);
  });

  it("rejects a duplicate relationship with 409 RELATIONSHIP.DUPLICATE", async () => {
    const a = await createTestEntity("rel_dup_a");
    const b = await createTestEntity("rel_dup_b");
    await createRelationship(
      jsonRequest("http://localhost/api/relationships", "POST", {
        sourceEntityId: a.id,
        targetEntityId: b.id,
        relationshipType: "USES",
      }),
    );

    const response = await createRelationship(
      jsonRequest("http://localhost/api/relationships", "POST", {
        sourceEntityId: a.id,
        targetEntityId: b.id,
        relationshipType: "USES",
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("RELATIONSHIP.DUPLICATE");
  });

  it("rejects an invalid source with 400 RELATIONSHIP.INVALID_SOURCE (not 404)", async () => {
    const b = await createTestEntity("rel_invalid_source_b");
    const response = await createRelationship(
      jsonRequest("http://localhost/api/relationships", "POST", {
        sourceEntityId: "00000000-0000-4000-8000-000000000000",
        targetEntityId: b.id,
        relationshipType: "REQUIRES",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("RELATIONSHIP.INVALID_SOURCE");
  });
});
