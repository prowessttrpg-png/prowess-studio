/**
 * EntityVersion lifecycle statuses.
 *
 * Defined here as a shared type only. The mutation rules attached to each
 * status (which may be edited in place vs. which require a new Version) are
 * enforced by the domain/service layer starting in M1-WO3 — this module
 * makes no persistence or enforcement claims.
 */
export const ENTITY_VERSION_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PLAYTEST",
  "CANON",
  "DEPRECATED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;

export type EntityVersionStatus = (typeof ENTITY_VERSION_STATUSES)[number];

export function isEntityVersionStatus(value: string): value is EntityVersionStatus {
  return (ENTITY_VERSION_STATUSES as readonly string[]).includes(value);
}
