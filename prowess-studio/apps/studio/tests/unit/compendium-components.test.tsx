import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AliasList } from "../../app/compendium/_components/AliasList";
import { EntityFilters, type EntityFiltersValue } from "../../app/compendium/_components/EntityFilters";
import { EntityListRow } from "../../app/compendium/_components/EntityListRow";
import { ErrorState } from "../../app/compendium/_components/ErrorState";
import { IdentitySection } from "../../app/compendium/_components/IdentitySection";
import { KeywordSection } from "../../app/compendium/_components/KeywordSection";
import { RevisionSection } from "../../app/compendium/_components/RevisionSection";
import { RelationshipSection } from "../../app/compendium/_components/RelationshipSection";
import { SourceReferenceSection } from "../../app/compendium/_components/SourceReferenceSection";
import type {
  EntityDto,
  EntityListItemDto,
  EntityVersionDto,
  KeywordAssignmentDto,
  RelationshipWithCounterpartDto,
  SourceDocumentDto,
  SourceReferenceDto,
} from "../../app/compendium/_lib/api-client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const baseEntity: EntityDto = {
  id: "11111111-1111-4111-8111-111111111111",
  entityType: "SPELL_EFFECT",
  canonicalKey: "test.spell.effect.direct",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const baseVersion: EntityVersionDto = {
  id: "22222222-2222-4222-8222-222222222222",
  entityId: baseEntity.id,
  revisionNumber: 3,
  status: "DRAFT",
  displayName: "Direct Damage",
  shortDescription: "A short description.",
  rulesText: "The rules text.",
  structuredData: { value: 10 },
  parentVersionId: null,
  changeType: null,
  changeSummary: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
};

describe("EntityListRow", () => {
  it("renders the displayName, canonical key, type, revision number, and status when a latestRevision exists", () => {
    const item: EntityListItemDto = {
      entity: baseEntity,
      latestRevision: {
        id: baseVersion.id,
        revisionNumber: 3,
        status: "DRAFT",
        displayName: "Direct Damage",
      },
    };
    render(
      <ul>
        <EntityListRow item={item} />
      </ul>,
    );

    const row = screen.getByTestId("entity-row");
    expect(within(row).getByText("Direct Damage")).toBeInTheDocument();
    expect(within(row).getByText("test.spell.effect.direct")).toBeInTheDocument();
    expect(within(row).getByText("Spell Effect")).toBeInTheDocument();
    expect(within(row).getByText(/Latest Revision 3/)).toBeInTheDocument();
    expect(within(row).getByText("Draft")).toBeInTheDocument();
  });

  it("uses the mandatory 'Latest Revision' terminology, never current/active/Canon", () => {
    const item: EntityListItemDto = {
      entity: baseEntity,
      latestRevision: { id: baseVersion.id, revisionNumber: 1, status: "CANON", displayName: "X" },
    };
    render(
      <ul>
        <EntityListRow item={item} />
      </ul>,
    );
    const row = screen.getByTestId("entity-row");
    expect(row.textContent).toMatch(/Latest Revision/);
    expect(row.textContent).not.toMatch(/Current Version|Current Rule|Active Version|Canon Version/);
  });

  it("shows canonical key as the primary label and an explicit 'No revisions' state when there is no Version", () => {
    const item: EntityListItemDto = { entity: baseEntity, latestRevision: null };
    render(
      <ul>
        <EntityListRow item={item} />
      </ul>,
    );
    const row = screen.getByTestId("entity-row");
    expect(within(row).getByTestId("no-revisions-label")).toHaveTextContent("No revisions");
    // The canonical key appears as the fallback label — never a fabricated name.
    expect(within(row).getAllByText("test.spell.effect.direct").length).toBeGreaterThan(0);
  });

  it("links to the Entity's own detail page with a real, keyboard-accessible link", () => {
    const item: EntityListItemDto = { entity: baseEntity, latestRevision: null };
    render(
      <ul>
        <EntityListRow item={item} />
      </ul>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/compendium/entities/${baseEntity.id}`);
  });
});

describe("EntityFilters", () => {
  it("renders labeled search and filter controls reflecting the current value", () => {
    const value: EntityFiltersValue = {
      search: "damage",
      entityType: "SPELL_EFFECT",
      status: "DRAFT",
      canonicalKey: "",
      keyword: "",
    };
    render(<EntityFilters value={value} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Search")).toHaveValue("damage");
    expect(screen.getByLabelText("Entity Type")).toHaveValue("SPELL_EFFECT");
    expect(screen.getByLabelText("Latest Revision Status")).toHaveValue("DRAFT");
    expect(screen.getByLabelText("Canonical Key (exact)")).toHaveValue("");
  });

  it("calls onChange with the updated value when a filter changes, preserving the rest", () => {
    const onChange = vi.fn();
    const value: EntityFiltersValue = {
      search: "",
      entityType: "",
      status: "",
      canonicalKey: "",
      keyword: "",
    };
    render(<EntityFilters value={value} onChange={onChange} />);

    screen.getByLabelText("Entity Type").dispatchEvent(new Event("focus", { bubbles: true }));
    (screen.getByLabelText("Entity Type") as HTMLSelectElement).value = "SPELL_EFFECT";
    screen.getByLabelText("Entity Type").dispatchEvent(new Event("change", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ entityType: "SPELL_EFFECT" }));
  });

  it("documents the search scope and the Entity-level-only keyword filter scope accurately", () => {
    const value: EntityFiltersValue = { search: "", entityType: "", status: "", canonicalKey: "", keyword: "" };
    render(<EntityFilters value={value} onChange={vi.fn()} />);
    expect(screen.getByText(/aliases and EntityVersion display names/i)).toBeInTheDocument();
    expect(screen.getByText(/Entity-level Keyword assignments only/i)).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders the given safe message and an alert role, with an optional retry action", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Could not reach the server." onRetry={onRetry} />);
    const state = screen.getByTestId("error-state");
    expect(state).toHaveAttribute("role", "alert");
    expect(state).toHaveTextContent("Could not reach the server.");
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalled();
  });

  it("never fabricates detail beyond the provided message (no raw HTTP/Prisma text)", () => {
    render(<ErrorState message="Entity not found: abc" />);
    const text = screen.getByTestId("error-state").textContent ?? "";
    expect(text.toLowerCase()).not.toContain("prisma");
    expect(text).not.toMatch(/P2\d{3}/);
  });
});

describe("Identity vs Latest Revision content separation", () => {
  it("IdentitySection shows only stable identity fields, never versioned content", () => {
    render(<IdentitySection entity={baseEntity} />);
    const section = screen.getByTestId("identity-section");
    expect(within(section).getByText("test.spell.effect.direct")).toBeInTheDocument();
    expect(within(section).getByText("Spell Effect")).toBeInTheDocument();
    expect(section.textContent).not.toContain("Direct Damage"); // the Version's displayName
  });

  it("RevisionSection is titled exactly 'Latest Revision' and shows versioned content", () => {
    render(<RevisionSection version={baseVersion} versionCount={3} isLatest />);
    expect(screen.getByRole("heading", { name: "Latest Revision" })).toBeInTheDocument();
    const section = screen.getByTestId("latest-revision-section");
    expect(within(section).getByText("Direct Damage")).toBeInTheDocument();
    expect(within(section).getByText("Versions: 3")).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/Current Version|Canon Version|Active Version/);
  });

  it("RevisionSection shows an intentional empty state when there is no Version", () => {
    render(<RevisionSection version={null} versionCount={0} isLatest />);
    expect(screen.getByText("No revisions")).toBeInTheDocument();
  });
});

describe("AliasList", () => {
  it("renders aliases with optional context, or an empty state when none exist", () => {
    render(
      <AliasList
        aliases={[
          { id: "a1", entityId: "e1", alias: "Old Name", normalizedAlias: "old name", context: "Legacy", createdAt: "" },
        ]}
      />,
    );
    expect(screen.getByText("Old Name")).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });

  it("shows 'No aliases' when the list is empty", () => {
    render(<AliasList aliases={[]} />);
    expect(screen.getByText("No aliases")).toBeInTheDocument();
  });
});

describe("Entity Keywords vs Latest Revision Keywords", () => {
  const keywordAssignment: KeywordAssignmentDto = {
    keyword: { id: "k1", canonicalKey: "test.keyword.fire", name: "Fire", categoryId: null, description: null, deprecated: false, createdAt: "" },
    sourceType: "AUTHORED",
    createdAt: "",
  };

  it("renders two visually and semantically distinct sections, never merged", () => {
    render(
      <>
        <KeywordSection
          heading="Entity Keywords"
          headingId="entity-kw"
          assignments={[keywordAssignment]}
          emptyLabel="No Entity Keywords"
        />
        <KeywordSection
          heading="Latest Revision Keywords"
          headingId="version-kw"
          assignments={[]}
          emptyLabel="No Latest Revision Keywords"
        />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Entity Keywords" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Latest Revision Keywords" })).toBeInTheDocument();
    expect(screen.getByText("Fire")).toBeInTheDocument();
    expect(screen.getByText("No Latest Revision Keywords")).toBeInTheDocument();
  });
});

describe("Incoming vs Outgoing Relationships", () => {
  const relationship: RelationshipWithCounterpartDto = {
    relationship: {
      id: "r1",
      sourceEntityId: "e1",
      targetEntityId: "e2",
      relationshipType: "REQUIRES",
      metadata: {},
      createdAt: "",
    },
    counterpart: { ...baseEntity, id: "e2", canonicalKey: "test.counterpart" },
  };

  it("renders Outgoing and Incoming as separate sections, never auto-inventing an inverse", () => {
    render(
      <>
        <RelationshipSection
          heading="Outgoing Relationships"
          headingId="outgoing"
          relationships={[relationship]}
          emptyLabel="No outgoing relationships"
        />
        <RelationshipSection
          heading="Incoming Relationships"
          headingId="incoming"
          relationships={[]}
          emptyLabel="No incoming relationships"
        />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Outgoing Relationships" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Incoming Relationships" })).toBeInTheDocument();
    expect(screen.getByText("Requires")).toBeInTheDocument();
    expect(screen.getByText("test.counterpart")).toBeInTheDocument();
    expect(screen.getByText("No incoming relationships")).toBeInTheDocument();
  });

  it("links the counterpart to its own Entity detail page", () => {
    render(
      <RelationshipSection
        heading="Outgoing Relationships"
        headingId="outgoing"
        relationships={[relationship]}
        emptyLabel="No outgoing relationships"
      />,
    );
    expect(screen.getByRole("link", { name: "test.counterpart" })).toHaveAttribute(
      "href",
      "/compendium/entities/e2",
    );
  });
});

describe("Source provenance presentation", () => {
  const sourceDoc: SourceDocumentDto = {
    id: "doc1",
    title: "Test Spellcasting Source",
    sourceType: "DOCUMENT",
    versionLabel: "v1",
    authorityStatus: "GOVERNING",
    fileReference: "project-file:test-spellcasting",
    notes: null,
    createdAt: "",
  };
  const sourceRef: SourceReferenceDto = {
    id: "ref1",
    sourceDocumentId: "doc1",
    entityVersionId: "v1",
    sectionLabel: "Direct Damage",
    pageReference: "14-16",
    sourceExcerptNote: null,
    createdAt: "",
  };

  it("shows the document title, type, authority status (descriptive-only note), section, and page", () => {
    render(
      <SourceReferenceSection references={[sourceRef]} documents={new Map([["doc1", sourceDoc]])} />,
    );
    expect(screen.getByText(/Test Spellcasting Source/)).toBeInTheDocument();
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByText("Governing")).toBeInTheDocument();
    expect(screen.getByText(/does not control an active Ruleset/)).toBeInTheDocument();
    expect(screen.getByText("Direct Damage")).toBeInTheDocument();
    expect(screen.getByText("14-16")).toBeInTheDocument();
  });

  it("labels file_reference as an opaque reference, never attempting to open it", () => {
    render(
      <SourceReferenceSection references={[sourceRef]} documents={new Map([["doc1", sourceDoc]])} />,
    );
    expect(screen.getByText("project-file:test-spellcasting")).toBeInTheDocument();
    expect(screen.getByText(/opaque reference/)).toBeInTheDocument();
  });

  it("shows 'No sources' when there are none", () => {
    render(<SourceReferenceSection references={[]} documents={new Map()} />);
    expect(screen.getByText("No sources")).toBeInTheDocument();
  });
});
