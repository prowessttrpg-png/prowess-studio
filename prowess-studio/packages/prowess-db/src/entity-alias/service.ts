import {
  DomainError,
  ENTITY_ALIAS_ERROR_CODES,
  isValidEntityAlias,
  normalizeEntityAlias,
  type CreateEntityAliasInput,
  type EntityAlias,
} from "@prowess/model";
import { getEntityById } from "../entity/service.js";
import {
  deleteEntityAliasById,
  insertEntityAlias,
  isAliasUniqueConstraintViolation,
  selectAliasesByEntityId,
  selectEntitiesByAlias,
  type AliasEntityMatch,
} from "./repository.js";

/**
 * EntityAlias service — the application/domain boundary for EntityAlias
 * operations (PAS-10 M1-WO4 §13), mirroring the Entity/EntityVersion
 * services' layering:
 *
 *   domain (callers) -> this service -> repository.ts (Prisma only) -> Prisma / PostgreSQL
 *
 * Alias creation is always explicit — nothing here or anywhere else in
 * this package automatically creates an alias from an EntityVersion's
 * `displayName` (PAS-10 M1-WO4 §26). Hidden/automatic writes would be a
 * surprise, not a convenience.
 */

/**
 * Creates a new alias for `entityId`.
 *
 * Validates, before anything reaches Prisma:
 *   - the Entity exists (reuses `@prowess/db`'s own Entity service, so a
 *     missing Entity surfaces as the existing `ENTITY.NOT_FOUND` — see
 *     `@prowess/model`'s errors.ts for why this is reused rather than a
 *     parallel `ENTITY_ALIAS.ENTITY_NOT_FOUND`)
 *   - `alias` is non-empty after normalization and within the documented
 *     length limit (`ENTITY_ALIAS.INVALID_INPUT`)
 *   - `context`, if supplied, is likewise non-empty after normalization
 *
 * Throws `ENTITY_ALIAS.DUPLICATE` if the same Entity already has this
 * exact normalized alias in this exact normalized context — the database's
 * own unique constraint is the final authority; this mapping only ever
 * translates its failure into a controlled domain error, never leaks the
 * raw Prisma error.
 */
export async function createEntityAlias(
  entityId: string,
  input: CreateEntityAliasInput,
): Promise<EntityAlias> {
  await getEntityById(entityId);

  if (!isValidEntityAlias(input.alias)) {
    throw new DomainError(
      ENTITY_ALIAS_ERROR_CODES.INVALID_INPUT,
      "alias is required and must not be empty after normalization",
    );
  }

  if (input.context != null && !isValidEntityAlias(input.context)) {
    throw new DomainError(
      ENTITY_ALIAS_ERROR_CODES.INVALID_INPUT,
      "context, if supplied, must not be empty after normalization",
    );
  }

  const normalizedAlias = normalizeEntityAlias(input.alias);
  const normalizedContext = input.context != null ? normalizeEntityAlias(input.context) : "";

  try {
    return await insertEntityAlias({
      entityId,
      alias: input.alias,
      normalizedAlias,
      context: input.context ?? null,
      normalizedContext,
    });
  } catch (error) {
    if (isAliasUniqueConstraintViolation(error)) {
      const contextNote = input.context ? ` in context "${input.context}"` : "";
      throw new DomainError(
        ENTITY_ALIAS_ERROR_CODES.DUPLICATE,
        `Alias "${input.alias}" already exists for this Entity${contextNote}`,
      );
    }
    throw error;
  }
}

/** All aliases for an Entity, ordered `normalizedAlias ASC` (deterministic — PAS-10 M1-WO4 §24). */
export async function listEntityAliases(entityId: string): Promise<EntityAlias[]> {
  return selectAliasesByEntityId(entityId);
}

/**
 * Finds every Entity with a matching alias — ALWAYS 0..many, never exactly
 * one (PAS-10 M1-WO4 §17): different Entities may legitimately share the
 * same alias, and this function never arbitrarily picks a "first" match.
 * Returns an empty array, not an error, when nothing matches (a
 * search-style lookup — the same "absence is an expected outcome"
 * reasoning as `findEntityByCanonicalKey`).
 *
 * Returns stable Entity identity plus the specific alias row that matched
 * — deliberately does NOT invent a "current display name," since
 * Rulesets/current-version resolution don't exist yet (PAS-10 M1-WO4 §18).
 * Canonical-key lookup (`findEntityByCanonicalKey`) remains a completely
 * separate, exact operation — this function never falls back to it, and
 * vice versa.
 */
export async function findEntitiesByAlias(
  alias: string,
  context?: string,
): Promise<AliasEntityMatch[]> {
  const normalizedAlias = normalizeEntityAlias(alias);
  const normalizedContext = context != null ? normalizeEntityAlias(context) : undefined;
  return selectEntitiesByAlias(normalizedAlias, normalizedContext);
}

/**
 * Removes an alias. Throws `ENTITY_ALIAS.NOT_FOUND` if no alias exists
 * with that id. Deleting an alias never touches the Entity or any
 * EntityVersion — aliases are discovery metadata, not historical content.
 */
export async function removeEntityAlias(aliasId: string): Promise<void> {
  const deleted = await deleteEntityAliasById(aliasId);
  if (!deleted) {
    throw new DomainError(
      ENTITY_ALIAS_ERROR_CODES.NOT_FOUND,
      `EntityAlias not found: ${aliasId}`,
    );
  }
}
