import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { inspectBackup, loadBackup, makeBackup } from "./desktop/backup.mjs";

/**
 * RULES-WO1 Phase D — every new rule kind across machines, restart, restore and an app upgrade, on DISPOSABLE local
 * databases only.
 *
 *   source DB  → R1 + governed R2 (twelve new rule kinds, one ChangeSet) → R1.prowesspack, R2.prowesspack
 *   receiver DB (independent, fresh) → installs both packs → Characters on both Releases, an encounter and saved play
 *                state → recorded state
 *   restart    → a new process re-reads the receiver: identical
 *   restore    → the receiver's workspace backup is restored into a third fresh DB → identical. The backup is written by
 *                THIS build's backup code carrying an older version TAG (0.1.2), so this only proves that the version
 *                check accepts an older tag. It is NOT a backup from a previous build: that proof is
 *                verify-rules-wo1-previous-build-restore.mjs (a backup made by an identified earlier commit's own code).
 *
 * Every database is created and dropped here; names must end in `_test` on a loopback host.
 */
const root = path.resolve(import.meta.dirname, "../..");
const requireDb = createRequire(path.join(root, "packages/prowess-db/package.json"));
const { Client } = requireDb("pg");
const expected = new URL(process.env.DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(expected.hostname) && /^\/[a-z][a-z0-9_]*_test$/.test(expected.pathname), "Transfer proof requires a disposable local test database connection");
const evidence = process.env.PROWESS_RW1_EVIDENCE_DIR;
const output = evidence ? path.resolve(evidence) : await mkdtemp(path.join(os.tmpdir(), "prowess-rw1-"));
const run = "rw1" + randomBytes(5).toString("hex");
const admin = new URL(expected);
admin.pathname = "/postgres";
const client = new Client(admin.toString());
const runtime = ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/playtest/register.mjs"];
const prismaCli = path.join(root, "packages/prowess-db/node_modules/prisma/build/index.js");
const records = [];
const databases = [];
const urls = {};

function stage(roleName, url) {
  const result = spawnSync(process.execPath, [...runtime, "scripts/playtest/rules-wo1-transfer.ts", roleName, run, output], {
    cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 4_000_000, timeout: 600_000,
  });
  process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) throw result.error ?? new Error(`RULES-WO1 ${roleName} stage failed`);
  for (const line of (result.stdout ?? "").split("\n")) if (/^\{"stage":/.test(line)) records.push(JSON.parse(line));
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

const start = Date.now();
await mkdir(output, { recursive: true });
await client.connect();
try {
  for (const role of ["source", "receiver", "restored"]) {
    const name = `prowess_${run}_${role}_test`;
    await client.query(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const url = new URL(expected);
    url.pathname = "/" + name;
    urls[role] = url.toString();
    const deploy = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: path.join(root, "packages/prowess-db"), env: { ...process.env, DATABASE_URL: urls[role] }, stdio: "inherit", timeout: 180_000 });
    assert.equal(deploy.status, 0, `Migrations failed for ${role}`);
  }
  stage("source", urls.source);
  stage("receiver", urls.receiver);
  stage("resume", urls.receiver); // restart: a new process, same database

  // Restore: the desktop workspace backup of the receiver, loaded into an independent fresh database.
  const spec = await withDb(urls.receiver, async (c) => ({
    appVersion: "0.1.2",
    migrations: (await c.query("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name")).rows.map((r) => r.migration_name),
    tables: (await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows.map((r) => r.tablename).sort(),
  }));
  const bytes = await withDb(urls.receiver, (c) => makeBackup(c, { ...spec, setup: null }));
  // Version-tag compatibility only (this build's code writes the backup; the tag says 0.1.2). See the header.
  const studioVersion = JSON.parse(await readFile(path.join(root, "apps/studio/package.json"), "utf8")).version;
  assert.equal(studioVersion, "0.1.3");
  const { entries } = inspectBackup(bytes, { ...spec, appVersion: studioVersion });
  await withDb(urls.restored, (c) => loadBackup(c, entries, spec.tables));
  records.push({ stage: "backup-version-tag", writtenBy: "this build (tag 0.1.2)", bytes: bytes.length, tables: spec.tables.length });
  stage("resume", urls.restored);

  assert(records.some((r) => r.stage === "receiver" && r.r2Kinds === 14), "Missing receiver proof");
  assert.equal(records.filter((r) => r.stage === "resume" && r.unchanged).length, 2, "Missing restart and restore proofs");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  await writeFile(path.join(output, "rules-wo1-transfer-evidence.json"), JSON.stringify({ gate: "RULES-WO1", commit, elapsedMilliseconds: Date.now() - start, databases, records }, null, 2) + "\n");
  console.log(JSON.stringify({ stage: "done", elapsedMilliseconds: Date.now() - start }));
} finally {
  try {
    for (const name of databases.reverse()) await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
    if (!evidence) await rm(output, { force: true, recursive: true });
  }
}
