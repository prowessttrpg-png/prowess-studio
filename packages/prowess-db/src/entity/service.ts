import {
  DomainError,
  ENTITY_ERROR_CODES,
  isEntityType,
  isValidCanonicalKey,
  type CanonicalKey,
  type Entity,
  type EntityType,
} from "@prowess/model";
import { insertEntity, selectEntityByCanonicalKey, selectEntityById } from "./repository.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * Entity service — the application/domain boundary for Entity operations
 * (PAS-10 M1-WO1 §9). Callers use this, never `./repository.ts` or
 * `@prowess/db`'s `prisma` export, directly — this is what keeps Prisma
 * isolated inside persistence infrastructure:
 *
 *   domain (this file's callers)
 *     -> this service (validates input, maps errors)
 *     -> repository.ts (Prisma queries only)
 *     -> Prisma / PostgreSQL
 *
 * Three operations only, deliberately — no larger service framework for
 * what M1-WO1 actually needs. EntityVersion operations begin in M1-WO2.
 */

export interface CreateEntityInput {
  entityType: string;
  canonicalKey: string;
}

/**
 * Creates a new Entity.
 *
 * Validates `entityType` and `canonicalKey` against `@prowess/model`'s
 * controlled types *before* ever reaching Prisma — invalid input never
 * persists, per PAS-10 M1-WO1 §12. Throws:
 *   - `ENTITY.INVALID_TYPE` if `entityType` isn't a recognized `EntityType`
 *   - `ENTITY.INVALID_CANONICAL_KEY` if `canonicalKey` fails shape validation
 *   - `ENTITY.CANONICAL_KEY_CONFLICT` if `canonicalKey` is already in use
 *     (the database's own UNIQUE constraint is the authoritative guard
 *     here — this validates first as a fast, clear rejection, but a race
 *     between two concurrent creates is still correctly caught by Postgres
 *     and mapped below, not left to the validation check alone)
 */
export async function createEntity(input: CreateEntityInput): Promise<Entity> {
  if (!isEntityType(input.entityType)) {
    throw new DomainError(
      ENTITY_ERROR_CODES.INVALID_TYPE,
      `Not a recognized EntityType: ${JSON.stringify(input.entityType)}`,
    );
  }
  if (!isValidCanonicalKey(input.canonicalKey)) {
    throw new DomainError(
      ENTITY_ERROR_CODES.INVALID_CANONICAL_KEY,
      `Not a valid canonical key: ${JSON.stringify(input.canonicalKey)}`,
    );
  }

  const entityType: EntityType = input.entityType;
  const canonicalKey: CanonicalKey = input.canonicalKey as CanonicalKey;

  try {
    return await insertEntity({ entityType, canonicalKey });
  } catch (error) {
    if (isCanonicalKeyUniqueConstraintViolation(error)) {
      throw new DomainError(
        ENTITY_ERROR_CODES.CANONICAL_KEY_CONFLICT,
        `canonicalKey is already in use: ${canonicalKey}`,
      );
    }
    // Any other persistence failure is a real, unexpected error — it is
    // deliberately NOT swallowed or re-labeled as a domain error here.
    throw error;
  }
}

/**
 * Retrieves an Entity by its explicit UUID identity. Looking up by
 * explicit identity implies the caller expects the Entity to exist, so
 * absence is treated as exceptional: throws `ENTITY.NOT_FOUND` rather than
 * returning `null` (contrast with `findEntityByCanonicalKey` below). See
 * PAS-10 M1-WO1 §11.
 */
export async function getEntityById(id: string): Promise<Entity> {
  const entity = await selectEntityById(id);
  if (!entity) {
    throw new DomainError(ENTITY_ERROR_CODES.NOT_FOUND, `Entity not found: ${id}`);
  }
  return entity;
}

/**
 * Searches for an Entity by canonical key. A search may legitimately find
 * nothing — returns `null`, not an error. See PAS-10 M1-WO1 §11 and
 * `getEntityById` above for the contrasting by-identity behavior.
 */
export async function findEntityByCanonicalKey(canonicalKey: string): Promise<Entity | null> {
  return selectEntityByCanonicalKey(canonicalKey);
}

function isCanonicalKeyUniqueConstraintViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: "entities_canonical_key_key",
    fields: ["canonical_key"],
  });
}
