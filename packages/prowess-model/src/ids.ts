/**
 * Branded identifier types shared across the Prowess Platform.
 *
 * These are structural placeholders for M0. They establish the identifier
 * *shapes* that persistence, API, and UI layers agree on, without implying
 * any particular database schema — that is defined starting in M1
 * (Entity & Version Core).
 *
 * Branding prevents accidentally passing an EntityId where an
 * EntityVersionId is expected, even though both are UUID strings at runtime.
 */

declare const brand: unique symbol;

/** A nominal ("branded") string type. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** UUID identifying a stable Entity identity (see M1-WO1). */
export type EntityId = Brand<string, "EntityId">;

/** UUID identifying a specific historical EntityVersion (see M1-WO2). */
export type EntityVersionId = Brand<string, "EntityVersionId">;

/** UUID identifying an EntityAlias (see M1-WO4). */
export type EntityAliasId = Brand<string, "EntityAliasId">;

/** UUID identifying a KeywordCategory (see M1-WO5). */
export type KeywordCategoryId = Brand<string, "KeywordCategoryId">;

/** UUID identifying a KeywordDefinition (see M1-WO5). */
export type KeywordDefinitionId = Brand<string, "KeywordDefinitionId">;

/** UUID identifying an EntityRelationship (see M1-WO6). */
/** UUID identifying an EntityRelationship (see M1-WO6). */
export type EntityRelationshipId = Brand<string, "EntityRelationshipId">;

/** UUID identifying a SourceDocument (see M1-WO7). */
export type SourceDocumentId = Brand<string, "SourceDocumentId">;

/** UUID identifying a SourceReference (see M1-WO7). */
export type SourceReferenceId = Brand<string, "SourceReferenceId">;

function asBrand<T extends string, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

export const EntityId = { of: (value: string) => asBrand<string, "EntityId">(value) };
export const EntityVersionId = {
  of: (value: string) => asBrand<string, "EntityVersionId">(value),
};
export const EntityAliasId = {
  of: (value: string) => asBrand<string, "EntityAliasId">(value),
};
export const KeywordCategoryId = {
  of: (value: string) => asBrand<string, "KeywordCategoryId">(value),
};
export const KeywordDefinitionId = {
  of: (value: string) => asBrand<string, "KeywordDefinitionId">(value),
};
export const EntityRelationshipId = {
  of: (value: string) => asBrand<string, "EntityRelationshipId">(value),
};
export const SourceDocumentId = {
  of: (value: string) => asBrand<string, "SourceDocumentId">(value),
};
export const SourceReferenceId = {
  of: (value: string) => asBrand<string, "SourceReferenceId">(value),
};

/** Opaque, immutable UUID identity of a Ruleset (PAS-10 M2-WO1). */
export type RulesetId = Brand<string, "RulesetId">;
export const RulesetId = {
  of: (value: string) => asBrand<string, "RulesetId">(value),
};

/** Opaque, immutable UUID identity of a RulesetManifest (PAS-10 M2-WO2). */
export type RulesetManifestId = Brand<string, "RulesetManifestId">;
export const RulesetManifestId = {
  of: (value: string) => asBrand<string, "RulesetManifestId">(value),
};

/** Opaque, immutable UUID identity of a RulesetManifestEntry (PAS-10 M2-WO2). */
export type RulesetManifestEntryId = Brand<string, "RulesetManifestEntryId">;
export const RulesetManifestEntryId = {
  of: (value: string) => asBrand<string, "RulesetManifestEntryId">(value),
};

/** Opaque, immutable UUID identity of a CanonPolicy snapshot (PAS-10 M2-WO4). */
export type CanonPolicyId = Brand<string, "CanonPolicyId">;
export const CanonPolicyId = {
  of: (value: string) => asBrand<string, "CanonPolicyId">(value),
};

/** Opaque, immutable UUID identity of a SourceAuthorityRecord (PAS-10 M2-WO4). */
export type SourceAuthorityRecordId = Brand<string, "SourceAuthorityRecordId">;
export const SourceAuthorityRecordId = {
  of: (value: string) => asBrand<string, "SourceAuthorityRecordId">(value),
};

/** Opaque, immutable UUID identity of a RuleConflict (PAS-10 M2-WO5). */
export type RuleConflictId = Brand<string, "RuleConflictId">;
export const RuleConflictId = {
  of: (value: string) => asBrand<string, "RuleConflictId">(value),
};

/** Opaque, immutable UUID identity of a RuleConflictCandidate (PAS-10 M2-WO5). */
export type RuleConflictCandidateId = Brand<string, "RuleConflictCandidateId">;
export const RuleConflictCandidateId = {
  of: (value: string) => asBrand<string, "RuleConflictCandidateId">(value),
};

/** Opaque, immutable UUID identity of a CanonDecision (PAS-10 M2-WO6). */
export type CanonDecisionId = Brand<string, "CanonDecisionId">;
export const CanonDecisionId = {
  of: (value: string) => asBrand<string, "CanonDecisionId">(value),
};

/** Opaque, immutable UUID identity of a CanonDecisionSelection (PAS-10 M2-WO6). */
export type CanonDecisionSelectionId = Brand<string, "CanonDecisionSelectionId">;
export const CanonDecisionSelectionId = {
  of: (value: string) => asBrand<string, "CanonDecisionSelectionId">(value),
};

/** Opaque, immutable UUID identity of a ChangeSet (PAS-10 M2-WO7). */
export type ChangeSetId = Brand<string, "ChangeSetId">;
export const ChangeSetId = {
  of: (value: string) => asBrand<string, "ChangeSetId">(value),
};

/** Opaque, immutable UUID identity of a ChangeSetOperation (PAS-10 M2-WO7). */
export type ChangeSetOperationId = Brand<string, "ChangeSetOperationId">;
export const ChangeSetOperationId = {
  of: (value: string) => asBrand<string, "ChangeSetOperationId">(value),
};

/** Opaque, immutable UUID identity of a RulesetRelease (PAS-10 M2-WO8). */
export type RulesetReleaseId = Brand<string, "RulesetReleaseId">;
export const RulesetReleaseId = {
  of: (value: string) => asBrand<string, "RulesetReleaseId">(value),
};

/** Opaque, immutable UUID identity of a MigrationPlan (PAS-10 M2-WO11). */
export type MigrationPlanId = Brand<string, "MigrationPlanId">;
export const MigrationPlanId = {
  of: (value: string) => asBrand<string, "MigrationPlanId">(value),
};

/** Opaque, immutable UUID identity of a MigrationPlanItem (PAS-10 M2-WO11). */
export type MigrationPlanItemId = Brand<string, "MigrationPlanItemId">;
export const MigrationPlanItemId = {
  of: (value: string) => asBrand<string, "MigrationPlanItemId">(value),
};

/** Opaque, immutable UUID identity of a SourceSnapshot — one exact revision of a source's bytes (PAS-10 M3-WO1). */
export type SourceSnapshotId = Brand<string, "SourceSnapshotId">;
export const SourceSnapshotId = {
  of: (value: string) => asBrand<string, "SourceSnapshotId">(value),
};

/** Opaque, immutable UUID identity of a SourceSnapshotIngestion record (PAS-10 M3-WO1). */
export type SourceSnapshotIngestionId = Brand<string, "SourceSnapshotIngestionId">;
export const SourceSnapshotIngestionId = {
  of: (value: string) => asBrand<string, "SourceSnapshotIngestionId">(value),
};

/** Opaque, immutable UUID identity of a SourceSection (PAS-10 M3-WO1). */
export type SourceSectionId = Brand<string, "SourceSectionId">;
export const SourceSectionId = {
  of: (value: string) => asBrand<string, "SourceSectionId">(value),
};

/** Opaque, immutable UUID identity of a SourceBlock (PAS-10 M3-WO1). */
export type SourceBlockId = Brand<string, "SourceBlockId">;
export const SourceBlockId = {
  of: (value: string) => asBrand<string, "SourceBlockId">(value),
};

/** Opaque, immutable UUID identity of a SourceTable (PAS-10 M3-WO1). */
export type SourceTableId = Brand<string, "SourceTableId">;
export const SourceTableId = {
  of: (value: string) => asBrand<string, "SourceTableId">(value),
};

/** Opaque, immutable UUID identity of a SourceAsset (PAS-10 M3-WO1). */
export type SourceAssetId = Brand<string, "SourceAssetId">;
export const SourceAssetId = {
  of: (value: string) => asBrand<string, "SourceAssetId">(value),
};

/** Opaque, immutable UUID identity of a SourceAssetPlacement (PAS-10 M3-WO1). */
export type SourceAssetPlacementId = Brand<string, "SourceAssetPlacementId">;
export const SourceAssetPlacementId = {
  of: (value: string) => asBrand<string, "SourceAssetPlacementId">(value),
};

/** Opaque, immutable UUID identity of a SourceContentNode (PAS-10 M3-WO1). */
export type SourceContentNodeId = Brand<string, "SourceContentNodeId">;
export const SourceContentNodeId = {
  of: (value: string) => asBrand<string, "SourceContentNodeId">(value),
};

/** Opaque, immutable UUID identity of an ImportBatch — one reproducible extraction attempt (PAS-10 M3-WO2). */
export type ImportBatchId = Brand<string, "ImportBatchId">;
export const ImportBatchId = {
  of: (value: string) => asBrand<string, "ImportBatchId">(value),
};

/** Opaque, immutable UUID identity of an ExtractionCandidate — one proposed piece of extracted information (M3-WO2). */
export type ExtractionCandidateId = Brand<string, "ExtractionCandidateId">;
export const ExtractionCandidateId = {
  of: (value: string) => asBrand<string, "ExtractionCandidateId">(value),
};

/** Opaque, immutable UUID identity of an ExtractionCandidateSource — one supporting source anchor (M3-WO2). */
export type ExtractionCandidateSourceId = Brand<string, "ExtractionCandidateSourceId">;
export const ExtractionCandidateSourceId = {
  of: (value: string) => asBrand<string, "ExtractionCandidateSourceId">(value),
};

/** Opaque, immutable UUID identity of an ImportMatchRun — one exact identity-matching analysis (PAS-10 M3-WO4). */
export type ImportMatchRunId = Brand<string, "ImportMatchRunId">;
export const ImportMatchRunId = { of: (value: string) => asBrand<string, "ImportMatchRunId">(value) };

/** Opaque, immutable UUID identity of a CandidateMatchAssessment (PAS-10 M3-WO4). */
export type CandidateMatchAssessmentId = Brand<string, "CandidateMatchAssessmentId">;
export const CandidateMatchAssessmentId = { of: (value: string) => asBrand<string, "CandidateMatchAssessmentId">(value) };

/** Opaque, immutable UUID identity of a CandidateMatchSuggestion (PAS-10 M3-WO4). */
export type CandidateMatchSuggestionId = Brand<string, "CandidateMatchSuggestionId">;
export const CandidateMatchSuggestionId = { of: (value: string) => asBrand<string, "CandidateMatchSuggestionId">(value) };

/** Opaque, immutable UUID identity of a CandidateDuplicateGroup (PAS-10 M3-WO4). */
export type CandidateDuplicateGroupId = Brand<string, "CandidateDuplicateGroupId">;
export const CandidateDuplicateGroupId = { of: (value: string) => asBrand<string, "CandidateDuplicateGroupId">(value) };
