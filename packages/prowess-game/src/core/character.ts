import { createActorContext, type ActorContext } from "@prowess/rules";
import { deepFreeze } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isToken, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { CORE_ERROR_CODES as K, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import type { CharacterDieProgressionPayload } from "../definition/core-payload.js";
import {
  BONUS_CONTEXT_SEGMENTS,
  BONUS_TARGETS,
  CHARACTER_PROPERTY_KEYS,
  PROWESS_STATS,
  STAT_CONTEXT_KEYS,
  type BonusTarget,
  type ProwessStat,
} from "../vocabulary/core.js";
import type { CoreDefinitionIndex } from "./definitions.js";

/**
 * The Character Die a character rolls: one die size and the level band it belongs to (s16). Resolved from the exact
 * CHARACTER_DIE_PROGRESSION Definition by comparison — never by a branch per level, never computed.
 */
export interface CharacterDie {
  readonly dieKey: string;
  readonly faces: number;
  readonly levelMinimum: number;
  readonly levelMaximum: number;
}

/** A named situational bonus (s14). It is its own Formula term on the roll / statistic it targets — never folded in. */
export interface ExplicitBonus {
  /** Lowercase key, unique per target; the bonus's Formula variable is `bonus.<bonusKey>`. */
  readonly bonusKey: string;
  readonly appliesTo: BonusTarget;
  readonly value: number;
  /** Optional SCREAMING_SNAKE category (e.g. COVER, EQUIPMENT, SKILL) — descriptive; never changes the arithmetic. */
  readonly category: string | null;
  /** Optional exact canonical key of the Definition that granted the bonus (provenance). */
  readonly sourceKey: string | null;
}

export interface CharacterSkillRank {
  /** Exact canonical key of the Skill (Skill catalog content arrives in M5-WO3; WO2 never resolves it by name). */
  readonly skillKey: string;
  readonly rankKey: string;
}

/**
 * CharacterCore (PAS-10 M5-WO2): the character inputs core resolution reads. Base HP / Base MP are the racial base
 * values (M5-SC-003); Stats are the six Ability Scores; the Character Die is stated explicitly and must equal the die the
 * progression assigns to `level`. Anything not listed is not a core input.
 */
export interface CharacterCore {
  readonly level: number;
  readonly characterDie: { readonly dieKey: string };
  readonly stats: Readonly<Record<ProwessStat, number>>;
  readonly baseHp: number;
  readonly baseMp: number;
  readonly skillRanks: readonly CharacterSkillRank[];
  readonly explicitBonuses: readonly ExplicitBonus[];
}

/** A CharacterCore checked against exact core Definitions, with its resolved Character Die. */
export interface ValidatedCharacterCore extends CharacterCore {
  readonly resolvedDie: CharacterDie;
}

const CORE_FIELDS = ["level", "characterDie", "stats", "baseHp", "baseMp", "skillRanks", "explicitBonuses"];
const BONUS_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** The die band the progression assigns to `level`, or null when `level` is not a declared Character Level. */
export function resolveCharacterDie(progression: CharacterDieProgressionPayload, level: number): CharacterDie | null {
  if (!progression.levels.includes(level)) return null;
  const band = progression.progression.find((b) => b.levelMinimum <= level && level <= b.levelMaximum);
  const die = band === undefined ? undefined : progression.dice.find((d) => d.dieKey === band.dieKey);
  if (band === undefined || die === undefined) return null;
  return deepFreeze({ dieKey: die.dieKey, faces: die.faces, levelMinimum: band.levelMinimum, levelMaximum: band.levelMaximum });
}

/**
 * Validates a CharacterCore against the exact core Definitions: every Stat within its STAT Definition's limits, a
 * declared Level, the stated Character Die equal to the progression's, Skill ranks on the Skill ladder, uniquely
 * keyed bonuses with known targets. Fails closed; never clamps, rounds or repairs a value.
 */
export function validateCharacterCore(value: unknown, core: CoreDefinitionIndex): ProwessOutcome<ValidatedCharacterCore> {
  const p = new Problems();
  if (!checkPlainData(value, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(value, [], p, K.INVALID_CHARACTER, CORE_FIELDS, CORE_FIELDS);
  if (r === null) return finish(p, () => null as never);

  const level = readSafeInteger(own(r, "level"), ["level"], p, K.INVALID_CHARACTER, "level");
  let resolvedDie: CharacterDie | null = null;
  if (level !== null) {
    resolvedDie = resolveCharacterDie(core.progression.payload, level);
    if (resolvedDie === null) p.add(K.LEVEL_OUT_OF_RANGE, ["level"], `level ${level} is not a Character Level of ${core.progression.ref.canonicalKey} (${core.progression.payload.levels.join(", ")})`);
  }
  const die = readRecord(own(r, "characterDie"), ["characterDie"], p, K.INVALID_CHARACTER, ["dieKey"], ["dieKey"]);
  const dieKey = die === null ? null : own(die, "dieKey");
  if (die !== null && !isToken(dieKey)) p.add(K.INVALID_CHARACTER, ["characterDie", "dieKey"], "dieKey is an exact die token");
  else if (die !== null && resolvedDie !== null && dieKey !== resolvedDie.dieKey) {
    p.add(K.CHARACTER_DIE_MISMATCH, ["characterDie", "dieKey"], `a level ${String(level)} character rolls ${resolvedDie.dieKey}, not ${String(dieKey)}`);
  }

  const rawStats = own(r, "stats");
  const stats: Partial<Record<ProwessStat, number>> = {};
  const statRecord = readRecord(rawStats, ["stats"], p, K.INVALID_CHARACTER, PROWESS_STATS, PROWESS_STATS);
  if (statRecord !== null) {
    for (const stat of PROWESS_STATS) {
      const n = readSafeInteger(own(statRecord, stat), ["stats", stat], p, K.INVALID_CHARACTER, stat);
      if (n === null) continue;
      const limits = core.stats[stat].payload;
      if (n < limits.minimum || n > limits.maximum) p.add(K.STAT_OUT_OF_RANGE, ["stats", stat], `${stat} ${n} is outside ${limits.minimum}–${limits.maximum} (${core.stats[stat].ref.canonicalKey})`);
      else stats[stat] = n;
    }
  }
  const baseHp = readSafeInteger(own(r, "baseHp"), ["baseHp"], p, K.INVALID_CHARACTER, "baseHp");
  const baseMp = readSafeInteger(own(r, "baseMp"), ["baseMp"], p, K.INVALID_CHARACTER, "baseMp");

  const skillRanks: CharacterSkillRank[] = [];
  const rawRanks = own(r, "skillRanks");
  if (!Array.isArray(rawRanks)) p.add(K.INVALID_CHARACTER, ["skillRanks"], "skillRanks is an array of { skillKey, rankKey }");
  else
    rawRanks.forEach((v: unknown, i: number) => {
      const e = readRecord(v, ["skillRanks", i], p, K.INVALID_CHARACTER, ["skillKey", "rankKey"], ["skillKey", "rankKey"]);
      if (e === null) return;
      const skillKey = own(e, "skillKey");
      const rankKey = own(e, "rankKey");
      if (!isExactCanonicalKey(skillKey) || skillRanks.some((s) => s.skillKey === skillKey)) {
        p.add(K.INVALID_CHARACTER, ["skillRanks", i, "skillKey"], "skillKey is an exact Skill canonical key, listed once");
        return;
      }
      if (!core.skillLadder.payload.ranks.some((rk) => rk.rankKey === rankKey)) {
        p.add(K.UNKNOWN_RANK, ["skillRanks", i, "rankKey"], `${JSON.stringify(rankKey)} is not a rank of ${core.skillLadder.ref.canonicalKey}`);
        return;
      }
      skillRanks.push({ skillKey, rankKey: rankKey as string });
    });

  const explicitBonuses: ExplicitBonus[] = [];
  const rawBonuses = own(r, "explicitBonuses");
  if (!Array.isArray(rawBonuses)) p.add(K.INVALID_CHARACTER, ["explicitBonuses"], "explicitBonuses is an array of { bonusKey, appliesTo, value }");
  else
    rawBonuses.forEach((v: unknown, i: number) => {
      const e = readRecord(v, ["explicitBonuses", i], p, K.INVALID_CHARACTER, ["bonusKey", "appliesTo", "value", "category", "sourceKey"], ["bonusKey", "appliesTo", "value"]);
      if (e === null) return;
      const bonusKey = own(e, "bonusKey");
      const appliesTo = readEnum(own(e, "appliesTo"), BONUS_TARGETS, ["explicitBonuses", i, "appliesTo"], p, K.INVALID_CHARACTER, "bonus target");
      const amount = readSafeInteger(own(e, "value"), ["explicitBonuses", i, "value"], p, K.INVALID_CHARACTER, "bonus value");
      if (typeof bonusKey !== "string" || !BONUS_KEY_PATTERN.test(bonusKey) || explicitBonuses.some((b) => b.bonusKey === bonusKey && b.appliesTo === appliesTo)) {
        p.add(K.INVALID_CHARACTER, ["explicitBonuses", i, "bonusKey"], "bonusKey is a lowercase key, unique per bonus target");
        return;
      }
      const category = own(e, "category") ?? null;
      const sourceKey = own(e, "sourceKey") ?? null;
      if (category !== null && !isToken(category)) p.add(K.INVALID_CHARACTER, ["explicitBonuses", i, "category"], "category is a SCREAMING_SNAKE token");
      if (sourceKey !== null && !isExactCanonicalKey(sourceKey)) p.add(K.INVALID_CHARACTER, ["explicitBonuses", i, "sourceKey"], "sourceKey is an exact Definition canonical key");
      if (appliesTo !== null && amount !== null) explicitBonuses.push({ bonusKey, appliesTo, value: amount, category: category as string | null, sourceKey: sourceKey as string | null });
    });

  return finish(p, () =>
    deepFreeze({
      level: level as number,
      characterDie: { dieKey: dieKey as string },
      stats: stats as Record<ProwessStat, number>,
      baseHp: baseHp as number,
      baseMp: baseMp as number,
      skillRanks: [...skillRanks].sort((a, b) => (a.skillKey < b.skillKey ? -1 : a.skillKey > b.skillKey ? 1 : 0)),
      explicitBonuses: [...explicitBonuses].sort((a, b) => {
        const ka = `${a.appliesTo}:${a.bonusKey}`;
        const kb = `${b.appliesTo}:${b.bonusKey}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      }),
      resolvedDie: resolvedDie as CharacterDie,
    }),
  );
}

/** The ActorContext `properties` key one explicit bonus is bound from. */
export function bonusPropertyKey(bonus: Pick<ExplicitBonus, "appliesTo" | "bonusKey">): string {
  return ["bonus", BONUS_CONTEXT_SEGMENTS[bonus.appliesTo], bonus.bonusKey].join(".");
}

/**
 * The M4 ActorContext of a validated character: its six Stats under their context keys, its Level, Base HP / Base MP,
 * resolved die faces and every explicit bonus under its own named property. Values are copied, never combined.
 */
export function buildCharacterActorContext(character: ValidatedCharacterCore): ProwessOutcome<ActorContext> {
  const p = new Problems();
  const stats: Record<string, number> = {};
  for (const stat of PROWESS_STATS) stats[STAT_CONTEXT_KEYS[stat]] = character.stats[stat];
  const properties: Record<string, number> = {
    [CHARACTER_PROPERTY_KEYS.LEVEL]: character.level,
    [CHARACTER_PROPERTY_KEYS.BASE_HP]: character.baseHp,
    [CHARACTER_PROPERTY_KEYS.BASE_MP]: character.baseMp,
    [CHARACTER_PROPERTY_KEYS.CHARACTER_DIE_FACES]: character.resolvedDie.faces,
  };
  for (const bonus of character.explicitBonuses) properties[bonusPropertyKey(bonus)] = bonus.value;
  const ranks: Record<string, string> = {};
  for (const rank of character.skillRanks) ranks[rank.skillKey] = rank.rankKey;
  const created = createActorContext({ actorRef: null, stats, ranks, keywords: [], resources: {}, ownedEntities: [], properties, tags: [] });
  if (!created.ok) p.add(K.INVALID_CHARACTER, [], "the character does not form a valid M4 ActorContext");
  return finish(p, () => (created as { ok: true; value: ActorContext }).value);
}
