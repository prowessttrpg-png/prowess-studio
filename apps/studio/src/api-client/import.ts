import { apiGet, apiList, apiPost, query } from "./http";

/**
 * Typed functions for every M3 Import endpoint the Import Studio uses (PAS-10 M3-WO8 §62). One function per
 * endpoint, no logic beyond building the URL and body. All calls go to the approved /api/import surface (WO7); the
 * browser never talks to services or the database. Server-controlled fields are never sent.
 */
const enc = encodeURIComponent;

// ---- DTOs (the serialized WO7 responses) ---------------------------------------------------------------------------

export interface SourceSnapshotDto {
  id: string;
  sourceDocumentId: string;
  label: string;
  originalFilename: string;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  pageCount: number | null;
  declaredVersion: string | null;
  declaredDraftState: string | null;
  createdAt: string;
}
export interface SourceIngestionDto {
  id: string;
  sourceSnapshotId: string;
  parserName: string;
  parserVersion: string;
  structureHash: string;
  sectionCount: number;
  nodeCount: number;
  createdAt: string;
}
export interface SourceSectionDto {
  id: string;
  sourceSnapshotId: string;
  parentSectionId: string | null;
  title: string;
  headingLevel: number;
  ordinal: number;
  startPage: number | null;
  endPage: number | null;
  pageLocationBasis: string;
}
export interface SourceOutlineDto {
  snapshot: SourceSnapshotDto;
  ingestion: SourceIngestionDto | null;
  sections: SourceSectionDto[];
  assetCount: number;
  contentNodeCount: number;
}
export interface TableCellDto {
  index: number;
  columnIndex: number;
  rowSpan: number;
  colSpan: number;
  isHeader: boolean;
  rawText: string;
  nestedTables: TableStructureDto[];
}
export interface TableStructureDto {
  schemaVersion: number;
  rowCount: number;
  columnCount: number;
  rows: Array<{ index: number; isHeader: boolean; cells: TableCellDto[] }>;
}
export interface SourceBlockDto {
  id: string;
  sourceSectionId: string | null;
  blockType: string;
  ordinal: number;
  rawText: string;
  sourceStyle: string | null;
  listLevel: number | null;
  listOrdered: boolean | null;
}
export interface SourceTableDto {
  id: string;
  sourceSectionId: string | null;
  ordinal: number;
  caption: string | null;
  structure: TableStructureDto;
  rawText: string | null;
}
export interface SourceAssetDto {
  id: string;
  assetType: string;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  sourceFilename: string | null;
  caption: string | null;
  altTextFromSource: string | null;
}
export interface SourceContentNodeDto {
  id: string;
  sourceSnapshotId: string;
  sourceSectionId: string | null;
  ordinal: number;
  nodeType: "BLOCK" | "TABLE" | "ASSET_PLACEMENT";
  block?: SourceBlockDto;
  table?: SourceTableDto;
  placement?: { id: string; pageNumber: number | null; altTextFromSource: string | null };
  asset?: SourceAssetDto;
}

export type ReviewCounts<K extends string> = Record<K, number>;
export interface BatchSummaryDto {
  candidateCount: number;
  byConfidence: Record<string, number>;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
}
export interface ImportBatchDto {
  id: string;
  sourceSnapshotId: string;
  sourceStructureHash: string;
  label: string;
  description: string | null;
  scopeType: "SNAPSHOT" | "SECTION_SUBTREE";
  scopeSectionId: string | null;
  reviewRulesetId: string | null;
  comparisonManifestId: string | null;
  extractorKey: string;
  extractorVersion: string;
  extractorConfigHash: string | null;
  batchFingerprint: string;
  status: string;
  extractionOutputHash: string | null;
  extractedAt: string | null;
  createdAt: string;
  summary?: BatchSummaryDto;
}
export interface ExtractionResultDto {
  batch: ImportBatchDto;
  candidateCount: number;
  extractionOutputHash: string;
  summary: BatchSummaryDto;
  alreadyExtracted: boolean;
}
export interface ExtractionVerificationDto {
  importBatchId: string;
  storedOutputHash: string;
  persistedSetHash: string;
  recomputedOutputHash: string;
  persistedSetMatches: boolean;
  extractorOutputMatches: boolean;
}
export interface CandidateSourceDto {
  id: string;
  sourceSectionId: string | null;
  sourceContentNodeId: string | null;
  ordinal: number;
  excerpt: string | null;
}
export interface ExtractionCandidateDto {
  id: string;
  importBatchId: string;
  sourceSnapshotId: string;
  ordinal: number;
  candidateKind: string;
  proposedEntityType: string | null;
  proposedCanonicalKey: string | null;
  displayLabel: string;
  summary: string | null;
  confidence: string;
  status: string;
  payloadSchemaKey: string;
  payloadSchemaVersion: number;
  payload: Record<string, unknown>;
  candidateFingerprint: string;
  primarySourceSectionId: string | null;
  primarySourceContentNodeId: string | null;
  supportingSources: CandidateSourceDto[];
  createdAt: string;
}
export interface MatchRunDto {
  id: string;
  importBatchId: string;
  matcherKey: string;
  matcherVersion: string;
  matcherConfigHash: string;
  candidateSetHash: string;
  entityCatalogHash: string;
  comparisonManifestId: string | null;
  runFingerprint: string;
  resultHash: string;
  createdAt: string;
  assessmentCount?: number;
  byOutcome?: Record<string, number>;
  duplicateGroupCount?: number;
}
export interface MatchSuggestionDto {
  id: string;
  entityId: string;
  rank: number;
  score: number;
  basis: string;
  comparisonEntityVersionId: string | null;
}
export interface MatchAssessmentDto {
  id: string;
  matchRunId: string;
  extractionCandidateId: string;
  outcome: string;
  matchedEntityId: string | null;
  matchedBy: string;
  normalizedCandidateLabel: string | null;
  normalizedProposedCanonicalKey: string | null;
  comparisonEntityVersionId: string | null;
  suggestions: MatchSuggestionDto[];
}
export interface DuplicateGroupDto {
  id: string;
  matchRunId: string;
  basis: string;
  identityKey: string;
  identityKeyHash: string;
  memberCandidateIds: string[];
}
export interface ConflictSignalDto {
  duplicateGroupId: string;
  type: string;
  candidateIds: string[];
  payloadSchemaKey: string | null;
  payloadSchemaVersion: number | null;
  distinctPayloadCount: number;
}
export interface ImportDecisionDto {
  id: string;
  importBatchId: string;
  extractionCandidateId: string;
  sequenceNumber: number;
  decisionType: string;
  fromStatus: string;
  toStatus: string;
  matchBasis: string | null;
  candidateFingerprint: string;
  candidateSetHash: string;
  matchRunId: string | null;
  matchAssessmentId: string | null;
  duplicateGroupId: string | null;
  targetEntityId: string | null;
  comparisonEntityVersionId: string | null;
  rationale: string | null;
  decisionFingerprint: string;
  createdAt: string;
}
export interface ReviewSummaryDto {
  totalCandidates: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  decisionCount: number;
  potentialConflictCount: number | null;
}

/** Exactly the fields the decision command accepts (WO7). Server-controlled fields are not representable here. */
export interface DecisionRequest {
  candidateFingerprint: string;
  decisionType: string;
  matchBasis?: string;
  targetEntityId?: string;
  matchRunId?: string;
  matchAssessmentId?: string;
  duplicateGroupId?: string;
  comparisonEntityVersionId?: string;
  rationale?: string;
}
export interface CreateBatchRequest {
  sourceSnapshotId: string;
  label: string;
  description?: string;
  scope: { type: "SNAPSHOT" | "SECTION_SUBTREE"; sectionId?: string };
  reviewRulesetId?: string;
  comparisonManifestId?: string;
  extractorKey: string;
  extractorVersion: string;
}

type Page = { page?: number; pageSize?: number };

// ---- Sources (WO1) ---------------------------------------------------------------------------------------------------
export const listSourceSnapshots = (sourceDocumentId: string, p: Page = {}) => apiList<SourceSnapshotDto>(`/api/import/source-snapshots${query({ sourceDocumentId, ...p })}`);
export const getSourceSnapshot = (id: string) => apiGet<SourceSnapshotDto>(`/api/import/source-snapshots/${enc(id)}`);
export const getSourceOutline = (snapshotId: string) => apiGet<SourceOutlineDto>(`/api/import/source-snapshots/${enc(snapshotId)}/structure`);
export const getSourceSection = (id: string) => apiGet<SourceSectionDto>(`/api/import/source-sections/${enc(id)}`);
export const listSectionChildren = (id: string, p: Page = {}) => apiList<SourceSectionDto>(`/api/import/source-sections/${enc(id)}/children${query(p)}`);
export const listSectionContents = (id: string, p: Page = {}) => apiList<SourceContentNodeDto>(`/api/import/source-sections/${enc(id)}/contents${query(p)}`);
export const getSourceBlock = (id: string) => apiGet<SourceBlockDto>(`/api/import/source-blocks/${enc(id)}`);
export const getSourceTable = (id: string) => apiGet<SourceTableDto>(`/api/import/source-tables/${enc(id)}`);
export const getSourceAsset = (id: string) => apiGet<SourceAssetDto>(`/api/import/source-assets/${enc(id)}`);

// ---- Batches / extraction (WO2 / WO3) --------------------------------------------------------------------------------
export const listImportBatches = (f: { sourceSnapshotId?: string } & Page = {}) => apiList<ImportBatchDto>(`/api/import/batches${query(f)}`);
export const getImportBatch = (id: string) => apiGet<ImportBatchDto>(`/api/import/batches/${enc(id)}`);
export const createImportBatch = (body: CreateBatchRequest) => apiPost<{ batch: ImportBatchDto; created: boolean }>("/api/import/batches", body);
export const extractImportBatch = (id: string) => apiPost<ExtractionResultDto>(`/api/import/batches/${enc(id)}/extract`);
export const getExtractionResult = (id: string) => apiGet<ExtractionResultDto>(`/api/import/batches/${enc(id)}/extraction-result`);
export const verifyExtraction = (id: string) => apiGet<ExtractionVerificationDto>(`/api/import/batches/${enc(id)}/verify-extraction`);
export const listBatchCandidates = (id: string, p: Page = {}) => apiList<ExtractionCandidateDto>(`/api/import/batches/${enc(id)}/candidates${query(p)}`);
export const getCandidate = (id: string) => apiGet<ExtractionCandidateDto>(`/api/import/candidates/${enc(id)}`);

// ---- Matching / conflicts (WO4 / WO6) --------------------------------------------------------------------------------
export const analyzeMatches = (batchId: string) => apiPost<{ run: MatchRunDto; created: boolean }>(`/api/import/batches/${enc(batchId)}/match-runs`, {});
export const listMatchRuns = (batchId: string, p: Page = {}) => apiList<MatchRunDto>(`/api/import/batches/${enc(batchId)}/match-runs${query(p)}`);
export const getMatchRun = (id: string) => apiGet<MatchRunDto>(`/api/import/match-runs/${enc(id)}`);
export const getCandidateAssessment = (matchRunId: string, candidateId: string) =>
  apiGet<MatchAssessmentDto>(`/api/import/match-runs/${enc(matchRunId)}/candidates/${enc(candidateId)}/assessment`);
export const listDuplicateGroups = (matchRunId: string, p: Page = {}) => apiList<DuplicateGroupDto>(`/api/import/match-runs/${enc(matchRunId)}/duplicate-groups${query(p)}`);
export const listConflictSignals = (batchId: string, matchRunId: string, p: Page = {}) =>
  apiList<ConflictSignalDto>(`/api/import/batches/${enc(batchId)}/conflicts${query({ matchRunId, ...p })}`);

// ---- Review (WO6) ----------------------------------------------------------------------------------------------------
export const submitDecision = (candidateId: string, body: DecisionRequest) => apiPost<{ decision: ImportDecisionDto; created: boolean }>(`/api/import/candidates/${enc(candidateId)}/decisions`, body);
export const listCandidateDecisions = (candidateId: string, p: Page = {}) => apiList<ImportDecisionDto>(`/api/import/candidates/${enc(candidateId)}/decisions${query(p)}`);
export const listBatchDecisions = (batchId: string, p: Page = {}) => apiList<ImportDecisionDto>(`/api/import/batches/${enc(batchId)}/decisions${query(p)}`);
export const getImportDecision = (id: string) => apiGet<ImportDecisionDto>(`/api/import/decisions/${enc(id)}`);
export const getReviewSummary = (batchId: string, matchRunId?: string) => apiGet<ReviewSummaryDto>(`/api/import/batches/${enc(batchId)}/review-summary${query({ matchRunId })}`);
export const completeImportReview = (batchId: string) => apiPost<ImportBatchDto>(`/api/import/batches/${enc(batchId)}/complete-review`);
