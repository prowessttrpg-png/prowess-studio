import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateDto, CharacterDto, CreationContextDto, OptionDto, ResolutionDto } from "../../app/characters/_lib/character-client";

/**
 * PAS-10 M6-WO3 §103 — Character UI. The Character API client is mocked: these tests prove PRESENTATION and the wizard's
 * interaction contract — explicit Release selection with capability errors, the concept step, Ancestry cards with exact
 * Release Rules Reference links, distinct Stat-choice selectors, a points meter that shows the SERVER's numbers, Skill
 * selection with duplicate prevention, Primary Affinity selection, the Review with the server's derived preview, server
 * validation issues, the stale-save message, the completed read-only state, the index and accessibility labels.
 * Nothing here calculates a rule: every number shown comes from the mocked server resolution.
 * Invariants: M6-I025 (completed Characters are read-only), M6-I027 (options come only from the Release context).
 */
const client = vi.hoisted(() => ({
  listCharacters: vi.fn(),
  createCharacter: vi.fn(),
  getCharacter: vi.fn(),
  getCreationContext: vi.fn(),
  checkCharacter: vi.fn(),
  saveCreation: vi.fn(),
  saveProfile: vi.fn(),
  completeCoreCreation: vi.fn(),
  getCapability: vi.fn(),
}));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
const reference = vi.hoisted(() => ({ listReleases: vi.fn() }));
vi.mock("../../app/compendium/rulesets/_lib/reference-client", async (importActual) => ({ ...(await importActual<object>()), ...reference }));
const governance = vi.hoisted(() => ({ listAllRulesets: vi.fn() }));
vi.mock("../../src/api-client/governance", async (importActual) => ({ ...(await importActual<object>()), ...governance }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/characters" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { CharacterWizard } = await import("../../app/characters/_components/CharacterWizard");
const { NewCharacterForm } = await import("../../app/characters/_components/NewCharacterForm");
const { CharacterIndex } = await import("../../app/characters/_components/CharacterIndex");
const { CharacterSheetSummary } = await import("../../app/characters/_components/CharacterSheetSummary");
const { CharacterApiError } = await import("../../app/characters/_lib/character-client");

const RELEASE = { id: "rel1", rulesetId: "rs1", rulesetName: "Core Playtest", releaseNumber: 3, versionLabel: "0.3.0", channel: "CORE_PLAYTEST" };
const ref = (entityId: string, entityVersionId: string, definitionKind: string, canonicalKey = `test.${entityId}`) => ({ entityId, entityVersionId, canonicalKey, definitionKind, systemFamily: "CHARACTER" });
const option = (entityId: string, versionId: string, kind: string, displayName: string, payload: Record<string, unknown> | null = null, extra: Partial<OptionDto> = {}): OptionDto => ({
  ref: ref(entityId, versionId, kind),
  displayName,
  shortDescription: `${displayName} description`,
  revisionNumber: 1,
  payload,
  ...extra,
});
const SKILL_NAMES = ["Athletics", "Survival", "Stealth", "Arcana"];
const SKILLS = SKILL_NAMES.map((n) => option(`sk-${n.toLowerCase()}`, `skv-${n.toLowerCase()}`, "SKILL", n));
const sel = (o: OptionDto) => ({ entityId: o.ref.entityId, entityVersionId: o.ref.entityVersionId });
const ORCANI = option("anc-orcani", "ancv-orcani", "ANCESTRY", "Orcani", {
  baseHp: 10,
  baseMp: 4,
  statGrants: [
    { grantKey: "orcani_might", kind: "FIXED", stat: "STR", amount: 2 },
    { grantKey: "orcani_versatility", kind: "CHOOSE_DISTINCT", count: 2, amount: 1, allowedStats: ["AGI", "CON", "PER", "RES", "PRO"] },
  ],
  skillGrants: [{ grantKey: "orcani_upbringing", rankKey: "TRAINED", selectionKind: "CHOOSE_FROM", count: 1, options: [sel(SKILLS[0]!), sel(SKILLS[1]!)] }],
  source: { document: "test", section: "test" },
});
const EVOCATION = option("aff-evo", "affv-evo", "AFFINITY", "Evocation", { identity: { text: "Raw force.", themes: ["force"] }, strengths: [{}], weaknesses: [] }, { schemaVersion: 2, executable: true });
const LEGACY = option("aff-old", "affv-old", "AFFINITY", "Legacy Affinity", {}, { schemaVersion: 1, executable: false });
const STATS = ["STR", "AGI", "CON", "PER", "RES", "PRO"];

const CONTEXT: CreationContextDto = {
  character: { id: "c1", name: "Grukk", lockVersion: 2, status: "DRAFT" },
  release: RELEASE,
  capability: { status: "READY", missing: [] },
  creationRule: option("rule", "rulev", "CHARACTER_CREATION_RULE", "Creation Rule", { startingLevel: 1, statPointBudget: 15, freeTrainedSkillCount: 2 }),
  stats: STATS.map((s) => ({ stat: s, minimum: 1, maximum: 10, ref: ref(`stat-${s}`, `statv-${s}`, "STAT") })),
  characterDie: { level: 1, dieKey: "D4", faces: 4 },
  skillRankLadder: { ref: ref("ladder", "ladderv", "RANK_LADDER"), ranks: [{ rankKey: "TRAINED", order: 1 }] },
  derivedStatistics: [],
  ancestries: [ORCANI],
  skills: SKILLS,
  affinities: [EVOCATION, LEGACY],
};
const EMPTY: CandidateDto = { ancestry: null, ancestryStatChoices: [], statAllocations: {}, skills: [], primaryAffinity: null };

function resolution(over: Partial<ResolutionDto["resolved"]> = {}, status: ResolutionDto["status"] = "INCOMPLETE", issues: ResolutionDto["issues"] = [], derived: ResolutionDto["derivedPreview"] = null): ResolutionDto {
  return {
    status,
    issues,
    capability: { status: "READY", missing: [] },
    resolved: {
      level: 1,
      characterDie: { dieKey: "D4", faces: 4 },
      creationRule: CONTEXT.creationRule!.ref,
      ancestry: null,
      baseHp: null,
      baseMp: null,
      pointBudget: 15,
      pointsSpent: 0,
      pointsRemaining: 15,
      stats: STATS.map((s) => ({ stat: s, baseline: 1, ancestry: 0, allocated: 0, final: 1, minimum: 1, maximum: 10, definition: ref(`stat-${s}`, `statv-${s}`, "STAT") })),
      skills: [],
      freeSkillCount: 2,
      primaryAffinity: null,
      ...over,
    },
    derivedPreview: derived,
  };
}
const READY_DERIVED = [
  { statistic: "MAXIMUM_HP", value: 14, unit: null, definition: ref("d-hp", "dv-hp", "DERIVED_STAT") },
  { statistic: "MAXIMUM_MP", value: 7, unit: null, definition: ref("d-mp", "dv-mp", "DERIVED_STAT") },
  { statistic: "SIGNATURE_ABILITY_SLOTS", value: 4, unit: null, definition: ref("d-sig", "dv-sig", "DERIVED_STAT") },
];
function character(over: Partial<CharacterDto> = {}, choices: CandidateDto = EMPTY, res: ResolutionDto = resolution()): CharacterDto {
  return {
    id: "c1",
    name: "Grukk",
    concept: "A wandering bruiser",
    level: 1,
    lockVersion: 2,
    coreCreationCompletedAt: null,
    status: "DRAFT",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    release: RELEASE,
    choices: { ...choices, skills: choices.skills.map((s) => ({ ...s, rankKey: "TRAINED" })) },
    resolution: res,
    names: {},
    ...over,
  };
}
async function openWizard(c: CharacterDto = character()) {
  client.getCharacter.mockResolvedValue(c);
  client.getCreationContext.mockResolvedValue(CONTEXT);
  render(<CharacterWizard characterId="c1" />);
  await screen.findByTestId(c.status === "CORE_COMPLETE" ? "wizard-read-only" : "character-wizard");
}
const step = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  for (const f of [...Object.values(client), ...Object.values(reference), ...Object.values(governance), nav.push]) f.mockReset();
  client.checkCharacter.mockResolvedValue(resolution());
});

describe("M6-WO3 New Character — explicit Release selection and capability (§55)", () => {
  beforeEach(() => {
    governance.listAllRulesets.mockResolvedValue([{ id: "rs1", name: "Core Playtest" }]);
    reference.listReleases.mockResolvedValue({ ruleset: { id: "rs1" }, releases: [{ id: "rel1", rulesetId: "rs1", releaseNumber: 3, versionLabel: "0.3.0", channel: "CORE_PLAYTEST", publishedAt: "2026-10-01T00:00:00.000Z" }] });
  });

  it("preselects nothing; the create button needs a READY Release and a name", async () => {
    client.getCapability.mockResolvedValue({ status: "READY", missing: [], release: RELEASE });
    client.createCharacter.mockResolvedValue({ id: "new1" });
    render(<NewCharacterForm />);
    const ruleset = await screen.findByLabelText("Ruleset");
    await waitFor(() => expect(within(ruleset).getByRole("option", { name: "Core Playtest" })).toBeTruthy());
    expect((ruleset as HTMLSelectElement).value).toBe("");
    const create = screen.getByRole("button", { name: "Create Character Draft" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(ruleset, { target: { value: "rs1" } });
    const release = await screen.findByLabelText("Release");
    expect((release as HTMLSelectElement).value).toBe("");
    fireEvent.change(release, { target: { value: "rel1" } });
    await screen.findByTestId("capability-ready");
    expect(client.getCapability).toHaveBeenCalledWith("rel1");
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name (required)"), { target: { value: "Grukk" } });
    expect((create as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() => expect(client.createCharacter).toHaveBeenCalledWith({ name: "Grukk", concept: null, rulesetReleaseId: "rel1" }));
    expect(nav.push).toHaveBeenCalledWith("/characters/new1/create");
  });

  it("a Release missing required content lists what is missing and cannot be used", async () => {
    client.getCapability.mockResolvedValue({ status: "MISSING_REQUIRED_CONTENT", missing: [{ requirement: "ANCESTRY", message: "No Ancestry is pinned." }], release: RELEASE });
    render(<NewCharacterForm />);
    fireEvent.change(await screen.findByLabelText("Ruleset"), { target: { value: "rs1" } });
    fireEvent.change(await screen.findByLabelText("Release"), { target: { value: "rel1" } });
    const missing = await screen.findByTestId("capability-missing");
    expect(missing.textContent).toContain("ANCESTRY: No Ancestry is pinned.");
    fireEvent.change(screen.getByLabelText("Name (required)"), { target: { value: "Grukk" } });
    expect((screen.getByRole("button", { name: "Create Character Draft" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("M6-WO3 creation wizard (§56–§69)", () => {
  it("shows the pinned Release, Level and Character Die from the server; concept is descriptive", async () => {
    await openWizard();
    expect(screen.getByTestId("wizard-release").textContent).toBe("Pinned to Core Playtest — Release 3 (0.3.0)");
    expect(screen.getByText("Level 1")).toBeTruthy();
    expect(screen.getByText("Character Die d4")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Grukk");
    expect((screen.getByLabelText("Concept (optional, descriptive only)") as HTMLTextAreaElement).value).toBe("A wandering bruiser");
    expect(screen.getByRole("navigation", { name: "Creation steps" })).toBeTruthy();
  });

  it("Ancestry cards come from the Release, link to the exact Release reference, and reveal distinct Stat choices", async () => {
    await openWizard();
    step(/2\. Race/);
    const cards = screen.getAllByTestId("ancestry-card");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.textContent).toContain("Base HP 10 · Base MP 4");
    expect(card.textContent).toContain("+2 STR");
    expect(card.textContent).toContain("+1 to 2 different Stats (AGI, CON, PER, RES, PRO)");
    expect(card.textContent).toContain("choose 1: Athletics or Survival");
    expect(within(card).getByRole("link", { name: "Rules Reference" }).getAttribute("href")).toBe("/compendium/rulesets/rs1/releases/rel1/entities/anc-orcani");
    fireEvent.click(within(card).getByRole("radio"));
    const first = screen.getByLabelText("Stat choice 1 of 2");
    const second = screen.getByLabelText("Stat choice 2 of 2");
    fireEvent.change(first, { target: { value: "AGI" } });
    expect((within(second).getByRole("option", { name: "AGI" }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(second, { target: { value: "PRO" } });
    await waitFor(() => expect(client.checkCharacter).toHaveBeenCalled());
    const sent = client.checkCharacter.mock.calls.at(-1)![1] as CandidateDto;
    expect(sent.ancestry).toEqual(sel(ORCANI));
    expect(sent.ancestryStatChoices).toEqual([
      { grantKey: "orcani_versatility", stat: "AGI" },
      { grantKey: "orcani_versatility", stat: "PRO" },
    ]);
  });

  it("the Stats step shows the server's Base / Ancestry / Allocated / Final and points remaining; + is disabled at 0", async () => {
    const stats = resolution({ pointsSpent: 15, pointsRemaining: 0, stats: STATS.map((s) => ({ stat: s, baseline: 1, ancestry: s === "STR" ? 2 : 0, allocated: s === "STR" ? 3 : 0, final: s === "STR" ? 6 : 1, minimum: 1, maximum: 10, definition: ref(`stat-${s}`, `statv-${s}`, "STAT") })) });
    await openWizard(character({}, { ...EMPTY, ancestry: sel(ORCANI), statAllocations: { STR: 3 } }, stats));
    step(/3\. Stats/);
    expect(screen.getByTestId("points-remaining").textContent).toBe("Points Remaining: 0 of 15");
    const str = screen.getByTestId("stat-row-STR");
    expect([...str.querySelectorAll("td")].slice(0, 4).map((c) => c.textContent)).toEqual(["1", "+2", "+3", "6"]);
    expect((screen.getByRole("button", { name: "Add a point to AGI" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove a point from AGI" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove a point from STR" }));
    await waitFor(() => expect(client.checkCharacter).toHaveBeenCalled());
    expect((client.checkCharacter.mock.calls.at(-1)![1] as CandidateDto).statAllocations.STR).toBe(2);
  });

  it("Skills: Race choice from exact options, free training count from the server, duplicates disabled", async () => {
    await openWizard(character({}, { ...EMPTY, ancestry: sel(ORCANI) }));
    step(/4\. Skills/);
    const race = screen.getByLabelText("Race Skill 1");
    expect(within(race).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a Skill…", "Athletics", "Survival"]);
    fireEvent.change(race, { target: { value: "skv-athletics" } });
    expect(screen.getByText("Choose 2 trained Skills")).toBeTruthy();
    const free1 = screen.getByLabelText("Free Skill 1");
    const athletics = within(free1).getByRole("option", { name: /Athletics/ }) as HTMLOptionElement;
    expect(athletics.disabled).toBe(true);
    expect(athletics.textContent).toContain("(already chosen)");
    fireEvent.change(free1, { target: { value: "skv-stealth" } });
    expect((within(screen.getByLabelText("Free Skill 2")).getByRole("option", { name: /Stealth/ }) as HTMLOptionElement).disabled).toBe(true);
    await waitFor(() => expect(client.checkCharacter).toHaveBeenCalled());
    expect((client.checkCharacter.mock.calls.at(-1)![1] as CandidateDto).skills).toEqual([
      { skill: sel(SKILLS[0]!), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
      { skill: sel(SKILLS[2]!), sourceKind: "FREE", sourceGrantKey: null },
    ]);
  });

  it("Primary Affinity: only executable Release Affinities are offered; exactly one is selected", async () => {
    await openWizard();
    step(/5\. Primary Affinity/);
    const cards = screen.getAllByTestId("affinity-card");
    expect(cards.map((c) => c.querySelector("strong")?.textContent)).toEqual(["Evocation"]);
    expect(within(cards[0]!).getByRole("link", { name: "Rules Reference" }).getAttribute("href")).toBe("/compendium/rulesets/rs1/releases/rel1/entities/aff-evo");
    fireEvent.click(within(cards[0]!).getByRole("radio"));
    await waitFor(() => expect(client.checkCharacter).toHaveBeenCalled());
    expect((client.checkCharacter.mock.calls.at(-1)![1] as CandidateDto).primaryAffinity).toEqual(sel(EVOCATION));
  });

  it("server validation issues are shown in their step and on Review", async () => {
    const issues = [{ code: "PROWESS_CHARACTER.STAT_BUDGET_EXCEEDED", severity: "ERROR" as const, path: "statAllocations", message: "16 points spent; the budget is 15.", source: null }];
    await openWizard(character({}, EMPTY, resolution({}, "INVALID", issues)));
    step(/3\. Stats/);
    expect(screen.getByRole("list", { name: "Problems in this step" }).textContent).toContain("Not allowed: 16 points spent; the budget is 15.");
    step(/6\. Review/);
    expect(screen.getByRole("list", { name: "Remaining problems" }).textContent).toContain("16 points spent");
    expect((screen.getByRole("button", { name: "Complete Core Creation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Review shows the server's derived preview including Signature Ability capacity; completion is server-validated", async () => {
    const ready = resolution({ ancestry: ORCANI.ref, primaryAffinity: EVOCATION.ref, skills: [{ skill: SKILLS[0]!.ref, rankKey: "TRAINED", sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" }] }, "READY", [], READY_DERIVED);
    client.checkCharacter.mockResolvedValue(ready);
    client.completeCoreCreation.mockResolvedValue(character({ status: "CORE_COMPLETE" }));
    await openWizard(character({}, { ...EMPTY, ancestry: sel(ORCANI), primaryAffinity: sel(EVOCATION) }, ready));
    step(/6\. Review/);
    expect(screen.getByTestId("derived-MAXIMUM_HP").textContent).toBe("14");
    expect(screen.getByTestId("derived-SIGNATURE_ABILITY_SLOTS").textContent).toBe("4");
    expect(screen.getByTestId("review-ancestry").querySelector("a")?.getAttribute("href")).toBe("/compendium/rulesets/rs1/releases/rel1/entities/anc-orcani");
    expect(screen.getByTestId("check-ready")).toBeTruthy();
    expect(screen.getByText(/Equipment and Ability selection are completed in later M6 systems/)).toBeTruthy();
    const complete = screen.getByRole("button", { name: "Complete Core Creation" }) as HTMLButtonElement;
    expect(complete.disabled).toBe(false);
    fireEvent.click(complete);
    await waitFor(() => expect(client.completeCoreCreation).toHaveBeenCalledWith("c1", 2));
    expect(nav.push).toHaveBeenCalledWith("/characters/c1");
  });

  it("Save & Continue sends the expected lockVersion; a stale write offers a reload", async () => {
    client.saveCreation.mockRejectedValue(new CharacterApiError("CHARACTER.STALE_WRITE", "This Character was changed elsewhere.", 409));
    await openWizard();
    step(/2\. Race/);
    fireEvent.click(within(screen.getAllByTestId("ancestry-card")[0]!).getByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    await waitFor(() => expect(client.saveCreation).toHaveBeenCalled());
    expect(client.saveCreation.mock.calls[0]![1]).toBe(2);
    const message = await screen.findByTestId("wizard-message");
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent).toContain("This Character was changed elsewhere.");
    expect(within(message).getByRole("button", { name: "Reload the Character" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Complete Core Creation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a completed Character is read-only: no creation controls", async () => {
    const ready = resolution({ ancestry: ORCANI.ref }, "READY", [], READY_DERIVED);
    await openWizard(character({ status: "CORE_COMPLETE", coreCreationCompletedAt: "2026-10-03T00:00:00.000Z" }, { ...EMPTY, ancestry: sel(ORCANI) }, ready));
    expect(screen.getByText(/Core Creation Complete/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save & Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete Core Creation" })).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByTestId("derived-MAXIMUM_HP").textContent).toBe("14");
  });
});

describe("M6-WO3 Character index and page (§54, §69, §74)", () => {
  it("the index lists name, Level, exact Release, status and links to the Character", async () => {
    client.listCharacters.mockResolvedValue({ items: [{ id: "c1", name: "Grukk", level: 1, status: "CORE_COMPLETE", updatedAt: "2026-10-02T10:30:00.000Z", release: RELEASE }], total: 1 });
    render(<CharacterIndex />);
    const row = await screen.findByTestId("character-row");
    expect(within(row).getByRole("link", { name: "Grukk" }).getAttribute("href")).toBe("/characters/c1");
    expect(row.textContent).toContain("Core Playtest — Release 3 (0.3.0)");
    expect(row.textContent).toContain("Core Creation Complete");
    expect(screen.getByRole("table", { name: "Characters" })).toBeTruthy();
  });

  it("the Character page shows the pinned Release and saves only the profile", async () => {
    const done = character({ status: "CORE_COMPLETE" }, EMPTY, resolution({}, "READY", [], READY_DERIVED));
    client.getCharacter.mockResolvedValue(done);
    client.saveProfile.mockResolvedValue({ ...done, name: "Grukk II", lockVersion: 3 });
    render(<CharacterSheetSummary characterId="c1" />);
    expect((await screen.findByTestId("character-pinned-release")).textContent).toBe("Pinned to Core Playtest — Release 3 (0.3.0)");
    expect(screen.queryByRole("link", { name: "Continue creation" })).toBeNull();
    const form = screen.getByRole("form", { name: "Profile" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Grukk II" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(client.saveProfile).toHaveBeenCalledWith("c1", 2, "Grukk II", "A wandering bruiser"));
    expect(client.saveCreation).not.toHaveBeenCalled();
    expect(await screen.findByText("Profile saved.")).toBeTruthy();
  });
});
