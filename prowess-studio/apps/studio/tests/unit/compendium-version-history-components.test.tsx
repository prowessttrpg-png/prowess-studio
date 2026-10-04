import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComparisonControls } from "../../app/compendium/_components/ComparisonControls";
import { RevisionSection } from "../../app/compendium/_components/RevisionSection";
import { StructuredDataViewer } from "../../app/compendium/_components/StructuredDataViewer";
import { VersionHistoryList } from "../../app/compendium/_components/VersionHistoryList";
import type { EntityVersionDto } from "../../app/compendium/_lib/api-client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function version(n: number, over: Partial<EntityVersionDto> = {}): EntityVersionDto {
  return {
    id: `v${n}`,
    entityId: "e1",
    revisionNumber: n,
    status: "DRAFT",
    displayName: `Name ${n}`,
    shortDescription: null,
    rulesText: null,
    structuredData: { n },
    parentVersionId: null,
    changeType: null,
    changeSummary: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
const href = (n: number) => `/compendium/entities/e1?revision=${n}`;

describe("VersionHistoryList", () => {
  const versions = [version(1), version(2, { changeType: "BALANCE", changeSummary: "Tuned it" }), version(3, { status: "CANON" })];

  it("lists every revision newest first with name, status text, and change metadata", () => {
    render(<VersionHistoryList versions={versions} selectedId="v2" latestId="v3" hrefForRevision={href} />);
    const entries = screen.getAllByTestId("history-entry");
    expect(entries.map((e) => e.getAttribute("data-revision"))).toEqual(["3", "2", "1"]);
    const second = within(entries[1]!);
    expect(second.getByText("Name 2")).toBeInTheDocument();
    expect(second.getByText("Balance")).toBeInTheDocument();
    expect(second.getByText("Tuned it")).toBeInTheDocument();
    expect(second.getByText("Draft")).toBeInTheDocument();
  });

  it("marks the selected revision with text AND aria-current, and the latest with text — not color alone", () => {
    render(<VersionHistoryList versions={versions} selectedId="v2" latestId="v3" hrefForRevision={href} />);
    const selected = screen.getByTestId("history-link-2");
    expect(selected).toHaveAttribute("aria-current", "page");
    expect(selected).toHaveTextContent("Selected");
    expect(screen.getByTestId("history-link-1")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("history-link-3")).toHaveTextContent("Latest Revision");
    expect(screen.getByTestId("history-link-1")).not.toHaveTextContent("Selected");
  });

  it("shows a CANON status only as a lifecycle label, with no authority wording", () => {
    render(<VersionHistoryList versions={versions} selectedId={null} latestId="v3" hrefForRevision={href} />);
    const entry = screen.getByTestId("history-link-3");
    expect(entry).toHaveTextContent("Canon");
    expect(entry.textContent).not.toMatch(/active|current|governing/i);
  });
});

describe("RevisionSection", () => {
  it("titles the latest revision 'Latest Revision' with no return link", () => {
    render(<RevisionSection version={version(3)} versionCount={3} isLatest latestHref="/x" />);
    expect(screen.getByRole("heading", { name: "Latest Revision" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Return to Latest Revision" })).not.toBeInTheDocument();
  });

  it("titles an older revision 'Selected Revision — Revision N' and offers the return link", () => {
    render(<RevisionSection version={version(1)} versionCount={3} isLatest={false} latestHref="/compendium/entities/e1" />);
    expect(screen.getByRole("heading", { name: "Selected Revision — Revision 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to Latest Revision" })).toHaveAttribute("href", "/compendium/entities/e1");
    expect(screen.getByTestId("selected-revision-section")).toBeInTheDocument();
  });

  it("shows every historical field of the SELECTED version, not the latest's", () => {
    render(
      <RevisionSection
        version={version(1, { displayName: "Old Rule", shortDescription: "short", rulesText: "rules", changeType: "FIX", changeSummary: "fixed", structuredData: { value: 10 } })}
        versionCount={2}
        isLatest={false}
        latestHref="/x"
      />,
    );
    const section = screen.getByTestId("selected-revision-section");
    for (const expected of ["Old Rule", "short", "rules", "FIX", "fixed", '"value": 10']) {
      expect(section.textContent).toContain(expected);
    }
  });

  it("renders a real parent link, a no-parent state, and an unavailable state", () => {
    const { rerender } = render(
      <RevisionSection version={version(3)} versionCount={3} isLatest parent={{ kind: "found", parent: version(1) }} parentHref={href} />,
    );
    expect(screen.getByTestId("revision-parent")).toHaveTextContent("Revision 1");
    expect(within(screen.getByTestId("revision-parent")).getByRole("link")).toHaveAttribute("href", href(1));

    rerender(<RevisionSection version={version(1)} versionCount={3} isLatest parent={{ kind: "none" }} />);
    expect(screen.getByTestId("revision-parent")).toHaveTextContent("None");

    rerender(<RevisionSection version={version(2)} versionCount={3} isLatest parent={{ kind: "missing", parentVersionId: "x" }} />);
    expect(screen.getByTestId("revision-parent")).toHaveTextContent("Unavailable");
  });

  it("never invents lifecycle-event timestamps", () => {
    render(<RevisionSection version={version(1, { status: "APPROVED" })} versionCount={1} isLatest />);
    expect(screen.getByTestId("latest-revision-section").textContent).not.toMatch(/approved on|entered playtest|transitioned/i);
  });
});

describe("ComparisonControls", () => {
  it("is labeled and offers both selectors when there are two or more revisions", () => {
    render(<ComparisonControls versions={[version(1), version(2)]} revisionA="" revisionB="" onChange={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByLabelText("Revision A")).toBeInTheDocument();
    expect(screen.getByLabelText("Revision B")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear comparison" })).not.toBeInTheDocument();
  });

  it("offers a clear action once something is selected", () => {
    render(<ComparisonControls versions={[version(1), version(2)]} revisionA="1" revisionB="" onChange={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Clear comparison" })).toBeInTheDocument();
  });

  it("renders no selectors at all for a single-version Entity", () => {
    render(<ComparisonControls versions={[version(1)]} revisionA="" revisionB="" onChange={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByTestId("comparison-unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("StructuredDataViewer accessibility", () => {
  it("is a labeled, keyboard-focusable scroll region", () => {
    render(<StructuredDataViewer data={{ a: 1 }} emptyLabel="none" label="Structured data, Revision 2" />);
    const region = screen.getByRole("region", { name: "Structured data, Revision 2" });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});
