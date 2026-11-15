import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { connect, setup, waitFor, workspace } from "./installed-smoke.mjs";

const prefix = "/__prowess_desktop";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const data = async (api, route, options, status) => (await (await api(route, options, status)).json()).data;
const record = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });

function characterRows(tables, id) {
  const byName = new Map(tables.map(({ table, rows }) => [table, rows.map((row) => ({ row, fields: JSON.parse(row) }))]));
  const character = byName.get("characters").find(({ fields }) => fields.id === id)?.fields;
  assert.ok(character, "The playtest Character is present.");
  const ids = (table) => new Set(byName.get(table).filter(({ fields }) => fields.character_id === id).map(({ fields }) => fields.id));
  const abilities = ids("character_signature_abilities");
  const advancements = ids("character_advancements");
  const release = byName.get("ruleset_releases").find(({ fields }) => fields.id === character.ruleset_release_id)?.fields;
  assert.ok(release, "The Character has an exact Release.");
  const selected = {};
  for (const [table, rows] of byName) {
    const entries = rows.filter(({ fields }) => table === "characters" ? fields.id === id
      : table === "ruleset_releases" ? fields.id === release.id
      : table === "ruleset_manifests" ? fields.id === release.manifest_id
      : table === "ruleset_manifest_entries" ? fields.manifest_id === release.manifest_id
      : table.startsWith("character_") &&
        (fields.character_id === id || abilities.has(fields.ability_id) || advancements.has(fields.advancement_id)));
    if (entries.length) selected[table] = entries.map(({ row }) => row).sort();
  }
  return { character, selected, release };
}

export function fingerprint(tables, id) {
  const { character, selected, release } = characterRows(tables, id);
  return {
    characterId: character.id, releaseId: release.id, releaseManifestHash: release.manifest_hash,
    rows: Object.fromEntries(Object.entries(selected).sort().map(([table, rows]) => [table, rows.length])),
    sha256: sha256(JSON.stringify(Object.entries(selected).sort())),
  };
}

export function backupContents(bytes) {
  const envelope = JSON.parse(bytes.toString("utf8"));
  assert.equal(envelope.format, "prowess-workspace-1");
  assert.equal(sha256(envelope.payload), envelope.sha256);
  return JSON.parse(envelope.payload);
}

export function activeCharacter({ tables }) {
  const runtimes = tables.find((entry) => entry.table === "character_play_runtimes").rows.map(JSON.parse);
  const active = runtimes.filter((row) => row.state?.combat?.turn === "ACTIVE" &&
    row.state.activeMagic?.effects?.some((effect) => effect.status === "ACTIVE"));
  assert.equal(active.length, 1, "Leave exactly one sample Character in an active turn with Active Magic before exporting the backup.");
  const id = active[0].character_id;
  const result = fingerprint(tables, id);
  for (const table of ["character_portrait_images", "character_signature_spell_revisions", "character_signature_maneuver_revisions",
    "character_play_events", "character_weapon_loadouts"]) {
    assert.ok(result.rows[table], "The playtest backup is missing " + table + ".");
  }
  return id;
}

async function databaseSnapshot(root, stage, manifest, id) {
  const state = workspace(root);
  const metadata = readFileSync(path.join(root, "cluster", "postmaster.pid"), "utf8").split(/\r?\n/);
  assert.match(metadata[0], /^\d+$/);
  assert.equal(realpathSync(metadata[1]), realpathSync(path.join(root, "cluster")));
  const port = Number(metadata[3]);
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const pg = path.resolve(stage, manifest.desktopClient);
  const { Client } = createRequire(pg)(pg);
  const client = new Client({
    host: "127.0.0.1", port, user: "prowess_local", password: state.password,
    database: state.active, connectionTimeoutMillis: 5000, statement_timeout: 10_000,
  });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = [];
    for (const table of manifest.desktopTables) {
      if (table !== "characters" && !table.startsWith("character_") &&
          !["ruleset_releases", "ruleset_manifests", "ruleset_manifest_entries"].includes(table)) continue;
      assert.match(table, /^[a-z_]+$/);
      const { rows } = await client.query(`SELECT row_to_json(t)::text AS record FROM public."${table}" t`);
      tables.push({ table, rows: rows.map((row) => row.record) });
    }
    await client.query("COMMIT");
    return { fingerprint: fingerprint(tables, id), postgresPort: port };
  } finally { await client.end(); }
}

async function checkBinding(gateway, postgresPort) {
  const external = Object.values(networkInterfaces()).flat().filter((entry) =>
    entry && !entry.internal && entry.family === "IPv4").map((entry) => entry.address);
  for (const host of external) {
    for (const port of [Number(new URL(gateway.origin).port), postgresPort]) {
      const connected = await new Promise((resolve) => {
        const socket = net.connect({ host, port });
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", () => resolve(false));
        socket.setTimeout(3000, () => { socket.destroy(); resolve(false); });
      });
      assert.equal(connected, false, "A non-loopback interface accepted a connection.");
    }
  }
  return external.length;
}

async function readCharacter(api, id) {
  const route = "/api/characters/" + id;
  return { character: await data(api, route), play: await data(api, route + "/play") };
}

async function verify(root, stage, manifest, api, baseline) {
  const current = await readCharacter(api, baseline.fingerprint.characterId);
  assert.equal(sha256(JSON.stringify(current)), baseline.apiSha256, "Character and Play Workspace API results changed.");
  const { fingerprint: currentFingerprint } = await databaseSnapshot(root, stage, manifest, baseline.fingerprint.characterId);
  assert.deepEqual(currentFingerprint, baseline.fingerprint);
  return current.character;
}

function modifiedBackup(payload, change) {
  const next = structuredClone(payload);
  change(next);
  const bytes = JSON.stringify(next);
  return JSON.stringify({ format: "prowess-workspace-1", sha256: sha256(bytes), payload: bytes });
}

async function execute(phase, root, stage, evidence, input) {
  const manifest = JSON.parse(readFileSync(path.join(stage, "prototype.json"), "utf8"));
  const baselineFile = path.join(evidence, "workspace-baseline.json");
  if (phase === "baseline") {
    const bytes = readFileSync(input);
    const contents = backupContents(bytes);
    const id = activeCharacter(contents);
    const { gateway, api, startupMilliseconds } = await setup(root, "empty", manifest);
    const empty = await data(api, "/api/rulesets");
    assert.deepEqual(empty, [], "An empty workspace contains no Rulesets.");
    const restore = (session, body) => session(prefix + "/restore", { method: "POST", body });
    assert.match(await (await restore(api, bytes)).text(), /^Workspace restored/);
    await (await api("/api/characters", { method: "POST" }, 401)).text();
    const session = await gateway.browser();
    const first = await databaseSnapshot(root, stage, manifest, id);
    assert.deepEqual(first.fingerprint, fingerprint(contents.tables, id));
    const current = await readCharacter(session, id);
    assert.equal(current.character.release.id, first.fingerprint.releaseId);
    const baseline = { fingerprint: first.fingerprint, apiSha256: sha256(JSON.stringify(current)), backupSha256: sha256(bytes),
      startupMilliseconds, externalIpv4InterfacesChecked: await checkBinding(gateway, first.postgresPort),
      depth: "mid-turn with portrait, Spell, Maneuver and play history" };
    const db = workspace(root).active;
    const invalid = [
      bytes.subarray(0, 10),
      modifiedBackup(contents, (next) => { next.postgresMajor = 99; }),
      modifiedBackup(contents, (next) => { next.tables.push({ table: "executable_sql", columns: ["sql"], rows: ["CREATE FUNCTION"] }); }),
      modifiedBackup(contents, (next) => {
        const characters = next.tables.find((entry) => entry.table === "characters");
        const index = characters.rows.findIndex((row) => JSON.parse(row).id === id);
        characters.rows[index] = JSON.stringify({ ...JSON.parse(characters.rows[index]), ruleset_release_id: "00000000-0000-0000-0000-000000000000" });
      }),
    ];
    for (const body of invalid) {
      assert.match(await (await restore(session, body)).text(), /^Restore failed/);
      assert.equal(workspace(root).active, db);
      await verify(root, stage, manifest, session, baseline);
    }
    const second = await gateway.browser();
    await verify(root, stage, manifest, second, baseline);
    record(baselineFile, baseline);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const phases = ["failure", "still-old", "duplicate", "upgrade", "reinstall", "after-reboot", "after-launcher-crash"];
  assert.ok(phases.includes(phase), "Unknown lifecycle phase.");
  const gateway = await connect(root);
  const api = await gateway.browser();
  if (phase === "failure") {
    await waitFor(async () => {
      const status = await (await api(prefix + "/status")).json();
      return !status.ready && /workspace schema check failed/i.test(status.message);
    }, "an explicit upgrade failure");
    const journal = JSON.parse(readFileSync(path.join(root, "upgrade.json"), "utf8"));
    const state = workspace(root);
    assert.equal(state.active, journal.previous);
    assert.equal(state.appVersion, journal.from);
    assert.notEqual(journal.previous, journal.staged);
    const recovery = backupContents(readFileSync(path.join(root, "recovery", path.basename(journal.backup))));
    assert.deepEqual(fingerprint(recovery.tables, baseline.fingerprint.characterId), baseline.fingerprint);
    record(path.join(evidence, "failed-upgrade.json"), { from: journal.from, to: journal.to, fingerprint: baseline.fingerprint });
    return;
  }

  await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "database-backed readiness");
  assert.equal(workspace(root).appVersion, manifest.appVersion);
  const character = await verify(root, stage, manifest, api, baseline);
  if (phase === "upgrade") {
    const creation = await data(api, "/api/characters", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "DIST-WO1 post-upgrade test", rulesetReleaseId: character.release.id }),
    }, 201);
    assert.notEqual(creation.id, character.id);
    assert.equal(creation.release.id, character.release.id);
    record(path.join(evidence, "post-upgrade-character.json"), { id: creation.id, release: creation.release.id });
  }
  if (phase === "reinstall" || phase === "after-reboot") {
    const created = JSON.parse(readFileSync(path.join(evidence, "post-upgrade-character.json"), "utf8"));
    const saved = await data(api, "/api/characters/" + created.id);
    assert.equal(saved.id, created.id);
    assert.equal(saved.release.id, created.release);
  }
  record(path.join(evidence, phase + ".json"), { version: manifest.appVersion, fingerprint: baseline.fingerprint });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [phase, root, stage, evidence, input] = process.argv.slice(2);
  if (phase === "check-backup") {
    const bytes = readFileSync(input);
    const contents = backupContents(bytes);
    activeCharacter(contents);
    assert.equal(contents.appVersion, "0.1.0", "Export this fixture from the verified 0.1.0 installer.");
  } else {
    await execute(phase, root, stage, evidence, input);
  }
}
