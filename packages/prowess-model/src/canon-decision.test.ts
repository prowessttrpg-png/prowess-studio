import { describe, expect, it } from "vitest";
import { CANON_CONFLICT_DISPOSITIONS, isCanonConflictDisposition, ruleConflictStatusForDisposition } from "./canon-conflict-disposition.js";
import { CANON_DECISION_TYPES, isCanonDecisionType } from "./canon-decision-type.js";
import {
  CANON_DECISION_RULES,
  MAX_CANON_DECISION_RATIONALE_LENGTH,
  validateCreateCanonDecisionInput,
  validateListCanonDecisionsFilters,
  type CreateCanonDecisionInput,
} from "./canon-decision.js";
import { CANON_DECISION_ERROR_CODES } from "./errors.js";
import { CanonDecisionId, CanonDecisionSelectionId } from "./ids.js";
import { DECIDABLE_RULE_CONFLICT_STATUSES, isDecidableRuleConflictStatus, RULE_CONFLICT_STATUSES } from "./rule-conflict-status.js";

const P = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
const C3 = "44444444-4444-4444-8444-444444444444";
const V = "55555555-5555-4555-8555-555555555555";
const base = (over: Partial<CreateCanonDecisionInput>): CreateCanonDecisionInput => ({
  canonPolicyId: P,
  decisionType: "SELECT_RULE",
  conflictDisposition: "RESOLVED",
  selectedCandidateIds: [C1],
  rationale: "Errata supersedes the playtest AP cost.",
  ...over,
});
const problem = (over: Partial<CreateCanonDecisionInput>) => validateCreateCanonDecisionInput(base(over));

describe("vocabularies (§6, §7)", () => {
  it("CanonDecisionType is exactly the four conflict-resolution types — no RENAME/DEPRECATE/PROMOTE/ROLLBACK/… yet", () => {
    expect([...CANON_DECISION_TYPES]).toEqual(["SELECT_RULE", "KEEP_SEPARATE", "MERGE", "RESOLVE_CONFLICT"]);
    for (const t of CANON_DECISION_TYPES) expect(isCanonDecisionType(t)).toBe(true);
    for (const t of ["RENAME", "DEPRECATE", "AUTHORIZE_EXPERIMENT", "PROMOTE", "ROLLBACK", "SOURCE_AUTHORITY_CHANGE", "select_rule", ""]) {
      expect(isCanonDecisionType(t), t).toBe(false);
    }
  });

  it("CanonConflictDisposition is exactly the three terminal states", () => {
    expect([...CANON_CONFLICT_DISPOSITIONS]).toEqual(["RESOLVED", "ACCEPTED_DIVERGENCE", "DISMISSED"]);
    for (const d of ["OPEN", "UNDER_REVIEW", "resolved", ""]) expect(isCanonConflictDisposition(d), d).toBe(false);
  });

  it("every disposition maps to the RuleConflictStatus of the same name, and none is OPEN/UNDER_REVIEW (§8)", () => {
    for (const d of CANON_CONFLICT_DISPOSITIONS) {
      expect(ruleConflictStatusForDisposition(d)).toBe(d);
      expect((RULE_CONFLICT_STATUSES as readonly string[]).includes(d)).toBe(true);
      expect(isDecidableRuleConflictStatus(d)).toBe(false);
    }
  });

  it("only OPEN and UNDER_REVIEW are decidable (§9)", () => {
    expect([...DECIDABLE_RULE_CONFLICT_STATUSES]).toEqual(["OPEN", "UNDER_REVIEW"]);
    expect(RULE_CONFLICT_STATUSES.filter(isDecidableRuleConflictStatus)).toEqual(["OPEN", "UNDER_REVIEW"]);
  });
});

describe("ids and errors (§54, §55)", () => {
  it("brand UUID strings without changing them", () => {
    expect(CanonDecisionId.of(P)).toBe(P);
    expect(CanonDecisionSelectionId.of(C1)).toBe(C1);
  });

  it("the error vocabulary is exactly the ten CANON_DECISION codes", () => {
    expect(Object.keys(CANON_DECISION_ERROR_CODES).sort()).toEqual(
      [
        "NOT_FOUND",
        "CONFLICT_NOT_FOUND",
        "RULESET_NOT_FOUND",
        "CONFLICT_ALREADY_DECIDED",
        "POLICY_NOT_FOUND",
        "INVALID_POLICY_CONTEXT",
        "INVALID_INPUT",
        "INVALID_CANDIDATE",
        "INVALID_RESULT_VERSION",
        "DECISION_CONFLICT",
      ].sort(),
    );
    for (const [key, code] of Object.entries(CANON_DECISION_ERROR_CODES)) expect(code).toBe(`CANON_DECISION.${key}`);
  });
});

describe("validateCreateCanonDecisionInput — valid combinations (§16–§20, §41)", () => {
  it.each([
    ["SELECT_RULE + RESOLVED + 1", { decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [C1] }],
    ["KEEP_SEPARATE + ACCEPTED_DIVERGENCE + 2", { decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [C1, C2] }],
    ["KEEP_SEPARATE + ACCEPTED_DIVERGENCE + 3", { decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [C1, C2, C3] }],
    ["MERGE + RESOLVED + 2 + result", { decisionType: "MERGE", conflictDisposition: "RESOLVED", selectedCandidateIds: [C1, C2], resultEntityVersionId: V }],
    ["RESOLVE_CONFLICT + RESOLVED + 0", { decisionType: "RESOLVE_CONFLICT", conflictDisposition: "RESOLVED", selectedCandidateIds: [] }],
    ["RESOLVE_CONFLICT + DISMISSED + 0", { decisionType: "RESOLVE_CONFLICT", conflictDisposition: "DISMISSED", selectedCandidateIds: [] }],
    ["RESOLVE_CONFLICT + DISMISSED + 2", { decisionType: "RESOLVE_CONFLICT", conflictDisposition: "DISMISSED", selectedCandidateIds: [C1, C2] }],
  ])("accepts %s", (_name, over) => {
    expect(problem(over as Partial<CreateCanonDecisionInput>)).toBeNull();
  });
});

describe("validateCreateCanonDecisionInput — invalid combinations are INVALID_INPUT (§42)", () => {
  it.each([
    ["SELECT_RULE + ACCEPTED_DIVERGENCE", { conflictDisposition: "ACCEPTED_DIVERGENCE" }],
    ["SELECT_RULE + DISMISSED", { conflictDisposition: "DISMISSED" }],
    ["SELECT_RULE + 0 selections", { selectedCandidateIds: [] }],
    ["SELECT_RULE + 2 selections", { selectedCandidateIds: [C1, C2] }],
    ["SELECT_RULE with a result", { resultEntityVersionId: V }],
    ["KEEP_SEPARATE + RESOLVED", { decisionType: "KEEP_SEPARATE", conflictDisposition: "RESOLVED", selectedCandidateIds: [C1, C2] }],
    ["KEEP_SEPARATE + 1 selection", { decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [C1] }],
    ["MERGE without result", { decisionType: "MERGE", selectedCandidateIds: [C1, C2] }],
    ["MERGE with null result", { decisionType: "MERGE", selectedCandidateIds: [C1, C2], resultEntityVersionId: null }],
    ["MERGE with 1 selection", { decisionType: "MERGE", selectedCandidateIds: [C1], resultEntityVersionId: V }],
    ["MERGE + ACCEPTED_DIVERGENCE", { decisionType: "MERGE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [C1, C2], resultEntityVersionId: V }],
    ["MERGE + DISMISSED", { decisionType: "MERGE", conflictDisposition: "DISMISSED", selectedCandidateIds: [C1, C2], resultEntityVersionId: V }],
    ["RESOLVE_CONFLICT + ACCEPTED_DIVERGENCE", { decisionType: "RESOLVE_CONFLICT", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [] }],
    ["RESOLVE_CONFLICT with a result", { decisionType: "RESOLVE_CONFLICT", selectedCandidateIds: [], resultEntityVersionId: V }],
    ["a duplicate selection (case-insensitive)", { decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [C1, ` ${C1.toUpperCase()} `] }],
    ["an unsupported type (PROMOTE)", { decisionType: "PROMOTE" }],
    ["an unknown disposition", { conflictDisposition: "CLOSED" }],
    ["OPEN as a disposition", { conflictDisposition: "OPEN" }],
    ["a blank policy id", { canonPolicyId: " " }],
    ["a blank rationale", { rationale: "   " }],
    ["an over-long rationale", { rationale: "x".repeat(MAX_CANON_DECISION_RATIONALE_LENGTH + 1) }],
    ["selections not an array", { selectedCandidateIds: C1 as unknown as string[] }],
    ["a blank selection", { selectedCandidateIds: [""] }],
    ["a blank result id", { decisionType: "MERGE", selectedCandidateIds: [C1, C2], resultEntityVersionId: "" }],
  ])("rejects %s", (_name, over) => {
    expect(problem(over as Partial<CreateCanonDecisionInput>)?.kind).toBe("INVALID_INPUT");
  });

  it("rejects a non-object input", () => {
    expect(validateCreateCanonDecisionInput(null as unknown as CreateCanonDecisionInput)?.kind).toBe("INVALID_INPUT");
  });

  it("the whole type × disposition matrix matches the documented rules exactly", () => {
    for (const type of CANON_DECISION_TYPES) {
      const rules = CANON_DECISION_RULES[type];
      for (const disposition of CANON_CONFLICT_DISPOSITIONS) {
        const selections = [C1, C2, C3].slice(0, Math.max(rules.minSelections, 1));
        const ok =
          validateCreateCanonDecisionInput(
            base({
              decisionType: type,
              conflictDisposition: disposition,
              selectedCandidateIds: rules.maxSelections === 1 ? [C1] : selections,
              ...(rules.resultVersion === "required" ? { resultEntityVersionId: V } : {}),
            }),
          ) === null;
        expect(ok, `${type} + ${disposition}`).toBe((rules.dispositions as readonly string[]).includes(disposition));
      }
    }
    // The matrix itself, spelled out (§16–§20):
    expect(Object.fromEntries(CANON_DECISION_TYPES.map((t) => [t, [...CANON_DECISION_RULES[t].dispositions]]))).toEqual({
      SELECT_RULE: ["RESOLVED"],
      KEEP_SEPARATE: ["ACCEPTED_DIVERGENCE"],
      MERGE: ["RESOLVED"],
      RESOLVE_CONFLICT: ["RESOLVED", "DISMISSED"],
    });
  });

  it("ACCEPTED_DIVERGENCE is reachable ONLY through KEEP_SEPARATE (§20)", () => {
    expect(CANON_DECISION_TYPES.filter((t) => (CANON_DECISION_RULES[t].dispositions as readonly string[]).includes("ACCEPTED_DIVERGENCE"))).toEqual([
      "KEEP_SEPARATE",
    ]);
  });

  it("smuggled winner / manifest fields do not change validation (they are ignored downstream)", () => {
    expect(validateCreateCanonDecisionInput({ ...base({}), winnerId: C1, appliedManifestId: P } as unknown as CreateCanonDecisionInput)).toBeNull();
  });
});

describe("validateListCanonDecisionsFilters (§37)", () => {
  it("accepts none and every recognized value", () => {
    expect(validateListCanonDecisionsFilters(undefined)).toBeNull();
    expect(validateListCanonDecisionsFilters({ ruleConflictId: C1, canonPolicyId: P, decisionType: "MERGE", conflictDisposition: "DISMISSED" })).toBeNull();
  });
  it.each([[{ decisionType: "PROMOTE" }], [{ conflictDisposition: "OPEN" }], [{ ruleConflictId: "" }], [{ canonPolicyId: " " }]])("rejects %j", (f) => {
    expect(validateListCanonDecisionsFilters(f)?.kind).toBe("INVALID_INPUT");
  });
});
