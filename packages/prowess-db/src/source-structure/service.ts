import { createHash } from "node:crypto";
import {
  canonicalSourceStructureJson,
  DomainError,
  SOURCE_ASSET_ERROR_CODES,
  SOURCE_SNAPSHOT_ERROR_CODES,
  SOURCE_STRUCTURE_ERROR_CODES,
  validateSourceStructureInput,
  type ResolvedSourceContentNode,
  type SourceAsset,
  type SourceAssetPlacement,
  type SourceBlock,
  type SourceSection,
  type SourceSnapshotIngestion,
  type SourceStructure,
  type SourceStructureInput,
  type SourceTable,
} from "@prowess/model";
import { getSourceSnapshot } from "../source-snapshot/service.js";
import {
  insertSnapshotStructure,
  selectAssetById,
  selectAssets,
  selectBlockById,
  selectChildSections,
  selectIngestion,
  selectPlacementsForAsset,
  selectResolvedNodes,
  selectSectionById,
  selectSections,
  selectTableById,
} from "./repository.js";

/**
 * Source structure service (PAS-10 M3-WO1) — the public boundary for a Snapshot's structural ingestion and reads.
 *
 * Structural ingestion records what a source says and where it says it: sections, verbatim text blocks, structured
 * tables and explicit asset placements, in their original order. It never interprets prose into Prowess rules,
 * never creates or changes an Entity / EntityVersion, and never touches Rulesets, Canon policy, conflicts,
 * decisions, ChangeSets or Releases.
 */

/** SHA-256 of a structure's canonical JSON — identical structures always hash identically. */
export function hashSourceStructure(input: SourceStructureInput): string {
  return createHash("sha256").update(canonicalSourceStructureJson(input), "utf8").digest("hex");
}

export interface IngestSourceStructureResult {
  ingestion: SourceSnapshotIngestion;
  /** false when the Snapshot already held this exact structure and nothing was written. */
  created: boolean;
}

/**
 * Ingests `input` as the structure of Snapshot `sourceSnapshotId` — once, atomically, forever.
 *
 *   - the Snapshot must exist                                         -> SOURCE_SNAPSHOT.NOT_FOUND
 *   - the structure must be valid                                     -> SOURCE_STRUCTURE.* (see validateSourceStructureInput)
 *   - Snapshot already ingested with the SAME structure hash          -> returns it, `created: false` (safely repeatable)
 *   - Snapshot already ingested with a DIFFERENT structure            -> SOURCE_SNAPSHOT.IMMUTABLE (nothing written)
 *
 * Race-safe: the "already ingested?" decision is the database's unique key on the ingestion record, inserted first
 * inside the same transaction as the structure, so concurrent ingestions cannot both write.
 */
export async function ingestSourceStructure(sourceSnapshotId: string, input: SourceStructureInput): Promise<IngestSourceStructureResult> {
  await getSourceSnapshot(sourceSnapshotId);
  validateSourceStructureInput(input);
  const structureHash = hashSourceStructure(input);

  const existing = await selectIngestion(sourceSnapshotId);
  if (existing) return compareWithExisting(existing, structureHash);

  const result = await insertSnapshotStructure(sourceSnapshotId, input, structureHash);
  if (result === "ALREADY_INGESTED") {
    const winner = await selectIngestion(sourceSnapshotId);
    if (!winner) throw new Error(`Snapshot ${sourceSnapshotId} reported as ingested but has no ingestion record`);
    return compareWithExisting(winner, structureHash);
  }
  return { ingestion: result.ingestion, created: true };
}

function compareWithExisting(existing: SourceSnapshotIngestion, structureHash: string): IngestSourceStructureResult {
  if (existing.structureHash !== structureHash) {
    throw new DomainError(
      SOURCE_SNAPSHOT_ERROR_CODES.IMMUTABLE,
      `SourceSnapshot ${existing.sourceSnapshotId} already has an ingested structure (${existing.structureHash}); a Snapshot's structure is immutable — changed source bytes need a new Snapshot`,
    );
  }
  return { ingestion: existing, created: false };
}

/** The ingestion record of a Snapshot, or null if its structure has not been ingested. */
export async function getSourceSnapshotIngestion(sourceSnapshotId: string): Promise<SourceSnapshotIngestion | null> {
  await getSourceSnapshot(sourceSnapshotId);
  return selectIngestion(sourceSnapshotId);
}

/** The whole structure of one Snapshot, in document order. Re-reading an older Snapshot returns identical content. */
export async function getSourceStructure(sourceSnapshotId: string): Promise<SourceStructure> {
  const snapshot = await getSourceSnapshot(sourceSnapshotId);
  const [ingestion, sections, assets, nodes] = await Promise.all([
    selectIngestion(sourceSnapshotId),
    selectSections(sourceSnapshotId),
    selectAssets(sourceSnapshotId),
    selectResolvedNodes({ sourceSnapshotId }),
  ]);
  return { snapshot, ingestion, sections, assets, nodes };
}

const notFound = (what: string, id: string) => new DomainError(SOURCE_STRUCTURE_ERROR_CODES.NOT_FOUND, `${what} not found: ${id}`);

export async function getSourceSection(id: string): Promise<SourceSection> {
  const section = await selectSectionById(id);
  if (!section) throw notFound("SourceSection", id);
  return section;
}

/** Direct child sections of a section, in document order. */
export async function listSourceSectionChildren(sectionId: string): Promise<SourceSection[]> {
  await getSourceSection(sectionId);
  return selectChildSections(sectionId);
}

/** The content nodes directly inside a section (not its sub-sections), in document order. */
export async function getSourceSectionContent(sectionId: string): Promise<ResolvedSourceContentNode[]> {
  const section = await getSourceSection(sectionId);
  return selectResolvedNodes({ sourceSnapshotId: section.sourceSnapshotId, sourceSectionId: section.id });
}

export async function getSourceBlock(id: string): Promise<SourceBlock> {
  const block = await selectBlockById(id);
  if (!block) throw notFound("SourceBlock", id);
  return block;
}

export async function getSourceTable(id: string): Promise<SourceTable> {
  const table = await selectTableById(id);
  if (!table) throw notFound("SourceTable", id);
  return table;
}

export async function getSourceAsset(id: string): Promise<SourceAsset> {
  const asset = await selectAssetById(id);
  if (!asset) throw new DomainError(SOURCE_ASSET_ERROR_CODES.NOT_FOUND, `SourceAsset not found: ${id}`);
  return asset;
}

/** Every placement of an asset, in document order. */
export async function listSourceAssetPlacements(sourceAssetId: string): Promise<SourceAssetPlacement[]> {
  await getSourceAsset(sourceAssetId);
  return selectPlacementsForAsset(sourceAssetId);
}

/** Every asset of a Snapshot, in order of first appearance. */
export async function listSourceAssets(sourceSnapshotId: string): Promise<SourceAsset[]> {
  await getSourceSnapshot(sourceSnapshotId);
  return selectAssets(sourceSnapshotId);
}
