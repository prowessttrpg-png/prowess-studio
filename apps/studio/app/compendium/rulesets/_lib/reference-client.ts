/**
 * Rules Reference API client (PAS-10 M6-WO2) — the ONLY way Rules Reference UI code talks to data. It issues GET
 * requests only, through the shared Studio transport (`src/api-client/http.ts`), to the read-only
 * `/api/compendium-reference/*` routes. Nothing under `app/compendium/` imports `@prowess/db`, Prisma or a repository.
 *
 * Every URL carries the exact Ruleset and Release ids: Release context is never implied, remembered or defaulted here.
 * Deliberately thin — it never re-interprets what the server decided (membership, kind, verification).
 */
import { fetchJsonBody, query } from "../../../../src/api-client/http";
import type { EntityVersionDto, KeywordDefinitionDto, SourceReferenceDto } from "../../_lib/api-client";

export class ReferenceApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ReferenceApiError";
    this.code = code;
    this.status = status;
  }
}

export interface Paged<T> {
  data: T;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

async function get<T>(path: string): Promise<{ data: T; pagination?: Paged<T>["pagination"] }> {
  const sent = await fetchJsonBody(path);
  if (sent.kind === "NETWORK_FAILURE") throw new ReferenceApiError("NETWORK_ERROR", "Could not reach the server.", 0);
  if (sent.kind === "UNREADABLE_BODY") throw new ReferenceApiError("INVALID_RESPONSE", "The server returned an unreadable response.", sent.response.status);
  const json = sent.body as Record<string, unknown> | null;
  if (!sent.response.ok) {
    const code = json !== null && typeof json.code === "string" ? json.code : "UNKNOWN_ERROR";
    const message = json !== null && typeof json.message === "string" ? json.message : "The request failed.";
    throw new ReferenceApiError(code, message, sent.response.status);
  }
  return json as { data: T; pagination?: Paged<T>["pagination"] };
}

const enc = encodeURIComponent;
const base = (rulesetId: string) => `/api/compendium-reference/rulesets/${enc(rulesetId)}`;
const releaseBase = (rulesetId: string, releaseId: string) => `${base(rulesetId)}/releases/${enc(releaseId)}`;

// --- DTOs (the JSON the read-only routes return) --------------------------------------------------------------------

export interface RulesetSummaryDto {
  id: string;
  canonicalKey: string;
  name: string;
}

export interface ReleaseSummaryDto {
  id: string;
  rulesetId: string;
  releaseNumber: number;
  versionLabel: string;
  channel: string;
  publishedAt: string;
}

export interface ReleaseDetailDto extends ReleaseSummaryDto {
  ruleset: RulesetSummaryDto;
  releaseNotes: string | null;
  manifestId: string;
  manifestHash: string;
  compositionSize: number;
  verification: { valid: boolean; storedHash: string; computedHash: string };
}

export interface KindInfoDto {
  definitionKind: string;
  systemFamily: string;
  branch: string | null;
  sharedContract: string | null;
  supportedSchemaVersions: number[];
}

export interface EntryCardDto {
  entityId: string;
  entityVersionId: string;
  canonicalKey: string;
  entityType: string;
  displayName: string;
  shortDescription: string | null;
  revisionNumber: number;
  status: string;
  definitionKind: string | null;
  kind: KindInfoDto | null;
  schemaVersion: number | null;
  keywords: string[];
}

export interface ExactRefDto {
  entityId: string;
  entityVersionId: string;
  canonicalKey: string;
  definitionKind: string;
  systemFamily: string;
}

export interface DefinitionReferenceDto {
  path: string;
  authored: ExactRefDto;
  authoredRevisionNumber: number | null;
  authoredDisplayName: string | null;
  inRelease: boolean;
  pinned: { entityVersionId: string; revisionNumber: number; displayName: string } | null;
  matchesPin: boolean;
}

export interface DeclaredDefinitionDto {
  schemaVersion: number | null;
  systemFamily: string | null;
  definitionKind: string | null;
  payload: Record<string, unknown> | null;
  legacyTerms: unknown;
}

export interface ReferenceRelationshipDto {
  relationship: { id: string; sourceEntityId: string; targetEntityId: string; relationshipType: string; metadata: unknown };
  direction: "OUTGOING" | "INCOMING";
  counterpart: { id: string; canonicalKey: string; entityType: string };
  counterpartPin: { entityVersionId: string; revisionNumber: number; displayName: string } | null;
}

export interface EntryDetailDto {
  release: ReleaseSummaryDto;
  ruleset: RulesetSummaryDto;
  entity: { id: string; canonicalKey: string; entityType: string };
  pinnedRevision: EntityVersionDto;
  latestRevisionNumber: number | null;
  definition: DeclaredDefinitionDto | null;
  kind: KindInfoDto | null;
  schemaVersionSupported: boolean;
  keywords: {
    structured: Array<{ canonicalKey: string; keyword: { id: string; canonicalKey: string; name: string; deprecated: boolean } | null }>;
    assigned: Array<{ keyword: KeywordDefinitionDto; sourceType: string }>;
  };
  references: DefinitionReferenceDto[];
  referencesTruncated: boolean;
  referencedBy: EntryCardDto[];
  referencedByTruncated: boolean;
  relationships: ReferenceRelationshipDto[];
  relatedByKeyword: EntryCardDto[];
  sources: Array<{
    reference: SourceReferenceDto;
    document: { id: string; title: string; sourceType: string; versionLabel: string | null; authorityStatus: string | null } | null;
  }>;
}

export interface ComparisonDto {
  releaseA: ReleaseSummaryDto;
  releaseB: ReleaseSummaryDto;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  entries: Array<{
    type: "ADDED_ENTITY" | "REMOVED_ENTITY" | "CHANGED_VERSION";
    entityId: string;
    canonicalKey: string | null;
    from: { entityVersionId: string; revisionNumber: number | null; displayName: string | null } | null;
    to: { entityVersionId: string; revisionNumber: number | null; displayName: string | null } | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

export interface EntryFilters {
  search?: string;
  kind?: string;
  family?: string;
  branch?: string;
  entityType?: string;
  keywordId?: string;
}

// --- calls (GET only) ------------------------------------------------------------------------------------------------

export const listReleases = async (rulesetId: string) => (await get<{ ruleset: RulesetSummaryDto; releases: ReleaseSummaryDto[] }>(`${base(rulesetId)}/releases`)).data;

/** Explicit user action only ("View Latest Release"): asks the server which exact Release is the highest-numbered. */
export const resolveLatestRelease = async (rulesetId: string) => (await get<{ ruleset: RulesetSummaryDto; release: ReleaseSummaryDto | null }>(`${base(rulesetId)}/latest-release`)).data;

export const getRelease = async (rulesetId: string, releaseId: string) => (await get<ReleaseDetailDto>(releaseBase(rulesetId, releaseId))).data;

export async function listEntries(rulesetId: string, releaseId: string, filters: EntryFilters & { page: number; pageSize: number }): Promise<Paged<EntryCardDto[]>> {
  const r = await get<EntryCardDto[]>(`${releaseBase(rulesetId, releaseId)}/entities${query({ ...filters })}`);
  return { data: r.data, pagination: r.pagination ?? { page: filters.page, pageSize: filters.pageSize, total: r.data.length, totalPages: 1 } };
}

export const getEntry = async (rulesetId: string, releaseId: string, entityId: string) => (await get<EntryDetailDto>(`${releaseBase(rulesetId, releaseId)}/entities/${enc(entityId)}`)).data;

export const compareReleases = async (rulesetId: string, releaseId: string, otherReleaseId: string, q: { page: number; pageSize: number; type?: string }) =>
  (await get<ComparisonDto>(`${releaseBase(rulesetId, releaseId)}/compare/${enc(otherReleaseId)}${query({ ...q })}`)).data;

// --- shared read-only catalog and Keyword vocabulary (the M6-WO1 endpoints; one M5-derived catalog, never a copy) ----

export interface CatalogKindDto {
  definitionKind: string;
  systemFamily: string;
  branch: string | null;
  sharedContract: string | null;
  supportedSchemaVersions: number[];
}

export interface CatalogDto {
  kinds: CatalogKindDto[];
  systemFamilies: string[];
  vocabularies: Record<string, string[]>;
}

export const getCatalog = async () => (await get<CatalogDto>("/api/compendium-authoring/catalog")).data;

export const searchKeywords = async (search: string) =>
  (await get<Array<{ id: string; canonicalKey: string; name: string; deprecated: boolean }>>(`/api/compendium-authoring/keywords${query({ search })}`)).data;
