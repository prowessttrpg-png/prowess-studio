import type { CreateExtractionCandidateInput, ResolvedSourceContentNode, SourceBlockType, SourceSection } from "@prowess/model";
import { describe, expect, it } from "vitest";
import { runExtraction, type ExtractionBatchIdentity } from "./extractor.js";
import { defaultExtractorRegistry } from "./registry.js";
import { parseAssignment, parseExpression } from "./semantic-formula.js";
import { normalizeKeywordLabel } from "./semantic-foundation-v1.js";

const SNAP = "00000000-0000-4000-8000-0000000000bb";
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
    const s = { id: uid(), sourceSnapshotId: SNAP, parentSectionId: parent ? parent.id : null, title, headingLevel: level, ordinal: this.sections.length, startPage: null, endPage: null, pageLocationBasis: "UNAVAILABLE", createdAt: T0 } as unknown as SourceSection;
    this.sections.push(s);
    this.stack.push(s);
    return this.block("HEADING", title);
  }
  block(type: SourceBlockType, text: string): this {
    const id = uid();
    const sectionId = this.stack[this.stack.length - 1]?.id ?? null;
    this.nodes.push({ id: uid(), sourceSnapshotId: SNAP, sourceSectionId: sectionId, ordinal: this.nodes.length, nodeType: "BLOCK", blockId: id, tableId: null, assetPlacementId: null,
      block: { id, sourceSnapshotId: SNAP, sourceSectionId: sectionId, blockType: type, ordinal: 0, rawText: text, normalizedText: null, sourceStyle: null, listLevel: null, listOrdered: null, pageStart: null, pageEnd: null, pageLocationBasis: "UNAVAILABLE", createdAt: T0 } } as unknown as ResolvedSourceContentNode);
    return this;
  }
  p(text: string) {
    return this.block("PARAGRAPH", text);
  }
  table(rows: string[][], headerRows = 1): this {
    const id = uid();
    const sectionId = this.stack[this.stack.length - 1]?.id ?? null;
    this.nodes.push({ id: uid(), sourceSnapshotId: SNAP, sourceSectionId: sectionId, ordinal: this.nodes.length, nodeType: "TABLE", blockId: null, tableId: id, assetPlacementId: null,
      table: { id, sourceSnapshotId: SNAP, sourceSectionId: sectionId, ordinal: 0, caption: null, pageStart: null, pageEnd: null, pageLocationBasis: "UNAVAILABLE", rawText: null, createdAt: T0,
        structure: { schemaVersion: 1, rowCount: rows.length, columnCount: rows[0]?.length ?? 0, rows: rows.map((r, i) => ({ index: i, isHeader: i < headerRows, cells: r.map((t, j) => ({ index: j, columnIndex: j, rowSpan: 1, colSpan: 1, isHeader: i < headerRows, rawText: t, nestedTables: [] })) })) } } } as unknown as ResolvedSourceContentNode);
    return this;
  }
}

const batch = (over: Partial<ExtractionBatchIdentity> = {}): ExtractionBatchIdentity => ({ importBatchId: "b", sourceSnapshotId: SNAP, sourceStructureHash: "c".repeat(64), scopeType: "SNAPSHOT", scopeSectionId: null, extractorKey: "prowess.semantic-foundation", extractorVersion: "1", extractorConfigHash: null, ...over });
const run = (d: Doc, over: Partial<ExtractionBatchIdentity> = {}) => runExtraction(defaultExtractorRegistry, batch(over), d.sections, d.nodes);
const of = (text: string) => run(new Doc().heading(1, "Rules").p(text)).candidates;
const kinds = (cs: CreateExtractionCandidateInput[]) => cs.map((c) => c.candidateKind);
const pay = (c: CreateExtractionCandidateInput | undefined) => c!.payloadJson as Record<string, unknown>;

describe("registration", () => {
  it("prowess.semantic-foundation@1 is registered by exact key / version, beside prowess.structural@1", () => {
    expect(defaultExtractorRegistry.keys()).toEqual(["prowess.semantic-foundation@1", "prowess.structural@1"]);
    expect(defaultExtractorRegistry.find("prowess.semantic-foundation", "2")).toBeNull();
  });
});

describe("FORMULA", () => {
  it("§59 Spell AP = floor(Final MP / PRO), minimum 1.", () => {
    const text = "Spell AP = floor(Final MP / PRO), minimum 1.";
    const cs = of(text);
    expect(kinds(cs)).toEqual(["FORMULA"]);
    const c = cs[0]!;
    expect(c).toMatchObject({ confidence: "HIGH", proposedEntityType: null, proposedCanonicalKey: null, displayLabel: "Spell AP", payloadSchemaKey: "prowess.semantic.formula" });
    expect(pay(c)).toMatchObject({ semanticType: "FORMULA", sourceForm: "ASSIGNMENT", rawText: "Spell AP = floor(Final MP / PRO), minimum 1", leftHandText: "Spell AP", expressionText: "floor(Final MP / PRO)", qualifiers: ["minimum 1"], terms: ["Final MP", "PRO"], functions: ["floor"], operators: ["/"], startOffset: 0, endOffset: 43 });
    expect(text.slice(pay(c).startOffset as number, pay(c).endOffset as number)).toBe(pay(c).rawText);
    expect(c.supportingSourceAnchors).toEqual([{ contentNodeId: c.primarySourceAnchor.contentNodeId, excerpt: "Spell AP = floor(Final MP / PRO), minimum 1" }]);
  });

  it("§60 units are kept verbatim; × is preserved in the authored text and normalized separately", () => {
    const c = of("Spell Range = 15 ft × PER.")[0]!;
    expect(pay(c)).toMatchObject({ expressionText: "15 ft × PER", normalizedExpressionText: "15 ft * PER", quantities: [{ value: "15", unit: "ft" }], terms: ["PER"], operators: ["×"] });
  });

  it("labelled formulas, ÷ / − symbols, ceil/min/max, decimals and parentheses", () => {
    expect(pay(of("Formula: HP = (CON × 5) + 2.5")[0])).toMatchObject({ sourceForm: "LABELLED_ASSIGNMENT", markerText: "Formula", leftHandText: "HP" });
    expect(pay(of("Formula: max(1, ceil(MP ÷ 2) − 1)")[0])).toMatchObject({ sourceForm: "LABELLED_EXPRESSION", leftHandText: null, functions: ["max", "ceil"] });
    expect(of("Cost = MP / 2, rounded down").map((c) => pay(c).qualifiers)).toEqual([["rounded down"]]);
  });

  it("§54 / §13 / §58 rejects ordinary numbers, URLs, prose equalities, trivial and malformed expressions", () => {
    for (const text of [
      "The Mage may move 15 feet.",
      "See https://example.com/page?mode=full for details.",
      "In short, power = responsibility, as the saying goes.",
      "AP = 3.",
      "Damage = floor(MP / PRO.",
      "Range = 15 × .",
      " = MP / 2",
      "Cost = MP / 2, unless the GM decides otherwise",
      "x == y",
    ]) expect(of(text), text).toEqual([]);
    expect(parseAssignment("A = B + (C")).toBeNull();
    expect(parseExpression("5")).toBeNull();
  });

  it("§75 two formulas in one paragraph get exact, distinct offsets", () => {
    const text = "Spell AP = floor(MP / PRO). Spell Range = 15 × PER.";
    const cs = of(text);
    expect(cs.map((c) => text.slice(pay(c).startOffset as number, pay(c).endOffset as number))).toEqual(["Spell AP = floor(MP / PRO)", "Spell Range = 15 × PER"]);
  });
});

describe("REQUIREMENT", () => {
  it("§61 / §62 explicit markers; terms stay unresolved; marker preserved", () => {
    const r = of("Requires: Expert Emission");
    expect(kinds(r)).toEqual(["REQUIREMENT"]);
    expect(pay(r[0])).toMatchObject({ semanticType: "REQUIREMENT", marker: "Requires", markerForm: "COLON", rawRequirementText: "Expert Emission", terms: ["Expert", "Emission"], negated: false });
    expect(r[0]!.confidence).toBe("HIGH");
    expect(pay(of("Prerequisite: Trained Arcana")[0])).toMatchObject({ marker: "Prerequisite", rawRequirementText: "Trained Arcana" });
    expect(JSON.stringify(r)).not.toMatch(/affinity|rank|minimumRank/i);
  });

  it("§17 / §18 one candidate per explicit clause; 'and' is never turned into Boolean logic", () => {
    const cs = of("Requirements: Expert Emission; Trained Arcana, Spell Focus");
    expect(cs.map((c) => pay(c).rawRequirementText)).toEqual(["Expert Emission", "Trained Arcana", "Spell Focus"]);
    expect(cs.map((c) => [pay(c).clauseIndex, pay(c).clauseCount])).toEqual([[0, 3], [1, 3], [2, 3]]);
    expect(pay(of("Requires: Expert Arcana and Trained Emission")[0])).toMatchObject({ rawRequirementText: "Expert Arcana and Trained Emission", clauseCount: 1 });
  });

  it("the colon-less statement form 'Requires Expert Emission.' is MEDIUM; generic verb uses are rejected (§52)", () => {
    const inline = of("Requires Expert Emission.");
    expect(inline.map((c) => [c.candidateKind, c.confidence, pay(c).markerForm, pay(c).rawRequirementText])).toEqual([["REQUIREMENT", "MEDIUM", "INLINE", "Expert Emission"]]);
    for (const text of ["This calculation requires the player to know their Prowess score.", "This requires the GM to consider the situation.", "Requires the GM to adjudicate."]) expect(of(text), text).toEqual([]);
  });
});

describe("KEYWORD", () => {
  it("§63 / §64 one candidate per declared token, in source order, authored label preserved", () => {
    const text = "Keywords: Damage, Control, Ongoing";
    const cs = of(text);
    expect(cs.map((c) => [c.candidateKind, c.displayLabel, pay(c).declarationLabel, pay(c).tokenIndex])).toEqual([["KEYWORD", "Damage", "Keywords", 0], ["KEYWORD", "Control", "Keywords", 1], ["KEYWORD", "Ongoing", "Keywords", 2]]);
    for (const c of cs) expect(text.slice(pay(c).startOffset as number, pay(c).endOffset as number)).toBe(pay(c).authoredLabel);
    expect(of("Keyword: Sustain").map((c) => pay(c).authoredLabel)).toEqual(["Sustain"]);
  });

  it("§53 / §19 no keyword from prose, capitalization or repetition; a malformed token rejects the whole declaration", () => {
    for (const text of ["This spell deals Damage over time.", "Damage is often affected by cover.", "DAMAGE DAMAGE DAMAGE", "The keyword list appears later.", "Keywords: Damage, see page 4 (=12)"]) expect(of(text), text).toEqual([]);
  });

  it("§51 marker context wins: 'Keywords: Formula, Damage' are keywords, not a formula", () => {
    expect(of("Keywords: Formula, Damage").map((c) => [c.candidateKind, c.displayLabel])).toEqual([["KEYWORD", "Formula"], ["KEYWORD", "Damage"]]);
  });

  it("keyword normalization is NFC + whitespace + locale-independent lowercase, authored label kept", () => {
    expect(normalizeKeywordLabel("  Ongoing\u00a0 Effect ")).toBe("ongoing effect");
    expect(normalizeKeywordLabel("IRIS")).toBe("iris");
  });
});

describe("mixed blocks, ordering and Unicode", () => {
  it("§31 one block: formula then two keywords, all on one node with distinct fingerprints", () => {
    const r = run(new Doc().heading(1, "Rules").p("Formula: Range = 15 × PER. Keywords: Range, Magic."));
    expect(kinds(r.candidates)).toEqual(["FORMULA", "KEYWORD", "KEYWORD"]);
    expect(new Set(r.candidates.map((c) => c.primarySourceAnchor.contentNodeId)).size).toBe(1);
    expect(new Set(r.fingerprints).size).toBe(3);
  });

  it("§69 Formula / Requirements / Keywords on separate lines are ordered by occurrence", () => {
    const text = "Formula: AP = MP / PRO\nRequirements: Expert Emission\nKeywords: Magic, Cost";
    const cs = of(text);
    expect(cs.map((c) => [c.candidateKind, c.displayLabel])).toEqual([["FORMULA", "AP"], ["REQUIREMENT", "Requirements: Expert Emission"], ["KEYWORD", "Magic"], ["KEYWORD", "Cost"]]);
    expect(cs.map((c) => c.ordinal)).toEqual([1, 2, 3, 4]);
  });

  it("§68 ordinary prose mentioning requires / damage / keyword / formula yields nothing", () => {
    const d = new Doc().heading(1, "Intro").p("Casting a spell requires focus. Damage depends on the formula your GM uses, and each keyword is explained later.").block("LIST_ITEM", "The formula is easy to remember.");
    expect(run(d).candidates).toEqual([]);
  });

  it("§76 accented Latin, Cyrillic and non-ASCII math symbols are preserved exactly", () => {
    const cs = of("Énergie Résiduelle = floor(Сила ÷ 2) − 1. Keywords: Огонь, Éclair");
    expect(pay(cs[0])).toMatchObject({ leftHandText: "Énergie Résiduelle", expressionText: "floor(Сила ÷ 2) − 1", terms: ["Сила"], operators: ["÷", "−"] });
    expect(cs.slice(1).map((c) => pay(c).authoredLabel)).toEqual(["Огонь", "Éclair"]);
  });

  it("§32 identical declarations in two places stay two candidates; sectionPath gives context only", () => {
    const d = new Doc().heading(1, "Spellcasting").heading(2, "Casting").p("Keywords: Magic").heading(1, "Rituals").p("Keywords: Magic");
    const r = run(d);
    expect(r.candidates.map((c) => pay(c).sectionPath)).toEqual(["Spellcasting > Casting", "Rituals"]);
    expect(new Set(r.fingerprints).size).toBe(2);
  });

  it("§37 identical output whatever order the rows arrive in", () => {
    const d = new Doc().heading(1, "A").p("Keywords: X, Y").heading(1, "B").p("HP = CON × 5").table([["Name", "Requirements"], ["Bolt", "Expert Emission"]]);
    const base = run(d);
    const again = runExtraction(defaultExtractorRegistry, batch(), [...d.sections].reverse(), [...d.nodes].reverse());
    expect(again.outputHash).toBe(base.outputHash);
  });

  it("§73 a SECTION_SUBTREE batch reads only its subtree", () => {
    const d = new Doc().heading(1, "Combat").p("Keywords: Melee").heading(1, "Skills").p("Requires: Trained Athletics").heading(1, "Spellcasting").p("Keywords: Magic").heading(2, "Costs").p("AP = MP / PRO");
    const scoped = run(d, { scopeType: "SECTION_SUBTREE", scopeSectionId: d.sections[2]!.id });
    expect(scoped.candidates.map((c) => c.displayLabel)).toEqual(["Magic", "AP"]);
  });
});

describe("tables (§24 / §25 / §65–§67)", () => {
  it("explicit header columns only; cell provenance via row / column / header", () => {
    const d = new Doc().heading(1, "Spells").table([
      ["Name", "Keywords", "Prerequisite", "Formula", "Damage"],
      ["Example", "Damage, Ongoing", "Expert Emission", "HP = CON × 5", "15"],
    ]);
    const cs = run(d).candidates;
    expect(cs.map((c) => [c.candidateKind, c.displayLabel, c.confidence, pay(c).rowIndex, pay(c).columnIndex, pay(c).headerText])).toEqual([
      ["KEYWORD", "Damage", "HIGH", 1, 1, "Keywords"],
      ["KEYWORD", "Ongoing", "HIGH", 1, 1, "Keywords"],
      ["REQUIREMENT", "Prerequisite: Expert Emission", "HIGH", 1, 2, "Prerequisite"],
      ["FORMULA", "HP", "MEDIUM", 1, 3, "Formula"],
    ]);
    expect(cs.every((c) => c.primarySourceAnchor.contentNodeId === d.nodes[1]!.id)).toBe(true);
    expect(pay(cs[0])).toMatchObject({ startOffset: 0, endOffset: 6 });
  });

  it("numeric content alone never makes a semantic column", () => {
    expect(run(new Doc().heading(1, "T").table([["Tier", "MP"], ["1", "3 + 2"], ["2", "5 × 2"]])).candidates).toEqual([]);
  });
});
