import { prisma } from "../client.js";
import type { EntityIdentityRow, EntityVersionOwnerRow } from "./composition.js";

/**
 * Batched, read-only identity lookups for exact Ruleset resolution (PAS-10 M4-WO2 §20–21, §37–38). Internal to
 * @prowess/db.
 *
 * Exactly two queries per resolution regardless of composition size (no N+1): the pinned Entities' identity
 * (id, canonical key, type) and the pinned EntityVersions' owning Entity. Nothing else is read — no payload, display
 * name, status, alias, keyword or relationship — and nothing is written. Both are ordered by immutable id so results
 * never depend on database row order. This module never touches Rulesets, Manifests or Releases: those come only from
 * M2's own services.
 */
export async function selectEntityIdentities(ids: readonly string[]): Promise<EntityIdentityRow[]> {
  if (ids.length === 0) return [];
  return prisma.entity.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, canonicalKey: true, entityType: true },
    orderBy: { id: "asc" },
  });
}

export async function selectEntityVersionOwners(ids: readonly string[]): Promise<EntityVersionOwnerRow[]> {
  if (ids.length === 0) return [];
  return prisma.entityVersion.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, entityId: true },
    orderBy: { id: "asc" },
  });
}
