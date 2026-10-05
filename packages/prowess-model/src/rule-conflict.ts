import type { EntityId, EntityVersionId, RuleConflictCandidateId, RuleConflictId, RulesetId, SourceReferenceId } from "./ids.js";
import { isRuleConflictSeverity, type RuleConflictSeverity } from "./rule-conflict-severity.js";
import { isRuleConflictStatus, type RuleConflictStatus } from "./rule-conflict-status.js";
import { isRuleConflictType, type RuleConflictType } from "./rule-conflict-type.js";

/**
 * A RuleConflict — an explicit, historically reproducible record that two or more
 * exact historical rule representations disagree, or otherwise need human governance
 * attention (PAS-10 M2-WO5).
 *
 * ```
 * Ruleset
 *   └── RuleConflict            (one Ruleset, one stable Entity)
 *         ├── Candidate A  →  Entity Revision 2  →  SourceReference A (optional)
 *         └── Candidate B  →  Entity Revision 3  →  SourceReference B (optional)
 * ```
 *
 * It means "there is a known disagreement that requires explicit review". It does NOT
 * resolve anything: no candidate is selected, no manifest or inheritance result changes,
 * no EntityVersion status changes, no source authority changes, nothing becomes Canon,
 * and no mechanic changes. There is deliberately no winner, resolution, or decision
 * field — those belong to M2-WO6's CanonDecision, which will record the outcome (and the
 * exact CanonPolicy snapshot it relied on) separately.
 *
 * Scope:
 *  - Ruleset-scoped: the same EntityVersions may conflict in Ruleset A and not in B.
 *    There is no global conflict state.
 *  - Single-Entity: every candidate is a Version of `entityId`. Cross-Entity structural
 *    conflicts are out of scope until designed explicitly.
 *  - Not tied to a CanonPolicy: a conflict exists before review; the policy snapshot
 *    that informs a decision is recorded by that decision.
 */
export interface RuleConflict {
  id: RuleConflictId;
  rulesetId: RulesetId;
  entityId: EntityId;
  conflictType: RuleConflictType;
  severity: RuleConflictSeverity;
  /** Always `OPEN` in M2-WO5: nothing can change it yet (M2-WO6 owns transitions). */
  status: RuleConflictStatus;
  title: string;
  description: string | null;
  createdAt: Date;
}

/**
 * One exact historical EntityVersion participating in a conflict.
 *
 * `entityVersionId` is an exact Version id — never "latest", "CANON", "highest
 * revision" or "current" — so the conflict stays reproducible: a later revision is
 * never silently added. `sourceReferenceId`, when present, is provenance evidence that
 * belongs to THIS Version. `label` and `positionSummary` are editorial review aids
 * ("Older AP interpretation"), never authoritative mechanics.
 *
 * Authority is deliberately not copied here: a candidate supported by a GOVERNING
 * source does not outrank one supported by REFERENCE_ONLY. Inspect authority through
 * the CanonPolicy operations when needed.
 */
export interface RuleConflictCandidate {
  id: RuleConflictCandidateId;
  ruleConflictId: RuleConflictId;
  entityVersionId: EntityVersionId;
  sourceReferenceId: SourceReferenceId | null;
  label: string | null;
  positionSummary: string | null;
  createdAt: Date;
}

/**
 * A conflict with its candidates, ordered by the candidate Version's `revisionNumber`
 * ascending, then candidate id — deterministic, independent of input order, and never
 * a ranking. (Within one conflict every Version belongs to one Entity, so revision
 * numbers are already distinct; the id is a defensive tiebreak.)
 */
export interface RuleConflictWithCandidates extends RuleConflict {
  candidates: RuleConflictCandidate[];
}

export interface CreateRuleConflictCandidateInput {
  entityVersionId: string;
  sourceReferenceId?: string | null;
  label?: string | null;
  positionSummary?: string | null;
}

/**
 * What a caller may supply. There is intentionally NO `status` (always OPEN) and no
 * winner / resolution / decision field of any kind.
 */
export interface CreateRuleConflictInput {
  entityId: string;
  conflictType: string;
  severity: string;
  title: string;
  description?: string | null;
  candidates: CreateRuleConflictCandidateInput[];
}

/** Optional, simple equality filters for listing a Ruleset's conflicts. No full-text search. */
export interface ListRuleConflictsFilters {
  entityId?: string;
  status?: string;
  severity?: string;
  conflictType?: string;
}

/** Fewer than this many candidates represents no disagreement. */
export const MIN_RULE_CONFLICT_CANDIDATES = 2;
/**
 * A documented upper bound so one request cannot create a pathological conflict. A
 * single-Entity disagreement among more than 25 distinct revisions is not a meaningful
 * review unit (split it); the bound also caps the per-request existence lookups.
 */
export const MAX_RULE_CONFLICT_CANDIDATES = 25;
export const MAX_RULE_CONFLICT_TITLE_LENGTH = 200;
export const MAX_RULE_CONFLICT_DESCRIPTION_LENGTH = 4000;
export const MAX_RULE_CONFLICT_CANDIDATE_LABEL_LENGTH = 200;
export const MAX_RULE_CONFLICT_POSITION_SUMMARY_LENGTH = 2000;

export interface RuleConflictInputProblem {
  kind: "INVALID_INPUT" | "INSUFFICIENT_CANDIDATES" | "DUPLICATE_CANDIDATE";
  message: string;
}

const normalizeId = (value: string) => value.trim().toLowerCase();
const isBlank = (value: unknown) => typeof value !== "string" || value.trim().length === 0;

function optionalText(value: unknown, field: string, max: number): RuleConflictInputProblem | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return { kind: "INVALID_INPUT", message: `${field}, when supplied, must be a string` };
  }
  if (value.length > max) {
    return { kind: "INVALID_INPUT", message: `${field} must be at most ${max} characters` };
  }
  return null;
}

/**
 * Pure, shape-only validation; returns the first problem found, or `null`.
 *
 * Order: conflict fields, then candidate count (fewer than two is
 * INSUFFICIENT_CANDIDATES; more than the cap is INVALID_INPUT), then each candidate's
 * shape in input order, then duplicates — the same EntityVersion twice, ids compared
 * case-insensitively. Whether the Ruleset, Entity, Versions and SourceReferences exist,
 * and whether they belong together, are persistence questions for the service.
 */
export function validateCreateRuleConflictInput(input: CreateRuleConflictInput): RuleConflictInputProblem | null {
  if (typeof input !== "object" || input === null) {
    return { kind: "INVALID_INPUT", message: "input must be an object" };
  }
  if (isBlank(input.entityId)) {
    return { kind: "INVALID_INPUT", message: "entityId is required" };
  }
  if (typeof input.conflictType !== "string" || !isRuleConflictType(input.conflictType)) {
    return { kind: "INVALID_INPUT", message: `conflictType is not a recognized RuleConflictType: ${JSON.stringify(input.conflictType)}` };
  }
  if (typeof input.severity !== "string" || !isRuleConflictSeverity(input.severity)) {
    return { kind: "INVALID_INPUT", message: `severity is not a recognized RuleConflictSeverity: ${JSON.stringify(input.severity)}` };
  }
  if (isBlank(input.title)) {
    return { kind: "INVALID_INPUT", message: "title is required and must not be empty" };
  }
  if (input.title.trim().length > MAX_RULE_CONFLICT_TITLE_LENGTH) {
    return { kind: "INVALID_INPUT", message: `title must be at most ${MAX_RULE_CONFLICT_TITLE_LENGTH} characters` };
  }
  const description = optionalText(input.description, "description", MAX_RULE_CONFLICT_DESCRIPTION_LENGTH);
  if (description !== null) {
    return description;
  }
  if (!Array.isArray(input.candidates)) {
    return { kind: "INVALID_INPUT", message: "candidates is required and must be an array" };
  }
  if (input.candidates.length < MIN_RULE_CONFLICT_CANDIDATES) {
    return {
      kind: "INSUFFICIENT_CANDIDATES",
      message: `a conflict needs at least ${MIN_RULE_CONFLICT_CANDIDATES} candidates (got ${input.candidates.length}); with fewer there is no represented disagreement`,
    };
  }
  if (input.candidates.length > MAX_RULE_CONFLICT_CANDIDATES) {
    return { kind: "INVALID_INPUT", message: `a conflict may have at most ${MAX_RULE_CONFLICT_CANDIDATES} candidates` };
  }

  for (const [index, candidate] of input.candidates.entries()) {
    if (typeof candidate !== "object" || candidate === null) {
      return { kind: "INVALID_INPUT", message: `candidates[${index}] must be an object` };
    }
    if (isBlank(candidate.entityVersionId)) {
      return { kind: "INVALID_INPUT", message: `candidates[${index}].entityVersionId is required` };
    }
    if (candidate.sourceReferenceId !== undefined && candidate.sourceReferenceId !== null && isBlank(candidate.sourceReferenceId)) {
      return { kind: "INVALID_INPUT", message: `candidates[${index}].sourceReferenceId, when supplied, must be a non-empty string` };
    }
    const problem =
      optionalText(candidate.label, `candidates[${index}].label`, MAX_RULE_CONFLICT_CANDIDATE_LABEL_LENGTH) ??
      optionalText(candidate.positionSummary, `candidates[${index}].positionSummary`, MAX_RULE_CONFLICT_POSITION_SUMMARY_LENGTH);
    if (problem !== null) {
      return problem;
    }
  }

  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    const key = normalizeId(candidate.entityVersionId);
    if (seen.has(key)) {
      return { kind: "DUPLICATE_CANDIDATE", message: `EntityVersion ${candidate.entityVersionId} appears more than once in one conflict` };
    }
    seen.add(key);
  }
  return null;
}

/**
 * Shape-only validation of listing filters: each, when supplied, must be a recognized
 * value of its vocabulary (or a non-empty id). Returns the first problem, or `null`.
 */
export function validateListRuleConflictsFilters(filters: ListRuleConflictsFilters | undefined): RuleConflictInputProblem | null {
  if (filters === undefined) {
    return null;
  }
  if (typeof filters !== "object" || filters === null) {
    return { kind: "INVALID_INPUT", message: "filters, when supplied, must be an object" };
  }
  if (filters.entityId !== undefined && isBlank(filters.entityId)) {
    return { kind: "INVALID_INPUT", message: "filters.entityId, when supplied, must be a non-empty string" };
  }
  const checks: Array<[string, unknown, (v: string) => boolean]> = [
    ["status", filters.status, isRuleConflictStatus],
    ["severity", filters.severity, isRuleConflictSeverity],
    ["conflictType", filters.conflictType, isRuleConflictType],
  ];
  for (const [name, value, accepts] of checks) {
    if (value !== undefined && (typeof value !== "string" || !accepts(value))) {
      return { kind: "INVALID_INPUT", message: `filters.${name} is not a recognized value: ${JSON.stringify(value)}` };
    }
  }
  return null;
}
