import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateDto, CharacterDto, CharacterListItemDto, CreationContextDto, OptionDto, ResolutionDto } from "../../app/characters/_lib/character-client";

/**
 * PAS-10 M6-WO11 — Character Library / Save / Load: Studio behaviour with the Character API client mocked. Library:
 * the unfiltered first request is the WO3 client call; search / status reset to page 1; paging; only the newest
 * response reaches the screen; same-named rows are told apart by id; loading, empty, no-match and retry states; the
 * actions follow the persisted status. Creation: a reopened Draft continues where its saved progress needs; a failed
 * second write keeps the acknowledged first one and retries only what is unsaved; an unknown outcome is reconciled by a
 * read; edits made while saving stay unsaved; a double click saves once; a late response for another Character is
 * ignored; leaving with unsaved edits asks first.
 */
const client = vi.hoisted(() => ({
  listCharacters: vi.fn(),
  getCharacter: vi.fn(),
  getCreationContext: vi.fn(),
  checkCharacter: vi.fn(),
  saveCreation: vi.fn(),
  saveProfile: vi.fn(),
  completeCoreCreation: vi.fn(),
}));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/characters" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { CharacterIndex, LIBRARY_SEARCH_DEBOUNCE_MS, libraryActions } = await import("../../app/characters/_components/CharacterIndex");
const { CharacterWizard } = await import("../../app/characters/_components/CharacterWizard");
const { CharacterApiError } = await import("../../app/characters/_lib/character-client");
const { continuationStep } = await import("../../app/characters/_lib/creation-save");

const RELEASE = { id: "rel1", rulesetId: "rs1", rulesetName: "Core Playtest", releaseNumber: 3, versionLabel: "0.3.0", channel: "CORE_PLAYTEST" };
const row = (id: string, name: string, status: "DRAFT" | "CORE_COMPLETE" = "DRAFT", updatedAt = "2026-10-02T10:30:00.000Z"): CharacterListItemDto => ({ id, name, level: 1, status, updatedAt, release: RELEASE });
const page = (items: CharacterListItemDto[], total = items.length, totalPages = 1) => ({ items, total, page: 1, pageSize: 50, totalPages });
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const ref = (entityId: string, entityVersionId: string, definitionKind: string) => ({ entityId, entityVersionId, canonicalKey: `test.${entityId}`, definitionKind, systemFamily: "CHARACTER" });
const option = (entityId: string, versionId: string, kind: string, displayName: string, payload: Record<string, unknown> | null = null): OptionDto => ({ ref: ref(entityId, versionId, kind), displayName, shortDescription: displayName, revisionNumber: 1, payload });
const ORCANI = option("anc-orcani", "ancv-orcani", "ANCESTRY", "Orcani", { baseHp: 10, baseMp: 4, statGrants: [], skillGrants: [], source: {} });
const STATS = ["STR", "AGI", "CON", "PER", "RES", "PRO"];
const CONTEXT: CreationContextDto = {
  character: { id: "c1", name: "Grukk", lockVersion: 2, status: "DRAFT" },
  release: RELEASE,
  capability: { status: "READY", missing: [] },
  creationRule: option("rule", "rulev", "CHARACTER_CREATION_RULE", "Creation Rule", { startingLevel: 1, statPointBudget: 15, freeTrainedSkillCount: 2 }),
  stats: STATS.map((s) => ({ stat: s, minimum: 1, maximum: 10, ref: ref(`stat-${s}`, `statv-${s}`, "STAT") })),
  characterDie: { level: 1, dieKey: "D4", faces: 4 },
  skillRankLadder: { ref: ref("ladder", "ladderv", "RANK_LADDER"), ranks: [{ rankKey: "TRAINED", order: 1 }] },
  derivedStatistics: [],
  ancestries: [ORCANI],
  skills: [],
  affinities: [],
} as unknown as CreationContextDto;
const EMPTY: CandidateDto = { ancestry: null, ancestryStatChoices: [], statAllocations: {}, skills: [], primaryAffinity: null };
const WITH_ANCESTRY: CandidateDto = { ...EMPTY, ancestry: { entityId: "anc-orcani", entityVersionId: "ancv-orcani" } };
function resolution(status: ResolutionDto["status"] = "INCOMPLETE", issues: ResolutionDto["issues"] = []): ResolutionDto {
  return { status, issues, capability: { status: "READY", missing: [] }, resolved: { level: 1, characterDie: null, creationRule: null, ancestry: null, baseHp: null, baseMp: null, pointBudget: 15, pointsSpent: 0, pointsRemaining: 15, stats: [], skills: [], freeSkillCount: 2, primaryAffinity: null }, derivedPreview: null };
}
const issue = (path: string) => ({ code: "X", severity: "INCOMPLETE" as const, path, message: `${path} to do`, source: null });
function character(over: Partial<CharacterDto> = {}, choices: CandidateDto = EMPTY, res: ResolutionDto = resolution("INCOMPLETE", [issue("ancestry")])): CharacterDto {
  return { id: "c1", name: "Grukk", concept: "Bruiser", level: 1, lockVersion: 2, coreCreationCompletedAt: null, status: "DRAFT", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z", release: RELEASE, choices: { ...choices, skills: [] }, resolution: res, names: {}, ...over } as CharacterDto;
}
async function openWizard(c: CharacterDto = character()) {
  client.getCharacter.mockResolvedValue(c);
  client.getCreationContext.mockResolvedValue(CONTEXT);
  const view = render(<CharacterWizard characterId={c.id} />);
  await screen.findByTestId("character-wizard");
  return view;
}
const currentStep = () => screen.getByRole("heading", { level: 2 }).textContent;

beforeEach(() => {
  for (const f of [...Object.values(client), nav.push]) f.mockReset();
  client.checkCharacter.mockResolvedValue(resolution());
});

describe("M6-WO11 Character Library", () => {
  it("M6-I173 L11 the first request is the unchanged WO3 client call; rows carry status actions and a distinguishing id", async () => {
    client.listCharacters.mockResolvedValue(page([row("aaaaaaaa-1111-4111-8111-111111111111", "Twin"), row("bbbbbbbb-2222-4222-8222-222222222222", "Twin", "CORE_COMPLETE")]));
    render(<CharacterIndex />);
    const rows = await screen.findAllByTestId("character-row");
    expect(client.listCharacters.mock.calls[0]).toEqual([]);
    expect(rows.map((r) => within(r).getByTestId("library-character-id").textContent)).toEqual(["id aaaaaaaa", "id bbbbbbbb"]);
    expect(within(rows[0]!).getByRole("link", { name: "Twin" }).getAttribute("href")).toBe("/characters/aaaaaaaa-1111-4111-8111-111111111111");
    expect(within(rows[0]!).getByTestId("library-continue-creation").getAttribute("href")).toBe("/characters/aaaaaaaa-1111-4111-8111-111111111111/create");
    expect(within(rows[0]!).queryByTestId("library-resume-play")).toBeNull();
    expect(within(rows[1]!).getByTestId("library-open-sheet").getAttribute("href")).toBe("/characters/bbbbbbbb-2222-4222-8222-222222222222");
    expect(within(rows[1]!).getByTestId("library-resume-play").getAttribute("href")).toBe("/characters/bbbbbbbb-2222-4222-8222-222222222222/play");
    // The action's accessible name is the action; its description is the row's Character (name and short id). The name
    // link stays the ONLY link whose name is the Character's name (existing tests select it by name).
    const play = within(rows[1]!).getByTestId("library-resume-play");
    expect(play.getAttribute("aria-label")).toBeNull();
    expect(document.getElementById(play.getAttribute("aria-describedby")!)!.textContent).toBe("Twinid bbbbbbbb");
    expect(within(rows[1]!).getAllByRole("link", { name: /Twin/ })).toHaveLength(1);
    expect(screen.getByRole("columnheader", { name: /Record updated/ })).toBeTruthy();
    expect(libraryActions({ id: "x/y", status: "DRAFT" })[0]!.href).toBe("/characters/x%2Fy/create");
  });

  it("M6-I173 L01 search and status reset to page 1 and are sent to the server; paging asks for the next page", async () => {
    client.listCharacters.mockResolvedValue(page([row("a", "Alpha")], 120, 3));
    render(<CharacterIndex />);
    await screen.findByTestId("character-row");
    expect(screen.getByTestId("library-page").textContent).toBe("Page 1 of 3");
    fireEvent.click(screen.getByTestId("library-next"));
    await waitFor(() => expect(client.listCharacters).toHaveBeenLastCalledWith(2, 50, { q: "", status: "ALL" }));
    await waitFor(() => expect(screen.getByTestId("library-page").textContent).toBe("Page 2 of 3"));
    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "  50% (scout) " } });
    await waitFor(() => expect(client.listCharacters).toHaveBeenLastCalledWith(1, 50, { q: "  50% (scout) ", status: "ALL" }), { timeout: LIBRARY_SEARCH_DEBOUNCE_MS * 8 });
    fireEvent.click(screen.getByTestId("library-next"));
    await waitFor(() => expect(client.listCharacters).toHaveBeenLastCalledWith(2, 50, { q: "  50% (scout) ", status: "ALL" }));
    fireEvent.click(screen.getByTestId("library-status-DRAFT"));
    await waitFor(() => expect(client.listCharacters).toHaveBeenLastCalledWith(1, 50, { q: "  50% (scout) ", status: "DRAFT" }));
  });

  it("M6-I178 L07 L12 a slower, older response never replaces newer results", async () => {
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    client.listCharacters.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<CharacterIndex />);
    fireEvent.click(screen.getByTestId("library-status-CORE_COMPLETE"));
    await waitFor(() => expect(client.listCharacters).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(page([row("new", "Newest", "CORE_COMPLETE")])));
    await act(async () => first.resolve(page([row("old", "Stale Old")])));
    const rows = await screen.findAllByTestId("character-row");
    expect(rows.map((r) => r.getAttribute("data-character-id"))).toEqual(["new"]);
    expect(screen.queryByText("Stale Old")).toBeNull();
  });

  it("M6-I173 L11 empty library, no matches, and a failed read with retry are distinct", async () => {
    client.listCharacters.mockResolvedValueOnce(page([], 0, 0));
    const view = render(<CharacterIndex />);
    expect(await screen.findByText("No Characters yet")).toBeTruthy();
    view.unmount();
    client.listCharacters.mockReset();
    client.listCharacters.mockResolvedValueOnce(page([row("a", "Alpha")])).mockResolvedValue(page([], 0, 0));
    render(<CharacterIndex />);
    await screen.findByTestId("character-row");
    fireEvent.click(screen.getByTestId("library-status-CORE_COMPLETE"));
    expect(await screen.findByTestId("library-no-matches")).toBeTruthy();
    expect(screen.queryByText("No Characters yet")).toBeNull();
    client.listCharacters.mockReset();
    client.listCharacters.mockRejectedValueOnce(new CharacterApiError("NETWORK_ERROR", "Could not reach the server.", 0)).mockResolvedValue(page([row("b", "Back")]));
    fireEvent.click(screen.getByTestId("library-status-ALL"));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach the server.");
    fireEvent.click(screen.getByTestId("library-retry"));
    expect(await screen.findByText("Back")).toBeTruthy();
    // Keyboard: every control is a native, labelled form control or button.
    expect(screen.getByRole("searchbox", { name: "Search by name" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Draft" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Library pages" })).toBeTruthy();
  });
});

describe("M6-WO11 creation save and resume", () => {
  it("M6-I175 L03 a reopened Draft continues where its saved progress needs; a fresh Draft starts at Concept", async () => {
    expect(continuationStep(EMPTY, resolution("INCOMPLETE", [issue("ancestry")]))).toBe(0);
    expect(continuationStep(WITH_ANCESTRY, resolution("INCOMPLETE", [issue("statAllocations"), issue("skills.orcani_upbringing"), issue("primaryAffinity")]))).toBe(2);
    expect(continuationStep(WITH_ANCESTRY, resolution("INCOMPLETE", [issue("ancestryStatChoices.orcani_versatility")]))).toBe(1);
    expect(continuationStep(WITH_ANCESTRY, resolution("READY"))).toBe(5);
    expect(continuationStep(WITH_ANCESTRY, resolution("INVALID", [issue("")]))).toBe(5);
    await openWizard(character({}, WITH_ANCESTRY, resolution("INCOMPLETE", [issue("skills")])));
    expect(currentStep()).toBe("Skills");
    expect(screen.getByTestId("wizard-save-state").textContent).toBe("All changes saved.");
  });

  it("M6-I175 L08 a failed second write keeps the acknowledged profile; the retry sends only the choices at the new version", async () => {
    await openWizard();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Grukk Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /2\. Race/ }));
    fireEvent.click(within(screen.getAllByTestId("ancestry-card")[0]!).getByRole("radio"));
    client.saveProfile.mockResolvedValue(character({ name: "Grukk Renamed", lockVersion: 3 }));
    client.saveCreation.mockRejectedValueOnce(new CharacterApiError("CHARACTER.INVALID_INPUT", "Injected failure", 400));
    fireEvent.click(screen.getByTestId("wizard-save"));
    const message = await screen.findByTestId("wizard-message");
    expect(message.textContent).toContain("The profile was saved, but the creation choices were not");
    expect(client.saveProfile).toHaveBeenCalledWith("c1", 2, "Grukk Renamed", "Bruiser");
    expect(client.saveCreation.mock.calls[0]![1]).toBe(3);
    expect(screen.getByTestId("wizard-save-state").textContent).toBe("Unsaved changes.");
    expect(currentStep()).toBe("Race / Ancestry");
    client.saveCreation.mockResolvedValue(character({ name: "Grukk Renamed", lockVersion: 4 }, WITH_ANCESTRY));
    fireEvent.click(screen.getByTestId("wizard-save"));
    await waitFor(() => expect(screen.getByTestId("wizard-message").textContent).toBe("Saved."));
    expect(client.saveProfile).toHaveBeenCalledTimes(1);
    expect(client.saveCreation.mock.calls[1]![1]).toBe(3);
    expect(screen.getByTestId("wizard-save-state").textContent).toBe("All changes saved.");
  });

  it("M6-I175 an unknown outcome is reconciled by reading the Character — confirmed, or still unsaved", async () => {
    await openWizard();
    fireEvent.click(screen.getByRole("button", { name: /2\. Race/ }));
    fireEvent.click(within(screen.getAllByTestId("ancestry-card")[0]!).getByRole("radio"));
    client.saveCreation.mockRejectedValueOnce(new CharacterApiError("NETWORK_ERROR", "Could not reach the server.", 0));
    client.getCharacter.mockResolvedValueOnce(character({ lockVersion: 3 }, WITH_ANCESTRY));
    fireEvent.click(screen.getByTestId("wizard-save"));
    await waitFor(() => expect(screen.getByTestId("wizard-message").textContent).toContain("the server confirms these changes were saved"));
    expect(screen.getByTestId("wizard-save-state").textContent).toBe("All changes saved.");
    expect(client.saveCreation).toHaveBeenCalledTimes(1);
    // The other outcome: the server holds the previous choices — the edit stays unsaved and nothing is re-sent.
    fireEvent.click(within(screen.getAllByTestId("ancestry-card")[0]!).getByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: /1\. Concept/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Other" } });
    client.saveProfile.mockRejectedValueOnce(new CharacterApiError("INVALID_RESPONSE", "Unreadable", 502));
    client.getCharacter.mockResolvedValueOnce(character({ lockVersion: 3 }, WITH_ANCESTRY));
    fireEvent.click(screen.getByTestId("wizard-save"));
    await waitFor(() => expect(screen.getByTestId("wizard-message").textContent).toContain("the previous profile"));
    expect(screen.getByTestId("wizard-save-state").textContent).toBe("Unsaved changes.");
    expect(client.saveProfile).toHaveBeenCalledTimes(1);
  });

  it("M6-I175 one save at a time; edits made while saving stay unsaved; success is shown only after the server acknowledges", async () => {
    await openWizard();
    const pending = deferred<CharacterDto>();
    client.saveProfile.mockReturnValue(pending.promise);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "First" } });
    // Two clicks inside ONE React batch: the button is not yet re-rendered as disabled, so only the in-flight guard
    // stands between them and a second submission.
    const button = screen.getByTestId("wizard-save");
    act(() => {
      button.click();
      button.click();
    });
    expect(screen.getByTestId("wizard-save-state").textContent).toBe("Saving — the server has not confirmed yet.");
    expect(screen.queryByText("Saved.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Second" } });
    await act(async () => pending.resolve(character({ name: "First", lockVersion: 3 })));
    expect(client.saveProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("wizard-message").textContent).toBe("Saved what was submitted. Changes made while saving are not saved yet.");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Second");
    expect(screen.getByTestId("wizard-save-state").textContent).toBe("Unsaved changes.");
    expect(currentStep()).toBe("Concept");
  });

  it("M6-I178 L07 a late response for Character A never updates Character B's form", async () => {
    const a = deferred<CharacterDto>();
    client.getCreationContext.mockResolvedValue(CONTEXT);
    client.getCharacter.mockImplementation((id: string) => (id === "A" ? a.promise : Promise.resolve(character({ id: "B", name: "Bea" }))));
    const view = render(<CharacterWizard characterId="A" />);
    view.rerender(<CharacterWizard characterId="B" />);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Bea"));
    await act(async () => a.resolve(character({ id: "A", name: "Ava" })));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Bea");
  });

  it("M6-I175 leaving with unsaved edits asks first; staying keeps the edits", async () => {
    await openWizard();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    // Any in-app link on the page (the app shell's navigation, a breadcrumb, a rule link).
    const link = document.body.appendChild(Object.assign(document.createElement("a"), { href: "/characters" }));
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(confirm).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Unsaved");
    // With no unsaved edits, links are not intercepted.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Grukk" } });
    const free = new MouseEvent("click", { bubbles: true, cancelable: true });
    confirm.mockClear();
    link.dispatchEvent(free);
    expect(confirm).not.toHaveBeenCalled();
    link.remove();
    confirm.mockRestore();
  });
});
