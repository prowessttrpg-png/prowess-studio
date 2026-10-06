/**
 * Lifecycle vocabulary of a ChangeSet (PAS-10 M2-WO7 §3).
 *
 *   DRAFT             proposed; not yet submitted for review
 *   READY_FOR_REVIEW  submitted for governance review
 *   APPROVED          approved for publishing
 *   REJECTED          not to be published
 *   SUPERSEDED        replaced by a later ChangeSet
 *
 * M2-WO7 creates every ChangeSet DRAFT and exposes NO transition: the remaining values establish
 * the lifecycle shape for the review/publishing workflow (M2-WO8). To revise a proposal, create
 * another ChangeSet. Kept in lockstep with the Prisma `ChangeSetStatus` enum (static audit).
 */
export const CHANGE_SET_STATUSES = ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"] as const;

export type ChangeSetStatus = (typeof CHANGE_SET_STATUSES)[number];

/** The only status a ChangeSet can be created with in M2-WO7 — never caller-supplied. */
export const INITIAL_CHANGE_SET_STATUS = "DRAFT" satisfies ChangeSetStatus;

export function isChangeSetStatus(value: string): value is ChangeSetStatus {
  return (CHANGE_SET_STATUSES as readonly string[]).includes(value);
}
