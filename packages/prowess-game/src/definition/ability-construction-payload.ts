import type { JsonObject } from "@prowess/model";
import { validateFormulaProgram } from "@prowess/rules";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { AFFINITY_RANKS, type AffinityRank } from "../vocabulary/affinity.js";
import {
  AFFINITY_AUTHORITY_CAPACITY_SOURCES,
  CASTING_CONDITION_CAPACITY_SOURCES,
  CONSTRUCTION_PREREQUISITE_KINDS,
  CONSTRUCTION_SKILL_TRACKS,
  STACK_LIMIT_KINDS,
  type ConstructionSkillTrack,
} from "../vocabulary/ability-construction.js";
import { DERIVED_STATISTICS, type DerivedStatistic } from "../vocabulary/core.js";
import { CONSTRUCTION_ERROR_CODES as K, DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";

/**
 * Version-1 payload of ABILITY_CONSTRUCTION_RULE (PAS-10 M5-WO5 §120–§127): the versioned structural policy of shared
 * Ability Construction. Every number a construction legality check uses is authored here (or in the WO4
 * AFFINITY_RANK_RULE it reuses, §122) — never in TypeScript. Ranks are SKILL-ladder rank keys; their ORDER always comes
 * from the exact RANK_LADDER Definition the payload names, never from string comparison.
 */
export interface ArcaneCapacityRow {
  readonly rankKey: string;
  readonly effectCapacity: number;
  readonly traitCapacity: number;
}

export interface MartialCapacityRow {
  readonly rankKey: string;
  /** The Martial Rank Value (§20). Only mechanics that explicitly use Rank Value read it. */
  readonly martialRankValue: number;
  readonly effectCapacity: number;
  readonly traitCapacity: number;
  readonly conditionCapacity: number;
}

export interface ConditionCapacityRow {
  readonly rankKey: string;
  readonly capacity: number;
}

/** The Spell Effect-slot → Trait-slot exchange (§63, §126). Explicit per Spell; never inferred from unused capacity. */
export interface TraitExchangeRule {
  readonly effectSlotsPerExchange: number;
  readonly traitSlotsPerExchange: number;
  /** Effect capacity that must remain after every exchange — a Spell always keeps at least one Effect (§11). */
  readonly minimumEffectsRemaining: number;
}

export interface SignatureExemption {
  readonly exemptionKey: string;
  readonly description: string;
}

/**
 * An authored construction Formula: an M4 Formula program whose variables are drawn from the slot's fixed construction
 * inputs (CONSTRUCTION_FORMULA_INPUTS). The expression is Definition data, validated by M4's own validateFormulaProgram;
 * @prowess/game never parses or evaluates it.
 */
export interface ConstructionFormula {
  readonly expression: string;
  readonly rounding: "NONE" | "FLOOR" | "CEIL";
  readonly minimum: number | null;
  readonly variables: readonly string[];
}

/** The construction Formula slots and the inputs each may read (§59–§63, §93–§94). */
export const CONSTRUCTION_FORMULA_INPUTS = {
  remainingEffects: ["base_effects", "trades", "effect_slots_per_exchange"],
  effectiveTraits: ["base_traits", "trades", "trait_slots_per_exchange"],
  maximumTrades: ["base_effects", "minimum_effects_remaining", "effect_slots_per_exchange"],
  signatureProjected: ["used_slots", "candidate_slots"],
  signatureAvailable: ["capacity", "projected"],
} as const satisfies Record<string, readonly string[]>;
export type ConstructionFormulaSlot = keyof typeof CONSTRUCTION_FORMULA_INPUTS;
const FORMULA_SLOTS = Object.keys(CONSTRUCTION_FORMULA_INPUTS) as ConstructionFormulaSlot[];

export interface AbilityConstructionRulePayload {
  /** The SKILL rank ladder both construction tracks read (§19). */
  readonly rankLadder: string;
  /** Every construction arithmetic step, authored as content (M5-I050 / M5-I074: arithmetic lives in content). */
  readonly formulas: Readonly<Record<ConstructionFormulaSlot, ConstructionFormula>>;
  readonly spell: {
    readonly arcaneAuthority: { readonly skillKey: string; readonly minimumRank: string; readonly ranks: readonly ArcaneCapacityRow[] };
    readonly affinityAuthority: { readonly capacitySource: "AFFINITY_RANK_RULE" };
    readonly castingConditions: { readonly capacitySource: "ARCANE_RANK"; readonly ranks: readonly ConditionCapacityRow[] };
    readonly minimumEffects: number;
    readonly traitExchange: TraitExchangeRule | null;
  };
  readonly maneuver: {
    readonly martial: { readonly skillKey: string; readonly minimumRank: string; readonly ranks: readonly MartialCapacityRow[] };
    readonly minimumEffects: number;
    readonly foundationRequired: boolean;
    /** No Maneuver exchange exists in WO5 (§14). Authored `null`; a future explicit Maneuver rule may add one. */
    readonly traitExchange: TraitExchangeRule | null;
  };
  readonly signature: {
    readonly capacityStatistic: DerivedStatistic;
    readonly defaultSlotCost: number;
    readonly exemptSlotCost: number;
    /** Explicit authored slot exemptions. A zero-slot Ability must name one of these (§47). */
    readonly exemptions: readonly SignatureExemption[];
  };
  readonly source: CoreDefinitionSource;
}

const nonNegative = (value: unknown, at: readonly PathSegment[], p: Problems, what: string): number | null => {
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < 0) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is a non-negative safe integer`);
    return null;
  }
  return n;
};

function readRows<T extends { rankKey: string }>(value: unknown, at: readonly PathSegment[], p: Problems, fields: readonly string[]): T[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    p.add(C.INVALID_PAYLOAD, at, "ranks is a non-empty array of per-rank rows");
    return null;
  }
  const before = p.count;
  const rows: T[] = [];
  value.forEach((raw: unknown, i: number) => {
    const r = readRecord(raw, [...at, i], p, C.INVALID_PAYLOAD, ["rankKey", ...fields], ["rankKey", ...fields]);
    if (r === null) return;
    const rankKey = own(r, "rankKey");
    if (!isToken(rankKey) || rows.some((x) => x.rankKey === rankKey)) {
      p.add(C.INVALID_PAYLOAD, [...at, i, "rankKey"], "rankKey is a SKILL-ladder rank token, authored once");
      return;
    }
    const row: Record<string, unknown> = { rankKey };
    for (const f of fields) row[f] = nonNegative(own(r, f), [...at, i, f], p, f);
    rows.push(row as T);
  });
  return p.count > before ? null : rows;
}

function readExchange(value: unknown, at: readonly PathSegment[], p: Problems): TraitExchangeRule | null | undefined {
  if (value === null) return null;
  const fields = ["effectSlotsPerExchange", "traitSlotsPerExchange", "minimumEffectsRemaining"];
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, fields, fields);
  if (r === null) return undefined;
  const effectSlotsPerExchange = nonNegative(own(r, "effectSlotsPerExchange"), [...at, "effectSlotsPerExchange"], p, "effectSlotsPerExchange");
  const traitSlotsPerExchange = nonNegative(own(r, "traitSlotsPerExchange"), [...at, "traitSlotsPerExchange"], p, "traitSlotsPerExchange");
  const minimumEffectsRemaining = nonNegative(own(r, "minimumEffectsRemaining"), [...at, "minimumEffectsRemaining"], p, "minimumEffectsRemaining");
  if (effectSlotsPerExchange === 0) p.add(C.INVALID_PAYLOAD, [...at, "effectSlotsPerExchange"], "an exchange gives up at least one Effect slot");
  if (effectSlotsPerExchange === null || traitSlotsPerExchange === null || minimumEffectsRemaining === null || effectSlotsPerExchange === 0) return undefined;
  return { effectSlotsPerExchange, traitSlotsPerExchange, minimumEffectsRemaining };
}

function readConstructionFormula(value: unknown, at: readonly PathSegment[], p: Problems, slot: ConstructionFormulaSlot): ConstructionFormula | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["expression", "rounding", "minimum", "variables"], ["expression", "rounding", "variables"]);
  if (r === null) return null;
  const before = p.count;
  const expression = own(r, "expression");
  const rounding = readEnum(own(r, "rounding"), ["NONE", "FLOOR", "CEIL"] as const, [...at, "rounding"], p, C.INVALID_PAYLOAD, "explicit rounding");
  const rawMin = own(r, "minimum");
  const minimum = rawMin === undefined || rawMin === null ? null : readSafeInteger(rawMin, [...at, "minimum"], p, C.INVALID_PAYLOAD, "minimum");
  const program = validateFormulaProgram({ expression, rounding: rounding ?? "NONE", minimum, maximum: null, unit: null });
  if (typeof expression !== "string" || !program.ok) {
    p.add(C.INVALID_FORMULA, [...at, "expression"], "expression must be a valid M4 Formula program (validated by @prowess/rules)");
    return null;
  }
  const raw = own(r, "variables");
  const allowed: readonly string[] = CONSTRUCTION_FORMULA_INPUTS[slot];
  const variables: string[] = [];
  if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, "variables"], "variables lists the construction inputs the expression reads");
  else
    raw.forEach((v: unknown, i: number) => {
      if (typeof v !== "string" || !allowed.includes(v) || variables.includes(v)) p.add(C.INVALID_FORMULA, [...at, "variables", i], `each variable is one of ${allowed.join(", ")}, declared once`);
      else variables.push(v);
    });
  for (const name of program.program.variables) if (!variables.includes(name)) p.add(C.INVALID_FORMULA, [...at, "variables"], `Formula variable "${name}" is not a declared construction input`);
  for (const name of variables) if (!program.program.variables.includes(name)) p.add(C.INVALID_FORMULA, [...at, "variables"], `declared variable "${name}" is not used by the expression`);
  if (p.count > before || rounding === null) return null;
  return { expression, rounding, minimum, variables };
}

/** Reads and validates an ABILITY_CONSTRUCTION_RULE payload (version 1). Rank keys are checked against the ladder at compile time. */
export function readAbilityConstructionRulePayload(value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["rankLadder", "formulas", "spell", "maneuver", "signature", "source"], ["rankLadder", "formulas", "spell", "maneuver", "signature", "source"]);
  if (r === null) return null;
  const rankLadder = own(r, "rankLadder");
  if (!isToken(rankLadder)) p.add(C.INVALID_PAYLOAD, [...at, "rankLadder"], "rankLadder is the SKILL rank ladder key");
  const fr = readRecord(own(r, "formulas"), [...at, "formulas"], p, C.INVALID_PAYLOAD, FORMULA_SLOTS, FORMULA_SLOTS);
  const formulas: Record<string, ConstructionFormula | null> = {};
  if (fr !== null) for (const slot of FORMULA_SLOTS) formulas[slot] = readConstructionFormula(own(fr, slot), [...at, "formulas", slot], p, slot);
  const skill = (value: unknown, path: readonly PathSegment[], rowFields: readonly string[]) => {
    const s = readRecord(value, path, p, C.INVALID_PAYLOAD, ["skillKey", "minimumRank", "ranks"], ["skillKey", "minimumRank", "ranks"]);
    if (s === null) return null;
    if (!isExactCanonicalKey(own(s, "skillKey"))) p.add(C.INVALID_PAYLOAD, [...path, "skillKey"], "skillKey is the exact canonical key of the Skill whose rank the track reads");
    if (!isToken(own(s, "minimumRank"))) p.add(C.INVALID_PAYLOAD, [...path, "minimumRank"], "minimumRank is a SKILL-ladder rank token");
    const ranks = readRows(own(s, "ranks"), [...path, "ranks"], p, rowFields);
    return { skillKey: own(s, "skillKey"), minimumRank: own(s, "minimumRank"), ranks };
  };

  const spellAt = [...at, "spell"];
  const sp = readRecord(own(r, "spell"), spellAt, p, C.INVALID_PAYLOAD, ["arcaneAuthority", "affinityAuthority", "castingConditions", "minimumEffects", "traitExchange"], ["arcaneAuthority", "affinityAuthority", "castingConditions", "minimumEffects", "traitExchange"]);
  let spell: Record<string, unknown> | null = null;
  if (sp !== null) {
    const arcaneAuthority = skill(own(sp, "arcaneAuthority"), [...spellAt, "arcaneAuthority"], ["effectCapacity", "traitCapacity"]);
    const aa = readRecord(own(sp, "affinityAuthority"), [...spellAt, "affinityAuthority"], p, C.INVALID_PAYLOAD, ["capacitySource"], ["capacitySource"]);
    const capacitySource = aa === null ? null : readEnum(own(aa, "capacitySource"), AFFINITY_AUTHORITY_CAPACITY_SOURCES, [...spellAt, "affinityAuthority", "capacitySource"], p, C.INVALID_PAYLOAD, "Affinity Authority capacity source");
    const cc = readRecord(own(sp, "castingConditions"), [...spellAt, "castingConditions"], p, C.INVALID_PAYLOAD, ["capacitySource", "ranks"], ["capacitySource", "ranks"]);
    const ccSource = cc === null ? null : readEnum(own(cc, "capacitySource"), CASTING_CONDITION_CAPACITY_SOURCES, [...spellAt, "castingConditions", "capacitySource"], p, C.INVALID_PAYLOAD, "Casting Condition capacity source");
    const ccRanks = cc === null ? null : readRows<ConditionCapacityRow>(own(cc, "ranks"), [...spellAt, "castingConditions", "ranks"], p, ["capacity"]);
    const minimumEffects = nonNegative(own(sp, "minimumEffects"), [...spellAt, "minimumEffects"], p, "minimumEffects");
    const traitExchange = readExchange(own(sp, "traitExchange"), [...spellAt, "traitExchange"], p);
    spell = { arcaneAuthority, affinityAuthority: { capacitySource }, castingConditions: { capacitySource: ccSource, ranks: ccRanks }, minimumEffects, traitExchange };
  }

  const manAt = [...at, "maneuver"];
  const mn = readRecord(own(r, "maneuver"), manAt, p, C.INVALID_PAYLOAD, ["martial", "minimumEffects", "foundationRequired", "traitExchange"], ["martial", "minimumEffects", "foundationRequired", "traitExchange"]);
  let maneuver: Record<string, unknown> | null = null;
  if (mn !== null) {
    const martial = skill(own(mn, "martial"), [...manAt, "martial"], ["martialRankValue", "effectCapacity", "traitCapacity", "conditionCapacity"]);
    const minimumEffects = nonNegative(own(mn, "minimumEffects"), [...manAt, "minimumEffects"], p, "minimumEffects");
    const foundationRequired = own(mn, "foundationRequired");
    if (typeof foundationRequired !== "boolean") p.add(C.INVALID_PAYLOAD, [...manAt, "foundationRequired"], "foundationRequired is an explicit boolean");
    const traitExchange = readExchange(own(mn, "traitExchange"), [...manAt, "traitExchange"], p);
    maneuver = { martial, minimumEffects, foundationRequired, traitExchange };
  }

  const sigAt = [...at, "signature"];
  const sg = readRecord(own(r, "signature"), sigAt, p, C.INVALID_PAYLOAD, ["capacityStatistic", "defaultSlotCost", "exemptSlotCost", "exemptions"], ["capacityStatistic", "defaultSlotCost", "exemptSlotCost", "exemptions"]);
  let signature: Record<string, unknown> | null = null;
  if (sg !== null) {
    const capacityStatistic = readEnum(own(sg, "capacityStatistic"), DERIVED_STATISTICS, [...sigAt, "capacityStatistic"], p, C.INVALID_PAYLOAD, "derived statistic");
    const defaultSlotCost = nonNegative(own(sg, "defaultSlotCost"), [...sigAt, "defaultSlotCost"], p, "defaultSlotCost");
    const exemptSlotCost = nonNegative(own(sg, "exemptSlotCost"), [...sigAt, "exemptSlotCost"], p, "exemptSlotCost");
    const raw = own(sg, "exemptions");
    const exemptions: SignatureExemption[] = [];
    if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...sigAt, "exemptions"], "exemptions is an array of { exemptionKey, description }");
    else
      raw.forEach((x: unknown, i: number) => {
        const e = readRecord(x, [...sigAt, "exemptions", i], p, C.INVALID_PAYLOAD, ["exemptionKey", "description"], ["exemptionKey", "description"]);
        if (e === null) return;
        const exemptionKey = own(e, "exemptionKey");
        const description = own(e, "description");
        if (!isToken(exemptionKey) || exemptions.some((y) => y.exemptionKey === exemptionKey)) p.add(C.INVALID_PAYLOAD, [...sigAt, "exemptions", i, "exemptionKey"], "exemptionKey is a unique SCREAMING_SNAKE token");
        else if (typeof description !== "string" || description.length === 0) p.add(C.INVALID_PAYLOAD, [...sigAt, "exemptions", i, "description"], "every exemption states the rule it represents");
        else exemptions.push({ exemptionKey, description });
      });
    signature = { capacityStatistic, defaultSlotCost, exemptSlotCost, exemptions };
  }
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before) return null;
  return { rankLadder, formulas, spell, maneuver, signature, source } as unknown as JsonObject;
}

// ---- Component `rules.construction` sub-contract (§38) ----------------------------------------------------------------

export type ConstructionPrerequisite =
  | { readonly prerequisiteKey: string; readonly kind: "SKILL_RANK_AT_LEAST"; readonly skillKey: string; readonly minimumRank: string }
  | { readonly prerequisiteKey: string; readonly kind: "AFFINITY_RANK_AT_LEAST"; readonly affinity: ProwessDefinitionRef; readonly minimumRank: AffinityRank };

export type StackLimit = { readonly kind: "FIXED"; readonly maximum: number } | { readonly kind: "TRACK_RANK_VALUE"; readonly track: ConstructionSkillTrack };

/**
 * The typed construction sub-contract a component Definition may author inside its existing structured `rules`
 * surface (§38): explicit prerequisites (§36–§39), explicit Effect stacking permission and limit (§52–§56), and
 * explicit Affinity access (§24). Absent → no prerequisites, not stackable, no component Affinity access.
 */
export interface ComponentConstructionRules {
  readonly prerequisites: readonly ConstructionPrerequisite[];
  readonly stacking: { readonly stackable: false } | { readonly stackable: true; readonly limit: StackLimit };
  readonly affinityAccess: readonly ProwessDefinitionRef[];
}

export const NO_COMPONENT_CONSTRUCTION_RULES: ComponentConstructionRules = Object.freeze({ prerequisites: Object.freeze([]), stacking: Object.freeze({ stackable: false as const }), affinityAccess: Object.freeze([]) });

/** Reads `rules.construction` of a component payload. Errors are Definition defects (§41), never INVALID constructions. */
export function readComponentConstructionRules(rules: JsonObject, at: readonly PathSegment[], p: Problems): ComponentConstructionRules | null {
  const raw = own(rules as Record<string, unknown>, "construction");
  if (raw === undefined) return NO_COMPONENT_CONSTRUCTION_RULES;
  const cat = [...at, "construction"];
  const r = readRecord(raw, cat, p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, ["prerequisites", "stacking", "affinityAccess"], []);
  if (r === null) return null;
  const before = p.count;

  const prerequisites: ConstructionPrerequisite[] = [];
  const rawPre = own(r, "prerequisites") ?? [];
  if (!Array.isArray(rawPre)) p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...cat, "prerequisites"], "prerequisites is an array of structured prerequisite records");
  else
    rawPre.forEach((x: unknown, i: number) => {
      const pat = [...cat, "prerequisites", i];
      if (!isPlainObject(x)) {
        p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, pat, "a prerequisite is a structured record");
        return;
      }
      const kind = readEnum(own(x, "kind"), CONSTRUCTION_PREREQUISITE_KINDS, [...pat, "kind"], p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, "prerequisite kind");
      if (kind === null) return;
      const fields = kind === "SKILL_RANK_AT_LEAST" ? ["prerequisiteKey", "kind", "skillKey", "minimumRank"] : ["prerequisiteKey", "kind", "affinity", "minimumRank"];
      const q = readRecord(x, pat, p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, fields, fields);
      if (q === null) return;
      const prerequisiteKey = own(q, "prerequisiteKey");
      if (!isToken(prerequisiteKey) || prerequisites.some((y) => y.prerequisiteKey === prerequisiteKey)) {
        p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...pat, "prerequisiteKey"], "prerequisiteKey is a unique SCREAMING_SNAKE token");
        return;
      }
      if (kind === "SKILL_RANK_AT_LEAST") {
        const skillKey = own(q, "skillKey");
        const minimumRank = own(q, "minimumRank");
        if (!isExactCanonicalKey(skillKey)) p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...pat, "skillKey"], "skillKey is an exact Skill canonical key");
        else if (!isToken(minimumRank)) p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...pat, "minimumRank"], "minimumRank is a SKILL-ladder rank token");
        else prerequisites.push({ prerequisiteKey, kind, skillKey, minimumRank });
      } else {
        const affinity = readDefinitionRef(own(q, "affinity"), [...pat, "affinity"], p, K.INVALID_COMPONENT_CONSTRUCTION_RULES);
        const minimumRank = readEnum(own(q, "minimumRank"), AFFINITY_RANKS, [...pat, "minimumRank"], p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, "Affinity Rank");
        if (affinity !== null && minimumRank !== null) prerequisites.push({ prerequisiteKey, kind, affinity, minimumRank });
      }
    });

  let stacking: ComponentConstructionRules["stacking"] = { stackable: false };
  const rawStack = own(r, "stacking");
  if (rawStack !== undefined) {
    const sat = [...cat, "stacking"];
    const s = readRecord(rawStack, sat, p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, ["stackable", "limit"], ["stackable"]);
    if (s !== null) {
      const stackable = own(s, "stackable");
      if (stackable === false) {
        if (own(s, "limit") !== undefined) p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...sat, "limit"], "a non-stackable component authors no stack limit");
      } else if (stackable === true) {
        const lat = [...sat, "limit"];
        const l = isPlainObject(own(s, "limit")) ? (own(s, "limit") as Record<string, unknown>) : null;
        const kind = l === null ? null : readEnum(own(l, "kind"), STACK_LIMIT_KINDS, [...lat, "kind"], p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, "stack limit kind");
        if (l === null) p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, lat, "a stackable component authors its explicit stack limit rule (§55); there is no default");
        else if (kind === "FIXED") {
          const f = readRecord(l, lat, p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, ["kind", "maximum"], ["kind", "maximum"]);
          const maximum = f === null ? null : readSafeInteger(own(f, "maximum"), [...lat, "maximum"], p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, "maximum stacks");
          if (maximum !== null && maximum < 1) p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...lat, "maximum"], "a stack limit is at least 1");
          else if (maximum !== null) stacking = { stackable: true, limit: { kind, maximum } };
        } else if (kind === "TRACK_RANK_VALUE") {
          const f = readRecord(l, lat, p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, ["kind", "track"], ["kind", "track"]);
          const track = f === null ? null : readEnum(own(f, "track"), CONSTRUCTION_SKILL_TRACKS, [...lat, "track"], p, K.INVALID_COMPONENT_CONSTRUCTION_RULES, "construction track");
          if (track !== null) stacking = { stackable: true, limit: { kind, track } };
        }
      } else p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...sat, "stackable"], "stackable is an explicit boolean");
    }
  }

  const affinityAccess: ProwessDefinitionRef[] = [];
  const rawAccess = own(r, "affinityAccess") ?? [];
  if (!Array.isArray(rawAccess)) p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...cat, "affinityAccess"], "affinityAccess is an array of exact AFFINITY Definition references");
  else
    rawAccess.forEach((x: unknown, i: number) => {
      const ref = readDefinitionRef(x, [...cat, "affinityAccess", i], p, K.INVALID_COMPONENT_CONSTRUCTION_RULES);
      if (ref === null) return;
      if (ref.definitionKind !== "AFFINITY") p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, [...cat, "affinityAccess", i, "definitionKind"], "Affinity access names exact AFFINITY Definitions");
      else affinityAccess.push(ref);
    });
  return p.count > before ? null : { prerequisites, stacking, affinityAccess };
}
