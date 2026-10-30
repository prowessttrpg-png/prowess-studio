import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryCardDto, EntryDetailDto, ReleaseDetailDto } from "../../app/compendium/rulesets/_lib/reference-client";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";

/**
 * PAS-10 M6-WO2 — Rules Reference UI. The read-only reference client is mocked: these tests prove PRESENTATION — exact
 * Release context in every URL, pinned-vs-latest indicator, exact-reference mismatch / absence, dedicated presenters
 * per family through the ONE descriptor set, generic fallback without an inferred kind, raw JSON only under Developer
 * details, integrity warnings from the server, server-side facets in URL state, explicit Latest Release resolution,
 * the no-Releases state and composition-only comparison. Invariants: M6-I011, M6-I012, M6-I014, M6-I015, M6-I016,
 * M6-I017, M6-I018, M6-I019.
 */
const client = vi.hoisted(() => ({
  listReleases: vi.fn(),
  resolveLatestRelease: vi.fn(),
  getRelease: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  compareReleases: vi.fn(),
  getCatalog: vi.fn(),
  searchKeywords: vi.fn(),
}));
vi.mock("../../app/compendium/rulesets/_lib/reference-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams(), pathname: "/compendium/rulesets/rs1/releases/rel1" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => nav.params, usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { EntryDetailView } = await import("../../app/compendium/rulesets/_components/EntryDetailView");
const { ReleaseBrowser } = await import("../../app/compendium/rulesets/_components/ReleaseBrowser");
const { RulesetReference } = await import("../../app/compendium/rulesets/_components/RulesetReference");
const { ComparisonView } = await import("../../app/compendium/rulesets/_components/ComparisonView");
const { ReferenceApiError } = await import("../../app/compendium/rulesets/_lib/reference-client");

const RS = "rs1";
const REL = "rel1";
const RELEASE = { id: REL, rulesetId: RS, releaseNumber: 3, versionLabel: "0.3.0", channel: "CORE_PLAYTEST", publishedAt: "2026-10-01T12:00:00.000Z" };
const RELEASE_DETAIL: ReleaseDetailDto = {
  ...RELEASE,
  ruleset: { id: RS, canonicalKey: "ruleset.core", name: "Core Playtest" },
  releaseNotes: "Movement pass.",
  manifestId: "m3",
  manifestHash: "a".repeat(64),
  compositionSize: 2,
  verification: { valid: true, storedHash: "a".repeat(64), computedHash: "a".repeat(64) },
};
const info = (definitionKind: string) => {
  const k = kindRow(definitionKind);
  return { definitionKind, systemFamily: k.systemFamily, branch: k.branch, sharedContract: k.sharedContract, supportedSchemaVersions: k.supportedSchemaVersions };
};
const ref = (entityId: string, entityVersionId: string) => ({ entityId, entityVersionId, canonicalKey: `spell.effect.${entityId}`, definitionKind: "SPELL_EFFECT", systemFamily: "SPELL" });

function detail(over: Partial<EntryDetailDto> = {}, payload: Record<string, unknown> | null = null, kind = "SPELL_EFFECT", schemaVersion = 1): EntryDetailDto {
  const definition =
    payload === null
      ? null
      : { schemaVersion, systemFamily: kindRow(kind).systemFamily, definitionKind: kind, payload, legacyTerms: null };
  return {
    release: RELEASE,
    ruleset: RELEASE_DETAIL.ruleset,
    entity: { id: "e1", canonicalKey: "spell.effect.force_push", entityType: "SPELL_EFFECT" },
    pinnedRevision: {
      id: "v3", entityId: "e1", revisionNumber: 3, status: "APPROVED", displayName: "Force Push", shortDescription: "Shove a creature.", rulesText: "You push the target 10 feet.",
      structuredData: definition === null ? { summary: "Fire damage Spell Effect" } : { prowessDefinition: definition }, parentVersionId: "v2", changeType: null, changeSummary: null, createdAt: "", updatedAt: "",
    },
    latestRevisionNumber: 5,
    definition,
    kind: definition === null ? null : info(kind),
    schemaVersionSupported: definition !== null && kindRow(kind).supportedSchemaVersions.includes(schemaVersion),
    keywords: { structured: [{ canonicalKey: "keyword.control", keyword: { id: "k1", canonicalKey: "keyword.control", name: "Control", deprecated: false } }], assigned: [] },
    references: [],
    referencesTruncated: false,
    referencedBy: [],
    referencedByTruncated: false,
    relationships: [],
    relatedByKeyword: [],
    sources: [],
    ...over,
  };
}

const EFFECT_PAYLOAD = {
  effectFamily: "FORCED_MOVEMENT",
  keywords: ["keyword.control"],
  parameters: {},
  compatibility: [{ relation: "TARGETING", allow: ["SINGLE_TARGET"] }],
  costContributions: [{ contributionKey: "effect.mp", currency: "MP", data: { formula: { expression: "2 + rank", rounding: "NONE" } } }],
  rules: { pairsWith: ref("e2", "v2b"), access: { kind: "ALL", children: [{ kind: "KEYWORD_PRESENT", keywordId: null, canonicalKey: "keyword.control", provenance: null }] } },
  resolution: { mode: "SAVING_THROW", data: { saveStat: "STR" } },
  outcomes: [{ outcomeKey: "push", data: { feet: 10 } }],
};

const card = (id: string, name: string, over: Partial<EntryCardDto> = {}): EntryCardDto => ({
  entityId: id, entityVersionId: `${id}v`, canonicalKey: `test.${id}`, entityType: "GENERIC_RULE", displayName: name, shortDescription: null, revisionNumber: 1, status: "APPROVED", definitionKind: null, kind: null, schemaVersion: null, keywords: [], ...over,
});

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  nav.push.mockReset();
  nav.params = new URLSearchParams();
  client.getCatalog.mockResolvedValue(CATALOG);
  client.searchKeywords.mockResolvedValue([]);
  client.getRelease.mockResolvedValue(RELEASE_DETAIL);
  client.listReleases.mockResolvedValue({ ruleset: RELEASE_DETAIL.ruleset, releases: [{ ...RELEASE, id: "rel0", releaseNumber: 2, versionLabel: "0.2.0" }, RELEASE] });
  client.listEntries.mockResolvedValue({ data: [card("e1", "Force Push", { definitionKind: "SPELL_EFFECT", kind: info("SPELL_EFFECT"), entityType: "SPELL_EFFECT" }), card("g1", "Adjudication Note")], pagination: { page: 1, pageSize: 24, total: 2, totalPages: 1 } });
});

describe("M6-WO2 entry page — exact pin, header and separation (M6-I012, M6-I015)", () => {
  it("shows the common header, the pinned-vs-latest indicator and separates Rules Text from Mechanical Data; no edit controls", async () => {
    client.getEntry.mockResolvedValue(detail({}, EFFECT_PAYLOAD));
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Force Push" })).toBeInTheDocument();
    const header = screen.getByTestId("reference-entry-header");
    expect(header).toHaveTextContent("Spell Effect");
    expect(header).toHaveTextContent("Pinned Revision 3");
    expect(screen.getByText("spell.effect.force_push")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Keywords of this revision" })).toHaveTextContent("Control");
    expect(screen.getByTestId("reference-pin-indicator")).toHaveTextContent("This Release uses Revision 3. Latest Entity Revision is 5.");
    expect(screen.getByRole("link", { name: "View Revision History" })).toHaveAttribute("href", "/compendium/entities/e1?revision=3");
    expect(screen.getByRole("link", { name: "Open in Compendium Admin" })).toHaveAttribute("href", "/compendium/admin/entities/e1");
    expect(screen.getByRole("heading", { level: 2, name: "Rules Text" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Mechanical Data" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save|edit|delete|publish|create/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    // The breadcrumb names the exact Release, and the crumb link keeps it.
    expect(screen.getByRole("link", { name: "Release 3 — 0.3.0" })).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel1");
  });

  it("dedicated Effect presentation: tokens readable with the exact token, authored costs and formulas exactly (never computed), structured requirements; raw JSON only under Developer details", async () => {
    client.getEntry.mockResolvedValue(detail({}, EFFECT_PAYLOAD));
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
    const presenter = await screen.findByTestId("reference-presenter");
    expect(presenter).toHaveAttribute("data-presenter", "dedicated");
    expect(presenter).toHaveTextContent("Forced Movement FORCED_MOVEMENT");
    expect(presenter).toHaveTextContent("Saving Throw SAVING_THROW");
    expect(within(presenter).getByRole("table")).toHaveTextContent("effect.mp");
    expect(presenter).toHaveTextContent("Formula (authored — not evaluated here) 2 + rank");
    expect(presenter).toHaveTextContent("The final cost is computed by the Rules Engine — never on this page.");
    expect(presenter).toHaveTextContent("All ALL of:");
    expect(presenter).toHaveTextContent("Keyword Present KEYWORD_PRESENT");
    const developer = screen.getByText(/Developer details — stored structured data/).closest("details")!;
    expect(developer).not.toHaveAttribute("open");
    expect(developer.querySelector("pre")?.textContent).toContain('"prowessDefinition"');
    expect(presenter.querySelector("pre")).toBeNull();
  });

  it.each(["SPELL_TARGETING", "SPELL_EFFECT", "SPELL_TRAIT", "SPELL_DURATION", "SPELL_CASTING_CONDITION", "MANEUVER_TARGETING", "MANEUVER_EFFECT", "MANEUVER_TRAIT", "MANEUVER_DURATION", "MANEUVER_CONDITION", "MANEUVER_FOUNDATION"])(
    "%s has a dedicated presenter from its shared-contract descriptor",
    async (kind) => {
      client.getEntry.mockResolvedValue(detail({}, { keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {} }, kind));
      render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
      expect(await screen.findByTestId("reference-presenter")).toHaveAttribute("data-presenter", "dedicated");
    },
  );

  it.each([1, 2])("AFFINITY version %i has a dedicated presenter", async (schemaVersion) => {
    const payload = schemaVersion === 1 ? { affinity: "EVOCATION" } : { affinity: "EVOCATION", identity: { text: "Raw force.", themes: ["force"] }, strengths: [], weaknesses: [], source: { document: "x" } };
    client.getEntry.mockResolvedValue(detail({}, payload, "AFFINITY", schemaVersion));
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
    const presenter = await screen.findByTestId("reference-presenter");
    expect(presenter).toHaveAttribute("data-presenter", "dedicated");
    expect(presenter).toHaveTextContent("Evocation EVOCATION");
  });

  it("an unsupported (historical / future) schema version renders generically, verbatim, and says it is never migrated", async () => {
    client.getEntry.mockResolvedValue(detail({}, { anything: { goes: true } }, "SPELL_EFFECT", 99));
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
    const presenter = await screen.findByTestId("reference-presenter");
    expect(presenter).toHaveAttribute("data-presenter", "generic");
    expect(presenter).toHaveTextContent("Schema version 99 is not a version the catalog supports for SPELL_EFFECT; it is shown exactly as stored and never migrated on view.");
    expect(presenter).toHaveTextContent(/Goes\s*true/);
  });

  it("M6-I010 generic content is labelled generic — no Definition kind is inferred from its name or text", async () => {
    client.getEntry.mockResolvedValue({ ...detail({}, null), entity: { id: "g1", canonicalKey: "test.spell_effect_lookalike", entityType: "GENERIC_RULE" } });
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="g1" />);
    expect(await screen.findByTestId("reference-entry-header")).toHaveTextContent("Generic / non-Prowess Entity");
    expect(screen.getByTestId("reference-entry-header")).not.toHaveTextContent("Spell Effect");
    expect(screen.getByTestId("reference-presenter")).toHaveTextContent("no Definition kind is shown or inferred");
  });
});

describe("M6-WO2 entry page — exact references and related content (M6-I016)", () => {
  const mismatch = { path: "payload.rules.pairsWith", authored: ref("e2", "v2b"), authoredRevisionNumber: 2, authoredDisplayName: "Piercing", inRelease: true, pinned: { entityVersionId: "v2a", revisionNumber: 1, displayName: "Piercing" }, matchesPin: false };
  const absent = { path: "payload.rules.other", authored: ref("e9", "v9"), authoredRevisionNumber: 4, authoredDisplayName: "Gone", inRelease: false, pinned: null, matchesPin: false };

  it("shows authored vs pinned revisions without rewriting, keeps Release context, and states absence plainly", async () => {
    client.getEntry.mockResolvedValue(detail({ references: [mismatch, absent] }, { ...EFFECT_PAYLOAD, rules: { pairsWith: mismatch.authored, other: absent.authored } }));
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
    const list = await screen.findByRole("list", { name: "Referenced Definitions" });
    expect(within(list).getByTestId("reference-mismatch")).toHaveTextContent("Version mismatch: the authored reference names Revision 2; this Release pins Revision 1.");
    expect(within(list).getAllByRole("link", { name: "Piercing" })[0]).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel1/entities/e2");
    expect(within(list).getByRole("link", { name: "Compare revisions" })).toHaveAttribute("href", "/compendium/entities/e2?compareA=1&compareB=2");
    expect(within(list).getByTestId("reference-absent")).toHaveTextContent("Referenced Definition is not part of this Release.");
    // The same exact references render inline, in place, inside the structured data.
    expect(within(screen.getByTestId("reference-presenter")).getAllByText(/Referenced Definition is not part of this Release/)).toHaveLength(1);
  });

  it("Referenced By, Relationships (no inferred inverse) and Related by Keyword are labelled and stay in this Release", async () => {
    client.getEntry.mockResolvedValue(
      detail(
        {
          referencedBy: [card("e3", "Piercing Trait")],
          relatedByKeyword: [card("e4", "Gust")],
          relationships: [
            { relationship: { id: "r1", sourceEntityId: "e1", targetEntityId: "e5", relationshipType: "REQUIRES", metadata: {} }, direction: "OUTGOING", counterpart: { id: "e5", canonicalKey: "test.e5", entityType: "GENERIC_RULE" }, counterpartPin: null },
          ],
          sources: [{ reference: { id: "s1", sourceDocumentId: "d1", entityVersionId: "v3", sectionLabel: "Movement", pageReference: "14", sourceExcerptNote: null, createdAt: "" }, document: { id: "d1", title: "Playtest Rules", sourceType: "DOCUMENT", versionLabel: "0.1", authorityStatus: "PRIMARY" } }],
        },
        EFFECT_PAYLOAD,
      ),
    );
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
    expect(within(await screen.findByRole("list", { name: "Referenced By" })).getByRole("link", { name: "Piercing Trait" })).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel1/entities/e3");
    expect(within(screen.getByRole("list", { name: "Related by Keyword" })).getByRole("link", { name: "Gust" })).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel1/entities/e4");
    expect(screen.getByText(/Sharing a Keyword is not a rules relationship/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Outgoing relationships" })).toHaveTextContent("test.e5 (not part of this Release)");
    expect(screen.queryByRole("list", { name: "Incoming relationships" })).toBeNull();
    expect(screen.getByRole("list", { name: "Sources" })).toHaveTextContent("Playtest Rules (0.1) — Movement, p. 14");
    expect(screen.getByText(/it never changes which revision this Release pins/)).toBeInTheDocument();
  });

  it("an Entity the Release does not pin gets an explicit not-in-Release state (no fallback to another revision)", async () => {
    client.getEntry.mockRejectedValue(new ReferenceApiError("COMPENDIUM_REFERENCE.ENTITY_NOT_IN_RELEASE", "Entity e7 is not part of Release 3 (0.3.0)", 404));
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e7" />);
    expect(await screen.findByTestId("reference-not-in-release")).toHaveTextContent("Entity e7 is not part of Release 3 (0.3.0)");
    expect(screen.getByRole("link", { name: "Back to this Release" })).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel1");
  });

  it("other errors show the server's message and code with a retry", async () => {
    client.getEntry.mockRejectedValueOnce(new ReferenceApiError("COMPENDIUM_REFERENCE.RELEASE_NOT_IN_RULESET", "Release 3 belongs to a different Ruleset", 404)).mockResolvedValue(detail({}, EFFECT_PAYLOAD));
    render(<EntryDetailView rulesetId={RS} releaseId={REL} entityId="e1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Release 3 belongs to a different Ruleset (COMPENDIUM_REFERENCE.RELEASE_NOT_IN_RULESET)");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Force Push" })).toBeInTheDocument();
  });
});

describe("M6-WO2 Release browser — selection, integrity and server-side facets (M6-I014, M6-I017, M6-I019)", () => {
  it("shows Release metadata and verification from the server; options name number, label, channel and date", async () => {
    render(<ReleaseBrowser rulesetId={RS} releaseId={REL} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Release 3 — 0.3.0" })).toBeInTheDocument();
    expect(screen.getByTestId("reference-integrity")).toHaveTextContent("Manifest verified");
    expect(screen.getByRole("option", { name: "Release 3 — 0.3.0 · Core Playtest · 2026-10-01" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Release"), { target: { value: "rel0" } });
    expect(nav.push).toHaveBeenCalledWith("/compendium/rulesets/rs1/releases/rel0");
    const cards = await screen.findAllByTestId("reference-card");
    expect(within(cards[0]!).getByRole("link", { name: "Force Push" })).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel1/entities/e1");
    expect(cards[1]).toHaveTextContent("Generic / non-Prowess Entity");
    fireEvent.change(screen.getByLabelText("Compare with"), { target: { value: "rel0" } });
    expect(nav.push).toHaveBeenCalledWith("/compendium/rulesets/rs1/releases/rel1/compare/rel0");
  });

  it("a failed manifest verification is a serious, announced warning", async () => {
    client.getRelease.mockResolvedValue({ ...RELEASE_DETAIL, verification: { valid: false, storedHash: "a".repeat(64), computedHash: "b".repeat(64) } });
    render(<ReleaseBrowser rulesetId={RS} releaseId={REL} />);
    const warning = await screen.findByTestId("reference-integrity");
    expect(warning).toHaveAttribute("role", "alert");
    expect(warning).toHaveTextContent("Integrity warning: this Release's manifest does not match its stored hash.");
  });

  it("facets come from the URL and go to the server unchanged; changing one writes the URL and resets the page", async () => {
    nav.params = new URLSearchParams("kind=SPELL_EFFECT&family=SPELL&keywordId=k1&keywordLabel=Control&page=2");
    render(<ReleaseBrowser rulesetId={RS} releaseId={REL} />);
    await waitFor(() => expect(client.listEntries).toHaveBeenCalledWith(RS, REL, expect.objectContaining({ page: 2, pageSize: 24, kind: "SPELL_EFFECT", family: "SPELL", keywordId: "k1" })));
    expect(await screen.findByRole("button", { name: "Clear Keyword filter Control" })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Entity type"), { target: { value: "SPELL_TRAIT" } });
    expect(nav.push).toHaveBeenCalledWith("/compendium/rulesets/rs1/releases/rel1?kind=SPELL_EFFECT&family=SPELL&entityType=SPELL_TRAIT&keywordId=k1&keywordLabel=Control");
    // Kind options are the catalog's (plus Generic), never a hand-written list.
    const kindSelect = screen.getByLabelText("Kind") as HTMLSelectElement;
    expect([...kindSelect.options].map((o) => o.value)).toEqual(["", "GENERIC", ...CATALOG.kinds.map((k) => k.definitionKind)]);
  });

  it("an empty filtered result has its own state, distinct from loading and error", async () => {
    nav.params = new URLSearchParams("search=zzz");
    client.listEntries.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 0 } });
    render(<ReleaseBrowser rulesetId={RS} releaseId={REL} />);
    expect(await screen.findByText("No entries in this Release match these filters")).toBeInTheDocument();
  });

  it("View Latest Release resolves on the server on click and navigates to that EXACT Release URL", async () => {
    client.resolveLatestRelease.mockResolvedValue({ ruleset: RELEASE_DETAIL.ruleset, release: { ...RELEASE, id: "rel9", releaseNumber: 9 } });
    render(<ReleaseBrowser rulesetId={RS} releaseId={REL} />);
    expect(client.resolveLatestRelease).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "View Latest Release" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/compendium/rulesets/rs1/releases/rel9"));
    expect(client.resolveLatestRelease).toHaveBeenCalledTimes(1);
  });
});

describe("M6-WO2 Ruleset history and comparison (M6-I017, M6-I018)", () => {
  it("a Ruleset without Releases says so and links to the Canon Manager and the Entity Library — no fallback", async () => {
    client.listReleases.mockResolvedValue({ ruleset: RELEASE_DETAIL.ruleset, releases: [] });
    render(<RulesetReference rulesetId={RS} />);
    const empty = await screen.findByTestId("reference-no-releases");
    expect(within(empty).getByRole("link", { name: "Open this Ruleset in the Canon Manager" })).toHaveAttribute("href", "/developer/rulesets/rs1");
    expect(within(empty).getByRole("link", { name: "Browse the Entity Library" })).toHaveAttribute("href", "/compendium");
    expect(client.resolveLatestRelease).not.toHaveBeenCalled();
  });

  it("Release History lists every Release newest first, each by its exact URL", async () => {
    render(<RulesetReference rulesetId={RS} />);
    const rows = await screen.findAllByTestId("reference-release-row");
    expect(rows.map((r) => within(r).getByRole("link").getAttribute("href"))).toEqual(["/compendium/rulesets/rs1/releases/rel1", "/compendium/rulesets/rs1/releases/rel0"]);
  });

  it("comparison shows the composition counts and links CHANGED revisions to the existing revision comparison", async () => {
    client.compareReleases.mockResolvedValue({
      releaseA: { ...RELEASE, id: "rel0", releaseNumber: 2, versionLabel: "0.2.0" },
      releaseB: RELEASE,
      counts: { added: 1, removed: 1, changed: 1, unchanged: 7 },
      entries: [
        { type: "CHANGED_VERSION", entityId: "e1", canonicalKey: "spell.effect.force_push", from: { entityVersionId: "v1", revisionNumber: 1, displayName: "Force Push" }, to: { entityVersionId: "v3", revisionNumber: 3, displayName: "Force Push" } },
        { type: "REMOVED_ENTITY", entityId: "e8", canonicalKey: "test.e8", from: { entityVersionId: "v8", revisionNumber: 2, displayName: "Retired" }, to: null },
        { type: "ADDED_ENTITY", entityId: "e9", canonicalKey: "test.e9", from: null, to: { entityVersionId: "v9", revisionNumber: 1, displayName: "New" } },
      ],
      total: 3,
      page: 1,
      pageSize: 50,
    });
    render(<ComparisonView rulesetId={RS} releaseId="rel0" otherReleaseId={REL} />);
    expect(await screen.findByTestId("reference-comparison-counts")).toHaveTextContent("1 added · 1 removed · 1 changed revision · 7 unchanged");
    const [changed, removed, added] = screen.getAllByTestId("reference-comparison-entry");
    expect(within(changed!).getByRole("link", { name: "Compare revisions" })).toHaveAttribute("href", "/compendium/entities/e1?compareA=1&compareB=3");
    expect(within(removed!).getByRole("link", { name: "Revision 2" })).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel0/entities/e8");
    expect(within(added!).getByRole("link", { name: "Revision 1" })).toHaveAttribute("href", "/compendium/rulesets/rs1/releases/rel1/entities/e9");
    fireEvent.click(screen.getByRole("button", { name: "Added" }));
    expect(nav.push).toHaveBeenCalledWith(`${nav.pathname}?type=ADDED_ENTITY`);
  });
});
