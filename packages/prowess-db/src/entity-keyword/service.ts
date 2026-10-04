import {
  DomainError,
  isKeywordAssignmentSource,
  KEYWORD_ASSIGNMENT_ERROR_CODES,
  type KeywordAssignmentSource,
} from "@prowess/model";
import { getEntityById } from "../entity/service.js";
import { getKeywordDefinition } from "../keyword-definition/service.js";
import {
  deleteEntityKeyword,
  insertEntityKeyword,
  isEntityKeywordDuplicateViolation,
  selectEntitiesByKeyword,
  selectEntityKeywords,
  type EntityKeywordAssignment,
  type EntityKeywordMatch,
} from "./repository.js";

/**
 * EntityKeyword service — the application/domain boundary for
 * stable-identity-level Keyword assignment (PAS-10 M1-WO5 §16, §21).
 *
 * No lifecycle guard here: Entity-level assignment does not depend on, or
 * interact with, any EntityVersion's status — "this Keyword describes the
 * stable identity itself," which has no DRAFT/protected distinction of its
 * own. Contrast with `../entity-version-keyword/service.ts`.
 *
 * No automatic inference of any kind — every assignment here is the
 * direct result of an explicit `assignKeywordToEntity` call.
 *
 * `findEntitiesByKeyword` takes a KeywordDefinition's UUID `id` directly,
 * not "an id or a canonical key" — if a caller only has a canonical key,
 * resolving it first via `@prowess/db`'s own
 * `findKeywordDefinitionByCanonicalKey` is a single, explicit extra step,
 * preferred here over having this function silently guess which format it
 * was handed.
 */

/**
 * Assigns a Keyword to an Entity.
 *
 * Validates, before anything reaches Prisma:
 *   - the Entity exists (`ENTITY.NOT_FOUND`, reused from M1-WO1)
 *   - the KeywordDefinition exists (`KEYWORD.NOT_FOUND`, reused from this
 *     Work Order's own Keyword service)
 *   - `source` is a recognized `KeywordAssignmentSource`
 *     (`KEYWORD_ASSIGNMENT.INVALID_SOURCE`)
 *
 * Throws `KEYWORD_ASSIGNMENT.DUPLICATE` if this Entity already carries
 * this Keyword — the database's `(entity_id, keyword_id)` primary key is
 * the authoritative guard; this mapping only ever translates its failure
 * into a controlled domain error.
 */
export async function assignKeywordToEntity(
  entityId: string,
  keywordId: string,
  source: string = "AUTHORED",
): Promise<void> {
  await getEntityById(entityId);
  await getKeywordDefinition(keywordId);

  if (!isKeywordAssignmentSource(source)) {
    throw new DomainError(
      KEYWORD_ASSIGNMENT_ERROR_CODES.INVALID_SOURCE,
      `Not a recognized KeywordAssignmentSource: ${JSON.stringify(source)}`,
    );
  }

  try {
    await insertEntityKeyword(entityId, keywordId, source as KeywordAssignmentSource);
  } catch (error) {
    if (isEntityKeywordDuplicateViolation(error)) {
      throw new DomainError(
        KEYWORD_ASSIGNMENT_ERROR_CODES.DUPLICATE,
        `Keyword ${keywordId} is already assigned to Entity ${entityId}`,
      );
    }
    throw error;
  }
}

/**
 * Removes a Keyword assignment from an Entity. Idempotent: if the
 * assignment didn't exist, this succeeds silently rather than throwing —
 * PAS-10 M1-WO5 names no dedicated "assignment not found" error code, and
 * "the Keyword is not assigned" is already the post-condition a caller
 * removing it wants.
 */
export async function removeKeywordFromEntity(entityId: string, keywordId: string): Promise<void> {
  await deleteEntityKeyword(entityId, keywordId);
}

/** All Keywords assigned to an Entity, ordered by the Keyword's `canonicalKey ASC`. */
export async function listEntityKeywords(entityId: string): Promise<EntityKeywordAssignment[]> {
  return selectEntityKeywords(entityId);
}

/**
 * Finds every Entity carrying a given Keyword — ALWAYS 0..many, never
 * exactly one, and never confused with Version-level assignment (see
 * `../entity-version-keyword/service.ts`'s `findEntityVersionsByKeyword`
 * for the separate, Version-level equivalent — the two are never merged).
 */
export async function findEntitiesByKeyword(keywordId: string): Promise<EntityKeywordMatch[]> {
  return selectEntitiesByKeyword(keywordId);
}
