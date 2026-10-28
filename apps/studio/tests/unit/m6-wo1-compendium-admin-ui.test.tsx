import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityVersionDto } from "../../app/compendium/_lib/api-client";
import { DefinitionEditor } from "../../app/compendium/admin/_components/DefinitionEditor";
import { ValidationPanel } from "../../app/compendium/admin/_components/ValidationPanel";
import { AuthoredDataEditor } from "../../app/compendium/admin/_components/AuthoredDataEditor";
import { newCandidate, type DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { CONTRACT_DESCRIPTORS } from "../../app/compendium/admin/_lib/descriptors";
import { UNSAVED_CHANGES_MESSAGE, useUnsavedChangesGuard } from "../../app/compendium/admin/_lib/use-navigation-guard";
import { CATALOG, issue, kindRow } from "./m6-wo1-fixtures";

/**
 * PAS-10 M6-WO1 — Compendium Admin UI (§12–13, §16–20, §27, §42–47, §57, §67). The authoring client is mocked: these
 * tests prove presentation behavior (structured fields, read-only history, dirty state, accessible validation,
 * explicit save with optimistic protection, no autosave), never mechanics.
 */
const client = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  getEntity: vi.fn(),
  getVersion: vi.fn(),
  listVersionKeywords: vi.fn(),
  listVersionSources: vi.fn(),
  listSourceDocuments: vi.fn(),
  validateStoredRevision: vi.fn(),
  validateCandidate: vi.fn(),
  saveDraft: vi.fn(),
  createRevision: vi.fn(),
  createDefinition: vi.fn(),
  listDefinitions: vi.fn(),
  submitForReview: vi.fn(),
  returnToDraft: vi.fn(),
  proposeChangeSet: vi.fn(),
  listAllRulesets: vi.fn(),
  listManifests: vi.fn(),
  searchKeywords: vi.fn(),
  searchDefinitionReferences: vi.fn(),
}));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => nav.params, usePathname: () => "/compendium/admin" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { RevisionWorkspace } = await import("../../app/compendium/admin/_components/RevisionWorkspace");
const { NewDefinitionForm } = await import("../../app/compendium/admin/_components/NewDefinitionForm");
const { AuthoringDashboard } = await import("../../app/compendium/admin/_components/AuthoringDashboard");

const ENTITY = { id: "e1", entityType: "SPELL_EFFECT", canonicalKey: "spell.effect.m6_test_force_push", createdAt: "", updatedAt: "" };
const PAYLOAD = { effectFamily: "MOVEMENT", keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {}, resolution: { mode: "SAVING_THROW", data: {} }, outcomes: [] };
const version = (over: Partial<EntityVersionDto> = {}): EntityVersionDto => ({
  id: "v1",
  entityId: "e1",
  revisionNumber: 1,
  status: "DRAFT",
  displayName: "Force Push",
  shortDescription: null,
  rulesText: null,
  structuredData: { prowessDefinition: { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_EFFECT", payload: PAYLOAD } },
  parentVersionId: null,
  changeType: null,
  changeSummary: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const PASS = { status: "PASS" as const, definitionKind: "SPELL_EFFECT", issues: [], normalized: null, refused: false };

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  nav.push.mockReset();
  nav.params = new URLSearchParams();
  client.getCatalog.mockResolvedValue(CATALOG);
  client.getEntity.mockResolvedValue(ENTITY);
  client.listVersionKeywords.mockResolvedValue([]);
  client.listVersionSources.mockResolvedValue([]);
  client.listSourceDocuments.mockResolvedValue([]);
  client.validateStoredRevision.mockResolvedValue(PASS);
  client.searchKeywords.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

function Editor({ kind, initial, issues = [], readOnly = false, onChange }: { kind: string; initial?: DefinitionCandidate; issues?: ReturnType<typeof issue>[]; readOnly?: boolean; onChange?: (c: DefinitionCandidate) => void }) {
  const row = kindRow(kind);
  const [c, setC] = useState<DefinitionCandidate>(initial ?? newCandidate(row));
  return (
    <DefinitionEditor
      kind={row}
      catalog={CATALOG}
      candidate={c}
      issues={issues}
      readOnly={readOnly}
      onChange={(next) => {
        setC(next);
        onChange?.(next);
      }}
    />
  );
}

describe("structured Definition editor (§12–13, §28)", () => {
  it("renders labelled structured fields for a SPELL_EFFECT with options from the catalog — not a JSON text box", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_EFFECT" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText("Effect family (required)"), { target: { value: "MOVEMENT" } });
    expect(changes.at(-1)?.payload.effectFamily).toBe("MOVEMENT");
    fireEvent.click(screen.getByLabelText("This Effect has its own resolution"));
    const mode = screen.getByLabelText("Resolution mode");
    expect([...(mode as HTMLSelectElement).options].map((o) => o.value).slice(1)).toEqual(CATALOG.vocabularies.resolutionModes);
    fireEvent.change(mode, { target: { value: "SAVING_THROW" } });
    expect(changes.at(-1)?.payload.resolution).toEqual({ mode: "SAVING_THROW", data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Add outcome" }));
    expect(changes.at(-1)?.payload.outcomes).toEqual([{ outcomeKey: "", data: {} }]);
    expect(screen.queryByRole("textbox", { name: /developer json/i })).toBeNull();
  });

  it("M6-I002 §57 a Targeting editor offers no Damage, Healing, Save or outcome field", () => {
    render(<Editor kind="SPELL_TARGETING" />);
    expect(screen.getByLabelText("Semantic shape (required)")).toBeInTheDocument();
    for (const name of [/Resolution/, /Outcome/, /Effect family/, /Damage/, /Save/]) expect(screen.queryByLabelText(name)).toBeNull();
    expect(screen.getByText(/never decides what happens/i)).toBeInTheDocument();
  });

  it("§47 associates server issues with their field (aria-invalid + aria-describedby) and keeps text labels", () => {
    render(<Editor kind="SPELL_EFFECT" issues={[issue("payload.effectFamily", { message: "effectFamily is an explicit SCREAMING_SNAKE token" })]} />);
    const input = screen.getByLabelText("Effect family (required)");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby")!.split(" ");
    const errors = describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(errors).toContain("effectFamily is an explicit SCREAMING_SNAKE token");
    expect(errors).toContain("Error:");
  });

  it("M6-I004 §17 a read-only revision disables every structured control", () => {
    render(<Editor kind="SPELL_EFFECT" readOnly />);
    expect(screen.getByLabelText("Effect family (required)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add outcome" })).toBeDisabled();
    expect(screen.queryByLabelText(/Enable developer JSON editing/)).toBeNull();
  });

  it("§12 raw JSON is read-only inspection unless developer editing is explicitly enabled; the kind cannot change through it", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_EFFECT" onChange={(c) => changes.push(c)} />);
    expect(screen.getByLabelText("Definition JSON (read-only)").tagName).toBe("PRE");
    fireEvent.click(screen.getByLabelText(/Enable developer JSON editing/));
    const box = screen.getByLabelText("Developer JSON");
    fireEvent.change(box, { target: { value: JSON.stringify({ ...newCandidate(kindRow("SPELL_EFFECT")), definitionKind: "SPELL_TRAIT" }) } });
    fireEvent.click(screen.getByRole("button", { name: "Apply JSON to the form" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The Definition kind stays SPELL_EFFECT.");
    expect(changes).toHaveLength(0);
  });

  it("§68 legacy terminology is chosen only from inventoried pairs and recorded as provenance", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_EFFECT" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText("Add an inventoried legacy term"), { target: { value: "Emission" } });
    expect(changes.at(-1)?.legacyTerms).toEqual([{ legacyTerm: "Emission", canonicalTerm: "Evocation" }]);
    expect(changes.at(-1)?.payload).toEqual(newCandidate(kindRow("SPELL_EFFECT")).payload);
  });
});

describe("M6-I009 payload Keywords (§22)", () => {
  it("are chosen from the Keyword vocabulary search and stored by exact canonical key", async () => {
    client.searchKeywords.mockResolvedValue([{ id: "k1", canonicalKey: "keyword.control", name: "Control", deprecated: false }]);
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_EFFECT" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText("Add a Definition Keyword"), { target: { value: "Cont" } });
    fireEvent.click(await screen.findByRole("button", { name: /Control — keyword\.control/ }));
    expect(changes.at(-1)?.payload.keywords).toEqual(["keyword.control"]);
    expect(client.searchKeywords).toHaveBeenCalledWith("Cont");
  });
});

describe("authored-data editor (opaque M5 data, edited as typed fields)", () => {
  it("adds named, typed fields and nests groups", () => {
    let value: Record<string, unknown> = {};
    function Host() {
      const [v, setV] = useState<Record<string, unknown>>({});
      return <AuthoredDataEditor value={v} onChange={(n) => { value = n; setV(n); }} label="Rules" />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add field to Rules" }));
    fireEvent.change(screen.getByLabelText("Rules: field name 1"), { target: { value: "feet" } });
    fireEvent.change(screen.getByLabelText("Rules.feet type"), { target: { value: "number" } });
    fireEvent.change(screen.getByLabelText("Rules.feet"), { target: { value: "15" } });
    expect(value).toEqual({ feet: 15 });
    fireEvent.click(screen.getByRole("button", { name: "Add field to Rules" }));
    fireEvent.change(screen.getByLabelText("Rules.field2 type"), { target: { value: "group" } });
    expect(value).toEqual({ feet: 15, field2: {} });
  });

  it("M6-I006 §30 a Definition-reference field stores the exact identity chosen in the picker, never a name", async () => {
    let value: Record<string, unknown> = {};
    const ref = { entityId: "e9", entityVersionId: "v9", canonicalKey: "spell.targeting.radius", definitionKind: "SPELL_TARGETING", systemFamily: "SPELL" };
    client.searchDefinitionReferences.mockResolvedValue([{ ref, displayName: "Radius", revisionNumber: 2, status: "APPROVED" }]);
    function Host() {
      const [v, setV] = useState<Record<string, unknown>>({ area: "" });
      return <AuthoredDataEditor value={v} onChange={(n) => { value = n; setV(n); }} label="Rules" />;
    }
    render(<Host />);
    fireEvent.change(screen.getByLabelText("Rules.area type"), { target: { value: "reference" } });
    fireEvent.click(screen.getByRole("button", { name: "Rules.area: choose Definition" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Radius" } });
    fireEvent.click(await screen.findByRole("button", { name: /Radius — spell\.targeting\.radius/ }));
    expect(value).toEqual({ area: ref });
  });
});

describe("validation summary (§15, §47)", () => {
  it("states PASS / FAIL in text and links each issue to its field", () => {
    const fields = CONTRACT_DESCRIPTORS.EFFECT!.fields;
    const { rerender } = render(<ValidationPanel result={PASS} stale={false} fields={fields} />);
    expect(screen.getByRole("status")).toHaveTextContent("PASS — SPELL_EFFECT satisfies its M5 structural contract.");
    rerender(
      <>
        <input id="definition-field-resolution" aria-label="target" />
        <ValidationPanel result={{ ...PASS, status: "FAIL", issues: [issue("payload.resolution.mode", { component: "resolution" })] }} stale fields={fields} />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("FAIL — SPELL_EFFECT has 1 error(s).");
    expect(screen.getByRole("status")).toHaveTextContent("validate again");
    fireEvent.click(screen.getByRole("link", { name: "payload.resolution.mode" }));
    expect(document.activeElement).toBe(screen.getByLabelText("target"));
  });
});

describe("revision workspace", () => {
  it("M6-I004 §17 an immutable revision is read-only, offers Create New Revision, and has no Save action", async () => {
    client.getVersion.mockResolvedValue(version({ status: "APPROVED" }));
    client.createRevision.mockResolvedValue(version({ id: "v2", revisionNumber: 2 }));
    render(<RevisionWorkspace entityId="e1" versionId="v1" />);
    expect(await screen.findByText(/is Approved and immutable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
    expect(screen.getByLabelText(/^Display Name/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create New Revision from Revision 1" }));
    await waitFor(() => expect(client.createRevision).toHaveBeenCalledWith("e1", { baseVersionId: "v1" }));
    expect(nav.push).toHaveBeenCalledWith("/compendium/admin/entities/e1/revisions/v2");
  });

  it("§19 / §42 tracks Saved Draft vs Unsaved Changes and saves only on the explicit action, with expectedUpdatedAt", async () => {
    client.getVersion.mockResolvedValue(version());
    client.saveDraft.mockImplementation(async (_id: string, body: { displayName: string }) => ({ version: version({ displayName: body.displayName, updatedAt: "2026-10-02T00:00:00.000Z" }), validation: PASS }));
    render(<RevisionWorkspace entityId="e1" versionId="v1" />);
    const name = await screen.findByLabelText(/^Display Name/);
    expect(screen.getAllByText("Saved Draft").length).toBeGreaterThan(0);
    fireEvent.change(name, { target: { value: "Force Push II" } });
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
    expect(client.saveDraft).not.toHaveBeenCalled(); // no autosave
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(client.saveDraft).toHaveBeenCalledTimes(1));
    expect(client.saveDraft.mock.calls[0]![1]).toMatchObject({ expectedUpdatedAt: "2026-10-01T00:00:00.000Z", displayName: "Force Push II", prowessDefinition: { definitionKind: "SPELL_EFFECT" } });
    expect(client.saveDraft.mock.calls[0]![1]).not.toHaveProperty("revisionNumber");
    expect(client.saveDraft.mock.calls[0]![1]).not.toHaveProperty("status");
    expect(await screen.findByText(/Draft saved — validation PASS/)).toBeInTheDocument();
  });

  it("§46 a stale save is reported and nothing is overwritten; the author can reload deliberately", async () => {
    client.getVersion.mockResolvedValue(version());
    const { AuthoringApiError } = await import("../../app/compendium/admin/_lib/authoring-client");
    client.saveDraft.mockRejectedValue(new AuthoringApiError("COMPENDIUM_AUTHORING.STALE_REVISION", "Revision 1 changed after it was loaded", 409));
    render(<RevisionWorkspace entityId="e1" versionId="v1" />);
    fireEvent.change(await screen.findByLabelText(/^Display Name/), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This Draft changed after you opened it");
    expect(alert).toHaveTextContent("COMPENDIUM_AUTHORING.STALE_REVISION");
    expect(within(alert).getByRole("button", { name: /Reload the saved Draft/ })).toBeInTheDocument();
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
  });

  it("M6-I007 §16 Validate does not save; a FAIL result moves focus to the validation summary", async () => {
    client.getVersion.mockResolvedValue(version());
    client.validateCandidate.mockResolvedValue({ ...PASS, status: "FAIL", issues: [issue("payload.resolution.mode")] });
    render(<RevisionWorkspace entityId="e1" versionId="v1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Validate Definition" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Validation" })));
    expect(client.saveDraft).not.toHaveBeenCalled();
  });

  it("M6-I010 §67 generic content shows as Generic / non-Prowess Entity with no Definition editor", async () => {
    client.getVersion.mockResolvedValue(version({ structuredData: { note: "Fire damage spell effect" } }));
    render(<RevisionWorkspace entityId="e1" versionId="v1" />);
    expect((await screen.findAllByText("Generic / non-Prowess Entity")).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Effect family (required)")).toBeNull();
    expect(client.validateStoredRevision).not.toHaveBeenCalled();
  });

  it("M6-I005 §33–34 the Canon hand-off needs an explicitly chosen Ruleset and only creates a ChangeSet proposal", async () => {
    client.getVersion.mockResolvedValue(version());
    client.listAllRulesets.mockResolvedValue([{ id: "r1", name: "Core Playtest", status: "APPROVED" }]);
    client.listManifests.mockResolvedValue({ items: [], pagination: null });
    client.proposeChangeSet.mockResolvedValue({ id: "cs1", rulesetId: "r1", status: "DRAFT", name: "Force Push — Revision 1" });
    render(<RevisionWorkspace entityId="e1" versionId="v1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose a Ruleset…" }));
    const create = await screen.findByRole("button", { name: "Create ChangeSet proposal" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ruleset (explicit authoring context)"), { target: { value: "r1" } });
    fireEvent.click(create);
    await waitFor(() => expect(client.proposeChangeSet).toHaveBeenCalledWith("v1", { rulesetId: "r1", targetManifestId: null, name: "Force Push — Revision 1", description: null }));
    expect(await screen.findByRole("link", { name: "Open in Canon Manager" })).toHaveAttribute("href", "/developer/rulesets/r1/change-sets/cs1");
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
  });
});

describe("new Definition form (§10–11, §55)", () => {
  it("derives the EntityType from the catalog, disables reserved kinds and never derives the Canonical Key silently", async () => {
    client.createDefinition.mockResolvedValue({ entity: { id: "e7" }, version: { id: "v7" }, validation: PASS });
    render(<NewDefinitionForm />);
    fireEvent.change(await screen.findByLabelText("Definition family"), { target: { value: "EQUIPMENT" } });
    const kindSelect = screen.getByLabelText("Definition kind") as HTMLSelectElement;
    expect([...kindSelect.options].find((o) => o.value === "WEAPON")).toMatchObject({ disabled: true });
    fireEvent.change(screen.getByLabelText("Definition family"), { target: { value: "SPELL" } });
    fireEvent.change(screen.getByLabelText("Definition kind"), { target: { value: "SPELL_EFFECT" } });
    expect(screen.getByText(/Stored as Entity Type/)).toHaveTextContent("SPELL_EFFECT");
    fireEvent.change(screen.getByLabelText("Display Name (required)"), { target: { value: "Force Push" } });
    expect(screen.getByLabelText("Canonical Key (required)")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Suggest a Canonical Key from the Display Name" }));
    expect(screen.getByLabelText("Canonical Key (required)")).toHaveValue("spell.effect.force_push");
    fireEvent.change(screen.getByLabelText("Effect family (required)"), { target: { value: "MOVEMENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Definition as Draft" }));
    await waitFor(() => expect(client.createDefinition).toHaveBeenCalledTimes(1));
    const body = client.createDefinition.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({ definitionKind: "SPELL_EFFECT", entityType: "SPELL_EFFECT", canonicalKey: "spell.effect.force_push", displayName: "Force Push", prowessDefinition: { definitionKind: "SPELL_EFFECT", payload: { effectFamily: "MOVEMENT" } } });
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("revisionNumber");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/compendium/admin/entities/e7/revisions/v7?created=1"));
  });

  it("shows a Canonical Key conflict as an explicit, readable error", async () => {
    const { AuthoringApiError } = await import("../../app/compendium/admin/_lib/authoring-client");
    client.createDefinition.mockRejectedValue(new AuthoringApiError("ENTITY.CANONICAL_KEY_CONFLICT", "canonicalKey is already in use: spell.effect.x", 409));
    render(<NewDefinitionForm />);
    fireEvent.change(await screen.findByLabelText("Definition family"), { target: { value: "SPELL" } });
    fireEvent.change(screen.getByLabelText("Definition kind"), { target: { value: "SPELL_EFFECT" } });
    fireEvent.change(screen.getByLabelText("Display Name (required)"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Canonical Key (required)"), { target: { value: "spell.effect.x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Definition as Draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Canonical Key conflict");
  });
});

describe("authoring dashboard (§60–61)", () => {
  it("lists kind or Generic, Latest Revision and lifecycle status — never Current / Active / Canon labels", async () => {
    client.listDefinitions.mockResolvedValue({
      items: [
        { entity: ENTITY, latestRevision: { id: "v2", revisionNumber: 2, status: "DRAFT", displayName: "Force Push", updatedAt: "2026-10-02T00:00:00.000Z" }, definitionKind: "SPELL_EFFECT", structuralValidation: "FAIL" },
        { entity: { ...ENTITY, id: "e2", entityType: "GENERIC_RULE", canonicalKey: "test.generic" }, latestRevision: { id: "v3", revisionNumber: 1, status: "APPROVED", displayName: "Fire Damage", updatedAt: "2026-10-02T00:00:00.000Z" }, definitionKind: null, structuralValidation: "NOT_A_DEFINITION" },
      ],
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });
    render(<AuthoringDashboard />);
    const rows = await screen.findAllByTestId("authoring-row");
    expect(rows[0]).toHaveTextContent("SPELL_EFFECT");
    expect(rows[0]).toHaveTextContent("Revision 2");
    expect(rows[0]).toHaveTextContent("Needs attention");
    expect(rows[1]).toHaveTextContent("Generic / non-Prowess Entity");
    expect(document.body.textContent).not.toMatch(/current revision|active revision|canon version|current version/i);
    expect(screen.getByRole("link", { name: "New Definition" })).toHaveAttribute("href", "/compendium/admin/new");
  });
});

describe("§19 navigation protection", () => {
  function Guarded({ dirty }: { dirty: boolean }) {
    useUnsavedChangesGuard(dirty);
    return <a href="/elsewhere">Leave</a>;
  }
  it("asks before following a link while there are unsaved changes, and blocks on cancel", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender } = render(<Guarded dirty />);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      screen.getByText("Leave").dispatchEvent(event);
    });
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(event.defaultPrevented).toBe(true);
    confirm.mockClear();
    rerender(<Guarded dirty={false} />);
    const clean = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      screen.getByText("Leave").dispatchEvent(clean);
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});
