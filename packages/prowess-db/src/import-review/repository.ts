import {
  CandidateDuplicateGroupId,
  CandidateMatchAssessmentId,
  EntityId,
  EntityVersionId,
  ExtractionCandidateId,
  ImportBatchId,
  ImportDecisionId,
  ImportMatchRunId,
  TERMINAL_CANDIDATE_STATUSES,
  type ExtractionCandidateKind,
  type ExtractionCandidateStatus,
  type ImportDecision,
  type ImportDecisionType,
  type ImportMatchDecisionBasis,
  type JsonObject,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { ImportDecision as DecisionRow } from "../../generated/prisma/client.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * Import review repository (PAS-10 M3-WO6). Internal to @prowess/db.
 * WRITES only: a new `import_decisions` row, `extraction_candidates.status` (compare-and-set, in the same transaction
 * as its decision) and `import_batches.status` (READY_FOR_REVIEW -> REVIEWING on the first decision, REVIEWING ->
 * COMPLETED on completion). Nothing else — no Candidate content, no MatchRun, no domain or governance row.
 */
export const REVIEWABLE_BATCH_STATUSES = ["READY_FOR_REVIEW", "REVIEWING"] as const;
const REVIEWING = "REVIEWING" as const;
const COMPLETED = "COMPLETED" as const;

export function toDomainDecision(r: DecisionRow): ImportDecision {
  return {
    id: ImportDecisionId.of(r.id),
    importBatchId: ImportBatchId.of(r.importBatchId),
    extractionCandidateId: ExtractionCandidateId.of(r.extractionCandidateId),
    sequenceNumber: r.sequenceNumber,
    decisionType: r.decisionType as ImportDecisionType,
    fromStatus: r.fromStatus as ExtractionCandidateStatus,
    toStatus: r.toStatus as ExtractionCandidateStatus,
    matchBasis: r.matchBasis as ImportMatchDecisionBasis | null,
    candidateFingerprint: r.candidateFingerprint,
    candidateSetHash: r.candidateSetHash,
    matchRunId: r.matchRunId === null ? null : ImportMatchRunId.of(r.matchRunId),
    matchAssessmentId: r.matchAssessmentId === null ? null : CandidateMatchAssessmentId.of(r.matchAssessmentId),
    duplicateGroupId: r.duplicateGroupId === null ? null : CandidateDuplicateGroupId.of(r.duplicateGroupId),
    targetEntityId: r.targetEntityId === null ? null : EntityId.of(r.targetEntityId),
    comparisonEntityVersionId: r.comparisonEntityVersionId === null ? null : EntityVersionId.of(r.comparisonEntityVersionId),
    rationale: r.rationale,
    decisionFingerprint: r.decisionFingerprint,
    createdAt: r.createdAt,
  };
}

export interface ReviewCandidateRow {
  id: string;
  importBatchId: string;
  candidateKind: ExtractionCandidateKind;
  status: ExtractionCandidateStatus;
  candidateFingerprint: string;
  ordinal: number;
}

export async function selectReviewCandidate(id: string): Promise<ReviewCandidateRow | null> {
  const c = await prisma.extractionCandidate.findUnique({ where: { id }, select: { id: true, importBatchId: true, candidateKind: true, status: true, candidateFingerprint: true, ordinal: true } });
  return c ? { ...c, candidateKind: c.candidateKind as ExtractionCandidateKind, status: c.status as ExtractionCandidateStatus } : null;
}

/** The last decision of ONE Candidate's own append-only history (by sequence), or null. */
export async function selectLastDecision(extractionCandidateId: string): Promise<ImportDecision | null> {
  const r = await prisma.importDecision.findFirst({ where: { extractionCandidateId }, orderBy: { sequenceNumber: "desc" } });
  return r ? toDomainDecision(r) : null;
}

export async function selectDecisionById(id: string): Promise<ImportDecision | null> {
  const r = await prisma.importDecision.findUnique({ where: { id } });
  return r ? toDomainDecision(r) : null;
}

export async function selectDecisionsForCandidate(extractionCandidateId: string): Promise<ImportDecision[]> {
  return (await prisma.importDecision.findMany({ where: { extractionCandidateId }, orderBy: { sequenceNumber: "asc" } })).map(toDomainDecision);
}

/** Decisions of a Batch in Candidate ordinal order, then sequence. */
export async function selectDecisionsForBatch(importBatchId: string): Promise<ImportDecision[]> {
  const rows = await prisma.importDecision.findMany({ where: { importBatchId }, orderBy: [{ extractionCandidate: { ordinal: "asc" } }, { sequenceNumber: "asc" }] });
  return rows.map(toDomainDecision);
}

export async function countDecisions(importBatchId: string): Promise<number> {
  return prisma.importDecision.count({ where: { importBatchId } });
}

// ---- evidence reads ---------------------------------------------------------------------------------------------

export async function selectRunBatch(matchRunId: string): Promise<{ id: string; importBatchId: string } | null> {
  return prisma.importMatchRun.findUnique({ where: { id: matchRunId }, select: { id: true, importBatchId: true } });
}

export async function selectAssessmentEvidence(id: string) {
  return prisma.candidateMatchAssessment.findUnique({
    where: { id },
    select: { id: true, matchRunId: true, extractionCandidateId: true, outcome: true, matchedEntityId: true, comparisonEntityVersionId: true, suggestions: { select: { entityId: true, comparisonEntityVersionId: true } } },
  });
}

export async function selectGroupEvidence(id: string) {
  return prisma.candidateDuplicateGroup.findUnique({ where: { id }, select: { id: true, matchRunId: true, members: { select: { extractionCandidateId: true } } } });
}

export async function entityExists(id: string): Promise<boolean> {
  return (await prisma.entity.findUnique({ where: { id }, select: { id: true } })) !== null;
}

export async function selectConflictCandidates(ids: readonly string[]): Promise<Array<{ candidateId: string; ordinal: number; payloadSchemaKey: string; payloadSchemaVersion: number; payload: JsonObject }>> {
  const out = [];
  for (let i = 0; i < ids.length; i += 5_000) {
    const rows = await prisma.extractionCandidate.findMany({ where: { id: { in: ids.slice(i, i + 5_000) } }, select: { id: true, ordinal: true, payloadSchemaKey: true, payloadSchemaVersion: true, payloadJson: true } });
    out.push(...rows.map((r) => ({ candidateId: r.id, ordinal: r.ordinal, payloadSchemaKey: r.payloadSchemaKey, payloadSchemaVersion: r.payloadSchemaVersion, payload: r.payloadJson as JsonObject })));
  }
  return out;
}

// ---- writes ---------------------------------------------------------------------------------------------------------

class Abort extends Error {
  constructor(readonly outcome: "BATCH_NOT_OPEN" | "STATUS_CHANGED") {
    super(outcome);
  }
}

export interface InsertDecisionInput {
  importBatchId: string;
  extractionCandidateId: string;
  candidateFingerprint: string;
  candidateSetHash: string;
  sequenceNumber: number;
  decisionType: ImportDecisionType;
  fromStatus: ExtractionCandidateStatus;
  toStatus: ExtractionCandidateStatus;
  matchBasis: ImportMatchDecisionBasis | null;
  matchRunId: string | null;
  matchAssessmentId: string | null;
  duplicateGroupId: string | null;
  targetEntityId: string | null;
  comparisonEntityVersionId: string | null;
  rationale: string | null;
  decisionFingerprint: string;
}

/**
 * ONE transaction: row-lock the Batch (still reviewable -> REVIEWING), compare-and-set the Candidate status (still
 * `fromStatus` with the reviewed fingerprint -> `toStatus`), prove the sequence is next, insert the decision. Either
 * the decision and both status changes commit, or nothing does. Exactly one of two contradictory concurrent reviews
 * can win the compare-and-set.
 */
export async function insertDecision(input: InsertDecisionInput): Promise<ImportDecision | "BATCH_NOT_OPEN" | "STATUS_CHANGED" | "RACE"> {
  try {
    return await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.updateMany({ where: { id: input.importBatchId, status: { in: [...REVIEWABLE_BATCH_STATUSES] } }, data: { status: REVIEWING } });
      if (batch.count !== 1) throw new Abort("BATCH_NOT_OPEN");
      const cas = await tx.extractionCandidate.updateMany({
        where: { id: input.extractionCandidateId, importBatchId: input.importBatchId, status: input.fromStatus, candidateFingerprint: input.candidateFingerprint },
        data: { status: input.toStatus },
      });
      if (cas.count !== 1) throw new Abort("STATUS_CHANGED");
      const last = await tx.importDecision.findFirst({ where: { extractionCandidateId: input.extractionCandidateId }, orderBy: { sequenceNumber: "desc" }, select: { sequenceNumber: true } });
      if ((last?.sequenceNumber ?? 0) + 1 !== input.sequenceNumber) throw new Abort("STATUS_CHANGED");
      return toDomainDecision(await tx.importDecision.create({ data: input }));
    });
  } catch (error) {
    if (error instanceof Abort) return error.outcome;
    if (isUniqueViolation(error, { constraint: "import_decisions_decision_fingerprint_key", fields: ["decision_fingerprint"] })) return "RACE";
    if (isUniqueViolation(error, { constraint: "import_decisions_candidate_sequence_key", fields: ["extraction_candidate_id", "sequence_number"] })) return "RACE";
    throw error;
  }
}

/** REVIEWING -> COMPLETED only if every Candidate is APPROVED or REJECTED (checked under the Batch row lock). */
class CompletionAbort extends Error {
  constructor(readonly outcome: "NOT_REVIEWING" | "INCOMPLETE") {
    super(outcome);
  }
}

export async function completeReview(importBatchId: string): Promise<"COMPLETED" | "NOT_REVIEWING" | "INCOMPLETE"> {
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.importBatch.updateMany({ where: { id: importBatchId, status: REVIEWING }, data: { status: REVIEWING } });
      if (locked.count !== 1) throw new CompletionAbort("NOT_REVIEWING");
      const open = await tx.extractionCandidate.count({ where: { importBatchId, status: { notIn: [...TERMINAL_CANDIDATE_STATUSES] } } });
      if (open > 0) throw new CompletionAbort("INCOMPLETE");
      await tx.importBatch.updateMany({ where: { id: importBatchId, status: REVIEWING }, data: { status: COMPLETED } });
    });
    return "COMPLETED";
  } catch (error) {
    if (error instanceof CompletionAbort) return error.outcome;
    throw error;
  }
}
