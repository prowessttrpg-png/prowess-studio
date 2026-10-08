import { describe, expect, it } from "vitest";
import { DomainError, SOURCE_SNAPSHOT_ERROR_CODES, SOURCE_STRUCTURE_ERROR_CODES } from "./errors.js";
import {
  canonicalSourceStructureJson,
  isSha256Hex,
  normalizeSourceText,
  SOURCE_BLOCK_TYPES,
  validateCreateSourceSnapshotInput,
  validateSourceStructureInput,
  type SourceStructureInput,
  type SourceTableStructure,
} from "./source-structure.js";

const HASH = "a".repeat(64);
const table = (): SourceTableStructure => ({
  schemaVersion: 1,
  rowCount: 1,
  columnCount: 2,
  rows: [{ index: 0, isHeader: true, cells: [
    { index: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, isHeader: true, rawText: "a", nestedTables: [] },
    { index: 1, columnIndex: 1, rowSpan: 1, colSpan: 1, isHeader: true, rawText: "b", nestedTables: [] },
  ] }],
});

function valid(): SourceStructureInput {
  return {
    parserName: "test",
    parserVersion: "1",
    sections: [
      { key: "s0", parentKey: null, title: "Chapter", headingLevel: 1, ordinal: 0, pageLocationBasis: "UNAVAILABLE" },
      { key: "s1", parentKey: "s0", title: "Sub", headingLevel: 2, ordinal: 1, pageLocationBasis: "UNAVAILABLE" },
    ],
    assets: [{ key: "img", assetType: "IMAGE", mimeType: "image/png", contentHash: HASH, byteSize: 10 }],
    nodes: [
      { ordinal: 0, sectionKey: null, nodeType: "BLOCK", block: { blockType: "PARAGRAPH", rawText: "Intro", pageLocationBasis: "UNAVAILABLE" } },
      { ordinal: 1, sectionKey: "s0", nodeType: "TABLE", table: { structure: table(), pageLocationBasis: "UNAVAILABLE" } },
      { ordinal: 2, sectionKey: "s1", nodeType: "ASSET_PLACEMENT", placement: { assetKey: "img", pageLocationBasis: "UNAVAILABLE" } },
    ],
  };
}

function code(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return (e as DomainError).code;
  }
  return undefined;
}

describe("validateSourceStructureInput", () => {
  it("accepts a well-formed mixed structure", () => {
    expect(code(() => validateSourceStructureInput(valid()))).toBeUndefined();
  });

  it.each([
    ["duplicate node ordinal", (s: SourceStructureInput) => { (s.nodes[1] as { ordinal: number }).ordinal = 0; }],
    ["gap in node ordinals", (s: SourceStructureInput) => { (s.nodes[2] as { ordinal: number }).ordinal = 5; }],
    ["negative section ordinal", (s: SourceStructureInput) => { (s.sections[0] as { ordinal: number }).ordinal = -1; }],
    ["fractional ordinal", (s: SourceStructureInput) => { (s.nodes[0] as { ordinal: number }).ordinal = 0.5; }],
  ])("INVALID_ORDER: %s", (_n, mutate) => {
    const s = valid();
    mutate(s);
    expect(code(() => validateSourceStructureInput(s))).toBe(SOURCE_STRUCTURE_ERROR_CODES.INVALID_ORDER);
  });

  it.each([
    ["unknown parent", (s: SourceStructureInput) => { (s.sections[1] as { parentKey: string }).parentKey = "nope"; }],
    ["self parent", (s: SourceStructureInput) => { (s.sections[1] as { parentKey: string }).parentKey = "s1"; }],
    ["parent after child", (s: SourceStructureInput) => { (s.sections[0] as { parentKey: string | null }).parentKey = "s1"; }],
  ])("INVALID_PARENT: %s", (_n, mutate) => {
    const s = valid();
    mutate(s);
    expect(code(() => validateSourceStructureInput(s))).toBe(SOURCE_STRUCTURE_ERROR_CODES.INVALID_PARENT);
  });

  it.each([
    ["BLOCK node carrying a table", (s: SourceStructureInput) => { Object.assign(s.nodes[0] as object, { table: { structure: table(), pageLocationBasis: "UNAVAILABLE" } }); }],
    ["TABLE node without its table", (s: SourceStructureInput) => { delete (s.nodes[1] as { table?: unknown }).table; }],
    ["unknown node type", (s: SourceStructureInput) => { (s.nodes[0] as { nodeType: string }).nodeType = "SPELL_RULE"; }],
    ["unknown section key", (s: SourceStructureInput) => { (s.nodes[0] as { sectionKey: string }).sectionKey = "ghost"; }],
    ["unknown asset key", (s: SourceStructureInput) => { ((s.nodes[2] as { placement: { assetKey: string } }).placement).assetKey = "ghost"; }],
  ])("INVALID_NODE_TARGET: %s", (_n, mutate) => {
    const s = valid();
    mutate(s);
    expect(code(() => validateSourceStructureInput(s))).toBe(SOURCE_STRUCTURE_ERROR_CODES.INVALID_NODE_TARGET);
  });

  it.each([
    ["semantic block type", (s: SourceStructureInput) => { ((s.nodes[0] as { block: { blockType: string } }).block).blockType = "DAMAGE_FORMULA"; }],
    ["invented page numbers under UNAVAILABLE", (s: SourceStructureInput) => { Object.assign((s.nodes[0] as { block: object }).block, { pageStart: 4 }); }],
    ["SOURCE_NATIVE without a page", (s: SourceStructureInput) => { Object.assign((s.nodes[0] as { block: object }).block, { pageLocationBasis: "SOURCE_NATIVE" }); }],
    ["table rowCount mismatch", (s: SourceStructureInput) => { ((s.nodes[1] as { table: { structure: SourceTableStructure } }).table.structure).rowCount = 3; }],
    ["table cell span zero", (s: SourceTableStructure | SourceStructureInput) => { ((s as SourceStructureInput).nodes[1] as { table: { structure: SourceTableStructure } }).table.structure.rows[0]!.cells[0]!.colSpan = 0; }],
    ["bad asset hash", (s: SourceStructureInput) => { (s.assets[0] as { contentHash: string }).contentHash = "XYZ"; }],
    ["duplicate asset bytes", (s: SourceStructureInput) => { s.assets.push({ ...(s.assets[0] as object), key: "img2" } as never); }],
    ["missing parser name", (s: SourceStructureInput) => { s.parserName = ""; }],
  ])("INVALID_INPUT: %s", (_n, mutate) => {
    const s = valid();
    mutate(s);
    expect(code(() => validateSourceStructureInput(s))).toBe(SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT);
  });

  it("block types are structural only — no game-semantic vocabulary", () => {
    for (const t of SOURCE_BLOCK_TYPES) expect(t).not.toMatch(/SPELL|DAMAGE|FORMULA|SKILL|MANEUVER|SUMMON|RULE|MISSION/);
  });
});

describe("canonicalSourceStructureJson", () => {
  it("is independent of array order and object key order, and of undefined vs null optionals", () => {
    const a = valid();
    const b = valid();
    b.nodes.reverse();
    b.sections.reverse();
    (b.nodes.find((n) => n.nodeType === "BLOCK") as { block: { normalizedText?: null } }).block.normalizedText = null;
    expect(canonicalSourceStructureJson(b)).toBe(canonicalSourceStructureJson(a));
  });

  it("changes when any text changes", () => {
    const b = valid();
    (b.nodes[0] as { block: { rawText: string } }).block.rawText = "Intro!";
    expect(canonicalSourceStructureJson(b)).not.toBe(canonicalSourceStructureJson(valid()));
  });
});

describe("normalizeSourceText", () => {
  it("returns null when raw is already normal, so raw stays the only copy", () => {
    expect(normalizeSourceText("Plain text.")).toBeNull();
  });
  it("collapses whitespace without touching raw", () => {
    const raw = "  Damage =\t(Power × 2)\n+ Tier ";
    expect(normalizeSourceText(raw)).toBe("Damage = (Power × 2) + Tier");
    expect(raw).toBe("  Damage =\t(Power × 2)\n+ Tier ");
  });
});

describe("validateCreateSourceSnapshotInput", () => {
  const ok = { label: "V0.1", originalFilename: "packet.docx", mimeType: "application/x", contentHash: HASH, byteSize: 1 };
  it("accepts well-formed metadata", () => {
    expect(code(() => validateCreateSourceSnapshotInput(ok))).toBeUndefined();
    expect(isSha256Hex(HASH)).toBe(true);
  });
  it.each([
    { ...ok, label: " " },
    { ...ok, originalFilename: "" },
    { ...ok, contentHash: HASH.toUpperCase() },
    { ...ok, byteSize: -1 },
    { ...ok, pageCount: 0 },
    { ...ok, declaredVersion: "" },
  ])("rejects %j", (input) => {
    expect(code(() => validateCreateSourceSnapshotInput(input))).toBe(SOURCE_SNAPSHOT_ERROR_CODES.INVALID_INPUT);
  });
});
