import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { newCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { mechanicsSummary } from "../../app/compendium/admin/_lib/component-mechanics";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, validateStoredProwessDefinition } from "../../../../packages/prowess-game/src/index";
import { CATALOG, issue, kindRow } from "./m6-wo1-fixtures";
import { formulaGuide } from "../../../../packages/prowess-db/src/compendium-rules/formula-guide";
import { EFFECT_REFERENCE_CONTENT } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/effects";

/**
 * RULES-WO1 Phase G (R18) — the remaining Spell / Maneuver components are authored in game language: Targeting,
 * Duration, Casting / Maneuver Conditions and Foundations. The normal path never asks for a property name, a data type,
 * a key, a recursive data editor or programming syntax, and what it stores is accepted by the REAL M5 reader
 * (`validateStoredProwessDefinition`, the same function the server's save-time validation delegates to).
 */
const rules = vi.hoisted(() => ({ listAuthoringOptions: vi.fn(), describeFormula: vi.fn(), composeFormula: vi.fn(), nameFormulaInput: vi.fn(), renameFormulaInput: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/rules-client", async (importActual) => ({ ...(await importActual<object>()), ...rules }));
const auth = vi.hoisted(() => ({ searchDefinitionReferences: vi.fn(), searchKeywords: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), ...auth }));
const { DefinitionEditor } = await import("../../app/compendium/admin/_components/DefinitionEditor");

beforeEach(() => {
  rules.listAuthoringOptions.mockReset();
  rules.listAuthoringOptions.mockResolvedValue([]);
  rules.describeFormula.mockReset();
  rules.describeFormula.mockResolvedValue({ guided: { ok: true, terms: [] }, sourceLabels: [], words: "0", problems: [] });
  auth.searchDefinitionReferences.mockReset();
  auth.searchKeywords.mockReset();
  auth.searchKeywords.mockResolvedValue([]);
});

function Editor({ kind, onChange, issues = [] }: { kind: string; onChange?: (c: DefinitionCandidate) => void; issues?: ReturnType<typeof issue>[] }) {
  const row = kindRow(kind);
  const [c, setC] = useState<DefinitionCandidate>(newCandidate(row));
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
/** The REAL M5 save-time reader: the problems it reports for this payload (empty = accepted). */
function m5Problems(kind: string, payload: unknown): string[] {
  const k = kind as keyof typeof PROWESS_DEFINITION_KINDS;
  const out = validateStoredProwessDefinition({
    entityType: PROWESS_DEFINITION_KINDS[k].entityTypes[0] as never,
    structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 1, systemFamily: PROWESS_DEFINITION_KINDS[k].family, definitionKind: kind, payload: JSON.parse(JSON.stringify(payload)) } },
  });
  return out.ok ? [] : out.problems.map((p) => `${p.code} ${JSON.stringify(p.path)} ${p.message}`);
}
const noTechnicalPath = () => {
  expect(screen.queryByText(/Contribution key/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /Add field/i })).toBeNull();
  expect(screen.queryByLabelText(/Data type|Value type/i)).toBeNull();
  expect(screen.queryByText(/SCREAMING_SNAKE|lowerCamel/)).toBeNull();
};
const choose = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("RULES-WO1 Phase G — Spell Targeting in game language", () => {
  it("builds an expanding burst around the caster: area, size steps, placement, sight, cover and MP per step — accepted by M5", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_TARGETING" onChange={(c) => changes.push(c)} />);
    noTechnicalPath();
    fireEvent.change(screen.getByLabelText(/Semantic shape/), { target: { value: "RADIUS" } });
    choose("targeting-delivery-family", "AREA_DELIVERY");
    fireEvent.click(screen.getByTestId("targeting-cardinality-area"));
    fireEvent.click(screen.getByTestId("targeting-target-CREATURE"));
    fireEvent.click(screen.getByTestId("targeting-target-OBJECT"));
    // A size-step choice, named in plain words.
    fireEvent.click(screen.getByTestId("targeting-parameter-add"));
    fireEvent.change(screen.getByTestId("targeting-parameter-0-name"), { target: { value: "Size steps" } });
    choose("targeting-range-model", "SELF");
    choose("targeting-measure-RADIUS-status", "EFFECT_DEFINED");
    fireEvent.click(screen.getByTestId("targeting-origin-CASTER"));
    choose("targeting-origin-default", "CASTER");
    choose("targeting-placement", "FROM_ORIGIN");
    choose("targeting-line-of-sight", "NOT_REQUIRED");
    choose("targeting-line-of-effect", "REQUIRED");
    choose("targeting-cover", "EXPOSED_TO_RESOLUTION");
    // 4 MP base, plus 2 MP for each 5 ft step.
    fireEvent.click(screen.getByTestId("targeting-cost-add"));
    fireEvent.change(screen.getByTestId("targeting-cost-0-amount"), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("targeting-cost-add"));
    fireEvent.change(screen.getByTestId("targeting-cost-1-amount"), { target: { value: "2" } });

    const p = last(changes);
    expect(p.rules.targeting).toEqual({
      deliveryFamily: "AREA_DELIVERY",
      cardinality: { kind: "AREA" },
      validTargets: ["CREATURE", "OBJECT"],
      range: { model: "SELF" },
      measures: [{ measure: "RADIUS", valueStatus: "EFFECT_DEFINED" }],
      origin: { modes: ["CASTER"], default: "CASTER" },
      placement: "FROM_ORIGIN",
      lineOfSight: "NOT_REQUIRED",
      lineOfEffect: "REQUIRED",
      cover: "EXPOSED_TO_RESOLUTION",
      radiusCapable: true,
      parameters: [{ parameter: "sizeSteps", kind: "STEPS", minimum: 0, default: 0 }],
    });
    expect(p.costContributions).toEqual([
      { contributionKey: "targeting.1", currency: "MP", data: { kind: "BASE", amount: 4 } },
      { contributionKey: "targeting.2", currency: "MP", data: { kind: "PER_STEP", parameter: "sizeSteps", amount: 2, step: { size: 5, unit: "ft" } } },
    ]);
    expect(m5Problems("SPELL_TARGETING", p)).toEqual([]);
    expect(mechanicsSummary(p, "targeting")).toContain("Costs: MP for each size step — 2 MP");
  });

  it("several chosen targets read a number choice; renaming the choice renames the cardinality and the cost that read it", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_TARGETING" onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByTestId("targeting-parameter-add"));
    fireEvent.click(screen.getByTestId("targeting-parameter-0-type-number"));
    fireEvent.change(screen.getByTestId("targeting-parameter-0-name"), { target: { value: "Targets" } });
    fireEvent.click(screen.getByTestId("targeting-cardinality-selected"));
    fireEvent.click(screen.getByTestId("targeting-cost-add"));
    fireEvent.click(screen.getByTestId("targeting-cost-add"));
    choose("targeting-cost-1-kind", "PER_ADDITIONAL_TARGET");
    expect(last(changes).rules.targeting.cardinality).toEqual({ kind: "SELECTED", parameter: "targets", minimum: 2 });
    fireEvent.change(screen.getByTestId("targeting-parameter-0-name"), { target: { value: "Extra targets" } });
    const p = last(changes);
    expect(p.rules.targeting.parameters).toEqual([{ parameter: "extraTargets", kind: "COUNT", minimum: 1 }]);
    expect(p.rules.targeting.cardinality.parameter).toBe("extraTargets");
    expect(p.costContributions[1].data).toEqual({ kind: "PER_ADDITIONAL_TARGET", parameter: "extraTargets", amount: 0 });
  });

  it("a Maneuver Targeting has no cost of its own; a size distance offers the component's own size choices to the Formula", () => {
    render(<Editor kind="MANEUVER_TARGETING" />);
    expect(screen.getByTestId("targeting-maneuver-cost")).toBeTruthy();
    expect(screen.queryByTestId("targeting-cost-add")).toBeNull();
    choose("targeting-range-model", "FIXED");
    expect(within(screen.getByTestId("targeting-range-distance")).getByText("Range in feet")).toBeTruthy();
    expect(within(screen.getByTestId("targeting-range-distance")).queryByText(/Maximum result/)).toBeNull();
  });

  it("a performer-only Maneuver Targeting carries no cost — accepted by M5", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="MANEUVER_TARGETING" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText(/Semantic shape/), { target: { value: "SELF" } });
    choose("targeting-delivery-family", "SELF_DELIVERY");
    fireEvent.click(screen.getByTestId("targeting-cardinality-one"));
    fireEvent.click(screen.getByTestId("targeting-target-SELF"));
    choose("targeting-range-model", "SELF");
    fireEvent.click(screen.getByTestId("targeting-origin-PERFORMER"));
    choose("targeting-origin-default", "PERFORMER");
    choose("targeting-placement", "NONE");
    choose("targeting-line-of-sight", "NOT_REQUIRED");
    choose("targeting-line-of-effect", "NOT_REQUIRED");
    choose("targeting-cover", "NOT_APPLICABLE");
    const p = last(changes);
    expect(p.costContributions).toEqual([]);
    expect(m5Problems("MANEUVER_TARGETING", p)).toEqual([]);
  });

  it("server issues appear beside the control whose path they name", () => {
    render(<Editor kind="SPELL_TARGETING" issues={[issue("payload.rules.targeting.placement", { message: "placement model required" })]} />);
    expect(within(screen.getByTestId("targeting-origin")).getByText(/placement model required/)).toBeTruthy();
  });
});

describe("RULES-WO1 Phase G — Durations in game language", () => {
  it("a Sustained Spell Duration carries the matching play-time markers and no listed cost — accepted by M5", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_DURATION" onChange={(c) => changes.push(c)} />);
    noTechnicalPath();
    choose("duration-concept", "SUSTAINED");
    const p = last(changes);
    expect(p.durationConcept).toBe("SUSTAINED");
    expect(p.rules.duration).toEqual({
      branch: "SPELL",
      availability: "EXECUTABLE",
      deferralKey: null,
      requirements: { kind: "NUMERIC_COMPARE", factKey: "mechanic.present", operator: "==", expected: 1 },
      futureRuntime: { sustain: true, manaLock: false, concentration: "WO13", persists: true },
      costStatus: "UNLISTED",
    });
    expect(m5Problems("SPELL_DURATION", p)).toEqual([]);
  });

  it("a Rounds Duration lists a cost per round; Permanent waits on its open question — both accepted by M5", () => {
    const changes: DefinitionCandidate[] = [];
    const { unmount } = render(<Editor kind="SPELL_DURATION" onChange={(c) => changes.push(c)} />);
    choose("duration-concept", "ROUNDS");
    fireEvent.click(screen.getByTestId("duration-cost-listed"));
    fireEvent.click(screen.getByTestId("duration-cost-add"));
    fireEvent.click(screen.getByTestId("duration-cost-0-shape-perNumber"));
    choose("duration-cost-0-currency", "MP");
    fireEvent.change(screen.getByTestId("duration-cost-0-amount"), { target: { value: "1" } });
    let p = last(changes);
    expect(p.rules.duration.costStatus).toBe("AUTHORED");
    expect(m5Problems("SPELL_DURATION", p)).toEqual([]);
    unmount();
    changes.length = 0;
    render(<Editor kind="MANEUVER_DURATION" onChange={(c) => changes.push(c)} />);
    choose("duration-concept", "PERMANENT_BY_SPECIAL_RULE");
    fireEvent.click(screen.getByTestId("duration-deferred"));
    fireEvent.change(screen.getByTestId("duration-conflict"), { target: { value: "M5 SC 045" } });
    p = last(changes);
    expect(p.rules.duration).toMatchObject({ branch: "MANEUVER", availability: "DEFERRED", deferralKey: "M5-SC-045", futureRuntime: { sustain: false, manaLock: false, concentration: "NONE", persists: true } });
    expect(m5Problems("MANEUVER_DURATION", p)).toEqual([]);
  });
});

describe("RULES-WO1 Phase G — Casting and Maneuver Conditions in game language", () => {
  it("a Verbal-style Casting Condition: restriction, a play check, applicability and a 10% MP reduction — accepted by M5", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_CASTING_CONDITION" onChange={(c) => changes.push(c)} />);
    noTechnicalPath();
    fireEvent.change(screen.getByTestId("condition-restriction"), { target: { value: "Spoken words" } });
    fireEvent.click(screen.getByTestId("condition-runtime-add"));
    fireEvent.change(screen.getByTestId("condition-runtime-0-name"), { target: { value: "Vocalization" } });
    fireEvent.change(screen.getByTestId("condition-runtime-0-fact"), { target: { value: "can vocalize" } });
    choose("condition-applicability-0-fact", "mechanic.targets");
    choose("condition-applicability-0-member", "CREATURE");
    fireEvent.click(screen.getByTestId("condition-cost-add"));
    choose("condition-cost-0-meaning", "MP_PERCENT_REDUCTION");
    fireEvent.change(screen.getByTestId("condition-cost-0-amount"), { target: { value: "10" } });
    const p = last(changes);
    expect(p.restriction).toEqual({ restrictionKey: "SPOKEN_WORDS", data: {} });
    expect(p.rules.condition).toMatchObject({
      branch: "SPELL",
      availability: "EXECUTABLE",
      applicability: { kind: "SET_CONTAINS", factKey: "mechanic.targets", member: "CREATURE" },
      runtimeRequirements: [{ requirementKey: "VOCALIZATION", requirement: { kind: "NUMERIC_COMPARE", factKey: "runtime.canVocalize", operator: ">=", expected: 1 }, parameters: [] }],
      choice: { kind: "ALL" },
      consumesSlot: true,
    });
    expect(p.costContributions).toEqual([{ contributionKey: "condition.1", currency: "MP", data: { kind: "FIXED", amount: 10, modifier: "MP_PERCENT_REDUCTION" } }]);
    expect(m5Problems("SPELL_CASTING_CONDITION", p)).toEqual([]);
    expect(mechanicsSummary(p, "condition")).toContain("Checked in play (not yet run): Vocalization");
  });

  it("an AP-or-MP Maneuver Condition: the user picks one benefit from a list choice; Maneuvers offer only AP / MP reductions", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="MANEUVER_CONDITION" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByTestId("condition-restriction"), { target: { value: "Must move first" } });
    fireEvent.click(screen.getByTestId("condition-runtime-add"));
    fireEvent.change(screen.getByTestId("condition-runtime-0-name"), { target: { value: "Move ten feet first" } });
    fireEvent.change(screen.getByTestId("condition-runtime-0-fact"), { target: { value: "feet moved before" } });
    fireEvent.change(screen.getByTestId("condition-runtime-0-expected"), { target: { value: "10" } });
    // The choice: AP or MP.
    fireEvent.click(screen.getByTestId("condition-parameter-add"));
    fireEvent.change(screen.getByTestId("condition-parameter-0-name"), { target: { value: "Benefit" } });
    fireEvent.click(screen.getByTestId("condition-parameter-0-type-list"));
    for (const o of ["AP", "MP"]) {
      fireEvent.change(screen.getByTestId("condition-parameter-0-options-new"), { target: { value: o } });
      fireEvent.click(screen.getByTestId("condition-parameter-0-options-add"));
    }
    fireEvent.click(screen.getByTestId("condition-choose-one"));
    expect(within(screen.getByTestId("condition-benefit")).queryByRole("option", { name: /Commits extra AP|percentage/ })).toBeNull();
    fireEvent.click(screen.getByTestId("condition-cost-add"));
    choose("condition-cost-0-meaning", "AP_REDUCTION");
    fireEvent.change(screen.getByTestId("condition-cost-0-amount"), { target: { value: "1" } });
    choose("condition-cost-0-option", "AP");
    fireEvent.click(screen.getByTestId("condition-cost-add"));
    choose("condition-cost-1-meaning", "MP_REDUCTION");
    fireEvent.change(screen.getByTestId("condition-cost-1-amount"), { target: { value: "2" } });
    choose("condition-cost-1-option", "MP");
    const p = last(changes);
    expect(p.rules.condition.choice).toEqual({ kind: "CHOOSE_ONE", parameter: "benefit" });
    expect(p.costContributions.map((c: any) => [c.currency, c.data.modifier, c.data.option])).toEqual([
      ["AP", "AP_REDUCTION", "AP"],
      ["MP", "MP_REDUCTION", "MP"],
    ]);
    expect(m5Problems("MANEUVER_CONDITION", p)).toEqual([]);
  });

  it("a Condition that waits on an open rules question keeps no executable benefit — accepted by M5", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="SPELL_CASTING_CONDITION" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByTestId("condition-restriction"), { target: { value: "Material" } });
    fireEvent.click(screen.getByTestId("condition-runtime-add"));
    fireEvent.change(screen.getByTestId("condition-runtime-0-name"), { target: { value: "Material component" } });
    fireEvent.change(screen.getByTestId("condition-runtime-0-fact"), { target: { value: "has material" } });
    fireEvent.click(screen.getByTestId("condition-deferred"));
    fireEvent.change(screen.getByTestId("condition-conflict"), { target: { value: "M5 SC 044" } });
    const p = last(changes);
    expect(p.rules.condition).toMatchObject({ availability: "DEFERRED", deferralKey: "M5-SC-044" });
    expect(p.costContributions).toEqual([]);
    expect(m5Problems("SPELL_CASTING_CONDITION", p)).toEqual([]);
  });
});

describe("RULES-WO1 Phase G — the established portions of M5-SC-044 are authorable as exact instances", () => {
  // M5-SC-044: the GENERIC templates stay deferred, but "exact authored subjects/requirements and objective contributions
  // can use the typed framework". Each instance below names its subject and uses only the source's listed value.
  const author = (kind: string, restriction: string, check: string, fact: string, meaning: string, amount: string) => {
    const changes: DefinitionCandidate[] = [];
    const view = render(<Editor kind={kind} onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByTestId("condition-restriction"), { target: { value: restriction } });
    fireEvent.click(screen.getByTestId("condition-runtime-add"));
    fireEvent.change(screen.getByTestId("condition-runtime-0-name"), { target: { value: check } });
    fireEvent.change(screen.getByTestId("condition-runtime-0-fact"), { target: { value: fact } });
    fireEvent.click(screen.getByTestId("condition-cost-add"));
    choose("condition-cost-0-meaning", meaning);
    fireEvent.change(screen.getByTestId("condition-cost-0-amount"), { target: { value: amount } });
    const p = last(changes);
    view.unmount();
    return p;
  };
  it.each([
    ["SPELL_CASTING_CONDITION", "Delayed until the start of my next turn", "Trigger reached", "delay elapsed", "MP_PERCENT_REDUCTION", "10", "MP"], // s675 Delayed −10% MP
    ["SPELL_CASTING_CONDITION", "Environmental darkness", "In darkness", "in darkness", "MP_PERCENT_REDUCTION", "15", "MP"], // s675 Environmental −15% MP
    ["MANEUVER_CONDITION", "Weapon lock spear", "Wields a spear", "wields spear", "AP_REDUCTION", "1", "AP"], // s2020 Weapon Lock −1 AP
  ])("%s %s — accepted by M5", (kind, restriction, check, fact, meaning, amount, currency) => {
    const p = author(kind, restriction, check, fact, meaning, amount);
    expect(p.costContributions).toEqual([{ contributionKey: "condition.1", currency, data: { kind: "FIXED", amount: Number(amount), modifier: meaning } }]);
    expect(m5Problems(kind, p)).toEqual([]);
  });
});

describe("RULES-WO1 Phase G — Foundations in game language", () => {
  it("a movement Foundation: kind of action, its exact Maneuver Targeting and 1 AP — accepted by M5", async () => {
    const ref = { entityId: "11111111-1111-4111-8111-111111111111", entityVersionId: "22222222-2222-4222-8222-222222222222", canonicalKey: "maneuver.targeting.self", definitionKind: "MANEUVER_TARGETING", systemFamily: "MANEUVER_COMPONENT" };
    auth.searchDefinitionReferences.mockResolvedValue([{ ref, displayName: "Self", revisionNumber: 1, status: "PUBLISHED" }]);
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="MANEUVER_FOUNDATION" onChange={(c) => changes.push(c)} />);
    noTechnicalPath();
    fireEvent.change(screen.getByTestId("foundation-kind"), { target: { value: "Action" } });
    choose("foundation-action-category", "MOVEMENT");
    fireEvent.click(within(screen.getByTestId("foundation-action-targeting")).getByRole("button", { name: /Choose|Change/ }));
    fireEvent.change(within(screen.getByTestId("foundation-action-targeting")).getByRole("searchbox"), { target: { value: "Self" } });
    fireEvent.click(await within(screen.getByTestId("foundation-action-targeting")).findByRole("button", { name: /Self/ }));
    fireEvent.click(screen.getByTestId("foundation-cost-add"));
    choose("foundation-cost-0-currency", "AP");
    fireEvent.change(screen.getByTestId("foundation-cost-0-amount"), { target: { value: "1" } });
    const p = last(changes);
    expect(p.foundationKind).toBe("ACTION");
    expect(p.rules.action).toEqual({ category: "MOVEMENT", targeting: { componentKey: "targeting", definition: ref, parameters: {} } });
    expect(p.costContributions).toEqual([{ contributionKey: "foundation.1", currency: "AP", data: { kind: "FIXED", amount: 1 } }]);
    expect(m5Problems("MANEUVER_FOUNDATION", p)).toEqual([]);
  });
});

describe("RULES-WO1 Phase G — the Formula contributions view never edits from an out-of-date reading", () => {
  it("a second contribution added right after the first keeps the first (the add waits for the server's re-reading)", async () => {
    const { FormulaEditor } = await import("../../app/compendium/admin/_components/FormulaEditor");
    const termsOf = (expr: string) => (expr === "0" ? [{ sign: 1, kind: "CONSTANT", value: 0 }] : expr.split(" + ").map((v) => ({ sign: 1, kind: "CONSTANT", value: Number(v) })));
    rules.describeFormula.mockImplementation(async (expr: string) => ({ parse: { ok: true, variables: [] }, guided: { ok: true, terms: termsOf(expr) }, hazards: [], sourceLabels: [] }));
    rules.composeFormula.mockReset();
    rules.composeFormula.mockImplementation(async (terms: Array<{ value: number }>) => ({ ok: true, expression: terms.map((t) => String(t.value)).join(" + "), variables: [] }));
    const seen: string[] = [];
    function Host() {
      const [f, setF] = useState<Record<string, unknown>>({ expression: "0", rounding: "NONE", minimum: null, unit: "ft", variables: [] });
      return (
        <FormulaEditor
          value={f}
          onChange={(v) => {
            seen.push(String(v.expression));
            setF(v);
          }}
          catalog={CATALOG}
          sourceKinds={[]}
          label="Radius in feet"
          noMaximum
        />
      );
    }
    render(<Host />);
    const add = await screen.findByRole("button", { name: "Add contribution" });
    const shape = screen.getByLabelText("New contribution shape");
    fireEvent.change(shape, { target: { value: "CONSTANT" } });
    fireEvent.change(screen.getByLabelText("New contribution value"), { target: { value: "10" } });
    await vi.waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);
    await vi.waitFor(() => expect(seen).toEqual(["10"]));
    // Until the server has re-read "10", adding is disabled (and ignored): a rebuild from the reading of "0" would drop it.
    expect((screen.getByRole("button", { name: "Add contribution" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("New contribution value"), { target: { value: "5" } });
    await vi.waitFor(() => expect((screen.getByRole("button", { name: "Add contribution" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add contribution" }));
    await vi.waitFor(() => expect(seen).toEqual(["10", "10 + 5"]));
    expect(screen.queryByText(/Maximum result/)).toBeNull();
  });
});

describe("RULES-WO1 Phase G — an Effect's calculated values (the Cone Attack Conversion correction)", () => {
  // The server's own pure Formula guide answers the editor (describe / compose / rename / name).
  const guide = (body: Record<string, unknown>) => formulaGuide(body) as any;
  beforeEach(() => {
    rules.describeFormula.mockImplementation(async (expression: string, sources: unknown) => guide({ op: "describe", expression, sources }).description);
    rules.composeFormula.mockImplementation(async (terms: unknown, sources: unknown) => guide({ op: "compose", terms, sources }));
    rules.nameFormulaInput.mockImplementation(async (source: unknown, taken: unknown, style?: string) => guide({ op: "name", source, taken, ...(style ? { style } : {}) }));
    rules.renameFormulaInput.mockImplementation(async (expression: string, from: string, to: string, sources: unknown) => guide({ op: "rename", expression, from, to, sources }));
  });

  it("replacing the published cone's martial_rank input with the Martial Rank Value gives a lowerCamel name — the same 5 ft × Martial Rank", async () => {
    const name = rules.nameFormulaInput;
    const rename = rules.renameFormulaInput;
    const published = EFFECT_REFERENCE_CONTENT.definitions.find((d) => d.canonicalKey === "maneuver.effect.cone_attack_conversion")!.payload as any;
    const changes: DefinitionCandidate[] = [];
    function Host() {
      const row = kindRow("MANEUVER_EFFECT");
      const [c, setC] = useState<DefinitionCandidate>({ ...newCandidate(row), payload: JSON.parse(JSON.stringify(published)) });
      return <DefinitionEditor kind={row} catalog={CATALOG} candidate={c} issues={[]} onChange={(n) => { setC(n); changes.push(n); }} />;
    }
    render(<Host />);
    expect(screen.getByTestId("effect-formula-0-name")).toHaveValue("Length");
    const formula = within(screen.getByTestId("effect-formula-0"));
    fireEvent.click(await formula.findByRole("button", { name: "Replace input martial_rank" }));
    fireEvent.change(formula.getByLabelText("Replace input martial_rank: source"), { target: { value: "MARTIAL_RANK_VALUE" } });
    fireEvent.click(formula.getByRole("button", { name: "Apply" }));
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0));
    const after = (changes.at(-1)!.payload as any).rules.effect.formulas;
    expect(name).toHaveBeenCalledWith({ kind: "MARTIAL_RANK_VALUE" }, [], "camel");
    expect(rename).toHaveBeenCalled();
    expect(after).toEqual([{ formulaKey: "length", expression: "5 * martialRankValue", rounding: "NONE", minimum: 5, unit: "ft", variables: [{ variable: "martialRankValue", source: { kind: "MARTIAL_RANK_VALUE" } }] }]);
  });
});
