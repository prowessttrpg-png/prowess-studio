import type { PathSegment } from "../internal/plain-data.js";
import { Problems, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { ABILITY_CONSTRUCTION_SKILL_RANKS, type AbilityConstructionSkillRank } from "../vocabulary/ability-construction.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";

/**
 * Versioned M5-WO5 construction-capacity content. Numbers live in an exact Definition, never in compiler branches.
 * Arcane Rank and Martial Rank are still the existing Arcana/Martial Skill ranks; this payload only gives those ranks
 * their Ability-Construction meaning.
 */
export interface AbilityConstructionRankRule {
  readonly rank: AbilityConstructionSkillRank;
  readonly order: number;
  readonly rankValue: number;
  readonly arcane: {
    readonly effectCapacity: number;
    readonly traitCapacity: number;
    readonly castingConditionCapacity: number;
    readonly maximumTraitTrades: number;
  };
  readonly martial: {
    readonly effectCapacity: number;
    readonly traitCapacity: number;
    readonly maneuverConditionCapacity: number;
  };
}

export interface AbilityConstructionRulePayload {
  readonly ranks: readonly AbilityConstructionRankRule[];
  readonly spellAccess: {
    readonly minimumArcaneRank: AbilityConstructionSkillRank;
    readonly minimumAffinityRank: "NONE" | "TRAINED" | "EXPERT" | "MASTER";
    readonly minimumEffects: number;
  };
  readonly signature: {
    readonly defaultSlotsPerAbility: number;
    readonly capacityStat: "PRO";
  };
  readonly source: CoreDefinitionSource;
}

const NON_NEGATIVE = (value: unknown, at: readonly PathSegment[], p: Problems, what: string): number | null => {
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < 0) p.add(C.INVALID_PAYLOAD, at, `${what} cannot be negative`);
  return n !== null && n >= 0 ? n : null;
};

const POSITIVE = (value: unknown, at: readonly PathSegment[], p: Problems, what: string): number | null => {
  const n = NON_NEGATIVE(value, at, p, what);
  if (n !== null && n < 1) p.add(C.INVALID_PAYLOAD, at, `${what} must be at least 1`);
  return n !== null && n >= 1 ? n : null;
};

export function readAbilityConstructionRulePayload(value: unknown, at: readonly PathSegment[], p: Problems): AbilityConstructionRulePayload | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["ranks", "spellAccess", "signature", "source"], ["ranks", "spellAccess", "signature", "source"]);
  if (r === null) return null;
  const before = p.count;
  const rawRanks = own(r, "ranks");
  const ranks: AbilityConstructionRankRule[] = [];
  if (!Array.isArray(rawRanks)) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], "ranks is the complete Ability Construction rank table");
  else
    rawRanks.forEach((raw: unknown, i: number) => {
      const rr = readRecord(raw, [...at, "ranks", i], p, C.INVALID_PAYLOAD, ["rank", "order", "rankValue", "arcane", "martial"], ["rank", "order", "rankValue", "arcane", "martial"]);
      if (rr === null) return;
      const rank = readEnum(own(rr, "rank"), ABILITY_CONSTRUCTION_SKILL_RANKS, [...at, "ranks", i, "rank"], p, C.INVALID_PAYLOAD, "Skill rank");
      const order = NON_NEGATIVE(own(rr, "order"), [...at, "ranks", i, "order"], p, "rank order");
      const rankValue = NON_NEGATIVE(own(rr, "rankValue"), [...at, "ranks", i, "rankValue"], p, "Rank Value");
      const ar = readRecord(own(rr, "arcane"), [...at, "ranks", i, "arcane"], p, C.INVALID_PAYLOAD, ["effectCapacity", "traitCapacity", "castingConditionCapacity", "maximumTraitTrades"], ["effectCapacity", "traitCapacity", "castingConditionCapacity", "maximumTraitTrades"]);
      const mr = readRecord(own(rr, "martial"), [...at, "ranks", i, "martial"], p, C.INVALID_PAYLOAD, ["effectCapacity", "traitCapacity", "maneuverConditionCapacity"], ["effectCapacity", "traitCapacity", "maneuverConditionCapacity"]);
      const ae = ar === null ? null : NON_NEGATIVE(own(ar, "effectCapacity"), [...at, "ranks", i, "arcane", "effectCapacity"], p, "Arcane Effect capacity");
      const atc = ar === null ? null : NON_NEGATIVE(own(ar, "traitCapacity"), [...at, "ranks", i, "arcane", "traitCapacity"], p, "Arcane Trait capacity");
      const cc = ar === null ? null : NON_NEGATIVE(own(ar, "castingConditionCapacity"), [...at, "ranks", i, "arcane", "castingConditionCapacity"], p, "Casting Condition capacity");
      const mt = ar === null ? null : NON_NEGATIVE(own(ar, "maximumTraitTrades"), [...at, "ranks", i, "arcane", "maximumTraitTrades"], p, "maximum Trait trades");
      const me = mr === null ? null : NON_NEGATIVE(own(mr, "effectCapacity"), [...at, "ranks", i, "martial", "effectCapacity"], p, "Martial Effect capacity");
      const mtc = mr === null ? null : NON_NEGATIVE(own(mr, "traitCapacity"), [...at, "ranks", i, "martial", "traitCapacity"], p, "Martial Trait capacity");
      const mc = mr === null ? null : NON_NEGATIVE(own(mr, "maneuverConditionCapacity"), [...at, "ranks", i, "martial", "maneuverConditionCapacity"], p, "Maneuver Condition capacity");
      if (rank !== null && order !== null && rankValue !== null && ae !== null && atc !== null && cc !== null && mt !== null && me !== null && mtc !== null && mc !== null) {
        ranks.push({ rank, order, rankValue, arcane: { effectCapacity: ae, traitCapacity: atc, castingConditionCapacity: cc, maximumTraitTrades: mt }, martial: { effectCapacity: me, traitCapacity: mtc, maneuverConditionCapacity: mc } });
      }
    });
  for (const rank of ABILITY_CONSTRUCTION_SKILL_RANKS) if (ranks.filter((x) => x.rank === rank).length !== 1) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], `${rank} is defined exactly once`);
  if (new Set(ranks.map((x) => x.order)).size !== ranks.length) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], "rank order values are unique");

  const access = readRecord(own(r, "spellAccess"), [...at, "spellAccess"], p, C.INVALID_PAYLOAD, ["minimumArcaneRank", "minimumAffinityRank", "minimumEffects"], ["minimumArcaneRank", "minimumAffinityRank", "minimumEffects"]);
  const minimumArcaneRank = access === null ? null : readEnum(own(access, "minimumArcaneRank"), ABILITY_CONSTRUCTION_SKILL_RANKS, [...at, "spellAccess", "minimumArcaneRank"], p, C.INVALID_PAYLOAD, "minimum Arcane Rank");
  const affinityRanks = ["NONE", "TRAINED", "EXPERT", "MASTER"] as const;
  const minimumAffinityRank = access === null ? null : readEnum(own(access, "minimumAffinityRank"), affinityRanks, [...at, "spellAccess", "minimumAffinityRank"], p, C.INVALID_PAYLOAD, "minimum Affinity Rank");
  const minimumEffects = access === null ? null : POSITIVE(own(access, "minimumEffects"), [...at, "spellAccess", "minimumEffects"], p, "minimum Spell Effects");

  const signature = readRecord(own(r, "signature"), [...at, "signature"], p, C.INVALID_PAYLOAD, ["defaultSlotsPerAbility", "capacityStat"], ["defaultSlotsPerAbility", "capacityStat"]);
  const slots = signature === null ? null : POSITIVE(own(signature, "defaultSlotsPerAbility"), [...at, "signature", "defaultSlotsPerAbility"], p, "default Signature slots per Ability");
  const capacityStat = signature === null ? null : own(signature, "capacityStat");
  if (signature !== null && capacityStat !== "PRO") p.add(C.INVALID_PAYLOAD, [...at, "signature", "capacityStat"], "Signature Ability capacity uses PRO");
  const source = readSource(own(r, "source"), [...at, "source"], p);

  if (p.count > before || minimumArcaneRank === null || minimumAffinityRank === null || minimumEffects === null || slots === null || capacityStat !== "PRO" || source === null) return null;
  return { ranks, spellAccess: { minimumArcaneRank, minimumAffinityRank, minimumEffects }, signature: { defaultSlotsPerAbility: slots, capacityStat: "PRO" }, source };
}
