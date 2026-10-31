/**
 * PAS-10 M6-WO3 Studio API fixture — a published, Character-Creation-capable Release built through the ordinary public
 * @prowess/db services (Entities, approved revisions, Manifest, Canon Policy, ChangeSet, publication). Studio never
 * imports the M5 domain package: the canonical Core Playtest core / runtime Definitions and executable Affinities are
 * read from their JSON content files (stored under test-only canonical keys), Definition families and EntityTypes come
 * from the server's authoring catalog, and the character content (Creation Rule, five Skills, the "Orcani" Ancestry) is
 * TEST-ONLY data identical to packages/prowess-game/src/testing/character-fixtures.ts. Never game canon.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  approveChangeSet,
  approveRuleset,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  getAuthoringCatalog,
  prisma,
  publishRulesetRelease,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "@prowess/db";

const CONTENT = path.resolve(__dirname, "../../../../../packages/prowess-game/src/content/core-playtest-v0.1");
type Row = { canonicalKey: string; definitionKind: string; schemaVersion?: number; payload: unknown };
const rows = (file: string) => (JSON.parse(readFileSync(path.join(CONTENT, file), "utf8")) as { definitions: Row[] }).definitions;
const SOURCE = { locators: ["s20"], conflicts: [] };
export const SKILL_KEYS = ["test.m6wo3.skill.athletics", "test.m6wo3.skill.survival", "test.m6wo3.skill.stealth", "test.m6wo3.skill.arcana", "test.m6wo3.skill.perception"] as const;
export const RULE_KEY = "test.m6wo3.character_creation_rule";
export const ANCESTRY_KEY = "test.m6wo3.ancestry.orcani";

export interface Pin {
  entityId: string;
  entityVersionId: string;
  canonicalKey: string;
  definitionKind: string;
  systemFamily: string;
}
export interface CharacterWorld {
  readonly rulesetId: string;
  readonly policyId: string;
  readonly release: { id: string; manifestId: string; releaseNumber: number };
  readonly pins: Map<string, Pin>;
}

async function kinds(): Promise<Map<string, { family: string; entityType: string }>> {
  const catalog = await getAuthoringCatalog();
  return new Map(catalog.kinds.map((k) => [k.definitionKind, { family: k.systemFamily, entityType: k.allowedEntityTypes[0] as string }]));
}
async function approvedVersion(entityId: string, displayName: string, structuredData: object) {
  const v = await createEntityVersion(entityId, { displayName, structuredData, shortDescription: `${displayName} — test fixture` });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}
const ancestryPayload = (pins: Map<string, Pin>, baseHp = 10) => ({
  baseHp,
  baseMp: 4,
  statGrants: [
    { grantKey: "orcani_strength", kind: "FIXED", stat: "STR", amount: 2 },
    { grantKey: "orcani_versatility", kind: "CHOOSE_DISTINCT", count: 2, amount: 1, allowedStats: ["AGI", "CON", "PER", "RES", "PRO"] },
  ],
  skillGrants: [{ grantKey: "orcani_upbringing", rankKey: "TRAINED", selectionKind: "CHOOSE_FROM", count: 1, options: [pins.get("test.m6wo3.skill.athletics"), pins.get("test.m6wo3.skill.survival")] }],
  source: SOURCE,
});

/** Seeds and publishes Release 1 under `prefix`. */
/** The playtest advancement cadence (Levels 2–10) as a TEST Character Advancement Rule payload (M6-WO4). */
export const ADVANCEMENT_RULE_KEY = "test.m6wo4.advancement_rule";
export const advancementRulePayload = (statPoints: (level: number) => number = (l) => (l === 10 ? 2 : 1)) => ({
  levels: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => ({ level, statPoints: statPoints(level), skillAdvancements: [3, 5, 6, 8, 9, 10].includes(level) ? 1 : 0 })),
  source: { locators: ["s159"], conflicts: [] },
});

export async function seedCharacterWorld(prefix: string, label = "R1", options: { advancement?: boolean } = {}): Promise<CharacterWorld> {
  const k = await kinds();
  const tag = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const pins = new Map<string, Pin>();
  const stored = (kind: string, schemaVersion: number, payload: unknown) => ({ prowessDefinition: { schemaVersion, systemFamily: k.get(kind)!.family, definitionKind: kind, payload } });
  const add = async (contentKey: string, kind: string, schemaVersion: number, payload: unknown) => {
    const canonicalKey = `${prefix}.${contentKey.replace(/\./g, "_")}_${tag}`;
    const e = await createEntity({ entityType: k.get(kind)!.entityType, canonicalKey });
    const v = await approvedVersion(e.id, contentKey, stored(kind, schemaVersion, payload));
    pins.set(contentKey, { entityId: e.id, entityVersionId: v.id, canonicalKey, definitionKind: kind, systemFamily: k.get(kind)!.family });
  };
  for (const d of [...rows("core-resolution.json"), ...rows("runtime-resources.json"), ...rows("affinity.json")]) await add(d.canonicalKey, d.definitionKind, d.schemaVersion ?? 1, d.payload);
  await add(RULE_KEY, "CHARACTER_CREATION_RULE", 1, { startingLevel: 1, statPointBudget: 15, freeTrainedSkillCount: 2, startingSkillRankKey: "TRAINED", requiredAncestryCount: 1, requiredPrimaryAffinityCount: 1, source: SOURCE });
  for (const s of SKILL_KEYS) await add(s, "SKILL", 1, { ladderKey: "SKILL", source: SOURCE });
  await add(ANCESTRY_KEY, "ANCESTRY", 1, ancestryPayload(pins));
  if (options.advancement === true) {
    // M6-WO4: the advancement rule, the canonical Ability Construction Rule (Skills renamed to this world's test-scoped
    // Arcana / Martial Skills) and one component whose structured prerequisite is Arcana EXPERT.
    await add(ADVANCEMENT_RULE_KEY, "CHARACTER_ADVANCEMENT_RULE", 1, advancementRulePayload());
    for (const k of ["skill.arcana", "skill.martial"]) await add(k, "SKILL", 1, { ladderKey: "SKILL", source: SOURCE });
    const rule = JSON.parse(JSON.stringify(rows("ability-construction.json")[0]!.payload)) as { spell: { arcaneAuthority: { skillKey: string } }; maneuver: { martial: { skillKey: string } } };
    rule.spell.arcaneAuthority.skillKey = pins.get("skill.arcana")!.canonicalKey;
    rule.maneuver.martial.skillKey = pins.get("skill.martial")!.canonicalKey;
    await add("construction.ability_rules", "ABILITY_CONSTRUCTION_RULE", 1, rule);
    await add("test.m6wo4.effect.expert_lore", "SPELL_EFFECT", 1, {
      effectFamily: "UTILITY",
      resolution: { mode: "SAVING_THROW", data: { authored: true } },
      outcomes: [{ outcomeKey: "on-fail", data: { authored: true } }],
      rules: { construction: { prerequisites: [{ prerequisiteKey: "ARCANA_EXPERT", kind: "SKILL_RANK_AT_LEAST", skillKey: pins.get("skill.arcana")!.canonicalKey, minimumRank: "EXPERT" }] } },
    });
  }

  const r = await createRuleset({ canonicalKey: `${prefix}.ruleset_${tag}`, name: `M6-WO3 API ${tag}`, channel: "CORE_PLAYTEST", versionLabel: label });
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const policy = await createCanonPolicy(r.id, { name: `P ${tag}`, authorities: [] });
  const m = await createRulesetManifest(r.id, { entries: [...pins.values()].map((p) => ({ entityId: p.entityId, entityVersionId: p.entityVersionId })) });
  const release = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: label });
  return { rulesetId: r.id, policyId: policy.id, release: { id: release.id, manifestId: release.manifestId, releaseNumber: release.releaseNumber }, pins };
}

export const selOf = (pins: Map<string, Pin>, contentKey: string) => {
  const p = pins.get(contentKey)!;
  return { entityId: p.entityId, entityVersionId: p.entityVersionId };
};

/** The worked Orcani Character's creation choices against `pins`. */
export function workedChoices(pins: Map<string, Pin>) {
  return {
    ancestry: selOf(pins, ANCESTRY_KEY),
    ancestryStatChoices: [
      { grantKey: "orcani_versatility", stat: "AGI" },
      { grantKey: "orcani_versatility", stat: "PRO" },
    ],
    statAllocations: { STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 },
    skills: [
      { skill: selOf(pins, "test.m6wo3.skill.athletics"), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" as string | null },
      { skill: selOf(pins, "test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null as string | null },
      { skill: selOf(pins, "test.m6wo3.skill.arcana"), sourceKind: "FREE", sourceGrantKey: null as string | null },
    ],
    primaryAffinity: selOf(pins, "affinity.evocation"),
  };
}

/** Publishes the next Release with NEW approved revisions of the given content keys (Ancestry revision: Base HP 12). */
export async function publishNextRelease(world: CharacterWorld, contentKeys: readonly string[], label: string, overrides: Readonly<Record<string, unknown>> = {}): Promise<CharacterWorld> {
  const pins = new Map(world.pins);
  const operations = [];
  const ordered = [...contentKeys].sort((a, b) => (a === ANCESTRY_KEY ? 1 : b === ANCESTRY_KEY ? -1 : 0));
  for (const key of ordered) {
    const old = pins.get(key)!;
    const current = await prisma.entityVersion.findUniqueOrThrow({ where: { id: old.entityVersionId } });
    const data = current.structuredData as { prowessDefinition: { schemaVersion: number; systemFamily: string; definitionKind: string; payload: unknown } };
    const payload = overrides[key] ?? (key === ANCESTRY_KEY ? ancestryPayload(pins, 12) : data.prowessDefinition.payload);
    const v = await approvedVersion(old.entityId, `${current.displayName} (revised)`, { prowessDefinition: { ...data.prowessDefinition, payload } });
    pins.set(key, { ...old, entityVersionId: v.id });
    operations.push({ operationType: "REPLACE_ENTITY_VERSION" as const, targetEntityId: old.entityId, fromEntityVersionId: old.entityVersionId, toEntityVersionId: v.id });
  }
  const cs = await createChangeSet(world.rulesetId, { name: `${label} ${Date.now()}`, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  const release = await publishRulesetRelease({ rulesetId: world.rulesetId, baseManifestId: world.release.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: label });
  return { ...world, release: { id: release.id, manifestId: release.manifestId, releaseNumber: release.releaseNumber }, pins };
}

/** FK-ordered teardown of every Character and world created under `prefix` (lifts the freeze guard for its own rows). */
export async function cleanupCharacterWorlds(prefix: string): Promise<void> {
  const rulesetIds = (await prisma.ruleset.findMany({ where: { canonicalKey: { startsWith: prefix } }, select: { id: true } })).map((r: { id: string }) => r.id);
  const releaseIds = (await prisma.rulesetRelease.findMany({ where: { rulesetId: { in: rulesetIds } }, select: { id: true } })).map((r: { id: string }) => r.id);
  const characterIds = (await prisma.character.findMany({ where: { rulesetReleaseId: { in: releaseIds } }, select: { id: true } })).map((c: { id: string }) => c.id);
  const guards = ["character_stat_allocations", "character_ancestry_stat_choices", "character_skill_ranks"];
  for (const t of guards) await prisma.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER "${t}_guard"`);
  try {
    await prisma.characterSkillRank.deleteMany({ where: { characterId: { in: characterIds } } });
    await prisma.characterAncestryStatChoice.deleteMany({ where: { characterId: { in: characterIds } } });
    await prisma.characterStatAllocation.deleteMany({ where: { characterId: { in: characterIds } } });
  } finally {
    for (const t of guards) await prisma.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE TRIGGER "${t}_guard"`);
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
  const entityIds = (await prisma.entity.findMany({ where: { canonicalKey: { startsWith: prefix } }, select: { id: true } })).map((e: { id: string }) => e.id);
  await prisma.entityVersionKeyword.deleteMany({ where: { entityVersion: { entityId: { in: entityIds } } } });
  await prisma.sourceReference.deleteMany({ where: { entityVersion: { entityId: { in: entityIds } } } });
  await prisma.entityVersion.updateMany({ where: { entityId: { in: entityIds } }, data: { parentVersionId: null } });
  await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
}
