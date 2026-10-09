import type { CreateExtractionCandidateInput, ExtractionSourceAnchorInput, JsonObject, ResolvedSourceContentNode } from "@prowess/model";
import type { ExtractionContext, ExtractorDefinition } from "./extractor.js";

/**
 * `prowess.structural@1` (PAS-10 M3-WO3) — the first, deterministic, STRUCTURAL extractor.
 *
 * It answers "which structural pieces of this source should later import stages inspect?" — never "what rules should
 * Prowess adopt?". It reads only WO1 structure (sections, blocks, tables, asset placements and their source order),
 * performs no text interpretation of any kind, calls no AI service or network, and the same input always yields the
 * same output. Every unit becomes an UNREVIEWED candidate with `proposedEntityType = null` and
 * `proposedCanonicalKey = null`.
 *
 * Units (extractor-internal; never EntityTypes):
 *   SECTION       one per in-scope section that directly owns meaningful text (a non-heading block with text).
 *                 A pure container (heading only, or only sub-sections / images / tables) yields no SECTION unit.
 *                 Primary anchor: the section. Supporting anchors: every directly-owned content node except its
 *                 heading block (paragraphs, list items, tables, image placements), in source order.
 *                 candidateKind UNKNOWN, confidence HIGH (an explicit source heading).
 *   TABLE         one per in-scope table with at least one non-empty cell. Primary anchor: the table's content node.
 *                 candidateKind REFERENCE, confidence HIGH (an explicit source table).
 *   ROOT_CONTENT  one per contiguous run (consecutive node ordinals) of section-less nodes that contains meaningful
 *                 text — SNAPSHOT scope only, since a subtree contains no section-less content. Primary anchor: the
 *                 run's first node; supporting: the rest. candidateKind UNKNOWN, confidence MEDIUM (a derived grouping).
 *
 * Lists, examples, callouts and text that looks like a formula, a requirement or a keyword stay verbatim source
 * evidence under their unit's anchors; images are never interpreted. Excerpts are left null.
 */
export const STRUCTURAL_EXTRACTOR_KEY = "prowess.structural";
export const STRUCTURAL_EXTRACTOR_VERSION = "1";

export const STRUCTURAL_SECTION_PAYLOAD_SCHEMA = "prowess.structural.section";
export const STRUCTURAL_TABLE_PAYLOAD_SCHEMA = "prowess.structural.table";
export const STRUCTURAL_ROOT_CONTENT_PAYLOAD_SCHEMA = "prowess.structural.root-content";
export const STRUCTURAL_PAYLOAD_SCHEMA_VERSION = 1;

export type StructuralUnitType = "SECTION" | "TABLE" | "ROOT_CONTENT";

/** The transient intermediate representation (not persisted) that becomes one candidate input. */
export interface StructuralExtractionUnit {
  unitType: StructuralUnitType;
  displayLabel: string;
  confidence: "HIGH" | "MEDIUM";
  candidateKind: "UNKNOWN" | "REFERENCE";
  primaryAnchor: ExtractionSourceAnchorInput;
  supportingAnchors: ExtractionSourceAnchorInput[];
  payloadSchemaKey: string;
  payload: JsonObject;
  /** Source position: the content-node ordinal where the unit begins. */
  sourceOrderKey: number;
  /** Tie-breaker only (a SECTION before a TABLE starting at the same position; then the stable anchor id). */
  tieBreaker: string;
}

const MAX_LABEL = 300;
const label = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_LABEL ? flat : `${flat.slice(0, MAX_LABEL - 1)}…`;
};
const hasText = (n: ResolvedSourceContentNode) => n.nodeType === "BLOCK" && n.block.blockType !== "HEADING" && n.block.rawText.trim().length > 0;
const isOwnHeading = (n: ResolvedSourceContentNode) => n.nodeType === "BLOCK" && n.block.blockType === "HEADING";
const anchorOf = (n: ResolvedSourceContentNode): ExtractionSourceAnchorInput => ({ contentNodeId: n.id });
const UNIT_RANK: Record<StructuralUnitType, number> = { ROOT_CONTENT: 0, SECTION: 1, TABLE: 2 };

export function segmentStructure(context: ExtractionContext): StructuralExtractionUnit[] {
  const sections = context.sections; // in scope, source order
  const nodes = context.nodes; // in scope, source order
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const directNodes = new Map<string, ResolvedSourceContentNode[]>();
  for (const n of nodes) {
    if (n.sourceSectionId === null) continue;
    const list = directNodes.get(n.sourceSectionId) ?? [];
    list.push(n);
    directNodes.set(n.sourceSectionId, list);
  }
  const childCount = new Map<string, number>();
  for (const s of sections) if (s.parentSectionId !== null) childCount.set(s.parentSectionId, (childCount.get(s.parentSectionId) ?? 0) + 1);

  const units: StructuralExtractionUnit[] = [];

  // SECTION units
  for (const section of sections) {
    const own = directNodes.get(section.id) ?? [];
    if (!own.some(hasText)) continue; // a pure container (or image/table-only section) has no SECTION unit
    const content = own.filter((n) => !isOwnHeading(n));
    const count = (type: string) => content.filter((n) => n.nodeType === type).length;
    units.push({
      unitType: "SECTION",
      displayLabel: label(section.title),
      confidence: "HIGH",
      candidateKind: "UNKNOWN",
      primaryAnchor: { sectionId: section.id },
      supportingAnchors: content.map(anchorOf),
      payloadSchemaKey: STRUCTURAL_SECTION_PAYLOAD_SCHEMA,
      payload: {
        unitType: "SECTION",
        sourceSectionId: section.id,
        parentSectionId: section.parentSectionId,
        title: section.title,
        headingLevel: section.headingLevel,
        sectionOrdinal: section.ordinal,
        directContentNodeCount: content.length,
        directBlockCount: count("BLOCK"),
        directListItemCount: content.filter((n) => n.nodeType === "BLOCK" && n.block.blockType === "LIST_ITEM").length,
        directTableCount: count("TABLE"),
        directAssetPlacementCount: count("ASSET_PLACEMENT"),
        childSectionCount: childCount.get(section.id) ?? 0,
      },
      sourceOrderKey: (own[0] as ResolvedSourceContentNode).ordinal,
      tieBreaker: section.id,
    });
  }

  // TABLE units
  const tablesPerSection = new Map<string, number>();
  for (const n of nodes) if (n.nodeType === "TABLE") tablesPerSection.set(n.sourceSectionId ?? "", (tablesPerSection.get(n.sourceSectionId ?? "") ?? 0) + 1);
  const tableIndex = new Map<string, number>();
  for (const n of nodes) {
    if (n.nodeType !== "TABLE") continue;
    const structure = n.table.structure;
    if (!structure.rows.some((r) => r.cells.some((c) => c.rawText.trim().length > 0))) continue;
    const owner = n.sourceSectionId === null ? null : (sectionById.get(n.sourceSectionId) ?? null);
    const key = n.sourceSectionId ?? "";
    const index = (tableIndex.get(key) ?? 0) + 1;
    tableIndex.set(key, index);
    const where = owner ? owner.title : "document preface";
    const fallback = (tablesPerSection.get(key) ?? 0) > 1 ? `Table ${index} in ${where}` : `Table in ${where}`;
    units.push({
      unitType: "TABLE",
      displayLabel: label(n.table.caption && n.table.caption.trim().length > 0 ? n.table.caption : fallback),
      confidence: "HIGH",
      candidateKind: "REFERENCE",
      primaryAnchor: anchorOf(n),
      supportingAnchors: [],
      payloadSchemaKey: STRUCTURAL_TABLE_PAYLOAD_SCHEMA,
      payload: {
        unitType: "TABLE",
        sourceTableId: n.table.id,
        sourceContentNodeId: n.id,
        sourceSectionId: n.sourceSectionId,
        caption: n.table.caption,
        rowCount: structure.rowCount,
        columnCount: structure.columnCount,
        hasHeader: structure.rows.some((r) => r.isHeader),
      },
      sourceOrderKey: n.ordinal,
      tieBreaker: n.id,
    });
  }

  // ROOT_CONTENT units (SNAPSHOT scope only: the runner gives a subtree no section-less nodes)
  let run: ResolvedSourceContentNode[] = [];
  let lastSectionTitle: string | null = null;
  let runSectionTitle: string | null = null;
  const flush = () => {
    if (run.length > 0 && run.some(hasText)) {
      const first = run[0] as ResolvedSourceContentNode;
      const count = (type: string) => run.filter((n) => n.nodeType === type).length;
      units.push({
        unitType: "ROOT_CONTENT",
        displayLabel: label(runSectionTitle === null ? "Preface content" : `Content after "${runSectionTitle}"`),
        confidence: "MEDIUM",
        candidateKind: "UNKNOWN",
        primaryAnchor: anchorOf(first),
        supportingAnchors: run.slice(1).map(anchorOf),
        payloadSchemaKey: STRUCTURAL_ROOT_CONTENT_PAYLOAD_SCHEMA,
        payload: {
          unitType: "ROOT_CONTENT",
          nodeCount: run.length,
          nodeTypes: { BLOCK: count("BLOCK"), TABLE: count("TABLE"), ASSET_PLACEMENT: count("ASSET_PLACEMENT") },
          firstNodeOrdinal: first.ordinal,
          lastNodeOrdinal: (run[run.length - 1] as ResolvedSourceContentNode).ordinal,
        },
        sourceOrderKey: first.ordinal,
        tieBreaker: first.id,
      });
    }
    run = [];
  };
  let previousOrdinal: number | null = null;
  for (const n of nodes) {
    if (n.sourceSectionId !== null) {
      flush();
      lastSectionTitle = sectionById.get(n.sourceSectionId)?.title ?? lastSectionTitle;
    } else {
      if (run.length > 0 && previousOrdinal !== null && n.ordinal !== previousOrdinal + 1) flush();
      if (run.length === 0) runSectionTitle = lastSectionTitle;
      run.push(n);
    }
    previousOrdinal = n.ordinal;
  }
  flush();

  return units.sort((a, b) => a.sourceOrderKey - b.sourceOrderKey || UNIT_RANK[a.unitType] - UNIT_RANK[b.unitType] || (a.tieBreaker < b.tieBreaker ? -1 : a.tieBreaker > b.tieBreaker ? 1 : 0));
}

/** Units -> candidate inputs, ordinals 1..n in source order. */
export function unitsToCandidates(units: readonly StructuralExtractionUnit[]): CreateExtractionCandidateInput[] {
  return units.map((u, i) => ({
    ordinal: i + 1,
    candidateKind: u.candidateKind,
    proposedEntityType: null,
    proposedCanonicalKey: null,
    displayLabel: u.displayLabel,
    confidence: u.confidence,
    payloadSchemaKey: u.payloadSchemaKey,
    payloadSchemaVersion: STRUCTURAL_PAYLOAD_SCHEMA_VERSION,
    payloadJson: u.payload,
    primarySourceAnchor: u.primaryAnchor,
    supportingSourceAnchors: u.supportingAnchors,
  }));
}

export const structuralExtractorV1: ExtractorDefinition = {
  key: STRUCTURAL_EXTRACTOR_KEY,
  version: STRUCTURAL_EXTRACTOR_VERSION,
  description: "Deterministic structural segmentation of WO1 source structure into SECTION / TABLE / ROOT_CONTENT units. No semantic interpretation.",
  payloadSchemas: [
    { key: STRUCTURAL_SECTION_PAYLOAD_SCHEMA, version: STRUCTURAL_PAYLOAD_SCHEMA_VERSION },
    { key: STRUCTURAL_TABLE_PAYLOAD_SCHEMA, version: STRUCTURAL_PAYLOAD_SCHEMA_VERSION },
    { key: STRUCTURAL_ROOT_CONTENT_PAYLOAD_SCHEMA, version: STRUCTURAL_PAYLOAD_SCHEMA_VERSION },
  ],
  acceptsConfiguration: false,
  extract: (context) => unitsToCandidates(segmentStructure(context)),
};
