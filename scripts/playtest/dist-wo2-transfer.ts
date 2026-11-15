import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  approveChangeSet, assertRunningAgainstTestDatabase, commitCharacterPlayOperation, createAuthoredRevision,
  createCharacterSignatureManeuver, createCharacterSignatureSpell, exportContentPack, finalizeCharacterSignatureManeuver,
  finalizeCharacterSignatureSpell, getCharacterPlayWorkspace, getCharacterSignatureSpell, getRulesetRelease, installContentPack,
  materializeProwessDefinitionsFromRelease, previewContentPack, prisma, proposeDefinitionChangeSet, publishRulesetRelease,
  readContentPack, submitAuthoredRevisionForReview, submitChangeSetForReview, transitionEntityVersionStatus,
  updateAuthoredDraftDefinition, updateCharacterSignatureManeuverDraft, updateCharacterSignatureSpellDraft,
} from "../../packages/prowess-db/src/index";
import { refOf, type CharacterReleaseWorld, type Pin } from "../../packages/prowess-db/tests/fixtures/m6-wo3-character-release";
import { maneuverDraft, martialCharacter, spellDraft } from "../../packages/prowess-db/tests/fixtures/m6-wo8-maneuvers";
import { fingerprint, preparePlaytestRelease, REVISED_CONTENT_KEY, runPrefix } from "../../packages/prowess-db/tests/fixtures/m6-wo12-playtest";
import { TEST_ANCESTRY_KEY } from "../../packages/prowess-game/src/testing/character-fixtures";

const [role, runId, directory] = process.argv.slice(2);
assert(role && runId && directory, "Usage: dist-wo2-transfer.ts source|receiver|clean-receiver <run-id> <pack-directory>");
assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
const pack = (release: 1 | 2) => path.join(directory, `R${release}.prowesspack`);
const prefix = runPrefix(runId);

async function source() {
  assert.equal(await prisma.rulesetRelease.count(), 0, "Use a fresh disposable source database");
  const { world } = await preparePlaytestRelease(runId!);
  await mkdir(directory!, { recursive: true });
  const producerId = randomUUID();
  const exportPack = async (id: string, number: 1 | 2, wardVersionId: string) => {
    const before = await fingerprint(null, world.rulesetId);
    const options = { producerId, label: `Distribution proof R${number}`, provenance: { claimedCreator: "Prowess playtest", category: "sample" as const } };
    const bytes = await exportContentPack(id, options);
    assert.deepEqual(await exportContentPack(id, options), bytes);
    assert.equal(await fingerprint(null, world.rulesetId), before);
    assert(!bytes.includes(Buffer.from("DIST-WO2 PRIVATE DRAFT MARKER")));
    await writeFile(pack(number), bytes, { flag: "wx" });
    const { manifest, archiveSha256 } = readContentPack(bytes);
    console.log(JSON.stringify({
      stage: "export", number, bytes: bytes.length, archiveSha256, contentDigest: manifest.contentDigest,
      release: manifest.release, wardVersionId,
    }));
  };
  const base = world.pins.get(REVISED_CONTENT_KEY)!;
  const privateSource = await prisma.sourceDocument.create({ data: {
    title: "Playtest source", sourceType: "DOCUMENT", fileReference: "DIST-WO2 PRIVATE DRAFT MARKER",
    notes: "DIST-WO2 PRIVATE DRAFT MARKER",
  } });
  await prisma.sourceReference.create({ data: {
    sourceDocumentId: privateSource.id, entityVersionId: base.entityVersionId, sectionLabel: "Ward",
    sourceExcerptNote: "DIST-WO2 PRIVATE DRAFT MARKER",
  } });
  const draft = await createAuthoredRevision(base.entityId, {
    baseVersionId: base.entityVersionId, changeType: "MECHANICAL_CHANGE", changeSummary: "DIST-WO2 PRIVATE DRAFT MARKER",
  });
  await exportPack(world.release.id, 1, base.entityVersionId);
  // Publish a different approved revision of the same effect. The private Draft remains outside either closure.
  const revision = await createAuthoredRevision(base.entityId, {
    baseVersionId: base.entityVersionId, changeType: "MECHANICAL_CHANGE", changeSummary: "Playtest: 3 MP",
  });
  assert.notEqual(revision.id, draft.id);
  const stored = structuredClone((revision.structuredData as { prowessDefinition: { payload: { costContributions: Array<{ data: { amount: number } }> } } }).prowessDefinition);
  assert.equal(stored.payload.costContributions[0]!.data.amount, 4);
  stored.payload.costContributions[0]!.data.amount = 3;
  const saved = await updateAuthoredDraftDefinition(revision.id, {
    expectedUpdatedAt: revision.updatedAt.toISOString(), displayName: "Steady Ward revision 2", prowessDefinition: stored,
  });
  assert.equal(saved.validation?.status, "PASS");
  await submitAuthoredRevisionForReview(revision.id);
  await transitionEntityVersionStatus(revision.id, "APPROVED");
  const change = await proposeDefinitionChangeSet(revision.id, { rulesetId: world.rulesetId, name: "Adjust Ward cost" });
  await submitChangeSetForReview(change.id);
  await approveChangeSet(change.id);
  const r2 = await publishRulesetRelease({
    rulesetId: world.rulesetId, baseManifestId: world.release.manifestId, canonPolicyId: world.policyId, changeSetId: change.id, versionLabel: "R2",
  });
  await exportPack(r2.id, 2, revision.id);
}

async function install(number: 1 | 2, parallel = false) {
  const bytes = await readFile(pack(number));
  const archive = readContentPack(bytes);
  const before = await fingerprint(null, archive.manifest.release.rulesetId);
  const preview = await previewContentPack(bytes);
  assert.equal(preview.state, "Ready", JSON.stringify(preview.conflicts));
  assert.equal(preview.trust, "Unverified source");
  assert.equal(await fingerprint(null, archive.manifest.release.rulesetId), before);
  assert.equal(await prisma.contentPackReceipt.count({ where: { releaseId: preview.manifest.release.releaseId } }), 0);
  await assert.rejects(installContentPack(bytes, "0".repeat(64)), /Preview the file again/);
  const modified = Buffer.from(bytes);
  modified[modified.length - 1] ^= 1;
  await assert.rejects(previewContentPack(modified), /Payload bytes/);
  const results = await Promise.all(Array.from({ length: parallel ? 2 : 1 }, () => installContentPack(bytes, preview.previewFingerprint)));
  assert.deepEqual(results.map((entry) => entry.state).sort(), parallel ? ["Already installed", "Installed"] : ["Installed"]);
  const again = await previewContentPack(bytes);
  assert.equal(again.state, "Already installed");
  assert.equal((await installContentPack(bytes, again.previewFingerprint)).state, "Already installed");
  assert.equal(await prisma.contentPackReceipt.count({ where: { releaseId: archive.manifest.release.releaseId } }), 1);
  const release = await getRulesetRelease(archive.manifest.release.releaseId);
  assert.equal(release.manifestHash, archive.manifest.release.manifestHash);
  assert.equal(release.manifestId, archive.manifest.release.manifestId);
  console.log(JSON.stringify({ stage: "install", number, releaseId: release.id, manifestHash: release.manifestHash, pins: release.composition.length, state: "Installed", replay: again.state }));
  return release;
}

async function receiverWorld(release: Awaited<ReturnType<typeof install>>): Promise<CharacterReleaseWorld> {
  const { bundle } = await materializeProwessDefinitionsFromRelease(release.id);
  const pins = new Map<string, Pin>();
  const fixtureKeys = [
    TEST_ANCESTRY_KEY, "test.m6wo3.skill.athletics", "test.m6wo3.skill.stealth", "test.m6wo3.skill.arcana",
    "affinity.evocation", "skill.martial", "skill.arcana", "weapon.long_blade", "spell.targeting.single_target",
    "fixture.wo10.effect.damage", "spell.duration.instant", "spell.targeting.self", REVISED_CONTENT_KEY,
    "spell.duration.sustained", "test.wo8.effect.enhancement", "maneuver.duration.instant",
  ];
  for (const d of bundle.definitions) {
    assert(d.canonicalKey.startsWith(`${prefix}.`));
    const fixtureKey = fixtureKeys.find((key) => d.canonicalKey.startsWith(`${prefix}.${key.replaceAll(".", "_")}_`));
    if (fixtureKey === undefined) continue;
    pins.set(fixtureKey, {
      definitionKind: d.definitionKind, canonicalKey: d.canonicalKey, entityId: d.entityId, entityVersionId: d.entityVersionId,
    });
  }
  return {
    prefix, rulesetId: release.rulesetId, policyId: release.canonPolicyId,
    release: { id: release.id, manifestId: release.manifestId, releaseNumber: release.releaseNumber },
    entityIds: [...pins.values()].map((pin) => pin.entityId), pins,
  };
}

async function createAndPlay(world: CharacterReleaseWorld, price: number) {
  const { character, attack } = await martialCharacter(world, `Distribution tester R${world.release.releaseNumber}`);
  const name = "Steady Ward";
  const spell = await createCharacterSignatureSpell(character.id, { name });
  const draft = {
    ...spellDraft(world, name),
    targeting: { definition: refOf(world.pins, "spell.targeting.self"), parameters: {} },
    effects: [{ componentKey: "effect1", order: 1, definition: refOf(world.pins, REVISED_CONTENT_KEY), parameters: { amount: 1 } }],
    duration: { definition: refOf(world.pins, "spell.duration.sustained"), parameters: {} },
  };
  const saved = await updateCharacterSignatureSpellDraft(character.id, spell.spell.id, {
    expectedVersion: spell.spell.lockVersion, draft: draft as never,
  });
  assert.equal(saved.spell.draft?.evaluation?.cost?.finalMpCost, price);
  await finalizeCharacterSignatureSpell(character.id, spell.spell.id, { expectedVersion: saved.spell.lockVersion });

  const maneuver = await createCharacterSignatureManeuver(character.id, { name: "Exact Strike" });
  const built = await updateCharacterSignatureManeuverDraft(character.id, maneuver.maneuver.id, {
    expectedVersion: maneuver.maneuver.lockVersion, draft: maneuverDraft(world, attack),
  });
  await finalizeCharacterSignatureManeuver(character.id, maneuver.maneuver.id, { expectedVersion: built.maneuver.lockVersion });

  const commit = async (operation: unknown) => {
    const versions = (await getCharacterPlayWorkspace(character.id)).versions;
    const result = await commitCharacterPlayOperation(character.id, {
      operation, idempotencyKey: randomUUID(), expectedRuntimeVersion: versions.runtimeVersion, expectedPlayStateVersion: versions.playStateVersion,
    });
    assert(result.committed, JSON.stringify(result));
  };
  for (const event of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await commit({ kind: "TIMING", event });
  const before = await getCharacterPlayWorkspace(character.id);
  await commit({ kind: "SPELL", abilityId: spell.spell.id, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] });
  const after = await getCharacterPlayWorkspace(character.id);
  const mana = (value: typeof before) => value.workspace.resources.find((resource) => resource.resourceKey === "ME")!.current;
  assert.equal(mana(before) - mana(after), price);
  assert.equal((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).rulesetReleaseId, world.release.id);
  console.log(JSON.stringify({ stage: "play", characterId: character.id, releaseId: world.release.id, spellId: spell.spell.id, maneuverId: maneuver.maneuver.id, paidMana: price }));
  return { character, spellId: spell.spell.id, after };
}

const characterState = async (id: string, rulesetId: string) => (await fingerprint(id, rulesetId)).split("\n").slice(6).join("\n");

async function receiver() {
  assert.equal(await prisma.rulesetRelease.count(), 0, "Use a fresh independent receiver database");
  const r1 = await install(1, true);
  const world1 = await receiverWorld(r1);
  const old = await createAndPlay(world1, 4);
  const before = await characterState(old.character.id, r1.rulesetId);
  await assert.rejects(prisma.entityVersion.update({
    where: { id: world1.pins.get(REVISED_CONTENT_KEY)!.entityVersionId }, data: { rulesText: "This edit must be refused" },
  }), /Imported content is read-only/);

  const r2 = await install(2);
  assert.equal(await characterState(old.character.id, r1.rulesetId), before);
  assert.equal((await getCharacterSignatureSpell(old.character.id, old.spellId)).spell.current?.evaluation?.cost?.finalMpCost, 4);
  assert.deepEqual(await getCharacterPlayWorkspace(old.character.id), old.after);
  await createAndPlay(await receiverWorld(r2), 3);
  assert.equal(await characterState(old.character.id, r1.rulesetId), before);
  console.log(JSON.stringify({ stage: "safe-update", oldCharacter: old.character.id, oldRelease: r1.id, newRelease: r2.id, unchanged: true }));
  const rows = await prisma.character.findMany({ orderBy: { name: "asc" } });
  await writeFile(path.join(directory!, "receiver-state.json"), JSON.stringify(await Promise.all(rows.map(async (row) => ({
    characterId: row.id, releaseId: row.rulesetReleaseId, state: await characterState(row.id, r1.rulesetId),
  })))), { flag: "wx" });
}

async function resume() {
  const snapshots = JSON.parse(await readFile(path.join(directory!, "receiver-state.json"), "utf8")) as Array<{ characterId: string; releaseId: string; state: string }>;
  assert.equal(snapshots.length, 2);
  for (const { characterId, releaseId, state } of snapshots) {
    const release = await getRulesetRelease(releaseId);
    assert.deepEqual(await getCharacterPlayWorkspace(characterId), await getCharacterPlayWorkspace(characterId));
    assert.equal(await characterState(characterId, release.rulesetId), state);
    assert.equal((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).rulesetReleaseId, releaseId);
  }
  console.log(JSON.stringify({ stage: "resume", unchanged: true, characters: snapshots.map(({ characterId }) => characterId) }));
}

async function proveRollbackAndConflicts() {
  const bytes = await readFile(pack(2));
  const { files } = readContentPack(bytes);
  const entities = JSON.parse(Buffer.from(files.get("records/entities.json")!).toString("utf8")) as Array<{ canonicalKey: string; entityType: "GENERIC_RULE" }>;
  const preview = await previewContentPack(bytes);
  const clash = await prisma.entity.create({ data: { canonicalKey: entities[0]!.canonicalKey, entityType: "GENERIC_RULE" } });
  assert.equal((await previewContentPack(bytes)).state, "Conflict");
  await assert.rejects(installContentPack(bytes, preview.previewFingerprint), /Conflicting entities identity/);
  assert.equal(await prisma.rulesetRelease.count(), 0);
  await prisma.entity.delete({ where: { id: clash.id } });

  await prisma.$executeRaw`CREATE FUNCTION dist_wo2_test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DIST-WO2 injected receipt failure'; END; $$`;
  await prisma.$executeRaw`CREATE TRIGGER dist_wo2_test_fail_receipt BEFORE INSERT ON content_pack_receipts FOR EACH ROW EXECUTE FUNCTION dist_wo2_test_fail_receipt()`;
  try {
    await assert.rejects(installContentPack(bytes, preview.previewFingerprint), /injected receipt failure/);
    assert.equal(await prisma.rulesetRelease.count(), 0);
    assert.equal(await prisma.entity.count(), 0);
    assert.equal(await prisma.contentPackOwnership.count(), 0);
    assert.equal(await prisma.contentPackReceipt.count(), 0);
  } finally {
    await prisma.$executeRaw`DROP TRIGGER dist_wo2_test_fail_receipt ON content_pack_receipts`;
    await prisma.$executeRaw`DROP FUNCTION dist_wo2_test_fail_receipt()`;
  }
  console.log(JSON.stringify({ stage: "rejection", collision: true, lateFailureRolledBack: true }));
}

try {
  if (role === "source") await source();
  else if (role === "receiver") await receiver();
  else if (role === "resume") await resume();
  else if (role === "clean-receiver") {
    assert.equal(await prisma.rulesetRelease.count(), 0);
    await proveRollbackAndConflicts();
    const r2 = await install(2);
    await createAndPlay(await receiverWorld(r2), 3);
    assert.equal(await prisma.rulesetRelease.count(), 1, "R2 installs independently from R1");
    const r1 = await install(1);
    assert(r1.releaseNumber < r2.releaseNumber);
  } else throw new Error("Unknown transfer proof role");
} finally {
  await prisma.$disconnect();
}
