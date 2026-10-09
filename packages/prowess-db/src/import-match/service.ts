import {
  DomainError,
  IMPORT_MATCH_ERROR_CODES,
  isUuidString,
  type AnalyzeImportBatchMatchesOptions,
  type AnalyzeImportBatchMatchesResult,
  type CandidateDuplicateGroup,
  type CandidateMatchAssessment,
  type ImportMatchErrorCode,
  type ImportMatchRun,
  type ImportMatchRunWithSummary,
  type JsonObject,
} from "@prowess/model";
import {
  defaultMatcherRegistry,
  ENTITY_MATCHER_KEY,
  ENTITY_MATCHER_VERSION,
  extractionSetHash,
  importMatchRunFingerprint,
  MatchingError,
  runMatching,
  type MatcherRegistry,
  type MatchingRun,
} from "@prowess/import";
import { selectStoredCandidateSet } from "../extraction/repository.js";
import { selectImportBatchById } from "../import-batch/repository.js";
import { getEffectiveManifestEntries } from "../ruleset-inheritance/resolution.js";
import {
  CatalogIntegrityError,
  insertMatchRun,
  selectAssessments,
  selectDuplicateGroups,
  selectEntityCatalog,
  selectMatchCandidates,
  selectRunByFingerprint,
  selectRunById,
  selectRunsForBatch,
  selectRunSummary,
} from "./repository.js";

/**
 * Import identity matching (PAS-10 M3-WO4) — advisory, immutable analysis of which existing Entity, if any, each
 * Candidate of one exact extracted set could represent. Entity Identity Match ≠ Rule Content Agreement.
 *
 * Reads: the Batch's committed Candidates (verified against its extractionOutputHash), Entity identity, aliases, and
 * — only through the approved M2 effective-Manifest resolver and only for the Batch's own exact comparison Manifest —
 * the pinned Version per Entity. Writes: only the five WO4 analysis tables. It never changes a Candidate (status stays
 * UNREVIEWED), never creates an Entity, alias, Version, canonical key, conflict or decision, and never ranks by
 * EntityVersion lifecycle, Canon status or source authority.
 */

const fail = (code: ImportMatchErrorCode, m: string) => new DomainError(code, m);
const OPTION_KEYS = ["matcherKey", "matcherVersion", "matcherConfig"];

async function withSummary(run: ImportMatchRun): Promise<ImportMatchRunWithSummary> {
  return { ...run, ...(await selectRunSummary(run.id)) };
}

/** Internal (registry-injectable for tests); the public entry point is `analyzeImportBatchMatches`. */
export async function analyzeImportBatchMatchesWith(registry: MatcherRegistry, importBatchId: string, options: AnalyzeImportBatchMatchesOptions = {}): Promise<AnalyzeImportBatchMatchesResult> {
  if (typeof options !== "object" || options === null || Object.keys(options).some((k) => !OPTION_KEYS.includes(k))) {
    throw fail(IMPORT_MATCH_ERROR_CODES.INVALID_INPUT, `options accept only ${OPTION_KEYS.join(", ")} (the comparison Manifest always comes from the Batch)`);
  }
  const batch = isUuidString(importBatchId) ? await selectImportBatchById(importBatchId.toLowerCase()) : null;
  if (!batch) throw fail(IMPORT_MATCH_ERROR_CODES.BATCH_NOT_FOUND, `ImportBatch not found: ${importBatchId}`);
  if (batch.extractionOutputHash === null) throw fail(IMPORT_MATCH_ERROR_CODES.BATCH_NOT_EXTRACTED, `ImportBatch ${batch.id} has no committed extraction to match`);

  const candidates = await selectMatchCandidates(batch.id);
  const stored = await selectStoredCandidateSet(batch.id);
  if (extractionSetHash(stored) !== batch.extractionOutputHash) {
    throw fail(IMPORT_MATCH_ERROR_CODES.MATCH_CONFLICT, `ImportBatch ${batch.id}'s stored Candidates no longer reproduce its extractionOutputHash`);
  }

  let comparison: Map<string, string> | null = null;
  if (batch.comparisonManifestId !== null) {
    comparison = new Map((await getEffectiveManifestEntries(batch.comparisonManifestId)).map((e) => [e.entityId as string, e.entityVersionId as string]));
  }
  let catalog;
  try {
    catalog = await selectEntityCatalog(comparison);
  } catch (error) {
    if (error instanceof CatalogIntegrityError) throw fail(IMPORT_MATCH_ERROR_CODES.CATALOG_INTEGRITY_FAILURE, error.message);
    throw error;
  }

  let result: MatchingRun;
  try {
    result = runMatching(registry, options.matcherKey ?? ENTITY_MATCHER_KEY, options.matcherVersion ?? ENTITY_MATCHER_VERSION, options.matcherConfig, candidates, catalog);
  } catch (error) {
    if (error instanceof MatchingError) throw fail(IMPORT_MATCH_ERROR_CODES[error.kind], error.message);
    throw error;
  }
  const runFingerprint = importMatchRunFingerprint({
    importBatchId: batch.id,
    candidateSetHash: batch.extractionOutputHash,
    entityCatalogHash: result.catalogHash,
    comparisonManifestId: batch.comparisonManifestId,
    matcherKey: result.definition.key,
    matcherVersion: result.definition.version,
    matcherConfigHash: result.configHash,
  });

  const existing = await selectRunByFingerprint(runFingerprint);
  if (existing) return { run: await withSummary(compare(existing, result.resultHash)), created: false };

  const inserted = await insertMatchRun(
    {
      importBatchId: batch.id,
      candidateSetHash: batch.extractionOutputHash,
      comparisonManifestId: batch.comparisonManifestId,
      matcherKey: result.definition.key,
      matcherVersion: result.definition.version,
      matcherConfigHash: result.configHash,
      matcherConfig: result.config as unknown as JsonObject,
      entityCatalogHash: result.catalogHash,
      runFingerprint,
      resultHash: result.resultHash,
    },
    result.output,
  );
  if (inserted === "DUPLICATE") {
    const winner = await selectRunByFingerprint(runFingerprint);
    if (!winner) throw fail(IMPORT_MATCH_ERROR_CODES.MATCH_CONFLICT, `MatchRun ${runFingerprint} collided but could not be read back`);
    return { run: await withSummary(compare(winner, result.resultHash)), created: false };
  }
  return { run: await withSummary((await selectRunById(inserted)) as ImportMatchRun), created: true };
}

function compare(run: ImportMatchRun, resultHash: string): ImportMatchRun {
  if (run.resultHash !== resultHash) {
    throw fail(IMPORT_MATCH_ERROR_CODES.NONDETERMINISTIC_RESULT, `MatchRun ${run.id} stored result ${run.resultHash}, but the same exact context now yields ${resultHash}; the stored run is unchanged`);
  }
  return run;
}

/**
 * Analyses the Batch's committed Candidate set against the current Entity identity catalog (and the Batch's own exact
 * comparison Manifest, if any). Identical context -> the existing run (`created: false`); a changed catalog, matcher
 * version or config -> a new, separate run. Earlier runs are never rewritten.
 */
export async function analyzeImportBatchMatches(importBatchId: string, options: AnalyzeImportBatchMatchesOptions = {}): Promise<AnalyzeImportBatchMatchesResult> {
  return analyzeImportBatchMatchesWith(defaultMatcherRegistry, importBatchId, options);
}

async function requireRun(id: string): Promise<ImportMatchRun> {
  const run = isUuidString(id) ? await selectRunById(id.toLowerCase()) : null;
  if (!run) throw fail(IMPORT_MATCH_ERROR_CODES.NOT_FOUND, `ImportMatchRun not found: ${id}`);
  return run;
}

export async function getImportMatchRun(matchRunId: string): Promise<ImportMatchRunWithSummary> {
  return withSummary(await requireRun(matchRunId));
}

/** Every run of a Batch in creation (history) order. Review must explicitly choose which run it uses. */
export async function listImportMatchRuns(importBatchId: string): Promise<ImportMatchRun[]> {
  const batch = isUuidString(importBatchId) ? await selectImportBatchById(importBatchId.toLowerCase()) : null;
  if (!batch) throw fail(IMPORT_MATCH_ERROR_CODES.BATCH_NOT_FOUND, `ImportBatch not found: ${importBatchId}`);
  return selectRunsForBatch(batch.id);
}

export async function listCandidateMatchAssessments(matchRunId: string): Promise<CandidateMatchAssessment[]> {
  const run = await requireRun(matchRunId);
  return selectAssessments(run.id);
}

export async function getCandidateMatchAssessment(matchRunId: string, extractionCandidateId: string): Promise<CandidateMatchAssessment> {
  const run = await requireRun(matchRunId);
  const [assessment] = isUuidString(extractionCandidateId) ? await selectAssessments(run.id, extractionCandidateId.toLowerCase()) : [];
  if (!assessment) throw fail(IMPORT_MATCH_ERROR_CODES.NOT_FOUND, `No assessment of Candidate ${extractionCandidateId} in MatchRun ${run.id}`);
  return assessment;
}

export async function listCandidateDuplicateGroups(matchRunId: string): Promise<CandidateDuplicateGroup[]> {
  const run = await requireRun(matchRunId);
  return selectDuplicateGroups(run.id);
}
