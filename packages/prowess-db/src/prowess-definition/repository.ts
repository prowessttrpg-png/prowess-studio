import { prisma } from "../client.js";

/**
 * Batched, read-only content read for exact Prowess Definition materialization (PAS-10 M5-WO1 §88–92). Internal to
 * @prowess/db.
 *
 * Loads EXACTLY the EntityVersion ids the caller names — the pins of an already-resolved exact RulesetContext — in one
 * query, ordered by immutable id. There is deliberately no "by Entity", "by canonical key", "newest revision" or
 * "current version" read here: materialization never chooses a version (M5-I010, M5-I027). Nothing is written.
 */
export interface PinnedVersionContentRow {
  readonly id: string;
  readonly entityId: string;
  readonly structuredData: unknown;
}

export async function selectPinnedEntityVersionContent(ids: readonly string[]): Promise<PinnedVersionContentRow[]> {
  if (ids.length === 0) return [];
  return prisma.entityVersion.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, entityId: true, structuredData: true },
    orderBy: { id: "asc" },
  });
}
