import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FRAMING, dragFraming, framedImageBox } from "../../app/characters/_components/sheet/portrait-framing";
import { sheetFixture } from "./m6-wo5-sheet-fixture";

/**
 * PAS-10 M6-WO5 §109–§114 — Digital Character Sheet UI. The Character API client is mocked: these tests prove
 * PRESENTATION — the two-page Field Manual layout and its section order, server values shown verbatim (Stats / Saves,
 * Core Values & Combat with "Accuracy" and "Dodge", resources, Skills with T / E / M and Performance, the Affinity
 * Profile), "—" for values the Release does not define, inline resource edits that send CURRENT values only,
 * debounced notes autosave, portrait placeholder / framing / upload limits, and the print mode (no controls, explicit
 * overflow page). Nothing here calculates a rule.
 * Invariants: M6-I045 the sheet consumes the canonical profile · M6-I046 derived values are read-only projections ·
 * M6-I048 notes / M6-I049 action notes never create mechanics · M6-I050 nondestructive portrait framing ·
 * M6-I055 equipment / ability panels are integration boundaries · M6-I056 print is not rules authority.
 */
const client = vi.hoisted(() => ({ getSheet: vi.fn(), updatePlayState: vi.fn(), updateSheetNotes: vi.fn(), uploadPortrait: vi.fn(), updatePortraitTransform: vi.fn(), removePortrait: vi.fn() }));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { CharacterSheet } = await import("../../app/characters/_components/sheet/CharacterSheet");

beforeEach(() => {
  vi.useRealTimers();
  for (const f of Object.values(client)) f.mockReset();
});
const settle = (ms = 800) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("M6-WO5 sheet layout and server values (§5–§45)", () => {
  it("Page 1 holds identity, portrait, Stats, Core Values, Resources, Skills, Actions; Page 2 the persistent state", async () => {
    client.getSheet.mockResolvedValue(sheetFixture());
    render(<CharacterSheet characterId="c1" />);
    const p1 = await screen.findByTestId("sheet-page-1");
    const p2 = screen.getByTestId("sheet-page-2");
    const headings = (el: HTMLElement) => within(el).getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.trim());
    expect(headings(p1)).toEqual(["Stats", "Core Values & Combat", "Resources", "Skills", "Actions"]);
    expect(headings(p2)).toEqual(["Granted Effects & Conditions", "Affinity Profile", "Equipment & Gear", "Attunement", "Carry & Weight", "Possessions", "Character Notes"]);
    expect(within(p1).getByRole("heading", { level: 1 }).textContent).toContain("Character Personnel File");
    expect(screen.getByTestId("sheet-name").textContent).toBe("Brakka");
    expect(screen.getByTestId("sheet-level").textContent).toBe("6");
    expect(screen.getByTestId("sheet-species").textContent).toBe("Orcani");
    expect(screen.getByTestId("sheet-primary-affinity").textContent).toBe("Evocation");
    expect(screen.getByLabelText("Company / PAC")).toHaveProperty("value", "Harbor Watch");
    expect(screen.queryByText("Affinity Progression")).toBeNull(); // removed from the sheet (§51)
  });

  it("Stats and Saves, Core Values & Combat are the server's values; Accuracy and Dodge are the terms (no To-Hit / Evasion)", async () => {
    client.getSheet.mockResolvedValue(sheetFixture());
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-1");
    expect(["STR", "AGI", "CON", "PER", "RES", "PRO"].map((s) => screen.getByTestId(`sheet-stat-${s}`).textContent)).toEqual(["3", "4", "5", "6", "7", "8"]);
    expect(screen.getByTestId("sheet-save-PRO").textContent).toBe("+8");
    const core = (k: string) => screen.getByTestId(`sheet-core-${k}`).textContent;
    expect([core("die"), core("dc"), core("accuracy"), core("armor"), core("dodge"), core("initiative"), core("movement"), core("range")]).toEqual([
      "Character Died8",
      "Character DC13",
      "Accuracy+2",
      "Armor1",
      "Dodge11",
      "Initiative+6.5",
      "Movement25 ft",
      "Sight (Range)90 ft",
    ]);
    const sheetText = screen.getByTestId("character-sheet").textContent ?? "";
    expect(sheetText).not.toMatch(/To-Hit|Evasion/);
    // Concentration: Current / Max, unavailable with the server's reason — never a checkbox grid.
    const conc = screen.getByTestId("sheet-core-concentration");
    expect(conc.textContent).toContain("Unavailable: Concentration capacity: this Release defines no rule for it yet");
    expect(within(conc).queryByRole("checkbox")).toBeNull();
  });

  it("Skills: every Release Skill once (Performance included), equal rows, server score and T / E / M markers", async () => {
    client.getSheet.mockResolvedValue(sheetFixture());
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-1");
    const rows = screen.getAllByTestId("sheet-skill");
    expect(rows.map((r) => r.getAttribute("data-skill"))).toEqual(["Arcana", "Athletics", "Performance", "Stealth"]);
    const row = (name: string) => rows.find((r) => r.getAttribute("data-skill") === name) as HTMLElement;
    expect(within(row("Arcana")).getByTestId("sheet-skill-score").textContent).toBe("+6");
    expect(["TRAINED", "EXPERT", "MASTER"].map((k) => within(row("Athletics")).getByTestId(`sheet-skill-rank-${k}`).getAttribute("data-held"))).toEqual(["true", "true", "false"]);
    expect(within(row("Performance")).getByTestId("sheet-skill-score").textContent).toBe("+0");
    expect(within(row("Stealth")).getByRole("img", { name: "Trained: yes" })).toBeTruthy();
    expect(within(row("Arcana")).getByRole("link", { name: "Arcana" }).getAttribute("href")).toBe("/compendium/rulesets/rs1/releases/rel1/entities/arcana");
  });

  it("Affinity Profile: every owned Affinity with rank and Authority; Strengths / Weaknesses grow past three", async () => {
    client.getSheet.mockResolvedValue(sheetFixture());
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-2");
    expect(screen.getAllByTestId("sheet-affinity-row").map((r) => r.textContent)).toEqual([
      "Evocation — Primary, Expert · Authority available (needs Trained)",
      "Conjuration — Secondary, Trained · Authority available (needs Trained)",
    ]);
    expect(within(screen.getByTestId("sheet-strengths")).getAllByRole("listitem")).toHaveLength(4);
    expect(within(screen.getByTestId("sheet-weaknesses")).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Healing — +30% activation (Major) (Evocation)", "Direct Damage — +20% activation (Moderate) (Conjuration)"]);
  });

  it("intentional empty states and integration boundaries: effects, equipment, attunement, carry, possessions, notes", async () => {
    client.getSheet.mockResolvedValue(sheetFixture());
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-2");
    expect(screen.getByTestId("sheet-effects-empty").textContent).toBe("No current granted effects.");
    expect(screen.getByTestId("sheet-equipment-slots").getAttribute("data-available")).toBe("false");
    expect(screen.getByTestId("sheet-accessory-slots").textContent).toMatch(/Attunement, which this Release does not define yet/);
    expect(screen.getByTestId("sheet-attunement-max").textContent).toContain("—");
    expect(screen.getByTestId("sheet-carry-weight").textContent).toContain("—");
    expect(screen.getByTestId("sheet-possessions-empty").textContent).toBe("No possessions recorded.");
    expect(screen.getByTestId("sheet-action-notes").getAttribute("placeholder")).toBe("No action notes yet.");
    expect(screen.getByTestId("portrait-placeholder")).toBeTruthy();
  });
});

describe("M6-WO5 interaction (§29–§35, §44, §63)", () => {
  it("resource edits send ONLY the current value at the loaded play-state version; bounds disable the steppers", async () => {
    const base = sheetFixture();
    client.getSheet.mockResolvedValue(base);
    client.updatePlayState.mockImplementation(async (_id: string, version: number, values: Record<string, number>) => ({ ...base, playStateVersion: version + 1, resources: base.resources.map((r) => (r.resourceKey in values ? { ...r, current: values[r.resourceKey] as number } : r)) }));
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-1");
    fireEvent.click(screen.getByRole("button", { name: "Decrease HP (Health)" }));
    await waitFor(() => expect(client.updatePlayState).toHaveBeenCalledWith("c1", 3, { HP: 11 }));
    await waitFor(() => expect(screen.getByLabelText("Current HP (Health)")).toHaveProperty("value", "11"));
    fireEvent.click(screen.getByRole("button", { name: "Decrease Counter Actions" }));
    await waitFor(() => expect(client.updatePlayState).toHaveBeenLastCalledWith("c1", 4, { COUNTER_ACTION: 0 }));
    const hp = screen.getByLabelText("Current HP (Health)");
    fireEvent.change(hp, { target: { value: "7" } });
    fireEvent.blur(hp);
    await waitFor(() => expect(client.updatePlayState).toHaveBeenLastCalledWith("c1", 5, { HP: 7 }));
    expect(screen.getByRole("button", { name: "Increase MP (Mana)" })).toHaveProperty("disabled", true); // at the server maximum
    expect(screen.getByTestId("sheet-resource-max-HP").textContent).toBe("/ 18");
  });

  it("a refused value shows the server's message; a stale write reloads the sheet", async () => {
    const { CharacterApiError } = await import("../../app/characters/_lib/character-client");
    client.getSheet.mockResolvedValue(sheetFixture());
    client.updatePlayState.mockRejectedValueOnce(new CharacterApiError("CHARACTER.INVALID_PLAY_STATE", "resources.HP: HP cannot exceed its maximum 18", 422)).mockRejectedValueOnce(new CharacterApiError("CHARACTER.STALE_WRITE", "changed", 409));
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-1");
    fireEvent.click(screen.getByRole("button", { name: "Increase HP (Health)" }));
    expect((await screen.findByTestId("sheet-resource-message")).textContent).toBe("resources.HP: HP cannot exceed its maximum 18 (CHARACTER.INVALID_PLAY_STATE)");
    fireEvent.click(screen.getByRole("button", { name: "Increase HP (Health)" }));
    await waitFor(() => expect(screen.getByTestId("sheet-resource-message").textContent).toMatch(/changed elsewhere/));
    expect(client.getSheet).toHaveBeenCalledTimes(2);
  });

  it("Company / PAC, Action Notes, Character Notes and possessions autosave together as text only", async () => {
    const base = sheetFixture();
    client.getSheet.mockResolvedValue(base);
    client.updateSheetNotes.mockImplementation(async (_id: string, version: number, n: Record<string, unknown>) => ({ ...base, notes: { ...base.notes, ...(n as object), version: version + 1 } }));
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-1");
    fireEvent.change(screen.getByTestId("sheet-action-notes"), { target: { value: "Strike: 2 AP, then Dodge" } });
    fireEvent.change(screen.getByTestId("sheet-character-notes"), { target: { value: "Owes the harbormaster" } });
    fireEvent.click(screen.getByRole("button", { name: "Add possession" }));
    fireEvent.change(screen.getByLabelText("Item of possession 1"), { target: { value: "Rope" } });
    await settle();
    expect(client.updateSheetNotes).toHaveBeenCalledTimes(1);
    expect(client.updateSheetNotes).toHaveBeenCalledWith("c1", 0, { companyPac: "Harbor Watch", actionNotes: "Strike: 2 AP, then Dodge", characterNotes: "Owes the harbormaster", possessions: [{ category: "", item: "Rope", weight: "" }] });
    await waitFor(() => expect(screen.getByTestId("sheet-notes-status").textContent).toBe("All notes saved."));
    expect(client.updatePlayState).not.toHaveBeenCalled();
  });
});

describe("M6-WO5 portrait (§9–§15)", () => {
  it("framing preserves the aspect ratio (cover-fit, never stretched) and offsets select the visible overflow", () => {
    const wide = framedImageBox({ width: 800, height: 400 }, 3 / 4, DEFAULT_FRAMING);
    expect(wide.heightPct).toBe(100);
    expect(wide.widthPct / wide.heightPct).toBeCloseTo((800 / 400) / (3 / 4));
    expect(wide.leftPct).toBeCloseTo(-(wide.widthPct - 100) / 2);
    const tall = framedImageBox({ width: 300, height: 900 }, 3 / 4, { zoom: 2, offsetX: -1, offsetY: 1 });
    expect(tall.widthPct).toBe(200);
    expect((tall.widthPct / tall.heightPct) * (3 / 4)).toBeCloseTo(300 / 900);
    expect(tall.leftPct).toBe(-0); // offsetX −1 → the left edge
    expect(tall.topPct).toBeCloseTo(-(tall.heightPct - 100)); // offsetY 1 → the bottom edge
    const dragged = dragFraming(DEFAULT_FRAMING, wide, { width: 240, height: 320 }, 1000, 0);
    expect(dragged).toEqual({ zoom: 1, offsetX: -1, offsetY: 0 }); // clamped, never beyond the image
  });

  it("the stored portrait is shown through its saved framing; the editor saves framing numbers only", async () => {
    const base = sheetFixture({ portrait: { hasImage: true, mimeType: "image/png", width: 600, height: 800, zoom: 1.5, offsetX: 0.2, offsetY: -0.4, version: 2, imageUrl: "/api/characters/c1/portrait/image?v=abc", maxBytes: 8 * 1024 * 1024 } });
    client.getSheet.mockResolvedValue(base);
    client.updatePortraitTransform.mockResolvedValue({ ...base, portrait: { ...base.portrait, zoom: 2, version: 3 } });
    render(<CharacterSheet characterId="c1" />);
    const img = (await screen.findAllByTestId("portrait-image"))[0] as HTMLImageElement;
    expect([img.getAttribute("src"), img.dataset.zoom, img.dataset.offsetX, img.dataset.offsetY]).toEqual(["/api/characters/c1/portrait/image?v=abc", "1.5", "0.2", "-0.4"]);
    expect(img.style.width).toBe("150%");
    fireEvent.click(screen.getByRole("button", { name: "Edit portrait" }));
    const dialog = screen.getByRole("dialog", { name: "Character portrait" });
    fireEvent.change(within(dialog).getByLabelText("Zoom"), { target: { value: "2" } });
    fireEvent.keyDown(within(dialog).getByTestId("portrait-editor-frame"), { key: "ArrowLeft" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save framing" }));
    await waitFor(() => expect(client.updatePortraitTransform).toHaveBeenCalledTimes(1));
    const [id, version, framing] = client.updatePortraitTransform.mock.calls[0] as [string, number, { zoom: number; offsetX: number; offsetY: number }];
    expect([id, version, framing.zoom]).toEqual(["c1", 2, 2]);
    expect(Object.keys(framing).sort()).toEqual(["offsetX", "offsetY", "zoom"]);
    expect(framing.offsetX).toBeLessThan(0.2);
    expect(client.uploadPortrait).not.toHaveBeenCalled();
  });

  it("uploads go to the server; an oversized file is refused before upload; remove returns the placeholder", async () => {
    const base = sheetFixture();
    const uploaded = { ...base, portrait: { ...base.portrait, hasImage: true, mimeType: "image/png", width: 10, height: 10, version: 1, imageUrl: "/api/characters/c1/portrait/image?v=1" } };
    client.getSheet.mockResolvedValue(base);
    client.uploadPortrait.mockResolvedValue(uploaded);
    client.removePortrait.mockResolvedValue({ ...base, portrait: { ...base.portrait, version: 2 } });
    render(<CharacterSheet characterId="c1" />);
    await screen.findByTestId("sheet-page-1");
    fireEvent.click(screen.getByRole("button", { name: "Add portrait" }));
    const input = screen.getByLabelText("Upload portrait image");
    expect(input.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
    const huge = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [huge] } });
    expect((await screen.findByTestId("portrait-message")).textContent).toMatch(/larger than 8 MB/);
    expect(client.uploadPortrait).not.toHaveBeenCalled();
    const small = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload portrait image"), { target: { files: [small] } });
    await waitFor(() => expect(client.uploadPortrait).toHaveBeenCalledWith("c1", 0, small));
    fireEvent.click(await screen.findByRole("button", { name: "Remove portrait" }));
    await waitFor(() => expect(client.removePortrait).toHaveBeenCalledWith("c1", 1));
    expect(await screen.findByTestId("portrait-placeholder")).toBeTruthy();
  });
});

describe("M6-WO5 print view (§75–§76, §114)", () => {
  it("renders the two pages with no buttons, inputs, links or textareas", async () => {
    client.getSheet.mockResolvedValue(sheetFixture({ notes: { ...sheetFixture().notes, actionNotes: "Strike", characterNotes: "Owes a favor", possessions: [{ category: "Tools", item: "Rope", weight: "2" }], version: 1 } }));
    render(<CharacterSheet characterId="c1" mode="print" />);
    const sheet = await screen.findByTestId("character-sheet");
    expect(sheet.getAttribute("data-mode")).toBe("print");
    expect(within(sheet).queryAllByRole("button")).toEqual([]);
    expect(within(sheet).queryAllByRole("textbox")).toEqual([]);
    expect(within(sheet).queryAllByRole("link")).toEqual([]);
    expect(screen.getByTestId("sheet-action-notes").textContent).toContain("Strike");
    expect(screen.getByTestId("sheet-company").textContent).toBe("Harbor Watch");
    expect(screen.queryByTestId("sheet-page-supplement")).toBeNull();
  });

  it("overflowing text and possessions continue on a supplemental page instead of being clipped", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n");
    const possessions = Array.from({ length: 15 }, (_, i) => ({ category: "Gear", item: `Item ${i + 1}`, weight: "1" }));
    client.getSheet.mockResolvedValue(sheetFixture({ notes: { ...sheetFixture().notes, actionNotes: long, possessions, version: 1 } }));
    render(<CharacterSheet characterId="c1" mode="print" />);
    const supplement = await screen.findByTestId("sheet-page-supplement");
    expect(screen.getByTestId("sheet-action-notes").getAttribute("data-overflow")).toBe("true");
    expect(screen.getByText("Action Notes continue on the supplemental page.")).toBeTruthy();
    expect(supplement.textContent).toContain("Line 40");
    expect(supplement.textContent).toContain("Item 15");
    expect(screen.getAllByTestId("sheet-possession")).toHaveLength(11);
  });
});
