import { createHash } from "node:crypto";
import {
  canonicalSourceStructureJson,
  DomainError,
  SOURCE_PARSE_ERROR_CODES,
  validateSourceStructureInput,
  type SourceContentNodeInput,
  type SourceStructureInput,
  type SourceTableStructure,
} from "@prowess/model";
import { describe, expect, it } from "vitest";
import { DOCX_PARSER_NAME, DOCX_PARSER_VERSION, parseDocxStructure } from "../../src/source-ingestion/docx/parse";
import { readImageDimensions } from "../../src/source-ingestion/docx/image-info";
import { parseXml, textContent } from "../../src/source-ingestion/docx/xml";
import { ZipArchive } from "../../src/source-ingestion/docx/zip";
import { buildDocx, buildZip, makePng } from "../fixtures/docx-builder";
import {
  CORE_RULES,
  docx,
  FORMULAS_IN_PROSE,
  IMG_A,
  IMG_B,
  ILLUSTRATED,
  MISSION_TABLES,
  PLAYTEST_PACKET_MINIATURE,
  PROCEDURES,
  SKILL_TIERS,
  SPELL_MODULES,
  TABLES,
} from "../fixtures/prowess-structure-fixtures";

/**
 * M3-WO1 — the DOCX STRUCTURAL parser, against small deterministic synthetic fixtures (CI verification). These do
 * NOT use the real Prowess Core Playtest Packet; see docs/architecture/m3-source-structure.md for the distinction.
 */
const parse = (d: Parameters<typeof docx>[0]) => parseDocxStructure(docx(d)).structure;
const blocks = (s: SourceStructureInput) => s.nodes.filter((n): n is Extract<SourceContentNodeInput, { nodeType: "BLOCK" }> => n.nodeType === "BLOCK").map((n) => n.block);
const tables = (s: SourceStructureInput) => s.nodes.filter((n): n is Extract<SourceContentNodeInput, { nodeType: "TABLE" }> => n.nodeType === "TABLE").map((n) => n.table);
const title = (s: SourceStructureInput, key: string | null) => s.sections.find((x) => x.key === key)?.title ?? null;

describe("DOCX structural parser — output is a valid, deterministic structure", () => {
  it("every fixture parses into a structure the model validator accepts", () => {
    for (const f of [CORE_RULES, PROCEDURES, FORMULAS_IN_PROSE, TABLES, SKILL_TIERS, SPELL_MODULES, MISSION_TABLES, ILLUSTRATED, PLAYTEST_PACKET_MINIATURE]) {
      expect(() => validateSourceStructureInput(parse(f))).not.toThrow();
    }
  });

  it("is deterministic: the same bytes always give the same canonical structure (and the builder is byte-stable)", () => {
    const bytes = docx(PLAYTEST_PACKET_MINIATURE);
    expect(docx(PLAYTEST_PACKET_MINIATURE).equals(bytes)).toBe(true);
    expect(canonicalSourceStructureJson(parseDocxStructure(bytes).structure)).toBe(canonicalSourceStructureJson(parseDocxStructure(Buffer.from(bytes)).structure));
  });

  it("identifies itself as the structural parser", () => {
    const s = parse(CORE_RULES);
    expect([s.parserName, s.parserVersion]).toEqual([DOCX_PARSER_NAME, DOCX_PARSER_VERSION]);
  });

  it("reports only DECLARED metadata (Word's own page count and title), never computed pagination", () => {
    expect(parseDocxStructure(docx(CORE_RULES)).declared).toEqual({ pageCount: 12, title: "Core Rules Fixture" });
    expect(parseDocxStructure(docx(PROCEDURES)).declared).toEqual({ pageCount: null, title: null });
  });
});

describe("headings, nesting and ordering", () => {
  it("builds nested sections from the heading hierarchy, parents always preceding children", () => {
    const s = parse(CORE_RULES);
    expect(s.sections.map((x) => [x.title, x.headingLevel, title(s, x.parentKey)])).toEqual([
      ["Chapter 1: Introduction", 1, null],
      ["What You Need", 2, "Chapter 1: Introduction"],
      ["Core Concepts", 2, "Chapter 1: Introduction"],
      ["Action Points", 3, "Core Concepts"],
      ["Chapter 2: Characters", 1, null],
    ]);
  });

  it("content before the first heading belongs to no section; each later node to the innermost open section", () => {
    const s = parse(CORE_RULES);
    expect(s.nodes.slice(0, 2).map((n) => n.sectionKey)).toEqual([null, null]);
    const a = s.nodes.find((n) => n.nodeType === "BLOCK" && n.block.rawText.startsWith("A character spends"));
    expect(title(s, a?.sectionKey ?? null)).toBe("Action Points");
  });

  it("keeps the heading text as a verbatim HEADING block at the start of its section (raw is never replaced)", () => {
    const s = parse(CORE_RULES);
    const heading = s.nodes.find((n) => n.nodeType === "BLOCK" && n.block.blockType === "HEADING");
    expect(heading && heading.nodeType === "BLOCK" && heading.block.rawText).toBe("Chapter 1: Introduction");
  });

  it("a Title-styled paragraph is NOT a heading (no outline level); its style is preserved as metadata", () => {
    const b = blocks(parse(CORE_RULES))[0];
    expect([b?.blockType, b?.sourceStyle]).toEqual(["PARAGRAPH", "Title"]);
  });

  it("node ordinals are the original document order, contiguous from 0", () => {
    const s = parse(PLAYTEST_PACKET_MINIATURE);
    expect(s.nodes.map((n) => n.ordinal)).toEqual(s.nodes.map((_, i) => i));
  });

  it("Trained / Expert / Master subdivisions are plain nested headings — no skill semantics", () => {
    const s = parse(SKILL_TIERS);
    const athletics = s.sections.find((x) => x.title === "Athletics");
    expect(s.sections.filter((x) => x.parentKey === athletics?.key).map((x) => x.title)).toEqual(["Trained", "Expert", "Master"]);
    expect(s.sections.filter((x) => x.title === "Trained").map((x) => title(s, x.parentKey))).toEqual(["Athletics", "Lore"]);
  });

  it("modular spell sections, summoning and maneuvers are just sections, paragraphs and list items", () => {
    const s = parse(SPELL_MODULES);
    expect(s.sections.map((x) => x.title)).toEqual(["Spellcasting", "Spell Modules", "Effect: Direct Damage", "Modifier: Area", "Summoning", "Maneuvers"]);
    expect(new Set(blocks(s).map((b) => b.blockType))).toEqual(new Set(["HEADING", "PARAGRAPH", "LIST_ITEM"]));
  });
});

describe("text is preserved verbatim; normalization never replaces raw", () => {
  it("formulas written in prose survive byte-for-byte as PARAGRAPH text", () => {
    const b = blocks(parse(FORMULAS_IN_PROSE)).filter((x) => x.blockType === "PARAGRAPH");
    expect(b.map((x) => x.rawText)).toEqual([
      "Damage equals (Power × 2) + Tier − Resistance, minimum 1.",
      "MP cost = 3 + (2 × Range Step); halve it (round up) when Focused.",
      "A spell's AP cost is 1 per Action plus the casting modifier.",
    ]);
    expect(b.every((x) => x.normalizedText === null)).toBe(true);
  });

  it("tabs, doubled spaces and line breaks stay in rawText; normalizedText is a separate view", () => {
    const b = blocks(parse(CORE_RULES));
    const tab = b.find((x) => x.rawText.includes("\t"));
    expect(tab?.rawText).toBe("Dice, pencils and\tfriends.");
    expect(tab?.normalizedText).toBe("Dice, pencils and friends.");
    const dbl = b.find((x) => x.rawText.includes("  "));
    expect(dbl?.rawText).toBe("Welcome to the game.  Read this chapter first.");
    expect(dbl?.normalizedText).toBe("Welcome to the game. Read this chapter first.");
  });
});

describe("lists", () => {
  it("numbered procedures and bullets keep order, nesting level and ordered/bulleted kind", () => {
    const items = blocks(parse(PROCEDURES)).filter((b) => b.blockType === "LIST_ITEM");
    expect(items.map((b) => [b.rawText, b.listLevel, b.listOrdered])).toEqual([
      ["Choose the attribute.", 0, true],
      ["Roll the dice.", 0, true],
      ["Apply any modifier.", 1, true],
      ["Compare to the target.", 0, true],
      ["Critical results are noted.", 0, false],
      ["Ties favour the defender.", 1, false],
    ]);
  });
});

describe("tables stay structured", () => {
  const [simple, complex] = tables(parse(TABLES)) as unknown as [{ structure: SourceTableStructure; caption?: string | null; rawText?: string | null }, { structure: SourceTableStructure; caption?: string | null }];

  it("a simple table keeps rows, columns, header row and cell text in order", () => {
    expect(simple.structure.rowCount).toBe(3);
    expect(simple.structure.columnCount).toBe(2);
    expect(simple.structure.rows.map((r) => [r.isHeader, r.cells.map((c) => c.rawText)])).toEqual([
      [true, ["Step", "Distance"]],
      [false, ["1", "Touch"]],
      [false, ["2", "Near"]],
    ]);
    expect(simple.rawText).toBe("Step\tDistance\n1\tTouch\n2\tNear");
  });

  it("the caption paragraph before a table is its own CAPTION block, not merged into the table", () => {
    expect(blocks(parse(TABLES)).find((b) => b.blockType === "CAPTION")?.rawText).toBe("Table 1: Range Steps");
    expect(simple.caption).toBeNull();
    expect(complex.caption).toBe("Weapon Groups");
  });

  it("row spans, column spans, multiple header rows and grid positions are explicit", () => {
    const rows = complex.structure.rows;
    expect(rows.filter((r) => r.isHeader).length).toBe(2);
    expect(rows[0]?.cells.map((c) => [c.rawText, c.columnIndex, c.rowSpan, c.colSpan])).toEqual([
      ["Group", 0, 2, 1],
      ["Damage", 1, 1, 2],
    ]);
    expect(rows[1]?.cells.map((c) => [c.rawText, c.columnIndex])).toEqual([["Light", 1], ["Heavy", 2]]);
    expect(rows[2]?.cells[0]).toMatchObject({ rawText: "Blades", rowSpan: 2 });
    expect(rows[4]?.cells).toEqual([expect.objectContaining({ rawText: "Notes span the table", colSpan: 3, columnIndex: 0 })]);
    expect(complex.structure.columnCount).toBe(3);
  });

  it("a nested table inside a cell stays a nested structure", () => {
    const cell = complex.structure.rows[3]?.cells.find((c) => c.rawText === "see below");
    expect(cell?.nestedTables[0]?.rows.map((r) => r.cells.map((c) => c.rawText))).toEqual([["Edge", "+1"], ["Point", "+2"]]);
  });

  it("mission-generator roll tables keep their ranges verbatim", () => {
    const [d6, d66] = tables(parse(MISSION_TABLES));
    expect(d6?.structure.rows.map((r) => r.cells[0]?.rawText)).toEqual(["d6", "1–2", "3–4", "5–6"]);
    expect(d66?.structure.rows[0]?.cells.map((c) => c.rawText)).toEqual(["d66", "Complication"]);
  });
});

describe("assets are explicit, never analysed", () => {
  const s = parse(ILLUSTRATED);

  it("the same bytes are ONE asset with several placements; distinct bytes are distinct assets", () => {
    expect(s.assets.length).toBe(3);
    const hashA = createHash("sha256").update(IMG_A).digest("hex");
    const a = s.assets.find((x) => x.contentHash === hashA);
    expect(s.nodes.filter((n) => n.nodeType === "ASSET_PLACEMENT" && n.placement.assetKey === a?.key).length).toBe(2);
  });

  it("asset metadata comes from the source: mime type, exact byte size, header dimensions, alt text", () => {
    const b = s.assets.find((x) => x.contentHash === createHash("sha256").update(IMG_B).digest("hex"));
    expect(b).toMatchObject({ assetType: "IMAGE", mimeType: "image/png", byteSize: IMG_B.length, width: 5, height: 4, altTextFromSource: "A wolf", caption: null });
  });

  it("each placement keeps its own alt text, and an image-only page yields a placement with no empty block", () => {
    const flow = s.nodes.map((n) => (n.nodeType === "BLOCK" ? `B:${n.block.rawText}` : n.nodeType === "TABLE" ? "T" : `I:${n.placement.altTextFromSource}`));
    expect(flow).toEqual([
      "B:Bestiary",
      "I:A full-page illustration",
      "B:The wolf hunts in packs.",
      "I:A wolf",
      "B:Figure: tracks ",
      "I:null",
      "I:The same illustration again",
      "T",
      "I:null", // the image inside the table's cell is placed right after the table
    ]);
  });

  it("no page number is ever invented: every location is UNAVAILABLE with null pages", () => {
    const all = parse(PLAYTEST_PACKET_MINIATURE);
    for (const sec of all.sections) expect([sec.pageLocationBasis, sec.startPage ?? null]).toEqual(["UNAVAILABLE", null]);
    for (const n of all.nodes) {
      const loc = n.nodeType === "BLOCK" ? n.block : n.nodeType === "TABLE" ? n.table : n.placement;
      expect(loc.pageLocationBasis).toBe("UNAVAILABLE");
      expect(JSON.stringify(loc)).not.toMatch(/"page(Start|End|Number)":\s*\d/);
    }
  });
});

describe("robustness", () => {
  const expectMalformed = (bytes: Buffer) => {
    let err: unknown;
    try {
      parseDocxStructure(bytes);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(SOURCE_PARSE_ERROR_CODES.MALFORMED_SOURCE);
  };

  it("non-ZIP bytes, a ZIP without word/document.xml, and malformed XML are SOURCE_PARSE.MALFORMED_SOURCE", () => {
    expectMalformed(Buffer.from("definitely not a docx"));
    expectMalformed(buildZip([{ name: "hello.txt", data: Buffer.from("hi") }]));
    expectMalformed(buildZip([{ name: "word/document.xml", data: Buffer.from("<w:document><w:body></w:document>") }]));
  });

  it("tracked deletions, field codes and page breaks contribute no text; markup-compatibility content is read once", () => {
    const s = parse({
      blocks: [
        { kind: "raw", xml: '<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>Deleted</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:br w:type="page"/></w:r><w:ins><w:r><w:t> inserted</w:t></w:r></w:ins></w:p>' },
        { kind: "raw", xml: '<w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps"><w:r><w:t>Once</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>Once</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>' },
        { kind: "empty" },
      ],
    });
    expect(blocks(s).map((b) => b.rawText)).toEqual(["Kept inserted", "Once"]);
  });

  it("content controls (w:sdt) are unwrapped in order", () => {
    const s = parse({ blocks: [{ kind: "raw", xml: "<w:sdt><w:sdtContent><w:p><w:r><w:t>Inside control</w:t></w:r></w:p></w:sdtContent></w:sdt>" }] });
    expect(blocks(s).map((b) => b.rawText)).toEqual(["Inside control"]);
  });

  it("an empty document is a valid, empty structure", () => {
    const s = parse({ blocks: [] });
    expect([s.sections.length, s.nodes.length, s.assets.length]).toEqual([0, 0, 0]);
  });

  it("building blocks: ZIP reader round-trips stored and deflated entries; XML entities decode; image headers read", () => {
    const zip = new ZipArchive(buildZip([{ name: "a.txt", data: Buffer.from("stored"), store: true }, { name: "b.txt", data: Buffer.from("deflated ".repeat(50)) }]));
    expect(zip.readText("a.txt")).toBe("stored");
    expect(zip.readText("b.txt")).toBe("deflated ".repeat(50));
    expect(zip.read("missing")).toBeNull();
    expect(textContent(parseXml('<a x="1 &gt; 0">A &amp; B &#x2212; &#8722;<![CDATA[<raw>]]></a>'))).toBe("A & B − −<raw>");
    expect(readImageDimensions(makePng(9, 4))).toEqual({ width: 9, height: 4 });
    expect(readImageDimensions(Buffer.from("nope"))).toEqual({ width: null, height: null });
    expect(buildDocx({ blocks: [] }).length).toBeGreaterThan(0);
  });
});
