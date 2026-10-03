import { normalizeEntityAlias } from "@prowess/model";
import { prisma } from "../client.js";
import { toDomainEntity } from "../entity/repository.js";
import { toDomainEntityVersion } from "../entity-version/repository.js";
import type { Entity, EntityVersion } from "@prowess/model";

/**
 * Entity list/query repository — the only place in this package that
 * builds filtered `WHERE` clauses for the Entity list query (PAS-10
 * M1-WO8 §27). Internal implementation detail of the entity-query service
 * (not re-exported from `@prowess/db`'s own `index.ts`) — see
 * `./service.ts`.
 */

export interface EntityListFilters {
  entityType?: string;
  /** Exact match. */
  canonicalKey?: string;
  /**
   * Simple contains-match across EntityAlias.normalizedAlias (any Version,
   * any context) and EntityVersion.displayName (any revision, not just
   * latest — see `./service.ts`'s doc comment for why). No fuzzy ranking.
   */
  search?: string;
  /**
   * An Entity-level EntityKeyword assignment for this KeywordDefinition
   * UUID. M1-WO8 scope: Entity-level only — see `./service.ts`'s doc
   * comment for the documented limitation.
   */
  keywordId?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma `where`
   shape is only fully known once the generated client exists; this
   mirrors the same unavoidable cascading-type situation as every other
   repository file in this package when run outside a real Prisma
   generate. */
function buildWhereClause(filters: EntityListFilters): any {
  const and: any[] = [];

  if (filters.entityType !== undefined) {
    and.push({ entityType: filters.entityType });
  }
  if (filters.canonicalKey !== undefined) {
    and.push({ canonicalKey: filters.canonicalKey });
  }
  if (filters.keywordId !== undefined) {
    and.push({ keywordAssignments: { some: { keywordId: filters.keywordId } } });
  }
  if (filters.search !== undefined && filters.search.trim().length > 0) {
    const normalizedSearch = normalizeEntityAlias(filters.search);
    and.push({
      OR: [
        { aliases: { some: { normalizedAlias: { contains: normalizedSearch } } } },
        { versions: { some: { displayName: { contains: filters.search, mode: "insensitive" } } } },
      ],
    });
  }

  return and.length > 0 ? { AND: and } : {};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function countFilteredEntities(filters: EntityListFilters): Promise<number> {
  return prisma.entity.count({ where: buildWhereClause(filters) });
}

/** No ordering guarantee beyond `createdAt ASC, id ASC` — deterministic paging. */
export async function selectFilteredEntitiesPage(
  filters: EntityListFilters,
  skip: number,
  take: number,
): Promise<Entity[]> {
  const rows = await prisma.entity.findMany({
    where: buildWhereClause(filters),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip,
    take,
  });
  return rows.map(toDomainEntity);
}

/**
 * Every Entity id matching the non-status filters, unpaginated. Used only
 * when a `status` filter (a derived, per-entity concept — see
 * `./service.ts`) is also requested, since status filtering must happen
 * after `latestRevision` is resolved in application code — see
 * `./service.ts`'s doc comment for the documented scope/performance
 * tradeoff this implies.
 */
export async function selectAllFilteredEntityIds(filters: EntityListFilters): Promise<string[]> {
  const rows = await prisma.entity.findMany({
    where: buildWhereClause(filters),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return rows.map((row: { id: string }) => row.id);
}

export async function selectEntitiesByIds(ids: string[]): Promise<Entity[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await prisma.entity.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row: { id: string }) => [row.id, row]));
  // Preserve the caller's ordering rather than whatever order the DB returns.
  return ids.map((id) => toDomainEntity(byId.get(id))).filter((e): e is Entity => e !== undefined);
}

/**
 * The highest-`revisionNumber` EntityVersion for each of `entityIds`, as a
 * map keyed by `entityId`. An Entity with no Versions simply has no entry
 * — callers treat a missing key as `latestRevision: null`, never an error.
 *
 * Implementation note: fetches every Version for the candidate Entities in
 * ONE query (ordered `revisionNumber DESC`) and reduces to "first seen per
 * entityId" in plain JS, rather than relying on a Prisma `distinct`+
 * `orderBy` interaction — deliberately, since that interaction's exact
 * per-group "which row wins" semantics could not be empirically verified
 * in this sandbox (no generated Prisma client to test against), and a
 * plain JS reduction over an already-correctly-ordered result set is
 * unambiguous and easy to verify by inspection.
 */
export async function selectLatestVersionsByEntityIds(
  entityIds: string[],
): Promise<Map<string, EntityVersion>> {
  if (entityIds.length === 0) {
    return new Map();
  }
  const rows = await prisma.entityVersion.findMany({
    where: { entityId: { in: entityIds } },
    orderBy: { revisionNumber: "desc" },
  });

  const latestByEntityId = new Map<string, EntityVersion>();
  for (const row of rows as Array<Parameters<typeof toDomainEntityVersion>[0]>) {
    if (!latestByEntityId.has(row.entityId)) {
      latestByEntityId.set(row.entityId, toDomainEntityVersion(row));
    }
  }
  return latestByEntityId;
}
