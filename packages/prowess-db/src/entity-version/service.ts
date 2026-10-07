import {
  DomainError,
  ENTITY_VERSION_ERROR_CODES,
  isChangeType,
  isEntityVersionStatus,
  isValidDisplayName,
  isValidEntityVersionTransition,
  type CreateEntityVersionInput,
  type EntityVersion,
  type EntityVersionStatus,
  type UpdateDraftEntityVersionInput,
} from "@prowess/model";
import { getEntityById } from "../entity/service.js";
import {
  insertNextEntityVersion,
  isRevisionUniqueConstraintViolation,
  selectEntityVersionById,
  selectEntityVersionsByEntityId,
  selectLatestEntityVersion,
  selectEntityVersionByIdWith,
  transitionEntityVersionStatusAtomic,
  updateDraftEntityVersionContentAtomic,
  type EntityVersionClient,
} from "./repository.js";

/**
 * EntityVersion service — the application/domain boundary for EntityVersion
 * operations (PAS-10 M1-WO2 §15, lifecycle/mutation operations added
 * M1-WO3), mirroring the Entity service's layering:
 *
 *   domain (callers) -> this service -> repository.ts (Prisma only) -> Prisma / PostgreSQL
 *
 * Six operations total. Status changes and content updates are
 * intentionally separate operations (`transitionEntityVersionStatus` vs.
 * `updateDraftEntityVersion`) — there is no single generic
 * `updateEntityVersion(...)` that accepts both, by design (PAS-10 M1-WO3
 * §14): a unified update endpoint would be exactly the kind of escape
 * hatch future Canon/permission logic could be bypassed through.
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

/**
 * Updates a DRAFT EntityVersion's authored content (PAS-10 M1-WO3 §5–7).
 *
 * Only the fields in `UpdateDraftEntityVersionInput` are ever accepted —
 * there is no path from this function to a generic Prisma update payload.
 * `id`, `entityId`, `revisionNumber`, `createdAt`, `parentVersionId`, and
 * `status` are never touched here, even if somehow present on a caller's
 * object, because the type itself has no such fields.
 *
 * Race-safe by construction: the actual persistence call
 * (`updateDraftEntityVersionContentAtomic`) is a single conditional
 * `UPDATE ... WHERE id = ? AND status = 'DRAFT'`, so there is no
 * check-then-write window for a concurrent status transition to slip
 * through. If zero rows are affected, this function re-reads to tell
 * "doesn't exist" (`ENTITY_VERSION.NOT_FOUND`) apart from "exists but is
 * no longer DRAFT" (`ENTITY_VERSION.IMMUTABLE`) — never an opaque
 * zero-rows-affected result.
 */
export async function updateDraftEntityVersion(
  versionId: string,
  patch: UpdateDraftEntityVersionInput,
): Promise<EntityVersion> {
  if (patch.displayName !== undefined && !isValidDisplayName(patch.displayName)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      "displayName must not be empty",
    );
  }
  if (patch.changeType != null && !isChangeType(patch.changeType)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      `Not a recognized ChangeType: ${JSON.stringify(patch.changeType)}`,
    );
  }

  const hasAnyField =
    patch.displayName !== undefined ||
    patch.shortDescription !== undefined ||
    patch.rulesText !== undefined ||
    patch.structuredData !== undefined ||
    patch.changeType !== undefined ||
    patch.changeSummary !== undefined;
  if (!hasAnyField) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      "At least one field must be supplied to update",
    );
  }

  const updated = await updateDraftEntityVersionContentAtomic(versionId, patch);

  if (!updated) {
    const existing = await selectEntityVersionById(versionId);
    if (!existing) {
      throw new DomainError(
        ENTITY_VERSION_ERROR_CODES.NOT_FOUND,
        `EntityVersion not found: ${versionId}`,
      );
    }
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      `EntityVersion ${versionId} is not DRAFT (current status: ${existing.status}) and its content cannot be edited`,
    );
  }

  return updated;
}

/**
 * Transitions an EntityVersion's lifecycle status (PAS-10 M1-WO3 §9–13).
 *
 * Validates the transition against `@prowess/model`'s one authoritative
 * `ENTITY_VERSION_TRANSITIONS` graph before attempting any write — an
 * unrepresented transition (e.g. `DRAFT -> CANON`) throws
 * `ENTITY_VERSION.INVALID_STATUS_TRANSITION` immediately, without
 * touching the database.
 *
 * Race-safe: the actual persistence call
 * (`transitionEntityVersionStatusAtomic`) is a single conditional
 * `UPDATE ... WHERE id = ? AND status = ?`, naming both the row and the
 * exact status this function just validated against. If the status
 * changed concurrently between that validation and this write committing,
 * the conditional affects zero rows — mapped to the same
 * `ENTITY_VERSION.INVALID_STATUS_TRANSITION` code (the transition this
 * caller validated is no longer applicable to the Version's actual
 * current status), rather than silently forcing the requested status or
 * leaking an ambiguous zero-rows result.
 */
export async function transitionEntityVersionStatus(
  versionId: string,
  targetStatus: string,
): Promise<EntityVersion> {
  if (!isEntityVersionStatus(targetStatus)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_INPUT,
      `Not a recognized EntityVersionStatus: ${JSON.stringify(targetStatus)}`,
    );
  }

  return transitionEntityVersionStatusWith(undefined, versionId, targetStatus);
}

/**
 * The SAME M1 lifecycle transition, run on an enclosing interactive transaction (PAS-10 M2-WO8 §30):
 * identical validation (`isValidEntityVersionTransition`) and the identical conditional UPDATE, so a
 * publication's DEPRECATE commits or rolls back together with the release. Internal to @prowess/db.
 */
export async function transitionEntityVersionStatusInTransaction(
  tx: EntityVersionClient,
  versionId: string,
  targetStatus: EntityVersionStatus,
): Promise<EntityVersion> {
  return transitionEntityVersionStatusWith(tx, versionId, targetStatus);
}

async function transitionEntityVersionStatusWith(
  client: EntityVersionClient | undefined,
  versionId: string,
  targetStatus: EntityVersionStatus,
): Promise<EntityVersion> {
  // Default (M1): exactly the original read. In a transaction: the same read on the transaction.
  const current = client === undefined ? await getEntityVersion(versionId) : await selectEntityVersionByIdWith(client, versionId);
  if (current === null) {
    throw new DomainError(ENTITY_VERSION_ERROR_CODES.NOT_FOUND, `EntityVersion not found: ${versionId}`);
  }

  if (!isValidEntityVersionTransition(current.status, targetStatus)) {
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `Cannot transition EntityVersion ${versionId} from ${current.status} to ${targetStatus}`,
    );
  }

  const updated = await transitionEntityVersionStatusAtomic(
    versionId,
    current.status as EntityVersionStatus,
    targetStatus,
    client,
  );

  if (!updated) {
    // Lost a race: status changed between our read above and this write
    // committing. Re-validating against the NEW current status is
    // unnecessary — whatever it is now, the transition this caller
    // validated against `current.status` is no longer the applicable one.
    throw new DomainError(
      ENTITY_VERSION_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `EntityVersion ${versionId}'s status changed concurrently; the requested transition from ${current.status} is no longer valid`,
    );
  }

  return updated;
}
