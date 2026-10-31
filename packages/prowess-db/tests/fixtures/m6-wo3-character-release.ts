/**
 * PAS-10 M6-WO3 test fixture — a published, Character-Creation-capable Release built through the ordinary M1 / M2
 * services (Entities, approved revisions, Manifest, Canon Policy, publication). Content: the canonical Core Playtest
 * core / runtime Definitions and the canonical executable Affinities (stored under test-only canonical keys), plus
 * TEST-ONLY character content: a Character Creation Rule, five Skills and the "Orcani" test Ancestry. Never game canon.
 *
 * Shared by the @prowess/db integration suite, the Studio API integration suite and the Playwright flow.
 */
import type { CreateChangeSetOperationInput } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind, type ProwessDefinitionRef } from "@prowess/game";
import {
  approveChangeSet,
  approveRuleset,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  prisma,
  publishRulesetRelease,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "../../src/index";
import { PLAYTEST_DEFINITIONS } from "../../../prowess-game/src/testing/core-fixtures.js";
import { TEST_ANCESTRY_KEY, TEST_RULE_KEY, TEST_SKILL_KEYS, ancestryPayload, creationRulePayload, skillPayload } from "../../../prowess-game/src/testing/character-fixtures.js";
import affinityContent from "../../../prowess-game/src/content/core-playtest-v0.1/affinity.json";
import { ADVANCEMENT_RULE_KEY, advancementRulePayload } from "../../../prowess-game/src/testing/advancement-fixtures.js";
import { CONSTRUCTION_RULE_PAYLOAD } from "../../../prowess-game/src/testing/construction-fixtures.js";
import { effectPayload } from "../../../prowess-game/src/testing/fixtures.js";

export interface Pin {
  entityId: string;
  entityVersionId: string;
  canonicalKey: string;
  definitionKind: ProwessDefinitionKind;
}

const AFFINITIES = (affinityContent as unknown as { definitions: Array<{ canonicalKey: string; definitionKind: ProwessDefinitionKind; schemaVersion: number; payload: Record<string, unknown> }> }).definitions;

const DISPLAY: Record<string, string> = {
  [TEST_ANCESTRY_KEY]: "Orcani (test)",
  [TEST_RULE_KEY]: "Character Creation Rule (test)",
  "test.m6wo3.skill.athletics": "Athletics (test)",
  "test.m6wo3.skill.survival": "Survival (test)",
  "test.m6wo3.skill.stealth": "Stealth (test)",
  "test.m6wo3.skill.arcana": "Arcana (test)",
  "test.m6wo3.skill.perception": "Perception (test)",
  "affinity.evocation": "Evocation (test)",
};

const stored = (kind: ProwessDefinitionKind, schemaVersion: number, payload: unknown) => ({ prowessDefinition: { schemaVersion, systemFamily: PROWESS_DEFINITION_KINDS[kind].family, definitionKind: kind, payload } });

async function approvedVersion(entityId: string, displayName: string, structuredData: object, extra: { shortDescription?: string; rulesText?: string } = {}) {
  const v = await createEntityVersion(entityId, { displayName, structuredData, ...extra });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}

export interface CharacterReleaseWorld {
  readonly prefix: string;
  readonly rulesetId: string;
  readonly policyId: string;
  readonly release: { id: string; manifestId: string; releaseNumber: number };
  /** Content key (e.g. `affinity.evocation`) → its pin in the CURRENT (latest published) Release of this world. */
  readonly pins: Map<string, Pin>;
  readonly entityIds: string[];
}

/** Seeds and publishes Release 1. Every stored canonical key is `${prefix}.<content key>_<tag>`. */
export async function seedCharacterRelease(prefix: string, label = "R1", options: { characterContent?: boolean; advancement?: boolean } = {}): Promise<CharacterReleaseWorld> {
  const tag = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const key = (k: string) => `${prefix}.${k.replace(/\./g, "_")}_${tag}`;
  const pins = new Map<string, Pin>();
  const entityIds: string[] = [];
  const add = async (contentKey: string, kind: ProwessDefinitionKind, schemaVersion: number, payload: unknown) => {
    const e = await createEntity({ entityType: PROWESS_DEFINITION_KINDS[kind].entityTypes[0] as string, canonicalKey: key(contentKey) });
    entityIds.push(e.id);
    const v = await approvedVersion(e.id, DISPLAY[contentKey] ?? contentKey, stored(kind, schemaVersion, payload), { shortDescription: `${DISPLAY[contentKey] ?? contentKey} — test fixture` });
    pins.set(contentKey, { entityId: e.id, entityVersionId: v.id, canonicalKey: e.canonicalKey, definitionKind: kind });
  };
  for (const d of PLAYTEST_DEFINITIONS) await add(d.canonicalKey, d.definitionKind, 1, d.payload);
  for (const d of AFFINITIES) await add(d.canonicalKey, d.definitionKind, d.schemaVersion, d.payload);
  // `characterContent: false` publishes only the core + Affinity content (a Release that is NOT yet Character-Creation
  // capable) so a test can author the character content through the M6-WO1 Compendium authoring services.
  if (options.characterContent !== false) {
    await add(TEST_RULE_KEY, "CHARACTER_CREATION_RULE", 1, creationRulePayload());
    for (const k of TEST_SKILL_KEYS) await add(k, "SKILL", 1, skillPayload());
    await add(TEST_ANCESTRY_KEY, "ANCESTRY", 1, ancestryPayload((k) => refOf(pins, k)));
  }
  // `advancement: true` (M6-WO4): the test Character Advancement Rule (the playtest cadence), the canonical Ability
  // Construction Rule, the two Skills it names and two test components with structured construction prerequisites.
  if (options.advancement === true) {
    await add(ADVANCEMENT_RULE_KEY, "CHARACTER_ADVANCEMENT_RULE", 1, advancementRulePayload());
    for (const k of ["skill.arcana", "skill.martial"]) await add(k, "SKILL", 1, skillPayload());
    // Skills are identified by their exact canonical key in M5 construction content; the stored keys are test-scoped.
    const arcana = pins.get("skill.arcana")!.canonicalKey;
    const martial = pins.get("skill.martial")!.canonicalKey;
    const rule = JSON.parse(JSON.stringify(CONSTRUCTION_RULE_PAYLOAD)) as { spell: { arcaneAuthority: { skillKey: string } }; maneuver: { martial: { skillKey: string } } };
    rule.spell.arcaneAuthority.skillKey = arcana;
    rule.maneuver.martial.skillKey = martial;
    await add("construction.ability_rules", "ABILITY_CONSTRUCTION_RULE", 1, rule);
    const construction = (prerequisites: unknown[]) => ({ rules: { construction: { prerequisites } } });
    await add("test.m6wo4.effect.expert_lore", "SPELL_EFFECT", 1, effectPayload("UTILITY", construction([{ prerequisiteKey: "ARCANA_EXPERT", kind: "SKILL_RANK_AT_LEAST", skillKey: arcana, minimumRank: "EXPERT" }])));
    await add("test.m6wo4.effect.evocation_trained", "SPELL_EFFECT", 1, effectPayload("DAMAGE", construction([{ prerequisiteKey: "EVOCATION_TRAINED", kind: "AFFINITY_RANK_AT_LEAST", affinity: refOf(pins, "affinity.evocation"), minimumRank: "TRAINED" }])));
  }

  const r = await createRuleset({ canonicalKey: key("ruleset"), name: `M6-WO3 Characters ${tag}`, channel: "CORE_PLAYTEST", versionLabel: label });
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const policy = await createCanonPolicy(r.id, { name: `P ${tag}`, authorities: [] });
  const m = await createRulesetManifest(r.id, { entries: [...pins.values()].map((p) => ({ entityId: p.entityId, entityVersionId: p.entityVersionId })) });
  const release = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: label });
  return { prefix, rulesetId: r.id, policyId: policy.id, release: { id: release.id, manifestId: release.manifestId, releaseNumber: release.releaseNumber }, pins, entityIds };
}

export const refOf = (pins: Map<string, Pin>, contentKey: string): ProwessDefinitionRef => {
  const p = pins.get(contentKey);
  if (p === undefined) throw new Error(`no pin for ${contentKey}`);
  return { entityId: p.entityId, entityVersionId: p.entityVersionId, canonicalKey: p.canonicalKey, definitionKind: p.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[p.definitionKind].family } as unknown as ProwessDefinitionRef;
};
export const selOf = (pins: Map<string, Pin>, contentKey: string) => {
  const p = pins.get(contentKey)!;
  return { entityId: p.entityId, entityVersionId: p.entityVersionId };
};

/** The worked Orcani Character's creation choices against `pins`. */
export function workedChoices(pins: Map<string, Pin>) {
  return {
    ancestry: selOf(pins, TEST_ANCESTRY_KEY),
    ancestryStatChoices: [
      { grantKey: "orcani_versatility", stat: "AGI" },
      { grantKey: "orcani_versatility", stat: "PRO" },
    ],
    statAllocations: { STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 },
    skills: [
      { skill: selOf(pins, "test.m6wo3.skill.athletics"), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
      { skill: selOf(pins, "test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null },
      { skill: selOf(pins, "test.m6wo3.skill.arcana"), sourceKind: "FREE", sourceGrantKey: null },
    ],
    primaryAffinity: selOf(pins, "affinity.evocation"),
  };
}

/**
 * Publishes the next Release of `world` with NEW approved revisions of the given content keys (the Ancestry revision
 * keeps referencing the Skill revisions pinned in the new Release). Returns the new world (pins of the new Release).
 */
export async function publishNextRelease(world: CharacterReleaseWorld, contentKeys: readonly string[], label: string, overrides: Readonly<Record<string, unknown>> = {}): Promise<CharacterReleaseWorld> {
  const pins = new Map(world.pins);
  const operations: CreateChangeSetOperationInput[] = [];
  const ordered = [...contentKeys].sort((a, b) => (a === TEST_ANCESTRY_KEY ? 1 : b === TEST_ANCESTRY_KEY ? -1 : 0));
  for (const k of ordered) {
    const old = pins.get(k)!;
    const current = await prisma.entityVersion.findUniqueOrThrow({ where: { id: old.entityVersionId } });
    const data = current.structuredData as { prowessDefinition: { schemaVersion: number; payload: Record<string, unknown> } };
    const payload = overrides[k] ?? (k === TEST_ANCESTRY_KEY ? ancestryPayload((x) => refOf(pins, x), { baseHp: 12 }) : data.prowessDefinition.payload);
    const v = await approvedVersion(old.entityId, `${current.displayName} (revised)`, stored(old.definitionKind, data.prowessDefinition.schemaVersion, payload));
    pins.set(k, { ...old, entityVersionId: v.id });
    operations.push({ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: old.entityId, fromEntityVersionId: old.entityVersionId, toEntityVersionId: v.id });
  }
  const cs = await createChangeSet(world.rulesetId, { name: `${label} ${Date.now()}`, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  const release = await publishRulesetRelease({ rulesetId: world.rulesetId, baseManifestId: world.release.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: label });
  return { ...world, release: { id: release.id, manifestId: release.manifestId, releaseNumber: release.releaseNumber }, pins };
}

/** FK-ordered teardown of every Character and world created under `prefix`. */
export async function cleanupCharacterWorlds(prefix: string): Promise<void> {
  const rulesetIds = (await prisma.ruleset.findMany({ where: { canonicalKey: { startsWith: prefix } }, select: { id: true } })).map((r) => r.id);
  const releaseIds = (await prisma.rulesetRelease.findMany({ where: { rulesetId: { in: rulesetIds } }, select: { id: true } })).map((r) => r.id);
  const characterIds = (await prisma.character.findMany({ where: { rulesetReleaseId: { in: releaseIds } }, select: { id: true } })).map((c) => c.id);
  // Completed Characters are frozen by a database guard; test teardown lifts it for its own rows only.
  await prisma.$executeRawUnsafe('ALTER TABLE "character_stat_allocations" DISABLE TRIGGER "character_stat_allocations_guard"');
  await prisma.$executeRawUnsafe('ALTER TABLE "character_ancestry_stat_choices" DISABLE TRIGGER "character_ancestry_stat_choices_guard"');
  await prisma.$executeRawUnsafe('ALTER TABLE "character_skill_ranks" DISABLE TRIGGER "character_skill_ranks_guard"');
  try {
    await prisma.characterSkillRank.deleteMany({ where: { characterId: { in: characterIds } } });
    await prisma.characterAncestryStatChoice.deleteMany({ where: { characterId: { in: characterIds } } });
    await prisma.characterStatAllocation.deleteMany({ where: { characterId: { in: characterIds } } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "character_stat_allocations" ENABLE TRIGGER "character_stat_allocations_guard"');
    await prisma.$executeRawUnsafe('ALTER TABLE "character_ancestry_stat_choices" ENABLE TRIGGER "character_ancestry_stat_choices_guard"');
    await prisma.$executeRawUnsafe('ALTER TABLE "character_skill_ranks" ENABLE TRIGGER "character_skill_ranks_guard"');
  }
  // M6-WO4: committed advancement history is append-only (database guard); test teardown lifts it for its own rows.
  const advancementGuards = ["character_advancements", "character_stat_advancements", "character_skill_advancements", "character_affinity_advancement_choices"];
  for (const t of advancementGuards) await prisma.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER "${t}_guard"`);
  try {
    const advancementIds = (await prisma.characterAdvancement.findMany({ where: { characterId: { in: characterIds } }, select: { id: true } })).map((a: { id: string }) => a.id);
    await prisma.characterStatAdvancement.deleteMany({ where: { advancementId: { in: advancementIds } } });
    await prisma.characterSkillAdvancement.deleteMany({ where: { advancementId: { in: advancementIds } } });
    await prisma.characterAffinityAdvancementChoice.deleteMany({ where: { advancementId: { in: advancementIds } } });
    await prisma.characterAdvancement.deleteMany({ where: { id: { in: advancementIds } } });
  } finally {
    for (const t of advancementGuards) await prisma.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE TRIGGER "${t}_guard"`);
  }
  await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
  const inR = { rulesetId: { in: rulesetIds } };
  await prisma.rulesetRelease.deleteMany({ where: inR });
  await prisma.changeSetOperation.deleteMany({ where: inR });
  await prisma.changeSet.deleteMany({ where: inR });
  await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: inR } });
  await prisma.canonPolicy.deleteMany({ where: inR });
  await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: inR } });
  await prisma.rulesetManifest.updateMany({ where: inR, data: { parentManifestId: null } });
  await prisma.rulesetManifest.deleteMany({ where: inR });
  await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
  const entityIds = (await prisma.entity.findMany({ where: { canonicalKey: { startsWith: prefix } }, select: { id: true } })).map((e) => e.id);
  await prisma.entityVersionKeyword.deleteMany({ where: { entityVersion: { entityId: { in: entityIds } } } });
  await prisma.sourceReference.deleteMany({ where: { entityVersion: { entityId: { in: entityIds } } } });
  await prisma.entityVersion.updateMany({ where: { entityId: { in: entityIds } }, data: { parentVersionId: null } });
  await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
}
