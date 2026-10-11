import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * PAS-10 M3-WO9 — synthetic regressions for the two Import Studio defects the real Core Playtest Packet exposed:
 *  1. quadratic section-path derivation (a ~2,500-section outline made each semantic queue render take seconds);
 *  2. repeated section paths (a real source has several "Example …" sub-headings with the same path), which sent
 *     semantic Source Evidence to the FIRST section with that path even when the anchored node lives in another.
 */
const contents = vi.fn();
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("../../src/api-client", async (original) => ({ ...(await original<typeof import("../../src/api-client")>()), listSectionContents: (id: string, p: unknown) => contents(id, p) }));

import { SourceEvidence } from "../../app/developer/import/_components/review";
import { candidateSectionId, candidateSectionIds, sectionPath } from "../../app/developer/import/_lib/presentation";
import type { ExtractionCandidateDto, SourceSectionDto } from "../../src/api-client";

const section = (id: string, title: string, parentSectionId: string | null, ordinal: number): SourceSectionDto => ({ id, sourceSnapshotId: "s", parentSectionId, title, headingLevel: parentSectionId ? 2 : 1, ordinal, startPage: null, endPage: null, pageLocationBasis: "UNAVAILABLE" });
const semantic = (sectionPathText: string, nodeId: string): ExtractionCandidateDto => ({
  id: "c1", importBatchId: "b", sourceSnapshotId: "s", ordinal: 1, candidateKind: "KEYWORD", proposedEntityType: null, proposedCanonicalKey: null, displayLabel: "Fire", summary: null, confidence: "HIGH", status: "UNREVIEWED",
  payloadSchemaKey: "prowess.semantic.keyword", payloadSchemaVersion: 1, payload: { authoredLabel: "Fire", sectionPath: sectionPathText, startOffset: 10, endOffset: 14 }, candidateFingerprint: "f".repeat(64),
  primarySourceSectionId: null, primarySourceContentNodeId: nodeId, supportingSources: [], createdAt: "2026-10-10T00:00:00.000Z",
});

describe("outline indexing scales to real documents", () => {
  it("derives paths for a 3,000-section outline once, not per row per render", () => {
    const sections: SourceSectionDto[] = [];
    for (let i = 0; i < 1000; i += 1) {
      sections.push(section(`h${i}`, `CHAPTER ${i}`, null, i * 3));
      sections.push(section(`a${i}`, `Effects`, `h${i}`, i * 3 + 1));
      sections.push(section(`b${i}`, `Example ${i}`, `h${i}`, i * 3 + 2));
    }
    const rows = Array.from({ length: 25 }, (_, i) => semantic(`CHAPTER ${900 + i} > Example ${900 + i}`, `n${i}`));
    const started = performance.now();
    for (let render = 0; render < 40; render += 1) for (const r of rows) sectionPath(candidateSectionId(r, sections), sections);
    expect(performance.now() - started).toBeLessThan(500); // previously O(sections²) per row: tens of seconds here
    expect(sectionPath(candidateSectionId(rows[3]!, sections), sections)).toBe("CHAPTER 903 > Example 903");
  });
});

describe("scope-relative section paths (SECTION_SUBTREE payloads)", () => {
  it("a path recorded relative to the Batch's scope root resolves to the full-path section", () => {
    const sections = [section("p", "EXAMPLE TRAIT ENTRY", null, 0), section("c", "Fire Conversion", "p", 1), section("q", "OTHER", null, 2)];
    expect(candidateSectionIds(semantic("Fire Conversion", "n"), sections)).toEqual(["c"]);
    expect(candidateSectionIds(semantic("EXAMPLE TRAIT ENTRY > Fire Conversion", "n"), sections)).toEqual(["c"]);
  });
});

describe("repeated section paths", () => {
  const sections = [section("x1", "EXAMPLE TRAIT ENTRY", null, 0), section("x2", "EXAMPLE TRAIT ENTRY", null, 1), section("y", "OTHER", null, 2)];

  it("every section sharing the payload's path is a candidate location, in source order", () => {
    expect(candidateSectionIds(semantic("EXAMPLE TRAIT ENTRY", "n"), sections)).toEqual(["x1", "x2"]);
  });

  it("Source Evidence finds the anchored node in the second same-path section and links there", async () => {
    contents.mockImplementation(async (id: string) => ({
      items: id === "x2" ? [{ id: "node-2", sourceSnapshotId: "s", sourceSectionId: "x2", ordinal: 9, nodeType: "BLOCK", block: { id: "b2", sourceSectionId: "x2", blockType: "PARAGRAPH", ordinal: 0, rawText: "Keywords: Fire, Ice", sourceStyle: null, listLevel: null, listOrdered: null } }] : [],
      pagination: { page: 1, pageSize: 100, total: id === "x2" ? 1 : 0, totalPages: 1 },
    }));
    render(<SourceEvidence candidate={semantic("EXAMPLE TRAIT ENTRY", "node-2")} sections={sections} snapshotId="s" />);
    expect(await screen.findByTestId("source-highlight")).toHaveTextContent("Fire");
    expect(screen.getByTestId("view-in-source").getAttribute("href")).toContain("section=x2");
    expect(contents.mock.calls.map(([id]) => id)).toEqual(["x1", "x2"]);
  });
});
