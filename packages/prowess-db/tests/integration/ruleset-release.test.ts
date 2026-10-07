/**
 * Review lifecycles, publication and RulesetRelease — database integration tests (PAS-10 M2-WO8 §59–§86).
 * Runs only against prowess_studio_test (guarded). Torn down in FK order.
 */
import { CHANGE_SET_ERROR_CODES, DomainError, RULESET_ERROR_CODES, RULESET_RELEASE_ERROR_CODES, type CreateChangeSetOperationInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  approveRuleset,
  compareRulesetReleases,
  createCanonDecision,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
  createRuleConflict,
  createRuleset,
  createRulesetManifest,
  getChangeSet,
  getLatestRulesetRelease,
  getRuleset,
  getRulesetRelease,
  listRulesetReleases,
  prisma,
  proposeChangeSetFromCanonDecision,
  publishRulesetRelease,
  rejectChangeSet,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
  verifyRulesetReleaseManifestHash,
} from "../../src/index";
import { computeManifestHash } from "../../src/ruleset-release/hash";
import { executePublication } from "../../src/ruleset-release/repository";
import { mapPublicationError } from "../../src/ruleset-release/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const MISSING = "00000000-0000-4000-8000-000000000000";
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, opts: { approved?: boolean; parentRulesetId?: string } = {}) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.rel_${label.toLowerCase()}_${tag}_${next()}`,
    name: `ReleaseTest ${label}`,
    channel: "CORE_PLAYTEST",
    ...(opts.parentRulesetId === undefined ? {} : { parentRulesetId: opts.parentRulesetId }),
  });
  rulesetIds.push(r.id);
  if (opts.approved !== false) {
    await submitRulesetForReview(r.id);
    await approveRuleset(r.id);
  }
  return r;
}
async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.release.${label.toLowerCase()}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}
const version = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const policy = (rulesetId: string) => createCanonPolicy(rulesetId, { name: `P ${next()}`, authorities: [] });
async function approvedChangeSet(rulesetId: string, operations: CreateChangeSetOperationInput[], canonDecisionId?: string) {
  const cs = await createChangeSet(rulesetId, { name: `cs ${next()}`, operations, ...(canonDecisionId === undefined ? {} : { canonDecisionId }) });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  return cs;
}

/** Approved Ruleset R; Entities A, B with A1/A2/A3 and B1; base manifest M = {A1, B1}; policy P1. */
async function world(label: string) {
  const r = await ruleset(label);
  const [a, b] = [await entity(`${label}A`), await entity(`${label}B`)] as const;
  const [a1, a2, a3] = [await version(a.id, "A1"), await version(a.id, "A2"), await version(a.id, "A3")] as const;
  const b1 = await version(b.id, "B1");
  const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }, { entityId: b.id, entityVersionId: b1.id }] });
  const p1 = await policy(r.id);
  return { r, a, b, a1, a2, a3, b1, m, p1 };
}
const compositionOf = (release: { composition: Array<{ entityId: string; entityVersionId: string }> }) =>
  Object.fromEntries(release.composition.map((p) => [p.entityId, p.entityVersionId]));

async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}

async function fingerprint(tables: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t`);
    out[t] = row?.h ?? "";
  }
  return out;
}
/** Tables publication must never rewrite (§1, §83–§85). New manifests/entries are checked separately. */
const HISTORY = ["canon_policies", "source_authority_records", "canon_decisions", "canon_decision_selections", "rule_conflicts", "rule_conflict_candidates", "change_set_operations", "source_references", "entity_relationships", "entity_keywords", "entity_version_keywords"];
const rowsOf = async (rulesetId: string) => ({
  releases: await prisma.rulesetRelease.count({ where: { rulesetId } }),
  manifests: await prisma.rulesetManifest.count({ where: { rulesetId } }),
  entries: await prisma.rulesetManifestEntry.count({ where: { manifest: { rulesetId } } }),
});

describe("Ruleset publishing (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.rulesetRelease.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
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
    const versionIds = (await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } })).map((v: { id: string }) => v.id);
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  describe("review lifecycles (§10–§17, §71, §72, §86)", () => {
    it("ChangeSet: DRAFT -> READY_FOR_REVIEW -> APPROVED, and -> REJECTED; content stays frozen", async () => {
      const { r, a, a2 } = await world("csreview");
      const ops: CreateChangeSetOperationInput[] = [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a2.id }];
      const one = await createChangeSet(r.id, { name: "one", operations: ops });
      expect((await submitChangeSetForReview(one.id)).status).toBe("READY_FOR_REVIEW");
      expect((await approveChangeSet(one.id)).status).toBe("APPROVED");
      const after = await getChangeSet(one.id);
      expect({ ...after, status: "DRAFT" }).toEqual(one); // only status moved
      const two = await createChangeSet(r.id, { name: "two", operations: ops });
      await submitChangeSetForReview(two.id);
      expect((await rejectChangeSet(two.id)).status).toBe("REJECTED");
    });

    it("ChangeSet: shortcuts and re-transitions are INVALID_STATUS_TRANSITION; a missing one is NOT_FOUND", async () => {
      const { r } = await world("csinvalid");
      const cs = await createChangeSet(r.id, { name: "x", operations: [{ operationType: "NO_CHANGE" }] });
      await expectCode(approveChangeSet(cs.id), CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION, "DRAFT->APPROVED");
      await expectCode(rejectChangeSet(cs.id), CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION, "DRAFT->REJECTED");
      await submitChangeSetForReview(cs.id);
      await expectCode(submitChangeSetForReview(cs.id), CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION, "twice");
      await rejectChangeSet(cs.id);
      await expectCode(approveChangeSet(cs.id), CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION, "REJECTED->APPROVED");
      await expectCode(approveChangeSet(MISSING), CHANGE_SET_ERROR_CODES.NOT_FOUND);
    });

    it("concurrent approve/reject of one ChangeSet: exactly one wins (§13, §71)", async () => {
      const { r } = await world("csrace");
      const cs = await createChangeSet(r.id, { name: "x", operations: [{ operationType: "NO_CHANGE" }] });
      await submitChangeSetForReview(cs.id);
      const results = await Promise.allSettled([approveChangeSet(cs.id), rejectChangeSet(cs.id), approveChangeSet(cs.id), rejectChangeSet(cs.id)]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      for (const x of results.filter((y): y is PromiseRejectedResult => y.status === "rejected")) {
        expect((x.reason as DomainError).code).toBe(CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION);
      }
      expect(["APPROVED", "REJECTED"]).toContain((await getChangeSet(cs.id)).status);
    });

    it("Ruleset: DRAFT -> IN_REVIEW -> APPROVED; shortcuts fail; approving publishes nothing (§15, §72, §86)", async () => {
      const r = await ruleset("rsreview", { approved: false });
      await expectCode(approveRuleset(r.id), RULESET_ERROR_CODES.INVALID_STATUS_TRANSITION, "DRAFT->APPROVED");
      expect((await submitRulesetForReview(r.id)).status).toBe("IN_REVIEW");
      await expectCode(submitRulesetForReview(r.id), RULESET_ERROR_CODES.INVALID_STATUS_TRANSITION);
      expect((await approveRuleset(r.id)).status).toBe("APPROVED");
      await expectCode(approveRuleset(r.id), RULESET_ERROR_CODES.INVALID_STATUS_TRANSITION, "APPROVED->APPROVED");
      await expectCode(submitRulesetForReview(MISSING), RULESET_ERROR_CODES.NOT_FOUND);
      expect(await rowsOf(r.id)).toEqual({ releases: 0, manifests: 0, entries: 0 });
    });

    it("DRAFT / IN_REVIEW Rulesets cannot publish (§16)", async () => {
      const r = await ruleset("notpub", { approved: false });
      const a = await entity("notpub");
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: (await version(a.id, "A1")).id }] });
      const p = await policy(r.id);
      const publish = () => publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p.id, versionLabel: "0.1" });
      await expectCode(publish(), RULESET_RELEASE_ERROR_CODES.RULESET_NOT_PUBLISHABLE, "DRAFT");
      await submitRulesetForReview(r.id);
      await expectCode(publish(), RULESET_RELEASE_ERROR_CODES.RULESET_NOT_PUBLISHABLE, "IN_REVIEW");
      expect(await rowsOf(r.id)).toEqual({ releases: 0, manifests: 1, entries: 1 });
    });
  });

  describe("publication (§19–§29, §59–§65)", () => {
    it("initial publication without a ChangeSet: new flattened manifest, release 1, exact pins, channel snapshot, valid hash, Ruleset PUBLISHED (§59)", async () => {
      const { r, a, b, a1, b1, m, p1 } = await world("initial");
      const before = await fingerprint([...HISTORY, "ruleset_manifests", "ruleset_manifest_entries"]);
      const rel = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, versionLabel: "  Core Playtest 1  ", releaseNotes: "first" });

      expect(rel).toMatchObject({ rulesetId: r.id, releaseNumber: 1, versionLabel: "Core Playtest 1", channel: "CORE_PLAYTEST", canonPolicyId: p1.id, changeSetId: null, releaseNotes: "first" });
      expect(rel.manifestId).not.toBe(m.id);
      const manifest = await prisma.rulesetManifest.findUniqueOrThrow({ where: { id: rel.manifestId } });
      expect(manifest).toMatchObject({ rulesetId: r.id, parentManifestId: null, manifestVersion: 2 });
      expect(compositionOf(rel)).toEqual({ [a.id]: a1.id, [b.id]: b1.id });
      expect(rel.manifestHash).toBe(computeManifestHash([{ entityId: a.id, entityVersionId: a1.id }, { entityId: b.id, entityVersionId: b1.id }]));
      expect(await verifyRulesetReleaseManifestHash(rel.id)).toEqual({ releaseId: rel.id, valid: true, storedHash: rel.manifestHash, computedHash: rel.manifestHash });
      expect((await getRuleset(r.id)).status).toBe("PUBLISHED");
      // §85: every pre-existing manifest/entry row and every history table is byte-identical (only NEW rows were added)
      const after = await fingerprint(HISTORY);
      for (const t of HISTORY) expect(after[t], t).toBe(before[t]);
      expect(await prisma.rulesetManifestEntry.findMany({ where: { manifestId: m.id }, orderBy: { entityId: "asc" } })).toHaveLength(2);
    });

    it("REPLACE A1 -> A2: release {A2, B1}; the base manifest still {A1, B1} (§22, §60)", async () => {
      const { r, a, b, a1, a2, b1, m, p1 } = await world("replace");
      const cs = await approvedChangeSet(r.id, [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id, targetManifestId: m.id }]);
      const baseRows = await prisma.rulesetManifestEntry.findMany({ where: { manifestId: m.id }, orderBy: { entityId: "asc" } });
      const rel = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "0.2" });
      expect(rel.changeSetId).toBe(cs.id);
      expect(compositionOf(rel)).toEqual({ [a.id]: a2.id, [b.id]: b1.id });
      expect(await prisma.rulesetManifestEntry.findMany({ where: { manifestId: m.id }, orderBy: { entityId: "asc" } })).toEqual(baseRows);
      expect((await getChangeSet(cs.id)).status).toBe("APPROVED"); // publication does not rewrite the ChangeSet
    });

    it("ADD, REMOVE, PIN and NO_CHANGE apply exactly (§61–§64)", async () => {
      const add = await world("add");
      const c = await entity("addC");
      const c1 = await version(c.id, "C1");
      const relAdd = await publishRulesetRelease({
        rulesetId: add.r.id, baseManifestId: add.m.id, canonPolicyId: add.p1.id, versionLabel: "add",
        changeSetId: (await approvedChangeSet(add.r.id, [{ operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: c.id, toEntityVersionId: c1.id }])).id,
      });
      expect(compositionOf(relAdd)).toEqual({ [add.a.id]: add.a1.id, [add.b.id]: add.b1.id, [c.id]: c1.id });

      const rem = await world("remove");
      const relRem = await publishRulesetRelease({
        rulesetId: rem.r.id, baseManifestId: rem.m.id, canonPolicyId: rem.p1.id, versionLabel: "rem",
        changeSetId: (await approvedChangeSet(rem.r.id, [{ operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: rem.b.id, fromEntityVersionId: rem.b1.id }])).id,
      });
      expect(compositionOf(relRem)).toEqual({ [rem.a.id]: rem.a1.id });

      const pin = await world("pin");
      const relPin = await publishRulesetRelease({
        rulesetId: pin.r.id, baseManifestId: pin.m.id, canonPolicyId: pin.p1.id, versionLabel: "pin",
        changeSetId: (await approvedChangeSet(pin.r.id, [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: pin.a.id, toEntityVersionId: pin.a2.id }])).id,
      });
      expect(compositionOf(relPin)[pin.a.id]).toBe(pin.a2.id);

      const none = await world("nochange");
      const relNone = await publishRulesetRelease({
        rulesetId: none.r.id, baseManifestId: none.m.id, canonPolicyId: none.p1.id, versionLabel: "same",
        changeSetId: (await approvedChangeSet(none.r.id, [{ operationType: "NO_CHANGE" }])).id,
      });
      expect(compositionOf(relNone)).toEqual({ [none.a.id]: none.a1.id, [none.b.id]: none.b1.id });
      expect(relNone.manifestHash).toBe(computeManifestHash([{ entityId: none.b.id, entityVersionId: none.b1.id }, { entityId: none.a.id, entityVersionId: none.a1.id }]));
    });

    it("an inherited child base publishes a standalone, parentless snapshot of its EFFECTIVE composition (§20, §23, §65)", async () => {
      const parent = await ruleset("parent");
      const child = await ruleset("child", { parentRulesetId: parent.id });
      const [a, b] = [await entity("inhA"), await entity("inhB")] as const;
      const [a1, a2, b1] = [await version(a.id, "A1"), await version(a.id, "A2"), await version(b.id, "B1")] as const;
      const pm = await createRulesetManifest(parent.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }, { entityId: b.id, entityVersionId: b1.id }] });
      const cm = await createRulesetManifest(child.id, { parentManifestId: pm.id, entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const before = await fingerprint(["ruleset_manifests", "ruleset_manifest_entries"]);
      const rel = await publishRulesetRelease({ rulesetId: child.id, baseManifestId: cm.id, canonPolicyId: (await policy(child.id)).id, versionLabel: "child 1" });
      expect(compositionOf(rel)).toEqual({ [a.id]: a2.id, [b.id]: b1.id });
      expect((await prisma.rulesetManifest.findUniqueOrThrow({ where: { id: rel.manifestId } })).parentManifestId).toBeNull();
      const parentRows = await prisma.rulesetManifestEntry.findMany({ where: { manifestId: pm.id } });
      expect(parentRows.map((e) => e.entityVersionId).sort()).toEqual([a1.id, b1.id].sort()); // parent untouched
      expect(before).not.toEqual(await fingerprint(["ruleset_manifests", "ruleset_manifest_entries"])); // only a NEW manifest was added
    });
  });

  describe("fail closed — nothing written (§31–§33, §66–§70, §73, §77, §78)", () => {
    it("stale REPLACE / ADD / REMOVE -> STALE_CHANGE_SET (§66–§68)", async () => {
      const { r, a, b, a1, a2, a3, b1, p1 } = await world("stale");
      const base = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a3.id }, { entityId: b.id, entityVersionId: b1.id }] });
      const cases: CreateChangeSetOperationInput[] = [
        { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id },
        { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: a.id, toEntityVersionId: a2.id },
        { operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: a.id, fromEntityVersionId: a1.id },
      ];
      const before = await rowsOf(r.id);
      for (const op of cases) {
        const cs = await approvedChangeSet(r.id, [op]);
        await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: base.id, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.STALE_CHANGE_SET, op.operationType);
      }
      expect(await rowsOf(r.id)).toEqual(before);
      expect((await getRuleset(r.id)).status).toBe("APPROVED");
    });

    it("DRAFT / READY_FOR_REVIEW / REJECTED ChangeSets cannot be published (§69, §70)", async () => {
      const { r, m, p1 } = await world("unapproved");
      const draft = await createChangeSet(r.id, { name: "d", operations: [{ operationType: "NO_CHANGE" }] });
      const ready = await createChangeSet(r.id, { name: "r", operations: [{ operationType: "NO_CHANGE" }] });
      await submitChangeSetForReview(ready.id);
      const rejected = await createChangeSet(r.id, { name: "x", operations: [{ operationType: "NO_CHANGE" }] });
      await submitChangeSetForReview(rejected.id);
      await rejectChangeSet(rejected.id);
      for (const cs of [draft, ready, rejected]) {
        await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.CHANGE_SET_NOT_APPROVED);
      }
      expect((await rowsOf(r.id)).releases).toBe(0);
    });

    it("a CREATE operation blocks publication; a foreign-manifest operation is a context error (§31, §32, §73)", async () => {
      const { r, a, a1, m, p1 } = await world("create");
      const cs = await approvedChangeSet(r.id, [{ operationType: "CREATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id }]);
      const versionsBefore = await prisma.entityVersion.count({ where: { entityId: a.id } });
      await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.UNRESOLVED_CREATE_OPERATION);
      expect(await prisma.entityVersion.count({ where: { entityId: a.id } })).toBe(versionsBefore);
      const other = await createRulesetManifest(r.id, { entries: [] });
      const foreign = await approvedChangeSet(r.id, [{ operationType: "NO_CHANGE", targetManifestId: other.id }]);
      await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, changeSetId: foreign.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT);
      expect((await rowsOf(r.id)).releases).toBe(0);
      expect((await getRuleset(r.id)).status).toBe("APPROVED");
    });

    it("context errors: foreign manifest / policy / ChangeSet, missing references, bad shape", async () => {
      const one = await world("ctxOne");
      const two = await world("ctxTwo");
      const cs2 = await approvedChangeSet(two.r.id, [{ operationType: "NO_CHANGE" }]);
      const base = { rulesetId: one.r.id, baseManifestId: one.m.id, canonPolicyId: one.p1.id, versionLabel: "x" };
      await expectCode(publishRulesetRelease({ ...base, baseManifestId: two.m.id }), RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT);
      await expectCode(publishRulesetRelease({ ...base, canonPolicyId: two.p1.id }), RULESET_RELEASE_ERROR_CODES.INVALID_POLICY_CONTEXT);
      await expectCode(publishRulesetRelease({ ...base, changeSetId: cs2.id }), RULESET_RELEASE_ERROR_CODES.INVALID_CHANGE_SET_CONTEXT);
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(publishRulesetRelease({ ...base, rulesetId: bad }), RULESET_RELEASE_ERROR_CODES.RULESET_NOT_FOUND, bad);
        await expectCode(publishRulesetRelease({ ...base, baseManifestId: bad }), RULESET_RELEASE_ERROR_CODES.MANIFEST_NOT_FOUND, bad);
        await expectCode(publishRulesetRelease({ ...base, canonPolicyId: bad }), RULESET_RELEASE_ERROR_CODES.POLICY_NOT_FOUND, bad);
        await expectCode(publishRulesetRelease({ ...base, changeSetId: bad }), RULESET_RELEASE_ERROR_CODES.CHANGE_SET_NOT_FOUND, bad);
        await expectCode(getRulesetRelease(bad), RULESET_RELEASE_ERROR_CODES.NOT_FOUND, bad);
        await expectCode(verifyRulesetReleaseManifestHash(bad), RULESET_RELEASE_ERROR_CODES.NOT_FOUND, bad);
        await expectCode(listRulesetReleases(bad), RULESET_RELEASE_ERROR_CODES.RULESET_NOT_FOUND, bad);
      }
      await expectCode(publishRulesetRelease({ ...base, versionLabel: "   " }), RULESET_RELEASE_ERROR_CODES.INVALID_INPUT);
      expect((await rowsOf(one.r.id)).releases).toBe(0);
    });

    it("one approved ChangeSet backs one release; labels are unique; release 2 must base on release 1's manifest (§37–§39, §77, §78)", async () => {
      const { r, a, a1, a2, m, p1 } = await world("linear");
      const cs = await approvedChangeSet(r.id, [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id }]);
      const rel1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "0.1" });
      await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: rel1.manifestId, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "0.2" }), RULESET_RELEASE_ERROR_CODES.CHANGE_SET_ALREADY_PUBLISHED);
      await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: rel1.manifestId, canonPolicyId: p1.id, versionLabel: "0.1" }), RULESET_RELEASE_ERROR_CODES.VERSION_LABEL_CONFLICT);
      await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, versionLabel: "0.2" }), RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT); // older manifest
      const rel2 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: rel1.manifestId, canonPolicyId: p1.id, versionLabel: "0.2" });
      expect(rel2.releaseNumber).toBe(2);
      expect((await getRuleset(r.id)).status).toBe("PUBLISHED"); // PUBLISHED -> PUBLISHED
      expect((await listRulesetReleases(r.id)).map((x) => x.releaseNumber)).toEqual([1, 2]);
      expect((await getLatestRulesetRelease(r.id))?.id).toBe(rel2.id);
      expect(await getLatestRulesetRelease((await ruleset("nolatest")).id)).toBeNull();
    });
  });

  describe("lifecycle, atomicity and concurrency (§30, §34, §36, §74–§76)", () => {
    it("an approved DEPRECATE moves the Version to DEPRECATED through the M1 lifecycle, in the publication; composition is unaffected (§30, §74)", async () => {
      const { r, a, b, a1, a2, b1, m, p1 } = await world("deprecate");
      for (const s of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, s);
      const cs = await approvedChangeSet(r.id, [
        { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id },
        { operationType: "DEPRECATE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id },
      ]);
      const rel = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "dep" });
      expect((await prisma.entityVersion.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe("DEPRECATED");
      expect(compositionOf(rel)).toEqual({ [a.id]: a2.id, [b.id]: b1.id });

      // A DEPRECATE the lifecycle forbids (DRAFT -> DEPRECATED) blocks publication with nothing written.
      const w = await world("deprecatebad");
      const bad = await approvedChangeSet(w.r.id, [{ operationType: "DEPRECATE_ENTITY_VERSION", targetEntityId: w.b.id, fromEntityVersionId: w.b1.id }]);
      await expectCode(publishRulesetRelease({ rulesetId: w.r.id, baseManifestId: w.m.id, canonPolicyId: w.p1.id, changeSetId: bad.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.INVALID_OPERATION);
      expect((await prisma.entityVersion.findUniqueOrThrow({ where: { id: w.b1.id } })).status).toBe("DRAFT");
    });

    it("a failure AFTER the status transition, the lifecycle change, the manifest and its entries rolls ALL of it back (§34, §75)", async () => {
      const { r, a, b, a1, a2, b1 } = await world("rollback");
      for (const s of ["IN_REVIEW", "APPROVED"]) await transitionEntityVersionStatus(a1.id, s);
      const foreignPolicy = await policy((await ruleset("rbother")).id);
      const before = await rowsOf(r.id);
      // Bypass the service so the LAST statement (the release insert) fails on its composite policy key.
      const pins = [{ entityId: a.id, entityVersionId: a2.id }, { entityId: b.id, entityVersionId: b1.id }].sort((x, y) => (x.entityId < y.entityId ? -1 : 1));
      const error = await executePublication({
        rulesetId: r.id, expectedLatestManifestId: null, canonPolicyId: foreignPolicy.id, changeSetId: null, versionLabel: "rb", releaseNotes: null,
        pins, manifestHash: computeManifestHash(pins), deprecations: [a1.id],
      }).catch((e: unknown) => e);
      expect(String(error)).toMatch(/ruleset_releases_policy_fkey/);
      expect(await rowsOf(r.id)).toEqual(before); // no manifest, no entries, no release
      expect((await prisma.entityVersion.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe("APPROVED"); // lifecycle rolled back
      expect((await getRuleset(r.id)).status).toBe("APPROVED"); // status rolled back
      expect(mapPublicationError(new Error("other"))).toBeInstanceOf(Error);
    });

    it("concurrent first publications: exactly one release, no duplicate numbers, no orphan manifest, Ruleset PUBLISHED (§17, §36, §76)", async () => {
      const { r, m, p1 } = await world("race");
      const manifestsBefore = (await rowsOf(r.id)).manifests;
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) => publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, versionLabel: `race ${i}` })),
      );
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      for (const x of results.filter((y): y is PromiseRejectedResult => y.status === "rejected")) {
        expect([RULESET_RELEASE_ERROR_CODES.RELEASE_CONFLICT, RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT]).toContain((x.reason as DomainError).code);
      }
      const releases = await listRulesetReleases(r.id);
      expect(releases.map((x) => x.releaseNumber)).toEqual([1]);
      expect((await rowsOf(r.id)).manifests).toBe(manifestsBefore + 1);
      expect((await getRuleset(r.id)).status).toBe("PUBLISHED");
    });
  });

  describe("hash, diff and history (§41–§43, §48, §79–§85)", () => {
    it("verification detects a tampered release manifest, and passes again once restored (§43, §80)", async () => {
      const { r, a, a2, m, p1 } = await world("tamper");
      const rel = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, versionLabel: "t" });
      const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: rel.manifestId, entityId: a.id } });
      try {
        await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${a2.id}::uuid WHERE id = ${entry.id}::uuid`; // test-only corruption
        const v = await verifyRulesetReleaseManifestHash(rel.id);
        expect(v.valid).toBe(false);
        expect(v.storedHash).toBe(rel.manifestHash);
        expect(v.computedHash).not.toBe(rel.manifestHash);
      } finally {
        await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
      }
      expect((await verifyRulesetReleaseManifestHash(rel.id)).valid).toBe(true);
    });

    it("compares releases: A changed, B removed, C added, in Entity order (§48, §81)", async () => {
      const { r, a, b, a1, a2, b1, m, p1 } = await world("diff");
      const c = await entity("diffC");
      const c1 = await version(c.id, "C1");
      const rel1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, versionLabel: "1" });
      const cs = await approvedChangeSet(r.id, [
        { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id },
        { operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: b.id, fromEntityVersionId: b1.id },
        { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: c.id, toEntityVersionId: c1.id },
      ]);
      const rel2 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: rel1.manifestId, canonPolicyId: p1.id, changeSetId: cs.id, versionLabel: "2" });
      const diff = await compareRulesetReleases(rel1.id, rel2.id);
      const expected = [
        { type: "CHANGED_VERSION", entityId: a.id, fromEntityVersionId: a1.id, toEntityVersionId: a2.id },
        { type: "REMOVED_ENTITY", entityId: b.id, fromEntityVersionId: b1.id, toEntityVersionId: null },
        { type: "ADDED_ENTITY", entityId: c.id, fromEntityVersionId: null, toEntityVersionId: c1.id },
      ].sort((x, y) => (x.entityId < y.entityId ? -1 : 1));
      expect(diff).toEqual({ releaseAId: rel1.id, releaseBId: rel2.id, entries: expected, unchangedCount: 0 });
      expect((await compareRulesetReleases(rel1.id, rel1.id)).entries).toEqual([]);
    });

    it("release 1 is reproducible after new Versions, policy, ChangeSet and release; a decision-derived publication mutates no governance history (§82–§84)", async () => {
      const { r, a, a1, a2, a3, m, p1 } = await world("history");
      const conflict = await createRuleConflict(r.id, { entityId: a.id, conflictType: "OTHER", severity: "LOW", title: "t", candidates: [{ entityVersionId: a1.id }, { entityVersionId: a2.id }] });
      const decision = await createCanonDecision(conflict.id, { canonPolicyId: p1.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [conflict.candidates[1]!.id], rationale: "r" });
      const proposal = await proposeChangeSetFromCanonDecision(decision.id, { name: "apply D", targetManifestId: m.id });
      await submitChangeSetForReview(proposal.id);
      await approveChangeSet(proposal.id);
      const before = await fingerprint(HISTORY);
      const rel1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p1.id, changeSetId: proposal.id, versionLabel: "1" });
      expect(await fingerprint(HISTORY)).toEqual(before); // policies, records, decisions, conflicts, operations... untouched
      const snapshot = await getRulesetRelease(rel1.id);

      await version(a.id, "A4");
      const p2 = await policy(r.id);
      const cs2 = await approvedChangeSet(r.id, [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a3.id }]);
      await publishRulesetRelease({ rulesetId: r.id, baseManifestId: rel1.manifestId, canonPolicyId: p2.id, changeSetId: cs2.id, versionLabel: "2" });

      expect(await getRulesetRelease(rel1.id)).toEqual(snapshot);
      expect(snapshot).toMatchObject({ canonPolicyId: p1.id, changeSetId: proposal.id, versionLabel: "1", channel: "CORE_PLAYTEST" });
      expect(compositionOf(snapshot)[a.id]).toBe(a2.id);
      expect((await verifyRulesetReleaseManifestHash(rel1.id)).valid).toBe(true);
    });
  });

  describe("the database enforces what it can (§3, §4, §38, §54, §55)", () => {
    it("composite keys reject a foreign manifest / policy / ChangeSet; uniques reject duplicates; RESTRICT protects history", async () => {
      const one = await world("dbOne");
      const two = await world("dbTwo");
      const rel = await publishRulesetRelease({ rulesetId: one.r.id, baseManifestId: one.m.id, canonPolicyId: one.p1.id, versionLabel: "1" });
      const cs2 = await approvedChangeSet(two.r.id, [{ operationType: "NO_CHANGE" }]);
      const row = { rulesetId: one.r.id, releaseNumber: 9, versionLabel: "direct", channel: "CORE_PLAYTEST" as const, manifestId: one.m.id, canonPolicyId: one.p1.id, manifestHash: "x" };
      await expect(prisma.rulesetRelease.create({ data: { ...row, manifestId: two.m.id } })).rejects.toThrow(/ruleset_releases_manifest_fkey/);
      await expect(prisma.rulesetRelease.create({ data: { ...row, canonPolicyId: two.p1.id } })).rejects.toThrow(/ruleset_releases_policy_fkey/);
      await expect(prisma.rulesetRelease.create({ data: { ...row, changeSetId: cs2.id } })).rejects.toThrow(/ruleset_releases_change_set_fkey/);
      await expect(prisma.rulesetRelease.create({ data: { ...row, releaseNumber: 1 } })).rejects.toThrow(/ruleset_releases_ruleset_id_release_number_key/);
      await expect(prisma.rulesetRelease.create({ data: { ...row, versionLabel: "1" } })).rejects.toThrow(/ruleset_releases_ruleset_id_version_label_key/);
      await expect(prisma.rulesetManifest.delete({ where: { id: rel.manifestId } })).rejects.toThrow();
      await expect(prisma.canonPolicy.delete({ where: { id: one.p1.id } })).rejects.toThrow();
      await expect(prisma.ruleset.delete({ where: { id: one.r.id } })).rejects.toThrow();
      const keys = await prisma.$queryRaw<Array<{ delete_rule: string }>>`
        SELECT delete_rule FROM information_schema.referential_constraints WHERE constraint_name LIKE 'ruleset_releases%'`;
      expect(keys).toHaveLength(4);
      expect(keys.every((k) => k.delete_rule === "RESTRICT")).toBe(true);
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'ruleset_releases' ORDER BY column_name`;
      expect(cols.map((c) => c.column_name)).toEqual([
        "canon_policy_id", "change_set_id", "channel", "id", "manifest_hash", "manifest_id", "published_at", "release_notes", "release_number", "ruleset_id", "version_label",
      ]);
      const pointers = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'rulesets' AND column_name ~* '(release|published_manifest|current|active)'`;
      expect(pointers).toEqual([]);
    });

    it("the M2-WO8 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null }>>`
        SELECT finished_at FROM _prisma_migrations WHERE migration_name = '20261009010000_add_ruleset_releases'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
    });
  });
});
