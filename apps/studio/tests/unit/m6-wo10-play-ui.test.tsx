import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardWorld } from "./m6-wo9-card-world";
import { ConflictError, FakePlayServer, PLAY_CHARACTER_ID, StaleError } from "./m6-wo10-play-world";

/**
 * PAS-10 M6-WO10 — Play Workspace presentation and interaction (verification E). The Character API client is mocked by an
 * in-memory server whose every response is the REAL @prowess/game play domain's (m6-wo10-play-world.ts). These tests prove
 * the page renders the server's values, previews never change the shown resources, commits update them only from the
 * server's response, pending inputs are collected as raw rolls, manual adjustments and notes are labelled, stale and
 * duplicate submissions are handled safely, cards open read-only, and the page is keyboard reachable.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const client = vi.hoisted(() => ({ getPlayWorkspace: vi.fn(), previewPlayOperation: vi.fn(), commitPlayOperation: vi.fn(), getCardLibrary: vi.fn() }));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { CharacterApiError } = await import("../../app/characters/_lib/character-client");
const { PlayWorkspace } = await import("../../app/characters/_components/play/PlayWorkspace");

let server: FakePlayServer;
const asApi = (e: unknown) => (e instanceof StaleError ? new CharacterApiError(e.code, e.message, 409) : e instanceof ConflictError ? new CharacterApiError(e.code, e.message, 409) : e);
beforeEach(() => {
  server = new FakePlayServer();
  for (const f of Object.values(client)) f.mockReset();
  client.getPlayWorkspace.mockImplementation(async () => server.view());
  client.previewPlayOperation.mockImplementation(async (_id: string, op: unknown, r: number, s: number) => {
    try {
      return server.preview(op, r, s);
    } catch (e) {
      throw asApi(e);
    }
  });
  client.commitPlayOperation.mockImplementation(async (_id: string, op: unknown, key: string, r: number, s: number) => {
    try {
      return server.commit(op, key, r, s);
    } catch (e) {
      throw asApi(e);
    }
  });
  client.getCardLibrary.mockResolvedValue(structuredClone(cardWorld().library));
});

async function open() {
  render(<PlayWorkspace characterId={PLAY_CHARACTER_ID} />);
  await screen.findByTestId("play-workspace");
}
const resource = (key: string) => screen.getByTestId(`play-resource-${key}`).textContent;
async function timing(event: string) {
  const button = screen.getByTestId(`play-timing-${event}`);
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(client.commitPlayOperation).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId("play-workspace").getAttribute("data-runtime-version")).toBe(String(server.versions.runtimeVersion)));
}
async function intoTurn() {
  for (const e of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await timing(e);
}

describe("M6-WO10 E — header, resources and timing", () => {
  it("M6-I151 renders the server's header values and Release-derived resources; only legal timing controls are enabled", async () => {
    await open();
    const view = server.view();
    expect(screen.getByTestId("play-die").textContent).toBe(view.workspace.header.characterDie.dieKey);
    for (const r of view.workspace.resources) expect(resource(r.resourceKey)).toBe(`${String(r.current)}${r.maximum === null ? "" : ` / ${String(r.maximum)}`}`);
    expect(screen.getByTestId("play-timing-BEGIN_COMBAT")).not.toBeDisabled();
    for (const e of ["START_ROUND", "START_TURN", "END_TURN", "END_ROUND", "END_COMBAT"]) expect(screen.getByTestId(`play-timing-${e}`)).toBeDisabled();
    expect(screen.getByTestId("play-context").getAttribute("data-phase")).toBe("OUT_OF_COMBAT");
    expect(screen.getByRole("link", { name: "Character Sheet" }).getAttribute("href")).toBe(`/characters/${PLAY_CHARACTER_ID}`);
    expect(screen.getByRole("link", { name: "Cards" }).getAttribute("href")).toBe(`/characters/${PLAY_CHARACTER_ID}/cards`);
  });

  it("M6-I160 timing commits go through the server; the turn context and enabled controls follow its state", async () => {
    await open();
    await intoTurn();
    expect(screen.getByTestId("play-context").getAttribute("data-turn")).toBe("ACTIVE");
    expect(screen.getByTestId("play-timing-START_TURN")).toBeDisabled();
    expect(screen.getByTestId("play-timing-END_TURN")).not.toBeDisabled();
    expect(client.commitPlayOperation.mock.calls.map((c) => (c[1] as { event: string }).event)).toEqual(["BEGIN_COMBAT", "START_ROUND", "START_TURN"]);
    expect(screen.getAllByTestId("play-event").map((e) => e.getAttribute("data-sequence"))).toEqual(["1", "2", "3"]);
  });
});

describe("M6-WO10 E — actions, previews and commits", () => {
  it("M6-I154 a preview shows the server's result but never changes the shown resources; a commit does, from the response", async () => {
    await open();
    await intoTurn();
    const ap = resource("AP");
    fireEvent.click(within(screen.getAllByTestId("play-action").find((r) => r.getAttribute("data-action") === "MOVE")!).getByTestId("play-action-open"));
    fireEvent.click(screen.getByTestId("play-preview"));
    await screen.findByTestId("play-result");
    expect(screen.getByTestId("play-result").getAttribute("data-committed")).toBe("false");
    expect(screen.getByTestId("play-result").textContent).toMatch(/Preview only/);
    expect(resource("AP")).toBe(ap);
    fireEvent.click(screen.getByTestId("play-commit"));
    await waitFor(() => expect(screen.getByTestId("play-result").getAttribute("data-committed")).toBe("true"));
    expect(resource("AP")).not.toBe(ap);
    expect(resource("AP")).toBe(`${String(server.view().workspace.resources.find((r) => r.resourceKey === "AP")!.current)} / ${String(server.view().workspace.resources.find((r) => r.resourceKey === "AP")!.maximum)}`);
  });

  it("M6-I161 a refused Action keeps resources unchanged and shows the exact reason", async () => {
    await open();
    fireEvent.click(within(screen.getAllByTestId("play-action").find((r) => r.getAttribute("data-action") === "MOVE")!).getByTestId("play-action-open"));
    fireEvent.click(screen.getByTestId("play-commit"));
    await screen.findByTestId("play-result");
    expect(screen.getByTestId("play-result").getAttribute("data-status")).toBe("REFUSED");
    expect(screen.getByTestId("play-result").textContent).toMatch(/own turn/);
    expect(server.events).toHaveLength(0);
  });

  it("M6-I162 movement: Move grants allowance; segments are spent with the server's terrain cost", async () => {
    await open();
    await intoTurn();
    fireEvent.click(within(screen.getAllByTestId("play-action").find((r) => r.getAttribute("data-action") === "MOVE")!).getByTestId("play-action-open"));
    fireEvent.click(screen.getByTestId("play-commit"));
    await waitFor(() => expect(resource("MOVEMENT_ALLOWANCE")).not.toBe("0"));
    fireEvent.click(screen.getByTestId("play-tab-movement"));
    fireEvent.click(screen.getByTestId("play-movement-open"));
    fireEvent.change(screen.getByTestId("play-segment-0-distance"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("play-segment-0-terrain"), { target: { value: "DIFFICULT" } });
    fireEvent.click(screen.getByTestId("play-commit"));
    await waitFor(() => expect(server.stored.runtime!.movement.segments).toHaveLength(1));
    fireEvent.click(screen.getByTestId("play-tab-movement"));
    expect(screen.getByTestId("play-movement-segments").textContent).toMatch(/5 ft difficult \(cost 10\)/);
  });

  it("M6-I158 M6-I167 a Spell lists the engine's pending request, takes a raw roll, commits once and labels outcomes NOT APPLIED", async () => {
    await open();
    await intoTurn();
    fireEvent.click(screen.getByTestId("play-tab-spells"));
    const ember = screen.getAllByTestId("play-spell").find((r) => /Ember Bolt/.test(r.textContent ?? ""))!;
    fireEvent.click(within(ember).getByTestId("play-ability-open"));
    fireEvent.click(screen.getByTestId("play-commit"));
    const pending = await screen.findByTestId("play-pending");
    expect(pending.getAttribute("data-kind")).toBe("ATTACK_ROLL");
    expect(server.events).toHaveLength(3);
    const id = `play-pending-${pending.getAttribute("data-request")!.replace(/[^A-Za-z0-9]/g, "_")}`;
    fireEvent.change(screen.getByTestId(`${id}-roll-face-0`), { target: { value: "7" } });
    fireEvent.change(screen.getByTestId(`${id}-dodge`), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("play-commit"));
    await waitFor(() => expect(screen.getByTestId("play-result").getAttribute("data-committed")).toBe("true"));
    expect(server.events).toHaveLength(4);
    expect(screen.getByTestId("play-result-outcomes").textContent).toMatch(/not applied/);
    const sent = client.commitPlayOperation.mock.calls.at(-1)![1] as { inputs: Record<string, unknown>[] };
    expect(sent.inputs[0]).toEqual({ requestKey: pending.getAttribute("data-request"), kind: "ATTACK_ROLL", roll: { mode: "NORMAL", rolls: [7], source: "PHYSICAL" }, targetDodge: 4 });
    expect(JSON.stringify(sent)).not.toMatch(/success|total|finalApCost|finalMpCost|hit/);
  });

  it("M6-I172 the optional digital roller fills raw faces within the die and marks them DIGITAL", async () => {
    await open();
    await intoTurn();
    fireEvent.click(screen.getByTestId("play-tab-attacks"));
    fireEvent.click(within(screen.getAllByTestId("play-attack").find((r) => r.getAttribute("data-availability") === "AVAILABLE")!).getByTestId("play-attack-open"));
    for (let i = 0; i < 30; i += 1) {
      fireEvent.click(screen.getByTestId("play-attack-roll-digital"));
      const face = Number((screen.getByTestId("play-attack-roll-face-0") as HTMLInputElement).value);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(server.view().workspace.header.characterDie.faces);
    }
    expect((screen.getByTestId("play-attack-roll-source") as HTMLSelectElement).value).toBe("DIGITAL");
  });
});

describe("M6-WO10 E — manual adjustments, notes, conflicts and cards", () => {
  it("M6-I168 a manual adjustment and a GM note are recorded and labelled as such in the activity log", async () => {
    await open();
    fireEvent.click(screen.getByText("Manual adjustment (player / GM)"));
    fireEvent.change(screen.getByTestId("play-manual-resource"), { target: { value: "HP" } });
    fireEvent.change(screen.getByTestId("play-manual-value"), { target: { value: "4" } });
    fireEvent.change(screen.getByTestId("play-manual-reason"), { target: { value: "fell" } });
    fireEvent.click(screen.getByTestId("play-manual-submit"));
    await waitFor(() => expect(resource("HP")).toMatch(/^4 \//));
    fireEvent.change(screen.getByTestId("play-note-text"), { target: { value: "The GM rules the door is barred." } });
    fireEvent.click(screen.getByTestId("play-note-submit"));
    await waitFor(() => expect(screen.getAllByTestId("play-event")).toHaveLength(2));
    expect(screen.getAllByTestId("play-event").map((e) => e.getAttribute("data-classification"))).toEqual(["MANUAL_ADJUSTMENT", "NOTE"]);
    expect(screen.getByTestId("play-log").textContent).toMatch(/not calculated by the rules engine/);
  });

  it("M6-I157 M6-I170 a stale submission (Character Sheet edited elsewhere) applies nothing, reloads and explains", async () => {
    await open();
    server.sheetEdit("HP", 2);
    await timing("BEGIN_COMBAT").catch(() => undefined);
    await screen.findByTestId("play-notice");
    expect(screen.getByTestId("play-notice").textContent).toMatch(/changed elsewhere/);
    expect(server.events).toHaveLength(0);
    await waitFor(() => expect(resource("HP")).toMatch(/^2 \//));
  });

  it("M6-I156 a retry after a network failure reuses the same idempotency key (never double-applies)", async () => {
    await open();
    client.commitPlayOperation.mockImplementationOnce(async () => {
      throw new TypeError("network down");
    });
    fireEvent.click(screen.getByTestId("play-timing-BEGIN_COMBAT"));
    await screen.findByTestId("play-notice");
    expect(screen.getByTestId("play-notice").textContent).toMatch(/network/);
    fireEvent.click(screen.getByTestId("play-timing-BEGIN_COMBAT"));
    await waitFor(() => expect(server.events).toHaveLength(1));
    const keys = client.commitPlayOperation.mock.calls.map((c) => c[2]);
    expect(keys[0]).toBe(keys[1]);
  });

  it("M6-I170 a WO9 card opens read-only in the Play Workspace; tabs are keyboard reachable", async () => {
    await open();
    const first = screen.getByTestId("play-tab-general");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByTestId("play-tab-counter").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId("play-tab-counter"));
    fireEvent.click(screen.getByTestId("play-tab-general"));
    fireEvent.click(within(screen.getAllByTestId("play-action")[0]!).getByTestId("play-open-card"));
    await screen.findByTestId("play-card-drawer");
    expect(client.getCardLibrary).toHaveBeenCalledWith(PLAY_CHARACTER_ID);
    expect(within(screen.getByTestId("play-card-drawer")).queryByTestId("play-commit")).toBeNull();
    fireEvent.click(screen.getByTestId("play-card-close"));
    expect(screen.queryByTestId("play-card-drawer")).toBeNull();
  });
});
