/** RuleConflicts and CanonDecisions over HTTP (PAS-10 M2-WO9 §25–§31, §69, §70, §82). */
import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupM2Api, collectKeys, entityWithVersions, sourceFor } from "./m2-api-harness";
import { apiManifest, apiPolicy, apiRuleset } from "./m2-flow";
import * as R from "./m2-routes";

describe("M2 API — Conflicts & Decisions (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("records an OPEN conflict with exact candidates and evidence, never a winner; rejects `status`; filters (§26–§28, §69, §82)", async () => {
    const rulesetId = await apiRuleset("conflict", false);
    const { entity, versions } = await entityWithVersions("cA", "A1", "A2");
    const ref = await sourceFor(versions[0]!.id, "ev");
    const post = (extra: Record<string, unknown> = {}) =>
      call(R.Conflicts.POST, "POST", "", { rulesetId }, {
        entityId: entity.id, conflictType: "MECHANICAL_DIVERGENCE", severity: "HIGH", title: "AP cost",
        candidates: [{ entityVersionId: versions[0]!.id, sourceReferenceId: ref.id, label: "old" }, { entityVersionId: versions[1]!.id }], ...extra,
      });
    const created = await post();
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ rulesetId, entityId: entity.id, status: "OPEN", conflictType: "MECHANICAL_DIVERGENCE" });
    const got = await call(R.Conflict.GET, "GET", "", { conflictId: created.data.id });
    expect(got.data.candidates.map((c: { entityVersionId: string; sourceReferenceId: string | null }) => [c.entityVersionId, c.sourceReferenceId])).toEqual([
      [versions[0]!.id, ref.id],
      [versions[1]!.id, null],
    ]);
    // §82: no persistence-only integrity column (candidate.entity_id) and no winner anywhere.
    for (const c of got.data.candidates) expect(Object.keys(c).sort()).toEqual(["createdAt", "entityVersionId", "id", "label", "positionSummary", "ruleConflictId", "sourceReferenceId"]);
    expect(collectKeys(got.data).filter((k) => /winner|selected|resolved|preferred/i.test(k))).toEqual([]);
    expect((await post({ status: "RESOLVED" })).body.error?.field).toBe("status");
    expect((await post({ severity: "EXTREME" })).body.error?.field).toBe("severity");
    const listed = await call(R.Conflicts.GET, "GET", `/api/rulesets/${rulesetId}/rule-conflicts?status=OPEN&severity=HIGH&entityId=${entity.id}`, { rulesetId });
    expect(listed.data.map((c: { id: string }) => c.id)).toEqual([created.data.id]);
    expect((await call(R.Conflicts.GET, "GET", `/api/rulesets/${rulesetId}/rule-conflicts?status=open`, { rulesetId })).status).toBe(400);
  });

  it("SELECT_RULE through HTTP stores the exact policy/conflict/candidate, resolves the conflict, leaves the manifest alone (§29–§31, §70, §82)", async () => {
    const rulesetId = await apiRuleset("decision", false);
    const { entity, versions } = await entityWithVersions("dA", "A1", "A2");
    const m = await apiManifest(rulesetId, [{ entityId: entity.id, entityVersionId: versions[1]!.id }]);
    const policy = await apiPolicy(rulesetId);
    const conflict = (await call(R.Conflicts.POST, "POST", "", { rulesetId }, {
      entityId: entity.id, conflictType: "OTHER", severity: "LOW", title: "t", candidates: [{ entityVersionId: versions[0]!.id }, { entityVersionId: versions[1]!.id }],
    })).data;
    const c1 = conflict.candidates[0].id;
    const body = { canonPolicyId: policy.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [c1], rationale: "errata" };
    const created = await call(R.ConflictDecisions.POST, "POST", "", { conflictId: conflict.id }, body);
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ rulesetId, ruleConflictId: conflict.id, canonPolicyId: policy.id, decisionType: "SELECT_RULE", resultEntityVersionId: null });
    expect(Object.keys(created.data)).not.toContain("entityId"); // §82: CanonDecision.entity_id is integrity-only
    expect(Object.keys(created.data.selections[0]).sort()).toEqual(["canonDecisionId", "createdAt", "id", "ruleConflictCandidateId"]); // no ruleConflictId
    expect((await call(R.Decision.GET, "GET", "", { decisionId: created.data.id })).data).toEqual(created.data);
    expect((await call(R.Conflict.GET, "GET", "", { conflictId: conflict.id })).data.status).toBe("RESOLVED");
    expect((await call(R.Manifest.GET, "GET", "", { manifestId: m.id })).data.entries[0].entityVersionId).toBe(versions[1]!.id);
    const again = await call(R.ConflictDecisions.POST, "POST", "", { conflictId: conflict.id }, body);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("CANON_DECISION.CONFLICT_ALREADY_DECIDED");
    expect((await call(R.ConflictDecisions.GET, "GET", `/api/x`, { conflictId: conflict.id })).data.map((d: { id: string }) => d.id)).toEqual([created.data.id]);
    expect((await call(R.RulesetDecisions.GET, "GET", `/api/x?decisionType=SELECT_RULE&ruleConflictId=${conflict.id}`, { rulesetId })).data).toHaveLength(1);
    expect((await call(R.RulesetDecisions.GET, "GET", `/api/x?decisionType=PROMOTE`, { rulesetId })).status).toBe(400);
    expect((await call(R.ConflictDecisions.POST, "POST", "", { conflictId: conflict.id }, { ...body, selectedCandidateIds: "x" })).body.error?.field).toBe("selectedCandidateIds");
  });
});
