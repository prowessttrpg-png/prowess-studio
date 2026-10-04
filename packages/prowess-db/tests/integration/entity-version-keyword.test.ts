/**
 * EntityVersionKeyword (version-level Keyword assignment) database
 * integration tests (PAS-10 M1-WO5 §29–32).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 */
import { DomainError, ENTITY_VERSION_ERROR_CODES, KEYWORD_ASSIGNMENT_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignKeywordToEntityVersion,
  createEntity,
  createEntityVersion,
  createKeywordDefinition,
  findEntityVersionsByKeyword,
  getEntityVersion,
  listEntityVersionKeywords,
  prisma,
  removeKeywordFromEntityVersion,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.";
let fixtureCounter = 0;

function nextCanonicalKey(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_PREFIX}verkw.${label}_${fixtureCounter}`;
}

async function createTestEntity(label: string) {
  return createEntity({ entityType: "GENERIC_RULE", canonicalKey: nextCanonicalKey(label) });
}

async function createTestKeyword(label: string) {
  return createKeywordDefinition({ canonicalKey: nextCanonicalKey(`kw.${label}`), name: label });
}

describe("EntityVersionKeyword — version-level assignment (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const testEntities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const testEntityIds = testEntities.map((e) => e.id);
    await prisma.entityVersionKeyword.deleteMany({
      where: { entityVersion: { entityId: { in: testEntityIds } } },
    });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
    await prisma.keywordDefinition.deleteMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
    });
  });

  it("assigns a Keyword to a DRAFT Version and retrieves it", async () => {
    const entity = await createTestEntity("basic");
    const rev1 = await createEntityVersion(entity.id, { displayName: "Rev 1" });
    const fire = await createTestKeyword("fire");

    await assignKeywordToEntityVersion(rev1.id, fire.id);

    const assignments = await listEntityVersionKeywords(rev1.id);
    expect(assignments.map((a) => a.keyword.id)).toEqual([fire.id]);
  });

  it("does NOT automatically carry a Keyword from one revision to the next (historical independence)", async () => {
    const entity = await createTestEntity("independence");
    const rev1 = await createEntityVersion(entity.id, { displayName: "Rev 1" });
    const fire = await createTestKeyword("fire_independence");
    await assignKeywordToEntityVersion(rev1.id, fire.id);

    const rev2 = await createEntityVersion(entity.id, { displayName: "Rev 2" });

    const rev1Keywords = await listEntityVersionKeywords(rev1.id);
    const rev2Keywords = await listEntityVersionKeywords(rev2.id);
    expect(rev1Keywords.map((a) => a.keyword.id)).toEqual([fire.id]);
    expect(rev2Keywords).toEqual([]);
  });

  describe("version immutability (same lifecycle semantics as M1-WO3)", () => {
    it("protects a non-DRAFT Version's Keyword assignments, and allows them again after reopening to DRAFT", async () => {
      const entity = await createTestEntity("immutability");
      const version = await createEntityVersion(entity.id, { displayName: "Protected" });
      const alpha = await createTestKeyword("immut_alpha");
      const beta = await createTestKeyword("immut_beta");

      await assignKeywordToEntityVersion(version.id, alpha.id);
      await transitionEntityVersionStatus(version.id, "IN_REVIEW");

      const assignAttempt = assignKeywordToEntityVersion(version.id, beta.id);
      await expect(assignAttempt).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      });
      await expect(assignAttempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);

      const removeAttempt = removeKeywordFromEntityVersion(version.id, alpha.id);
      await expect(removeAttempt).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      });

      // Confirm nothing actually changed while protected.
      const stillOnlyAlpha = await listEntityVersionKeywords(version.id);
      expect(stillOnlyAlpha.map((a) => a.keyword.id)).toEqual([alpha.id]);

      await transitionEntityVersionStatus(version.id, "DRAFT");

      await assignKeywordToEntityVersion(version.id, beta.id);
      await removeKeywordFromEntityVersion(version.id, alpha.id);

      const finalKeywords = await listEntityVersionKeywords(version.id);
      expect(finalKeywords.map((a) => a.keyword.id)).toEqual([beta.id]);
    });

    it("reading a protected Version's Keywords is always allowed, regardless of status", async () => {
      const entity = await createTestEntity("read_while_protected");
      const version = await createEntityVersion(entity.id, { displayName: "Readable" });
      const keyword = await createTestKeyword("readable");
      await assignKeywordToEntityVersion(version.id, keyword.id);
      await transitionEntityVersionStatus(version.id, "IN_REVIEW");

      await expect(listEntityVersionKeywords(version.id)).resolves.toHaveLength(1);
    });
  });

  it("rejects a duplicate assignment of the same Keyword to the same Version", async () => {
    const entity = await createTestEntity("duplicate");
    const version = await createEntityVersion(entity.id, { displayName: "Dup" });
    const keyword = await createTestKeyword("dup_version");
    await assignKeywordToEntityVersion(version.id, keyword.id);

    const attempt = assignKeywordToEntityVersion(version.id, keyword.id);

    await expect(attempt).rejects.toMatchObject({
      code: KEYWORD_ASSIGNMENT_ERROR_CODES.DUPLICATE,
    });
  });

  it("finds all EntityVersions (across Entities and revisions) carrying a given Keyword", async () => {
    const entityA = await createTestEntity("reverse_a");
    const entityB = await createTestEntity("reverse_b");
    const aRev1 = await createEntityVersion(entityA.id, { displayName: "A Rev 1" });
    const aRev2 = await createEntityVersion(entityA.id, { displayName: "A Rev 2" });
    const bRev1 = await createEntityVersion(entityB.id, { displayName: "B Rev 1" });
    const beta = await createTestKeyword("reverse_beta");

    await assignKeywordToEntityVersion(aRev1.id, beta.id);
    await assignKeywordToEntityVersion(aRev2.id, beta.id);
    await assignKeywordToEntityVersion(bRev1.id, beta.id);

    const matches = await findEntityVersionsByKeyword(beta.id);

    expect(matches.map((m) => m.entityVersion.id).sort()).toEqual(
      [aRev1.id, aRev2.id, bRev1.id].sort(),
    );
  });

  describe("no implicit mechanics — Keyword assignment is metadata only", () => {
    it("assigning a Keyword does not alter structuredData, status, rulesText, or revisionNumber", async () => {
      const entity = await createTestEntity("no_mechanics");
      const version = await createEntityVersion(entity.id, {
        displayName: "Unaffected",
        structuredData: { value: 10 },
        rulesText: "Original rules text",
      });
      const keyword = await createTestKeyword("no_mechanics_kw");

      await assignKeywordToEntityVersion(version.id, keyword.id);

      const after = await getEntityVersion(version.id);
      expect(after.structuredData).toEqual({ value: 10 });
      expect(after.status).toBe("DRAFT");
      expect(after.rulesText).toBe("Original rules text");
      expect(after.revisionNumber).toBe(version.revisionNumber);
    });

    it("removing a Keyword likewise does not alter EntityVersion's own fields", async () => {
      const entity = await createTestEntity("no_mechanics_remove");
      const version = await createEntityVersion(entity.id, {
        displayName: "Unaffected",
        structuredData: { value: 20 },
      });
      const keyword = await createTestKeyword("no_mechanics_remove_kw");
      await assignKeywordToEntityVersion(version.id, keyword.id);

      await removeKeywordFromEntityVersion(version.id, keyword.id);

      const after = await getEntityVersion(version.id);
      expect(after.structuredData).toEqual({ value: 20 });
      expect(after.status).toBe("DRAFT");
      expect(after.revisionNumber).toBe(version.revisionNumber);
    });
  });
});
