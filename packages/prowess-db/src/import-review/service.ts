import {
  DomainError,
  IMPORT_DECISION_ERROR_CODES,
  IMPORT_MATCH_ERROR_CODES,
  IMPORT_REVIEW_ERROR_CODES,
  isUuidString,
  type CandidateDuplicateGroupId,
  type ExtractionCandidateId,
  type ImportBatch,
  type ImportConflictSignal,
  type ImportDecision,
  type ImportDecisionErrorCode,
  type ImportReviewSummary,
  type ReviewImportCandidateInput,
  type ReviewImportCandidateResult,
} from "@prowess/model";
import { analyzeConflictSignals, hasRationale, importDecisionFingerprint, ruleFor, validateReviewInputShape } from "@prowess/import";
import { computeImportBatchSummary, selectImportBatchById } from "../import-batch/repository.js";
import { selectDuplicateGroups } from "../import-match/repository.js";
import {
  completeReview,
  countDecisions,
  entityExists,
  insertDecision,
  REVIEWABLE_BATCH_STATUSES,
  selectAssessmentEvidence,
  selectConflictCandidates,
  selectDecisionById,
  selectDecisionsForBatch,
  selectDecisionsForCandidate,
  selectGroupEvidence,
  selectLastDecision,
  selectReviewCandidate,
  selectRunBatch,
  type ReviewCandidateRow,
} from "./repository.js";

/**
 * Import review (PAS-10 M3-WO6): derived conflict evidence and explicit, append-only editorial decisions.
 *
 * Automated evidence (WO4 MatchRuns, the conflict signals below) NEVER changes a Candidate's status. Only
 * `reviewImportCandidate` does — atomically, through the fixed workflow graph, recording an immutable ImportDecision
 * that pins the exact Candidate fingerprint, Candidate-set hash and cited evidence. Nothing here creates or changes an
 * Entity, EntityVersion, alias, keyword / formula / requirement definition, M2 RuleConflict, CanonDecision, Manifest
 * or Release. APPROVED ≠ CANON; Candidate CONFLICT ≠ M2 RuleConflict (which needs exact EntityVersions).
 */

const decisionError = (code: ImportDecisionErrorCode, m: string) => new DomainError(code, m);
const lower = (v: string | null | undefined) => (typeof v === "string" ? v.toLowerCase() : null);

async function requireBatch(importBatchId: string): Promise<ImportBatch> {
  const batch = isUuidString(importBatchId) ? await selectImportBatchById(importBatchId.toLowerCase()) : null;
  if (!batch) throw new DomainError(IMPORT_REVIEW_ERROR_CODES.BATCH_NOT_FOUND, `ImportBatch not found: ${importBatchId}`);
  return batch;
}

function fingerprintFor(candidate: ReviewCandidateRow, batch: ImportBatch, input: ReviewImportCandidateInput, sequenceNumber: number, fromStatus: ReviewCandidateRow["status"]): string {
  return importDecisionFingerprint({
    extractionCandidateId: candidate.id,
    candidateFingerprint: candidate.candidateFingerprint,
    candidateSetHash: batch.extractionOutputHash as string,
    sequenceNumber,
    fromStatus,
    decisionType: input.decisionType,
    matchBasis: input.matchBasis ?? null,
    targetEntityId: lower(input.targetEntityId),
    comparisonEntityVersionId: lower(input.comparisonEntityVersionId),
    matchRunId: lower(input.matchRunId),
    matchAssessmentId: lower(input.matchAssessmentId),
    duplicateGroupId: lower(input.duplicateGroupId),
    rationale: input.rationale ?? null,
  });
}

/** An exact retry of the Candidate's last decision returns that decision instead of appending a duplicate. */
async function asRetry(candidate: ReviewCandidateRow, batch: ImportBatch, input: ReviewImportCandidateInput): Promise<ImportDecision | null> {
  const last = await selectLastDecision(candidate.id);
  if (!last || candidate.status !== last.toStatus) return null;
  return fingerprintFor(candidate, batch, input, last.sequenceNumber, last.fromStatus) === last.decisionFingerprint ? last : null;
}

/** Validates every cited piece of evidence against the exact Batch / Candidate / MatchRun. */
async function validateEvidence(candidate: ReviewCandidateRow, batch: ImportBatch, input: ReviewImportCandidateInput, classification: ImportDecision | null): Promise<void> {
  const runId = lower(input.matchRunId);
  const targetId = lower(input.targetEntityId);
  if (runId !== null) {
    const run = isUuidString(runId) ? await selectRunBatch(runId) : null;
    if (!run) throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, `MatchRun ${input.matchRunId} does not exist`);
    if (run.importBatchId !== batch.id) throw decisionError(IMPORT_DECISION_ERROR_CODES.MATCH_RUN_MISMATCH, `MatchRun ${run.id} analyses another ImportBatch than Candidate ${candidate.id}'s`);
  }
  const assessmentId = lower(input.matchAssessmentId);
  const assessment = assessmentId !== null && isUuidString(assessmentId) ? await selectAssessmentEvidence(assessmentId) : null;
  if (assessmentId !== null && (!assessment || assessment.matchRunId !== runId || assessment.extractionCandidateId !== candidate.id)) {
    throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, `MatchAssessment ${input.matchAssessmentId} is not an assessment of this Candidate in MatchRun ${runId}`);
  }
  const groupId = lower(input.duplicateGroupId);
  if (groupId !== null) {
    const group = isUuidString(groupId) ? await selectGroupEvidence(groupId) : null;
    if (!group) throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, `Duplicate group ${input.duplicateGroupId} does not exist`);
    if (group.matchRunId !== runId || !group.members.some((m) => m.extractionCandidateId === candidate.id)) {
      throw decisionError(IMPORT_DECISION_ERROR_CODES.DUPLICATE_GROUP_MISMATCH, `Candidate ${candidate.id} is not a member of duplicate group ${group.id} in MatchRun ${runId}`);
    }
  }
  if (targetId !== null && !(isUuidString(targetId) && (await entityExists(targetId)))) {
    throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_TARGET_ENTITY, `Entity ${input.targetEntityId} does not exist`);
  }
  if (input.decisionType === "CLASSIFY_MATCHED") {
    if (input.matchBasis === "EXACT_MATCH" && !(assessment && assessment.outcome === "EXACT_MATCH" && assessment.matchedEntityId === targetId)) {
      throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, "basis EXACT_MATCH needs the Candidate's assessment to be an EXACT_MATCH to exactly this target Entity");
    }
    if (input.matchBasis === "SUGGESTED_MATCH" && !(assessment && assessment.suggestions.some((s) => s.entityId === targetId))) {
      throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, "basis SUGGESTED_MATCH needs the target Entity to be one of the assessment's suggestions");
    }
  }
  const versionId = lower(input.comparisonEntityVersionId);
  if (versionId !== null && assessment) {
    const supplied = (assessment.matchedEntityId === targetId && assessment.comparisonEntityVersionId === versionId) || assessment.suggestions.some((s) => s.entityId === targetId && s.comparisonEntityVersionId === versionId);
    if (!supplied) throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, "comparisonEntityVersionId must be the exact comparison Version the cited assessment supplied for the target Entity");
  }
  if (input.decisionType === "APPROVE_MATCHED" && classification?.targetEntityId !== targetId) {
    throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_TARGET_ENTITY, `APPROVE_MATCHED must name the Entity the Candidate was classified MATCHED to (${classification?.targetEntityId ?? "none"}); re-classify explicitly to change it`);
  }
}

/**
 * Records one explicit review decision and applies its status transition — atomically.
 *
 *   shape / fields the type does not accept / REJECT without rationale -> IMPORT_DECISION.INVALID_INPUT
 *   Candidate missing                                                   -> IMPORT_DECISION.CANDIDATE_NOT_FOUND
 *   fingerprint differs from the Candidate's                            -> IMPORT_DECISION.INVALID_EVIDENCE
 *   Batch not READY_FOR_REVIEW / REVIEWING                              -> IMPORT_REVIEW.NOT_READY
 *   not allowed from the current status / for the Candidate's kind      -> IMPORT_DECISION.INVALID_TRANSITION
 *   MANUAL_OVERRIDE without rationale                                   -> IMPORT_DECISION.MANUAL_RATIONALE_REQUIRED
 *   evidence of another Batch / Candidate / run, or not what is claimed -> MATCH_RUN_MISMATCH / DUPLICATE_GROUP_MISMATCH / INVALID_EVIDENCE
 *   target Entity missing, or approval target ≠ MATCHED classification  -> IMPORT_DECISION.INVALID_TARGET_ENTITY
 *   a concurrent decision changed the Candidate first                   -> IMPORT_DECISION.DECISION_CONFLICT
 *   an exact retry of the Candidate's last decision                     -> that decision, created: false
 */
export async function reviewImportCandidate(input: ReviewImportCandidateInput): Promise<ReviewImportCandidateResult> {
  validateReviewInputShape(input);
  const candidateId = input.extractionCandidateId.toLowerCase();
  const candidate = isUuidString(candidateId) ? await selectReviewCandidate(candidateId) : null;
  if (!candidate) throw decisionError(IMPORT_DECISION_ERROR_CODES.CANDIDATE_NOT_FOUND, `ExtractionCandidate not found: ${input.extractionCandidateId}`);
  if (input.candidateFingerprint !== candidate.candidateFingerprint) {
    throw decisionError(IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, `Candidate ${candidate.id} has fingerprint ${candidate.candidateFingerprint}, not the reviewed ${input.candidateFingerprint}`);
  }
  const batch = (await selectImportBatchById(candidate.importBatchId)) as ImportBatch;
  if (!(REVIEWABLE_BATCH_STATUSES as readonly string[]).includes(batch.status) || batch.extractionOutputHash === null) {
    throw new DomainError(IMPORT_REVIEW_ERROR_CODES.NOT_READY, `ImportBatch ${batch.id} is ${batch.status}; decisions are recorded only while it is READY_FOR_REVIEW or REVIEWING`);
  }

  const retry = await asRetry(candidate, batch, input);
  if (retry) return { decision: retry, created: false };

  const rule = ruleFor(input.decisionType, candidate.status, candidate.candidateKind);
  if (input.matchBasis === "MANUAL_OVERRIDE" && !hasRationale(input.rationale)) {
    throw decisionError(IMPORT_DECISION_ERROR_CODES.MANUAL_RATIONALE_REQUIRED, "a MANUAL_OVERRIDE match needs a rationale explaining the deviation from the automated evidence");
  }
  const last = await selectLastDecision(candidate.id);
  await validateEvidence(candidate, batch, input, last);

  const sequenceNumber = (last?.sequenceNumber ?? 0) + 1;
  const outcome = await insertDecision({
    importBatchId: batch.id,
    extractionCandidateId: candidate.id,
    candidateFingerprint: candidate.candidateFingerprint,
    candidateSetHash: batch.extractionOutputHash,
    sequenceNumber,
    decisionType: input.decisionType,
    fromStatus: candidate.status,
    toStatus: rule.toStatus,
    matchBasis: input.matchBasis ?? null,
    matchRunId: lower(input.matchRunId),
    matchAssessmentId: lower(input.matchAssessmentId),
    duplicateGroupId: lower(input.duplicateGroupId),
    targetEntityId: lower(input.targetEntityId),
    comparisonEntityVersionId: lower(input.comparisonEntityVersionId),
    rationale: input.rationale ?? null,
    decisionFingerprint: fingerprintFor(candidate, batch, input, sequenceNumber, candidate.status),
  });
  if (typeof outcome === "object") return { decision: outcome, created: true };
  if (outcome === "BATCH_NOT_OPEN") throw new DomainError(IMPORT_REVIEW_ERROR_CODES.NOT_READY, `ImportBatch ${batch.id} stopped accepting decisions`);
  // Lost a race: an identical concurrent request is an idempotent success; anything else is a conflict.
  const now = (await selectReviewCandidate(candidate.id)) as ReviewCandidateRow;
  const winner = await asRetry(now, batch, input);
  if (winner) return { decision: winner, created: false };
  throw decisionError(IMPORT_DECISION_ERROR_CODES.DECISION_CONFLICT, `Candidate ${candidate.id} was changed by a concurrent review (now ${now.status}); nothing was written`);
}

export async function getImportDecision(id: string): Promise<ImportDecision> {
  const d = isUuidString(id) ? await selectDecisionById(id.toLowerCase()) : null;
  if (!d) throw decisionError(IMPORT_DECISION_ERROR_CODES.NOT_FOUND, `ImportDecision not found: ${id}`);
  return d;
}

/** A Candidate's full append-only history, sequence 1..n. */
export async function listImportDecisionsForCandidate(extractionCandidateId: string): Promise<ImportDecision[]> {
  const c = isUuidString(extractionCandidateId) ? await selectReviewCandidate(extractionCandidateId.toLowerCase()) : null;
  if (!c) throw decisionError(IMPORT_DECISION_ERROR_CODES.CANDIDATE_NOT_FOUND, `ExtractionCandidate not found: ${extractionCandidateId}`);
  return selectDecisionsForCandidate(c.id);
}

/** Every decision of a Batch, by Candidate ordinal then sequence. */
export async function listImportDecisionsForBatch(importBatchId: string): Promise<ImportDecision[]> {
  return selectDecisionsForBatch((await requireBatch(importBatchId)).id);
}

/**
 * Derived, read-only conflict evidence over one EXPLICITLY named MatchRun of the Batch (never a "latest" run): one
 * signal per WO4 duplicate group — DUPLICATE_EQUIVALENT / POTENTIAL_CONTENT_CONFLICT / UNCOMPARABLE_DUPLICATE.
 * Writes nothing; never changes a status; never creates a RuleConflict.
 */
export async function analyzeImportConflicts(importBatchId: string, matchRunId: string): Promise<ImportConflictSignal[]> {
  const batch = await requireBatch(importBatchId);
  const run = isUuidString(matchRunId) ? await selectRunBatch(matchRunId.toLowerCase()) : null;
  if (!run) throw new DomainError(IMPORT_MATCH_ERROR_CODES.NOT_FOUND, `ImportMatchRun not found: ${matchRunId}`);
  if (run.importBatchId !== batch.id) throw decisionError(IMPORT_DECISION_ERROR_CODES.MATCH_RUN_MISMATCH, `MatchRun ${run.id} analyses another ImportBatch`);
  const groups = await selectDuplicateGroups(run.id);
  const candidates = await selectConflictCandidates([...new Set(groups.flatMap((g) => g.memberCandidateIds as string[]))]);
  return analyzeConflictSignals(groups.map((g) => ({ duplicateGroupId: g.id, memberCandidateIds: g.memberCandidateIds })), candidates).map((s) => ({
    ...s,
    duplicateGroupId: s.duplicateGroupId as CandidateDuplicateGroupId,
    candidateIds: s.candidateIds as ExtractionCandidateId[],
  }));
}

/** Derived counts (never stored). `potentialConflictCount` only when an exact MatchRun is named. */
export async function getImportReviewSummary(importBatchId: string, options: { matchRunId?: string } = {}): Promise<ImportReviewSummary> {
  const batch = await requireBatch(importBatchId);
  const s = await computeImportBatchSummary(batch.id);
  const potentialConflictCount = options.matchRunId === undefined ? null : (await analyzeImportConflicts(batch.id, options.matchRunId)).filter((x) => x.type === "POTENTIAL_CONTENT_CONFLICT").length;
  return { totalCandidates: s.candidateCount, byStatus: s.byStatus, byKind: s.byKind, decisionCount: await countDecisions(batch.id), potentialConflictCount };
}

/**
 * REVIEWING -> COMPLETED, only when every Candidate is APPROVED or REJECTED. COMPLETED means "review of this immutable
 * extraction set is finished" — not published, not materialized.
 */
export async function completeImportReview(importBatchId: string): Promise<ImportBatch> {
  const batch = await requireBatch(importBatchId);
  const outcome = await completeReview(batch.id);
  if (outcome === "NOT_REVIEWING") throw new DomainError(IMPORT_REVIEW_ERROR_CODES.NOT_READY, `ImportBatch ${batch.id} is ${batch.status}; only a REVIEWING Batch can complete review`);
  if (outcome === "INCOMPLETE") throw new DomainError(IMPORT_REVIEW_ERROR_CODES.INCOMPLETE, `ImportBatch ${batch.id} still has Candidates that are not APPROVED or REJECTED`);
  return (await selectImportBatchById(batch.id)) as ImportBatch;
}
