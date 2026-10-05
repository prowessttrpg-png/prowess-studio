import {
  CANON_DECISION_ERROR_CODES,
  DomainError,
  isDecidableRuleConflictStatus,
  validateCreateCanonDecisionInput,
  validateListCanonDecisionsFilters,
  type CanonConflictDisposition,
  type CanonDecision,
  type CanonDecisionType,
  type CanonDecisionWithSelections,
  type CreateCanonDecisionInput,
  type ListCanonDecisionsFilters,
} from "@prowess/model";
import { selectCanonPolicyById } from "../canon-policy/repository.js";
import { selectEntityVersionById } from "../entity-version/repository.js";
import { selectRuleConflictById } from "../rule-conflict/repository.js";
import { selectRulesetById } from "../ruleset/repository.js";
import {
  insertCanonDecisionWithTransition,
  isDuplicateSelectionViolation,
  isTransactionConflict,
  isUuid,
  RuleConflictNotDecidableError,
  selectCandidateOwners,
  selectCanonDecisionsByRuleset,
  selectCanonDecisionsForConflict,
  selectCanonDecisionWithSelections,
  violatedDecisionForeignKey,
  type CanonDecisionListWhere,
} from "./repository.js";

/**
 * CanonDecision service (PAS-10 M2-WO6) — immutable, auditable outcomes for RuleConflicts.
 *
 * A decision RECORDS an explicit governance outcome; it never APPLIES one. Nothing here reads or
 * writes a manifest, consults inheritance, resolves source authority, changes an EntityVersion's
 * status, or looks up anything "latest". The only reads of other domains are exact-id existence and
 * ownership lookups (RuleConflict, CanonPolicy, candidates, EntityVersion, Ruleset). The only write
 * to an existing row is the conflict's status moving to the decision's disposition, atomically.
 *
 * The caller states the outcome — type, disposition, selections, rationale. The service never picks
 * a candidate, and a GOVERNING source never outranks anything automatically: the pinned policy is
 * historical context, not a winner engine.
 *
 * Deliberately absent: any update, edit, re-selection, policy swap, delete, or "apply" operation.
 */

const normalizeId = (value: string) => value.trim().toLowerCase();

async function requireConflict(ruleConflictId: string) {
  const conflict = await selectRuleConflictById(normalizeId(ruleConflictId));
  if (conflict === null) {
    throw new DomainError(CANON_DECISION_ERROR_CODES.CONFLICT_NOT_FOUND, `RuleConflict not found: ${ruleConflictId}`);
  }
  return conflict;
}

/**
 * Records the decision for one RuleConflict and, in the same transaction, moves the conflict to
 * `conflictDisposition`. The Ruleset is derived from the conflict.
 *
 * Order — the first failure is reported and NOTHING changes:
 *   0. everything decidable without the database (shape; the type/disposition combination; distinct
 *      selections; the type's selection count; MERGE result present / non-MERGE result absent)
 *                                                               -> INVALID_INPUT
 *   1. the RuleConflict exists                                  -> CONFLICT_NOT_FOUND
 *   2. it is OPEN or UNDER_REVIEW                               -> CONFLICT_ALREADY_DECIDED
 *   3. the CanonPolicy exists                                   -> POLICY_NOT_FOUND
 *   4. it belongs to the conflict's Ruleset                     -> INVALID_POLICY_CONTEXT
 *   5. every selected candidate exists and belongs to the conflict -> INVALID_CANDIDATE
 *   6. a MERGE result exists and is a Version of the conflict's Entity -> INVALID_RESULT_VERSION
 *   7. ONE transaction: conditional status transition, then decision, then selections.
 *
 * Step 0 runs first (a reordering of WO §34's steps 5, 6, 8 and part of 9) because it needs no
 * database and reveals nothing about stored state. Step 2 is an early, friendly check; the
 * conditional UPDATE in step 7 is the authority, so a concurrent decision that wins after step 2
 * still makes this one fail with CONFLICT_ALREADY_DECIDED, with nothing written. The database's
 * composite keys re-check steps 4–6 and map to the same codes.
 */
export async function createCanonDecision(ruleConflictId: string, input: CreateCanonDecisionInput): Promise<CanonDecisionWithSelections> {
  const problem = validateCreateCanonDecisionInput(input);
  if (problem !== null) {
    throw new DomainError(CANON_DECISION_ERROR_CODES.INVALID_INPUT, problem.message);
  }

  const conflict = await requireConflict(ruleConflictId);
  if (!isDecidableRuleConflictStatus(conflict.status)) {
    throw new DomainError(
      CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED,
      `RuleConflict ${conflict.id} is ${conflict.status}; a decided conflict cannot receive another decision`,
    );
  }

  const policy = await selectCanonPolicyById(normalizeId(input.canonPolicyId));
  if (policy === null) {
    throw new DomainError(CANON_DECISION_ERROR_CODES.POLICY_NOT_FOUND, `CanonPolicy not found: ${input.canonPolicyId}`);
  }
  if (policy.rulesetId !== conflict.rulesetId) {
    throw new DomainError(
      CANON_DECISION_ERROR_CODES.INVALID_POLICY_CONTEXT,
      `CanonPolicy ${policy.id} belongs to Ruleset ${policy.rulesetId}, not the conflict's Ruleset ${conflict.rulesetId}`,
    );
  }

  const selected = input.selectedCandidateIds.map(normalizeId);
  const owners = await selectCandidateOwners(selected);
  for (const [index, candidateId] of selected.entries()) {
    const owner = owners.get(candidateId);
    if (owner === undefined) {
      throw new DomainError(CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE, `selectedCandidateIds[${index}]: candidate not found: ${candidateId}`);
    }
    if (owner !== conflict.id) {
      throw new DomainError(
        CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE,
        `selectedCandidateIds[${index}]: candidate ${candidateId} belongs to RuleConflict ${owner}, not ${conflict.id}`,
      );
    }
  }

  let resultEntityVersionId: string | null = null;
  if (input.resultEntityVersionId !== undefined && input.resultEntityVersionId !== null) {
    const result = await selectEntityVersionById(normalizeId(input.resultEntityVersionId));
    if (result === null) {
      throw new DomainError(CANON_DECISION_ERROR_CODES.INVALID_RESULT_VERSION, `Result EntityVersion not found: ${input.resultEntityVersionId}`);
    }
    if (result.entityId !== conflict.entityId) {
      throw new DomainError(
        CANON_DECISION_ERROR_CODES.INVALID_RESULT_VERSION,
        `Result EntityVersion ${result.id} belongs to Entity ${result.entityId}, not the conflict's Entity ${conflict.entityId}`,
      );
    }
    resultEntityVersionId = result.id;
  }

  try {
    return await insertCanonDecisionWithTransition(
      {
        rulesetId: conflict.rulesetId,
        entityId: conflict.entityId,
        ruleConflictId: conflict.id,
        canonPolicyId: policy.id,
        decisionType: input.decisionType as CanonDecisionType, // validated in step 0
        conflictDisposition: input.conflictDisposition as CanonConflictDisposition, // validated in step 0
        resultEntityVersionId,
        rationale: input.rationale.trim(),
      },
      selected,
    );
  } catch (error) {
    throw mapCanonDecisionWriteError(error);
  }
}

/**
 * Translates a rejected decision write into the controlled vocabulary. Reachable only when the
 * database disagrees with the service's checks (a concurrent change); anything else is returned
 * unchanged.
 */
export function mapCanonDecisionWriteError(error: unknown): unknown {
  if (error instanceof RuleConflictNotDecidableError) {
    return new DomainError(
      CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED,
      `RuleConflict ${error.ruleConflictId} was decided by another request first; nothing was written`,
    );
  }
  if (isTransactionConflict(error)) {
    return new DomainError(CANON_DECISION_ERROR_CODES.DECISION_CONFLICT, "A concurrent transaction aborted this decision; nothing was written and it is safe to retry");
  }
  if (isDuplicateSelectionViolation(error)) {
    return new DomainError(CANON_DECISION_ERROR_CODES.INVALID_INPUT, "A candidate may be selected at most once in one decision");
  }
  switch (violatedDecisionForeignKey(error)) {
    case "policy":
      return new DomainError(CANON_DECISION_ERROR_CODES.INVALID_POLICY_CONTEXT, "The CanonPolicy does not exist or belongs to another Ruleset");
    case "selectionCandidate":
      return new DomainError(CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE, "A selected candidate does not exist or belongs to another RuleConflict");
    case "resultVersion":
      return new DomainError(CANON_DECISION_ERROR_CODES.INVALID_RESULT_VERSION, "The result Version does not exist or belongs to another Entity");
    default:
      return error;
  }
}

/** By explicit identity: absence is exceptional (`CANON_DECISION.NOT_FOUND`), including a malformed id. */
export async function getCanonDecision(decisionId: string): Promise<CanonDecisionWithSelections> {
  const decision = await selectCanonDecisionWithSelections(normalizeId(decisionId));
  if (decision === null) {
    throw new DomainError(CANON_DECISION_ERROR_CODES.NOT_FOUND, `CanonDecision not found: ${decisionId}`);
  }
  return decision;
}

/**
 * A conflict's decisions (headers), `created_at ASC, id ASC`. Normal WO6 flow yields at most one —
 * the lifecycle check, not a database constraint, enforces that, so future rollback/supersession can
 * add history. A conflict with none lists as empty; one that does not exist is CONFLICT_NOT_FOUND.
 */
export async function listCanonDecisionsForConflict(ruleConflictId: string): Promise<CanonDecision[]> {
  const conflict = await requireConflict(ruleConflictId);
  return selectCanonDecisionsForConflict(conflict.id);
}

/**
 * A Ruleset's decisions (headers), `created_at ASC, id ASC`, optionally filtered by exact
 * ruleConflictId / canonPolicyId / decisionType / conflictDisposition. A malformed id filter is
 * INVALID_INPUT; a well-formed one that matches nothing simply lists nothing.
 */
export async function listCanonDecisions(rulesetId: string, filters?: ListCanonDecisionsFilters): Promise<CanonDecision[]> {
  const problem = validateListCanonDecisionsFilters(filters);
  if (problem !== null) {
    throw new DomainError(CANON_DECISION_ERROR_CODES.INVALID_INPUT, problem.message);
  }
  const ruleset = await selectRulesetById(rulesetId);
  if (ruleset === null) {
    throw new DomainError(CANON_DECISION_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  }
  const where: CanonDecisionListWhere = {};
  for (const key of ["ruleConflictId", "canonPolicyId"] as const) {
    const value = filters?.[key];
    if (value !== undefined) {
      if (!isUuid(normalizeId(value))) {
        throw new DomainError(CANON_DECISION_ERROR_CODES.INVALID_INPUT, `filters.${key} is not a valid id: ${JSON.stringify(value)}`);
      }
      where[key] = normalizeId(value);
    }
  }
  if (filters?.decisionType !== undefined) where.decisionType = filters.decisionType as CanonDecisionType;
  if (filters?.conflictDisposition !== undefined) where.conflictDisposition = filters.conflictDisposition as CanonConflictDisposition;
  return selectCanonDecisionsByRuleset(ruleset.id, where);
}
