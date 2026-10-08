import { deflateRawSync } from "node:zlib";

/**
 * Deterministic synthetic DOCX builder for M3-WO1 tests. Produces small, real WordprocessingML packages (a valid
 * ZIP with [Content_Types].xml, rels, styles, numbering, document, docProps and media) from a tiny DSL, so CI can
 * exercise the structural parser on every structural case the real Prowess Core Playtest Packet contains WITHOUT
 * committing that ~898-page document. Same input -> byte-identical output (fixed timestamps, fixed entry order).
 *
 * The text in these fixtures imitates Prowess prose on purpose (spells, skill tiers, formulas, mission tables) so
 * tests can prove the parser keeps such prose VERBATIM and never classifies it.
 */

export type FxCell = string | { text: string; colSpan?: number; vMerge?: "restart" | "continue"; nested?: FxTable };
export interface FxTable {
  kind: "table";
  rows: FxCell[][];
  headerRows?: number;
  caption?: string;
  /** Inline images inside the first cell (media keys). */
  cellImages?: string[];
}

export type FxBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "p"; text: string; style?: string; runs?: string[] }
  | { kind: "bullet"; text: string; level?: number }
  | { kind: "numbered"; text: string; level?: number }
  | { kind: "caption"; text: string }
  | { kind: "image"; media: string; alt?: string; withText?: string }
  | { kind: "empty" }
  | { kind: "pageBreak" }
  | { kind: "raw"; xml: string }
  | FxTable;

export interface FxDocument {
  blocks: FxBlock[];
  /** media key (e.g. "image1.png") -> bytes */
  media?: Record<string, Buffer>;
  pages?: number;
  title?: string;
}

// ---- tiny valid images --------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A valid grayscale PNG of the given size; `seed` varies the pixels so different seeds give different bytes. */
export function makePng(width: number, height: number, seed = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width + 1);
    for (let x = 0; x < width; x += 1) row[x + 1] = (x * 31 + y * 17 + seed * 7) & 0xff;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateRawSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- ZIP writer -----------------------------------------------------------------------------------------------------

export function buildZip(entries: Array<{ name: string; data: Buffer; store?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const compressed = e.store ? e.data : deflateRawSync(e.data);
    const method = e.store ? 0 : 8;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // fixed time
    local.writeUInt16LE(0x5a21, 12); // fixed date (2025-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5a21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---- WordprocessingML ---------------------------------------------------------------------------------------------

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Runs: tabs and newlines in fixture text become w:tab / w:br, exactly as Word stores them. */
function runs(text: string): string {
  return text
    .split(/(\t|\n)/)
    .filter((part) => part.length > 0)
    .map((part) => (part === "\t" ? "<w:r><w:tab/></w:r>" : part === "\n" ? "<w:r><w:br/></w:r>" : `<w:r><w:t xml:space="preserve">${esc(part)}</w:t></w:r>`))
    .join("");
}

const para = (pPr: string, body: string) => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${body}</w:p>`;

export function buildDocx(doc: FxDocument): Buffer {
  const media = doc.media ?? {};
  const mediaKeys = Object.keys(media).sort();
  const rid = (key: string) => `rIdImg${mediaKeys.indexOf(key) + 1}`;
  let drawingId = 0;
  const drawing = (key: string, alt?: string) => {
    drawingId += 1;
    return `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="${drawingId}" name="Picture ${drawingId}"${alt !== undefined ? ` descr="${esc(alt)}"` : ""}/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${rid(key)}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };

  const table = (t: FxTable): string => {
    const cols = Math.max(...t.rows.map((r) => r.reduce((n, c) => n + (typeof c === "string" ? 1 : (c.colSpan ?? 1)), 0)));
    const grid = `<w:tblGrid>${"<w:gridCol w:w=\"1000\"/>".repeat(cols)}</w:tblGrid>`;
    const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/>${t.caption ? `<w:tblCaption w:val="${esc(t.caption)}"/>` : ""}</w:tblPr>`;
    const rows = t.rows
      .map((row, r) => {
        const trPr = r < (t.headerRows ?? 0) ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
        const cells = row
          .map((cell, c) => {
            const spec = typeof cell === "string" ? { text: cell } : cell;
            const tcPr = `${spec.colSpan && spec.colSpan > 1 ? `<w:gridSpan w:val="${spec.colSpan}"/>` : ""}${spec.vMerge === "restart" ? '<w:vMerge w:val="restart"/>' : spec.vMerge === "continue" ? "<w:vMerge/>" : ""}`;
            const images = r === 0 && c === 0 && t.cellImages ? t.cellImages.map((k) => drawing(k)).join("") : "";
            const paragraphs = spec.text.split("\n\n").map((pt) => para("", runs(pt))).join("");
            const firstPara = images ? para("", images) : "";
            return `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${firstPara}${paragraphs}${spec.nested ? table(spec.nested) + para("", "") : ""}</w:tc>`;
          })
          .join("");
        return `<w:tr>${trPr}${cells}</w:tr>`;
      })
      .join("");
    return `<w:tbl>${tblPr}${grid}${rows}</w:tbl>`;
  };

  const body = doc.blocks
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return para(`<w:pStyle w:val="Heading${b.level}"/>`, runs(b.text));
        case "p":
          return para(b.style ? `<w:pStyle w:val="${b.style}"/>` : "", b.runs ? b.runs.map(runs).join("") : runs(b.text));
        case "bullet":
          return para(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${b.level ?? 0}"/><w:numId w:val="1"/></w:numPr>`, runs(b.text));
        case "numbered":
          return para(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${b.level ?? 0}"/><w:numId w:val="2"/></w:numPr>`, runs(b.text));
        case "caption":
          return para('<w:pStyle w:val="Caption"/>', runs(b.text));
        case "image":
          return para("", `${b.withText ? runs(b.withText) : ""}${drawing(b.media, b.alt)}`);
        case "empty":
          return para("", "");
        case "pageBreak":
          return para("", '<w:r><w:br w:type="page"/></w:r>');
        case "raw":
          return b.xml;
        case "table":
          return table(b);
        default:
          return "";
      }
    })
    .join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>
${[1, 2, 3, 4].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr></w:style>`).join("")}
<w:style w:type="paragraph" w:styleId="ChapterTitle"><w:name w:val="Chapter Title"/><w:basedOn w:val="Heading1"/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="10">${[0, 1, 2].map((l) => `<w:lvl w:ilvl="${l}"><w:numFmt w:val="bullet"/></w:lvl>`).join("")}</w:abstractNum>
<w:abstractNum w:abstractNumId="20">${[0, 1, 2].map((l) => `<w:lvl w:ilvl="${l}"><w:numFmt w:val="${l === 1 ? "lowerLetter" : "decimal"}"/></w:lvl>`).join("")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
</w:numbering>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
${mediaKeys.map((k) => `<Relationship Id="${rid(k)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${k}"/>`).join("")}
</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${doc.pages !== undefined ? `<Pages>${doc.pages}</Pages>` : ""}<Application>Fixture</Application></Properties>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${doc.title ? `<dc:title>${esc(doc.title)}</dc:title>` : ""}</cp:coreProperties>`;

  const u = (s: string) => Buffer.from(s, "utf8");
  return buildZip([
    { name: "[Content_Types].xml", data: u(contentTypes) },
    { name: "_rels/.rels", data: u(rootRels) },
    { name: "word/document.xml", data: u(documentXml) },
    { name: "word/styles.xml", data: u(stylesXml) },
    { name: "word/numbering.xml", data: u(numberingXml) },
    { name: "word/_rels/document.xml.rels", data: u(rels) },
    { name: "docProps/app.xml", data: u(app) },
    { name: "docProps/core.xml", data: u(core) },
    ...mediaKeys.map((k) => ({ name: `word/media/${k}`, data: media[k] as Buffer, store: true })),
  ]);
}
