/**
 * Shared harness for the permanent negative / mutation controls (M5-CLOSEOUT-03 C2).
 *
 * Every control still mutates REAL source on disk, runs the permanent guard that must catch it, requires the guard to
 * FAIL for a behavioural reason (the control's own pattern), restores the file in a `finally` and verifies it
 * byte-for-byte. What changed is only how often an identical guard is re-run on an identical tree:
 *
 *   before   per control: green baseline → mutation run → restored re-run of the guard
 *   after    per DISTINCT guard command: one green baseline on the pristine tree (its first use);
 *            per control: the mutation run, then the byte-for-byte restore check;
 *            once per run: a whole-tree check — `git status` and the bytes of every modified / untracked file are
 *            identical before and after (no residue, no unexpected file).
 *
 * Why this is equivalent: a guard is identified by its exact command (working directory, vitest arguments including any
 * `-t` filter, environment flag). Each control's file is restored and verified byte-for-byte before the next control, so
 * every use of a guard sees the same bytes its green baseline saw; a re-run of that guard on those bytes can only repeat
 * the baseline result. The byte-level restore proof plus the per-guard baseline therefore replace the per-control
 * restored re-run. A guard whose identity is unknown (no `key`) is never shared: it keeps the original per-control
 * pattern (its own baseline before, and a green re-run after, that control).
 *
 * Failure to restore is itself a failing run (byte check per control, tree check at the end).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** A vitest guard identified by its exact command. */
export function vitestGuard(root, pkgDir, args, { timeout = 600_000, ciEnv = true } = {}) {
  const run = () =>
    spawnSync(process.execPath, [path.join(root, pkgDir, "node_modules/vitest/vitest.mjs"), "run", ...args], {
      cwd: path.join(root, pkgDir),
      encoding: "utf8",
      timeout,
      env: ciEnv ? { ...process.env, CI: "1" } : process.env,
    });
  run.key = JSON.stringify(["vitest", pkgDir, args, ciEnv]);
  return run;
}

/** Any other guard command with an explicit identity (same key ⇒ same command). */
export function keyedGuard(key, run) {
  run.key = JSON.stringify(["command", key]);
  return run;
}

/** Applies `[from, to]` edits (from === null appends); each anchor must occur exactly once. */
export function applyEdits(name, edits) {
  return (text) => {
    let out = text;
    for (const [from, to] of edits) {
      if (from === null) out = `${out}${to}`;
      else {
        assert.equal(out.split(from).length, 2, `mutation anchor must occur exactly once (${name}): ${from}`);
        out = out.replace(from, to);
      }
    }
    return out;
  };
}

function treeState(root) {
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const files = git(["ls-files", "-m", "-o", "--exclude-standard"]).split("\n").filter(Boolean).sort();
  const hashes = files.map((f) => `${f} ${existsSync(path.join(root, f)) ? createHash("sha256").update(readFileSync(path.join(root, f))).digest("hex") : "deleted"}`);
  return `${status}\n--\n${hashes.join("\n")}`;
}

/**
 * Runs every control. `controls`: `{ name, file, mutate(text) → text, guard, expect?: RegExp }` (file relative to root).
 * Returns the guard-run statistics (also printed) so callers / CI logs can report them.
 */
export function runControls({
  root,
  title,
  controls,
  expect: defaultExpect = /AssertionError|expected/,
  emptyBaseline = /no tests|No test files found|\b0 passed/i,
  caught = (name) => `Negative control caught: ${name}`,
  done = (count) => `All ${count} ${title} controls caught and reverted.`,
  after = null,
}) {
  assert.ok(controls.length > 0, `${title}: no controls defined`);
  const expected = process.env.PROWESS_EXPECT_CONTROLS;
  if (expected !== undefined) assert.equal(controls.length, Number(expected), `${title}: control inventory changed (expected ${expected}, found ${controls.length})`);
  const abs = (file) => path.join(root, file);
  const before = treeState(root);
  const originals = new Map();
  const green = new Set(); // guard keys with a green baseline on the pristine tree
  const stats = { controls: controls.length, baselineRuns: 0, mutationRuns: 0, restoreRuns: 0 };
  const requireGreen = (guard, label, phase) => {
    const result = guard();
    assert.equal(result.status, 0, `${phase} guard is not green for ${label}:\n${result.stdout}${result.stderr}`);
    if (emptyBaseline) assert.doesNotMatch(result.stdout, emptyBaseline, `${phase} guard selected no tests for ${label}`);
  };
  try {
    for (const control of controls) {
      const { name, file, mutate, guard } = control;
      assert.equal(typeof guard, "function", `${name}: guard missing`);
      if (!originals.has(file)) originals.set(file, readFileSync(abs(file), "utf8"));
      const original = originals.get(file);
      assert.equal(readFileSync(abs(file), "utf8"), original, `${name}: ${file} is not pristine before the control`);
      const key = guard.key ?? null;
      if (key === null || !green.has(key)) {
        requireGreen(guard, name, "baseline");
        stats.baselineRuns += 1;
        if (key !== null) green.add(key);
      }
      const mutated = mutate(original);
      assert.notEqual(mutated, original, `${name}: mutation changed nothing`);
      writeFileSync(abs(file), mutated);
      try {
        const result = guard();
        stats.mutationRuns += 1;
        assert.notEqual(result.status, 0, `control was NOT caught: ${name}`);
        assert.match(`${result.stdout}${result.stderr}`, control.expect ?? defaultExpect, `control failed for infrastructure rather than behaviour: ${name}\n${result.stdout}${result.stderr}`);
      } finally {
        writeFileSync(abs(file), original);
      }
      assert.equal(readFileSync(abs(file), "utf8"), original, `file not restored byte-for-byte: ${file}`);
      if (key === null) {
        requireGreen(guard, name, "post-restore");
        stats.restoreRuns += 1;
      }
      console.log(caught(name));
    }
    if (after) after();
  } finally {
    for (const [file, text] of originals) writeFileSync(abs(file), text);
  }
  for (const [file, text] of originals) assert.equal(readFileSync(abs(file), "utf8"), text, `${file} was not restored byte-for-byte`);
  assert.equal(treeState(root), before, `${title}: the working tree differs from its state before the controls (residue or unexpected file)`);
  console.log(`${title} guard runs: ${stats.baselineRuns} baseline + ${stats.mutationRuns} mutation + ${stats.restoreRuns} post-restore; every file restored byte-for-byte and the working tree unchanged.`);
  console.log(done(controls.length));
  return stats;
}
