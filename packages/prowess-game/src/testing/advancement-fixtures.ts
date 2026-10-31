import { CONSTRUCTION_RULE_PAYLOAD } from "./construction-fixtures.js";
import { characterFixture, workedCandidate, type CharacterFixture, type FixtureRow } from "./character-fixtures.js";
import { effectPayload } from "./fixtures.js";

/**
 * Test-only fixtures for PAS-10 M6-WO4 Character advancement and eligibility (never game canon, never public surface).
 * The WO3 character fixture plus: the Core Playtest advancement schedule as a TEST Character Advancement Rule
 * (`test.m6wo4.*`), the canonical Ability Construction Rule (content file), the two Skills that rule names
 * (`skill.arcana`, `skill.martial`) and neutral test components with structured construction prerequisites.
 */
export const ADVANCEMENT_RULE_KEY = "test.m6wo4.advancement_rule";

/** The current playtest cadence (§5): Stat Points and Skill advancements per Level 2–10 (Character Die / Affinity are not here). */
export const PLAYTEST_ADVANCEMENT_LEVELS = [
  { level: 2, statPoints: 1, skillAdvancements: 0 },
  { level: 3, statPoints: 1, skillAdvancements: 1 },
  { level: 4, statPoints: 1, skillAdvancements: 0 },
  { level: 5, statPoints: 1, skillAdvancements: 1 },
  { level: 6, statPoints: 1, skillAdvancements: 1 },
  { level: 7, statPoints: 1, skillAdvancements: 0 },
  { level: 8, statPoints: 1, skillAdvancements: 1 },
  { level: 9, statPoints: 1, skillAdvancements: 1 },
  { level: 10, statPoints: 2, skillAdvancements: 1 },
] as const;

export const advancementRulePayload = (levels: readonly unknown[] = PLAYTEST_ADVANCEMENT_LEVELS) => ({ levels: levels.map((l) => ({ ...(l as object) })), source: { locators: ["s159"], conflicts: [] } });
const skill = (canonicalKey: string): FixtureRow => ({ canonicalKey, definitionKind: "SKILL", schemaVersion: 1, payload: { ladderKey: "SKILL", source: { locators: ["s29"], conflicts: [] } } });
const construction = (prerequisites: unknown[]) => ({ rules: { construction: { prerequisites } } });

export interface AdvancementFixture extends CharacterFixture {
  readonly creation: ReturnType<typeof workedCandidate>;
}

/**
 * The fixture bundle. `levels` overrides the advancement schedule; `omitAdvancementRule` drops it; `revision` pins newer
 * revisions of the named keys (a "Release 2"); `rulesetId` changes the exact Release identity.
 */
export function advancementFixture(options: { readonly levels?: readonly unknown[]; readonly omitAdvancementRule?: boolean; readonly revision?: readonly string[]; readonly rulesetId?: string; readonly extra?: readonly FixtureRow[] } = {}): AdvancementFixture {
  // Exact references inside component payloads: the fixture's ids depend only on row order, so a first build names them.
  const probe = characterFixture({ revision: options.revision, rulesetId: options.rulesetId });
  const evocation = probe.ref("affinity.evocation");
  const conjuration = probe.ref("affinity.conjuration");
  const extra: FixtureRow[] = [
    ...(options.omitAdvancementRule ? [] : [{ canonicalKey: ADVANCEMENT_RULE_KEY, definitionKind: "CHARACTER_ADVANCEMENT_RULE" as const, schemaVersion: 1, payload: advancementRulePayload(options.levels) }]),
    { canonicalKey: "construction.ability_rules", definitionKind: "ABILITY_CONSTRUCTION_RULE", schemaVersion: 1, payload: CONSTRUCTION_RULE_PAYLOAD },
    skill("skill.arcana"),
    skill("skill.martial"),
    { canonicalKey: "test.m6wo4.effect.expert_lore", definitionKind: "SPELL_EFFECT", schemaVersion: 1, payload: effectPayload("UTILITY", construction([{ prerequisiteKey: "ARCANA_EXPERT", kind: "SKILL_RANK_AT_LEAST", skillKey: "skill.arcana", minimumRank: "EXPERT" }])) },
    { canonicalKey: "test.m6wo4.effect.evocation_trained", definitionKind: "SPELL_EFFECT", schemaVersion: 1, payload: effectPayload("DAMAGE", construction([{ prerequisiteKey: "EVOCATION_TRAINED", kind: "AFFINITY_RANK_AT_LEAST", affinity: evocation, minimumRank: "TRAINED" }])) },
    { canonicalKey: "test.m6wo4.effect.conjuration_trained", definitionKind: "SPELL_EFFECT", schemaVersion: 1, payload: effectPayload("UTILITY", construction([{ prerequisiteKey: "CONJURATION_TRAINED", kind: "AFFINITY_RANK_AT_LEAST", affinity: conjuration, minimumRank: "TRAINED" }])) },
    { canonicalKey: "test.m6wo4.effect.martial_expert", definitionKind: "MANEUVER_EFFECT", schemaVersion: 1, payload: effectPayload("DAMAGE", construction([{ prerequisiteKey: "MARTIAL_EXPERT", kind: "SKILL_RANK_AT_LEAST", skillKey: "skill.martial", minimumRank: "EXPERT" }])) },
    { canonicalKey: "test.m6wo4.effect.open", definitionKind: "SPELL_EFFECT", schemaVersion: 1, payload: effectPayload("UTILITY") },
    ...(options.extra ?? []),
  ];
  const f = characterFixture({ revision: options.revision, rulesetId: options.rulesetId, extra });
  return { ...f, creation: workedCandidate(f) };
}
