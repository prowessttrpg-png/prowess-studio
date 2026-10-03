import {
  CanonicalKey,
  DomainError,
  isValidCanonicalKey,
  isValidKeywordName,
  KEYWORD_CATEGORY_ERROR_CODES,
  type CreateKeywordCategoryInput,
  type KeywordCategory,
} from "@prowess/model";
import { Prisma } from "../../generated/prisma/client.js";
import {
  insertKeywordCategory,
  selectKeywordCategories,
  selectKeywordCategoryByCanonicalKey,
  selectKeywordCategoryById,
} from "./repository.js";

/**
 * KeywordCategory service — the application/domain boundary for
 * KeywordCategory operations (PAS-10 M1-WO5 §14). Mirrors the Entity
 * service's layering exactly:
 *
 *   domain (callers) -> this service -> repository.ts (Prisma only) -> Prisma / PostgreSQL
 *
 * Three operations only — create/get/find-by-key. No update or delete API
 * exists yet (PAS-10 M1-WO5 §14: "Full editing/deletion APIs are not
 * required yet").
 */

/**
 * Creates a new KeywordCategory.
 *
 * Validates, before anything reaches Prisma:
 *   - `canonicalKey` is a syntactically valid canonical key (reuses
 *     `@prowess/model`'s `isValidCanonicalKey` — the same grammar/
 *     validation as Entity's, not a parallel Keyword-specific key format)
 *   - `name` is non-empty and within the documented length limit
 *
 * Throws `KEYWORD_CATEGORY.CANONICAL_KEY_CONFLICT` if the canonical key is
 * already in use — the database's own unique constraint is the
 * authoritative guard; this mapping only ever translates its failure into
 * a controlled domain error, never leaks the raw Prisma error.
 */
export async function createKeywordCategory(
  input: CreateKeywordCategoryInput,
): Promise<KeywordCategory> {
  if (!isValidCanonicalKey(input.canonicalKey)) {
    throw new DomainError(
      KEYWORD_CATEGORY_ERROR_CODES.INVALID_INPUT,
      `Not a valid canonical key: ${JSON.stringify(input.canonicalKey)}`,
    );
  }
  if (!isValidKeywordName(input.name)) {
    throw new DomainError(
      KEYWORD_CATEGORY_ERROR_CODES.INVALID_INPUT,
      "name is required and must not be empty",
    );
  }

  try {
    return await insertKeywordCategory({
      canonicalKey: CanonicalKey.parse(input.canonicalKey),
      name: input.name,
      description: input.description ?? null,
    });
  } catch (error) {
    if (isCanonicalKeyUniqueConstraintViolation(error)) {
      throw new DomainError(
        KEYWORD_CATEGORY_ERROR_CODES.CANONICAL_KEY_CONFLICT,
        `canonicalKey is already in use: ${input.canonicalKey}`,
      );
    }
    throw error;
  }
}

/** Retrieves a KeywordCategory by its explicit UUID identity. */
export async function getKeywordCategory(id: string): Promise<KeywordCategory> {
  const category = await selectKeywordCategoryById(id);
  if (!category) {
    throw new DomainError(
      KEYWORD_CATEGORY_ERROR_CODES.NOT_FOUND,
      `KeywordCategory not found: ${id}`,
    );
  }
  return category;
}

/**
 * Searches for a KeywordCategory by canonical key. Returns `null`, not an
 * error, when nothing matches — the same "absence is an expected outcome"
 * reasoning as `findEntityByCanonicalKey`.
 */
export async function findKeywordCategoryByCanonicalKey(
  canonicalKey: string,
): Promise<KeywordCategory | null> {
  return selectKeywordCategoryByCanonicalKey(canonicalKey);
}

/** All KeywordCategories, ordered `canonicalKey ASC`. Added for M1-WO8's `GET /api/keyword-categories`. */
export async function listKeywordCategories(): Promise<KeywordCategory[]> {
  return selectKeywordCategories();
}

function isCanonicalKeyUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta.target as string[]).includes("canonical_key")
  );
}
