import { prisma } from "../client.js";

/**
 * Persistence for effective resolution (PAS-10 M2-WO3). Internal to @prowess/db.
 *
 * The only thing resolution needs from storage beyond the manifest repository is
 * a way to order resolved Entities the SAME way M2-WO2 orders a manifest's
 * entries. That order is the database's own `canonical_key ASC` collation, which
 * can differ from a JavaScript string comparison for keys containing '.' and '_',
 * so the ordering is asked of the database rather than reimplemented here.
 */

/** The given Entity ids, sorted by `canonical_key ASC, id ASC` — the M2-WO2 convention. */
export async function selectEntityIdsInCanonicalKeyOrder(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await prisma.entity.findMany({
    where: { id: { in: [...ids] } },
    orderBy: [{ canonicalKey: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return rows.map((row: { id: string }) => row.id);
}
