import { isCanonConflictDisposition, type CanonConflictDisposition } from "./canon-conflict-disposition.js";
import { isCanonDecisionType, type CanonDecisionType } from "./canon-decision-type.js";
import type {
  CanonDecisionId,
  CanonDecisionSelectionId,
  CanonPolicyId,
  EntityVersionId,
  RuleConflictCandidateId,
  RuleConflictId,
  RulesetId,
} from "./ids.js";

/**
 * A CanonDecision — an immutable, auditable record of the explicit governance outcome of ONE
 * RuleConflict (PAS-10 M2-WO6).
 *
 * ```
 * RuleConflict
 *    ├── Candidate A
 *    └── Candidate B
 *           ↓
 * CanonDecision
 *    ├── CanonPolicy P1          (the exact authority snapshot it was decided under)
 *    ├── Type: SELECT_RULE
 *    ├── Selected: Candidate A
 *    └── Disposition: RESOLVED   (the conflict's new terminal status)
 * ```
 *
 * It records WHAT was decided, against WHICH exact conflict, under WHICH exact policy snapshot,
 * with WHICH exact candidates, and WHY. It does NOT apply the decision: no manifest, inheritance
 * result, EntityVersion status, or policy changes. Applying a governance outcome to a Ruleset's
 * composition belongs to later ChangeSet / publishing work. The one side effect of creating a
 * decision is the conflict's status moving to `conflictDisposition`, in the same transaction.
 *
 * Immutable: there is no update, edit, re-selection, policy swap, or delete. A later reversal or
 * supersession must be another explicit governance record (a future work order).
 */
export interface CanonDecision {
  id: CanonDecisionId;
  /** Always the conflict's Ruleset (derived, never supplied); the policy shares it too. */
  rulesetId: RulesetId;
  ruleConflictId: RuleConflictId;
  /** The exact policy snapshot — never "latest", "current" or "active". */
  canonPolicyId: CanonPolicyId;
  decisionType: CanonDecisionType;
  conflictDisposition: CanonConflictDisposition;
  /** MERGE only: the existing EntityVersion (of the conflict's Entity) the positions were reconciled into. */
  resultEntityVersionId: EntityVersionId | null;
  /** Why the decision was made. Required, human-written; never derived from source authority. */
  rationale: string;
  createdAt: Date;
}

/** One exact conflict candidate the decision selected (or, for MERGE / KEEP_SEPARATE, retained). */
export interface CanonDecisionSelection {
  id: CanonDecisionSelectionId;
  canonDecisionId: CanonDecisionId;
  ruleConflictCandidateId: RuleConflictCandidateId;
  createdAt: Date;
}

/**
 * A decision with its selections, ordered by the selected candidate's EntityVersion
 * `revisionNumber` ASC, then selection id — a display order, never a ranking.
 */
export interface CanonDecisionWithSelections extends CanonDecision {
  selections: CanonDecisionSelection[];
}

/**
 * What a caller supplies. The RuleConflict is the operation's subject (its first argument), and
 * the Ruleset is derived from it. There is no field for a winner flag, an applied manifest, or an
 * automatic choice: the caller states the outcome explicitly.
 */
export interface CreateCanonDecisionInput {
  canonPolicyId: string;
  decisionType: string;
  conflictDisposition: string;
  selectedCandidateIds: string[];
  resultEntityVersionId?: string | null;
  rationale: string;
}

/** Optional, simple equality filters for listing a Ruleset's decisions. No full-text search. */
export interface ListCanonDecisionsFilters {
  ruleConflictId?: string;
  decisionType?: string;
  conflictDisposition?: string;
  canonPolicyId?: string;
}

export const MAX_CANON_DECISION_RATIONALE_LENGTH = 8000;

/**
 * The type/disposition/selection rules (§16–§20), as data so they are documented in one place.
 * `maxSelections: null` = no upper bound beyond the conflict's own candidates.
 */
export const CANON_DECISION_RULES = {
  SELECT_RULE: { dispositions: ["RESOLVED"], minSelections: 1, maxSelections: 1, resultVersion: "forbidden" },
  KEEP_SEPARATE: { dispositions: ["ACCEPTED_DIVERGENCE"], minSelections: 2, maxSelections: null, resultVersion: "forbidden" },
  MERGE: { dispositions: ["RESOLVED"], minSelections: 2, maxSelections: null, resultVersion: "required" },
  RESOLVE_CONFLICT: { dispositions: ["RESOLVED", "DISMISSED"], minSelections: 0, maxSelections: null, resultVersion: "forbidden" },
} as const satisfies Record<
  CanonDecisionType,
  {
    dispositions: readonly CanonConflictDisposition[];
    minSelections: number;
    maxSelections: number | null;
    resultVersion: "required" | "forbidden";
  }
>;

export interface CanonDecisionInputProblem {
  kind: "INVALID_INPUT";
  message: string;
}

const normalizeId = (value: string) => value.trim().toLowerCase();
const isBlank = (value: unknown) => typeof value !== "string" || value.trim().length === 0;
const invalid = (message: string): CanonDecisionInputProblem => ({ kind: "INVALID_INPUT", message });

/**
 * Pure validation; returns the first problem found, or `null`. Everything here is decidable
 * without the database:
 *
 *   1. shape: policy id, type, disposition, selections array of non-empty strings, rationale
 *   2. the type/disposition combination (§16–§20)
 *   3. selections are distinct (ids compared case-insensitively) (§15)
 *   4. the type's selection count (§16, §17, §19, §20)
 *   5. the MERGE result: required for MERGE, forbidden for every other type (§18)
 *
 * Whether the conflict, policy, candidates and result Version exist and belong together is a
 * persistence question for the service.
 */
export function validateCreateCanonDecisionInput(input: CreateCanonDecisionInput): CanonDecisionInputProblem | null {
  if (typeof input !== "object" || input === null) {
    return invalid("input must be an object");
  }
  if (isBlank(input.canonPolicyId)) {
    return invalid("canonPolicyId is required: a decision always pins one exact CanonPolicy snapshot");
  }
  if (typeof input.decisionType !== "string" || !isCanonDecisionType(input.decisionType)) {
    return invalid(`decisionType is not a supported CanonDecisionType: ${JSON.stringify(input.decisionType)}`);
  }
  if (typeof input.conflictDisposition !== "string" || !isCanonConflictDisposition(input.conflictDisposition)) {
    return invalid(`conflictDisposition is not a recognized CanonConflictDisposition: ${JSON.stringify(input.conflictDisposition)}`);
  }
  if (!Array.isArray(input.selectedCandidateIds)) {
    return invalid("selectedCandidateIds is required and must be an array (it may be empty for RESOLVE_CONFLICT)");
  }
  for (const [index, id] of input.selectedCandidateIds.entries()) {
    if (isBlank(id)) {
      return invalid(`selectedCandidateIds[${index}] must be a non-empty string`);
    }
  }
  if (input.resultEntityVersionId !== undefined && input.resultEntityVersionId !== null && isBlank(input.resultEntityVersionId)) {
    return invalid("resultEntityVersionId, when supplied, must be a non-empty string");
  }
  if (isBlank(input.rationale)) {
    return invalid("rationale is required: every decision must say why it was made");
  }
  if (input.rationale.length > MAX_CANON_DECISION_RATIONALE_LENGTH) {
    return invalid(`rationale must be at most ${MAX_CANON_DECISION_RATIONALE_LENGTH} characters`);
  }

  const type = input.decisionType;
  const rules = CANON_DECISION_RULES[type];
  if (!(rules.dispositions as readonly string[]).includes(input.conflictDisposition)) {
    return invalid(`${type} requires conflictDisposition ${rules.dispositions.join(" or ")} (got ${input.conflictDisposition})`);
  }

  const seen = new Set<string>();
  for (const id of input.selectedCandidateIds) {
    const key = normalizeId(id);
    if (seen.has(key)) {
      return invalid(`candidate ${id} is selected more than once`);
    }
    seen.add(key);
  }

  const count = input.selectedCandidateIds.length;
  if (count < rules.minSelections || (rules.maxSelections !== null && count > rules.maxSelections)) {
    const expected =
      rules.maxSelections === rules.minSelections ? `exactly ${rules.minSelections}` : `at least ${rules.minSelections}`;
    return invalid(`${type} requires ${expected} selected candidate(s) (got ${count})`);
  }

  const hasResult = input.resultEntityVersionId !== undefined && input.resultEntityVersionId !== null;
  if (rules.resultVersion === "required" && !hasResult) {
    return invalid(`${type} requires resultEntityVersionId: the existing EntityVersion the positions were reconciled into`);
  }
  if (rules.resultVersion === "forbidden" && hasResult) {
    return invalid(`resultEntityVersionId is only meaningful for MERGE (got it with ${type})`);
  }
  return null;
}

/** Shape-only validation of listing filters. Returns the first problem, or `null`. */
export function validateListCanonDecisionsFilters(filters: ListCanonDecisionsFilters | undefined): CanonDecisionInputProblem | null {
  if (filters === undefined) {
    return null;
  }
  if (typeof filters !== "object" || filters === null) {
    return invalid("filters, when supplied, must be an object");
  }
  for (const key of ["ruleConflictId", "canonPolicyId"] as const) {
    if (filters[key] !== undefined && isBlank(filters[key])) {
      return invalid(`filters.${key}, when supplied, must be a non-empty string`);
    }
  }
  if (filters.decisionType !== undefined && (typeof filters.decisionType !== "string" || !isCanonDecisionType(filters.decisionType))) {
    return invalid(`filters.decisionType is not a recognized value: ${JSON.stringify(filters.decisionType)}`);
  }
  if (
    filters.conflictDisposition !== undefined &&
    (typeof filters.conflictDisposition !== "string" || !isCanonConflictDisposition(filters.conflictDisposition))
  ) {
    return invalid(`filters.conflictDisposition is not a recognized value: ${JSON.stringify(filters.conflictDisposition)}`);
  }
  return null;
}
