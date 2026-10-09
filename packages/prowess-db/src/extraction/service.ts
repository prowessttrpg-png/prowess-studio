import {
  DomainError,
  EXTRACTED_IMPORT_BATCH_STATUS,
  IMPORT_BATCH_ERROR_CODES,
  INITIAL_IMPORT_BATCH_STATUS,
  POST_EXTRACTION_REVIEW_STATUSES,
  type ImportBatch,
  type ImportBatchErrorCode,
  type ImportBatchExtractionResult,
  type ImportBatchExtractionVerification,
} from "@prowess/model";
import { defaultExtractorRegistry, ExtractionError, extractionSetHash, runExtraction, type ExtractionRun, type ExtractorRegistry } from "@prowess/import";
import { prepareCandidates } from "../extraction-candidate/service.js";
import { computeImportBatchSummary, selectImportBatchById } from "../import-batch/repository.js";
import { requireBatch } from "../import-batch/service.js";
import { getSourceStructure } from "../source-structure/service.js";
import { commitExtraction, selectStoredCandidateSet } from "./repository.js";

/**
 * Automated extraction (PAS-10 M3-WO3): an ImportBatch explicitly executes its EXACT registered extractor over its
 * EXACT pinned source structure, and commits the resulting UNREVIEWED Candidate set atomically.
 *
 *   load exact structure  ->  pure extractor (@prowess/import)  ->  validate the WHOLE output (pure, then against the
 *   database)  ->  fingerprints + output hash  ->  one short commit transaction  ->  READY_FOR_REVIEW
 *
 * The expensive segmentation happens before the transaction. No Entity, alias, keyword, Ruleset, Manifest, Canon
 * policy, source authority, conflict, decision, ChangeSet or Release is read or written; source structure is read
 * only. Candidates are never classified further here.
 *
 * Failure behaviour (documented decision): an extractor failure or invalid output writes nothing and leaves the Batch
 * CREATED with a controlled error. FAILED is not used — no async job system exists, and recording a failure would
 * need a second write outside the atomic commit.
 */

const fail = (code: ImportBatchErrorCode, m: string) => new DomainError(code, m);

function assertExtractable(batch: ImportBatch): void {
  if ((POST_EXTRACTION_REVIEW_STATUSES as readonly string[]).includes(batch.status)) {
    throw fail(IMPORT_BATCH_ERROR_CODES.ALREADY_REVIEWING, `ImportBatch ${batch.id} is ${batch.status}; extraction is closed`);
  }
  if (batch.status !== INITIAL_IMPORT_BATCH_STATUS && batch.status !== EXTRACTED_IMPORT_BATCH_STATUS) {
    throw fail(IMPORT_BATCH_ERROR_CODES.EXTRACTION_CONFLICT, `ImportBatch ${batch.id} is ${batch.status} and cannot be extracted`);
  }
}

/** Runs the exact extractor over the exact pinned structure and validates its complete output (pure + database). */
async function computeExtraction(registry: ExtractorRegistry, batch: ImportBatch): Promise<{ run: ExtractionRun; prepared: Awaited<ReturnType<typeof prepareCandidates>> }> {
  const structure = await getSourceStructure(batch.sourceSnapshotId);
  if (!structure.ingestion || structure.ingestion.structureHash !== batch.sourceStructureHash) {
    throw fail(IMPORT_BATCH_ERROR_CODES.EXTRACTION_CONFLICT, `ImportBatch ${batch.id} pins structure ${batch.sourceStructureHash}, which is not the Snapshot's ingested structure`);
  }
  let run: ExtractionRun;
  try {
    run = runExtraction(
      registry,
      {
        importBatchId: batch.id,
        sourceSnapshotId: batch.sourceSnapshotId,
        sourceStructureHash: batch.sourceStructureHash,
        scopeType: batch.scopeType,
        scopeSectionId: batch.scopeSectionId,
        extractorKey: batch.extractorKey,
        extractorVersion: batch.extractorVersion,
        extractorConfigHash: batch.extractorConfigHash,
      },
      structure.sections,
      structure.nodes,
    );
  } catch (error) {
    if (error instanceof ExtractionError) throw fail(IMPORT_BATCH_ERROR_CODES[error.kind], error.message);
    throw error;
  }
  let prepared: Awaited<ReturnType<typeof prepareCandidates>>;
  try {
    prepared = run.candidates.length === 0 ? [] : await prepareCandidates(batch, run.candidates);
  } catch (error) {
    // The database is authoritative for anchors (existence, Snapshot, scope, verbatim excerpts).
    if (error instanceof DomainError) throw fail(IMPORT_BATCH_ERROR_CODES.INVALID_EXTRACTOR_OUTPUT, `extractor output rejected: ${error.message}`);
    throw error;
  }
  if (prepared.some((p, i) => p.candidateFingerprint !== run.fingerprints[i])) {
    throw fail(IMPORT_BATCH_ERROR_CODES.INVALID_EXTRACTOR_OUTPUT, "extractor output fingerprints differ between pure and database validation");
  }
  return { run, prepared };
}

async function result(batchId: string, alreadyExtracted: boolean): Promise<ImportBatchExtractionResult> {
  const batch = (await selectImportBatchById(batchId)) as ImportBatch;
  const summary = await computeImportBatchSummary(batch.id);
  return { batch, candidateCount: summary.candidateCount, extractionOutputHash: batch.extractionOutputHash as string, summary, alreadyExtracted };
}

function compareWithCommitted(batch: ImportBatch, outputHash: string): void {
  if (batch.extractionOutputHash !== outputHash) {
    throw fail(
      IMPORT_BATCH_ERROR_CODES.NONDETERMINISTIC_OUTPUT,
      `${batch.extractorKey}@${batch.extractorVersion} now produces output ${outputHash} for ImportBatch ${batch.id}, which committed ${batch.extractionOutputHash}; the committed Candidates are unchanged — a behaviour change needs a new extractor version (and so a new Batch)`,
    );
  }
}

/** Internal (registry-injectable for tests); the public entry point is `extractImportBatch`. */
export async function extractImportBatchWith(registry: ExtractorRegistry, importBatchId: string): Promise<ImportBatchExtractionResult> {
  const batch = await requireBatch(importBatchId);
  assertExtractable(batch);
  const { run, prepared } = await computeExtraction(registry, batch);

  if (batch.status === EXTRACTED_IMPORT_BATCH_STATUS) {
    compareWithCommitted(batch, run.outputHash);
    return result(batch.id, true);
  }
  const outcome = await commitExtraction(batch.id, batch.sourceSnapshotId, prepared, run.outputHash);
  if (outcome === "HAS_CANDIDATES") {
    throw fail(IMPORT_BATCH_ERROR_CODES.EXTRACTION_CONFLICT, `ImportBatch ${batch.id} already holds manually recorded Candidates; automated extraction needs an empty Batch`);
  }
  if (outcome === "NOT_CREATED") {
    // A concurrent extraction committed first (or the Batch moved on): one logical result wins.
    const current = (await selectImportBatchById(batch.id)) as ImportBatch;
    assertExtractable(current);
    if (current.status !== EXTRACTED_IMPORT_BATCH_STATUS) throw fail(IMPORT_BATCH_ERROR_CODES.EXTRACTION_CONFLICT, `ImportBatch ${batch.id} changed state during extraction`);
    compareWithCommitted(current, run.outputHash);
    return result(batch.id, true);
  }
  return result(batch.id, false);
}

/**
 * Explicitly executes the Batch's exact registered extractor.
 *
 *   CREATED          -> computes, validates and atomically commits the Candidate set -> READY_FOR_REVIEW
 *   READY_FOR_REVIEW -> re-runs deterministically; identical output returns the committed result
 *                       (`alreadyExtracted: true`); different output is IMPORT_BATCH.NONDETERMINISTIC_OUTPUT
 *   REVIEWING / COMPLETED / CANCELLED -> IMPORT_BATCH.ALREADY_REVIEWING
 *
 *   unknown exact key@version (or unsupported config)  -> IMPORT_BATCH.EXTRACTOR_NOT_FOUND
 *   extractor throws / output fails validation          -> IMPORT_BATCH.INVALID_EXTRACTOR_OUTPUT (nothing written)
 *   Batch already holds manually recorded Candidates    -> IMPORT_BATCH.EXTRACTION_CONFLICT
 */
export async function extractImportBatch(importBatchId: string): Promise<ImportBatchExtractionResult> {
  return extractImportBatchWith(defaultExtractorRegistry, importBatchId);
}

/** The committed extraction of a Batch. A Batch that has not been extracted is IMPORT_BATCH.NOT_EXTRACTED. */
export async function getExtractionResult(importBatchId: string): Promise<ImportBatchExtractionResult> {
  const batch = await requireBatch(importBatchId);
  if (batch.extractionOutputHash === null) throw fail(IMPORT_BATCH_ERROR_CODES.NOT_EXTRACTED, `ImportBatch ${batch.id} has not been extracted`);
  return result(batch.id, true);
}

/** Internal (registry-injectable for tests); the public entry point is `verifyExtractionOutput`. */
export async function verifyExtractionOutputWith(registry: ExtractorRegistry, importBatchId: string): Promise<ImportBatchExtractionVerification> {
  const batch = await requireBatch(importBatchId);
  if (batch.extractionOutputHash === null) throw fail(IMPORT_BATCH_ERROR_CODES.NOT_EXTRACTED, `ImportBatch ${batch.id} has not been extracted`);
  const persistedSetHash = extractionSetHash(await selectStoredCandidateSet(batch.id));
  const { run } = await computeExtraction(registry, batch);
  return {
    importBatchId: batch.id,
    storedOutputHash: batch.extractionOutputHash,
    persistedSetHash,
    recomputedOutputHash: run.outputHash,
    persistedSetMatches: persistedSetHash === batch.extractionOutputHash,
    extractorOutputMatches: run.outputHash === batch.extractionOutputHash,
  };
}

/**
 * Read-only re-verification of a committed extraction: recomputes the hash of the Candidates actually stored AND
 * re-runs the exact extractor over the exact pinned structure, reporting whether each matches the stored hash.
 * Writes nothing.
 */
export async function verifyExtractionOutput(importBatchId: string): Promise<ImportBatchExtractionVerification> {
  return verifyExtractionOutputWith(defaultExtractorRegistry, importBatchId);
}
