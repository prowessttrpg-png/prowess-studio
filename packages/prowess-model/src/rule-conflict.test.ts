import { describe, expect, it } from "vitest";
import { RULE_CONFLICT_ERROR_CODES } from "./errors.js";
import { RuleConflictCandidateId, RuleConflictId } from "./ids.js";
import { isRuleConflictSeverity, RULE_CONFLICT_SEVERITIES } from "./rule-conflict-severity.js";
import { INITIAL_RULE_CONFLICT_STATUS, isRuleConflictStatus, RULE_CONFLICT_STATUSES } from "./rule-conflict-status.js";
import { isRuleConflictType, RULE_CONFLICT_TYPES } from "./rule-conflict-type.js";
import {
  MAX_RULE_CONFLICT_CANDIDATE_LABEL_LENGTH,
  MAX_RULE_CONFLICT_CANDIDATES,
  MAX_RULE_CONFLICT_DESCRIPTION_LENGTH,
  MAX_RULE_CONFLICT_POSITION_SUMMARY_LENGTH,
  MAX_RULE_CONFLICT_TITLE_LENGTH,
  MIN_RULE_CONFLICT_CANDIDATES,
  validateCreateRuleConflictInput,
  validateListRuleConflictsFilters,
  type CreateRuleConflictInput,
} from "./rule-conflict.js";

const E = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const vid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ok: CreateRuleConflictInput = {
  entityId: E,
  conflictType: "MECHANICAL_DIVERGENCE",
  severity: "HIGH",
  title: "AP cost disagreement",
  candidates: [{ entityVersionId: V1 }, { entityVersionId: V2 }],
};
const kind = (input: unknown) => validateCreateRuleConflictInput(input as CreateRuleConflictInput)?.kind ?? null;

describe("RuleConflict vocabularies (§5–§8)", () => {
  it("RuleConflictType is exactly the six classifications", () => {
    expect([...RULE_CONFLICT_TYPES]).toEqual([
      "SOURCE_CONTRADICTION",
      "MECHANICAL_DIVERGENCE",
      "TERMINOLOGY_DIVERGENCE",
      "STRUCTURAL_DIVERGENCE",
      "AUTHORING_STANDARD_CONFLICT",
      "OTHER",
    ]);
    for (const t of RULE_CONFLICT_TYPES) expect(isRuleConflictType(t)).toBe(true);
    for (const t of ["mechanical_divergence", "", "CONFLICT", "LOW"]) expect(isRuleConflictType(t)).toBe(false);
  });

  it("RuleConflictSeverity is exactly LOW < MEDIUM < HIGH < CRITICAL", () => {
    expect([...RULE_CONFLICT_SEVERITIES]).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    for (const s of RULE_CONFLICT_SEVERITIES) expect(isRuleConflictSeverity(s)).toBe(true);
    for (const s of ["low", "", "BLOCKER", "OPEN"]) expect(isRuleConflictSeverity(s)).toBe(false);
  });

  it("RuleConflictStatus is exactly the five governance states, and ACCEPTED_DIVERGENCE is one of them (§8, §58)", () => {
    expect([...RULE_CONFLICT_STATUSES]).toEqual(["OPEN", "UNDER_REVIEW", "RESOLVED", "ACCEPTED_DIVERGENCE", "DISMISSED"]);
    expect(isRuleConflictStatus("ACCEPTED_DIVERGENCE")).toBe(true);
    for (const s of ["open", "", "CANON", "WON", "CLOSED"]) expect(isRuleConflictStatus(s)).toBe(false);
  });

  it("every conflict starts OPEN (§7)", () => {
    expect(INITIAL_RULE_CONFLICT_STATUS).toBe("OPEN");
  });

  it("the three vocabularies are disjoint (no label means two things)", () => {
    const all = [...RULE_CONFLICT_TYPES, ...RULE_CONFLICT_SEVERITIES, ...RULE_CONFLICT_STATUSES];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("ids (§32)", () => {
  it("brand UUID strings without changing their runtime value", () => {
    expect(RuleConflictId.of(V1)).toBe(V1);
    expect(RuleConflictCandidateId.of(V2)).toBe(V2);
  });
});

describe("error vocabulary (§33)", () => {
  it("is exactly the nine RULE_CONFLICT codes, with no resolution / transition / winner code", () => {
    expect(Object.values(RULE_CONFLICT_ERROR_CODES).sort()).toEqual(
      [
        "RULE_CONFLICT.NOT_FOUND",
        "RULE_CONFLICT.RULESET_NOT_FOUND",
        "RULE_CONFLICT.ENTITY_NOT_FOUND",
        "RULE_CONFLICT.INVALID_INPUT",
        "RULE_CONFLICT.INSUFFICIENT_CANDIDATES",
        "RULE_CONFLICT.DUPLICATE_CANDIDATE",
        "RULE_CONFLICT.VERSION_NOT_FOUND",
        "RULE_CONFLICT.VERSION_ENTITY_MISMATCH",
        "RULE_CONFLICT.INVALID_SOURCE_REFERENCE",
      ].sort(),
    );
    for (const [key, code] of Object.entries(RULE_CONFLICT_ERROR_CODES)) expect(code).toBe(`RULE_CONFLICT.${key}`);
    expect(Object.keys(RULE_CONFLICT_ERROR_CODES).filter((k) => /RESOLV|TRANSITION|WINNER|STATUS|DECISION/.test(k))).toEqual([]);
  });
});

describe("validateCreateRuleConflictInput (§12, §13, §23)", () => {
  it("accepts a minimal two-candidate conflict, and every type and severity", () => {
    expect(validateCreateRuleConflictInput(ok)).toBeNull();
    for (const conflictType of RULE_CONFLICT_TYPES) for (const severity of RULE_CONFLICT_SEVERITIES) {
      expect(validateCreateRuleConflictInput({ ...ok, conflictType, severity })).toBeNull();
    }
  });

  it("accepts optional description, SourceReference, label and position summary (null or absent)", () => {
    expect(
      validateCreateRuleConflictInput({
        ...ok,
        description: "d",
        candidates: [
          { entityVersionId: V1, sourceReferenceId: E, label: "Older AP interpretation", positionSummary: "AP = 2" },
          { entityVersionId: V2, sourceReferenceId: null, label: null, positionSummary: null },
        ],
      }),
    ).toBeNull();
  });

  it("requires at least two candidates: zero and one are INSUFFICIENT_CANDIDATES (§12)", () => {
    expect(MIN_RULE_CONFLICT_CANDIDATES).toBe(2);
    expect(kind({ ...ok, candidates: [] })).toBe("INSUFFICIENT_CANDIDATES");
    expect(kind({ ...ok, candidates: [{ entityVersionId: V1 }] })).toBe("INSUFFICIENT_CANDIDATES");
  });

  it("caps candidates at a documented maximum: exactly the cap is fine, one more is INVALID_INPUT (§12)", () => {
    expect(MAX_RULE_CONFLICT_CANDIDATES).toBe(25);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ entityVersionId: vid(i + 1) }));
    expect(kind({ ...ok, candidates: many(MAX_RULE_CONFLICT_CANDIDATES) })).toBeNull();
    expect(kind({ ...ok, candidates: many(MAX_RULE_CONFLICT_CANDIDATES + 1) })).toBe("INVALID_INPUT");
  });

  it("rejects the same EntityVersion twice — case- and whitespace-insensitively — as DUPLICATE_CANDIDATE (§13)", () => {
    expect(kind({ ...ok, candidates: [{ entityVersionId: V1 }, { entityVersionId: V1 }] })).toBe("DUPLICATE_CANDIDATE");
    expect(kind({ ...ok, candidates: [{ entityVersionId: V1 }, { entityVersionId: V2 }, { entityVersionId: ` ${V1.toUpperCase()} ` }] })).toBe(
      "DUPLICATE_CANDIDATE",
    );
  });

  it("reports shape problems before duplicates", () => {
    expect(kind({ ...ok, candidates: [{ entityVersionId: V1 }, { entityVersionId: V1, label: 7 }] })).toBe("INVALID_INPUT");
  });

  it.each([
    ["not an object", null],
    ["missing entityId", { ...ok, entityId: "" }],
    ["unknown type", { ...ok, conflictType: "BALANCE" }],
    ["lower-case type", { ...ok, conflictType: "other" }],
    ["unknown severity", { ...ok, severity: "BLOCKER" }],
    ["blank title", { ...ok, title: "   " }],
    ["missing title", { ...ok, title: undefined }],
    ["over-long title", { ...ok, title: "x".repeat(MAX_RULE_CONFLICT_TITLE_LENGTH + 1) }],
    ["non-string description", { ...ok, description: 5 }],
    ["over-long description", { ...ok, description: "x".repeat(MAX_RULE_CONFLICT_DESCRIPTION_LENGTH + 1) }],
    ["candidates not an array", { ...ok, candidates: "v1,v2" }],
    ["candidate not an object", { ...ok, candidates: [{ entityVersionId: V1 }, null] }],
    ["candidate missing version", { ...ok, candidates: [{ entityVersionId: V1 }, { entityVersionId: " " }] }],
    ["blank sourceReferenceId", { ...ok, candidates: [{ entityVersionId: V1, sourceReferenceId: "" }, { entityVersionId: V2 }] }],
    ["over-long label", { ...ok, candidates: [{ entityVersionId: V1, label: "x".repeat(MAX_RULE_CONFLICT_CANDIDATE_LABEL_LENGTH + 1) }, { entityVersionId: V2 }] }],
    [
      "over-long summary",
      { ...ok, candidates: [{ entityVersionId: V1, positionSummary: "x".repeat(MAX_RULE_CONFLICT_POSITION_SUMMARY_LENGTH + 1) }, { entityVersionId: V2 }] },
    ],
  ])("rejects %s as INVALID_INPUT", (_name, input) => {
    expect(kind(input)).toBe("INVALID_INPUT");
  });

  it("has no input field for status or a winner: smuggled ones do not affect validation (they are ignored downstream)", () => {
    expect(validateCreateRuleConflictInput({ ...ok, status: "RESOLVED", winningVersionId: V1 } as unknown as CreateRuleConflictInput)).toBeNull();
  });
});

describe("validateListRuleConflictsFilters (§26)", () => {
  it("accepts no filters, and every recognized value", () => {
    expect(validateListRuleConflictsFilters(undefined)).toBeNull();
    expect(validateListRuleConflictsFilters({})).toBeNull();
    expect(validateListRuleConflictsFilters({ entityId: E, status: "OPEN", severity: "CRITICAL", conflictType: "OTHER" })).toBeNull();
  });

  it.each([
    [{ status: "open" }],
    [{ severity: "HUGE" }],
    [{ conflictType: "MECHANICAL" }],
    [{ entityId: "" }],
  ])("rejects %j as INVALID_INPUT", (filters) => {
    expect(validateListRuleConflictsFilters(filters)?.kind).toBe("INVALID_INPUT");
  });
});
