import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopGateway, readBody } from "./gateway.mjs";
import { atomicJSON, freePort, secret, Storage } from "./storage.mjs";
import { backupLimit, compareVersions, inspectBackup, loadBackup, makeBackup } from "./backup.mjs";
import { materializeLinks } from "../prototype-links.mjs";

const [packageDirectory, dataDirectory, postgresAccess] = process.argv.slice(2);
const stage = realpathSync(packageDirectory);
const root = realpathSync(dataDirectory);
const manifest = JSON.parse(readFileSync(path.join(stage, "prototype.json"), "utf8"));
const accessRoot = postgresAccess ?? root;
const statusPath = path.join(root, "status.json");
const controlPath = path.join(root, "control.json");
const journalPath = path.join(root, "upgrade.json");
const log = path.join(root, "launcher.log");
const demoFile = path.join(stage, "desktop", "Demo.prowesspack");
const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
const systemRoot = process.env.SystemRoot;
const system = process.platform === "win32" ? {
  SystemRoot: systemRoot, WINDIR: systemRoot, Path: path.join(systemRoot, "System32") + ";" + systemRoot,
  TEMP: accessRoot, TMP: accessRoot,
} : { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root };

const input = createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();
const instruction = await lines.next();
if (instruction.value !== "START") {
  input.close();
  process.exit(1);
}

let gateway;
let storage;
let studio;
let ready = false;
let working = true;
let closing = false;
let message = "Checking the Prowess Studio installation.";
let operation = Promise.resolve();
const controlToken = secret();
const backendToken = secret();

function status() {
  return {
    message, ready, firstRun: Boolean(storage?.state.initialized && storage.state.appVersion && !storage.state.setup && !working),
    demo: existsSync(demoFile), version: manifest.appVersion,
  };
}

function setStatus(next, running = false) {
  message = next;
  ready = running;
  try { atomicJSON(statusPath, status()); }
  catch { console.error("The launcher could not write its status file. Check available space and directory permissions."); }
}

function exclusive(action) {
  if (working || closing) return Promise.reject(new Error("Another launcher operation is in progress."));
  working = true;
  operation = Promise.resolve().then(action).finally(() => { working = false; });
  return operation;
}

async function stopStudio() {
  await gateway.drain();
  if (!studio) return;
  const stopping = studio;
  studio = undefined;
  stopping.child.kill();
  await stopping.done;
}

async function launchStudio(database) {
  const node = path.join(stage, manifest.node);
  const server = path.join(stage, manifest.server);
  const port = await freePort();
  const descriptor = openSync(log, "a");
  let child;
  try {
    child = spawn(node, [server], {
      cwd: path.dirname(server), windowsHide: true, stdio: ["ignore", descriptor, descriptor],
      env: { ...system, NODE_ENV: "production", DATABASE_URL: storage.url(database), APP_URL: gateway.origin,
        PORT: String(port), HOSTNAME: "127.0.0.1", LOG_LEVEL: "warn", DEVELOPMENT_MODE: "false",
        NEXT_TELEMETRY_DISABLED: "1", PROWESS_DESKTOP_MODE: "true", PROWESS_DESKTOP_BACKEND_TOKEN: backendToken,
        PROWESS_DESKTOP_WORKSPACE_ID: storage.state.id,
        // RULES-WO1: the exact build identity, shown on Studio's "About this build" page.
        PROWESS_APP_VERSION: manifest.appVersion, PROWESS_BUILD_COMMIT: manifest.build.commit, PROWESS_BUILD_TREE: manifest.build.tree,
        PROWESS_PACKAGE_SHA256: manifest.packageSha256,
      },
    });
  } finally { closeSync(descriptor); }
  const current = { child, done: new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
  }) };
  studio = current;
  void current.done.then(() => {
    if (studio === current && ready && !closing) {
      gateway.setBackend(undefined);
      setStatus("Studio stopped unexpectedly. Quit and reopen it to recover the workspace.");
    }
  });
  const origin = "http://127.0.0.1:" + port;
  const headers = { "x-prowess-desktop-backend": backendToken };
  const until = Date.now() + 30_000;
  while (child.exitCode === null && Date.now() < until) {
    try {
      const response = await fetch(origin + "/api/characters", { headers, signal: AbortSignal.timeout(3000) });
      if (response.ok && Array.isArray((await response.json()).data)) {
        const direct = await fetch(origin + "/api/characters", { signal: AbortSignal.timeout(3000) });
        await direct.body?.cancel();
        if (direct.status !== 403) throw new Error("The desktop backend allowed a direct request.");
        return port;
      }
      await response.body?.cancel();
    } catch (error) {
      if (error.message === "The desktop backend allowed a direct request.") throw error;
    }
    await delay(250);
  }
  throw new Error("Studio did not complete a database-backed readiness check. Use launcher diagnostics.");
}

const backupSpec = (state = storage.state) => ({
  appVersion: state.appVersion, migrations: state.migrations, tables: state.tables, setup: state.setup,
});
const installedSpec = () => ({ appVersion: manifest.appVersion, migrations: manifest.migrations, tables: manifest.desktopTables });

async function snapshot(state) {
  return storage.withClient(state.active, (client) => makeBackup(client, backupSpec(state)));
}

async function recoveryBackup(state, purpose) {
  const bytes = await snapshot(state);
  inspectBackup(bytes, backupSpec(state));
  const directory = path.join(root, "recovery");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, purpose + "-" + Date.now() + "-" + secret().slice(0, 12) + ".prowess-backup");
  writeFileSync(file, bytes, { flag: "wx", mode: 0o600, flush: true });
  inspectBackup(readFileSync(file), backupSpec(state));
  return path.basename(file);
}

async function activate(database, choice) {
  await storage.checkSchema(database);
  const port = await launchStudio(database);
  storage.persist({ active: database, setup: choice, ...installedSpec() });
  gateway.setBackend(port);
  setStatus("Studio is ready.", true);
}

async function activateSample(database) {
  const bytes = readFileSync(demoFile);
  if (!manifest.demo || createHash("sha256").update(bytes).digest("hex") !== manifest.demo.sha256) {
    throw new Error("The bundled sample pack has changed. Reinstall Prowess Studio.");
  }
  await storage.checkSchema(database);
  const port = await launchStudio(database);
  const origin = "http://127.0.0.1:" + port;
  const headers = { "x-prowess-desktop-backend": backendToken };
  try {
    const reviewed = await fetch(origin + "/api/content-packs/preview", {
      method: "POST", headers, body: bytes, signal: AbortSignal.timeout(60_000),
    });
    const preview = await reviewed.json();
    if (!reviewed.ok || preview.state !== "Ready" || preview.manifest.provenance.category !== "sample" ||
        preview.manifest.contentDigest !== manifest.demo.contentDigest || preview.manifest.release.releaseId !== manifest.demo.release) {
      throw new Error("The bundled sample Release did not pass content pack validation.");
    }
    const result = await fetch(origin + "/api/content-packs/install", {
      method: "POST", headers: { ...headers, "x-prowess-pack-preview": preview.previewFingerprint }, body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
    if (!result.ok || (await result.json()).state !== "Installed") throw new Error("The bundled sample Release did not install.");
    storage.persist({ active: database, setup: "demo", ...installedSpec() });
    gateway.setBackend(port);
    setStatus("Studio is ready.", true);
  } catch (error) {
    await stopStudio();
    throw error;
  }
}

async function restoreWorkspace(request) {
  if (!ready) throw new Error("Open the existing workspace before restoring it.");
  const { entries, setup } = inspectBackup(await readBody(request, backupLimit), installedSpec());
  const previous = storage.state;
  setStatus("Preparing the workspace restore.");
  await stopStudio();
  try {
    await recoveryBackup(previous, "before-restore");
    const database = await storage.newDatabase();
    await storage.prisma(database, "migrate", "deploy");
    await storage.withClient(database, (client) => loadBackup(client, entries, manifest.desktopTables));
    await activate(database, setup ?? "empty");
    gateway.invalidateSessions();
    return "Workspace restored. Open Studio again from its shortcut.";
  } catch (error) {
    await stopStudio();
    gateway.setBackend(await launchStudio(storage.state.active));
    setStatus("Studio is ready. The restore did not complete.", true);
    throw error;
  }
}

async function chooseWorkspace(choice) {
  if (!["empty", "demo"].includes(choice) || !storage?.state.appVersion || storage.state.setup !== null) {
    throw new Error("This workspace already has a first-run choice.");
  }
  setStatus("Preparing your workspace.");
  if (choice === "demo") {
    const database = await storage.newDatabase();
    await storage.prisma(database, "migrate", "deploy");
    await activateSample(database);
  } else {
    await activate(storage.state.active, choice);
  }
  return "Studio is ready.";
}

async function prepareWorkspace() {
  const previous = storage.state;
  if (!previous.appVersion) {
    await storage.prisma(previous.active, "migrate", "deploy");
    await storage.checkSchema(previous.active);
    storage.persist(installedSpec());
  } else {
    const order = compareVersions(manifest.appVersion, previous.appVersion);
    if (order < 0) throw new Error("This workspace requires a newer Prowess Studio version.");
    const prefix = previous.migrations.every((migration, index) => migration === manifest.migrations[index]);
    if (!prefix || order === 0 && previous.migrations.length !== manifest.migrations.length) {
      throw new Error("The workspace migration history does not match this application.");
    }
    if (order > 0) {
      setStatus("Backing up and upgrading the local workspace.");
      await storage.checkHistory(previous.active, previous.migrations);
      const backup = await recoveryBackup(previous, "before-upgrade");
      const staged = await storage.newDatabase(previous.active);
      atomicJSON(journalPath, { previous: previous.active, staged, from: previous.appVersion, to: manifest.appVersion, backup });
      await storage.prisma(staged, "migrate", "deploy");
      if (previous.setup) await activate(staged, previous.setup);
      else {
        await storage.checkSchema(staged);
        storage.persist({ ...installedSpec(), active: staged });
      }
      try { rmSync(journalPath, { force: true }); }
      catch { console.error("The upgrade completed but its recovery record could not be removed."); }
      return;
    }
  }
  if (storage.state.setup) {
    await storage.checkSchema(storage.state.active);
    gateway.setBackend(await launchStudio(storage.state.active));
    setStatus("Studio is ready.", true);
  }
}

async function quit() {
  if (closing) return;
  closing = true;
  try {
    await operation.catch(() => {});
    if (gateway) {
      await stopStudio();
      await gateway.close();
    }
    await storage?.stop();
  } finally {
    rmSync(controlPath, { force: true });
    input.close();
  }
}

function fail(error) {
  const text = String(error?.message ?? "Unknown launcher failure.");
  const message = storage?.state.password ? text.replaceAll(storage.state.password, "[redacted]") : text;
  setStatus(message);
}

gateway = await createDesktopGateway({
  controlToken, backendToken, status,
  setup: (choice) => exclusive(() => chooseWorkspace(choice)).catch((error) => {
    if (!ready) fail(error);
    return message;
  }),
  backup: () => exclusive(async () => {
    if (!ready) throw new Error("Open the workspace before backing it up.");
    return snapshot(storage.state);
  }),
  restore: (request) => exclusive(() => restoreWorkspace(request)).catch(() => "Restore failed. The previous workspace was retained."),
  diagnostics: () => ({
    ...status(), commit: manifest.build.commit, tree: manifest.build.tree, packageSha256: manifest.packageSha256,
    windowsBuild: os.release(), architecture: process.arch, migrations: manifest.migrations.length,
  }),
  quit: () => { quit().catch(() => { process.exitCode = 1; }); },
});
atomicJSON(controlPath, { origin: gateway.origin, token: controlToken });
input.once("close", () => { quit().catch(() => { process.exitCode = 1; }); });

operation = (async () => {
  try {
    materializeLinks(stage, readJSON(path.join(stage, "links.json")));
    setStatus("Starting the local PostgreSQL database.");
    storage = new Storage({ root, accessRoot, stage, manifest, environment: system, log });
    await storage.start();
    setStatus("Checking the workspace schema.");
    await prepareWorkspace();
    if (!storage.state.setup) setStatus("Choose how to start your workspace.");
  } catch (error) { fail(error); }
  finally { working = false; }
})();
await operation;
let checkingStorage = false;
const healthCheck = setInterval(async () => {
  if (!ready || working || closing || checkingStorage) return;
  const active = storage.state.active;
  checkingStorage = true;
  try { await storage.withClient(active, (client) => client.query("SELECT 1")); }
  catch {
    if (ready && !working && !closing && storage.state.active === active) {
      gateway.setBackend(undefined);
      setStatus("The local database stopped responding. Quit and reopen Studio to recover the workspace.");
    }
  } finally { checkingStorage = false; }
}, 5000);
healthCheck.unref();
