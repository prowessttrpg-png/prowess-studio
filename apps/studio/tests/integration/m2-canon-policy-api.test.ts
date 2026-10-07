/** Canon policies and source authority over HTTP (PAS-10 M2-WO9 §19–§24, §68). */
import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_M2_TABLES, call, cleanupM2Api, entityWithVersions, fingerprint, sourceFor } from "./m2-api-harness";
import { apiPolicy, apiRuleset } from "./m2-flow";
import * as R from "./m2-routes";

describe("M2 API — Canon Policies (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("creates an exact snapshot, lists it, latest = highest policyVersion, records are exact; exact / global fallback / UNRESOLVED all resolve with 200", async () => {
    const rulesetId = await apiRuleset("policy", false);
    const { versions } = await entityWithVersions("polA", "A1");
    const [s1, s2, s3] = [await sourceFor(versions[0]!.id, "one"), await sourceFor(versions[0]!.id, "two"), await sourceFor(versions[0]!.id, "three")];
    const policy = await apiPolicy(rulesetId, [
      { sourceDocumentId: s1.sourceDocumentId, scopeKey: "spell.affinity", authorityStatus: "GOVERNING", rationale: "core" },
      { sourceDocumentId: s2.sourceDocumentId, scopeKey: "global", authorityStatus: "REFERENCE_ONLY" },
    ]);
    expect(policy).toMatchObject({ rulesetId, policyVersion: 1 });
    expect((await call(R.Policy.GET, "GET", "", { policyId: policy.id })).data).toEqual(policy);
    const records = await call(R.PolicyAuthorities.GET, "GET", `/api/canon-policies/${policy.id}/source-authorities`, { policyId: policy.id });
    expect(records.data).toEqual(policy.authorities);
    expect(records.body.pagination).toMatchObject({ total: 2 });
    const second = await apiPolicy(rulesetId, []);
    expect((await call(R.PolicyLatest.GET, "GET", "", { rulesetId })).data.id).toBe(second.id);
    expect((await call(R.Policies.GET, "GET", `/api/rulesets/${rulesetId}/canon-policies`, { rulesetId })).data.map((p: { policyVersion: number }) => p.policyVersion)).toEqual([1, 2]);

    const before = await fingerprint(ALL_M2_TABLES);
    const resolve = (sourceDocumentId: string, scopeKey: string) =>
      call(R.PolicyResolve.GET, "GET", `/api/canon-policies/${policy.id}/source-authority/resolve?sourceDocumentId=${sourceDocumentId}&scopeKey=${scopeKey}`, { policyId: policy.id });
    expect((await resolve(s1.sourceDocumentId, "spell.affinity")).data).toMatchObject({ policyId: policy.id, requestedScopeKey: "spell.affinity", resolvedScopeKey: "spell.affinity", authorityStatus: "GOVERNING", source: "EXACT" });
    expect((await resolve(s2.sourceDocumentId, "spell.affinity")).data).toMatchObject({ resolvedScopeKey: "global", authorityStatus: "REFERENCE_ONLY", source: "GLOBAL_FALLBACK" });
    const unresolved = await resolve(s3.sourceDocumentId, "spell.affinity");
    expect(unresolved.status).toBe(200);
    expect(unresolved.data).toMatchObject({ resolvedScopeKey: null, source: "UNRESOLVED" });
    expect(await fingerprint(ALL_M2_TABLES)).toEqual(before);
  });

  it("rejects policyVersion, a bad authority status, a malformed source id, and a missing/unknown resolve query (§20, §46)", async () => {
    const rulesetId = await apiRuleset("policyshape", false);
    const post = (body: unknown) => call(R.Policies.POST, "POST", "", { rulesetId }, body);
    expect((await post({ name: "x", authorities: [], policyVersion: 3 })).body.error?.field).toBe("policyVersion");
    expect((await post({ name: "x", authorities: [{ sourceDocumentId: "00000000-0000-4000-8000-000000000000", scopeKey: "global", authorityStatus: "WINNER" }] })).body.error?.field).toBe("authorityStatus");
    expect((await post({ name: "x", authorities: [{ sourceDocumentId: "x", scopeKey: "global", authorityStatus: "GOVERNING" }] })).body.error?.field).toBe("sourceDocumentId");
    const p = await apiPolicy(rulesetId);
    const r = await call(R.PolicyResolve.GET, "GET", `/api/canon-policies/${p.id}/source-authority/resolve?scopeKey=global`, { policyId: p.id });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "API.INVALID_QUERY", field: "sourceDocumentId" });
    expect((await call(R.PolicyResolve.GET, "GET", `/api/canon-policies/${p.id}/source-authority/resolve?scopeKey=global&sourceDocumentId=${p.id}&winner=1`, { policyId: p.id })).body.error?.field).toBe("winner");
    expect((await call(R.PolicyLatest.GET, "GET", "", { rulesetId: (await apiRuleset("nopolicy", false)) })).data).toBeNull();
  });
});
