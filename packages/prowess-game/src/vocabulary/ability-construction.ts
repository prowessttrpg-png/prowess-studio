import { deepFreeze } from "../internal/plain-data.js";

/**
 * M5-WO5 shared Ability Construction vocabulary.
 *
 * Arcane Rank and Martial Rank are NOT new progression tracks: they are the existing Arcana and Martial Skill ranks.
 * The numeric meaning below belongs specifically to Ability Construction (capacity / Rank Value), not to the generic
 * Skill ladder's Skill Check bonus. This preserves the WO2 rule that rank ordering and rank mechanical meaning are
 * separate concepts.
 */
export const ABILITY_CONSTRUCTION_SKILL_RANKS = deepFreeze(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"] as const);
export type AbilityConstructionSkillRank = (typeof ABILITY_CONSTRUCTION_SKILL_RANKS)[number];

/** Exact Skill identities used by the construction rules. */
export const ARCANA_SKILL_KEY = "skill.arcana" as const;
export const MARTIAL_SKILL_KEY = "skill.martial" as const;

export interface AbilityConstructionRankCapacity {
  /** Per-system Rank Value. UNTRAINED has no trained Rank Value. */
  readonly rankValue: number;
  readonly effectCapacity: number;
  readonly traitCapacity: number;
  /** Spell Casting Conditions: derived from Arcane Rank only. */
  readonly castingConditionCapacity: number;
  /** Spell-only unused-Effect → Trait exchanges while retaining at least one Effect. */
  readonly maximumTraitTrades: number;
}

/**
 * Locked designer table for M5-WO5.
 *
 * - Arcane Authority uses Effect / Trait capacities 1 / 2 / 3.
 * - Martial uses Effect capacity 1 / 2 / 3 and Maneuver Condition capacity is the Martial Rank Value.
 * - Casting Condition capacity is 0 / 1 / 2 / 3 by Arcane Rank, regardless of selected Spell Authority.
 * - Trait exchange is Spell-only; Trained 0, Expert 1, Master 2.
 */
export const ABILITY_CONSTRUCTION_CAPACITY_BY_RANK: Readonly<Record<AbilityConstructionSkillRank, AbilityConstructionRankCapacity>> = deepFreeze({
  UNTRAINED: { rankValue: 0, effectCapacity: 0, traitCapacity: 0, castingConditionCapacity: 0, maximumTraitTrades: 0 },
  TRAINED: { rankValue: 1, effectCapacity: 1, traitCapacity: 1, castingConditionCapacity: 1, maximumTraitTrades: 0 },
  EXPERT: { rankValue: 2, effectCapacity: 2, traitCapacity: 2, castingConditionCapacity: 2, maximumTraitTrades: 1 },
  MASTER: { rankValue: 3, effectCapacity: 3, traitCapacity: 3, castingConditionCapacity: 3, maximumTraitTrades: 2 },
});

export const ABILITY_CONSTRUCTION_SUBJECT_KINDS = deepFreeze(["ABILITY_CONSTRUCTION"] as const);
export type AbilityConstructionSubjectKind = (typeof ABILITY_CONSTRUCTION_SUBJECT_KINDS)[number];

/** Explicit exemption is the only way a player-created/known Ability avoids the default one Signature slot. */
export const SIGNATURE_SLOT_POLICIES = deepFreeze(["DEFAULT_ONE", "EXEMPT_BY_RULE"] as const);
export type SignatureSlotPolicy = (typeof SIGNATURE_SLOT_POLICIES)[number];

/** Effect stacking is opt-in Definition data; no Rank is a default stack limit. */
export const EFFECT_STACK_LIMIT_KINDS = deepFreeze(["FIXED", "SKILL_RANK_VALUE", "GOVERNING_AFFINITY_RANK_VALUE"] as const);
export type EffectStackLimitKind = (typeof EFFECT_STACK_LIMIT_KINDS)[number];

export const ABILITY_CONSTRUCTION_RULINGS = deepFreeze({
  SPELL_ACCESS: "ARCANE_TRAINED_OR_RELEVANT_AFFINITY_TRAINED",
  TRAIT_EXCHANGE: "ONE_UNUSED_EFFECT_FOR_ONE_TRAIT_SPELL_ONLY",
  SIGNATURE_SLOT_DEFAULT: 1,
  STACKING: "EXPLICIT_DEFINITION_ONLY",
  CASTING_CONDITIONS: "ARCANE_RANK_ONLY",
} as const);
