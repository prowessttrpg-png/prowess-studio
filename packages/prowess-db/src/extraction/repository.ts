import { randomUUID } from "node:crypto";
import {
  EXTRACTED_IMPORT_BATCH_STATUS,
  EXTRACTING_IMPORT_BATCH_STATUS,
  INITIAL_EXTRACTION_CANDIDATE_STATUS,
  INITIAL_IMPORT_BATCH_STATUS,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { PreparedCandidate } from "../extraction-candidate/repository.js";

/**
 * Extraction commit repository (PAS-10 M3-WO3). Internal to @prowess/db. In ONE transaction it:
 *   1. claims the Batch with a conditional update CREATED -> EXTRACTING (row-locked; exactly one caller can win);
 *   2. proves the Batch holds no Candidates yet;
 *   3. inserts every Candidate and supporting anchor in bounded chunks (PostgreSQL bind-parameter limits);
 *   4. moves the Batch to READY_FOR_REVIEW with its output hash and extraction timestamp.
 * Any failure rolls ALL of it back: no partial Candidate set, no output hash, never a false READY_FOR_REVIEW, and the
 * Batch is CREATED again. EXTRACTING is therefore never visible outside the transaction. It writes only
 * import_batches workflow fields, extraction_candidates and extraction_candidate_sources.
 */
const CANDIDATE_CHUNK = 1_000;
const SOURCE_CHUNK = 5_000;
const COMMIT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 300_000 } as const;

class AbortCommit extends Error {
  constructor(readonly outcome: "NOT_CREATED" | "HAS_CANDIDATES") {
    super(outcome);
  }
}

export type CommitOutcome = "COMMITTED" | "NOT_CREATED" | "HAS_CANDIDATES";

export async function commitExtraction(importBatchId: string, sourceSnapshotId: string, prepared: readonly PreparedCandidate[], extractionOutputHash: string): Promise<CommitOutcome> {
  const ids = prepared.map(() => randomUUID());
  const candidateRows: Prisma.ExtractionCandidateCreateManyInput[] = prepared.map((c, i) => ({
    id: ids[i] as string,
    importBatchId,
    sourceSnapshotId,
    ordinal: c.ordinal,
    candidateKind: c.candidateKind,
    proposedEntityType: c.proposedEntityType,
    proposedCanonicalKey: c.proposedCanonicalKey,
    displayLabel: c.displayLabel,
    summary: c.summary,
    confidence: c.confidence,
    status: INITIAL_EXTRACTION_CANDIDATE_STATUS,
    payloadSchemaKey: c.payloadSchemaKey,
    payloadSchemaVersion: c.payloadSchemaVersion,
    payloadJson: c.payload as Prisma.InputJsonObject,
    candidateFingerprint: c.candidateFingerprint,
    primarySourceSectionId: c.primarySourceSectionId,
    primarySourceContentNodeId: c.primarySourceContentNodeId,
  }));
  const sourceRows: Prisma.ExtractionCandidateSourceCreateManyInput[] = prepared.flatMap((c, i) =>
    c.supporting.map((s, j) => ({ extractionCandidateId: ids[i] as string, sourceSnapshotId, ordinal: j + 1, ...s })),
  );
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.importBatch.updateMany({ where: { id: importBatchId, status: INITIAL_IMPORT_BATCH_STATUS }, data: { status: EXTRACTING_IMPORT_BATCH_STATUS } });
      if (claimed.count !== 1) throw new AbortCommit("NOT_CREATED");
      if ((await tx.extractionCandidate.count({ where: { importBatchId } })) > 0) throw new AbortCommit("HAS_CANDIDATES");
      for (let i = 0; i < candidateRows.length; i += CANDIDATE_CHUNK) await tx.extractionCandidate.createMany({ data: candidateRows.slice(i, i + CANDIDATE_CHUNK) });
      for (let i = 0; i < sourceRows.length; i += SOURCE_CHUNK) await tx.extractionCandidateSource.createMany({ data: sourceRows.slice(i, i + SOURCE_CHUNK) });
      await tx.importBatch.update({ where: { id: importBatchId }, data: { status: EXTRACTED_IMPORT_BATCH_STATUS, extractionOutputHash, extractedAt: new Date() } });
    }, COMMIT_TRANSACTION_OPTIONS);
    return "COMMITTED";
  } catch (error) {
    if (error instanceof AbortCommit) return error.outcome;
    throw error;
  }
}

/** The committed set as stored: (ordinal, fingerprint) in ordinal order, read in bounded pages. */
export async function selectStoredCandidateSet(importBatchId: string): Promise<Array<{ ordinal: number; candidateFingerprint: string }>> {
  const out: Array<{ ordinal: number; candidateFingerprint: string }> = [];
  let after = 0;
  for (;;) {
    const page = await prisma.extractionCandidate.findMany({
      where: { importBatchId, ordinal: { gt: after } },
      select: { ordinal: true, candidateFingerprint: true },
      orderBy: { ordinal: "asc" },
      take: 10_000,
    });
    out.push(...page);
    if (page.length < 10_000) return out;
    after = (page[page.length - 1] as { ordinal: number }).ordinal;
  }
}
