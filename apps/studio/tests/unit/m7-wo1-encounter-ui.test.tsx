import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncounterCandidateDto, EncounterDto } from "../../app/encounters/_lib/encounter-client";

/**
 * M7-WO1 — the encounter workspace presents the server's decisions and nothing else: readiness and eligibility are
 * rendered as given, there is no combat control, a stale command reloads and explains, a lost response is retried with
 * the SAME idempotency key, and an occupied side cannot be removed from the UI. Server calls are mocked.
 */
const client = vi.hoisted(() => ({ getEncounter: vi.fn(), commandEncounter: vi.fn(), searchEncounterCandidates: vi.fn(), newSubmissionKey: vi.fn() }));
vi.mock("../../app/encounters/_lib/encounter-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({}) }));
const { EncounterWorkspace } = await import("../../app/encounters/_components/EncounterWorkspace");
const { EncounterApiError } = await import("../../app/encounters/_lib/encounter-client");

const release = { id: "r1", rulesetId: "rs", rulesetName: "Core Playtest", releaseNumber: 3, versionLabel: "0.1.2", channel: "PLAYTEST" };
const encounter = (over: Partial<EncounterDto> = {}): EncounterDto => ({
  contractVersion: 1,
  id: "e1",
  name: "Bridge Ambush",
  notes: null,
  status: "PREPARATION",
  archivedAt: null,
  version: 4,
  createdAt: "2026-11-18T10:00:00.000Z",
  updatedAt: "2026-11-18T10:05:00.000Z",
  release,
  sides: [
    { id: "s1", name: "Heroes", ordinal: 1, participantIds: ["p1"] },
    { id: "s2", name: "Raiders", ordinal: 2, participantIds: [] },
  ],
  participants: [{ id: "p1", sideId: "s1", addedAt: "2026-11-18T10:01:00.000Z", character: { id: "c1", name: "Alpha", level: 2, status: "CORE_COMPLETE", rulesetReleaseId: "r1" }, standalone: { readable: true, combatActive: true, round: 2 } }],
  readiness: {
    state: "PREPARED",
    blocking: [],
    warnings: [{ code: "STANDALONE_COMBAT_ACTIVE", message: "Alpha is in standalone combat (round 2).", participantId: "p1", sideId: null }, { code: "EMPTY_SIDE", message: "Side “Raiders” has no participants.", participantId: null, sideId: "s2" }],
    combat: { available: false, reason: "Side initiative, rounds and turns arrive with M7-WO2." },
  },
  recentEvents: [{ id: "ev4", sequence: 4, kind: "PARTICIPANT_ADDED", summary: "Alpha added to “Heroes”.", encounterVersion: 4, record: {}, createdAt: "2026-11-18T10:05:00.000Z" }],
  ...over,
});
const candidates: EncounterCandidateDto[] = [
  { id: "c2", name: "Beta", level: 1, status: "CORE_COMPLETE", release, eligibility: "ELIGIBLE", reason: null },
  { id: "c3", name: "Gamma", level: 1, status: "CORE_COMPLETE", release: { ...release, id: "r2", releaseNumber: 4 }, eligibility: "OTHER_RELEASE", reason: "Built on Core Playtest Release 4; this encounter uses Release 3." },
  { id: "c4", name: "Delta", level: 1, status: "DRAFT", release, eligibility: "NOT_COMPLETE", reason: "Core creation is not complete yet." },
];

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.getEncounter.mockResolvedValue(encounter());
  client.searchEncounterCandidates.mockResolvedValue(candidates);
  let n = 0;
  client.newSubmissionKey.mockImplementation(() => `00000000-0000-4000-8000-00000000000${++n}`);
});
afterEach(() => vi.restoreAllMocks());

async function open() {
  render(<EncounterWorkspace id="e1" />);
  await screen.findByRole("heading", { level: 1, name: "Bridge Ambush" });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}

describe("M7-WO1 encounter workspace", () => {
  it("renders the server's readiness and Release as given, with no combat control", async () => {
    await open();
    expect(screen.getByTestId("encounter-release")).toHaveTextContent("Core Playtest · Release 3 (0.1.2)");
    const readiness = screen.getByTestId("encounter-readiness");
    expect(readiness).toHaveTextContent("Prepared");
    expect(readiness).toHaveTextContent("Alpha is in standalone combat (round 2).");
    expect(screen.getByTestId("combat-unavailable")).toHaveTextContent("not available yet");
    expect(screen.queryByRole("button", { name: /start combat|begin combat|roll initiative/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Sheet" })).toHaveAttribute("href", "/characters/c1");
  });

  it("an occupied side cannot be removed from the UI; an empty one asks first, then sends one command", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Remove side “Heroes”" })).toBeDisabled();
    expect(screen.getByText("Move or remove its participants before removing this side.")).toBeInTheDocument();
    client.commandEncounter.mockResolvedValue({ committed: true, replayed: false, event: encounter().recentEvents[0], encounter: encounter({ version: 5, sides: [encounter().sides[0]!] }) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove side “Raiders”" }));
    await waitFor(() => expect(client.commandEncounter).toHaveBeenCalledTimes(1));
    expect(client.commandEncounter).toHaveBeenCalledWith("e1", { kind: "REMOVE_SIDE", sideId: "s2" }, 4, "00000000-0000-4000-8000-000000000001");
    await screen.findByText("Side “Raiders” removed.");
  });

  it("only server-eligible Characters can be added; ineligible ones show the server's reason", async () => {
    await open();
    const list = within(screen.getByTestId("encounter-candidates"));
    expect(list.getByText("Built on Core Playtest Release 4; this encounter uses Release 3.")).toBeInTheDocument();
    expect(list.queryByRole("button", { name: "Add Gamma" })).toBeNull();
    expect(list.queryByRole("button", { name: "Add Delta" })).toBeNull();
    client.commandEncounter.mockResolvedValue({ committed: true, replayed: false, event: encounter().recentEvents[0], encounter: encounter({ version: 5 }) });
    fireEvent.change(screen.getByLabelText("Add to side"), { target: { value: "s2" } });
    fireEvent.click(list.getByRole("button", { name: "Add Beta" }));
    await waitFor(() => expect(client.commandEncounter).toHaveBeenCalledWith("e1", { kind: "ADD_PARTICIPANT", characterId: "c2", sideId: "s2" }, 4, expect.any(String)));
  });

  it("a lost response is retried with the SAME key; a stale refusal reloads and explains", async () => {
    await open();
    client.commandEncounter.mockRejectedValueOnce(new EncounterApiError("NETWORK_ERROR", "Could not reach the server.", 0));
    fireEvent.change(screen.getByLabelText("New side name"), { target: { value: "Watchers" } });
    fireEvent.click(screen.getByRole("button", { name: "Add side" }));
    await screen.findByText(/not confirmed/);
    client.commandEncounter.mockRejectedValueOnce(new EncounterApiError("ENCOUNTER.STALE_WRITE", "This encounter changed since it was loaded (now at version 5).", 409));
    client.getEncounter.mockResolvedValue(encounter({ version: 5 }));
    fireEvent.click(screen.getByRole("button", { name: "Add side" }));
    await screen.findByTestId("encounter-notice-stale");
    const keys = client.commandEncounter.mock.calls.map((c) => c[3]);
    expect(keys[0]).toBe(keys[1]);
    expect(client.getEncounter).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("encounter-notice-stale")).toHaveTextContent("reloaded with the latest saved state");
  });

  it("an archived encounter is a read-only record: no edit, roster or archive controls", async () => {
    client.getEncounter.mockResolvedValue(encounter({ status: "ARCHIVED", archivedAt: "2026-11-18T11:00:00.000Z", readiness: { state: "ARCHIVED", blocking: [], warnings: [], combat: { available: false, reason: "x" } } }));
    await open();
    expect(screen.getByTestId("encounter-status")).toHaveTextContent("Archived — read-only");
    expect(screen.queryByRole("button", { name: /Add side|Archive encounter|Save details|Remove|Move|Rename/ })).toBeNull();
    expect(screen.queryByTestId("encounter-candidates")).toBeNull();
    expect(screen.getByTestId("encounter-history")).toHaveTextContent("Alpha added to “Heroes”.");
  });

  it("unsaved details are protected and saved as one UPDATE_METADATA command", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Name (required)"), { target: { value: "Bridge Ambush II" } });
    expect(screen.getByTestId("details-unsaved")).toBeInTheDocument();
    client.commandEncounter.mockResolvedValue({ committed: true, replayed: false, event: encounter().recentEvents[0], encounter: encounter({ version: 5, name: "Bridge Ambush II" }) });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(client.commandEncounter).toHaveBeenCalledWith("e1", { kind: "UPDATE_METADATA", name: "Bridge Ambush II", notes: null }, 4, expect.any(String)));
    await waitFor(() => expect(screen.queryByTestId("details-unsaved")).toBeNull());
  });
});
