/**
 * ChangeSet, ChangeSetOperation, decision translation and impact analysis — database integration tests
 * (PAS-10 M2-WO7 §47–§71). Runs only against prowess_studio_test (guarded), torn down in FK order.
 */
import { CHANGE_SET_ERROR_CODES, DomainError, SOURCE_DOCUMENT_TYPES, type ChangeSetImpactItem, type CreateChangeSetOperationInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeChangeSetImpact,
  assignKeywordToEntity,
  assignKeywordToEntityVersion,
  createCanonDecision,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityRelationship,
  createEntityVersion,
  createKeywordDefinition,
  createRuleConflict,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceReference,
  getChangeSet,
  listChangeSets,
  prisma,
  proposeChangeSetFromCanonDecision,
  resolveEffectiveEntityVersion,
  resolveEntityVersionFromManifest,
  transitionEntityVersionStatus,
} from "../../src/index";
import { insertChangeSetWithOperations } from "../../src/change-set/repository";
import { mapChangeSetWriteError } from "../../src/change-set/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = "00000000-0000-4000-8000-000000000000";
const SOURCE_TITLE_PREFIX = "ChangeSetTest ";
const KEYWORD_PREFIX = `test.cskw_${tag}`;
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, parentRulesetId?: string) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.cs_${label.toLowerCase()}_${tag}_${next()}`,
    name: `ChangeSetTest ${label}`,
    channel: "DEVELOPMENT",
    ...(parentRulesetId === undefined ? {} : { parentRulesetId }),
  });
  rulesetIds.push(r.id);
  return r;
}
async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.changeset.${label.toLowerCase()}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}
const version = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const reference = async (entityVersionId: string, label: string) =>
  createSourceReference(entityVersionId, {
    sourceDocumentId: (await createSourceDocument({ title: `${SOURCE_TITLE_PREFIX}${label} ${tag}_${next()}`, sourceType: SOURCE_DOCUMENT_TYPES[0] as string })).id,
  });

/** Ruleset R, Entity A with A1 + A2, manifest M pinning A1. */
async function base(label: string) {
  const r = await ruleset(label);
  const a = await entity(label);
  const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
  const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
  return { r, a, a1, a2, m };
}

/** An OPEN conflict A1 vs A2 in R, a policy, and a decision of the given shape. */
async function decided(rulesetId: string, entityId: string, a1: string, a2: string, shape: "SELECT_A1" | "SELECT_A2" | "MERGE" | "KEEP" | "DISMISS", mergeResult?: string) {
  const conflict = await createRuleConflict(rulesetId, {
    entityId,
    conflictType: "MECHANICAL_DIVERGENCE",
    severity: "HIGH",
    title: "AP cost",
    candidates: [{ entityVersionId: a1 }, { entityVersionId: a2 }],
  });
  const c1 = conflict.candidates[0]!;
  const c2 = conflict.candidates[1]!;
  const policy = await createCanonPolicy(rulesetId, { name: `P ${next()}`, authorities: [] });
  const common = { canonPolicyId: policy.id, rationale: "because" };
  const input = {
    SELECT_A1: { ...common, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [c1.id] },
    SELECT_A2: { ...common, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [c2.id] },
    MERGE: { ...common, decisionType: "MERGE", conflictDisposition: "RESOLVED", selectedCandidateIds: [c1.id, c2.id], resultEntityVersionId: mergeResult },
    KEEP: { ...common, decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [c1.id, c2.id] },
    DISMISS: { ...common, decisionType: "RESOLVE_CONFLICT", conflictDisposition: "DISMISSED", selectedCandidateIds: [] },
  }[shape];
  const decision = await createCanonDecision(conflict.id, input);
  return { conflict, policy, decision };
}

async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}

/** A content fingerprint of every application table (optionally excluding some), for byte-identical comparisons. */
async function fingerprint(exclude: string[] = []): Promise<Record<string, string>> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    if (exclude.includes(table_name)) continue;
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(
      `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${table_name}" t`,
    );
    out[table_name] = row?.h ?? "";
  }
  return out;
}
const CHANGE_SET_TABLES = ["change_sets", "change_set_operations"];
const countFor = async (rulesetId: string) => ({
  changeSets: await prisma.changeSet.count({ where: { rulesetId } }),
  operations: await prisma.changeSetOperation.count({ where: { rulesetId } }),
});
const has = (items: ChangeSetImpactItem[], category: string, resourceId: string) => items.find((i) => i.category === category && i.resourceId === resourceId);

describe("ChangeSet (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.changeSetOperation.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSet.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.canonDecisionSelection.deleteMany({ where: { canonDecision: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonDecision.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleConflictCandidate.deleteMany({ where: { ruleConflict: { rulesetId: { in: rulesetIds } } } });
    await prisma.ruleConflict.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonPolicy.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.updateMany({ where: { id: { in: rulesetIds } }, data: { parentRulesetId: null } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityRelationship.deleteMany({ where: { OR: [{ sourceEntityId: { in: entityIds } }, { targetEntityId: { in: entityIds } }] } });
    const versionIds = (await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } })).map((v: { id: string }) => v.id);
    await prisma.entityVersionKeyword.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.entityKeyword.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.keywordDefinition.deleteMany({ where: { canonicalKey: { startsWith: KEYWORD_PREFIX } } });
    await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.sourceDocument.deleteMany({ where: { title: { startsWith: SOURCE_TITLE_PREFIX } } });
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  describe("creation (§2, §3, §11, §12, §47, §66–§69)", () => {
    it("persists a DRAFT REPLACE A1 -> A2 proposal; manifest M still resolves A1 and NOTHING outside the ChangeSet tables changes (§47, §66)", async () => {
      const { r, a, a1, a2, m } = await base("basic");
      const before = await fingerprint(CHANGE_SET_TABLES);
      const at = Date.now();

      const cs = await createChangeSet(r.id, {
        name: "  Apply errata  ",
        description: "swap AP rule",
        operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id, targetManifestId: m.id, description: "A1 -> A2" }],
      });

      expect(cs.id).toMatch(UUID);
      expect(cs).toMatchObject({ rulesetId: r.id, canonDecisionId: null, name: "Apply errata", description: "swap AP rule", status: "DRAFT" });
      expect(cs.createdAt.getTime()).toBeGreaterThan(at - 60_000);
      expect(cs.operations).toHaveLength(1);
      expect(cs.operations[0]).toMatchObject({
        changeSetId: cs.id,
        sequence: 1,
        operationType: "REPLACE_ENTITY_VERSION",
        targetEntityId: a.id,
        fromEntityVersionId: a1.id,
        toEntityVersionId: a2.id,
        targetManifestId: m.id,
        description: "A1 -> A2",
      });
      expect(await getChangeSet(cs.id)).toEqual(cs);
      expect((await resolveEntityVersionFromManifest(m.id, a.id))?.id).toBe(a1.id);
      expect(await fingerprint(CHANGE_SET_TABLES)).toEqual(before); // §66–§69: nothing else moved
    });

    it("keeps the author's operation order as sequence 1..n", async () => {
      const { r, a, a1, a2 } = await base("order");
      const b = await entity("orderB");
      const b1 = await version(b.id, "B1");
      const cs = await createChangeSet(r.id, {
        name: "multi",
        operations: [
          { operationType: "PIN_ENTITY_VERSION", targetEntityId: b.id, toEntityVersionId: b1.id },
          { operationType: "DEPRECATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id },
          { operationType: "CREATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a2.id },
        ],
      });
      expect(cs.operations.map((o) => [o.sequence, o.operationType])).toEqual([
        [1, "PIN_ENTITY_VERSION"],
        [2, "DEPRECATE_ENTITY_VERSION"],
        [3, "CREATE_ENTITY_VERSION"],
      ]);
    });

    it("a proposed deprecation does not deprecate; a proposed creation creates nothing (§67)", async () => {
      const { r, a, a1, a2 } = await base("lifecycle");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, status);
      const versionsBefore = await prisma.entityVersion.findMany({ where: { entityId: a.id }, orderBy: { revisionNumber: "asc" } });
      await createChangeSet(r.id, {
        name: "retire A1",
        operations: [
          { operationType: "DEPRECATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id },
          { operationType: "CREATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a2.id },
        ],
      });
      expect(await prisma.entityVersion.findMany({ where: { entityId: a.id }, orderBy: { revisionNumber: "asc" } })).toEqual(versionsBefore);
      expect((await prisma.entityVersion.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe("CANON");
    });

    it("linking a decision modifies neither the decision nor its conflict (§68, §69), and deciding creates no ChangeSet (§70)", async () => {
      const { r, a, a1, a2 } = await base("link");
      const { decision, conflict } = await decided(r.id, a.id, a1.id, a2.id, "SELECT_A2");
      expect(await countFor(r.id)).toEqual({ changeSets: 0, operations: 0 }); // §70
      const before = await fingerprint(CHANGE_SET_TABLES);
      const cs = await createChangeSet(r.id, { canonDecisionId: decision.id, name: "from D", operations: [{ operationType: "NO_CHANGE" }] });
      expect(cs.canonDecisionId).toBe(decision.id);
      expect(await fingerprint(CHANGE_SET_TABLES)).toEqual(before);
      expect((await prisma.ruleConflict.findUniqueOrThrow({ where: { id: conflict.id } })).status).toBe("RESOLVED");
    });
  });

  describe("rejections persist nothing (§48–§52)", () => {
    it("several valid operations followed by an invalid last one persist nothing (§41, §48)", async () => {
      const { r, a, a1, a2 } = await base("atomic");
      const b1 = await version((await entity("atomicB")).id, "B1");
      await expectCode(
        createChangeSet(r.id, {
          name: "x",
          operations: [
            { operationType: "DEPRECATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id },
            { operationType: "CREATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a2.id },
            { operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: b1.id },
          ],
        }),
        CHANGE_SET_ERROR_CODES.VERSION_ENTITY_MISMATCH,
      );
      expect(await countFor(r.id)).toEqual({ changeSets: 0, operations: 0 });
    });

    it("the WRITE is atomic: a database rejection of a late operation rolls back the ChangeSet and earlier operations", async () => {
      const { r, a, a1, a2 } = await base("atomicdb");
      const b1 = await version((await entity("atomicdbB")).id, "B1");
      const op = (type: "DEPRECATE_ENTITY_VERSION" | "PIN_ENTITY_VERSION", from: string | null, to: string | null) => ({
        operationType: type,
        targetEntityId: a.id,
        fromEntityVersionId: from,
        toEntityVersionId: to,
        targetManifestId: null,
        description: null,
      });
      const error = await insertChangeSetWithOperations(
        { rulesetId: r.id, canonDecisionId: null, name: "direct", description: null },
        [op("DEPRECATE_ENTITY_VERSION", a1.id, null), op("DEPRECATE_ENTITY_VERSION", a2.id, null), op("PIN_ENTITY_VERSION", null, b1.id)],
      ).catch((e: unknown) => e);
      expect(String(error)).toMatch(/change_set_operations_to_version_fkey/);
      expect(mapChangeSetWriteError(error)).toMatchObject({ code: CHANGE_SET_ERROR_CODES.VERSION_ENTITY_MISMATCH });
      expect(await countFor(r.id)).toEqual({ changeSets: 0, operations: 0 });
    });

    it("rejects a Version of another Entity on either side (§49)", async () => {
      const { r, a, a1 } = await base("mismatch");
      const b1 = await version((await entity("mismatchB")).id, "B1");
      await expectCode(
        createChangeSet(r.id, { name: "x", operations: [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: b1.id }] }),
        CHANGE_SET_ERROR_CODES.VERSION_ENTITY_MISMATCH,
      );
      await expectCode(
        createChangeSet(r.id, { name: "x", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: b1.id, toEntityVersionId: a1.id }] }),
        CHANGE_SET_ERROR_CODES.VERSION_ENTITY_MISMATCH,
      );
      expect(await countFor(r.id)).toEqual({ changeSets: 0, operations: 0 });
    });

    it("rejects a decision from another Ruleset with INVALID_DECISION_CONTEXT, a missing one with DECISION_NOT_FOUND (§50)", async () => {
      const one = await base("decR1");
      const { decision } = await decided(one.r.id, one.a.id, one.a1.id, one.a2.id, "SELECT_A1");
      const r2 = await ruleset("decR2");
      await expectCode(
        createChangeSet(r2.id, { canonDecisionId: decision.id, name: "x", operations: [{ operationType: "NO_CHANGE" }] }),
        CHANGE_SET_ERROR_CODES.INVALID_DECISION_CONTEXT,
      );
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(createChangeSet(r2.id, { canonDecisionId: bad, name: "x", operations: [{ operationType: "NO_CHANGE" }] }), CHANGE_SET_ERROR_CODES.DECISION_NOT_FOUND, bad);
        await expectCode(proposeChangeSetFromCanonDecision(bad, { name: "x" }), CHANGE_SET_ERROR_CODES.DECISION_NOT_FOUND, bad);
      }
      expect(await countFor(r2.id)).toEqual({ changeSets: 0, operations: 0 });
    });

    it("rejects a manifest from another Ruleset with INVALID_MANIFEST_CONTEXT, a missing one with MANIFEST_NOT_FOUND (§10, §51)", async () => {
      const one = await base("manR1");
      const r2 = await ruleset("manR2");
      const op = (targetManifestId: string): CreateChangeSetOperationInput => ({ operationType: "PIN_ENTITY_VERSION", targetEntityId: one.a.id, toEntityVersionId: one.a2.id, targetManifestId });
      await expectCode(createChangeSet(r2.id, { name: "x", operations: [op(one.m.id)] }), CHANGE_SET_ERROR_CODES.INVALID_MANIFEST_CONTEXT);
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(createChangeSet(r2.id, { name: "x", operations: [op(bad)] }), CHANGE_SET_ERROR_CODES.MANIFEST_NOT_FOUND, bad);
      }
      const { decision } = await decided(one.r.id, one.a.id, one.a1.id, one.a2.id, "SELECT_A2");
      const foreign = await createRulesetManifest(r2.id, { entries: [] });
      await expectCode(proposeChangeSetFromCanonDecision(decision.id, { name: "x", targetManifestId: foreign.id }), CHANGE_SET_ERROR_CODES.INVALID_MANIFEST_CONTEXT);
      expect(await countFor(r2.id)).toEqual({ changeSets: 0, operations: 0 });
      expect(await countFor(one.r.id)).toEqual({ changeSets: 0, operations: 0 });
    });

    it("rejects contradictory operations with OPERATION_CONFLICT (§13, §14, §52)", async () => {
      const { r, a, a1, a2 } = await base("contradict");
      const cases: CreateChangeSetOperationInput[][] = [
        [
          { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id },
          { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a2.id, toEntityVersionId: a1.id },
        ],
        [
          { operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: a.id },
          { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: a.id, toEntityVersionId: a2.id },
        ],
        [
          { operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a1.id },
          { operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a2.id },
        ],
        [{ operationType: "NO_CHANGE" }, { operationType: "CREATE_ENTITY_VERSION", targetEntityId: a.id }],
      ];
      for (const operations of cases) {
        await expectCode(createChangeSet(r.id, { name: "x", operations }), CHANGE_SET_ERROR_CODES.OPERATION_CONFLICT, JSON.stringify(operations.map((o) => o.operationType)));
      }
      expect(await countFor(r.id)).toEqual({ changeSets: 0, operations: 0 });
    });

    it("reports missing Ruleset / Entity / Version / ChangeSet, bad shapes and bad operations with controlled codes", async () => {
      const { r, a } = await base("codes");
      for (const id of [MISSING, "not-a-uuid"]) {
        await expectCode(createChangeSet(id, { name: "x", operations: [{ operationType: "NO_CHANGE" }] }), CHANGE_SET_ERROR_CODES.RULESET_NOT_FOUND, id);
        await expectCode(listChangeSets(id), CHANGE_SET_ERROR_CODES.RULESET_NOT_FOUND, id);
        await expectCode(getChangeSet(id), CHANGE_SET_ERROR_CODES.NOT_FOUND, id);
        await expectCode(analyzeChangeSetImpact(id), CHANGE_SET_ERROR_CODES.NOT_FOUND, id);
        await expectCode(
          createChangeSet(r.id, { name: "x", operations: [{ operationType: "CREATE_ENTITY_VERSION", targetEntityId: id }] }),
          CHANGE_SET_ERROR_CODES.ENTITY_NOT_FOUND,
          id,
        );
        await expectCode(
          createChangeSet(r.id, { name: "x", operations: [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: id }] }),
          CHANGE_SET_ERROR_CODES.VERSION_NOT_FOUND,
          id,
        );
      }
      await expectCode(createChangeSet(r.id, { name: "x", operations: [] }), CHANGE_SET_ERROR_CODES.INVALID_INPUT);
      await expectCode(createChangeSet(r.id, { name: " ", operations: [{ operationType: "NO_CHANGE" }] }), CHANGE_SET_ERROR_CODES.INVALID_INPUT);
      await expectCode(createChangeSet(r.id, { name: "x", operations: [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id }] }), CHANGE_SET_ERROR_CODES.INVALID_OPERATION);
      await expectCode(listChangeSets(r.id, { status: "draft" }), CHANGE_SET_ERROR_CODES.INVALID_INPUT);
      expect(await countFor(r.id)).toEqual({ changeSets: 0, operations: 0 });
    });
  });

  describe("decision translation (§15–§21, §53–§57)", () => {
    it("SELECT_RULE: manifest pins A2, decision selects A1 -> REPLACE A2 -> A1; M still pins A2 (§16, §53)", async () => {
      const r = await ruleset("selreplace");
      const a = await entity("selreplace");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const { decision } = await decided(r.id, a.id, a1.id, a2.id, "SELECT_A1");
      const cs = await proposeChangeSetFromCanonDecision(decision.id, { name: "apply D", targetManifestId: m.id });
      expect(cs).toMatchObject({ rulesetId: r.id, canonDecisionId: decision.id, status: "DRAFT" });
      expect(cs.operations.map((o) => [o.operationType, o.targetEntityId, o.fromEntityVersionId, o.toEntityVersionId, o.targetManifestId])).toEqual([
        ["REPLACE_ENTITY_VERSION", a.id, a2.id, a1.id, m.id],
      ]);
      expect((await resolveEntityVersionFromManifest(m.id, a.id))?.id).toBe(a2.id);
    });

    it("SELECT_RULE: already pinned -> NO_CHANGE; no pin -> ADD; no manifest -> PIN (§16, §53)", async () => {
      const r = await ruleset("selothers");
      const a = await entity("selothers");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const pinsA1 = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const empty = await createRulesetManifest(r.id, { entries: [] });
      const { decision } = await decided(r.id, a.id, a1.id, a2.id, "SELECT_A1");
      const types = async (targetManifestId?: string) =>
        (await proposeChangeSetFromCanonDecision(decision.id, { name: "p", ...(targetManifestId === undefined ? {} : { targetManifestId }) })).operations.map((o) => [
          o.operationType,
          o.toEntityVersionId,
        ]);
      expect(await types(pinsA1.id)).toEqual([["NO_CHANGE", null]]);
      expect(await types(empty.id)).toEqual([["ADD_ENTITY_TO_MANIFEST", a1.id]]);
      expect(await types()).toEqual([["PIN_ENTITY_VERSION", a1.id]]);
      expect(await countFor(r.id)).toEqual({ changeSets: 3, operations: 3 }); // each EXPLICIT call made one; deciding made none
    });

    it("MERGE uses its exact result Version: REPLACE / ADD / NO_CHANGE (§17, §54)", async () => {
      const r = await ruleset("merge");
      const a = await entity("merge");
      const [a1, a2, a3] = [await version(a.id, "A1"), await version(a.id, "A2"), await version(a.id, "A3")] as const;
      const pinsA1 = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const empty = await createRulesetManifest(r.id, { entries: [] });
      const pinsA3 = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a3.id }] });
      const { decision } = await decided(r.id, a.id, a1.id, a2.id, "MERGE", a3.id);
      const op = async (targetManifestId: string) => (await proposeChangeSetFromCanonDecision(decision.id, { name: "p", targetManifestId })).operations[0]!;
      expect(await op(pinsA1.id)).toMatchObject({ operationType: "REPLACE_ENTITY_VERSION", fromEntityVersionId: a1.id, toEntityVersionId: a3.id });
      expect(await op(empty.id)).toMatchObject({ operationType: "ADD_ENTITY_TO_MANIFEST", toEntityVersionId: a3.id });
      expect(await op(pinsA3.id)).toMatchObject({ operationType: "NO_CHANGE" });
    });

    it("KEEP_SEPARATE and DISMISSED translate to NO_CHANGE (§18, §19, §55, §56)", async () => {
      for (const shape of ["KEEP", "DISMISS"] as const) {
        const { r, a, a1, a2, m } = await base(`nochange${shape}`);
        const { decision } = await decided(r.id, a.id, a1.id, a2.id, shape);
        const cs = await proposeChangeSetFromCanonDecision(decision.id, { name: "p", targetManifestId: m.id });
        expect(cs.operations.map((o) => [o.operationType, o.targetEntityId, o.toEntityVersionId]), shape).toEqual([["NO_CHANGE", null, null]]);
      }
    });

    it("an INHERITED pin: the proposal targets the CHILD manifest; the parent is untouched (§21, §57)", async () => {
      const parentR = await ruleset("ip");
      const childR = await ruleset("ic", parentR.id);
      const a = await entity("inherit");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const p1 = await createRulesetManifest(parentR.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const c1 = await createRulesetManifest(childR.id, { parentManifestId: p1.id, entries: [] });
      expect(await resolveEffectiveEntityVersion(c1.id, a.id)).toMatchObject({ entityVersionId: a1.id, source: "INHERITED" });
      const { decision } = await decided(childR.id, a.id, a1.id, a2.id, "SELECT_A2");
      const before = await fingerprint(CHANGE_SET_TABLES);

      const cs = await proposeChangeSetFromCanonDecision(decision.id, { name: "override", targetManifestId: c1.id });

      expect(cs.rulesetId).toBe(childR.id);
      expect(cs.operations[0]).toMatchObject({ operationType: "REPLACE_ENTITY_VERSION", fromEntityVersionId: a1.id, toEntityVersionId: a2.id, targetManifestId: c1.id });
      expect(cs.operations[0]!.description).toMatch(new RegExp(`INHERITED from manifest ${p1.id}`));
      expect(await fingerprint(CHANGE_SET_TABLES)).toEqual(before); // parent AND child manifests untouched
      expect(await resolveEffectiveEntityVersion(c1.id, a.id)).toMatchObject({ entityVersionId: a1.id, source: "INHERITED" });
    });
  });

  describe("impact analysis (§22–§35, §58–§64)", () => {
    it("reports direct, manifest, inheriting, relationship, keyword, source and governance impact — and writes nothing (§58–§64)", async () => {
      const { r, a, a1, a2, m } = await base("impact");
      const b = await entity("impactB"); // A REQUIRES B
      const c = await entity("impactC"); // C USES A
      await createEntityRelationship({ sourceEntityId: a.id, targetEntityId: b.id, relationshipType: "REQUIRES" });
      await createEntityRelationship({ sourceEntityId: c.id, targetEntityId: a.id, relationshipType: "USES" });
      const d = await entity("impactD"); // two hops away (B REQUIRES D): must NOT appear
      await createEntityRelationship({ sourceEntityId: b.id, targetEntityId: d.id, relationshipType: "REQUIRES" });
      const kw = await createKeywordDefinition({ canonicalKey: `${KEYWORD_PREFIX}.fire`, name: "Fire" });
      await assignKeywordToEntity(a.id, kw.id);
      await assignKeywordToEntityVersion(a2.id, kw.id);
      const s1 = await reference(a1.id, "A1 src");
      const { conflict, policy, decision } = await decided(r.id, a.id, a1.id, a2.id, "SELECT_A2");
      // multi-level inheritance below M: M <- C1 <- G1, in descendant Rulesets
      const childR = await ruleset("impactChild", r.id);
      const grandR = await ruleset("impactGrand", childR.id);
      const c1 = await createRulesetManifest(childR.id, { parentManifestId: m.id, entries: [] });
      const g1 = await createRulesetManifest(grandR.id, { parentManifestId: c1.id, entries: [] });

      const cs = await createChangeSet(r.id, {
        canonDecisionId: decision.id,
        name: "apply",
        operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id, targetManifestId: m.id }],
      });
      const op = cs.operations[0]!;
      const before = await fingerprint();

      const report = await analyzeChangeSetImpact(cs.id);
      const again = await analyzeChangeSetImpact(cs.id);

      expect(await fingerprint()).toEqual(before); // §64: byte-identical — analysis wrote nothing
      expect(again).toEqual(report); // §32: deterministic
      expect(report).toMatchObject({ changeSetId: cs.id, rulesetId: r.id, derivation: "LIVE" });
      const items = report.items;
      // direct (§58)
      expect(has(items, "DIRECT_ENTITY", a.id)?.reasons[0]).toMatchObject({ sourceOperationId: op.id, sequence: 1 });
      expect(has(items, "DIRECT_ENTITY_VERSION", a1.id)).toBeDefined();
      expect(has(items, "DIRECT_ENTITY_VERSION", a2.id)).toBeDefined();
      expect(has(items, "MANIFEST", m.id)?.resourceType).toBe("RULESET_MANIFEST");
      expect(has(items, "MANIFEST", r.id)?.resourceType).toBe("RULESET");
      // inheriting, transitively, as POTENTIAL impact (§59)
      expect(has(items, "INHERITING_MANIFEST", c1.id)?.reasons[0]!.reason).toMatch(/depth 1.*POTENTIAL.*does not change/);
      expect(has(items, "INHERITING_MANIFEST", g1.id)?.reasons[0]!.reason).toMatch(/depth 2/);
      expect(has(items, "INHERITING_MANIFEST", grandR.id)?.resourceType).toBe("RULESET");
      // one-hop relationships, both directions, with type; never two hops (§60, §34)
      expect(has(items, "RELATIONSHIP_DEPENDENT_ENTITY", b.id)?.reasons[0]!.relationshipType).toBe("REQUIRES");
      expect(has(items, "RELATIONSHIP_DEPENDENT_ENTITY", c.id)?.reasons[0]!.relationshipType).toBe("USES");
      expect(has(items, "RELATIONSHIP_DEPENDENT_ENTITY", d.id)).toBeUndefined();
      // keywords and sources (§61, §62)
      expect(has(items, "KEYWORD_RELATED", `${a.id}:${kw.id}`)?.reasons[0]!.reason).toMatch(/fire/);
      expect(has(items, "KEYWORD_RELATED", `${a2.id}:${kw.id}`)).toBeDefined();
      expect(has(items, "SOURCE_PROVENANCE", s1.id)).toBeDefined();
      // governance (§63)
      expect(has(items, "CANON_GOVERNANCE", conflict.id)?.resourceType).toBe("RULE_CONFLICT");
      const decisionItem = has(items, "CANON_GOVERNANCE", decision.id)!;
      expect(decisionItem.reasons.map((x) => x.sourceOperationId)).toEqual([op.id, null]); // via the conflict AND via the link, one item
      expect(has(items, "CANON_GOVERNANCE", policy.id)?.resourceType).toBe("CANON_POLICY");
      // no accidental duplicates (§33)
      const keys = items.map((i) => `${i.category}|${i.resourceType}|${i.resourceId}`);
      expect(new Set(keys).size).toBe(keys.length);
      // B (and everything else) was not modified (§60): the whole-database fingerprint above is identical.
    });

    it("a NO_CHANGE ChangeSet linked to a decision reports only that governance context", async () => {
      const { r, a, a1, a2 } = await base("impactnone");
      const { decision, policy } = await decided(r.id, a.id, a1.id, a2.id, "DISMISS");
      const cs = await createChangeSet(r.id, { canonDecisionId: decision.id, name: "n", operations: [{ operationType: "NO_CHANGE" }] });
      const report = await analyzeChangeSetImpact(cs.id);
      expect(report.items.map((i) => [i.category, i.resourceId])).toEqual([
        ["CANON_GOVERNANCE", decision.id],
        ["CANON_GOVERNANCE", policy.id],
      ]);
    });
  });

  describe("historical vs live-derived (§65)", () => {
    it("old operations stay exact after new decisions/policies/manifests/Versions; the impact report is LIVE", async () => {
      const { r, a, a1, a2, m } = await base("history");
      const { decision } = await decided(r.id, a.id, a1.id, a2.id, "SELECT_A2");
      const cs = await proposeChangeSetFromCanonDecision(decision.id, { name: "D1 on M1", targetManifestId: m.id });
      const snapshot = await getChangeSet(cs.id);
      const reportBefore = await analyzeChangeSetImpact(cs.id);

      await createCanonPolicy(r.id, { name: "P later", authorities: [] });
      const [a3, a4] = [await version(a.id, "A3"), await version(a.id, "A4")] as const;
      await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a4.id }] });
      const { conflict: later } = await decided(r.id, a.id, a3.id, a4.id, "SELECT_A1");

      const after = await getChangeSet(cs.id);
      expect(after).toEqual(snapshot); // historical snapshot: unchanged
      expect(after.operations.map((o) => [o.operationType, o.fromEntityVersionId, o.toEntityVersionId, o.targetManifestId])).toEqual([
        ["REPLACE_ENTITY_VERSION", a1.id, a2.id, m.id],
      ]);
      const reportAfter = await analyzeChangeSetImpact(cs.id);
      expect(has(reportBefore.items, "CANON_GOVERNANCE", later.id)).toBeUndefined();
      expect(has(reportAfter.items, "CANON_GOVERNANCE", later.id)).toBeDefined(); // live-derived: sees the newer conflict
    });
  });

  describe("listing and surface (§40, §71)", () => {
    it("lists by Ruleset with exact filters", async () => {
      const { r, a, a1, a2 } = await base("list");
      const { decision } = await decided(r.id, a.id, a1.id, a2.id, "SELECT_A1");
      const one = await createChangeSet(r.id, { name: "one", operations: [{ operationType: "NO_CHANGE" }] });
      const two = await createChangeSet(r.id, { canonDecisionId: decision.id, name: "two", operations: [{ operationType: "NO_CHANGE" }] });
      expect((await listChangeSets(r.id)).map((c) => c.id)).toEqual([one.id, two.id]);
      expect((await listChangeSets(r.id)).every((c) => !("operations" in c))).toBe(true);
      expect((await listChangeSets(r.id, { canonDecisionId: decision.id })).map((c) => c.id)).toEqual([two.id]);
      expect((await listChangeSets(r.id, { status: "DRAFT" })).map((c) => c.id)).toEqual([one.id, two.id]);
      expect(await listChangeSets(r.id, { status: "APPROVED" })).toEqual([]);
      await expectCode(listChangeSets(r.id, { canonDecisionId: "nope" }), CHANGE_SET_ERROR_CODES.INVALID_INPUT);
    });

    it("exposes exactly five ChangeSet proposal operations; nothing applies, executes, edits, or deletes (§40, §42, §71)", async () => {
      const names = Object.keys(await import("../../src/index"));
      // M2-WO8 added the explicit review transitions (submit/approve/reject), audited in ruleset-release.test.ts.
      const review = ["submitChangeSetForReview", "approveChangeSet", "rejectChangeSet"];
      expect(names.filter((n) => /changeset/i.test(n) && !review.includes(n)).sort()).toEqual([
        "analyzeChangeSetImpact",
        "createChangeSet",
        "getChangeSet",
        "listChangeSets",
        "proposeChangeSetFromCanonDecision",
      ]);
      const forbidden = /^(apply|execute|publish|commit|update|edit|delete|remove|add|set|transition|approve|reject|supersede|submit)\w*(changeset|operation)/i;
      const control = ["applyChangeSet", "executeChangeSet", "updateChangeSet", "deleteChangeSet", "addChangeSetOperation", "approveChangeSet", "setChangeSetStatus"];
      expect(control.filter((n) => forbidden.test(n))).toEqual(control);
      expect(names.filter((n) => forbidden.test(n) && !review.includes(n))).toEqual([]);
      expect(names.filter((n) => /^(apply|execute|set)\w*changeset/i.test(n))).toEqual([]); // still no apply/execute/generic setter
    });
  });

  describe("the database enforces what it can (§4, §10, §43, §44)", () => {
    it("even inserted directly: a foreign decision, a foreign manifest, a mismatched Version, or a mismatched Ruleset copy is rejected", async () => {
      const one = await base("dbOne");
      const two = await base("dbTwo");
      const { decision } = await decided(two.r.id, two.a.id, two.a1.id, two.a2.id, "SELECT_A1");
      await expect(prisma.changeSet.create({ data: { rulesetId: one.r.id, canonDecisionId: decision.id, name: "x" } })).rejects.toThrow(/change_sets_canon_decision_fkey/);
      const cs = await prisma.changeSet.create({ data: { rulesetId: one.r.id, name: "direct" } });
      const op = { changeSetId: cs.id, rulesetId: one.r.id, sequence: 1, operationType: "PIN_ENTITY_VERSION" as const, targetEntityId: one.a.id, toEntityVersionId: one.a2.id };
      await expect(prisma.changeSetOperation.create({ data: { ...op, targetManifestId: two.m.id } })).rejects.toThrow(/change_set_operations_target_manifest_fkey/);
      await expect(prisma.changeSetOperation.create({ data: { ...op, toEntityVersionId: two.a1.id } })).rejects.toThrow(/change_set_operations_to_version_fkey/);
      await expect(prisma.changeSetOperation.create({ data: { ...op, fromEntityVersionId: two.a1.id, operationType: "REPLACE_ENTITY_VERSION" } })).rejects.toThrow(
        /change_set_operations_from_version_fkey/,
      );
      await expect(prisma.changeSetOperation.create({ data: { ...op, rulesetId: two.r.id, targetManifestId: two.m.id } })).rejects.toThrow(/change_set_operations_change_set_fkey/);
      await prisma.changeSetOperation.create({ data: op });
      await expect(prisma.changeSetOperation.create({ data: { ...op, operationType: "NO_CHANGE", targetEntityId: null, toEntityVersionId: null } })).rejects.toThrow(
        /change_set_operations_change_set_id_sequence_key/,
      );
    });

    it("protects history: referenced decision, manifest, Versions, Entity, Ruleset and a ChangeSet with operations cannot be deleted (RESTRICT, §43)", async () => {
      const { r, a, a1, a2, m } = await base("restrict");
      const { decision } = await decided(r.id, a.id, a1.id, a2.id, "SELECT_A2");
      const cs = await createChangeSet(r.id, {
        canonDecisionId: decision.id,
        name: "x",
        operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id, targetManifestId: m.id }],
      });
      await expect(prisma.canonDecision.delete({ where: { id: decision.id } })).rejects.toThrow();
      await expect(prisma.rulesetManifest.delete({ where: { id: m.id } })).rejects.toThrow();
      await expect(prisma.entityVersion.delete({ where: { id: a2.id } })).rejects.toThrow();
      await expect(prisma.entity.delete({ where: { id: a.id } })).rejects.toThrow();
      await expect(prisma.ruleset.delete({ where: { id: r.id } })).rejects.toThrow();
      await expect(prisma.changeSet.delete({ where: { id: cs.id } })).rejects.toThrow(/change_set_operations_change_set_fkey/);
      expect(await getChangeSet(cs.id)).toEqual(cs);
    });

    it("every foreign key is RESTRICT with exactly the designed columns; no impact table exists (§43–§46)", async () => {
      const keys = await prisma.$queryRaw<Array<{ constraint_name: string; delete_rule: string; cols: string }>>`
        SELECT rc.constraint_name, rc.delete_rule, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
        WHERE rc.constraint_name LIKE 'change_set%'
        GROUP BY rc.constraint_name, rc.delete_rule ORDER BY rc.constraint_name`;
      expect(keys).toEqual([
        { constraint_name: "change_set_operations_change_set_fkey", delete_rule: "RESTRICT", cols: "change_set_id,ruleset_id" },
        { constraint_name: "change_set_operations_from_version_fkey", delete_rule: "RESTRICT", cols: "from_entity_version_id,target_entity_id" },
        { constraint_name: "change_set_operations_target_entity_fkey", delete_rule: "RESTRICT", cols: "target_entity_id" },
        { constraint_name: "change_set_operations_target_manifest_fkey", delete_rule: "RESTRICT", cols: "target_manifest_id,ruleset_id" },
        { constraint_name: "change_set_operations_to_version_fkey", delete_rule: "RESTRICT", cols: "to_entity_version_id,target_entity_id" },
        { constraint_name: "change_sets_canon_decision_fkey", delete_rule: "RESTRICT", cols: "canon_decision_id,ruleset_id" },
        { constraint_name: "change_sets_ruleset_id_fkey", delete_rule: "RESTRICT", cols: "ruleset_id" },
      ]);
      const impactTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ~* '(impact|dependency|snapshot|cache)'`;
      expect(impactTables).toEqual([]);
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'change_set%'
          AND column_name ~* '(applied|executed|published|release|updated_at|winner|latest|current)'`;
      expect(cols).toEqual([]);
    });

    it("the M2-WO7 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261008010000_add_change_sets'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });
  });
});
