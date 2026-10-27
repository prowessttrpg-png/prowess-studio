/**
 * Self-test of the shared control harness (M5-CLOSEOUT-03 C2): proves, in a throw-away git repository, that the
 * harness passes a correctly caught control and FAILS for every way a control run can go wrong — a mutation the guard
 * does not catch, a guard that fails for the wrong reason, a red baseline, a mutation that changes nothing, residue left
 * in the working tree, and a changed control inventory — and that a file already dirty before the run is left as found.
 *
 *   node scripts/lib/control-harness.selftest.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { keyedGuard, runControls, applyEdits } from "./control-harness.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "prowess-harness-"));
const git = (...args) => assert.equal(spawnSync("git", args, { cwd: dir, encoding: "utf8" }).status, 0, `git ${args.join(" ")}`);
const quiet = { log: console.log };
let passed = 0;
try {
  git("init", "-q");
  git("config", "user.email", "selftest@example.invalid");
  git("config", "user.name", "selftest");
  writeFileSync(path.join(dir, "rule.txt"), "limit = 30\n");
  writeFileSync(path.join(dir, "other.txt"), "stable\n");
  git("add", ".");
  git("commit", "-q", "-m", "fixture");

  // A guard: passes while rule.txt says 30; otherwise fails with an assertion-style message.
  const guardScript = `const t=require("fs").readFileSync(${JSON.stringify(path.join(dir, "rule.txt"))},"utf8"); if(!t.includes("limit = 30")){console.log("AssertionError: limit changed"); process.exit(1)} console.log("1 passed")`;
  const runs = { n: 0 };
  const guard = keyedGuard("selftest-guard", () => { runs.n += 1; return spawnSync(process.execPath, ["-e", guardScript], { encoding: "utf8" }); });
  const blind = keyedGuard("selftest-blind", () => spawnSync(process.execPath, ["-e", 'console.log("1 passed")'], { encoding: "utf8" }));
  const noisy = keyedGuard("selftest-noisy", () => spawnSync(process.execPath, ["-e", guardScript.replace("AssertionError: limit changed", "ENOENT: infrastructure")], { encoding: "utf8" }));
  const red = keyedGuard("selftest-red", () => spawnSync(process.execPath, ["-e", 'console.log("AssertionError"); process.exit(1)'], { encoding: "utf8" }));
  const mutate = applyEdits("raise the limit", [["limit = 30", "limit = 40"]]);
  const base = { root: dir, title: "SELFTEST", expect: /AssertionError/, caught: () => "", done: () => "" };
  console.log = () => {};

  // 1. Two caught controls sharing one guard: one baseline, two mutation runs, file restored, tree unchanged.
  const stats = runControls({ ...base, controls: [{ name: "a", file: "rule.txt", mutate, guard }, { name: "b", file: "rule.txt", mutate: applyEdits("drop", [["limit = 30", "limit = 0"]]), guard }] });
  assert.deepEqual({ b: stats.baselineRuns, m: stats.mutationRuns, r: stats.restoreRuns }, { b: 1, m: 2, r: 0 });
  assert.equal(readFileSync(path.join(dir, "rule.txt"), "utf8"), "limit = 30\n");
  passed += 1;

  const mustFail = (label, options, pattern) => {
    assert.throws(() => runControls({ ...base, ...options }), pattern, label);
    assert.equal(readFileSync(path.join(dir, "rule.txt"), "utf8"), "limit = 30\n", `${label}: file restored after the failure`);
    passed += 1;
  };
  mustFail("uncaught mutation", { controls: [{ name: "blind", file: "rule.txt", mutate, guard: blind }] }, /control was NOT caught: blind/);
  mustFail("failure for the wrong reason", { controls: [{ name: "noisy", file: "rule.txt", mutate, guard: noisy }] }, /infrastructure rather than behaviour: noisy/);
  mustFail("red baseline", { controls: [{ name: "red", file: "rule.txt", mutate, guard: red }] }, /baseline guard is not green for red/);
  mustFail("mutation that changes nothing", { controls: [{ name: "noop", file: "rule.txt", mutate: (t) => t, guard }] }, /mutation changed nothing/);
  const residue = keyedGuard("selftest-residue", () => { writeFileSync(path.join(dir, "residue.txt"), "left behind\n"); return spawnSync(process.execPath, ["-e", guardScript], { encoding: "utf8" }); });
  mustFail("residue left in the working tree", { controls: [{ name: "residue", file: "rule.txt", mutate, guard: residue }] }, /working tree differs/);
  rmSync(path.join(dir, "residue.txt"));
  writeFileSync(path.join(dir, "other.txt"), "drifted\n");
  const sneaky = { name: "sneaky", file: "other.txt", mutate: () => "mutated\n", guard };
  // other.txt is dirty before the run; a control that leaves it as it found it still passes (comparison is before/after) …
  runControls({ ...base, controls: [sneaky].map((c) => ({ ...c, guard: keyedGuard("other", () => spawnSync(process.execPath, ["-e", `const t=require("fs").readFileSync(${JSON.stringify(path.join(dir, "other.txt"))},"utf8"); if(t==="mutated\\n"){console.log("AssertionError");process.exit(1)} console.log("1 passed")`], { encoding: "utf8" })) })) });
  assert.equal(readFileSync(path.join(dir, "other.txt"), "utf8"), "drifted\n");
  passed += 1;
  git("checkout", "--", "other.txt");
  process.env.PROWESS_EXPECT_CONTROLS = "2";
  mustFail("changed control inventory", { controls: [{ name: "a", file: "rule.txt", mutate, guard }] }, /control inventory changed \(expected 2, found 1\)/);
  delete process.env.PROWESS_EXPECT_CONTROLS;
  assert.ok(runs.n > 0);
} finally {
  console.log = quiet.log;
  rmSync(dir, { recursive: true, force: true });
}
console.log(`Control harness self-test: ${passed} scenarios behaved as required (caught control passes; uncaught, misattributed, red-baseline, no-op, residue and inventory-change runs fail; files always restored).`);
