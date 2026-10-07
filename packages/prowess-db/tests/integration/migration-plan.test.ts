/** MigrationPlan — database integration tests on real published Releases (PAS-10 M2-WO11 §25–§35). */
import { DomainError, MIGRATION_PLAN_ERROR_CODES, type CreateChangeSetOperationInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet, approveRuleset, createCanonPolicy, createChangeSet, createEntity, createEntityVersion, createMigrationPlan, createRuleset,
  createRulesetManifest, getMigrationPlan, getRulesetRelease, listMigrationPlans, prisma, previewRulesetMigration, publishRulesetRelease,
  submitChangeSetForReview, submitRulesetForReview, verifyRulesetReleaseManifestHash,
} from "../../src/index";
import { insertMigrationPlanWithItems } from "../../src/migration-plan/repository";
import { mapMigrationPlanWriteError } from "../../src/migration-plan/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let n = 0;
const rulesetIds: string[] = [];
const entityIds: string[] = [];
const MISSING = "00000000-0000-4000-8000-000000000000";

async function entity(label: string, ...names: string[]) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.migration.${label.toLowerCase()}_${tag}_${++n}` });
  entityIds.push(e.id);
  const versions = [];
  for (const name of names) versions.push(await createEntityVersion(e.id, { displayName: name }));
  return { id: e.id, v: versions.map((x) => x.id) };
}
/** An approved Ruleset with a policy, published as Release 1 from the given pins. */
async function firstRelease(label: string, pins: Array<[string, string]>) {
  const r = await createRuleset({ canonicalKey: `test.ruleset.mig_${label.toLowerCase()}_${tag}_${++n}`, name: `Migration ${label}`, channel: "CORE_PLAYTEST" });
  rulesetIds.push(r.id);
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const m = await createRulesetManifest(r.id, { entries: pins.map(([entityId, entityVersionId]) => ({ entityId, entityVersionId })) });
  const p = await createCanonPolicy(r.id, { name: "P", authorities: [] });
  const release = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p.id, versionLabel: `${label} 1` });
  return { rulesetId: r.id, policyId: p.id, release };
}
/** The next Release of the same Ruleset, applying an approved ChangeSet to the previous Release's manifest. */
async function nextRelease(ctx: { rulesetId: string; policyId: string }, previous: { manifestId: string }, label: string, operations: CreateChangeSetOperationInput[]) {
  const cs = await createChangeSet(ctx.rulesetId, { name: label, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  return publishRulesetRelease({ rulesetId: ctx.rulesetId, baseManifestId: previous.manifestId, canonPolicyId: ctx.policyId, changeSetId: cs.id, versionLabel: label });
}
async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}
async function fingerprint(tables: string[]) {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t`);
    out[t] = row?.h ?? "";
  }
  return out;
}
const ALL = ["rulesets", "ruleset_manifests", "ruleset_manifest_entries", "canon_policies", "canon_decisions", "change_sets", "change_set_operations", "ruleset_releases", "entity_versions", "migration_plans", "migration_plan_items"];
const planRows = async () => ({ plans: await prisma.migrationPlan.count(), items: await prisma.migrationPlanItem.count() });

describe("MigrationPlan (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(getTestDatabaseUrl()));
  afterAll(async () => {
    const releaseIds = (await prisma.rulesetRelease.findMany({ where: { rulesetId: { in: rulesetIds } }, select: { id: true } })).map((r: { id: string }) => r.id);
    const planIds = (await prisma.migrationPlan.findMany({ where: { OR: [{ sourceReleaseId: { in: releaseIds } }, { targetReleaseId: { in: releaseIds } }] }, select: { id: true } })).map((p: { id: string }) => p.id);
    await prisma.migrationPlanItem.deleteMany({ where: { migrationPlanId: { in: planIds } } });
    await prisma.migrationPlan.deleteMany({ where: { id: { in: planIds } } });
    const inR = { rulesetId: { in: rulesetIds } };
    await prisma.rulesetRelease.deleteMany({ where: inR });
    await prisma.changeSetOperation.deleteMany({ where: inR });
    await prisma.changeSet.deleteMany({ where: inR });
    await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: inR } });
    await prisma.canonPolicy.deleteMany({ where: inR });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: inR } });
    await prisma.rulesetManifest.updateMany({ where: inR, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: inR });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    const versionIds = (await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } })).map((v: { id: string }) => v.id);
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  it("identical compositions: all UNCHANGED, zero review required, no Release modified (§25)", async () => {
    const a = await entity("idA", "A1");
    const b = await entity("idB", "B1");
    const ctx = await firstRelease("identical", [[a.id, a.v[0]!], [b.id, b.v[0]!]]);
    const r2 = await publishRulesetRelease({ rulesetId: ctx.rulesetId, baseManifestId: ctx.release.manifestId, canonPolicyId: ctx.policyId, versionLabel: "identical 2" });
    const before = await getRulesetRelease(ctx.release.id);
    const plan = await createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id, name: "same" });
    expect(plan.summary).toEqual({ unchanged: 2, added: 0, removed: 0, changed: 0, reviewRequired: 0, total: 2 });
    expect(plan.items.every((i) => i.compatibilityClassification === "UNCHANGED")).toBe(true);
    expect(await getRulesetRelease(ctx.release.id)).toEqual(before);
  });

  it("changed Version: CHANGED_VERSION / REVIEW_REQUIRED with exact ids and no compatibility claim (§16, §26)", async () => {
    const a = await entity("chA", "A1", "A2");
    const ctx = await firstRelease("changed", [[a.id, a.v[0]!]]);
    const r2 = await nextRelease(ctx, ctx.release, "changed 2", [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a.v[0]!, toEntityVersionId: a.v[1]! }]);
    const plan = await createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id, name: "A1 -> A2" });
    expect(plan.items.map((i) => [i.entityId, i.changeType, i.compatibilityClassification, i.sourceEntityVersionId, i.targetEntityVersionId])).toEqual([
      [a.id, "CHANGED_VERSION", "REVIEW_REQUIRED", a.v[0], a.v[1]],
    ]);
    expect((await getRulesetRelease(ctx.release.id)).composition.map((p) => p.entityVersionId)).toEqual([a.v[0]]); // Release 1 still pins A1
  });

  it("added / removed and multiple changes, in Entity-id order, with structural counts (§27, §28)", async () => {
    const [a, b, c, d] = [await entity("mA", "A1", "A2"), await entity("mB", "B1"), await entity("mC", "C1"), await entity("mD", "D1")];
    const ctx = await firstRelease("multi", [[a.id, a.v[0]!], [b.id, b.v[0]!], [c.id, c.v[0]!]]);
    const r2 = await nextRelease(ctx, ctx.release, "multi 2", [
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.id, fromEntityVersionId: a.v[0]!, toEntityVersionId: a.v[1]! },
      { operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: b.id, fromEntityVersionId: b.v[0]! },
      { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: d.id, toEntityVersionId: d.v[0]! },
    ]);
    const plan = await createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id, name: "multi" });
    const expected = [[a.id, "CHANGED_VERSION"], [b.id, "REMOVED_ENTITY"], [c.id, "UNCHANGED"], [d.id, "ADDED_ENTITY"]].sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
    expect(plan.items.map((i) => [i.entityId, i.changeType])).toEqual(expected);
    expect(plan.summary).toEqual({ unchanged: 1, added: 1, removed: 1, changed: 1, reviewRequired: 3, total: 4 });
    const preview = await previewRulesetMigration({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id });
    expect(preview.items.map((i) => [i.entityId, i.changeType, i.sourceEntityVersionId, i.targetEntityVersionId])).toEqual(plan.items.map((i) => [i.entityId, i.changeType, i.sourceEntityVersionId, i.targetEntityVersionId]));
    expect(preview.summary).toEqual(plan.summary);
    const removed = plan.items.find((i) => i.changeType === "REMOVED_ENTITY")!;
    expect(removed.targetEntityVersionId).toBeNull();
    expect(plan.items.find((i) => i.changeType === "ADDED_ENTITY")!.sourceEntityVersionId).toBeNull();
  });

  it("legacy preservation and NO implicit latest: a later Release 3 changes nothing in the plan or Release 1 (§17, §29, §30)", async () => {
    const a = await entity("latestA", "A1", "A2", "A3");
    const ctx = await firstRelease("latest", [[a.id, a.v[0]!]]);
    const r2 = await nextRelease(ctx, ctx.release, "latest 2", [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a.v[1]! }]);
    const plan = await createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id, name: "1 -> 2" });
    const r1Before = await getRulesetRelease(ctx.release.id);
    const r3 = await nextRelease(ctx, r2, "latest 3", [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a.v[2]! }]);
    await createEntityVersion(a.id, { displayName: "A4" });
    const again = await getMigrationPlan(plan.id);
    expect(again).toEqual(plan);
    expect([again.sourceReleaseId, again.targetReleaseId]).toEqual([ctx.release.id, r2.id]);
    expect(JSON.stringify(again)).not.toContain(r3.id);
    expect(again.items[0]).toMatchObject({ sourceEntityVersionId: a.v[0], targetEntityVersionId: a.v[1] });
    expect(await getRulesetRelease(ctx.release.id)).toEqual(r1Before); // composition, hash, policy, label, timestamps
    expect((await verifyRulesetReleaseManifestHash(ctx.release.id)).valid).toBe(true);
    expect(again.sourceManifestHash).toBe(r1Before.manifestHash);
  });

  it("cross-Ruleset: two Rulesets' exact Releases compare structurally, nothing inferred (§3, §33)", async () => {
    const [a, b, c] = [await entity("xA", "A1", "A2"), await entity("xB", "B1"), await entity("xC", "C1")];
    const core = await firstRelease("core", [[a.id, a.v[0]!], [b.id, b.v[0]!]]);
    const exp = await firstRelease("experimental", [[a.id, a.v[1]!], [c.id, c.v[0]!]]);
    const plan = await createMigrationPlan({ sourceReleaseId: core.release.id, targetReleaseId: exp.release.id, name: "Core -> Experimental" });
    expect(Object.fromEntries(plan.items.map((i) => [i.entityId, i.changeType]))).toEqual({ [a.id]: "CHANGED_VERSION", [b.id]: "REMOVED_ENTITY", [c.id]: "ADDED_ENTITY" });
  });

  it("a tampered Release is refused with MANIFEST_INTEGRITY_FAILURE; nothing is persisted (§4, §31)", async () => {
    const a = await entity("tamperA", "A1", "A2");
    const ctx = await firstRelease("tamper", [[a.id, a.v[0]!]]);
    const r2 = await publishRulesetRelease({ rulesetId: ctx.rulesetId, baseManifestId: ctx.release.manifestId, canonPolicyId: ctx.policyId, versionLabel: "tamper 2" });
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: ctx.release.manifestId } });
    const before = await planRows();
    try {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${a.v[1]!}::uuid WHERE id = ${entry.id}::uuid`;
      await expectCode(createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id, name: "x" }), MIGRATION_PLAN_ERROR_CODES.MANIFEST_INTEGRITY_FAILURE);
      await expectCode(previewRulesetMigration({ sourceReleaseId: r2.id, targetReleaseId: ctx.release.id }), MIGRATION_PLAN_ERROR_CODES.MANIFEST_INTEGRITY_FAILURE, "target side too");
    } finally {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
    }
    expect(await planRows()).toEqual(before);
    expect((await verifyRulesetReleaseManifestHash(ctx.release.id)).valid).toBe(true);
  });

  it("preview is read-only: every relevant table is byte-identical afterwards (§11, §32)", async () => {
    const a = await entity("roA", "A1", "A2");
    const ctx = await firstRelease("readonly", [[a.id, a.v[0]!]]);
    const r2 = await nextRelease(ctx, ctx.release, "readonly 2", [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a.v[1]! }]);
    const before = await fingerprint(ALL);
    const preview = await previewRulesetMigration({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id });
    expect(preview.summary.changed).toBe(1);
    expect(preview.source).toMatchObject({ releaseId: ctx.release.id, releaseNumber: 1 });
    expect(await fingerprint(ALL)).toEqual(before);
  });

  it("a late failure during creation leaves no plan and no items (§12, §23, §34)", async () => {
    const [a, b] = [await entity("rbA", "A1"), await entity("rbB", "B1")];
    const ctx = await firstRelease("rollback", [[a.id, a.v[0]!]]);
    const before = await planRows();
    const hist = await fingerprint(["ruleset_releases", "ruleset_manifest_entries", "entity_versions"]);
    // Bypass the service so the LAST item violates its composite Version key (B1 is not a Version of A) after the plan and one item were inserted.
    const error = await insertMigrationPlanWithItems(
      { sourceReleaseId: ctx.release.id, targetReleaseId: ctx.release.id, sourceManifestHash: "x", targetManifestHash: "x", name: "late", description: null },
      [
        { entityId: a.id as never, sourceEntityVersionId: a.v[0] as never, targetEntityVersionId: a.v[0] as never, changeType: "UNCHANGED", compatibilityClassification: "UNCHANGED" },
        { entityId: a.id as never, sourceEntityVersionId: null, targetEntityVersionId: b.v[0] as never, changeType: "ADDED_ENTITY", compatibilityClassification: "REVIEW_REQUIRED" },
      ],
    ).catch((e: unknown) => e);
    expect(String(error)).toMatch(/migration_plan_items_(target_version_fkey|plan_entity_key)/);
    expect(await planRows()).toEqual(before);
    expect(await fingerprint(["ruleset_releases", "ruleset_manifest_entries", "entity_versions"])).toEqual(hist);
    const single = await insertMigrationPlanWithItems(
      { sourceReleaseId: ctx.release.id, targetReleaseId: ctx.release.id, sourceManifestHash: "x", targetManifestHash: "x", name: "late2", description: null },
      [{ entityId: a.id as never, sourceEntityVersionId: null, targetEntityVersionId: b.v[0] as never, changeType: "ADDED_ENTITY", compatibilityClassification: "REVIEW_REQUIRED" }],
    ).catch((e: unknown) => e);
    expect(String(single)).toMatch(/migration_plan_items_target_version_fkey/);
    expect(mapMigrationPlanWriteError(single)).toMatchObject({ code: MIGRATION_PLAN_ERROR_CODES.INVALID_VERSION_REFERENCE });
    expect(await planRows()).toEqual(before);
  });

  it("referenced Releases, Entities and Versions cannot be deleted while a plan depends on them; plans have no delete path (§9, §35)", async () => {
    const a = await entity("delA", "A1", "A2");
    const ctx = await firstRelease("delete", [[a.id, a.v[0]!]]);
    const r2 = await nextRelease(ctx, ctx.release, "delete 2", [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: a.id, toEntityVersionId: a.v[1]! }]);
    const plan = await createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: r2.id, name: "keep" });
    await expect(prisma.rulesetRelease.delete({ where: { id: ctx.release.id } })).rejects.toThrow(/migration_plans_source_release_fkey/);
    await expect(prisma.rulesetRelease.delete({ where: { id: r2.id } })).rejects.toThrow(/migration_plans_target_release_fkey/);
    await expect(prisma.migrationPlan.delete({ where: { id: plan.id } })).rejects.toThrow(/migration_plan_items_plan_fkey/);
    await expect(prisma.entityVersion.delete({ where: { id: a.v[0]! } })).rejects.toThrow();
    await expect(prisma.entity.delete({ where: { id: a.id } })).rejects.toThrow();
    const rules = await prisma.$queryRaw<Array<{ delete_rule: string }>>`SELECT delete_rule FROM information_schema.referential_constraints WHERE constraint_name LIKE 'migration_plan%'`;
    expect(rules).toHaveLength(6);
    expect(rules.every((r) => r.delete_rule === "RESTRICT")).toBe(true);
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'migration_plan%' AND column_name ~* '(applied|current|active|complete|executed|updated_at|status)'`;
    expect(cols).toEqual([]);
    const names = Object.keys(await import("../../src/index")).filter((k) => /migrat/i.test(k)).sort();
    expect(names).toEqual(["createMigrationPlan", "getMigrationPlan", "listMigrationPlans", "previewRulesetMigration"]);
  });

  it("explicit selection and controlled errors: missing or identical Releases, unknown plans, filters (§2, §13, §22)", async () => {
    const a = await entity("errA", "A1");
    const ctx = await firstRelease("errors", [[a.id, a.v[0]!]]);
    await expectCode(createMigrationPlan({ sourceReleaseId: MISSING, targetReleaseId: ctx.release.id, name: "x" }), MIGRATION_PLAN_ERROR_CODES.SOURCE_RELEASE_NOT_FOUND);
    await expectCode(createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: "nope", name: "x" }), MIGRATION_PLAN_ERROR_CODES.TARGET_RELEASE_NOT_FOUND);
    await expectCode(previewRulesetMigration({ sourceReleaseId: ctx.release.id, targetReleaseId: ctx.release.id }), MIGRATION_PLAN_ERROR_CODES.INVALID_INPUT);
    await expectCode(createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: MISSING, name: " " }), MIGRATION_PLAN_ERROR_CODES.INVALID_INPUT);
    await expectCode(getMigrationPlan(MISSING), MIGRATION_PLAN_ERROR_CODES.NOT_FOUND);
    await expectCode(listMigrationPlans({ sourceReleaseId: "bad" }), MIGRATION_PLAN_ERROR_CODES.INVALID_INPUT);
    const b = await firstRelease("errors2", [[a.id, a.v[0]!]]);
    const p1 = await createMigrationPlan({ sourceReleaseId: ctx.release.id, targetReleaseId: b.release.id, name: "one" });
    const p2 = await createMigrationPlan({ sourceReleaseId: b.release.id, targetReleaseId: ctx.release.id, name: "two" });
    expect((await listMigrationPlans({ sourceReleaseId: ctx.release.id })).map((p) => p.id)).toEqual([p1.id]);
    expect((await listMigrationPlans({ targetReleaseId: ctx.release.id })).map((p) => p.id)).toEqual([p2.id]);
  });
});
