import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const prefix = "/__prowess_desktop";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function workspace(root) {
  return JSON.parse(readFileSync(path.join(root, "workspace.json"), "utf8"));
}

export async function waitFor(read, description) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; }
    catch (error) { last = error; }
    await delay(250);
  }
  throw new Error("Timed out waiting for " + description, { cause: last });
}

export async function connect(root) {
  const { origin, token } = await waitFor(() => JSON.parse(readFileSync(path.join(root, "control.json"), "utf8")),
    "the native launcher's control socket");
  const request = async (route, options = {}, expected = 200) => {
    const response = await fetch(origin + route, {
      signal: AbortSignal.timeout(100_000), ...options, headers: { ...options.headers, connection: "close" },
    });
    if (response.status !== expected) throw new Error(route + " returned " + response.status + ", expected " + expected);
    return response;
  };
  const control = (body) => request(prefix + "/control", { method: "POST", headers: { "x-prowess-control": token }, body });
  async function browser() {
    const url = new URL(await (await control("open")).text());
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, prefix + "/launch");
    await (await request(url.pathname)).text();
    const redeem = (expected) => request(prefix + "/session", {
      method: "POST", headers: { origin, "sec-fetch-site": "same-origin" }, body: url.hash.slice(1),
    }, expected);
    const session = await redeem(200);
    assert.match(session.headers.get("set-cookie"), /^prowess_desktop=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/$/);
    await session.text();
    await (await redeem(403)).text();
    const cookie = session.headers.get("set-cookie").split(";")[0];
    return (route, options = {}, expected) => request(route, {
      ...options, headers: { cookie, origin, "sec-fetch-site": "same-origin", ...options.headers },
    }, expected);
  }
  return { origin, request, control, browser };
}

export async function setup(root, choice, manifest) {
  const start = performance.now();
  const gateway = await connect(root);
  await (await gateway.request("/api/characters", {}, 401)).text();
  await (await gateway.request(prefix + "/control", { method: "POST", body: "quit" }, 403)).text();
  const api = await gateway.browser();
  await waitFor(async () => (await (await api(prefix + "/status")).json()).firstRun, "first-run choices");
  await (await api(prefix + "/status", { headers: { origin: "https://example.test" } }, 403)).text();
  await (await api(prefix + "/quit", { method: "POST", headers: { origin: "https://example.test" } }, 403)).text();
  await (await api("/api/characters", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }, 403)).text();
  const rejectedHost = await new Promise((resolve, reject) => {
    const request = http.get(gateway.origin + "/api/characters", { headers: { host: "outside.example.test" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.setTimeout(30_000, () => request.destroy(new Error("Host check timed out.")));
  });
  assert.equal(rejectedHost, 403);
  await (await api(prefix + "/setup", { method: "POST", body: choice })).text();
  await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "database-backed Studio readiness");
  const diagnostics = await (await api(prefix + "/diagnostics")).json();
  assert.equal(diagnostics.commit, manifest.build.commit);
  assert.equal(diagnostics.tree, manifest.build.tree);
  assert.equal(diagnostics.packageSha256, manifest.packageSha256);
  assert.equal(diagnostics.migrations, manifest.migrations.length);
  const characters = (await (await api("/api/characters")).json()).data;
  assert.deepEqual(characters, []);
  assert.equal(workspace(root).setup, choice);
  assert.deepEqual(workspace(root).migrations, manifest.migrations);
  return { gateway, api, startupMilliseconds: Math.round(performance.now() - start) };
}

export async function exercise(root, manifest, packFile) {
  const { gateway, api, startupMilliseconds } = await setup(root, "demo", manifest);
  const name = "DIST-WO1 Windows sample é";
  const creation = await api("/api/characters", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, rulesetReleaseId: manifest.demo.release }),
  }, 201);
  const character = (await creation.json()).data;
  assert.equal(character.name, name);
  assert.equal(character.release.id, manifest.demo.release);
  const route = "/api/characters/" + character.id;
  assert.deepEqual((await (await api(route)).json()).data, character);
  const first = workspace(root).active;
  const backup = Buffer.from(await (await api(prefix + "/backup")).arrayBuffer());
  const archive = JSON.parse(backup.toString());
  const rows = JSON.parse(archive.payload).tables.find((entry) => entry.table === "characters").rows;
  const row = rows.find((entry) => JSON.parse(entry).id === character.id);
  assert.ok(row);
  const fingerprint = createHash("sha256").update(row).digest("hex");
  const restore = (body) => api(prefix + "/restore", { method: "POST", body });
  assert.match(await (await restore(backup.subarray(0, 10))).text(), /^Restore failed/);
  assert.equal(workspace(root).active, first);
  assert.match(await (await restore(backup)).text(), /^Workspace restored/);
  assert.notEqual(workspace(root).active, first);
  await (await api(route, {}, 401)).text();
  const reopened = await gateway.browser();
  assert.deepEqual((await (await reopened(route)).json()).data, character);
  const after = JSON.parse(JSON.parse(await (await reopened(prefix + "/backup")).text()).payload);
  const restored = after.tables.find((entry) => entry.table === "characters").rows;
  assert.equal(restored.find((entry) => JSON.parse(entry).id === character.id), row);
  let pack;
  if (packFile) {
    const response = await reopened(`/api/ruleset-releases/${manifest.demo.release}/content-pack`);
    assert.match(response.headers.get("content-disposition"), /\.prowesspack"$/);
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(packFile, bytes, { flag: "wx" });
    const release = after.tables.find((entry) => entry.table === "ruleset_releases").rows
      .map(JSON.parse).find((entry) => entry.id === manifest.demo.release);
    pack = { archiveSha256: sha256(bytes), bytes: bytes.length, releaseId: release.id,
      manifestId: release.manifest_id, manifestHash: release.manifest_hash };
  }
  await (await gateway.control("quit")).text();
  return { startupMilliseconds, fingerprint, character, route, pack };
}

export async function verifyRestart(root, initial) {
  const gateway = await connect(root);
  const api = await gateway.browser();
  await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "Studio restart");
  assert.deepEqual((await (await api(initial.route)).json()).data, initial.character);
  await (await gateway.control("quit")).text();
}

const backup = async (api) => Buffer.from(await (await api(prefix + "/backup")).arrayBuffer());

function backedUpTables(bytes) {
  const envelope = JSON.parse(bytes.toString("utf8"));
  assert.equal(sha256(envelope.payload), envelope.sha256);
  const { tables } = JSON.parse(envelope.payload);
  return Object.fromEntries(tables.map(({ table, rows }) => [table, rows.sort()]));
}

const installedState = async (api) => backedUpTables(await backup(api));

async function installedTransfer(root, manifest, packFile, source) {
  const bytes = readFileSync(packFile);
  assert.equal(sha256(bytes), source.archiveSha256);
  const { gateway, api, startupMilliseconds } = await setup(root, "empty", manifest);
  const baseline = await installedState(api);
  assert.deepEqual(baseline.ruleset_releases, []);
  assert.deepEqual(baseline.content_pack_receipts, []);
  const preview = (body, status = 200) => api("/api/content-packs/preview", { method: "POST", body }, status);
  const invalid = Buffer.from(bytes);
  invalid[invalid.length - 1] ^= 1;
  assert.match((await (await preview(invalid, 422)).json()).error, /Payload bytes/);
  const plan = await (await preview(bytes)).json();
  assert.equal(plan.state, "Ready");
  assert.equal(plan.trust, "Unverified source");
  assert.equal(plan.manifest.release.releaseId, source.releaseId);
  assert.equal(plan.manifest.release.manifestId, source.manifestId);
  assert.equal(plan.manifest.release.manifestHash, source.manifestHash);
  assert.deepEqual(await installedState(api), baseline);
  const install = async () => (await (await api("/api/content-packs/install", {
    method: "POST", body: bytes, headers: { "x-prowess-pack-preview": plan.previewFingerprint },
  })).json()).state;
  assert.equal(await install(), "Installed");
  const after = await installedState(api);
  assert.equal(after.content_pack_receipts.length, 1);
  assert.equal(await install(), "Already installed");
  assert.deepEqual(await installedState(api), after);
  const character = (await (await api("/api/characters", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "DIST-WO2 receiving Character", rulesetReleaseId: source.releaseId }),
  }, 201)).json()).data;
  assert.equal(character.release.id, source.releaseId);
  const route = `/api/characters/${character.id}`;
  const bytesToRestore = await backup(api);
  const saved = backedUpTables(bytesToRestore);
  const first = workspace(root).active;
  const restore = (body) => api(prefix + "/restore", { method: "POST", body });
  assert.match(await (await restore(bytes)).text(), /^Restore failed/);
  assert.equal(workspace(root).active, first);
  assert.match(await (await restore(bytesToRestore)).text(), /^Workspace restored/);
  assert.notEqual(workspace(root).active, first);
  await (await api(route, {}, 401)).text();
  const restored = await gateway.browser();
  assert.deepEqual(await installedState(restored), saved);
  await (await gateway.control("quit")).text();
  return { startupMilliseconds, route, character, pack: { ...source, contentDigest: plan.manifest.contentDigest },
    previewUnchanged: true, invalidPackRejected: true, replay: "Already installed", fingerprint: sha256(JSON.stringify(saved)) };
}

async function restartTransferredWorkspace(root, initial) {
  const gateway = await connect(root);
  const api = await gateway.browser();
  await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "installed transfer restart");
  assert.deepEqual((await (await api(initial.route)).json()).data, initial.character);
  assert.equal(sha256(JSON.stringify(await installedState(api))), initial.fingerprint);
  await (await gateway.control("quit")).text();
}

async function verifyUpgrade(root, manifest, previous) {
  const gateway = await connect(root);
  const api = await gateway.browser();
  await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "DIST-WO1 workspace upgrade");
  assert.equal(workspace(root).appVersion, manifest.appVersion);
  assert.deepEqual(workspace(root).migrations, manifest.migrations);
  assert.equal(workspace(root).setup, "demo");
  assert.deepEqual((await (await api(previous.route)).json()).data, previous.character);
  const catalog = await installedState(api);
  const oldCharacter = catalog.characters.find((row) => JSON.parse(row).id === previous.character.id);
  assert.ok(oldCharacter, "The prior Character is present in the upgraded database");
  assert.equal(sha256(oldCharacter), previous.fingerprint);
  assert.deepEqual(catalog.content_pack_receipts, []);
  await (await gateway.control("quit")).text();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [phase, root, manifestPath, report, packFile, sourceReport] = process.argv.slice(2);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (phase === "initial") {
    const result = await exercise(root, manifest, packFile);
    writeFileSync(report, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  } else if (phase === "restart") {
    await verifyRestart(root, JSON.parse(readFileSync(report, "utf8")));
  } else if (phase === "transfer") {
    const { pack } = JSON.parse(readFileSync(sourceReport, "utf8"));
    const result = await installedTransfer(root, manifest, packFile, pack);
    writeFileSync(report, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  } else if (phase === "transfer-restart") {
    await restartTransferredWorkspace(root, JSON.parse(readFileSync(report, "utf8")));
  } else if (phase === "upgrade") {
    await verifyUpgrade(root, manifest, JSON.parse(readFileSync(report, "utf8")));
  } else {
    throw new Error("Use initial, restart, transfer, transfer-restart or upgrade for the installed smoke.");
  }
}
