import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { newCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { asParameterName, costWords, mechanicsSummary, parameterWords, renameParameterReferences } from "../../app/compendium/admin/_lib/component-mechanics";
import { CATALOG, issue, kindRow } from "./m6-wo1-fixtures";

/**
 * RULES-WO1 Phase F (R18) — Spell / Maneuver components are authored in game language. Building a meaningful Effect
 * (what it does, how it resolves, the caster's choices, its costs, what happens on a success or a failure, how long it
 * lasts and what it takes to build) never asks for a property name, a data type, a key or programming syntax, and it
 * produces exactly the M5 Effect contract the Spell builder compiles. Server calls are mocked: legality stays on the
 * server (the browser journey publishes and builds the Effect for real).
 */
const rules = vi.hoisted(() => ({ listAuthoringOptions: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/rules-client", async (importActual) => ({ ...(await importActual<object>()), ...rules }));
const auth = vi.hoisted(() => ({ searchDefinitionReferences: vi.fn(), searchKeywords: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), ...auth }));
const { DefinitionEditor } = await import("../../app/compendium/admin/_components/DefinitionEditor");

beforeEach(() => {
  rules.listAuthoringOptions.mockReset();
  rules.listAuthoringOptions.mockImplementation(async (list: string) => (list === "skills" ? [{ token: "skill.arcana", label: "Arcana" }] : list === "skillRanks" ? [{ token: "TRAINED", label: "Trained" }, { token: "EXPERT", label: "Expert" }] : []));
  auth.searchDefinitionReferences.mockReset();
  auth.searchKeywords.mockReset();
  auth.searchKeywords.mockResolvedValue([]);
});

function Editor({ kind, initial, onChange, issues = [] }: { kind: string; initial?: DefinitionCandidate; onChange?: (c: DefinitionCandidate) => void; issues?: ReturnType<typeof issue>[] }) {
  const row = kindRow(kind);
  const [c, setC] = useState<DefinitionCandidate>(initial ?? newCandidate(row));
  return (
    <DefinitionEditor
      kind={row}
      catalog={CATALOG}
      candidate={c}
      issues={issues}
      onChange={(next) => {
        setC(next);
        onChange?.(next);
      }}
    />
  );
}
const last = (changes: DefinitionCandidate[]) => changes.at(-1)!.payload as Record<string, any>;

describe("RULES-WO1 Phase F — a meaningful Spell Effect, authored in game language", () => {
  it("builds a fire-or-shock damage Effect with a per-die cost, outcomes, duration and a Skill requirement — no keys, types or syntax", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_EFFECT" onChange={(c) => changes.push(c)} />);
    // No raw data editor and no "Contribution key" anywhere on the normal path.
    expect(screen.queryByText(/Contribution key/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Add field/i })).toBeNull();
    expect(screen.queryByLabelText(/Data type|Value type/i)).toBeNull();

    // What it does and how it resolves.
    fireEvent.change(screen.getByTestId("effect-family"), { target: { value: "DAMAGE" } });
    fireEvent.change(screen.getByTestId("effect-subfamily"), { target: { value: "DIRECT" } });
    fireEvent.click(screen.getByTestId("effect-target-CREATURE"));
    fireEvent.click(screen.getByLabelText("An attack roll"));
    fireEvent.change(screen.getByLabelText("Kind of attack"), { target: { value: "ABILITY_ATTACK" } });

    // The caster's choices: a number of dice (up to PRO) and a damage type from a list.
    fireEvent.click(screen.getByTestId("effect-parameter-add"));
    fireEvent.change(screen.getByTestId("effect-parameter-0-name"), { target: { value: "Damage dice" } });
    fireEvent.change(screen.getByTestId("effect-parameter-0-default"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("effect-parameter-0-max-stat"));
    fireEvent.change(screen.getByTestId("effect-parameter-0-max-stat-choice"), { target: { value: "PRO" } });
    fireEvent.click(screen.getByTestId("effect-parameter-add"));
    fireEvent.change(screen.getByTestId("effect-parameter-1-name"), { target: { value: "Damage type" } });
    fireEvent.click(screen.getByTestId("effect-parameter-1-type-list"));
    for (const option of ["Fire", "Shock"]) {
      fireEvent.change(screen.getByTestId("effect-parameter-1-options-new"), { target: { value: option } });
      fireEvent.click(screen.getByTestId("effect-parameter-1-options-add"));
    }
    fireEvent.change(screen.getByTestId("effect-parameter-1-default"), { target: { value: "FIRE" } });

    // Costs: 3 MP, plus 2 MP for each die after the first.
    fireEvent.click(screen.getByTestId("effect-cost-add"));
    fireEvent.change(screen.getByTestId("effect-cost-0-currency"), { target: { value: "MP" } });
    fireEvent.change(screen.getByTestId("effect-cost-0-amount"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("effect-cost-add"));
    fireEvent.change(screen.getByTestId("effect-cost-1-currency"), { target: { value: "MP" } });
    fireEvent.click(screen.getByTestId("effect-cost-1-shape-perNumber"));
    fireEvent.change(screen.getByTestId("effect-cost-1-parameter"), { target: { value: "damageDice" } });
    fireEvent.change(screen.getByTestId("effect-cost-1-amount"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("effect-cost-1-included"), { target: { value: "1" } });
    expect(screen.getByTestId("effect-cost-1-summary")).toHaveTextContent("2 MP for each damage dice after the first 1");

    // What happens: damage on a success (dice and type read the choices above), nothing on a failure.
    fireEvent.change(screen.getByTestId("effect-outcome-SUCCESS-add"), { target: { value: "DAMAGE" } });
    fireEvent.change(screen.getByTestId("effect-outcome-SUCCESS-0-diceParameter"), { target: { value: "damageDice" } });
    fireEvent.change(screen.getByTestId("effect-outcome-SUCCESS-0-damageTypeParameter"), { target: { value: "damageType" } });
    fireEvent.change(screen.getByTestId("effect-outcome-FAILURE-add"), { target: { value: "NO_EFFECT" } });

    // How long it lasts, and what it takes to build with it.
    fireEvent.click(screen.getByTestId("effect-duration-INSTANT"));
    fireEvent.change(screen.getByTestId("effect-duration-default"), { target: { value: "INSTANT" } });
    fireEvent.click(screen.getByTestId("effect-construction-add-skill"));
    const requirement = screen.getByTestId("effect-construction-requirement-0");
    await waitFor(() => expect(within(requirement).getAllByRole("option").map((o) => o.textContent)).toContain("Arcana"));
    fireEvent.change(within(requirement).getByLabelText("Skill"), { target: { value: "skill.arcana" } });
    await waitFor(() => expect(within(requirement).getByLabelText("At least this rank").querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(within(requirement).getByLabelText("At least this rank"), { target: { value: "TRAINED" } });

    const p = last(changes);
    expect(p.effectFamily).toBe("DAMAGE");
    expect(p.resolution).toEqual({ mode: "ATTACK_ROLL", data: {} });
    expect(p.rules.effect).toEqual({
      branch: "SPELL",
      effectSubfamily: "DIRECT",
      targetCategories: ["CREATURE"],
      resolutionPolicy: "OWN",
      attackType: "ABILITY_ATTACK",
      saveProfile: null,
      parameters: [
        { parameter: "damageDice", kind: "COUNT", minimum: 1, maximum: { kind: "STAT", stat: "PRO" }, increment: 1, default: 1 },
        { parameter: "damageType", kind: "TOKEN", allowed: ["FIRE", "SHOCK"], default: "FIRE" },
      ],
      formulas: [],
      duration: { allowed: ["INSTANT"], default: "INSTANT", sustainEligible: false, manaLockEligible: false },
      targetingConversion: null,
      restrictions: [],
    });
    expect(p.costContributions).toEqual([
      { contributionKey: "cost.1", currency: "MP", data: { kind: "FIXED", amount: 3 } },
      { contributionKey: "cost.2", currency: "MP", data: { kind: "PER_UNIT", parameter: "damageDice", amount: 2, includedUnits: 1 } },
    ]);
    expect(p.outcomes).toEqual([
      { outcomeKey: "SUCCESS", data: { operations: [{ kind: "DAMAGE", data: { diceParameter: "damageDice", damageTypeParameter: "damageType" } }] } },
      { outcomeKey: "FAILURE", data: { operations: [{ kind: "NO_EFFECT", data: {} }] } },
    ]);
    expect(p.rules.construction).toEqual({ prerequisites: [{ prerequisiteKey: "SKILL_ARCANA_TRAINED", kind: "SKILL_RANK_AT_LEAST", skillKey: "skill.arcana", minimumRank: "TRAINED" }] });
  });

  it("a Saving Throw Effect names its Saves and who chooses; switching to an attack clears the Saves", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_EFFECT" onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByLabelText("A Saving Throw by the target"));
    fireEvent.click(screen.getByTestId("effect-save-STR"));
    fireEvent.click(screen.getByTestId("effect-save-PRO"));
    fireEvent.change(screen.getByTestId("effect-save-policy"), { target: { value: "TARGET_CHOICE" } });
    expect(last(changes).rules.effect.saveProfile).toEqual({ validSaves: ["STR", "PRO"], selectionPolicy: "TARGET_CHOICE" });
    fireEvent.click(screen.getByLabelText("An attack roll"));
    expect(last(changes).rules.effect).toMatchObject({ saveProfile: null, attackType: null });
    expect(last(changes).resolution).toEqual({ mode: "ATTACK_ROLL", data: {} });
  });

  it("a cost that depends on a list choice asks for one amount per option; renaming a choice keeps what reads it", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_EFFECT" onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByTestId("effect-parameter-add"));
    fireEvent.change(screen.getByTestId("effect-parameter-0-name"), { target: { value: "Element" } });
    fireEvent.click(screen.getByTestId("effect-parameter-0-type-list"));
    for (const option of ["Fire", "Ice"]) {
      fireEvent.change(screen.getByTestId("effect-parameter-0-options-new"), { target: { value: option } });
      fireEvent.click(screen.getByTestId("effect-parameter-0-options-add"));
    }
    fireEvent.click(screen.getByTestId("effect-cost-add"));
    fireEvent.click(screen.getByTestId("effect-cost-0-shape-perOption"));
    fireEvent.change(screen.getByTestId("effect-cost-0-amount-FIRE"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("effect-cost-0-amount-ICE"), { target: { value: "3" } });
    expect(last(changes).costContributions[0].data).toEqual({ kind: "PER_SELECTION", parameter: "element", amounts: { FIRE: 2, ICE: 3 } });
    fireEvent.change(screen.getByTestId("effect-outcome-SUCCESS-add"), { target: { value: "CONVERT_DAMAGE_TYPE" } });
    fireEvent.change(screen.getByTestId("effect-outcome-SUCCESS-0-damageTypeParameter"), { target: { value: "element" } });
    // Rename the choice: the cost and the outcome follow it.
    fireEvent.change(screen.getByTestId("effect-parameter-0-name"), { target: { value: "Element chosen" } });
    const p = last(changes);
    expect(p.rules.effect.parameters[0].parameter).toBe("elementChosen");
    expect(p.costContributions[0].data.parameter).toBe("elementChosen");
    expect(p.outcomes[0].data.operations[0].data.damageTypeParameter).toBe("elementChosen");
  });

  it("is lossless: stored data the guided editor does not show (formulas, older data, extra operation fields) is kept", () => {
    const changes: DefinitionCandidate[] = [];
    const base = newCandidate(kindRow("MANEUVER_EFFECT"));
    const stored = {
      ...base,
      payload: {
        ...base.payload,
        effectFamily: "TARGETING_CONVERSION",
        parameters: { legacy: true },
        resolution: { mode: "SAVING_THROW", data: { note: "kept" } },
        outcomes: [{ outcomeKey: "SUCCESS", data: { operations: [{ kind: "FOUNDATION_DAMAGE", data: { fraction: 1, frequency: "ONCE_PER_ROUND" } }] } }],
        rules: { construction: { stacking: { stackable: false } }, effect: { ...(base.payload.rules as any).effect, formulas: [{ formulaKey: "length", expression: "5 * str", rounding: "NONE", minimum: 5, unit: "ft", variables: [{ variable: "str", source: { kind: "STAT", stat: "STR" } }] }], extra: "kept" } },
      },
    };
    render(<Editor kind="MANEUVER_EFFECT" initial={stored} onChange={(c) => changes.push(c)} />);
    expect(screen.getByTestId("effect-kept")).toHaveTextContent("1 authored formula");
    expect(screen.getByTestId("effect-outcome-SUCCESS-0")).toHaveTextContent("Also stored with this line (kept unchanged): Frequency");
    fireEvent.change(screen.getByTestId("effect-outcome-SUCCESS-0-fraction"), { target: { value: "0.5" } });
    const p = last(changes);
    expect(p.outcomes[0].data.operations[0].data).toEqual({ fraction: 0.5, frequency: "ONCE_PER_ROUND" });
    expect(p.parameters).toEqual({ legacy: true });
    expect(p.resolution).toEqual({ mode: "SAVING_THROW", data: { note: "kept" } });
    expect(p.rules.effect.formulas).toHaveLength(1);
    expect(p.rules.effect.extra).toBe("kept");
    expect(p.rules.construction).toEqual({ stacking: { stackable: false } });
  });

  it("a Maneuver Effect may use the Maneuver's own roll, and offers an Affinity-rank reduction on a fixed cost", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="MANEUVER_EFFECT" onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByTestId("effect-resolution-inherit"));
    expect(last(changes).resolution).toBeNull();
    expect(last(changes).rules.effect.resolutionPolicy).toBe("INHERIT_ABILITY");
    fireEvent.click(screen.getByTestId("effect-cost-add"));
    fireEvent.click(screen.getByTestId("effect-cost-0-affinity"));
    fireEvent.change(screen.getByTestId("effect-cost-0-rank-EXPERT"), { target: { value: "1" } });
    expect(last(changes).costContributions[0].data.affinityReduction).toEqual({ affinities: [], byRank: { EXPERT: 1 }, minimum: 0 });
  });

  it("places a server issue next to the control it names (§47)", () => {
    render(<Editor kind="SPELL_EFFECT" issues={[issue("payload.rules.effect.attackType", { message: "Attack Effect identifies attack type" })]} />);
    fireEvent.click(screen.getByLabelText("An attack roll"));
    const control = screen.getByLabelText("Kind of attack");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(control.getAttribute("aria-describedby")!)).toHaveTextContent("Attack Effect identifies attack type");
  });
});

describe("RULES-WO1 Phase F — a Trait, authored in game language", () => {
  it("a Trait changes a measure by a number choice and costs MP per step — the M5 Trait contract", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_TRAIT" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByTestId("trait-name"), { target: { value: "Wide" } });
    fireEvent.change(screen.getByTestId("trait-description"), { target: { value: "Widens the area." } });
    fireEvent.click(screen.getByTestId("trait-parameter-add"));
    fireEvent.change(screen.getByTestId("trait-parameter-0-name"), { target: { value: "Extra feet" } });
    fireEvent.change(screen.getByTestId("trait-modification-add"), { target: { value: "TARGETING_MEASURE" } });
    fireEvent.change(screen.getByTestId("trait-modification-0-measure"), { target: { value: "RADIUS" } });
    fireEvent.change(screen.getByTestId("trait-modification-0-operation"), { target: { value: "ADD" } });
    fireEvent.click(screen.getByTestId("trait-cost-add"));
    fireEvent.change(screen.getByTestId("trait-cost-0-currency"), { target: { value: "MP" } });
    fireEvent.click(screen.getByTestId("trait-cost-0-shape-perNumber"));
    fireEvent.change(screen.getByTestId("trait-cost-0-amount"), { target: { value: "1" } });
    const p = last(changes);
    expect(p.rules.trait).toMatchObject({ family: "SPELL", name: "Wide", description: "Widens the area.", modifications: [{ kind: "TARGETING_MEASURE", parameter: "extraFeet", measure: "RADIUS", operation: "ADD" }] });
    expect(p.costContributions).toEqual([{ contributionKey: "cost.1", currency: "MP", data: { kind: "PER_UNIT", parameter: "extraFeet", amount: 1, includedUnits: 0 } }]);
    expect(Object.keys(p)).not.toContain("outcomes");
  });
});

describe("RULES-WO1 Phase F — game-language helpers", () => {
  it("names and words round-trip; costs and stored Effects read in words", () => {
    expect(asParameterName("Damage dice")).toBe("damageDice");
    expect(asParameterName("  2 extra Targets ")).toBe("extraTargets");
    expect(parameterWords("damageDice")).toBe("Damage dice");
    expect(costWords({ currency: "MP", data: { kind: "PER_SELECTION", parameter: "element", amounts: { FIRE: 2 } } })).toBe("depends on element: Fire 2 MP");
    const renamed = renameParameterReferences({ costContributions: [{ data: { parameter: "a" } }], outcomes: [{ data: { operations: [{ kind: "DAMAGE", data: { diceParameter: "a", target: "a" } }] } }], rules: {} }, "a", "b") as any;
    expect(renamed.costContributions[0].data.parameter).toBe("b");
    expect(renamed.outcomes[0].data.operations[0].data).toEqual({ diceParameter: "b", target: "a" });
    expect(mechanicsSummary({ effectFamily: "HEALING", resolution: { mode: "AUTOMATIC", data: {} }, outcomes: [{ outcomeKey: "SUCCESS", data: { operations: [{ kind: "HEAL", data: {} }] } }], costContributions: [{ currency: "MP", data: { kind: "FIXED", amount: 5 } }], rules: { effect: { parameters: [] } } }, "effect")).toEqual([
      "Does: Healing",
      "Resolves by: It happens automatically (no roll)",
      "On a success: Heals",
      "Costs: 5 MP",
    ]);
  });
});

describe("RULES-WO1 Phase F — a prerequisite chosen by kind in a list (regression)", () => {
  it("a new prerequisite starts as its own record, so choosing its kind is kept (no confirmation, nothing hidden under an empty key)", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SUMMON_TYPE" onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByRole("button", { name: "Add requirement group" }));
    const group = screen.getByRole("group", { name: /Who can create it/ });
    fireEvent.click(within(group).getByRole("button", { name: "Add prerequisite" }));
    fireEvent.change(within(group).getByRole("combobox", { name: "Kind" }), { target: { value: "LEVEL_AT_LEAST" } });
    expect(confirm).not.toHaveBeenCalled();
    expect(within(group).getByLabelText(/^Minimum Level/)).toBeInTheDocument();
    const access = last(changes).access as Array<{ prerequisites: Array<Record<string, unknown>> }>;
    expect(access[0]!.prerequisites[0]).toEqual({ kind: "LEVEL_AT_LEAST", prerequisiteKey: "", minimum: null });
    confirm.mockRestore();
  });
});
