import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [phase, root, artifact, evidence, input, runDocument] = process.argv.slice(2);
const { connect, setup, waitFor, workspace } = await import(pathToFileURL(path.join(artifact, "installed-smoke.mjs")));
const { backupContents, fingerprint } = await import(pathToFileURL(path.join(artifact, "installed-lifecycle.mjs")));
const read = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const write = (name, value) => writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const proof = read(runDocument);
const manifest = read(path.join(artifact, "prototype.json"));
const prefix = "/__prowess_desktop";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeWorkspace = () => {
  const { id, active, setup } = workspace(root);
  assert.ok(id && active);
  return { id, active, setup };
};
const get = async (api, route) => (await (await api(route)).json()).data;
const send = async (api, route, method, body, status = 200) => (
  await (await api(route, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }, status)).json()
).data;
const resource = (state, key) => {
  const value = state.resources.find((r) => r.resourceKey === key)?.current;
  assert.equal(typeof value, "number", key + " must have a numeric current amount.");
  return value;
};
const mana = (state) => resource(state, "ME") + resource(state, "MP");
const capture = async (api, route) => {
  const view = await get(api, route + "/play");
  const exact = await get(api, "/api/ruleset-releases/" + view.release.id);
  const { id, rulesetId, releaseNumber, versionLabel, manifestId, manifestHash } = exact;
  assert.match(manifestHash, /^[a-f0-9]{64}$/);
  const { runtime, resources, activeMagic } = view.workspace;
  const { events } = await get(api, route + "/play/events?limit=200");
  return { character: view.character, release: { id, rulesetId, releaseNumber, versionLabel, manifestId, manifestHash },
    versions: view.versions, runtime, resources, activeMagic, events };
};
const backup = async (api) => Buffer.from(await (await api(prefix + "/backup")).arrayBuffer());

async function commit(api, route, operation) {
  const { versions } = await get(api, route + "/play");
  const result = await send(api, route + "/play/operations", "POST", {
    operation, idempotencyKey: randomUUID(),
    expectedRuntimeVersion: versions.runtimeVersion, expectedPlayStateVersion: versions.playStateVersion,
  });
  assert.equal(result.committed, true, JSON.stringify(result));
  assert.equal(result.replayed, false);
  return result;
}

if (phase === "restore") {
  const source = read(path.join(input, "source.json"));
  assert.notEqual(proof.host.sha256, source.host.sha256, "The restore must run on a different Windows installation.");
  assert.equal(source.ciRunId, 43767082829);
  assert.equal(source.ciArtifactId, 14183350774);
  assert.equal(source.installerSha256, "d48f37648263c269ad2ce94a0b3e4334eb109b5e3e72254e796bc477c4a939c3");
  assert.equal(proof.ciRunId, 43777171367);
  assert.notEqual(proof.installerSha256, source.installerSha256);
  const bytes = readFileSync(path.join(input, "p15.prowess-backup"));
  assert.equal(sha256(bytes), source.backupSha256);
  const { gateway, api } = await setup(root, "empty", manifest);
  const before = safeWorkspace();
  assert.notEqual(before.id, source.workspace.id);
  const empty = { characters: await get(api, "/api/characters"), rulesets: await get(api, "/api/rulesets") };
  assert.deepEqual(empty, { characters: [], rulesets: [] });
  const restored = await api(prefix + "/restore", { method: "POST", body: bytes });
  assert.match(await restored.text(), /^Workspace restored/);
  const session = await gateway.browser();
  const after = safeWorkspace();
  assert.equal(after.id, before.id);
  assert.notEqual(after.active, before.active);
  const snapshot = await capture(session, source.route);
  assert.deepEqual(snapshot, source.midTurn, "Live Character state changed on restore.");
  const restoredFingerprint = fingerprint(backupContents(await backup(session)).tables, source.midTurn.character.id);
  assert.deepEqual(restoredFingerprint, source.fingerprint, "Restored database rows differ.");
  write("restore.json", { ...proof, empty, before, after, snapshot, fingerprint: restoredFingerprint, backupSha256: source.backupSha256 });
  console.log("Fresh receiving Windows installation restored the exact Character and Character records.");
  await (await gateway.control("quit")).text();
} else if (phase === "restart") {
  const source = read(path.join(input, "source.json"));
  const restored = read(path.join(evidence, "restore.json"));
  assert.notEqual(proof.launcherPid, restored.launcherPid);
  assert.deepEqual(proof.host, restored.host);
  const gateway = await connect(root);
  const api = await gateway.browser();
  await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "restored Studio to restart");
  assert.deepEqual(safeWorkspace(), restored.after);
  const snapshot = await capture(api, source.route);
  assert.deepEqual(snapshot, source.midTurn, "Restart changed the restored live Character state.");
  const restartedFingerprint = fingerprint(backupContents(await backup(api)).tables, source.midTurn.character.id);
  assert.deepEqual(restartedFingerprint, source.fingerprint, "Restart changed the restored Character rows.");
  const move = await commit(api, source.route, { kind: "GENERAL_ACTION", actionKey: "MOVE" });
  const continued = await capture(api, source.route);
  assert.deepEqual(continued.release, snapshot.release);
  assert.deepEqual(continued.runtime.combat, snapshot.runtime.combat);
  assert.deepEqual(continued.activeMagic, snapshot.activeMagic);
  assert.equal(mana(continued), mana(snapshot));
  assert.equal(resource(continued, "AP"), resource(snapshot, "AP") - 1);
  assert.ok(resource(continued, "MOVEMENT_ALLOWANCE") > resource(snapshot, "MOVEMENT_ALLOWANCE"));
  assert.deepEqual(continued.events.slice(1), snapshot.events);
  assert.deepEqual(continued.events[0], move.event);
  assert.equal(move.event.sequence, snapshot.events[0].sequence + 1);
  assert.equal(move.event.classification, "RULES_EXECUTED");
  assert.equal(move.event.rulesetReleaseId, snapshot.release.id);
  write("restart-and-play.json", { ...proof, result: "passed", snapshot, fingerprint: restartedFingerprint, continued, moveEvent: move.event });
  console.log("After native restart, the same turn continued. Move spent 1 AP, granted movement, kept the Ward active and appended one event.");
  await (await gateway.control("quit")).text();
} else {
  throw new Error("Expected phase restore or restart.");
}
