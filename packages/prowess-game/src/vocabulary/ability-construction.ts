import { deepFreeze } from "../internal/plain-data.js";

/**
 * M5-WO5 shared Ability Construction vocabulary.
 * Arcane Rank and Martial Rank are the existing Arcana and Martial Skill ranks; all numeric construction meaning is
 * authored in an exact ABILITY_CONSTRUCTION_RULE Definition, never embedded in this vocabulary module.
 */
export const ABILITY_CONSTRUCTION_SKILL_RANKS = deepFreeze(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"] as const);
export type AbilityConstructionSkillRank = (typeof ABILITY_CONSTRUCTION_SKILL_RANKS)[number];

export const ARCANA_SKILL_KEY = "skill.arcana" as const;
export const MARTIAL_SKILL_KEY = "skill.martial" as const;

export const ABILITY_CONSTRUCTION_SUBJECT_KINDS = deepFreeze(["ABILITY_CONSTRUCTION"] as const);
export type AbilityConstructionSubjectKind = (typeof ABILITY_CONSTRUCTION_SUBJECT_KINDS)[number];

/** Explicit exemption is the only way a player-created/known Ability avoids the default Signature-slot rule. */
export const SIGNATURE_SLOT_POLICIES = deepFreeze(["DEFAULT_ONE", "EXEMPT_BY_RULE"] as const);
export type SignatureSlotPolicy = (typeof SIGNATURE_SLOT_POLICIES)[number];

/** Effect stacking is opt-in Definition data; no Rank is a default stack limit. */
export const EFFECT_STACK_LIMIT_KINDS = deepFreeze(["FIXED", "SKILL_RANK_VALUE", "GOVERNING_AFFINITY_RANK_VALUE"] as const);
export type EffectStackLimitKind = (typeof EFFECT_STACK_LIMIT_KINDS)[number];

export const ABILITY_CONSTRUCTION_RULINGS = deepFreeze({
  SPELL_ACCESS: "ARCANE_TRAINED_OR_RELEVANT_AFFINITY_TRAINED",
  TRAIT_EXCHANGE: "ONE_UNUSED_EFFECT_FOR_ONE_TRAIT_SPELL_ONLY",
  STACKING: "EXPLICIT_DEFINITION_ONLY",
  CASTING_CONDITIONS: "ARCANE_RANK_ONLY",
} as const);
