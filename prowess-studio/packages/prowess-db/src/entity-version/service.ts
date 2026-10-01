import {
  DomainError,
  ENTITY_VERSION_ERROR_CODES,
  isChangeType,
  isEntityVersionStatus,
  isValidDisplayName,
  type CreateEntityVersionInput,
  type EntityVersion,
} from "@prowess/model";
import { getEntityById } from "../entity/service.js";
import {
  insertNextEntityVersion,
  isRevisionUniqueConstraintViolation,
  selectEntityVersionById,
  selectEntityVersionsByEntityId,
  selectLatestEntityVersion,
} from "./repository.js";

/**
 * EntityVersion service — the application/domain boundary for EntityVersion
 * operations (PAS-10 M1-WO2 §15), mirroring the Entity service's layering:
 *
 *   domain (callers) -> this service -> repository.ts (Prisma only) -> Prisma / PostgreSQL
 *
 * Four operations only. Deliberately no update/delete here — M1-WO2's job
 * is creating and retrieving historical snapshots; M1-WO3 owns whatever
 * narrow lifecycle/mutation rules come later (see PAS-10 M1-WO2 §20).
 */

/**
 * Creates the next EntityVersion for `entityId` (revision number allocated
 * automatically — never caller-supplied).
 *
 * Validates, before anything reaches Prisma:
 *   - the parent Entity exists (reuses `@prowess/db`'s own Entity service,
 *     so a missing Entity surfaces as the existing `ENTITY.NOT_FOUND` —
 *     see `@prowess/model`'s errors.ts for why this is reused rather than
 *     a parallel `ENTITY_VERSION.ENTITY_NOT_FOUND`)
 *   - `displayName` is a non-empty string
 *   - `status`, if supplied, is a recognized `EntityVersionStatus` (defaults
 *     to `DRAFT`)
 *   - `changeType`, if supplied, is a recognized `ChangeType`
 *   - `parentVersionId`, if supplied, exists and belongs to the SAME Entity
 *     (`ENTITY_VERSION.INVALID_PARENT`)
 *
 * Throws `ENTITY_VERSION.REVISION_CONFLICT` only if the repository's
 * bounded retry (see `./repository.ts`) is exhausted — in ordinary use
 * this should not happen; it exists because the database's unique
 * constraint, not application logic, is the final authority.
 */
export async function createEntityVersion(
  entityId: string,
  input: CreateEntityVersionInput,
): Promise<EntityVersion> {
  await getEntityById(entityId);

  if (!isValidDisplayName(input.displayName)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      "displayName is required and must not be empty",
    );
  }

  const status = input.status ?? "DRAFT";
  if (!isEntityVersionStatus(status)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      `Not a recognized EntityVersionStatus: ${JSON.stringify(status)}`,
    );
  }

  if (input.changeType != null && !isChangeType(input.changeType)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      `Not a recognized ChangeType: ${JSON.stringify(input.changeType)}`,
    );
  }

  if (input.parentVersionId != null) {
    await assertValidParentVersion(entityId, input.parentVersionId);
  }

  try {
    return await insertNextEntityVersion({
      entityId,
      status,
      displayName: input.displayName,
      shortDescription: input.shortDescription ?? null,
      rulesText: input.rulesText ?? null,
      structuredData: input.structuredData ?? {},
      parentVersionId: input.parentVersionId ?? null,
      changeType: input.changeType ?? null,
      changeSummary: input.changeSummary ?? null,
    });
  } catch (error) {
    if (isRevisionUniqueConstraintViolation(error)) {
      throw new DomainError(
        ENTITY_VERSION_ERROR_CODES.REVISION_CONFLICT,
        `Could not allocate a unique revision number for Entity ${entityId} after retrying`,
      );
    }
    throw error;
  }
}

/** Retrieves an EntityVersion by its explicit UUID identity. */
export async function getEntityVersion(versionId: string): Promise<EntityVersion> {
  const version = await selectEntityVersionById(versionId);
  if (!version) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.NOT_FOUND,
      `EntityVersion not found: ${versionId}`,
    );
  }
  return version;
}

/** All Versions for an Entity, oldest first (`revisionNumber ASC`). */
export async function listEntityVersions(entityId: string): Promise<EntityVersion[]> {
  return selectEntityVersionsByEntityId(entityId);
}

/**
 * The highest-revision EntityVersion for an Entity, or `null` if it has
 * none yet — not an error, the same "absence is an expected outcome"
 * reasoning as `findEntityByCanonicalKey`.
 */
export async function getLatestEntityVersion(entityId: string): Promise<EntityVersion | null> {
  return selectLatestEntityVersion(entityId);
}

async function assertValidParentVersion(entityId: string, parentVersionId: string): Promise<void> {
  const parent = await selectEntityVersionById(parentVersionId);
  if (!parent) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_PARENT,
      `parentVersionId does not exist: ${parentVersionId}`,
    );
  }
  if (parent.entityId !== entityId) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_PARENT,
      `parentVersionId belongs to a different Entity: ${parentVersionId}`,
    );
  }
  // A true self-reference check (a Version naming itself as its own
  // parent) is defensive only — not reachable via createEntityVersion
  // today, since the new Version's id doesn't exist until after this
  // function returns and insertion happens. Recorded here so the guard
  // isn't forgotten if a future mutation path (M1-WO3) ever allows
  // changing parentVersionId after creation.
}
