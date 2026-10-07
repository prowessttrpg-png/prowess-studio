/**
 * Response shapes of the M2 HTTP API (PAS-10 M2-WO9) as the UI consumes them: plain JSON (ISO date strings,
 * UUID strings, exact enum strings). These mirror the server's domain DTOs; they add no meaning.
 */
export interface RulesetDto {
  id: string;
  canonicalKey: string;
  name: string;
  description: string | null;
  status: string;
  channel: string;
  versionLabel: string | null;
  parentRulesetId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ManifestEntryDto {
  id: string;
  manifestId: string;
  entityId: string;
  entityVersionId: string;
  createdAt: string;
}
export interface ManifestDto {
  id: string;
  rulesetId: string;
  manifestVersion: number;
  parentManifestId: string | null;
  createdAt: string;
  entries?: ManifestEntryDto[];
}
export interface ResolutionDto {
  entityId: string;
  entityVersionId: string;
  requestedManifestId: string;
  resolvedFromManifestId: string;
  resolutionDepth: number;
  source: "EXPLICIT" | "INHERITED";
}
export interface AuthorityRecordDto {
  id: string;
  canonPolicyId: string;
  sourceDocumentId: string;
  scopeKey: string;
  authorityStatus: string;
  rationale: string | null;
  createdAt: string;
}
export interface PolicyDto {
  id: string;
  rulesetId: string;
  policyVersion: number;
  name: string;
  description: string | null;
  createdAt: string;
  authorities?: AuthorityRecordDto[];
}
export interface AuthorityResolutionDto {
  policyId: string;
  sourceDocumentId: string;
  requestedScopeKey: string;
  resolvedScopeKey: string | null;
  authorityStatus: string;
  source: "EXACT" | "GLOBAL_FALLBACK" | "UNRESOLVED";
}
export interface CandidateDto {
  id: string;
  ruleConflictId: string;
  entityVersionId: string;
  sourceReferenceId: string | null;
  label: string | null;
  positionSummary: string | null;
  createdAt: string;
}
export interface ConflictDto {
  id: string;
  rulesetId: string;
  entityId: string;
  conflictType: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  createdAt: string;
  candidates?: CandidateDto[];
}
export interface SelectionDto {
  id: string;
  canonDecisionId: string;
  ruleConflictCandidateId: string;
  createdAt: string;
}
export interface DecisionDto {
  id: string;
  rulesetId: string;
  ruleConflictId: string;
  canonPolicyId: string;
  decisionType: string;
  conflictDisposition: string;
  resultEntityVersionId: string | null;
  rationale: string;
  createdAt: string;
  selections?: SelectionDto[];
}
export interface OperationDto {
  id: string;
  changeSetId: string;
  sequence: number;
  operationType: string;
  targetEntityId: string | null;
  fromEntityVersionId: string | null;
  toEntityVersionId: string | null;
  targetManifestId: string | null;
  description: string | null;
  createdAt: string;
}
export interface ChangeSetDto {
  id: string;
  rulesetId: string;
  canonDecisionId: string | null;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  operations?: OperationDto[];
}
export interface ImpactReasonDto {
  sourceOperationId: string | null;
  sequence: number | null;
  reason: string;
  relationshipType: string | null;
}
export interface ImpactItemDto {
  category: string;
  resourceType: string;
  resourceId: string;
  reasons: ImpactReasonDto[];
}
export interface ImpactReportDto {
  changeSetId: string;
  rulesetId: string;
  derivation: "LIVE";
  items: ImpactItemDto[];
}
export interface PinDto {
  entityId: string;
  entityVersionId: string;
}
export interface ReleaseDto {
  id: string;
  rulesetId: string;
  releaseNumber: number;
  versionLabel: string;
  channel: string;
  manifestId: string;
  canonPolicyId: string;
  changeSetId: string | null;
  manifestHash: string;
  releaseNotes: string | null;
  publishedAt: string;
  composition?: PinDto[];
}
export interface HashVerificationDto {
  releaseId: string;
  valid: boolean;
  storedHash: string;
  computedHash: string;
}
export interface ReleaseDiffDto {
  releaseAId: string;
  releaseBId: string;
  entries: Array<{ type: "ADDED_ENTITY" | "REMOVED_ENTITY" | "CHANGED_VERSION"; entityId: string; fromEntityVersionId: string | null; toEntityVersionId: string | null }>;
  unchangedCount: number;
}
/** M1 Entity API shapes used by the pickers. */
export interface EntityDto {
  id: string;
  entityType: string;
  canonicalKey: string;
}
export interface EntityVersionDto {
  id: string;
  entityId: string;
  revisionNumber: number;
  status: string;
  displayName: string;
}
export interface SourceDocumentDto {
  id: string;
  title: string;
  sourceType: string;
}
export interface SourceReferenceDto {
  id: string;
  entityVersionId: string;
  sourceDocumentId: string;
  sectionLabel?: string | null;
}
