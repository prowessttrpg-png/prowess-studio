import { describe, expect, it } from "vitest";
import { DomainError, EXTRACTION_CANDIDATE_ERROR_CODES, IMPORT_BATCH_ERROR_CODES } from "./errors.js";
import {
  emptyImportBatchSummary,
  EXTRACTION_CANDIDATE_KINDS,
  EXTRACTION_CANDIDATE_STATUSES,
  EXTRACTION_CONFIDENCES,
  IMPORT_BATCH_SCOPE_TYPES,
  IMPORT_BATCH_STATUSES,
  INITIAL_EXTRACTION_CANDIDATE_STATUS,
  INITIAL_IMPORT_BATCH_STATUS,
  validateCreateExtractionCandidateInput,
  validateCreateImportBatchInput,
  type CreateExtractionCandidateInput,
  type CreateImportBatchInput,
} from "./import-batch.js";

const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return (e as DomainError).code;
  }
  return undefined;
};
const ID = "11111111-1111-4111-8111-111111111111";
const batch = (over: Record<string, unknown> = {}) => ({ sourceSnapshotId: ID, label: "b", scope: { type: "SNAPSHOT" }, extractorKey: "manual-foundation", extractorVersion: "1.0", ...over }) as unknown as CreateImportBatchInput;
const cand = (over: Record<string, unknown> = {}) =>
  ({ ordinal: 1, candidateKind: "ENTITY", displayLabel: "x", confidence: "HIGH", payloadSchemaKey: "prowess.test", payloadSchemaVersion: 1, payloadJson: {}, primarySourceAnchor: { sectionId: ID }, ...over }) as unknown as CreateExtractionCandidateInput;

describe("vocabularies", () => {
  it("are exactly the approved sets, and only CREATED / UNREVIEWED are ever written in WO2", () => {
    expect(IMPORT_BATCH_SCOPE_TYPES).toEqual(["SNAPSHOT", "SECTION_SUBTREE"]);
    expect(IMPORT_BATCH_STATUSES).toEqual(["CREATED", "EXTRACTING", "READY_FOR_REVIEW", "REVIEWING", "COMPLETED", "FAILED", "CANCELLED"]);
    expect(EXTRACTION_CANDIDATE_KINDS).toEqual(["ENTITY", "ENTITY_FIELD", "FORMULA", "REQUIREMENT", "KEYWORD", "RELATIONSHIP", "REFERENCE", "UNKNOWN"]);
    expect(EXTRACTION_CONFIDENCES).toEqual(["HIGH", "MEDIUM", "LOW"]);
    expect(EXTRACTION_CANDIDATE_STATUSES).toEqual(["UNREVIEWED", "MATCHED", "NEW_ENTITY", "CONFLICT", "NEEDS_MAPPING", "REJECTED", "APPROVED"]);
    expect([INITIAL_IMPORT_BATCH_STATUS, INITIAL_EXTRACTION_CANDIDATE_STATUS]).toEqual(["CREATED", "UNREVIEWED"]);
    for (const k of EXTRACTION_CANDIDATE_KINDS) expect(k).not.toMatch(/SPELL|WEAPON|MANEUVER|SKILL/);
  });
  it("an empty summary lists every value at zero", () => {
    const s = emptyImportBatchSummary();
    expect(s.candidateCount).toBe(0);
    expect(Object.keys(s.byStatus)).toEqual([...EXTRACTION_CANDIDATE_STATUSES]);
    expect(Object.values(s.byKind).every((v) => v === 0)).toBe(true);
  });
});

describe("validateCreateImportBatchInput", () => {
  it("accepts a valid SNAPSHOT and SECTION_SUBTREE input", () => {
    expect(code(() => validateCreateImportBatchInput(batch()))).toBeUndefined();
    expect(code(() => validateCreateImportBatchInput(batch({ scope: { type: "SECTION_SUBTREE", sectionId: ID }, reviewRulesetId: ID, comparisonManifestId: ID }))) ).toBeUndefined();
  });
  it.each([
    [{ status: "CREATED" }, IMPORT_BATCH_ERROR_CODES.INVALID_INPUT],
    [{ batchFingerprint: "x" }, IMPORT_BATCH_ERROR_CODES.INVALID_INPUT],
    [{ sourceStructureHash: "x" }, IMPORT_BATCH_ERROR_CODES.INVALID_INPUT],
    [{ label: "" }, IMPORT_BATCH_ERROR_CODES.INVALID_INPUT],
    [{ extractorKey: "Manual Foundation" }, IMPORT_BATCH_ERROR_CODES.INVALID_INPUT],
    [{ extractorVersion: "1 0" }, IMPORT_BATCH_ERROR_CODES.INVALID_INPUT],
    [{ extractorConfigHash: "ABC" }, IMPORT_BATCH_ERROR_CODES.INVALID_INPUT],
    [{ scope: { type: "SNAPSHOT", sectionId: ID } }, IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE],
    [{ scope: { type: "SECTION_SUBTREE" } }, IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE],
    [{ scope: { type: "SECTIONS", sectionIds: [ID] } }, IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE],
    [{ comparisonManifestId: ID }, IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT],
  ])("rejects %j", (over, expected) => {
    expect(code(() => validateCreateImportBatchInput(batch(over)))).toBe(expected);
  });
});

describe("validateCreateExtractionCandidateInput", () => {
  it("accepts a valid candidate with supporting anchors", () => {
    expect(code(() => validateCreateExtractionCandidateInput(cand({ proposedEntityType: "GENERIC_RULE", supportingSourceAnchors: [{ contentNodeId: ID, excerpt: "x" }] })))).toBeUndefined();
  });
  it.each([
    [{ status: "APPROVED" }],
    [{ status: "UNREVIEWED" }],
    [{ candidateFingerprint: "x" }],
    [{ sourceSnapshotId: ID }],
    [{ ordinal: 0 }],
    [{ ordinal: 1.5 }],
    [{ candidateKind: "SPELL_EFFECT" }],
    [{ confidence: "AUTHORITATIVE" }],
    [{ payloadJson: null }],
    [{ payloadJson: [] }],
    [{ payloadSchemaVersion: 0 }],
    [{ proposedEntityType: "NOT_A_TYPE" }],
    [{ candidateKind: "KEYWORD", proposedEntityType: "GENERIC_RULE" }],
    [{ primarySourceAnchor: {} }],
    [{ primarySourceAnchor: { sectionId: ID, contentNodeId: ID } }],
    [{ primarySourceAnchor: { sectionId: ID, excerpt: "x" } }],
    [{ supportingSourceAnchors: [{ sectionId: ID, excerpt: "" }] }],
  ])("rejects %j as INVALID_INPUT", (over) => {
    expect(code(() => validateCreateExtractionCandidateInput(cand(over)))).toBe(EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT);
  });
});
