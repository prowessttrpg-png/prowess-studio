import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { newCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { descriptorFor, GENERIC_DESCRIPTOR } from "../../app/compendium/admin/_lib/descriptors";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";

/**
 * RULES-WO1 Phase C — the ordinary-user interface for the remaining families: guided editors (no technical tree), the
 * readable source picker (titles, not section keys), Mission rules by shape, readable choices for Skill ranks and
 * values, truthful status indicators, reference previews and the Keywords screen. Server calls are mocked: these tests
 * prove PRESENTATION; legality and every number stay on the server.
 */
const rules = vi.hoisted(() => ({ describeFormula: vi.fn(), composeFormula: vi.fn(), renameFormulaInput: vi.fn(), nameFormulaInput: vi.fn(), lookupSourceSections: vi.fn(), previewReference: vi.fn(), listAuthoringOptions: vi.fn() }));
vi.mock("../../app/compendium/admin/_lib/rules-client", async (importActual) => ({ ...(await importActual<object>()), ...rules }));
const auth = vi.hoisted(() => ({ getAuthoring: vi.fn(), postAuthoring: vi.fn(), patchAuthoring: vi.fn() }));
const reference = vi.hoisted(() => ({ getRuleUsage: vi.fn(), getKindCapabilities: vi.fn() }));
vi.mock("../../app/compendium/rulesets/_lib/reference-client", async (importActual) => ({ ...(await importActual<object>()), ...reference }));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), ...auth }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => <a href={href} {...rest}>{children}</a> }));
const { DefinitionEditor } = await import("../../app/compendium/admin/_components/DefinitionEditor");
const { EntryOverview, readableNode } = await import("../../app/compendium/admin/_components/EntryOverview");
const { ReferencePreviewPanel } = await import("../../app/compendium/admin/_components/ReferencePreviewPanel");
const { KeywordsScreen } = await import("../../app/compendium/admin/_components/KeywordsScreen");
const { DefinitionPreview } = await import("../../app/compendium/admin/_components/DefinitionPreview");
const { asToken } = await import("../../app/compendium/admin/_lib/token-input");
const { EntryStatus } = await import("../../app/compendium/rulesets/_components/EntryStatus");

const NO_SNAPSHOT = { snapshot: null, snapshots: [], matches: [], known: [], unknown: [] };
beforeEach(() => {
  for (const fn of [...Object.values(rules), ...Object.values(auth), ...Object.values(reference)]) fn.mockReset();
  rules.describeFormula.mockResolvedValue({ ok: true, guided: { ok: true, terms: [] }, sourceLabels: [] });
  rules.lookupSourceSections.mockResolvedValue(NO_SNAPSHOT);
  rules.listAuthoringOptions.mockResolvedValue([]);
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

describe("RULES-WO1 Phase C — every family has a guided editor", () => {
  it("each authorable kind in the catalog has a guided descriptor at its authoring version", () => {
    const technical = CATALOG.kinds.filter((k) => k.authorable && descriptorFor(k, k.authoringSchemaVersion) === GENERIC_DESCRIPTOR).map((k) => k.definitionKind);
    expect(technical).toEqual([]);
  });
  it("new entries start with every field the M5 reader requires", () => {
    expect(Object.keys(newCandidate(kindRow("ARMOR")).payload).sort()).toEqual(["armorKey", "armorValue", "category", "maxAgiForDodge", "movementPenaltyFeet", "notes", "source", "stealth", "strengthRequirement"]);
    expect(newCandidate(kindRow("MISSION_RULE")).payload).toEqual({ ruleKey: "", shape: "", rollTable: null, clock: null, intel: null, points: null, relatedRules: [], source: { locators: [], conflicts: [] } });
    expect(newCandidate(kindRow("MAGE_ART")).schemaVersion).toBe(2);
    expect(Object.keys(newCandidate(kindRow("MAGE_ART")).payload)).toEqual(expect.arrayContaining(["grantedBenefits", "maintenanceExceptions"]));
  });
  it("every capability in the catalog is stated, and reference families say they are not used in play", () => {
    for (const k of CATALOG.kinds) expect(CATALOG.capabilities?.[k.definitionKind], k.definitionKind).toBeDefined();
    for (const k of ["ARMOR", "STATUS_CONDITION", "SUMMON_TYPE", "SUMMON_TRAIT", "MISSION_RULE", "METAMAGIC", "JOB_TEMPLATE", "MAGE_ART", "CONCENTRATION_RULE"]) expect(CATALOG.capabilities?.[k]?.execution, k).toBe("REFERENCE_ONLY");
  });
});

describe("RULES-WO1 Phase C — readable source picker", () => {
  it("chooses rulebook sections by title; the keys are stored but only shown under Section keys", async () => {
    rules.lookupSourceSections.mockImplementation(async (q: string, locators: string[]) => ({
      snapshot: { id: "s", label: "Core Playtest", sectionCount: 3 },
      snapshots: [],
      matches: q === "armor" ? [{ locator: "s540", title: "ARMOR", headingLevel: 1, parentTitle: null }, { locator: "s545", title: "LIGHT ARMOR", headingLevel: 1, parentTitle: null }] : [],
      known: locators.includes("s540") ? [{ locator: "s540", title: "ARMOR", headingLevel: 1, parentTitle: null }] : [],
      unknown: [],
    }));
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("ARMOR"))} onChange={(c) => changes.push(c)} />);
    fireEvent.change(await screen.findByTestId("source-search", {}, { timeout: 5000 }), { target: { value: "armor" } });
    const matches = await screen.findByTestId("source-matches");
    fireEvent.click(within(matches).getByRole("button", { name: "Add ARMOR" }));
    await waitFor(() => expect(changes.at(-1)?.payload.source).toEqual({ locators: ["s540"], conflicts: [] }));
    await waitFor(() => expect(screen.getByTestId("source-chosen").textContent).toContain("ARMOR"));
  });
  it("without an imported rulebook it says so and keeps the keys editable", async () => {
    render(<Editor initial={newCandidate(kindRow("STATUS_CONDITION"))} />);
    expect((await screen.findByTestId("source-no-snapshot", {}, { timeout: 5000 })).textContent).toMatch(/No rulebook is imported/);
  });
});

describe("RULES-WO1 Phase C — Mission rules, Skill ranks and status", () => {
  it("a Mission rule's shape decides its part: a table with rows, or a clock with escalations", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("MISSION_RULE"))} onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText("Kind of rule"), { target: { value: "ROLL_TABLE" } });
    await waitFor(() => expect(changes.at(-1)?.payload).toMatchObject({ shape: "ROLL_TABLE", rollTable: { dieCount: 1, dieFaces: 20, rows: [] }, clock: null, intel: null, points: null }));
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.change(screen.getByLabelText("Row 1 from"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Row 1 to"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Row 1 result"), { target: { value: "Anything." } });
    await waitFor(() => expect((changes.at(-1)?.payload.rollTable as { rows: unknown[] }).rows).toEqual([{ from: 1, to: 20, result: "Anything." }]));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.change(screen.getByLabelText("Kind of rule"), { target: { value: "CLOCK" } });
    await waitFor(() => expect(changes.at(-1)?.payload).toMatchObject({ shape: "CLOCK", rollTable: null, clock: { segments: 6 } }));
  });
  it("a Skill benefit's rank is chosen by name", async () => {
    rules.listAuthoringOptions.mockResolvedValue([{ token: "EXPERT", label: "Expert" }, { token: "TRAINED", label: "Trained" }]);
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("SKILL_BENEFIT"))} onChange={(c) => changes.push(c)} />);
    const select = (await screen.findByTestId("content-token-skillRanks")) as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.text)).toEqual(["Choose…", "Expert", "Trained"]));
    fireEvent.change(select, { target: { value: "TRAINED" } });
    await waitFor(() => expect(changes.at(-1)?.payload.minimumRankKey).toBe("TRAINED"));
  });
  it("the Overview states validation, publication, preview, connections and live status from their real sources", async () => {
    reference.getRuleUsage.mockResolvedValue({ node: { role: "DEFINITION", token: "x" }, reads: [{ from: "STAT:STR", via: "FORMULA_VARIABLE", variable: "str" }], usedBy: [{ role: "DEFINITION", token: "y", displayName: "Half Load", depth: 1 }] });
    render(<EntryOverview capability={CATALOG.capabilities!.ARMOR!} validationStatus="PASS" releaseId="r1" entityId="e1" purpose="A suit of worn Armor." />);
    expect(screen.getByTestId("status-validated").textContent).toContain("yes");
    expect(screen.getByTestId("status-live").textContent).toMatch(/Reference only — not used in play yet/);
    await waitFor(() => expect(screen.getByTestId("status-published").textContent).toContain("yes"));
    expect(screen.getByTestId("usage-reads").textContent).toBe("Stat STR");
    expect(screen.getByTestId("usage-used-by").textContent).toContain("Half Load");
    expect(reference.getRuleUsage).toHaveBeenCalledWith("r1", "e1");
    expect(readableNode("DERIVED:STRENGTH_ARMOR")).toBe("Strength Armor");
  });
  it("without a Release the Overview does not claim publication", () => {
    render(<EntryOverview capability={CATALOG.capabilities!.CALCULATED_VALUE!} validationStatus={null} releaseId={null} entityId="e1" purpose={null} />);
    expect(screen.getByTestId("status-published").textContent).toMatch(/open this entry from a Release/);
    expect(screen.getByTestId("status-live").textContent).toMatch(/Partly used in play/);
    expect(reference.getRuleUsage).not.toHaveBeenCalled();
  });
});

describe("RULES-WO1 Phase C — reference previews and Keywords", () => {
  it("previews Armor from the server and says play does not use it", async () => {
    rules.previewReference.mockResolvedValue({ definitionKind: "ARMOR", result: { armorValue: 5, agiCountedForDodge: 5, agiCapped: true, meetsStrengthRequirement: false, movementPenaltyFeet: 5, stealthDisadvantage: true, appliesInPlay: false } });
    render(<ReferencePreviewPanel entityVersionId="v1" sample="SHEET" unsavedChanges={false} />);
    expect(screen.getByTestId("reference-not-in-play").textContent).toBe("Preview only — play does not use this rule yet.");
    fireEvent.click(screen.getByTestId("reference-preview-run"));
    expect((await screen.findByTestId("preview-armor-agi")).textContent).toBe("5 (capped by the armor)");
    expect(screen.getByTestId("preview-armor-str").textContent).toBe("no");
    expect(rules.previewReference.mock.calls[0]![0]).toMatchObject({ entityVersionId: "v1", sample: { stats: { STR: 4, AGI: 4 } } });
  });
  it("previews a table roll", async () => {
    rules.previewReference.mockResolvedValue({ definitionKind: "MISSION_RULE", result: { roll: 20, result: "Hidden clause.", appliesInPlay: false } });
    render(<ReferencePreviewPanel entityVersionId="v2" sample="ROLL_OR_CLOCK" unsavedChanges={false} />);
    fireEvent.change(screen.getByLabelText("Sample roll"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("reference-preview-run"));
    expect((await screen.findByTestId("preview-table-result")).textContent).toBe("Hidden clause.");
  });
  it("the Keywords screen lists Keywords by category and creates one without typing a machine key", async () => {
    auth.getAuthoring.mockImplementation(async (path: string) =>
      path === "/api/keywords" ? [{ id: "k1", canonicalKey: "keyword_category.element.fire", name: "Fire", categoryId: "c1", description: null, deprecated: false }] : [{ id: "c1", canonicalKey: "keyword_category.element", name: "Element", description: null }],
    );
    auth.postAuthoring.mockResolvedValue({});
    render(<KeywordsScreen />);
    expect((await screen.findByTestId("keyword-list")).textContent).toContain("Fire");
    fireEvent.change(screen.getByLabelText("Name (required)"), { target: { value: "Cold Iron" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyword" }));
    await waitFor(() => expect(auth.postAuthoring).toHaveBeenCalledWith("/api/keywords", { canonicalKey: "keyword_category.element.cold_iron", name: "Cold Iron", categoryId: "c1", description: null }));
  });
  it("shows the Keyword's permanent key before it is created (never set silently, never typed)", async () => {
    auth.getAuthoring.mockResolvedValue([]);
    render(<KeywordsScreen />);
    fireEvent.change(screen.getByLabelText("Name (required)"), { target: { value: "Cold Iron" } });
    expect(screen.getByTestId("keyword-key-preview").textContent).toContain("keyword.cold_iron");
  });
  it("R09: edits a Keyword's words only — shows where it is used, sends the values it loaded, and reports a stale edit", async () => {
    const fire = { id: "k1", canonicalKey: "keyword_category.element.fire", name: "Fire", categoryId: "c1", description: null, deprecated: false };
    auth.getAuthoring.mockImplementation(async (path: string) =>
      path === "/api/keywords" ? [fire] : path.endsWith("/usage") ? { entityAssignments: 2, versionAssignments: 1, definitionRevisions: 4, releases: 2, imported: false } : [{ id: "c1", canonicalKey: "keyword_category.element", name: "Element", description: null }],
    );
    auth.patchAuthoring.mockResolvedValueOnce({ ...fire, name: "Flame" });
    render(<KeywordsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Fire" }));
    expect((await screen.findByTestId("keyword-usage")).textContent).toMatch(/4 Definition revision\(s\) in 2 Release\(s\)/);
    expect(screen.getByTestId("keyword-usage").textContent).toContain("permanent key and category stay the same");
    expect(screen.getByTestId("keyword-editor").textContent).not.toContain("keyword_category.element.fire");
    await waitFor(() => expect(screen.getByTestId("keyword-usage").textContent).toMatch(/Used by/));
    fireEvent.change(screen.getByLabelText("Keyword name"), { target: { value: "Flame" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Keyword" }));
    await waitFor(() => expect(auth.patchAuthoring).toHaveBeenCalledWith("/api/keywords/k1/presentation", { expected: { name: "Fire", description: null, deprecated: false }, name: "Flame", description: null, deprecated: false }));
    expect((await screen.findByTestId("keyword-list")).textContent).toContain("Flame");

    const { AuthoringApiError } = await vi.importActual<typeof import("../../app/compendium/admin/_lib/authoring-client")>("../../app/compendium/admin/_lib/authoring-client");
    auth.patchAuthoring.mockRejectedValueOnce(new AuthoringApiError("KEYWORD.STALE_EDIT", "Keyword changed after it was loaded. Reload it before saving — nothing was changed.", 409));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Flame" }));
    await waitFor(() => expect(screen.getByTestId("keyword-usage").textContent).toMatch(/Used by/));
    fireEvent.change(screen.getByLabelText("Keyword name"), { target: { value: "Blaze" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Keyword" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was changed/);
  });
  it("R09: an imported Keyword is shown read-only and cannot be saved", async () => {
    const fire = { id: "k1", canonicalKey: "keyword_category.element.fire", name: "Fire", categoryId: "c1", description: null, deprecated: false };
    auth.getAuthoring.mockImplementation(async (path: string) =>
      path === "/api/keywords" ? [fire] : path.endsWith("/usage") ? { entityAssignments: 0, versionAssignments: 0, definitionRevisions: 1, releases: 1, imported: true } : [{ id: "c1", canonicalKey: "keyword_category.element", name: "Element", description: null }],
    );
    render(<KeywordsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Fire" }));
    expect((await screen.findByTestId("keyword-imported")).textContent).toMatch(/read-only/);
    expect((screen.getByLabelText("Keyword name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save Keyword" }) as HTMLButtonElement).disabled).toBe(true);
    expect(auth.patchAuthoring).not.toHaveBeenCalled();
  });
});

describe("RULES-WO1 Phase D — the Definition preview names fields in words", () => {
  it("labels each stored field with the editor's label (or the field name in words) — never a payload key", () => {
    const candidate = { ...newCandidate(kindRow("ARMOR")), payload: { armorKey: "PLATE", armorValue: 5, movementPenaltyFeet: -5, extraPart: { a: 1 } } };
    render(<DefinitionPreview content={{ displayName: "Plate", shortDescription: "", rulesText: "", status: null, revisionNumber: null, sources: [] }} candidate={candidate} validation={null} fields={descriptorFor(kindRow("ARMOR"), 1).fields} />);
    const summary = screen.getByRole("region", { name: "Structured mechanical summary" });
    expect(within(summary).getByText("Armor granted")).toBeTruthy();
    expect(within(summary).getByText("Movement penalty (feet)")).toBeTruthy();
    expect(within(summary).getByText("Extra part")).toBeTruthy();
    expect(summary.textContent).not.toMatch(/armorValue|movementPenaltyFeet|extraPart/);
  });
});

describe("RULES-WO1 Phase D — names are typed in plain words, never as tokens", () => {
  it("derives the stored token as the author types, visibly, and leaves a valid token unchanged", () => {
    expect(asToken("Tier 1", true)).toBe("TIER_1");
    expect(asToken("tactical ")).toBe("TACTICAL_");
    expect(asToken("tactical plating!", true)).toBe("TACTICAL_PLATING");
    expect(asToken("ALREADY_A_TOKEN", true)).toBe("ALREADY_A_TOKEN");
  });
  it("an identity name field stores the token of what was typed", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("ARMOR"))} onChange={(c) => changes.push(c)} />);
    const input = screen.getByLabelText(/^Armor name used by other rules/);
    fireEvent.change(input, { target: { value: "Tactical plating" } });
    fireEvent.blur(input);
    await waitFor(() => expect(changes.at(-1)?.payload.armorKey).toBe("TACTICAL_PLATING"));
    expect((input as HTMLInputElement).value).toBe("TACTICAL_PLATING");
  });
});

describe("RULES-WO1 Phase D — the Rules Reference entry states its status truthfully (R17)", () => {
  it("says the Release pins the revision and what this build does with the kind, from the capability registry", async () => {
    reference.getKindCapabilities.mockResolvedValue({ ARMOR: { execution: "REFERENCE_ONLY", consumers: ["Rules Reference"], preview: "REFERENCE_PREVIEW", notYet: "The sheet does not equip worn Armor yet." } });
    render(<EntryStatus definitionKind="ARMOR" revisionNumber={2} />);
    expect(screen.getByTestId("reference-status-published").textContent).toContain("Revision 2");
    const live = await screen.findByTestId("reference-status-live");
    expect(live.getAttribute("data-state")).toBe("REFERENCE_ONLY");
    expect(live.textContent).toContain("Reference only — not used in play yet");
    expect(live.textContent).toContain("does not equip worn Armor");
    expect(screen.getByTestId("reference-status-preview").textContent).toContain("sample inputs");
  });
  it("a non-Prowess entry is content only and asks the registry nothing", () => {
    render(<EntryStatus definitionKind={null} revisionNumber={1} />);
    expect(screen.getByText(/content only/)).toBeTruthy();
    expect(reference.getKindCapabilities).not.toHaveBeenCalled();
  });
});

describe("RULES-WO1 Phase E — compatibility rules without typed keys (R18)", () => {
  it("chooses the relation from the list and adds an allowed label in plain words; the stored label stays exact", async () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor initial={newCandidate(kindRow("SPELL_EFFECT"))} onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByRole("button", { name: "Add compatibility rule" }));
    const rule = await screen.findByTestId("compatibility-rule");
    const relation = within(rule).getByLabelText("Relation") as HTMLSelectElement;
    expect([...relation.options].map((o) => o.value)).toEqual(expect.arrayContaining(["TARGETING", "KEYWORD", "AFFINITY", "ABILITY_KIND"]));
    expect([...relation.options].find((o) => o.value === "ABILITY_KIND")?.textContent).toBe("Ability Kind");
    fireEvent.change(relation, { target: { value: "ABILITY_KIND" } });
    fireEvent.click(within(rule).getByRole("button", { name: "Add another label" }));
    fireEvent.change(within(rule).getByLabelText("Allowed label in plain words"), { target: { value: "single target" } });
    fireEvent.click(within(rule).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(changes.at(-1)?.payload.compatibility).toEqual([{ relation: "ABILITY_KIND", allow: ["SINGLE_TARGET"] }]));
    expect(within(rule).getByTestId("compatibility-allowed").textContent).toMatch(/^Single target/);
    expect(within(rule).queryByText(/comma-separated/)).toBeNull();
  });
});
