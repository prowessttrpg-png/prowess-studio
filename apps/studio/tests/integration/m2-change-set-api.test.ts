/** ChangeSets, explicit proposal, live impact and review commands over HTTP (PAS-10 M2-WO9 §32–§36, §71, §72, §82). */
import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_M2_TABLES, call, cleanupM2Api, entityWithVersions, fingerprint } from "./m2-api-harness";
import { apiManifest, apiPolicy, apiRuleset } from "./m2-flow";
import * as R from "./m2-routes";

describe("M2 API — ChangeSets (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("creates a DRAFT snapshot without integrity columns; impact is LIVE and GET impact writes nothing (§33, §35, §71, §82)", async () => {
    const rulesetId = await apiRuleset("cs", false);
    const { entity, versions } = await entityWithVersions("csA", "A1", "A2");
    const m = await apiManifest(rulesetId, [{ entityId: entity.id, entityVersionId: versions[0]!.id }]);
    const op = { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: entity.id, fromEntityVersionId: versions[0]!.id, toEntityVersionId: versions[1]!.id, targetManifestId: m.id };
    const created = await call(R.ChangeSets.POST, "POST", "", { rulesetId }, { name: "swap", operations: [op] });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ rulesetId, status: "DRAFT", canonDecisionId: null });
    expect(Object.keys(created.data.operations[0])).not.toContain("rulesetId"); // §82: operation.ruleset_id is integrity-only
    expect((await call(R.ChangeSet.GET, "GET", "", { changeSetId: created.data.id })).data).toEqual(created.data);
    const before = await fingerprint(ALL_M2_TABLES);
    const impact = await call(R.Impact.GET, "GET", "", { changeSetId: created.data.id });
    expect(impact.status).toBe(200);
    expect(impact.data).toMatchObject({ changeSetId: created.data.id, rulesetId, derivation: "LIVE" });
    expect(impact.data.items.some((i: { category: string; resourceId: string }) => i.category === "DIRECT_ENTITY" && i.resourceId === entity.id)).toBe(true);
    expect(await fingerprint(ALL_M2_TABLES)).toEqual(before);
    expect((await call(R.ChangeSets.POST, "POST", "", { rulesetId }, { name: "x", status: "APPROVED", operations: [op] })).body.error?.field).toBe("status");
    expect((await call(R.ChangeSets.POST, "POST", "", { rulesetId }, { name: "x", operations: [{ ...op, operationType: "APPLY" }] })).body.error?.field).toBe("operationType");
    expect((await call(R.ChangeSets.GET, "GET", `/api/x?status=DRAFT`, { rulesetId })).data.map((c: { id: string }) => c.id)).toEqual([created.data.id]);
  });

  it("review commands: DRAFT -> READY_FOR_REVIEW -> APPROVED; shortcuts and reject-after-approve are 409 (§36, §72)", async () => {
    const rulesetId = await apiRuleset("csreview", false);
    const id = (await call(R.ChangeSets.POST, "POST", "", { rulesetId }, { name: "n", operations: [{ operationType: "NO_CHANGE" }] })).data.id;
    const approveEarly = await call(R.CsApprove.POST, "POST", "", { changeSetId: id });
    expect(approveEarly).toMatchObject({ status: 409 });
    expect(approveEarly.body.error?.code).toBe("CHANGE_SET.INVALID_STATUS_TRANSITION");
    expect((await call(R.CsSubmit.POST, "POST", "", { changeSetId: id })).data.status).toBe("READY_FOR_REVIEW");
    expect((await call(R.CsApprove.POST, "POST", "", { changeSetId: id })).data.status).toBe("APPROVED");
    expect((await call(R.CsReject.POST, "POST", "", { changeSetId: id })).status).toBe(409);
  });

  it("propose-change-set explicitly persists a DRAFT proposal; reading the decision creates nothing (§34)", async () => {
    const rulesetId = await apiRuleset("propose", false);
    const { entity, versions } = await entityWithVersions("pA", "A1", "A2");
    const m = await apiManifest(rulesetId, [{ entityId: entity.id, entityVersionId: versions[0]!.id }]);
    const policy = await apiPolicy(rulesetId);
    const conflict = (await call(R.Conflicts.POST, "POST", "", { rulesetId }, { entityId: entity.id, conflictType: "OTHER", severity: "LOW", title: "t", candidates: [{ entityVersionId: versions[0]!.id }, { entityVersionId: versions[1]!.id }] })).data;
    const decision = (await call(R.ConflictDecisions.POST, "POST", "", { conflictId: conflict.id }, { canonPolicyId: policy.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [conflict.candidates[1].id], rationale: "r" })).data;
    await call(R.Decision.GET, "GET", "", { decisionId: decision.id });
    expect((await call(R.ChangeSets.GET, "GET", "/api/x", { rulesetId })).data).toEqual([]);
    const proposed = await call(R.Propose.POST, "POST", "", { decisionId: decision.id }, { name: "apply", targetManifestId: m.id });
    expect(proposed.status).toBe(201);
    expect(proposed.data).toMatchObject({ canonDecisionId: decision.id, status: "DRAFT" });
    expect(proposed.data.operations[0]).toMatchObject({ operationType: "REPLACE_ENTITY_VERSION", fromEntityVersionId: versions[0]!.id, toEntityVersionId: versions[1]!.id });
  });
});
