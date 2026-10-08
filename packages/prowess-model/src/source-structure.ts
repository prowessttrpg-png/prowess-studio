import { DomainError, SOURCE_SNAPSHOT_ERROR_CODES, SOURCE_STRUCTURE_ERROR_CODES } from "./errors.js";
import type {
  SourceAssetId,
  SourceAssetPlacementId,
  SourceBlockId,
  SourceContentNodeId,
  SourceDocumentId,
  SourceSectionId,
  SourceSnapshotId,
  SourceSnapshotIngestionId,
  SourceTableId,
} from "./ids.js";

/**
 * Structured source layer (PAS-10 M3-WO1).
 *
 * ```
 * SourceDocument                 stable conceptual identity            (M1-WO7)
 *   -> SourceSnapshot            one exact revision of the source bytes (immutable)
 *        -> SourceSection        nested heading hierarchy
 *        -> SourceContentNode    the ordered document flow, each node targeting exactly one of:
 *             -> SourceBlock           a structural text block (raw text preserved verbatim)
 *             -> SourceTable           a table, kept structured (rows / cells / spans)
 *             -> SourceAssetPlacement  where an embedded SourceAsset appears
 * ```
 *
 * "Source structure records what a source says and where it says it. It does not determine whether that source is
 * Canon." Nothing in this file classifies prose into Prowess rules: every vocabulary below is STRUCTURAL (a heading,
 * a paragraph, a list item, a table cell) and never game-semantic.
 *
 * Location metadata is kept explicitly distinct:
 *   - source-native location — a page number the SOURCE itself states (`pageLocationBasis = SOURCE_NATIVE`);
 *   - derived structural ordering — every `ordinal`, which is derived from document order by the parser;
 *   - unavailable location — `pageLocationBasis = UNAVAILABLE` with every page field null. Page numbers are never
 *     invented (e.g. a DOCX has no reliable pagination without rendering).
 */

// ---------------------------------------------------------------------------------------------------------------
// Vocabularies (each mirrored exactly by a Prisma enum — see the M1 audit enum-parity test)
// ---------------------------------------------------------------------------------------------------------------

/** Structural block kinds. Deliberately NOT game-semantic: there is no SPELL_RULE, DAMAGE_FORMULA, etc. */
export const SOURCE_BLOCK_TYPES = ["HEADING", "PARAGRAPH", "LIST_ITEM", "CAPTION", "PREFORMATTED", "OTHER"] as const;
export type SourceBlockType = (typeof SOURCE_BLOCK_TYPES)[number];
export const isSourceBlockType = (value: unknown): value is SourceBlockType =>
  typeof value === "string" && (SOURCE_BLOCK_TYPES as readonly string[]).includes(value);

/** What a SourceContentNode points at. Exactly one target per node, matching this type. */
export const SOURCE_CONTENT_NODE_TYPES = ["BLOCK", "TABLE", "ASSET_PLACEMENT"] as const;
export type SourceContentNodeType = (typeof SOURCE_CONTENT_NODE_TYPES)[number];
export const isSourceContentNodeType = (value: unknown): value is SourceContentNodeType =>
  typeof value === "string" && (SOURCE_CONTENT_NODE_TYPES as readonly string[]).includes(value);

/** Kinds of embedded asset. Structural only — nothing here analyses what an image depicts. */
export const SOURCE_ASSET_TYPES = ["IMAGE", "EMBEDDED_OBJECT", "OTHER"] as const;
export type SourceAssetType = (typeof SOURCE_ASSET_TYPES)[number];
export const isSourceAssetType = (value: unknown): value is SourceAssetType =>
  typeof value === "string" && (SOURCE_ASSET_TYPES as readonly string[]).includes(value);

/**
 * Where a page location came from. `SOURCE_NATIVE`: the source itself states it. `UNAVAILABLE`: the source does
 * not reliably state it, so every page field is null. There is intentionally no "estimated" value.
 */
export const SOURCE_PAGE_LOCATION_BASES = ["SOURCE_NATIVE", "UNAVAILABLE"] as const;
export type SourcePageLocationBasis = (typeof SOURCE_PAGE_LOCATION_BASES)[number];
export const isSourcePageLocationBasis = (value: unknown): value is SourcePageLocationBasis =>
  typeof value === "string" && (SOURCE_PAGE_LOCATION_BASES as readonly string[]).includes(value);

/** Documented limits. */
export const MAX_SOURCE_SNAPSHOT_LABEL_LENGTH = 300;
export const MAX_SOURCE_FILENAME_LENGTH = 500;
export const MAX_SOURCE_SECTION_TITLE_LENGTH = 2000;
export const MAX_SOURCE_HEADING_LEVEL = 9;
export const SOURCE_TABLE_STRUCTURE_SCHEMA_VERSION = 1;

/** A lowercase SHA-256 hex digest — the only content-hash form this layer accepts. */
export const isSha256Hex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

// ---------------------------------------------------------------------------------------------------------------
// Persisted domain shapes
// ---------------------------------------------------------------------------------------------------------------

/** One exact revision of a SourceDocument's bytes. Changed bytes are a NEW Snapshot; history is never overwritten. */
export interface SourceSnapshot {
  id: SourceSnapshotId;
  sourceDocumentId: SourceDocumentId;
  label: string;
  originalFilename: string;
  mimeType: string;
  /** SHA-256 (lowercase hex) of the exact source bytes. Unique per SourceDocument. */
  contentHash: string;
  byteSize: number;
  /** Page count the source itself declares (e.g. DOCX `docProps/app.xml`), never computed by rendering. */
  pageCount: number | null;
  /** Version text the source declares about itself (e.g. "V0.1"). Descriptive only — never authority. */
  declaredVersion: string | null;
  /** Draft state the source declares about itself (e.g. "Playtest"). Descriptive only — never Canon status. */
  declaredDraftState: string | null;
  createdAt: Date;
}

export interface CreateSourceSnapshotInput {
  label: string;
  originalFilename: string;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  pageCount?: number | null;
  declaredVersion?: string | null;
  declaredDraftState?: string | null;
}

/**
 * The single, insert-only record that a Snapshot's structure was ingested — by which parser, and with which
 * structure hash. At most one per Snapshot (database-unique), which is what makes a Snapshot immutable after
 * structural ingestion without ever updating a row.
 */
export interface SourceSnapshotIngestion {
  id: SourceSnapshotIngestionId;
  sourceSnapshotId: SourceSnapshotId;
  parserName: string;
  parserVersion: string;
  /** SHA-256 of the canonical structure (see `canonicalSourceStructureJson`). */
  structureHash: string;
  sectionCount: number;
  nodeCount: number;
  createdAt: Date;
}

export interface SourceSection {
  id: SourceSectionId;
  sourceSnapshotId: SourceSnapshotId;
  parentSectionId: SourceSectionId | null;
  title: string;
  headingLevel: number;
  /** Derived structural order of sections within the Snapshot (0-based, contiguous). */
  ordinal: number;
  startPage: number | null;
  endPage: number | null;
  pageLocationBasis: SourcePageLocationBasis;
  createdAt: Date;
}

export interface SourceBlock {
  id: SourceBlockId;
  sourceSnapshotId: SourceSnapshotId;
  sourceSectionId: SourceSectionId | null;
  blockType: SourceBlockType;
  /** Derived order of blocks within the Snapshot (0-based, contiguous). */
  ordinal: number;
  /** The source's text, verbatim. Never replaced by normalization. */
  rawText: string;
  /** Whitespace-normalized text, or null when identical to `rawText`. A convenience view, never authoritative. */
  normalizedText: string | null;
  /** The source's own style name (e.g. a DOCX paragraph style id). Structural metadata, not interpretation. */
  sourceStyle: string | null;
  /** List nesting level (0-based) for LIST_ITEM blocks. */
  listLevel: number | null;
  /** Whether a LIST_ITEM belongs to a numbered (true) or bulleted (false) list, when the source says so. */
  listOrdered: boolean | null;
  pageStart: number | null;
  pageEnd: number | null;
  pageLocationBasis: SourcePageLocationBasis;
  createdAt: Date;
}

/** A table cell, in source order. Spans are explicit; text is verbatim. */
export interface SourceTableCell {
  /** 0-based position of this cell within its row's cell list (source order). */
  index: number;
  /** 0-based grid column this cell starts in, accounting for column spans of earlier cells. */
  columnIndex: number;
  rowSpan: number;
  colSpan: number;
  isHeader: boolean;
  /** Verbatim cell text; paragraphs separated by "\n". */
  rawText: string;
  /** Tables nested inside this cell, kept structured. */
  nestedTables: SourceTableStructure[];
}

export interface SourceTableRow {
  index: number;
  isHeader: boolean;
  cells: SourceTableCell[];
}

/** `structureJson` — row / column / cell order preserved; header, row-span and column-span representable. */
export interface SourceTableStructure {
  schemaVersion: typeof SOURCE_TABLE_STRUCTURE_SCHEMA_VERSION;
  rowCount: number;
  columnCount: number;
  rows: SourceTableRow[];
}

export interface SourceTable {
  id: SourceTableId;
  sourceSnapshotId: SourceSnapshotId;
  sourceSectionId: SourceSectionId | null;
  /** Derived order of tables within the Snapshot (0-based, contiguous). */
  ordinal: number;
  caption: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  pageLocationBasis: SourcePageLocationBasis;
  structure: SourceTableStructure;
  /** A verbatim plain-text rendering (cells tab-separated, rows newline-separated). Never replaces `structure`. */
  rawText: string | null;
  createdAt: Date;
}

export interface SourceAsset {
  id: SourceAssetId;
  sourceSnapshotId: SourceSnapshotId;
  assetType: SourceAssetType;
  mimeType: string;
  /** SHA-256 of the asset's exact bytes. Unique per Snapshot: the same image placed twice is one asset. */
  contentHash: string;
  byteSize: number;
  /** Intrinsic pixel dimensions read from the image header, when the format states them. */
  width: number | null;
  height: number | null;
  sourceFilename: string | null;
  caption: string | null;
  /** The alt text of the asset's FIRST placement, verbatim (each placement also keeps its own). */
  altTextFromSource: string | null;
  createdAt: Date;
}

export interface SourceAssetPlacement {
  id: SourceAssetPlacementId;
  sourceSnapshotId: SourceSnapshotId;
  sourceAssetId: SourceAssetId;
  sourceSectionId: SourceSectionId | null;
  /** Derived order of placements within the Snapshot (0-based, contiguous). */
  ordinal: number;
  pageNumber: number | null;
  pageLocationBasis: SourcePageLocationBasis;
  /** This placement's own alt text, verbatim. */
  altTextFromSource: string | null;
  createdAt: Date;
}

export interface SourceContentNode {
  id: SourceContentNodeId;
  sourceSnapshotId: SourceSnapshotId;
  sourceSectionId: SourceSectionId | null;
  /** Position in the Snapshot's ordered document flow (0-based, contiguous). */
  ordinal: number;
  nodeType: SourceContentNodeType;
  blockId: SourceBlockId | null;
  tableId: SourceTableId | null;
  assetPlacementId: SourceAssetPlacementId | null;
}

/** A content node together with the one thing it targets. */
export type ResolvedSourceContentNode =
  | (SourceContentNode & { nodeType: "BLOCK"; block: SourceBlock })
  | (SourceContentNode & { nodeType: "TABLE"; table: SourceTable })
  | (SourceContentNode & { nodeType: "ASSET_PLACEMENT"; placement: SourceAssetPlacement; asset: SourceAsset });

/** The full structure of one Snapshot, in document order. */
export interface SourceStructure {
  snapshot: SourceSnapshot;
  /** null when the Snapshot exists but its structure has not been ingested yet. */
  ingestion: SourceSnapshotIngestion | null;
  sections: SourceSection[];
  assets: SourceAsset[];
  nodes: ResolvedSourceContentNode[];
}

// ---------------------------------------------------------------------------------------------------------------
// Structure input (what a structural parser produces; local `key`s instead of database ids)
// ---------------------------------------------------------------------------------------------------------------

export interface SourcePageLocationInput {
  pageLocationBasis: SourcePageLocationBasis;
  pageStart?: number | null;
  pageEnd?: number | null;
}

export interface SourceSectionInput {
  key: string;
  parentKey: string | null;
  title: string;
  headingLevel: number;
  ordinal: number;
  pageLocationBasis: SourcePageLocationBasis;
  startPage?: number | null;
  endPage?: number | null;
}

export interface SourceBlockInput extends SourcePageLocationInput {
  blockType: SourceBlockType;
  rawText: string;
  normalizedText?: string | null;
  sourceStyle?: string | null;
  listLevel?: number | null;
  listOrdered?: boolean | null;
}

export interface SourceTableInput extends SourcePageLocationInput {
  caption?: string | null;
  structure: SourceTableStructure;
  rawText?: string | null;
}

export interface SourceAssetInput {
  key: string;
  assetType: SourceAssetType;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  width?: number | null;
  height?: number | null;
  sourceFilename?: string | null;
  caption?: string | null;
  altTextFromSource?: string | null;
}

export interface SourceAssetPlacementInput {
  assetKey: string;
  pageLocationBasis: SourcePageLocationBasis;
  pageNumber?: number | null;
  altTextFromSource?: string | null;
}

export type SourceContentNodeInput =
  | { ordinal: number; sectionKey: string | null; nodeType: "BLOCK"; block: SourceBlockInput }
  | { ordinal: number; sectionKey: string | null; nodeType: "TABLE"; table: SourceTableInput }
  | { ordinal: number; sectionKey: string | null; nodeType: "ASSET_PLACEMENT"; placement: SourceAssetPlacementInput };

export interface SourceStructureInput {
  parserName: string;
  parserVersion: string;
  sections: SourceSectionInput[];
  assets: SourceAssetInput[];
  nodes: SourceContentNodeInput[];
}

// ---------------------------------------------------------------------------------------------------------------
// Validation (pure; throws controlled DomainErrors before anything reaches persistence)
// ---------------------------------------------------------------------------------------------------------------

const structureError = (code: (typeof SOURCE_STRUCTURE_ERROR_CODES)[keyof typeof SOURCE_STRUCTURE_ERROR_CODES], message: string) =>
  new DomainError(code, message);

const isNonNegativeInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isOptionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";
const isNonEmptyString = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Ordinals must be unique, contiguous, non-negative integers starting at 0. */
export function assertContiguousOrdinals(ordinals: readonly unknown[], what: string): void {
  const seen = new Set<number>();
  for (const o of ordinals) {
    if (!isNonNegativeInt(o)) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_ORDER, `${what}: ordinal ${JSON.stringify(o)} is not a non-negative integer`);
    if (seen.has(o)) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_ORDER, `${what}: duplicate ordinal ${o}`);
    seen.add(o);
  }
  for (let i = 0; i < ordinals.length; i += 1) {
    if (!seen.has(i)) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_ORDER, `${what}: ordinals are not contiguous from 0 (missing ${i})`);
  }
}

function assertPageLocation(loc: { pageLocationBasis: unknown; pages: unknown[] }, where: string): void {
  if (!isSourcePageLocationBasis(loc.pageLocationBasis)) {
    throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT, `${where}: pageLocationBasis must be one of ${SOURCE_PAGE_LOCATION_BASES.join(", ")}`);
  }
  const present = loc.pages.filter((p) => p !== undefined && p !== null);
  for (const p of present) if (!isPositiveInt(p)) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT, `${where}: page numbers must be positive integers`);
  if (loc.pageLocationBasis === "UNAVAILABLE" && present.length > 0) {
    throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT, `${where}: page numbers are present but pageLocationBasis is UNAVAILABLE (page numbers are never invented)`);
  }
  if (loc.pageLocationBasis === "SOURCE_NATIVE" && (loc.pages[0] === undefined || loc.pages[0] === null)) {
    throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT, `${where}: SOURCE_NATIVE location requires a starting page`);
  }
  const [a, b] = loc.pages;
  if (isPositiveInt(a) && isPositiveInt(b) && b < a) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT, `${where}: end page precedes start page`);
}

/** Validates a table structure: explicit row/cell order, positive spans, verbatim cell text. */
export function assertValidTableStructure(structure: unknown, where: string): asserts structure is SourceTableStructure {
  const bad = (m: string) => structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT, `${where}: ${m}`);
  if (typeof structure !== "object" || structure === null) throw bad("structure must be an object");
  const s = structure as Partial<SourceTableStructure>;
  if (s.schemaVersion !== SOURCE_TABLE_STRUCTURE_SCHEMA_VERSION) throw bad(`structure.schemaVersion must be ${SOURCE_TABLE_STRUCTURE_SCHEMA_VERSION}`);
  if (!Array.isArray(s.rows)) throw bad("structure.rows must be an array");
  if (!isNonNegativeInt(s.rowCount) || s.rowCount !== s.rows.length) throw bad("structure.rowCount must equal rows.length");
  if (!isNonNegativeInt(s.columnCount)) throw bad("structure.columnCount must be a non-negative integer");
  s.rows.forEach((row, r) => {
    if (typeof row !== "object" || row === null || row.index !== r || typeof row.isHeader !== "boolean" || !Array.isArray(row.cells)) {
      throw bad(`row ${r} must be { index: ${r}, isHeader, cells[] } in source order`);
    }
    row.cells.forEach((cell, c) => {
      if (typeof cell !== "object" || cell === null || cell.index !== c) throw bad(`row ${r} cell ${c} is out of order`);
      if (!isNonNegativeInt(cell.columnIndex) || !isPositiveInt(cell.rowSpan) || !isPositiveInt(cell.colSpan)) throw bad(`row ${r} cell ${c} has invalid columnIndex/rowSpan/colSpan`);
      if (typeof cell.isHeader !== "boolean" || typeof cell.rawText !== "string" || !Array.isArray(cell.nestedTables)) throw bad(`row ${r} cell ${c} must carry isHeader, rawText and nestedTables[]`);
      cell.nestedTables.forEach((nested, n) => assertValidTableStructure(nested, `${where} row ${r} cell ${c} nested table ${n}`));
    });
  });
}

/**
 * Validates a whole structure before persistence. Throws:
 *   SOURCE_STRUCTURE.INVALID_ORDER        ordinals (sections, nodes) not unique/contiguous from 0
 *   SOURCE_STRUCTURE.INVALID_PARENT       a section's parent is unknown, itself, or later in document order
 *   SOURCE_STRUCTURE.INVALID_NODE_TARGET  a node's payload does not match its nodeType, or names an unknown
 *                                          section / asset key
 *   SOURCE_STRUCTURE.INVALID_INPUT        any other shape problem
 */
export function validateSourceStructureInput(input: SourceStructureInput): void {
  const bad = (m: string) => structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT, m);
  if (typeof input !== "object" || input === null) throw bad("structure must be an object");
  if (!isNonEmptyString(input.parserName, 200) || !isNonEmptyString(input.parserVersion, 100)) throw bad("parserName and parserVersion are required");
  if (!Array.isArray(input.sections) || !Array.isArray(input.assets) || !Array.isArray(input.nodes)) throw bad("sections, assets and nodes must be arrays");

  // Sections
  assertContiguousOrdinals(input.sections.map((s) => s?.ordinal), "sections");
  const sectionByKey = new Map<string, SourceSectionInput>();
  for (const s of input.sections) {
    if (!isNonEmptyString(s.key, 200)) throw bad("every section needs a non-empty key");
    if (sectionByKey.has(s.key)) throw bad(`duplicate section key ${JSON.stringify(s.key)}`);
    sectionByKey.set(s.key, s);
  }
  for (const s of input.sections) {
    if (typeof s.title !== "string" || s.title.length > MAX_SOURCE_SECTION_TITLE_LENGTH) throw bad(`section ${s.key}: title must be a string of at most ${MAX_SOURCE_SECTION_TITLE_LENGTH} characters`);
    if (!isPositiveInt(s.headingLevel) || s.headingLevel > MAX_SOURCE_HEADING_LEVEL) throw bad(`section ${s.key}: headingLevel must be 1..${MAX_SOURCE_HEADING_LEVEL}`);
    assertPageLocation({ pageLocationBasis: s.pageLocationBasis, pages: [s.startPage, s.endPage] }, `section ${s.key}`);
    if (s.parentKey !== null) {
      const parent = typeof s.parentKey === "string" ? sectionByKey.get(s.parentKey) : undefined;
      if (!parent) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_PARENT, `section ${s.key}: parent ${JSON.stringify(s.parentKey)} is not a section of this structure`);
      if (parent === s) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_PARENT, `section ${s.key} cannot be its own parent`);
      if (parent.ordinal >= s.ordinal) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_PARENT, `section ${s.key}: parent must precede it in document order`);
    }
  }

  // Assets
  const assetKeys = new Set<string>();
  const assetHashes = new Set<string>();
  for (const a of input.assets) {
    if (!isNonEmptyString(a.key, 200)) throw bad("every asset needs a non-empty key");
    if (assetKeys.has(a.key)) throw bad(`duplicate asset key ${JSON.stringify(a.key)}`);
    assetKeys.add(a.key);
    if (!isSourceAssetType(a.assetType)) throw bad(`asset ${a.key}: assetType must be one of ${SOURCE_ASSET_TYPES.join(", ")}`);
    if (!isNonEmptyString(a.mimeType, 200)) throw bad(`asset ${a.key}: mimeType is required`);
    if (!isSha256Hex(a.contentHash)) throw bad(`asset ${a.key}: contentHash must be a lowercase SHA-256 hex digest`);
    if (assetHashes.has(a.contentHash)) throw bad(`asset ${a.key}: the same bytes are already an asset of this structure (place it twice instead)`);
    assetHashes.add(a.contentHash);
    if (!isNonNegativeInt(a.byteSize)) throw bad(`asset ${a.key}: byteSize must be a non-negative integer`);
    for (const d of [a.width, a.height]) if (d !== undefined && d !== null && !isPositiveInt(d)) throw bad(`asset ${a.key}: width/height must be positive integers`);
    if (![a.sourceFilename, a.caption, a.altTextFromSource].every(isOptionalString)) throw bad(`asset ${a.key}: optional text fields must be strings`);
  }

  // Content flow
  assertContiguousOrdinals(input.nodes.map((n) => n?.ordinal), "content nodes");
  for (const n of input.nodes) {
    const where = `content node ${n.ordinal}`;
    if (!isSourceContentNodeType(n.nodeType)) throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_NODE_TARGET, `${where}: unknown nodeType ${JSON.stringify(n.nodeType)}`);
    if (n.sectionKey !== null && (typeof n.sectionKey !== "string" || !sectionByKey.has(n.sectionKey))) {
      throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_NODE_TARGET, `${where}: section ${JSON.stringify(n.sectionKey)} is not a section of this structure`);
    }
    const payload = n as Partial<Record<"block" | "table" | "placement", unknown>>;
    const targets = (["block", "table", "placement"] as const).filter((k) => payload[k] !== undefined && payload[k] !== null);
    const expected = n.nodeType === "BLOCK" ? "block" : n.nodeType === "TABLE" ? "table" : "placement";
    if (targets.length !== 1 || targets[0] !== expected) {
      throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_NODE_TARGET, `${where}: a ${n.nodeType} node must carry exactly one target, "${expected}"`);
    }
    if (n.nodeType === "BLOCK") {
      const b = n.block;
      if (!isSourceBlockType(b.blockType)) throw bad(`${where}: blockType must be one of ${SOURCE_BLOCK_TYPES.join(", ")}`);
      if (typeof b.rawText !== "string") throw bad(`${where}: rawText must be a string`);
      if (![b.normalizedText, b.sourceStyle].every(isOptionalString)) throw bad(`${where}: normalizedText/sourceStyle must be strings`);
      if (b.listLevel !== undefined && b.listLevel !== null && !isNonNegativeInt(b.listLevel)) throw bad(`${where}: listLevel must be a non-negative integer`);
      if (b.listOrdered !== undefined && b.listOrdered !== null && typeof b.listOrdered !== "boolean") throw bad(`${where}: listOrdered must be boolean`);
      assertPageLocation({ pageLocationBasis: b.pageLocationBasis, pages: [b.pageStart, b.pageEnd] }, where);
    } else if (n.nodeType === "TABLE") {
      const t = n.table;
      if (![t.caption, t.rawText].every(isOptionalString)) throw bad(`${where}: caption/rawText must be strings`);
      assertValidTableStructure(t.structure, where);
      assertPageLocation({ pageLocationBasis: t.pageLocationBasis, pages: [t.pageStart, t.pageEnd] }, where);
    } else {
      const p = n.placement;
      if (typeof p.assetKey !== "string" || !assetKeys.has(p.assetKey)) {
        throw structureError(SOURCE_STRUCTURE_ERROR_CODES.INVALID_NODE_TARGET, `${where}: asset ${JSON.stringify(p.assetKey)} is not an asset of this structure`);
      }
      if (!isOptionalString(p.altTextFromSource)) throw bad(`${where}: altTextFromSource must be a string`);
      assertPageLocation({ pageLocationBasis: p.pageLocationBasis, pages: [p.pageNumber] }, where);
    }
  }
}

/** Validates Snapshot metadata. Throws SOURCE_SNAPSHOT.INVALID_INPUT. */
export function validateCreateSourceSnapshotInput(input: CreateSourceSnapshotInput): void {
  const bad = (m: string) => new DomainError(SOURCE_SNAPSHOT_ERROR_CODES.INVALID_INPUT, m);
  if (typeof input !== "object" || input === null) throw bad("snapshot input must be an object");
  if (!isNonEmptyString(input.label, MAX_SOURCE_SNAPSHOT_LABEL_LENGTH)) throw bad(`label is required (at most ${MAX_SOURCE_SNAPSHOT_LABEL_LENGTH} characters)`);
  if (!isNonEmptyString(input.originalFilename, MAX_SOURCE_FILENAME_LENGTH)) throw bad(`originalFilename is required (at most ${MAX_SOURCE_FILENAME_LENGTH} characters)`);
  if (!isNonEmptyString(input.mimeType, 200)) throw bad("mimeType is required");
  if (!isSha256Hex(input.contentHash)) throw bad("contentHash must be a lowercase SHA-256 hex digest of the exact source bytes");
  if (!isNonNegativeInt(input.byteSize) || input.byteSize > 2_147_483_647) throw bad("byteSize must be a non-negative 32-bit integer");
  if (input.pageCount !== undefined && input.pageCount !== null && !isPositiveInt(input.pageCount)) throw bad("pageCount must be a positive integer when present");
  for (const [k, v] of [["declaredVersion", input.declaredVersion], ["declaredDraftState", input.declaredDraftState]] as const) {
    if (v !== undefined && v !== null && !isNonEmptyString(v, 200)) throw bad(`${k} must be a non-empty string of at most 200 characters when present`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Text normalization and canonical form
// ---------------------------------------------------------------------------------------------------------------

/**
 * Whitespace normalization for the convenience `normalizedText` view: Unicode NFC, runs of whitespace collapsed to
 * one space, trimmed. Returns null when the result is identical to the raw text (so raw stays the only copy).
 * NEVER used to replace raw text.
 */
export function normalizeSourceText(raw: string): string | null {
  const normalized = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalized === raw ? null : normalized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic JSON of a structure: sections and nodes sorted by ordinal, assets by key, object keys sorted,
 * `undefined` dropped and optional fields defaulted to null. Two structurally identical inputs always yield the
 * same string; its SHA-256 is the ingestion's `structureHash`. Parser name/version are part of it on purpose.
 */
export function canonicalSourceStructureJson(input: SourceStructureInput): string {
  const n = <T>(v: T | undefined | null) => (v === undefined ? null : v);
  const page = (p: SourcePageLocationInput) => ({ pageLocationBasis: p.pageLocationBasis, pageStart: n(p.pageStart), pageEnd: n(p.pageEnd) });
  return JSON.stringify(
    canonicalize({
      parserName: input.parserName,
      parserVersion: input.parserVersion,
      sections: [...input.sections]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((s) => ({ key: s.key, parentKey: s.parentKey, title: s.title, headingLevel: s.headingLevel, ordinal: s.ordinal, pageLocationBasis: s.pageLocationBasis, startPage: n(s.startPage), endPage: n(s.endPage) })),
      assets: [...input.assets]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((a) => ({ key: a.key, assetType: a.assetType, mimeType: a.mimeType, contentHash: a.contentHash, byteSize: a.byteSize, width: n(a.width), height: n(a.height), sourceFilename: n(a.sourceFilename), caption: n(a.caption), altTextFromSource: n(a.altTextFromSource) })),
      nodes: [...input.nodes]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((node) => {
          const base = { ordinal: node.ordinal, sectionKey: node.sectionKey, nodeType: node.nodeType };
          if (node.nodeType === "BLOCK") {
            const b = node.block;
            return { ...base, block: { blockType: b.blockType, rawText: b.rawText, normalizedText: n(b.normalizedText), sourceStyle: n(b.sourceStyle), listLevel: n(b.listLevel), listOrdered: n(b.listOrdered), ...page(b) } };
          }
          if (node.nodeType === "TABLE") {
            const t = node.table;
            return { ...base, table: { caption: n(t.caption), structure: t.structure, rawText: n(t.rawText), ...page(t) } };
          }
          const p = node.placement;
          return { ...base, placement: { assetKey: p.assetKey, pageLocationBasis: p.pageLocationBasis, pageNumber: n(p.pageNumber), altTextFromSource: n(p.altTextFromSource) } };
        }),
    }),
  );
}
