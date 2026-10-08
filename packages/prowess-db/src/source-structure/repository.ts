import { randomUUID } from "node:crypto";
import {
  SourceAssetId,
  SourceAssetPlacementId,
  SourceBlockId,
  SourceContentNodeId,
  SourceSectionId,
  SourceSnapshotId,
  SourceSnapshotIngestionId,
  SourceTableId,
  type ResolvedSourceContentNode,
  type SourceAsset,
  type SourceAssetPlacement,
  type SourceAssetType,
  type SourceBlock,
  type SourceBlockType,
  type SourceContentNode,
  type SourceContentNodeType,
  type SourcePageLocationBasis,
  type SourceSection,
  type SourceSnapshotIngestion,
  type SourceStructureInput,
  type SourceTable,
  type SourceTableStructure,
} from "@prowess/model";
import { prisma } from "../client.js";
import type {
  Prisma,
  SourceAsset as AssetRow,
  SourceAssetPlacement as PlacementRow,
  SourceBlock as BlockRow,
  SourceContentNode as NodeRow,
  SourceSection as SectionRow,
  SourceSnapshotIngestion as IngestionRow,
  SourceTable as TableRow,
} from "../../generated/prisma/client.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * Source structure repository (PAS-10 M3-WO1). Internal to @prowess/db.
 *
 * WRITES only the approved source-structure tables — source_snapshot_ingestions, source_sections, source_blocks,
 * source_tables, source_assets, source_asset_placements, source_content_nodes — and only by INSERT, all inside ONE
 * transaction per Snapshot. It never updates or deletes a row, and never touches an Entity, EntityVersion, Ruleset,
 * Manifest, CanonPolicy, Release, conflict, decision or ChangeSet (pinned by the M3 static audit).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Constraint fixed by migration 20261011010000_add_source_structure. */
export const INGESTION_SNAPSHOT_UNIQUE = "source_snapshot_ingestions_snapshot_key";

/** Large documents write tens of thousands of rows in one transaction; give it room (default is 5s). */
const INGESTION_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 300_000 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------------------------------------------

export function toDomainIngestion(row: IngestionRow): SourceSnapshotIngestion {
  return {
    id: SourceSnapshotIngestionId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    parserName: row.parserName,
    parserVersion: row.parserVersion,
    structureHash: row.structureHash,
    sectionCount: row.sectionCount,
    nodeCount: row.nodeCount,
    createdAt: row.createdAt,
  };
}

const sectionIdOrNull = (v: string | null) => (v === null ? null : SourceSectionId.of(v));

export function toDomainSection(row: SectionRow): SourceSection {
  return {
    id: SourceSectionId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    parentSectionId: sectionIdOrNull(row.parentSectionId),
    title: row.title,
    headingLevel: row.headingLevel,
    ordinal: row.ordinal,
    startPage: row.startPage,
    endPage: row.endPage,
    pageLocationBasis: row.pageLocationBasis as SourcePageLocationBasis,
    createdAt: row.createdAt,
  };
}

export function toDomainBlock(row: BlockRow): SourceBlock {
  return {
    id: SourceBlockId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    sourceSectionId: sectionIdOrNull(row.sourceSectionId),
    blockType: row.blockType as SourceBlockType,
    ordinal: row.ordinal,
    rawText: row.rawText,
    normalizedText: row.normalizedText,
    sourceStyle: row.sourceStyle,
    listLevel: row.listLevel,
    listOrdered: row.listOrdered,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    pageLocationBasis: row.pageLocationBasis as SourcePageLocationBasis,
    createdAt: row.createdAt,
  };
}

export function toDomainTable(row: TableRow): SourceTable {
  return {
    id: SourceTableId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    sourceSectionId: sectionIdOrNull(row.sourceSectionId),
    ordinal: row.ordinal,
    caption: row.caption,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    pageLocationBasis: row.pageLocationBasis as SourcePageLocationBasis,
    structure: row.structureJson as unknown as SourceTableStructure,
    rawText: row.rawText,
    createdAt: row.createdAt,
  };
}

export function toDomainAsset(row: AssetRow): SourceAsset {
  return {
    id: SourceAssetId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    assetType: row.assetType as SourceAssetType,
    mimeType: row.mimeType,
    contentHash: row.contentHash,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    sourceFilename: row.sourceFilename,
    caption: row.caption,
    altTextFromSource: row.altTextFromSource,
    createdAt: row.createdAt,
  };
}

export function toDomainPlacement(row: PlacementRow): SourceAssetPlacement {
  return {
    id: SourceAssetPlacementId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    sourceAssetId: SourceAssetId.of(row.sourceAssetId),
    sourceSectionId: sectionIdOrNull(row.sourceSectionId),
    ordinal: row.ordinal,
    pageNumber: row.pageNumber,
    pageLocationBasis: row.pageLocationBasis as SourcePageLocationBasis,
    altTextFromSource: row.altTextFromSource,
    createdAt: row.createdAt,
  };
}

function toDomainNode(row: NodeRow): SourceContentNode {
  return {
    id: SourceContentNodeId.of(row.id),
    sourceSnapshotId: SourceSnapshotId.of(row.sourceSnapshotId),
    sourceSectionId: sectionIdOrNull(row.sourceSectionId),
    ordinal: row.ordinal,
    nodeType: row.nodeType as SourceContentNodeType,
    blockId: row.blockId === null ? null : SourceBlockId.of(row.blockId),
    tableId: row.tableId === null ? null : SourceTableId.of(row.tableId),
    assetPlacementId: row.assetPlacementId === null ? null : SourceAssetPlacementId.of(row.assetPlacementId),
  };
}

type NodeWithTargets = NodeRow & { block: BlockRow | null; table: TableRow | null; assetPlacement: (PlacementRow & { sourceAsset: AssetRow }) | null };

/** Resolves a node and its single target. A node whose target is missing is corrupt data — fail loudly. */
function resolveNode(row: NodeWithTargets): ResolvedSourceContentNode {
  const node = toDomainNode(row);
  if (row.nodeType === "BLOCK" && row.block) return { ...node, nodeType: "BLOCK", block: toDomainBlock(row.block) };
  if (row.nodeType === "TABLE" && row.table) return { ...node, nodeType: "TABLE", table: toDomainTable(row.table) };
  if (row.nodeType === "ASSET_PLACEMENT" && row.assetPlacement) {
    return { ...node, nodeType: "ASSET_PLACEMENT", placement: toDomainPlacement(row.assetPlacement), asset: toDomainAsset(row.assetPlacement.sourceAsset) };
  }
  throw new Error(`Source content node ${row.id} has no ${row.nodeType} target (database CHECK constraint bypassed?)`);
}


// ---------------------------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------------------------

export interface InsertStructureResult {
  outcome: "CREATED";
  ingestion: SourceSnapshotIngestion;
}

/**
 * Writes the ingestion record AND the whole structure in ONE transaction. The ingestion row is inserted FIRST: its
 * unique key on source_snapshot_id is the race-safe "has this Snapshot already been ingested?" decision, so of two
 * concurrent ingestions exactly one commits. Any failure anywhere rolls back everything — no partial structure.
 *
 * Returns `"ALREADY_INGESTED"` when the Snapshot already has an ingestion (the service then compares hashes).
 */
export async function insertSnapshotStructure(
  sourceSnapshotId: string,
  input: SourceStructureInput,
  structureHash: string,
): Promise<InsertStructureResult | "ALREADY_INGESTED"> {
  // All ids are allocated up front so every table can be written with one multi-row INSERT (parents before
  // children; FK checks run at statement end, so a section's parent may appear in the same INSERT).
  const sectionId = new Map(input.sections.map((s) => [s.key, randomUUID()]));
  const assetId = new Map(input.assets.map((a) => [a.key, randomUUID()]));
  const sectionOf = (key: string | null) => (key === null ? null : (sectionId.get(key) as string));

  const sections = [...input.sections]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => ({
      id: sectionId.get(s.key) as string,
      sourceSnapshotId,
      parentSectionId: sectionOf(s.parentKey),
      title: s.title,
      headingLevel: s.headingLevel,
      ordinal: s.ordinal,
      startPage: s.startPage ?? null,
      endPage: s.endPage ?? null,
      pageLocationBasis: s.pageLocationBasis,
    }));

  const blocks: Prisma.SourceBlockCreateManyInput[] = [];
  const tables: Prisma.SourceTableCreateManyInput[] = [];
  const placements: Prisma.SourceAssetPlacementCreateManyInput[] = [];
  const nodes: Prisma.SourceContentNodeCreateManyInput[] = [];

  for (const n of [...input.nodes].sort((a, b) => a.ordinal - b.ordinal)) {
    const id = randomUUID();
    const section = sectionOf(n.sectionKey);
    if (n.nodeType === "BLOCK") {
      const b = n.block;
      blocks.push({
        id, sourceSnapshotId, sourceSectionId: section, blockType: b.blockType, ordinal: blocks.length,
        rawText: b.rawText, normalizedText: b.normalizedText ?? null, sourceStyle: b.sourceStyle ?? null,
        listLevel: b.listLevel ?? null, listOrdered: b.listOrdered ?? null,
        pageStart: b.pageStart ?? null, pageEnd: b.pageEnd ?? null, pageLocationBasis: b.pageLocationBasis,
      });
      nodes.push({ sourceSnapshotId, sourceSectionId: section, ordinal: n.ordinal, nodeType: "BLOCK", blockId: id });
    } else if (n.nodeType === "TABLE") {
      const t = n.table;
      tables.push({
        id, sourceSnapshotId, sourceSectionId: section, ordinal: tables.length, caption: t.caption ?? null,
        pageStart: t.pageStart ?? null, pageEnd: t.pageEnd ?? null, pageLocationBasis: t.pageLocationBasis,
        structureJson: t.structure as unknown as Prisma.InputJsonValue, rawText: t.rawText ?? null,
      });
      nodes.push({ sourceSnapshotId, sourceSectionId: section, ordinal: n.ordinal, nodeType: "TABLE", tableId: id });
    } else {
      const p = n.placement;
      placements.push({
        id, sourceSnapshotId, sourceAssetId: assetId.get(p.assetKey) as string, sourceSectionId: section,
        ordinal: placements.length, pageNumber: p.pageNumber ?? null, pageLocationBasis: p.pageLocationBasis,
        altTextFromSource: p.altTextFromSource ?? null,
      });
      nodes.push({ sourceSnapshotId, sourceSectionId: section, ordinal: n.ordinal, nodeType: "ASSET_PLACEMENT", assetPlacementId: id });
    }
  }

  const assets = input.assets.map((a) => ({
    id: assetId.get(a.key) as string,
    sourceSnapshotId,
    assetType: a.assetType,
    mimeType: a.mimeType,
    contentHash: a.contentHash,
    byteSize: a.byteSize,
    width: a.width ?? null,
    height: a.height ?? null,
    sourceFilename: a.sourceFilename ?? null,
    caption: a.caption ?? null,
    altTextFromSource: a.altTextFromSource ?? null,
  }));

  try {
    return await prisma.$transaction(async (tx) => {
      const ingestion = await tx.sourceSnapshotIngestion.create({
        data: {
          sourceSnapshotId,
          parserName: input.parserName,
          parserVersion: input.parserVersion,
          structureHash,
          sectionCount: sections.length,
          nodeCount: nodes.length,
        },
      });
      if (sections.length > 0) await tx.sourceSection.createMany({ data: sections });
      if (assets.length > 0) await tx.sourceAsset.createMany({ data: assets });
      if (blocks.length > 0) await tx.sourceBlock.createMany({ data: blocks });
      if (tables.length > 0) await tx.sourceTable.createMany({ data: tables });
      if (placements.length > 0) await tx.sourceAssetPlacement.createMany({ data: placements });
      if (nodes.length > 0) await tx.sourceContentNode.createMany({ data: nodes });
      return { outcome: "CREATED" as const, ingestion: toDomainIngestion(ingestion) };
    }, INGESTION_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error, { constraint: INGESTION_SNAPSHOT_UNIQUE, fields: ["source_snapshot_id"] })) return "ALREADY_INGESTED";
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reads (all ordered by derived structural ordinal — never by "latest")
// ---------------------------------------------------------------------------------------------------------------

export async function selectIngestion(sourceSnapshotId: string): Promise<SourceSnapshotIngestion | null> {
  const row = await prisma.sourceSnapshotIngestion.findUnique({ where: { sourceSnapshotId } });
  return row ? toDomainIngestion(row) : null;
}

export async function selectSections(sourceSnapshotId: string): Promise<SourceSection[]> {
  const rows = await prisma.sourceSection.findMany({ where: { sourceSnapshotId }, orderBy: { ordinal: "asc" } });
  return rows.map(toDomainSection);
}

/**
 * Rows are fetched per table and joined in memory, in chunks: a real document has tens of thousands of nodes, and a
 * single relational `include` would exceed PostgreSQL's bind-parameter limit (found by a local ~900-page-scale run).
 */
const ID_CHUNK = 5_000;
async function byIdChunks<T>(ids: readonly string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(...(await load(ids.slice(i, i + ID_CHUNK))));
  return out;
}
const present = (v: string | null): v is string => v !== null;

export async function selectResolvedNodes(where: { sourceSnapshotId: string; sourceSectionId?: string }): Promise<ResolvedSourceContentNode[]> {
  const nodes = await prisma.sourceContentNode.findMany({ where, orderBy: { ordinal: "asc" } });
  const sourceSnapshotId = where.sourceSnapshotId;
  const [blocks, tables, placements] = await Promise.all([
    byIdChunks(nodes.map((x) => x.blockId).filter(present), (ids) => prisma.sourceBlock.findMany({ where: { sourceSnapshotId, id: { in: ids } } })),
    byIdChunks(nodes.map((x) => x.tableId).filter(present), (ids) => prisma.sourceTable.findMany({ where: { sourceSnapshotId, id: { in: ids } } })),
    byIdChunks(nodes.map((x) => x.assetPlacementId).filter(present), (ids) => prisma.sourceAssetPlacement.findMany({ where: { sourceSnapshotId, id: { in: ids } } })),
  ]);
  const assets = await byIdChunks([...new Set(placements.map((p) => p.sourceAssetId))], (ids) => prisma.sourceAsset.findMany({ where: { sourceSnapshotId, id: { in: ids } } }));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const placementById = new Map(placements.map((p) => [p.id, { ...p, sourceAsset: assetById.get(p.sourceAssetId) as AssetRow }]));
  return nodes.map((row) =>
    resolveNode({
      ...row,
      block: row.blockId === null ? null : (blockById.get(row.blockId) ?? null),
      table: row.tableId === null ? null : (tableById.get(row.tableId) ?? null),
      assetPlacement: row.assetPlacementId === null ? null : (placementById.get(row.assetPlacementId) ?? null),
    }),
  );
}

/** Assets of a Snapshot in order of first appearance in the flow; never-placed assets last, by content hash. */
export async function selectAssets(sourceSnapshotId: string): Promise<SourceAsset[]> {
  const [rows, placements] = await Promise.all([
    prisma.sourceAsset.findMany({ where: { sourceSnapshotId } }),
    prisma.sourceAssetPlacement.findMany({ where: { sourceSnapshotId }, select: { sourceAssetId: true, ordinal: true }, orderBy: { ordinal: "asc" } }),
  ]);
  const first = new Map<string, number>();
  for (const p of placements) if (!first.has(p.sourceAssetId)) first.set(p.sourceAssetId, p.ordinal);
  const at = (r: AssetRow) => first.get(r.id) ?? Number.MAX_SAFE_INTEGER;
  rows.sort((a, b) => at(a) - at(b) || (a.contentHash < b.contentHash ? -1 : a.contentHash > b.contentHash ? 1 : 0));
  return rows.map(toDomainAsset);
}

export async function selectSectionById(id: string): Promise<SourceSection | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.sourceSection.findUnique({ where: { id } });
  return row ? toDomainSection(row) : null;
}

export async function selectBlockById(id: string): Promise<SourceBlock | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.sourceBlock.findUnique({ where: { id } });
  return row ? toDomainBlock(row) : null;
}

export async function selectTableById(id: string): Promise<SourceTable | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.sourceTable.findUnique({ where: { id } });
  return row ? toDomainTable(row) : null;
}

export async function selectAssetById(id: string): Promise<SourceAsset | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.sourceAsset.findUnique({ where: { id } });
  return row ? toDomainAsset(row) : null;
}

export async function selectPlacementsForAsset(sourceAssetId: string): Promise<SourceAssetPlacement[]> {
  const rows = await prisma.sourceAssetPlacement.findMany({ where: { sourceAssetId }, orderBy: { ordinal: "asc" } });
  return rows.map(toDomainPlacement);
}

export async function selectChildSections(parentSectionId: string): Promise<SourceSection[]> {
  const rows = await prisma.sourceSection.findMany({ where: { parentSectionId }, orderBy: { ordinal: "asc" } });
  return rows.map(toDomainSection);
}
