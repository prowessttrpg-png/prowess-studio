// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BROWSER_GATES, checkBrowserEvidence } from "../../../../scripts/ci/verify-browser-evidence.mjs";

/**
 * PAS-10 M6-WO12 — the browser evidence gate (invariant M6-I187). scripts/ci/verify-browser-evidence.mjs runs in the e2e
 * job after Playwright; these cases pin what it must refuse: an absent report or evidence file, a missing / skipped /
 * failing / flaky-only test, evidence from another commit, a single journey run, two runs in the same world, and a run
 * with a missing or failed step.
 */
const SHA = "a".repeat(40);
const spec = (file: string, titles: string[], status = "expected", results = ["passed"]) => ({ title: file, file, specs: titles.map((title) => ({ title, file, tests: [{ status, results: results.map((s) => ({ status: s })) }] })), suites: [] });
const failureTitles = ["F1 a newer Release exists", "F2 draft", "F3 wrong timing", "F4 a lost commit response", "F5 two tabs"];
const report = (over: { journey?: object; failures?: object } = {}) => ({
  suites: [over.journey ?? spec("m6-playtest.spec.ts", ["run 1", "run 2"]), over.failures ?? spec("m6-playtest-failures.spec.ts", failureTitles)],
});
const steps = BROWSER_GATES["M6-WO12"]!.steps;
const run = (n: number, world: string, rows = steps.map((id) => ({ id, status: "passed" }))) => ({ run: n, world, rows });
const evidence = (over: Record<string, unknown> = {}) => ({ gate: "M6-WO12", sha: SHA, runs: [run(1, "e2ea1"), run(2, "e2eb2")], ...over });
const check = (r: unknown, e: unknown, sha = SHA) => checkBrowserEvidence("M6-WO12", { report: r, evidence: e, sha });

describe("M6-WO12 browser evidence gate", () => {
  it("W12-EVIDENCE passes only complete, passing, same-commit evidence of two runs in two worlds", () => {
    expect(check(report(), evidence())).toEqual([]);
  });

  it("W12-EVIDENCE refuses an absent report or an absent evidence file", () => {
    expect(check(null, evidence()).join("\n")).toMatch(/Playwright JSON report is absent/);
    expect(check(report(), null).join("\n")).toMatch(/evidence file is absent/);
  });

  it("W12-EVIDENCE refuses a missing spec, too few tests, a skipped test and a failing test", () => {
    expect(check({ suites: [spec("m6-playtest.spec.ts", ["run 1", "run 2"])] }, evidence()).join("\n")).toMatch(/m6-playtest-failures\.spec\.ts is absent/);
    expect(check(report({ journey: spec("m6-playtest.spec.ts", ["run 1"]) }), evidence()).join("\n")).toMatch(/reported 1 test\(s\), expected at least 2/);
    expect(check(report({ journey: spec("m6-playtest.spec.ts", ["run 1", "run 2"], "skipped", []) }), evidence()).join("\n")).toMatch(/"run 1" was skipped/);
    expect(check(report({ failures: spec("m6-playtest-failures.spec.ts", failureTitles, "unexpected", ["failed", "failed"]) }), evidence()).join("\n")).toMatch(/did not pass/);
    expect(check(report({ failures: spec("m6-playtest-failures.spec.ts", failureTitles, "flaky", ["failed", "passed"]) }), evidence()).join("\n")).toMatch(/did not pass \(flaky/);
  });

  it("W12-EVIDENCE refuses evidence produced for another commit or another gate", () => {
    expect(check(report(), evidence({ sha: "b".repeat(40) })).join("\n")).toMatch(/produced for commit b{40}, not a{40}/);
    expect(check(report(), evidence({ gate: "M6-WO11" })).join("\n")).toMatch(/belongs to M6-WO11/);
  });

  it("W12-EVIDENCE refuses one journey run, two runs in the same world and a run with a missing or failed step", () => {
    expect(check(report(), evidence({ runs: [run(1, "e2ea1")] })).join("\n")).toMatch(/1 complete journey run\(s\) recorded, expected 2/);
    expect(check(report(), evidence({ runs: [run(1, "same"), run(2, "same")] })).join("\n")).toMatch(/did not use different prepared worlds/);
    expect(check(report(), evidence({ runs: [run(1, "e2ea1"), run(2, "e2eb2", steps.slice(0, 11).map((id) => ({ id, status: "passed" })))] })).join("\n")).toMatch(/run 2 recorded steps/);
    expect(check(report(), evidence({ runs: [run(1, "e2ea1", steps.map((id) => ({ id, status: id === "V10" ? "failed" : "passed" }))), run(2, "e2eb2")] })).join("\n")).toMatch(/run 1 step V10 is failed/);
  });
});
