/**
 * KeywordCategory and KeywordDefinition database integration tests
 * (PAS-10 M1-WO5 §27).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 */
import { DomainError, KEYWORD_CATEGORY_ERROR_CODES, KEYWORD_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createKeywordCategory,
  createKeywordDefinition,
  findKeywordCategoryByCanonicalKey,
  findKeywordDefinitionByCanonicalKey,
  getKeywordCategory,
  getKeywordDefinition,
  listKeywordDefinitions,
  prisma,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.keyword";
let fixtureCounter = 0;

function nextKey(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_PREFIX}.${label}_${fixtureCounter}`;
}

describe("KeywordCategory & KeywordDefinition (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await prisma.keywordDefinition.deleteMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
    });
    await prisma.keywordCategory.deleteMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
    });
  });

  describe("KeywordCategory", () => {
    it("creates and retrieves a Category by ID and canonical key", async () => {
      const key = nextKey("category.effect");
      const created = await createKeywordCategory({ canonicalKey: key, name: "Effect" });

      expect(created.name).toBe("Effect");
      expect(created.canonicalKey).toBe(key);

      const byId = await getKeywordCategory(created.id);
      expect(byId.id).toBe(created.id);

      const byKey = await findKeywordCategoryByCanonicalKey(key);
      expect(byKey?.id).toBe(created.id);
    });

    it("rejects a duplicate Category canonical key", async () => {
      const key = nextKey("category.duplicate");
      await createKeywordCategory({ canonicalKey: key, name: "First" });

      const attempt = createKeywordCategory({ canonicalKey: key, name: "Second" });

      await expect(attempt).rejects.toMatchObject({
        code: KEYWORD_CATEGORY_ERROR_CODES.CANONICAL_KEY_CONFLICT,
      });
      await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
    });

    it("produces documented not-found behavior for a nonexistent Category id", async () => {
      const nonexistentId = "00000000-0000-4000-8000-000000000000";
      await expect(getKeywordCategory(nonexistentId)).rejects.toMatchObject({
        code: KEYWORD_CATEGORY_ERROR_CODES.NOT_FOUND,
      });
    });
  });

  describe("KeywordDefinition", () => {
    it("creates and retrieves a Keyword by ID and canonical key, uncategorized", async () => {
      const key = nextKey("damage");
      const created = await createKeywordDefinition({ canonicalKey: key, name: "Damage" });

      expect(created.name).toBe("Damage");
      expect(created.categoryId).toBeNull();
      expect(created.deprecated).toBe(false);

      const byId = await getKeywordDefinition(created.id);
      expect(byId.id).toBe(created.id);

      const byKey = await findKeywordDefinitionByCanonicalKey(key);
      expect(byKey?.id).toBe(created.id);
    });

    it("creates a Keyword with a Category", async () => {
      const category = await createKeywordCategory({
        canonicalKey: nextKey("category.damage_types"),
        name: "Damage Types",
      });
      const keyword = await createKeywordDefinition({
        canonicalKey: nextKey("fire"),
        name: "Fire",
        categoryId: category.id,
      });

      expect(keyword.categoryId).toBe(category.id);
    });

    it("rejects a duplicate Keyword canonical key", async () => {
      const key = nextKey("control");
      await createKeywordDefinition({ canonicalKey: key, name: "Control" });

      const attempt = createKeywordDefinition({ canonicalKey: key, name: "Control Again" });

      await expect(attempt).rejects.toMatchObject({
        code: KEYWORD_ERROR_CODES.CANONICAL_KEY_CONFLICT,
      });
    });

    it("rejects Keyword creation when the supplied categoryId does not exist", async () => {
      const nonexistentCategoryId = "00000000-0000-4000-8000-000000000000";

      const attempt = createKeywordDefinition({
        canonicalKey: nextKey("orphan_category"),
        name: "Orphan",
        categoryId: nonexistentCategoryId,
      });

      await expect(attempt).rejects.toMatchObject({
        code: KEYWORD_CATEGORY_ERROR_CODES.NOT_FOUND,
      });
    });

    it("produces documented not-found behavior for a nonexistent Keyword id", async () => {
      const nonexistentId = "00000000-0000-4000-8000-000000000000";
      await expect(getKeywordDefinition(nonexistentId)).rejects.toMatchObject({
        code: KEYWORD_ERROR_CODES.NOT_FOUND,
      });
    });

    it("lists Keywords in deterministic canonicalKey ASC order, optionally filtered by category", async () => {
      const category = await createKeywordCategory({
        canonicalKey: nextKey("category.list_order"),
        name: "List Order Category",
      });
      const keyA = nextKey("list_order.zzz");
      const keyB = nextKey("list_order.aaa");
      await createKeywordDefinition({ canonicalKey: keyA, name: "Zzz", categoryId: category.id });
      await createKeywordDefinition({ canonicalKey: keyB, name: "Aaa", categoryId: category.id });
      // An uncategorized one must not appear in the filtered list.
      await createKeywordDefinition({ canonicalKey: nextKey("list_order.uncategorized"), name: "U" });

      const categorized = await listKeywordDefinitions(category.id);

      expect(categorized.map((k) => k.canonicalKey)).toEqual([keyB, keyA].sort());
    });
  });
});
