import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertPreserved, assertRowsPreserved, PRESERVED_KEYS, PRESERVED_TABLES } from "./installed-upgrade.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("the upgrade comparison allows added fields and columns but no lost or changed value", () => {
  const before = { a: 1, list: [{ id: "x", ap: 3 }], nested: { turn: 2 } };
  assertPreserved(before, { a: 1, list: [{ id: "x", ap: 3, added: true }], nested: { turn: 2, phase: "new" }, extra: 1 }, "s");
  assert.throws(() => assertPreserved(before, { ...before, a: 2 }, "s"), /s\.a changed/);
  assert.throws(() => assertPreserved(before, { a: 1, list: [], nested: { turn: 2 } }, "s"), /s\.list has 0 entries, expected 1/);
  assert.throws(() => assertPreserved(before, { a: 1, list: [{ id: "x", ap: 3 }] }, "s"), /s\.nested is missing/);

  const rows = (table, ...values) => ({ [table]: values.map((v) => JSON.stringify(v)) });
  const all = (extra) => Object.fromEntries(PRESERVED_TABLES.map((t) => [t, []]).concat(Object.entries(extra)));
  const event = { id: "e1", sequence: 1, operation_kind: "TIMING" };
  const resource = { character_id: "c1", resource_key: "AP", current: 3 };
  const before2 = all({ ...rows("character_play_events", event), ...rows("character_resource_states", resource) });
  assert.equal(assertRowsPreserved(before2, all({ ...rows("character_play_events", { ...event, added: 1 }, { id: "e2" }), ...rows("character_resource_states", resource) })).character_play_events, 1);
  assert.throws(() => assertRowsPreserved(before2, all(rows("character_resource_states", resource))), /character_play_events row e1 is missing/);
  assert.throws(() => assertRowsPreserved(before2, all({ ...rows("character_play_events", event), ...rows("character_resource_states", { ...resource, current: 2 }) })), /character_resource_states\(c1\|AP\)\.current changed/);
});

test("the preserved tables cover Releases, Characters, play state and encounters, each with its key", () => {
  for (const table of ["ruleset_releases", "ruleset_manifest_entries", "characters", "character_resource_states", "character_play_runtimes", "character_play_events", "encounters", "encounter_participants", "encounter_events"]) {
    assert(PRESERVED_KEYS[table]?.length > 0, table);
  }
});

test("the upgrade baseline is an identified earlier build, and CI runs the installed upgrade as its own required job", () => {
  const baseline = JSON.parse(read("scripts/distribution/upgrade-baseline.json"));
  assert.match(baseline.commit, /^[a-f0-9]{40}$/);
  assert.match(baseline.tree, /^[a-f0-9]{40}$/);
  assert.equal(baseline.artifact.name, "prowess-windows-x64-" + baseline.commit);
  assert(Number.isInteger(baseline.artifact.runId));
  const app = JSON.parse(read("apps/studio/package.json")).version;
  const newer = (a, b) => { const [x, y] = [a, b].map((v) => v.split(".").map(Number)); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  assert(newer(app, baseline.appVersion), `this build (${app}) is newer than the baseline (${baseline.appVersion}), so the launcher upgrades it`);

  const ci = read(".github/workflows/ci.yml");
  const job = ci.slice(ci.indexOf("\n  windows-upgrade:"), ci.indexOf("\n  # ---- Tier summaries"));
  assert.match(job, /needs: windows-package/);
  assert.match(job, /upgrade-baseline\.json/);
  assert.match(job, /run-id: \$\{\{ steps\.base\.outputs\.run \}\}/);
  assert.match(job, /if: steps\.download\.outcome != 'success'/, "an expired baseline artifact is rebuilt from its recorded source");
  assert.match(job, /verify-windows-upgrade\.ps1/);
  assert.match(job, /-ExpectedCommit \$env:GITHUB_SHA/);
  assert.match(ci, /needs: \[[^\]]*windows-installed, windows-upgrade\]/, "Tier 2 requires the installed upgrade");
  // The backup / restore proof stays a separate, separately named check.
  assert.match(ci, /windows-installed:\n\s+name: DIST-WO1 — verify installed Windows artifact/);
  assert.doesNotMatch(job, /verify-windows-installer\.ps1/);

  const build = read("scripts/distribution/build-windows-installer.ps1");
  for (const file of ["verify-windows-upgrade.ps1", "desktop\\installed-upgrade.mjs", "desktop\\installed-smoke.mjs"]) assert(build.includes(`'${file}'`), `the artifact carries ${file}`);
});
