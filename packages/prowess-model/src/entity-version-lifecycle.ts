import type { EntityVersionStatus } from "./status.js";

/**
 * The Phase 1 EntityVersion lifecycle transition graph (PAS-10 M1-WO3
 * §10) — the ONE authoritative location for which status transitions are
 * allowed. Tests, the `@prowess/db` service layer, and any future UI must
 * all consult this map rather than duplicating the graph independently.
 *
 * This is a lifecycle-CONTROL graph only. It says nothing about Ruleset
 * publication, Canon Authority, ChangeSets, permissions, or release
 * management — those belong to M2/PAS-08. In particular, reaching `CANON`
 * here means only that this Version has reached the CANON lifecycle
 * state; it does NOT mean this Version is globally "the active Prowess
 * rule." Which exact EntityVersion is authoritative within a given
 * Ruleset is a question later M2 Ruleset Manifests answer — never a field
 * on EntityVersion itself (no `is_current`, `is_active_rule`, or
 * `current_version_id` exists or should ever be added here).
 *
 * Every `EntityVersionStatus` value has an entry, even `ARCHIVED` (an
 * empty array — terminal, no outgoing transitions) — see this module's
 * own test for a completeness check that guards against a future status
 * value being added to `ENTITY_VERSION_STATUSES` without a corresponding
 * entry here.
 */
export const ENTITY_VERSION_TRANSITIONS: Readonly<
  Record<EntityVersionStatus, readonly EntityVersionStatus[]>
> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  // IN_REVIEW -> DRAFT is how review feedback returns an existing working
  // revision to an editable state. Once APPROVED is reached, there is no
  // path back to DRAFT — a new EntityVersion is how the architecture
  // expects post-approval mechanical changes to happen instead.
  IN_REVIEW: ["DRAFT", "APPROVED", "ARCHIVED"],
  APPROVED: ["PLAYTEST", "DEPRECATED", "ARCHIVED"],
  PLAYTEST: ["CANON", "SUPERSEDED", "DEPRECATED"],
  CANON: ["SUPERSEDED", "DEPRECATED"],
  SUPERSEDED: ["ARCHIVED"],
  DEPRECATED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Whether transitioning from `from` to `to` is represented in the lifecycle graph. */
export function isValidEntityVersionTransition(
  from: EntityVersionStatus,
  to: EntityVersionStatus,
): boolean {
  return ENTITY_VERSION_TRANSITIONS[from].includes(to);
}

/**
 * Phase 1 mutation policy (PAS-10 M1-WO3 §1): only `DRAFT` content may be
 * edited in place. Every other status — including `ARCHIVED`, which has no
 * further lifecycle transitions at all — is content-protected. Centralized
 * here (rather than scattered `=== "DRAFT"` checks) so the one rule has one
 * home, same as the transition graph above.
 */
export function canMutateEntityVersionContent(status: EntityVersionStatus): boolean {
  return status === "DRAFT";
}
