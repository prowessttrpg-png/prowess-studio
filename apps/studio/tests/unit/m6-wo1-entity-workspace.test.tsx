import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityVersionDto } from "../../app/compendium/_lib/api-client";

/**
 * PAS-10 M6-WO1 §21–24, §28–29, §39, §41, §65 — the Entity workspace: identity, revision history with Create New
 * Revision and links into the EXISTING Version History / comparison, aliases, Entity-level Keywords and relationships,
 * each through its existing M1 endpoint (client mocked). Error states surface the server's code; generic content is
 * labelled generic, never guessed into a Definition kind (M6-I010).
 */
const client = vi.hoisted(() => ({
  getEntity: vi.fn(),
  listVersions: vi.fn(),
  listAliases: vi.fn(),
  listEntityKeywords: vi.fn(),
  listRelationships: vi.fn(),
  createAlias: vi.fn(),
  removeAlias: vi.fn(),
  assignEntityKeyword: vi.fn(),
  removeEntityKeyword: vi.fn(),
  createRelationship: vi.fn(),
  removeRelationship: vi.fn(),
  createRevision: vi.fn(),
  searchEntities: vi.fn(),
  searchKeywords: vi.fn(),
  searchDefinitionReferences: vi.fn(),
}));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/compendium/admin" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { EntityWorkspace } = await import("../../app/compendium/admin/_components/EntityWorkspace");
const { AuthoringApiError } = await import("../../app/compendium/admin/_lib/authoring-client");

const ENTITY = { id: "e1", entityType: "SPELL_EFFECT", canonicalKey: "spell.effect.m6_test_force_push", createdAt: "", updatedAt: "" };
const def = { prowessDefinition: { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_EFFECT", payload: {} } };
const version = (n: number, status: string, structuredData: unknown = def): EntityVersionDto => ({
  id: `v${n}`, entityId: "e1", revisionNumber: n, status, displayName: `Force Push r${n}`, shortDescription: null, rulesText: null, structuredData,
  parentVersionId: n > 1 ? `v${n - 1}` : null, changeType: null, changeSummary: n === 2 ? "Updated Radius scaling." : null, createdAt: "", updatedAt: "",
});
const keyword = (id: string, name: string) => ({ keyword: { id, canonicalKey: `keyword.${id}`, name, categoryId: null, description: null, deprecated: false, createdAt: "" }, sourceType: "AUTHORED" });

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  nav.push.mockReset();
  client.getEntity.mockResolvedValue(ENTITY);
  client.listVersions.mockResolvedValue([version(1, "APPROVED"), version(2, "DRAFT")]);
  client.listAliases.mockResolvedValue([{ id: "a1", alias: "Shove", context: "playtest" }]);
  client.listEntityKeywords.mockResolvedValue([keyword("k1", "Control")]);
  client.listRelationships.mockResolvedValue({
    outgoing: [{ relationship: { id: "r1", sourceEntityId: "e1", targetEntityId: "e9", relationshipType: "REQUIRES", metadata: { note: "x" } }, counterpart: { ...ENTITY, id: "e9", canonicalKey: "spell.targeting.single_target" } }],
    incoming: [],
  });
  client.searchKeywords.mockResolvedValue([]);
  client.searchEntities.mockResolvedValue([]);
});

describe("M6-WO1 Entity workspace", () => {
  it("§21 / §39 shows identity and history: Edit Draft vs read-only View, Version History and comparison links, change metadata", async () => {
    render(<EntityWorkspace entityId="e1" />);
    const revisions = await screen.findAllByTestId("authoring-revision");
    expect(revisions).toHaveLength(2);
    expect(within(revisions[0]!).getByRole("link", { name: "Edit Draft (Revision 2)" })).toHaveAttribute("href", "/compendium/admin/entities/e1/revisions/v2");
    expect(within(revisions[0]!).getByText("Updated Radius scaling.")).toBeInTheDocument();
    expect(within(revisions[0]!).getByRole("link", { name: "Compare with previous revision" })).toHaveAttribute("href", "/compendium/entities/e1?compareA=1&compareB=2");
    expect(within(revisions[1]!).getByRole("link", { name: "View Revision 1" })).toBeInTheDocument();
    expect(within(revisions[1]!).getByRole("link", { name: "Version History" })).toHaveAttribute("href", "/compendium/entities/e1?revision=1");
    expect(screen.getAllByText("SPELL_EFFECT").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /delete entity/i })).toBeNull();
  });

  it("§22 Create New Revision sends only the base revision and change summary — the server allocates the number", async () => {
    client.createRevision.mockResolvedValue(version(3, "DRAFT"));
    render(<EntityWorkspace entityId="e1" />);
    fireEvent.change(await screen.findByLabelText("Change summary (why this revision exists)"), { target: { value: "Third pass." } });
    fireEvent.click(screen.getByRole("button", { name: "Create New Revision from Revision 2" }));
    await waitFor(() => expect(client.createRevision).toHaveBeenCalledWith("e1", { baseVersionId: "v2", changeSummary: "Third pass." }));
    expect(nav.push).toHaveBeenCalledWith("/compendium/admin/entities/e1/revisions/v3");
  });

  it("§28 aliases: list with context, create with optional context, remove — through the M1 alias endpoints", async () => {
    client.createAlias.mockResolvedValue({});
    client.removeAlias.mockResolvedValue(undefined);
    render(<EntityWorkspace entityId="e1" />);
    const list = await screen.findByRole("list", { name: "Aliases" });
    expect(list).toHaveTextContent("Shove");
    expect(list).toHaveTextContent("context: playtest");
    fireEvent.change(screen.getByLabelText("Alias"), { target: { value: "Telekinetic Push" } });
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    await waitFor(() => expect(client.createAlias).toHaveBeenCalledWith("e1", "Telekinetic Push", null));
    fireEvent.click(screen.getByRole("button", { name: "Remove alias Shove" }));
    await waitFor(() => expect(client.removeAlias).toHaveBeenCalledWith("a1"));
  });

  it("§26 Entity-level Keywords are assigned by Keyword id from the vocabulary search, and removed", async () => {
    client.searchKeywords.mockResolvedValue([{ id: "k2", canonicalKey: "keyword.forced_movement", name: "Forced Movement", deprecated: false }]);
    client.assignEntityKeyword.mockResolvedValue({});
    client.removeEntityKeyword.mockResolvedValue(undefined);
    render(<EntityWorkspace entityId="e1" />);
    expect(await screen.findByRole("list", { name: "Entity-level Keywords" })).toHaveTextContent("Control");
    fireEvent.change(screen.getByLabelText("Assign an Entity-level Keyword"), { target: { value: "Forced" } });
    fireEvent.click(await screen.findByRole("button", { name: /Forced Movement/ }));
    await waitFor(() => expect(client.assignEntityKeyword).toHaveBeenCalledWith("e1", "k2"));
    fireEvent.click(screen.getByRole("button", { name: "Remove Entity-level Keyword Control" }));
    await waitFor(() => expect(client.removeEntityKeyword).toHaveBeenCalledWith("e1", "k1"));
  });

  it("§29 relationships show source, type, target and metadata; a new one is exactly what was authored (no inverse)", async () => {
    client.searchEntities.mockResolvedValue([{ entity: { ...ENTITY, id: "e7", canonicalKey: "spell.trait.piercing" }, latestRevision: { displayName: "Piercing" } }]);
    client.createRelationship.mockResolvedValue({});
    render(<EntityWorkspace entityId="e1" />);
    const outgoing = await screen.findByRole("list", { name: "Outgoing relationships" });
    expect(outgoing).toHaveTextContent("spell.effect.m6_test_force_push");
    expect(outgoing).toHaveTextContent("Requires");
    expect(outgoing).toHaveTextContent("spell.targeting.single_target");
    expect(outgoing).toHaveTextContent('"note": "x"');
    fireEvent.change(screen.getByLabelText("Relationship type"), { target: { value: "COMPATIBLE_WITH" } });
    fireEvent.change(screen.getByLabelText(/^Target Entity/), { target: { value: "Pier" } });
    fireEvent.click(await screen.findByRole("button", { name: /Piercing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add relationship" }));
    await waitFor(() => expect(client.createRelationship).toHaveBeenCalledTimes(1));
    expect(client.createRelationship).toHaveBeenCalledWith({ sourceEntityId: "e1", targetEntityId: "e7", relationshipType: "COMPATIBLE_WITH", metadata: {} });
  });

  it("error states show the server's message and code, without losing the page", async () => {
    client.createAlias.mockRejectedValue(new AuthoringApiError("ENTITY_ALIAS.DUPLICATE", "Alias already exists", 409));
    render(<EntityWorkspace entityId="e1" />);
    fireEvent.change(await screen.findByLabelText("Alias"), { target: { value: "Shove" } });
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Alias already exists (ENTITY_ALIAS.DUPLICATE)");
    expect(screen.getByRole("heading", { level: 2, name: "Identity" })).toBeInTheDocument();
  });

  it("M6-I010 §41 generic content is labelled generic, never guessed into a Definition kind", async () => {
    client.getEntity.mockResolvedValue({ ...ENTITY, entityType: "GENERIC_RULE", canonicalKey: "test.spell_effect_lookalike" });
    client.listVersions.mockResolvedValue([version(1, "DRAFT", { summary: "Fire damage Spell Effect" })]);
    render(<EntityWorkspace entityId="e1" />);
    expect((await screen.findAllByText("Generic / non-Prowess Entity")).length).toBeGreaterThan(0);
    expect(screen.getByText(/None — generic content/)).toBeInTheDocument();
  });
});
