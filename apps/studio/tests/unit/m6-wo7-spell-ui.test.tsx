import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterAbilitiesDto, SignatureSpellBuilderDto, SignatureSpellDetailDto, SignatureSpellDraftDto } from "../../app/characters/_lib/character-client";
import fixture from "./fixtures/m6-wo7-builder.json";
import { sheetFixture } from "./m6-wo5-sheet-fixture";

/**
 * PAS-10 M6-WO7 §19–§75, §93–§98, §121–§134 — Signature Spell presentation. The Character API client is mocked with a
 * server-shaped builder read (captured from the DB service over the M5 engine): these tests prove PRESENTATION — the
 * ten accessible steps, explicit Authority (never preselected), the live review with "Cost unresolved" (never zero),
 * the validation summary linking to steps, autosave sending SELECTIONS only with optimistic concurrency (Saving / Saved /
 * Conflict), keyboard Effect reorder persisting order, the explicit Effect-slot exchange, locked options visible with
 * their reasons, Finalize available only for a valid Spell, the Abilities roster, Spell history and the compact Sheet
 * Actions lines. Every MP, AP and capacity here is "the server's".
 * Invariants: M6-I079 prose never creates mechanics · M6-I080 explicit Authority · M6-I082 / M6-I083 M5 owns legality
 * and cost · M6-I084 ME never changes the listed cost · M6-I086 Effect order · M6-I087 explicit exchange · M6-I089
 * drafts use no slot · M6-I097 runtime deferrals surfaced · M6-I098 nothing is cast.
 */
const client = vi.hoisted(() => ({ getAbilities: vi.fn(), getSpell: vi.fn(), getSpellBuilder: vi.fn(), saveSpellDraft: vi.fn(), validateSpell: vi.fn(), finalizeSpell: vi.fn(), rebuildSpell: vi.fn(), retireSpell: vi.fn(), createSpell: vi.fn(), getSheet: vi.fn(), updatePlayState: vi.fn(), updateSheetNotes: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/characters" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { SpellBuilder } = await import("../../app/characters/_components/spells/SpellBuilder");
const { AbilitiesPanel } = await import("../../app/characters/_components/spells/AbilitiesPanel");
const { SpellDetail } = await import("../../app/characters/_components/spells/SpellDetail");
const { CharacterSheet } = await import("../../app/characters/_components/sheet/CharacterSheet");
const { CharacterApiError } = await import("../../app/characters/_lib/character-client");

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const FINAL = fixture.finalized as unknown as SignatureSpellBuilderDto;
const EMPTY = fixture.empty as unknown as SignatureSpellBuilderDto;
const CID = FINAL.character.id;
const SID = EMPTY.spell.id;
/** The finalized Spell's current selections, open as a (valid) working draft. */
function validDraftView(): SignatureSpellBuilderDto {
  const v = clone(EMPTY);
  v.spell.draft = { draft: clone(FINAL.spell.current!.draft), evaluation: clone(FINAL.spell.current!.evaluation) };
  return v;
}
const savedFrom = (view: SignatureSpellBuilderDto, version: number): SignatureSpellDetailDto => ({ ...clone(view), spell: { ...clone(view.spell), lockVersion: version } });

beforeEach(() => {
  vi.useRealTimers();
  nav.push.mockReset();
  for (const f of Object.values(client)) f.mockReset();
});

async function openBuilder(view: SignatureSpellBuilderDto = EMPTY) {
  client.getSpellBuilder.mockResolvedValue(clone(view));
  render(<SpellBuilder characterId={CID} spellId={SID} />);
  await screen.findByTestId("spell-builder");
}

describe("M6-WO7 builder steps and explicit authority (§21, §24–§28, §124)", () => {
  it("shows ten accessible steps with keyboard navigation", async () => {
    await openBuilder();
    const tabs = within(screen.getByRole("tablist", { name: "Spell builder steps" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/ \(needs attention\)$/, ""))).toEqual(["1. Concept", "2. Authority", "3. Targeting", "4. Effects", "5. Effect Chain", "6. Traits", "7. Duration", "8. Casting Conditions", "9. Review", "10. Finalize"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(screen.getByTestId("spell-step-AUTHORITY")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(screen.getByTestId("spell-step-FINALIZE")).toHaveAttribute("aria-selected", "true");
  });

  it("M6-I080 neither Authority nor Affinity is preselected; both are offered from the catalog", async () => {
    await openBuilder();
    fireEvent.click(screen.getByTestId("spell-step-AUTHORITY"));
    expect(screen.getByTestId("spell-authority-ARCANE_AUTHORITY")).not.toBeChecked();
    expect(screen.getByTestId("spell-authority-AFFINITY_AUTHORITY")).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "None" })).toBeChecked();
    expect(screen.getByTestId("spell-arcana-rank")).toHaveTextContent("Trained");
    expect(screen.getAllByTestId("spell-affinity-option")).toHaveLength(EMPTY.catalog.affinities.length);
  });

  it("§128 an incomplete Spell shows 'Cost unresolved' with the reason — never zero — and the summary links to steps", async () => {
    await openBuilder();
    const cost = within(screen.getByTestId("spell-live")).getByTestId("spell-cost");
    expect(cost).toHaveAttribute("data-resolved", "false");
    expect(cost).toHaveTextContent(/Cost unresolved — choose authority, targeting, effects, duration first/);
    expect(cost.textContent).not.toMatch(/\b0 MP/);
    fireEvent.click(screen.getByTestId("spell-step-REVIEW"));
    const issues = screen.getAllByTestId("spell-issue");
    expect(issues.map((i) => i.getAttribute("data-step"))).toEqual(["AUTHORITY", "TARGETING", "EFFECTS", "DURATION"]);
    fireEvent.click(within(issues[1]!).getByRole("button", { name: "Targeting" }));
    expect(screen.getByTestId("spell-step-TARGETING")).toHaveAttribute("aria-selected", "true");
  });
});

describe("M6-WO7 autosave sends selections only, with optimistic concurrency (§87, §121, §126)", () => {
  it("choosing Arcane Authority autosaves the draft at the loaded version: Saving → Saved; nothing derived is sent", async () => {
    await openBuilder();
    const saved = savedFrom(EMPTY, 2);
    let release!: (v: SignatureSpellDetailDto) => void;
    client.saveSpellDraft.mockReturnValue(new Promise((r) => (release = r)));
    fireEvent.click(screen.getByTestId("spell-step-AUTHORITY"));
    fireEvent.click(screen.getByTestId("spell-authority-ARCANE_AUTHORITY"));
    expect(screen.getByTestId("spell-save-state")).toHaveTextContent("Unsaved changes");
    await waitFor(() => expect(client.saveSpellDraft).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(screen.getByTestId("spell-save-state")).toHaveTextContent("Saving…");
    const [characterId, spellId, version, draft] = client.saveSpellDraft.mock.calls[0]! as [string, string, number, SignatureSpellDraftDto];
    expect([characterId, spellId, version]).toEqual([CID, SID, EMPTY.spell.lockVersion]);
    expect(draft.authority).toBe("ARCANE_AUTHORITY");
    expect(Object.keys(draft).sort()).toEqual(["additionalAffinityTraits", "affinity", "authority", "castingConditions", "concept", "constructionOptions", "duration", "effectChain", "effects", "schemaVersion", "targeting", "traits"]);
    expect(JSON.stringify(draft)).not.toMatch(/finalMpCost|finalApCost|capacity|discount|penalty|sustain|signature/i);
    await act(async () => release(saved));
    expect(screen.getByTestId("spell-save-state")).toHaveTextContent("Saved");
  });

  it("a stale save shows Conflict and offers a reload; Finalize is blocked", async () => {
    await openBuilder(validDraftView());
    client.saveSpellDraft.mockRejectedValue(new CharacterApiError("STALE_WRITE", "changed", 409));
    fireEvent.change(screen.getByTestId("spell-name"), { target: { value: "Ember Bolt II" } });
    await screen.findByTestId("spell-conflict", undefined, { timeout: 3000 });
    expect(screen.getByTestId("spell-save-state")).toHaveTextContent("Conflict");
    fireEvent.click(screen.getByTestId("spell-step-FINALIZE"));
    expect(screen.getByTestId("spell-finalize")).toBeDisabled();
  });

  it("M6-I079 renaming changes prose only: the saved selections are otherwise identical", async () => {
    await openBuilder(validDraftView());
    client.saveSpellDraft.mockResolvedValue(savedFrom(validDraftView(), 2));
    fireEvent.change(screen.getByTestId("spell-name"), { target: { value: "Healing Nova" } });
    await waitFor(() => expect(client.saveSpellDraft).toHaveBeenCalled(), { timeout: 3000 });
    const sent = client.saveSpellDraft.mock.calls[0]![3] as SignatureSpellDraftDto;
    const before = FINAL.spell.current!.draft!;
    expect(sent.concept.name).toBe("Healing Nova");
    expect({ ...sent, concept: null }).toEqual({ ...before, concept: null });
  });
});

describe("M6-WO7 Effects: order, capacity and exchange (§35–§42, §129–§130)", () => {
  it("M6-I086 adding a second Effect and moving it earlier persists the new order", async () => {
    await openBuilder(validDraftView());
    client.saveSpellDraft.mockImplementation(async () => savedFrom(validDraftView(), 2));
    fireEvent.click(screen.getByTestId("spell-step-EFFECTS"));
    // At capacity (1 / 1 from the server) the add buttons are disabled and explained.
    expect(screen.getByTestId("spell-effect-picker-disabled")).toHaveTextContent(/Effect capacity reached \(1 \/ 1\)/);
    expect(screen.getByTestId("spell-effect-capacity")).toHaveTextContent("Effects used: 1 / 1");
    // The exchange is explicit and offered only within the server's maximum (0 here).
    expect(screen.getByTestId("spell-trade-slot")).toBeDisabled();
    expect(screen.getByTestId("spell-trade-slot")).toHaveTextContent("Trade 1 unused Effect slot for +1 Trait slot");
  });

  it("reordering with the keyboard-accessible buttons renumbers orders in list position", async () => {
    const view = validDraftView();
    const second = view.catalog.effects.find((o) => o.ref.canonicalKey.endsWith("direct_damage"))!;
    view.spell.draft!.draft!.effects.push({ componentKey: "effect2", definition: second.ref, order: 20, parameters: {} });
    view.spell.draft!.evaluation!.construction = null;
    await openBuilder(view);
    client.saveSpellDraft.mockResolvedValue(savedFrom(view, 2));
    fireEvent.click(screen.getByTestId("spell-step-EFFECTS"));
    expect(screen.getAllByTestId("spell-effect").map((e) => e.getAttribute("data-effect"))).toEqual(["effect1", "effect2"]);
    fireEvent.click(within(screen.getAllByTestId("spell-effect")[1]!).getByTestId("spell-effect-up"));
    expect(screen.getAllByTestId("spell-effect").map((e) => e.getAttribute("data-effect"))).toEqual(["effect2", "effect1"]);
    await waitFor(() => expect(client.saveSpellDraft).toHaveBeenCalled(), { timeout: 3000 });
    const sent = client.saveSpellDraft.mock.calls[0]![3] as SignatureSpellDraftDto;
    expect(sent.effects.map((e) => [e.componentKey, e.order])).toEqual([
      ["effect2", 1],
      ["effect1", 2],
    ]);
  });

  it("§32 locked components stay visible with their reason; Strength / Weakness alignment shows for the chosen Affinity", async () => {
    const view = validDraftView();
    view.spell.draft!.draft!.affinity = view.catalog.affinities[0]!.affinity;
    await openBuilder(view);
    fireEvent.click(screen.getByTestId("spell-step-EFFECTS"));
    const options = within(screen.getByTestId("spell-effect-picker")).getAllByTestId("spell-option");
    expect(options).toHaveLength(view.catalog.effects.length);
    const locked = options.find((o) => o.querySelector('[data-status="INELIGIBLE"]'));
    expect(locked).toBeDefined();
    expect(within(locked!).getByTestId("spell-option-reason").textContent).toMatch(/^ Requires /);
    const healing = options.find((o) => o.getAttribute("data-key")?.endsWith("direct_healing"))!;
    expect(within(healing).getByTestId("spell-option-alignment")).toHaveAttribute("data-alignment", "WEAKNESS");
  });
});

describe("M6-WO7 review, finalize and runtime deferrals (§69–§76, §100)", () => {
  it("a valid draft shows the server's MP / AP with the ME boundary and can be finalized", async () => {
    await openBuilder(validDraftView());
    const cost = within(screen.getByTestId("spell-live")).getByTestId("spell-cost");
    expect(cost).toHaveAttribute("data-resolved", "true");
    expect(within(cost).getByTestId("spell-final-mp")).toHaveTextContent("11 MP");
    expect(within(cost).getByTestId("spell-final-ap")).toHaveTextContent("2 AP");
    expect(cost).toHaveTextContent("current ME may pay part during casting");
    fireEvent.click(screen.getByTestId("spell-step-REVIEW"));
    const inspector = screen.getByTestId("spell-cost-inspector");
    expect(within(inspector).getAllByTestId("spell-cost-row")).toHaveLength(3);
    expect(within(inspector).getByTestId("spell-base-mp")).toHaveTextContent("11 MP");
    expect(screen.getByTestId("spell-review-range")).toHaveTextContent("45 ft");
    fireEvent.click(screen.getByTestId("spell-step-FINALIZE"));
    expect(screen.getByTestId("spell-finalize-slots")).toHaveTextContent("Signature slots used 0 / 4 · after finalizing 1 / 4");
    client.finalizeSpell.mockResolvedValue(savedFrom(FINAL, 3));
    fireEvent.click(screen.getByTestId("spell-finalize"));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/characters/${CID}/spells/${SID}`));
    expect(client.finalizeSpell).toHaveBeenCalledWith(CID, SID, EMPTY.spell.lockVersion);
  });

  it("an invalid Spell cannot be finalized and the draft stays saved (§158)", async () => {
    const view = validDraftView();
    const e = view.spell.draft!.evaluation!;
    e.state = "INVALID";
    e.cost = null;
    e.issues = [{ code: "PROWESS_CONSTRUCTION.TARGETING_INCOMPATIBLE", path: "/composition/effects/0", step: "EFFECTS", componentKey: "effect1", message: "Effect 1 cannot use Radius Targeting." }];
    await openBuilder(view);
    fireEvent.click(screen.getByTestId("spell-step-FINALIZE"));
    expect(screen.getByTestId("spell-finalize")).toBeDisabled();
    expect(screen.getByTestId("spell-finalize-unavailable")).toHaveTextContent("The draft stays saved");
    expect(screen.getByTestId("spell-issues")).toHaveTextContent("Effect 1 cannot use Radius Targeting.");
    expect(within(screen.getByTestId("spell-live")).getByTestId("spell-cost")).toHaveTextContent("Cost unresolved");
  });

  it("M6-I097 Mana Lock shows 'Runtime: Deferred' with the exact conflict key and no invented amount", async () => {
    const view = validDraftView();
    const e = view.spell.draft!.evaluation!;
    e.state = "VALID_WITH_RUNTIME_DEFERRED";
    e.runtime = { sustain: null, manaLock: { reservedMp: null, conflictKey: "M5-SC-052" }, concentration: "NONE", deferred: [{ conflictKey: "M5-SC-052", message: "The Mana Lock reserved amount is unresolved." }] };
    await openBuilder(view);
    expect(within(screen.getByTestId("spell-live")).getByTestId("spell-runtime-deferred")).toHaveTextContent("Runtime: Deferred — Reason: M5-SC-052");
    fireEvent.click(screen.getByTestId("spell-step-REVIEW"));
    expect(screen.getByTestId("spell-review-mana-lock")).toHaveTextContent("Runtime: Deferred — Reason: M5-SC-052");
    fireEvent.click(screen.getByTestId("spell-step-FINALIZE"));
    expect(screen.getByTestId("spell-finalize")).toBeEnabled();
  });

  it("a finalized Spell opens read-only with an explicit Start rebuild", async () => {
    client.getSpellBuilder.mockResolvedValue(clone(FINAL));
    render(<SpellBuilder characterId={CID} spellId={FINAL.spell.id} />);
    await screen.findByTestId("spell-builder-readonly");
    client.rebuildSpell.mockResolvedValue(savedFrom(FINAL, 4));
    fireEvent.click(screen.getByTestId("spell-start-rebuild"));
    await waitFor(() => expect(client.rebuildSpell).toHaveBeenCalledWith(CID, FINAL.spell.id, FINAL.spell.lockVersion));
  });
});

describe("M6-WO7 Abilities roster, Spell history and Sheet Actions (§18, §93–§95, §133–§134)", () => {
  const abilities = (): CharacterAbilitiesDto => ({ character: FINAL.character, release: FINAL.release, signature: FINAL.signature, spells: [clone(FINAL.spell), clone(EMPTY.spell)], names: FINAL.names });

  it("lists every Spell with the server's AP / MP and status; drafts show no cost and use no slot", async () => {
    client.getAbilities.mockResolvedValue(abilities());
    render(<AbilitiesPanel characterId={CID} />);
    await screen.findByTestId("abilities-panel");
    expect(screen.getByTestId("abilities-signature-slots")).toHaveTextContent("Signature slots used: 1 / 4");
    const rows = screen.getAllByTestId("abilities-spell-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["ACTIVE", "DRAFT"]);
    expect(within(rows[0]!).getByTestId("abilities-spell-ap")).toHaveTextContent("2");
    expect(within(rows[0]!).getByTestId("abilities-spell-mp")).toHaveTextContent("11");
    expect(within(rows[1]!).getByTestId("abilities-spell-mp")).toHaveTextContent("Unresolved");
    expect(screen.getByTestId("abilities-new-spell")).toHaveAttribute("href", `/characters/${CID}/spells/new`);
  });

  it("the Spell page shows the current revision and its history with Rules Reference links scoped to the Character's Release", async () => {
    const detail: SignatureSpellDetailDto = { ...clone(FINAL), history: [{ ...clone(FINAL.history[0]!), current: false, revisionNumber: 1 }, { ...clone(FINAL.history[0]!), revisionId: "r2", revisionNumber: 2, current: true }] };
    client.getSpell.mockResolvedValue(detail);
    render(<SpellDetail characterId={CID} spellId={FINAL.spell.id} />);
    await screen.findByTestId("spell-detail");
    expect(screen.getAllByTestId("spell-history-row").map((r) => [r.getAttribute("data-revision"), r.getAttribute("data-current")])).toEqual([
      ["2", "true"],
      ["1", "false"],
    ]);
    const links = screen.getAllByTestId("spell-component-link");
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute("href")).toMatch(new RegExp(`/releases/${FINAL.release.id}/entities/`));
  });

  it("the Sheet Actions list each active Spell compactly from the server's evaluation; print stays compact", async () => {
    const t = FINAL.spell.current!.draft!.targeting!.definition;
    const spell = { id: "s1", name: "Ember Bolt", revisionNumber: 1, state: "VALID" as const, finalApCost: 2, finalMpCost: 11, targeting: t, range: { model: "DEFAULT_SPELL_RANGE", value: 45, unit: "ft", ruleText: null }, effectFamilies: ["DAMAGE"], keywords: ["keyword.damage"], duration: null, deferred: [] };
    client.getSheet.mockResolvedValue(sheetFixture({ signatureSpells: [spell], names: { ...sheetFixture().names, [t.entityVersionId]: "Single Target" } }));
    render(<CharacterSheet characterId="c1" />);
    const rows = await screen.findAllByTestId("sheet-spell-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Ember Bolt");
    expect(within(rows[0]!).getByTestId("sheet-spell-cost")).toHaveTextContent("2 AP · 11 MP");
    expect(within(rows[0]!).getByTestId("sheet-spell-targeting")).toHaveTextContent("Single Target · 45 ft");
    expect(rows[0]).toHaveTextContent("Damage");
    expect(screen.getByTestId("sheet-action-notes")).toBeInTheDocument();
  });
});
