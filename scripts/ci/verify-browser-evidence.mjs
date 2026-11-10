/**
 * PAS-10 M6-WO12 — browser evidence gate (run in the e2e job right after Playwright, against the ONE production build).
 *
 *   node scripts/ci/verify-browser-evidence.mjs M6-WO12
 *
 * Fails unless THIS commit's Playwright run proves the playtest vertical slice:
 *   1. the Playwright JSON report (apps/studio/playwright-report/results.json) exists and every test of each required
 *      spec file is present, ran and PASSED — a missing file, a skipped / fixme test, a failure or an interrupted run
 *      all fail the gate;
 *   2. the journey's evidence file (apps/studio/test-results/m6-wo12-evidence.json) exists, names this gate and the
 *      EXACT commit under test (GITHUB_SHA in CI, `git rev-parse HEAD` locally), and holds two complete runs in two
 *      different prepared worlds, each with every step V01–V12 in order and passed.
 * Paths can be overridden (for the gate's own tests) with PROWESS_PLAYWRIGHT_REPORT and PROWESS_WO12_EVIDENCE.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BROWSER_GATES = {
  "M6-WO12": {
    specs: ["tests/e2e/m6-playtest.spec.ts", "tests/e2e/m6-playtest-failures.spec.ts"],
    minimumTests: { "tests/e2e/m6-playtest.spec.ts": 2, "tests/e2e/m6-playtest-failures.spec.ts": 5 },
    steps: ["V01", "V02", "V03", "V04", "V05", "V06", "V07", "V08", "V09", "V10", "V11", "V12"],
    runs: 2,
  },
};

function specsOf(report) {
  const out = new Map();
  const walk = (suite, file) => {
    const f = suite.file ?? file;
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) {
      const key = (spec.file ?? f ?? "").split(path.sep).join("/");
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ title: spec.title, status: t.status, results: (t.results ?? []).map((r) => r.status) });
    }
    for (const s of suite.suites ?? []) walk(s, f);
  };
  for (const s of report.suites ?? []) walk(s, s.file);
  return out;
}

/** Returns a list of problems (empty = the gate passes). Pure: the inputs are parsed JSON plus the expected commit. */
export function checkBrowserEvidence(gateId, { report, evidence, sha }) {
  const gate = BROWSER_GATES[gateId];
  if (gate === undefined) return [`unknown browser gate ${gateId}`];
  const problems = [];
  if (report === null) problems.push(`${gateId}: the Playwright JSON report is absent (the browser tests did not run or did not report)`);
  else {
    const specs = specsOf(report);
    for (const file of gate.specs) {
      const key = [...specs.keys()].find((k) => k === file || k.endsWith(`/${file}`) || file.endsWith(`/${k}`) || k === file.replace(/^tests\/e2e\//, ""));
      const tests = key === undefined ? [] : specs.get(key);
      if (tests.length === 0) {
        problems.push(`${gateId}: ${file} is absent from the Playwright report`);
        continue;
      }
      if (tests.length < gate.minimumTests[file]) problems.push(`${gateId}: ${file} reported ${tests.length} test(s), expected at least ${gate.minimumTests[file]}`);
      for (const t of tests) {
        if (t.status === "skipped" || t.results.length === 0 || t.results.every((r) => r === "skipped")) problems.push(`${gateId}: "${t.title}" was skipped`);
        else if (t.status !== "expected" || t.results.at(-1) !== "passed") problems.push(`${gateId}: "${t.title}" did not pass (${t.status}; ${t.results.join(", ")})`);
      }
    }
  }
  if (evidence === null) problems.push(`${gateId}: the journey evidence file is absent`);
  else {
    if (evidence.gate !== gateId) problems.push(`${gateId}: the evidence file belongs to ${String(evidence.gate)}`);
    if (evidence.sha !== sha) problems.push(`${gateId}: the evidence was produced for commit ${String(evidence.sha)}, not ${sha}`);
    const runs = Array.isArray(evidence.runs) ? evidence.runs : [];
    if (runs.length !== gate.runs) problems.push(`${gateId}: ${runs.length} complete journey run(s) recorded, expected ${gate.runs}`);
    if (new Set(runs.map((r) => r.world)).size !== runs.length) problems.push(`${gateId}: the journey runs did not use different prepared worlds`);
    for (const r of runs) {
      const ids = (r.rows ?? []).map((x) => x.id);
      if (JSON.stringify(ids) !== JSON.stringify(gate.steps)) problems.push(`${gateId}: run ${String(r.run)} recorded steps ${ids.join(",") || "none"}, expected ${gate.steps.join(",")}`);
      for (const x of r.rows ?? []) if (x.status !== "passed") problems.push(`${gateId}: run ${String(r.run)} step ${String(x.id)} is ${String(x.status)}`);
    }
  }
  return problems;
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
function expectedSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateId = process.argv[2];
  const report = readJson(process.env.PROWESS_PLAYWRIGHT_REPORT ?? path.join(root, "apps/studio/playwright-report/results.json"));
  const evidence = readJson(process.env.PROWESS_WO12_EVIDENCE ?? path.join(root, "apps/studio/test-results/m6-wo12-evidence.json"));
  const problems = checkBrowserEvidence(gateId, { report, evidence, sha: expectedSha() });
  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`${gateId} browser evidence verified for ${evidence.sha}: ${BROWSER_GATES[gateId].specs.join(" + ")} passed; ${evidence.runs.length} journey runs × ${BROWSER_GATES[gateId].steps.length} steps.`);
}
