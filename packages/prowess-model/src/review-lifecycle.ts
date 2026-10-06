import type { ChangeSetStatus } from "./change-set-status.js";
import type { RulesetStatus } from "./ruleset-status.js";

/**
 * Review lifecycles introduced by PAS-10 M2-WO8. Each is a small, explicit graph; no generic status
 * setter exists, and every write is an expected-state conditional update.
 *
 * ChangeSet:  DRAFT -> READY_FOR_REVIEW -> APPROVED | REJECTED
 *   APPROVED and REJECTED are terminal here; SUPERSEDED stays vocabulary only (no workflow yet).
 *   A transition changes ONLY the status — the proposal's content stays frozen.
 *
 * Ruleset:    DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED (-> PUBLISHED for later releases)
 *   APPROVED -> PUBLISHED happens ONLY inside publication. DEPRECATED / ARCHIVED stay reserved.
 */
export const CHANGE_SET_TRANSITIONS: Readonly<Record<ChangeSetStatus, readonly ChangeSetStatus[]>> = {
  DRAFT: ["READY_FOR_REVIEW"],
  READY_FOR_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  SUPERSEDED: [],
};

export function isValidChangeSetTransition(from: ChangeSetStatus, to: ChangeSetStatus): boolean {
  return CHANGE_SET_TRANSITIONS[from].includes(to);
}

/** Review transitions a caller may request directly. APPROVED -> PUBLISHED is publication-only. */
export const RULESET_REVIEW_TRANSITIONS: Readonly<Record<RulesetStatus, readonly RulesetStatus[]>> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["APPROVED"],
  APPROVED: [],
  PUBLISHED: [],
  DEPRECATED: [],
  ARCHIVED: [],
};

export function isValidRulesetReviewTransition(from: RulesetStatus, to: RulesetStatus): boolean {
  return RULESET_REVIEW_TRANSITIONS[from].includes(to);
}

/** Statuses from which `publishRulesetRelease` may publish. The first publication moves APPROVED -> PUBLISHED. */
export const PUBLISHABLE_RULESET_STATUSES = ["APPROVED", "PUBLISHED"] as const satisfies readonly RulesetStatus[];

export function isPublishableRulesetStatus(status: RulesetStatus): boolean {
  return (PUBLISHABLE_RULESET_STATUSES as readonly string[]).includes(status);
}
