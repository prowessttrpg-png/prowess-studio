/**
 * Verifies one permanent gate from the AUTHORITATIVE suite results of this exact CI run (M5-CLOSEOUT-03 C1).
 *
 *   node scripts/ci/verify-gate.mjs <GATE-ID> <test files…>
 *
 * The test files named on the command line must be exactly the gate's files in scripts/ci/gates.json (so the workflow,
 * the inventory and the check cannot drift apart). Each file must appear in the vitest JSON report of the suite that
 * owns it (collected by scripts/ci/collect-reports.mjs from the suite jobs of this same commit) with status `passed`,
 * at least one assertion and no failed assertion. `allOf` suites must have run completely: success, no failed test, and
 * every test file of the package present in the report. Reports from another commit are refused.
 *
 * This replaces re-running the same files a second time inside the gate step; the gate's own mutation / negative
 * controls still run in the same step after this check.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suiteOfFile, loadInventory, suiteTestFiles } from "./gate-inventory.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportsDir = path.join(root, process.env.PROWESS_REPORTS_DIR ?? "reports");
const [gateId, ...files] = process.argv.slice(2);
const inventory = loadInventory(root);
const gate = inventory.gates.find((g) => g.id === gateId);
assert.ok(gate, `unknown gate ${gateId}`);
assert.deepEqual([...files].sort(), [...gate.tests].sort(), `${gateId}: the workflow's file list differs from scripts/ci/gates.json`);

function loadSuite(suite) {
  assert.ok(existsSync(reportsDir), `${gateId}: reports directory ${reportsDir} is missing (suite jobs did not deliver their results)`);
  const names = readdirSync(reportsDir).filter((f) => f === `${suite}.json` || new RegExp(`^${suite}-shard-\\d+\\.json$`).test(f));
  assert.ok(names.length > 0, `${gateId}: no authoritative report for suite ${suite}`);
  const expectedShards = inventory.suites[suite].shards ?? 1;
  assert.equal(names.length, expectedShards, `${gateId}: suite ${suite} has ${names.length} report(s), expected ${expectedShards}`);
  const results = [];
  for (const name of names) {
    const meta = JSON.parse(readFileSync(path.join(reportsDir, name.replace(/\.json$/, ".meta.json")), "utf8"));
    if (process.env.GITHUB_SHA) assert.equal(meta.sha, process.env.GITHUB_SHA, `${gateId}: report ${name} was produced for another commit`);
    assert.equal(meta.suite, suite, `${gateId}: report ${name} belongs to suite ${meta.suite}`);
    results.push(JSON.parse(readFileSync(path.join(reportsDir, name), "utf8")));
  }
  return results;
}

const bySuite = new Map();
const suiteResults = (suite) => {
  if (!bySuite.has(suite)) bySuite.set(suite, loadSuite(suite));
  return bySuite.get(suite);
};
const relative = (abs) => path.relative(root, abs).split(path.sep).join("/");
const filesIn = (results, pkg) => results.flatMap((r) => r.testResults.map((t) => ({ ...t, rel: relative(t.name.startsWith("/") ? t.name : path.join(root, pkg, t.name)) })));

let assertions = 0;
for (const file of gate.tests) {
  const suite = suiteOfFile(inventory, file);
  const entries = filesIn(suiteResults(suite), inventory.suites[suite].package).filter((t) => t.rel.endsWith(file));
  assert.equal(entries.length, 1, `${gateId}: ${file} must appear exactly once in the ${suite} report (found ${entries.length})`);
  const [entry] = entries;
  assert.equal(entry.status, "passed", `${gateId}: ${file} did not pass in the authoritative ${suite} run`);
  const failed = entry.assertionResults.filter((a) => a.status === "failed");
  const passed = entry.assertionResults.filter((a) => a.status === "passed");
  assert.equal(failed.length, 0, `${gateId}: ${file} has failed assertions`);
  assert.ok(passed.length > 0, `${gateId}: ${file} ran no passing assertion`);
  assertions += passed.length;
}
for (const suite of gate.allOf) {
  const results = suiteResults(suite);
  for (const r of results) {
    assert.equal(r.success, true, `${gateId}: suite ${suite} did not succeed`);
    assert.equal(r.numFailedTests, 0, `${gateId}: suite ${suite} has failed tests`);
  }
  const reported = new Set(filesIn(results, inventory.suites[suite].package).map((t) => t.rel));
  const onDisk = suiteTestFiles(root, inventory.suites[suite]);
  for (const f of onDisk) assert.ok(reported.has(f), `${gateId}: ${f} (suite ${suite}) is missing from the authoritative report — the complete suite did not run`);
  assertions += results.reduce((n, r) => n + r.numPassedTests, 0);
}
console.log(`${gateId} — ${gate.name}: ${gate.tests.length} test file(s)${gate.allOf.length ? ` + complete suite(s) ${gate.allOf.join(", ")}` : ""} verified passed in this commit's authoritative run (${assertions} passing assertions).`);
