import {
  CHANGE_SET_ERROR_CODES,
  DomainError,
  isValidChangeSetTransition,
  isValidRulesetReviewTransition,
  RULESET_ERROR_CODES,
  type ChangeSet,
  type ChangeSetStatus,
  type Ruleset,
  type RulesetStatus,
} from "@prowess/model";
import { selectChangeSetById } from "../change-set/repository.js";
import { selectRulesetById } from "../ruleset/repository.js";
import { transitionChangeSetStatusAtomic, transitionRulesetStatusAtomic } from "./repository.js";

/**
 * Explicit review transitions (PAS-10 M2-WO8). No generic status setter exists. A transition changes
 * ONLY status — a ChangeSet's name, description, decision link and operations stay frozen. Approving
 * a ChangeSet or a Ruleset never publishes anything: publication is a separate, explicit call.
 * A disallowed transition — or losing a concurrent race — is INVALID_STATUS_TRANSITION.
 */
const normalizeId = (value: string) => value.trim().toLowerCase();

async function transitionChangeSet(changeSetId: string, to: ChangeSetStatus): Promise<ChangeSet> {
  const current = await selectChangeSetById(normalizeId(changeSetId));
  if (current === null) throw new DomainError(CHANGE_SET_ERROR_CODES.NOT_FOUND, `ChangeSet not found: ${changeSetId}`);
  if (!isValidChangeSetTransition(current.status, to)) {
    throw new DomainError(CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION, `Cannot transition ChangeSet ${current.id} from ${current.status} to ${to}`);
  }
  if (!(await transitionChangeSetStatusAtomic(current.id, current.status, to))) {
    throw new DomainError(
      CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `ChangeSet ${current.id}'s status changed concurrently; the transition from ${current.status} is no longer valid`,
    );
  }
  return { ...current, status: to };
}

async function transitionRuleset(rulesetId: string, to: RulesetStatus): Promise<Ruleset> {
  const current = await selectRulesetById(rulesetId);
  if (current === null) throw new DomainError(RULESET_ERROR_CODES.NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  if (!isValidRulesetReviewTransition(current.status, to)) {
    throw new DomainError(RULESET_ERROR_CODES.INVALID_STATUS_TRANSITION, `Cannot transition Ruleset ${current.id} from ${current.status} to ${to}`);
  }
  if (!(await transitionRulesetStatusAtomic(current.id, current.status, to))) {
    throw new DomainError(
      RULESET_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `Ruleset ${current.id}'s status changed concurrently; the transition from ${current.status} is no longer valid`,
    );
  }
  const updated = await selectRulesetById(current.id);
  if (updated === null) throw new DomainError(RULESET_ERROR_CODES.NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  return updated;
}

/** DRAFT -> READY_FOR_REVIEW. */
export const submitChangeSetForReview = (changeSetId: string) => transitionChangeSet(changeSetId, "READY_FOR_REVIEW");
/** READY_FOR_REVIEW -> APPROVED. Freezes the exact proposal for publication; publishes nothing. */
export const approveChangeSet = (changeSetId: string) => transitionChangeSet(changeSetId, "APPROVED");
/** READY_FOR_REVIEW -> REJECTED (terminal). */
export const rejectChangeSet = (changeSetId: string) => transitionChangeSet(changeSetId, "REJECTED");
/** DRAFT -> IN_REVIEW. */
export const submitRulesetForReview = (rulesetId: string) => transitionRuleset(rulesetId, "IN_REVIEW");
/** IN_REVIEW -> APPROVED. Makes the Ruleset publishable; publishes nothing. APPROVED -> PUBLISHED happens only in publication. */
export const approveRuleset = (rulesetId: string) => transitionRuleset(rulesetId, "APPROVED");
