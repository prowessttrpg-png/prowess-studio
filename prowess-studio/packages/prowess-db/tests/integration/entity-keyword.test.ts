/**
 * EntityKeyword (entity-level Keyword assignment) database integration
 * tests (PAS-10 M1-WO5 §28, §31 Entity-level half).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 */
import { DomainError, KEYWORD_ASSIGNMENT_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignKeywordToEntity,
  createEntity,
  createEntityVersion,
  createKeywordDefinition,
  findEntitiesByKeyword,
  listEntityKeywords,
  prisma,
  removeKeywordFromEntity,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.";
let fixtureCounter = 0;

function nextCanonicalKey(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_PREFIX}entkw.${label}_${fixtureCounter}`;
}

async function createTestEntity(label: string) {
  return createEntity({ entityType: "GENERIC_RULE", canonicalKey: nextCanonicalKey(label) });
}

async function createTestKeyword(label: string) {
  return createKeywordDefinition({ canonicalKey: nextCanonicalKey(`kw.${label}`), name: label });
}

describe("EntityKeyword — entity-level assignment (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const testEntities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const testEntityIds = testEntities.map((e) => e.id);
    await prisma.entityKeyword.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
    await prisma.keywordDefinition.deleteMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
    });
  });

  it("assigns and lists multiple Keywords on an Entity", async () => {
    const entity = await createTestEntity("keyworded");
    const alpha = await createTestKeyword("alpha");
    const beta = await createTestKeyword("beta");

    await assignKeywordToEntity(entity.id, alpha.id);
    await assignKeywordToEntity(entity.id, beta.id);

    const assignments = await listEntityKeywords(entity.id);
    expect(assignments.map((a) => a.keyword.id).sort()).toEqual([alpha.id, beta.id].sort());
    expect(assignments.every((a) => a.sourceType === "AUTHORED")).toBe(true);
  });

  it("lists Entity Keywords in deterministic order (by the keyword's canonicalKey)", async () => {
    const entity = await createTestEntity("list_order");
    const zzz = await createKeywordDefinition({
      canonicalKey: nextCanonicalKey("zzz_order"),
      name: "Zzz",
    });
    const aaa = await createKeywordDefinition({
      canonicalKey: nextCanonicalKey("aaa_order"),
      name: "Aaa",
    });
    await assignKeywordToEntity(entity.id, zzz.id);
    await assignKeywordToEntity(entity.id, aaa.id);

    const assignments = await listEntityKeywords(entity.id);

    expect(assignments.map((a) => a.keyword.canonicalKey)).toEqual(
      [aaa.canonicalKey, zzz.canonicalKey].sort(),
    );
  });

  it("rejects a duplicate assignment of the same Keyword to the same Entity", async () => {
    const entity = await createTestEntity("duplicate");
    const keyword = await createTestKeyword("dup");
    await assignKeywordToEntity(entity.id, keyword.id);

    const attempt = assignKeywordToEntity(entity.id, keyword.id);

    await expect(attempt).rejects.toMatchObject({
      code: KEYWORD_ASSIGNMENT_ERROR_CODES.DUPLICATE,
    });
    await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
  });

  it("removes one Keyword while the Entity, its other Keywords, and its Versions remain", async () => {
    const entity = await createTestEntity("remove");
    await createEntityVersion(entity.id, { displayName: "Keep Me" });
    const alpha = await createTestKeyword("remove_alpha");
    const beta = await createTestKeyword("remove_beta");
    await assignKeywordToEntity(entity.id, alpha.id);
    await assignKeywordToEntity(entity.id, beta.id);

    await removeKeywordFromEntity(entity.id, alpha.id);

    const remaining = await listEntityKeywords(entity.id);
    expect(remaining.map((a) => a.keyword.id)).toEqual([beta.id]);

    const entityStillExists = await prisma.entity.findUnique({ where: { id: entity.id } });
    expect(entityStillExists).not.toBeNull();
    const versionsStillExist = await prisma.entityVersion.findMany({
      where: { entityId: entity.id },
    });
    expect(versionsStillExist).toHaveLength(1);
  });

  it("removing a Keyword that was never assigned is idempotent (no error)", async () => {
    const entity = await createTestEntity("idempotent_remove");
    const keyword = await createTestKeyword("never_assigned");

    await expect(removeKeywordFromEntity(entity.id, keyword.id)).resolves.toBeUndefined();
  });

  it("finds all Entities carrying a given Keyword — never arbitrarily one", async () => {
    const entityA = await createTestEntity("reverse_a");
    const entityB = await createTestEntity("reverse_b");
    const shared = await createTestKeyword("shared_reverse");
    await assignKeywordToEntity(entityA.id, shared.id);
    await assignKeywordToEntity(entityB.id, shared.id);

    const matches = await findEntitiesByKeyword(shared.id);

    expect(matches.map((m) => m.entity.id).sort()).toEqual([entityA.id, entityB.id].sort());
  });
});
