import {
  DomainError,
  ENTITY_ERROR_CODES,
  isRelationshipType,
  RELATIONSHIP_ERROR_CODES,
  type CreateEntityRelationshipInput,
  type EntityRelationship,
  type RelationshipType,
  type RelationshipErrorCode,
} from "@prowess/model";
import { getEntityById } from "../entity/service.js";
import {
  deleteEntityRelationship,
  insertEntityRelationship,
  isRelationshipUniqueConstraintViolation,
  selectEntityRelationshipById,
  selectIncomingRelationships,
  selectOutgoingRelationships,
  type RelationshipWithCounterpart,
} from "./repository.js";

/**
 * EntityRelationship service — the application/domain boundary for
 * EntityRelationship operations (PAS-10 M1-WO6 §13), mirroring every other
 * service's layering in this package:
 *
 *   domain (callers) -> this service -> repository.ts (Prisma only) -> Prisma / PostgreSQL
 */

/**
 * Creates a new directed EntityRelationship.
 *
 * Validates, before anything reaches Prisma, in this order:
 *   1. `sourceEntityId !== targetEntityId` — `RELATIONSHIP.SELF_REFERENCE`
 *      if equal. Checked first since it's a pure input-shape check,
 *      independent of database state.
 *   2. `relationshipType` is a recognized `RelationshipType` —
 *      `RELATIONSHIP.INVALID_TYPE` otherwise.
 *   3. the source Entity exists — `RELATIONSHIP.INVALID_SOURCE` otherwise
 *      (NOT the generic `ENTITY.NOT_FOUND`: the caller needs to know
 *      *which side* of the relationship is invalid without inspecting the
 *      relationship's own fields).
 *   4. the target Entity exists — `RELATIONSHIP.INVALID_TARGET` otherwise,
 *      same reasoning.
 *
 * Throws `RELATIONSHIP.DUPLICATE` if the exact
 * `(sourceEntityId, targetEntityId, relationshipType)` triple already
 * exists. Creates exactly one row — never an automatic inverse
 * relationship (no `targetEntityId REQUIRED_BY sourceEntityId` is ever
 * created as a side effect).
 */
export async function createEntityRelationship(
  input: CreateEntityRelationshipInput,
): Promise<EntityRelationship> {
  if (input.sourceEntityId === input.targetEntityId) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.SELF_REFERENCE,
      `sourceEntityId and targetEntityId must not be the same: ${input.sourceEntityId}`,
    );
  }

  if (!isRelationshipType(input.relationshipType)) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.INVALID_TYPE,
      `Not a recognized RelationshipType: ${JSON.stringify(input.relationshipType)}`,
    );
  }

  await assertEntityExists(input.sourceEntityId, RELATIONSHIP_ERROR_CODES.INVALID_SOURCE, "Source");
  await assertEntityExists(input.targetEntityId, RELATIONSHIP_ERROR_CODES.INVALID_TARGET, "Target");

  const relationshipType: RelationshipType = input.relationshipType;

  try {
    return await insertEntityRelationship({
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      relationshipType,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    if (isRelationshipUniqueConstraintViolation(error)) {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.DUPLICATE,
        `A ${relationshipType} relationship from ${input.sourceEntityId} to ${input.targetEntityId} already exists`,
      );
    }
    throw error;
  }
}

/** Retrieves an EntityRelationship by its explicit UUID identity. */
export async function getEntityRelationship(id: string): Promise<EntityRelationship> {
  const relationship = await selectEntityRelationshipById(id);
  if (!relationship) {
    throw new DomainError(RELATIONSHIP_ERROR_CODES.NOT_FOUND, `EntityRelationship not found: ${id}`);
  }
  return relationship;
}

/**
 * This Entity's outgoing relationships (where it is the stated SOURCE),
 * each paired with the target Entity's stable identity. Returns an empty
 * array, not an error, for an Entity with none — a search-style lookup
 * (PAS-10 M1-WO6 §16).
 */
export async function getOutgoingRelationships(
  entityId: string,
): Promise<RelationshipWithCounterpart[]> {
  return selectOutgoingRelationships(entityId);
}

/**
 * This Entity's incoming relationships (where it is the stated TARGET),
 * each paired with the source Entity's stable identity. Same
 * empty-is-not-an-error reasoning as outgoing above. Never automatically
 * populated by an outgoing relationship on the other side — only a
 * relationship deliberately authored with this Entity as the target
 * appears here.
 */
export async function getIncomingRelationships(
  entityId: string,
): Promise<RelationshipWithCounterpart[]> {
  return selectIncomingRelationships(entityId);
}

/**
 * Removes an EntityRelationship. Throws `RELATIONSHIP.NOT_FOUND` if no
 * relationship exists with that id. Removes only the relationship row —
 * never the source Entity, target Entity, any EntityVersion, alias, or
 * Keyword assignment.
 */
export async function removeEntityRelationship(id: string): Promise<void> {
  const deleted = await deleteEntityRelationship(id);
  if (!deleted) {
    throw new DomainError(RELATIONSHIP_ERROR_CODES.NOT_FOUND, `EntityRelationship not found: ${id}`);
  }
}

async function assertEntityExists(
  entityId: string,
  errorCode: RelationshipErrorCode,
  label: "Source" | "Target",
): Promise<void> {
  try {
    await getEntityById(entityId);
  } catch (error) {
    if (error instanceof DomainError && error.code === ENTITY_ERROR_CODES.NOT_FOUND) {
      throw new DomainError(errorCode, `${label} Entity not found: ${entityId}`);
    }
    throw error;
  }
}
