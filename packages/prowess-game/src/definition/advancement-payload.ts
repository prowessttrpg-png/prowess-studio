import type { JsonObject } from "@prowess/model";
import type { PathSegment } from "../internal/plain-data.js";
import { Problems, own, readRecord, readSafeInteger } from "../internal/problems.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";

/**
 * Version-1 payload of CHARACTER_ADVANCEMENT_RULE (PAS-10 M6-WO4 §6–§7): the per-Level advancement entitlements that no
 * other Definition owns — Stat Points and Skill advancements gained on reaching each Level after creation. The Character
 * Die stays CHARACTER_DIE_PROGRESSION's and Affinity advancement stays AFFINITY_PROGRESSION's; neither is repeated here.
 * Like every M5 reader this checks structure only (no arithmetic, no defaults); cross-Definition coherence (which Levels
 * are legal, what the Character Die covers) is checked against the exact Release by character/advancement.ts.
 */
export interface CharacterAdvancementLevel {
  /** The Level reached by this advancement (a Level after the creation Level). */
  readonly level: number;
  readonly statPoints: number;
  readonly skillAdvancements: number;
}

export interface CharacterAdvancementRulePayload {
  /** Strictly ascending by `level`. */
  readonly levels: readonly CharacterAdvancementLevel[];
  readonly source: CoreDefinitionSource;
}

export const ADVANCEMENT_PAYLOAD_KINDS = Object.freeze(["CHARACTER_ADVANCEMENT_RULE"] as const);
export type AdvancementPayloadKind = (typeof ADVANCEMENT_PAYLOAD_KINDS)[number];
export const isAdvancementPayloadKind = (kind: string): kind is AdvancementPayloadKind => (ADVANCEMENT_PAYLOAD_KINDS as readonly string[]).includes(kind);

const FIELDS = ["levels", "source"];
const LEVEL_FIELDS = ["level", "statPoints", "skillAdvancements"];
/** Input validation only: a Character Level is a positive integer; counts are never negative. */
const FIRST_LEVEL = 1;
const NO_COUNT = 0;

function readAtLeast(value: unknown, at: readonly PathSegment[], p: Problems, what: string, minimum: number): number | null {
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < minimum) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is at least ${minimum}`);
    return null;
  }
  return n;
}

/** Validates `value` as the version-1 CHARACTER_ADVANCEMENT_RULE payload (the caller checked the version). */
export function readAdvancementPayload(_kind: AdvancementPayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS, FIELDS);
  if (r === null) return null;
  const before = p.count;
  const raw = own(r, "levels");
  const levels: CharacterAdvancementLevel[] = [];
  if (!Array.isArray(raw) || raw.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "levels"], "levels is a non-empty array of { level, statPoints, skillAdvancements }");
  else
    raw.forEach((item: unknown, i: number) => {
      const lat = [...at, "levels", i];
      const e = readRecord(item, lat, p, C.INVALID_PAYLOAD, LEVEL_FIELDS, LEVEL_FIELDS);
      if (e === null) return;
      const level = readAtLeast(own(e, "level"), [...lat, "level"], p, "level", FIRST_LEVEL);
      const statPoints = readAtLeast(own(e, "statPoints"), [...lat, "statPoints"], p, "statPoints", NO_COUNT);
      const skillAdvancements = readAtLeast(own(e, "skillAdvancements"), [...lat, "skillAdvancements"], p, "skillAdvancements", NO_COUNT);
      if (level === null || statPoints === null || skillAdvancements === null) return;
      const previous = levels.at(-1);
      if (previous !== undefined && !(previous.level < level)) {
        p.add(C.INVALID_PAYLOAD, [...lat, "level"], "levels are strictly ascending; each Level is authored once");
        return;
      }
      levels.push({ level, statPoints, skillAdvancements });
    });
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before) return null;
  return { levels, source: source as CoreDefinitionSource } as unknown as JsonObject;
}
