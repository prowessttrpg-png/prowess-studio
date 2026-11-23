import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Installed upgrade proof (RULES-WO1; reusable for later upgrades).
 *
 *   prepare  — run against the PREVIOUS installed application (the identified baseline build) before the upgrade:
 *              first run with the sample rules, an authored Ruleset published as its own Release, two completed
 *              Characters and a draft one, a prepared encounter (two sides, both completed Characters), and one
 *              Character stopped mid-turn in its Play Workspace (combat begun, its turn started, AP spent on a Move).
 *              Every identity and the relevant state is recorded, with the workspace's own rows.
 *   verify   — run against the CANDIDATE after it was installed over the previous one and started (the launcher's
 *              supported upgrade: recovery backup, staged copy, migrations). The Release pins and manifests, every
 *              Character, the encounter and its participation, the resources, the active turn and every play event
 *              are preserved (recorded fields equal; recorded rows still present with every recorded column equal),
 *              then play continues: another Move is committed in the same turn and the encounter takes a new command.
 *   restart  — after the candidate is restarted: the preserved state and the two continued actions are all still there.
 *
 * The comparisons are by recorded fields and by recorded columns, so a later version may ADD fields and columns, but
 * may not lose or change what the previous version stored. Nothing here restores a backup: the backup / restore proof
 * stays a separate test in the installed smoke.
 */
const json = { "content-type": "application/json" };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
/** Tables whose rows the upgrade must keep (their recorded columns unchanged), with each table's primary key. */
export const PRESERVED_KEYS = Object.freeze({
  rulesets: ["id"], ruleset_manifests: ["id"], ruleset_manifest_entries: ["id"], ruleset_releases: ["id"],
  characters: ["id"], character_play_states: ["character_id"], character_resource_states: ["character_id", "resource_key"],
  character_play_runtimes: ["character_id"], character_play_events: ["id"],
  encounters: ["id"], encounter_sides: ["id"], encounter_participants: ["id"], encounter_events: ["id"],
});
export const PRESERVED_TABLES = Object.freeze(Object.keys(PRESERVED_KEYS));

/** `after` keeps everything `before` recorded: equal scalars, the same array lengths, and every recorded key. */
export function assertPreserved(before, after, where) {
  if (Array.isArray(before)) {
    assert(Array.isArray(after), `${where} is no longer a list`);
    assert.equal(after.length, before.length, `${where} has ${after.length} entries, expected ${before.length}`);
    before.forEach((value, index) => assertPreserved(value, after[index], `${where}[${index}]`));
  } else if (before !== null && typeof before === "object") {
    assert(after !== null && typeof after === "object" && !Array.isArray(after), `${where} is no longer an object`);
    for (const key of Object.keys(before)) {
      assert(Object.hasOwn(after, key), `${where}.${key} is missing after the upgrade`);
      assertPreserved(before[key], after[key], `${where}.${key}`);
    }
  } else {
    assert.deepEqual(after, before, `${where} changed`);
  }
}

/** Every recorded row is still present (by id) with each recorded column equal. Returns the row counts. */
export function assertRowsPreserved(before, after) {
  const counts = {};
  for (const table of PRESERVED_TABLES) {
    const rows = before[table] ?? [];
    const keyOf = (row) => PRESERVED_KEYS[table].map((column) => { assert(row[column] !== undefined, `${table} rows carry ${column}`); return String(row[column]); }).join("|");
    const now = new Map((after[table] ?? []).map((text) => { const row = JSON.parse(text); return [keyOf(row), row]; }));
    for (const text of rows) {
      const row = JSON.parse(text);
      const key = keyOf(row);
      assert(now.has(key), `${table} row ${key} is missing after the upgrade`);
      assertPreserved(row, now.get(key), `${table}(${key})`);
    }
    counts[table] = rows.length;
  }
  return counts;
}

const data = async (response) => (await response.json()).data;

/** Reads everything the proof compares, through the application's own routes. */
export async function readState(api, ids) {
  const out = { releases: {}, characters: {}, sheets: {}, play: {}, events: {} };
  for (const id of ids.releases) {
    out.releases[id] = await data(await api(`/api/ruleset-releases/${id}`));
    const verified = await data(await api(`/api/ruleset-releases/${id}/verify-manifest-hash`));
    assert.equal(verified.valid, true, `Release ${id}'s manifest hash verifies`);
    out.releases[id].manifestHash = verified.storedHash;
  }
  for (const id of ids.characters) out.characters[id] = await data(await api(`/api/characters/${id}`));
  for (const id of ids.completed) {
    out.sheets[id] = await data(await api(`/api/characters/${id}/sheet`));
    const play = await data(await api(`/api/characters/${id}/play`));
    out.play[id] = { versions: play.versions, release: play.release, resources: play.workspace.resources, runtime: play.workspace.runtime };
    out.events[id] = (await data(await api(`/api/characters/${id}/play/events?limit=200`))).events;
  }
  const encounter = await data(await api(`/api/encounters/${ids.encounter}`));
  out.encounter = { id: encounter.id, name: encounter.name, notes: encounter.notes, status: encounter.status, version: encounter.version,
    release: encounter.release, sides: encounter.sides, participants: encounter.participants };
  out.encounterEvents = await data(await api(`/api/encounters/${ids.encounter}/events`));
  return out;
}

async function playCommit(api, characterId, operation) {
  const { versions } = await data(await api(`/api/characters/${characterId}/play`));
  const result = await data(await api(`/api/characters/${characterId}/play/operations`, { method: "POST", headers: json, body: JSON.stringify({
    operation, idempotencyKey: randomUUID(), expectedRuntimeVersion: versions.runtimeVersion, expectedPlayStateVersion: versions.playStateVersion,
  }) }));
  assert.equal(result.committed, true, `${operation.kind} ${operation.event ?? operation.actionKey ?? ""} was not committed: ${JSON.stringify(result).slice(0, 400)}`);
  return result;
}

async function encounterCommand(api, encounterId, command, status = 200) {
  const { version } = await data(await api(`/api/encounters/${encounterId}`));
  return (await data(await api(`/api/encounters/${encounterId}/commands`, { method: "POST", headers: json,
    body: JSON.stringify({ command, expectedVersion: version, idempotencyKey: randomUUID() }) }, status))).encounter;
}

const apOf = (play) => play.resources.find((r) => r.resourceKey === "AP")?.current;

/** Builds the representative workspace with the PREVIOUS application. `snapshot()` returns the workspace rows. */
export async function prepareUpgradeState(api, { sampleReleaseId, snapshot, label = "Upgrade proof" }) {
  // 1. A locally authored Ruleset, published as its own Release (beside the sample rules' Release).
  const unique = randomUUID().slice(0, 8);
  // Creating routes answer 201, transitions 200 (each request is sent once).
  const post = async (route, body, status = 201) => data(await api(route, { method: "POST", headers: json, body: JSON.stringify(body ?? {}) }, status));
  const ruleset = await post("/api/rulesets", { canonicalKey: `test.upgrade_${unique}`, name: `${label} rules ${unique}`, channel: "CORE_PLAYTEST" });
  await post(`/api/rulesets/${ruleset.id}/submit-review`, {}, 200);
  await post(`/api/rulesets/${ruleset.id}/approve`, {}, 200);
  const entity = await post("/api/entities", { entityType: "GENERIC_RULE", canonicalKey: `test.upgrade_rule_${unique}` });
  const version = await post(`/api/entities/${entity.id}/versions`, { displayName: `${label} rule é` });
  await post(`/api/entity-versions/${version.id}/status`, { status: "IN_REVIEW" }, 200);
  await post(`/api/entity-versions/${version.id}/status`, { status: "APPROVED" }, 200);
  const manifest = await post(`/api/rulesets/${ruleset.id}/manifests`, { entries: [{ entityId: entity.id, entityVersionId: version.id }] });
  const policy = await post(`/api/rulesets/${ruleset.id}/canon-policies`, { name: `${label} policy`, authorities: [] });
  const authored = await post(`/api/rulesets/${ruleset.id}/releases`, { baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "1.0.0" });

  // 2. Characters on the sample rules' Release: two completed (from its own creation context) and one draft.
  const complete = async (name) => {
    const created = await post("/api/characters", { name, concept: null, rulesetReleaseId: sampleReleaseId });
    const context = await data(await api(`/api/characters/${created.id}/creation-context`));
    const pick = (options, key) => {
      // The sample rules keep the fixture's key, possibly namespaced (`<namespace>.<key with "_" for ".">_<suffix>`).
      const flat = key.replace(/\./g, "_");
      const option = options.find((o) => o.ref.canonicalKey === key || o.ref.canonicalKey.endsWith("." + key) || o.ref.canonicalKey.includes("." + flat + "_"));
      assert(option, `The sample rules offer ${key}`);
      return { entityId: option.ref.entityId, entityVersionId: option.ref.entityVersionId };
    };
    const saved = await data(await api(`/api/characters/${created.id}/creation`, { method: "PUT", headers: json, body: JSON.stringify({
      expectedLockVersion: created.lockVersion,
      candidate: {
        ancestry: pick(context.ancestries, "test.m6wo3.ancestry.orcani"),
        ancestryStatChoices: [{ grantKey: "orcani_versatility", stat: "AGI" }, { grantKey: "orcani_versatility", stat: "PRO" }],
        statAllocations: { STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 },
        skills: [
          { skill: pick(context.skills, "test.m6wo3.skill.athletics"), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
          { skill: pick(context.skills, "test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null },
          { skill: pick(context.skills, "test.m6wo3.skill.arcana"), sourceKind: "FREE", sourceGrantKey: null },
        ],
        primaryAffinity: pick(context.affinities, "affinity.evocation"),
      },
    }) }));
    return (await post(`/api/characters/${created.id}/finalize`, { expectedLockVersion: saved.lockVersion }, 200)).id;
  };
  const alpha = await complete(`${label} Alpha é`);
  const beta = await complete(`${label} Beta`);
  const draft = (await post("/api/characters", { name: `${label} Draft`, concept: null, rulesetReleaseId: sampleReleaseId })).id;

  // 3. A prepared encounter: two sides, both completed Characters.
  const encounter = (await post("/api/encounters", { name: `${label}: Bridge é`, notes: "Kept across the upgrade", rulesetReleaseId: sampleReleaseId, idempotencyKey: randomUUID() })).encounter;
  const heroes = (await encounterCommand(api, encounter.id, { kind: "ADD_SIDE", name: "Heroes" })).sides[0];
  const raiders = (await encounterCommand(api, encounter.id, { kind: "ADD_SIDE", name: "Raiders" })).sides[1];
  await encounterCommand(api, encounter.id, { kind: "ADD_PARTICIPANT", characterId: alpha, sideId: heroes.id });
  await encounterCommand(api, encounter.id, { kind: "ADD_PARTICIPANT", characterId: beta, sideId: raiders.id });

  // 4. Saved mid-turn play state: Beta's combat has begun, its turn has started, and a Move has spent AP.
  for (const event of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await playCommit(api, beta, { kind: "TIMING", event });
  const full = apOf((await data(await api(`/api/characters/${beta}/play`))).workspace);
  await playCommit(api, beta, { kind: "GENERAL_ACTION", actionKey: "MOVE" });
  const moved = apOf((await data(await api(`/api/characters/${beta}/play`))).workspace);
  assert.equal(moved, full - 1, "the Move spent 1 AP before the upgrade");

  const ids = { releases: [sampleReleaseId, authored.id], characters: [alpha, beta, draft], completed: [alpha, beta], encounter: encounter.id,
    midTurn: beta, authoredRuleset: ruleset.id };
  const state = await readState(api, ids);
  assert.equal(state.events[beta].length, 4, "four play events recorded before the upgrade");
  assert.equal(state.encounter.participants.length, 2);
  const rows = await snapshot();
  return { format: 1, ids, apBeforeUpgrade: moved, state, rows, rowsSha256: sha256(JSON.stringify(rows)) };
}

/** After the candidate replaced the previous application: everything recorded is preserved, then play continues. */
export async function verifyUpgradedState(api, record, { snapshot }) {
  const { ids } = record;
  const state = await readState(api, ids);
  assertPreserved(record.state, state, "state");
  const rows = assertRowsPreserved(record.rows, await snapshot());
  const beta = ids.midTurn;
  assert.equal(apOf(state.play[beta]), record.apBeforeUpgrade, "the active turn's AP is unchanged");
  // Play continues in the same turn, through the candidate's own rules.
  await playCommit(api, beta, { kind: "GENERAL_ACTION", actionKey: "MOVE" });
  const after = await data(await api(`/api/characters/${beta}/play`));
  assert.equal(apOf(after.workspace), record.apBeforeUpgrade - 1, "a Move after the upgrade spends 1 more AP in the same turn");
  const events = (await data(await api(`/api/characters/${beta}/play/events?limit=200`))).events;
  assert.equal(events.length, record.state.events[beta].length + 1, "one new play event after the upgrade");
  assertPreserved(record.state.events[beta], events.slice(1), "earlier play events");
  const encounter = await encounterCommand(api, ids.encounter, { kind: "ADD_SIDE", name: "Upgraded side" });
  assert.equal(encounter.version, record.state.encounter.version + 1, "the encounter takes a new command after the upgrade");
  return { preservedRows: rows, continued: { ap: apOf(after.workspace), playEvents: events.length, encounterVersion: encounter.version }, rowsAfterContinuing: await snapshot() };
}

/** After a restart: the preserved state is unchanged apart from the two continued actions, which are kept. */
export async function verifyAfterRestart(api, record, { continued, rowsAfterContinuing }, { snapshot }) {
  const { ids } = record;
  const state = await readState(api, ids);
  const rows = assertRowsPreserved(rowsAfterContinuing, await snapshot());
  const beta = ids.midTurn;
  assert.equal(apOf(state.play[beta]), continued.ap, "the continued turn's AP survives the restart");
  assert.equal(state.events[beta].length, continued.playEvents, "the continued play event survives the restart");
  assert.equal(state.encounter.version, continued.encounterVersion, "the continued encounter command survives the restart");
  for (const id of ids.characters) assertPreserved(record.state.characters[id], state.characters[id], `characters.${id}`);
  for (const id of ids.releases) assertPreserved(record.state.releases[id], state.releases[id], `releases.${id}`);
  return { restarted: true, preservedRows: rows };
}

// ---- Installed application (the desktop gateway) ----------------------------------------------------------------------

const prefix = "/__prowess_desktop";
async function installed(root) {
  const { connect, waitFor } = await import("./installed-smoke.mjs");
  const gateway = await connect(root);
  const api = await gateway.browser();
  return { gateway, api, waitFor };
}
const backupTables = async (api) => {
  const envelope = JSON.parse(Buffer.from(await (await api(prefix + "/backup")).arrayBuffer()).toString("utf8"));
  assert.equal(sha256(envelope.payload), envelope.sha256);
  return Object.fromEntries(JSON.parse(envelope.payload).tables.filter(({ table }) => PRESERVED_TABLES.includes(table)).map(({ table, rows }) => [table, rows.slice().sort()]));
};
const workspaceState = (root) => JSON.parse(readFileSync(path.join(root, "workspace.json"), "utf8"));

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [phase, root, manifestPath, report, result] = process.argv.slice(2);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { gateway, api, waitFor } = await installed(root);
  const snapshot = () => backupTables(api);
  if (phase === "prepare") {
    await waitFor(async () => (await (await api(prefix + "/status")).json()).firstRun, "the previous build's first-run choices");
    await (await api(prefix + "/setup", { method: "POST", body: "demo" })).text();
    await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "the previous build's readiness");
    const diagnostics = await (await api(prefix + "/diagnostics")).json();
    assert.equal(diagnostics.commit, manifest.build.commit, "the running previous application is the identified baseline");
    assert.equal(diagnostics.tree, manifest.build.tree);
    const record = await prepareUpgradeState(api, { sampleReleaseId: manifest.demo.release, snapshot });
    record.previous = { appVersion: manifest.appVersion, build: manifest.build, packageSha256: manifest.packageSha256, migrations: manifest.migrations.length, workspace: workspaceState(root) };
    writeFileSync(report, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  } else if (phase === "verify") {
    const record = JSON.parse(readFileSync(report, "utf8"));
    await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "the upgraded workspace");
    const ws = workspaceState(root);
    assert.equal(ws.appVersion, manifest.appVersion, "the workspace now records the candidate's version");
    assert.deepEqual(ws.migrations, manifest.migrations);
    assert.equal(ws.setup, record.previous.workspace.setup);
    assert.notEqual(record.previous.appVersion, manifest.appVersion, "the baseline and the candidate are different versions");
    assert(!existsSync(path.join(root, "upgrade.json")), "the upgrade journal was completed");
    const recovery = readdirSync(root, { recursive: true }).map(String).filter((f) => /before-upgrade/i.test(f));
    assert(recovery.length > 0, "the launcher kept a recovery backup before upgrading");
    const diagnostics = await (await api(prefix + "/diagnostics")).json();
    assert.equal(diagnostics.commit, manifest.build.commit);
    const outcome = await verifyUpgradedState(api, record, { snapshot });
    writeFileSync(result, JSON.stringify({ format: 1, from: record.previous.build, to: manifest.build, appVersions: [record.previous.appVersion, manifest.appVersion], recoveryBackups: recovery.length, ...outcome }, null, 2) + "\n", { flag: "wx" });
  } else if (phase === "restart") {
    const record = JSON.parse(readFileSync(report, "utf8"));
    const outcome = JSON.parse(readFileSync(result, "utf8"));
    await waitFor(async () => (await (await api(prefix + "/status")).json()).ready, "the restarted upgraded workspace");
    await verifyAfterRestart(api, record, outcome, { snapshot });
  } else {
    throw new Error("Use prepare, verify or restart for the installed upgrade proof.");
  }
  await (await gateway.control("quit")).text();
}
