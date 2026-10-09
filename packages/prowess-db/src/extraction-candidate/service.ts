import {
  DomainError,
  EXTRACTION_CANDIDATE_ERROR_CODES,
  isUuidString,
  MAX_CANDIDATES_PER_CALL,
  validateCreateExtractionCandidateInput,
  type CreateExtractionCandidateInput,
  type ExtractionCandidate,
  type ExtractionSourceAnchorInput,
  type ImportBatch,
} from "@prowess/model";
import { canonicalJson, CanonicalJsonError, extractionCandidateFingerprint, isAnchorInScope, sectionSubtree } from "@prowess/import";
import { requireBatch } from "../import-batch/service.js";
import {
  insertCandidates,
  selectAnchorNodes,
  selectAnchorSections,
  selectCandidateById,
  selectCandidatesByFingerprints,
  selectCandidatesByOrdinals,
  selectCandidatesForBatch,
  selectSectionLinks,
  type AnchorNode,
  type AnchorSection,
  type PreparedCandidate,
} from "./repository.js";

/**
 * ExtractionCandidate service (PAS-10 M3-WO2) — records immutable extraction PROPOSALS with exact provenance.
 *
 * It stores what it is handed and nothing more: no semantic interpretation, no Entity lookup or matching, no
 * conflict detection, no decision. Every Candidate is written UNREVIEWED (callers cannot supply a status), never
 * changes afterwards in WO2, and cannot be deleted. Recording a Candidate never creates or changes an Entity,
 * EntityVersion, Keyword, relationship, Ruleset, Manifest, Canon policy, conflict, decision, ChangeSet, Release or
 * MigrationPlan, and never reads source authority.
 */

export interface RecordExtractionCandidatesResult {
  /** The Candidates of this call, in ordinal order — newly created and idempotently reused alike. */
  candidates: ExtractionCandidate[];
  createdCount: number;
  reusedCount: number;
}

const invalidAnchor = (m: string) => new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_SOURCE_ANCHOR, m);

interface Resolved {
  sectionId: string | null;
  contentNodeId: string | null;
  excerpt: string | null;
}

/**
 * Records a group of Candidates against one Batch — atomically: if any Candidate is invalid, out of scope or in
 * conflict, NONE of this call's new Candidates persist.
 *
 *   Batch does not exist                                            -> IMPORT_BATCH.NOT_FOUND
 *   shape / forbidden fields (status, fingerprint, sourceSnapshotId) -> EXTRACTION_CANDIDATE.INVALID_INPUT
 *   anchor missing / of another Snapshot / non-verbatim excerpt     -> EXTRACTION_CANDIDATE.INVALID_SOURCE_ANCHOR
 *   anchor outside the Batch's section subtree                       -> EXTRACTION_CANDIDATE.OUTSIDE_BATCH_SCOPE
 *   ordinal owned by a different Candidate (stored or in this call)  -> EXTRACTION_CANDIDATE.ORDINAL_CONFLICT
 *   same content already recorded under another ordinal / summary   -> EXTRACTION_CANDIDATE.CANDIDATE_CONFLICT
 *   exactly the same Candidate again (concurrently or not)           -> reused, not duplicated
 */
export async function recordExtractionCandidates(importBatchId: string, candidates: CreateExtractionCandidateInput[]): Promise<RecordExtractionCandidatesResult> {
  const batch = await requireBatch(importBatchId);
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > MAX_CANDIDATES_PER_CALL) {
    throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, `candidates must be a non-empty array of at most ${MAX_CANDIDATES_PER_CALL}`);
  }
  candidates.forEach((c, i) => validateCreateExtractionCandidateInput(c, `candidates[${i}]`));

  const prepared = await prepare(batch, candidates);
  const unique = collapseWithinCall(prepared);

  const first = await classifyAgainstStored(batch.id, unique);
  if (first.toCreate.length > 0) {
    const outcome = await insertCandidates(batch.id, batch.sourceSnapshotId, first.toCreate);
    if (outcome === "UNIQUE_RACE") {
      // A concurrent call recorded some of these first. Re-evaluate: identical content is reused, anything else is a
      // conflict. Nothing of this attempt was written (the transaction rolled back), so retrying is safe.
      const second = await classifyAgainstStored(batch.id, unique);
      if (second.toCreate.length > 0) {
        const retry = await insertCandidates(batch.id, batch.sourceSnapshotId, second.toCreate);
        if (retry === "UNIQUE_RACE") throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.CANDIDATE_CONFLICT, "Candidates of this Batch are being recorded concurrently with conflicting content; nothing was written");
      }
      return finish(batch.id, unique, second.toCreate.length);
    }
  }
  return finish(batch.id, unique, first.toCreate.length);
}

async function finish(importBatchId: string, unique: readonly PreparedCandidate[], createdCount: number): Promise<RecordExtractionCandidatesResult> {
  const stored = await selectCandidatesByFingerprints(importBatchId, unique.map((c) => c.candidateFingerprint));
  stored.sort((a, b) => a.ordinal - b.ordinal);
  return { candidates: stored, createdCount, reusedCount: unique.length - createdCount };
}

/** Resolves and verifies every anchor (existence, Snapshot, scope, verbatim excerpt) and computes fingerprints. */
async function prepare(batch: ImportBatch, candidates: readonly CreateExtractionCandidateInput[]): Promise<PreparedCandidate[]> {
  const allAnchors = candidates.flatMap((c) => [c.primarySourceAnchor, ...(c.supportingSourceAnchors ?? [])]);
  const sectionIds = [...new Set(allAnchors.map((a) => a.sectionId).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()))];
  const nodeIds = [...new Set(allAnchors.map((a) => a.contentNodeId).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()))];
  for (const id of [...sectionIds, ...nodeIds]) if (!isUuidString(id)) throw invalidAnchor(`anchor id ${id} is not a valid id`);

  const [sections, nodes, links] = await Promise.all([
    selectAnchorSections(sectionIds),
    selectAnchorNodes(nodeIds),
    batch.scopeType === "SECTION_SUBTREE" ? selectSectionLinks(batch.sourceSnapshotId) : Promise.resolve([]),
  ]);
  const sectionById = new Map<string, AnchorSection>(sections.map((s) => [s.id, s]));
  const nodeById = new Map<string, AnchorNode>(nodes.map((n) => [n.id, n]));
  const scope = batch.scopeType === "SECTION_SUBTREE" ? { type: "SECTION_SUBTREE" as const, subtree: sectionSubtree(batch.scopeSectionId as string, links) } : { type: "SNAPSHOT" as const };

  const resolve = (anchor: ExtractionSourceAnchorInput, where: string): Resolved => {
    const excerpt = anchor.excerpt ?? null;
    if (typeof anchor.sectionId === "string") {
      const id = anchor.sectionId.toLowerCase();
      const section = sectionById.get(id);
      if (!section) throw invalidAnchor(`${where}: SourceSection ${anchor.sectionId} does not exist`);
      if (section.sourceSnapshotId !== batch.sourceSnapshotId) throw invalidAnchor(`${where}: SourceSection ${id} belongs to another Snapshot than the Batch's`);
      if (!isAnchorInScope({ kind: "SECTION", sectionId: id }, scope)) throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.OUTSIDE_BATCH_SCOPE, `${where}: SourceSection ${id} is outside the Batch's section-subtree scope`);
      if (excerpt !== null && !section.title.includes(excerpt)) throw invalidAnchor(`${where}: the excerpt is not verbatim text of the anchored section's title`);
      return { sectionId: id, contentNodeId: null, excerpt };
    }
    const id = (anchor.contentNodeId as string).toLowerCase();
    const node = nodeById.get(id);
    if (!node) throw invalidAnchor(`${where}: SourceContentNode ${anchor.contentNodeId} does not exist`);
    if (node.sourceSnapshotId !== batch.sourceSnapshotId) throw invalidAnchor(`${where}: SourceContentNode ${id} belongs to another Snapshot than the Batch's`);
    if (!isAnchorInScope({ kind: "CONTENT_NODE", sectionId: node.sourceSectionId }, scope)) throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.OUTSIDE_BATCH_SCOPE, `${where}: SourceContentNode ${id} is outside the Batch's section-subtree scope`);
    if (excerpt !== null && !node.texts.some((t) => t.includes(excerpt))) throw invalidAnchor(`${where}: the excerpt is not verbatim text of the anchored ${node.nodeType.toLowerCase()} (excerpts are never paraphrased)`);
    return { sectionId: null, contentNodeId: id, excerpt };
  };

  return candidates.map((c, i) => {
    const where = `candidates[${i}]`;
    const primary = resolve(c.primarySourceAnchor, `${where}.primarySourceAnchor`);
    const supporting = (c.supportingSourceAnchors ?? []).map((a, j) => resolve(a, `${where}.supportingSourceAnchors[${j}]`));
    let payload;
    try {
      payload = JSON.parse(canonicalJson(c.payloadJson)) as typeof c.payloadJson; // a plain, canonical JSON copy
    } catch (error) {
      if (error instanceof CanonicalJsonError) throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, `${where}.payloadJson: ${error.message}`);
      throw error;
    }
    const base = {
      candidateKind: c.candidateKind,
      proposedEntityType: c.proposedEntityType ?? null,
      proposedCanonicalKey: c.proposedCanonicalKey ?? null,
      displayLabel: c.displayLabel,
      confidence: c.confidence,
      payloadSchemaKey: c.payloadSchemaKey,
      payloadSchemaVersion: c.payloadSchemaVersion,
      payload,
    };
    const candidateFingerprint = extractionCandidateFingerprint({
      ...base,
      primaryAnchor: primary,
      supportingAnchors: supporting,
    });
    return {
      ...base,
      ordinal: c.ordinal,
      summary: c.summary ?? null,
      candidateFingerprint,
      primarySourceSectionId: primary.sectionId,
      primarySourceContentNodeId: primary.contentNodeId,
      supporting: supporting.map((s) => ({ sourceSectionId: s.sectionId, sourceContentNodeId: s.contentNodeId, excerpt: s.excerpt })),
    };
  });
}

/** Within one call: exact repeats collapse; a shared ordinal or a shared fingerprint with any difference is a conflict. */
function collapseWithinCall(prepared: readonly PreparedCandidate[]): PreparedCandidate[] {
  const byOrdinal = new Map<number, PreparedCandidate>();
  const byFingerprint = new Map<string, PreparedCandidate>();
  const out: PreparedCandidate[] = [];
  for (const c of prepared) {
    const sameOrdinal = byOrdinal.get(c.ordinal);
    if (sameOrdinal && sameOrdinal.candidateFingerprint !== c.candidateFingerprint) {
      throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.ORDINAL_CONFLICT, `ordinal ${c.ordinal} is given to two different Candidates in this call`);
    }
    const sameContent = byFingerprint.get(c.candidateFingerprint);
    if (sameContent && (sameContent.ordinal !== c.ordinal || sameContent.summary !== c.summary)) {
      throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.CANDIDATE_CONFLICT, `the same extracted content appears twice in this call with a different ordinal or summary (ordinals ${sameContent.ordinal} and ${c.ordinal})`);
    }
    if (sameContent) continue;
    byOrdinal.set(c.ordinal, c);
    byFingerprint.set(c.candidateFingerprint, c);
    out.push(c);
  }
  return out;
}

/** Compares against what the Batch already holds: identical -> reuse, ordinal / content clash -> conflict. */
async function classifyAgainstStored(importBatchId: string, unique: readonly PreparedCandidate[]): Promise<{ toCreate: PreparedCandidate[] }> {
  const [byFingerprint, byOrdinal] = await Promise.all([
    selectCandidatesByFingerprints(importBatchId, unique.map((c) => c.candidateFingerprint)),
    selectCandidatesByOrdinals(importBatchId, unique.map((c) => c.ordinal)),
  ]);
  const storedByFingerprint = new Map(byFingerprint.map((s) => [s.candidateFingerprint, s]));
  const storedByOrdinal = new Map(byOrdinal.map((s) => [s.ordinal, s]));
  const toCreate: PreparedCandidate[] = [];
  for (const c of unique) {
    const sameContent = storedByFingerprint.get(c.candidateFingerprint);
    if (sameContent) {
      if (sameContent.ordinal !== c.ordinal || sameContent.summary !== c.summary) {
        throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.CANDIDATE_CONFLICT, `the same extracted content is already recorded in this Batch as Candidate ${sameContent.id} (ordinal ${sameContent.ordinal}); it is never overwritten`);
      }
      continue; // exactly the same Candidate: reuse
    }
    const sameOrdinal = storedByOrdinal.get(c.ordinal);
    if (sameOrdinal) {
      throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.ORDINAL_CONFLICT, `ordinal ${c.ordinal} is already owned by a different Candidate (${sameOrdinal.id}) of this Batch; nothing is renumbered`);
    }
    toCreate.push(c);
  }
  return { toCreate };
}

/** A Candidate with its supporting anchors. A malformed id is NOT_FOUND. */
export async function getExtractionCandidate(id: string): Promise<ExtractionCandidate> {
  const candidate = isUuidString(id) ? await selectCandidateById(id.toLowerCase()) : null;
  if (!candidate) throw new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.NOT_FOUND, `ExtractionCandidate not found: ${id}`);
  return candidate;
}

/** Every Candidate of a Batch, `ordinal ASC, id ASC`. The Batch must exist. */
export async function listExtractionCandidates(importBatchId: string): Promise<ExtractionCandidate[]> {
  const batch = await requireBatch(importBatchId);
  return selectCandidatesForBatch(batch.id);
}
