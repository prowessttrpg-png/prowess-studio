/**
 * Compendium Admin API client (PAS-10 M6-WO1 §37–39) — the ONLY way authoring UI code talks to data. Every call goes
 * through the shared Studio transport (`src/api-client/http.ts`) to the Studio HTTP API: the new
 * `/api/compendium-authoring/*` routes and the existing M1 mutation routes (aliases, Keywords, relationships, sources,
 * lifecycle). Nothing under `app/compendium/` imports `@prowess/db`, Prisma or a repository (scripts/check-architecture.mjs).
 *
 * Deliberately thin: it never re-validates a Definition — the server's M5 validation boundary decides (§14). It only
 * builds URLs, sends JSON, and turns the API's `{ data }` / `{ code, message, field }` envelopes into typed values or a
 * thrown `AuthoringApiError` carrying the server's own code (never a raw Response, stack or parse exception).
 */
import { fetchJsonBody, query } from "../../../../src/api-client/http";
import type { EntityDto, EntityVersionDto, KeywordDefinitionDto, SourceDocumentDto, SourceReferenceDto } from "../../_lib/api-client";

export class AuthoringApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | null;
  constructor(code: string, message: string, status: number, field: string | null = null) {
    super(message);
    this.name = "AuthoringApiError";
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<{ data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const sent = await fetchJsonBody(
    path,
    method === "GET" ? undefined : { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
  );
  if (sent.kind === "NETWORK_FAILURE") throw new AuthoringApiError("NETWORK_ERROR", "Could not reach the server.", 0);
  if (sent.kind === "UNREADABLE_BODY") {
    // DELETE routes answer 204 with no body: that is success, not an unreadable response.
    if (sent.response.ok && sent.response.status === 204) return { data: undefined as T };
    throw new AuthoringApiError("INVALID_RESPONSE", "The server returned an unreadable response.", sent.response.status);
  }
  const json = sent.body as Record<string, unknown> | null;
  if (!sent.response.ok) {
    const code = json !== null && typeof json.code === "string" ? json.code : "UNKNOWN_ERROR";
    const message = json !== null && typeof json.message === "string" ? json.message : "The request failed.";
    throw new AuthoringApiError(code, message, sent.response.status, json !== null && typeof json.field === "string" ? json.field : null);
  }
  return json as { data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } };
}
const get = async <T>(path: string) => (await request<T>("GET", path)).data;
const post = async <T>(path: string, body?: unknown) => (await request<T>("POST", path, body)).data;
const put = async <T>(path: string, body: unknown) => (await request<T>("PUT", path, body)).data;
const del = async (path: string) => {
  await request<unknown>("DELETE", path);
};
const enc = encodeURIComponent;

// --- Catalog and validation (M6-WO1 authoring API) ------------------------------------------------------------------

export interface AuthoringKindDto {
  definitionKind: string;
  systemFamily: string;
  branch: string | null;
  sharedContract: string | null;
  allowedEntityTypes: string[];
  supportedSchemaVersions: number[];
  authoringSchemaVersion: number | null;
  authorable: boolean;
}

export interface AuthoringCatalogDto {
  kinds: AuthoringKindDto[];
  systemFamilies: string[];
  vocabularies: Record<string, string[]>;
  legacyTerms: Array<{ legacyTerm: string; canonicalTerm: string }>;
}

export interface ValidationIssueDto {
  code: string;
  severity: "ERROR" | "WARNING";
  path: string;
  message: string;
  definitionKind: string | null;
  component: string | null;
  source: "M5_CONTRACT" | "REFERENCE";
}

export interface ValidationResultDto {
  status: "PASS" | "FAIL";
  definitionKind: string | null;
  issues: ValidationIssueDto[];
  normalized: { schemaVersion: number; systemFamily: string; definitionKind: string; payload: Record<string, unknown>; legacyTerms: Array<{ legacyTerm: string; canonicalTerm: string }> } | null;
  refused: boolean;
}

export const getCatalog = () => get<AuthoringCatalogDto>("/api/compendium-authoring/catalog");
export const validateCandidate = (definitionKind: string, prowessDefinition: unknown) =>
  post<ValidationResultDto>("/api/compendium-authoring/validate", { definitionKind, prowessDefinition });
export const validateStoredRevision = (versionId: string) => get<ValidationResultDto>(`/api/compendium-authoring/entity-versions/${enc(versionId)}/validation`);

// --- Definitions ------------------------------------------------------------------------------------------------------

export interface AuthoringListItemDto {
  entity: EntityDto;
  latestRevision: { id: string; revisionNumber: number; status: string; displayName: string; updatedAt: string } | null;
  definitionKind: string | null;
  structuralValidation: "PASS" | "FAIL" | "NOT_A_DEFINITION" | null;
}

export async function listDefinitions(params: { page?: number; pageSize?: number; search?: string; status?: string; entityType?: string }) {
  const r = await request<AuthoringListItemDto[]>("GET", `/api/compendium-authoring/definitions${query(params)}`);
  return { items: r.data, pagination: r.pagination ?? { page: 1, pageSize: r.data.length, total: r.data.length, totalPages: 1 } };
}

export interface CreateDefinitionBody {
  definitionKind: string;
  entityType?: string | null;
  canonicalKey: string;
  displayName: string;
  shortDescription?: string | null;
  rulesText?: string | null;
  changeSummary?: string | null;
  prowessDefinition: unknown;
  entityKeywordIds?: string[];
  versionKeywordIds?: string[];
  sources?: Array<{ sourceDocumentId: string; sectionLabel?: string | null; pageReference?: string | null; sourceExcerptNote?: string | null }>;
}

export const createDefinition = (body: CreateDefinitionBody) =>
  post<{ entity: EntityDto; version: EntityVersionDto; validation: ValidationResultDto }>("/api/compendium-authoring/definitions", body);

export interface SaveDraftBody {
  expectedUpdatedAt: string;
  displayName?: string;
  shortDescription?: string | null;
  rulesText?: string | null;
  changeType?: string | null;
  changeSummary?: string | null;
  prowessDefinition?: unknown;
}

export const saveDraft = (versionId: string, body: SaveDraftBody) =>
  put<{ version: EntityVersionDto; validation: ValidationResultDto | null }>(`/api/compendium-authoring/entity-versions/${enc(versionId)}`, body);
export const createRevision = (entityId: string, body: { baseVersionId: string; changeType?: string | null; changeSummary?: string | null }) =>
  post<EntityVersionDto>(`/api/compendium-authoring/entities/${enc(entityId)}/revisions`, body);
export const submitForReview = (versionId: string) => post<EntityVersionDto>(`/api/compendium-authoring/entity-versions/${enc(versionId)}/submit-review`);
export const proposeChangeSet = (versionId: string, body: { rulesetId: string; targetManifestId?: string | null; name: string; description?: string | null }) =>
  post<{ id: string; rulesetId: string; status: string; name: string }>(`/api/compendium-authoring/entity-versions/${enc(versionId)}/change-set-proposals`, body);

/** IN_REVIEW → DRAFT through the existing M1 lifecycle route (reopening is not validation-gated). */
export const returnToDraft = (versionId: string) => post<EntityVersionDto>(`/api/entity-versions/${enc(versionId)}/status`, { status: "DRAFT" });

// --- Pickers (bounded searches) -----------------------------------------------------------------------------------------

export interface DefinitionReferenceDto {
  ref: { entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string; systemFamily: string };
  displayName: string;
  revisionNumber: number;
  status: string;
}
export interface KeywordRowDto {
  id: string;
  canonicalKey: string;
  name: string;
  deprecated: boolean;
}

export const searchDefinitionReferences = (search: string, definitionKind?: string) =>
  get<DefinitionReferenceDto[]>(`/api/compendium-authoring/definition-references${query({ search, definitionKind })}`);
export const searchKeywords = (search: string) => get<KeywordRowDto[]>(`/api/compendium-authoring/keywords${query({ search })}`);
/** Entity search for relationship targets — the existing paginated M1 list, bounded to 20 results. */
export const searchEntities = async (search: string) =>
  (await request<Array<{ entity: EntityDto; latestRevision: { displayName: string } | null }>>("GET", `/api/entities${query({ search, pageSize: 20 })}`)).data;

// --- Existing M1 metadata mutations (aliases, Keywords, relationships, provenance) --------------------------------------

export const getEntity = (entityId: string) => get<EntityDto>(`/api/entities/${enc(entityId)}`);
export const listVersions = (entityId: string) => get<EntityVersionDto[]>(`/api/entities/${enc(entityId)}/versions`);
export const getVersion = (versionId: string) => get<EntityVersionDto>(`/api/entity-versions/${enc(versionId)}`);

export const listAliases = (entityId: string) => get<Array<{ id: string; alias: string; context: string | null }>>(`/api/entities/${enc(entityId)}/aliases`);
export const createAlias = (entityId: string, alias: string, context: string | null) => post<unknown>(`/api/entities/${enc(entityId)}/aliases`, { alias, context });
export const removeAlias = (aliasId: string) => del(`/api/entity-aliases/${enc(aliasId)}`);

export interface KeywordAssignmentDto {
  keyword: KeywordDefinitionDto;
  sourceType: string;
}
export const listEntityKeywords = (entityId: string) => get<KeywordAssignmentDto[]>(`/api/entities/${enc(entityId)}/keywords`);
export const assignEntityKeyword = (entityId: string, keywordId: string) => post<unknown>(`/api/entities/${enc(entityId)}/keywords`, { keywordId });
export const removeEntityKeyword = (entityId: string, keywordId: string) => del(`/api/entities/${enc(entityId)}/keywords/${enc(keywordId)}`);
export const listVersionKeywords = (versionId: string) => get<KeywordAssignmentDto[]>(`/api/entity-versions/${enc(versionId)}/keywords`);
export const assignVersionKeyword = (versionId: string, keywordId: string) => post<unknown>(`/api/entity-versions/${enc(versionId)}/keywords`, { keywordId });
export const removeVersionKeyword = (versionId: string, keywordId: string) => del(`/api/entity-versions/${enc(versionId)}/keywords/${enc(keywordId)}`);

export interface RelationshipRowDto {
  relationship: { id: string; sourceEntityId: string; targetEntityId: string; relationshipType: string; metadata: Record<string, unknown> };
  counterpart: EntityDto;
}
export const listRelationships = (entityId: string) => get<{ outgoing: RelationshipRowDto[]; incoming: RelationshipRowDto[] }>(`/api/entities/${enc(entityId)}/relationships`);
export const createRelationship = (body: { sourceEntityId: string; targetEntityId: string; relationshipType: string; metadata: Record<string, unknown> }) => post<unknown>("/api/relationships", body);
export const removeRelationship = (relationshipId: string) => del(`/api/relationships/${enc(relationshipId)}`);

export const listSourceDocuments = () => get<SourceDocumentDto[]>("/api/source-documents");
export const listVersionSources = (versionId: string) => get<SourceReferenceDto[]>(`/api/entity-versions/${enc(versionId)}/sources`);
export const attachSource = (versionId: string, body: { sourceDocumentId: string; sectionLabel?: string | null; pageReference?: string | null; sourceExcerptNote?: string | null }) =>
  post<SourceReferenceDto>(`/api/entity-versions/${enc(versionId)}/sources`, body);
export const removeSource = (sourceReferenceId: string) => del(`/api/source-references/${enc(sourceReferenceId)}`);

// --- M2 (Canon Manager) lookups for the explicit hand-off context --------------------------------------------------------

export type { RulesetDto as RulesetOptionDto } from "../../../../src/api-client/types";
/** Every Ruleset, page by page — the same paginated lookup the top-bar selector uses (§35). */
export { listAllRulesets } from "../../../../src/api-client/governance";
/** A Ruleset's Manifests (one bounded page), for an EXPLICIT optional target choice — never an automatic "latest". */
export { listManifests } from "../../../../src/api-client/governance";
