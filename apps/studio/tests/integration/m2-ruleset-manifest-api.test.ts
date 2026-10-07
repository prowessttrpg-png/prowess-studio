/** Rulesets, review commands and Manifests over HTTP (PAS-10 M2-WO9 §8–§18, §66, §67, §72). */
import { assertRunningAgainstTestDatabase, createEntityVersion } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_M2_TABLES, call, cleanupM2Api, entityWithVersions, fingerprint, key } from "./m2-api-harness";
import { apiManifest, apiRuleset } from "./m2-flow";
import * as R from "./m2-routes";

describe("M2 API — Rulesets & Manifests (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("creates a DRAFT Ruleset (201), gets it, lists it with filters and pagination; rejects a `status` field (§9–§11)", async () => {
    const canonicalKey = key("create");
    const created = await call(R.Rulesets.POST, "POST", "/api/rulesets", {}, { canonicalKey, name: "N", channel: "DEVELOPMENT", versionLabel: "0.1" });
    expect(created.status).toBe(201);
    expect(created.contentType).toMatch(/application\/json/);
    expect(created.data).toMatchObject({ canonicalKey, status: "DRAFT", channel: "DEVELOPMENT", versionLabel: "0.1", parentRulesetId: null });
    expect(created.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const id = created.data.id;
    expect((await call(R.Ruleset.GET, "GET", `/api/rulesets/${id}`, { rulesetId: id })).data).toEqual(created.data);
    const listed = await call(R.Rulesets.GET, "GET", "/api/rulesets?status=DRAFT&channel=DEVELOPMENT&pageSize=100", {});
    expect(listed.status).toBe(200);
    expect(listed.body.pagination).toMatchObject({ page: 1, pageSize: 100 });
    expect((listed.data as Array<{ id: string }>).some((r) => r.id === id)).toBe(true);
    const forbidden = await call(R.Rulesets.POST, "POST", "/api/rulesets", {}, { canonicalKey: key("st"), name: "N", channel: "DEVELOPMENT", status: "PUBLISHED" });
    expect(forbidden.status).toBe(400);
    expect(forbidden.body.error).toMatchObject({ code: "API.INVALID_BODY", field: "status" });
  });

  it("runs DRAFT -> IN_REVIEW -> APPROVED via named commands; shortcuts are 409; no generic status route (§12, §72)", async () => {
    const id = await apiRuleset("lifecycle", false);
    const approveEarly = await call(R.RulesetApprove.POST, "POST", "", { rulesetId: id });
    expect(approveEarly.status).toBe(409);
    expect(approveEarly.body.error?.code).toBe("RULESET.INVALID_STATUS_TRANSITION");
    expect((await call(R.RulesetSubmit.POST, "POST", "", { rulesetId: id })).data.status).toBe("IN_REVIEW");
    expect((await call(R.RulesetApprove.POST, "POST", "", { rulesetId: id }, {})).data.status).toBe("APPROVED");
    expect((await call(R.RulesetSubmit.POST, "POST", "", { rulesetId: id }, { status: "DRAFT" })).status).toBe(400); // commands take no input
    expect(Object.keys(R.Ruleset)).toEqual(["GET"]);
  });

  it("an exact manifest stays exact after newer Versions exist; effective = explicit here (§15, §17, §66)", async () => {
    const rulesetId = await apiRuleset("exact", false);
    const { entity, versions } = await entityWithVersions("exactA", "A1");
    const m1 = await apiManifest(rulesetId, [{ entityId: entity.id, entityVersionId: versions[0]!.id }]);
    expect(m1).toMatchObject({ rulesetId, manifestVersion: 1, parentManifestId: null });
    await createEntityVersion(entity.id, { displayName: "A2" });
    const got = await call(R.Manifest.GET, "GET", "", { manifestId: m1.id });
    expect(got.data.entries.map((e: { entityVersionId: string }) => e.entityVersionId)).toEqual([versions[0]!.id]);
    const eff = await call(R.ManifestEffective.GET, "GET", "", { manifestId: m1.id });
    expect(eff.data).toEqual([expect.objectContaining({ entityId: entity.id, entityVersionId: versions[0]!.id, resolvedFromManifestId: m1.id, resolutionDepth: 0, source: "EXPLICIT" })]);
    const latest = await call(R.ManifestLatest.GET, "GET", "", { rulesetId });
    expect(latest.data.id).toBe(m1.id);
    expect((await call(R.Manifests.GET, "GET", `/api/rulesets/${rulesetId}/manifests`, { rulesetId })).data.map((m: { id: string }) => m.id)).toEqual([m1.id]);
  });

  it("child effective = explicit override + inherited entry with provenance; resolve returns null (200) for an unpinned Entity (§17, §18, §67)", async () => {
    const parentId = await apiRuleset("parent", false);
    const childId = await apiRuleset("child", false, { parentRulesetId: parentId });
    const a = await entityWithVersions("inhA", "A1", "A2");
    const b = await entityWithVersions("inhB", "B1");
    const loose = await entityWithVersions("inhLoose", "X1");
    const p = await apiManifest(parentId, [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }, { entityId: b.entity.id, entityVersionId: b.versions[0]!.id }]);
    const c = await apiManifest(childId, [{ entityId: a.entity.id, entityVersionId: a.versions[1]!.id }], p.id);
    const before = await fingerprint(ALL_M2_TABLES);
    const eff = await call(R.ManifestEffective.GET, "GET", "", { manifestId: c.id });
    const byEntity = Object.fromEntries((eff.data as Array<{ entityId: string }>).map((x) => [x.entityId, x]));
    expect(byEntity[a.entity.id]).toMatchObject({ entityVersionId: a.versions[1]!.id, resolvedFromManifestId: c.id, resolutionDepth: 0, source: "EXPLICIT" });
    expect(byEntity[b.entity.id]).toMatchObject({ entityVersionId: b.versions[0]!.id, resolvedFromManifestId: p.id, resolutionDepth: 1, source: "INHERITED" });
    expect((await call(R.Manifest.GET, "GET", "", { manifestId: c.id })).data.entries).toHaveLength(1); // exact != effective
    expect((await call(R.ManifestResolve.GET, "GET", "", { manifestId: c.id, entityId: b.entity.id })).data.resolution).toMatchObject({ source: "INHERITED" });
    const none = await call(R.ManifestResolve.GET, "GET", "", { manifestId: c.id, entityId: loose.entity.id });
    expect(none).toMatchObject({ status: 200, data: { resolution: null } });
    expect(await fingerprint(ALL_M2_TABLES)).toEqual(before); // reads write nothing
  });

  it("manifest input is shape-checked and manifestVersion is never accepted (§14, §80)", async () => {
    const rulesetId = await apiRuleset("mshape", false);
    const { entity, versions } = await entityWithVersions("mshapeA", "A1");
    const post = (body: unknown) => call(R.Manifests.POST, "POST", "", { rulesetId }, body);
    expect((await post({ entries: [{ entityId: entity.id, entityVersionId: versions[0]!.id }], manifestVersion: 7 })).body.error?.field).toBe("manifestVersion");
    expect((await post({ entries: "nope" })).status).toBe(400);
    expect((await post({ entries: [{ entityId: "not-a-uuid", entityVersionId: versions[0]!.id }] })).body.error?.field).toBe("entityId");
    expect((await post({ entries: [{ entityId: entity.id, entityVersionId: versions[0]!.id, extra: 1 }] })).body.error?.field).toBe("extra");
    expect((await call(R.ManifestLatest.GET, "GET", "", { rulesetId })).data).toBeNull();
  });
});
