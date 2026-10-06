/**
 * What one ChangeSetOperation proposes (PAS-10 M2-WO7 §7). PROPOSALS ONLY: nothing here is ever
 * executed by M2-WO7.
 *
 *   PIN_ENTITY_VERSION           a future manifest pins the Entity to this exact Version
 *   REPLACE_ENTITY_VERSION       a future manifest switches the Entity from one exact Version to another
 *   ADD_ENTITY_TO_MANIFEST       a future manifest introduces a pin where none exists
 *   REMOVE_ENTITY_FROM_MANIFEST  a future manifest omits the Entity
 *   CREATE_ENTITY_VERSION        a new revision needs to be authored (it does not exist yet)
 *   DEPRECATE_ENTITY_VERSION     a Version should later receive deprecation / lifecycle treatment
 *   NO_CHANGE                    the governance outcome needs no repository/ruleset change
 *
 * Kept in lockstep with the Prisma `ChangeSetOperationType` enum (static audit).
 */
export const CHANGE_SET_OPERATION_TYPES = [
  "PIN_ENTITY_VERSION",
  "REPLACE_ENTITY_VERSION",
  "ADD_ENTITY_TO_MANIFEST",
  "REMOVE_ENTITY_FROM_MANIFEST",
  "CREATE_ENTITY_VERSION",
  "DEPRECATE_ENTITY_VERSION",
  "NO_CHANGE",
] as const;

export type ChangeSetOperationType = (typeof CHANGE_SET_OPERATION_TYPES)[number];

export function isChangeSetOperationType(value: string): value is ChangeSetOperationType {
  return (CHANGE_SET_OPERATION_TYPES as readonly string[]).includes(value);
}

/** Operations that propose a FUTURE MANIFEST'S composition for an Entity: at most one per Entity per ChangeSet. */
export const MANIFEST_COMPOSITION_OPERATION_TYPES = [
  "PIN_ENTITY_VERSION",
  "REPLACE_ENTITY_VERSION",
  "ADD_ENTITY_TO_MANIFEST",
  "REMOVE_ENTITY_FROM_MANIFEST",
] as const satisfies readonly ChangeSetOperationType[];

export function isManifestCompositionOperation(type: ChangeSetOperationType): boolean {
  return (MANIFEST_COMPOSITION_OPERATION_TYPES as readonly string[]).includes(type);
}
