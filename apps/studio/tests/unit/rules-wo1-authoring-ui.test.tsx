import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildIdentity, guidedEditorCoverage } from "../../app/about/build-identity";
import { AdditionalValuesPanel, CarryPanel } from "../../app/characters/_components/sheet/SheetPanels";
import type { SheetCalculatedValueDto } from "../../app/characters/_lib/character-client";
import type { DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { newCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { descriptorFor, GENERIC_DESCRIPTOR } from "../../app/compendium/admin/_lib/descriptors";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";
import { sheetFixture } from "./m6-wo5-sheet-fixture";

/**
 * RULES-WO1 — game-language authoring of calculated values, Skill benefits and the Concentration rule; the sheet's
 * labelled calculated values; and "About this build". Server calls are mocked: these tests prove PRESENTATION — every
 * number shown comes from the (mocked) server, and nothing here calculates a rule.
 */
const rules = vi.hoisted(() => ({ describeFormula: vi.fn(), composeFormula: vi.fn(), renameFormulaInput: vi.fn(), nameFormulaInput: vi.fn(), previewRuleCandidate: vi.fn(), previewAuthoredRules: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/rules-client", async (importActual) => ({ ...(await importActual<object>()), ...rules }));
const { DefinitionEditor } = await import("../../app/compendium/admin/_components/DefinitionEditor");
const { AuthoredRulePreviewPanel } = await import("../../app/compendium/admin/_components/AuthoredRulePreviewPanel");

beforeEach(() => {
  for (const fn of Object.values(rules)) fn.mockReset();
  rules.describeFormula.mockResolvedValue({ ok: true, guided: { ok: true, terms: [] }, sourceLabels: [] });
});

function Editor({ initial, onChange }: { initial: DefinitionCandidate; onChange?: (c: DefinitionCandidate) => void }) {
  const [c, setC] = useState(initial);
  return (
    <DefinitionEditor
      kind={kindRow(initial.definitionKind)}
      catalog={CATALOG}
      candidate={c}
      issues={[]}
      onChange={(next) => {
        setC(next);
        onChange?.(next);
      }}
    />
  );
}

describe("RULES-WO1 guided descriptors", () => {
  it("the three new kinds and every Stat / derived-statistic kind have a guided editor (never the technical tree)", () => {
    for (const kind of ["CALCULATED_VALUE", "SKILL_BENEFIT", "CONCENTRATION_RULE", "STAT", "DERIVED_STAT", "SKILL", "MAGE_ART"]) {
      expect(descriptorFor(kindRow(kind), 1), kind).not.toBe(GENERIC_DESCRIPTOR);
    }
  });

  it("the build's coverage list is derived from the code: the new kinds are guided", () => {
    const { guided, technical } = guidedEditorCoverage(CATALOG.kinds);
    expect(guided).toEqual(expect.arrayContaining(["CALCULATED_VALUE", "SKILL_BENEFIT", "CONCENTRATION_RULE", "STAT"]));
    expect(technical.filter((k) => ["CALCULATED_VALUE", "SKILL_BENEFIT", "CONCENTRATION_RULE", "STAT"].includes(k))).toEqual([]);
  });

  it("a new calculated value starts complete for the M5 reader's required fields, with no base invented", () => {
    const c = newCandidate(kindRow("CALCULATED_VALUE"));
    expect(Object.keys(c.payload).sort()).toEqual(["base", "canonStatus", "note", "placement", "source", "unit", "valueKey"]);
    expect(c.payload.base).toBeNull();
    expect(c.payload.source).toBeNull();
  });
});

describe("RULES-WO1 calculated value editor (game language)", () => {
  it("states 'not stated in the rulebook' for a value without a base, and switching to a stated base adds an empty calculation", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("CALCULATED_VALUE"))} onChange={(c) => changes.push(c)} />);
    expect(screen.getByTestId("formula-not-stated").textContent).toMatch(/no base value is invented/);
    expect(screen.queryByText(/no dedicated authoring descriptor/)).toBeNull();
    expect(document.body.textContent).toContain("Where this rule comes from");
    fireEvent.click(screen.getByLabelText("The rule states a base calculation"));
    await waitFor(() => expect(changes.at(-1)?.payload.base).toEqual({ expression: "0", rounding: "", minimum: null, maximum: null, unit: null, variables: [] }));
    fireEvent.click(screen.getByLabelText(/does not state a base value/));
    await waitFor(() => expect(changes.at(-1)?.payload.base).toBeNull());
  });

  it("citing the rulebook is optional and switchable", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("CALCULATED_VALUE"))} onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByLabelText("Cite rulebook sections"));
    expect(changes.at(-1)?.payload.source).toEqual({ locators: [], conflicts: [] });
  });

  it("the Concentration rule is edited as points, upkeep and plain yes/no allocation rules", () => {
    render(<Editor initial={newCandidate(kindRow("CONCENTRATION_RULE"))} />);
    expect(document.body.textContent).toContain("Concentration points");
    expect(document.body.textContent).toContain("Sustained Spell upkeep (AP per round)");
    expect(document.body.textContent).toContain("Upkeep AP not covered is still paid");
    expect(document.body.textContent).toContain("Points also waive MP upkeep");
  });
});

const CONCENTRATION_PREVIEW = {
  capacity: 3,
  assignedPoints: 1,
  freePoints: 2,
  effects: [{ label: "Sustained Spell", castAp: 5, upkeepAp: 2, assignedPoints: 1, coveredAp: 1, payableAp: 1 }],
  totalPayableAp: 1,
  mpUpkeepStillPaid: true,
  manaLockStillApplies: true,
  openQuestions: ["Can points be reassigned while an Effect continues?"],
  appliesInPlay: false,
  issues: [],
};
const side = (values: unknown[], concentration: unknown[] = []) => ({ ok: true, problems: [], values, concentration, skills: [{ entityId: "11111111-1111-4111-8111-111111111111", canonicalKey: "skill.athletics", displayName: "Athletics" }], ranks: ["UNTRAINED", "TRAINED", "EXPERT"] });
const CARRY: SheetCalculatedValueDto = { valueKey: "CARRY_CAPACITY", definition: null, unit: "lb", canonStatus: "TEST_ONLY", placement: "CARRY_MAXIMUM_LOAD", note: "placeholder", baseStated: true, base: 100, contributions: [], total: 100, unavailable: null };
const THROW: SheetCalculatedValueDto = {
  valueKey: "THROW_DISTANCE",
  definition: null,
  unit: "ft",
  canonStatus: "OWNER_PROVIDED",
  placement: "ADDITIONAL_VALUES",
  note: "base not stated",
  baseStated: false,
  base: null,
  contributions: [{ benefitKey: "ATHLETICS_TRAINED_THROW", contributionKey: "PER_STR", minimumRankKey: "TRAINED", applies: true, amount: 20 }],
  total: 20,
  unavailable: null,
};

describe("RULES-WO1 authored-rule preview", () => {
  it("sends the saved Draft and a sample Character; shows values with their status and the Concentration preview as preview only", async () => {
    rules.previewAuthoredRules.mockResolvedValue({
      release: { id: "r", rulesetId: "rs", releaseNumber: 1, versionLabel: "0.1" },
      overlay: [{ entityId: "e", entityVersionId: "v", revisionNumber: 1, status: "DRAFT", mode: "ADDED" }],
      candidate: side([{ ...THROW, displayName: "Throw Distance", contributions: [{ ...THROW.contributions[0], skill: { canonicalKey: "skill.athletics" } }] }], [{ canonicalKey: "core.concentration", displayName: "Concentration", preview: CONCENTRATION_PREVIEW }]),
      published: side([]),
    });
    render(<AuthoredRulePreviewPanel releaseId="22222222-2222-4222-8222-222222222222" drafts={["33333333-3333-4333-8333-333333333333"]} focusStat="RES" />);
    fireEvent.click(screen.getByTestId("authored-preview-run"));
    await screen.findByTestId("authored-preview-result");
    const body = rules.previewAuthoredRules.mock.calls[0]![0] as { drafts: string[]; sample: { stats: Record<string, number>; effects: unknown[] } };
    expect(body.drafts).toEqual(["33333333-3333-4333-8333-333333333333"]);
    expect(body.sample.stats.RES).toBe(6);
    expect(body.sample.effects).toEqual([{ label: "Sustained Spell", castAp: 5, assignedPoints: 1 }]);
    const row = screen.getByTestId("authored-value-THROW_DISTANCE");
    expect(within(row).getByTestId("authored-value-result").textContent).toBe("+20 ft from bonuses (base not stated in the rulebook)");
    expect(within(row).getByTestId("canon-badge").textContent).toBe("Owner ruling");
    expect(screen.getByTestId("concentration-not-in-play").textContent).toBe("Preview only — combat does not use this rule yet.");
    expect(screen.getByTestId("concentration-capacity").textContent).toBe("3");
    expect(screen.getByTestId("concentration-upkeep").textContent).toBe("2");
    expect(screen.getByTestId("concentration-payable").textContent).toBe("1");
    // The Skill of a benefit can now be given a sample rank.
    expect(screen.getByLabelText("Sample Athletics rank")).toBeTruthy();
  });
});

describe("RULES-WO1 Character sheet: calculated values are labelled by where they come from", () => {
  it("the Carry maximum shows the published value and says when it is a test value", () => {
    const base = sheetFixture();
    const sheet = { ...base, mechanics: { ...base.mechanics, carry: { ...base.mechanics.carry, maximumLoad: { value: 100, unit: "lb", unavailable: null, source: null } }, calculatedValues: [CARRY, THROW] } };
    render(
      <>
        <CarryPanel sheet={sheet} />
        <AdditionalValuesPanel sheet={sheet} />
      </>,
    );
    expect(screen.getByTestId("sheet-carry-max").textContent).toBe("100 lb");
    expect(screen.getByTestId("sheet-carry-canon").textContent).toContain("Test value — not canon");
    const throwRow = screen.getByTestId("sheet-value-THROW_DISTANCE");
    expect(throwRow.textContent).toContain("+20 ft");
    expect(throwRow.textContent).toContain("base not stated");
    expect(throwRow.textContent).toContain("Owner ruling");
  });

  it("without published values nothing new is shown", () => {
    const sheet = sheetFixture();
    const { container } = render(<AdditionalValuesPanel sheet={sheet} />);
    expect(container.textContent).toBe("");
  });
});

describe("RULES-WO1 About this build", () => {
  it("reads the installed build identity from the desktop controller's environment and refuses malformed values", () => {
    const commit = "a".repeat(40);
    expect(buildIdentity({ PROWESS_DESKTOP_MODE: "true", PROWESS_APP_VERSION: "0.1.3", PROWESS_BUILD_COMMIT: commit, PROWESS_BUILD_TREE: "b".repeat(40), PROWESS_PACKAGE_SHA256: "c".repeat(64) }, "0.0.0")).toEqual({
      version: "0.1.3",
      mode: "DESKTOP",
      commit,
      tree: "b".repeat(40),
      packageSha256: "c".repeat(64),
    });
    expect(buildIdentity({ PROWESS_BUILD_COMMIT: "not-a-commit", PROWESS_APP_VERSION: "latest" }, "0.1.3")).toEqual({ version: "0.1.3", mode: "OTHER", commit: null, tree: null, packageSha256: null });
  });
});
