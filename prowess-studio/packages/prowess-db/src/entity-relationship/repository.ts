import {
  EntityId,
  EntityRelationshipId,
  type Entity,
  type EntityRelationship,
  type JsonObject,
  type RelationshipType,
} from "@prowess/model";
import { prisma } from "../client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { toDomainEntity } from "../entity/repository.js";
import type {
  Entity as PrismaEntityRow,
  EntityRelationship as PrismaEntityRelationshipRow,
} from "../../generated/prisma/client.js";

/**
 * EntityRelationship repository — the only place in this package that
 * speaks Prisma's `entityRelationship` query API directly. Internal
 * implementation detail of the entity-relationship service (not
 * re-exported from `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 */

function toDomainEntityRelationship(row: PrismaEntityRelationshipRow): EntityRelationship {
  return {
    id: EntityRelationshipId.of(row.id),
    sourceEntityId: EntityId.of(row.sourceEntityId),
    targetEntityId: EntityId.of(row.targetEntityId),
    relationshipType: row.relationshipType as RelationshipType,
    metadata: row.metadata as JsonObject,
    createdAt: row.createdAt,
  };
}

export interface InsertEntityRelationshipInput {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: RelationshipType;
  metadata: JsonObject;
}

/**
 * Inserts a new EntityRelationship row. Does not catch or translate
 * errors — a duplicate `(source, target, type)` triple surfaces here as
 * Prisma's own `PrismaClientKnownRequestError` (code `P2002`); a
 * nonexistent source/target surfaces as a foreign-key violation (`P2003`).
 * Mapping both to controlled domain errors is the service layer's job —
 * see `./service.ts`, which validates source/target existence beforehand
 * anyway, so the FK path should not occur through the supported service
 * boundary.
 */
export async function insertEntityRelationship(
  input: InsertEntityRelationshipInput,
): Promise<EntityRelationship> {
  const row = await prisma.entityRelationship.create({
    data: {
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      relationshipType: input.relationshipType,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
  return toDomainEntityRelationship(row);
}

export async function selectEntityRelationshipById(
  id: string,
): Promise<EntityRelationship | null> {
  try {
    const row = await prisma.entityRelationship.findUnique({ where: { id } });
    return row ? toDomainEntityRelationship(row) : null;
  } catch {
    return null;
  }
}

export interface RelationshipWithCounterpart {
  relationship: EntityRelationship;
  /**
   * The OTHER Entity in this relationship — the target for an outgoing
   * query, the source for an incoming one. Stable Entity identity only
   * (PAS-10 M1-WO6 §21) — never a "current display name," current
   * Version, or Ruleset-resolved value, none of which exist yet.
   */
  counterpart: Entity;
}

/**
 * This Entity's outgoing relationships — where it is the stated SOURCE.
 * Ordered `relationshipType ASC`, then counterpart (target) Entity `id
 * ASC` — deterministic, documented (PAS-10 M1-WO6 §20), and independent of
 * database natural row order.
 */
export async function selectOutgoingRelationships(
  entityId: string,
): Promise<RelationshipWithCounterpart[]> {
  const rows = await prisma.entityRelationship.findMany({
    where: { sourceEntityId: entityId },
    include: { targetEntity: true },
    orderBy: [{ relationshipType: "asc" }, { targetEntityId: "asc" }],
  });

  return rows.map((row: PrismaEntityRelationshipRow & { targetEntity: PrismaEntityRow }) => ({
    relationship: toDomainEntityRelationship(row),
    counterpart: toDomainEntity(row.targetEntity),
  }));
}

/**
 * This Entity's incoming relationships — where it is the stated TARGET.
 * Ordered `relationshipType ASC`, then counterpart (source) Entity `id
 * ASC` — same determinism rationale as outgoing above.
 */
export async function selectIncomingRelationships(
  entityId: string,
): Promise<RelationshipWithCounterpart[]> {
  const rows = await prisma.entityRelationship.findMany({
    where: { targetEntityId: entityId },
    include: { sourceEntity: true },
    orderBy: [{ relationshipType: "asc" }, { sourceEntityId: "asc" }],
  });

  return rows.map((row: PrismaEntityRelationshipRow & { sourceEntity: PrismaEntityRow }) => ({
    relationship: toDomainEntityRelationship(row),
    counterpart: toDomainEntity(row.sourceEntity),
  }));
}

/**
 * Deletes an EntityRelationship by id. Returns `true` if a row was
 * deleted, `false` if no row with that id existed.
 */
export async function deleteEntityRelationship(id: string): Promise<boolean> {
  try {
    await prisma.entityRelationship.delete({ where: { id } });
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
 * `(source_entity_id, target_entity_id, relationship_type)` constraint
 * firing — scoped to exactly that constraint (checked via Prisma's
 * `meta.target`), not every possible unique-constraint violation on this
 * table.
 */
export function isRelationshipUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  return (
    Array.isArray(target) &&
    (target as string[]).includes("source_entity_id") &&
    (target as string[]).includes("target_entity_id") &&
    (target as string[]).includes("relationship_type")
  );
}
