import { prisma } from "@prowess/db";

/**
 * Complete, FK-ordered teardown of everything an API integration file may
 * have created under a fixture prefix. One shared implementation replaces the
 * per-file `afterAll` blocks that each deleted only the tables their own
 * tests happened to touch.
 *
 * Why it matters (found by the first real CI run): the files share one
 * database and one `test.api` prefix, and only `keyword-api` creates
 * Version-level Keyword rows — which no cleanup deleted. Its own teardown hit
 * a foreign-key error and left residue, which then made every LATER file's
 * prefix-wide cleanup fail too. An incomplete cleanup anywhere poisons the
 * rest of the run, so cleanup must cover every dependent table, always.
 *
 * Order is dictated by the schema's ON DELETE RESTRICT foreign keys:
 * dependents first, parents last.
 */
export async function cleanupFixtures(options: {
  entityPrefix: string;
  keywordPrefix?: string;
  documentTitlePrefix?: string;
}): Promise<void> {
  const entities = await prisma.entity.findMany({
    where: { canonicalKey: { startsWith: options.entityPrefix } },
    select: { id: true },
  });
  const entityIds = entities.map((e: { id: string }) => e.id);
  const versions = await prisma.entityVersion.findMany({
    where: { entityId: { in: entityIds } },
    select: { id: true },
  });
  const versionIds = versions.map((v: { id: string }) => v.id);

  await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
  await prisma.entityVersionKeyword.deleteMany({ where: { entityVersionId: { in: versionIds } } });
  await prisma.entityKeyword.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.entityRelationship.deleteMany({
    where: { OR: [{ sourceEntityId: { in: entityIds } }, { targetEntityId: { in: entityIds } }] },
  });
  await prisma.entityAlias.deleteMany({ where: { entityId: { in: entityIds } } });
  // Lineage is a self-reference with RESTRICT: detach parents before deleting versions.
  await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
  await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
  await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });

  if (options.keywordPrefix) {
    await prisma.keywordDefinition.deleteMany({ where: { canonicalKey: { startsWith: options.keywordPrefix } } });
  }
  if (options.documentTitlePrefix) {
    await prisma.sourceDocument.deleteMany({ where: { title: { startsWith: options.documentTitlePrefix } } });
  }
}
