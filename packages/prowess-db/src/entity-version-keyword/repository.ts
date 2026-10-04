import {
  canMutateEntityVersionContent,
  EntityVersionId,
  isEntityVersionStatus,
  KeywordDefinitionId,
  type EntityVersion,
  type EntityVersionKeyword,
  type KeywordAssignmentSource,
  type KeywordDefinition,
} from "@prowess/model";
import { prisma } from "../client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { toDomainEntityVersion } from "../entity-version/repository.js";
import { toDomainKeywordDefinition } from "../keyword-definition/repository.js";
import type {
  EntityVersion as PrismaEntityVersionRow,
  EntityVersionKeyword as PrismaEntityVersionKeywordRow,
  KeywordDefinition as PrismaKeywordDefinitionRow,
} from "../../generated/prisma/client.js";

/**
 * EntityVersionKeyword repository — the only place in this package that
 * speaks Prisma's `entityVersionKeyword` query API directly. Internal
 * implementation detail of the entity-version-keyword service (not
 * re-exported from `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 *
 * **The atomic DRAFT guard (PAS-10 M1-WO5 §19–20):** since a Version-level
 * Keyword assignment describes the *content* of a specific Version,
 * authored assignment/removal must respect the same DRAFT-only mutability
 * rule M1-WO3 established for every other authored field on
 * `EntityVersion` — but the assignment itself lives in a DIFFERENT table
 * (`entity_version_keywords`), so the single-statement `UPDATE ... WHERE
 * id = ? AND status = 'DRAFT'` trick M1-WO3 used for `EntityVersion`'s own
 * columns doesn't directly apply here; there's no `status` column on
 * *this* table to condition an `UPDATE` on.
 *
 * Instead: a short transaction takes a row lock on the `EntityVersion`
 * itself — `SELECT status FROM entity_versions WHERE id = ? FOR UPDATE` —
 * before checking its status and performing the insert/delete here. That
 * lock is what makes this atomic: Postgres blocks any concurrent writer
 * (including M1-WO3's own `transitionEntityVersionStatus`, which does its
 * own conditional `UPDATE ... WHERE id = ? AND status = ?` against the
 * very same row) from changing that row until this transaction commits or
 * rolls back. A transition racing against this assignment is therefore
 * fully serialized by Postgres itself — not by application-level
 * check-then-act logic — exactly the same reliance on the database's own
 * concurrency control that M1-WO3's atomic conditional updates use, just
 * applied across two tables instead of one. No distributed lock, no
 * polling, no retry loop needed.
 */

function toDomainEntityVersionKeyword(row: PrismaEntityVersionKeywordRow): EntityVersionKeyword {
  return {
    entityVersionId: EntityVersionId.of(row.entityVersionId),
    keywordId: KeywordDefinitionId.of(row.keywordId),
    sourceType: row.sourceType as KeywordAssignmentSource,
    createdAt: row.createdAt,
  };
}

/** The three possible outcomes of a DRAFT-guarded write (PAS-10 M1-WO5 §19–20). */
export type DraftGuardedResult<T> =
  | { outcome: "ok"; value: T }
  | { outcome: "not_draft"; currentStatus: string }
  | { outcome: "not_found" };

async function lockEntityVersionStatus(
  tx: Prisma.TransactionClient,
  entityVersionId: string,
): Promise<string | undefined> {
  const rows = await tx.$queryRaw<
    { status: string }[]
  >`SELECT status FROM entity_versions WHERE id = ${entityVersionId}::uuid FOR UPDATE`;
  return rows[0]?.status;
}

/**
 * Assigns a Keyword to an EntityVersion, but only if that Version is
 * currently `DRAFT` — checked and enforced atomically (see this module's
 * own doc comment above). Returns `{ outcome: "not_draft", currentStatus
 * }` rather than throwing directly; the service layer maps that to
 * `ENTITY_VERSION.IMMUTABLE`.
 */
export async function insertEntityVersionKeywordIfDraft(
  entityVersionId: string,
  keywordId: string,
  sourceType: KeywordAssignmentSource,
): Promise<DraftGuardedResult<EntityVersionKeyword>> {
  return prisma.$transaction(async (tx) => {
    const status = await lockEntityVersionStatus(tx, entityVersionId);
    if (status === undefined) {
      return { outcome: "not_found" };
    }
    if (!isEntityVersionStatus(status) || !canMutateEntityVersionContent(status)) {
      return { outcome: "not_draft", currentStatus: status };
    }
    const row = await tx.entityVersionKeyword.create({
      data: { entityVersionId, keywordId, sourceType },
    });
    return { outcome: "ok", value: toDomainEntityVersionKeyword(row) };
  });
}

/**
 * Removes a Keyword assignment from an EntityVersion, but only if that
 * Version is currently `DRAFT` — same atomic guard as the insert above.
 * `value` is `true` if a row was actually deleted, `false` if the
 * assignment didn't exist (still only when DRAFT — removal is just as
 * protected as assignment while non-DRAFT).
 */
export async function deleteEntityVersionKeywordIfDraft(
  entityVersionId: string,
  keywordId: string,
): Promise<DraftGuardedResult<boolean>> {
  return prisma.$transaction(async (tx) => {
    const status = await lockEntityVersionStatus(tx, entityVersionId);
    if (status === undefined) {
      return { outcome: "not_found" };
    }
    if (!isEntityVersionStatus(status) || !canMutateEntityVersionContent(status)) {
      return { outcome: "not_draft", currentStatus: status };
    }
    const result = await tx.entityVersionKeyword.deleteMany({
      where: { entityVersionId, keywordId },
    });
    return { outcome: "ok", value: result.count > 0 };
  });
}

export interface EntityVersionKeywordAssignment {
  keyword: KeywordDefinition;
  sourceType: KeywordAssignmentSource;
  createdAt: Date;
}

/** Lists an EntityVersion's Keyword assignments, ordered by the keyword's `canonicalKey ASC`. */
export async function selectEntityVersionKeywords(
  entityVersionId: string,
): Promise<EntityVersionKeywordAssignment[]> {
  const rows = await prisma.entityVersionKeyword.findMany({
    where: { entityVersionId },
    include: { keyword: true },
    orderBy: { keyword: { canonicalKey: "asc" } },
  });

  return rows.map(
    (row: PrismaEntityVersionKeywordRow & { keyword: PrismaKeywordDefinitionRow }) => ({
      keyword: toDomainKeywordDefinition(row.keyword),
      sourceType: row.sourceType as KeywordAssignmentSource,
      createdAt: row.createdAt,
    }),
  );
}

export interface EntityVersionKeywordMatch {
  entityVersion: EntityVersion;
  sourceType: KeywordAssignmentSource;
}

/**
 * Finds every EntityVersion carrying a given Keyword at the Version level
 * — deliberately 0..many (PAS-10 M1-WO5 §18/§31), across any Entity and
 * any revision, with NO inference of which Version is "current" (no such
 * concept exists yet — see `@prowess/model`'s EntityVersionKeyword doc
 * comment).
 */
export async function selectEntityVersionsByKeyword(
  keywordId: string,
): Promise<EntityVersionKeywordMatch[]> {
  const rows = await prisma.entityVersionKeyword.findMany({
    where: { keywordId },
    include: { entityVersion: true },
    orderBy: { createdAt: "asc" },
  });

  return rows.map(
    (row: PrismaEntityVersionKeywordRow & { entityVersion: PrismaEntityVersionRow }) => ({
      entityVersion: toDomainEntityVersion(row.entityVersion),
      sourceType: row.sourceType as KeywordAssignmentSource,
    }),
  );
}

/**
 * Whether `error` is a duplicate-assignment violation. Same single-
 * constraint-table reasoning as `entity-keyword/repository.ts`'s
 * `isEntityKeywordDuplicateViolation`: `entity_version_keywords` has
 * exactly one uniqueness constraint (its composite primary key), so any
 * `P2002` on this table unambiguously means "this Keyword is already
 * assigned to this EntityVersion."
 */
export function isEntityVersionKeywordDuplicateViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
