// Maintainer-only demo assembly. Runtime installs the resulting data backup.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectBackup, makeBackup } from "./desktop/backup.mjs";
import { Storage } from "./desktop/storage.mjs";
import { materializeLinks } from "./prototype-links.mjs";
import { prototypePackageSha256, verifyPrototypeBuild } from "./prototype-build-identity.mjs";

const repository = realpathSync(path.join(import.meta.dirname, "../.."));
const [packagePath] = process.argv.slice(2);
assert.ok(packagePath && process.argv.length === 3, "Supply one clean stage directory.");
const stage = realpathSync(packagePath);
const manifestPath = path.join(stage, "prototype.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.deepEqual(manifest.build, verifyPrototypeBuild(repository));
assert.equal(manifest.packageSha256, prototypePackageSha256(stage));
assert.ok(manifest.postgres && !manifest.demo, "Stage a fresh package with the bundled PostgreSQL runtime.");

const temporary = mkdtempSync(path.join(os.tmpdir(), "Prowess-demo-"));
if (process.platform === "win32") assert.match(temporary, /^[\x20-\x7e]+$/, "Use an ASCII maintainer temporary directory.");
const workspace = path.join(temporary, "workspace");
const copy = path.join(temporary, "package");
mkdirSync(workspace);
cpSync(stage, copy, { recursive: true });
const systemRoot = process.env.SystemRoot;
const environment = process.platform === "win32" ? {
  SystemRoot: systemRoot, WINDIR: systemRoot, Path: path.join(systemRoot, "System32"),
  TEMP: temporary, TMP: temporary,
} : { PATH: "/usr/bin:/bin", HOME: temporary };
let storage;
try {
  materializeLinks(copy, JSON.parse(readFileSync(path.join(copy, "links.json"), "utf8")));
  storage = new Storage({ root: workspace, accessRoot: workspace, stage: copy, manifest, environment,
    log: path.join(temporary, "build-demo.log") });
  await storage.start();
  const database = "prowess_desktop_demo_test";
  storage.prisma(database, "migrate", "deploy");
  storage.checkSchema(database);
  const runId = "demo" + randomBytes(6).toString("hex");
  execFileSync(path.join(copy, manifest.node), ["--experimental-transform-types", "--no-warnings",
    "--import", "./scripts/playtest/register.mjs", "./scripts/playtest/wo12-world.ts", "prepare", runId], {
    cwd: repository, env: { ...environment, NODE_ENV: "test", DATABASE_URL: storage.url(database) },
    windowsHide: true, timeout: 300_000, stdio: "inherit",
  });
  const fixture = JSON.parse(readFileSync(path.join(repository, ".playtest", "m6-wo12-" + runId + ".json"), "utf8"));
  const spec = { appVersion: manifest.appVersion, migrations: manifest.migrations, tables: manifest.desktopTables, setup: "demo" };
  const backup = await storage.withClient(database, async (client) => {
    const renamed = await client.query("UPDATE public.rulesets SET name = $1 WHERE id = $2", ["Demo — sample rules", fixture.rulesetId]);
    assert.equal(renamed.rowCount, 1);
    return makeBackup(client, spec);
  });
  const demo = inspectBackup(backup, spec);
  assert.ok(demo.entries.filter((entry) => entry.table.startsWith("character")).every((entry) => entry.rows.length === 0),
    "The demo may only include rule and source data.");
  const file = path.join(stage, "desktop", "Demo.prowess-backup");
  assert.ok(!existsSync(file));
  writeFileSync(file, backup, { flag: "wx" });
  manifest.demo = {
    provenance: "M6-WO12 isolated test Release, demo sample rules",
    ruleset: fixture.rulesetId,
    release: fixture.release1.id,
    sha256: createHash("sha256").update(backup).digest("hex"),
  };
  manifest.packageSha256 = prototypePackageSha256(stage);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Prepared the sample-rules backup and updated the package identity.");
} catch (error) {
  console.error("Demo preparation logs: " + path.join(temporary, "build-demo.log"));
  throw error;
} finally {
  storage?.stop();
}
if (process.platform !== "win32") rmSync(temporary, { recursive: true, force: true });
