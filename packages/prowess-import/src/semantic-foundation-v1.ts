import type { CreateExtractionCandidateInput, JsonObject, ResolvedSourceContentNode, SourceSection, SourceTableStructure } from "@prowess/model";
import type { ExtractionContext, ExtractorDefinition } from "./extractor.js";
import { findColonDeclarations, findInlineRequires, unclaimedStatements, type Declaration } from "./semantic-declarations.js";
import { parseAssignment, parseExpression, type FormulaParse } from "./semantic-formula.js";

/**
 * `prowess.semantic-foundation@1` (PAS-10 M3-WO5) — the first deliberately SEMANTIC extractor. It reads source text,
 * but only to recognize EXPLICIT statements of three kinds, and records them as ordinary UNREVIEWED candidates:
 *
 *   FORMULA      "Formula: …" declarations and clear assignments "Left = expression[, qualifiers]"
 *   REQUIREMENT  "Requires:/Requirement(s):/Prerequisite(s):" declarations (+ "Requires <Capitalized Terms>" statements)
 *   KEYWORD      "Keyword(s):" declarations — one candidate per declared token
 *
 * plus the same three roles in table columns whose HEADER explicitly names them. Precision over recall: anything
 * uncertain is left unextracted. Nothing is resolved (terms, ranks, stats, affinities stay authored text), nothing is
 * evaluated, no Entity / canonical key / definition is proposed, and no game vocabulary is consulted. Deterministic:
 * no network, filesystem, clock, randomness or locale.
 *
 * Provenance: the primary anchor is the exact content node (paragraph, list item or table) holding the statement; a
 * supporting anchor on the same node carries the verbatim excerpt (verified by the database as an exact substring).
 * Payload offsets are UTF-16 code-unit indices into the block's raw text — or, for tables, into the cell's raw text,
 * with rowIndex / columnIndex / headerText (WO1 cannot anchor an individual cell).
 */
export const SEMANTIC_FOUNDATION_EXTRACTOR_KEY = "prowess.semantic-foundation";
export const SEMANTIC_FOUNDATION_EXTRACTOR_VERSION = "1";
export const SEMANTIC_FORMULA_PAYLOAD_SCHEMA = "prowess.semantic.formula";
export const SEMANTIC_REQUIREMENT_PAYLOAD_SCHEMA = "prowess.semantic.requirement";
export const SEMANTIC_KEYWORD_PAYLOAD_SCHEMA = "prowess.semantic.keyword";
export const SEMANTIC_PAYLOAD_SCHEMA_VERSION = 1;

type Kind = "FORMULA" | "REQUIREMENT" | "KEYWORD";
const KIND_RANK: Record<Kind, number> = { FORMULA: 0, REQUIREMENT: 1, KEYWORD: 2 };
const MAX_LABEL = 300;
const MAX_EXCERPT = 4000;

/** A transient finding (never persisted) — becomes one candidate input. */
export interface SemanticFinding {
  kind: Kind;
  confidence: "HIGH" | "MEDIUM";
  node: ResolvedSourceContentNode;
  /** Ordering within the node: table row / column (or -1 for text blocks), then offset, then kind, then token index. */
  order: [number, number, number, number, number];
  /** The verbatim source text the finding cites (an exact substring of the block / cell raw text). */
  evidence: string;
  displayLabel: string;
  payloadSchemaKey: string;
  payload: JsonObject;
}

const label = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_LABEL ? flat : `${flat.slice(0, MAX_LABEL - 1)}…`;
};

/** NFC + trim + collapsed whitespace + locale-INDEPENDENT lowercase — a review aid only; the authored label is kept. */
export const normalizeKeywordLabel = (authored: string) => authored.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

interface Place {
  node: ResolvedSourceContentNode;
  text: string;
  sectionPath: string | null;
  table: { rowIndex: number; columnIndex: number; headerText: string } | null;
}
const where = (p: Place) => (p.table ? { rowIndex: p.table.rowIndex, columnIndex: p.table.columnIndex, headerText: p.table.headerText } : { rowIndex: null, columnIndex: null, headerText: null });
const orderOf = (p: Place, offset: number, kind: Kind, token: number): SemanticFinding["order"] => [p.table ? p.table.rowIndex : -1, p.table ? p.table.columnIndex : -1, offset, KIND_RANK[kind], token];

function formulaFinding(p: Place, parse: FormulaParse, start: number, end: number, sourceForm: string, markerText: string | null, confidence: "HIGH" | "MEDIUM"): SemanticFinding {
  const rawText = p.text.slice(start, end);
  return {
    kind: "FORMULA", confidence, node: p.node, order: orderOf(p, start, "FORMULA", 0), evidence: rawText,
    displayLabel: label(parse.leftHandText ?? rawText),
    payloadSchemaKey: SEMANTIC_FORMULA_PAYLOAD_SCHEMA,
    payload: {
      semanticType: "FORMULA", sourceForm, markerText, rawText, leftHandText: parse.leftHandText, expressionText: parse.expressionText,
      normalizedExpressionText: parse.normalizedExpressionText, qualifiers: parse.qualifiers, terms: parse.terms, functions: parse.functions,
      operators: parse.operators, quantities: parse.quantities, sectionPath: p.sectionPath, startOffset: start, endOffset: end, ...where(p),
    },
  };
}

/** Separators of an explicit list value: commas and semicolons at parenthesis depth 0. */
function splitList(text: string, base: number): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let depth = 0;
  let from = 0;
  const push = (to: number) => {
    let s = from;
    let e = to;
    while (s < e && /\s/.test(text[s] as string)) s += 1;
    while (e > s && /\s/.test(text[e - 1] as string)) e -= 1;
    out.push({ text: text.slice(s, e), start: base + s, end: base + e });
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if ((c === "," || c === ";") && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  push(text.length);
  return out;
}

const KEYWORD_TOKEN = /^\p{L}[\p{L}\p{N}'’ -]{0,79}$/u;

function keywordFindings(p: Place, value: string, base: number, markerText: string, confidence: "HIGH" | "MEDIUM"): SemanticFinding[] {
  const items = splitList(value, base);
  // Precision: one malformed token rejects the whole declaration rather than guessing which part is a keyword.
  if (items.length === 0 || items.some((t) => !KEYWORD_TOKEN.test(t.text) || t.text.split(" ").length > 5)) return [];
  return items.map((t, i) => ({
    kind: "KEYWORD" as const, confidence, node: p.node, order: orderOf(p, t.start, "KEYWORD", i), evidence: t.text,
    displayLabel: label(t.text),
    payloadSchemaKey: SEMANTIC_KEYWORD_PAYLOAD_SCHEMA,
    payload: { semanticType: "KEYWORD", authoredLabel: t.text, normalizedLabel: normalizeKeywordLabel(t.text), declarationLabel: markerText, tokenIndex: i, tokenCount: items.length, sectionPath: p.sectionPath, startOffset: t.start, endOffset: t.end, ...where(p) },
  }));
}

function requirementFindings(p: Place, value: string, base: number, markerText: string, form: string, confidence: "HIGH" | "MEDIUM"): SemanticFinding[] {
  const clauses = splitList(value, base);
  if (clauses.length === 0 || clauses.some((c) => c.text.length === 0 || c.text.length > 200 || c.text.includes("=") || !/\p{L}/u.test(c.text))) return [];
  return clauses.map((c, i) => ({
    kind: "REQUIREMENT" as const, confidence, node: p.node, order: orderOf(p, c.start, "REQUIREMENT", i), evidence: c.text,
    displayLabel: label(`${markerText}: ${c.text}`),
    payloadSchemaKey: SEMANTIC_REQUIREMENT_PAYLOAD_SCHEMA,
    payload: {
      semanticType: "REQUIREMENT", marker: markerText, markerForm: form, rawRequirementText: c.text, declarationText: value,
      clauseIndex: i, clauseCount: clauses.length, negated: /^(?:not|no)\s/i.test(c.text), terms: c.text.split(/\s+/).filter((w) => w.length > 0),
      sectionPath: p.sectionPath, startOffset: c.start, endOffset: c.end, ...where(p),
    },
  }));
}

/** Declarations and bare assignments of one text (a block's raw text, or a cell's). */
function textFindings(p: Place): SemanticFinding[] {
  const text = p.text;
  const colon = findColonDeclarations(text);
  const inline = findInlineRequires(text, colon);
  const declarations: Declaration[] = [...colon, ...inline];
  const findings: SemanticFinding[] = [];
  for (const d of declarations) {
    const value = text.slice(d.valueStart, d.valueEnd);
    if (d.role === "KEYWORD") findings.push(...keywordFindings(p, value, d.valueStart, d.markerText, "HIGH"));
    else if (d.role === "REQUIREMENT") findings.push(...requirementFindings(p, value, d.valueStart, d.markerText, d.form, d.form === "COLON" ? "HIGH" : "MEDIUM"));
    else {
      const assignment = parseAssignment(value);
      const expression = assignment ? null : parseExpression(value);
      const parse = assignment ?? (expression ? { leftHandText: null, ...expression } : null);
      if (parse) findings.push(formulaFinding(p, parse, d.valueStart, d.valueEnd, assignment ? "LABELLED_ASSIGNMENT" : "LABELLED_EXPRESSION", d.markerText, "HIGH"));
    }
  }
  // Bare assignments, only in text no declaration has claimed ("Keywords: Formula, X = Y" is never re-read).
  for (const s of unclaimedStatements(text, declarations)) {
    const parse = parseAssignment(text.slice(s.start, s.end));
    if (parse) findings.push(formulaFinding(p, parse, s.start, s.end, "ASSIGNMENT", null, "HIGH"));
  }
  return findings;
}

const HEADER_ROLE: Record<string, Kind> = { formula: "FORMULA", formulas: "FORMULA", requirement: "REQUIREMENT", requirements: "REQUIREMENT", requires: "REQUIREMENT", prerequisite: "REQUIREMENT", prerequisites: "REQUIREMENT", keyword: "KEYWORD", keywords: "KEYWORD" };

/** Table columns whose header cell explicitly names a role; only their data cells are read. */
function tableFindings(node: ResolvedSourceContentNode & { nodeType: "TABLE" }, sectionPath: string | null): SemanticFinding[] {
  const s: SourceTableStructure = node.table.structure;
  if (s.rows.length < 2) return [];
  const headerRowIndex = s.rows.reduce((last, r) => (r.isHeader ? r.index : last), 0); // the last flagged header row, else row 0
  const header = s.rows[headerRowIndex];
  if (!header) return [];
  const roles = new Map<number, { kind: Kind; headerText: string }>();
  for (const c of header.cells) {
    const kind = HEADER_ROLE[c.rawText.trim().replace(/:$/, "").toLowerCase()];
    if (kind && c.colSpan === 1) roles.set(c.columnIndex, { kind, headerText: c.rawText.trim() });
  }
  const findings: SemanticFinding[] = [];
  for (const row of s.rows.slice(headerRowIndex + 1)) {
    if (row.isHeader) continue;
    for (const cell of row.cells) {
      const role = roles.get(cell.columnIndex);
      if (!role || cell.rawText.trim().length === 0) continue;
      const p: Place = { node, text: cell.rawText, sectionPath, table: { rowIndex: row.index, columnIndex: cell.columnIndex, headerText: role.headerText } };
      const lead = cell.rawText.length - cell.rawText.trimStart().length;
      const value = cell.rawText.trim();
      if (role.kind === "KEYWORD") findings.push(...keywordFindings(p, value, lead, role.headerText, "HIGH"));
      else if (role.kind === "REQUIREMENT") findings.push(...requirementFindings(p, value, lead, role.headerText, "TABLE_COLUMN", "HIGH"));
      else {
        const assignment = parseAssignment(value);
        const expression = assignment ? null : parseExpression(value);
        const parse = assignment ?? (expression ? { leftHandText: null, ...expression } : null);
        if (parse) findings.push(formulaFinding(p, parse, lead, lead + value.length, assignment ? "TABLE_ASSIGNMENT" : "TABLE_EXPRESSION", role.headerText, "MEDIUM"));
      }
    }
  }
  return findings;
}

function sectionPaths(sections: readonly SourceSection[]): Map<string, string> {
  const byId = new Map(sections.map((s) => [s.id as string, s]));
  const out = new Map<string, string>();
  for (const s of sections) {
    const titles: string[] = [];
    let cur: SourceSection | undefined = s;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      titles.unshift(cur.title);
      cur = cur.parentSectionId === null ? undefined : byId.get(cur.parentSectionId);
    }
    out.set(s.id, titles.join(" > "));
  }
  return out;
}

export function findSemanticStatements(context: ExtractionContext): SemanticFinding[] {
  const paths = sectionPaths(context.sections);
  const findings: SemanticFinding[] = [];
  for (const node of context.nodes) {
    const sectionPath = node.sourceSectionId === null ? null : (paths.get(node.sourceSectionId) ?? null);
    if (node.nodeType === "BLOCK" && node.block.blockType !== "HEADING") findings.push(...textFindings({ node, text: node.block.rawText, sectionPath, table: null }));
    else if (node.nodeType === "TABLE") findings.push(...tableFindings(node, sectionPath));
  }
  const cmp = (a: SemanticFinding, b: SemanticFinding) => {
    if (a.node.ordinal !== b.node.ordinal) return a.node.ordinal - b.node.ordinal;
    for (let i = 0; i < 5; i += 1) if (a.order[i] !== b.order[i]) return (a.order[i] as number) - (b.order[i] as number);
    return 0;
  };
  return findings.sort(cmp);
}

export function findingsToCandidates(findings: readonly SemanticFinding[]): CreateExtractionCandidateInput[] {
  return findings.map((f, i) => ({
    ordinal: i + 1,
    candidateKind: f.kind,
    proposedEntityType: null,
    proposedCanonicalKey: null,
    displayLabel: f.displayLabel,
    confidence: f.confidence,
    payloadSchemaKey: f.payloadSchemaKey,
    payloadSchemaVersion: SEMANTIC_PAYLOAD_SCHEMA_VERSION,
    payloadJson: f.payload,
    primarySourceAnchor: { contentNodeId: f.node.id },
    supportingSourceAnchors: f.evidence.length > 0 && f.evidence.length <= MAX_EXCERPT ? [{ contentNodeId: f.node.id, excerpt: f.evidence }] : [],
  }));
}

export const semanticFoundationExtractorV1: ExtractorDefinition = {
  key: SEMANTIC_FOUNDATION_EXTRACTOR_KEY,
  version: SEMANTIC_FOUNDATION_EXTRACTOR_VERSION,
  description: "Deterministic explicit-only semantic extraction of Formula, Requirement and Keyword statements. Nothing is resolved or evaluated.",
  payloadSchemas: [
    { key: SEMANTIC_FORMULA_PAYLOAD_SCHEMA, version: SEMANTIC_PAYLOAD_SCHEMA_VERSION },
    { key: SEMANTIC_REQUIREMENT_PAYLOAD_SCHEMA, version: SEMANTIC_PAYLOAD_SCHEMA_VERSION },
    { key: SEMANTIC_KEYWORD_PAYLOAD_SCHEMA, version: SEMANTIC_PAYLOAD_SCHEMA_VERSION },
  ],
  acceptsConfiguration: false,
  extract: (context) => findingsToCandidates(findSemanticStatements(context)),
};
