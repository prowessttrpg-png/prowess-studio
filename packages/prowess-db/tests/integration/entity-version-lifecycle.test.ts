/**
 * EntityVersion lifecycle & mutation integration tests (PAS-10 M1-WO3
 * §20–29).
 *
 * Runs only against prowess_studio_test — see tests/integration/setup.mjs
 * and the assertRunningAgainstTestDatabase() guard in beforeAll below.
 * Uses only the public Entity/EntityVersion services.
 */
import {
  DomainError,
  ENTITY_VERSION_ERROR_CODES,
  type EntityVersion,
  type EntityVersionStatus,
} from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as DbPackage from "../../src/index";
import {
  createEntity,
  createEntityVersion,
  getEntityVersion,
  prisma,
  transitionEntityVersionStatus,
  updateDraftEntityVersion,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const TEST_DATABASE_URL = getTestDatabaseUrl();
const FIXTURE_PREFIX = "test.";
let fixtureCounter = 0;

/** Unique canonical keys per test, so tests never collide with each other. */
function nextCanonicalKey(label: string): string {
  fixtureCounter += 1;
  return `${FIXTURE_PREFIX}lifecycle.${label}_${fixtureCounter}`;
}

/** Creates an Entity plus a single DRAFT EntityVersion for it. */
async function createDraftVersion(
  label: string,
  overrides: Partial<Parameters<typeof createEntityVersion>[1]> = {},
): Promise<EntityVersion> {
  const entity = await createEntity({
    entityType: "GENERIC_RULE",
    canonicalKey: nextCanonicalKey(label),
  });
  return createEntityVersion(entity.id, { displayName: label, ...overrides });
}

/** Applies a sequence of valid transitions in order, returning the final Version. */
async function progressThrough(
  versionId: string,
  path: readonly EntityVersionStatus[],
): Promise<EntityVersion> {
  let current: EntityVersion | undefined;
  for (const status of path) {
    current = await transitionEntityVersionStatus(versionId, status);
  }
  return current!;
}

describe("EntityVersion lifecycle & mutation (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const testEntities = await prisma.entity.findMany({
      where: { canonicalKey: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const testEntityIds = testEntities.map((e) => e.id);
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: testEntityIds } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: FIXTURE_PREFIX } } });
  });

  it("updates a DRAFT Version's content, changing updatedAt but not createdAt/id/revisionNumber", async () => {
    const draft = await createDraftVersion("draft_mutation", {
      structuredData: { value: 1 },
    });

    // Ensure a measurable clock difference before the update.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await updateDraftEntityVersion(draft.id, {
      displayName: "Updated Name",
      rulesText: "New rules text",
      structuredData: { value: 2 },
    });

    expect(updated.id).toBe(draft.id);
    expect(updated.revisionNumber).toBe(draft.revisionNumber);
    expect(updated.displayName).toBe("Updated Name");
    expect(updated.rulesText).toBe("New rules text");
    expect(updated.structuredData).toEqual({ value: 2 });
    expect(updated.createdAt.getTime()).toBe(draft.createdAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThan(draft.updatedAt.getTime());
  });

  describe("protected statuses reject content mutation with ENTITY_VERSION.IMMUTABLE", () => {
    const cases: Array<{ status: EntityVersionStatus; path: EntityVersionStatus[] }> = [
      { status: "IN_REVIEW", path: ["IN_REVIEW"] },
      { status: "APPROVED", path: ["IN_REVIEW", "APPROVED"] },
      { status: "PLAYTEST", path: ["IN_REVIEW", "APPROVED", "PLAYTEST"] },
      { status: "CANON", path: ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"] },
      {
        status: "SUPERSEDED",
        path: ["IN_REVIEW", "APPROVED", "PLAYTEST", "SUPERSEDED"],
      },
      { status: "ARCHIVED", path: ["ARCHIVED"] },
    ];

    it.each(cases)("rejects mutation once a Version reaches $status", async ({ status, path }) => {
      const draft = await createDraftVersion(`protected_${status.toLowerCase()}`);
      const progressed = await progressThrough(draft.id, path);
      expect(progressed.status).toBe(status);

      const attempt = updateDraftEntityVersion(draft.id, { displayName: "Should not apply" });

      await expect(attempt).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE });
      await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);

      const stillUnchanged = await getEntityVersion(draft.id);
      expect(stillUnchanged.displayName).not.toBe("Should not apply");
    });
  });

  it("allows IN_REVIEW to reopen to DRAFT and become editable again", async () => {
    const draft = await createDraftVersion("reopen_review");
    await transitionEntityVersionStatus(draft.id, "IN_REVIEW");

    const blocked = updateDraftEntityVersion(draft.id, { displayName: "Blocked" });
    await expect(blocked).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE });

    await transitionEntityVersionStatus(draft.id, "DRAFT");
    const edited = await updateDraftEntityVersion(draft.id, { displayName: "Edited after reopen" });

    expect(edited.displayName).toBe("Edited after reopen");
    expect(edited.status).toBe("DRAFT");
  });

  it("progresses through the full valid lifecycle sequence, persisting each transition", async () => {
    const draft = await createDraftVersion("full_progression");
    const sequence: EntityVersionStatus[] = [
      "IN_REVIEW",
      "APPROVED",
      "PLAYTEST",
      "CANON",
      "SUPERSEDED",
      "ARCHIVED",
    ];

    for (const status of sequence) {
      const result = await transitionEntityVersionStatus(draft.id, status);
      expect(result.status).toBe(status);
      const reread = await getEntityVersion(draft.id);
      expect(reread.status).toBe(status);
    }
  });

  describe("invalid transitions are rejected and leave status unchanged", () => {
    it("DRAFT -> CANON is rejected", async () => {
      const draft = await createDraftVersion("invalid_draft_to_canon");
      await expect(transitionEntityVersionStatus(draft.id, "CANON")).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.INVALID_STATUS_TRANSITION,
      });
      const reread = await getEntityVersion(draft.id);
      expect(reread.status).toBe("DRAFT");
    });

    it("CANON -> DRAFT is rejected", async () => {
      const draft = await createDraftVersion("invalid_canon_to_draft");
      await progressThrough(draft.id, ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]);
      await expect(transitionEntityVersionStatus(draft.id, "DRAFT")).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.INVALID_STATUS_TRANSITION,
      });
      const reread = await getEntityVersion(draft.id);
      expect(reread.status).toBe("CANON");
    });

    it("ARCHIVED -> DRAFT is rejected (ARCHIVED is terminal)", async () => {
      const draft = await createDraftVersion("invalid_archived_to_draft");
      await progressThrough(draft.id, ["ARCHIVED"]);
      await expect(transitionEntityVersionStatus(draft.id, "DRAFT")).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.INVALID_STATUS_TRANSITION,
      });
      const reread = await getEntityVersion(draft.id);
      expect(reread.status).toBe("ARCHIVED");
    });

    it("SUPERSEDED -> CANON is rejected", async () => {
      const draft = await createDraftVersion("invalid_superseded_to_canon");
      await progressThrough(draft.id, ["IN_REVIEW", "APPROVED", "PLAYTEST", "SUPERSEDED"]);
      await expect(transitionEntityVersionStatus(draft.id, "CANON")).rejects.toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.INVALID_STATUS_TRANSITION,
      });
      const reread = await getEntityVersion(draft.id);
      expect(reread.status).toBe("SUPERSEDED");
    });
  });

  it("lets a CANON Version serve as the parent of a new DRAFT revision, unchanged", async () => {
    const rev1 = await createDraftVersion("canon_parent", { structuredData: { value: 10 } });
    const entityId = rev1.entityId;
    await progressThrough(rev1.id, ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]);

    const rev2 = await createEntityVersion(entityId, {
      displayName: "Successor",
      parentVersionId: rev1.id,
    });

    expect(rev2.status).toBe("DRAFT");
    expect(rev2.parentVersionId).toBe(rev1.id);

    const rev1AfterChildCreation = await getEntityVersion(rev1.id);
    expect(rev1AfterChildCreation.status).toBe("CANON");
    expect(rev1AfterChildCreation.structuredData).toEqual({ value: 10 });
  });

  it("keeps historical revisions independent through a DRAFT mutation, then protects the mutated one", async () => {
    const rev1 = await createDraftVersion("historical_independence", {
      structuredData: { value: 10 },
    });
    const entityId = rev1.entityId;
    const rev2 = await createEntityVersion(entityId, {
      displayName: "Revision 2",
      structuredData: { value: 20 },
    });

    const rev2Mutated = await updateDraftEntityVersion(rev2.id, { structuredData: { value: 30 } });
    expect(rev2Mutated.structuredData).toEqual({ value: 30 });

    const rev1Unchanged = await getEntityVersion(rev1.id);
    expect(rev1Unchanged.structuredData).toEqual({ value: 10 });

    await transitionEntityVersionStatus(rev2.id, "IN_REVIEW");
    const furtherMutation = updateDraftEntityVersion(rev2.id, { structuredData: { value: 40 } });
    await expect(furtherMutation).rejects.toMatchObject({ code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE });
  });

  it("race safety: a concurrent content mutation and DRAFT->IN_REVIEW transition never corrupt state", async () => {
    const draft = await createDraftVersion("race_safety", { displayName: "Original" });

    const [mutationResult, transitionResult] = await Promise.allSettled([
      updateDraftEntityVersion(draft.id, { displayName: "Mutated" }),
      transitionEntityVersionStatus(draft.id, "IN_REVIEW"),
    ]);

    // The transition has no content precondition beyond status === DRAFT,
    // which held at least once — it must always eventually succeed.
    expect(transitionResult.status).toBe("fulfilled");

    const final = await getEntityVersion(draft.id);
    expect(final.status).toBe("IN_REVIEW");

    if (mutationResult.status === "fulfilled") {
      // The mutation's atomic UPDATE committed before the transition's —
      // valid outcome (a): content changed, and the transition still
      // succeeded afterward since it doesn't check content.
      expect(final.displayName).toBe("Mutated");
    } else {
      // The transition's atomic UPDATE committed first — valid outcome
      // (b): the mutation's conditional WHERE status='DRAFT' matched
      // nothing once status had already moved, so it must have failed
      // with exactly IMMUTABLE, never a raw/opaque error, and content
      // must be untouched.
      expect(mutationResult.reason).toMatchObject({
        code: ENTITY_VERSION_ERROR_CODES.IMMUTABLE,
      });
      expect(final.displayName).toBe("Original");
    }
  });

  it("exposes no public operation that bypasses lifecycle rules via a generic update", () => {
    // Regression guard (PAS-10 M1-WO3 §29): enumerate @prowess/db's actual
    // public export surface and confirm it matches exactly the intended
    // allowlist — no generic `updateEntityVersion`/`setEntityVersion`-style
    // function, and no raw Prisma update payload type, ever gets added
    // without this test failing first.
    const exportedNames = Object.keys(DbPackage).sort();
    // M3-WO3 added extractImportBatch (explicit, idempotent extraction of the Batch's exact registered extractor),
    // getExtractionResult and verifyExtractionOutput (reads). No status setter, review or Entity operation.
    // M3-WO2 added createImportBatch (idempotent), recordExtractionCandidates (idempotent, atomic, INSERT-only) and
    // reads (get/list Batch, Batch summary, get/list Candidate). No update, delete, status setter or review operation.
    // M3-WO1 added the structured-source layer: one creation (createSourceSnapshot), two idempotent INSERT-only
    // ingestions (ingestSourceSnapshot, ingestSourceStructure), the structural parser and its constants, a hash
    // helper, and reads. No update, delete or status setter for any source-structure record.
    // M2-WO8 added five review transitions and six release operations (publish + five reads; no release mutation or delete).
    // M2-WO7 added five ChangeSet operations (create, two reads, explicit decision translation, read-only impact; no apply/execute).
    // M2-WO6 added four decision operations (create + reads only; no update, apply, delete, or status setter).
    // M2-WO5 added four conflict operations (create + reads only; no status transition, edit, or delete).
    // M2-WO4 added six policy operations (create + reads + authority resolution; no mutation).
    // M2-WO3 added two inheritance operations (effective resolution and effective composition; reads only).
    // M2-WO2 added six manifest operations (create + reads only; no entry mutation).
    // M2-WO1 added createRuleset / findRulesetByCanonicalKey / getRuleset / listRulesets
    // (read + create only — no Ruleset mutation is exposed yet).
    // M1-WO11: this allowlist was frozen at M1-WO3's 13 names and never
    // updated as M1-WO4..WO8 legitimately added more (found by the first real
    // CI run). It is now the reviewed M1 surface. Adding an export still
    // fails this test first, by design — update the list deliberately.
    expect(exportedNames).toEqual(
      [
        "UnsafeTestDatabaseResetError",
        "assertRunningAgainstTestDatabase",
        "assertSafeToResetTestDatabase",
        "assignKeywordToEntity",
        "assignKeywordToEntityVersion",
        "createEntity",
        "createCanonPolicy",
        "createCanonDecision",
        "createChangeSet",
        "createMigrationPlan",
        "getMigrationPlan",
        "listMigrationPlans",
        "previewRulesetMigration",
        "submitChangeSetForReview",
        "approveChangeSet",
        "rejectChangeSet",
        "submitRulesetForReview",
        "approveRuleset",
        "publishRulesetRelease",
        "getRulesetRelease",
        "listRulesetReleases",
        "getLatestRulesetRelease",
        "verifyRulesetReleaseManifestHash",
        "compareRulesetReleases",
        "createRuleConflict",
        "createEntityAlias",
        "createEntityRelationship",
        "createEntityVersion",
        "createRuleset",
        "createRulesetManifest",
        "createKeywordCategory",
        "createKeywordDefinition",
        "createSourceDocument",
        "createSourceReference",
        "createSourceSnapshot",
        "createImportBatch",
        "getImportBatch",
        "getImportBatchSummary",
        "listImportBatches",
        "recordExtractionCandidates",
        "getExtractionCandidate",
        "listExtractionCandidates",
        "extractImportBatch",
        "getExtractionResult",
        "verifyExtractionOutput",
        "DOCX_MIME_TYPE",
        "DOCX_PARSER_NAME",
        "DOCX_PARSER_VERSION",
        "findSourceSnapshotByContentHash",
        "getSourceAsset",
        "getSourceBlock",
        "getSourceSection",
        "getSourceSectionContent",
        "getSourceSnapshot",
        "getSourceSnapshotIngestion",
        "getSourceStructure",
        "getSourceTable",
        "hashSourceStructure",
        "ingestSourceSnapshot",
        "ingestSourceStructure",
        "listSourceAssetPlacements",
        "listSourceAssets",
        "listSourceSectionChildren",
        "listSourceSnapshots",
        "parseDocxStructure",
        "findEntitiesByAlias",
        "findEntitiesByKeyword",
        "findEntityByCanonicalKey",
        "findEntityVersionsByKeyword",
        "findKeywordCategoryByCanonicalKey",
        "findKeywordDefinitionByCanonicalKey",
        "findRulesetByCanonicalKey",
        "getEntityById",
        "getEffectiveManifestEntries",
        "getCanonPolicy",
        "getCanonDecision",
        "getChangeSet",
        "getRuleConflict",
        "getEntityRelationship",
        "getEntityVersion",
        "getIncomingRelationships",
        "getKeywordCategory",
        "getKeywordDefinition",
        "getLatestEntityVersion",
        "getLatestCanonPolicy",
        "getLatestRulesetManifest",
        "getManifestEntry",
        "getOutgoingRelationships",
        "getRuleset",
        "getRulesetManifest",
        "getSourceDocument",
        "getSourceReference",
        "getSourceAuthorityRecord",
        "listEntities",
        "listCanonPolicies",
        "listCanonDecisions",
        "listCanonDecisionsForConflict",
        "listChangeSets",
        "proposeChangeSetFromCanonDecision",
        "analyzeChangeSetImpact",
        "listRuleConflicts",
        "listRuleConflictsForEntity",
        "listEntityAliases",
        "listEntityKeywords",
        "listEntityVersionKeywords",
        "listEntityVersions",
        "listKeywordCategories",
        "listKeywordDefinitions",
        "listRulesets",
        "listRulesetManifests",
        "listSourceDocuments",
        "listSourceReferencesForDocument",
        "listSourceReferencesForVersion",
        "prisma",
        "removeEntityAlias",
        "removeEntityRelationship",
        "removeKeywordFromEntity",
        "removeKeywordFromEntityVersion",
        "removeSourceReference",
        "resolveEffectiveEntityVersion",
        "resolveSourceAuthority",
        "resolveEntityVersionFromManifest",
        "transitionEntityVersionStatus",
        "updateDraftEntityVersion",
      ].sort(),
    );

    // The property this guard exists for, stated directly: the ONLY mutating
    // "update"/"set"/"delete"-style operation on a Version is the
    // lifecycle-aware updateDraftEntityVersion (+ status transition). No
    // generic bypass may appear, whatever else is added to the surface.
    const mutatorLike = exportedNames.filter((n) => /^(update|set|patch|overwrite|delete|upsert)/i.test(n));
    expect(mutatorLike).toEqual(["updateDraftEntityVersion"]);
  });
});
