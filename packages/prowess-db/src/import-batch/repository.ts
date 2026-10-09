import {
  emptyImportBatchSummary,
  ImportBatchId,
  INITIAL_IMPORT_BATCH_STATUS,
  RulesetId,
  RulesetManifestId,
  SourceSectionId,
  SourceSnapshotId,
  type ExtractionCandidateKind,
  type ExtractionCandidateStatus,
  type ExtractionConfidence,
  type ImportBatch,
  type ImportBatchScopeType,
  type ImportBatchStatus,
  type ImportBatchSummary,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { ImportBatch as BatchRow } from "../../generated/prisma/client.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * ImportBatch repository (PAS-10 M3-WO2). Internal to @prowess/db. WRITES exactly one thing — a new
 * `import_batches` row, always with status CREATED — and never updates or deletes one. Summaries are COMPUTED from
 * Candidates on every read; no counter is ever stored.
 */
export const BATCH_FINGERPRINT_UNIQUE = "import_batches_batch_fingerprint_key";

export function toDomainImportBatch(row: BatchRow): ImportBatch {
  return {
    id: ImportBatchId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    sourceStructureHash: row.sourceStructureHash,
    label: row.label,
    description: row.description,
    scopeType: row.scopeType as ImportBatchScopeType,
    scopeSectionId: row.scopeSectionId === null ? null : SourceSectionId.of(row.scopeSectionId),
    reviewRulesetId: row.reviewRulesetId === null ? null : RulesetId.of(row.reviewRulesetId),
    comparisonManifestId: row.comparisonManifestId === null ? null : RulesetManifestId.of(row.comparisonManifestId),
    extractorKey: row.extractorKey,
    extractorVersion: row.extractorVersion,
    extractorConfigHash: row.extractorConfigHash,
    batchFingerprint: row.batchFingerprint,
    status: row.status as ImportBatchStatus,
    createdAt: row.createdAt,
  };
}

export interface InsertImportBatchInput {
  sourceSnapshotId: string;
  sourceStructureHash: string;
  label: string;
  description: string | null;
  scopeType: ImportBatchScopeType;
  scopeSectionId: string | null;
  reviewRulesetId: string | null;
  comparisonManifestId: string | null;
  extractorKey: string;
  extractorVersion: string;
  extractorConfigHash: string | null;
  batchFingerprint: string;
}

/** Inserts a CREATED Batch, or returns "DUPLICATE_FINGERPRINT" when that extraction context already exists. */
export async function insertImportBatch(input: InsertImportBatchInput): Promise<ImportBatch | "DUPLICATE_FINGERPRINT"> {
  try {
    return toDomainImportBatch(await prisma.importBatch.create({ data: { ...input, status: INITIAL_IMPORT_BATCH_STATUS } }));
  } catch (error) {
    if (isUniqueViolation(error, { constraint: BATCH_FINGERPRINT_UNIQUE, fields: ["batch_fingerprint"] })) return "DUPLICATE_FINGERPRINT";
    throw error;
  }
}

export async function selectImportBatchById(id: string): Promise<ImportBatch | null> {
  const row = await prisma.importBatch.findUnique({ where: { id } });
  return row ? toDomainImportBatch(row) : null;
}

export async function selectImportBatchByFingerprint(batchFingerprint: string): Promise<ImportBatch | null> {
  const row = await prisma.importBatch.findUnique({ where: { batchFingerprint } });
  return row ? toDomainImportBatch(row) : null;
}

/** Creation (history) order, `createdAt ASC, id ASC` — never a "latest" pick. */
export async function selectImportBatches(filter: { sourceSnapshotId?: string }): Promise<ImportBatch[]> {
  const rows = await prisma.importBatch.findMany({
    where: filter.sourceSnapshotId === undefined ? {} : { sourceSnapshotId: filter.sourceSnapshotId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainImportBatch);
}

/** Derived counts over the Batch's Candidates (three grouped reads; nothing persisted). */
export async function computeImportBatchSummary(importBatchId: string): Promise<ImportBatchSummary> {
  const where = { importBatchId };
  const [byConfidence, byStatus, byKind] = await Promise.all([
    prisma.extractionCandidate.groupBy({ by: ["confidence"], where, _count: { _all: true } }),
    prisma.extractionCandidate.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.extractionCandidate.groupBy({ by: ["candidateKind"], where, _count: { _all: true } }),
  ]);
  const summary = emptyImportBatchSummary();
  for (const g of byConfidence) summary.byConfidence[g.confidence as ExtractionConfidence] = g._count._all;
  for (const g of byStatus) summary.byStatus[g.status as ExtractionCandidateStatus] = g._count._all;
  for (const g of byKind) summary.byKind[g.candidateKind as ExtractionCandidateKind] = g._count._all;
  summary.candidateCount = byKind.reduce((n, g) => n + g._count._all, 0);
  return summary;
}
