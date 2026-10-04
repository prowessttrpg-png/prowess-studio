import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityDetailView } from "../../app/compendium/_components/EntityDetailView";
import type {
  EntityVersionDto,
  KeywordAssignmentDto,
  SourceDocumentDto,
  SourceReferenceDto,
} from "../../app/compendium/_lib/api-client";

let mockSearchParams = new URLSearchParams();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ENTITY = {
  id: "e1",
  entityType: "SPELL_EFFECT",
  canonicalKey: "test.history.entity",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function version(n: number, over: Partial<EntityVersionDto> = {}): EntityVersionDto {
  return {
    id: `v${n}`,
    entityId: "e1",
    revisionNumber: n,
    status: "DRAFT",
    displayName: `Rev ${n}`,
    shortDescription: null,
    rulesText: null,
    structuredData: {},
    parentVersionId: null,
    changeType: null,
    changeSummary: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
const kw = (id: string, name: string): KeywordAssignmentDto => ({
  keyword: { id, canonicalKey: `test.kw.${id}`, name, categoryId: null, description: null, deprecated: false, createdAt: "" },
  sourceType: "AUTHORED",
  createdAt: "",
});
const ref = (id: string, docId: string, versionId: string): SourceReferenceDto => ({
  id, sourceDocumentId: docId, entityVersionId: versionId, sectionLabel: null, pageReference: null, sourceExcerptNote: null, createdAt: "",
});
const doc = (id: string, title: string): SourceDocumentDto => ({
  id, title, sourceType: "DOCUMENT", versionLabel: null, authorityStatus: null, fileReference: null, notes: null, createdAt: "",
});

interface Scenario {
  versions: EntityVersionDto[];
  keywords: Record<string, KeywordAssignmentDto[]>;
  sources: Record<string, SourceReferenceDto[]>;
  docs: Record<string, SourceDocumentDto>;
  failKeywordsFor?: string[];
}

function twoRevisionScenario(): Scenario {
  return {
    versions: [
      version(1, { displayName: "Old Rule", structuredData: { value: 10 } }),
      version(2, { displayName: "New Rule", structuredData: { value: 20 }, parentVersionId: "v1" }),
    ],
    keywords: { v1: [kw("alpha", "Alpha"), kw("common", "Common")], v2: [kw("beta", "Beta"), kw("common", "Common")] },
    sources: { v1: [ref("r1", "doc-a", "v1")], v2: [ref("r2", "doc-b", "v2")] },
    docs: { "doc-a": doc("doc-a", "Source A"), "doc-b": doc("doc-b", "Source B") },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function installFetch(scenario: Scenario): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(input, "http://localhost").pathname;
      calls.push(path);
      if (path === "/api/entities/e1") return json({ data: ENTITY });
      if (path === "/api/entities/e1/versions") return json({ data: scenario.versions });
      if (path === "/api/entities/e1/aliases") {
        return json({ data: [{ id: "a1", entityId: "e1", alias: "Legacy Alias", normalizedAlias: "legacy alias", context: null, createdAt: "" }] });
      }
      if (path === "/api/entities/e1/keywords") return json({ data: [kw("entity-kw", "Gamma")] });
      if (path === "/api/entities/e1/relationships") {
        return json({
          data: {
            outgoing: [
              {
                relationship: { id: "rel1", sourceEntityId: "e1", targetEntityId: "e2", relationshipType: "REQUIRES", metadata: {}, createdAt: "" },
                counterpart: { ...ENTITY, id: "e2", canonicalKey: "test.counterpart" },
              },
            ],
            incoming: [],
          },
        });
      }
      const keywordsMatch = /^\/api\/entity-versions\/(\w+)\/keywords$/.exec(path);
      if (keywordsMatch) {
        const id = keywordsMatch[1] as string;
        if (scenario.failKeywordsFor?.includes(id)) {
          return json({ code: "INTERNAL.UNEXPECTED_ERROR", message: "An unexpected server error occurred.", field: null, details: null }, 500);
        }
        return json({ data: scenario.keywords[id] ?? [] });
      }
      const sourcesMatch = /^\/api\/entity-versions\/(\w+)\/sources$/.exec(path);
      if (sourcesMatch) return json({ data: scenario.sources[sourcesMatch[1] as string] ?? [] });
      const docMatch = /^\/api\/source-documents\/([\w-]+)$/.exec(path);
      if (docMatch && scenario.docs[docMatch[1] as string]) return json({ data: scenario.docs[docMatch[1] as string] });
      return json({ code: "ENTITY.NOT_FOUND", message: "not found", field: null, details: null }, 404);
    }),
  );
  return calls;
}

function at(search: string) {
  mockSearchParams = new URLSearchParams(search);
}

describe("EntityDetailView — Version History", () => {
  beforeEach(() => {
    mockPush.mockClear();
    at("");
  });
  afterEach(() => vi.unstubAllGlobals());

  describe("historical independence (mandatory regression)", () => {
    it("selecting Revision 1 shows only Revision 1's content, Keywords, and Sources", async () => {
      at("revision=1");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);

      const group = await screen.findByTestId("selected-revision-group");
      await within(group).findByText("Alpha");
      await within(group).findByText(/Source A/);

      const text = group.textContent ?? "";
      expect(text).toContain("Old Rule");
      expect(text).toContain('"value": 10');
      expect(text).toContain("Alpha");
      expect(text).toContain("Source A");
      expect(text).not.toContain("New Rule");
      expect(text).not.toContain('"value": 20');
      expect(text).not.toContain("Beta");
      expect(text).not.toContain("Source B");
    });

    it("selecting Revision 2 shows only Revision 2's content", async () => {
      at("revision=2");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);

      const group = await screen.findByTestId("selected-revision-group");
      await within(group).findByText("Beta");
      await within(group).findByText(/Source B/);
      const text = group.textContent ?? "";
      expect(text).toContain("New Rule");
      expect(text).toContain('"value": 20');
      expect(text).not.toContain("Old Rule");
      expect(text).not.toContain("Alpha");
      expect(text).not.toContain("Source A");
    });
  });

  describe("Latest vs Selected terminology", () => {
    it("labels the default view 'Latest Revision' and marks the newest history entry as current selection", async () => {
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      expect(await screen.findByRole("heading", { name: "Latest Revision" })).toBeInTheDocument();
      expect(screen.getByTestId("history-link-2")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("history-link-1")).not.toHaveAttribute("aria-current");
    });

    it("labels a deliberately-selected older revision 'Selected Revision — Revision N' with a return link, never snapping back", async () => {
      at("revision=1");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      expect(await screen.findByRole("heading", { name: "Selected Revision — Revision 1" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Latest Revision" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Return to Latest Revision" })).toHaveAttribute("href", "/compendium/entities/e1");
      expect(screen.getByTestId("history-link-1")).toHaveAttribute("aria-current", "page");
    });

    it("explicitly requesting the highest revision is still the Latest Revision", async () => {
      at("revision=2");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      expect(await screen.findByRole("heading", { name: "Latest Revision" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Selected Revision/ })).not.toBeInTheDocument();
    });

    it("lists every revision newest first, as links addressing ?revision=N", async () => {
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      await screen.findByTestId("version-history");
      const entries = screen.getAllByTestId("history-entry");
      expect(entries.map((entry) => entry.getAttribute("data-revision"))).toEqual(["2", "1"]);
      expect(screen.getByTestId("history-link-1")).toHaveAttribute("href", "/compendium/entities/e1?revision=1");
      expect(screen.getByRole("navigation", { name: "Version History" })).toBeInTheDocument();
    });
  });

  describe("parent lineage (mandatory regression)", () => {
    const branched = (): Scenario => ({
      ...twoRevisionScenario(),
      versions: [version(1), version(2, { parentVersionId: "v1" }), version(3, { parentVersionId: "v1" })],
    });

    it("Revision 3 whose parent is Revision 1 shows Revision 1, not Revision 2", async () => {
      at("revision=3");
      installFetch(branched());
      render(<EntityDetailView entityId="e1" />);
      const parent = await screen.findByTestId("revision-parent");
      expect(parent).toHaveTextContent("Revision 1");
      expect(parent).not.toHaveTextContent("Revision 2");
      expect(within(parent).getByRole("link")).toHaveAttribute("href", "/compendium/entities/e1?revision=1");
    });

    it("shows a clean no-parent state for a root revision", async () => {
      at("revision=1");
      installFetch(branched());
      render(<EntityDetailView entityId="e1" />);
      expect(await screen.findByTestId("revision-parent")).toHaveTextContent("None");
    });

    it("does not invent a parent link when parentVersionId is not among this Entity's revisions", async () => {
      at("revision=2");
      installFetch({ ...twoRevisionScenario(), versions: [version(1), version(2, { parentVersionId: "ghost" })] });
      render(<EntityDetailView entityId="e1" />);
      const parent = await screen.findByTestId("revision-parent");
      expect(parent).toHaveTextContent("Unavailable");
      expect(within(parent).queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("invalid revision in the URL", () => {
    it("renders a not-found state with a way back, and does NOT silently show another revision", async () => {
      at("revision=999");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);

      const notFound = await screen.findByTestId("revision-not-found");
      expect(notFound).toHaveTextContent("Revision 999");
      expect(within(notFound).getByRole("link", { name: "Return to Latest Revision" })).toBeInTheDocument();
      expect(screen.queryByTestId("latest-revision-section")).not.toBeInTheDocument();
      expect(screen.queryByTestId("selected-revision-section")).not.toBeInTheDocument();
      // Stable identity survives the bad selection.
      expect(screen.getByTestId("identity-section")).toHaveTextContent("test.history.entity");
      // The history rail remains, and NO entry is marked selected — nothing was substituted.
      const entries = screen.getAllByTestId("history-entry");
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => entry.getAttribute("data-selected") === "false")).toBe(true);
    });
  });

  describe("empty and single-version Entities", () => {
    it("zero versions: shows 'No revisions' and renders no history or comparison controls", async () => {
      installFetch({ ...twoRevisionScenario(), versions: [] });
      render(<EntityDetailView entityId="e1" />);
      expect(await screen.findByText("No revisions")).toBeInTheDocument();
      expect(screen.queryByTestId("version-history")).not.toBeInTheDocument();
      expect(screen.queryByTestId("comparison-controls")).not.toBeInTheDocument();
      expect(screen.getByTestId("identity-section")).toBeInTheDocument();
    });

    it("one version: history still shows Revision 1, comparison is unavailable with no empty selector", async () => {
      installFetch({ ...twoRevisionScenario(), versions: [version(1)] });
      render(<EntityDetailView entityId="e1" />);
      expect(await screen.findByTestId("comparison-unavailable")).toHaveTextContent("at least two revisions");
      expect(screen.getAllByTestId("history-entry")).toHaveLength(1);
      expect(screen.queryByLabelText("Revision A")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Revision B")).not.toBeInTheDocument();
    });
  });

  describe("comparison mode", () => {
    it("choosing Revision A writes compareA to the URL, preserving the rest", async () => {
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      const select = await screen.findByLabelText("Revision A");
      fireEvent.change(select, { target: { value: "1" } });
      expect(mockPush).toHaveBeenCalledWith("/compendium/entities/e1?compareA=1");
    });

    it("compares Revision 1 vs Revision 2 with clear A/B identity and independent values (mandatory regression)", async () => {
      at("compareA=1&compareB=2");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);

      const cmp = await screen.findByTestId("revision-comparison");
      expect(within(cmp).getByTestId("compare-display-name-a")).toHaveTextContent("Revision A (Revision 1)");
      expect(within(cmp).getByTestId("compare-display-name-a")).toHaveTextContent("Old Rule");
      expect(within(cmp).getByTestId("compare-display-name-b")).toHaveTextContent("Revision B (Revision 2)");
      expect(within(cmp).getByTestId("compare-display-name-b")).toHaveTextContent("New Rule");
      expect(within(cmp).getByTestId("compare-field-display-name")).toHaveTextContent("Differs between revisions");

      const jsonA = within(cmp).getByTestId("compare-structured-data-a");
      const jsonB = within(cmp).getByTestId("compare-structured-data-b");
      expect(jsonA).toHaveTextContent('"value": 10');
      expect(jsonA).not.toHaveTextContent('"value": 20');
      expect(jsonB).toHaveTextContent('"value": 20');
      expect(jsonB).not.toHaveTextContent('"value": 10');
      expect(within(cmp).getByTestId("compare-field-structured-data")).toHaveTextContent("Differs between revisions");

      await waitFor(() => expect(within(cmp).getByTestId("compare-keywords-only-a")).toHaveTextContent("Alpha"));
      expect(within(cmp).getByTestId("compare-keywords-only-a")).not.toHaveTextContent("Common");
      expect(within(cmp).getByTestId("compare-keywords-only-a")).not.toHaveTextContent("Beta");
      expect(within(cmp).getByTestId("compare-keywords-shared")).toHaveTextContent("Common");
      expect(within(cmp).getByTestId("compare-keywords-only-b")).toHaveTextContent("Beta");
      expect(within(cmp).getByTestId("compare-keywords-only-b")).not.toHaveTextContent("Alpha");

      await waitFor(() => expect(within(cmp).getByTestId("compare-sources-a")).toHaveTextContent("Source A"));
      await waitFor(() => expect(within(cmp).getByTestId("compare-sources-b")).toHaveTextContent("Source B"));
      expect(within(cmp).getByTestId("compare-sources-a")).not.toHaveTextContent("Source B");
      expect(within(cmp).getByTestId("compare-sources-b")).not.toHaveTextContent("Source A");
      expect(cmp.textContent).toMatch(/no game-balance or mechanical meaning/i);
      expect(cmp.textContent).not.toMatch(/buff|nerf/i);
    });

    it("marks identical fields as identical", async () => {
      at("compareA=1&compareB=2");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      const cmp = await screen.findByTestId("revision-comparison");
      expect(within(cmp).getByTestId("compare-field-status")).toHaveTextContent("Identical in both revisions");
    });

    it("rejects an unknown compare revision clearly instead of guessing", async () => {
      at("compareA=1&compareB=77");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      expect(await screen.findByTestId("comparison-invalid")).toHaveTextContent("Revision 77");
      expect(screen.queryByTestId("revision-comparison")).not.toBeInTheDocument();
    });
  });

  describe("stable Entity-level data", () => {
    it("is not refetched when the selected revision changes, and stays visible and identical", async () => {
      at("revision=1");
      const calls = installFetch(twoRevisionScenario());
      const { rerender } = render(<EntityDetailView entityId="e1" />);

      const stableBefore = await screen.findByTestId("stable-entity-sections");
      await within(stableBefore).findByText("test.counterpart");
      expect(within(stableBefore).getByText("Legacy Alias")).toBeInTheDocument();
      expect(within(stableBefore).getByText("Gamma")).toBeInTheDocument();
      const htmlBefore = stableBefore.innerHTML;

      at("revision=2");
      rerender(<EntityDetailView entityId="e1" />);
      const group = screen.getByTestId("selected-revision-group");
      await within(group).findByText("Beta");

      const stableAfter = screen.getByTestId("stable-entity-sections");
      expect(stableAfter.innerHTML).toBe(htmlBefore);
      for (const stablePath of [
        "/api/entities/e1",
        "/api/entities/e1/versions",
        "/api/entities/e1/aliases",
        "/api/entities/e1/keywords",
        "/api/entities/e1/relationships",
      ]) {
        expect(calls.filter((call) => call === stablePath)).toHaveLength(1);
      }
      expect(calls.filter((call) => call === "/api/entity-versions/v2/keywords")).toHaveLength(1);
    });

    it("keeps aliases at the Entity level, not tied to whichever revision shares a name", async () => {
      at("revision=2");
      installFetch(twoRevisionScenario());
      render(<EntityDetailView entityId="e1" />);
      const stable = await screen.findByTestId("stable-entity-sections");
      expect(within(stable).getByText("Legacy Alias")).toBeInTheDocument();
      expect(within(screen.getByTestId("selected-revision-group")).queryByText("Legacy Alias")).not.toBeInTheDocument();
    });
  });

  describe("version-scoped failures", () => {
    it("a Keyword load failure shows a local error but keeps the Entity, the revision, and its Sources", async () => {
      at("revision=1");
      installFetch({ ...twoRevisionScenario(), failKeywordsFor: ["v1"] });
      render(<EntityDetailView entityId="e1" />);

      const group = await screen.findByTestId("selected-revision-group");
      const error = await within(group).findByTestId("error-state");
      expect(error).toHaveTextContent("An unexpected server error occurred.");
      expect(error.textContent?.toLowerCase()).not.toContain("prisma");
      expect(group.textContent).toContain("Old Rule");
      await within(group).findByText(/Source A/);
      expect(screen.getByTestId("identity-section")).toHaveTextContent("test.history.entity");
    });
  });
});
