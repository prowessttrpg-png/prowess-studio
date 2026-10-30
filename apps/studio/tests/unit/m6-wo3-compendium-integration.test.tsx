import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DefinitionEditor } from "../../app/compendium/admin/_components/DefinitionEditor";
import { newCandidate, type DefinitionCandidate } from "../../app/compendium/admin/_lib/definition-form";
import { CHARACTER_KIND_DESCRIPTORS, GENERIC_DESCRIPTOR, descriptorFor, presentationDescriptorFor } from "../../app/compendium/admin/_lib/descriptors";
import type { EntryDetailDto } from "../../app/compendium/rulesets/_lib/reference-client";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";

/**
 * PAS-10 M6-WO3 §50–§51 — the activated character-facing kinds (ANCESTRY v1, SKILL v1, CHARACTER_CREATION_RULE v1)
 * join the ONE descriptor set: the WO1 authoring catalog lists them, the WO1 editor authors them through structured
 * fields (no raw JSON for normal authoring), and the WO2 Rules Reference presents them readably through the same
 * descriptors. Values are shown as authored — nothing is calculated. Invariants: M6-I027, M6-I029.
 */
vi.mock("../../app/compendium/admin/_lib/authoring-client", async (importActual) => ({ ...(await importActual<object>()), searchDefinitionReferences: vi.fn().mockResolvedValue([]) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { DefinitionPresenter } = await import("../../app/compendium/rulesets/_components/DefinitionPresenter");

function Editor({ kind, onChange }: { kind: string; onChange: (c: DefinitionCandidate) => void }) {
  const row = kindRow(kind);
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

describe("M6-WO3 catalog and descriptors (§10, §50)", () => {
  it("the catalog lists ANCESTRY v1, SKILL v1 and CHARACTER_CREATION_RULE v1 (CHARACTER family)", () => {
    expect(kindRow("ANCESTRY").supportedSchemaVersions).toEqual([1]);
    expect(kindRow("SKILL").supportedSchemaVersions).toEqual([1]);
    expect(kindRow("CHARACTER_CREATION_RULE")).toMatchObject({ systemFamily: "CHARACTER", supportedSchemaVersions: [1] });
    expect(CATALOG.vocabularies.ancestryStatGrantKinds).toEqual(["FIXED", "CHOOSE_DISTINCT"]);
    expect(CATALOG.vocabularies.ancestrySkillSelectionKinds).toEqual(["FIXED", "CHOOSE_FROM", "CHOOSE_ANY"]);
  });

  it("each new kind has a dedicated descriptor for authoring AND presentation; other versions fall back", () => {
    for (const k of ["ANCESTRY", "SKILL", "CHARACTER_CREATION_RULE"]) {
      const row = kindRow(k);
      expect(descriptorFor(row, 1)).toBe(CHARACTER_KIND_DESCRIPTORS[k]);
      expect(presentationDescriptorFor(row, 1)).toBe(CHARACTER_KIND_DESCRIPTORS[k]);
      expect(descriptorFor(row, 2)).toBe(GENERIC_DESCRIPTOR);
      expect(presentationDescriptorFor(row, 2)).toBeNull();
    }
    const rule = CHARACTER_KIND_DESCRIPTORS.CHARACTER_CREATION_RULE!;
    expect(rule.fields.map((f) => f.key)).toEqual(["startingLevel", "statPointBudget", "freeTrainedSkillCount", "startingSkillRankKey", "requiredAncestryCount", "requiredPrimaryAffinityCount", "source"]);
    // Stat bounds are NOT part of the creation rule (§13): they come from the STAT Definitions.
    expect(rule.fields.map((f) => f.key).join(",")).not.toMatch(/maximum|minimum|statMax|statCap/i);
  });
});

describe("M6-WO3 WO1 editors (§50)", () => {
  it("authors a Character Creation Rule through labelled integer fields", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="CHARACTER_CREATION_RULE" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText("Stat point budget (required)"), { target: { value: "15" } });
    expect(changes.at(-1)?.payload.statPointBudget).toBe(15);
    fireEvent.change(screen.getByLabelText("Free trained Skills (required)"), { target: { value: "2" } });
    expect(changes.at(-1)?.payload.freeTrainedSkillCount).toBe(2);
    expect(screen.queryByRole("textbox", { name: /payload/i })).toBeNull();
  });

  it("authors Ancestry Stat grants (FIXED and CHOOSE_DISTINCT) and Skill grants through structured controls", () => {
    const changes: DefinitionCandidate[] = [];
    render(<Editor kind="ANCESTRY" onChange={(c) => changes.push(c)} />);
    fireEvent.change(screen.getByLabelText("Base HP (required)"), { target: { value: "10" } });
    expect(changes.at(-1)?.payload.baseHp).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "Add Stat grant" }));
    const grant = screen.getByRole("group", { name: "Stat grant 1" });
    fireEvent.change(within(grant).getByLabelText("Grant key"), { target: { value: "orcani_might" } });
    expect(changes.at(-1)?.payload.statGrants).toEqual([expect.objectContaining({ grantKey: "orcani_might", kind: "FIXED" })]);
    fireEvent.click(screen.getByRole("button", { name: "Add Skill grant" }));
    const skillGrant = screen.getByRole("group", { name: "Skill grant 1" });
    expect(within(skillGrant).getByLabelText("Selection")).toBeTruthy();
    expect(within(skillGrant).getByRole("button", { name: "Add Skill option" })).toBeTruthy();
    expect(changes.at(-1)?.payload.skillGrants).toEqual([expect.objectContaining({ selectionKind: "FIXED", options: [] })]);
  });
});

describe("M6-WO3 WO2 presentation (§51)", () => {
  const skillRef = { entityId: "sk1", entityVersionId: "skv1", canonicalKey: "test.skill.athletics", definitionKind: "SKILL", systemFamily: "CHARACTER" };
  function detail(kind: string, payload: Record<string, unknown>): EntryDetailDto {
    const row = kindRow(kind);
    const definition = { schemaVersion: 1, systemFamily: row.systemFamily, definitionKind: kind, payload, legacyTerms: null };
    return {
      release: { id: "rel1", rulesetId: "rs1", releaseNumber: 1, versionLabel: "0.1", channel: "CORE_PLAYTEST", publishedAt: "" },
      ruleset: { id: "rs1", canonicalKey: "ruleset.t", name: "T" },
      entity: { id: "e1", canonicalKey: "test.e1", entityType: row.allowedEntityTypes[0] ?? kind },
      pinnedRevision: { id: "v1", entityId: "e1", revisionNumber: 1, status: "APPROVED", displayName: "X", shortDescription: null, rulesText: null, structuredData: { prowessDefinition: definition }, parentVersionId: null, changeType: null, changeSummary: null, createdAt: "", updatedAt: "" },
      latestRevisionNumber: 1,
      definition,
      kind: { definitionKind: kind, systemFamily: row.systemFamily, branch: row.branch, sharedContract: row.sharedContract, supportedSchemaVersions: row.supportedSchemaVersions },
      schemaVersionSupported: true,
      keywords: { structured: [], assigned: [] },
      references: [],
      referencesTruncated: false,
      referencedBy: [],
      referencedByTruncated: false,
      relationships: [],
    } as unknown as EntryDetailDto;
  }

  it("Ancestry: Base HP / MP, Stat grants and Skill grants are presented readably (dedicated presenter)", () => {
    render(
      <DefinitionPresenter
        detail={detail("ANCESTRY", {
          baseHp: 10,
          baseMp: 4,
          statGrants: [
            { grantKey: "orcani_might", kind: "FIXED", stat: "STR", amount: 2 },
            { grantKey: "orcani_versatility", kind: "CHOOSE_DISTINCT", count: 2, amount: 1, allowedStats: ["AGI", "CON"] },
          ],
          skillGrants: [{ grantKey: "upbringing", rankKey: "TRAINED", selectionKind: "CHOOSE_FROM", count: 1, options: [skillRef] }],
          source: { document: "test", section: "1" },
        })}
        renderReference={() => null}
      />,
    );
    expect(screen.getByTestId("reference-presenter").getAttribute("data-presenter")).toBe("dedicated");
    expect(screen.getByText("Base HP").nextSibling?.textContent).toBe("10");
    const grants = screen.getAllByTestId("reference-stat-grant").map((g) => g.textContent);
    expect(grants[0]).toMatch(/orcani_might.*\+2.*(STR|Str).*fixed/);
    expect(grants[1]).toContain("+1 to 2 different Stats, chosen from AGI, CON");
    expect(screen.getByTestId("reference-skill-grant").textContent).toMatch(/choose 1 of:/);
  });

  it("Skill and Character Creation Rule are presented through their dedicated descriptors", () => {
    const { unmount } = render(<DefinitionPresenter detail={detail("SKILL", { ladderKey: "SKILL", source: { document: "t", section: "1" } })} renderReference={() => null} />);
    expect(screen.getByTestId("reference-presenter").getAttribute("data-presenter")).toBe("dedicated");
    expect(screen.getByText("Rank ladder")).toBeTruthy();
    unmount();
    render(
      <DefinitionPresenter
        detail={detail("CHARACTER_CREATION_RULE", { startingLevel: 1, statPointBudget: 15, freeTrainedSkillCount: 2, startingSkillRankKey: "TRAINED", requiredAncestryCount: 1, requiredPrimaryAffinityCount: 1, source: { document: "t", section: "1" } })}
        renderReference={() => null}
      />,
    );
    expect(screen.getByText("Starting Level").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("Stat point budget").nextSibling?.textContent).toBe("15");
    expect(screen.getByText("Free trained Skills").nextSibling?.textContent).toBe("2");
    expect(screen.getByRole("region", { name: "Required selections" })).toBeTruthy();
  });
});
