import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectBackup, loadBackup } from "./desktop/backup.mjs";

/**
 * RULES-WO1 — a workspace backup made by an IDENTIFIED PREVIOUS BUILD is restored and read by this candidate.
 *
 *   previous build (a separate checkout given by PROWESS_PREVIOUS_BUILD_DIR, e.g. main 23f3c03, app 0.1.2):
 *     fresh DB migrated with ITS migrations → ITS own M7-WO1 restore seed (two completed Characters, one with combat
 *     running in its Play Workspace; a prepared and an archived encounter; every Character-owned row recorded) → ITS
 *     Character sheets snapshot → ITS desktop backup code writes the backup (tagged with ITS app version).
 *   candidate (this checkout):
 *     a fresh DB migrated with THIS build's migrations → THIS build's backup check accepts the file and loads it →
 *     THIS build's code re-reads the encounters, memberships, Release references and every Character-owned row
 *     (identical to what the previous build recorded) and computes the same sheets (identical); nothing is written.
 *
 * Only disposable `*_test` databases on a loopback host are created and dropped here.
 */
const root = path.resolve(import.meta.dirname, "../..");
const previous = path.resolve(process.env.PROWESS_PREVIOUS_BUILD_DIR ?? "");
assert(process.env.PROWESS_PREVIOUS_BUILD_DIR, "Set PROWESS_PREVIOUS_BUILD_DIR to a checkout of the previous build (with its dependencies installed)");
const requireDb = createRequire(path.join(root, "packages/prowess-db/package.json"));
const { Client } = requireDb("pg");
const expected = new URL(process.env.DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(expected.hostname) && /^\/[a-z][a-z0-9_]*_test$/.test(expected.pathname), "Requires a disposable local test database connection");
const output = path.resolve(process.env.PROWESS_RW1_EVIDENCE_DIR ?? path.join(root, "test-results", "rules-wo1-previous-build"));
const run = "rw1p" + randomBytes(4).toString("hex");
const runtime = ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/playtest/register.mjs"];
const admin = new URL(expected);
admin.pathname = "/postgres";
const client = new Client(admin.toString());
const databases = [];
const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const version = async (dir) => JSON.parse(await readFile(path.join(dir, "apps/studio/package.json"), "utf8")).version;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** `prisma migrate deploy` of one checkout's migrations onto one database. */
function deploy(dir, url, name) {
  const cli = path.join(dir, "packages/prowess-db/node_modules/prisma/build/index.js");
  const result = spawnSync(process.execPath, [cli, "migrate", "deploy"], { cwd: path.join(dir, "packages/prowess-db"), env: { ...process.env, DATABASE_URL: url }, stdio: "inherit", timeout: 180_000 });
  assert.equal(result.status, 0, `Migrations failed for ${name}`);
}

function script(dir, file, args, url) {
  const result = spawnSync(process.execPath, [...runtime, file, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 8_000_000, timeout: 600_000 });
  process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) throw result.error ?? new Error(`${file} ${args[0] ?? ""} failed in ${dir}`);
  return (result.stdout ?? "").split("\n").filter((l) => /^\{"stage":/.test(l)).map((l) => JSON.parse(l));
}

async function withDb(url, fn) {
  const c = new Client(url);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const schemaOf = (c) =>
  Promise.all([
    c.query("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name").then((r) => r.rows.map((x) => x.migration_name)),
    c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename").then((r) => r.rows.map((x) => x.tablename).sort()),
  ]);
/** Every table's rows, order-independent, as one digest per table (database content, read by SQL alone). */
const contentOf = async (c, tables) => {
  const out = {};
  for (const t of tables) out[t] = sha256((await c.query(`SELECT row_to_json(x)::text AS r FROM public."${t}" x`)).rows.map((x) => x.r).sort().join("\n"));
  return out;
};

const identity = {
  previous: { commit: git(previous, "rev-parse", "HEAD"), tree: git(previous, "rev-parse", "HEAD^{tree}"), appVersion: await version(previous) },
  candidate: { commit: git(root, "rev-parse", "HEAD"), tree: git(root, "rev-parse", "HEAD^{tree}"), appVersion: await version(root), clean: git(root, "status", "--porcelain", "--untracked-files=no") === "" },
};
assert.notEqual(identity.previous.commit, identity.candidate.commit, "The previous build must be a different commit");
await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await client.connect();
const start = Date.now();
try {
  const urls = {};
  for (const role of ["previous", "candidate"]) {
    const name = `prowess_${run}_${role}_test`;
    await client.query(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const url = new URL(expected);
    url.pathname = "/" + name;
    urls[role] = url.toString();
  }
  // 1. The previous build makes and records its own workspace.
  deploy(previous, urls.previous, "the previous build");
  script(previous, "scripts/playtest/m7-wo1-encounter-restore.ts", ["source", run, output], urls.previous);
  await copyFile(path.join(root, "scripts/playtest/rules-wo1-sheet-snapshot.ts"), path.join(previous, "scripts/playtest/rules-wo1-sheet-snapshot.ts"));
  script(previous, "scripts/playtest/rules-wo1-sheet-snapshot.ts", [path.join(output, "sheets-previous.json")], urls.previous);
  await rm(path.join(previous, "scripts/playtest/rules-wo1-sheet-snapshot.ts"), { force: true });

  // 2. The previous build's OWN backup code writes the backup.
  const { makeBackup: makePreviousBackup } = await import(pathToFileURL(path.join(previous, "scripts/distribution/desktop/backup.mjs")).href);
  const [prevMigrations, prevTables] = await withDb(urls.previous, schemaOf);
  const bytes = await withDb(urls.previous, (c) => makePreviousBackup(c, { appVersion: identity.previous.appVersion, migrations: prevMigrations, tables: prevTables, setup: null }));
  await writeFile(path.join(output, "previous-build.backup.json"), bytes);
  const before = await withDb(urls.previous, (c) => contentOf(c, prevTables));

  // 3. This candidate accepts and restores it into its own freshly migrated workspace.
  deploy(root, urls.candidate, "the candidate");
  const [candMigrations, candTables] = await withDb(urls.candidate, schemaOf);
  const { entries } = inspectBackup(bytes, { appVersion: identity.candidate.appVersion, migrations: candMigrations, tables: candTables });
  await withDb(urls.candidate, (c) => loadBackup(c, entries, candTables));
  const restored = await withDb(urls.candidate, (c) => contentOf(c, candTables));
  assert.deepEqual(restored, before, "every table's content is identical after the candidate restores the previous build's backup");

  // 4. This candidate's code reads it: identical encounters and Character rows, identical sheets; nothing is written.
  script(root, "scripts/playtest/m7-wo1-encounter-restore.ts", ["resume", run, output], urls.candidate);
  script(root, "scripts/playtest/rules-wo1-sheet-snapshot.ts", [path.join(output, "sheets-candidate.json")], urls.candidate);
  const prevSheets = JSON.parse(await readFile(path.join(output, "sheets-previous.json"), "utf8"));
  const candSheets = JSON.parse(await readFile(path.join(output, "sheets-candidate.json"), "utf8"));
  assert.ok(prevSheets.characters >= 2, "the previous build's workspace has Characters");
  assert.deepEqual(candSheets, prevSheets, "the candidate computes the same Character sheets as the previous build");
  assert.deepEqual(await withDb(urls.candidate, (c) => contentOf(c, candTables)), before, "reading the restored workspace writes nothing");

  const evidence = {
    gate: "RULES-WO1",
    proof: "previous-build backup restored by the candidate",
    identity,
    backup: { file: "previous-build.backup.json", bytes: bytes.length, sha256: sha256(bytes), writtenBy: `previous build ${identity.previous.commit} (app ${identity.previous.appVersion})` },
    migrations: { previous: prevMigrations.length, candidate: candMigrations.length, identical: JSON.stringify(prevMigrations) === JSON.stringify(candMigrations) },
    tables: candTables.length,
    characters: prevSheets.characters,
    elapsedMilliseconds: Date.now() - start,
  };
  await writeFile(path.join(output, "rules-wo1-previous-build-restore-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ stage: "done", ...evidence }));
} finally {
  try {
    for (const name of databases.reverse()) await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
