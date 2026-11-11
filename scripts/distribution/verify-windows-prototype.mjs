// Feasibility harness for a disposable ordinary-user Windows 11 account.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { prototypePackageSha256, verifyPrototypeBuild } from "./prototype-build-identity.mjs";
import { materializeLinks, relativeInside } from "./prototype-links.mjs";
import { inspectWindowsProofEnvironment } from "./windows-proof-environment.mjs";
import { createPostgresAccessPaths } from "./windows-postgres-paths.mjs";

assert.equal(process.platform, "win32", "Run this check on Windows 11 x64.");
assert.equal(process.arch, "x64");
const [packagePath, ...extra] = process.argv.slice(2);
assert.ok(packagePath && extra.length === 0, "Supply the staged prototype directory.");
const root = realpathSync(packagePath);
assert.ok(root.includes(" ") && /[^\x00-\x7f]/.test(root), "Exercise a package path with spaces and non-ASCII characters.");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const manifest = readFileSync(path.join(root, "prototype.json"));
const staged = JSON.parse(manifest.toString("utf8"));
assert.ok(staged.build?.version === 1 && staged.postgres && staged.crt && staged.build.platform === "win32",
  "Use a recorded clean-source Windows stage.");
assert.equal(process.version, staged.build.nodeVersion);
const repository = path.resolve(import.meta.dirname, "../..");
const stageFile = (name) => {
  assert.ok(!path.isAbsolute(name));
  const file = realpathSync(path.resolve(root, name));
  relativeInside(root, file);
  return file;
};
const node = stageFile(staged.node);
assert.equal(realpathSync(process.execPath), node, "Start the harness with the packaged Node executable.");
assert.equal(createHash("sha256").update(readFileSync(node)).digest("hex"), staged.nodeSha256);
for (const file of staged.crt.files) {
  for (const directory of [path.dirname(staged.node), staged.postgres.bin, path.dirname(staged.schemaEngine)]) {
    assert.equal(createHash("sha256").update(readFileSync(stageFile(path.join(directory, file.name)))).digest("hex"), file.sha256);
  }
}
const database = stageFile(staged.database);
const systemRoot = process.env.SystemRoot;
assert.ok(systemRoot && path.isAbsolute(systemRoot));
const systemEnvironment = {
  SystemRoot: systemRoot,
  WINDIR: systemRoot,
  Path: [path.join(systemRoot, "System32"), systemRoot].join(path.delimiter),
  TEMP: os.tmpdir(),
  TMP: os.tmpdir(),
};
const windows = inspectWindowsProofEnvironment(systemRoot, systemEnvironment);
assert.deepEqual(staged.build, verifyPrototypeBuild(repository), "Stage the recorded build from this checkout.");
assert.equal(prototypePackageSha256(root), staged.packageSha256, "The staged package differs from its manifest. Stage a fresh package.");
materializeLinks(root, readJson(path.join(root, "links.json")));
const profile = mkdtempSync(path.join(os.tmpdir(), "Prowess essai é "));
const storage = createPostgresAccessPaths(os.tmpdir(), stageFile(staged.postgres.bin), profile);
const postgres = (name) => path.join(storage.bin, name + ".exe");
const cluster = path.join(storage.profile, "cluster");
const password = randomBytes(32).toString("hex");
const passwordFile = path.join(storage.profile, "initdb-password");
const databaseName = "prowess_dist_prototype_test";
const user = "dist_prototype";
const startedAt = Date.now();

function run(executable, args, env = systemEnvironment, cwd = storage.profile, timeout = 60_000) {
  return execFileSync(executable, args, { env, cwd, timeout, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

async function freeLoopbackPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

const pgPort = await freeLoopbackPort();
const connection = { user, password, host: "127.0.0.1", port: pgPort, connectionTimeoutMillis: 5000 };
const databaseUrl = "postgresql://" + user + ":" + password + "@127.0.0.1:" + pgPort + "/" + databaseName;
const databaseEnvironment = { ...systemEnvironment, DATABASE_URL: databaseUrl };
const requireDb = createRequire(path.join(repository, "packages/prowess-db/package.json"));
const { Client } = requireDb("pg");

async function query(databaseName, sql, params = []) {
  const client = new Client({ ...connection, database: databaseName });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

function migrate(...args) {
  return run(node, [stageFile(staged.prisma), ...args], {
    ...databaseEnvironment,
    PRISMA_SCHEMA_ENGINE_BINARY: stageFile(staged.schemaEngine),
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    CHECKPOINT_DISABLE: "1",
  }, database);
}

async function api(base, route, status, options = {}) {
  const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, status, route);
  return (await response.json()).data;
}

async function withStudio(pass, verify) {
  const port = await freeLoopbackPort();
  const base = "http://127.0.0.1:" + port;
  const server = stageFile(staged.server);
  const log = openSync(path.join(profile, "studio-" + pass + ".log"), "wx");
  const app = spawn(node, [server], {
    cwd: path.dirname(server),
    env: {
      ...databaseEnvironment, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
      APP_URL: base, DEVELOPMENT_MODE: "false", LOG_LEVEL: "warn", NEXT_TELEMETRY_DISABLED: "1",
    },
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const exited = new Promise((resolve) => {
    app.once("exit", resolve);
    app.once("error", resolve);
  });
  try {
    let ready = false;
    const deadline = Date.now() + 30_000;
    while (!ready && app.exitCode === null && Date.now() < deadline) {
      ready = await api(base, "/api/characters", 200).then(Array.isArray, () => false);
      if (!ready) await delay(250);
    }
    assert.ok(ready, "Studio did not complete a database-backed read.");
    return await verify(base);
  } finally {
    if (app.exitCode === null) app.kill();
    await exited;
  }
}

let storageMayBeRunning = false;
function startStorage() {
  storageMayBeRunning = true;
  run(postgres("pg_ctl"), ["-D", cluster, "-l", path.join(storage.profile, "postgres.log"), "-w", "-t", "30", "start"]);
}

function stopStorage() {
  try {
    run(postgres("pg_ctl"), ["-D", cluster, "status"]);
    run(postgres("pg_ctl"), ["-D", cluster, "-w", "-t", "30", "-m", "fast", "stop"]);
  } catch (error) {
    if (error.status !== 3) throw error;
  }
  storageMayBeRunning = false;
}

async function verifyOwnedStorage() {
  const [observed] = await query("postgres", "SELECT current_setting('data_directory') AS path, " +
    "current_setting('server_version_num')::int AS version, current_setting('server_encoding') AS encoding");
  assert.match(observed.path, /^[\x20-\x7e]+$/);
  assert.equal(realpathSync(observed.path), realpathSync(path.join(profile, "cluster")));
  assert.equal(observed.encoding, "UTF8");
  assert.equal(observed.version, 160014);
  return observed.version;
}

async function fingerprint(id) {
  const rows = await query(databaseName, "SELECT row_to_json(c)::text AS record FROM characters c WHERE c.id = $1", [id]);
  assert.equal(rows.length, 1);
  return createHash("sha256").update(rows[0].record).digest("hex");
}

try {
  console.log("Initializing the disposable PostgreSQL cluster.");
  assert.match(run(postgres("postgres"), ["--version"]), /\b16\.14\b/);
  writeFileSync(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
  try {
    run(postgres("initdb"), ["-D", cluster, "-U", user, "--pwfile=" + passwordFile, "--auth=scram-sha-256", "--locale=C", "--encoding=UTF8"]);
  } finally {
    rmSync(passwordFile, { force: true });
  }
  appendFileSync(path.join(cluster, "postgresql.conf"), "\nlisten_addresses = '127.0.0.1'\nport = " + pgPort + "\n");
  startStorage();
  const postgresVersion = await verifyOwnedStorage();

  console.log("Deploying and checking the shipped Prisma migrations.");
  migrate("validate");
  migrate("migrate", "deploy");
  migrate("migrate", "status");
  migrate("migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code");
  const migrations = await query(databaseName,
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name");
  assert.deepEqual(migrations.map((entry) => entry.migration_name), staged.migrations);

  console.log("Preparing one test-only Release through the guarded WO12 command.");
  const runId = "dist" + randomBytes(6).toString("hex");
  run(node, ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/playtest/register.mjs",
    "./scripts/playtest/wo12-world.ts", "prepare", runId], { ...databaseEnvironment, NODE_ENV: "test" }, repository, 300_000);
  const world = readJson(path.join(repository, ".playtest", "m6-wo12-" + runId + ".json"));
  const name = "Prowess prototype é";
  const character = await withStudio("first", (base) => api(base, "/api/characters", 201, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, rulesetReleaseId: world.release1.id }),
  }));
  assert.equal(character.name, name);
  assert.equal(character.status, "DRAFT");
  assert.equal(character.release.id, world.release1.id);
  const before = await fingerprint(character.id);

  console.log("Restarting both processes and reading the saved draft.");
  stopStorage();
  startStorage();
  await verifyOwnedStorage();
  migrate("migrate", "status");
  const resumed = await withStudio("restart", (base) => api(base, "/api/characters/" + character.id, 200));
  assert.deepEqual(resumed, character);
  const after = await fingerprint(character.id);
  assert.equal(after, before);

  stopStorage();
  const evidence = {
    windows,
    build: staged.build,
    package: {
      sha256: staged.packageSha256,
      manifestSha256: createHash("sha256").update(manifest).digest("hex"),
      appVersion: staged.appVersion, nextVersion: staged.nextVersion, prismaVersion: staged.prismaVersion,
      nodeSha256: staged.nodeSha256, postgresVersion, crtVersion: staged.crt.version,
    },
    paths: { package: root, profile, postgresBin: storage.bin, postgresDataDirectory: cluster },
    checks: {
      postgresStartup: "passed", productionStudioStartup: "passed",
      migrationDeployment: "passed", migrations: migrations.length, schemaDrift: "none",
      characterCreation: "passed", restartPersistence: "passed",
    },
    fixture: world.prefix, character: character.id, release: resumed.release.id,
    fingerprintBeforeRestart: before, fingerprintAfterRestart: after,
    result: "passed",
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  writeFileSync(path.join(profile, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  console.log("Windows prototype evidence " + path.join(profile, "evidence.json"));
} catch (error) {
  console.error((String(error) + "\n" + (error.stderr ?? "")).replaceAll(password, "[redacted]"));
  console.error("Disposable test evidence is under " + profile);
  process.exitCode = 1;
} finally {
  if (storageMayBeRunning) stopStorage();
}
