import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const requireDb = createRequire(path.join(root, "packages/prowess-db/package.json"));
const { Client } = requireDb("pg");
const expected = new URL(process.env.DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(expected.hostname) && /^\/[a-z][a-z0-9_]*_test$/.test(expected.pathname),
  "Transfer proof requires a disposable local test database connection");
const evidence = process.env.PROWESS_DIST_WO2_EVIDENCE_DIR;
const output = evidence ? path.resolve(evidence) : await mkdtemp(path.join(os.tmpdir(), "prowess-dist-wo2-"));
const run = "dist" + randomBytes(6).toString("hex");
const browser = process.argv[2] === "--browser";
const http = process.argv[2] === "--http";
const production = browser || http;
const admin = new URL(expected);
admin.pathname = "/postgres";
const client = new Client(admin.toString());
const runtime = ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/playtest/register.mjs"];
const records = [];
const databases = [];

function execute(command, args, uri, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: uri, NODE_ENV: "test" },
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", maxBuffer: 2_000_000, timeout: 300_000,
  });
  if (capture) process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) throw result.error ?? new Error("DIST-WO2 verification step failed");
  for (const line of (result.stdout ?? "").split("\n")) if (/^\{"stage":/.test(line)) records.push(JSON.parse(line));
}

const prisma = path.join(root, "packages/prowess-db/node_modules/prisma/build/index.js");
const start = Date.now();
await mkdir(output, { recursive: true });
await client.connect();
try {
  const urls = {};
  for (const role of production ? ["source", "production_receiver"] : ["source", "receiver", "clean_receiver"]) {
    const name = `prowess_${run}_${role}_test`;
    assert(/^[a-z0-9_]+_test$/.test(name));
    await client.query(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const url = new URL(expected);
    url.pathname = "/" + name;
    urls[role] = url.toString();
    const deploy = spawnSync(process.execPath, [prisma, "migrate", "deploy"], {
      cwd: path.join(root, "packages/prowess-db"), env: { ...process.env, DATABASE_URL: urls[role] }, stdio: "inherit", timeout: 120_000,
    });
    assert.equal(deploy.status, 0, `Migrations failed for ${role}`);
  }
  const sourceFiles = path.join(output, "source");
  execute(process.execPath, [...runtime, "scripts/playtest/dist-wo2-transfer.ts", "source", run, sourceFiles], urls.source, true);
  for (const role of production ? [] : ["receiver", "clean_receiver"]) {
    const files = path.join(output, role);
    await mkdir(files);
    for (const name of ["R1.prowesspack", "R2.prowesspack"]) await copyFile(path.join(sourceFiles, name), path.join(files, name));
    execute(process.execPath, [...runtime, "scripts/playtest/dist-wo2-transfer.ts", role.replaceAll("_", "-"), run, files], urls[role], true);
    if (role === "receiver") execute(process.execPath, [...runtime, "scripts/playtest/dist-wo2-transfer.ts", "resume", run, files], urls[role], true);
  }
  if (production) {
    const { runPackBrowserProof, runPackHttpProof } = await import("../playtest/dist-wo2-browser.mjs");
    const releases = records.filter((row) => row.stage === "export").map((row) => ({
      ...row.release, wardVersionId: row.wardVersionId, wardEntityId: row.wardEntityId,
    }));
    assert.equal(releases.length, 2);
    const verify = browser ? runPackBrowserProof : runPackHttpProof;
    const proof = await verify({ source: urls.source, receiver: urls.production_receiver }, releases, output);
    records.push(proof);
    console.log(JSON.stringify(proof));
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length !== 0;
  if (process.env.GITHUB_SHA) assert.equal(commit, process.env.GITHUB_SHA, "Wrong source commit for transfer proof");
  if (browser) assert(records.some((row) => row.stage === "browser" && row.restarts === 2 && row.importedAuthoringRefused === true &&
    row.characters.map((character) => character.paidMana).join(",") === "4,3"), "Missing browser transfer and play proof");
  else if (http) assert(records.some((row) => row.stage === "production-http" && row.unchangedAfterRestart), "Missing HTTP transfer proof");
  else {
    assert(records.some((row) => row.stage === "safe-update" && row.unchanged), "Missing safe-update proof");
    assert(records.some((row) => row.stage === "resume" && row.unchanged), "Missing restart proof");
    assert(records.some((row) => row.stage === "rejection" && row.lateFailureRolledBack), "Missing rollback proof");
  }
  if (process.env.GITHUB_SHA) assert(!dirty, "CI transfer proof requires a clean source tree");
  await writeFile(path.join(output, "transfer-evidence.json"), JSON.stringify({
    commit, tree, dirty, mode: browser ? "browser" : http ? "production-http" : "services", os: os.platform(), architecture: os.arch(), elapsedMilliseconds: Date.now() - start, databases, records,
  }, null, 2) + "\n", { flag: "wx" });
} finally {
  try {
    for (const name of databases.reverse()) await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
    if (!evidence) await rm(output, { force: true, recursive: true });
  }
}
