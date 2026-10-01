import { EntityId, type CanonicalKey, type Entity, type EntityType } from "@prowess/model";
import { prisma } from "../client.js";
import type { Entity as PrismaEntityRow } from "../../generated/prisma/client.js";

/**
 * Entity repository — the only place in this package that speaks Prisma's
 * `entity` query API directly. Translates between Prisma's generated row
 * shape and `@prowess/model`'s framework-independent `Entity` domain type.
 *
 * Deliberately thin: no business rules, no input validation, no error
 * mapping beyond the null-on-not-found convention below — see
 * `./service.ts` for all of that. This module is an internal implementation
 * detail of the entity service, not part of `@prowess/db`'s public surface
 * (it is not re-exported from the package's own `index.ts`).
 */

function toDomainEntity(row: PrismaEntityRow): Entity {
  return {
    id: EntityId.of(row.id),
    entityType: row.entityType as EntityType,
    canonicalKey: row.canonicalKey as CanonicalKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface InsertEntityInput {
  entityType: EntityType;
  canonicalKey: CanonicalKey;
}

/**
 * Inserts a new Entity row. Does not catch or translate errors — a
 * canonical-key uniqueness violation surfaces here as Prisma's own
 * `PrismaClientKnownRequestError` (code `P2002`); mapping that to the
 * domain's `ENTITY.CANONICAL_KEY_CONFLICT` is the service layer's job.
 */
export async function insertEntity(input: InsertEntityInput): Promise<Entity> {
  const row = await prisma.entity.create({
    data: {
      entityType: input.entityType,
      canonicalKey: input.canonicalKey,
    },
  });
  return toDomainEntity(row);
}

/**
 * Looks up an Entity by its primary UUID identity. Returns `null` both
 * when no row matches and when `id` isn't even syntactically a valid UUID
 * (Prisma's native `@db.Uuid` typing can reject a malformed id before
 * querying) — this repository deliberately does not distinguish the two
 * cases; the service layer treats either as "not found" (see
 * `./service.ts`'s `getEntityById`).
 */
export async function selectEntityById(id: string): Promise<Entity | null> {
  try {
    const row = await prisma.entity.findUnique({ where: { id } });
    return row ? toDomainEntity(row) : null;
  } catch {
    return null;
  }
}

/**
 * Looks up an Entity by its canonical key. Returns `null` when nothing
 * matches — a search-style lookup, not a by-identity lookup, so absence is
 * an expected outcome here, not translated to an error (see PAS-10 M1-WO1
 * §11 and `./service.ts`'s `findEntityByCanonicalKey`).
 */
export async function selectEntityByCanonicalKey(canonicalKey: string): Promise<Entity | null> {
  const row = await prisma.entity.findUnique({ where: { canonicalKey } });
  return row ? toDomainEntity(row) : null;
}
