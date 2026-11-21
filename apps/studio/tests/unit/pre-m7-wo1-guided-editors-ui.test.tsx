import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { newCandidate, stableStringify } from "../../app/compendium/admin/_lib/definition-form";
import { descriptorFor, initialPayload } from "../../app/compendium/admin/_lib/descriptors";
import { readChildRef, stashParent, takeParent } from "../../app/compendium/admin/_lib/child-draft";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";

/**
 * PRE-M7-WO1 C04, C05, C12 — the guided editors behave losslessly on REAL shipped content: rendering never rewrites a
 * stored payload, an edit changes exactly the edited value, switching a shape asks before dropping data, and a reusable
 * Spell / Maneuver is composed from exact component revisions with a child-Draft round trip that keeps unsaved work.
 * Server calls are mocked (presentation only; legality is the server's).
 */
const client = vi.hoisted(() => ({ getVersion: vi.fn(), searchDefinitionReferences: vi.fn(), searchKeywords: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
const rules = vi.hoisted(() => ({ describeFormula: vi.fn(), composeFormula: vi.fn(), renameFormulaInput: vi.fn(), nameFormulaInput: vi.fn(), previewRuleCandidate: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/rules-client", async (importActual) => ({ ...(await importActual<object>()), ...rules }));
const { DefinitionEditor } = await import("../../app/compendium/admin/_components/DefinitionEditor");
const { withChildComponent } = await import("../../app/compendium/admin/_components/AbilityDefinitionEditor");

const ROOT = path.resolve(process.cwd(), "../..");
function shipped(kind: string): Array<{ schemaVersion: number; payload: Record<string, unknown> }> {
  const out: Array<{ schemaVersion: number; payload: Record<string, unknown> }> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      const r = v as Record<string, unknown>;
      if (r.definitionKind === kind && r.payload !== null && typeof r.payload === "object") out.push({ schemaVersion: typeof r.schemaVersion === "number" ? r.schemaVersion : 1, payload: r.payload as Record<string, unknown> });
      Object.values(r).forEach(walk);
    }
  };
  for (const f of ["core-resolution.json", "runtime-resources.json", "affinity.json", "ability-construction.json"]) walk(JSON.parse(readFileSync(path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1", f), "utf8")));
  return out;
}
const candidateOf = (kind: string, schemaVersion: number, payload: Record<string, unknown>): DefinitionCandidate => ({ ...newCandidate(kindRow(kind)), schemaVersion, payload: structuredClone(payload) });

function Editor({ initial, onChange, onCreateChild }: { initial: DefinitionCandidate; onChange?: (c: DefinitionCandidate) => void; onCreateChild?: (kind: string, slot: string) => void }) {
  const [c, setC] = useState(initial);
  return (
    <DefinitionEditor
      kind={kindRow(initial.definitionKind)}
      catalog={CATALOG}
      candidate={c}
      issues={[]}
      onCreateChild={onCreateChild}
      onChange={(next) => {
        setC(next);
        onChange?.(next);
      }}
    />
  );
}

const REF = (kind: string, key: string) => ({ entityId: `e-${key}`, entityVersionId: `v-${key}`, canonicalKey: key, definitionKind: kind, systemFamily: kind.startsWith("SPELL") ? "SPELL" : "MANEUVER" });

beforeEach(() => {
  for (const fn of [...Object.values(client), ...Object.values(rules)]) fn.mockReset();
  rules.describeFormula.mockResolvedValue({ parse: { ok: true, variables: [] }, guided: { ok: true, terms: [] }, hazards: [], sourceLabels: [] });
  client.searchKeywords.mockResolvedValue([]);
  client.getVersion.mockResolvedValue({ structuredData: { prowessDefinition: { payload: { parameters: [{ parameter: "dice", kind: "COUNT", minimum: 1, maximum: { kind: "FIXED", value: 4 }, increment: 1, default: 1 }] } } } });
});
afterEach(() => vi.restoreAllMocks());

describe("PRE-M7-WO1 guided editors on shipped content", () => {
  const KINDS = ["ACTION", "RESOURCE", "CORE_RESOLUTION", "AFFINITY_RANK_RULE", "AFFINITY_PROGRESSION", "ABILITY_CONSTRUCTION_RULE", "AFFINITY"];

  it("W1-GUIDED rendering a stored payload never rewrites it (every shipped Definition of every newly guided kind)", async () => {
    for (const kind of KINDS) {
      for (const s of shipped(kind)) {
        const changes: DefinitionCandidate[] = [];
        const { unmount, container } = render(<Editor initial={candidateOf(kind, s.schemaVersion, s.payload)} onChange={(c) => changes.push(c)} />);
        await act(async () => {});
        expect(changes, `${kind} rewrote its payload on render`).toEqual([]);
        // Ordinary fields are real controls, not a raw JSON box.
        expect(container.querySelectorAll("textarea[data-raw-json]").length).toBe(0);
        unmount();
      }
    }
  });

  it("W1-GUIDED editing one value changes exactly that value (ACTION Move: AP amount; every other key byte-identical)", async () => {
    const move = shipped("ACTION").find((s) => s.payload.actionKey === "MOVE")!;
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={candidateOf("ACTION", 1, move.payload)} onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText("AP amount (required)"), { target: { value: "2" } });
    const after = changes.at(-1)!.payload as Record<string, unknown>;
    expect(after.actionPointCost).toEqual({ model: "FIXED", amount: 2 });
    expect(stableStringify({ ...after, actionPointCost: null })).toBe(stableStringify({ ...move.payload, actionPointCost: null }));
  });

  it("W1-GUIDED switching a shape asks before dropping populated data; cancelling keeps everything", async () => {
    const grapple = shipped("ACTION").find((s) => s.payload.actionKey === "GRAPPLE")!;
    const changes: DefinitionCandidate[] = [];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor initial={candidateOf("ACTION", 1, grapple.payload)} onChange={(c) => changes.push(c)} />);
    const cost = screen.getByRole("group", { name: /AP cost/ });
    fireEvent.change(within(cost).getByRole("combobox"), { target: { value: "VARIABLE" } });
    // RULES-WO1 Phase D: the confirmation names the fields in words (their labels), not their payload keys.
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/removes: Minimum AP, Maximum AP/));
    expect(changes).toEqual([]);
    confirm.mockReturnValue(true);
    fireEvent.change(within(cost).getByRole("combobox"), { target: { value: "VARIABLE" } });
    expect((changes.at(-1)!.payload as Record<string, unknown>).actionPointCost).toEqual({ model: "VARIABLE", determinedBy: "" });
  });

  it("W1-GUIDED optional engine policies stay absent until added and are removed as absent (never {})", async () => {
    const acr = shipped("ABILITY_CONSTRUCTION_RULE")[0]!;
    const without = Object.fromEntries(Object.entries(acr.payload).filter(([k]) => k !== "activeMagicPolicy"));
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={candidateOf("ABILITY_CONSTRUCTION_RULE", 1, without)} onChange={(c) => changes.push(c)} />);
    const group = screen.getByRole("group", { name: /Active Magic policy/ });
    fireEvent.click(within(group).getByRole("button", { name: /Add active magic policy/i }));
    expect((changes.at(-1)!.payload as Record<string, unknown>).activeMagicPolicy).toEqual({});
    fireEvent.click(within(screen.getByRole("group", { name: /Active Magic policy/ })).getByRole("button", { name: /Remove active magic policy/i }));
    expect(JSON.parse(JSON.stringify(changes.at(-1)!.payload))).not.toHaveProperty("activeMagicPolicy");
  });
});

describe("PRE-M7-WO1 reusable Spell / Maneuver Definitions", () => {
  it("W1-ABILITY a new Spell is composed from exact revisions: Targeting and an Effect with its declared parameters", async () => {
    client.searchDefinitionReferences.mockImplementation(async (_term: string, kind: string) => [{ ref: REF(kind, `${kind.toLowerCase()}.sample`), displayName: `Sample ${kind}`, revisionNumber: 3, status: "APPROVED" }]);
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("SPELL_DEFINITION"))} onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByTestId("ability-name"), { target: { value: "Force Lance" } });
    fireEvent.change(screen.getByTestId("ability-authority"), { target: { value: "ARCANE_AUTHORITY" } });
    for (const slot of ["targeting", "effects"]) {
      fireEvent.click(screen.getByTestId(`ability-add-${slot}`));
      fireEvent.change(within(screen.getByTestId(`ability-slot-${slot}`)).getByRole("searchbox"), { target: { value: "sample" } });
      fireEvent.click(await within(screen.getByTestId(`ability-slot-${slot}`)).findByRole("button", { name: /Sample/ }));
    }
    const p = changes.at(-1)!.payload as { name: string; composition: { authority: unknown; targeting: { componentKey: string; definition: { entityVersionId: string } }; effects: Array<{ componentKey: string; order: number; definition: { entityVersionId: string; definitionKind: string } }> } };
    expect(p.name).toBe("Force Lance");
    expect(p.composition.authority).toEqual({ authority: "ARCANE_AUTHORITY" });
    expect(p.composition.targeting).toMatchObject({ componentKey: "targeting", definition: { entityVersionId: "v-spell_targeting.sample" } });
    expect(p.composition.effects).toEqual([{ componentKey: "effect1", order: 1, parameters: {}, definition: REF("SPELL_EFFECT", "spell_effect.sample") }]);
    // The Effect's declared parameter (read from that exact revision) is a typed input; the value belongs to this use.
    const dice = await within(screen.getByTestId("ability-slot-effects")).findByLabelText(/dice/i);
    fireEvent.change(dice, { target: { value: "3" } });
    expect((changes.at(-1)!.payload as typeof p).composition.effects[0]).toMatchObject({ parameters: { dice: 3 } });
    expect(client.getVersion).toHaveBeenCalledWith("v-spell_effect.sample");
  });

  it("W1-ABILITY a Maneuver attaches each Effect to explicit actions and can mark a Powerful Blow", async () => {
    const base = newCandidate(kindRow("MANEUVER_DEFINITION"));
    const payload = { ...base.payload, actions: [{ componentKey: "action1", order: 1, parameters: {}, definition: REF("MANEUVER_FOUNDATION", "f1") }, { componentKey: "action2", order: 2, parameters: {}, definition: REF("MANEUVER_FOUNDATION", "f2") }], composition: { ...(base.payload.composition as object), effects: [{ componentKey: "effect1", order: 1, parameters: {}, definition: REF("MANEUVER_EFFECT", "e1") }] } };
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={{ ...base, payload }} onChange={(c) => changes.push(c)} />);
    const attach = within(screen.getByTestId("ability-attachment"));
    fireEvent.click(attach.getByRole("checkbox", { name: /action2/ }));
    expect((changes.at(-1)!.payload as Record<string, unknown>).effectAttachments).toEqual([{ effectKey: "effect1", actionKeys: ["action2"] }]);
    fireEvent.click(within(screen.getByTestId("ability-powerful-blow")).getByRole("checkbox", { name: /Powerful Blow/ }));
    expect((changes.at(-1)!.payload as Record<string, unknown>).powerfulBlow).toEqual({ actionKeys: ["action1", "action2"] });
  });

  it("W1-ABILITY Create-a-new-component hands the slot and kind to the workspace, which keeps the unsaved parent", async () => {
    const created: Array<[string, string]> = [];
    render(<Editor initial={newCandidate(kindRow("SPELL_DEFINITION"))} onCreateChild={(k, s) => created.push([k, s])} />);
    fireEvent.click(screen.getByTestId("ability-create-effects"));
    expect(created).toEqual([["SPELL_EFFECT", "effects"]]);
    // The round trip: the unsaved parent is stashed for ONE use, and the created child comes back as an exact reference.
    const parent = { candidate: { payload: { name: "Unsaved name" } } };
    expect(stashParent("v-parent", parent, "effects")).toBe(true);
    expect(takeParent("v-parent")).toEqual({ form: parent, slot: "effects" });
    expect(takeParent("v-parent")).toBeNull();
    expect(readChildRef(JSON.stringify(REF("SPELL_EFFECT", "new")))).toEqual(REF("SPELL_EFFECT", "new"));
    expect(readChildRef("{bad")).toBeNull();
    const next = withChildComponent(newCandidate(kindRow("SPELL_DEFINITION")).payload, "traits", REF("SPELL_TRAIT", "t"), CATALOG.vocabularies.traitScopes ?? []);
    expect((next.composition as { traits: unknown[] }).traits).toEqual([{ componentKey: "trait1", order: 1, parameters: {}, definition: REF("SPELL_TRAIT", "t"), appliesTo: { scope: "ABILITY_WIDE", componentKey: null } }]);
  });

  it("W1-MAGE-ART a Mage Art is authored with guided cost, Active Effect and mode controls in the exact v1 shape", async () => {
    // RULES-WO1 authors NEW Mage Arts at version 2; this test keeps checking the exact version-1 editor.
    const base = { ...newCandidate(kindRow("MAGE_ART")), schemaVersion: 1, payload: initialPayload(descriptorFor(kindRow("MAGE_ART"), 1)) };
    expect(Object.keys(base.payload).sort()).toEqual(["activation", "activeEffect", "artKey", "maintenance", "modes", "source"]);
    expect(base.payload.maintenance).toEqual({ ap: null, mp: null, special: null }); // numbers are entered, never defaulted
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={base} onChange={(c) => changes.push(c)} />);
    const last = () => changes.at(-1)!.payload as Record<string, unknown>;
    // A special maintenance cost is text; emptying it stores null again (never an empty string the validator refuses).
    const special = screen.getAllByLabelText(/Special cost/)[0]!;
    fireEvent.change(special, { target: { value: "Stated in the Art's text." } });
    expect((last().maintenance as Record<string, unknown>).special).toBe("Stated in the Art's text.");
    fireEvent.change(special, { target: { value: "" } });
    expect((last().maintenance as Record<string, unknown>).special).toBeNull();
    // A mode starts with no own costs (it uses the Art's) and only the controls the contract has.
    fireEvent.click(screen.getByRole("button", { name: "Add mode" }));
    expect(last().modes).toEqual([{ modeKey: "", name: "", activation: null, maintenance: null, rulesText: "" }]);
    fireEvent.click(screen.getByRole("button", { name: "Set own activation cost" }));
    expect((last().modes as Array<Record<string, unknown>>)[0]!.activation).toEqual({ ap: null, mp: null });
    expect(screen.getByRole("combobox", { name: /When/ })).toBeTruthy();
  });
});

void waitFor;
