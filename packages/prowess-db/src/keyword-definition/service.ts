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
  isKeywordImported,
  selectKeywordUsage,
  updateKeywordPresentation,
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

/**
 * RULES-WO1 (R09) — safe Keyword editing. Only PRESENTATION changes are made here: the name, the description and the
 * descriptive `deprecated` flag. The canonical key is the Keyword's mechanical identity (Definition payloads, Affinity
 * Strengths and Weaknesses, assignments and content packs refer to it) and is never changed; the category is part of a
 * content pack's protected identity and is not changed either. So no published Release, Definition or Character changes
 * meaning: an older Character keeps exactly the mechanics it had, and only the words shown for the Keyword change.
 *
 * The edit is a compare-and-set against the values the editor loaded: a Keyword changed since then is refused with
 * KEYWORD.STALE_EDIT and nothing is written.
 */
export interface KeywordPresentationEdit {
  readonly expected: { readonly name: string; readonly description: string | null; readonly deprecated: boolean };
  readonly name: string;
  readonly description: string | null;
  readonly deprecated: boolean;
}

export async function changeKeywordPresentation(id: string, edit: KeywordPresentationEdit): Promise<KeywordDefinition> {
  const current = await getKeywordDefinition(id);
  const name = typeof edit.name === "string" ? edit.name.trim() : "";
  if (!isValidKeywordName(name)) throw new DomainError(KEYWORD_ERROR_CODES.INVALID_INPUT, "name is required and must not be empty");
  if (edit.description !== null && typeof edit.description !== "string") throw new DomainError(KEYWORD_ERROR_CODES.INVALID_INPUT, "description is text or null");
  if (typeof edit.deprecated !== "boolean") throw new DomainError(KEYWORD_ERROR_CODES.INVALID_INPUT, "deprecated is true or false");
  const e = edit.expected;
  if (e === null || typeof e !== "object" || typeof e.name !== "string" || typeof e.deprecated !== "boolean" || (e.description !== null && typeof e.description !== "string")) {
    throw new DomainError(KEYWORD_ERROR_CODES.INVALID_INPUT, "expected names the values the editor loaded (name, description, deprecated)");
  }
  // Imported content stays exactly as its pack delivered it (the database refuses the write too); say so plainly.
  if (await isKeywordImported(current.id)) throw new DomainError(KEYWORD_ERROR_CODES.IMPORTED_READ_ONLY, `Keyword ${current.name} was installed from a content pack, and imported content is read-only. Nothing was changed.`);
  const description = edit.description === null || edit.description.trim() === "" ? null : edit.description.trim();
  const updated = await updateKeywordPresentation(current.id, { name: e.name, description: e.description, deprecated: e.deprecated }, { name, description, deprecated: edit.deprecated });
  if (updated === null) throw new DomainError(KEYWORD_ERROR_CODES.STALE_EDIT, `Keyword ${current.canonicalKey} changed after it was loaded. Reload it before saving — nothing was changed.`);
  return updated;
}

/** Where a Keyword is used, so an editor can say what a name change will be shown on (read-only). */
export async function getKeywordUsage(id: string): Promise<{ entityAssignments: number; versionAssignments: number; definitionRevisions: number; releases: number; imported: boolean }> {
  const current = await getKeywordDefinition(id);
  const [usage, imported] = await Promise.all([selectKeywordUsage(current.id, current.canonicalKey), isKeywordImported(current.id)]);
  return { ...usage, imported };
}
