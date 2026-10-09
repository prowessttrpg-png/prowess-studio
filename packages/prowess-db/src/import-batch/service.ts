import {
  DomainError,
  IMPORT_BATCH_ERROR_CODES,
  isUuidString,
  RULESET_ERROR_CODES,
  RULESET_MANIFEST_ERROR_CODES,
  validateCreateImportBatchInput,
  type CreateImportBatchInput,
  type ImportBatch,
  type ImportBatchSummary,
  type ImportBatchWithSummary,
  type ListImportBatchesFilter,
} from "@prowess/model";
import { importBatchFingerprint } from "@prowess/import";
import { getRuleset } from "../ruleset/service.js";
import { getRulesetManifest } from "../ruleset-manifest/service.js";
import { selectSourceSnapshotById } from "../source-snapshot/repository.js";
import { selectIngestion, selectSectionById } from "../source-structure/repository.js";
import {
  computeImportBatchSummary,
  insertImportBatch,
  selectImportBatchByFingerprint,
  selectImportBatchById,
  selectImportBatches,
} from "./repository.js";

/**
 * ImportBatch service (PAS-10 M3-WO2) — one reproducible extraction attempt against ONE exact, structurally-ingested
 * SourceSnapshot.
 *
 * Never chooses anything implicitly: no latest Manifest, Release, CanonPolicy or EntityVersion is ever looked up.
 * A review Ruleset / comparison Manifest are recorded only when the caller names them, and only as CONTEXT — nothing
 * here (or in Candidate recording) writes to a Ruleset, Manifest or any other M1/M2 record. Structural ingestion is
 * never triggered from here.
 */

export interface CreateImportBatchResult {
  batch: ImportBatch;
  /** false when this exact extraction context (fingerprint) already existed and that Batch was returned. */
  created: boolean;
}

/**
 * Creates — or, for an identical extraction context, returns — an ImportBatch.
 *
 *   shape / forbidden server-controlled fields          -> IMPORT_BATCH.INVALID_INPUT
 *   scope type vs section / section not of the Snapshot -> IMPORT_BATCH.INVALID_SCOPE
 *   Snapshot does not exist                             -> IMPORT_BATCH.SOURCE_SNAPSHOT_NOT_FOUND
 *   Snapshot structure not ingested                     -> IMPORT_BATCH.SOURCE_STRUCTURE_NOT_READY
 *   Manifest without Ruleset / unknown / other Ruleset  -> IMPORT_BATCH.INVALID_COMPARISON_CONTEXT
 *   same fingerprint (concurrently or not)              -> the existing Batch, created: false
 *
 * Label / description are not part of the extraction identity: a repeat with a different label returns the
 * original Batch unchanged.
 */
export async function createImportBatch(input: CreateImportBatchInput): Promise<CreateImportBatchResult> {
  validateCreateImportBatchInput(input);
  const sourceSnapshotId = input.sourceSnapshotId.toLowerCase();

  const snapshot = isUuidString(sourceSnapshotId) ? await selectSourceSnapshotById(sourceSnapshotId) : null;
  if (!snapshot) throw new DomainError(IMPORT_BATCH_ERROR_CODES.SOURCE_SNAPSHOT_NOT_FOUND, `SourceSnapshot not found: ${input.sourceSnapshotId}`);
  const ingestion = await selectIngestion(snapshot.id);
  if (!ingestion) {
    throw new DomainError(IMPORT_BATCH_ERROR_CODES.SOURCE_STRUCTURE_NOT_READY, `SourceSnapshot ${snapshot.id} has no completed structural ingestion; ingest its structure first`);
  }

  let scopeSectionId: string | null = null;
  if (input.scope.type === "SECTION_SUBTREE") {
    const requested = (input.scope.sectionId as string).toLowerCase();
    const section = isUuidString(requested) ? await selectSectionById(requested) : null;
    if (!section) throw new DomainError(IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE, `scope section ${input.scope.sectionId} does not exist`);
    if (section.sourceSnapshotId !== snapshot.id) throw new DomainError(IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE, `scope section ${section.id} belongs to another Snapshot`);
    scopeSectionId = section.id;
  }

  const { reviewRulesetId, comparisonManifestId } = await resolveComparisonContext(input.reviewRulesetId ?? null, input.comparisonManifestId ?? null);

  const identity = {
    sourceSnapshotId: snapshot.id,
    sourceStructureHash: ingestion.structureHash,
    scopeType: input.scope.type,
    scopeSectionId,
    reviewRulesetId,
    comparisonManifestId,
    extractorKey: input.extractorKey,
    extractorVersion: input.extractorVersion,
    extractorConfigHash: input.extractorConfigHash ?? null,
  };
  const batchFingerprint = importBatchFingerprint(identity);

  const existing = await selectImportBatchByFingerprint(batchFingerprint);
  if (existing) return { batch: existing, created: false };

  const inserted = await insertImportBatch({ ...identity, label: input.label, description: input.description ?? null, batchFingerprint });
  if (inserted !== "DUPLICATE_FINGERPRINT") return { batch: inserted, created: true };
  // A concurrent identical create won the unique-key race: return the winner.
  const winner = await selectImportBatchByFingerprint(batchFingerprint);
  if (!winner) throw new DomainError(IMPORT_BATCH_ERROR_CODES.CONFLICT, `ImportBatch fingerprint ${batchFingerprint} collided but no Batch could be read back`);
  return { batch: winner, created: false };
}

/** Explicit ids only. A missing / unknown Ruleset or Manifest, or a Manifest of another Ruleset, is a bad context. */
async function resolveComparisonContext(rulesetId: string | null, manifestId: string | null): Promise<{ reviewRulesetId: string | null; comparisonManifestId: string | null }> {
  const fail = (m: string) => new DomainError(IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT, m);
  if (rulesetId === null) return { reviewRulesetId: null, comparisonManifestId: null };
  const r = rulesetId.toLowerCase();
  if (!isUuidString(r)) throw fail(`reviewRulesetId ${rulesetId} is not a valid id`);
  try {
    await getRuleset(r);
  } catch (error) {
    if (error instanceof DomainError && error.code === RULESET_ERROR_CODES.NOT_FOUND) throw fail(`review Ruleset ${rulesetId} does not exist`);
    throw error;
  }
  if (manifestId === null) return { reviewRulesetId: r, comparisonManifestId: null };
  const m = manifestId.toLowerCase();
  if (!isUuidString(m)) throw fail(`comparisonManifestId ${manifestId} is not a valid id`);
  let manifestRulesetId: string;
  try {
    manifestRulesetId = (await getRulesetManifest(m)).rulesetId;
  } catch (error) {
    if (error instanceof DomainError && error.code === RULESET_MANIFEST_ERROR_CODES.NOT_FOUND) throw fail(`comparison Manifest ${manifestId} does not exist`);
    throw error;
  }
  if (manifestRulesetId !== r) throw fail(`comparison Manifest ${m} belongs to Ruleset ${manifestRulesetId}, not to review Ruleset ${r}`);
  return { reviewRulesetId: r, comparisonManifestId: m };
}

async function requireBatch(id: string): Promise<ImportBatch> {
  const batch = isUuidString(id) ? await selectImportBatchById(id.toLowerCase()) : null;
  if (!batch) throw new DomainError(IMPORT_BATCH_ERROR_CODES.NOT_FOUND, `ImportBatch not found: ${id}`);
  return batch;
}

/** A Batch with its DERIVED summary. A malformed id is NOT_FOUND. */
export async function getImportBatch(id: string): Promise<ImportBatchWithSummary> {
  const batch = await requireBatch(id);
  return { ...batch, summary: await computeImportBatchSummary(batch.id) };
}

/** Derived counts by confidence / status / kind, computed from Candidates on every call (never stored). */
export async function getImportBatchSummary(id: string): Promise<ImportBatchSummary> {
  const batch = await requireBatch(id);
  return computeImportBatchSummary(batch.id);
}

/** Batches in creation order, optionally of one Snapshot. A malformed snapshot filter is INVALID_INPUT. */
export async function listImportBatches(filter: ListImportBatchesFilter = {}): Promise<ImportBatch[]> {
  if (filter.sourceSnapshotId !== undefined && !isUuidString(filter.sourceSnapshotId)) {
    throw new DomainError(IMPORT_BATCH_ERROR_CODES.INVALID_INPUT, `sourceSnapshotId filter ${filter.sourceSnapshotId} is not a valid id`);
  }
  return selectImportBatches({ sourceSnapshotId: filter.sourceSnapshotId?.toLowerCase() });
}

/** Internal (not exported from the package): the Batch for Candidate recording. */
export { requireBatch };
