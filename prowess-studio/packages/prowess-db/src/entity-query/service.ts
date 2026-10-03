import {
  DomainError,
  ENTITY_ERROR_CODES,
  ENTITY_VERSION_ERROR_CODES,
  isEntityType,
  isEntityVersionStatus,
  type Entity,
  type EntityVersion,
} from "@prowess/model";
import {
  countFilteredEntities,
  selectAllFilteredEntityIds,
  selectEntitiesByIds,
  selectFilteredEntitiesPage,
  selectLatestVersionsByEntityIds,
  type EntityListFilters,
} from "./repository.js";

/**
 * Entity list/query service — backs `GET /api/entities` (PAS-10 M1-WO8
 * §6, §27–30). The one place Prisma query construction for the filtered
 * Entity list lives; API routes call this, never Prisma directly.
 *
 * **`latestRevision`, never `currentVersion`/`activeVersion`/`canonVersion`
 * (PAS-10 M1-WO8 §6 — mandatory distinction):** the Version returned
 * alongside each Entity is deterministically "the one with the highest
 * `revisionNumber`" — a simple, documented, list-display convenience. It
 * is NOT a claim about Canon authority, Ruleset currentness, or which
 * Version is "active" in any mechanical sense — none of those concepts
 * exist yet (M2). If an Entity has no Versions at all, `latestRevision` is
 * `null`.
 */

export interface ListEntitiesQuery {
  /** 1-based. Already validated/defaulted by the API layer before this is called. */
  page: number;
  /** Already validated/capped by the API layer before this is called. */
  pageSize: number;
  entityType?: string;
  /** Exact match. */
  canonicalKey?: string;
  /**
   * Contains-match across EntityAlias.normalizedAlias (any context) and
   * EntityVersion.displayName (ANY revision, not just latestRevision) —
   * deliberate: restricting search to only the latest revision would
   * itself privilege one Version as though it were canonically special
   * for discovery purposes, which is exactly the assumption M1-WO8 is
   * instructed to avoid making. Someone searching for an Entity's old
   * name should still find it. No fuzzy/trigram/full-text matching.
   */
  search?: string;
  /**
   * An Entity-level EntityKeyword assignment for this KeywordDefinition
   * UUID (a canonical-key form is NOT supported here — PAS-10 M1-WO8 §28
   * permits choosing one stable input form; a caller holding only a
   * canonical key resolves it first via `GET /api/keywords?canonicalKey=`,
   * mirroring the same "resolve explicitly, don't guess the input shape"
   * decision M1-WO5's `findEntitiesByKeyword` already made).
   *
   * **Scope limitation, stated explicitly (PAS-10 M1-WO8 §30):** this
   * filter checks ONLY Entity-level `EntityKeyword` assignments — it does
   * NOT also check `latestRevision`'s Version-level Keywords. The fuller
   * "entity-level OR latestRevision-level" semantics PAS-10 recommends
   * would require resolving `latestRevision` before the Entity-level
   * `WHERE` clause can even be built (a significantly more expensive
   * two-phase query, the same class of cost the `status` filter below
   * already pays) — deferred to a later Work Order rather than attempted
   * here. A Keyword assigned only at the Version level will NOT currently
   * surface an Entity through this filter.
   */
  keywordId?: string;
  /**
   * Filters by `latestRevision.status` (PAS-10 M1-WO8 §29's recommended
   * semantic — matches the displayed summary object exactly). **This is a
   * list-view convenience, not global Canon resolution** — an Entity
   * whose latest revision happens to be `DRAFT` is not thereby "inactive"
   * in any authoritative sense; it just means the newest revision is in
   * that state. An Entity with no Versions never matches any `status`
   * filter value (there is no `latestRevision` for its status to equal).
   */
  status?: string;
}

export interface EntityListItem {
  entity: Entity;
  /** `null` if the Entity has no EntityVersions yet. */
  latestRevision: EntityVersion | null;
}

export interface ListEntitiesResult {
  items: EntityListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listEntities(query: ListEntitiesQuery): Promise<ListEntitiesResult> {
  if (query.entityType !== undefined && !isEntityType(query.entityType)) {
    throw new DomainError(
      ENTITY_ERROR_CODES.INVALID_TYPE,
      `Not a recognized EntityType: ${JSON.stringify(query.entityType)}`,
    );
  }
  if (query.status !== undefined && !isEntityVersionStatus(query.status)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      `Not a recognized EntityVersionStatus: ${JSON.stringify(query.status)}`,
    );
  }

  const filters: EntityListFilters = {
    entityType: query.entityType,
    canonicalKey: query.canonicalKey,
    search: query.search,
    keywordId: query.keywordId,
  };
  const skip = (query.page - 1) * query.pageSize;

  if (query.status === undefined) {
    // Fast path: filtering is entirely expressible in the Entity-level
    // WHERE clause, so pagination happens in the database.
    const [total, entities] = await Promise.all([
      countFilteredEntities(filters),
      selectFilteredEntitiesPage(filters, skip, query.pageSize),
    ]);
    const latestByEntityId = await selectLatestVersionsByEntityIds(entities.map((e) => e.id));
    return {
      items: entities.map((entity) => ({
        entity,
        latestRevision: latestByEntityId.get(entity.id) ?? null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // Status filtering requires latestRevision, a derived per-entity value
  // the database-level WHERE clause above cannot express directly.
  // Documented tradeoff: every candidate Entity id (matching the OTHER
  // filters) is loaded, its latestRevision resolved in bulk, and the
  // status match + pagination both happen in application code. Acceptable
  // for Phase 1 development-scale data; worth revisiting (e.g. a raw-SQL
  // window-function query) if dataset size grows significantly before a
  // Ruleset/Canon system makes this kind of query obsolete anyway.
  const allCandidateIds = await selectAllFilteredEntityIds(filters);
  const latestByEntityId = await selectLatestVersionsByEntityIds(allCandidateIds);
  const matchingIds = allCandidateIds.filter(
    (id) => latestByEntityId.get(id)?.status === query.status,
  );
  const pageIds = matchingIds.slice(skip, skip + query.pageSize);
  const entities = await selectEntitiesByIds(pageIds);

  return {
    items: entities.map((entity) => ({
      entity,
      latestRevision: latestByEntityId.get(entity.id) ?? null,
    })),
    total: matchingIds.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}
