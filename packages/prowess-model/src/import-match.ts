import type {
  CandidateDuplicateGroupId,
  CandidateMatchAssessmentId,
  CandidateMatchSuggestionId,
  EntityId,
  EntityVersionId,
  ExtractionCandidateId,
  ImportBatchId,
  ImportMatchRunId,
  RulesetManifestId,
} from "./ids.js";
import type { JsonObject } from "./json.js";

/**
 * Import identity matching (PAS-10 M3-WO4) — advisory, immutable analysis of WHICH existing Entity, if any, an
 * ExtractionCandidate could represent. Never which rule is correct.
 *
 * ```
 * ExtractionCandidate -> Identity Matcher -> CandidateMatchAssessment (+ suggestions, duplicate groups) -> human review later
 * ```
 *
 * Entity Identity Match ≠ Rule Content Agreement. Matching never changes a Candidate (its status stays UNREVIEWED),
 * never creates or changes an Entity, alias, EntityVersion, Manifest, conflict or decision, and never consults
 * EntityVersion lifecycle, Canon status or source authority. See docs/architecture/m3-entity-matching.md.
 */

/** Lockstep with the Prisma enum ImportMatchOutcome. */
export const IMPORT_MATCH_OUTCOMES = ["EXACT_MATCH", "POTENTIAL_MATCH", "NO_MATCH", "INSUFFICIENT_IDENTITY", "NOT_APPLICABLE"] as const;
export type ImportMatchOutcome = (typeof IMPORT_MATCH_OUTCOMES)[number];

/**
 * Why an Entity was matched / suggested, strongest first. Only CANONICAL_KEY_EXACT and ALIAS_EXACT can establish an
 * EXACT_MATCH; label equality and fuzzy similarity are suggestions only. Lockstep with the Prisma enum ImportMatchBasis.
 */
export const IMPORT_MATCH_BASES = ["CANONICAL_KEY_EXACT", "ALIAS_EXACT", "DISPLAY_LABEL_EXACT", "NORMALIZED_LABEL", "FUZZY_LABEL", "NONE"] as const;
export type ImportMatchBasis = (typeof IMPORT_MATCH_BASES)[number];
export const EXACT_IMPORT_MATCH_BASES = ["CANONICAL_KEY_EXACT", "ALIAS_EXACT"] as const satisfies readonly ImportMatchBasis[];

/** Advisory duplicate bases. Lockstep with the Prisma enum CandidateDuplicateBasis. */
export const CANDIDATE_DUPLICATE_BASES = ["PROPOSED_CANONICAL_KEY", "NORMALIZED_LABEL"] as const;
export type CandidateDuplicateBasis = (typeof CANDIDATE_DUPLICATE_BASES)[number];

/** Validated, versioned matcher configuration. Defaults are explicit and hashed into the run — never env-driven. */
export interface ImportMatcherConfig {
  /** Fuzzy suggestions are shown at or above this similarity (0..1). Never an acceptance threshold. */
  suggestionThreshold: number;
  /** Review-oriented cap on suggestions per Candidate (not a game rule). */
  maxSuggestions: number;
}

export interface ImportMatchRun {
  id: ImportMatchRunId;
  importBatchId: ImportBatchId;
  matcherKey: string;
  matcherVersion: string;
  /** SHA-256 of the canonical JSON of the effective matcher config. */
  matcherConfigHash: string;
  matcherConfig: JsonObject;
  /** The Batch's `extractionOutputHash` — the exact Candidate set analysed. */
  candidateSetHash: string;
  /** SHA-256 (PROWESS_ENTITY_CATALOG_V1) of exactly the identity data the matcher consulted. */
  entityCatalogHash: string;
  /** The Batch's exact comparison Manifest (never a "latest" one), or null. */
  comparisonManifestId: RulesetManifestId | null;
  /** SHA-256 (PROWESS_IMPORT_MATCH_RUN_V1) of the analysis context — the run's identity. */
  runFingerprint: string;
  /** SHA-256 (PROWESS_IMPORT_MATCH_RESULT_V1) of the full result — used to detect nondeterminism. */
  resultHash: string;
  createdAt: Date;
}

export interface CandidateMatchSuggestion {
  id: CandidateMatchSuggestionId;
  candidateMatchAssessmentId: CandidateMatchAssessmentId;
  entityId: EntityId;
  rank: number;
  /** Advisory similarity in [0, 1]; exact bases score 1. */
  score: number;
  basis: ImportMatchBasis;
  /** The Entity's exact effective Version in the comparison Manifest, or null (absent / no Manifest). */
  comparisonEntityVersionId: EntityVersionId | null;
  createdAt: Date;
}

export interface CandidateMatchAssessment {
  id: CandidateMatchAssessmentId;
  matchRunId: ImportMatchRunId;
  importBatchId: ImportBatchId;
  extractionCandidateId: ExtractionCandidateId;
  outcome: ImportMatchOutcome;
  /** Authoritative only for EXACT_MATCH (null otherwise) — never derived from suggestion rank. */
  matchedEntityId: EntityId | null;
  matchedBy: ImportMatchBasis;
  normalizedCandidateLabel: string | null;
  normalizedProposedCanonicalKey: string | null;
  /** Exact comparison-Manifest Version of the matched Entity, or null. Absence never means "new Entity". */
  comparisonEntityVersionId: EntityVersionId | null;
  suggestions: CandidateMatchSuggestion[];
  createdAt: Date;
}

export interface CandidateDuplicateGroup {
  id: CandidateDuplicateGroupId;
  matchRunId: ImportMatchRunId;
  basis: CandidateDuplicateBasis;
  identityKey: string;
  identityKeyHash: string;
  /** Members in Candidate ordinal order. Ordering only — no winner, no authority. */
  memberCandidateIds: ExtractionCandidateId[];
  createdAt: Date;
}

export interface ImportMatchRunWithSummary extends ImportMatchRun {
  assessmentCount: number;
  byOutcome: Record<ImportMatchOutcome, number>;
  duplicateGroupCount: number;
}

export interface AnalyzeImportBatchMatchesOptions {
  matcherKey?: string;
  matcherVersion?: string;
  matcherConfig?: Partial<ImportMatcherConfig>;
}

export interface AnalyzeImportBatchMatchesResult {
  run: ImportMatchRunWithSummary;
  /** false when this exact analysis context already had a MatchRun (which was returned unchanged). */
  created: boolean;
}
