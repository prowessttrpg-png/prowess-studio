/**
 * EntityVersion database integration tests (PAS-10 M1-WO2 §26–27).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 * Uses the public Entity/EntityVersion services for everything except the
 * two cases that need to reach a lower-level primitive directly (the
 * duplicate-revision conflict and the raw Entity-deletion FK check) — both
 * clearly commented where that happens.
 */
import { DomainError, ENTITY_ERROR_CODES, ENTITY_VERSION_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityVersion,
  getEntityVersion,
  getLatestEntityVersion,
  listEntityVersions,
  prisma,
} from "../../src/index";
import { insertEntityVersionAtRevision } from "../../src/entity-version/repository";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.";

describe("EntityVersion (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const testEntities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const testEntityIds = testEntities.map((e) => e.id);
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
  });

  it("creates the first Version for an Entity at revision 1", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.versioned",
    });

    const version = await createEntityVersion(entity.id, {
      displayName: "Test Rule",
      structuredData: { value: 10 },
    });

    expect(version.revisionNumber).toBe(1);
    expect(version.entityId).toBe(entity.id);
    expect(version.displayName).toBe("Test Rule");
    expect(version.status).toBe("DRAFT");
    expect(version.structuredData).toEqual({ value: 10 });
  });

  it("creates a second Version for the same Entity at revision 2", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.two_revisions",
    });
    await createEntityVersion(entity.id, { displayName: "Test Rule", structuredData: { value: 10 } });

    const second = await createEntityVersion(entity.id, {
      displayName: "Test Rule",
      structuredData: { value: 20 },
    });

    expect(second.revisionNumber).toBe(2);
  });

  it("gives a separate Entity its own independent revision sequence starting at 1", async () => {
    const entityA = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.sequence_a",
    });
    const entityB = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.sequence_b",
    });

    await createEntityVersion(entityA.id, { displayName: "A" });
    const bFirst = await createEntityVersion(entityB.id, { displayName: "B" });

    expect(bFirst.revisionNumber).toBe(1);
  });

  it("preserves historical Versions independently — creating revision 2 does not mutate revision 1", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.historical",
    });
    const rev1 = await createEntityVersion(entity.id, {
      displayName: "Test Rule",
      structuredData: { value: 10 },
    });
    const rev2 = await createEntityVersion(entity.id, {
      displayName: "Test Rule",
      structuredData: { value: 20 },
    });

    const fetchedRev1 = await getEntityVersion(rev1.id);
    const fetchedRev2 = await getEntityVersion(rev2.id);

    expect(fetchedRev1.structuredData).toEqual({ value: 10 });
    expect(fetchedRev2.structuredData).toEqual({ value: 20 });
  });

  it("lists Versions for an Entity in deterministic revisionNumber ASC order", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.list_order",
    });
    await createEntityVersion(entity.id, { displayName: "v1" });
    await createEntityVersion(entity.id, { displayName: "v2" });
    await createEntityVersion(entity.id, { displayName: "v3" });

    const versions = await listEntityVersions(entity.id);

    expect(versions.map((v) => v.revisionNumber)).toEqual([1, 2, 3]);
  });

  it("returns the highest-revision Version as the latest", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.latest",
    });
    await createEntityVersion(entity.id, { displayName: "v1" });
    const v2 = await createEntityVersion(entity.id, { displayName: "v2" });

    const latest = await getLatestEntityVersion(entity.id);

    expect(latest?.id).toBe(v2.id);
    expect(latest?.revisionNumber).toBe(2);
  });

  it("returns null (not an error) for the latest Version of an Entity with none yet", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.no_versions_yet",
    });

    const latest = await getLatestEntityVersion(entity.id);

    expect(latest).toBeNull();
  });

  it("persists parent-version lineage", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.lineage",
    });
    const rev1 = await createEntityVersion(entity.id, { displayName: "v1" });
    const rev2 = await createEntityVersion(entity.id, {
      displayName: "v2",
      parentVersionId: rev1.id,
    });

    expect(rev2.parentVersionId).toBe(rev1.id);
  });

  it("rejects a parentVersionId that belongs to a different Entity", async () => {
    const entityA = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.cross_parent_a",
    });
    const entityB = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.cross_parent_b",
    });
    const aVersion = await createEntityVersion(entityA.id, { displayName: "A v1" });

    const attempt = createEntityVersion(entityB.id, {
      displayName: "B v1",
      parentVersionId: aVersion.id,
    });

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.INVALID_PARENT });
  });

  it("rejects a parentVersionId that does not exist", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.nonexistent_parent",
    });
    const nonexistentVersionId = "00000000-0000-4000-8000-000000000000";

    const attempt = createEntityVersion(entity.id, {
      displayName: "v1",
      parentVersionId: nonexistentVersionId,
    });

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.INVALID_PARENT });
  });

  it("exercises the underlying (entity_id, revision_number) unique constraint directly", async () => {
    // White-box: calls the repository's lowest-level primitive directly
    // (bypassing automatic revision allocation) to deterministically force
    // a real constraint violation, rather than relying on timing. See
    // repository.ts's own doc comment on insertEntityVersionAtRevision for
    // why this is a legitimate same-package use.
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.duplicate_revision",
    });

    await insertEntityVersionAtRevision({
      entityId: entity.id,
      revisionNumber: 1,
      status: "DRAFT",
      displayName: "First",
      shortDescription: null,
      rulesText: null,
      structuredData: {},
      parentVersionId: null,
      changeType: null,
      changeSummary: null,
    });

    const attempt = insertEntityVersionAtRevision({
      entityId: entity.id,
      revisionNumber: 1,
      status: "DRAFT",
      displayName: "Duplicate",
      shortDescription: null,
      rulesText: null,
      structuredData: {},
      parentVersionId: null,
      changeType: null,
      changeSummary: null,
    });

    await expect(attempt).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects Version creation for a nonexistent Entity with ENTITY.NOT_FOUND", async () => {
    const nonexistentEntityId = "00000000-0000-4000-8000-000000000000";

    const attempt = createEntityVersion(nonexistentEntityId, { displayName: "v1" });

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_ERROR_CODES.NOT_FOUND });
    await expect(attempt.catch((e) => e)).resolves.toBeInstanceOf(DomainError);
  });

  it("produces documented not-found behavior for a nonexistent Version id", async () => {
    const nonexistentVersionId = "00000000-0000-4000-8000-000000000000";

    const attempt = getEntityVersion(nonexistentVersionId);

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.NOT_FOUND });
  });

  it("prevents an Entity with EntityVersions from being physically deleted", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.delete_protection",
    });
    await createEntityVersion(entity.id, { displayName: "v1" });

    // No Entity-deletion service/API exists (deliberately — see M1-WO1).
    // This verifies the foreign-key RESTRICT behavior directly at the
    // database level, per PAS-10 M1-WO2 §24.
    const attempt = prisma.entity.delete({ where: { id: entity.id } });

    await expect(attempt).rejects.toThrow();

    // And prove the Entity (and its Version) really are still there.
    const stillExists = await prisma.entity.findUnique({ where: { id: entity.id } });
    expect(stillExists).not.toBeNull();
  });

  it("concurrent creation: multiple simultaneous requests for the same Entity all succeed with distinct, correct revision numbers", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.concurrent",
    });

    const concurrentAttempts = 4;
    const results = await Promise.all(
      Array.from({ length: concurrentAttempts }, (_, i) =>
        createEntityVersion(entity.id, { displayName: `Concurrent ${i}` }),
      ),
    );

    const revisionNumbers = results.map((r) => r.revisionNumber).sort((a, b) => a - b);
    expect(revisionNumbers).toEqual([1, 2, 3, 4]);
    expect(new Set(revisionNumbers).size).toBe(concurrentAttempts);

    // No lost writes: exactly `concurrentAttempts` rows actually persisted.
    const allVersions = await listEntityVersions(entity.id);
    expect(allVersions).toHaveLength(concurrentAttempts);
  });
});
