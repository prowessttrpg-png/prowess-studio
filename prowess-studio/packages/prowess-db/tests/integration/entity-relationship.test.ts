/**
 * EntityRelationship database integration tests (PAS-10 M1-WO6 §30–42).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 */
import { DomainError, RELATIONSHIP_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityAlias,
  createEntityRelationship,
  createEntityVersion,
  getEntityRelationship,
  getIncomingRelationships,
  getOutgoingRelationships,
  prisma,
  removeEntityRelationship,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.relationship";
let fixtureCounter = 0;

function nextCanonicalKey(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_PREFIX}.${label}_${fixtureCounter}`;
}

async function createTestEntity(label: string) {
  return createEntity({ entityType: "GENERIC_RULE", canonicalKey: nextCanonicalKey(label) });
}

describe("EntityRelationship (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const testEntities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const testEntityIds = testEntities.map((e) => e.id);
    await prisma.entityRelationship.deleteMany({
      where: { OR: [{ sourceEntityId: { in: testEntityIds } }, { targetEntityId: { in: testEntityIds } }] },
    });
    await prisma.entityAlias.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
  });

  it("creates and retrieves a relationship with the correct source, target, and type", async () => {
    const a = await createTestEntity("a");
    const b = await createTestEntity("b");

    const created = await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    expect(created.sourceEntityId).toBe(a.id);
    expect(created.targetEntityId).toBe(b.id);
    expect(created.relationshipType).toBe("REQUIRES");
    expect(created.metadata).toEqual({});

    const fetched = await getEntityRelationship(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it("outgoing/incoming queries find the relationship on the correct side only", async () => {
    const a = await createTestEntity("io_a");
    const b = await createTestEntity("io_b");
    await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    const aOutgoing = await getOutgoingRelationships(a.id);
    const bIncoming = await getIncomingRelationships(b.id);
    const bOutgoing = await getOutgoingRelationships(b.id);

    expect(aOutgoing.map((r) => r.counterpart.id)).toEqual([b.id]);
    expect(bIncoming.map((r) => r.counterpart.id)).toEqual([a.id]);
    // No automatic mirrored relationship on B's outgoing side.
    expect(bOutgoing).toEqual([]);
  });

  it("allows multiple relationship types between the same pair", async () => {
    const a = await createTestEntity("multi_a");
    const b = await createTestEntity("multi_b");

    await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });
    await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "USES",
    });

    const outgoing = await getOutgoingRelationships(a.id);
    expect(outgoing.map((r) => r.relationship.relationshipType).sort()).toEqual(
      ["REQUIRES", "USES"].sort(),
    );
  });

  it("rejects an exact duplicate (same source, target, and type) and leaves one row persisted", async () => {
    const a = await createTestEntity("dup_a");
    const b = await createTestEntity("dup_b");
    await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    const attempt = createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    await expect(attempt).rejects.toMatchObject({ code: RELATIONSHIP_ERROR_CODES.DUPLICATE });
    await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);

    const outgoing = await getOutgoingRelationships(a.id);
    expect(outgoing.filter((r) => r.relationship.relationshipType === "REQUIRES")).toHaveLength(1);
  });

  it("allows the opposite direction as an independently-stored, distinct relationship", async () => {
    const a = await createTestEntity("opp_a");
    const b = await createTestEntity("opp_b");

    await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });
    await createEntityRelationship({
      sourceEntityId: b.id,
      targetEntityId: a.id,
      relationshipType: "REQUIRES",
    });

    const allInvolvingA = await prisma.entityRelationship.findMany({
      where: { OR: [{ sourceEntityId: a.id }, { targetEntityId: a.id }] },
    });
    expect(allInvolvingA).toHaveLength(2);
  });

  it("rejects a self-relationship without persisting anything", async () => {
    const a = await createTestEntity("self");

    const attempt = createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: a.id,
      relationshipType: "REQUIRES",
    });

    await expect(attempt).rejects.toMatchObject({ code: RELATIONSHIP_ERROR_CODES.SELF_REFERENCE });

    const anyInvolvingA = await prisma.entityRelationship.findMany({
      where: { sourceEntityId: a.id },
    });
    expect(anyInvolvingA).toHaveLength(0);
  });

  it("rejects a nonexistent source with RELATIONSHIP.INVALID_SOURCE", async () => {
    const b = await createTestEntity("missing_source_b");
    const nonexistentId = "00000000-0000-4000-8000-000000000000";

    const attempt = createEntityRelationship({
      sourceEntityId: nonexistentId,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    await expect(attempt).rejects.toMatchObject({ code: RELATIONSHIP_ERROR_CODES.INVALID_SOURCE });
  });

  it("rejects a nonexistent target with RELATIONSHIP.INVALID_TARGET", async () => {
    const a = await createTestEntity("missing_target_a");
    const nonexistentId = "00000000-0000-4000-8000-000000000000";

    const attempt = createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: nonexistentId,
      relationshipType: "REQUIRES",
    });

    await expect(attempt).rejects.toMatchObject({ code: RELATIONSHIP_ERROR_CODES.INVALID_TARGET });
  });

  it("produces documented not-found behavior for explicit lookup and removal", async () => {
    const nonexistentId = "00000000-0000-4000-8000-000000000000";
    await expect(getEntityRelationship(nonexistentId)).rejects.toMatchObject({
      code: RELATIONSHIP_ERROR_CODES.NOT_FOUND,
    });
    await expect(removeEntityRelationship(nonexistentId)).rejects.toMatchObject({
      code: RELATIONSHIP_ERROR_CODES.NOT_FOUND,
    });
  });

  it("lists relationships in deterministic order regardless of insertion order", async () => {
    const hub = await createTestEntity("order_hub");
    const targetZzz = await createTestEntity("order_zzz");
    const targetMmm = await createTestEntity("order_mmm");
    const targetAaa = await createTestEntity("order_aaa");
    // Insert out of any sorted order, and with mixed types.
    await createEntityRelationship({
      sourceEntityId: hub.id,
      targetEntityId: targetZzz.id,
      relationshipType: "USES",
    });
    await createEntityRelationship({
      sourceEntityId: hub.id,
      targetEntityId: targetMmm.id,
      relationshipType: "REQUIRES",
    });
    await createEntityRelationship({
      sourceEntityId: hub.id,
      targetEntityId: targetAaa.id,
      relationshipType: "REQUIRES",
    });

    const outgoing = await getOutgoingRelationships(hub.id);
    const expectedOrder = [...outgoing].sort((a, b) => {
      if (a.relationship.relationshipType !== b.relationship.relationshipType) {
        return a.relationship.relationshipType < b.relationship.relationshipType ? -1 : 1;
      }
      return a.counterpart.id < b.counterpart.id ? -1 : 1;
    });

    expect(outgoing.map((r) => r.relationship.id)).toEqual(expectedOrder.map((r) => r.relationship.id));
  });

  it("round-trips JSON-compatible metadata exactly, without interpreting it", async () => {
    const a = await createTestEntity("metadata_a");
    const b = await createTestEntity("metadata_b");
    const metadata = { note: "test relationship", tags: ["editorial"], priority: 1 };

    const created = await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "SEE_ALSO",
      metadata,
    });

    const fetched = await getEntityRelationship(created.id);
    expect(fetched.metadata).toEqual(metadata);
  });

  it("no implicit mechanics: a MODIFIES relationship does not alter either Entity's content", async () => {
    const a = await createTestEntity("no_mechanics_a");
    const b = await createTestEntity("no_mechanics_b");
    const aVersion = await createEntityVersion(a.id, {
      displayName: "A",
      structuredData: { value: 10 },
    });
    const bVersion = await createEntityVersion(b.id, {
      displayName: "B",
      structuredData: { value: 99 },
    });

    await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "MODIFIES",
    });

    const aVersionAfter = await prisma.entityVersion.findUnique({ where: { id: aVersion.id } });
    const bVersionAfter = await prisma.entityVersion.findUnique({ where: { id: bVersion.id } });
    expect(aVersionAfter?.structuredData).toEqual({ value: 10 });
    expect(bVersionAfter?.structuredData).toEqual({ value: 99 });
  });

  it("version independence: creating a new Version of the source does not duplicate, move, or delete the relationship", async () => {
    const a = await createTestEntity("version_independence_a");
    const b = await createTestEntity("version_independence_b");
    await createEntityVersion(a.id, { displayName: "Rev 1" });

    await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    await createEntityVersion(a.id, { displayName: "Rev 2" });

    const outgoing = await getOutgoingRelationships(a.id);
    expect(outgoing).toHaveLength(1);
    expect(outgoing.every((r) => r.relationship.sourceEntityId === a.id)).toBe(true);
    const versions = await prisma.entityVersion.findMany({ where: { entityId: a.id } });
    expect(versions).toHaveLength(2);
  });

  it("removal deletes only the relationship — Entities, Versions, and aliases remain", async () => {
    const a = await createTestEntity("removal_a");
    const b = await createTestEntity("removal_b");
    await createEntityVersion(a.id, { displayName: "Keep Me" });
    await createEntityAlias(a.id, { alias: "Keep This Alias" });
    const relationship = await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    await removeEntityRelationship(relationship.id);

    await expect(getEntityRelationship(relationship.id)).rejects.toMatchObject({
      code: RELATIONSHIP_ERROR_CODES.NOT_FOUND,
    });
    const aStillExists = await prisma.entity.findUnique({ where: { id: a.id } });
    const bStillExists = await prisma.entity.findUnique({ where: { id: b.id } });
    expect(aStillExists).not.toBeNull();
    expect(bStillExists).not.toBeNull();
    const versions = await prisma.entityVersion.findMany({ where: { entityId: a.id } });
    const aliases = await prisma.entityAlias.findMany({ where: { entityId: a.id } });
    expect(versions).toHaveLength(1);
    expect(aliases).toHaveLength(1);
  });

  it("an Entity participating in a relationship cannot be physically deleted until the relationship is removed", async () => {
    const a = await createTestEntity("delete_protection_a");
    const b = await createTestEntity("delete_protection_b");
    const relationship = await createEntityRelationship({
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "REQUIRES",
    });

    // Both participate in the relationship FK — direct deletion of either
    // is rejected at the database level (no Entity-deletion API exists;
    // this exercises the FK restriction directly, per PAS-10 M1-WO6 §25).
    await expect(prisma.entity.delete({ where: { id: a.id } })).rejects.toThrow();
    await expect(prisma.entity.delete({ where: { id: b.id } })).rejects.toThrow();

    await removeEntityRelationship(relationship.id);

    // The relationship no longer blocks deletion — but B (and A) may still
    // be blocked by other history-preservation constraints (Versions,
    // aliases, Keywords) if the fixture gave them any. Neither A nor B
    // here has any Version/alias/Keyword, so both should now be freely
    // deletable; this confirms the relationship itself was the only
    // thing blocking them.
    await expect(prisma.entity.delete({ where: { id: a.id } })).resolves.toBeDefined();
    await expect(prisma.entity.delete({ where: { id: b.id } })).resolves.toBeDefined();
  });
});
