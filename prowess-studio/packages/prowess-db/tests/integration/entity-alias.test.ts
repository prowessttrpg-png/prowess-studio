/**
 * EntityAlias database integration tests (PAS-10 M1-WO4 §24–25).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 * Uses only the public Entity/EntityAlias/EntityVersion services.
 */
import { DomainError, ENTITY_ALIAS_ERROR_CODES, ENTITY_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityAlias,
  createEntityVersion,
  findEntitiesByAlias,
  listEntityAliases,
  prisma,
  removeEntityAlias,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.";
let fixtureCounter = 0;

function nextCanonicalKey(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_PREFIX}alias.${label}_${fixtureCounter}`;
}

async function createTestEntity(label: string) {
  return createEntity({ entityType: "GENERIC_RULE", canonicalKey: nextCanonicalKey(label) });
}

describe("EntityAlias (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const testEntities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const testEntityIds = testEntities.map((e) => e.id);
    await prisma.entityAlias.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
  });

  it("creates and persists an alias for an Entity", async () => {
    const entity = await createTestEntity("create");

    const alias = await createEntityAlias(entity.id, { alias: "Old Rule Name" });

    expect(alias.entityId).toBe(entity.id);
    expect(alias.alias).toBe("Old Rule Name");
    expect(alias.normalizedAlias).toBe("old rule name");
    expect(alias.context).toBeNull();
  });

  it("rejects a normalized duplicate for the same Entity and context", async () => {
    const entity = await createTestEntity("duplicate");
    await createEntityAlias(entity.id, { alias: "Old Rule Name" });

    const attempt = createEntityAlias(entity.id, { alias: "  old   rule name  " });

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_ALIAS_ERROR_CODES.DUPLICATE });
    await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
  });

  it("allows one Entity to have multiple distinct aliases", async () => {
    const entity = await createTestEntity("multiple");
    await createEntityAlias(entity.id, { alias: "Old Rule Name" });
    await createEntityAlias(entity.id, { alias: "New Rule Name" });
    await createEntityAlias(entity.id, { alias: "Legacy Rule Name" });

    const aliases = await listEntityAliases(entity.id);

    expect(aliases.map((a) => a.alias).sort()).toEqual(
      ["Legacy Rule Name", "New Rule Name", "Old Rule Name"].sort(),
    );
  });

  it("lists aliases in deterministic normalizedAlias ASC order", async () => {
    const entity = await createTestEntity("list_order");
    await createEntityAlias(entity.id, { alias: "Zeta" });
    await createEntityAlias(entity.id, { alias: "Alpha" });
    await createEntityAlias(entity.id, { alias: "Mu" });

    const aliases = await listEntityAliases(entity.id);

    expect(aliases.map((a) => a.normalizedAlias)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("allows different Entities to share the same alias, and lookup returns both", async () => {
    const entityA = await createTestEntity("shared_a");
    const entityB = await createTestEntity("shared_b");
    await createEntityAlias(entityA.id, { alias: "Ward" });
    await createEntityAlias(entityB.id, { alias: "Ward" });

    const matches = await findEntitiesByAlias("Ward");

    const matchedEntityIds = matches.map((m) => m.entity.id).sort();
    expect(matchedEntityIds).toEqual([entityA.id, entityB.id].sort());
  });

  it("does not arbitrarily pick a single result — ambiguous lookup returns all matches", async () => {
    const entityA = await createTestEntity("ambiguous_a");
    const entityB = await createTestEntity("ambiguous_b");
    const entityC = await createTestEntity("ambiguous_c");
    for (const e of [entityA, entityB, entityC]) {
      await createEntityAlias(e.id, { alias: "Flicker" });
    }

    const matches = await findEntitiesByAlias("flicker");

    expect(matches).toHaveLength(3);
  });

  it("disambiguates by context — same alias text, different contexts, both persist and lookup separately", async () => {
    const entityAffinity = await createTestEntity("context_affinity");
    const entityOrg = await createTestEntity("context_org");
    await createEntityAlias(entityAffinity.id, { alias: "Emission", context: "Affinity" });
    await createEntityAlias(entityOrg.id, { alias: "Emission", context: "Organization" });

    const affinityMatches = await findEntitiesByAlias("Emission", "Affinity");
    const orgMatches = await findEntitiesByAlias("Emission", "Organization");

    expect(affinityMatches.map((m) => m.entity.id)).toEqual([entityAffinity.id]);
    expect(orgMatches.map((m) => m.entity.id)).toEqual([entityOrg.id]);
  });

  it("treats the same alias+context pair (one with, one without context) as distinct and non-conflicting", async () => {
    const entity = await createTestEntity("context_vs_no_context");
    await createEntityAlias(entity.id, { alias: "Emission" });
    const withContext = await createEntityAlias(entity.id, {
      alias: "Emission",
      context: "Affinity",
    });

    expect(withContext.context).toBe("Affinity");
    const aliases = await listEntityAliases(entity.id);
    expect(aliases).toHaveLength(2);
  });

  it("still rejects a normalized duplicate within the same non-null context", async () => {
    const entity = await createTestEntity("duplicate_with_context");
    await createEntityAlias(entity.id, { alias: "Emission", context: "Affinity" });

    const attempt = createEntityAlias(entity.id, {
      alias: "  EMISSION  ",
      context: " affinity ",
    });

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_ALIAS_ERROR_CODES.DUPLICATE });
  });

  it("rejects alias creation for a nonexistent Entity with ENTITY.NOT_FOUND", async () => {
    const nonexistentEntityId = "00000000-0000-4000-8000-000000000000";

    const attempt = createEntityAlias(nonexistentEntityId, { alias: "Whatever" });

    await expect(attempt).rejects.toMatchObject({ code: ENTITY_ERROR_CODES.NOT_FOUND });
  });

  it("removes an alias without touching the Entity, its Versions, or its other aliases", async () => {
    const entity = await createTestEntity("remove");
    await createEntityVersion(entity.id, { displayName: "Keep Me" });
    const keptAlias = await createEntityAlias(entity.id, { alias: "Keep This Alias" });
    const removedAlias = await createEntityAlias(entity.id, { alias: "Remove This Alias" });

    await removeEntityAlias(removedAlias.id);

    const remainingAliases = await listEntityAliases(entity.id);
    expect(remainingAliases.map((a) => a.id)).toEqual([keptAlias.id]);

    const entityStillExists = await prisma.entity.findUnique({ where: { id: entity.id } });
    expect(entityStillExists).not.toBeNull();
    const versionsStillExist = await prisma.entityVersion.findMany({
      where: { entityId: entity.id },
    });
    expect(versionsStillExist).toHaveLength(1);
  });

  it("produces documented not-found behavior when removing a nonexistent alias", async () => {
    const nonexistentAliasId = "00000000-0000-4000-8000-000000000000";

    await expect(removeEntityAlias(nonexistentAliasId)).rejects.toMatchObject({
      code: ENTITY_ALIAS_ERROR_CODES.NOT_FOUND,
    });
  });

  it("findEntitiesByAlias returns an empty array (not an error) for a nonexistent alias", async () => {
    const matches = await findEntitiesByAlias("no-such-alias-anywhere");
    expect(matches).toEqual([]);
  });

  describe("historical terminology use case", () => {
    it("resolves both an old and a new display name to the same Entity via aliases", async () => {
      const entity = await createTestEntity("renamed");
      await createEntityVersion(entity.id, { displayName: "Old Name" });
      await createEntityAlias(entity.id, { alias: "Old Name" });
      await createEntityAlias(entity.id, { alias: "New Name" });

      const oldNameMatches = await findEntitiesByAlias("Old Name");
      const newNameMatches = await findEntitiesByAlias("New Name");

      expect(oldNameMatches.map((m) => m.entity.id)).toEqual([entity.id]);
      expect(newNameMatches.map((m) => m.entity.id)).toEqual([entity.id]);
    });
  });

  it("canonical-key lookup remains exact and unaffected by alias matching", async () => {
    const entity = await createTestEntity("canonical_key_separate");
    await createEntityAlias(entity.id, { alias: "A Completely Different Name" });

    // findEntityByCanonicalKey must not fuzzy-match against aliases at all.
    const { findEntityByCanonicalKey } = await import("../../src/index");
    const byCanonicalKey = await findEntityByCanonicalKey(entity.canonicalKey);
    const byWrongLookup = await findEntityByCanonicalKey("A Completely Different Name");

    expect(byCanonicalKey?.id).toBe(entity.id);
    expect(byWrongLookup).toBeNull();
  });
});
