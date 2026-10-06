/** M2 API error handling (PAS-10 M2-WO9 §6, §7, §79–§81). */
import { assertRunningAgainstTestDatabase } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, cleanupM2Api } from "./m2-api-harness";
import { apiRuleset } from "./m2-flow";
import * as R from "./m2-routes";

const MISSING = "00000000-0000-4000-8000-000000000000";
const LEAK = /prisma|P20\d\d|select |insert |\/home\/|\/usr\/|postgres(ql)?:\/\/|at \w+ \(|\.ts:\d+/i;

describe("M2 API — errors (prowess_studio_test only)", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(process.env.DATABASE_URL!));
  afterAll(cleanupM2Api);

  it("unknown ADDRESSED resources are 404 with the controlled code; nothing leaks (§79)", async () => {
    const cases: Array<[unknown, Record<string, string>, string]> = [
      [R.Ruleset.GET, { rulesetId: MISSING }, "RULESET.NOT_FOUND"],
      [R.Manifest.GET, { manifestId: MISSING }, "RULESET_MANIFEST.NOT_FOUND"],
      [R.Policy.GET, { policyId: MISSING }, "CANON_POLICY.NOT_FOUND"],
      [R.Conflict.GET, { conflictId: MISSING }, "RULE_CONFLICT.NOT_FOUND"],
      [R.Decision.GET, { decisionId: MISSING }, "CANON_DECISION.NOT_FOUND"],
      [R.ChangeSet.GET, { changeSetId: MISSING }, "CHANGE_SET.NOT_FOUND"],
      [R.Release.GET, { releaseId: MISSING }, "RULESET_RELEASE.NOT_FOUND"],
      [R.ReleaseLatest.GET, { rulesetId: MISSING }, "RULESET_RELEASE.RULESET_NOT_FOUND"],
    ];
    for (const [handler, params, code] of cases) {
      const r = await call(handler, "GET", "/api/x", params);
      expect(r.status, code).toBe(404);
      expect(r.body.error?.code, code).toBe(code);
      expect(JSON.stringify(r.body), code).not.toMatch(LEAK);
    }
  });

  it("unknown REFERENCED resources in a body are 400 with the controlled code (§79)", async () => {
    const rulesetId = await apiRuleset("refs");
    const r = await call(R.Releases.POST, "POST", "", { rulesetId }, { baseManifestId: MISSING, canonPolicyId: MISSING, versionLabel: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("RULESET_RELEASE.MANIFEST_NOT_FOUND");
  });

  it("malformed JSON, bad UUID params, wrong types, missing fields and bad pagination are controlled 400s (§6, §46, §80)", async () => {
    const rulesetId = await apiRuleset("shape", false);
    const malformed = await call(R.Conflicts.POST, "POST", "", { rulesetId }, "{ not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error?.code).toBe("API.INVALID_BODY");
    expect(JSON.stringify(malformed.body)).not.toMatch(/SyntaxError|Unexpected token|at /);
    expect((await call(R.Conflicts.POST, "POST", "", { rulesetId }, "[1,2]")).status).toBe(400);
    expect((await call(R.Ruleset.GET, "GET", "/api/x", { rulesetId: "not-a-uuid" })).body.error).toMatchObject({ code: "API.INVALID_UUID", field: "rulesetId" });
    expect((await call(R.Conflicts.POST, "POST", "", { rulesetId }, { conflictType: "OTHER" })).body.error?.field).toBe("entityId");
    expect((await call(R.Conflicts.POST, "POST", "", { rulesetId }, { entityId: MISSING, conflictType: "OTHER", severity: "LOW", title: 7, candidates: [] })).body.error?.field).toBe("title");
    expect((await call(R.Rulesets.GET, "GET", "/api/rulesets?page=0", {})).body.error).toMatchObject({ code: "API.INVALID_QUERY", field: "page" });
    expect((await call(R.Rulesets.GET, "GET", "/api/rulesets?status=LIVE", {})).body.error).toMatchObject({ code: "API.INVALID_QUERY", field: "status" });
  });

  it("an unexpected server error fails closed as a generic 500 with no internal detail (§7, §81)", async () => {
    vi.resetModules();
    vi.doMock("@prowess/db", async (original) => ({
      ...(await original<typeof import("@prowess/db")>()),
      getRuleset: async () => {
        throw new Error("boom at /home/claude/db.ts:12 postgresql://user:pw@host/db P2002 SELECT * FROM rulesets");
      },
    }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { GET } = await import("../../app/api/rulesets/[rulesetId]/route");
    const r = await call(GET, "GET", "/api/x", { rulesetId: MISSING });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/boom|claude|postgresql|P2002|SELECT/);
    expect(r.body.error).toBeDefined();
    spy.mockRestore();
    vi.doUnmock("@prowess/db");
  });
});
