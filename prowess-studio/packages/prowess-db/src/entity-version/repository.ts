import {
  EntityId,
  EntityVersionId,
  type ChangeType,
  type EntityVersion,
  type EntityVersionStatus,
} from "@prowess/model";
import { prisma } from "../client.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { EntityVersion as PrismaEntityVersionRow } from "../../generated/prisma/client.js";

/**
 * EntityVersion repository — the only place in this package that speaks
 * Prisma's `entityVersion` query API directly. Internal implementation
 * detail of the entity-version service (not re-exported from
 * `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 */

function toDomainEntityVersion(row: PrismaEntityVersionRow): EntityVersion {
  return {
    id: EntityVersionId.of(row.id),
    entityId: EntityId.of(row.entityId),
    revisionNumber: row.revisionNumber,
    status: row.status as EntityVersionStatus,
    displayName: row.displayName,
    shortDescription: row.shortDescription,
    rulesText: row.rulesText,
    structuredData: row.structuredData,
    parentVersionId: row.parentVersionId ? EntityVersionId.of(row.parentVersionId) : null,
    changeType: row.changeType as ChangeType | null,
    changeSummary: row.changeSummary,
    createdAt: row.createdAt,
  };
}

export interface InsertEntityVersionAtRevisionInput {
  entityId: string;
  revisionNumber: number;
  status: EntityVersionStatus;
  displayName: string;
  shortDescription: string | null;
  rulesText: string | null;
  structuredData: unknown;
  parentVersionId: string | null;
  changeType: ChangeType | null;
  changeSummary: string | null;
}

/**
 * Lowest-level insert primitive: creates a row at an EXPLICIT revision
 * number — no allocation, no retry. Used internally by
 * `insertNextEntityVersion`'s bounded-retry loop below, and imported
 * directly by integration tests that need to deterministically force a
 * real `(entity_id, revision_number)` conflict (see
 * `tests/integration/entity-version.test.ts`'s "Duplicate Revision
 * Conflict" case) — a legitimate same-package, white-box use that doesn't
 * cross `@prowess/db`'s public boundary (this function is never re-exported
 * from the package's own `index.ts`).
 */
export async function insertEntityVersionAtRevision(
  input: InsertEntityVersionAtRevisionInput,
): Promise<EntityVersion> {
  const row = await prisma.entityVersion.create({
    data: {
      entityId: input.entityId,
      revisionNumber: input.revisionNumber,
      status: input.status,
      displayName: input.displayName,
      shortDescription: input.shortDescription,
      rulesText: input.rulesText,
      structuredData: input.structuredData as Prisma.InputJsonValue,
      parentVersionId: input.parentVersionId,
      changeType: input.changeType,
      changeSummary: input.changeSummary,
    },
  });
  return toDomainEntityVersion(row);
}

/** Bounded — see this module's and the service's docs on why this is enough. */
const MAX_REVISION_ALLOCATION_ATTEMPTS = 5;

export type InsertNextEntityVersionInput = Omit<InsertEntityVersionAtRevisionInput, "revisionNumber">;

/**
 * Allocates the next revision number for `entityId` (max existing + 1,
 * starting at 1) and inserts atomically within a transaction.
 *
 * Concurrency strategy (PAS-10 M1-WO2 §6, §27): two concurrent calls for
 * the same Entity both read the current max revision, both compute the
 * same "next" number, and one of their two `INSERT`s loses the race against
 * the `UNIQUE(entity_id, revision_number)` constraint — Postgres itself is
 * the only thing that can authoritatively settle this, not application
 * logic. Rather than heavyweight distributed locking (explicitly out of
 * scope), the loser simply retries: re-reads the (now-updated) max and
 * tries again, up to `MAX_REVISION_ALLOCATION_ATTEMPTS` times. With only a
 * handful of genuinely concurrent writers for a single Entity (the
 * realistic case — this is authoring tooling, not a high-throughput
 * system), one retry resolves the overwhelming majority of races; five is
 * a deliberately small, bounded ceiling, not a tuning knob expected to
 * matter in practice. If attempts are exhausted (pathological contention),
 * the last error propagates — the service layer maps it to
 * `ENTITY_VERSION.REVISION_CONFLICT` as a final-authority fallback, per
 * "a unique database constraint remains the final authority."
 */
export async function insertNextEntityVersion(
  input: InsertNextEntityVersionInput,
): Promise<EntityVersion> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_REVISION_ALLOCATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const latest = await tx.entityVersion.findFirst({
          where: { entityId: input.entityId },
          orderBy: { revisionNumber: "desc" },
          select: { revisionNumber: true },
        });
        const nextRevisionNumber = (latest?.revisionNumber ?? 0) + 1;

        const row = await tx.entityVersion.create({
          data: {
            entityId: input.entityId,
            revisionNumber: nextRevisionNumber,
            status: input.status,
            displayName: input.displayName,
            shortDescription: input.shortDescription,
            rulesText: input.rulesText,
            structuredData: input.structuredData as Prisma.InputJsonValue,
            parentVersionId: input.parentVersionId,
            changeType: input.changeType,
            changeSummary: input.changeSummary,
          },
        });
        return toDomainEntityVersion(row);
      });
    } catch (error) {
      lastError = error;
      if (isRevisionUniqueConstraintViolation(error)) {
        continue; // another request won this revision number — retry against a fresh max
      }
      throw error;
    }
  }

  throw lastError;
}

export async function selectEntityVersionById(id: string): Promise<EntityVersion | null> {
  try {
    const row = await prisma.entityVersion.findUnique({ where: { id } });
    return row ? toDomainEntityVersion(row) : null;
  } catch {
    // Same deliberate simplification as entity/repository.ts's
    // selectEntityById: a malformed UUID and a genuinely absent id are
    // both treated as "not found" here.
    return null;
  }
}

/** Ordered `revisionNumber ASC` — deterministic history order. */
export async function selectEntityVersionsByEntityId(entityId: string): Promise<EntityVersion[]> {
  const rows = await prisma.entityVersion.findMany({
    where: { entityId },
    orderBy: { revisionNumber: "asc" },
  });
  return rows.map(toDomainEntityVersion);
}

export async function selectLatestEntityVersion(entityId: string): Promise<EntityVersion | null> {
  const row = await prisma.entityVersion.findFirst({
    where: { entityId },
    orderBy: { revisionNumber: "desc" },
  });
  return row ? toDomainEntityVersion(row) : null;
}

/**
 * Whether `error` is Postgres's `UNIQUE(entity_id, revision_number)`
 * constraint firing — scoped to exactly that constraint (checked via
 * Prisma's `meta.target`), not every possible unique-constraint violation
 * on this table.
 */
export function isRevisionUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  return (
    Array.isArray(target) &&
    (target as string[]).includes("entity_id") &&
    (target as string[]).includes("revision_number")
  );
}
