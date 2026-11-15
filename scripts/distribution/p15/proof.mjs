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

function component(options, key) {
  const matches = options.filter(({ ref }) => ref.canonicalKey === key ||
    ref.canonicalKey.includes("." + key.replaceAll(".", "_") + "_"));
  assert.equal(matches.length, 1, key + " requires one exact Release pin.");
  return matches[0].ref;
}

async function stageCharacter(api) {
  const created = await send(api, "/api/characters", "POST", {
    name: "P15 Mid-Turn Character", rulesetReleaseId: manifest.demo.release,
  }, 201);
  const route = "/api/characters/" + created.id;
  const options = await get(api, route + "/creation-context");
  const pick = (ref) => {
    const { entityId, entityVersionId } = ref;
    return { entityId, entityVersionId };
  };
  const candidate = {
    ancestry: pick(options.ancestries.find((a) => a.displayName === "Orcani (test)").ref),
    ancestryStatChoices: [{ grantKey: "orcani_versatility", stat: "AGI" }, { grantKey: "orcani_versatility", stat: "PRO" }],
    statAllocations: { STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 },
    skills: [
      { skill: pick(options.skills.find((s) => s.displayName === "Athletics (test)").ref), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
      { skill: pick(component(options.skills, "skill.martial")), sourceKind: "FREE", sourceGrantKey: null },
      { skill: pick(component(options.skills, "skill.arcana")), sourceKind: "FREE", sourceGrantKey: null },
    ],
    primaryAffinity: pick(options.affinities.find((a) => a.displayName === "Evocation (test)").ref),
  };
  const saved = await send(api, route + "/creation", "PUT", { expectedLockVersion: created.lockVersion, candidate });
  await send(api, route + "/finalize", "POST", { expectedLockVersion: saved.lockVersion });
  console.log("Core Character creation completed.");
  const { spell } = await send(api, route + "/spells", "POST", { name: "P15 Steady Ward" }, 201);
  const spellRoute = route + "/spells/" + spell.id;
  const { catalog } = await get(api, spellRoute + "/builder");
  const draft = {
    ...spell.draft.draft,
    authority: "ARCANE_AUTHORITY",
    targeting: { definition: component(catalog.targeting, "spell.targeting.self"), parameters: {} },
    effects: [{ componentKey: "effect1", order: 1, definition: component(catalog.effects, "fixture.wo9.effect.maintenance"), parameters: { amount: 1 } }],
    duration: { definition: component(catalog.durations, "spell.duration.sustained"), parameters: {} },
  };
  const working = await send(api, spellRoute + "/draft", "PUT", { expectedVersion: spell.lockVersion, draft });
  assert.equal(working.spell.draft.evaluation.cost.finalMpCost, 4);
  const finalized = await send(api, spellRoute + "/finalize", "POST", { expectedVersion: working.spell.lockVersion });
  const { revisionId, revisionNumber } = finalized.spell.current;
  assert.equal(revisionNumber, 1);
  for (const event of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) {
    await commit(api, route, { kind: "TIMING", event });
  }
  const preCast = await capture(api, route);
  await commit(api, route, { kind: "SPELL", abilityId: spell.id, revisionNumber, targets: [{ targetKey: "self" }], inputs: [] });
  const midTurn = await capture(api, route);
  assert.equal(midTurn.release.id, manifest.demo.release);
  assert.equal(midTurn.release.releaseNumber, 1);
  assert.equal(midTurn.runtime.combat.turn, "ACTIVE");
  assert.equal(midTurn.runtime.combat.round, 1);
  assert.equal(mana(preCast) - mana(midTurn), 4);
  assert.equal(midTurn.events.length, 4);
  assert.ok(midTurn.events.every((event) => event.rulesetReleaseId === midTurn.release.id));
  const active = midTurn.activeMagic.state.effects.filter((effect) => effect.status === "ACTIVE");
  assert.equal(active.length, 1);
  assert.ok(active[0].sustain);
  assert.equal(active[0].ability.signatureAbilityId, spell.id);
  assert.equal(active[0].ability.revisionNumber, revisionNumber);
  return { route, midTurn, manaBeforeCast: mana(preCast), ward: { id: spell.id, revisionId, revisionNumber, paidMp: 4 } };
}

if (phase === "source") {
  const { gateway, api } = await setup(root, "demo", manifest);
  const fixture = await stageCharacter(api);
  const bytes = await backup(api);
  const id = fixture.midTurn.character.id;
  const sourceFingerprint = fingerprint(backupContents(bytes).tables, id);
  for (const table of ["character_play_runtimes", "character_play_events", "character_resource_states", "character_signature_spell_revisions"]) {
    const actualTable = sourceFingerprint.rows[table];
    assert.ok(actualTable, "Backup is missing Character records for " + table);
  }
  assert.deepEqual(await capture(api, fixture.route), fixture.midTurn, "Backup changed the live source Character.");
  write("source.json", { ...proof, ...fixture, workspace: safeWorkspace(), backupSha256: sha256(bytes), fingerprint: sourceFingerprint });
  writeFileSync(path.join(evidence, "p15.prowess-backup"), bytes);
  console.log("Source backed up the active R1 turn with its 4 MP sustained Ward and four committed events.");
  await (await gateway.control("quit")).text();
} else if (phase === "restore") {
  const source = read(path.join(input, "source.json"));
  assert.notEqual(proof.host.sha256, source.host.sha256, "The restore must run on a different Windows installation.");
  assert.equal(proof.installerSha256, source.installerSha256);
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
  throw new Error("Expected phase source, restore, or restart.");
}
