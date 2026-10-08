/**
 * M2 FINAL AUDIT (PAS-10 M2-WO12) — the whole of M2 exercised as ONE governance system on the golden history fixture.
 * Every check here verifies an existing invariant; nothing is redesigned. prowess_studio_test only (guarded).
 */
import {
  CANON_DECISION_ERROR_CODES, CHANGE_SET_ERROR_CODES, DomainError, ENTITY_VERSION_ERROR_CODES, MIGRATION_PLAN_ERROR_CODES, RULESET_RELEASE_ERROR_CODES, SOURCE_REFERENCE_ERROR_CODES,
} from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeChangeSetImpact, approveChangeSet, approveRuleset, assignKeywordToEntity, compareRulesetReleases, createCanonDecision, createCanonPolicy,
  createChangeSet, createEntity, createEntityRelationship, createEntityVersion, createKeywordDefinition, createMigrationPlan, createRuleConflict,
  createRuleset, createRulesetManifest, getCanonDecision, getCanonPolicy, getChangeSet, getEffectiveManifestEntries, getMigrationPlan, getRuleConflict,
  getRulesetManifest, getRulesetRelease, listCanonDecisions, listCanonPolicies, listChangeSets, listMigrationPlans, listRuleConflicts, listRulesetManifests,
  listRulesetReleases, prisma, previewRulesetMigration, publishRulesetRelease, rejectChangeSet, resolveEffectiveEntityVersion, resolveSourceAuthority,
  createSourceDocument, createSourceReference, getEntityVersion, removeSourceReference, submitChangeSetForReview, submitRulesetForReview,
  transitionEntityVersionStatus, updateDraftEntityVersion, verifyRulesetReleaseManifestHash,
} from "../../src/index";
import { computeManifestHash } from "../../src/ruleset-release/hash";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { buildM2GoldenHistory, cleanupM2GoldenHistories, type GoldenHistory } from "./fixtures/m2-golden-history";

const PREFIX = `test.m2final.${Date.now()}`;
let n = 0;
const k = (s: string) => `${PREFIX}.${s}_${++n}`;
let g: GoldenHistory;

async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}
const pins = (rows: Array<{ entityId: string; entityVersionId: string }>) => rows.map((r) => `${r.entityId}:${r.entityVersionId}`).sort();
async function approvedRuleset(label: string) {
  const r = await createRuleset({ canonicalKey: k(`ruleset_${label}`), name: `${PREFIX} ${label}`, channel: "CORE_PLAYTEST" });
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  return r;
}
async function fingerprint(tables: string[]) {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t`);
    out[t] = row?.h ?? "";
  }
  return out;
}
/** Every historical object of the golden history, read back through the public services. */
async function historicalSnapshot() {
  return {
    M1: await getRulesetManifest(g.manifests.M1.id),
    M1effective: await getEffectiveManifestEntries(g.manifests.M1.id),
    M2effective: await getEffectiveManifestEntries(g.manifests.M2.id),
    P1: await getCanonPolicy(g.policies.P1.id),
    P2: await getCanonPolicy(g.policies.P2.id),
    C1: await getRuleConflict(g.conflicts.C1.id),
    D1: await getCanonDecision(g.decisions.D1.id),
    CS1: await getChangeSet(g.changeSets.CS1.id),
    CS2: await getChangeSet(g.changeSets.CS2.id),
    R1: await getRulesetRelease(g.releases.R1.id),
    R2: await getRulesetRelease(g.releases.R2.id),
    plan: await getMigrationPlan(g.plan.id),
    sourceRows: await prisma.sourceDocument.findMany({ where: { id: { in: [g.sources.docA.id, g.sources.docB.id] } }, orderBy: { id: "asc" } }),
    referenceRows: await prisma.sourceReference.findMany({ where: { id: { in: [g.sources.refA1.id, g.sources.refA2.id] } }, orderBy: { id: "asc" } }),
    versionRows: await prisma.entityVersion.findMany({ where: { entityId: { in: [g.entities.A.id, g.entities.B.id, g.entities.C.id] } }, orderBy: { id: "asc" } }),
  };
}

describe("M2 final audit (prowess_studio_test only)", () => {
  let initial: Awaited<ReturnType<typeof historicalSnapshot>>;
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    g = await buildM2GoldenHistory(PREFIX);
    initial = await historicalSnapshot();
  }, 60_000);
  afterAll(() => cleanupM2GoldenHistories(PREFIX), 60_000);

  it("§3/§4 the golden history holds exactly the original references", () => {
    const { A, B, C } = g.entities;
    const { A1, A2, B1, B2, C1 } = g.versions;
    expect(pins(initial.M1.entries!)).toEqual(pins([{ entityId: A.id, entityVersionId: A1.id }, { entityId: B.id, entityVersionId: B1.id }]));
    expect(initial.P1.authorities!.map((a) => [a.sourceDocumentId, a.scopeKey, a.authorityStatus]).sort()).toEqual(
      [[g.sources.docA.id, "global", "CURRENT_PRIMARY"], [g.sources.docB.id, "spell.affinity", "REFERENCE_ONLY"]].sort(),
    );
    expect(initial.C1.status).toBe("RESOLVED");
    expect(initial.C1.candidates!.map((c) => [c.entityVersionId, c.sourceReferenceId])).toEqual([[A1.id, g.sources.refA1.id], [A2.id, g.sources.refA2.id]]);
    expect(initial.D1).toMatchObject({ ruleConflictId: g.conflicts.C1.id, canonPolicyId: g.policies.P1.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED" });
    expect(initial.D1.selections!.map((s) => s.ruleConflictCandidateId)).toEqual([g.conflicts.C1.candidates[1]!.id]);
    expect(initial.CS1.operations!.map((o) => [o.operationType, o.fromEntityVersionId, o.toEntityVersionId, o.targetManifestId])).toEqual([["REPLACE_ENTITY_VERSION", A1.id, A2.id, g.manifests.M1.id]]);
    expect(initial.CS1).toMatchObject({ canonDecisionId: g.decisions.D1.id, status: "APPROVED" });
    expect(pins(initial.R1.composition!)).toEqual(pins([{ entityId: A.id, entityVersionId: A2.id }, { entityId: B.id, entityVersionId: B1.id }]));
    expect(pins(initial.R2.composition!)).toEqual(pins([{ entityId: A.id, entityVersionId: A2.id }, { entityId: B.id, entityVersionId: B2.id }, { entityId: C.id, entityVersionId: C1.id }]));
    expect(initial.R1).toMatchObject({ releaseNumber: 1, canonPolicyId: g.policies.P1.id, changeSetId: g.changeSets.CS1.id });
    expect(initial.R2).toMatchObject({ releaseNumber: 2, canonPolicyId: g.policies.P2.id, changeSetId: g.changeSets.CS2.id });
    expect(Object.fromEntries(initial.plan.items.map((i) => [i.entityId, [i.changeType, i.compatibilityClassification]]))).toEqual({
      [A.id]: ["UNCHANGED", "UNCHANGED"], [B.id]: ["CHANGED_VERSION", "REVIEW_REQUIRED"], [C.id]: ["ADDED_ENTITY", "REVIEW_REQUIRED"],
    });
    expect([initial.plan.sourceReleaseId, initial.plan.targetReleaseId, initial.plan.sourceManifestHash]).toEqual([g.releases.R1.id, g.releases.R2.id, initial.R1.manifestHash]);
  });

  it("§8 manifest inheritance follows exact parent ids; a newer parent manifest never changes an old child's effective resolution", async () => {
    const { A, B } = g.entities;
    // Inheritance runs between a child Ruleset and its PARENT Ruleset (M2-WO3), so build a child of R here.
    const child = await createRuleset({ canonicalKey: k("ruleset_child"), name: `${PREFIX} child`, channel: "CORE_PLAYTEST", parentRulesetId: g.ruleset.id });
    const cm = await createRulesetManifest(child.id, { parentManifestId: g.manifests.M1.id, entries: [{ entityId: B.id, entityVersionId: g.versions.B2.id }] });
    const effective = await getEffectiveManifestEntries(cm.id);
    expect(Object.fromEntries(effective.map((e) => [e.entityId, [e.entityVersionId, e.source, e.resolutionDepth, e.resolvedFromManifestId]]))).toEqual({
      [A.id]: [g.versions.A1.id, "INHERITED", 1, g.manifests.M1.id],
      [B.id]: [g.versions.B2.id, "EXPLICIT", 0, cm.id],
    });
    // A NEWER parent-Ruleset manifest (A→A3) must not change the child, which pins M1 exactly.
    await createRulesetManifest(g.ruleset.id, { entries: [{ entityId: A.id, entityVersionId: g.versions.A3.id }] });
    expect(await getEffectiveManifestEntries(cm.id)).toEqual(effective);
    expect((await resolveEffectiveEntityVersion(cm.id, A.id))?.entityVersionId).toBe(g.versions.A1.id);
    expect(await getRulesetManifest(g.manifests.M1.id)).toEqual(initial.M1); // explicit entries immutable
    expect((await getRulesetManifest(g.releases.R1.manifestId)).parentManifestId).toBeNull(); // release manifests are flattened
    expect((await getRulesetManifest(g.releases.R2.manifestId)).parentManifestId).toBeNull();
  });

  it("§10/§11 P1 resolves exact → global → UNRESOLVED inside P1 only; SourceDocument metadata stays independent", async () => {
    const { docA, docB } = g.sources;
    const other = await prisma.sourceDocument.create({ data: { title: `${PREFIX} unrelated`, sourceType: "DOCUMENT" } });
    expect(await resolveSourceAuthority(g.policies.P1.id, docB.id, "spell.affinity")).toMatchObject({ source: "EXACT", authorityStatus: "REFERENCE_ONLY" });
    expect(await resolveSourceAuthority(g.policies.P1.id, docA.id, "spell.effect")).toMatchObject({ source: "GLOBAL_FALLBACK", authorityStatus: "CURRENT_PRIMARY" });
    expect(await resolveSourceAuthority(g.policies.P1.id, other.id, "spell.affinity")).toMatchObject({ source: "UNRESOLVED" });
    expect(await resolveSourceAuthority(g.policies.P2.id, docA.id, "global")).toMatchObject({ authorityStatus: "REFERENCE_ONLY" }); // P2 differs…
    expect(await resolveSourceAuthority(g.policies.P1.id, docA.id, "global")).toMatchObject({ authorityStatus: "CURRENT_PRIMARY" }); // …P1 does not follow it
    expect(await resolveSourceAuthority(g.policies.P2.id, docB.id, "spell.affinity")).toMatchObject({ source: "UNRESOLVED" }); // no cross-policy fallback
    expect(initial.sourceRows.find((d) => d.id === docA.id)!.authorityStatus).toBe("REFERENCE_ONLY"); // the document's OWN metadata — never written by policies
  });

  it("§15/§16 impact is live-derived and read-only; the ChangeSet snapshot never moves", async () => {
    const tables = ["rulesets", "ruleset_manifests", "ruleset_manifest_entries", "canon_policies", "source_authority_records", "rule_conflicts", "rule_conflict_candidates", "canon_decisions", "canon_decision_selections", "change_sets", "change_set_operations", "ruleset_releases", "migration_plans", "migration_plan_items", "entity_versions", "entity_relationships", "entity_keywords", "source_references"];
    const before = await fingerprint(tables);
    const first = await analyzeChangeSetImpact(g.changeSets.CS1.id);
    const second = await analyzeChangeSetImpact(g.changeSets.CS1.id);
    expect(await fingerprint(tables)).toEqual(before);
    expect(second).toEqual(first);
    // Change the surrounding graph through normal services: a relationship and a keyword on A.
    await createEntityRelationship({ sourceEntityId: g.entities.A.id, targetEntityId: g.entities.C.id, relationshipType: "REQUIRES" });
    const kw = await createKeywordDefinition({ canonicalKey: `${PREFIX}.kw.fire`, name: "Fire" });
    await assignKeywordToEntity(g.entities.A.id, kw.id);
    const third = await analyzeChangeSetImpact(g.changeSets.CS1.id);
    expect(third).not.toEqual(first); // the LIVE report reflects the new graph…
    expect(third.items.some((i) => i.category === "RELATIONSHIP_DEPENDENT_ENTITY" && i.resourceId === g.entities.C.id)).toBe(true);
    expect(await getChangeSet(g.changeSets.CS1.id)).toEqual(initial.CS1); // …the ChangeSet snapshot does not
  });

  it("§18/§19/§20 hashes verify and recompute; tampering is detected and blocks planning; release history stays linear", async () => {
    for (const r of [initial.R1, initial.R2]) {
      expect((await verifyRulesetReleaseManifestHash(r.id)).valid).toBe(true);
      expect(computeManifestHash(r.composition!)).toBe(r.manifestHash);
      expect(computeManifestHash([...r.composition!].reverse())).toBe(r.manifestHash);
    }
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: g.releases.R1.manifestId, entityId: g.entities.B.id } });
    const plansBefore = await prisma.migrationPlan.count();
    try {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${g.versions.B2.id}::uuid WHERE id = ${entry.id}::uuid`;
      expect((await verifyRulesetReleaseManifestHash(g.releases.R1.id)).valid).toBe(false);
      await expectCode(createMigrationPlan({ sourceReleaseId: g.releases.R1.id, targetReleaseId: g.releases.R2.id, name: "tampered" }), MIGRATION_PLAN_ERROR_CODES.MANIFEST_INTEGRITY_FAILURE);
    } finally {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
    }
    expect(await prisma.migrationPlan.count()).toBe(plansBefore);
    expect((await verifyRulesetReleaseManifestHash(g.releases.R1.id)).valid).toBe(true);
    await expectCode(
      publishRulesetRelease({ rulesetId: g.ruleset.id, baseManifestId: g.manifests.M1.id, canonPolicyId: g.policies.P2.id, versionLabel: "fork attempt" }),
      RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT,
    );
  });

  it("§7 Ruleset isolation: nothing leaks, and wrong-Ruleset references fail with controlled errors", async () => {
    const S = await approvedRuleset("isolation");
    const sm = await createRulesetManifest(S.id, { entries: [{ entityId: g.entities.A.id, entityVersionId: g.versions.A1.id }] });
    const sp = await createCanonPolicy(S.id, { name: "S policy", authorities: [] });
    const sConflict = await createRuleConflict(S.id, { entityId: g.entities.A.id, conflictType: "OTHER", severity: "LOW", title: "S", candidates: [{ entityVersionId: g.versions.A1.id }, { entityVersionId: g.versions.A2.id }] });
    await expectCode(createCanonDecision(sConflict.id, { canonPolicyId: g.policies.P1.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [sConflict.candidates[0]!.id], rationale: "x" }), CANON_DECISION_ERROR_CODES.INVALID_POLICY_CONTEXT);
    await expectCode(createCanonDecision(sConflict.id, { canonPolicyId: sp.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [g.conflicts.C1.candidates[0]!.id], rationale: "x" }), CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE);
    await expectCode(createChangeSet(S.id, { canonDecisionId: g.decisions.D1.id, name: "x", operations: [{ operationType: "NO_CHANGE" }] }), CHANGE_SET_ERROR_CODES.INVALID_DECISION_CONTEXT);
    await expectCode(createChangeSet(S.id, { name: "x", operations: [{ operationType: "NO_CHANGE", targetManifestId: g.manifests.M1.id }] }), CHANGE_SET_ERROR_CODES.INVALID_MANIFEST_CONTEXT);
    await expectCode(publishRulesetRelease({ rulesetId: S.id, baseManifestId: g.manifests.M1.id, canonPolicyId: sp.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT);
    await expectCode(publishRulesetRelease({ rulesetId: S.id, baseManifestId: sm.id, canonPolicyId: g.policies.P1.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.INVALID_POLICY_CONTEXT);
    await expectCode(publishRulesetRelease({ rulesetId: S.id, baseManifestId: sm.id, canonPolicyId: sp.id, changeSetId: g.changeSets.CS2.id, versionLabel: "x" }), RULESET_RELEASE_ERROR_CODES.INVALID_CHANGE_SET_CONTEXT);
    expect(await resolveSourceAuthority(sp.id, g.sources.docA.id, "global")).toMatchObject({ source: "UNRESOLVED" }); // P1's authority does not leak into S
    const rIds = new Set<string>([g.manifests.M1.id, g.manifests.M2.id, g.policies.P1.id, g.policies.P2.id, g.conflicts.C1.id, g.conflicts.C2.id, g.decisions.D1.id, g.decisions.D2.id, g.changeSets.CS1.id, g.changeSets.CS2.id, g.releases.R1.id, g.releases.R2.id]);
    const sIds = [
      ...(await listRulesetManifests(S.id)), ...(await listCanonPolicies(S.id)), ...(await listRuleConflicts(S.id)),
      ...(await listCanonDecisions(S.id)), ...(await listChangeSets(S.id)), ...(await listRulesetReleases(S.id)),
    ].map((x) => x.id as string);
    expect(sIds.filter((id) => rIds.has(id))).toEqual([]);
    expect((await listMigrationPlans({ sourceReleaseId: g.releases.R1.id })).map((p) => p.targetReleaseId)).toEqual([g.releases.R2.id]); // only explicit endpoints
  });

  it("§9/§17/§21/§22/§24/§55/§56 later activity rewrites nothing; no auto-publish, no auto-migration, no forced upgrade", async () => {
    const releasesBefore = await prisma.rulesetRelease.count({ where: { rulesetId: g.ruleset.id } });
    const plansBefore = await prisma.migrationPlan.count();
    // Later governance activity, each step explicitly NOT a publication.
    const A4 = await createEntityVersion(g.entities.A.id, { displayName: "Emission (v4)" });
    await transitionEntityVersionStatus(A4.id, "IN_REVIEW");
    await transitionEntityVersionStatus(A4.id, "APPROVED");
    const P3 = await createCanonPolicy(g.ruleset.id, { name: "P3", authorities: [] });
    const c3 = await createRuleConflict(g.ruleset.id, { entityId: g.entities.A.id, conflictType: "OTHER", severity: "LOW", title: "Later", candidates: [{ entityVersionId: g.versions.A2.id }, { entityVersionId: A4.id }] });
    const d3 = await createCanonDecision(c3.id, { canonPolicyId: P3.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [c3.candidates[1]!.id], rationale: "later" });
    const cs3 = await createChangeSet(g.ruleset.id, { canonDecisionId: d3.id, name: "later", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: g.entities.A.id, fromEntityVersionId: g.versions.A2.id, toEntityVersionId: A4.id }] });
    await submitChangeSetForReview(cs3.id);
    await approveChangeSet(cs3.id);
    expect(await prisma.rulesetRelease.count({ where: { rulesetId: g.ruleset.id } })).toBe(releasesBefore); // §55
    await previewRulesetMigration({ sourceReleaseId: g.releases.R1.id, targetReleaseId: g.releases.R2.id });
    expect(await prisma.migrationPlan.count()).toBe(plansBefore); // preview ≠ persistence (§56)
    const R3 = await publishRulesetRelease({ rulesetId: g.ruleset.id, baseManifestId: g.releases.R2.manifestId, canonPolicyId: P3.id, changeSetId: cs3.id, versionLabel: "Core Playtest 3" });
    expect(await prisma.migrationPlan.count()).toBe(plansBefore); // a new Release ≠ a migration (§56)

    const after = await historicalSnapshot();
    expect(after).toEqual({ ...initial, C1: after.C1, versionRows: after.versionRows }); // compare everything…
    expect(after.C1).toEqual(initial.C1); // …C1 included
    expect(after.versionRows.filter((v) => initial.versionRows.some((i) => i.id === v.id))).toEqual(initial.versionRows); // old Versions untouched (A4 is new)
    // §21 the old plan is still exactly R1 → R2; §22 compatibility never overstated
    const plan = await getMigrationPlan(g.plan.id);
    expect([plan.sourceReleaseId, plan.targetReleaseId]).toEqual([g.releases.R1.id, g.releases.R2.id]);
    expect(JSON.stringify(plan)).not.toContain(R3.id);
    expect(new Set(plan.items.map((i) => i.compatibilityClassification))).toEqual(new Set(["UNCHANGED", "REVIEW_REQUIRED"]));
    // §24 the legacy Release stays retrievable, verifiable, comparable and usable as a plan endpoint
    expect((await verifyRulesetReleaseManifestHash(g.releases.R1.id)).valid).toBe(true);
    expect((await compareRulesetReleases(g.releases.R1.id, R3.id)).entries.length).toBeGreaterThan(0);
    const legacy = await createMigrationPlan({ sourceReleaseId: g.releases.R1.id, targetReleaseId: R3.id, name: "R1 → R3" });
    expect(legacy.items.find((i) => i.entityId === g.entities.A.id)).toMatchObject({ changeType: "CHANGED_VERSION", sourceEntityVersionId: g.versions.A2.id, targetEntityVersionId: A4.id });
  });

  it("§26 concurrency: allocation, decisions, review transitions and publication stay single-winner with no orphans", async () => {
    const r = await approvedRuleset("concurrency");
    const pin = [{ entityId: g.entities.A.id, entityVersionId: g.versions.A1.id }];
    const manifests = await Promise.all(Array.from({ length: 5 }, () => createRulesetManifest(r.id, { entries: pin })));
    expect(manifests.map((m) => m.manifestVersion).sort()).toEqual([1, 2, 3, 4, 5]);
    const policies = await Promise.all(Array.from({ length: 5 }, (_, i) => createCanonPolicy(r.id, { name: `p${i}`, authorities: [] })));
    expect(policies.map((p) => p.policyVersion).sort()).toEqual([1, 2, 3, 4, 5]);
    const conflict = await createRuleConflict(r.id, { entityId: g.entities.A.id, conflictType: "OTHER", severity: "LOW", title: "race", candidates: [{ entityVersionId: g.versions.A1.id }, { entityVersionId: g.versions.A2.id }] });
    const decisions = await Promise.allSettled(Array.from({ length: 4 }, () => createCanonDecision(conflict.id, { canonPolicyId: policies[0]!.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [conflict.candidates[0]!.id], rationale: "race" })));
    expect(decisions.filter((d) => d.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.canonDecision.count({ where: { ruleConflictId: conflict.id } })).toBe(1);
    const cs = await createChangeSet(r.id, { name: "race", operations: [{ operationType: "NO_CHANGE" }] });
    await submitChangeSetForReview(cs.id);
    const transitions = await Promise.allSettled([approveChangeSet(cs.id), rejectChangeSet(cs.id), approveChangeSet(cs.id)]);
    expect(transitions.filter((t) => t.status === "fulfilled")).toHaveLength(1);
    const firsts = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => publishRulesetRelease({ rulesetId: r.id, baseManifestId: manifests[0]!.id, canonPolicyId: policies[0]!.id, versionLabel: `first ${i}` })));
    expect(firsts.filter((p) => p.status === "fulfilled")).toHaveLength(1);
    const release1 = (await listRulesetReleases(r.id))[0]!;
    const seconds = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => publishRulesetRelease({ rulesetId: r.id, baseManifestId: release1.manifestId, canonPolicyId: policies[0]!.id, versionLabel: `second ${i}` })));
    expect(seconds.filter((p) => p.status === "fulfilled")).toHaveLength(1);
    expect((await listRulesetReleases(r.id)).map((x) => x.releaseNumber)).toEqual([1, 2]);
    expect(await prisma.rulesetManifest.count({ where: { rulesetId: r.id } })).toBe(5 + 2); // 5 created + 2 release manifests: no orphans
  }, 60_000);

  it("§27 RESTRICT protects every historical dependency from direct deletion", async () => {
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["EntityVersion referenced by a manifest", () => prisma.entityVersion.delete({ where: { id: g.versions.B1.id } })],
      ["SourceDocument referenced by a policy and evidence", () => prisma.sourceDocument.delete({ where: { id: g.sources.docA.id } })],
      ["Manifest referenced by a child manifest / ChangeSet", () => prisma.rulesetManifest.delete({ where: { id: g.manifests.M1.id } })],
      ["Release manifest referenced by its Release", () => prisma.rulesetManifest.delete({ where: { id: g.releases.R1.manifestId } })],
      ["CanonPolicy referenced by a decision / release", () => prisma.canonPolicy.delete({ where: { id: g.policies.P1.id } })],
      ["RuleConflict referenced by a decision", () => prisma.ruleConflict.delete({ where: { id: g.conflicts.C1.id } })],
      ["CanonDecision referenced by a ChangeSet", () => prisma.canonDecision.delete({ where: { id: g.decisions.D1.id } })],
      ["Release referenced by a migration plan", () => prisma.rulesetRelease.delete({ where: { id: g.releases.R1.id } })],
      ["MigrationPlan with items", () => prisma.migrationPlan.delete({ where: { id: g.plan.id } })],
    ];
    for (const [label, attempt] of attempts) await expect(attempt(), label).rejects.toThrow();
    const nonRestrict = await prisma.$queryRaw<Array<{ constraint_name: string; delete_rule: string }>>`
      SELECT constraint_name, delete_rule FROM information_schema.referential_constraints
      WHERE constraint_schema = 'public' AND delete_rule <> 'RESTRICT' AND constraint_name !~ '^(entity_aliases|entity_keywords|entity_version_keywords|entity_relationships|keyword_)'`;
    expect(nonRestrict.filter((r) => /ruleset|manifest|canon|conflict|change_set|migration|source_authority/.test(r.constraint_name))).toEqual([]);
  });

  it("§28 the DATABASE itself rejects every wrong-scope composite reference (direct inserts)", async () => {
    const S = await approvedRuleset("composite");
    const sp = await createCanonPolicy(S.id, { name: "S", authorities: [] });
    const D = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: k("entity_d") });
    const cases: Array<[string, () => Promise<unknown>, RegExp]> = [
      ["manifest entry ↔ wrong Version", () => prisma.rulesetManifestEntry.create({ data: { manifestId: g.manifests.M2.id, entityId: g.entities.C.id, entityVersionId: g.versions.B1.id } }), /ruleset_manifest_entries_\w*fkey/],
      ["candidate ↔ wrong Entity", () => prisma.ruleConflictCandidate.create({ data: { ruleConflictId: g.conflicts.C2.id, entityId: g.entities.B.id, entityVersionId: g.versions.A1.id } }), /rule_conflict_candidates_version_entity_fkey/],
      ["candidate SourceReference ↔ wrong Version", () => prisma.ruleConflictCandidate.create({ data: { ruleConflictId: g.conflicts.C1.id, entityId: g.entities.A.id, entityVersionId: g.versions.A3.id, sourceReferenceId: g.sources.refA1.id } }), /rule_conflict_candidates_source_reference_fkey/],
      ["decision ↔ another Ruleset's policy", () => prisma.canonDecision.create({ data: { rulesetId: g.ruleset.id, entityId: g.entities.A.id, ruleConflictId: g.conflicts.C1.id, canonPolicyId: sp.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", rationale: "x" } }), /canon_decisions_policy_fkey/],
      ["selection ↔ another conflict's candidate", () => prisma.canonDecisionSelection.create({ data: { canonDecisionId: g.decisions.D1.id, ruleConflictId: g.conflicts.C1.id, ruleConflictCandidateId: g.conflicts.C2.candidates[0]!.id } }), /canon_decision_selections_candidate_fkey/],
      ["ChangeSet operation Version ↔ wrong Entity", () => prisma.changeSetOperation.create({ data: { changeSetId: g.changeSets.CS1.id, rulesetId: g.ruleset.id, sequence: 99, operationType: "PIN_ENTITY_VERSION", targetEntityId: g.entities.A.id, toEntityVersionId: g.versions.B1.id } }), /change_set_operations_to_version_fkey/],
      ["release ↔ another Ruleset's manifest", () => prisma.rulesetRelease.create({ data: { rulesetId: S.id, releaseNumber: 99, versionLabel: "x", channel: "CORE_PLAYTEST", manifestId: g.releases.R1.manifestId, canonPolicyId: sp.id, manifestHash: "x" } }), /ruleset_releases_manifest_fkey/],
      ["migration item Version ↔ wrong Entity", () => prisma.migrationPlanItem.create({ data: { migrationPlanId: g.plan.id, entityId: D.id, sourceEntityVersionId: g.versions.A1.id, changeType: "REMOVED_ENTITY", compatibilityClassification: "REVIEW_REQUIRED" } }), /migration_plan_items_source_version_fkey/],
    ];
    for (const [label, attempt, constraint] of cases) await expect(attempt(), label).rejects.toThrow(constraint);
  });

  describe("WO12 fix F1 — mutable Versions may not cross the publication boundary", () => {
    async function frozen(entityId: string, name: string) {
      const v = await createEntityVersion(entityId, { displayName: name });
      await transitionEntityVersionStatus(v.id, "IN_REVIEW");
      return transitionEntityVersionStatus(v.id, "APPROVED");
    }

    it("content-level reproducibility: a published Version's content cannot be edited, and the Release still verifies (req. 10)", async () => {
      const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: k("entity_f1") });
      const a1 = await frozen(e.id, "Published content");
      const r = await approvedRuleset("f1content");
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: e.id, entityVersionId: a1.id }] });
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [] });
      const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: p.id, versionLabel: "1" });
      const published = await getEntityVersion(a1.id);
      const row = await prisma.entityVersion.findUniqueOrThrow({ where: { id: a1.id } });
      await expectCode(updateDraftEntityVersion(a1.id, { displayName: "EDITED AFTER PUBLICATION" }), ENTITY_VERSION_ERROR_CODES.IMMUTABLE);
      expect(await getEntityVersion(a1.id)).toEqual(published);
      expect(await prisma.entityVersion.findUniqueOrThrow({ where: { id: a1.id } })).toEqual(row);
      expect(await getRulesetRelease(r1.id)).toEqual(r1);
      expect((await verifyRulesetReleaseManifestHash(r1.id)).valid).toBe(true);
    });

    it("a DRAFT (or IN_REVIEW) Version in the FINAL composition is refused with MUTABLE_VERSION_PINNED and complete rollback (req. 11)", async () => {
      const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: k("entity_f1neg") });
      const a1 = await frozen(e.id, "frozen");
      const a2 = await createEntityVersion(e.id, { displayName: "still DRAFT" });
      const r = await approvedRuleset("f1negative");
      const draftManifest = await createRulesetManifest(r.id, { entries: [{ entityId: e.id, entityVersionId: a2.id }] }); // development manifests may pin DRAFT (req. 5)
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [] });
      const rows = async () => ({
        releases: await prisma.rulesetRelease.count({ where: { rulesetId: r.id } }),
        manifests: await prisma.rulesetManifest.count({ where: { rulesetId: r.id } }),
        entries: await prisma.rulesetManifestEntry.count({ where: { manifest: { rulesetId: r.id } } }),
        status: (await prisma.ruleset.findUniqueOrThrow({ where: { id: r.id } })).status,
        versions: await prisma.entityVersion.findMany({ where: { entityId: e.id }, orderBy: { id: "asc" } }),
      });
      const before = await rows();
      await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: draftManifest.id, canonPolicyId: p.id, versionLabel: "draft" }), RULESET_RELEASE_ERROR_CODES.MUTABLE_VERSION_PINNED);
      expect(await rows()).toEqual(before); // no Release, no Manifest, no entries, no Ruleset transition, no lifecycle side effect
      expect(before.status).toBe("APPROVED");
      // IN_REVIEW can return to DRAFT (M1 send-back), so it is mutable too — derived from the lifecycle graph.
      await transitionEntityVersionStatus(a2.id, "IN_REVIEW");
      await expectCode(publishRulesetRelease({ rulesetId: r.id, baseManifestId: draftManifest.id, canonPolicyId: p.id, versionLabel: "in review" }), RULESET_RELEASE_ERROR_CODES.MUTABLE_VERSION_PINNED);
      // The FINAL composition is what counts: a base pinning the mutable Version publishes once the ChangeSet replaces it.
      const cs = await createChangeSet(r.id, { name: "freeze", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: e.id, fromEntityVersionId: a2.id, toEntityVersionId: a1.id }] });
      await submitChangeSetForReview(cs.id);
      await approveChangeSet(cs.id);
      const rel = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: draftManifest.id, canonPolicyId: p.id, changeSetId: cs.id, versionLabel: "frozen" });
      expect(rel.composition!.map((x) => x.entityVersionId)).toEqual([a1.id]);
      expect((await getEntityVersion(a2.id)).status).toBe("IN_REVIEW"); // never promoted or modified by publication
    });
  });

  describe("WO12 fix F2 — referenced SourceReferences are refused with SOURCE_REFERENCE.IN_USE", () => {
    it("referenced removal -> IN_USE with evidence intact; unreferenced removal still succeeds", async () => {
      const before = await getRuleConflict(g.conflicts.C1.id);
      await expectCode(removeSourceReference(g.sources.refA1.id), SOURCE_REFERENCE_ERROR_CODES.IN_USE);
      expect(await prisma.sourceReference.count({ where: { id: g.sources.refA1.id } })).toBe(1);
      expect(await getRuleConflict(g.conflicts.C1.id)).toEqual(before);
      const doc = await createSourceDocument({ title: `${PREFIX} loose`, sourceType: "DOCUMENT" });
      const loose = await createSourceReference(g.versions.A3.id, { sourceDocumentId: doc.id });
      await expect(removeSourceReference(loose.id)).resolves.toBeUndefined();
      expect(await prisma.sourceReference.count({ where: { id: loose.id } })).toBe(0);
    });
  });
});
