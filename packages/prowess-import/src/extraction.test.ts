import type { CreateExtractionCandidateInput, ResolvedSourceContentNode, SourceBlockType, SourceSection } from "@prowess/model";
import { describe, expect, it } from "vitest";
import { ExtractionError, ExtractorRegistry, runExtraction, scopeStructure, type ExtractionBatchIdentity, type ExtractorDefinition } from "./extractor.js";
import { EXTRACTION_SET_HASH_VERSION, extractionSetHash, extractionSetPreimage, sha256Hex } from "./fingerprint.js";
import { defaultExtractorRegistry } from "./registry.js";
import { segmentStructure, structuralExtractorV1 } from "./structural-v1.js";

// ---- a tiny in-memory structure builder (shapes are exactly WO1's domain types) ----------------------------------
const SNAP = "00000000-0000-4000-8000-0000000000aa";
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const T0 = new Date(0);

class Doc {
  sections: SourceSection[] = [];
  nodes: ResolvedSourceContentNode[] = [];
  private stack: SourceSection[] = [];

  heading(level: number, title: string): this {
    while (this.stack.length > 0 && (this.stack[this.stack.length - 1] as SourceSection).headingLevel >= level) this.stack.pop();
    const parent = this.stack[this.stack.length - 1] ?? null;
    const s = { id: uid(), sourceSnapshotId: SNAP, parentSectionId: parent ? parent.id : null, title, headingLevel: level, ordinal: this.sections.length, startPage: null, endPage: null, pageLocationBasis: "UNAVAILABLE", createdAt: T0 } as SourceSection;
    this.sections.push(s);
    this.stack.push(s);
    return this.block("HEADING", title);
  }
  private get section() {
    return this.stack[this.stack.length - 1] ?? null;
  }
  block(type: SourceBlockType, text: string): this {
    const id = uid();
    const sectionId = this.section ? this.section.id : null;
    this.nodes.push({
      id: uid(), sourceSnapshotId: SNAP, sourceSectionId: sectionId, ordinal: this.nodes.length, nodeType: "BLOCK", blockId: id, tableId: null, assetPlacementId: null,
      block: { id, sourceSnapshotId: SNAP, sourceSectionId: sectionId, blockType: type, ordinal: 0, rawText: text, normalizedText: null, sourceStyle: null, listLevel: type === "LIST_ITEM" ? 0 : null, listOrdered: null, pageStart: null, pageEnd: null, pageLocationBasis: "UNAVAILABLE", createdAt: T0 },
    } as unknown as ResolvedSourceContentNode);
    return this;
  }
  p(text: string) {
    return this.block("PARAGRAPH", text);
  }
  table(rows: string[][], caption: string | null = null): this {
    const id = uid();
    const sectionId = this.section ? this.section.id : null;
    this.nodes.push({
      id: uid(), sourceSnapshotId: SNAP, sourceSectionId: sectionId, ordinal: this.nodes.length, nodeType: "TABLE", blockId: null, tableId: id, assetPlacementId: null,
      table: { id, sourceSnapshotId: SNAP, sourceSectionId: sectionId, ordinal: 0, caption, pageStart: null, pageEnd: null, pageLocationBasis: "UNAVAILABLE", rawText: null, createdAt: T0,
        structure: { schemaVersion: 1, rowCount: rows.length, columnCount: rows[0]?.length ?? 0, rows: rows.map((r, i) => ({ index: i, isHeader: i === 0, cells: r.map((t, j) => ({ index: j, columnIndex: j, rowSpan: 1, colSpan: 1, isHeader: i === 0, rawText: t, nestedTables: [] })) })) } },
    } as unknown as ResolvedSourceContentNode);
    return this;
  }
  image(): this {
    const id = uid();
    const sectionId = this.section ? this.section.id : null;
    const assetId = uid();
    this.nodes.push({
      id: uid(), sourceSnapshotId: SNAP, sourceSectionId: sectionId, ordinal: this.nodes.length, nodeType: "ASSET_PLACEMENT", blockId: null, tableId: null, assetPlacementId: id,
      placement: { id, sourceSnapshotId: SNAP, sourceAssetId: assetId, sourceSectionId: sectionId, ordinal: 0, pageNumber: null, pageLocationBasis: "UNAVAILABLE", altTextFromSource: null, createdAt: T0 },
      asset: { id: assetId, sourceSnapshotId: SNAP, assetType: "IMAGE", mimeType: "image/png", contentHash: "a".repeat(64), byteSize: 1, width: 1, height: 1, sourceFilename: null, caption: null, altTextFromSource: null, createdAt: T0 },
    } as unknown as ResolvedSourceContentNode);
    return this;
  }
  root(): this {
    this.stack = [];
    return this;
  }
}

const batchFor = (over: Partial<ExtractionBatchIdentity> = {}): ExtractionBatchIdentity => ({
  importBatchId: "b", sourceSnapshotId: SNAP, sourceStructureHash: "c".repeat(64), scopeType: "SNAPSHOT", scopeSectionId: null, extractorKey: "prowess.structural", extractorVersion: "1", extractorConfigHash: null, ...over,
});
const run = (d: Doc, over: Partial<ExtractionBatchIdentity> = {}) => runExtraction(defaultExtractorRegistry, batchFor(over), d.sections, d.nodes);
const title = (d: Doc, t: string) => d.sections.find((s) => s.title === t)!.id;
const summary = (cs: CreateExtractionCandidateInput[]) => cs.map((c) => `${c.ordinal}|${c.candidateKind}|${c.confidence}|${c.displayLabel}`);

describe("registry: exact key + version only", () => {
  it("finds prowess.structural@1 and nothing that merely resembles it", () => {
    expect(defaultExtractorRegistry.find("prowess.structural", "1")).toBe(structuralExtractorV1);
    expect(defaultExtractorRegistry.find("prowess.structural", "2")).toBeNull();
    expect(defaultExtractorRegistry.find("prowess.structural", "1.0")).toBeNull();
    expect(defaultExtractorRegistry.find("manual-foundation", "1.0")).toBeNull();
    expect(defaultExtractorRegistry.keys()).toEqual(["prowess.structural@1"]);
  });

  it("an unknown exact extractor, or a configuration v1 does not accept, is EXTRACTOR_NOT_FOUND", () => {
    const d = new Doc().heading(1, "Core").p("x");
    expect(() => run(d, { extractorVersion: "2" })).toThrow(ExtractionError);
    expect(() => run(d, { extractorVersion: "2" })).toThrow(/exactly prowess\.structural@2/);
    expect(() => run(d, { extractorConfigHash: "d".repeat(64) })).toThrow(/accepts no configuration/);
  });

  it("refuses a duplicate registration", () => {
    expect(() => new ExtractorRegistry([structuralExtractorV1, structuralExtractorV1])).toThrow(/duplicate/);
  });
});

describe("prowess.structural@1 segmentation", () => {
  it("§54 a section with direct paragraphs is ONE UNKNOWN, HIGH, section-anchored candidate citing its content", () => {
    const d = new Doc().heading(1, "Core Rules").p("One.").p("Two.").p("Three.");
    const { candidates } = run(d);
    expect(summary(candidates)).toEqual(["1|UNKNOWN|HIGH|Core Rules"]);
    const c = candidates[0]!;
    expect(c.primarySourceAnchor).toEqual({ sectionId: title(d, "Core Rules") });
    expect(c.supportingSourceAnchors!.map((a) => a.contentNodeId)).toEqual(d.nodes.slice(1).map((n) => n.id));
    expect([c.proposedEntityType, c.proposedCanonicalKey]).toEqual([null, null]);
    expect(c.payloadJson).toMatchObject({ unitType: "SECTION", title: "Core Rules", headingLevel: 1, directContentNodeCount: 3, directBlockCount: 3, childSectionCount: 0 });
  });

  it("§55 a pure container yields no candidate; its children do", () => {
    const d = new Doc().heading(1, "Spellcasting").heading(2, "Targeting").p("A target in range.").heading(2, "Effects").p("Effects text.");
    expect(summary(run(d).candidates)).toEqual(["1|UNKNOWN|HIGH|Targeting", "2|UNKNOWN|HIGH|Effects"]);
  });

  it("§56 a table is a generic REFERENCE candidate with structural metadata only", () => {
    const d = new Doc().heading(1, "Difficulty").p("Pick a DC.").table([["Task", "DC"], ["Easy", "10"], ["Hard", "20"]], "Difficulty Classes");
    const { candidates } = run(d);
    expect(summary(candidates)).toEqual(["1|UNKNOWN|HIGH|Difficulty", "2|REFERENCE|HIGH|Difficulty Classes"]);
    expect(candidates[1]!.payloadJson).toEqual({ unitType: "TABLE", sourceTableId: (d.nodes[2] as { tableId: string }).tableId, sourceContentNodeId: d.nodes[2]!.id, sourceSectionId: title(d, "Difficulty"), caption: "Difficulty Classes", rowCount: 3, columnCount: 2, hasHeader: true });
    expect(candidates[0]!.supportingSourceAnchors!.map((a) => a.contentNodeId)).toContain(d.nodes[2]!.id); // also evidence of its section
  });

  it("uncaptioned tables get deterministic source-derived labels", () => {
    const one = new Doc().heading(1, "Gear").table([["a"]]);
    const two = new Doc().heading(1, "Gear").table([["a"]]).table([["b"]]);
    const empty = new Doc().heading(1, "Gear").p("x").table([[""]]);
    expect(run(one).candidates.map((c) => c.displayLabel)).toEqual(["Table in Gear"]);
    expect(run(two).candidates.map((c) => c.displayLabel)).toEqual(["Table 1 in Gear", "Table 2 in Gear"]);
    expect(run(empty).candidates.map((c) => c.candidateKind)).toEqual(["UNKNOWN"]); // an all-empty table is not significant
  });

  it("§57 ten bullets stay with their section — one candidate, not ten", () => {
    const d = new Doc().heading(1, "Maneuvers");
    for (let i = 0; i < 10; i += 1) d.block("LIST_ITEM", `Item ${i}`);
    const { candidates } = run(d);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.payloadJson).toMatchObject({ directListItemCount: 10 });
    expect(candidates[0]!.supportingSourceAnchors!.length).toBe(10);
  });

  it("§58 / §59 / §14 formula-, requirement- and keyword-looking text stays structural (no FORMULA / REQUIREMENT / KEYWORD)", () => {
    const d = new Doc().heading(1, "Spell AP").p("Spell AP = floor(Final MP / PRO), minimum 1.").p("Requires Expert Emission.").p("**Burning** Burning Burning");
    const { candidates } = run(d);
    expect(candidates.map((c) => c.candidateKind)).toEqual(["UNKNOWN"]);
    expect(JSON.stringify(candidates)).not.toMatch(/floor|Requires Expert|Burning/); // text is cited by anchor, never copied
  });

  it("§60 an image-only section yields no candidate (the asset stays preserved in source structure)", () => {
    const d = new Doc().heading(1, "Art").image().image();
    expect(run(d).candidates).toEqual([]);
  });

  it("images in a text section are supporting anchors, never interpreted", () => {
    const d = new Doc().heading(1, "Bestiary").p("Wolves.").image();
    expect(run(d).candidates[0]!.payloadJson).toMatchObject({ directAssetPlacementCount: 1, directContentNodeCount: 2 });
  });

  it("§61 section-less content becomes contiguous ROOT_CONTENT groups (MEDIUM), in source order", () => {
    const d = new Doc().p("Preface one.").p("Preface two.").image().heading(1, "Chapter").p("Body.").root().p("Afterword.");
    const { candidates } = run(d);
    expect(summary(candidates)).toEqual(["1|UNKNOWN|MEDIUM|Preface content", "2|UNKNOWN|HIGH|Chapter", '3|UNKNOWN|MEDIUM|Content after "Chapter"']);
    expect(candidates[0]!.primarySourceAnchor).toEqual({ contentNodeId: d.nodes[0]!.id });
    expect(candidates[0]!.supportingSourceAnchors!.map((a) => a.contentNodeId)).toEqual([d.nodes[1]!.id, d.nodes[2]!.id]);
    expect(candidates[0]!.payloadJson).toEqual({ unitType: "ROOT_CONTENT", nodeCount: 3, nodeTypes: { BLOCK: 2, TABLE: 0, ASSET_PLACEMENT: 1 }, firstNodeOrdinal: 0, lastNodeOrdinal: 2 });
  });

  it("§63 a SECTION_SUBTREE batch sees only its subtree", () => {
    const d = new Doc().p("Preface.").heading(1, "Combat").p("c").heading(1, "Skills").p("s").heading(1, "Spellcasting").p("intro").heading(2, "Targeting").p("t").heading(2, "Effects").p("e").table([["x"]]);
    const { candidates } = run(d, { scopeType: "SECTION_SUBTREE", scopeSectionId: title(d, "Spellcasting") });
    expect(candidates.map((c) => c.displayLabel)).toEqual(["Spellcasting", "Targeting", "Effects", "Table in Effects"]);
    const scoped = scopeStructure(batchFor({ scopeType: "SECTION_SUBTREE", scopeSectionId: title(d, "Spellcasting") }), d.sections, d.nodes);
    expect(scoped.nodes.some((n) => n.sourceSectionId === null)).toBe(false);
  });

  it("§64 the output is identical whatever order the structure rows arrive in", () => {
    const d = new Doc().p("Pre.").heading(1, "A").p("a").table([["t"]]).heading(2, "B").p("b").image().heading(1, "C").block("LIST_ITEM", "c");
    const base = run(d);
    const shuffled = (xs: readonly unknown[]) => [...xs].reverse().sort((x, y) => ((x as { id: string }).id.charCodeAt(30) % 3) - ((y as { id: string }).id.charCodeAt(30) % 3));
    for (let i = 0; i < 3; i += 1) {
      const again = runExtraction(defaultExtractorRegistry, batchFor(), shuffled(d.sections) as SourceSection[], shuffled(d.nodes) as ResolvedSourceContentNode[]);
      expect(again.outputHash).toBe(base.outputHash);
      expect(again.fingerprints).toEqual(base.fingerprints);
      expect(summary(again.candidates)).toEqual(summary(base.candidates));
    }
  });

  it("long titles are truncated deterministically to a valid label", () => {
    const d = new Doc().heading(1, "T".repeat(500)).p("x");
    const label = run(d).candidates[0]!.displayLabel;
    expect(label.length).toBe(300);
    expect(label.endsWith("…")).toBe(true);
  });

  it("segmentation never produces game-semantic units or proposals", () => {
    const d = new Doc().heading(1, "Arcana").p("Skill text.").heading(1, "Fireball").p("Spell text.").table([["Weapon", "Damage"], ["Sword", "d8"]]);
    for (const u of segmentStructure({ batch: batchFor(), sections: d.sections, nodes: d.nodes })) expect(["SECTION", "TABLE", "ROOT_CONTENT"]).toContain(u.unitType);
    for (const c of run(d).candidates) {
      expect(["UNKNOWN", "REFERENCE"]).toContain(c.candidateKind);
      expect([c.proposedEntityType, c.proposedCanonicalKey]).toEqual([null, null]);
    }
  });
});

describe("output validation (whole output, before anything could persist)", () => {
  const d = new Doc().heading(1, "Core").p("x").heading(1, "Other").p("y");
  const withOutput = (out: (ctx: Parameters<ExtractorDefinition["extract"]>[0]) => CreateExtractionCandidateInput[]): ExtractorRegistry =>
    new ExtractorRegistry([{ ...structuralExtractorV1, extract: out }]);
  const base = (ctx: Parameters<ExtractorDefinition["extract"]>[0]) => structuralExtractorV1.extract(ctx);
  const attempt = (reg: ExtractorRegistry, over: Partial<ExtractionBatchIdentity> = {}) => () => runExtraction(reg, batchFor(over), d.sections, d.nodes);

  it.each([
    ["duplicate ordinal", (ctx: never) => base(ctx).map((c) => ({ ...c, ordinal: 1 }))],
    ["descending ordinals", (ctx: never) => base(ctx).reverse()],
    ["an undeclared payload schema", (ctx: never) => base(ctx).map((c) => ({ ...c, payloadSchemaKey: "prowess.unknown" }))],
    ["an anchor outside the structure", (ctx: never) => base(ctx).map((c) => ({ ...c, primarySourceAnchor: { sectionId: "00000000-0000-4000-8000-999999999999" } }))],
    ["a status smuggled in", (ctx: never) => base(ctx).map((c) => ({ ...c, status: "APPROVED" }) as never)],
    ["duplicate content", (ctx: never) => { const [a] = base(ctx); return [a!, { ...a!, ordinal: 2 }]; }],
    ["a non-array", () => ({}) as never],
    ["a thrown error", () => { throw new Error("boom"); }],
  ])("rejects %s as INVALID_EXTRACTOR_OUTPUT", (_n, out) => {
    expect(attempt(withOutput(out as never))).toThrow(expect.objectContaining({ kind: "INVALID_EXTRACTOR_OUTPUT" }) as unknown as Error);
  });

  it("an anchor outside a SECTION_SUBTREE scope is rejected even if it exists in the Snapshot", () => {
    const leak = withOutput((ctx) => [...base(ctx), { ...base(ctx)[0]!, ordinal: 99, displayLabel: "leak", primarySourceAnchor: { sectionId: title(d, "Other") } }]);
    expect(attempt(leak, { scopeType: "SECTION_SUBTREE", scopeSectionId: title(d, "Core") })).toThrow(/not in-scope/);
  });
});

describe("extraction set hash (PROWESS_EXTRACTION_SET_V1)", () => {
  it("uses the documented preimage, ordered by ordinal", () => {
    const entries = [{ ordinal: 2, candidateFingerprint: "b".repeat(64) }, { ordinal: 1, candidateFingerprint: "a".repeat(64) }];
    expect(extractionSetPreimage(entries)).toBe(`${EXTRACTION_SET_HASH_VERSION}\n1:${"a".repeat(64)}\n2:${"b".repeat(64)}`);
    expect(extractionSetHash(entries)).toBe(sha256Hex(extractionSetPreimage(entries)));
    expect(extractionSetHash([])).toBe(sha256Hex(EXTRACTION_SET_HASH_VERSION));
  });
  it("the run's outputHash is the set hash of its candidates", () => {
    const r = run(new Doc().heading(1, "A").p("a").table([["t"]]));
    expect(r.outputHash).toBe(extractionSetHash(r.candidates.map((c, i) => ({ ordinal: c.ordinal, candidateFingerprint: r.fingerprints[i]! }))));
  });
});
