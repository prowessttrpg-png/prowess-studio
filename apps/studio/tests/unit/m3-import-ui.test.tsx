import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/developer/import/batches/abc" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { FormulaView, KeywordView, RequirementView, StructuralView, CandidateDetail } from "../../app/developer/import/_components/candidate";
import { BatchLifecycle, BatchStatusBadge, CandidateStatusBadge, ConfidenceBadge, ImportNav, ReviewProgress } from "../../app/developer/import/_components/common";
import { buildDecisionRequest, CompleteReviewPanel, DecisionHistory, DecisionPanel, MatchAssessmentView } from "../../app/developer/import/_components/review";
import { HighlightedText, SourceTableView } from "../../app/developer/import/_components/source";
import { availableDecisions, candidateSectionId, sectionPath } from "../../app/developer/import/_lib/presentation";
import type { ExtractionCandidateDto, ImportBatchDto, ImportDecisionDto, MatchAssessmentDto } from "../../src/api-client";

/** PAS-10 M3-WO8 §77 — Import Studio components (jsdom). Network is stubbed at fetch; nothing here talks to a DB. */
afterEach(() => vi.unstubAllGlobals());

const candidate = (over: Partial<ExtractionCandidateDto> = {}): ExtractionCandidateDto => ({
  id: "c1", importBatchId: "b1", sourceSnapshotId: "s1", ordinal: 18, candidateKind: "FORMULA", proposedEntityType: null, proposedCanonicalKey: null,
  displayLabel: "Spell AP", summary: null, confidence: "HIGH", status: "UNREVIEWED", payloadSchemaKey: "prowess.semantic.formula", payloadSchemaVersion: 1,
  payload: { leftHandText: "Spell AP", expressionText: "floor(Final MP / PRO)", qualifiers: ["minimum 1"], terms: ["Final MP", "PRO"], functions: ["floor"], sourceForm: "ASSIGNMENT", startOffset: 9, endOffset: 52, sectionPath: "Spellcasting > Costs" },
  candidateFingerprint: "f".repeat(64), primarySourceSectionId: null, primarySourceContentNodeId: "n1", supportingSources: [], createdAt: "2026-10-09T00:00:00.000Z", ...over,
});
const batch = (status: string): ImportBatchDto => ({
  id: "b1", sourceSnapshotId: "s1", sourceStructureHash: "a".repeat(64), label: "Batch", description: null, scopeType: "SNAPSHOT", scopeSectionId: null, reviewRulesetId: null, comparisonManifestId: null,
  extractorKey: "prowess.semantic-foundation", extractorVersion: "1", extractorConfigHash: null, batchFingerprint: "b".repeat(64), status, extractionOutputHash: "c".repeat(64), extractedAt: null, createdAt: "2026-10-09T00:00:00.000Z",
});
const assessment: MatchAssessmentDto = {
  id: "a1", matchRunId: "r1", extractionCandidateId: "c1", outcome: "POTENTIAL_MATCH", matchedEntityId: null, matchedBy: "NORMALIZED_LABEL", normalizedCandidateLabel: "arcana", normalizedProposedCanonicalKey: null, comparisonEntityVersionId: null,
  suggestions: [
    { id: "s1", entityId: "e1", rank: 1, score: 1, basis: "NORMALIZED_LABEL", comparisonEntityVersionId: "v1" },
    { id: "s2", entityId: "e2", rank: 2, score: 0.89, basis: "FUZZY_LABEL", comparisonEntityVersionId: null },
  ],
};
const decision = (n: number, type: string, from: string, to: string, extra: Partial<ImportDecisionDto> = {}): ImportDecisionDto => ({
  id: `d${n}`, importBatchId: "b1", extractionCandidateId: "c1", sequenceNumber: n, decisionType: type, fromStatus: from, toStatus: to, matchBasis: null, candidateFingerprint: "f".repeat(64), candidateSetHash: "c".repeat(64),
  matchRunId: null, matchAssessmentId: null, duplicateGroupId: null, targetEntityId: null, comparisonEntityVersionId: null, rationale: null, decisionFingerprint: "d".repeat(64), createdAt: "2026-10-09T00:00:00.000Z", ...extra,
});
const stubFetch = () => {
  const f = vi.fn(async (_input?: unknown, _init?: unknown) => new Response(JSON.stringify({ data: { entity: { id: "e1", canonicalKey: "k", entityType: "RESOURCE" } } }), { status: 200 }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("navigation and status", () => {
  it("Import navigation marks the active section with aria-current", () => {
    render(<ImportNav />);
    expect(screen.getByRole("link", { name: "Batches" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Sources" })).not.toHaveAttribute("aria-current");
  });

  it("Batch status: COMPLETED reads 'Review Complete' and the lifecycle marks the current step", () => {
    render(<><BatchStatusBadge status="COMPLETED" /><BatchLifecycle status="REVIEWING" /></>);
    expect(screen.getByTestId("batch-status")).toHaveTextContent("Review Complete");
    expect(screen.getByTestId("batch-status")).not.toHaveTextContent(/publish|import(ed)?\b|canon/i);
    const steps = within(screen.getByRole("list", { name: "Batch lifecycle" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(["Created", "Extracting", "Ready for Review", "Reviewing", "Review Complete"]);
    expect(screen.getByText("Reviewing")).toHaveAttribute("aria-current", "step");
  });

  it("review status and extraction confidence are separate, text-labelled badges", () => {
    render(<><CandidateStatusBadge status="APPROVED" /><CandidateStatusBadge status="CONFLICT" /><ConfidenceBadge confidence="HIGH" /></>);
    const [approved, conflict] = screen.getAllByTestId("candidate-status");
    expect(approved).toHaveTextContent("Approved for Import");
    expect(approved).toHaveAttribute("title", expect.stringMatching(/not Canon/));
    expect(conflict).toHaveTextContent("Import Conflict");
    expect(conflict).toHaveAttribute("title", "Import review conflict. This is not yet a Ruleset RuleConflict.");
    expect(screen.getByTestId("candidate-confidence")).toHaveTextContent("Confidence: HIGH");
  });
});

describe("candidate views", () => {
  it("Formula: structured fields, unresolved terms, nothing calculated", () => {
    render(<FormulaView payload={candidate().payload} />);
    const view = screen.getByTestId("formula-view");
    expect(view).toHaveTextContent("Spell AP");
    expect(view).toHaveTextContent("floor(Final MP / PRO)");
    expect(view).toHaveTextContent("minimum 1");
    expect(view).toHaveTextContent("Final MP, PRO");
    expect(view).toHaveTextContent(/not evaluated or executed/);
  });

  it("Requirement: authored text and unresolved source terms", () => {
    render(<RequirementView payload={{ marker: "Requires", rawRequirementText: "Expert Emission", terms: ["Expert", "Emission"], clauseIndex: 0, clauseCount: 1, negated: false }} />);
    const view = screen.getByTestId("requirement-view");
    expect(view).toHaveTextContent("Expert Emission");
    expect(view).toHaveTextContent("Unresolved source terms");
    expect(view).toHaveTextContent("Expert, Emission");
  });

  it("Keyword: authored label and the no-mechanics notice", () => {
    render(<KeywordView payload={{ authoredLabel: "Damage", normalizedLabel: "damage", declarationLabel: "Keywords" }} />);
    expect(screen.getByTestId("keyword-view")).toHaveTextContent("Extracted Keyword evidence does not grant mechanics.");
  });

  it("Structural: facts only, explicitly not a finished rule", () => {
    render(<StructuralView payload={{ unitType: "SECTION", title: "Combat", headingLevel: 1, sourceSectionId: "x" }} />);
    expect(screen.getByTestId("structural-view")).toHaveTextContent(/not a finished rule/);
  });

  it("Candidate detail keeps raw payload and fingerprints behind disclosures", () => {
    render(<CandidateDetail candidate={candidate()} />);
    expect(screen.getByText("Raw payload").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Technical details").closest("details")).not.toHaveAttribute("open");
  });
});

describe("source evidence rendering", () => {
  it("verbatim text with the payload offsets highlighted", () => {
    render(<HighlightedText text={"Formula: Spell AP = floor(Final MP / PRO), minimum 1\nNext line"} start={9} end={52} />);
    expect(screen.getByTestId("source-highlight")).toHaveTextContent("Spell AP = floor(Final MP / PRO), minimum 1");
    expect(screen.getByTestId("source-text").textContent).toBe("Formula: Spell AP = floor(Final MP / PRO), minimum 1\nNext line");
  });

  it("a table cell named by row / column is marked, nothing interpreted", () => {
    render(<SourceTableView structure={{ schemaVersion: 1, rowCount: 2, columnCount: 2, rows: [{ index: 0, isHeader: true, cells: [{ index: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, isHeader: true, rawText: "Name", nestedTables: [] }, { index: 1, columnIndex: 1, rowSpan: 1, colSpan: 1, isHeader: true, rawText: "Keywords", nestedTables: [] }] }, { index: 1, isHeader: false, cells: [{ index: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, isHeader: false, rawText: "Bolt", nestedTables: [] }, { index: 1, columnIndex: 1, rowSpan: 1, colSpan: 1, isHeader: false, rawText: "Damage, Ongoing", nestedTables: [] }] }] }} highlight={{ row: 1, column: 1 }} />);
    expect(screen.getByText("Damage, Ongoing")).toHaveAttribute("data-highlight", "true");
    expect(screen.getByText("Bolt")).not.toHaveAttribute("data-highlight");
  });

  it("section paths and evidence sections come from the loaded outline", () => {
    const sections = [{ id: "s1", sourceSnapshotId: "x", parentSectionId: null, title: "Spellcasting", headingLevel: 1, ordinal: 0, startPage: null, endPage: null, pageLocationBasis: "UNAVAILABLE" }, { id: "s2", sourceSnapshotId: "x", parentSectionId: "s1", title: "Costs", headingLevel: 2, ordinal: 1, startPage: null, endPage: null, pageLocationBasis: "UNAVAILABLE" }];
    expect(sectionPath("s2", sections)).toBe("Spellcasting > Costs");
    expect(candidateSectionId(candidate(), sections)).toBe("s2");
  });
});

describe("matching", () => {
  it("POTENTIAL_MATCH is not 'Matched'; suggestions keep server order; nothing is accepted", () => {
    stubFetch();
    render(<MatchAssessmentView assessment={assessment} />);
    expect(screen.getByTestId("match-outcome")).toHaveTextContent("Potential Match (not accepted)");
    expect(screen.getAllByTestId("match-suggestion").map((li) => li.textContent)).toEqual([expect.stringContaining("1.000"), expect.stringContaining("0.890")]);
    expect(screen.getByText(/A suggestion is not an acceptance/)).toBeInTheDocument();
  });
});

describe("decisions", () => {
  it("actions come from the shared rules: no direct approval of Entities, structural kinds only Needs Mapping / Reject", () => {
    expect(availableDecisions("UNREVIEWED", "ENTITY")).not.toContain("APPROVE_NEW_ENTITY");
    expect(availableDecisions("UNREVIEWED", "ENTITY")).toEqual(["CLASSIFY_MATCHED", "CLASSIFY_NEW_ENTITY", "MARK_CONFLICT", "MARK_NEEDS_MAPPING", "REJECT"]);
    expect(availableDecisions("UNREVIEWED", "FORMULA")).toContain("APPROVE_SEMANTIC");
    expect(availableDecisions("UNREVIEWED", "UNKNOWN")).toEqual(["MARK_NEEDS_MAPPING", "REJECT"]);
    expect(availableDecisions("APPROVED", "FORMULA")).toEqual([]);
  });

  it("the request carries exactly the command fields — never a server-controlled one", () => {
    const c = candidate({ candidateKind: "ENTITY" });
    const suggested = buildDecisionRequest(c, "CLASSIFY_MATCHED", { basis: "SUGGESTED_MATCH", target: "e1", rationale: "", groupId: "" }, { matchRunId: "r1", assessment, history: [] });
    expect(suggested).toEqual({ candidateFingerprint: "f".repeat(64), decisionType: "CLASSIFY_MATCHED", matchBasis: "SUGGESTED_MATCH", targetEntityId: "e1", matchRunId: "r1", matchAssessmentId: "a1", comparisonEntityVersionId: "v1" });
    const approve = buildDecisionRequest(c, "APPROVE_MATCHED", { basis: "", target: "", rationale: "", groupId: "" }, { matchRunId: null, assessment: null, history: [decision(1, "CLASSIFY_MATCHED", "UNREVIEWED", "MATCHED", { targetEntityId: "e9" })] });
    expect(approve).toEqual({ candidateFingerprint: "f".repeat(64), decisionType: "APPROVE_MATCHED", targetEntityId: "e9" });
    for (const body of [suggested, approve]) for (const k of ["status", "fromStatus", "toStatus", "sequenceNumber", "decisionFingerprint", "candidateSetHash", "createdAt"]) expect(body).not.toHaveProperty(k);
  });

  it("a manual override cannot be submitted without a rationale (no request is sent)", () => {
    const fetchMock = stubFetch();
    render(<DecisionPanel candidate={candidate({ candidateKind: "ENTITY" })} batch={batch("READY_FOR_REVIEW")} matchRunId={null} assessment={null} groups={[]} history={[]} onRecorded={() => undefined} onStale={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Classify as Matched" }));
    fireEvent.change(screen.getByLabelText("Match basis"), { target: { value: "MANUAL_OVERRIDE" } });
    fireEvent.click(screen.getByRole("button", { name: "Record: Classify as Matched" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A rationale is required for a manual override.");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/decisions"))).toEqual([]);
  });

  it("a completed Batch renders no review actions", () => {
    render(<DecisionPanel candidate={candidate()} batch={batch("COMPLETED")} matchRunId={null} assessment={null} groups={[]} history={[]} onRecorded={() => undefined} onStale={() => undefined} />);
    expect(screen.getByTestId("read-only-note")).toHaveTextContent("Review Complete");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("history renders sequence, transition, rationale — and offers no edit or delete", () => {
    stubFetch();
    render(<DecisionHistory decisions={[decision(1, "MARK_CONFLICT", "UNREVIEWED", "CONFLICT", { rationale: "cost 4 vs 6" }), decision(2, "CLASSIFY_MATCHED", "CONFLICT", "MATCHED", { targetEntityId: "e1", matchBasis: "MANUAL_OVERRIDE" })]} />);
    const entries = screen.getAllByTestId("decision-entry");
    expect(entries[0]).toHaveTextContent("1 MARK CONFLICT · Unreviewed → Import Conflict");
    expect(entries[0]).toHaveTextContent("cost 4 vs 6");
    expect(entries[1]).toHaveTextContent("basis MANUAL_OVERRIDE");
    expect(screen.queryByRole("button", { name: /edit|delete/i })).toBeNull();
  });
});

describe("progress and completion", () => {
  const summary = (byStatus: Record<string, number>, total: number) => ({ totalCandidates: total, byStatus, byKind: {}, decisionCount: 0, potentialConflictCount: null });
  it("progress comes from the server summary", () => {
    render(<ReviewProgress summary={summary({ APPROVED: 30, REJECTED: 12, UNREVIEWED: 25 }, 67)} />);
    expect(screen.getByTestId("review-progress")).toHaveTextContent("Reviewed 42 / 67");
    expect(screen.getByTestId("count-unresolved")).toHaveTextContent("25");
  });
  it("completion is blocked while Candidates are unresolved, and the confirmation explains it publishes nothing", () => {
    const { unmount } = render(<CompleteReviewPanel batch={batch("REVIEWING")} summary={summary({ APPROVED: 1, UNREVIEWED: 1 }, 2)} onComplete={async () => undefined} />);
    expect(screen.getByTestId("complete-blocked")).toHaveTextContent("1 Candidate(s)");
    expect(screen.getByRole("button", { name: "Complete Review" })).toBeDisabled();
    unmount();
    render(<CompleteReviewPanel batch={batch("REVIEWING")} summary={summary({ APPROVED: 1, REJECTED: 1 }, 2)} onComplete={async () => undefined} />);
    expect(screen.getByRole("button", { name: "Complete Review" })).toBeEnabled();
    expect(screen.getByText("Completing review freezes this review workflow. It does not publish or create Canon content.")).toBeInTheDocument();
  });
  it("a completed Batch shows Review Complete (read-only)", () => {
    render(<CompleteReviewPanel batch={batch("COMPLETED")} summary={summary({ APPROVED: 2 }, 2)} onComplete={async () => undefined} />);
    expect(screen.getByTestId("review-complete-note")).toHaveTextContent("Review Complete");
  });
});
