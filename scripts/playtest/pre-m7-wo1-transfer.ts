import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  approveChangeSet, assertRunningAgainstTestDatabase, createAuthoredRevision, createCharacter, finalizeCharacterCoreCreation,
  getCharacterSheet, getRulesetRelease, getStatImpacts, materializeProwessDefinitionsFromRelease, prisma, proposeDefinitionChangeSet,
  publishRulesetRelease, saveCharacterCreation, submitAuthoredRevisionForReview, submitChangeSetForReview, transitionEntityVersionStatus,
  updateAuthoredDraftDefinition,
} from "../../packages/prowess-db/src/index";
import { exportContentPack, installContentPack, previewContentPack, readContentPack } from "../../packages/prowess-db/src/content-pack/index";
import { workedChoices, type CharacterReleaseWorld, type Pin } from "../../packages/prowess-db/tests/fixtures/m6-wo3-character-release";
import { fingerprint, preparePlaytestRelease, runPrefix } from "../../packages/prowess-db/tests/fixtures/m6-wo12-playtest";
import { TEST_ANCESTRY_KEY } from "../../packages/prowess-game/src/testing/character-fixtures";

/**
 * PRE-M7-WO1 C13–C14 — the Strength → Armor change crosses machines and survives restart and restore.
 *
 *   source   : a fresh disposable DB; the WO12 test Ruleset's R1 pins `STRENGTH_ARMOR = floor(str / 3)`; the removal is
 *              authored, reviewed, approved and published as R2 through the governed services; R1 and R2 are exported.
 *   receiver : an independent fresh DB installs both packs, proves the exact-Release rule reads (R1's STR affects Armor,
 *              R2's does not) and creates one Character on each Release; their sheets are recorded.
 *   resume   : a NEW process (restart) — and, separately, a DB restored from the receiver's workspace backup — reads the
 *              same Releases and Characters and must reproduce the recorded state exactly, writing nothing.
 */
const [role, runId, directory] = process.argv.slice(2);
assert(role && runId && directory, "Usage: pre-m7-wo1-transfer.ts source|receiver|resume <run-id> <directory>");
assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
const pack = (n: 1 | 2) => path.join(directory, `R${n}.prowesspack`);
const prefix = runPrefix(runId);
const ARMOR_KEY = "core.derived.strength_armor";
type Stored = { payload: { formula: { expression: string; variables: unknown[] } } };

async function source() {
  assert.equal(await prisma.rulesetRelease.count(), 0, "Use a fresh disposable source database");
  const { world } = await preparePlaytestRelease(runId!);
  const armor = world.pins.get(ARMOR_KEY);
  assert(armor, "the test Release pins the core Strength Armor rule");
  await mkdir(directory!, { recursive: true });
  const producerId = randomUUID();
  const exportPack = async (id: string, n: 1 | 2) => {
    const before = await fingerprint(null, world.rulesetId);
    const bytes = await exportContentPack(id, { producerId, label: `PRE-M7-WO1 Strength Armor R${n}`, provenance: { claimedCreator: "Prowess playtest", category: "sample" } });
    assert.equal(await fingerprint(null, world.rulesetId), before, "export writes nothing");
    await writeFile(pack(n), bytes, { flag: "wx" });
    const { manifest, archiveSha256 } = readContentPack(bytes);
    console.log(JSON.stringify({ stage: "export", number: n, bytes: bytes.length, archiveSha256, releaseId: manifest.release.releaseId }));
  };
  await exportPack(world.release.id, 1);
  const draft = await createAuthoredRevision(armor.entityId, { baseVersionId: armor.entityVersionId, changeType: "MECHANICAL_CHANGE", changeSummary: "Strength no longer adds Armor" });
  const stored = structuredClone((draft.structuredData as { prowessDefinition: Stored }).prowessDefinition);
  assert.equal(stored.payload.formula.expression, "floor(str / 3)");
  stored.payload.formula = { ...stored.payload.formula, expression: "0", variables: [] };
  const saved = await updateAuthoredDraftDefinition(draft.id, { expectedUpdatedAt: draft.updatedAt.toISOString(), prowessDefinition: stored as never });
  assert.equal(saved.validation?.status, "PASS");
  await submitAuthoredRevisionForReview(draft.id);
  await transitionEntityVersionStatus(draft.id, "APPROVED");
  const change = await proposeDefinitionChangeSet(draft.id, { rulesetId: world.rulesetId, name: "Strength no longer adds Armor" });
  await submitChangeSetForReview(change.id);
  await approveChangeSet(change.id);
  const r2 = await publishRulesetRelease({ rulesetId: world.rulesetId, baseManifestId: world.release.manifestId, canonPolicyId: world.policyId, changeSetId: change.id, versionLabel: "R2" });
  await exportPack(r2.id, 2);
}

async function install(n: 1 | 2) {
  const bytes = await readFile(pack(n));
  const preview = await previewContentPack(bytes);
  assert.equal(preview.state, "Ready", JSON.stringify(preview.conflicts));
  assert.equal((await installContentPack(bytes, preview.previewFingerprint)).state, "Installed");
  assert.equal((await previewContentPack(bytes)).state, "Already installed");
  return getRulesetRelease(readContentPack(bytes).manifest.release.releaseId);
}

async function world(release: Awaited<ReturnType<typeof install>>): Promise<CharacterReleaseWorld> {
  const { bundle } = await materializeProwessDefinitionsFromRelease(release.id);
  const pins = new Map<string, Pin>();
  const keys = [TEST_ANCESTRY_KEY, "test.m6wo3.skill.athletics", "test.m6wo3.skill.stealth", "test.m6wo3.skill.arcana", "affinity.evocation", "skill.martial", "skill.arcana"];
  for (const d of bundle.definitions) {
    const key = keys.find((k) => d.canonicalKey.startsWith(`${prefix}.${k.replaceAll(".", "_")}_`));
    if (key !== undefined) pins.set(key, { definitionKind: d.definitionKind, canonicalKey: d.canonicalKey, entityId: d.entityId, entityVersionId: d.entityVersionId });
  }
  return { prefix, rulesetId: release.rulesetId, policyId: release.canonPolicyId, release: { id: release.id, manifestId: release.manifestId, releaseNumber: release.releaseNumber }, entityIds: [...pins.values()].map((p) => p.entityId), pins };
}

async function snapshot(characterId: string) {
  const sheet = await getCharacterSheet(characterId);
  const row = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  return { characterId, releaseId: row.rulesetReleaseId, str: sheet.mechanics.stats.find((s) => s.stat === "STR")!.total, armor: sheet.mechanics.combat.armor.value, row: JSON.stringify(row) };
}
async function readsArmor(releaseId: string) {
  return (await getStatImpacts(releaseId, "STR")).impacts.some((i) => i.token === "STRENGTH_ARMOR");
}

async function receiver() {
  assert.equal(await prisma.rulesetRelease.count(), 0, "Use a fresh disposable receiver database");
  const r1 = await install(1);
  const r2 = await install(2);
  assert.equal(await readsArmor(r1.id), true);
  assert.equal(await readsArmor(r2.id), false);
  const out = [];
  for (const r of [r1, r2]) {
    const w = await world(r);
    const c = await createCharacter({ name: `Strength Armor R${r.releaseNumber}`, rulesetReleaseId: r.id });
    const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(w.pins) as never });
    await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
    out.push({ releaseNumber: r.releaseNumber, ...(await snapshot(c.id)) });
  }
  const [c1, c2] = out as [typeof out[number], typeof out[number]];
  assert.equal(c1.armor, Math.floor(c1.str / 3));
  assert(c1.armor > 0, "the R1 Character has Strength Armor");
  assert.equal(c2.str, c1.str);
  assert.equal(c2.armor, 0, "the R2 Character has none");
  await writeFile(path.join(directory!, "receiver-state.json"), JSON.stringify({ releases: { r1: r1.id, r2: r2.id }, characters: out }, null, 2));
  console.log(JSON.stringify({ stage: "receiver", r1: r1.id, r2: r2.id, r1ReadsArmor: true, r2ReadsArmor: false, characters: out.map(({ row: _row, ...c }) => c) }));
}

async function resume() {
  const state = JSON.parse(await readFile(path.join(directory!, "receiver-state.json"), "utf8")) as { releases: { r1: string; r2: string }; characters: Array<Awaited<ReturnType<typeof snapshot>> & { releaseNumber: number }> };
  assert.equal(await readsArmor(state.releases.r1), true);
  assert.equal(await readsArmor(state.releases.r2), false);
  for (const c of state.characters) {
    const now = await snapshot(c.characterId);
    assert.deepEqual({ ...now }, { characterId: c.characterId, releaseId: c.releaseId, str: c.str, armor: c.armor, row: c.row }, `Character R${c.releaseNumber} changed`);
  }
  console.log(JSON.stringify({ stage: "resume", database: new URL(process.env.DATABASE_URL!).pathname.slice(1), unchanged: true, armor: state.characters.map((c) => ({ release: c.releaseNumber, armor: c.armor })) }));
}

try {
  if (role === "source") await source();
  else if (role === "receiver") await receiver();
  else if (role === "resume") await resume();
  else throw new Error("Unknown role");
} finally {
  await prisma.$disconnect();
}
