import { prisma } from "../client.js";

/**
 * Bounded, read-only lookups for Compendium authoring (PAS-10 M6-WO1 §49–50). Every query is keyed by an explicit,
 * caller-bounded id / key list or carries an explicit `take`: nothing here loads the whole Compendium, and nothing
 * selects a "latest", "current" or "active" revision — the one latestRevision convenience stays in entity-query.
 */

export interface KeywordRow {
  readonly id: string;
  readonly canonicalKey: string;
  readonly name: string;
  readonly deprecated: boolean;
}

/** Keyword Definitions by exact canonical key (the structured vocabulary a payload's `keywords` cite). */
export async function selectKeywordsByCanonicalKeys(keys: readonly string[]): Promise<KeywordRow[]> {
  if (keys.length === 0) return [];
  return prisma.keywordDefinition.findMany({
    where: { canonicalKey: { in: [...new Set(keys)] } },
    select: { id: true, canonicalKey: true, name: true, deprecated: true },
    orderBy: { canonicalKey: "asc" },
  });
}

/** Keyword Definitions by exact id (for validating assignment requests before any write). */
export async function selectKeywordsByIds(ids: readonly string[]): Promise<KeywordRow[]> {
  if (ids.length === 0) return [];
  return prisma.keywordDefinition.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, canonicalKey: true, name: true, deprecated: true },
    orderBy: { canonicalKey: "asc" },
  });
}

/** Bounded Keyword search by canonical key or name (case-insensitive contains). */
export async function searchKeywordRows(term: string, limit: number): Promise<KeywordRow[]> {
  const t = term.trim();
  return prisma.keywordDefinition.findMany({
    where: t === "" ? {} : { OR: [{ canonicalKey: { contains: t, mode: "insensitive" } }, { name: { contains: t, mode: "insensitive" } }] },
    select: { id: true, canonicalKey: true, name: true, deprecated: true },
    orderBy: { canonicalKey: "asc" },
    take: limit,
  });
}

export interface VersionIdentityRow {
  readonly id: string;
  readonly entityId: string;
  readonly revisionNumber: number;
  readonly status: string;
  readonly displayName: string;
  readonly structuredData: unknown;
  readonly entity: { readonly id: string; readonly canonicalKey: string; readonly entityType: string };
}

const VERSION_IDENTITY_SELECT = {
  id: true,
  entityId: true,
  revisionNumber: true,
  status: true,
  displayName: true,
  structuredData: true,
  entity: { select: { id: true, canonicalKey: true, entityType: true } },
} as const;

/** Exact EntityVersions (with their Entity's identity) by exact id — for exact Definition reference checks. */
export async function selectVersionIdentitiesByIds(ids: readonly string[]): Promise<VersionIdentityRow[]> {
  if (ids.length === 0) return [];
  return prisma.entityVersion.findMany({ where: { id: { in: [...new Set(ids)] } }, select: VERSION_IDENTITY_SELECT, orderBy: { id: "asc" } });
}

/** Every EntityVersion of a bounded set of Entities (reference-picker candidates), in revision order. */
export async function selectVersionIdentitiesByEntityIds(entityIds: readonly string[]): Promise<VersionIdentityRow[]> {
  if (entityIds.length === 0) return [];
  return prisma.entityVersion.findMany({
    where: { entityId: { in: [...new Set(entityIds)] } },
    select: VERSION_IDENTITY_SELECT,
    orderBy: [{ entityId: "asc" }, { revisionNumber: "asc" }],
  });
}

/** Source Documents by exact id (for validating provenance requests before any write). */
export async function selectSourceDocumentIds(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.sourceDocument.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true } });
  return rows.map((r) => r.id);
}
