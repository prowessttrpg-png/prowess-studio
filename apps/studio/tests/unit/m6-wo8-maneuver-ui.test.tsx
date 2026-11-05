import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/m6-wo8-builder.json";
import type { ManeuverBuilderDto } from "../../app/characters/_lib/maneuver-types";
import { sheetFixture } from "./m6-wo5-sheet-fixture";
const api = vi.hoisted(() => ({ getManeuverBuilder: vi.fn(), saveManeuverDraft: vi.fn(), validateManeuver: vi.fn(), finalizeManeuver: vi.fn(), getManeuver: vi.fn(), rebuildManeuver: vi.fn(), retireManeuver: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../../app/characters/_lib/character-client", async actual => ({ ...await actual<object>(), ...api }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
import { CharacterApiError } from "../../app/characters/_lib/character-client";
import { ManeuverBuilder } from "../../app/characters/_components/maneuvers/ManeuverBuilder";
import { ManeuverDetail } from "../../app/characters/_components/maneuvers/ManeuverDetail";
import { ManeuverRoster } from "../../app/characters/_components/maneuvers/ManeuverRoster";
import { SignatureManeuverRows } from "../../app/characters/_components/sheet/ManeuverRows";
import { SheetModeContext } from "../../app/characters/_components/sheet/SheetPanels";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const views = fixture as unknown as Record<string, ManeuverBuilderDto>;
const open = async (key = "empty") => { api.getManeuverBuilder.mockResolvedValue(clone(views[key])); render(<ManeuverBuilder characterId="character" maneuverId="maneuver" />); await screen.findByRole("tab", { name: "Concept" }); };
beforeEach(() => { vi.clearAllMocks(); api.saveManeuverDraft.mockImplementation(async (_c, _m, version, draft) => ({ ...clone(views.empty), maneuver: { ...clone(views.empty!.maneuver), lockVersion: version + 1, draft: { draft, evaluation: views.empty!.maneuver.draft!.evaluation } } })); });
const choose = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("WO8 Action-first accessible builder and server-only pricing", () => {
  it("offers nine keyboard tabs, no global Targeting, and server missing-content limitations", async () => {
    await open(); expect(screen.getAllByRole("tab")).toHaveLength(9);
    expect(screen.queryByRole("tab", { name: "Targeting" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Concept" }), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Action Selection" })).toHaveFocus());
    expect(screen.getByRole("tab", { name: "Action Selection" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Release limitations")).toHaveTextContent(/interaction/i);
    expect(screen.getByTestId("maneuver-cost")).toHaveTextContent("Cost unresolved");
  });
  it("keeps exact Attack references, saves authored choices at the loaded version and reorders by keyboard buttons", async () => {
    await open("multi"); choose("Action Sequence");
    const before = clone(views.multi!.maneuver.draft!.draft!.actions);
    fireEvent.click(screen.getByRole("button", { name: "Move attack2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(api.saveManeuverDraft).toHaveBeenCalled());
    const sent = api.saveManeuverDraft.mock.calls[0]!;
    expect(sent[2]).toBe(1); expect(sent[3].actions[0].source).toEqual(before[1]!.source);
    expect(sent[3].actions.map((a: { componentKey: string }) => a.componentKey)).toEqual(["attack2", "attack1"]);
    expect(Object.keys(sent[3]).sort()).toEqual(Object.keys(views.multi!.maneuver.draft!.draft!).sort());
    expect(sent[3]).not.toHaveProperty("cost"); await screen.findByText("Saved");
  });
  it("offers only complete Powerful Blow attachment groups and preserves all constituent identities", async () => {
    await open("powerful"); choose("Effects");
    const select = screen.getByRole("combobox", { name: "Attach effect1 to" });
    expect(within(select).getByRole("option", { name: /Powerful Blow/ })).toBeInTheDocument();
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(select, { target: { value: "powerful-blow" } }); fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(api.saveManeuverDraft).toHaveBeenCalled());
    expect(api.saveManeuverDraft.mock.calls[0]![3].effectAttachments[0].actionKeys).toEqual(["attack1", "attack2"]);
    expect(api.saveManeuverDraft.mock.calls[0]![3].actions).toEqual(views.powerful!.maneuver.draft!.draft!.actions);
  });
  it("keeps Action-specific Traits scoped and displays each independent attachment", async () => {
    await open("scoped"); choose("Traits"); expect(screen.getByText(/Scope: Action Specific; target: block/)).toBeInTheDocument();
    const name = Object.values(views.scoped!.names).find(n => n === "block addition")!;
    fireEvent.click(screen.getByRole("button", { name: `Select ${name}` }));
    expect(screen.getByRole("button", { name: "Add scoped Trait" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Exact Trait target" }), { target: { value: "block" } });
    fireEvent.click(screen.getByRole("button", { name: "Add scoped Trait" }));
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(api.saveManeuverDraft).toHaveBeenCalled());
    expect(api.saveManeuverDraft.mock.calls[0]![3].traits.at(-1).appliesTo).toEqual({ scope: "ACTION_SPECIFIC", componentKey: "block" });
  });
  it("displays exact server cost stages and structured Performance benefits, excluding preparation from listed AP", async () => {
    await open("performance"); choose("Conditions");
    expect(screen.getByText(/Actual Character rank: MASTER/)).toBeInTheDocument();
    const label = views.performance!.names[views.performance!.performance[0]!.definition.entityVersionId];
    const table = screen.getByRole("table", { name: `Release-authored ${label} benefits` });
    expect(within(table).getByRole("row", { name: "Master 6 0" })).toBeInTheDocument();
    choose("Review"); const cost = views.performance!.maneuver.draft!.evaluation!.cost!;
    expect(screen.getAllByTestId("maneuver-cost")[0]).toHaveTextContent(`${cost.ap.finalApCost} AP`);
    expect(screen.getByTestId("maneuver-performance-preparation")).toHaveTextContent(/separate preparation 0 AP/);
    expect(screen.getByTestId("maneuver-cost-inspector")).toHaveTextContent(String(cost.ap.protectedActionAp));
  });
  it("uses the exact Release Condition label in benefits and evaluated preparation", async () => {
    const view = clone(views.performance!);
    view.names[view.performance[0]!.definition.entityVersionId] = "Stage discipline";
    api.getManeuverBuilder.mockResolvedValue(view); render(<ManeuverBuilder characterId="character" maneuverId="maneuver" />);
    await screen.findByRole("tab", { name: "Conditions" }); choose("Conditions");
    expect(screen.getByRole("heading", { name: "Stage discipline" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Release-authored Stage discipline benefits" })).toBeInTheDocument();
    choose("Review");
    expect(screen.getByTestId("maneuver-performance-preparation")).toHaveTextContent("Stage discipline: Master; separate preparation 0 AP");
  });
  it("blocks unsupported Release finalization and links accessible server issues to steps", async () => {
    const view = clone(views.empty!); view.catalog.limitations.push({ code: "MISSING_APPROVED_COST_POLICY", message: "Approved cost policy missing" });
    api.getManeuverBuilder.mockResolvedValue(view); render(<ManeuverBuilder characterId="character" maneuverId="maneuver" />);
    await screen.findByRole("tab", { name: "Finalize" }); choose("Finalize"); expect(screen.getByRole("button", { name: "Finalize Maneuver" })).toBeDisabled();
    const summary = screen.getByLabelText("Validation summary"); fireEvent.click(within(summary).getAllByRole("button", { name: "Effects" })[0]!);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Effects" })).toHaveFocus());
  });
});

describe("WO8 draft concurrency and immutable history", () => {
  it("autosaves, handles a 409, retains local choices and does not retry or finalize over the conflict", async () => {
    api.saveManeuverDraft.mockRejectedValue(new CharacterApiError("STALE_WRITE", "Changed elsewhere", 409));
    await open("basic"); fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Unsaved local name" } });
    await screen.findByText(/Conflict — this Maneuver/);
    fireEvent.click(screen.getByRole("tab", { name: "Finalize" }));
    expect(screen.getByRole("button", { name: "Finalize Maneuver" })).toBeDisabled();
    expect(api.saveManeuverDraft).toHaveBeenCalledTimes(1); expect(api.finalizeManeuver).not.toHaveBeenCalled();
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    choose("Concept"); expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Unsaved local name");
  });
  it("never shows a saved evaluation as the cost of newer unsaved choices", async () => {
    let resolve!: (v: unknown) => void;
    api.saveManeuverDraft.mockImplementation(() => new Promise(r => { resolve = r; }));
    await open("basic"); fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "First edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Newer edit" } });
    await act(async () => resolve({ ...views.basic, maneuver: { ...views.basic!.maneuver, lockVersion: 2 } }));
    expect(screen.getByTestId("maneuver-cost")).toHaveTextContent("Cost unresolved");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Newer edit");
  });
  it("exposes immutable predecessors and current revision without replacing current with a rebuild draft", async () => {
    const view = clone(views.basic!); const saved = view.maneuver.draft!;
    view.maneuver.status = "ACTIVE"; view.maneuver.current = { ...saved, revisionId: "revision1", revisionNumber: 1, createdAt: "2026-11-04" };
    view.history = [{ ...view.maneuver.current, characterReleaseId: "release", current: true }];
    view.maneuver.draft = { draft: { ...saved.draft!, concept: { ...saved.draft!.concept, name: "Rebuild in progress" } }, evaluation: null };
    api.getManeuver.mockResolvedValue(view); render(<ManeuverDetail characterId="character" maneuverId="maneuver" />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Maneuver fixture");
    expect(screen.getByTestId("maneuver-history-revision")).toHaveTextContent("Revision 1 (current)");
  });
  it("shows shared roster usage and bounds printed current Maneuvers while retaining digital warnings", () => {
    const entry = clone(views.basic!.maneuver); entry.status = "ACTIVE"; entry.current = { ...entry.draft!, revisionId: "revision1", revisionNumber: 1, createdAt: "2026-11-04" }; entry.draft = null;
    render(<ManeuverRoster characterId="character" entries={[entry]} names={views.basic!.names} />);
    expect(screen.getByRole("link", { name: "New Signature Maneuver" })).toHaveAttribute("href", "/characters/character/maneuvers/new");
    const sheet = sheetFixture({ signatureManeuvers: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: "Printed Maneuver", revisionNumber: 1, state: "VALID_WITH_RUNTIME_DEFERRED", actions: entry.current!.draft!.actions, finalApCost: 2, finalMpCost: 0, effects: [], keywords: [], warnings: [{ code: "DEFERRED", message: "Runtime deferred" }] })) });
    render(<SheetModeContext.Provider value="print"><SignatureManeuverRows sheet={sheet} /></SheetModeContext.Provider>);
    expect(screen.getAllByTestId("sheet-maneuver-row")).toHaveLength(4); expect(screen.getByText(/More Maneuvers/)).toBeInTheDocument();
  });
});
