/** Publication and releases over HTTP, including the full governance flow (PAS-10 M2-WO9 §37–§44, §65, §73–§78). */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupM2Api, entityWithVersions, key } from "./m2-api-harness";
import { apiApprovedChangeSet, apiManifest, apiPolicy, apiRuleset } from "./m2-flow";
import * as R from "./m2-routes";

const rows = async (rulesetId: string) => ({
  releases: await prisma.rulesetRelease.count({ where: { rulesetId } }),
  manifests: await prisma.rulesetManifest.count({ where: { rulesetId } }),
});

describe("M2 API — Releases (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("the full governance flow, every step through HTTP (§65)", async () => {
    // 1–3 Ruleset, review, approve
    const created = await call(R.Rulesets.POST, "POST", "/api/rulesets", {}, { canonicalKey: key("flow"), name: "Flow", channel: "CORE_PLAYTEST" });
    const rulesetId = created.data.id;
    expect((await call(R.RulesetSubmit.POST, "POST", "", { rulesetId })).data.status).toBe("IN_REVIEW");
    expect((await call(R.RulesetApprove.POST, "POST", "", { rulesetId })).data.status).toBe("APPROVED");
    // 4 Entities + Versions through existing services
    const a = await entityWithVersions("flowA", "A1", "A2");
    const b = await entityWithVersions("flowB", "B1");
    // 5–8 manifest, policy, conflict, decision
    const m = await apiManifest(rulesetId, [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }, { entityId: b.entity.id, entityVersionId: b.versions[0]!.id }]);
    const policy = await apiPolicy(rulesetId);
    const conflict = (await call(R.Conflicts.POST, "POST", "", { rulesetId }, { entityId: a.entity.id, conflictType: "MECHANICAL_DIVERGENCE", severity: "HIGH", title: "AP", candidates: [{ entityVersionId: a.versions[0]!.id }, { entityVersionId: a.versions[1]!.id }] })).data;
    const decision = (await call(R.ConflictDecisions.POST, "POST", "", { conflictId: conflict.id }, { canonPolicyId: policy.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [conflict.candidates[1].id], rationale: "playtest" })).data;
    // 9–11 propose, review, approve
    const cs = (await call(R.Propose.POST, "POST", "", { decisionId: decision.id }, { name: "apply", targetManifestId: m.id })).data;
    await call(R.CsSubmit.POST, "POST", "", { changeSetId: cs.id });
    expect((await call(R.CsApprove.POST, "POST", "", { changeSetId: cs.id })).data.status).toBe("APPROVED");
    expect((await call(R.ReleaseLatest.GET, "GET", "", { rulesetId })).data).toBeNull(); // approving published nothing
    // 12 publish
    const published = await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: m.id, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "Core Playtest 1", releaseNotes: "first" });
    expect(published.status).toBe(201);
    const rel = published.data;
    expect(rel).toMatchObject({ rulesetId, releaseNumber: 1, versionLabel: "Core Playtest 1", channel: "CORE_PLAYTEST", canonPolicyId: policy.id, changeSetId: cs.id });
    expect(rel.manifestId).not.toBe(m.id);
    expect(Object.fromEntries(rel.composition.map((p: { entityId: string; entityVersionId: string }) => [p.entityId, p.entityVersionId]))).toEqual({ [a.entity.id]: a.versions[1]!.id, [b.entity.id]: b.versions[0]!.id });
    // 13–15 get, verify, latest
    expect((await call(R.Release.GET, "GET", "", { releaseId: rel.id })).data).toEqual(rel);
    expect((await call(R.ReleaseVerify.GET, "GET", "", { releaseId: rel.id })).data).toEqual({ releaseId: rel.id, valid: true, storedHash: rel.manifestHash, computedHash: rel.manifestHash });
    expect((await call(R.ReleaseLatest.GET, "GET", "", { rulesetId })).data.id).toBe(rel.id);
    // exact references and side effects (§73)
    expect((await call(R.Ruleset.GET, "GET", "", { rulesetId })).data.status).toBe("PUBLISHED");
    expect((await call(R.Manifest.GET, "GET", "", { manifestId: m.id })).data.entries.find((e: { entityId: string }) => e.entityId === a.entity.id).entityVersionId).toBe(a.versions[0]!.id);
    expect((await call(R.Manifest.GET, "GET", "", { manifestId: rel.manifestId })).data.parentManifestId).toBeNull();
    // §77: single use
    const reuse = await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: rel.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "2" });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error?.code).toBe("RULESET_RELEASE.CHANGE_SET_ALREADY_PUBLISHED");
    // §76: duplicate label
    const dup = await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: rel.manifestId, canonPolicyId: policy.id, versionLabel: "Core Playtest 1" });
    expect(dup).toMatchObject({ status: 409 });
    expect(dup.body.error?.code).toBe("RULESET_RELEASE.VERSION_LABEL_CONFLICT");
    // §44 diff + listing
    const rel2 = (await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: rel.manifestId, canonPolicyId: policy.id, versionLabel: "2" })).data;
    expect((await call(R.ReleaseCompare.GET, "GET", "", { releaseId: rel.id, otherReleaseId: rel2.id })).data).toEqual({ releaseAId: rel.id, releaseBId: rel2.id, entries: [], unchangedCount: 2 });
    expect((await call(R.Releases.GET, "GET", "/api/x", { rulesetId })).data.map((r: { releaseNumber: number }) => r.releaseNumber)).toEqual([1, 2]);
  });

  it("stale REPLACE -> 409 STALE_CHANGE_SET with no orphan rows; CREATE -> 409 UNRESOLVED_CREATE_OPERATION (§74, §75)", async () => {
    const rulesetId = await apiRuleset("stale");
    const a = await entityWithVersions("staleA", "A1", "A2", "A3");
    const m = await apiManifest(rulesetId, [{ entityId: a.entity.id, entityVersionId: a.versions[2]!.id }]);
    const policy = await apiPolicy(rulesetId);
    const stale = await apiApprovedChangeSet(rulesetId, [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.entity.id, fromEntityVersionId: a.versions[0]!.id, toEntityVersionId: a.versions[1]!.id }]);
    const before = await rows(rulesetId);
    const r1 = await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: m.id, canonPolicyId: policy.id, changeSetId: stale, versionLabel: "x" });
    expect(r1.status).toBe(409);
    expect(r1.body.error?.code).toBe("RULESET_RELEASE.STALE_CHANGE_SET");
    const create = await apiApprovedChangeSet(rulesetId, [{ operationType: "CREATE_ENTITY_VERSION", targetEntityId: a.entity.id }]);
    const r2 = await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: m.id, canonPolicyId: policy.id, changeSetId: create, versionLabel: "x" });
    expect(r2.status).toBe(409);
    expect(r2.body.error?.code).toBe("RULESET_RELEASE.UNRESOLVED_CREATE_OPERATION");
    expect(await rows(rulesetId)).toEqual(before);
    expect((await call(R.Ruleset.GET, "GET", "", { rulesetId })).data.status).toBe("APPROVED");
  });

  it("verify returns 200 with valid=false for a tampered release manifest (test-only corruption), then true once restored (§43, §78)", async () => {
    const rulesetId = await apiRuleset("tamper");
    const a = await entityWithVersions("tamperA", "A1", "A2");
    const m = await apiManifest(rulesetId, [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }]);
    const rel = (await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: m.id, canonPolicyId: (await apiPolicy(rulesetId)).id, versionLabel: "t" })).data;
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: rel.manifestId } });
    try {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${a.versions[1]!.id}::uuid WHERE id = ${entry.id}::uuid`;
      const v = await call(R.ReleaseVerify.GET, "GET", "", { releaseId: rel.id });
      expect(v.status).toBe(200);
      expect(v.data).toMatchObject({ valid: false, storedHash: rel.manifestHash });
    } finally {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
    }
    expect((await call(R.ReleaseVerify.GET, "GET", "", { releaseId: rel.id })).data.valid).toBe(true);
  });

  it("publication input never accepts generated fields (§38)", async () => {
    const rulesetId = await apiRuleset("gen");
    for (const field of ["releaseNumber", "manifestHash", "channel", "publishedAt", "resultManifestId"]) {
      const r = await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: rulesetId, canonPolicyId: rulesetId, versionLabel: "x", [field]: 1 });
      expect(r.body.error, field).toMatchObject({ code: "API.INVALID_BODY", field });
    }
  });
});
