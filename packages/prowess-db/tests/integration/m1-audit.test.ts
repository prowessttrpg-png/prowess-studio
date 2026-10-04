/**
 * M1 audit gate — DATABASE-level invariants (PAS-10 M1-WO11 §8, §13, §26–27).
 *
 * Covers what only a real PostgreSQL can prove: foreign-key protection of
 * historical records, revision-number uniqueness/allocation, explicit
 * lineage, and that the migration ledger on a database built from
 * `prisma migrate deploy` is exactly the approved chain. The user-visible
 * reproducibility scenario lives in apps/studio's m1-audit-api suite.
 *
 * Runs only against prowess_studio_test (guarded). Fixtures are tracked by
 * id and removed by id, never by a shared key prefix.
 */
import { DomainError, ENTITY_VERSION_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignKeywordToEntity,
  assignKeywordToEntityVersion,
  createEntity,
  createEntityAlias,
  createEntityRelationship,
  createEntityVersion,
  createKeywordCategory,
  createKeywordDefinition,
  createSourceDocument,
  createSourceReference,
  listEntityVersions,
  prisma,
  transitionEntityVersionStatus,
  updateDraftEntityVersion,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const key = (label: string) => `test.audit.db_${label}_${tag}_${++counter}`;
const created = {
  entities: [] as string[],
  keywords: [] as string[],
  categories: [] as string[],
  documents: [] as string[],
};

async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: key(label) });
  created.entities.push(e.id);
  return e;
}
async function keyword(label: string, categoryId?: string) {
  const k = await createKeywordDefinition({ canonicalKey: key(`kw_${label}`), name: label, categoryId });
  created.keywords.push(k.id);
  return k;
}
async function document(label: string) {
  const d = await createSourceDocument({ title: `Audit ${label} ${tag}`, sourceType: "DOCUMENT" });
  created.documents.push(d.id);
  return d;
}

async function expectProtected(attempt: Promise<unknown>, stillThere: () => Promise<unknown>) {
  await expect(attempt).rejects.toThrow();
  expect(await stillThere()).not.toBeNull();
}

describe("M1 audit — database level (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    const versions = await prisma.entityVersion.findMany({
      where: { entityId: { in: created.entities } },
      select: { id: true },
    });
    const versionIds = versions.map((v: { id: string }) => v.id);
    await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.entityVersionKeyword.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.entityKeyword.deleteMany({ where: { entityId: { in: created.entities } } });
    await prisma.entityRelationship.deleteMany({
      where: {
        OR: [{ sourceEntityId: { in: created.entities } }, { targetEntityId: { in: created.entities } }],
      },
    });
    await prisma.entityAlias.deleteMany({ where: { entityId: { in: created.entities } } });
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: created.entities } } });
    await prisma.keywordDefinition.deleteMany({ where: { id: { in: created.keywords } } });
    await prisma.keywordCategory.deleteMany({ where: { id: { in: created.categories } } });
    await prisma.sourceDocument.deleteMany({ where: { id: { in: created.documents } } });
  });

  describe("migration ledger and schema shape (§26–27)", () => {
    const EXPECTED = [
      "20260930235722_init",
      "20261001045349_add_entity",
      "20261001212804_add_entity_version",
      "20261001215241_add_entity_version_updated_at",
      "20261002022400_add_entity_alias",
      "20261002025218_add_keyword_foundation",
      "20261002225710_add_entity_relationship",
      "20261002231523_add_source_provenance",
    ];

    it("a database built by `prisma migrate deploy` has applied exactly the approved M1 chain, in order, none failed or rolled back", async () => {
      const rows = await prisma.$queryRaw<
        Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
      >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name ASC`;
      expect(rows.length).toBeGreaterThanOrEqual(EXPECTED.length);
      // Prefix match: a later milestone appending migrations must not break the M1 gate.
      expect(rows.slice(0, EXPECTED.length).map((r) => r.migration_name)).toEqual(EXPECTED);
      for (const row of rows) {
        expect(row.finished_at, row.migration_name).not.toBeNull();
        expect(row.rolled_back_at, row.migration_name).toBeNull();
      }
    });

    it("every M1 table exists", async () => {
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
      const names = rows.map((r) => r.table_name);
      for (const table of [
        "entities",
        "entity_versions",
        "entity_aliases",
        "keyword_categories",
        "keyword_definitions",
        "entity_keywords",
        "entity_version_keywords",
        "entity_relationships",
        "source_documents",
        "source_references",
      ]) {
        expect(names, table).toContain(table);
      }
    });

    it("no column anywhere in the live database encodes a global current/active version", async () => {
      const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'`;
      for (const { column_name } of rows) {
        expect(column_name).not.toMatch(
          /^(is_current|current_version_id|current_version|active_version|active_rule|global_current_revision)$/,
        );
      }
    });
  });

  describe("referential integrity: historical records cannot be deleted out from under their dependents (§13)", () => {
    it("Entity with EntityVersions", async () => {
      const e = await entity("ri_version");
      await createEntityVersion(e.id, { displayName: "v" });
      await expectProtected(prisma.entity.delete({ where: { id: e.id } }), () =>
        prisma.entity.findUnique({ where: { id: e.id } }),
      );
    });

    it("Entity with Aliases", async () => {
      const e = await entity("ri_alias");
      await createEntityAlias(e.id, { alias: `Audit Alias ${tag}` });
      await expectProtected(prisma.entity.delete({ where: { id: e.id } }), () =>
        prisma.entity.findUnique({ where: { id: e.id } }),
      );
    });

    it("Entity with Entity-level Keyword assignments", async () => {
      const e = await entity("ri_kw");
      const k = await keyword("ri_entity_kw");
      await assignKeywordToEntity(e.id, k.id);
      await expectProtected(prisma.entity.delete({ where: { id: e.id } }), () =>
        prisma.entity.findUnique({ where: { id: e.id } }),
      );
    });

    it("Entity participating in a Relationship — as source AND as target", async () => {
      const source = await entity("ri_rel_source");
      const target = await entity("ri_rel_target");
      await createEntityRelationship({
        sourceEntityId: source.id,
        targetEntityId: target.id,
        relationshipType: "REQUIRES",
      });
      await expectProtected(prisma.entity.delete({ where: { id: source.id } }), () =>
        prisma.entity.findUnique({ where: { id: source.id } }),
      );
      await expectProtected(prisma.entity.delete({ where: { id: target.id } }), () =>
        prisma.entity.findUnique({ where: { id: target.id } }),
      );
    });

    it("KeywordDefinition assigned to an Entity", async () => {
      const e = await entity("ri_kwdef_entity");
      const k = await keyword("ri_kwdef_entity");
      await assignKeywordToEntity(e.id, k.id);
      await expectProtected(prisma.keywordDefinition.delete({ where: { id: k.id } }), () =>
        prisma.keywordDefinition.findUnique({ where: { id: k.id } }),
      );
    });

    it("KeywordDefinition assigned to an EntityVersion", async () => {
      const e = await entity("ri_kwdef_version");
      const v = await createEntityVersion(e.id, { displayName: "v" });
      const k = await keyword("ri_kwdef_version");
      await assignKeywordToEntityVersion(v.id, k.id);
      await expectProtected(prisma.keywordDefinition.delete({ where: { id: k.id } }), () =>
        prisma.keywordDefinition.findUnique({ where: { id: k.id } }),
      );
    });

    it("KeywordCategory that still has KeywordDefinitions", async () => {
      const category = await createKeywordCategory({ canonicalKey: key("ri_category"), name: "Audit Category" });
      created.categories.push(category.id);
      await keyword("ri_in_category", category.id);
      await expectProtected(prisma.keywordCategory.delete({ where: { id: category.id } }), () =>
        prisma.keywordCategory.findUnique({ where: { id: category.id } }),
      );
    });

    it("SourceDocument with SourceReferences", async () => {
      const e = await entity("ri_source");
      const v = await createEntityVersion(e.id, { displayName: "v" });
      const d = await document("ri_source");
      await createSourceReference(v.id, { sourceDocumentId: d.id });
      await expectProtected(prisma.sourceDocument.delete({ where: { id: d.id } }), () =>
        prisma.sourceDocument.findUnique({ where: { id: d.id } }),
      );
    });

    it("EntityVersion with SourceReferences, with Version Keywords, and as a lineage parent", async () => {
      const e = await entity("ri_version_dependents");
      const parent = await createEntityVersion(e.id, { displayName: "parent" });
      await createEntityVersion(e.id, { displayName: "child", parentVersionId: parent.id });
      const d = await document("ri_version_dependents");
      await createSourceReference(parent.id, { sourceDocumentId: d.id });
      const k = await keyword("ri_version_dependents");
      await assignKeywordToEntityVersion(parent.id, k.id);

      await expectProtected(prisma.entityVersion.delete({ where: { id: parent.id } }), () =>
        prisma.entityVersion.findUnique({ where: { id: parent.id } }),
      );
      // The dependents are all intact too.
      expect(await prisma.sourceReference.count({ where: { entityVersionId: parent.id } })).toBe(1);
      expect(await prisma.entityVersionKeyword.count({ where: { entityVersionId: parent.id } })).toBe(1);
      expect(await prisma.entityVersion.count({ where: { parentVersionId: parent.id } })).toBe(1);
    });
  });

  describe("revision allocation and lineage (§7–8)", () => {
    it("allocates 1, 2, 3 automatically, and a different Entity independently starts at 1", async () => {
      const a = await entity("alloc_a");
      const b = await entity("alloc_b");
      const numbers = [];
      for (const name of ["one", "two", "three"]) {
        numbers.push((await createEntityVersion(a.id, { displayName: name })).revisionNumber);
      }
      expect(numbers).toEqual([1, 2, 3]);
      expect((await createEntityVersion(b.id, { displayName: "b-one" })).revisionNumber).toBe(1);
    });

    it("the database itself rejects a duplicate (entity, revisionNumber) pair", async () => {
      const e = await entity("alloc_unique");
      await createEntityVersion(e.id, { displayName: "first" });
      await expect(
        prisma.entityVersion.create({ data: { entityId: e.id, revisionNumber: 1, displayName: "dup" } }),
      ).rejects.toThrow();
      expect(await prisma.entityVersion.count({ where: { entityId: e.id } })).toBe(1);
    });

    it("concurrent creation never yields duplicate revision numbers (see also entity-version.test.ts, which owns the heavier concurrency proof)", async () => {
      const e = await entity("alloc_concurrent");
      const results = await Promise.all(
        [1, 2, 3, 4].map((n) => createEntityVersion(e.id, { displayName: `concurrent ${n}` })),
      );
      expect(results.map((v) => v.revisionNumber).sort()).toEqual([1, 2, 3, 4]);
    });

    it("lineage is explicit: Revision 3 can descend from Revision 1, and is never inferred from numbering", async () => {
      const e = await entity("lineage");
      const r1 = await createEntityVersion(e.id, { displayName: "r1" });
      const r2 = await createEntityVersion(e.id, { displayName: "r2", parentVersionId: r1.id });
      const r3 = await createEntityVersion(e.id, { displayName: "r3", parentVersionId: r1.id });
      const r4 = await createEntityVersion(e.id, { displayName: "r4" });

      const byRevision = new Map((await listEntityVersions(e.id)).map((v) => [v.revisionNumber, v]));
      expect(byRevision.get(1)?.parentVersionId).toBeNull();
      expect(byRevision.get(2)?.parentVersionId).toBe(r1.id);
      expect(byRevision.get(3)?.parentVersionId).toBe(r1.id);
      expect(byRevision.get(3)?.parentVersionId).not.toBe(r2.id);
      expect(byRevision.get(4)?.parentVersionId).toBeNull(); // not auto-parented to Revision 3
      expect(r3.parentVersionId).toBe(r1.id);
      expect(r4.parentVersionId).toBeNull();
    });

    it("a parent belonging to a different Entity is rejected with ENTITY_VERSION.INVALID_PARENT", async () => {
      const a = await entity("lineage_cross_a");
      const b = await entity("lineage_cross_b");
      const foreign = await createEntityVersion(a.id, { displayName: "foreign" });
      const attempt = createEntityVersion(b.id, { displayName: "child", parentVersionId: foreign.id });
      await expect(attempt).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.INVALID_PARENT });
      await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
    });
  });

  describe("protected Versions (§5)", () => {
    it("a CANON Version rejects content edits and Version-Keyword assignment, and is left exactly as it was", async () => {
      const e = await entity("immutable");
      const v = await createEntityVersion(e.id, {
        displayName: "Locked",
        rulesText: "locked text",
        structuredData: { value: 1 },
      });
      for (const next of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) {
        await transitionEntityVersionStatus(v.id, next);
      }
      const before = await prisma.entityVersion.findUnique({ where: { id: v.id } });

      await expect(updateDraftEntityVersion(v.id, { displayName: "Changed" })).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      });
      await expect(updateDraftEntityVersion(v.id, { rulesText: "Changed" })).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      });
      await expect(updateDraftEntityVersion(v.id, { structuredData: { value: 2 } })).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      });
      const k = await keyword("immutable_kw");
      await expect(assignKeywordToEntityVersion(v.id, k.id)).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      });

      expect(await prisma.entityVersion.findUnique({ where: { id: v.id } })).toEqual(before);
    });
  });
});
