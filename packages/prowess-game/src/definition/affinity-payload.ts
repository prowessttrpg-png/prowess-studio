import type { JsonObject } from "@prowess/model";
import type { PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, isExactLabel, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { CANONICAL_AFFINITIES, type CanonicalAffinity } from "../vocabulary/construction.js";
import {
  AFFINITY_ADVANCEMENT_ACTIONS,
  AFFINITY_PROGRESSION_MODES,
  AFFINITY_RANKS,
  AFFINITY_RANK_UP_TARGETS,
  AFFINITY_ROLES,
  AFFINITY_WEAKNESS_SEVERITIES,
  type AffinityProgressionMode,
  type AffinityRank,
  type AffinityRankUpTarget,
  type AffinityRole,
  type AffinityWeaknessSeverity,
} from "../vocabulary/affinity.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";

/**
 * Affinity payload contracts (PAS-10 M5-WO4 §25, §33, §53–§60, §145). Every number below is authored content — the
 * readers check structure, closed vocabularies, uniqueness and finiteness only. They perform no arithmetic and never
 * branch on an Affinity identity: a future Affinity Version that changes a Keyword, a percentage or a rank value is
 * read by exactly the same code (§144).
 *
 * AFFINITY schema history: version 1 (M5-WO1) is the identity-only payload `{ affinity }`; version 2 (M5-WO4) is the
 * full rule content below. Version 1 stays valid — WO1 history is never rewritten — but only version 2 is executable.
 */

/** One Strength: the Ability is aligned when ANY of these exact Keyword canonical keys is present (§53, §148). */
export interface AffinityStrengthRule {
  readonly strengthKey: string;
  readonly matchAny: readonly string[];
}

/**
 * One Weakness (§55–§60). `activationPenaltyPercent` is the exact authored penalty — never derived from `severity`,
 * which is an optional reference label (null when the exact value is not on the standard scale, e.g. Divination's
 * Persistent Effects +15%).
 */
export interface AffinityWeaknessRule {
  readonly weaknessKey: string;
  readonly matchAny: readonly string[];
  readonly activationPenaltyPercent: number;
  readonly severity: AffinityWeaknessSeverity | null;
}

/** AFFINITY v2 — one canonical Affinity's identity and Strength / Weakness tables (§25, §70–§75). */
export interface AffinityDefinitionV2Payload {
  readonly affinity: CanonicalAffinity;
  /** Descriptive identity prose — never a mechanical Keyword (§147). */
  readonly identity: { readonly text: string; readonly themes: readonly string[] };
  readonly strengths: readonly AffinityStrengthRule[];
  readonly weaknesses: readonly AffinityWeaknessRule[];
  readonly source: CoreDefinitionSource;
}

/** One Affinity Rank's meaning (§33–§38). `authority` null = the rank grants no Affinity Authority capacity. */
export interface AffinityRankEntry {
  readonly rank: AffinityRank;
  /** The explicit rank order (§31, §123) — compared as data by M4 RANK_AT_LEAST, never as a string. */
  readonly order: number;
  readonly strengthDiscountPercent: number;
  readonly authority: { readonly effectCapacity: number; readonly traitCapacity: number } | null;
}

/** AFFINITY_RANK_RULE v1 — the versioned Affinity Rank table (§33). */
export interface AffinityRankRulePayload {
  readonly ranks: readonly AffinityRankEntry[];
  /** The lowest rank that may govern Affinity Authority (§107). */
  readonly authorityMinimumRank: AffinityRank;
  readonly source: CoreDefinitionSource;
}

/** AFFINITY_WEAKNESS_SEVERITY v1 — the standard severity reference scale (s686, §57). Reference only. */
export interface AffinityWeaknessSeverityPayload {
  readonly severities: readonly { readonly severity: AffinityWeaknessSeverity; readonly percent: number }[];
  readonly source: CoreDefinitionSource;
}

export type AffinityAdvancementOption =
  | { readonly optionKey: string; readonly action: "CHOOSE_PRIMARY_AFFINITY"; readonly startingRank: AffinityRank }
  | { readonly optionKey: string; readonly action: "RANK_UP"; readonly target: AffinityRankUpTarget; readonly from: AffinityRank; readonly to: AffinityRank }
  | {
      readonly optionKey: string;
      readonly action: "GAIN_AFFINITY";
      readonly role: AffinityRole;
      /** null = the starting rank is unresolved canon; the option is exposed structurally but never executed (§160). */
      readonly startingRank: AffinityRank | null;
      readonly conflictKey: string | null;
    };

export interface AffinityProgressionLevel {
  readonly level: number;
  readonly mode: AffinityProgressionMode;
  readonly options: readonly AffinityAdvancementOption[];
}

/** AFFINITY_PROGRESSION v1 — standard Affinity advancement (s118, s161, §39–§52). Explicit choices, never inferred. */
export interface AffinityProgressionPayload {
  readonly levels: readonly AffinityProgressionLevel[];
  readonly source: CoreDefinitionSource;
}

export const AFFINITY_PAYLOAD_KINDS = Object.freeze(["AFFINITY_RANK_RULE", "AFFINITY_WEAKNESS_SEVERITY", "AFFINITY_PROGRESSION"] as const);
export type AffinityPayloadKind = (typeof AFFINITY_PAYLOAD_KINDS)[number];
export const isAffinityPayloadKind = (kind: string): kind is AffinityPayloadKind => (AFFINITY_PAYLOAD_KINDS as readonly string[]).includes(kind);

const SOURCE_CONFLICT = /^M5-SC-\d{3}$/;
/** Structural validation only: Character Levels start at 1. */
const FIRST_CHARACTER_LEVEL = 1;

/** A finite, non-negative authored percentage (§162–§164). 0 is legal; no upper bound is imposed. */
function readPercent(value: unknown, at: readonly PathSegment[], p: Problems, what: string): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is a finite, non-negative authored percentage (0 is legal; no maximum is imposed)`);
    return null;
  }
  return value;
}

function readKeywordList(value: unknown, at: readonly PathSegment[], p: Problems): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every((k: unknown) => isExactCanonicalKey(k)) || new Set(value).size !== value.length) {
    p.add(C.INVALID_PAYLOAD, at, "matchAny is a non-empty, duplicate-free array of exact Keyword canonical keys");
    return null;
  }
  return [...(value as string[])];
}

function uniqueKeys<T>(items: readonly T[], key: (t: T) => string, at: readonly PathSegment[], p: Problems, what: string): void {
  if (new Set(items.map(key)).size !== items.length) p.add(C.INVALID_PAYLOAD, at, `each ${what} is unique`);
}

function readStrengths(value: unknown, at: readonly PathSegment[], p: Problems): AffinityStrengthRule[] | null {
  if (!Array.isArray(value)) {
    p.add(C.INVALID_PAYLOAD, at, "strengths is an array of { strengthKey, matchAny }");
    return null;
  }
  const out: AffinityStrengthRule[] = [];
  value.forEach((raw: unknown, i: number) => {
    const r = readRecord(raw, [...at, i], p, C.INVALID_PAYLOAD, ["strengthKey", "matchAny"], ["strengthKey", "matchAny"]);
    if (r === null) return;
    const strengthKey = own(r, "strengthKey");
    if (!isToken(strengthKey)) p.add(C.INVALID_PAYLOAD, [...at, i, "strengthKey"], "strengthKey is a SCREAMING_SNAKE token");
    const matchAny = readKeywordList(own(r, "matchAny"), [...at, i, "matchAny"], p);
    if (isToken(strengthKey) && matchAny !== null) out.push({ strengthKey, matchAny });
  });
  uniqueKeys(out, (s) => s.strengthKey, at, p, "strengthKey");
  return out;
}

function readWeaknesses(value: unknown, at: readonly PathSegment[], p: Problems): AffinityWeaknessRule[] | null {
  if (!Array.isArray(value)) {
    p.add(C.INVALID_PAYLOAD, at, "weaknesses is an array of { weaknessKey, matchAny, activationPenaltyPercent, severity }");
    return null;
  }
  const fields = ["weaknessKey", "matchAny", "activationPenaltyPercent", "severity"];
  const out: AffinityWeaknessRule[] = [];
  value.forEach((raw: unknown, i: number) => {
    const r = readRecord(raw, [...at, i], p, C.INVALID_PAYLOAD, fields, fields);
    if (r === null) return;
    const weaknessKey = own(r, "weaknessKey");
    if (!isToken(weaknessKey)) p.add(C.INVALID_PAYLOAD, [...at, i, "weaknessKey"], "weaknessKey is a SCREAMING_SNAKE token");
    const matchAny = readKeywordList(own(r, "matchAny"), [...at, i, "matchAny"], p);
    const percent = readPercent(own(r, "activationPenaltyPercent"), [...at, i, "activationPenaltyPercent"], p, "activationPenaltyPercent");
    const rawSeverity = own(r, "severity");
    const severity = rawSeverity === null ? null : readEnum(rawSeverity, AFFINITY_WEAKNESS_SEVERITIES, [...at, i, "severity"], p, C.INVALID_PAYLOAD, "Weakness severity (or null)");
    if (isToken(weaknessKey) && matchAny !== null && percent !== null && (rawSeverity === null || severity !== null)) out.push({ weaknessKey, matchAny, activationPenaltyPercent: percent, severity });
  });
  uniqueKeys(out, (w) => w.weaknessKey, at, p, "weaknessKey");
  return out;
}

const AFFINITY_V2_FIELDS = ["affinity", "identity", "strengths", "weaknesses", "source"];

/** AFFINITY version 2 (§25). The canonical identity is already checked against legacy terminology by the caller. */
export function readAffinityDefinitionPayload(value: unknown, at: readonly PathSegment[], p: Problems): AffinityDefinitionV2Payload | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, AFFINITY_V2_FIELDS, AFFINITY_V2_FIELDS);
  if (r === null) return null;
  const before = p.count;
  const affinity = readEnum(own(r, "affinity"), CANONICAL_AFFINITIES, [...at, "affinity"], p, C.INVALID_PAYLOAD, "canonical Affinity");
  const id = readRecord(own(r, "identity"), [...at, "identity"], p, C.INVALID_PAYLOAD, ["text", "themes"], ["text", "themes"]);
  const text = id === null ? null : own(id, "text");
  const themes = id === null ? null : own(id, "themes");
  if (id !== null && !isExactLabel(text)) p.add(C.INVALID_PAYLOAD, [...at, "identity", "text"], "identity text is a non-empty exact label");
  if (id !== null && (!Array.isArray(themes) || !themes.every((t: unknown) => isExactLabel(t)) || new Set(themes).size !== themes.length)) {
    p.add(C.INVALID_PAYLOAD, [...at, "identity", "themes"], "themes is a duplicate-free array of descriptive labels (never Keywords)");
  }
  const strengths = readStrengths(own(r, "strengths"), [...at, "strengths"], p);
  const weaknesses = readWeaknesses(own(r, "weaknesses"), [...at, "weaknesses"], p);
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || affinity === null || strengths === null || weaknesses === null || source === null) return null;
  return { affinity, identity: { text: text as string, themes: [...(themes as string[])] }, strengths, weaknesses, source };
}

function readRankRule(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): AffinityRankRulePayload | null {
  const before = p.count;
  const raw = own(r, "ranks");
  const ranks: AffinityRankEntry[] = [];
  if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], "ranks is an array of { rank, order, strengthDiscountPercent, authority }");
  else
    raw.forEach((x: unknown, i: number) => {
      const fields = ["rank", "order", "strengthDiscountPercent", "authority"];
      const e = readRecord(x, [...at, "ranks", i], p, C.INVALID_PAYLOAD, fields, fields);
      if (e === null) return;
      const rank = readEnum(own(e, "rank"), AFFINITY_RANKS, [...at, "ranks", i, "rank"], p, C.INVALID_PAYLOAD, "Affinity Rank");
      const order = readSafeInteger(own(e, "order"), [...at, "ranks", i, "order"], p, C.INVALID_PAYLOAD, "order");
      const percent = readPercent(own(e, "strengthDiscountPercent"), [...at, "ranks", i, "strengthDiscountPercent"], p, "strengthDiscountPercent");
      const rawAuthority = own(e, "authority");
      let authority: AffinityRankEntry["authority"] = null;
      if (rawAuthority !== null) {
        const a = readRecord(rawAuthority, [...at, "ranks", i, "authority"], p, C.INVALID_PAYLOAD, ["effectCapacity", "traitCapacity"], ["effectCapacity", "traitCapacity"]);
        const effects = a === null ? null : readSafeInteger(own(a, "effectCapacity"), [...at, "ranks", i, "authority", "effectCapacity"], p, C.INVALID_PAYLOAD, "effectCapacity");
        const traits = a === null ? null : readSafeInteger(own(a, "traitCapacity"), [...at, "ranks", i, "authority", "traitCapacity"], p, C.INVALID_PAYLOAD, "traitCapacity");
        if (effects !== null && effects < 1) p.add(C.INVALID_PAYLOAD, [...at, "ranks", i, "authority", "effectCapacity"], "an Authority-granting rank permits at least one Effect");
        if (traits !== null && traits < 0) p.add(C.INVALID_PAYLOAD, [...at, "ranks", i, "authority", "traitCapacity"], "traitCapacity is never negative");
        if (effects !== null && traits !== null) authority = { effectCapacity: effects, traitCapacity: traits };
      }
      if (rank !== null && order !== null && percent !== null) ranks.push({ rank, order, strengthDiscountPercent: percent, authority });
    });
  for (const rank of AFFINITY_RANKS) if (ranks.filter((x) => x.rank === rank).length !== 1) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], `rank ${rank} is defined exactly once`);
  uniqueKeys(ranks, (x) => String(x.order), [...at, "ranks"], p, "rank order");
  const minimum = readEnum(own(r, "authorityMinimumRank"), AFFINITY_RANKS, [...at, "authorityMinimumRank"], p, C.INVALID_PAYLOAD, "Affinity Rank");
  const floor = ranks.find((x) => x.rank === minimum);
  if (floor !== undefined) {
    // Authority capacity exists exactly at and above the authored minimum rank (comparison of authored orders only).
    for (const x of ranks) {
      if (x.order >= floor.order && x.authority === null) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], `${x.rank} is at or above the Authority minimum rank and must define Authority capacity`);
      if (x.order < floor.order && x.authority !== null) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], `${x.rank} is below the Authority minimum rank and grants no Authority capacity`);
    }
  }
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || minimum === null || source === null) return null;
  return { ranks, authorityMinimumRank: minimum, source };
}

function readSeverityScale(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): AffinityWeaknessSeverityPayload | null {
  const before = p.count;
  const raw = own(r, "severities");
  const severities: { severity: AffinityWeaknessSeverity; percent: number }[] = [];
  if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, "severities"], "severities is an array of { severity, percent }");
  else
    raw.forEach((x: unknown, i: number) => {
      const e = readRecord(x, [...at, "severities", i], p, C.INVALID_PAYLOAD, ["severity", "percent"], ["severity", "percent"]);
      if (e === null) return;
      const severity = readEnum(own(e, "severity"), AFFINITY_WEAKNESS_SEVERITIES, [...at, "severities", i, "severity"], p, C.INVALID_PAYLOAD, "Weakness severity");
      const percent = readPercent(own(e, "percent"), [...at, "severities", i, "percent"], p, "percent");
      if (severity !== null && percent !== null) severities.push({ severity, percent });
    });
  for (const s of AFFINITY_WEAKNESS_SEVERITIES) if (severities.filter((x) => x.severity === s).length !== 1) p.add(C.INVALID_PAYLOAD, [...at, "severities"], `severity ${s} is defined exactly once`);
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || source === null) return null;
  return { severities, source };
}

function readOption(value: unknown, at: readonly PathSegment[], p: Problems): AffinityAdvancementOption | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["optionKey", "action", "startingRank", "target", "from", "to", "role", "conflictKey"], ["optionKey", "action"]);
  if (r === null) return null;
  const optionKey = own(r, "optionKey");
  if (!isToken(optionKey)) p.add(C.INVALID_PAYLOAD, [...at, "optionKey"], "optionKey is a SCREAMING_SNAKE token");
  const action = readEnum(own(r, "action"), AFFINITY_ADVANCEMENT_ACTIONS, [...at, "action"], p, C.INVALID_PAYLOAD, "advancement action");
  const allowed = (fields: readonly string[]) => {
    for (const k of Object.keys(r)) if (!["optionKey", "action", ...fields].includes(k)) p.add(C.INVALID_PAYLOAD, [...at, k], `${String(action)} does not take "${k}"`);
    for (const k of fields) if (own(r, k) === undefined) p.add(C.INVALID_PAYLOAD, [...at, k], `${String(action)} requires "${k}"`);
  };
  const rank = (k: string) => readEnum(own(r, k), AFFINITY_RANKS, [...at, k], p, C.INVALID_PAYLOAD, "Affinity Rank");
  if (!isToken(optionKey) || action === null) return null;
  const before = p.count;
  switch (action) {
    case "CHOOSE_PRIMARY_AFFINITY": {
      allowed(["startingRank"]);
      const startingRank = rank("startingRank");
      return p.count > before || startingRank === null ? null : { optionKey, action, startingRank };
    }
    case "RANK_UP": {
      allowed(["target", "from", "to"]);
      const target = readEnum(own(r, "target"), AFFINITY_RANK_UP_TARGETS, [...at, "target"], p, C.INVALID_PAYLOAD, "rank-up target");
      const from = rank("from");
      const to = rank("to");
      if (from !== null && from === to) p.add(C.INVALID_PAYLOAD, [...at, "to"], "a RANK_UP changes the rank");
      return p.count > before || target === null || from === null || to === null ? null : { optionKey, action, target, from, to };
    }
    case "GAIN_AFFINITY": {
      allowed(["role", "startingRank", "conflictKey"]);
      const role = readEnum(own(r, "role"), AFFINITY_ROLES, [...at, "role"], p, C.INVALID_PAYLOAD, "Affinity role");
      if (role === "PRIMARY") p.add(C.INVALID_PAYLOAD, [...at, "role"], "the Primary Affinity is chosen by CHOOSE_PRIMARY_AFFINITY, never gained later");
      const rawStart = own(r, "startingRank");
      const startingRank = rawStart === null ? null : rank("startingRank");
      const conflictKey = own(r, "conflictKey");
      if (conflictKey !== null && (typeof conflictKey !== "string" || !SOURCE_CONFLICT.test(conflictKey))) p.add(C.INVALID_PAYLOAD, [...at, "conflictKey"], "conflictKey is an M5-SC-NNN key or null");
      // An unresolved starting rank must cite the open conflict; a resolved one must not pretend to be open (§48–§49).
      if (rawStart === null && conflictKey === null) p.add(C.DEFERRED_PENDING_CANON, [...at, "conflictKey"], "an unresolved starting rank cites its source conflict (M5-SC-035)");
      if (rawStart !== null && conflictKey !== null) p.add(C.INVALID_PAYLOAD, [...at, "conflictKey"], "a resolved starting rank cites no open conflict");
      return p.count > before || role === null ? null : { optionKey, action, role, startingRank, conflictKey: conflictKey as string | null };
    }
  }
}

function readProgression(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): AffinityProgressionPayload | null {
  const before = p.count;
  const raw = own(r, "levels");
  const levels: AffinityProgressionLevel[] = [];
  if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, "levels"], "levels is an array of { level, mode, options }");
  else
    raw.forEach((x: unknown, i: number) => {
      const e = readRecord(x, [...at, "levels", i], p, C.INVALID_PAYLOAD, ["level", "mode", "options"], ["level", "mode", "options"]);
      if (e === null) return;
      const level = readSafeInteger(own(e, "level"), [...at, "levels", i, "level"], p, C.INVALID_PAYLOAD, "level");
      if (level !== null && !(level >= FIRST_CHARACTER_LEVEL)) p.add(C.INVALID_PAYLOAD, [...at, "levels", i, "level"], "a Character Level is at least 1");
      const mode = readEnum(own(e, "mode"), AFFINITY_PROGRESSION_MODES, [...at, "levels", i, "mode"], p, C.INVALID_PAYLOAD, "progression mode");
      const rawOptions = own(e, "options");
      const options: AffinityAdvancementOption[] = [];
      if (!Array.isArray(rawOptions) || rawOptions.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "levels", i, "options"], "options is a non-empty array");
      else rawOptions.forEach((o: unknown, j: number) => {
        const option = readOption(o, [...at, "levels", i, "options", j], p);
        if (option !== null) options.push(option);
      });
      if (mode === "REQUIRED" && Array.isArray(rawOptions) && rawOptions.length !== 1) p.add(C.INVALID_PAYLOAD, [...at, "levels", i, "options"], "a REQUIRED level grants exactly one option");
      uniqueKeys(options, (o) => o.optionKey, [...at, "levels", i, "options"], p, "optionKey");
      if (level !== null && mode !== null) levels.push({ level, mode, options });
    });
  uniqueKeys(levels, (l) => String(l.level), [...at, "levels"], p, "level");
  if (levels.some((l, i) => levels.slice(0, i).some((earlier) => earlier.level > l.level))) p.add(C.INVALID_PAYLOAD, [...at, "levels"], "levels are listed in ascending order");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || source === null) return null;
  return { levels, source };
}

const FIELDS: Readonly<Record<AffinityPayloadKind, readonly string[]>> = {
  AFFINITY_RANK_RULE: ["ranks", "authorityMinimumRank", "source"],
  AFFINITY_WEAKNESS_SEVERITY: ["severities", "source"],
  AFFINITY_PROGRESSION: ["levels", "source"],
};

/** Validates a version-1 payload of an M5-WO4 Affinity rule kind. */
export function readAffinityPayload(kind: AffinityPayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS[kind], FIELDS[kind]);
  if (r === null) return null;
  const readers = { AFFINITY_RANK_RULE: readRankRule, AFFINITY_WEAKNESS_SEVERITY: readSeverityScale, AFFINITY_PROGRESSION: readProgression } as const;
  return readers[kind](r, at, p) as unknown as JsonObject | null;
}
