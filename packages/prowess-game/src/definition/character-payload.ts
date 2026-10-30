import type { JsonObject } from "@prowess/model";
import type { PathSegment } from "../internal/plain-data.js";
import { Problems, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import { ANCESTRY_SKILL_SELECTION_KINDS, ANCESTRY_STAT_GRANT_KINDS, type AncestrySkillSelectionKind } from "../vocabulary/character.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";

/**
 * Version-1 payload contracts of the character-facing Definition kinds activated by PAS-10 M6-WO3: ANCESTRY, SKILL and
 * CHARACTER_CREATION_RULE. Like every M5 reader they check structure, closed vocabularies and exact references only —
 * no arithmetic, no defaults, no game legality. Narrative racial features and Skill prose stay revision content (Rules
 * Text); only what Character creation reads is structured here.
 */

/** A fixed Ancestry Stat adjustment (e.g. +2 STR). */
export interface AncestryFixedStatGrant {
  readonly grantKey: string;
  readonly kind: "FIXED";
  readonly stat: ProwessStat;
  readonly amount: number;
}

/** A player choice: `amount` to each of `count` DIFFERENT Stats from `allowedStats` (e.g. +1 to any two). */
export interface AncestryChoiceStatGrant {
  readonly grantKey: string;
  readonly kind: "CHOOSE_DISTINCT";
  readonly count: number;
  readonly amount: number;
  readonly allowedStats: readonly ProwessStat[];
}

export type AncestryStatGrant = AncestryFixedStatGrant | AncestryChoiceStatGrant;

/** Starting Skill training granted by an Ancestry. Options are exact SKILL Definition references. */
export interface AncestrySkillGrant {
  readonly grantKey: string;
  /** The exact rank key on the Release's Skill rank ladder the granted Skills start at (e.g. TRAINED). */
  readonly rankKey: string;
  readonly selectionKind: AncestrySkillSelectionKind;
  readonly count: number;
  readonly options: readonly ProwessDefinitionRef[];
}

export interface AncestryDefinitionPayload {
  readonly baseHp: number;
  readonly baseMp: number;
  readonly statGrants: readonly AncestryStatGrant[];
  readonly skillGrants: readonly AncestrySkillGrant[];
  readonly source: CoreDefinitionSource;
}

/** A Skill's minimal structured identity: the rank ladder it is trained on. Skill Actions evolve separately. */
export interface SkillDefinitionPayload {
  readonly ladderKey: string;
  readonly source: CoreDefinitionSource;
}

/** The Level-1 creation values not already supplied by STAT / DERIVED_STAT / rank content. */
export interface CharacterCreationRulePayload {
  readonly startingLevel: number;
  readonly statPointBudget: number;
  readonly freeTrainedSkillCount: number;
  /** The exact Skill rank key free starting Skills receive (e.g. TRAINED) — a rank of the Release's Skill ladder. */
  readonly startingSkillRankKey: string;
  readonly requiredAncestryCount: number;
  readonly requiredPrimaryAffinityCount: number;
  readonly source: CoreDefinitionSource;
}

export const CHARACTER_PAYLOAD_KINDS = Object.freeze(["ANCESTRY", "SKILL", "CHARACTER_CREATION_RULE"] as const);
export type CharacterPayloadKind = (typeof CHARACTER_PAYLOAD_KINDS)[number];
export const isCharacterPayloadKind = (kind: string): kind is CharacterPayloadKind => (CHARACTER_PAYLOAD_KINDS as readonly string[]).includes(kind);

const GRANT_KEY = /^[a-z][a-z0-9_]{0,63}$/;

function readCount(value: unknown, at: readonly PathSegment[], p: Problems, what: string, minimum: number): number | null {
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < minimum) {
    p.add(C.INVALID_PAYLOAD, at, `${what} must be at least ${minimum}`);
    return null;
  }
  return n;
}

function readGrantKey(value: unknown, at: readonly PathSegment[], p: Problems, seen: Set<string>): string | null {
  if (typeof value !== "string" || !GRANT_KEY.test(value)) {
    p.add(C.INVALID_PAYLOAD, at, "grantKey is a stable lowercase key");
    return null;
  }
  if (seen.has(value)) {
    p.add(C.INVALID_PAYLOAD, at, `grantKey ${value} is used twice in this Ancestry`);
    return null;
  }
  seen.add(value);
  return value;
}

function readStatGrant(value: unknown, at: readonly PathSegment[], p: Problems, seen: Set<string>): AncestryStatGrant | null {
  const head = readRecord(value, at, p, C.INVALID_PAYLOAD, ["grantKey", "kind", "stat", "count", "amount", "allowedStats"], ["grantKey", "kind", "amount"]);
  if (head === null) return null;
  const before = p.count;
  const grantKey = readGrantKey(own(head, "grantKey"), [...at, "grantKey"], p, seen);
  const kind = readEnum(own(head, "kind"), ANCESTRY_STAT_GRANT_KINDS, [...at, "kind"], p, C.INVALID_PAYLOAD, "Stat grant kind");
  const amount = readSafeInteger(own(head, "amount"), [...at, "amount"], p, C.INVALID_PAYLOAD, "amount");
  if (amount === 0) p.add(C.INVALID_PAYLOAD, [...at, "amount"], "a Stat grant changes a Stat (amount is never 0)");
  if (kind === "FIXED") {
    const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["grantKey", "kind", "stat", "amount"], ["grantKey", "kind", "stat", "amount"]);
    const stat = r === null ? null : readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, C.INVALID_PAYLOAD, "Stat");
    if (p.count > before) return null;
    return { grantKey: grantKey as string, kind, stat: stat as ProwessStat, amount: amount as number };
  }
  if (kind === "CHOOSE_DISTINCT") {
    const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["grantKey", "kind", "count", "amount", "allowedStats"], ["grantKey", "kind", "count", "amount", "allowedStats"]);
    if (r === null) return null;
    const count = readCount(own(r, "count"), [...at, "count"], p, "count", 1);
    const raw = own(r, "allowedStats");
    const allowed: ProwessStat[] = [];
    if (!Array.isArray(raw) || raw.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "allowedStats"], "allowedStats is a non-empty array of Stats");
    else
      raw.forEach((s: unknown, i: number) => {
        const stat = readEnum(s, PROWESS_STATS, [...at, "allowedStats", i], p, C.INVALID_PAYLOAD, "Stat");
        if (stat === null) return;
        if (allowed.includes(stat)) p.add(C.INVALID_PAYLOAD, [...at, "allowedStats", i], `${stat} is listed twice`);
        else allowed.push(stat);
      });
    if (count !== null && allowed.length > 0 && count > allowed.length) p.add(C.INVALID_PAYLOAD, [...at, "count"], `count ${count} exceeds the ${allowed.length} allowed Stats (choices are distinct)`);
    if (p.count > before) return null;
    return { grantKey: grantKey as string, kind, count: count as number, amount: amount as number, allowedStats: [...allowed] };
  }
  return null;
}

function readSkillGrant(value: unknown, at: readonly PathSegment[], p: Problems, seen: Set<string>): AncestrySkillGrant | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["grantKey", "rankKey", "selectionKind", "count", "options"], ["grantKey", "rankKey", "selectionKind", "count", "options"]);
  if (r === null) return null;
  const before = p.count;
  const grantKey = readGrantKey(own(r, "grantKey"), [...at, "grantKey"], p, seen);
  const rankKey = own(r, "rankKey");
  if (!isToken(rankKey)) p.add(C.INVALID_PAYLOAD, [...at, "rankKey"], "rankKey is an exact rank token of the Skill rank ladder");
  const selectionKind = readEnum(own(r, "selectionKind"), ANCESTRY_SKILL_SELECTION_KINDS, [...at, "selectionKind"], p, C.INVALID_PAYLOAD, "Skill selection kind");
  const count = readCount(own(r, "count"), [...at, "count"], p, "count", 1);
  const raw = own(r, "options");
  const options: ProwessDefinitionRef[] = [];
  if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, "options"], "options is an array of exact SKILL Definition references");
  else
    raw.forEach((v: unknown, i: number) => {
      const ref = readDefinitionRef(v, [...at, "options", i], p, C.INVALID_PAYLOAD);
      if (ref === null) return;
      if (ref.definitionKind !== "SKILL") p.add(C.INVALID_PAYLOAD, [...at, "options", i, "definitionKind"], "an Ancestry Skill option is an exact SKILL Definition");
      else if (options.some((o) => o.entityId === ref.entityId)) p.add(C.INVALID_PAYLOAD, [...at, "options", i], "the same Skill is offered twice");
      else options.push(ref);
    });
  if (selectionKind === "CHOOSE_ANY" && options.length > 0) p.add(C.INVALID_PAYLOAD, [...at, "options"], "a CHOOSE_ANY grant lists no options (any published SKILL of the Release)");
  if (selectionKind === "FIXED" && count !== null && count !== options.length) p.add(C.INVALID_PAYLOAD, [...at, "count"], "a FIXED grant's count equals its number of options");
  if (selectionKind === "CHOOSE_FROM" && count !== null && options.length < count) p.add(C.INVALID_PAYLOAD, [...at, "options"], `a CHOOSE_FROM grant offers at least ${count} options`);
  if (p.count > before) return null;
  return { grantKey: grantKey as string, rankKey: rankKey as string, selectionKind: selectionKind as AncestrySkillSelectionKind, count: count as number, options };
}

function readAncestry(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): AncestryDefinitionPayload | null {
  const before = p.count;
  const baseHp = readCount(own(r, "baseHp"), [...at, "baseHp"], p, "baseHp", 0);
  const baseMp = readCount(own(r, "baseMp"), [...at, "baseMp"], p, "baseMp", 0);
  const seen = new Set<string>();
  const list = <T,>(field: string, read: (v: unknown, a: readonly PathSegment[], pp: Problems, s: Set<string>) => T | null): T[] => {
    const raw = own(r, field);
    const out: T[] = [];
    if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, field], `${field} is an array`);
    else raw.forEach((v: unknown, i: number) => {
      const g = read(v, [...at, field, i], p, seen);
      if (g !== null) out.push(g);
    });
    return out;
  };
  const statGrants = list("statGrants", readStatGrant);
  const skillGrants = list("skillGrants", readSkillGrant);
  const fixedStats = statGrants.filter((g): g is AncestryFixedStatGrant => g.kind === "FIXED").map((g) => g.stat);
  if (new Set(fixedStats).size !== fixedStats.length) p.add(C.INVALID_PAYLOAD, [...at, "statGrants"], "a Stat receives at most one FIXED grant");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before) return null;
  return { baseHp: baseHp as number, baseMp: baseMp as number, statGrants, skillGrants, source: source as CoreDefinitionSource };
}

function readSkill(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): SkillDefinitionPayload | null {
  const before = p.count;
  const ladderKey = own(r, "ladderKey");
  if (!isToken(ladderKey)) p.add(C.INVALID_PAYLOAD, [...at, "ladderKey"], "ladderKey is the exact rank-ladder token this Skill is trained on");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before) return null;
  return { ladderKey: ladderKey as string, source: source as CoreDefinitionSource };
}

function readCreationRule(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): CharacterCreationRulePayload | null {
  const before = p.count;
  const startingLevel = readCount(own(r, "startingLevel"), [...at, "startingLevel"], p, "startingLevel", 1);
  const statPointBudget = readCount(own(r, "statPointBudget"), [...at, "statPointBudget"], p, "statPointBudget", 0);
  const freeTrainedSkillCount = readCount(own(r, "freeTrainedSkillCount"), [...at, "freeTrainedSkillCount"], p, "freeTrainedSkillCount", 0);
  const startingSkillRankKey = own(r, "startingSkillRankKey");
  if (!isToken(startingSkillRankKey)) p.add(C.INVALID_PAYLOAD, [...at, "startingSkillRankKey"], "startingSkillRankKey is an exact rank token of the Skill rank ladder");
  // Version 1 builds a Character with exactly one Ancestry and one Primary Affinity; the counts are stated, not assumed.
  for (const field of ["requiredAncestryCount", "requiredPrimaryAffinityCount"]) {
    const n = readSafeInteger(own(r, field), [...at, field], p, C.INVALID_PAYLOAD, field);
    if (n !== null && n !== 1) p.add(C.INVALID_PAYLOAD, [...at, field], `${field} is exactly 1 in CHARACTER_CREATION_RULE version 1`);
  }
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before) return null;
  return {
    startingLevel: startingLevel as number,
    statPointBudget: statPointBudget as number,
    freeTrainedSkillCount: freeTrainedSkillCount as number,
    startingSkillRankKey: startingSkillRankKey as string,
    requiredAncestryCount: 1,
    requiredPrimaryAffinityCount: 1,
    source: source as CoreDefinitionSource,
  };
}

const FIELDS: Readonly<Record<CharacterPayloadKind, readonly string[]>> = {
  ANCESTRY: ["baseHp", "baseMp", "statGrants", "skillGrants", "source"],
  SKILL: ["ladderKey", "source"],
  CHARACTER_CREATION_RULE: ["startingLevel", "statPointBudget", "freeTrainedSkillCount", "startingSkillRankKey", "requiredAncestryCount", "requiredPrimaryAffinityCount", "source"],
};

/** Validates `value` as the version-1 payload of a character-facing kind (the caller checked the version). */
export function readCharacterPayload(kind: CharacterPayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS[kind], FIELDS[kind]);
  if (r === null) return null;
  const readers = { ANCESTRY: readAncestry, SKILL: readSkill, CHARACTER_CREATION_RULE: readCreationRule } as const;
  return readers[kind](r, at, p) as unknown as JsonObject | null;
}
