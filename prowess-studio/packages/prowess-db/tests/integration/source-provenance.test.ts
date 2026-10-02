/**
 * Source provenance database integration tests (PAS-10 M1-WO7 §29–42).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 */
import {
  DomainError,
  ENTITY_VERSION_ERROR_CODES,
  SOURCE_DOCUMENT_ERROR_CODES,
  SOURCE_REFERENCE_ERROR_CODES,
} from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityVersion,
  createSourceDocument,
  createSourceReference,
  getEntityVersion,
  getSourceDocument,
  getSourceReference,
  listSourceReferencesForVersion,
  prisma,
  removeSourceReference,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.source";
let fixtureCounter = 0;

function nextCanonicalKey(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_PREFIX}.${label}_${fixtureCounter}`;
}

async function createTestEntity(label: string) {
  return createEntity({ entityType: "GENERIC_RULE", canonicalKey: nextCanonicalKey(label) });
}

async function createTestDocument(title: string, overrides: Record<string, unknown> = {}) {
  return createSourceDocument({ title, sourceType: "DOCUMENT", ...overrides });
}

describe("Source provenance (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const testEntities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const testEntityIds = testEntities.map((e) => e.id);
    const testVersions = await prisma.entityVersion.findMany({
      where: { entityId: { in: testEntityIds } },
      select: { id: true },
    });
    const testVersionIds = testVersions.map((v) => v.id);
    await prisma.sourceReference.deleteMany({
      where: { entityVersionId: { in: testVersionIds } },
    });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
    await prisma.sourceDocument.deleteMany({
      where: { title: { startsWith: "Test " } },
    });
  });

  describe("SourceDocument", () => {
    it("creates and retrieves a SourceDocument, with metadata round-tripping exactly", async () => {
      const created = await createSourceDocument({
        title: "Test Spellcasting Source",
        sourceType: "DOCUMENT",
        versionLabel: "v1",
      });

      expect(created.title).toBe("Test Spellcasting Source");
      expect(created.sourceType).toBe("DOCUMENT");
      expect(created.versionLabel).toBe("v1");
      expect(created.authorityStatus).toBeNull();

      const fetched = await getSourceDocument(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.title).toBe("Test Spellcasting Source");
      expect(fetched.versionLabel).toBe("v1");
    });

    it("persists authorityStatus as descriptive metadata only, with no side effects", async () => {
      const entity = await createTestEntity("authority_entity");
      const version = await createEntityVersion(entity.id, { displayName: "Unaffected" });
      const otherDoc = await createTestDocument("Test Supplemental Source", {
        authorityStatus: "REFERENCE_ONLY",
      });

      const document = await createTestDocument("Test Playtest Source", {
        authorityStatus: "PLAYTEST_REFERENCE",
      });

      expect(document.authorityStatus).toBe("PLAYTEST_REFERENCE");

      // No application behavior automatically changed anything else.
      const versionAfter = await getEntityVersion(version.id);
      expect(versionAfter.status).toBe("DRAFT");
      const entityAfter = await prisma.entity.findUnique({ where: { id: entity.id } });
      expect(entityAfter?.canonicalKey).toBe(entity.canonicalKey);
      const otherDocAfter = await getSourceDocument(otherDoc.id);
      expect(otherDocAfter.authorityStatus).toBe("REFERENCE_ONLY");
    });

    it("persists an opaque fileReference exactly, without interpreting it", async () => {
      const document = await createSourceDocument({
        title: "Test File Reference Source",
        sourceType: "OTHER",
        fileReference: "project-file:test-spellcasting",
      });

      const fetched = await getSourceDocument(document.id);
      expect(fetched.fileReference).toBe("project-file:test-spellcasting");
    });

    it("rejects creation with an unrecognized sourceType", async () => {
      const attempt = createSourceDocument({
        title: "Test Invalid Type Source",
        sourceType: "PDF",
      });
      await expect(attempt).rejects.toMatchObject({
        code: SOURCE_DOCUMENT_ERROR_CODES.INVALID_INPUT,
      });
    });
  });

  describe("SourceReference", () => {
    it("attaches a SourceReference to a DRAFT Version and retrieves it", async () => {
      const entity = await createTestEntity("basic_rule");
      const version = await createEntityVersion(entity.id, { displayName: "Rev 1" });
      const document = await createTestDocument("Test Spellcasting Basic");

      const reference = await createSourceReference(version.id, {
        sourceDocumentId: document.id,
        sectionLabel: "Direct Damage",
        pageReference: "14-16",
      });

      expect(reference.entityVersionId).toBe(version.id);
      expect(reference.sourceDocumentId).toBe(document.id);
      expect(reference.sectionLabel).toBe("Direct Damage");
      expect(reference.pageReference).toBe("14-16");

      const fetched = await getSourceReference(reference.id);
      expect(fetched.entityVersionId).toBe(version.id);
      expect(fetched.sourceDocumentId).toBe(document.id);
    });

    it("allows multiple SourceDocuments attached to one Version, listed deterministically", async () => {
      const entity = await createTestEntity("multi_source");
      const version = await createEntityVersion(entity.id, { displayName: "Rev" });
      const docA = await createTestDocument("Test Spellcasting A");
      const docB = await createTestDocument("Test Modular Spell Design B");

      await createSourceReference(version.id, { sourceDocumentId: docA.id });
      await createSourceReference(version.id, { sourceDocumentId: docB.id });

      const references = await listSourceReferencesForVersion(version.id);
      expect(references.map((r) => r.sourceDocumentId).sort()).toEqual([docA.id, docB.id].sort());
    });

    it("allows the same SourceDocument attached independently to two different Versions", async () => {
      const entity = await createTestEntity("same_source_two_versions");
      const rev1 = await createEntityVersion(entity.id, { displayName: "Rev 1" });
      const rev2 = await createEntityVersion(entity.id, { displayName: "Rev 2" });
      const document = await createTestDocument("Test Shared Source");

      const ref1 = await createSourceReference(rev1.id, { sourceDocumentId: document.id });
      const ref2 = await createSourceReference(rev2.id, { sourceDocumentId: document.id });

      expect(ref1.id).not.toBe(ref2.id);
      const rev1Refs = await listSourceReferencesForVersion(rev1.id);
      const rev2Refs = await listSourceReferencesForVersion(rev2.id);
      expect(rev1Refs.map((r) => r.id)).toEqual([ref1.id]);
      expect(rev2Refs.map((r) => r.id)).toEqual([ref2.id]);
    });

    it("version independence: each revision's SourceReferences are independent, with no automatic propagation", async () => {
      const entity = await createTestEntity("version_independence");
      const rev1 = await createEntityVersion(entity.id, { displayName: "Rev 1" });
      const docA = await createTestDocument("Test Source A Independence");

      await createSourceReference(rev1.id, { sourceDocumentId: docA.id });

      const rev2 = await createEntityVersion(entity.id, { displayName: "Rev 2" });
      const docB = await createTestDocument("Test Source B Independence");
      await createSourceReference(rev2.id, { sourceDocumentId: docB.id });

      const rev1Refs = await listSourceReferencesForVersion(rev1.id);
      const rev2Refs = await listSourceReferencesForVersion(rev2.id);
      expect(rev1Refs.map((r) => r.sourceDocumentId)).toEqual([docA.id]);
      expect(rev2Refs.map((r) => r.sourceDocumentId)).toEqual([docB.id]);
    });

    it("allows attaching provenance to a protected (CANON) Version without mutating its content", async () => {
      const entity = await createTestEntity("protected_version");
      const version = await createEntityVersion(entity.id, {
        displayName: "Protected Rule",
        structuredData: { value: 10 },
        rulesText: "Original rules",
      });
      await transitionEntityVersionStatus(version.id, "IN_REVIEW");
      await transitionEntityVersionStatus(version.id, "APPROVED");
      await transitionEntityVersionStatus(version.id, "PLAYTEST");
      await transitionEntityVersionStatus(version.id, "CANON");
      const document = await createTestDocument("Test Canon Source");

      const reference = await createSourceReference(version.id, {
        sourceDocumentId: document.id,
        sectionLabel: "Canon Rule",
      });
      expect(reference.entityVersionId).toBe(version.id);

      const after = await getEntityVersion(version.id);
      expect(after.status).toBe("CANON");
      expect(after.rulesText).toBe("Original rules");
      expect(after.structuredData).toEqual({ value: 10 });
      expect(after.displayName).toBe("Protected Rule");
      expect(after.revisionNumber).toBe(version.revisionNumber);
    });

    it("no implicit mechanics: a GOVERNING SourceDocument does not alter the attached Version", async () => {
      const entity = await createTestEntity("no_mechanics");
      const version = await createEntityVersion(entity.id, {
        displayName: "Unaffected",
        structuredData: { value: 10 },
      });
      const document = await createTestDocument("Test Governing Source", {
        authorityStatus: "GOVERNING",
      });

      await createSourceReference(version.id, { sourceDocumentId: document.id });

      const after = await getEntityVersion(version.id);
      expect(after.structuredData).toEqual({ value: 10 });
      expect(after.status).toBe("DRAFT");
      expect(after.revisionNumber).toBe(version.revisionNumber);
    });

    it("rejects attachment to a nonexistent SourceDocument, persisting nothing", async () => {
      const entity = await createTestEntity("missing_document");
      const version = await createEntityVersion(entity.id, { displayName: "Rev" });
      const nonexistentId = "00000000-0000-4000-8000-000000000000";

      const attempt = createSourceReference(version.id, { sourceDocumentId: nonexistentId });

      await expect(attempt).rejects.toMatchObject({ code: SOURCE_DOCUMENT_ERROR_CODES.NOT_FOUND });
      await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
      const refs = await listSourceReferencesForVersion(version.id);
      expect(refs).toEqual([]);
    });

    it("rejects attachment to a nonexistent EntityVersion", async () => {
      const document = await createTestDocument("Test Missing Version Source");
      const nonexistentId = "00000000-0000-4000-8000-000000000000";

      const attempt = createSourceReference(nonexistentId, { sourceDocumentId: document.id });

      await expect(attempt).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.NOT_FOUND });
    });

    it("removal deletes only the SourceReference — SourceDocument, Entity, and Version remain", async () => {
      const entity = await createTestEntity("removal");
      const version = await createEntityVersion(entity.id, { displayName: "Rev" });
      const document = await createTestDocument("Test Removal Source");
      const keptReference = await createSourceReference(version.id, {
        sourceDocumentId: document.id,
        sectionLabel: "Keep",
      });
      const removedDocument = await createTestDocument("Test Removal Source 2");
      const removedReference = await createSourceReference(version.id, {
        sourceDocumentId: removedDocument.id,
        sectionLabel: "Remove",
      });

      await removeSourceReference(removedReference.id);

      await expect(getSourceReference(removedReference.id)).rejects.toMatchObject({
        code: SOURCE_REFERENCE_ERROR_CODES.NOT_FOUND,
      });
      const remaining = await listSourceReferencesForVersion(version.id);
      expect(remaining.map((r) => r.id)).toEqual([keptReference.id]);
      const documentStillExists = await getSourceDocument(document.id);
      expect(documentStillExists).toBeTruthy();
      const entityStillExists = await prisma.entity.findUnique({ where: { id: entity.id } });
      expect(entityStillExists).not.toBeNull();
    });

    it("blocks SourceDocument deletion while a SourceReference exists, and allows it once removed", async () => {
      const entity = await createTestEntity("delete_protection");
      const version = await createEntityVersion(entity.id, { displayName: "Rev" });
      const document = await createTestDocument("Test Delete Protection Source");
      const reference = await createSourceReference(version.id, { sourceDocumentId: document.id });

      await expect(prisma.sourceDocument.delete({ where: { id: document.id } })).rejects.toThrow();

      await removeSourceReference(reference.id);

      await expect(
        prisma.sourceDocument.delete({ where: { id: document.id } }),
      ).resolves.toBeDefined();
    });
  });
});
