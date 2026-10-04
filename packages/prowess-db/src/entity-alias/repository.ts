import { EntityAliasId, EntityId, type Entity, type EntityAlias } from "@prowess/model";
import { prisma } from "../client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { toDomainEntity } from "../entity/repository.js";
import type {
  Entity as PrismaEntityRow,
  EntityAlias as PrismaEntityAliasRow,
} from "../../generated/prisma/client.js";

/**
 * EntityAlias repository — the only place in this package that speaks
 * Prisma's `entityAlias` query API directly. Internal implementation
 * detail of the entity-alias service (not re-exported from
 * `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 */

function toDomainEntityAlias(row: PrismaEntityAliasRow): EntityAlias {
  return {
    id: EntityAliasId.of(row.id),
    entityId: EntityId.of(row.entityId),
    alias: row.alias,
    normalizedAlias: row.normalizedAlias,
    context: row.context,
    createdAt: row.createdAt,
  };
}

export interface InsertEntityAliasInput {
  entityId: string;
  alias: string;
  normalizedAlias: string;
  context: string | null;
  normalizedContext: string;
}

/**
 * Inserts a new EntityAlias row. Does not catch or translate errors — a
 * (entity_id, normalized_alias, normalized_context) uniqueness violation
 * surfaces here as Prisma's own `PrismaClientKnownRequestError` (code
 * `P2002`); mapping that to the domain's `ENTITY_ALIAS.DUPLICATE` is the
 * service layer's job.
 */
export async function insertEntityAlias(input: InsertEntityAliasInput): Promise<EntityAlias> {
  const row = await prisma.entityAlias.create({
    data: {
      entityId: input.entityId,
      alias: input.alias,
      normalizedAlias: input.normalizedAlias,
      context: input.context,
      normalizedContext: input.normalizedContext,
    },
  });
  return toDomainEntityAlias(row);
}

/** Ordered `normalizedAlias ASC` — deterministic, documented default (PAS-10 M1-WO4 §24). */
export async function selectAliasesByEntityId(entityId: string): Promise<EntityAlias[]> {
  const rows = await prisma.entityAlias.findMany({
    where: { entityId },
    orderBy: { normalizedAlias: "asc" },
  });
  return rows.map(toDomainEntityAlias);
}

export async function selectEntityAliasById(id: string): Promise<EntityAlias | null> {
  try {
    const row = await prisma.entityAlias.findUnique({ where: { id } });
    return row ? toDomainEntityAlias(row) : null;
  } catch {
    // Same deliberate simplification as elsewhere in this package: a
    // malformed UUID and a genuinely absent id are both "not found" here.
    return null;
  }
}

export interface AliasEntityMatch {
  entity: Entity;
  matchedAlias: EntityAlias;
}

/**
 * Finds every Entity with a matching normalized alias — deliberately
 * 0..many, never exactly one (PAS-10 M1-WO4 §17): different Entities may
 * legitimately share the same alias (e.g. two unrelated "Ward" effects),
 * and this function must never arbitrarily pick a "first" result. Ordered
 * by creation order (oldest match first) purely for determinism, not to
 * imply any ranking among equally-valid matches — disambiguation is a
 * future UI/caller concern, not this function's.
 *
 * `normalizedContext`, when supplied, narrows to that exact context only
 * (still shape `0..many`, since the same normalized alias+context could in
 * principle match more than one Entity).
 */
export async function selectEntitiesByAlias(
  normalizedAlias: string,
  normalizedContext?: string,
): Promise<AliasEntityMatch[]> {
  const rows = await prisma.entityAlias.findMany({
    where: {
      normalizedAlias,
      ...(normalizedContext !== undefined && { normalizedContext }),
    },
    include: { entity: true },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row: PrismaEntityAliasRow & { entity: PrismaEntityRow }) => ({
    entity: toDomainEntity(row.entity),
    matchedAlias: toDomainEntityAlias(row),
  }));
}

/**
 * Deletes an EntityAlias by id. Returns `true` if a row was deleted,
 * `false` if no row with that id existed — the service layer maps `false`
 * to `ENTITY_ALIAS.NOT_FOUND` (see PAS-10 M1-WO4 §16).
 */
export async function deleteEntityAliasById(id: string): Promise<boolean> {
  try {
    await prisma.entityAlias.delete({ where: { id } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return false;
    }
    throw error;
  }
}

/**
 * Whether `error` is Postgres's
 * `(entity_id, normalized_alias, normalized_context)` constraint firing —
 * scoped to exactly that constraint (checked via Prisma's `meta.target`),
 * not every possible unique-constraint violation on this table.
 */
export function isAliasUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  return (
    Array.isArray(target) &&
    (target as string[]).includes("entity_id") &&
    (target as string[]).includes("normalized_alias") &&
    (target as string[]).includes("normalized_context")
  );
}
