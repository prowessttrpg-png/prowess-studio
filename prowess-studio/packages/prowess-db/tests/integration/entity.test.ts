/**
 * Entity database integration tests (PAS-10 M1-WO1 §19).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * (loads apps/studio/.env.test before this file's top-level
 * `import { prisma } ...` constructs the client) and the
 * assertRunningAgainstTestDatabase() guard in beforeAll below. Uses only
 * the public Entity service (createEntity/getEntityById/
 * findEntityByCanonicalKey) — never raw `prisma.entity.*` calls — so these
 * tests exercise exactly what any real caller would.
 */
import { DomainError, ENTITY_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEntity, findEntityByCanonicalKey, getEntityById, prisma } from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();

/** All fixtures in this file use this prefix, so cleanup can target them precisely. */
const FIXTURE_PREFIX = "test.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Entity (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
  });

  it("creates an Entity with a UUID identity following the project's UUID convention", async () => {
    const entity = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.create",
    });

    expect(entity.entityType).toBe("GENERIC_RULE");
    expect(entity.canonicalKey).toBe("test.rule.create");
    expect(typeof entity.id).toBe("string");
    expect(entity.id).toMatch(UUID_PATTERN);
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it("retrieves the same Entity by its UUID", async () => {
    const created = await createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.retrieve_by_id",
    });

    const fetched = await getEntityById(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.canonicalKey).toBe("test.rule.retrieve_by_id");
    expect(fetched.entityType).toBe("GENERIC_RULE");
  });

  it("retrieves the same Entity by its canonical key", async () => {
    const created = await createEntity({
      entityType: "RESOURCE",
      canonicalKey: "test.resource.retrieve_by_key",
    });

    const fetched = await findEntityByCanonicalKey("test.resource.retrieve_by_key");

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
  });

  it("rejects a second Entity with an already-used canonical key", async () => {
    await createEntity({ entityType: "GENERIC_RULE", canonicalKey: "test.rule.example" });

    const attempt = createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "test.rule.example",
    });

    await expect(attempt).rejects.toMatchObject({
      code: ENTITY_ERROR_CODES.CANONICAL_KEY_CONFLICT,
    });
    await expect(attempt.catch((e) => e)).resolves.toBeInstanceOf(DomainError);
  });

  it("rejects an invalid canonical key before anything persists", async () => {
    const attempt = createEntity({
      entityType: "GENERIC_RULE",
      canonicalKey: "Not A Valid Key",
    });

    await expect(attempt).rejects.toMatchObject({
      code: ENTITY_ERROR_CODES.INVALID_CANONICAL_KEY,
    });

    // Prove nothing was written — not just that the call threw.
    const found = await findEntityByCanonicalKey("Not A Valid Key");
    expect(found).toBeNull();
  });

  it("rejects an unrecognized entity type before anything persists", async () => {
    const attempt = createEntity({
      entityType: "NOT_A_REAL_TYPE",
      canonicalKey: "test.rule.invalid_type",
    });

    await expect(attempt).rejects.toMatchObject({
      code: ENTITY_ERROR_CODES.INVALID_TYPE,
    });

    const found = await findEntityByCanonicalKey("test.rule.invalid_type");
    expect(found).toBeNull();
  });

  it("produces documented not-found behavior for a nonexistent Entity id", async () => {
    const nonexistentId = "00000000-0000-4000-8000-000000000000";

    const attempt = getEntityById(nonexistentId);

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_ERROR_CODES.NOT_FOUND });
  });

  it("findEntityByCanonicalKey returns null (not an error) for a nonexistent key", async () => {
    const found = await findEntityByCanonicalKey("test.rule.does_not_exist");
    expect(found).toBeNull();
  });
});
