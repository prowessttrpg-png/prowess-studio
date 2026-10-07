import { TopBarRulesetSelector } from "@prowess/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorPanel, StatusBadge } from "../../app/developer/rulesets/_components/primitives";
import { canPublish, changeSetCommands, conflictAcceptsDecision, decisionAffordances, describeError, groupImpactItems, IMPACT_CATEGORY_INFO, operationFields, rulesetCommands } from "../../app/developer/rulesets/_lib/presentation";
import { GovernanceApiError } from "../../src/api-client";

/** PAS-10 M2-WO10 §83: presentation helpers and key components, tested by behavior. */
describe("lifecycle action visibility (§10, §36)", () => {
  it("offers only the named command valid for each Ruleset status", () => {
    expect(rulesetCommands("DRAFT").map((c) => c.label)).toEqual(["Submit for Review"]);
    expect(rulesetCommands("IN_REVIEW").map((c) => c.label)).toEqual(["Approve"]);
    for (const s of ["APPROVED", "PUBLISHED", "DEPRECATED", "ARCHIVED"]) expect(rulesetCommands(s)).toEqual([]);
    expect(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED"].filter(canPublish)).toEqual(["APPROVED", "PUBLISHED"]);
  });
  it("offers only the named ChangeSet commands valid for each status, with no generic setter", () => {
    expect(changeSetCommands("DRAFT").map((c) => c.command)).toEqual(["submit-review"]);
    expect(changeSetCommands("READY_FOR_REVIEW").map((c) => c.command)).toEqual(["approve", "reject"]);
    for (const s of ["APPROVED", "REJECTED", "SUPERSEDED"]) expect(changeSetCommands(s)).toEqual([]);
    expect(["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"].filter(conflictAcceptsDecision)).toEqual(["OPEN", "UNDER_REVIEW"]);
  });
});

describe("form affordances are DERIVED from the model's own rule tables (§27, §33)", () => {
  it("operation fields follow CHANGE_SET_OPERATION_RULES", () => {
    expect(operationFields("REPLACE_ENTITY_VERSION")).toEqual({ entity: true, from: true, to: true });
    expect(operationFields("PIN_ENTITY_VERSION")).toEqual({ entity: true, from: false, to: true });
    expect(operationFields("NO_CHANGE")).toEqual({ entity: false, from: false, to: false });
    expect(operationFields("DEPRECATE_ENTITY_VERSION")).toEqual({ entity: true, from: true, to: false });
  });
  it("decision affordances follow CANON_DECISION_RULES (single select, MERGE result, suggested dispositions)", () => {
    expect(decisionAffordances("SELECT_RULE")).toMatchObject({ singleSelection: true, showResult: false, suggestedDispositions: ["RESOLVED"] });
    expect(decisionAffordances("MERGE")).toMatchObject({ singleSelection: false, showResult: true });
    expect(decisionAffordances("KEEP_SEPARATE").suggestedDispositions).toEqual(["ACCEPTED_DIVERGENCE"]);
    expect(decisionAffordances("RESOLVE_CONFLICT").suggestedDispositions).toEqual(["RESOLVED", "DISMISSED"]);
  });
});

describe("impact grouping (§38)", () => {
  it("groups by the eight categories in documented order and keeps empty groups", () => {
    const groups = groupImpactItems([{ category: "MANIFEST", id: 1 }, { category: "DIRECT_ENTITY", id: 2 }, { category: "MANIFEST", id: 3 }]);
    expect(groups.map((g) => g.category)).toEqual(IMPACT_CATEGORY_INFO.map((i) => i.category));
    expect(groups.find((g) => g.category === "MANIFEST")!.items.map((i) => i.id)).toEqual([1, 3]);
    expect(groups.find((g) => g.category === "KEYWORD_RELATED")!.items).toEqual([]);
    for (const info of IMPACT_CATEGORY_INFO) expect(info.description).not.toMatch(/\b(broken|invalid|requires recalculation)\b/i);
  });
});

describe("components", () => {
  it("StatusBadge always renders the status as text (§57, §59)", () => {
    render(<StatusBadge value="READY_FOR_REVIEW" kind="change-set-status" />);
    expect(screen.getByTestId("badge-change-set-status")).toHaveTextContent("READY FOR REVIEW");
  });
  it("ErrorPanel shows readable copy AND the domain code, plus Retry for reads (§42, §52)", () => {
    const retry = vi.fn();
    render(<ErrorPanel error={new GovernanceApiError("RULESET_RELEASE.STALE_CHANGE_SET", "server text", 409)} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("no longer matches the base Manifest");
    expect(screen.getByTestId("error-code")).toHaveTextContent("RULESET_RELEASE.STALE_CHANGE_SET");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(describeError("UNKNOWN.CODE", "server says")).toBe("server says");
  });
  it("the top-bar selector is a VIEWING control that only reports the choice (§5, §6, §71)", () => {
    const onChange = vi.fn();
    render(<TopBarRulesetSelector options={[{ id: "a", label: "Core" }, { id: "b", label: "Experimental" }]} value="a" onChange={onChange} />);
    const select = screen.getByTestId("topbar-ruleset");
    expect(select).toHaveAccessibleName("Ruleset to view");
    expect(screen.getByText("Viewing")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
    expect(document.body.textContent).not.toMatch(/Active|Current/);
  });
});
