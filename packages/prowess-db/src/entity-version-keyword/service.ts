import {
  DomainError,
  ENTITY_VERSION_ERROR_CODES,
  isKeywordAssignmentSource,
  KEYWORD_ASSIGNMENT_ERROR_CODES,
  type EntityVersionKeyword,
  type KeywordAssignmentSource,
} from "@prowess/model";
import { getEntityVersion } from "../entity-version/service.js";
import { getKeywordDefinition } from "../keyword-definition/service.js";
import {
  deleteEntityVersionKeywordIfDraft,
  insertEntityVersionKeywordIfDraft,
  isEntityVersionKeywordDuplicateViolation,
  selectEntityVersionKeywords,
  selectEntityVersionsByKeyword,
  type DraftGuardedResult,
  type EntityVersionKeywordAssignment,
  type EntityVersionKeywordMatch,
} from "./repository.js";

/**
 * EntityVersionKeyword service — the application/domain boundary for
 * Version-level Keyword assignment (PAS-10 M1-WO5 §17, §19–20).
 *
 * **Lifecycle rule (PAS-10 M1-WO5 §19), matching M1-WO3's content-mutation
 * rule exactly:**
 *
 * ```
 * DRAFT EntityVersion      -> authored Keyword assignments may be changed
 * non-DRAFT EntityVersion  -> authored Keyword assignments are protected
 * ```
 *
 * A Version-level Keyword assignment describes that Version's *content* —
 * the same reasoning that makes `displayName`/`structuredData`/etc.
 * DRAFT-only also applies here. A `CANON` Version's semantic Keyword
 * classification cannot be changed while its rules content remains
 * frozen, for the same reason you cannot edit its `rulesText`. Reading
 * (`listEntityVersionKeywords`) is never restricted by status — only
 * authored assignment/removal is.
 *
 * Reading never mutates `EntityVersion`'s own authored content, status, or
 * `revisionNumber` — Keyword relationships are separate relational
 * metadata, not a side door into EntityVersion's own columns.
 */

/**
 * Assigns a Keyword to an EntityVersion. Only succeeds while that Version
 * is `DRAFT`, checked and enforced atomically (see
 * `./repository.ts`'s doc comment for the `SELECT ... FOR UPDATE`
 * strategy) — not via a separate, racy "check then write."
 *
 * Validates, before attempting the guarded write:
 *   - the EntityVersion exists (`ENTITY_VERSION.NOT_FOUND`, reused from
 *     M1-WO2)
 *   - the KeywordDefinition exists (`KEYWORD.NOT_FOUND`)
 *   - `source` is a recognized `KeywordAssignmentSource`
 *     (`KEYWORD_ASSIGNMENT.INVALID_SOURCE`)
 *
 * Throws `ENTITY_VERSION.IMMUTABLE` if the Version is not `DRAFT` at the
 * moment the guarded write actually executes — the same code M1-WO3 uses
 * for every other protected content mutation, per PAS-10 M1-WO5 §19's
 * explicit instruction to reuse that lifecycle semantics rather than
 * inventing a parallel one. Throws `KEYWORD_ASSIGNMENT.DUPLICATE` if this
 * Version already carries this Keyword.
 */
export async function assignKeywordToEntityVersion(
  entityVersionId: string,
  keywordId: string,
  source: string = "AUTHORED",
): Promise<void> {
  await getEntityVersion(entityVersionId);
  await getKeywordDefinition(keywordId);

  if (!isKeywordAssignmentSource(source)) {
    throw new DomainError(
      KEYWORD_ASSIGNMENT_ERROR_CODES.INVALID_SOURCE,
      `Not a recognized KeywordAssignmentSource: ${JSON.stringify(source)}`,
    );
  }

  let result: DraftGuardedResult<EntityVersionKeyword>;
  try {
    result = await insertEntityVersionKeywordIfDraft(
      entityVersionId,
      keywordId,
      source as KeywordAssignmentSource,
    );
  } catch (error) {
    if (isEntityVersionKeywordDuplicateViolation(error)) {
      throw new DomainError(
        KEYWORD_ASSIGNMENT_ERROR_CODES.DUPLICATE,
        `Keyword ${keywordId} is already assigned to EntityVersion ${entityVersionId}`,
      );
    }
    throw error;
  }

  handleDraftGuardOutcome(result, entityVersionId);
}

/**
 * Removes a Keyword assignment from an EntityVersion. Protected by the
 * exact same atomic DRAFT guard as assignment above — removal from a
 * protected Version is rejected with `ENTITY_VERSION.IMMUTABLE` just as
 * firmly as assignment to one would be (PAS-10 M1-WO5 §30: "Attempt
 * removal of keyword.alpha. Expected same protection.").
 */
export async function removeKeywordFromEntityVersion(
  entityVersionId: string,
  keywordId: string,
): Promise<void> {
  await getEntityVersion(entityVersionId);

  const result = await deleteEntityVersionKeywordIfDraft(entityVersionId, keywordId);

  handleDraftGuardOutcome(result, entityVersionId);
}

/**
 * All Keywords assigned to an EntityVersion, ordered by the keyword's
 * `canonicalKey ASC`. Never gated by the Version's status — reading a
 * protected Version's Keyword assignments is always allowed.
 */
export async function listEntityVersionKeywords(
  entityVersionId: string,
): Promise<EntityVersionKeywordAssignment[]> {
  return selectEntityVersionKeywords(entityVersionId);
}

/**
 * Finds every EntityVersion carrying a given Keyword — ALWAYS 0..many,
 * across any Entity and any revision. Never infers a "current" Version
 * (no such concept exists yet) and never merged with Entity-level lookup
 * (see `../entity-keyword/service.ts`'s `findEntitiesByKeyword` for the
 * separate, Entity-level equivalent).
 */
export async function findEntityVersionsByKeyword(
  keywordId: string,
): Promise<EntityVersionKeywordMatch[]> {
  return selectEntityVersionsByKeyword(keywordId);
}

function handleDraftGuardOutcome<T>(
  result: DraftGuardedResult<T>,
  entityVersionId: string,
): asserts result is { outcome: "ok"; value: T } {
  if (result.outcome === "not_found") {
    // Defensive only — getEntityVersion above already confirmed existence
    // moments earlier; EntityVersion has no delete operation anywhere in
    // this package, so this should be unreachable in practice.
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.NOT_FOUND,
      `EntityVersion not found: ${entityVersionId}`,
    );
  }
  if (result.outcome === "not_draft") {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      `EntityVersion ${entityVersionId} is not DRAFT (current status: ${result.currentStatus}) and its Keyword assignments cannot be changed`,
    );
  }
}
