import type { ExtractionCandidateKind, ExtractionCandidateStatus } from "./import-batch.js";
import type {
  CandidateDuplicateGroupId,
  CandidateMatchAssessmentId,
  EntityId,
  EntityVersionId,
  ExtractionCandidateId,
  ImportBatchId,
  ImportDecisionId,
  ImportMatchRunId,
} from "./ids.js";

/**
 * Import review decisions (PAS-10 M3-WO6).
 *
 * ```
 * ExtractionCandidate -> automated evidence (WO4 MatchRuns, WO6 conflict signals) -> human ImportDecision -> Candidate status
 * ```
 *
 * Automated evidence NEVER changes a Candidate's status; only an explicit ImportDecision does, and every Decision is
 * an append-only, immutable audit record pinning the exact Candidate (fingerprint) and Candidate set (hash) reviewed.
 *
 * APPROVED ≠ CANON. APPROVED means only "passed import review; a later materialization stage may use it" — never
 * Canon, published, part of a Ruleset or Manifest, mechanically correct or balanced. Candidate CONFLICT ≠ M2
 * RuleConflict (which is defined over exact EntityVersions). Nothing here materializes any domain record.
 */

/** Explicit decision types — there is no generic status setter. Lockstep with the Prisma enum ImportDecisionType. */
export const IMPORT_DECISION_TYPES = [
  "CLASSIFY_MATCHED",
  "CLASSIFY_NEW_ENTITY",
  "MARK_CONFLICT",
  "MARK_NEEDS_MAPPING",
  "REJECT",
  "APPROVE_MATCHED",
  "APPROVE_NEW_ENTITY",
  "APPROVE_SEMANTIC",
] as const;
export type ImportDecisionType = (typeof IMPORT_DECISION_TYPES)[number];

/** What a CLASSIFY_MATCHED decision rests on. Lockstep with the Prisma enum ImportMatchDecisionBasis. */
export const IMPORT_MATCH_DECISION_BASES = ["EXACT_MATCH", "SUGGESTED_MATCH", "MANUAL_OVERRIDE"] as const;
export type ImportMatchDecisionBasis = (typeof IMPORT_MATCH_DECISION_BASES)[number];

/** Candidate kinds that carry stable Entity identity — they must be classified MATCHED / NEW_ENTITY before approval. */
export const ENTITY_IDENTITY_CANDIDATE_KINDS = ["ENTITY", "ENTITY_FIELD"] as const satisfies readonly ExtractionCandidateKind[];
/** Semantic kinds that can be approved directly (APPROVE_SEMANTIC) because they carry no stable Entity identity. */
export const SEMANTIC_CANDIDATE_KINDS = ["FORMULA", "REQUIREMENT", "KEYWORD"] as const satisfies readonly ExtractionCandidateKind[];
/** Generic structural / reference kinds: never approved as domain content (may be rejected or marked NEEDS_MAPPING). */
export const STRUCTURAL_CANDIDATE_KINDS = ["UNKNOWN", "REFERENCE", "RELATIONSHIP"] as const satisfies readonly ExtractionCandidateKind[];

/** Terminal review statuses — nothing transitions out of them. */
export const TERMINAL_CANDIDATE_STATUSES = ["APPROVED", "REJECTED"] as const satisfies readonly ExtractionCandidateStatus[];

export interface ImportDecisionRule {
  toStatus: ExtractionCandidateStatus;
  fromStatuses: readonly ExtractionCandidateStatus[];
  kinds: readonly ExtractionCandidateKind[];
}

const ALL_KINDS = ["ENTITY", "ENTITY_FIELD", "FORMULA", "REQUIREMENT", "KEYWORD", "RELATIONSHIP", "REFERENCE", "UNKNOWN"] as const satisfies readonly ExtractionCandidateKind[];
const IDENTITY_AND_SEMANTIC = [...ENTITY_IDENTITY_CANDIDATE_KINDS, ...SEMANTIC_CANDIDATE_KINDS] as const;

/**
 * The whole Candidate workflow graph (the ONLY way a Candidate status changes):
 *
 * ```
 * UNREVIEWED    -> MATCHED | NEW_ENTITY | CONFLICT | NEEDS_MAPPING | REJECTED | APPROVED (APPROVE_SEMANTIC only)
 * MATCHED       -> APPROVED (APPROVE_MATCHED) | CONFLICT | NEEDS_MAPPING | REJECTED
 * NEW_ENTITY    -> APPROVED (APPROVE_NEW_ENTITY) | CONFLICT | NEEDS_MAPPING | REJECTED
 * CONFLICT      -> MATCHED | NEW_ENTITY | NEEDS_MAPPING | REJECTED            (never directly APPROVED)
 * NEEDS_MAPPING -> MATCHED | NEW_ENTITY | CONFLICT | REJECTED                 (never directly APPROVED)
 * APPROVED, REJECTED: terminal
 * ```
 */
export const IMPORT_DECISION_RULES: Record<ImportDecisionType, ImportDecisionRule> = {
  CLASSIFY_MATCHED: { toStatus: "MATCHED", fromStatuses: ["UNREVIEWED", "CONFLICT", "NEEDS_MAPPING"], kinds: ENTITY_IDENTITY_CANDIDATE_KINDS },
  CLASSIFY_NEW_ENTITY: { toStatus: "NEW_ENTITY", fromStatuses: ["UNREVIEWED", "CONFLICT", "NEEDS_MAPPING"], kinds: ENTITY_IDENTITY_CANDIDATE_KINDS },
  MARK_CONFLICT: { toStatus: "CONFLICT", fromStatuses: ["UNREVIEWED", "MATCHED", "NEW_ENTITY", "NEEDS_MAPPING"], kinds: IDENTITY_AND_SEMANTIC },
  MARK_NEEDS_MAPPING: { toStatus: "NEEDS_MAPPING", fromStatuses: ["UNREVIEWED", "MATCHED", "NEW_ENTITY", "CONFLICT"], kinds: ALL_KINDS },
  REJECT: { toStatus: "REJECTED", fromStatuses: ["UNREVIEWED", "MATCHED", "NEW_ENTITY", "CONFLICT", "NEEDS_MAPPING"], kinds: ALL_KINDS },
  APPROVE_MATCHED: { toStatus: "APPROVED", fromStatuses: ["MATCHED"], kinds: ENTITY_IDENTITY_CANDIDATE_KINDS },
  APPROVE_NEW_ENTITY: { toStatus: "APPROVED", fromStatuses: ["NEW_ENTITY"], kinds: ENTITY_IDENTITY_CANDIDATE_KINDS },
  APPROVE_SEMANTIC: { toStatus: "APPROVED", fromStatuses: ["UNREVIEWED"], kinds: SEMANTIC_CANDIDATE_KINDS },
};

/** Decision types that carry a target Entity (required), may carry one (MARK_CONFLICT), or must not. */
export const TARGET_REQUIRED_DECISION_TYPES = ["CLASSIFY_MATCHED", "APPROVE_MATCHED"] as const satisfies readonly ImportDecisionType[];
export const TARGET_OPTIONAL_DECISION_TYPES = ["MARK_CONFLICT"] as const satisfies readonly ImportDecisionType[];

export interface ImportDecision {
  id: ImportDecisionId;
  importBatchId: ImportBatchId;
  extractionCandidateId: ExtractionCandidateId;
  /** 1, 2, 3 … per Candidate; append-only. */
  sequenceNumber: number;
  decisionType: ImportDecisionType;
  fromStatus: ExtractionCandidateStatus;
  toStatus: ExtractionCandidateStatus;
  /** CLASSIFY_MATCHED only. */
  matchBasis: ImportMatchDecisionBasis | null;
  /** The exact extracted content reviewed (database-pinned to the Candidate). */
  candidateFingerprint: string;
  /** The Batch's extractionOutputHash — the exact Candidate set reviewed (database-pinned). */
  candidateSetHash: string;
  matchRunId: ImportMatchRunId | null;
  matchAssessmentId: CandidateMatchAssessmentId | null;
  duplicateGroupId: CandidateDuplicateGroupId | null;
  targetEntityId: EntityId | null;
  comparisonEntityVersionId: EntityVersionId | null;
  /** Authored exactly as given. Required for REJECT and MANUAL_OVERRIDE. */
  rationale: string | null;
  /** SHA-256 (PROWESS_IMPORT_DECISION_V1) of the decision's content in its sequence position. */
  decisionFingerprint: string;
  createdAt: Date;
}

export interface ReviewImportCandidateInput {
  extractionCandidateId: string;
  /** The exact fingerprint the reviewer reviewed — must equal the Candidate's. */
  candidateFingerprint: string;
  decisionType: ImportDecisionType;
  matchBasis?: ImportMatchDecisionBasis | null;
  targetEntityId?: string | null;
  matchRunId?: string | null;
  matchAssessmentId?: string | null;
  duplicateGroupId?: string | null;
  comparisonEntityVersionId?: string | null;
  rationale?: string | null;
}

export interface ReviewImportCandidateResult {
  decision: ImportDecision;
  /** false when this exact decision was already the Candidate's latest (an idempotent retry). */
  created: boolean;
}

/** Derived (never persisted) review evidence. */
export const IMPORT_CONFLICT_SIGNAL_TYPES = ["DUPLICATE_EQUIVALENT", "POTENTIAL_CONTENT_CONFLICT", "UNCOMPARABLE_DUPLICATE"] as const;
export type ImportConflictSignalType = (typeof IMPORT_CONFLICT_SIGNAL_TYPES)[number];

export interface ImportConflictSignal {
  duplicateGroupId: CandidateDuplicateGroupId;
  type: ImportConflictSignalType;
  /** Members in Candidate ordinal order. */
  candidateIds: ExtractionCandidateId[];
  /** The shared schema when comparable, else null. */
  payloadSchemaKey: string | null;
  payloadSchemaVersion: number | null;
  distinctPayloadCount: number;
}

export interface ImportReviewSummary {
  totalCandidates: number;
  byStatus: Record<ExtractionCandidateStatus, number>;
  byKind: Record<ExtractionCandidateKind, number>;
  decisionCount: number;
  /** Only when an exact MatchRun is named (never a "latest" one); otherwise null. */
  potentialConflictCount: number | null;
}

export const MAX_IMPORT_DECISION_RATIONALE_LENGTH = 4000;
