import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { newCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { formulaGuide } from "../../../../packages/prowess-db/src/compendium-rules/formula-guide";
import { TARGETING_CONTENT } from "../../../../packages/prowess-game/src/testing/targeting-fixtures";
import { ACTIVE_MAGIC_CONTENT, PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, validateStoredProwessDefinition } from "../../../../packages/prowess-game/src/index";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";

/**
 * RULES-WO1 Phase H — the remaining ordinary authoring gaps are guided: how a roll reads its dice and what it is compared
 * with, construction slot Formulas and the engine policies, Action Improvement conditions, written rule notes, and a
 * Targeting's values by Skill rank with "rank base × STR" composed from contributions. Formula calls are answered by the
 * server's own pure Formula guide; every stored payload is checked with the REAL M5 reader.
 */
const rules = vi.hoisted(() => ({ describeFormula: vi.fn(), composeFormula: vi.fn(), renameFormulaInput: vi.fn(), nameFormulaInput: vi.fn(), listAuthoringOptions: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/rules-client", async (importActual) => ({ ...(await importActual<object>()), ...rules }));
const auth = vi.hoisted(() => ({ searchDefinitionReferences: vi.fn(), searchKeywords: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), ...auth }));
const { DefinitionEditor } = await import("../../app/compendium/admin/_components/DefinitionEditor");

const guide = (body: Record<string, unknown>) => formulaGuide(body) as any;  
beforeEach(() => {
  rules.describeFormula.mockImplementation(async (expression: string, sources: unknown) => guide({ op: "describe", expression, sources }).description);
  rules.composeFormula.mockImplementation(async (terms: unknown, sources: unknown) => guide({ op: "compose", terms, sources }));
  rules.nameFormulaInput.mockImplementation(async (source: unknown, taken: unknown, style?: string) => guide({ op: "name", source, taken, ...(style ? { style } : {}) }));
  rules.renameFormulaInput.mockImplementation(async (expression: string, from: string, to: string, sources: unknown) => guide({ op: "rename", expression, from, to, sources }));
  rules.listAuthoringOptions.mockImplementation(async (list: string) => (list === "skills" ? [{ token: "skill.martial", label: "Martial" }] : list === "skillRanks" ? ["TRAINED", "EXPERT", "MASTER"].map((t) => ({ token: t, label: t.charAt(0) + t.slice(1).toLowerCase() })) : []));
  auth.searchKeywords.mockResolvedValue([]);
});

const ROOT = path.resolve(process.cwd(), "../..");
function shipped(kind: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      const r = v as Record<string, unknown>;
      if (r.definitionKind === kind && r.payload !== null && typeof r.payload === "object") out.push(r.payload as Record<string, unknown>);
      Object.values(r).forEach(walk);
    }
  };
  for (const f of ["core-resolution.json", "runtime-resources.json", "ability-construction.json"]) walk(JSON.parse(readFileSync(path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1", f), "utf8")));
  return out;
}
function m5Problems(kind: string, payload: unknown): string[] {
  const k = kind as keyof typeof PROWESS_DEFINITION_KINDS;
  const out = validateStoredProwessDefinition({ entityType: PROWESS_DEFINITION_KINDS[k].entityTypes[0] as never, structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 1, systemFamily: PROWESS_DEFINITION_KINDS[k].family, definitionKind: kind, payload: JSON.parse(JSON.stringify(payload)) } } });
  return out.ok ? [] : out.problems.map((p) => `${p.code} ${JSON.stringify(p.path)} ${p.message}`);
}
function Editor({ kind, payload, onChange }: { kind: string; payload?: Record<string, unknown>; onChange: (c: DefinitionCandidate) => void }) {
  const row = kindRow(kind);
  const [c, setC] = useState<DefinitionCandidate>(payload ? { ...newCandidate(row), payload: structuredClone(payload) } : newCandidate(row));
  return <DefinitionEditor kind={row} catalog={CATALOG} candidate={c} issues={[]} onChange={(n) => { setC(n); onChange(n); }} />;
}
const last = (c: DefinitionCandidate[]) => c.at(-1)!.payload as Record<string, any>;  

describe("RULES-WO1 Phase H — core roll configuration", () => {
  it("reads the dice by choice (as rolled / higher / lower) and compares from lists; the stored roll stays valid", () => {
    const roll = shipped("CORE_RESOLUTION").find((p) => p.procedure === "ATTACK_ROLL")!;
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="CORE_RESOLUTION" payload={roll} onChange={(c) => changes.push(c)} />);
    const natural = screen.getByTestId("natural-naturalSelection");
    expect((within(natural).getByTestId("natural-naturalSelection-NORMAL") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("The die as rolled");
    expect((within(natural).getByTestId("natural-naturalSelection-ADVANTAGE") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("The higher of the two dice");
    expect(screen.getByRole("option", { name: "meets or exceeds the difficulty" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Selection$|^Operator$/)).toBeNull();
    fireEvent.change(within(natural).getByTestId("natural-naturalSelection-ADVANTAGE"), { target: { value: "min(r1, r2)" } });
    expect(last(changes).naturalSelection.ADVANTAGE).toEqual({ expression: "min(r1, r2)" });
    expect(m5Problems("CORE_RESOLUTION", last(changes))).toEqual([]);
    fireEvent.change(within(natural).getByTestId("natural-naturalSelection-ADVANTAGE"), { target: { value: "max(r1, r2)" } });
    expect(last(changes)).toEqual(roll);
  });

  it("an expression written some other way is kept and shown, never rewritten", () => {
    const roll = structuredClone(shipped("CORE_RESOLUTION").find((p) => p.procedure === "ATTACK_ROLL")!) as Record<string, any>;  
    roll.naturalSelection.ADVANTAGE.expression = "max(r2, r1)";
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="CORE_RESOLUTION" payload={roll} onChange={(c) => changes.push(c)} />);
    expect(screen.getByTestId("natural-naturalSelection-ADVANTAGE-kept")).toHaveTextContent("max(r2, r1)");
    expect(changes).toEqual([]);
  });
});

describe("RULES-WO1 Phase H — construction rule and engine policies", () => {
  const full = () => structuredClone(ACTIVE_MAGIC_CONTENT.constructionRule.payload) as unknown as Record<string, unknown>;

  it("slot Formulas are contributions over the slot's named inputs; policies are numbers, lists and choices — and stay valid", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="ABILITY_CONSTRUCTION_RULE" payload={full()} onChange={(c) => changes.push(c)} />);
    expect(screen.getAllByText("Reads: base effects, trades, effect slots per exchange.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Inputs it reads")).toBeNull();
    expect(screen.queryByText(/Condition policy \(advanced\)/)).toBeNull();
    expect((screen.getByTestId("select-map-activeMagicPolicy-dismissal-SUSTAINED") as HTMLSelectElement).value).toBe("FREE_ACTION");
    expect((screen.getByTestId("select-map-effectExecutionPolicy-martialSaveControl-MASTER") as HTMLSelectElement).value).toBe("ATTACKER_CHOOSES");
    fireEvent.change(screen.getByTestId("select-map-activeMagicPolicy-dismissal-SCENE"), { target: { value: "FREE_ACTION" } });
    expect(last(changes).activeMagicPolicy.dismissal.SCENE).toBe("FREE_ACTION");
    expect(m5Problems("ABILITY_CONSTRUCTION_RULE", last(changes))).toEqual([]);
    // A slot Formula is edited through its contributions (the server rebuilds the expression).
    const slot = screen.getByTestId("fixed-formula-remaining-effects");
    expect(await within(slot).findAllByTestId("formula-term")).not.toHaveLength(0);
  });

  it("a policy is added from the Core Playtest ruling and removed as absent (never written as {})", () => {
    const without = Object.fromEntries(Object.entries(full()).filter(([k]) => k !== "effectExecutionPolicy"));
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="ABILITY_CONSTRUCTION_RULE" payload={without} onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByTestId("effectExecutionPolicy-add-ruling"));
    expect(last(changes).effectExecutionPolicy).toEqual(CATALOG.rulingDefaults!.effectExecutionPolicy);
    expect(m5Problems("ABILITY_CONSTRUCTION_RULE", last(changes))).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Remove effect execution policy" }));
    expect(JSON.parse(JSON.stringify(last(changes)))).not.toHaveProperty("effectExecutionPolicy");
  });
});

describe("RULES-WO1 Phase H — Action notes and Action Improvement conditions", () => {
  it("rule notes are written headings and text (never run), stored as the contract reads them", () => {
    const action = shipped("ACTION")[0]!;
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="ACTION" payload={action} onChange={(c) => changes.push(c)} />);
    const notes = screen.getByTestId("notes-rules");
    expect(within(notes).getByText(/play does not run these notes/)).toBeTruthy();
    fireEvent.change(within(notes).getByTestId("notes-rules-new"), { target: { value: "Table talk" } });
    fireEvent.click(within(notes).getByTestId("notes-rules-add"));
    fireEvent.change(within(notes).getByTestId("notes-rules-0-text"), { target: { value: "Describe the move to the GM." } });
    expect(last(changes).rules).toEqual({ TABLE_TALK: "Describe the move to the GM." });
    expect(m5Problems("ACTION", last(changes))).toEqual([]);
  });

  it("an improved AP cost applies always or only when a play-time check holds (named in plain words)", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="ACTION_IMPROVEMENT" onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByRole("button", { name: /Add modification/i }));
    const kind = screen.getAllByRole("combobox", { name: "Kind" }).at(-1)!;
    fireEvent.change(kind, { target: { value: "ACTION_POINT_COST" } });
    expect(screen.queryByText(/advanced requirement/)).toBeNull();
    fireEvent.click(screen.getByTestId("play-check-modifications-0-condition-when"));
    fireEvent.change(screen.getByTestId("play-check-modifications-0-condition-fact"), { target: { value: "has moved this turn" } });
    const mod = last(changes).modifications[0];
    expect(mod.condition).toEqual({ kind: "NUMERIC_COMPARE", factKey: "runtime.hasMovedThisTurn", operator: ">=", expected: 1 });
    fireEvent.click(screen.getByTestId("play-check-modifications-0-condition-always"));
    expect(last(changes).modifications[0].condition).toBeNull();
  });
});

describe("RULES-WO1 Phase H — Maneuver Radius: values by Martial rank × STR", () => {
  const radius = () => TARGETING_CONTENT.definitions.find((d) => d.canonicalKey === "maneuver.targeting.radius")!.payload as Record<string, any>;  

  it("shows the published 5 / 10 / 15 table and \"rank base × STR\" as one readable contribution, without rewriting them", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="MANEUVER_TARGETING" payload={radius()} onChange={(c) => changes.push(c)} />);
    expect(screen.getByTestId("targeting-rank-table-0-name")).toHaveValue("Martial rank base");
    expect(["0", "1", "2"].map((j) => (screen.getByTestId(`targeting-rank-table-0-row-${j}-value`) as HTMLInputElement).value)).toEqual(["5", "10", "15"]);
    const distance = screen.getByTestId("targeting-measure-RADIUS-distance");
    expect(await within(distance).findByRole("combobox", { name: "Contribution 1 second input" })).toBeTruthy();
    expect(within(distance).queryByTestId("formula-guided-unavailable")).toBeNull();
    expect(changes).toEqual([]);
  });

  it("editing a rank's value changes exactly that row; renaming the table renames the distance input that reads it", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="MANEUVER_TARGETING" payload={radius()} onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByTestId("targeting-rank-table-0-row-1-value"), { target: { value: "12" } });
    const p = last(changes);
    expect(p.rules.targeting.rankTables[0].entries).toEqual([{ rankKey: "TRAINED", value: 5 }, { rankKey: "EXPERT", value: 12 }, { rankKey: "MASTER", value: 15 }]);
    expect(p.rules.targeting.measures).toEqual(radius().rules.targeting.measures);
    expect(m5Problems("MANEUVER_TARGETING", p)).toEqual([]);
    fireEvent.change(screen.getByTestId("targeting-rank-table-0-name"), { target: { value: "Martial base" } });
    expect(last(changes).rules.targeting.measures[0].formula.variables[0].source).toEqual({ kind: "SKILL_RANK_TABLE", table: "MARTIAL_BASE" });
  });

  it("composes \"rank base × STR\" from scratch with readable controls", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="MANEUVER_TARGETING" onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByTestId("targeting-rank-table-add"));
    fireEvent.change(screen.getByTestId("targeting-rank-table-0-name"), { target: { value: "Martial rank base" } });
    fireEvent.change(await screen.findByRole("combobox", { name: "By the rank in" }), { target: { value: "skill.martial" } });
    for (const [j, rank, value] of [[0, "TRAINED", "5"], [1, "EXPERT", "10"], [2, "MASTER", "15"]] as const) {
      fireEvent.click(screen.getByTestId("targeting-rank-table-0-add-row"));
      const rankSelect = within(screen.getByTestId(`targeting-rank-table-0-row-${j}`)).getByRole("combobox");
      await within(rankSelect).findByRole("option", { name: rank.charAt(0) + rank.slice(1).toLowerCase() });
      fireEvent.change(rankSelect, { target: { value: rank } });
      fireEvent.change(screen.getByTestId(`targeting-rank-table-0-row-${j}-value`), { target: { value } });
    }
    fireEvent.change(screen.getByTestId("targeting-measure-RADIUS-status"), { target: { value: "FORMULA" } });
    const add = await within(screen.getByTestId("targeting-measure-RADIUS-distance")).findByTestId("formula-add");
    fireEvent.change(within(add).getByLabelText("New contribution shape"), { target: { value: "PRODUCT" } });
    fireEvent.change(within(add).getByLabelText("New contribution: source"), { target: { value: "SKILL_RANK_TABLE" } });
    fireEvent.change(within(add).getByLabelText("New contribution: rank table"), { target: { value: "MARTIAL_RANK_BASE" } });
    fireEvent.change(within(add).getByLabelText("Multiplied by: source"), { target: { value: "STAT" } });
    fireEvent.change(within(add).getByLabelText("Multiplied by: Stat"), { target: { value: "STR" } });
    await vi.waitFor(() => expect((within(add).getByRole("button", { name: "Add contribution" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(add).getByRole("button", { name: "Add contribution" }));
    await vi.waitFor(() => expect(last(changes).rules.targeting.measures[0].formula?.expression).toBe("martial_rank_base * str"));
    const t = last(changes).rules.targeting;
    expect(t.rankTables).toEqual([{ tableKey: "MARTIAL_RANK_BASE", skillKey: "skill.martial", entries: [{ rankKey: "TRAINED", value: 5 }, { rankKey: "EXPERT", value: 10 }, { rankKey: "MASTER", value: 15 }] }]);
    expect(t.measures[0].formula.variables).toEqual([{ variable: "martial_rank_base", source: { kind: "SKILL_RANK_TABLE", table: "MARTIAL_RANK_BASE" } }, { variable: "str", source: { kind: "STAT", stat: "STR" } }]);
  });
});
