import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardDto, GeneralActionSectionDto } from "../../app/characters/_lib/card-types";
import type { CharacterAttackDto } from "../../app/characters/_lib/character-client";
import { filterEntries, findEntry, libraryEntries } from "../../app/characters/_lib/card-format";
import { sheetFixture } from "./m6-wo5-sheet-fixture";
import { CHARACTER_ID, MANEUVER_ID, RETIRED_SPELL_ID, SPELL_ID, cardWorld } from "./m6-wo9-card-world";

/**
 * PAS-10 M6-WO9 Phase C — Card Library, Card Viewer, progression drawer, Action Directory, print pages and Character
 * Sheet links. The Character API client is mocked with cards produced by the REAL @prowess/game projections (see
 * m6-wo9-card-world.ts): these tests prove PRESENTATION — every value shown is the server's, generated language is shown
 * verbatim, history is never presented as usable and nothing is computed in Studio.
 */
vi.setConfig({ testTimeout: 120_000 });
const client = vi.hoisted(() => ({ getCardLibrary: vi.fn(), getActionDirectory: vi.fn(), getSheet: vi.fn(), updatePlayState: vi.fn(), updateSheetNotes: vi.fn() }));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { CardLibrary } = await import("../../app/characters/_components/cards/CardLibrary");
const { CardViewer } = await import("../../app/characters/_components/cards/CardViewer");
const { ActionDirectory } = await import("../../app/characters/_components/cards/ActionDirectory");
const { PrintCardPages } = await import("../../app/characters/_components/cards/PrintCard");
const { CharacterSheet } = await import("../../app/characters/_components/sheet/CharacterSheet");

const world = cardWorld();
const lib = world.library;
const entries = libraryEntries(lib);
const dodge = lib.actions.cards.find((c) => c.section.actionKey === "DODGE_ACTION")!;

beforeEach(() => {
  for (const f of Object.values(client)) f.mockReset();
  client.getCardLibrary.mockResolvedValue(structuredClone(lib));
  client.getActionDirectory.mockResolvedValue(structuredClone(world.directory));
  window.history.replaceState(null, "", "/characters/x/cards");
});

async function openLibrary(query: Record<string, string | null> = {}) {
  render(<CardLibrary characterId={CHARACTER_ID} query={query} />);
  await screen.findByTestId("card-library");
}
const viewer = () => screen.getByTestId("card-viewer");
const texts = (els: HTMLElement[]) => els.map((e) => e.textContent ?? "");

describe("1–2 · Character Card Library contents and identity", () => {
  it("lists only the cards usable now by default: current Spell and Maneuver, held Weapons, Attacks, General Actions, and the Mage Art domain", async () => {
    await openLibrary();
    expect(client.getCardLibrary).toHaveBeenCalledWith(CHARACTER_ID);
    const rows = screen.getAllByTestId("card-entry");
    const states = new Set(rows.map((r) => r.getAttribute("data-state")));
    expect([...states].sort()).toEqual(["ACTIVE", "AVAILABLE", "EQUIPPED", "UNAVAILABLE"]);
    const keys = rows.map((r) => r.getAttribute("data-key"));
    expect(keys).toContain(lib.spells[0]!.current!.card!.cardKey);
    expect(keys).toContain(lib.maneuvers[0]!.current!.card!.cardKey);
    expect(keys).not.toContain(lib.spells[0]!.draft!.card!.cardKey);
    expect(keys).not.toContain(lib.spells[0]!.history[0]!.card!.cardKey);
    expect(keys).not.toContain(lib.spells[1]!.current!.card!.cardKey); // retired
    for (const c of [...lib.weapons, ...lib.attacks, ...lib.actions.cards]) expect(keys).toContain(c.cardKey);
    expect(keys).toContain("MAGE_ART:domain");
    expect(rows.length).toBe(2 + lib.weapons.length + lib.attacks.length + lib.actions.cards.length + 1);
  });

  it("drafts, retired Abilities and history are opt-in and always labelled as not usable", async () => {
    await openLibrary();
    fireEvent.click(screen.getByTestId("cards-history"));
    const byKey = (k: string) => screen.getAllByTestId("card-entry").find((r) => r.getAttribute("data-key") === k)!;
    expect(byKey(lib.spells[0]!.draft!.card!.cardKey)).toHaveTextContent("Draft — not usable");
    expect(byKey(lib.spells[0]!.history[0]!.card!.cardKey)).toHaveTextContent("Historical revision — not usable");
    expect(byKey(lib.spells[1]!.current!.card!.cardKey)).toHaveTextContent("Retired — not usable");
    expect(byKey(`SIGNATURE_SPELL:${SPELL_ID}:r0`)).toHaveTextContent("Unreadable revision");
  });

  it("filters by category and searches by card name (presentation only)", async () => {
    await openLibrary();
    fireEvent.change(screen.getByTestId("cards-category"), { target: { value: "GENERAL_ACTION" } });
    expect(screen.getAllByTestId("card-entry").every((r) => r.getAttribute("data-category") === "GENERAL_ACTION")).toBe(true);
    fireEvent.change(screen.getByTestId("cards-search"), { target: { value: "dodge" } });
    expect(screen.getAllByTestId("card-entry").map((r) => r.getAttribute("data-key"))).toEqual([dodge.cardKey]);
    fireEvent.change(screen.getByTestId("cards-search"), { target: { value: "no such card" } });
    expect(screen.getByTestId("cards-empty")).toBeInTheDocument();
  });

  it("an unknown card key opens nothing — no fallback to another card, revision or Character", async () => {
    await openLibrary({ card: "SIGNATURE_SPELL:not-mine:1" });
    expect(screen.getByTestId("cards-not-found")).toBeInTheDocument();
    expect(screen.queryByTestId("card-viewer")).toBeNull();
    expect(findEntry(entries, { ability: "00000000-0000-4000-8000-00000000dead" })).toBeNull();
    // ?ability= opens the CURRENT revision only — never a draft or history.
    expect(findEntry(entries, { ability: SPELL_ID })?.key).toBe(lib.spells[0]!.current!.card!.cardKey);
  });
});

describe("3–6 · cards show the evaluated authority", () => {
  const openCard = async (key: string, mode = "tactical") => {
    await openLibrary({ card: key, mode });
    return viewer();
  };
  it("Spell and Maneuver cards show the server's final AP / MP and its generated instructions verbatim", async () => {
    for (const card of [lib.spells[0]!.current!.card!, lib.maneuvers[0]!.current!.card!]) {
      const v = await openCard(card.cardKey);
      expect(within(v).getByTestId("card-ap")).toHaveTextContent(String((card.costs.ap as { value: number }).value));
      expect(within(v).getByTestId("card-mp")).toHaveTextContent(String((card.costs.mp as { value: number }).value));
      expect(texts(within(v).getAllByTestId("card-instruction"))).toEqual(card.instructions.blocks.map((b) => expect.stringContaining(b.text)));
      document.body.innerHTML = "";
    }
  });

  it("Attack cards show the loadout's hand and grip and every damage profile with its scaling steps", async () => {
    const card = lib.attacks.find((c) => c.section.equipped.hand === "MAIN_HAND")!;
    const v = await openCard(card.cardKey, "combined");
    expect(within(v).getAllByTestId("card-facts")[0]).toHaveTextContent("Main Hand · Two Handed");
    const damage = within(v).getByTestId("card-damage");
    for (const d of card.section.damage) {
      expect(damage).toHaveTextContent(d.final ?? "Unresolved");
      for (const s of d.steps) expect(damage).toHaveTextContent(s.detail);
    }
  });

  it("General Actions: legitimate values, typed chosen / source-set costs and a runtime-deferred movement grant", async () => {
    const move = lib.actions.cards.find((c) => c.section.actionKey === "MOVE")!;
    let v = await openCard(move.cardKey, "combined");
    expect(within(v).getAllByTestId("card-ap")[0]).toHaveTextContent("1");
    expect(within(v).getByTestId("card-movement")).toHaveTextContent("Deferred — the granted Movement is evaluated by the runtime");
    document.body.innerHTML = "";
    const cast = lib.actions.cards.find((c) => c.section.actionKey === "CAST_SPELL")!;
    v = await openCard(cast.cardKey, "combined");
    expect(within(v).getAllByTestId("card-ap")[0]).toHaveTextContent("—");
    expect(within(v).getAllByTestId("card-ap")[0]).toHaveAttribute("title", "Unavailable — the AP cost is set by the spell it is used for");
  });

  it("Mage Arts are an unavailable domain: no card, no cost, no evaluation", async () => {
    await openLibrary({ card: "MAGE_ART:domain" });
    const panel = screen.getByTestId("card-unavailable");
    expect(panel).toHaveTextContent("Unavailable.");
    expect(panel).toHaveTextContent("Mage Arts are reserved");
    expect(screen.queryByTestId("card-ap")).toBeNull();
  });
});

describe("7 · view modes and flipping", () => {
  it("switching modes keeps the exact card (and records it in the URL); flipping is a keyboard-operable toggle", async () => {
    const key = lib.spells[0]!.current!.card!.cardKey;
    await openLibrary({ card: key });
    expect(viewer()).toHaveAttribute("data-mode", "illustrated");
    expect(within(viewer()).getByTestId("card-art")).toHaveAttribute("data-art", "placeholder");
    expect(within(viewer()).getByTestId("card-full-instructions")).toBeInTheDocument();
    for (const mode of ["tactical", "flip", "combined", "print", "illustrated"]) {
      fireEvent.click(screen.getByTestId(`mode-${mode}`));
      expect(viewer()).toHaveAttribute("data-mode", mode);
      expect(viewer()).toHaveAttribute("data-card", key);
      expect(screen.getByTestId(`mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
      expect(new URL(window.location.href).searchParams.get("card")).toBe(key);
      expect(new URL(window.location.href).searchParams.get("mode")).toBe(mode);
    }
    fireEvent.click(screen.getByTestId("mode-flip"));
    const flip = screen.getByTestId("card-flip");
    expect(flip.tagName).toBe("BUTTON");
    expect(screen.getByTestId("card-front")).toBeInTheDocument();
    flip.focus();
    fireEvent.click(flip);
    expect(flip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("card-back")).toBeInTheDocument();
    expect(screen.queryByTestId("card-front")).toBeNull();
    expect(screen.getByText("Showing the back of the card")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mode-combined"));
    expect(screen.getByTestId("card-front")).toBeInTheDocument();
    expect(screen.getByTestId("card-back")).toBeInTheDocument();
  });

  it("the stylesheet honours reduced motion for the flip and the drawer", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/characters/_components/cards/cards.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.fcard-flip__face \{ animation: none; \} \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.fcard-drawer__panel \{ animation: none; \} \}/);
  });
});

describe("8 · Action improvements and the progression drawer", () => {
  it("the card shows the server's current AP; the drawer groups improvements Active → Conditional → Future → Unavailable / Unresolved", async () => {
    await openLibrary({ card: dodge.cardKey, mode: "tactical" });
    expect(within(viewer()).getByTestId("card-ap")).toHaveTextContent("2");
    const opener = screen.getByTestId("progression-open");
    opener.focus();
    fireEvent.click(opener);
    const drawer = screen.getByTestId("progression-drawer");
    const dialog = within(drawer).getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const groups = within(drawer).getAllByRole("region").map((g) => g.getAttribute("data-testid"));
    expect(groups).toEqual(["improvement-group-active", "improvement-group-conditional", "improvement-group-future", "improvement-group-blocked"]);
    const status = (key: string) => within(drawer).getAllByTestId("improvement-detail").find((el) => el.getAttribute("data-improvement") === key.toUpperCase().replace(" ", "_"));
    expect(status("Quick Dodge")).toHaveAttribute("data-status", "ACTIVE");
    expect(status("Close Guard")).toHaveAttribute("data-status", "CONDITIONAL");
    expect(status("Far Dodge")).toHaveAttribute("data-status", "FUTURE");
    expect(status("Titan Dodge")).toHaveAttribute("data-status", "UNAVAILABLE");
    // An unmet Skill rank with no authored acquisition path stays UNRESOLVED — never FUTURE.
    expect(status("Expert Dodge")).toHaveAttribute("data-status", "UNRESOLVED");
    expect(status("Expert Dodge")).toHaveTextContent("Not met — no authored progression path");
    expect(within(drawer).getByTestId("progression-directory-link")).toHaveAttribute("href", `/characters/${CHARACTER_ID}/actions?action=DODGE_ACTION`);
  });

  it("the drawer traps focus, closes on Escape and restores focus to its opener", async () => {
    await openLibrary({ card: dodge.cardKey, mode: "tactical" });
    const opener = screen.getByTestId("progression-open");
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    const close = screen.getByTestId("progression-close");
    expect(document.activeElement).toBe(close);
    const link = screen.getByTestId("progression-directory-link");
    link.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("progression-drawer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("progression states follow the server: the Level-1 directory shows Quick Dodge as FUTURE and Dodge at its authored 3 AP", async () => {
    client.getActionDirectory.mockResolvedValue(structuredClone(world.directoryLevel1));
    render(<ActionDirectory characterId={CHARACTER_ID} initialAction="DODGE_ACTION" />);
    const detail = await screen.findByTestId("directory-detail");
    expect(within(detail).getByTestId("directory-eligibility")).toHaveTextContent("AP now: 3 AP");
    expect(within(detail).getAllByTestId("improvement-detail").find((el) => el.getAttribute("data-improvement") === "QUICK_DODGE")).toHaveAttribute("data-status", "FUTURE");
    expect(within(detail).getByTestId("directory-card-link")).toHaveAttribute("href", `/characters/${CHARACTER_ID}/cards?card=${encodeURIComponent(dodge.cardKey)}`);
  });

  it("the Action Directory lists exactly the Release's ACTION Definitions, searches them and keeps exact sources", async () => {
    render(<ActionDirectory characterId={CHARACTER_ID} initialAction={null} />);
    await screen.findByTestId("action-directory");
    expect(screen.getAllByTestId("directory-entry").map((e) => e.getAttribute("data-action"))).toEqual(world.directory.directory.cards.map((c) => c.section.actionKey));
    fireEvent.change(screen.getByTestId("directory-search"), { target: { value: "sprint" } });
    expect(screen.getAllByTestId("directory-entry").map((e) => e.getAttribute("data-action"))).toEqual(["SPRINT"]);
    fireEvent.click(within(screen.getByTestId("directory-entry")).getByRole("button"));
    const detail = screen.getByTestId("directory-detail");
    expect(detail).toHaveTextContent("action.sprint");
    expect(detail).toHaveTextContent("This Release authors no improvements for this Action.");
    expect(new URL(window.location.href).searchParams.get("action")).toBe("SPRINT");
  });
});

describe("9 · generated rules language is shown verbatim (Save, chain, trigger)", () => {
  const renderCard = (card: CardDto, mode: "tactical" | "combined" = "combined") =>
    render(<CardViewer entry={{ key: card.cardKey, category: card.category, name: card.name, state: "ACTIVE", card, reason: null, abilityId: null, revisionNumber: 2 }} card={card} names={lib.names} release="R1" characterId={CHARACTER_ID} mode={mode} onMode={() => undefined} revisions={[]} onOpen={() => undefined} />);
  it("a Saving Throw names the defender's save and keeps the Effect's success / failure; the BRANCH chain is in order", () => {
    renderCard(world.chainCard);
    const shown = texts(screen.getAllByTestId("card-instruction"));
    const expected = world.chainCard.instructions.blocks.map((b) => b.text);
    for (const t of expected) expect(shown.some((s) => s.endsWith(t))).toBe(true);
    const all = shown.join(" ");
    expect(all).toContain("If the save fails, the Effect succeeds");
    expect(all).toContain("If the save succeeds, the Effect fails");
  });
  it("conditional transitions (triggers) and NOT_TRIGGERED wording are preserved", () => {
    renderCard(world.triggerCard);
    const all = texts(screen.getAllByTestId("card-instruction")).join(" ");
    for (const b of world.triggerCard.instructions.blocks) expect(all).toContain(b.text);
    expect(all).toMatch(/not triggered — not a failure/);
  });
  it("independent Maneuver groups are separate ordered blocks", () => {
    const card = lib.maneuvers[0]!.current!.card!;
    renderCard(card);
    const groups = screen.getAllByTestId("card-instruction").filter((el) => el.getAttribute("data-kind") === "GROUP");
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });
});

describe("10 · current versus historical revisions", () => {
  it("a historical revision opens with its own revision and provenance, labelled not usable, never re-evaluated as current", async () => {
    const old = lib.spells[0]!.history[0]!.card!;
    await openLibrary({ card: old.cardKey, mode: "combined" });
    expect(screen.getByTestId("viewer-state")).toHaveAttribute("data-state", "HISTORICAL");
    expect(screen.getByTestId("card-revision")).toHaveTextContent("Revision 1 · Historical");
    expect(within(viewer()).getAllByTestId("card-mp")[0]).toHaveTextContent(String((old.costs.mp as { value: number }).value));
    const nav = screen.getByTestId("card-revisions");
    expect(within(nav).getByText(/Revision 2 — Active/)).toBeInTheDocument();
    const other = within(nav).getAllByTestId("card-revision-link").find((b) => b.textContent?.includes("Revision 0"))!;
    expect(other).toBeDisabled();
    expect(other).toHaveTextContent("pinned to another Release");
    fireEvent.click(within(nav).getByText(/Revision 2 — Active/));
    expect(viewer()).toHaveAttribute("data-card", lib.spells[0]!.current!.card!.cardKey);
    expect(viewer()).toHaveAttribute("data-mode", "combined");
  });
  it("a retired Ability's ?ability link opens its last revision as RETIRED, not usable", async () => {
    await openLibrary({ ability: RETIRED_SPELL_ID });
    expect(screen.getByTestId("viewer-state")).toHaveAttribute("data-state", "RETIRED");
    expect(filterEntries(entries, { category: "ALL", search: "", includeHistory: false }).some((e) => e.abilityId === RETIRED_SPELL_ID)).toBe(false);
  });
});

describe("11 · Character Sheet card links", () => {
  it("Spell, Maneuver and Attack rows link to their exact cards; the Actions panel links the library and directory; print has no links", async () => {
    const attackCard = lib.attacks.find((c) => c.section.equipped.hand === "MAIN_HAND")!;
    const attack = { attackKey: attackCard.section.attackKey, hand: "MAIN_HAND", weapon: attackCard.section.weapon, attack: attackCard.section.attack, moveKey: attackCard.section.moveKey, grip: "TWO_HANDED", apCost: 2, mpCost: 0, damage: [], range: attackCard.section.range, resolution: { mode: "ATTACK_ROLL", onMiss: "NO_DAMAGE" }, accuracyModifier: 0, weaponProperties: [], moveProperties: [], notExecuted: [], eligibility: "ELIGIBLE" } as unknown as CharacterAttackDto;
    const sheet = sheetFixture();
    const withRows = {
      ...sheet,
      identity: { ...sheet.identity, id: CHARACTER_ID },
      weaponAttacks: [attack],
      signatureSpells: [{ id: SPELL_ID, name: "Ember Bolt", revisionNumber: 2, state: "VALID" as const, finalApCost: 3, finalMpCost: 13, targeting: null, range: null, effectFamilies: [], keywords: [], duration: null, deferred: [] }],
      signatureManeuvers: [{ id: MANEUVER_ID, name: "Twin Strike", revisionNumber: 2, state: "VALID" as const, actions: [], finalApCost: 3, finalMpCost: 0, effects: [], keywords: [], warnings: [] }],
    };
    client.getSheet.mockResolvedValue(withRows);
    const { unmount } = render(<CharacterSheet characterId={CHARACTER_ID} />);
    await screen.findByTestId("sheet-page-1");
    const spellHref = screen.getByTestId("sheet-spell-card").getAttribute("href")!;
    const maneuverHref = screen.getByTestId("sheet-maneuver-card").getAttribute("href")!;
    const attackHref = screen.getByTestId("sheet-attack-card").getAttribute("href")!;
    expect(spellHref).toBe(`/characters/${CHARACTER_ID}/cards?ability=${SPELL_ID}`);
    expect(maneuverHref).toBe(`/characters/${CHARACTER_ID}/cards?ability=${MANEUVER_ID}`);
    expect(screen.getByTestId("sheet-action-directory-link")).toHaveAttribute("href", `/characters/${CHARACTER_ID}/actions`);
    expect(screen.getByTestId("sheet-general-actions-link")).toHaveAttribute("href", `/characters/${CHARACTER_ID}/cards?category=GENERAL_ACTION`);
    // Each link resolves, by exact identity, to the right card.
    const q = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(findEntry(entries, q(spellHref))?.key).toBe(lib.spells[0]!.current!.card!.cardKey);
    expect(findEntry(entries, q(maneuverHref))?.key).toBe(lib.maneuvers[0]!.current!.card!.cardKey);
    expect(findEntry(entries, q(attackHref))?.key).toBe(attackCard.cardKey);
    unmount();
    render(<CharacterSheet characterId={CHARACTER_ID} mode="print" />);
    await screen.findByTestId("sheet-page-1");
    expect(screen.queryByTestId("sheet-spell-card")).toBeNull();
    expect(screen.queryByTestId("sheet-attack-card")).toBeNull();
    expect(screen.queryByTestId("sheet-card-links")).toBeNull();
  });
});

describe("12 · print pages (structure; real pagination is the browser suite)", () => {
  it("every mechanical block of a complex card is present across the pages, with snapshot identity on every page and duplex pairs", async () => {
    const card = lib.maneuvers[0]!.current!.card!;
    await act(async () => {
      render(<PrintCardPages card={card} names={lib.names} release="Card Test Ruleset — Release 1 (R1)" layout="card" />);
    });
    const pages = await screen.findAllByTestId("print-page");
    expect(pages.length % 2).toBe(0);
    expect(pages.map((p) => p.getAttribute("data-side"))).toEqual(pages.map((_, i) => (i % 2 === 0 ? expect.stringMatching(/front|blank/) : expect.stringMatching(/back|blank/))));
    const all = pages.map((p) => p.textContent ?? "").join(" ");
    for (const b of card.instructions.blocks) expect(all).toContain(b.text);
    for (const s of card.provenance.sources) expect(all).toContain(s.canonicalKey);
    for (const f of screen.getAllByTestId("print-footer")) expect(f).toHaveTextContent(card.snapshot.cardKey);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(document.querySelectorAll("details").length).toBe(0);
  });
  it("the combined layout pairs front and back on one sheet", async () => {
    await act(async () => {
      render(<PrintCardPages card={dodge} names={lib.names} release="R1" layout="combined" />);
    });
    for (const sheet of await screen.findAllByTestId("print-sheet")) expect(within(sheet).getAllByTestId("print-page")).toHaveLength(2);
  });
});

describe("13 · no client mechanics, no writes", () => {
  const dir = path.resolve(__dirname, "../../app/characters/_components/cards");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  const source = [...files.map((f) => readFileSync(path.join(dir, f), "utf8")), readFileSync(path.resolve(__dirname, "../../app/characters/_lib/card-format.ts"), "utf8")].join("\n");
  it("card UI imports no database, Prisma or domain package and calls only the two read-only GET clients", () => {
    expect(source).not.toMatch(/@prowess\/(db|game|rules)|prisma/i);
    const calls = [...source.matchAll(/\b(get|update|create|finalize|retire|rebuild|validate|upload|remove)[A-Z]\w*\(/g)].map((m) => m[0]);
    const clientCalls = calls.filter((c) => /^(getCardLibrary|getActionDirectory|update|create|finalize|retire|rebuild|validate|upload|remove)/.test(c));
    expect(new Set(clientCalls)).toEqual(new Set(["getCardLibrary(", "getActionDirectory("]));
    expect(source).not.toMatch(/method:\s*"(POST|PUT|DELETE)"/);
  });
  it("no cost, eligibility or progression is computed from card values (only displayed)", () => {
    expect(source).not.toMatch(/\.value\s*[-+*/]\s*\d|\d\s*[-+*/]\s*[a-z.]*\.value\b/);
    expect(source).not.toMatch(/finalApCost|finalMpCost/);
    // The AP shown for an Action is the card's own value: Dodge shows the server's overridden 2, from its breakdown authority.
    expect((dodge.section as GeneralActionSectionDto).improvements.find((i) => i.improvementKey === "QUICK_DODGE")?.status).toBe("ACTIVE");
    expect(dodge.costs.ap).toEqual({ status: "AVAILABLE", value: 2 });
  });
});

describe("loading and error states", () => {
  it("shows a loading status, then an error with retry", async () => {
    client.getCardLibrary.mockRejectedValueOnce(new Error("boom"));
    render(<CardLibrary characterId={CHARACTER_ID} query={{}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the Card Library");
    await waitFor(() => expect(screen.getByTestId("cards-error")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Try again"));
    await screen.findByTestId("card-library");
  });
});
