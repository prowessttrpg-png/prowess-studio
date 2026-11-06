import { validateRequirement, type RequirementNode } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { AFFINITY_RANKS, type AffinityRank } from "../vocabulary/affinity.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";

/**
 * Version-1 payload of ACTION_IMPROVEMENT (PAS-10 M6-WO9 Phase B, approved decision C1): an improvement to ONE exact
 * existing ACTION Definition, with its own versioned identity. It names its parent ACTION by exact EntityVersion
 * reference, its structured prerequisites, its structured modifications / additional use cases and its source.
 *
 * Additive only: ACTION Definitions and their payload contract are untouched — an ACTION never names its improvements,
 * so every historical ACTION keeps its exact behavior. Like every M5 reader this checks STRUCTURE only (no arithmetic,
 * no defaults, no prose parsing). Whether a prerequisite is met is decided by M4 Requirements against the Character
 * (character/action-improvement.ts); whether a modification can be applied is decided there against the EXISTING
 * ACTION contract — an operation no existing rule evaluates is reported UNSUPPORTED, never executed.
 */

export const ACTION_IMPROVEMENT_PAYLOAD_KINDS = Object.freeze(["ACTION_IMPROVEMENT"] as const);
export type ActionImprovementPayloadKind = (typeof ACTION_IMPROVEMENT_PAYLOAD_KINDS)[number];
export const isActionImprovementPayloadKind = (kind: string): kind is ActionImprovementPayloadKind => (ACTION_IMPROVEMENT_PAYLOAD_KINDS as readonly string[]).includes(kind);

/** The structured prerequisite grammar. Each is evaluated independently through an M4 Requirement. */
export const ACTION_IMPROVEMENT_PREREQUISITE_KINDS = Object.freeze(["LEVEL_AT_LEAST", "STAT_AT_LEAST", "SKILL_RANK_AT_LEAST", "AFFINITY_RANK_AT_LEAST"] as const);
export type ActionImprovementPrerequisiteKind = (typeof ACTION_IMPROVEMENT_PREREQUISITE_KINDS)[number];

/**
 * The structured modification grammar:
 * - ACTION_POINT_COST — an explicit FIXED AP cost replacing the parent's (applicable only where the parent ACTION's
 *   existing contract already permits an explicit-rule cost override: a FIXED cost with costOverridableByExplicitRule);
 * - ADDITIONAL_USE_CASE — an additional authored use case of the Action (presented; never executed by the Studio);
 * - RULE_OPERATION — any other authored operation. No existing rule evaluates it, so it is always UNSUPPORTED.
 */
export const ACTION_IMPROVEMENT_MODIFICATION_KINDS = Object.freeze(["ACTION_POINT_COST", "ADDITIONAL_USE_CASE", "RULE_OPERATION"] as const);
export type ActionImprovementModificationKind = (typeof ACTION_IMPROVEMENT_MODIFICATION_KINDS)[number];

export type ActionImprovementPrerequisite =
  | { readonly prerequisiteKey: string; readonly kind: "LEVEL_AT_LEAST"; readonly minimum: number }
  | { readonly prerequisiteKey: string; readonly kind: "STAT_AT_LEAST"; readonly stat: ProwessStat; readonly minimum: number }
  | { readonly prerequisiteKey: string; readonly kind: "SKILL_RANK_AT_LEAST"; readonly skillKey: string; readonly minimumRank: string }
  | { readonly prerequisiteKey: string; readonly kind: "AFFINITY_RANK_AT_LEAST"; readonly affinity: ProwessDefinitionRef; readonly minimumRank: AffinityRank };

interface ModificationCommon {
  readonly modificationKey: string;
  /** Authored rules text shown with the modification. Presentation only — never parsed. */
  readonly rulesText: string;
  /** A validated M4 Requirement limiting WHEN the modification applies; null = whenever the Action is used. */
  readonly condition: RequirementNode | null;
}

export type ActionImprovementModification =
  | (ModificationCommon & { readonly kind: "ACTION_POINT_COST"; readonly actionPointCost: { readonly model: "FIXED"; readonly amount: number } })
  | (ModificationCommon & { readonly kind: "ADDITIONAL_USE_CASE"; readonly useCaseKey: string })
  | (ModificationCommon & { readonly kind: "RULE_OPERATION"; readonly operationKey: string; readonly data: JsonObject });

export interface ActionImprovementPayload {
  readonly improvementKey: string;
  /** The exact parent ACTION EntityVersion this improvement modifies. */
  readonly action: ProwessDefinitionRef;
  readonly rulesText: string;
  readonly prerequisites: readonly ActionImprovementPrerequisite[];
  readonly modifications: readonly ActionImprovementModification[];
  readonly source: CoreDefinitionSource;
}

const FIELDS = ["improvementKey", "action", "rulesText", "prerequisites", "modifications", "source"];
const MODIFICATION_FIELDS: Readonly<Record<ActionImprovementModificationKind, readonly string[]>> = {
  ACTION_POINT_COST: ["modificationKey", "kind", "rulesText", "condition", "actionPointCost"],
  ADDITIONAL_USE_CASE: ["modificationKey", "kind", "rulesText", "condition", "useCaseKey"],
  RULE_OPERATION: ["modificationKey", "kind", "rulesText", "condition", "operationKey", "data"],
};
const PREREQUISITE_FIELDS: Readonly<Record<ActionImprovementPrerequisiteKind, readonly string[]>> = {
  LEVEL_AT_LEAST: ["prerequisiteKey", "kind", "minimum"],
  STAT_AT_LEAST: ["prerequisiteKey", "kind", "stat", "minimum"],
  SKILL_RANK_AT_LEAST: ["prerequisiteKey", "kind", "skillKey", "minimumRank"],
  AFFINITY_RANK_AT_LEAST: ["prerequisiteKey", "kind", "affinity", "minimumRank"],
};
/** Input validation only: a Level is a positive integer; a Stat score and an AP cost are never negative. */
const FIRST_LEVEL = 1;
const NO_AMOUNT = 0;
const MAX_TEXT = 4000;

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_TEXT && v.trim() === v;

function readText(value: unknown, at: readonly PathSegment[], p: Problems, what: string): string | null {
  if (isText(value)) return value;
  p.add(C.INVALID_PAYLOAD, at, `${what} is non-empty, trimmed text`);
  return null;
}
function readAtLeast(value: unknown, at: readonly PathSegment[], p: Problems, what: string, minimum: number): number | null {
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < minimum) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is at least ${minimum}`);
    return null;
  }
  return n;
}
function readUniqueToken(value: unknown, taken: readonly string[], at: readonly PathSegment[], p: Problems, what: string): string | null {
  if (isToken(value) && !taken.includes(value)) return value;
  p.add(C.INVALID_PAYLOAD, at, `${what} is a unique SCREAMING_SNAKE token`);
  return null;
}
function readCondition(value: unknown, at: readonly PathSegment[], p: Problems): RequirementNode | null | undefined {
  if (value === null) return null;
  const out = validateRequirement(value);
  if (out.ok) return out.requirement;
  p.add(C.INVALID_PAYLOAD, at, "condition is null or a validated M4 Requirement; prose is inert");
  return undefined;
}

function readPrerequisite(x: unknown, taken: readonly string[], at: readonly PathSegment[], p: Problems): ActionImprovementPrerequisite | null {
  if (!isPlainObject(x)) {
    p.add(C.INVALID_PAYLOAD, at, "a prerequisite is a structured record");
    return null;
  }
  const kind = readEnum(own(x, "kind"), ACTION_IMPROVEMENT_PREREQUISITE_KINDS, [...at, "kind"], p, C.INVALID_PAYLOAD, "prerequisite kind");
  if (kind === null) return null;
  const fields = PREREQUISITE_FIELDS[kind];
  const q = readRecord(x, at, p, C.INVALID_PAYLOAD, fields, fields);
  if (q === null) return null;
  const prerequisiteKey = readUniqueToken(own(q, "prerequisiteKey"), taken, [...at, "prerequisiteKey"], p, "prerequisiteKey");
  if (prerequisiteKey === null) return null;
  if (kind === "LEVEL_AT_LEAST") {
    const minimum = readAtLeast(own(q, "minimum"), [...at, "minimum"], p, "minimum Level", FIRST_LEVEL);
    return minimum === null ? null : { prerequisiteKey, kind, minimum };
  }
  if (kind === "STAT_AT_LEAST") {
    const stat = readEnum(own(q, "stat"), PROWESS_STATS, [...at, "stat"], p, C.INVALID_PAYLOAD, "Stat");
    const minimum = readAtLeast(own(q, "minimum"), [...at, "minimum"], p, "minimum Stat score", NO_AMOUNT);
    return stat === null || minimum === null ? null : { prerequisiteKey, kind, stat, minimum };
  }
  if (kind === "SKILL_RANK_AT_LEAST") {
    const skillKey = own(q, "skillKey");
    const minimumRank = own(q, "minimumRank");
    if (!isExactCanonicalKey(skillKey)) p.add(C.INVALID_PAYLOAD, [...at, "skillKey"], "skillKey is an exact Skill canonical key");
    else if (!isToken(minimumRank)) p.add(C.INVALID_PAYLOAD, [...at, "minimumRank"], "minimumRank is a SKILL-ladder rank token");
    else return { prerequisiteKey, kind, skillKey, minimumRank };
    return null;
  }
  const affinity = readDefinitionRef(own(q, "affinity"), [...at, "affinity"], p, C.INVALID_PAYLOAD);
  const minimumRank = readEnum(own(q, "minimumRank"), AFFINITY_RANKS, [...at, "minimumRank"], p, C.INVALID_PAYLOAD, "Affinity Rank");
  if (affinity !== null && affinity.definitionKind !== "AFFINITY") p.add(C.INVALID_PAYLOAD, [...at, "affinity", "definitionKind"], "an Affinity prerequisite names an exact AFFINITY Definition");
  return affinity === null || minimumRank === null || affinity.definitionKind !== "AFFINITY" ? null : { prerequisiteKey, kind, affinity, minimumRank };
}

function readModification(x: unknown, taken: readonly string[], at: readonly PathSegment[], p: Problems): ActionImprovementModification | null {
  if (!isPlainObject(x)) {
    p.add(C.INVALID_PAYLOAD, at, "a modification is a structured record");
    return null;
  }
  const kind = readEnum(own(x, "kind"), ACTION_IMPROVEMENT_MODIFICATION_KINDS, [...at, "kind"], p, C.INVALID_PAYLOAD, "modification kind");
  if (kind === null) return null;
  const fields = MODIFICATION_FIELDS[kind];
  const m = readRecord(x, at, p, C.INVALID_PAYLOAD, fields, fields);
  if (m === null) return null;
  const before = p.count;
  const modificationKey = readUniqueToken(own(m, "modificationKey"), taken, [...at, "modificationKey"], p, "modificationKey");
  const rulesText = readText(own(m, "rulesText"), [...at, "rulesText"], p, "rulesText");
  const condition = readCondition(own(m, "condition"), [...at, "condition"], p);
  if (kind === "ACTION_POINT_COST") {
    const cat = [...at, "actionPointCost"];
    const c = readRecord(own(m, "actionPointCost"), cat, p, C.INVALID_PAYLOAD, ["model", "amount"], ["model", "amount"]);
    const model = c === null ? null : readEnum(own(c, "model"), ["FIXED"] as const, [...cat, "model"], p, C.INVALID_PAYLOAD, "improved AP cost model");
    const amount = c === null ? null : readAtLeast(own(c, "amount"), [...cat, "amount"], p, "AP amount", NO_AMOUNT);
    if (p.count > before || modificationKey === null || rulesText === null || condition === undefined || model === null || amount === null) return null;
    return { modificationKey, kind, rulesText, condition, actionPointCost: { model, amount } };
  }
  if (kind === "ADDITIONAL_USE_CASE") {
    const useCaseKey = isToken(own(m, "useCaseKey")) ? (own(m, "useCaseKey") as string) : (p.add(C.INVALID_PAYLOAD, [...at, "useCaseKey"], "useCaseKey is a SCREAMING_SNAKE token"), null);
    if (p.count > before || modificationKey === null || rulesText === null || condition === undefined || useCaseKey === null) return null;
    return { modificationKey, kind, rulesText, condition, useCaseKey };
  }
  const operationKey = isToken(own(m, "operationKey")) ? (own(m, "operationKey") as string) : (p.add(C.INVALID_PAYLOAD, [...at, "operationKey"], "operationKey is a SCREAMING_SNAKE token"), null);
  const data = isPlainObject(own(m, "data")) ? (own(m, "data") as JsonObject) : (p.add(C.INVALID_PAYLOAD, [...at, "data"], "data is a plain object of authored data"), null);
  if (p.count > before || modificationKey === null || rulesText === null || condition === undefined || operationKey === null || data === null) return null;
  return { modificationKey, kind, rulesText, condition, operationKey, data };
}

/** Validates `value` as the version-1 ACTION_IMPROVEMENT payload (the caller checked the version). */
export function readActionImprovementPayload(_kind: ActionImprovementPayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS, FIELDS);
  if (r === null) return null;
  const before = p.count;
  const improvementKey = isToken(own(r, "improvementKey")) ? (own(r, "improvementKey") as string) : (p.add(C.INVALID_PAYLOAD, [...at, "improvementKey"], "improvementKey is a SCREAMING_SNAKE token"), null);
  const action = readDefinitionRef(own(r, "action"), [...at, "action"], p, C.INVALID_PAYLOAD);
  if (action !== null && action.definitionKind !== "ACTION") p.add(C.INVALID_PAYLOAD, [...at, "action", "definitionKind"], "an Action Improvement names exactly one ACTION Definition as its parent");
  const rulesText = readText(own(r, "rulesText"), [...at, "rulesText"], p, "rulesText");

  const prerequisites: ActionImprovementPrerequisite[] = [];
  const rawPre = own(r, "prerequisites");
  if (!Array.isArray(rawPre)) p.add(C.INVALID_PAYLOAD, [...at, "prerequisites"], "prerequisites is an array of structured prerequisite records (empty = none)");
  else
    rawPre.forEach((x: unknown, i: number) => {
      const q = readPrerequisite(x, prerequisites.map((y) => y.prerequisiteKey), [...at, "prerequisites", i], p);
      if (q !== null) prerequisites.push(q);
    });

  const modifications: ActionImprovementModification[] = [];
  const rawMod = own(r, "modifications");
  if (!Array.isArray(rawMod) || rawMod.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "modifications"], "modifications is a non-empty array of structured modification records");
  else
    rawMod.forEach((x: unknown, i: number) => {
      const m = readModification(x, modifications.map((y) => y.modificationKey), [...at, "modifications", i], p);
      if (m !== null) modifications.push(m);
    });

  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || improvementKey === null || action === null || rulesText === null || source === null) return null;
  return { improvementKey, action, rulesText, prerequisites, modifications, source } satisfies ActionImprovementPayload as unknown as JsonObject;
}
