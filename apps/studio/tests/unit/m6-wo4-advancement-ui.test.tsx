import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessDto, AdvancementContextDto, AdvancementPreviewDto, CharacterDto, EntitlementsDto, ProfileDto } from "../../app/characters/_lib/character-client";
import { DefinitionEditor } from "../../app/compendium/admin/_components/DefinitionEditor";
import { newCandidate, type DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { CHARACTER_KIND_DESCRIPTORS, descriptorFor, presentationDescriptorFor } from "../../app/compendium/admin/_lib/descriptors";
import type { EntryDetailDto } from "../../app/compendium/rulesets/_lib/reference-client";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";

/**
 * PAS-10 M6-WO4 §104–§107, §118–§121 — advancement UI. The Character API client is mocked: these tests prove
 * PRESENTATION and the wizard's interaction contract — the next-Level summary from the server's entitlements, steps
 * skipped when a Level grants nothing, the points meter showing the SERVER's remaining count, Skill Train New / Upgrade
 * options, Affinity choice with the Affinity selector, the Review's before/after and access changes, Advance Character
 * enabled only for a READY preview, the commit body (expectedLockVersion + choices only), stale and error messages,
 * Maximum Level, the present-Character profile/access/history, and the WO1 editor + WO2 presenter for
 * CHARACTER_ADVANCEMENT_RULE. Nothing here calculates a rule.
 * Invariants: M6-I036–I039 (derived values come from the server), M6-I041 (access ≠ legality), M6-I044.
 */
const client = vi.hoisted(() => ({
  getAdvancementContext: vi.fn(),
  previewAdvancement: vi.fn(),
  advanceCharacter: vi.fn(),
  getAccess: vi.fn(),
}));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), searchDefinitionReferences: vi.fn().mockResolvedValue([]) }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/characters" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { AdvancementWizard } = await import("../../app/characters/_components/AdvancementWizard");
const { CharacterProgress } = await import("../../app/characters/_components/CharacterProgress");
const { CharacterApiError } = await import("../../app/characters/_lib/character-client");
const { DefinitionPresenter } = await import("../../app/compendium/rulesets/_components/DefinitionPresenter");

const RELEASE = { id: "rel1", rulesetId: "rs1", rulesetName: "Core Playtest", releaseNumber: 3, versionLabel: "0.3.0", channel: "CORE_PLAYTEST" };
const ref = (id: string, kind: string, canonicalKey = `test.${id}`) => ({ entityId: id, entityVersionId: `${id}-v`, canonicalKey, definitionKind: kind, systemFamily: "CHARACTER" });
const STATS = ["STR", "AGI", "CON", "PER", "INT", "PRO"];
function profile(level: number, finals: Record<string, number> = {}, extra: Partial<ProfileDto> = {}): ProfileDto {
  return {
    level,
    maximumLevel: 10,
    characterDie: level >= 3 ? { dieKey: "D6", faces: 6 } : { dieKey: "D4", faces: 4 },
    baseHp: 10,
    baseMp: 4,
    stats: STATS.map((s) => ({ stat: s, baseline: 1, ancestry: 0, creation: 2, advancement: (finals[s] ?? 3) - 3, final: finals[s] ?? 3, minimum: 1, maximum: s === "CON" ? 3 : 10, mastery: false, definition: ref(`stat-${s}`, "STAT") })),
    skills: [{ skill: ref("athletics", "SKILL"), rankKey: "TRAINED", source: { kind: "FREE", grantKey: null, level: 1 }, history: [] }],
    affinities: [{ affinity: ref("fire", "AFFINITY", "affinity.fire"), identity: "fire", role: "PRIMARY", rank: level >= 3 ? "TRAINED" : "NONE", acquisition: { level: 1, optionKey: "CHOOSE_PRIMARY" }, history: [] }],
    derivedStatistics: [{ statistic: "MAX_HP", value: 10 + level, unit: null, definition: ref("hp", "DERIVED_STATISTIC") }],
    signatureCapacity: 1,
    ...extra,
  };
}
const entitlements = (from: number, statPoints: number, skillAdvancements: number, affinity: EntitlementsDto["affinity"] = null): EntitlementsDto => ({
  fromLevel: from,
  toLevel: from + 1,
  statPoints,
  skillAdvancements,
  characterDie: { before: { dieKey: "D4", faces: 4 }, after: { dieKey: from + 1 >= 3 ? "D6" : "D4", faces: from + 1 >= 3 ? 6 : 4 } },
  affinity,
  source: ref("adv", "CHARACTER_ADVANCEMENT_RULE"),
});
function context(next: EntitlementsDto | null, over: Partial<AdvancementContextDto> = {}): AdvancementContextDto {
  const level = next === null ? 10 : next.fromLevel;
  return {
    character: { id: "c1", name: "Brakka", level, lockVersion: 4 },
    release: RELEASE,
    capability: { creation: { status: "CREATION_READY", missing: [] }, advancement: { status: "ADVANCEMENT_READY", missing: [] } },
    profile: profile(level),
    next,
    maximumLevelReached: next === null,
    skillOptions: { trainNew: [{ ref: ref("arcana", "SKILL"), displayName: "Arcana", rankKey: null }], upgrade: [{ ref: ref("athletics", "SKILL"), displayName: "Athletics", rankKey: "TRAINED" }] },
    affinityOptions: { gain: [{ ref: ref("water", "AFFINITY"), displayName: "Water", rankKey: null }], owned: [{ ref: ref("fire", "AFFINITY"), displayName: "Fire", rankKey: "TRAINED" }] },
    history: [],
    names: { "athletics-v": "Athletics", "arcana-v": "Arcana" },
    ...over,
  };
}
const preview = (status: AdvancementPreviewDto["status"], remaining: number | null, over: Partial<AdvancementPreviewDto> = {}): AdvancementPreviewDto => ({
  status,
  issues: [],
  fromLevel: 1,
  toLevel: 2,
  entitlements: null,
  before: null,
  after: null,
  accessChanges: null,
  statPoints: remaining === null ? null : { granted: 1, spent: 1 - remaining, remaining },
  ...over,
});

beforeEach(() => {
  vi.useRealTimers();
  for (const f of Object.values(client)) f.mockReset();
  nav.push.mockReset();
});
const settle = () => act(() => new Promise((r) => setTimeout(r, 300)));

describe("M6-WO4 Advancement wizard (§69–§77)", () => {
  it("summary shows the server's entitlements; steps with no entitlement are skipped (Level 2: Stats only)", async () => {
    client.getAdvancementContext.mockResolvedValue(context(entitlements(1, 1, 0)));
    client.previewAdvancement.mockResolvedValue(preview("INCOMPLETE", 1));
    render(<AdvancementWizard characterId="c1" />);
    const summary = await screen.findByTestId("next-level-summary");
    expect(screen.getByTestId("advance-levels").textContent).toBe("Level 1 → 2");
    expect(screen.getByTestId("advance-release").textContent).toContain("Core Playtest");
    expect(within(summary).getByTestId("summary-stat-points").textContent).toBe("1");
    expect(within(summary).getByTestId("summary-skill-advancements").textContent).toBe("0");
    expect(within(summary).getByTestId("summary-affinity").textContent).toBe("None at this Level");
    const steps = within(screen.getByRole("navigation", { name: "Advancement steps" })).getAllByRole("button").map((b) => b.textContent);
    expect(steps).toEqual(["1. Next Level", "2. Stat Points", "3. Review"]);
    expect(screen.getByRole("button", { name: "Advance Character" })).toHaveProperty("disabled", true);
  });

  it("the points meter shows the SERVER's remaining count; Add uses the server's maximum; choices are previewed", async () => {
    client.getAdvancementContext.mockResolvedValue(context(entitlements(1, 1, 0)));
    client.previewAdvancement.mockResolvedValueOnce(preview("INCOMPLETE", 1)).mockResolvedValue(preview("READY", 0, { after: profile(2, { PER: 4 }), before: profile(1) }));
    render(<AdvancementWizard characterId="c1" />);
    await screen.findByTestId("next-level-summary");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("advance-points").textContent).toBe("Points Remaining: 1 of 1");
    expect(screen.getByRole("button", { name: "Add a point to CON" })).toHaveProperty("disabled", true); // at the server's maximum
    fireEvent.click(screen.getByRole("button", { name: "Add a point to PER" }));
    await settle();
    expect(client.previewAdvancement).toHaveBeenLastCalledWith("c1", { statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null });
    expect(screen.getByTestId("advance-points").textContent).toBe("Points Remaining: 0 of 1");
    expect(within(screen.getByTestId("advance-stat-PER")).getAllByRole("cell")[2]?.textContent).toBe("4");
    expect(screen.getByRole("button", { name: "Add a point to STR" })).toHaveProperty("disabled", true);
  });

  it("Skill step offers Train New and Upgrade from the context; one selection is sent as a structured choice", async () => {
    client.getAdvancementContext.mockResolvedValue(context(entitlements(2, 1, 1)));
    client.previewAdvancement.mockResolvedValue(preview("INCOMPLETE", 1));
    render(<AdvancementWizard characterId="c1" />);
    await screen.findByTestId("next-level-summary");
    fireEvent.click(screen.getByRole("button", { name: "3. Skill Advancement" }));
    expect(screen.getAllByTestId("skill-train-option").map((o) => o.textContent?.trim())).toEqual(["Arcana"]);
    expect(screen.getAllByTestId("skill-upgrade-option")[0]?.textContent).toContain("Athletics");
    fireEvent.click(within(screen.getAllByTestId("skill-upgrade-option")[0]!).getByRole("radio"));
    await settle();
    expect(client.previewAdvancement).toHaveBeenLastCalledWith("c1", expect.objectContaining({ skillAdvancements: [{ action: "UPGRADE", skill: { entityId: "athletics", entityVersionId: "athletics-v" } }] }));
  });

  it("an automatic Affinity step is summarised, not chosen; a CHOOSE_ONE step asks for the option and the Affinity", async () => {
    const auto = { mode: "REQUIRED", automatic: true, options: [{ optionKey: "PRIMARY_TRAINED", action: "RANK_UP" as const, target: "PRIMARY", from: "NONE", to: "TRAINED" }], source: ref("ap", "AFFINITY_PROGRESSION") };
    client.getAdvancementContext.mockResolvedValue(context(entitlements(2, 1, 1, auto)));
    client.previewAdvancement.mockResolvedValue(preview("INCOMPLETE", 1));
    const { unmount } = render(<AdvancementWizard characterId="c1" />);
    expect((await screen.findByTestId("summary-affinity")).textContent).toMatch(/^Automatic: Primary Trained: raise the Primary Affinity from None to Trained/);
    expect(screen.queryByRole("button", { name: /Affinity Progression/ })).toBeNull();
    unmount();
    const choose = {
      mode: "CHOOSE_ONE",
      automatic: false,
      options: [
        { optionKey: "PRIMARY_EXPERT", action: "RANK_UP" as const, target: "PRIMARY", from: "TRAINED", to: "EXPERT" },
        { optionKey: "GAIN_SECONDARY_TRAINED", action: "GAIN_AFFINITY" as const, role: "SECONDARY", startingRank: "TRAINED" },
      ],
      source: ref("ap", "AFFINITY_PROGRESSION"),
    };
    client.getAdvancementContext.mockResolvedValue(context(entitlements(5, 1, 1, choose)));
    render(<AdvancementWizard characterId="c1" />);
    await screen.findByTestId("next-level-summary");
    fireEvent.click(screen.getByRole("button", { name: "4. Affinity Progression" }));
    expect(screen.getAllByTestId("affinity-option")).toHaveLength(2);
    fireEvent.click(within(screen.getAllByTestId("affinity-option")[1]!).getByRole("radio"));
    fireEvent.change(screen.getByRole("combobox", { name: "Affinity to gain" }), { target: { value: "water-v" } });
    await settle();
    expect(client.previewAdvancement).toHaveBeenLastCalledWith("c1", expect.objectContaining({ affinityChoice: { optionKey: "GAIN_SECONDARY_TRAINED", affinity: { entityId: "water", entityVersionId: "water-v" } } }));
  });

  it("Review shows the server's before/after and access changes; Advance Character commits expectedLockVersion + choices only", async () => {
    client.getAdvancementContext.mockResolvedValue(context(entitlements(1, 1, 0)));
    const ready = preview("READY", 0, {
      before: profile(1),
      after: profile(2, { PER: 4 }),
      accessChanges: { tracks: [{ track: "ARCANE", before: "UNTRAINED", after: "TRAINED", eligibleBefore: false, eligibleAfter: true }], signatureCapacity: { before: 1, after: 1 }, newlyEligible: [ref("bolt", "SPELL_EFFECT", "test.effect.bolt")], newlyIneligible: [] },
    });
    client.previewAdvancement.mockResolvedValueOnce(preview("INCOMPLETE", 1)).mockResolvedValue(ready);
    client.advanceCharacter.mockResolvedValue({});
    render(<AdvancementWizard characterId="c1" />);
    await screen.findByTestId("next-level-summary");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a point to PER" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("review-after-level").textContent).toBe("2");
    expect(screen.getByTestId("review-after-PER").textContent).toBe("4");
    expect(screen.getByTestId("review-after-MAX_HP").textContent).toBe("12");
    expect(screen.getByTestId("newly-eligible").textContent).toBe("Newly available: test.effect.bolt");
    expect(screen.getByTestId("advance-ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Advance Character" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/characters/c1"));
    expect(client.advanceCharacter).toHaveBeenCalledWith("c1", 4, { statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null });
  });

  it("server issues are shown per step; a stale write offers a reload; other errors show message and code", async () => {
    client.getAdvancementContext.mockResolvedValue(context(entitlements(1, 1, 0)));
    client.previewAdvancement.mockResolvedValueOnce(preview("INCOMPLETE", 1)).mockResolvedValueOnce(preview("INVALID", 0, { issues: [{ code: "X", severity: "ERROR", path: "statAllocations.CON", message: "CON would exceed its maximum", source: null }] })).mockResolvedValue(preview("READY", 0));
    render(<AdvancementWizard characterId="c1" />);
    await screen.findByTestId("next-level-summary");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a point to STR" }));
    await settle();
    expect(screen.getByRole("list", { name: "Problems in this step" }).textContent).toBe("Not allowed: CON would exceed its maximum");
    fireEvent.click(screen.getByRole("button", { name: "Remove a point from STR" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a point to PER" }));
    await settle();
    client.advanceCharacter.mockRejectedValueOnce(new CharacterApiError("CHARACTER.STALE_WRITE", "This Character changed since you loaded it.", 409));
    fireEvent.click(screen.getByRole("button", { name: "Advance Character" }));
    expect((await screen.findByTestId("advance-message")).textContent).toContain("This Character changed since you loaded it.");
    expect(screen.getByRole("button", { name: "Reload the Character" })).toBeTruthy();
    client.advanceCharacter.mockRejectedValueOnce(new CharacterApiError("CHARACTER.INVALID_ADVANCEMENT", "Not allowed", 422));
    fireEvent.click(screen.getByRole("button", { name: "Advance Character" }));
    await waitFor(() => expect(screen.getByTestId("advance-message").textContent).toBe("Not allowed (CHARACTER.INVALID_ADVANCEMENT)"));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Maximum Level: no steps and no Advance control — the history is shown", async () => {
    client.getAdvancementContext.mockResolvedValue(context(null, { history: [{ fromLevel: 9, toLevel: 10, createdAt: "", statAllocations: { STR: 2 }, skillAdvancements: [], affinityChoice: null }] }));
    render(<AdvancementWizard characterId="c1" />);
    expect((await screen.findByTestId("advancement-max-level")).textContent).toContain("Maximum Level Reached");
    expect(screen.queryByRole("button", { name: "Advance Character" })).toBeNull();
    expect(screen.getByTestId("history-level-10").textContent).toContain("+2 STR");
    expect(client.previewAdvancement).not.toHaveBeenCalled();
  });
});

describe("M6-WO4 present Character (§82–§84)", () => {
  const access: AccessDto = {
    character: { id: "c1", level: 3 },
    release: RELEASE,
    summary: {
      status: "RESOLVED",
      unresolved: [],
      spell: { arcaneAuthority: { skillKey: "skill.arcana", skill: null, rankKey: "TRAINED", minimumRankKey: "TRAINED", eligible: true }, affinityAuthorities: [{ affinity: ref("fire", "AFFINITY", "affinity.fire"), identity: "fire", role: "PRIMARY", rank: "TRAINED", minimumRank: "TRAINED", eligible: true }] },
      maneuver: { martial: { skillKey: "skill.martial", skill: null, rankKey: "UNTRAINED", minimumRankKey: "TRAINED", eligible: false } },
      signatureCapacity: 1,
      constructionRule: null,
    },
  } as AccessDto;
  const character = (p: ProfileDto, over: Partial<CharacterDto> = {}) =>
    ({ id: "c1", name: "Brakka", release: RELEASE, names: { "athletics-v": "Athletics" }, profile: p, profileIssues: [], advancementHistory: [], advancementCapability: { status: "ADVANCEMENT_READY", missing: [] }, ...over }) as unknown as CharacterDto;

  it("shows the server's profile (where every point came from), access and history, with an Advance Character link", async () => {
    client.getAccess.mockResolvedValue(access);
    render(<CharacterProgress character={character(profile(3, { PER: 4 }), { advancementHistory: [{ fromLevel: 1, toLevel: 2, createdAt: "", statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null }] })} />);
    expect(screen.getByTestId("profile-level").textContent).toBe("3 of 10");
    expect(screen.getByTestId("profile-die").textContent).toBe("D6 (d6)");
    expect(screen.getByTestId("profile-final-PER").textContent).toBe("4");
    expect(screen.getByTestId("profile-derived-MAX_HP").textContent).toBe("13");
    expect(screen.getByRole("link", { name: "Advance Character" }).getAttribute("href")).toBe("/characters/c1/advance");
    expect((await screen.findByTestId("access-arcane")).textContent).toBe("Trained (needs Trained) — Available");
    expect(screen.getByTestId("access-martial").textContent).toBe("Untrained (needs Trained) — Locked");
    expect(screen.getByTestId("access-signature").textContent).toBe("1");
    expect(screen.getByTestId("history-level-2").textContent).toContain("+1 PER");
  });

  it("Maximum Level shows the tag; a Release without advancement says what is missing; profile issues are surfaced", () => {
    client.getAccess.mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(<CharacterProgress character={character(profile(10))} />);
    expect(screen.getByTestId("max-level").textContent).toBe("Maximum Level Reached");
    expect(screen.queryByRole("link", { name: "Advance Character" })).toBeNull();
    unmount();
    const r = render(<CharacterProgress character={character(profile(1), { advancementCapability: { status: "MISSING_REQUIRED_CONTENT", missing: [{ requirement: "CHARACTER_ADVANCEMENT_RULE", message: "" }] } } as Partial<CharacterDto>)} />);
    expect(screen.getByText(/does not define advancement: CHARACTER_ADVANCEMENT_RULE/)).toBeTruthy();
    r.unmount();
    render(<CharacterProgress character={character(null as unknown as ProfileDto, { profile: null, profileIssues: [{ code: "X", severity: "ERROR", path: "", message: "Affinity profile invalid", source: null }] })} />);
    expect(screen.getByTestId("profile-issues").textContent).toContain("Affinity profile invalid");
  });
});

describe("M6-WO4 Character Advancement Rule in the WO1 editor and WO2 presenter (§78–§81)", () => {
  function Editor({ onChange }: { onChange: (c: DefinitionCandidate) => void }) {
    const row = kindRow("CHARACTER_ADVANCEMENT_RULE");
    const [c, setC] = useState<DefinitionCandidate>(newCandidate(row));
    return (
      <DefinitionEditor
        kind={row}
        catalog={CATALOG}
        candidate={c}
        issues={[]}
        onChange={(next) => {
          setC(next);
          onChange(next);
        }}
      />
    );
  }

  it("the catalog lists CHARACTER_ADVANCEMENT_RULE v1 (CHARACTER) with one dedicated descriptor for authoring and presentation", () => {
    const row = kindRow("CHARACTER_ADVANCEMENT_RULE");
    expect(row).toMatchObject({ systemFamily: "CHARACTER", supportedSchemaVersions: [1] });
    expect(descriptorFor(row, 1)).toBe(CHARACTER_KIND_DESCRIPTORS.CHARACTER_ADVANCEMENT_RULE);
    expect(presentationDescriptorFor(row, 1)).toBe(CHARACTER_KIND_DESCRIPTORS.CHARACTER_ADVANCEMENT_RULE);
    expect(CHARACTER_KIND_DESCRIPTORS.CHARACTER_ADVANCEMENT_RULE!.fields.map((f) => f.key)).toEqual(["levels", "source"]);
  });

  it("authors Levels as structured rows (no raw JSON); a removed row is gone", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor onChange={(c) => changes.push(c)} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Level" }));
    fireEvent.change(screen.getByLabelText("Level of row 1"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Stat Points of row 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Skill advancements of row 1"), { target: { value: "0" } });
    expect(changes.at(-1)?.payload.levels).toEqual([{ level: 2, statPoints: 1, skillAdvancements: 0 }]);
    fireEvent.click(screen.getByRole("button", { name: "Add Level" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
    expect(changes.at(-1)?.payload.levels).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: /payload/i })).toBeNull();
  });

  it("presents the Levels table exactly as authored", () => {
    const row = kindRow("CHARACTER_ADVANCEMENT_RULE");
    const definition = { schemaVersion: 1, systemFamily: "CHARACTER", definitionKind: "CHARACTER_ADVANCEMENT_RULE", payload: { levels: [{ level: 2, statPoints: 1, skillAdvancements: 0 }, { level: 10, statPoints: 2, skillAdvancements: 1 }], source: { document: "t", section: "1" } }, legacyTerms: null };
    const detail = {
      release: { id: "rel1", rulesetId: "rs1", releaseNumber: 1, versionLabel: "0.1", channel: "CORE_PLAYTEST", publishedAt: "" },
      ruleset: { id: "rs1", canonicalKey: "ruleset.t", name: "T" },
      entity: { id: "e1", canonicalKey: "test.e1", entityType: row.allowedEntityTypes[0] ?? "X" },
      pinnedRevision: { id: "v1", entityId: "e1", revisionNumber: 1, status: "APPROVED", displayName: "X", shortDescription: null, rulesText: null, structuredData: { prowessDefinition: definition }, parentVersionId: null, changeType: null, changeSummary: null, createdAt: "", updatedAt: "" },
      latestRevisionNumber: 1,
      definition,
      kind: { definitionKind: "CHARACTER_ADVANCEMENT_RULE", systemFamily: "CHARACTER", branch: row.branch, sharedContract: row.sharedContract, supportedSchemaVersions: row.supportedSchemaVersions },
      schemaVersionSupported: true,
      keywords: { structured: [], assigned: [] },
      references: [],
      referencesTruncated: false,
      referencedBy: [],
      referencedByTruncated: false,
      relationships: [],
    } as unknown as EntryDetailDto;
    render(<DefinitionPresenter detail={detail} renderReference={() => null} />);
    expect(screen.getByTestId("reference-presenter").getAttribute("data-presenter")).toBe("dedicated");
    const rows = within(screen.getByTestId("reference-advancement-levels")).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual(["210", "1021"]);
  });
});
