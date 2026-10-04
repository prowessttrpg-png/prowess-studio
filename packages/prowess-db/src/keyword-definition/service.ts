import {
  CanonicalKey,
  DomainError,
  isValidCanonicalKey,
  isValidKeywordName,
  KEYWORD_ERROR_CODES,
  type CreateKeywordDefinitionInput,
  type KeywordDefinition,
} from "@prowess/model";
import { getKeywordCategory } from "../keyword-category/service.js";
import {
  insertKeywordDefinition,
  selectKeywordDefinitionByCanonicalKey,
  selectKeywordDefinitionById,
  selectKeywordDefinitions,
} from "./repository.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * KeywordDefinition service — the application/domain boundary for
 * KeywordDefinition operations (PAS-10 M1-WO5 §15). Mirrors every other
 * service's layering in this package:
 *
 *   domain (callers) -> this service -> repository.ts (Prisma only) -> Prisma / PostgreSQL
 */

/**
 * Creates a new KeywordDefinition.
 *
 * Validates, before anything reaches Prisma:
 *   - `canonicalKey` is syntactically valid (reuses `@prowess/model`'s
 *     `isValidCanonicalKey` — not a Keyword-specific duplicate validator)
 *   - `name` is non-empty and within the documented length limit
 *   - `categoryId`, if supplied, refers to an existing KeywordCategory
 *     (reuses `@prowess/db`'s own KeywordCategory service, so a missing
 *     Category surfaces as the existing `KEYWORD_CATEGORY.NOT_FOUND`
 *     rather than a redundant parallel code)
 *
 * `deprecated` always starts `false` — not an accepted input field; no
 * deprecation mechanics exist in this Work Order (PAS-10 M1-WO5 §33).
 *
 * Throws `KEYWORD.CANONICAL_KEY_CONFLICT` if the canonical key is already
 * in use.
 */
export async function createKeywordDefinition(
  input: CreateKeywordDefinitionInput,
): Promise<KeywordDefinition> {
  if (!isValidCanonicalKey(input.canonicalKey)) {
    throw new DomainError(
      KEYWORD_ERROR_CODES.INVALID_INPUT,
      `Not a valid canonical key: ${JSON.stringify(input.canonicalKey)}`,
    );
  }
  if (!isValidKeywordName(input.name)) {
    throw new DomainError(
      KEYWORD_ERROR_CODES.INVALID_INPUT,
      "name is required and must not be empty",
    );
  }
  if (input.categoryId != null) {
    await getKeywordCategory(input.categoryId);
  }

  try {
    return await insertKeywordDefinition({
      canonicalKey: CanonicalKey.parse(input.canonicalKey),
      name: input.name,
      categoryId: input.categoryId ?? null,
      description: input.description ?? null,
    });
  } catch (error) {
    if (isCanonicalKeyUniqueConstraintViolation(error)) {
      throw new DomainError(
        KEYWORD_ERROR_CODES.CANONICAL_KEY_CONFLICT,
        `canonicalKey is already in use: ${input.canonicalKey}`,
      );
    }
    throw error;
  }
}

/** Retrieves a KeywordDefinition by its explicit UUID identity. */
export async function getKeywordDefinition(id: string): Promise<KeywordDefinition> {
  const keyword = await selectKeywordDefinitionById(id);
  if (!keyword) {
    throw new DomainError(KEYWORD_ERROR_CODES.NOT_FOUND, `KeywordDefinition not found: ${id}`);
  }
  return keyword;
}

/**
 * Searches for a KeywordDefinition by canonical key. Returns `null`, not
 * an error, when nothing matches.
 */
export async function findKeywordDefinitionByCanonicalKey(
  canonicalKey: string,
): Promise<KeywordDefinition | null> {
  return selectKeywordDefinitionByCanonicalKey(canonicalKey);
}

/**
 * Lists KeywordDefinitions, optionally narrowed to one Category. Ordered
 * `canonicalKey ASC` (PAS-10 M1-WO5 §15) — deterministic, and meaningful
 * whether or not a category filter is applied.
 */
export async function listKeywordDefinitions(categoryId?: string): Promise<KeywordDefinition[]> {
  return selectKeywordDefinitions(categoryId);
}

function isCanonicalKeyUniqueConstraintViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: "keyword_definitions_canonical_key_key",
    fields: ["canonical_key"],
  });
}
