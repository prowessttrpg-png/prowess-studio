import {
  DomainError,
  IMPORT_DECISION_ERROR_CODES,
  IMPORT_DECISION_RULES,
  IMPORT_DECISION_TYPES,
  IMPORT_MATCH_DECISION_BASES,
  MAX_IMPORT_DECISION_RATIONALE_LENGTH,
  TARGET_OPTIONAL_DECISION_TYPES,
  TARGET_REQUIRED_DECISION_TYPES,
  type ExtractionCandidateKind,
  type ExtractionCandidateStatus,
  type ImportConflictSignalType,
  type ImportDecisionRule,
  type ImportDecisionType,
  type ImportMatchDecisionBasis,
  type JsonObject,
  type ReviewImportCandidateInput,
} from "@prowess/model";
import { canonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./fingerprint.js";

/**
 * Pure import-review logic (PAS-10 M3-WO6): conflict signals over WO4 duplicate groups, the Candidate workflow-graph
 * check, and the versioned decision fingerprint. No database, network, filesystem, clock, randomness, and no game
 * interpretation: a POTENTIAL_CONTENT_CONFLICT says two payloads differ — never which one is right.
 */

// ---------------------------------------------------------------------------------------------------------------
// Conflict signals
// ---------------------------------------------------------------------------------------------------------------

export interface ConflictCandidateInput {
  candidateId: string;
  ordinal: number;
  payloadSchemaKey: string;
  payloadSchemaVersion: number;
  payload: JsonObject;
}

export interface ConflictGroupInput {
  duplicateGroupId: string;
  /** Members in any order; output orders them by Candidate ordinal, then id. */
  memberCandidateIds: readonly string[];
}

export interface ConflictSignalOutput {
  duplicateGroupId: string;
  type: ImportConflictSignalType;
  candidateIds: string[];
  payloadSchemaKey: string | null;
  payloadSchemaVersion: number | null;
  distinctPayloadCount: number;
}

/**
 * One signal per duplicate group (groups in the order given — the MatchRun's deterministic group order):
 *   UNCOMPARABLE_DUPLICATE      the members do not all share one payload schema key + version (no guessing how
 *                               schema versions translate)
 *   DUPLICATE_EQUIVALENT        one schema, canonically-equal payloads (e.g. the same statement in two places)
 *   POTENTIAL_CONTENT_CONFLICT  one schema, canonically-different payloads
 * Only schema key/version and the canonical payload are compared — never ids, anchors, status, confidence or time.
 */
export function analyzeConflictSignals(groups: readonly ConflictGroupInput[], candidates: readonly ConflictCandidateInput[]): ConflictSignalOutput[] {
  const byId = new Map(candidates.map((c) => [c.candidateId, c]));
  return groups.map((g) => {
    const members = g.memberCandidateIds
      .map((id) => {
        const c = byId.get(id);
        if (!c) throw new Error(`duplicate group ${g.duplicateGroupId} names candidate ${id}, which is not in the candidate set`);
        return c;
      })
      .sort((a, b) => a.ordinal - b.ordinal || (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
    const schemas = new Set(members.map((m) => `${m.payloadSchemaKey}@${m.payloadSchemaVersion}`));
    const payloads = new Set(members.map((m) => canonicalJson(m.payload)));
    const candidateIds = members.map((m) => m.candidateId);
    if (schemas.size !== 1) return { duplicateGroupId: g.duplicateGroupId, type: "UNCOMPARABLE_DUPLICATE" as const, candidateIds, payloadSchemaKey: null, payloadSchemaVersion: null, distinctPayloadCount: payloads.size };
    const first = members[0] as ConflictCandidateInput;
    return {
      duplicateGroupId: g.duplicateGroupId,
      type: payloads.size === 1 ? ("DUPLICATE_EQUIVALENT" as const) : ("POTENTIAL_CONTENT_CONFLICT" as const),
      candidateIds,
      payloadSchemaKey: first.payloadSchemaKey,
      payloadSchemaVersion: first.payloadSchemaVersion,
      distinctPayloadCount: payloads.size,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Decision shape + workflow graph
// ---------------------------------------------------------------------------------------------------------------

const REVIEW_FIELDS = ["extractionCandidateId", "candidateFingerprint", "decisionType", "matchBasis", "targetEntityId", "matchRunId", "matchAssessmentId", "duplicateGroupId", "comparisonEntityVersionId", "rationale"];
const bad = (m: string) => new DomainError(IMPORT_DECISION_ERROR_CODES.INVALID_INPUT, m);
const present = (v: unknown) => v !== undefined && v !== null;

/** A rationale counts only if it has non-whitespace content; it is otherwise stored exactly as authored. */
export const hasRationale = (r: string | null | undefined): r is string => typeof r === "string" && r.trim().length > 0;

/** Shape checks that depend only on the request (fields a decision type accepts / requires). */
export function validateReviewInputShape(input: ReviewImportCandidateInput): void {
  if (typeof input !== "object" || input === null) throw bad("review input must be an object");
  for (const k of Object.keys(input)) if (!REVIEW_FIELDS.includes(k)) throw bad(`field ${JSON.stringify(k)} is not accepted (there is no generic status setter)`);
  if (typeof input.extractionCandidateId !== "string" || input.extractionCandidateId.length === 0) throw bad("extractionCandidateId is required");
  if (typeof input.candidateFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.candidateFingerprint)) throw bad("candidateFingerprint (the exact fingerprint reviewed) is required");
  if (!(IMPORT_DECISION_TYPES as readonly string[]).includes(input.decisionType)) throw bad(`decisionType must be one of ${IMPORT_DECISION_TYPES.join(", ")}`);
  for (const k of ["targetEntityId", "matchRunId", "matchAssessmentId", "duplicateGroupId", "comparisonEntityVersionId"] as const) {
    if (present(input[k]) && typeof input[k] !== "string") throw bad(`${k} must be an id string`);
  }
  if (present(input.rationale) && (typeof input.rationale !== "string" || input.rationale.length > MAX_IMPORT_DECISION_RATIONALE_LENGTH)) throw bad(`rationale must be a string of at most ${MAX_IMPORT_DECISION_RATIONALE_LENGTH} characters`);
  const type = input.decisionType;
  const target = present(input.targetEntityId);
  if ((TARGET_REQUIRED_DECISION_TYPES as readonly string[]).includes(type) && !target) throw bad(`${type} requires targetEntityId`);
  if (!(TARGET_REQUIRED_DECISION_TYPES as readonly string[]).includes(type) && !(TARGET_OPTIONAL_DECISION_TYPES as readonly string[]).includes(type) && target) throw bad(`${type} must not name a targetEntityId (no Entity is chosen, created or reserved)`);
  if (type === "CLASSIFY_MATCHED") {
    if (!(IMPORT_MATCH_DECISION_BASES as readonly string[]).includes(input.matchBasis as string)) throw bad(`CLASSIFY_MATCHED requires matchBasis: ${IMPORT_MATCH_DECISION_BASES.join(", ")}`);
  } else if (present(input.matchBasis)) throw bad("matchBasis applies only to CLASSIFY_MATCHED");
  if (present(input.matchAssessmentId) && !present(input.matchRunId)) throw bad("matchAssessmentId requires its matchRunId");
  if (present(input.duplicateGroupId) && !present(input.matchRunId)) throw bad("duplicateGroupId requires its matchRunId");
  if (present(input.comparisonEntityVersionId) && !(target && present(input.matchAssessmentId))) throw bad("comparisonEntityVersionId requires targetEntityId and the matchAssessmentId that supplied it");
  if (type === "REJECT" && !hasRationale(input.rationale)) throw bad("REJECT requires a rationale");
}

/** The workflow-graph check: allowed from the current status, and for the Candidate's kind. */
export function ruleFor(type: ImportDecisionType, fromStatus: ExtractionCandidateStatus, kind: ExtractionCandidateKind): ImportDecisionRule {
  const rule = IMPORT_DECISION_RULES[type];
  if (!rule.fromStatuses.includes(fromStatus)) {
    throw new DomainError(IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, `${type} is not allowed from ${fromStatus} (allowed from: ${rule.fromStatuses.join(", ")}); APPROVED and REJECTED are terminal`);
  }
  if (!rule.kinds.includes(kind)) throw new DomainError(IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, `${type} does not apply to ${kind} candidates`);
  return rule;
}

// ---------------------------------------------------------------------------------------------------------------
// Decision fingerprint
// ---------------------------------------------------------------------------------------------------------------

export const IMPORT_DECISION_FINGERPRINT_VERSION = "PROWESS_IMPORT_DECISION_V1";

export interface ImportDecisionFingerprintInput {
  extractionCandidateId: string;
  candidateFingerprint: string;
  candidateSetHash: string;
  sequenceNumber: number;
  fromStatus: ExtractionCandidateStatus;
  decisionType: ImportDecisionType;
  matchBasis: ImportMatchDecisionBasis | null;
  targetEntityId: string | null;
  comparisonEntityVersionId: string | null;
  matchRunId: string | null;
  matchAssessmentId: string | null;
  duplicateGroupId: string | null;
  rationale: string | null;
}

/**
 * `PROWESS_IMPORT_DECISION_V1\n` + canonical JSON of the decision's content AND its position (sequence number, from
 * status). Ids are lowercased; the rationale is included exactly as authored. No database id, no timestamp. An exact
 * retry of a Candidate's latest decision reproduces that decision's fingerprint (and is therefore not duplicated).
 */
export function importDecisionFingerprint(i: ImportDecisionFingerprintInput): string {
  const id = (v: string | null) => (v === null ? null : v.toLowerCase());
  return sha256Hex(
    `${IMPORT_DECISION_FINGERPRINT_VERSION}\n${canonicalJson({
      extractionCandidateId: id(i.extractionCandidateId),
      candidateFingerprint: i.candidateFingerprint,
      candidateSetHash: i.candidateSetHash,
      sequenceNumber: i.sequenceNumber,
      fromStatus: i.fromStatus,
      decisionType: i.decisionType,
      matchBasis: i.matchBasis,
      targetEntityId: id(i.targetEntityId),
      comparisonEntityVersionId: id(i.comparisonEntityVersionId),
      matchRunId: id(i.matchRunId),
      matchAssessmentId: id(i.matchAssessmentId),
      duplicateGroupId: id(i.duplicateGroupId),
      rationale: i.rationale,
    })}`,
  );
}
