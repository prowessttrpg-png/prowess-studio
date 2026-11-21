import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CharacterSheetDto, SheetSkillBenefitDto } from "../../app/characters/_lib/character-client";
import { SkillBenefitsPanel, SkillGrantedActionRows } from "../../app/characters/_components/sheet/SheetPanels";

/**
 * RULES-WO1 (R08) — the Character sheet shows each published Skill benefit truthfully: whether it applies, and why not,
 * and lists only the Actions a benefit actually grants this Character (rank held, every prerequisite group met, and the
 * Action pinned by the Character's own Release). The evaluation itself is server-side (game + DB integration tests).
 */
const ref = (key: string, kind: string) => ({ entityId: `${key}-e`, entityVersionId: `${key}-v`, canonicalKey: `test.${key}`, definitionKind: kind, systemFamily: kind === "ACTION" ? "CORE" : "SKILL" });
const benefit = (over: Partial<SheetSkillBenefitDto>): SheetSkillBenefitDto => ({
  benefit: ref("benefit", "SKILL_BENEFIT"),
  benefitKey: "ATHLETICS_TRAINED_THROW",
  skill: ref("athletics", "SKILL"),
  minimumRankKey: "TRAINED",
  heldRankKey: "TRAINED",
  rankMet: true,
  eligibility: "RANK_ONLY",
  groups: [],
  grantedActions: [],
  writtenBenefit: "+5 ft Throw Distance per STR.",
  status: "GRANTED",
  ...over,
});
const sheetWith = (skillBenefits: SheetSkillBenefitDto[]) => ({ mechanics: { skillBenefits } }) as unknown as CharacterSheetDto;

describe("RULES-WO1 R08 — Skill benefits on the Character sheet", () => {
  const granted = benefit({ benefitKey: "ATHLETICS_EXPERT_LEAP", minimumRankKey: "EXPERT", heldRankKey: "EXPERT", eligibility: "ELIGIBLE", writtenBenefit: "Gain the Leap Action.", grantedActions: [{ action: ref("leap", "ACTION"), state: "PINNED", actionKey: "LEAP" }] });
  const tooLow = benefit({ benefitKey: "ATHLETICS_MASTER", minimumRankKey: "MASTER", heldRankKey: "TRAINED", rankMet: false, status: "RANK_NOT_REACHED", writtenBenefit: "Master benefit." });
  const ineligible = benefit({
    benefitKey: "ATHLETICS_STRONG_THROW",
    eligibility: "INELIGIBLE",
    status: "INELIGIBLE",
    writtenBenefit: "Strong throw.",
    groups: [{ groupKey: "STRENGTH", mode: "ALL", satisfied: false, prerequisites: [{ prerequisiteKey: "STR_AT_LEAST_5", kind: "STAT_AT_LEAST", satisfied: false, reason: "STR 4 is below 5" }] }],
    grantedActions: [{ action: ref("hurl", "ACTION"), state: "PINNED", actionKey: "HURL" }],
  });

  it("says whether each benefit applies and, when not, why — in words", () => {
    render(<SkillBenefitsPanel sheet={sheetWith([granted, tooLow, ineligible])} />);
    expect(screen.getByTestId("sheet-skill-benefit-ATHLETICS_EXPERT_LEAP").getAttribute("data-status")).toBe("GRANTED");
    expect(screen.getByTestId("sheet-skill-benefit-ATHLETICS_EXPERT_LEAP").textContent).toContain("applies");
    expect(screen.getByTestId("sheet-skill-benefit-ATHLETICS_MASTER").textContent).toMatch(/needs Master \(now Trained\)/);
    expect(screen.getByTestId("sheet-skill-benefit-ATHLETICS_STRONG_THROW").textContent).toMatch(/not met: Str at least 5/i);
  });

  it("lists only the Actions a benefit actually grants (never one from an ineligible benefit)", () => {
    render(<SkillGrantedActionRows sheet={sheetWith([granted, tooLow, ineligible])} />);
    const rows = within(screen.getByTestId("sheet-skill-actions")).getAllByTestId("sheet-skill-action");
    expect(rows.map((r) => r.textContent)).toHaveLength(1);
    expect(rows[0]!.textContent).toMatch(/^Leap — from Athletics/);
    expect(screen.queryByText(/Hurl/)).toBeNull();
  });

  it("a Character on a Release without Skill benefits shows nothing new", () => {
    const { container } = render(
      <>
        <SkillBenefitsPanel sheet={sheetWith([])} />
        <SkillGrantedActionRows sheet={sheetWith([])} />
      </>,
    );
    expect(container.textContent).toBe("");
  });
});
