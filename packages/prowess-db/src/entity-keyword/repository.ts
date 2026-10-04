import {
  EntityId,
  KeywordDefinitionId,
  type Entity,
  type EntityKeyword,
  type KeywordAssignmentSource,
  type KeywordDefinition,
} from "@prowess/model";
import { prisma } from "../client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { toDomainEntity } from "../entity/repository.js";
import { toDomainKeywordDefinition } from "../keyword-definition/repository.js";
import type {
  Entity as PrismaEntityRow,
  EntityKeyword as PrismaEntityKeywordRow,
  KeywordDefinition as PrismaKeywordDefinitionRow,
} from "../../generated/prisma/client.js";

/**
 * EntityKeyword repository — the only place in this package that speaks
 * Prisma's `entityKeyword` query API directly. Internal implementation
 * detail of the entity-keyword service (not re-exported from
 * `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 *
 * No lifecycle guard here — unlike `entity-version-keyword/repository.ts`,
 * Entity-level assignment does not depend on any EntityVersion status
 * (PAS-10 M1-WO5 §21).
 */

function toDomainEntityKeyword(row: PrismaEntityKeywordRow): EntityKeyword {
  return {
    entityId: EntityId.of(row.entityId),
    keywordId: KeywordDefinitionId.of(row.keywordId),
    sourceType: row.sourceType as KeywordAssignmentSource,
    createdAt: row.createdAt,
  };
}

/**
 * Inserts a new EntityKeyword row. Does not catch or translate errors — a
 * duplicate `(entityId, keywordId)` surfaces here as Prisma's own
 * `PrismaClientKnownRequestError` (code `P2002`); mapping that to the
 * domain's `KEYWORD_ASSIGNMENT.DUPLICATE` is the service layer's job. A
 * nonexistent `entityId`/`keywordId` surfaces as a foreign-key violation
 * (`P2003`) — the service layer validates both exist beforehand instead,
 * so this should not occur through the supported service boundary.
 */
export async function insertEntityKeyword(
  entityId: string,
  keywordId: string,
  sourceType: KeywordAssignmentSource,
): Promise<EntityKeyword> {
  const row = await prisma.entityKeyword.create({
    data: { entityId, keywordId, sourceType },
  });
  return toDomainEntityKeyword(row);
}

export interface EntityKeywordAssignment {
  keyword: KeywordDefinition;
  sourceType: KeywordAssignmentSource;
  createdAt: Date;
}

/** Lists an Entity's Keyword assignments, ordered by the keyword's `canonicalKey ASC`. */
export async function selectEntityKeywords(entityId: string): Promise<EntityKeywordAssignment[]> {
  const rows = await prisma.entityKeyword.findMany({
    where: { entityId },
    include: { keyword: true },
    orderBy: { keyword: { canonicalKey: "asc" } },
  });

  return rows.map((row: PrismaEntityKeywordRow & { keyword: PrismaKeywordDefinitionRow }) => ({
    keyword: toDomainKeywordDefinition(row.keyword),
    sourceType: row.sourceType as KeywordAssignmentSource,
    createdAt: row.createdAt,
  }));
}

export interface EntityKeywordMatch {
  entity: Entity;
  sourceType: KeywordAssignmentSource;
}

/**
 * Finds every Entity carrying a given Keyword at the Entity level —
 * deliberately 0..many (PAS-10 M1-WO5 §18/§31), never exactly one, and
 * never inferring anything about any EntityVersion.
 */
export async function selectEntitiesByKeyword(keywordId: string): Promise<EntityKeywordMatch[]> {
  const rows = await prisma.entityKeyword.findMany({
    where: { keywordId },
    include: { entity: true },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row: PrismaEntityKeywordRow & { entity: PrismaEntityRow }) => ({
    entity: toDomainEntity(row.entity),
    sourceType: row.sourceType as KeywordAssignmentSource,
  }));
}

/**
 * Removes an EntityKeyword assignment. Returns `true` if a row was
 * deleted, `false` if no such assignment existed.
 */
export async function deleteEntityKeyword(entityId: string, keywordId: string): Promise<boolean> {
  try {
    await prisma.entityKeyword.delete({
      where: { entityId_keywordId: { entityId, keywordId } },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return false;
    }
    throw error;
  }
}

/**
 * Whether `error` is a duplicate-assignment violation. `entity_keywords`
 * has exactly one uniqueness constraint — its composite primary key
 * `(entity_id, keyword_id)` — so any `P2002` on this table unambiguously
 * means "this Keyword is already assigned to this Entity"; there is no
 * other unique constraint it could be confused with (unlike tables with
 * several independent unique constraints, where matching `meta.target`
 * precisely matters).
 */
export function isEntityKeywordDuplicateViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
