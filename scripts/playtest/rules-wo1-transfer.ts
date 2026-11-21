import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  approveChangeSet, assertRunningAgainstTestDatabase, changeKeywordPresentation, commandEncounter, commitCharacterPlayOperation, createAuthoredDefinition, createChangeSet,
  createCharacter, createEncounter, finalizeCharacterCoreCreation, getCharacterPlayWorkspace, getCharacterSheet, getEncounter, getRulesetRelease,
  materializeProwessDefinitionsFromRelease, prisma, publishRulesetRelease, saveCharacterCreation, submitAuthoredRevisionForReview,
  submitChangeSetForReview, transitionEntityVersionStatus,
} from "../../packages/prowess-db/src/index";
import { exportContentPack, installContentPack, previewContentPack, readContentPack } from "../../packages/prowess-db/src/content-pack/index";
import { workedChoices, type CharacterReleaseWorld, type Pin } from "../../packages/prowess-db/tests/fixtures/m6-wo3-character-release";
import { preparePlaytestRelease, runPrefix } from "../../packages/prowess-db/tests/fixtures/m6-wo12-playtest";
import { TEST_ANCESTRY_KEY } from "../../packages/prowess-game/src/testing/character-fixtures";

/**
 * RULES-WO1 Phase D — every new rule kind crosses machines in a content pack and survives restart and restore, and an
 * earlier Release, its Characters, an encounter and saved play state are untouched.
 *
 *   source   : a fresh disposable DB; the WO12 test Ruleset R1; ONE governed ChangeSet adds a labelled TEST-ONLY Carry
 *              Capacity, an Athletics Skill benefit, the Concentration rule (owner override), worn Armor, a Condition, a
 *              Summon engine and trait, a Mission table, a gameplay reference rule, Metamagic, a Job template and a
 *              version-2 Mage Art; published as R2. R1 and R2 are exported as content packs.
 *   receiver : an independent fresh DB installs both packs; R2's bundle holds every new kind (R1 none); a Character on
 *              each Release (the R2 sheet shows the labelled Carry value, R1's does not); an R1 encounter; saved play
 *              state on the R1 Character. Everything is recorded.
 *   resume   : a NEW process (restart) — and, separately, a DB restored from the receiver's workspace backup (written by
 *              this build's code with an older version tag) — reads the same Releases, kinds, sheets, encounter and play
 *              state, writing nothing. A backup from an earlier BUILD is proved by verify-rules-wo1-previous-build-restore.mjs.
 */
const [role, runId, directory] = process.argv.slice(2);
assert(role && runId && directory, "Usage: rules-wo1-transfer.ts source|receiver|resume <run-id> <directory>");
assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
const pack = (n: 1 | 2) => path.join(directory, `R${n}.prowesspack`);
const prefix = runPrefix(runId);
const NEW_KINDS = ["ARMOR", "CALCULATED_VALUE", "CONCENTRATION_RULE", "JOB_TEMPLATE", "MAGE_ART", "METAMAGIC", "MISSION_RULE", "REFERENCE_RULE", "SKILL_BENEFIT", "STATUS_CONDITION", "SUMMON_TRAIT", "SUMMON_TYPE", "AMMUNITION", "WEAPON_MODIFICATION"].sort();
const SRC = { locators: ["s1"], conflicts: [] };
const f = (expression: string, variables: Array<{ variable: string; source: Record<string, unknown> }>, rounding = "NONE", minimum: number | null = null) => ({ expression, rounding, minimum, maximum: null, unit: null, variables });

function contents(athletics: Pin) {
  const ref = { entityId: athletics.entityId, entityVersionId: athletics.entityVersionId, canonicalKey: athletics.canonicalKey, definitionKind: "SKILL", systemFamily: "SKILL" };
  return [
    ["CHARACTER", "CALCULATED_VALUE", 1, "value.carry_capacity", "Carry Capacity (test only)", { valueKey: "CARRY_CAPACITY", unit: "lb", canonStatus: "TEST_ONLY", placement: "CARRY_MAXIMUM_LOAD", base: f("25 * str", [{ variable: "str", source: { kind: "STAT", stat: "STR" } }], "NONE", 0), note: "Test-only placeholder: the rulebook states no Carry Capacity formula.", source: null }],
    ["CHARACTER", "CALCULATED_VALUE", 1, "value.throw_distance", "Throw Distance", { valueKey: "THROW_DISTANCE", unit: "ft", canonStatus: "OWNER_PROVIDED", placement: "ADDITIONAL_VALUES", base: null, note: "The base Throw Distance is not stated in the source.", source: null }],
    ["SKILL", "SKILL_BENEFIT", 1, "benefit.athletics_trained_throw", "Athletics: Throw Distance", { benefitKey: "ATHLETICS_TRAINED_THROW", skill: ref, minimumRankKey: "TRAINED", contributions: [{ contributionKey: "PER_STR", valueKey: "THROW_DISTANCE", amount: f("5 * str", [{ variable: "str", source: { kind: "STAT", stat: "STR" } }]), condition: null }], grantedActions: [], prerequisiteGroups: [{ groupKey: "STRONG", mode: "ALL", prerequisites: [{ prerequisiteKey: "STR_1", kind: "STAT_AT_LEAST", stat: "STR", minimum: 1 }] }], writtenBenefit: "Increase Throw Distance by 5 ft per STR.", source: SRC }],
    ["ABILITY", "CONCENTRATION_RULE", 1, "rule.concentration", "Concentration", { ruleKey: "CONCENTRATION", canonStatus: "OWNER_PROVIDED", capacity: f("1 + floor(res / 3)", [{ variable: "res", source: { kind: "STAT", stat: "RES" } }]), sustainedSpellUpkeepAp: f("max(1, floor(cast_ap / 2))", [{ variable: "cast_ap", source: { kind: "CAST_AP" } }]), allocation: { apCoveredPerPoint: 1, maySplitAcrossEffects: true, mayStackOnOneEffect: true, uncoveredApPaid: true, waivesMpUpkeep: false, waivesManaLock: false, pointsReturnWhenEffectEnds: true }, openQuestions: [{ questionKey: "REASSIGNMENT", question: "Reassignment cost and timing?" }], note: "Owner override.", source: null }],
    ["EQUIPMENT", "ARMOR", 1, "armor.heavy_plate", "Heavy Plate", { armorKey: "HEAVY_PLATE", category: "HEAVY", armorValue: 5, strengthRequirement: 5, maxAgiForDodge: 5, movementPenaltyFeet: 5, stealth: "DISADVANTAGE", notes: [], source: SRC }],
    ["CONDITION", "STATUS_CONDITION", 1, "condition.burning", "Burning", { conditionKey: "BURNING", effects: [{ effectKey: "DAMAGE_OVER_TIME", text: "Takes damage over time." }], duration: { model: "UNTIL_REMOVED", rounds: null, text: null }, removal: ["Put out the flames."], ongoingTiming: "START_OF_TURN", stacking: "DOES_NOT_STACK", triggers: [{ triggerKey: "BURN", when: "START_OF_TURN", resistStat: null, text: "Takes the ongoing damage." }], source: SRC }],
    ["SUMMON", "SUMMON_TYPE", 1, "summon.totem", "Totem", { summonKey: "TOTEM", engine: "TOTEM", tiers: [{ tierKey: "TIER_1", label: "Tier 1", baseMp: 12, dieFaces: 4, staticValue: 2, hp: 10, armor: 2, resolve: 2, radiusFeet: 10, size: "Small", traitSlots: null }], castingAp: f("total_mp / pro", [{ variable: "total_mp", source: { kind: "TOTAL_MP" } }, { variable: "pro", source: { kind: "STAT", stat: "PRO" } }], "FLOOR", 1), sustainMode: "SUSTAINED", sustainMp: null, sustainApPerRound: 1, countsTowardConcentration: null, maxActive: null, actionEconomy: "Resolves on its timing.", ownership: { actionModel: "PASSIVE", actsWhen: "AUTOMATIC_AT_TRIGGER", baseAp: null, apOwner: "NONE", hpOwner: "SUMMON", mpOwner: "NONE", counterActions: false, dismissal: "FREE_ACTION" }, restrictions: [{ restrictionKey: "NO_ACTIONS", kind: "NO_ACTIONS_WITHOUT_TRAIT", text: "Does nothing except exist without an emitted Effect." }], openQuestions: [], source: SRC }],
    ["SUMMON", "SUMMON_TRAIT", 1, "summon_trait.warding_pulse", "Warding Pulse", { traitKey: "WARDING_PULSE", engines: ["TOTEM"], costs: [{ tierKey: "TIER_1", mp: 5 }], forbidden: false, effect: "Illustrative.", source: SRC }],
    ["CORE", "REFERENCE_RULE", 1, "reference.grappling", "Grappling", { ruleKey: "GRAPPLING", shape: "POINTS", rollTable: null, clock: null, intel: null, points: ["Movement becomes 0."], relatedRules: [], source: SRC }],
    ["MISSION", "MISSION_RULE", 1, "mission.contract_clause", "Contract Clause", { ruleKey: "CONTRACT_CLAUSE", shape: "ROLL_TABLE", rollTable: { dieCount: 1, dieFaces: 4, rows: [{ from: 1, to: 2, result: "No public combat." }, { from: 3, to: 4, result: "Hidden clause." }] }, clock: null, intel: null, points: null, relatedRules: ["@reference.grappling"], source: SRC }],
    ["SPELL", "METAMAGIC", 1, "metamagic.extend", "Extend", { metamagicKey: "EXTEND", form: "OPTION", mp: 2, ap: null, otherCost: null, effect: "Illustrative.", restrictions: [], source: SRC }],
    ["CHARACTER", "JOB_TEMPLATE", 1, "job.warrior", "Warrior", { jobKey: "WARRIOR", role: "Front line.", suggestedStats: ["STR"], suggestedSkills: [ref], startingEquipment: [], features: [], source: SRC }],
    ["MAGE_ART", "MAGE_ART", 2, "mage_art.barrier", "Barrier", { artKey: "BARRIER", activation: { ap: 1, mp: 2 }, maintenance: { ap: 0, mp: 1, special: null }, activeEffect: { counts: "WHILE_MAINTAINED" }, modes: [{ modeKey: "WARD", name: "Ward", activation: null, maintenance: null, rulesText: "Illustrative.", scaling: [{ scalingKey: "BONUS", label: "Bonus", unit: null, byLevel: [{ fromLevel: 1, toLevel: 10, value: 1 }], formula: null, text: "Illustrative." }] }], grantedBenefits: [{ benefitKey: "NO_SUFFOCATION", kind: "IMMUNITY", subject: "Suffocation", text: "Illustrative." }], maintenanceExceptions: [], source: SRC }],
    ["EQUIPMENT", "AMMUNITION", 1, "ammunition.standard_rounds", "Standard Rounds", { ammoKey: "STANDARD_ROUNDS", weaponFamilies: ["RIFLE"], perAttack: 1, burstPerAttack: 3, effect: "Illustrative.", notes: [], source: SRC }],
    ["EQUIPMENT", "WEAPON_MODIFICATION", 1, "modification.extended_magazine", "Extended Magazine", { modificationKey: "EXTENDED_MAGAZINE", weaponFamilies: ["RIFLE"], slotCost: 1, changes: [{ changeKey: "MORE", kind: "LOADING", amount: 4, text: "Illustrative." }], requirements: [], source: SRC }],
  ] as const;
}

async function source() {
  assert.equal(await prisma.rulesetRelease.count(), 0, "Use a fresh disposable source database");
  const { world } = await preparePlaytestRelease(runId!);
  await mkdir(directory!, { recursive: true });
  const producerId = randomUUID();
  const exportPack = async (id: string, n: 1 | 2) => {
    const bytes = await exportContentPack(id, { producerId, label: `RULES-WO1 R${n}`, provenance: { claimedCreator: "Prowess playtest", category: "sample" } });
    await writeFile(pack(n), bytes, { flag: "wx" });
    const { manifest, archiveSha256 } = readContentPack(bytes);
    console.log(JSON.stringify({ stage: "export", number: n, bytes: bytes.length, archiveSha256, releaseId: manifest.release.releaseId }));
  };
  await exportPack(world.release.id, 1);
  const athletics = world.pins.get("test.m6wo3.skill.athletics");
  assert(athletics, "the test Release pins Athletics");
  const operations = [];
  // "@key" in relatedRules is replaced by the exact reference of the entry created earlier in this list (R16 link).
  const createdRefs = new Map<string, Record<string, string>>();
  for (const [family, kind, schemaVersion, key, rawPayload, ] of contents(athletics).map((c) => [c[0], c[1], c[2], c[3], c[5]] as const)) {
    const name = contents(athletics).find((c) => c[3] === key)![4];
    const payload = "relatedRules" in rawPayload ? { ...rawPayload, relatedRules: (rawPayload.relatedRules as readonly string[]).map((k) => createdRefs.get(k.slice(1))!) } : rawPayload;
    const created = await createAuthoredDefinition({ definitionKind: kind, canonicalKey: `${prefix}.rw1.${key}`, displayName: name, prowessDefinition: { schemaVersion, systemFamily: family, definitionKind: kind, payload } });
    createdRefs.set(key, { entityId: created.entity.id, entityVersionId: created.version.id, canonicalKey: `${prefix}.rw1.${key}`, definitionKind: kind, systemFamily: family });
    assert.equal(created.validation?.status, "PASS", `${kind}: ${JSON.stringify(created.validation?.issues)}`);
    await submitAuthoredRevisionForReview(created.version.id);
    await transitionEntityVersionStatus(created.version.id, "APPROVED");
    operations.push({ operationType: "PIN_ENTITY_VERSION" as const, targetEntityId: created.entity.id, toEntityVersionId: created.version.id, targetManifestId: null, description: `RULES-WO1 add ${kind}` });
  }
  const change = await createChangeSet(world.rulesetId, { canonDecisionId: null, name: "RULES-WO1 new rule kinds", description: null, operations });
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
  // Replay is idempotent: the same pack previews and installs as "Already installed" and writes nothing.
  const versionsBefore = await prisma.entityVersion.count();
  const again = await previewContentPack(bytes);
  assert.equal(again.state, "Already installed");
  assert.equal((await installContentPack(bytes, again.previewFingerprint)).state, "Already installed");
  assert.equal(await prisma.entityVersion.count(), versionsBefore, "a replayed install writes no Entity versions");
  return getRulesetRelease(readContentPack(bytes).manifest.release.releaseId);
}

async function worldOf(release: Awaited<ReturnType<typeof install>>): Promise<CharacterReleaseWorld> {
  const { bundle } = await materializeProwessDefinitionsFromRelease(release.id);
  const pins = new Map<string, Pin>();
  const keys = [TEST_ANCESTRY_KEY, "test.m6wo3.skill.athletics", "test.m6wo3.skill.stealth", "test.m6wo3.skill.arcana", "affinity.evocation", "skill.martial", "skill.arcana"];
  for (const d of bundle.definitions) {
    const key = keys.find((k) => d.canonicalKey.startsWith(`${prefix}.${k.replaceAll(".", "_")}_`));
    if (key !== undefined) pins.set(key, { definitionKind: d.definitionKind, canonicalKey: d.canonicalKey, entityId: d.entityId, entityVersionId: d.entityVersionId });
  }
  return { prefix, rulesetId: release.rulesetId, policyId: release.canonPolicyId, release: { id: release.id, manifestId: release.manifestId, releaseNumber: release.releaseNumber }, entityIds: [...pins.values()].map((p) => p.entityId), pins };
}
const newKindsIn = async (releaseId: string) => [...new Set((await materializeProwessDefinitionsFromRelease(releaseId)).bundle.definitions.map((d) => d.definitionKind).filter((k) => NEW_KINDS.includes(k)))].sort();

async function characterState(id: string) {
  const sheet = await getCharacterSheet(id);
  const [character, playState, resources, runtime, events] = await Promise.all([
    prisma.character.findUnique({ where: { id } }),
    prisma.characterPlayState.findUnique({ where: { characterId: id } }),
    prisma.characterResourceState.findMany({ where: { characterId: id }, orderBy: { resourceKey: "asc" } }),
    prisma.characterPlayRuntime.findUnique({ where: { characterId: id } }),
    prisma.characterPlayEvent.findMany({ where: { characterId: id }, orderBy: { sequence: "asc" } }),
  ]);
  return JSON.parse(JSON.stringify({ carry: sheet.mechanics.carry.maximumLoad, calculated: sheet.mechanics.calculatedValues ?? null, character, playState, resources, runtime, events })) as Record<string, unknown>;
}

async function receiver() {
  assert.equal(await prisma.rulesetRelease.count(), 0, "Use a fresh disposable receiver database");
  const r1 = await install(1);
  // R09: a Keyword installed from the R1 pack keeps the DIST-WO2 protection — the edit service refuses it plainly and
  // writes nothing; the R2 pack still installs and the Keyword is exactly as delivered.
  const imported = await prisma.keywordDefinition.findFirst({ orderBy: { canonicalKey: "asc" } });
  assert(imported, "the R1 pack carries Keywords");
  await assert.rejects(
    changeKeywordPresentation(imported.id, { expected: { name: imported.name, description: imported.description, deprecated: imported.deprecated }, name: `${imported.name} (renamed here)`, description: imported.description, deprecated: imported.deprecated }),
    (e: unknown) => (e as { code?: string }).code === "KEYWORD.IMPORTED_READ_ONLY",
  );
  const r2 = await install(2);
  assert.deepEqual(await prisma.keywordDefinition.findUniqueOrThrow({ where: { id: imported.id } }), imported, "an imported Keyword is unchanged");
  assert.deepEqual(await newKindsIn(r1.id), [], "Release 1 carries none of the new kinds");
  assert.deepEqual(await newKindsIn(r2.id), [...NEW_KINDS].sort(), "Release 2 carries every new kind");
  // The Mission rule's link to the Grappling reference rule arrives as an exact reference to the installed revision.
  const r2Defs = (await materializeProwessDefinitionsFromRelease(r2.id)).bundle.definitions;
  const mission = r2Defs.find((d) => d.definitionKind === "MISSION_RULE")!;
  const grappling = r2Defs.find((d) => d.definitionKind === "REFERENCE_RULE")!;
  const linked = (mission.payload as { relatedRules: Array<{ entityVersionId: string }> }).relatedRules;
  assert.deepEqual(linked.map((l) => l.entityVersionId), [grappling.entityVersionId], "the linked rule survives the transfer exactly");
  const ids: Record<string, string> = {};
  for (const r of [r1, r2]) {
    const w = await worldOf(r);
    const c = await createCharacter({ name: `RULES-WO1 R${r.releaseNumber}`, rulesetReleaseId: r.id });
    const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(w.pins) as never });
    ids[`r${r.releaseNumber}`] = (await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion })).id;
  }
  // Saved play state on the Release 1 Character, and an encounter on Release 1.
  const v = (await getCharacterPlayWorkspace(ids.r1!)).versions;
  await commitCharacterPlayOperation(ids.r1!, { operation: { kind: "TIMING", event: "BEGIN_COMBAT" }, idempotencyKey: randomUUID(), expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
  const enc = (await createEncounter({ name: "RULES-WO1: Yard", rulesetReleaseId: r1.id, idempotencyKey: randomUUID() })).encounter;
  await commandEncounter(enc.id, { command: { kind: "ADD_PARTICIPANT", characterId: ids.r1, sideId: null }, expectedVersion: (await getEncounter(enc.id)).version, idempotencyKey: randomUUID() });

  const s1 = await characterState(ids.r1!);
  const s2 = await characterState(ids.r2!);
  assert.equal((s1.carry as { value: unknown }).value, null, "the Release 1 sheet has no Carry value");
  assert.equal(s1.calculated, null);
  const str = (await getCharacterSheet(ids.r2!)).mechanics.stats.find((s) => s.stat === "STR")!.total;
  assert.equal((s2.carry as { value: unknown }).value, 25 * str, "the Release 2 sheet shows the test-only Carry value");
  assert.deepEqual((s2.calculated as Array<{ valueKey: string; canonStatus: string }>).map((x) => [x.valueKey, x.canonStatus]), [["CARRY_CAPACITY", "TEST_ONLY"], ["THROW_DISTANCE", "OWNER_PROVIDED"]]);
  // The Skill benefit's prerequisite group (STR at least 1) is evaluated on the receiver: the R2 Character is eligible.
  assert.deepEqual((await getCharacterSheet(ids.r2!)).mechanics.skillBenefits?.map((b) => [b.benefitKey, b.status]), [["ATHLETICS_TRAINED_THROW", "GRANTED"]]);
  assert.equal("skillBenefits" in (await getCharacterSheet(ids.r1!)).mechanics, false, "the Release 1 sheet is unchanged (no Skill benefits)");
  const state = { releases: { r1: r1.id, r2: r2.id }, characters: ids, encounter: enc.id, sheets: { r1: s1, r2: s2 }, encounterView: JSON.parse(JSON.stringify(await getEncounter(enc.id))) as unknown };
  await writeFile(path.join(directory!, "rules-wo1-state.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ stage: "receiver", r1: r1.id, r2: r2.id, r2Kinds: NEW_KINDS.length, carryR2: 25 * str }));
}

async function resume() {
  const state = JSON.parse(await readFile(path.join(directory!, "rules-wo1-state.json"), "utf8")) as { releases: { r1: string; r2: string }; characters: { r1: string; r2: string }; encounter: string; sheets: { r1: unknown; r2: unknown }; encounterView: unknown };
  const counts = async () => [await prisma.entityVersion.count(), await prisma.rulesetRelease.count(), await prisma.character.count(), await prisma.encounterEvent.count(), await prisma.characterPlayEvent.count()];
  const before = await counts();
  assert.deepEqual(await newKindsIn(state.releases.r1), []);
  assert.deepEqual(await newKindsIn(state.releases.r2), [...NEW_KINDS].sort());
  assert.deepEqual(await characterState(state.characters.r1), state.sheets.r1, "the Release 1 Character, sheet and play state are identical");
  assert.deepEqual(await characterState(state.characters.r2), state.sheets.r2, "the Release 2 Character and its calculated values are identical");
  assert.deepEqual(JSON.parse(JSON.stringify(await getEncounter(state.encounter))), state.encounterView, "the encounter reads identically");
  assert.deepEqual(await counts(), before, "reading writes nothing");
  console.log(JSON.stringify({ stage: "resume", database: new URL(process.env.DATABASE_URL!).pathname.slice(1), unchanged: true }));
}

try {
  if (role === "source") await source();
  else if (role === "receiver") await receiver();
  else if (role === "resume") await resume();
  else throw new Error(`unknown role ${role}`);
} finally {
  await prisma.$disconnect();
}
