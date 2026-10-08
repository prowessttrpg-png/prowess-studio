/**
 * Minimal, dependency-free XML parser for structural source ingestion (PAS-10 M3-WO1).
 *
 * Produces a plain element tree with qualified names kept exactly as written ("w:p", "a:blip"). Handles the subset
 * of XML that OOXML parts use: the XML declaration, processing instructions, comments, CDATA, attributes in either
 * quote style, self-closing tags and the predefined + numeric character entities. No DTDs, no external entities —
 * nothing is ever fetched. Malformed input raises `XmlFormatError`.
 */
export class XmlFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlFormatError";
  }
}

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITY[body] ?? whole;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      appendText(stack, xml.slice(i));
      break;
    }
    if (lt > i) appendText(stack, xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlFormatError("unterminated comment");
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlFormatError("unterminated CDATA section");
      (stack[stack.length - 1] as XmlElement).children.push(xml.slice(lt + 9, end));
      i = end + 3;
    } else if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlFormatError("unterminated processing instruction");
      i = end + 2;
    } else if (xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) throw new XmlFormatError("unterminated declaration");
      i = end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) throw new XmlFormatError("unterminated end tag");
      const name = xml.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top === root || top.name !== name) throw new XmlFormatError(`mismatched end tag </${name}>`);
      i = end + 1;
    } else {
      const end = findTagEnd(xml, lt + 1);
      if (end < 0) throw new XmlFormatError("unterminated start tag");
      let body = xml.slice(lt + 1, end);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const space = body.search(/\s/);
      const name = space < 0 ? body : body.slice(0, space);
      if (name.length === 0) throw new XmlFormatError("empty tag name");
      const attrs: Record<string, string> = {};
      if (space >= 0) {
        ATTR.lastIndex = 0;
        let m: RegExpExecArray | null;
        const rest = body.slice(space);
        while ((m = ATTR.exec(rest))) attrs[m[1] as string] = decodeXmlEntities(m[3] ?? m[4] ?? "");
      }
      const element: XmlElement = { name, attrs, children: [] };
      (stack[stack.length - 1] as XmlElement).children.push(element);
      if (!selfClosing) stack.push(element);
      i = end + 1;
    }
  }
  if (stack.length !== 1) throw new XmlFormatError(`unclosed element <${(stack[stack.length - 1] as XmlElement).name}>`);
  return root;
}

/** Finds the `>` closing a start tag, skipping `>` characters inside quoted attribute values. */
function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < xml.length; j += 1) {
    const c = xml[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return j;
  }
  return -1;
}

function appendText(stack: XmlElement[], raw: string): void {
  if (raw.length === 0) return;
  (stack[stack.length - 1] as XmlElement).children.push(decodeXmlEntities(raw));
}

// ---- small helpers ---------------------------------------------------------------------------------------------

export const isElement = (node: XmlNode | undefined): node is XmlElement => typeof node === "object" && node !== null;

export function childElements(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const c of el.children) if (isElement(c) && (name === undefined || c.name === name)) out.push(c);
  return out;
}

export function firstChild(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (isElement(c) && c.name === name) return c;
  return undefined;
}

/** Depth-first search for descendants named `name` (does not descend into a match). */
export function findDescendants(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (!isElement(c)) continue;
    if (c.name === name) out.push(c);
    else findDescendants(c, name, out);
  }
  return out;
}

export function textContent(el: XmlElement): string {
  let s = "";
  for (const c of el.children) s += isElement(c) ? textContent(c) : c;
  return s;
}
