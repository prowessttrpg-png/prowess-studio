import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { inspectBackup, loadBackup, makeBackup } from "./desktop/backup.mjs";

/**
 * M7-WO1 E11–E12 — encounters survive a restart and a whole-workspace restore, on DISPOSABLE local databases only.
 *
 *   source DB   → the WO12 test Release, two completed Characters (one in standalone combat), a prepared encounter
 *                 (two sides, both Characters) and an archived encounter → recorded encounter views and Character rows
 *   restart     → a new process re-reads the source DB: identical
 *   restored DB → the source's workspace backup (the desktop backup format, every public table) loaded into an
 *                 independent fresh DB → identical encounters, memberships, Release references and Character state;
 *                 the archived freeze and the append-only history still hold
 *
 * Every database is created and dropped here; names must end in `_test` on a loopback host.
 */
const root = path.resolve(import.meta.dirname, "../..");
const requireDb = createRequire(path.join(root, "packages/prowess-db/package.json"));
const { Client } = requireDb("pg");
const expected = new URL(process.env.DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(expected.hostname) && /^\/[a-z][a-z0-9_]*_test$/.test(expected.pathname), "Encounter restore proof requires a disposable local test database connection");
const evidence = process.env.PROWESS_M7_EVIDENCE_DIR;
const output = evidence ? path.resolve(evidence) : await mkdtemp(path.join(os.tmpdir(), "prowess-m7-"));
const run = "m7" + randomBytes(5).toString("hex");
const admin = new URL(expected);
admin.pathname = "/postgres";
const client = new Client(admin.toString());
const runtime = ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/playtest/register.mjs"];
const prismaCli = path.join(root, "packages/prowess-db/node_modules/prisma/build/index.js");
const records = [];
const databases = [];
const urls = {};

function stage(roleName, url) {
  const result = spawnSync(process.execPath, [...runtime, "scripts/playtest/m7-wo1-encounter-restore.ts", roleName, run, output], {
    cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 4_000_000, timeout: 600_000,
  });
  process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) throw result.error ?? new Error(`M7-WO1 ${roleName} stage failed`);
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
  for (const role of ["source", "restored"]) {
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
  stage("resume", urls.source); // restart: a new process, same database

  const spec = await withDb(urls.source, async (c) => ({
    appVersion: "0.1.0",
    migrations: (await c.query("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name")).rows.map((r) => r.migration_name),
    tables: (await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows.map((r) => r.tablename).sort(),
  }));
  for (const t of ["encounters", "encounter_sides", "encounter_participants", "encounter_events"]) assert(spec.tables.includes(t), `the workspace backup covers ${t}`);
  const bytes = await withDb(urls.source, (c) => makeBackup(c, { ...spec, setup: null }));
  const { entries } = inspectBackup(bytes, spec);
  const rowsOf = (t) => entries.find((e) => e.table === t)?.rows.length ?? 0;
  await withDb(urls.restored, (c) => loadBackup(c, entries, spec.tables));
  records.push({ stage: "backup", bytes: bytes.length, tables: spec.tables.length, encounterRows: { encounters: rowsOf("encounters"), sides: rowsOf("encounter_sides"), participants: rowsOf("encounter_participants"), events: rowsOf("encounter_events") } });
  stage("resume", urls.restored);

  assert(records.some((r) => r.stage === "source"), "Missing source proof");
  assert.equal(records.filter((r) => r.stage === "resume" && r.unchanged).length, 2, "Missing restart and restore proofs");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  await writeFile(path.join(output, "m7-wo1-encounter-restore-evidence.json"), JSON.stringify({ gate: "M7-WO1", commit, elapsedMilliseconds: Date.now() - start, databases, records }, null, 2) + "\n");
  console.log(JSON.stringify({ stage: "done", elapsedMilliseconds: Date.now() - start }));
} finally {
  try {
    for (const name of databases.reverse()) await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
    if (!evidence) await rm(output, { force: true, recursive: true });
  }
}
