import { DomainError, EXTRACTION_CANDIDATE_STATUSES, IMPORT_DECISION_RULES, IMPORT_DECISION_TYPES, type ExtractionCandidateKind, type ReviewImportCandidateInput } from "@prowess/model";
import { describe, expect, it } from "vitest";
import { analyzeConflictSignals, importDecisionFingerprint, ruleFor, validateReviewInputShape, type ConflictCandidateInput } from "./review.js";

const c = (id: string, ordinal: number, payload: Record<string, unknown>, schema = "prowess.test.entity", version = 1): ConflictCandidateInput => ({ candidateId: id, ordinal, payloadSchemaKey: schema, payloadSchemaVersion: version, payload: payload as never });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return (e as DomainError).code;
  }
  return undefined;
};

describe("conflict signals (derived, never decisions)", () => {
  it("§68 / §69 / §70 equivalent, potential conflict and uncomparable — comparing only schema + canonical payload", () => {
    const cands = [
      c("a", 1, { name: "Direct Damage", cost: 4 }),
      c("b", 2, { cost: 4, name: "Direct Damage" }), // same payload, other key order, other location
      c("c", 3, { name: "Direct Damage", cost: 6 }),
      c("d", 4, { name: "Direct Damage" }, "prowess.test.entity", 2),
    ];
    const signals = analyzeConflictSignals(
      [
        { duplicateGroupId: "g1", memberCandidateIds: ["b", "a"] },
        { duplicateGroupId: "g2", memberCandidateIds: ["a", "c"] },
        { duplicateGroupId: "g3", memberCandidateIds: ["a", "d"] },
      ],
      cands,
    );
    expect(signals.map((s) => [s.duplicateGroupId, s.type, s.candidateIds, s.payloadSchemaKey, s.payloadSchemaVersion, s.distinctPayloadCount])).toEqual([
      ["g1", "DUPLICATE_EQUIVALENT", ["a", "b"], "prowess.test.entity", 1, 1],
      ["g2", "POTENTIAL_CONTENT_CONFLICT", ["a", "c"], "prowess.test.entity", 1, 2],
      ["g3", "UNCOMPARABLE_DUPLICATE", ["a", "d"], null, null, 2],
    ]);
  });

  it("never says which payload is right — the output has no winner, no preference, no rule", () => {
    const [s] = analyzeConflictSignals([{ duplicateGroupId: "g", memberCandidateIds: ["x", "y"] }], [c("x", 1, { cost: 4 }), c("y", 2, { cost: 6 })]);
    expect(Object.keys(s!).sort()).toEqual(["candidateIds", "distinctPayloadCount", "duplicateGroupId", "payloadSchemaKey", "payloadSchemaVersion", "type"]);
  });

  it("array order inside a payload is content", () => {
    const [s] = analyzeConflictSignals([{ duplicateGroupId: "g", memberCandidateIds: ["x", "y"] }], [c("x", 1, { tiers: ["A", "B"] }), c("y", 2, { tiers: ["B", "A"] })]);
    expect(s!.type).toBe("POTENTIAL_CONTENT_CONFLICT");
  });
});

describe("workflow graph", () => {
  const allowed = (type: (typeof IMPORT_DECISION_TYPES)[number], from: (typeof EXTRACTION_CANDIDATE_STATUSES)[number], kind: ExtractionCandidateKind) => code(() => ruleFor(type, from, kind)) === undefined;

  it("APPROVED and REJECTED are terminal for every decision type and kind", () => {
    for (const t of IMPORT_DECISION_TYPES) for (const from of ["APPROVED", "REJECTED"] as const) for (const k of ["ENTITY", "FORMULA", "UNKNOWN"] as const) expect(allowed(t, from, k)).toBe(false);
  });

  it("CONFLICT and NEEDS_MAPPING can never be approved directly; Entity candidates can never be approved from UNREVIEWED", () => {
    for (const t of ["APPROVE_MATCHED", "APPROVE_NEW_ENTITY", "APPROVE_SEMANTIC"] as const) {
      for (const from of ["CONFLICT", "NEEDS_MAPPING"] as const) for (const k of ["ENTITY", "FORMULA"] as const) expect(allowed(t, from, k)).toBe(false);
    }
    for (const t of ["APPROVE_MATCHED", "APPROVE_NEW_ENTITY", "APPROVE_SEMANTIC"] as const) expect(allowed(t, "UNREVIEWED", "ENTITY")).toBe(false);
  });

  it("semantic kinds approve directly; structural kinds may only be rejected or marked NEEDS_MAPPING", () => {
    for (const k of ["FORMULA", "REQUIREMENT", "KEYWORD"] as const) expect(allowed("APPROVE_SEMANTIC", "UNREVIEWED", k)).toBe(true);
    for (const k of ["UNKNOWN", "REFERENCE"] as const) {
      expect(IMPORT_DECISION_TYPES.filter((t) => allowed(t, "UNREVIEWED", k))).toEqual(["MARK_NEEDS_MAPPING", "REJECT"]);
    }
  });

  it("matches the documented graph exactly", () => {
    const graph: Record<string, string[]> = {};
    for (const from of EXTRACTION_CANDIDATE_STATUSES) graph[from] = [...new Set(IMPORT_DECISION_TYPES.filter((t) => IMPORT_DECISION_RULES[t].fromStatuses.includes(from)).map((t) => IMPORT_DECISION_RULES[t].toStatus))].sort();
    expect(graph).toEqual({
      UNREVIEWED: ["APPROVED", "CONFLICT", "MATCHED", "NEEDS_MAPPING", "NEW_ENTITY", "REJECTED"],
      MATCHED: ["APPROVED", "CONFLICT", "NEEDS_MAPPING", "REJECTED"],
      NEW_ENTITY: ["APPROVED", "CONFLICT", "NEEDS_MAPPING", "REJECTED"],
      CONFLICT: ["MATCHED", "NEEDS_MAPPING", "NEW_ENTITY", "REJECTED"],
      NEEDS_MAPPING: ["CONFLICT", "MATCHED", "NEW_ENTITY", "REJECTED"],
      REJECTED: [],
      APPROVED: [],
    });
  });
});

describe("input shape", () => {
  const ID = "00000000-0000-4000-8000-000000000001";
  const base = (over: Partial<ReviewImportCandidateInput> = {}) => ({ extractionCandidateId: ID, candidateFingerprint: "a".repeat(64), decisionType: "CLASSIFY_NEW_ENTITY", ...over }) as ReviewImportCandidateInput;
  it.each([
    [{ status: "APPROVED" }],
    [{ decisionType: "SET_STATUS" }],
    [{ candidateFingerprint: "nope" }],
    [{ decisionType: "CLASSIFY_MATCHED", matchBasis: "EXACT_MATCH" }], // no target
    [{ decisionType: "CLASSIFY_MATCHED", targetEntityId: ID }], // no basis
    [{ targetEntityId: ID }], // NEW_ENTITY never names an Entity
    [{ decisionType: "APPROVE_SEMANTIC", targetEntityId: ID }],
    [{ matchBasis: "EXACT_MATCH" }],
    [{ matchAssessmentId: ID }], // without its run
    [{ duplicateGroupId: ID }],
    [{ decisionType: "REJECT" }],
    [{ decisionType: "REJECT", rationale: "   " }],
  ])("rejects %j as INVALID_INPUT", (over) => {
    expect(code(() => validateReviewInputShape(base(over as never)))).toBe("IMPORT_DECISION.INVALID_INPUT");
  });
  it("accepts a well-formed decision", () => {
    expect(code(() => validateReviewInputShape(base({ decisionType: "REJECT", rationale: "Not a rule." })))).toBeUndefined();
  });
});

describe("decision fingerprint (PROWESS_IMPORT_DECISION_V1)", () => {
  const f = { extractionCandidateId: "A", candidateFingerprint: "a".repeat(64), candidateSetHash: "b".repeat(64), sequenceNumber: 1, fromStatus: "UNREVIEWED" as const, decisionType: "REJECT" as const, matchBasis: null, targetEntityId: null, comparisonEntityVersionId: null, matchRunId: null, matchAssessmentId: null, duplicateGroupId: null, rationale: "No." };
  it("is stable, id-case-insensitive, and changes with position, content and exact rationale", () => {
    expect(importDecisionFingerprint(f)).toBe(importDecisionFingerprint({ ...f, extractionCandidateId: "a" }));
    for (const over of [{ sequenceNumber: 2 }, { fromStatus: "CONFLICT" as const }, { rationale: "No" }, { rationale: "No. " }, { candidateSetHash: "c".repeat(64) }]) expect(importDecisionFingerprint({ ...f, ...over })).not.toBe(importDecisionFingerprint(f));
  });
});
