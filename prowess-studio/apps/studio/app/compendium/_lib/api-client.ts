/**
 * Compendium API client (PAS-10 M1-WO9 §1, §35) — the ONLY way Compendium
 * UI code talks to data. Every function here calls `fetch` against the
 * M1-WO8 HTTP API; nothing in this file (or anywhere under
 * `apps/studio/app/compendium/`) imports `@prowess/db`, Prisma, or any
 * database repository. This is what keeps the architectural boundary in
 * `docs/architecture/api-layer.md` real rather than aspirational —
 * enforced further by `scripts/check-architecture.mjs`'s dedicated
 * Compendium rule.
 *
 * Deliberately thin: this layer does not re-validate or re-interpret
 * anything the server already decided (PAS-10 M1-WO9 §35: "Do not
 * duplicate the server's domain validation"). It only: builds query
 * strings, calls `fetch`, and translates the API's `{ data }` / `{ data,
 * pagination }` / `{ code, message, field, details }` shapes (M1-WO8) into
 * typed values or a thrown `CompendiumApiError` — never leaking a raw
 * `Response`, a parsing exception, or server-side detail into whatever
 * calls it.
 */

/** Mirrors the API's stable error shape (M1-WO8 §4) exactly. */
export interface ApiErrorBody {
  code: string;
  message: string;
  field: string | null;
  details: unknown;
}

/**
 * Thrown for any non-2xx API response. Carries the server's own `code`/
 * `field` so UI can react to specific cases (e.g. show "no results" vs. a
 * generic error) without re-deriving anything the server didn't already
 * say explicitly.
 */
export class CompendiumApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | null;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "CompendiumApiError";
    this.code = body.code;
    this.status = status;
    this.field = body.field;
  }
}

async function apiGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    // A network-level failure (server unreachable, offline, ...) — not an
    // API error body at all. Surfaced as a CompendiumApiError too, so
    // every caller has exactly one error type to handle.
    throw new CompendiumApiError(
      { code: "NETWORK_ERROR", message: "Could not reach the server.", field: null, details: null },
      0,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CompendiumApiError(
      { code: "NETWORK_ERROR", message: "The server returned an unreadable response.", field: null, details: null },
      response.status,
    );
  }

  if (!response.ok) {
    throw new CompendiumApiError(body as ApiErrorBody, response.status);
  }
  return (body as { data: T }).data;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const asString = query.toString();
  return asString.length > 0 ? `?${asString}` : "";
}

// --- Entity -----------------------------------------------------------

export interface EntityDto {
  id: string;
  entityType: string;
  canonicalKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityVersionDto {
  id: string;
  entityId: string;
  revisionNumber: number;
  status: string;
  displayName: string;
  shortDescription: string | null;
  rulesText: string | null;
  structuredData: unknown;
  parentVersionId: string | null;
  changeType: string | null;
  changeSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A trimmed-down EntityVersion shape — exactly what the list endpoint returns per item. */
export interface LatestRevisionSummaryDto {
  id: string;
  revisionNumber: number;
  status: string;
  displayName: string;
}

export interface EntityListItemDto {
  entity: EntityDto;
  latestRevision: LatestRevisionSummaryDto | null;
}

export interface ListEntitiesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  entityType?: string;
  status?: string;
  canonicalKey?: string;
  keyword?: string;
}

export interface ListEntitiesResult {
  items: EntityListItemDto[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listEntities(params: ListEntitiesParams): Promise<ListEntitiesResult> {
  const query = buildQuery({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    entityType: params.entityType,
    status: params.status,
    canonicalKey: params.canonicalKey,
    keyword: params.keyword,
  });

  let response: Response;
  try {
    response = await fetch(`/api/entities${query}`);
  } catch {
    throw new CompendiumApiError(
      { code: "NETWORK_ERROR", message: "Could not reach the server.", field: null, details: null },
      0,
    );
  }
  const body = await response.json();
  if (!response.ok) {
    throw new CompendiumApiError(body as ApiErrorBody, response.status);
  }
  return { items: body.data, ...body.pagination };
}

export function getEntity(entityId: string): Promise<EntityDto> {
  return apiGet(`/api/entities/${entityId}`);
}

export function listEntityVersions(entityId: string): Promise<EntityVersionDto[]> {
  return apiGet(`/api/entities/${entityId}/versions`);
}

// --- Aliases ------------------------------------------------------------

export interface EntityAliasDto {
  id: string;
  entityId: string;
  alias: string;
  normalizedAlias: string;
  context: string | null;
  createdAt: string;
}

export function listEntityAliases(entityId: string): Promise<EntityAliasDto[]> {
  return apiGet(`/api/entities/${entityId}/aliases`);
}

// --- Keywords -------------------------------------------------------------

export interface KeywordDefinitionDto {
  id: string;
  canonicalKey: string;
  name: string;
  categoryId: string | null;
  description: string | null;
  deprecated: boolean;
  createdAt: string;
}

export interface KeywordAssignmentDto {
  keyword: KeywordDefinitionDto;
  sourceType: string;
  createdAt: string;
}

export function listEntityKeywords(entityId: string): Promise<KeywordAssignmentDto[]> {
  return apiGet(`/api/entities/${entityId}/keywords`);
}

export function listEntityVersionKeywords(versionId: string): Promise<KeywordAssignmentDto[]> {
  return apiGet(`/api/entity-versions/${versionId}/keywords`);
}

// --- Relationships -------------------------------------------------------

export interface EntityRelationshipDto {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RelationshipWithCounterpartDto {
  relationship: EntityRelationshipDto;
  counterpart: EntityDto;
}

export interface EntityRelationshipsResult {
  outgoing: RelationshipWithCounterpartDto[];
  incoming: RelationshipWithCounterpartDto[];
}

export function getEntityRelationships(entityId: string): Promise<EntityRelationshipsResult> {
  return apiGet(`/api/entities/${entityId}/relationships`);
}

// --- Source provenance -----------------------------------------------------

export interface SourceReferenceDto {
  id: string;
  sourceDocumentId: string;
  entityVersionId: string;
  sectionLabel: string | null;
  pageReference: string | null;
  sourceExcerptNote: string | null;
  createdAt: string;
}

export interface SourceDocumentDto {
  id: string;
  title: string;
  sourceType: string;
  versionLabel: string | null;
  authorityStatus: string | null;
  fileReference: string | null;
  notes: string | null;
  createdAt: string;
}

export function listEntityVersionSources(versionId: string): Promise<SourceReferenceDto[]> {
  return apiGet(`/api/entity-versions/${versionId}/sources`);
}

export function getSourceDocument(sourceDocumentId: string): Promise<SourceDocumentDto> {
  return apiGet(`/api/source-documents/${sourceDocumentId}`);
}

/**
 * Resolves the `SourceDocument` for each of `sourceReferences`, deduplicated
 * by `sourceDocumentId` and fetched in parallel (PAS-10 M1-WO9 §27): a
 * Version realistically cites a small number of distinct Documents, so
 * this is a bounded handful of parallel requests, not an unbounded N+1 —
 * a backend response-shape change was deliberately not made for this
 * (see `docs/architecture/compendium-ui.md`'s "Detail data loading"
 * section for the full reasoning this Work Order documents).
 *
 * An optional `cache` (document id -> in-flight/settled request) lets the
 * caller share lookups ACROSS calls — M1-WO10 uses it so two revisions
 * citing the same document cost one document request, not two.
 */
export async function resolveSourceDocuments(
  sourceReferences: SourceReferenceDto[],
  cache?: Map<string, Promise<SourceDocumentDto>>,
): Promise<Map<string, SourceDocumentDto>> {
  const uniqueIds = [...new Set(sourceReferences.map((ref) => ref.sourceDocumentId))];
  const documents = await Promise.all(
    uniqueIds.map((id) => {
      const cached = cache?.get(id);
      if (cached) {
        return cached;
      }
      const pending = getSourceDocument(id);
      if (cache) {
        cache.set(id, pending);
        // A failed lookup must not poison the cache for a later retry.
        pending.catch(() => cache.delete(id));
      }
      return pending;
    }),
  );
  return new Map(documents.map((doc) => [doc.id, doc]));
}
