import { createHash } from "node:crypto";
import {
  DomainError,
  normalizeSourceText,
  SOURCE_PARSE_ERROR_CODES,
  SOURCE_TABLE_STRUCTURE_SCHEMA_VERSION,
  type SourceAssetInput,
  type SourceAssetType,
  type SourceBlockType,
  type SourceContentNodeInput,
  type SourceSectionInput,
  type SourceStructureInput,
  type SourceTableCell,
  type SourceTableRow,
  type SourceTableStructure,
} from "@prowess/model";
import { readImageDimensions } from "./image-info.js";
import { childElements, findDescendants, firstChild, isElement, parseXml, textContent, XmlFormatError, type XmlElement } from "./xml.js";
import { ZipArchive, ZipFormatError } from "./zip.js";

/**
 * Deterministic DOCX STRUCTURAL parser (PAS-10 M3-WO1).
 *
 * Reads WordprocessingML structure and nothing else: heading hierarchy (outline levels), paragraphs, list items
 * (bulleted vs numbered, nesting level), tables (header rows, row spans, column spans, nested tables), embedded
 * images / objects (with their source alt text and exact bytes' hash) and document order. It NEVER interprets prose:
 * there is no notion of a spell, a formula, a skill tier or a damage value anywhere in this file — "formulas
 * expressed in prose" stay verbatim prose, and a Trained/Expert/Master subdivision is simply a heading.
 *
 * Location data: DOCX has no reliable pagination without rendering, so EVERY page field is left null with
 * `pageLocationBasis = UNAVAILABLE`; page numbers are never invented. All ordering is derived from document order.
 * The page count Word itself recorded (docProps/app.xml `<Pages>`) is reported as declared source metadata only.
 *
 * Deliberately out of scope (documented in docs/architecture/m3-source-structure.md): headers/footers, footnotes,
 * endnotes, comments and tracked deletions (`w:del`) — the latter is not what the document currently says.
 * Empty paragraphs (no text, no asset) are spacing, not content, and produce no block.
 */
export const DOCX_PARSER_NAME = "prowess-docx-structure";
export const DOCX_PARSER_VERSION = "1.0.0";
export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface DocxDeclaredMetadata {
  /** Page count Word recorded at last save (`docProps/app.xml`), or null. Declared, not computed. */
  pageCount: number | null;
  /** `dc:title` from `docProps/core.xml`, or null. */
  title: string | null;
}

export interface ParsedDocx {
  structure: SourceStructureInput;
  declared: DocxDeclaredMetadata;
}

const malformed = (message: string) => new DomainError(SOURCE_PARSE_ERROR_CODES.MALFORMED_SOURCE, message);

interface StyleInfo {
  name: string | null;
  basedOn: string | null;
  outlineLevel: number | null;
  numId: string | null;
  ilvl: number | null;
}

interface ParseContext {
  zip: ZipArchive;
  styles: Map<string, StyleInfo>;
  /** numId -> level -> ordered? */
  numbering: Map<string, Map<number, boolean>>;
  /** relationship id -> target part path (within the package) */
  rels: Map<string, { target: string; external: boolean }>;
  contentTypes: { defaults: Map<string, string>; overrides: Map<string, string> };
  sections: SourceSectionInput[];
  nodes: SourceContentNodeInput[];
  assets: Map<string, SourceAssetInput>; // key = content hash
  sectionStack: Array<{ key: string; level: number }>;
}

const W = (local: string) => `w:${local}`;
const attr = (el: XmlElement | undefined, name: string): string | undefined => (el ? el.attrs[name] : undefined);

/** Parses DOCX bytes into a structure. Throws SOURCE_PARSE.MALFORMED_SOURCE for anything that is not a DOCX. */
export function parseDocxStructure(bytes: Buffer): ParsedDocx {
  try {
    return parseUnchecked(bytes);
  } catch (error) {
    if (error instanceof ZipFormatError || error instanceof XmlFormatError) throw malformed(`Not a well-formed DOCX: ${error.message}`);
    throw error;
  }
}

function parseUnchecked(bytes: Buffer): ParsedDocx {
  const zip = new ZipArchive(bytes);
  const documentXml = zip.readText("word/document.xml");
  if (documentXml === null) throw malformed("Not a DOCX: word/document.xml is missing");
  const body = firstChild(firstChild(parseXml(documentXml), W("document")), W("body"));
  if (!body) throw malformed("Not a DOCX: word/document.xml has no w:document/w:body");

  const ctx: ParseContext = {
    zip,
    styles: readStyles(zip),
    numbering: readNumbering(zip),
    rels: readRelationships(zip),
    contentTypes: readContentTypes(zip),
    sections: [],
    nodes: [],
    assets: new Map(),
    sectionStack: [],
  };
  walkBlockContainer(ctx, body);

  return {
    structure: {
      parserName: DOCX_PARSER_NAME,
      parserVersion: DOCX_PARSER_VERSION,
      sections: ctx.sections,
      assets: [...ctx.assets.values()],
      nodes: ctx.nodes,
    },
    declared: readDeclaredMetadata(zip),
  };
}

// ---- package parts ----------------------------------------------------------------------------------------------

function readStyles(zip: ZipArchive): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  const xml = zip.readText("word/styles.xml");
  if (xml === null) return out;
  const root = firstChild(parseXml(xml), W("styles"));
  if (!root) return out;
  for (const style of childElements(root, W("style"))) {
    const id = attr(style, "w:styleId");
    if (!id) continue;
    const pPr = firstChild(style, W("pPr"));
    const outline = attr(firstChild(pPr, W("outlineLvl")), "w:val");
    const numPr = firstChild(pPr, W("numPr"));
    const ilvl = attr(firstChild(numPr, W("ilvl")), "w:val");
    out.set(id, {
      name: attr(firstChild(style, W("name")), "w:val") ?? null,
      basedOn: attr(firstChild(style, W("basedOn")), "w:val") ?? null,
      outlineLevel: outline === undefined ? null : Number.parseInt(outline, 10),
      numId: attr(firstChild(numPr, W("numId")), "w:val") ?? null,
      ilvl: ilvl === undefined ? null : Number.parseInt(ilvl, 10),
    });
  }
  return out;
}

function readNumbering(zip: ZipArchive): Map<string, Map<number, boolean>> {
  const out = new Map<string, Map<number, boolean>>();
  const xml = zip.readText("word/numbering.xml");
  if (xml === null) return out;
  const root = firstChild(parseXml(xml), W("numbering"));
  if (!root) return out;
  const abstract = new Map<string, Map<number, boolean>>();
  for (const a of childElements(root, W("abstractNum"))) {
    const levels = new Map<number, boolean>();
    for (const lvl of childElements(a, W("lvl"))) {
      const fmt = attr(firstChild(lvl, W("numFmt")), "w:val") ?? "decimal";
      levels.set(Number.parseInt(attr(lvl, "w:ilvl") ?? "0", 10), fmt !== "bullet" && fmt !== "none");
    }
    const id = attr(a, "w:abstractNumId");
    if (id !== undefined) abstract.set(id, levels);
  }
  for (const num of childElements(root, W("num"))) {
    const id = attr(num, "w:numId");
    const abs = attr(firstChild(num, W("abstractNumId")), "w:val");
    if (id !== undefined && abs !== undefined) out.set(id, abstract.get(abs) ?? new Map());
  }
  return out;
}

function readRelationships(zip: ZipArchive): Map<string, { target: string; external: boolean }> {
  const out = new Map<string, { target: string; external: boolean }>();
  const xml = zip.readText("word/_rels/document.xml.rels");
  if (xml === null) return out;
  const root = firstChild(parseXml(xml), "Relationships");
  if (!root) return out;
  for (const rel of childElements(root, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (!id || !target) continue;
    const external = attr(rel, "TargetMode") === "External";
    out.set(id, { target: external ? target : resolvePartPath("word", target), external });
  }
  return out;
}

function resolvePartPath(baseDir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${baseDir}/${target}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

function readContentTypes(zip: ZipArchive): ParseContext["contentTypes"] {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const xml = zip.readText("[Content_Types].xml");
  const root = xml === null ? undefined : firstChild(parseXml(xml), "Types");
  if (root) {
    for (const d of childElements(root, "Default")) if (d.attrs.Extension && d.attrs.ContentType) defaults.set(d.attrs.Extension.toLowerCase(), d.attrs.ContentType);
    for (const o of childElements(root, "Override")) if (o.attrs.PartName && o.attrs.ContentType) overrides.set(o.attrs.PartName.replace(/^\//, ""), o.attrs.ContentType);
  }
  return { defaults, overrides };
}

function readDeclaredMetadata(zip: ZipArchive): DocxDeclaredMetadata {
  let pageCount: number | null = null;
  const app = zip.readText("docProps/app.xml");
  if (app !== null) {
    const pages = findDescendants(parseXml(app), "Pages")[0];
    const value = pages ? Number.parseInt(textContent(pages).trim(), 10) : Number.NaN;
    if (Number.isInteger(value) && value > 0) pageCount = value;
  }
  let title: string | null = null;
  const core = zip.readText("docProps/core.xml");
  if (core !== null) {
    const t = findDescendants(parseXml(core), "dc:title")[0];
    const value = t ? textContent(t).trim() : "";
    if (value.length > 0) title = value;
  }
  return { pageCount, title };
}

// ---- body traversal ----------------------------------------------------------------------------------------------

/** Walks a block-level container (body, table cell, text box) in document order. */
function walkBlockContainer(ctx: ParseContext, container: XmlElement): void {
  for (const child of container.children) {
    if (!isElement(child)) continue;
    switch (child.name) {
      case W("p"):
        handleParagraph(ctx, child);
        break;
      case W("tbl"):
        handleTable(ctx, child);
        break;
      case W("sdt"): {
        const content = firstChild(child, W("sdtContent"));
        if (content) walkBlockContainer(ctx, content);
        break;
      }
      case W("customXml"):
      case W("ins"):
      case W("smartTag"):
        walkBlockContainer(ctx, child);
        break;
      default:
        // w:sectPr, w:bookmarkStart/End, w:del, w:altChunk, ... carry no content of their own.
        break;
    }
  }
}

function currentSectionKey(ctx: ParseContext): string | null {
  return ctx.sectionStack.length > 0 ? (ctx.sectionStack[ctx.sectionStack.length - 1] as { key: string }).key : null;
}

/** Resolves a style property through the basedOn chain (bounded, cycle-safe). */
function styleChain(ctx: ParseContext, styleId: string | undefined): StyleInfo[] {
  const chain: StyleInfo[] = [];
  const seen = new Set<string>();
  let id = styleId;
  while (id && !seen.has(id) && chain.length < 20) {
    seen.add(id);
    const s = ctx.styles.get(id);
    if (!s) break;
    chain.push(s);
    id = s.basedOn ?? undefined;
  }
  return chain;
}

interface ParagraphShape {
  styleId: string | null;
  headingLevel: number | null;
  listLevel: number | null;
  listOrdered: boolean | null;
  isCaption: boolean;
}

function paragraphShape(ctx: ParseContext, p: XmlElement): ParagraphShape {
  const pPr = firstChild(p, W("pPr"));
  const styleId = attr(firstChild(pPr, W("pStyle")), "w:val") ?? null;
  const chain = styleChain(ctx, styleId ?? undefined);

  // Heading: an explicit outline level (paragraph, then style chain), else a built-in "heading N" style name.
  let outline: number | null = null;
  const direct = attr(firstChild(pPr, W("outlineLvl")), "w:val");
  if (direct !== undefined) outline = Number.parseInt(direct, 10);
  for (const s of chain) if (outline === null && s.outlineLevel !== null) outline = s.outlineLevel;
  if (outline === null) {
    for (const s of chain) {
      const m = /^heading\s*([1-9])$/i.exec(s.name ?? "");
      if (m) {
        outline = Number.parseInt(m[1] as string, 10) - 1;
        break;
      }
    }
  }
  // Outline level 9 means "body text" in WordprocessingML.
  const headingLevel = outline !== null && Number.isInteger(outline) && outline >= 0 && outline <= 8 ? outline + 1 : null;

  // List membership: direct numPr, else the style chain's numPr. numId 0 means "not a list".
  const numPr = firstChild(pPr, W("numPr"));
  let numId = attr(firstChild(numPr, W("numId")), "w:val") ?? null;
  let ilvlRaw = attr(firstChild(numPr, W("ilvl")), "w:val");
  for (const s of chain) {
    if (numId === null && s.numId !== null) numId = s.numId;
    if (ilvlRaw === undefined && s.ilvl !== null) ilvlRaw = String(s.ilvl);
  }
  let listLevel: number | null = null;
  let listOrdered: boolean | null = null;
  if (numId !== null && numId !== "0") {
    listLevel = ilvlRaw === undefined ? 0 : Number.parseInt(ilvlRaw, 10);
    if (!Number.isInteger(listLevel) || listLevel < 0) listLevel = 0;
    const levels = ctx.numbering.get(numId);
    listOrdered = levels?.get(listLevel) ?? null;
  }

  const isCaption = chain.some((s) => /^caption$/i.test(s.name ?? ""));
  return { styleId, headingLevel, listLevel, listOrdered, isCaption };
}

interface InlineAsset {
  partPath: string;
  assetType: SourceAssetType;
  altText: string | null;
}

/** Collects a paragraph's verbatim text and its inline assets, in run order. */
function collectInline(ctx: ParseContext, el: XmlElement, acc: { text: string; assets: InlineAsset[]; textBoxes: XmlElement[] }): void {
  for (const child of el.children) {
    if (!isElement(child)) continue;
    switch (child.name) {
      case W("t"):
      case "m:t":
        acc.text += textContent(child);
        break;
      case W("tab"):
      case W("ptab"):
        acc.text += "\t";
        break;
      case W("br"):
        // A page break is a rendering location hint, not text. Line / column breaks are newlines.
        if (attr(child, "w:type") !== "page") acc.text += "\n";
        break;
      case W("cr"):
        acc.text += "\n";
        break;
      case W("noBreakHyphen"):
        acc.text += "\u2011";
        break;
      case W("softHyphen"):
        acc.text += "\u00AD";
        break;
      case W("sym"): {
        const code = attr(child, "w:char");
        if (code && /^[0-9A-Fa-f]+$/.test(code)) acc.text += String.fromCodePoint(Number.parseInt(code, 16));
        break;
      }
      case W("drawing"):
        collectDrawing(child, acc);
        break;
      case W("pict"):
      case W("object"):
        collectLegacy(child, acc);
        break;
      case "mc:AlternateContent": {
        // Markup-compatibility wrapper: the Choice and the Fallback describe the SAME content. Read exactly one.
        const chosen = firstChild(child, "mc:Choice") ?? firstChild(child, "mc:Fallback");
        if (chosen) collectInline(ctx, chosen, acc);
        break;
      }
      case W("del"):
      case W("delText"):
      case W("instrText"):
      case W("delInstrText"):
      case W("pPr"):
      case W("rPr"):
      case W("fldChar"):
      case W("footnoteReference"):
      case W("endnoteReference"):
      case W("commentReference"):
        break;
      default:
        // w:r, w:hyperlink, w:ins, w:smartTag, w:fldSimple, w:sdt/w:sdtContent, m:oMath, m:r, ... — descend.
        collectInline(ctx, child, acc);
    }
  }
}

function collectDrawing(drawing: XmlElement, acc: { assets: InlineAsset[]; textBoxes: XmlElement[] }): void {
  const docPr = findDescendants(drawing, "wp:docPr")[0];
  const altText = docPr ? (docPr.attrs.descr?.length ? docPr.attrs.descr : docPr.attrs.title?.length ? docPr.attrs.title : null) : null;
  for (const blip of findDescendants(drawing, "a:blip")) {
    const rid = blip.attrs["r:embed"];
    if (rid) acc.assets.push({ partPath: rid, assetType: "IMAGE", altText });
  }
  for (const box of findDescendants(drawing, W("txbxContent"))) acc.textBoxes.push(box);
}

function collectLegacy(el: XmlElement, acc: { assets: InlineAsset[]; textBoxes: XmlElement[] }): void {
  const ole = findDescendants(el, "o:OLEObject")[0];
  if (el.name === W("object") && ole?.attrs["r:id"]) {
    acc.assets.push({ partPath: ole.attrs["r:id"], assetType: "EMBEDDED_OBJECT", altText: null });
  } else {
    for (const img of findDescendants(el, "v:imagedata")) {
      const rid = img.attrs["r:id"];
      if (rid) acc.assets.push({ partPath: rid, assetType: "IMAGE", altText: img.attrs["o:title"]?.length ? img.attrs["o:title"] : null });
    }
  }
  for (const box of findDescendants(el, W("txbxContent"))) acc.textBoxes.push(box);
}

function handleParagraph(ctx: ParseContext, p: XmlElement): void {
  const shape = paragraphShape(ctx, p);
  const acc = { text: "", assets: [] as InlineAsset[], textBoxes: [] as XmlElement[] };
  collectInline(ctx, p, acc);
  const raw = acc.text;
  const hasText = raw.trim().length > 0;

  if (shape.headingLevel !== null && hasText) {
    const level = shape.headingLevel;
    while (ctx.sectionStack.length > 0 && (ctx.sectionStack[ctx.sectionStack.length - 1] as { level: number }).level >= level) ctx.sectionStack.pop();
    const key = `s${ctx.sections.length}`;
    ctx.sections.push({
      key,
      parentKey: currentSectionKey(ctx),
      title: normalizeSourceText(raw) ?? raw,
      headingLevel: level,
      ordinal: ctx.sections.length,
      pageLocationBasis: "UNAVAILABLE",
    });
    ctx.sectionStack.push({ key, level });
  }

  if (hasText) {
    let blockType: SourceBlockType = "PARAGRAPH";
    if (shape.headingLevel !== null) blockType = "HEADING";
    else if (shape.listLevel !== null) blockType = "LIST_ITEM";
    else if (shape.isCaption) blockType = "CAPTION";
    pushNode(ctx, {
      nodeType: "BLOCK",
      block: {
        blockType,
        rawText: raw,
        normalizedText: normalizeSourceText(raw),
        sourceStyle: shape.styleId,
        listLevel: blockType === "LIST_ITEM" ? shape.listLevel : null,
        listOrdered: blockType === "LIST_ITEM" ? shape.listOrdered : null,
        pageLocationBasis: "UNAVAILABLE",
      },
    });
  }
  for (const a of acc.assets) placeAsset(ctx, a);
  for (const box of acc.textBoxes) walkBlockContainer(ctx, box);
}

type NodePayload =
  | { nodeType: "BLOCK"; block: Extract<SourceContentNodeInput, { nodeType: "BLOCK" }>["block"] }
  | { nodeType: "TABLE"; table: Extract<SourceContentNodeInput, { nodeType: "TABLE" }>["table"] }
  | { nodeType: "ASSET_PLACEMENT"; placement: Extract<SourceContentNodeInput, { nodeType: "ASSET_PLACEMENT" }>["placement"] };

function pushNode(ctx: ParseContext, payload: NodePayload): void {
  ctx.nodes.push({ ordinal: ctx.nodes.length, sectionKey: currentSectionKey(ctx), ...payload } as SourceContentNodeInput);
}

function mimeTypeFor(ctx: ParseContext, partPath: string): string {
  const override = ctx.contentTypes.overrides.get(partPath);
  if (override) return override;
  const ext = partPath.includes(".") ? (partPath.split(".").pop() as string).toLowerCase() : "";
  return ctx.contentTypes.defaults.get(ext) ?? "application/octet-stream";
}

/** Registers (or reuses, by exact-bytes hash) an asset and appends its placement to the flow. */
function placeAsset(ctx: ParseContext, inline: InlineAsset): void {
  const rel = ctx.rels.get(inline.partPath);
  if (!rel || rel.external) return; // externally linked: no bytes in this source to represent
  const bytes = ctx.zip.read(rel.target);
  if (bytes === null) return; // dangling relationship: nothing to represent
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  let asset = ctx.assets.get(contentHash);
  if (!asset) {
    const dims = inline.assetType === "IMAGE" ? readImageDimensions(bytes) : { width: null, height: null };
    asset = {
      key: rel.target,
      assetType: inline.assetType,
      mimeType: mimeTypeFor(ctx, rel.target),
      contentHash,
      byteSize: bytes.length,
      width: dims.width,
      height: dims.height,
      sourceFilename: rel.target.split("/").pop() ?? null,
      caption: null,
      altTextFromSource: inline.altText,
    };
    ctx.assets.set(contentHash, asset);
  }
  pushNode(ctx, { nodeType: "ASSET_PLACEMENT", placement: { assetKey: asset.key, pageLocationBasis: "UNAVAILABLE", altTextFromSource: inline.altText } });
}

// ---- tables ----------------------------------------------------------------------------------------------------

interface RawCell {
  colStart: number;
  colSpan: number;
  vMerge: "restart" | "continue" | null;
  text: string;
  nested: SourceTableStructure[];
}

/** Builds a table's structure; inline assets found inside cells are collected for placement after the table. */
function buildTableStructure(ctx: ParseContext, tbl: XmlElement, cellAssets: InlineAsset[]): SourceTableStructure {
  const gridCols = childElements(firstChild(tbl, W("tblGrid")) ?? { name: "", attrs: {}, children: [] }, W("gridCol")).length;
  const rows: Array<{ isHeader: boolean; cells: RawCell[] }> = [];
  for (const tr of rowsOf(tbl)) {
    const trPr = firstChild(tr, W("trPr"));
    const isHeader = firstChild(trPr, W("tblHeader")) !== undefined && attr(firstChild(trPr, W("tblHeader")), "w:val") !== "0" && attr(firstChild(trPr, W("tblHeader")), "w:val") !== "false";
    let col = Number.parseInt(attr(firstChild(trPr, W("gridBefore")), "w:val") ?? "0", 10) || 0;
    const cells: RawCell[] = [];
    for (const tc of cellsOf(tr)) {
      const tcPr = firstChild(tc, W("tcPr"));
      const colSpan = Math.max(1, Number.parseInt(attr(firstChild(tcPr, W("gridSpan")), "w:val") ?? "1", 10) || 1);
      const vm = firstChild(tcPr, W("vMerge"));
      const vMerge = vm === undefined ? null : attr(vm, "w:val") === "restart" ? "restart" : "continue";
      const paragraphs: string[] = [];
      const nested: SourceTableStructure[] = [];
      for (const child of cellContent(tc)) {
        if (child.name === W("p")) {
          const acc = { text: "", assets: [] as InlineAsset[], textBoxes: [] as XmlElement[] };
          collectInline(ctx, child, acc);
          // Same rule as the body: an empty paragraph (spacing, an image-only line, the mandatory paragraph after a
          // nested table) is not text. Non-empty paragraph text is kept verbatim.
          if (acc.text.trim().length > 0) paragraphs.push(acc.text);
          cellAssets.push(...acc.assets);
        } else if (child.name === W("tbl")) {
          nested.push(buildTableStructure(ctx, child, cellAssets));
        }
      }
      cells.push({ colStart: col, colSpan, vMerge, text: paragraphs.join("\n"), nested });
      col += colSpan;
    }
    rows.push({ isHeader, cells });
  }

  const outRows: SourceTableRow[] = rows.map((row, r) => {
    const cells: SourceTableCell[] = [];
    for (const cell of row.cells) {
      if (cell.vMerge === "continue") continue; // represented by the spanning cell above
      let rowSpan = 1;
      if (cell.vMerge === "restart") {
        for (let below = r + 1; below < rows.length; below += 1) {
          const match = (rows[below] as { cells: RawCell[] }).cells.find((c) => c.colStart === cell.colStart);
          if (match && match.vMerge === "continue") rowSpan += 1;
          else break;
        }
      }
      cells.push({ index: cells.length, columnIndex: cell.colStart, rowSpan, colSpan: cell.colSpan, isHeader: row.isHeader, rawText: cell.text, nestedTables: cell.nested });
    }
    return { index: r, isHeader: row.isHeader, cells };
  });
  const widest = rows.reduce((m, row) => Math.max(m, row.cells.reduce((e, c) => Math.max(e, c.colStart + c.colSpan), 0)), 0);
  return { schemaVersion: SOURCE_TABLE_STRUCTURE_SCHEMA_VERSION, rowCount: outRows.length, columnCount: Math.max(gridCols, widest), rows: outRows };
}

/** Rows in order, unwrapping row-level content controls / custom XML. */
function rowsOf(tbl: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (el: XmlElement) => {
    for (const c of childElements(el)) {
      if (c.name === W("tr")) out.push(c);
      else if (c.name === W("sdt")) visit(firstChild(c, W("sdtContent")) ?? c);
      else if (c.name === W("customXml") || c.name === W("ins")) visit(c);
    }
  };
  visit(tbl);
  return out;
}

function cellsOf(tr: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (el: XmlElement) => {
    for (const c of childElements(el)) {
      if (c.name === W("tc")) out.push(c);
      else if (c.name === W("sdt")) visit(firstChild(c, W("sdtContent")) ?? c);
      else if (c.name === W("customXml") || c.name === W("ins")) visit(c);
    }
  };
  visit(tr);
  return out;
}

function cellContent(tc: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (el: XmlElement) => {
    for (const c of childElements(el)) {
      if (c.name === W("p") || c.name === W("tbl")) out.push(c);
      else if (c.name === W("sdt")) visit(firstChild(c, W("sdtContent")) ?? c);
      else if (c.name === W("customXml") || c.name === W("ins")) visit(c);
    }
  };
  visit(tc);
  return out;
}

export function tableRawText(structure: SourceTableStructure): string {
  return structure.rows.map((row) => row.cells.map((c) => c.rawText.replace(/\n/g, " ")).join("\t")).join("\n");
}

function handleTable(ctx: ParseContext, tbl: XmlElement): void {
  const cellAssets: InlineAsset[] = [];
  const structure = buildTableStructure(ctx, tbl, cellAssets);
  const caption = attr(firstChild(firstChild(tbl, W("tblPr")), W("tblCaption")), "w:val");
  pushNode(ctx, {
    nodeType: "TABLE",
    table: { caption: caption && caption.length > 0 ? caption : null, structure, rawText: tableRawText(structure), pageLocationBasis: "UNAVAILABLE" },
  });
  // Assets embedded in cells are placed immediately after their table (the flow is one-dimensional).
  for (const a of cellAssets) placeAsset(ctx, a);
}
