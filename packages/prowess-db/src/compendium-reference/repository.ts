import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../client.js";

/**
 * Bounded, read-only queries for the Compendium Rules Reference (PAS-10 M6-WO2). Every query here is scoped to ONE
 * Release manifest (`manifest_id`) and reads the EXACT EntityVersion that manifest pins: membership is decided only by
 * `ruleset_manifest_entries`, never by a latest revision, a status or a re-validation of content. Release manifests are
 * flattened (parentless) by M2, so no inheritance is reconstructed here. Nothing in this file writes.
 */

/** One pinned entry of a Release, as the list / card projection reads it (no stored card data — computed per read). */
export interface PinnedEntryRow {
  readonly entityId: string;
  readonly entityVersionId: string;
  readonly canonicalKey: string;
  readonly entityType: string;
  readonly displayName: string;
  readonly shortDescription: string | null;
  readonly revisionNumber: number;
  readonly status: string;
  /** `structured_data -> 'prowessDefinition'` of the PINNED revision, verbatim (null for generic content). */
  readonly definition: unknown;
}

export interface PinnedEntryFilters {
  readonly search?: string;
  /** Declared Definition kinds to match (already expanded from kind / family / branch facets by the service). */
  readonly definitionKinds?: readonly string[];
  /** Only entries whose pinned revision carries NO Prowess Definition (generic content). */
  readonly genericOnly?: boolean;
  readonly entityType?: string;
  /** Keyword by id: a Version-level assignment on the pinned revision, or the payload's structured `keywords`. */
  readonly keyword?: { readonly id: string; readonly canonicalKey: string };
}

const DEFINITION = Prisma.sql`v.structured_data -> 'prowessDefinition'`;

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

function whereClause(manifestId: string, f: PinnedEntryFilters): Prisma.Sql {
  const and: Prisma.Sql[] = [Prisma.sql`me.manifest_id = ${manifestId}::uuid`];
  if (f.entityType !== undefined) and.push(Prisma.sql`e.entity_type::text = ${f.entityType}`);
  if (f.genericOnly === true) and.push(Prisma.sql`jsonb_typeof(${DEFINITION}) IS DISTINCT FROM 'object'`);
  if (f.definitionKinds !== undefined) and.push(Prisma.sql`(${DEFINITION} ->> 'definitionKind') = ANY(${[...f.definitionKinds]}::text[])`);
  if (f.search !== undefined && f.search.trim() !== "") {
    const like = `%${escapeLike(f.search.trim())}%`;
    and.push(Prisma.sql`(v.display_name ILIKE ${like} OR e.canonical_key ILIKE ${like}
      OR EXISTS (SELECT 1 FROM entity_aliases a WHERE a.entity_id = e.id AND a.alias ILIKE ${like}))`);
  }
  if (f.keyword !== undefined) {
    and.push(Prisma.sql`(EXISTS (SELECT 1 FROM entity_version_keywords k WHERE k.entity_version_id = v.id AND k.keyword_id = ${f.keyword.id}::uuid)
      OR (jsonb_typeof(${DEFINITION} -> 'payload' -> 'keywords') = 'array' AND (${DEFINITION} -> 'payload' -> 'keywords') @> jsonb_build_array(${f.keyword.canonicalKey}::text)))`);
  }
  return Prisma.join(and, " AND ");
}

const FROM = Prisma.sql`FROM ruleset_manifest_entries me
  JOIN entities e ON e.id = me.entity_id
  JOIN entity_versions v ON v.id = me.entity_version_id AND v.entity_id = me.entity_id`;

/** Deterministic Rules Reference order: display name (case-insensitive, then exact bytes), canonical key, Entity id. */
const ORDER = Prisma.sql`ORDER BY lower(v.display_name) COLLATE "C" ASC, v.display_name COLLATE "C" ASC, e.canonical_key COLLATE "C" ASC, e.id ASC`;

const COLUMNS = Prisma.sql`e.id::text AS "entityId", v.id::text AS "entityVersionId", e.canonical_key AS "canonicalKey",
  e.entity_type::text AS "entityType", v.display_name AS "displayName", v.short_description AS "shortDescription",
  v.revision_number AS "revisionNumber", v.status::text AS "status", ${DEFINITION} AS "definition"`;

export async function countPinnedEntries(manifestId: string, filters: PinnedEntryFilters): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number }>>`SELECT count(*) AS total ${FROM} WHERE ${whereClause(manifestId, filters)}`;
  return Number(rows[0]?.total ?? 0);
}

export async function selectPinnedEntriesPage(manifestId: string, filters: PinnedEntryFilters, skip: number, take: number): Promise<PinnedEntryRow[]> {
  return prisma.$queryRaw<PinnedEntryRow[]>`SELECT ${COLUMNS} ${FROM} WHERE ${whereClause(manifestId, filters)} ${ORDER} LIMIT ${take} OFFSET ${skip}`;
}

/** The pinned entries of a bounded set of Entities in one manifest (absent Entities are simply not returned). */
export async function selectPinnedEntriesForEntities(manifestId: string, entityIds: readonly string[]): Promise<PinnedEntryRow[]> {
  if (entityIds.length === 0) return [];
  return prisma.$queryRaw<PinnedEntryRow[]>`SELECT ${COLUMNS} ${FROM} WHERE me.manifest_id = ${manifestId}::uuid AND me.entity_id = ANY(${[...new Set(entityIds)]}::uuid[]) ${ORDER}`;
}

/**
 * "Referenced By" within ONE Release (bounded, no reverse-reference table): pinned revisions whose structured data
 * contains an exact Definition reference (an object carrying both `entityId` and `entityVersionId`) to `entityId`.
 */
export async function selectPinnedEntriesReferencing(manifestId: string, entityId: string, limit: number): Promise<PinnedEntryRow[]> {
  return prisma.$queryRaw<PinnedEntryRow[]>`SELECT ${COLUMNS} ${FROM}
    WHERE me.manifest_id = ${manifestId}::uuid AND me.entity_id <> ${entityId}::uuid
      AND jsonb_path_exists(v.structured_data, '$.** ? (@.entityId == $id && exists(@.entityVersionId))', jsonb_build_object('id', ${entityId}::text))
    ${ORDER} LIMIT ${limit}`;
}

/** "Related by Keyword" within ONE Release (bounded): other pinned revisions whose payload `keywords` share a key. */
export async function selectPinnedEntriesSharingKeywords(manifestId: string, entityId: string, keywordKeys: readonly string[], limit: number): Promise<PinnedEntryRow[]> {
  if (keywordKeys.length === 0) return [];
  return prisma.$queryRaw<PinnedEntryRow[]>`SELECT ${COLUMNS} ${FROM}
    WHERE me.manifest_id = ${manifestId}::uuid AND me.entity_id <> ${entityId}::uuid
      AND jsonb_typeof(${DEFINITION} -> 'payload' -> 'keywords') = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${DEFINITION} -> 'payload' -> 'keywords') kw WHERE kw = ANY(${[...new Set(keywordKeys)]}::text[]))
    ${ORDER} LIMIT ${limit}`;
}

export interface SourceDocumentRow {
  readonly id: string;
  readonly title: string;
  readonly sourceType: string;
  readonly versionLabel: string | null;
  readonly authorityStatus: string | null;
}

/** Source Documents by exact id (provenance display only). */
export async function selectSourceDocumentsByIds(ids: readonly string[]): Promise<SourceDocumentRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.sourceDocument.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, title: true, sourceType: true, versionLabel: true, authorityStatus: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, sourceType: String(r.sourceType), versionLabel: r.versionLabel, authorityStatus: r.authorityStatus === null ? null : String(r.authorityStatus) }));
}

/** The highest revision number an Entity has — an INDICATOR next to the pin only; it never selects content. */
export async function selectLatestRevisionNumber(entityId: string): Promise<number | null> {
  const row = await prisma.entityVersion.aggregate({ where: { entityId }, _max: { revisionNumber: true } });
  return row._max.revisionNumber ?? null;
}
