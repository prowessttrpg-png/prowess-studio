/**
 * Moves the vitest JSON report of each named suite out of the working tree into $PROWESS_REPORTS_DIR (default
 * <tmpdir>/prowess-reports) with its provenance (M5-CLOSEOUT-03 C1).
 *
 *   node scripts/ci/collect-reports.mjs <suite…>        (PROWESS_SHARD=<n> for a sharded suite)
 *
 * The suite must have been run with `--reporter=json --outputFile.json=<the suite's report path in gates.json>`. The
 * report is refused if it is missing, unsuccessful or empty, so a suite job cannot hand a gate a partial result. The
 * meta file records the suite and the exact commit, which scripts/ci/verify-gate.mjs checks.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadInventory } from "./gate-inventory.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inventory = loadInventory(root);
const out = process.env.PROWESS_REPORTS_DIR ?? path.join(tmpdir(), "prowess-reports");
mkdirSync(out, { recursive: true });
const sha = process.env.GITHUB_SHA ?? spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
for (const id of process.argv.slice(2)) {
  const suite = inventory.suites[id];
  assert.ok(suite, `unknown suite ${id}`);
  const source = path.join(root, suite.report);
  assert.ok(existsSync(source), `${id}: no report at ${suite.report}`);
  const report = JSON.parse(readFileSync(source, "utf8"));
  assert.equal(report.success, true, `${id}: the suite did not succeed`);
  assert.ok(report.numTotalTests > 0 && report.testResults.length > 0, `${id}: the report is empty`);
  const shards = suite.shards ?? 1;
  const shard = shards > 1 ? Number(process.env.PROWESS_SHARD) : null;
  if (shards > 1) assert.ok(Number.isInteger(shard) && shard >= 1 && shard <= shards, `${id}: PROWESS_SHARD must be 1..${shards}`);
  const name = shard === null ? id : `${id}-shard-${shard}`;
  // Moved OUT of the working tree: a report must never be read by a later static audit or seen by a control's
  // whole-tree check.
  try { renameSync(source, path.join(out, `${name}.json`)); } catch { copyFileSync(source, path.join(out, `${name}.json`)); rmSync(source); }
  writeFileSync(path.join(out, `${name}.meta.json`), `${JSON.stringify({ suite: id, shard, sha })}\n`);
  console.log(`${name}: ${report.numPassedTests}/${report.numTotalTests} tests in ${report.testResults.length} files → ${path.join(out, `${name}.json`)}`);
}
