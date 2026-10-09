import {
  ExtractionCandidateId,
  ExtractionCandidateSourceId,
  ImportBatchId,
  INITIAL_EXTRACTION_CANDIDATE_STATUS,
  SourceContentNodeId,
  SourceSectionId,
  SourceSnapshotId,
  type EntityType,
  type ExtractionCandidate,
  type ExtractionCandidateKind,
  type ExtractionCandidateStatus,
  type ExtractionConfidence,
  type JsonObject,
  type SourceTableStructure,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { ExtractionCandidate as CandidateRow, ExtractionCandidateSource as SourceRow, Prisma } from "../../generated/prisma/client.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * ExtractionCandidate repository (PAS-10 M3-WO2). Internal to @prowess/db. WRITES only `extraction_candidates` and
 * `extraction_candidate_sources`, only by INSERT, always with status UNREVIEWED, all Candidates of one call in ONE
 * transaction. Reads source structure (sections / content nodes and their text) only to verify anchors.
 */
export const CANDIDATE_ORDINAL_UNIQUE = "extraction_candidates_batch_ordinal_key";
export const CANDIDATE_FINGERPRINT_UNIQUE = "extraction_candidates_batch_fingerprint_key";
const CHUNK = 5_000;

type CandidateWithSources = CandidateRow & { supportingSources: SourceRow[] };

export function toDomainCandidate(row: CandidateWithSources): ExtractionCandidate {
  return {
    id: ExtractionCandidateId.of(row.id),
    importBatchId: ImportBatchId.of(row.importBatchId),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    ordinal: row.ordinal,
    candidateKind: row.candidateKind as ExtractionCandidateKind,
    proposedEntityType: row.proposedEntityType as EntityType | null,
    proposedCanonicalKey: row.proposedCanonicalKey,
    displayLabel: row.displayLabel,
    summary: row.summary,
    confidence: row.confidence as ExtractionConfidence,
    status: row.status as ExtractionCandidateStatus,
    payloadSchemaKey: row.payloadSchemaKey,
    payloadSchemaVersion: row.payloadSchemaVersion,
    payload: row.payloadJson as JsonObject,
    candidateFingerprint: row.candidateFingerprint,
    primarySourceSectionId: row.primarySourceSectionId === null ? null : SourceSectionId.of(row.primarySourceSectionId),
    primarySourceContentNodeId: row.primarySourceContentNodeId === null ? null : SourceContentNodeId.of(row.primarySourceContentNodeId),
    supportingSources: [...row.supportingSources]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({
        id: ExtractionCandidateSourceId.of(s.id),
        extractionCandidateId: ExtractionCandidateId.of(s.extractionCandidateId),
        sourceSnapshotId: SourceSnapshotId.of(s.sourceSnapshotId),
        sourceSectionId: s.sourceSectionId === null ? null : SourceSectionId.of(s.sourceSectionId),
        sourceContentNodeId: s.sourceContentNodeId === null ? null : SourceContentNodeId.of(s.sourceContentNodeId),
        ordinal: s.ordinal,
        excerpt: s.excerpt,
        createdAt: s.createdAt,
      })),
    createdAt: row.createdAt,
  };
}


async function chunked<T>(ids: readonly string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await load(ids.slice(i, i + CHUNK))));
  return out;
}

/**
 * Attaches supporting sources with a separate, chunked read rather than a relational `include`, which would put every
 * candidate id into one statement and exceed PostgreSQL's bind-parameter limit for a large Batch (the WO1 lesson).
 */
async function withSources(rows: CandidateRow[]): Promise<ExtractionCandidate[]> {
  const sources = await chunked(rows.map((r) => r.id), (chunk) => prisma.extractionCandidateSource.findMany({ where: { extractionCandidateId: { in: chunk } } }));
  const byCandidate = new Map<string, SourceRow[]>();
  for (const s of sources) byCandidate.set(s.extractionCandidateId, [...(byCandidate.get(s.extractionCandidateId) ?? []), s]);
  return rows.map((r) => toDomainCandidate({ ...r, supportingSources: byCandidate.get(r.id) ?? [] }));
}

// ---- anchor targets (reads of WO1 structure) --------------------------------------------------------------------

export interface AnchorSection {
  id: string;
  sourceSnapshotId: string;
  title: string;
}
export interface AnchorNode {
  id: string;
  sourceSnapshotId: string;
  sourceSectionId: string | null;
  nodeType: string;
  /** Verbatim texts an excerpt may be taken from (block raw text; table raw text and every cell's raw text). */
  texts: string[];
}

export async function selectAnchorSections(ids: readonly string[]): Promise<AnchorSection[]> {
  return chunked(ids, (chunk) => prisma.sourceSection.findMany({ where: { id: { in: chunk } }, select: { id: true, sourceSnapshotId: true, title: true } }));
}

function cellTexts(structure: SourceTableStructure): string[] {
  return structure.rows.flatMap((r) => r.cells.flatMap((c) => [c.rawText, ...c.nestedTables.flatMap(cellTexts)]));
}

export async function selectAnchorNodes(ids: readonly string[]): Promise<AnchorNode[]> {
  const rows = await chunked(ids, (chunk) =>
    prisma.sourceContentNode.findMany({
      where: { id: { in: chunk } },
      select: { id: true, sourceSnapshotId: true, sourceSectionId: true, nodeType: true, block: { select: { rawText: true } }, table: { select: { rawText: true, structureJson: true } } },
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    sourceSnapshotId: r.sourceSnapshotId,
    sourceSectionId: r.sourceSectionId,
    nodeType: r.nodeType,
    texts: r.block ? [r.block.rawText] : r.table ? [...(r.table.rawText === null ? [] : [r.table.rawText]), ...cellTexts(r.table.structureJson as unknown as SourceTableStructure)] : [],
  }));
}

export async function selectSectionLinks(sourceSnapshotId: string): Promise<Array<{ id: string; parentSectionId: string | null }>> {
  return prisma.sourceSection.findMany({ where: { sourceSnapshotId }, select: { id: true, parentSectionId: true } });
}

// ---- candidates ---------------------------------------------------------------------------------------------------

export async function selectCandidatesByFingerprints(importBatchId: string, fingerprints: readonly string[]): Promise<ExtractionCandidate[]> {
  return withSources(await chunked(fingerprints, (chunk) => prisma.extractionCandidate.findMany({ where: { importBatchId, candidateFingerprint: { in: chunk } } })));
}

export async function selectCandidatesByOrdinals(importBatchId: string, ordinals: readonly number[]): Promise<ExtractionCandidate[]> {
  const out: CandidateRow[] = [];
  for (let i = 0; i < ordinals.length; i += CHUNK) out.push(...(await prisma.extractionCandidate.findMany({ where: { importBatchId, ordinal: { in: ordinals.slice(i, i + CHUNK) } } })));
  return withSources(out);
}

export interface PreparedCandidate {
  ordinal: number;
  candidateKind: ExtractionCandidateKind;
  proposedEntityType: EntityType | null;
  proposedCanonicalKey: string | null;
  displayLabel: string;
  summary: string | null;
  confidence: ExtractionConfidence;
  payloadSchemaKey: string;
  payloadSchemaVersion: number;
  payload: JsonObject;
  candidateFingerprint: string;
  primarySourceSectionId: string | null;
  primarySourceContentNodeId: string | null;
  supporting: Array<{ sourceSectionId: string | null; sourceContentNodeId: string | null; excerpt: string | null }>;
}

/**
 * Inserts every prepared Candidate (and its supporting anchors) in ONE transaction — all or nothing. Returns
 * "UNIQUE_RACE" when a concurrent call took one of the (batch, ordinal) / (batch, fingerprint) keys first; nothing
 * of this call is then written and the service re-evaluates against the database.
 */
export async function insertCandidates(importBatchId: string, sourceSnapshotId: string, prepared: readonly PreparedCandidate[]): Promise<"OK" | "UNIQUE_RACE"> {
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const c of prepared) {
          const created = await tx.extractionCandidate.create({
            data: {
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
            },
            select: { id: true },
          });
          if (c.supporting.length > 0) {
            await tx.extractionCandidateSource.createMany({
              data: c.supporting.map((s, i) => ({ extractionCandidateId: created.id, sourceSnapshotId, ordinal: i + 1, ...s })),
            });
          }
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    return "OK";
  } catch (error) {
    if (isUniqueViolation(error, { constraint: CANDIDATE_ORDINAL_UNIQUE, fields: ["import_batch_id", "ordinal"] })) return "UNIQUE_RACE";
    if (isUniqueViolation(error, { constraint: CANDIDATE_FINGERPRINT_UNIQUE, fields: ["import_batch_id", "candidate_fingerprint"] })) return "UNIQUE_RACE";
    throw error;
  }
}

export async function selectCandidateById(id: string): Promise<ExtractionCandidate | null> {
  const row = await prisma.extractionCandidate.findUnique({ where: { id } });
  return row ? ((await withSources([row]))[0] as ExtractionCandidate) : null;
}

/** `ordinal ASC, id ASC` — extractor output / review order, never priority or authority. */
export async function selectCandidatesForBatch(importBatchId: string): Promise<ExtractionCandidate[]> {
  return withSources(await prisma.extractionCandidate.findMany({ where: { importBatchId }, orderBy: [{ ordinal: "asc" }, { id: "asc" }] }));
}
