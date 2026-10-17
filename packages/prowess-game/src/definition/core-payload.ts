import { validateFormulaProgram } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import {
  CHARACTER_FIELDS,
  COMPARISON_TARGETS,
  CORE_PROCEDURES,
  CRITICAL_DAMAGE_RULES,
  CRITICAL_HIT_RULES,
  CRITICAL_THREAT_RULES,
  BONUS_TARGETS,
  DEFERRED_STATISTICS,
  DERIVED_STATISTICS,
  DERIVED_VARIABLE_SOURCE_KINDS,
  INITIATIVE_TIEBREAK_KINDS,
  PROWESS_STATS,
  ROLL_COMPARISON_OPERATORS,
  ROLL_MODES,
  ROLL_MODE_VARIABLES,
  ROLL_PROCEDURES,
  SOURCE_CONFLICT_PATTERN,
  SOURCE_LOCATOR_PATTERN,
  VARIABLE_SOURCE_KINDS,
  type BonusTarget,
  type CharacterField,
  type ComparisonAgainst,
  type CoreProcedure,
  type DerivedStatistic,
  type FormulaSourceKind,
  type ProwessStat,
  type RollMode,
} from "../vocabulary/core.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";

/**
 * Version-1 payload contracts of the M5-WO2 core Definition kinds: STAT, CHARACTER_DIE_PROGRESSION, RANK_LADDER,
 * SKILL_RANK, DERIVED_STAT and CORE_RESOLUTION (PAS-10 M5-WO2).
 *
 * Every number a core rule needs is CONTENT in one of these payloads; every Formula is an authored M4 expression string
 * in content, validated here by M4's own `validateFormulaProgram` (never parsed or evaluated by @prowess/game). The
 * readers check structure, closed vocabularies and comparisons only — they perform no arithmetic.
 */

/** Where in the Core Playtest a Definition comes from (`sNNN` section keys) and which conflicts govern it. */
export interface CoreDefinitionSource {
  readonly locators: readonly string[];
  readonly conflicts: readonly string[];
}

export interface StatDefinitionPayload {
  readonly stat: ProwessStat;
  readonly minimum: number;
  readonly maximum: number;
  readonly source: CoreDefinitionSource;
}

/** One die size (s16). `faces` is content; the half die is a DERIVED_STAT Formula over it, never computed here. */
export interface CharacterDieSize {
  readonly dieKey: string;
  readonly faces: number;
}

/** One level band of the Character Die progression: L`levelMinimum`–`levelMaximum` roll `dieKey`. */
export interface CharacterDieBand {
  readonly levelMinimum: number;
  readonly levelMaximum: number;
  readonly dieKey: string;
}

/**
 * The Character Die progression as data (s16, s159). `levels` lists every legal Character Level explicitly; every
 * level lies in exactly one band. There is no branch per level anywhere in code.
 */
export interface CharacterDieProgressionPayload {
  readonly levels: readonly number[];
  readonly dice: readonly CharacterDieSize[];
  readonly progression: readonly CharacterDieBand[];
  readonly source: CoreDefinitionSource;
}

/** An ordered rank ladder (s179). `order` is ladder position only — it carries no system-specific numeric meaning. */
export interface RankLadderPayload {
  readonly ladderKey: string;
  readonly ranks: readonly { readonly rankKey: string; readonly order: number }[];
  readonly source: CoreDefinitionSource;
}

/**
 * What each rank of a ladder MEANS for Skill Checks: a bonus, and — separately — whether a character at that rank may
 * attempt the check at all. UNTRAINED is a rank (bonus 0), not "attempt not allowed".
 */
export interface SkillRankPayload {
  readonly ladderKey: string;
  readonly entries: readonly { readonly rankKey: string; readonly bonus: number; /**
   * Whether a character at this rank may attempt a Skill Check without explicit permission (s30). UNTRAINED is a
   * rank (bonus 0) with `attemptAllowed: false` — a separate fact, never "the Skill does not exist". A caller supplies
   * explicit GM / rule permission to attempt anyway; nothing infers it from the bonus or the rank order.
   */
  readonly attemptAllowed: boolean }[];
  readonly source: CoreDefinitionSource;
}

/** Where one Formula variable's value comes from. Exactly one source per variable; nothing is implied. */
export type FormulaVariableSource =
  | { readonly kind: "STAT"; readonly stat: ProwessStat }
  | { readonly kind: "CHOSEN_STAT" }
  | { readonly kind: "CHARACTER"; readonly field: CharacterField }
  | { readonly kind: "CHARACTER_DIE_FACES" }
  | { readonly kind: "DERIVED"; readonly statistic: DerivedStatistic }
  | { readonly kind: "NATURAL" }
  | { readonly kind: "SKILL_RANK_BONUS" }
  | { readonly kind: "EXPLICIT_BONUSES" }
  /** M5-WO3: the distance moved in one movement segment (runtime input), read only by a TERRAIN allowance cost. */
  | { readonly kind: "MOVEMENT_DISTANCE" };

export interface FormulaVariableDeclaration {
  readonly variable: string;
  readonly source: FormulaVariableSource;
}

/** An authored M4 Formula program plus the declared source of each of its variables. */
export interface CoreFormula {
  readonly expression: string;
  readonly rounding: "NONE" | "FLOOR" | "CEIL";
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly unit: string | null;
  readonly variables: readonly FormulaVariableDeclaration[];
}

export interface DerivedStatPayload {
  readonly statistic: DerivedStatistic;
  readonly formula: CoreFormula;
  /** The bonus target whose explicit bonuses feed this statistic's EXPLICIT_BONUSES variable, or null. */
  readonly bonusTarget: BonusTarget | null;
  readonly source: CoreDefinitionSource;
}

export interface CoreRollPayload {
  readonly procedure: Exclude<CoreProcedure, "STAT_MASTERY">;
  /** Natural selection per roll mode (s13, M5-SC-010). Null for a procedure that rolls no die (automatic success). */
  readonly naturalSelection: Readonly<Record<RollMode, { readonly expression: string }>> | null;
  readonly total: CoreFormula;
  readonly bonusTarget: BonusTarget | null;
  readonly comparison: { readonly operator: ">="; readonly against: ComparisonAgainst };
  readonly critical: { readonly threat: "NATURAL_EQUALS_DIE_FACES"; readonly hit: "THREAT_AND_SUCCESS"; readonly damage: "DEFERRED" } | null;
  readonly requiresSkill: boolean;
  readonly source: CoreDefinitionSource;
}

/** Stat Mastery (s162): a roll-mode SIGNAL when Level and the Stat reach the authored thresholds — never a bonus. */
export interface StatMasteryPayload {
  readonly procedure: "STAT_MASTERY";
  readonly mastery: { readonly levelAtLeast: number; readonly statAtLeast: number; readonly signal: "ADVANTAGE" };
  readonly appliesTo: readonly Exclude<CoreProcedure, "STAT_MASTERY">[];
  readonly source: CoreDefinitionSource;
}

/** One Initiative tie-break step (s425): the highest value of a Stat among a tied side's creatures, or a reroll. */
export type InitiativeTiebreak = { readonly kind: "HIGHEST_STAT"; readonly stat: ProwessStat } | { readonly kind: "REROLL" };

/**
 * Initiative (s52, s425; M5-WO3): one chosen creature per side rolls the Character Die; the total is compared with the
 * other sides' totals — never with a DC — so there is no comparison and no critical. The total Formula declares its own
 * rounding (the source states none, so content says NONE and fractional totals are valid). Ties follow `tiebreak` in
 * order; the last step is always an explicit REROLL requirement (new runtime die input, never generated).
 */
export interface InitiativePayload {
  readonly procedure: "INITIATIVE";
  readonly naturalSelection: Readonly<Record<RollMode, { readonly expression: string }>>;
  readonly total: CoreFormula;
  readonly bonusTarget: BonusTarget | null;
  readonly tiebreak: readonly InitiativeTiebreak[];
  readonly source: CoreDefinitionSource;
}

export type CoreResolutionPayload = CoreRollPayload | StatMasteryPayload | InitiativePayload;

const ROLL_FIELDS = ["procedure", "naturalSelection", "total", "bonusTarget", "comparison", "critical", "requiresSkill", "source"];
const MASTERY_FIELDS = ["procedure", "mastery", "appliesTo", "source"];
const INITIATIVE_FIELDS = ["procedure", "naturalSelection", "total", "bonusTarget", "tiebreak", "source"];
const FORMULA_FIELDS = ["expression", "rounding", "minimum", "maximum", "unit", "variables"];

export function readSource(value: unknown, at: readonly PathSegment[], p: Problems): CoreDefinitionSource | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["locators", "conflicts"], ["locators", "conflicts"]);
  if (r === null) return null;
  const list = (field: string, pattern: RegExp, what: string): string[] | null => {
    const v = own(r, field);
    if (!Array.isArray(v) || !v.every((x: unknown) => typeof x === "string" && pattern.test(x)) || new Set(v).size !== v.length) {
      p.add(C.INVALID_PAYLOAD, [...at, field], `${field} is a duplicate-free array of ${what}`);
      return null;
    }
    return [...(v as string[])].sort();
  };
  const locators = list("locators", SOURCE_LOCATOR_PATTERN, "Core Playtest section keys (sNNN)");
  const conflicts = list("conflicts", SOURCE_CONFLICT_PATTERN, "source-conflict keys (M5-SC-NNN)");
  if (locators !== null && locators.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "locators"], "every core Definition cites at least one source section");
  return locators === null || conflicts === null ? null : { locators, conflicts };
}

function readBoundedInteger(value: unknown, at: readonly PathSegment[], p: Problems, what: string, floor: number): number | null {
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < floor) {
    p.add(C.INVALID_PAYLOAD, at, `${what} must be at least ${floor}`);
    return null;
  }
  return n;
}

function readStat(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): StatDefinitionPayload | null {
  const stat = readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, C.INVALID_PAYLOAD, "Stat");
  const minimum = readBoundedInteger(own(r, "minimum"), [...at, "minimum"], p, "minimum", 0);
  const maximum = readBoundedInteger(own(r, "maximum"), [...at, "maximum"], p, "maximum", 0);
  if (minimum !== null && maximum !== null && minimum > maximum) p.add(C.INVALID_PAYLOAD, [...at, "minimum"], "minimum exceeds maximum");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return stat === null || minimum === null || maximum === null || source === null ? null : { stat, minimum, maximum, source };
}

function readProgression(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): CharacterDieProgressionPayload | null {
  const before = p.count;
  const rawLevels = own(r, "levels");
  const levels: number[] = [];
  if (!Array.isArray(rawLevels) || rawLevels.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "levels"], "levels is a non-empty array of every legal Character Level");
  else
    rawLevels.forEach((v: unknown, i: number) => {
      const n = readBoundedInteger(v, [...at, "levels", i], p, "level", 1);
      if (n === null) return;
      const previous = levels.at(-1);
      if (previous !== undefined && !(n > previous)) p.add(C.INVALID_PAYLOAD, [...at, "levels", i], "levels are strictly increasing");
      levels.push(n);
    });

  const rawDice = own(r, "dice");
  const dice: CharacterDieSize[] = [];
  if (!Array.isArray(rawDice) || rawDice.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "dice"], "dice is a non-empty array of { dieKey, faces }");
  else
    rawDice.forEach((v: unknown, i: number) => {
      const d = readRecord(v, [...at, "dice", i], p, C.INVALID_PAYLOAD, ["dieKey", "faces"], ["dieKey", "faces"]);
      if (d === null) return;
      const dieKey = own(d, "dieKey");
      const faces = readBoundedInteger(own(d, "faces"), [...at, "dice", i, "faces"], p, "faces", 2);
      if (!isToken(dieKey) || dice.some((x) => x.dieKey === dieKey)) p.add(C.INVALID_PAYLOAD, [...at, "dice", i, "dieKey"], "dieKey is a unique SCREAMING_SNAKE token");
      else if (faces !== null) dice.push({ dieKey, faces });
    });

  const rawBands = own(r, "progression");
  const progression: CharacterDieBand[] = [];
  if (!Array.isArray(rawBands) || rawBands.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "progression"], "progression is a non-empty array of level bands");
  else
    rawBands.forEach((v: unknown, i: number) => {
      const b = readRecord(v, [...at, "progression", i], p, C.INVALID_PAYLOAD, ["levelMinimum", "levelMaximum", "dieKey"], ["levelMinimum", "levelMaximum", "dieKey"]);
      if (b === null) return;
      const levelMinimum = readBoundedInteger(own(b, "levelMinimum"), [...at, "progression", i, "levelMinimum"], p, "levelMinimum", 1);
      const levelMaximum = readBoundedInteger(own(b, "levelMaximum"), [...at, "progression", i, "levelMaximum"], p, "levelMaximum", 1);
      const dieKey = own(b, "dieKey");
      if (!dice.some((d) => d.dieKey === dieKey)) p.add(C.INVALID_PAYLOAD, [...at, "progression", i, "dieKey"], "a band names a declared die");
      if (levelMinimum === null || levelMaximum === null || typeof dieKey !== "string") return;
      if (levelMinimum > levelMaximum) p.add(C.INVALID_PAYLOAD, [...at, "progression", i], "levelMinimum exceeds levelMaximum");
      if (!levels.includes(levelMinimum) || !levels.includes(levelMaximum)) p.add(C.INVALID_PAYLOAD, [...at, "progression", i], "band bounds are declared levels");
      progression.push({ levelMinimum, levelMaximum, dieKey });
    });

  // Coverage: every declared level lies in exactly one band — no gap, no overlap. Comparisons only.
  levels.forEach((level, i) => {
    const holders = progression.filter((b) => b.levelMinimum <= level && level <= b.levelMaximum);
    if (holders.length !== 1) p.add(C.INVALID_PAYLOAD, [...at, "levels", i], `level ${level} must lie in exactly one progression band (found ${holders.length})`);
  });
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return p.count > before || source === null ? null : { levels, dice, progression, source };
}

function readLadder(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): RankLadderPayload | null {
  const before = p.count;
  const ladderKey = own(r, "ladderKey");
  if (!isToken(ladderKey)) p.add(C.INVALID_PAYLOAD, [...at, "ladderKey"], "ladderKey is a SCREAMING_SNAKE token");
  const raw = own(r, "ranks");
  const ranks: { rankKey: string; order: number }[] = [];
  if (!Array.isArray(raw) || raw.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "ranks"], "ranks is a non-empty ordered array of { rankKey, order }");
  else
    raw.forEach((v: unknown, i: number) => {
      const e = readRecord(v, [...at, "ranks", i], p, C.INVALID_PAYLOAD, ["rankKey", "order"], ["rankKey", "order"]);
      if (e === null) return;
      const rankKey = own(e, "rankKey");
      const order = readSafeInteger(own(e, "order"), [...at, "ranks", i, "order"], p, C.INVALID_PAYLOAD, "order");
      if (!isToken(rankKey) || ranks.some((x) => x.rankKey === rankKey)) {
        p.add(C.INVALID_PAYLOAD, [...at, "ranks", i, "rankKey"], "rankKey is a unique SCREAMING_SNAKE token");
        return;
      }
      const previous = ranks.at(-1);
      if (order !== null && previous !== undefined && !(order > previous.order)) p.add(C.INVALID_PAYLOAD, [...at, "ranks", i, "order"], "rank order is explicit and strictly increasing");
      if (order !== null) ranks.push({ rankKey, order });
    });
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return p.count > before || source === null ? null : { ladderKey: ladderKey as string, ranks, source };
}

function readSkillRank(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): SkillRankPayload | null {
  const before = p.count;
  const ladderKey = own(r, "ladderKey");
  if (!isToken(ladderKey)) p.add(C.INVALID_PAYLOAD, [...at, "ladderKey"], "ladderKey names the rank ladder these entries give meaning to");
  const raw = own(r, "entries");
  const entries: { rankKey: string; bonus: number; attemptAllowed: boolean }[] = [];
  if (!Array.isArray(raw) || raw.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "entries"], "entries is a non-empty array of { rankKey, bonus, attemptAllowed }");
  else
    raw.forEach((v: unknown, i: number) => {
      const e = readRecord(v, [...at, "entries", i], p, C.INVALID_PAYLOAD, ["rankKey", "bonus", "attemptAllowed"], ["rankKey", "bonus", "attemptAllowed"]);
      if (e === null) return;
      const rankKey = own(e, "rankKey");
      const bonus = readSafeInteger(own(e, "bonus"), [...at, "entries", i, "bonus"], p, C.INVALID_PAYLOAD, "bonus");
      const rawAllowed = own(e, "attemptAllowed");
      const attemptAllowed = typeof rawAllowed === "boolean" ? rawAllowed : null;
      if (attemptAllowed === null) p.add(C.INVALID_PAYLOAD, [...at, "entries", i, "attemptAllowed"], "attemptAllowed is an explicit boolean, separate from the rank");
      if (!isToken(rankKey) || entries.some((x) => x.rankKey === rankKey)) p.add(C.INVALID_PAYLOAD, [...at, "entries", i, "rankKey"], "rankKey is a unique SCREAMING_SNAKE token");
      else if (bonus !== null && attemptAllowed !== null) entries.push({ rankKey, bonus, attemptAllowed });
    });
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return p.count > before || source === null ? null : { ladderKey: ladderKey as string, entries, source };
}

function readVariableSource(value: unknown, at: readonly PathSegment[], p: Problems, allowed: readonly FormulaSourceKind[]): FormulaVariableSource | null {
  if (!isPlainObject(value)) {
    p.add(C.INVALID_PAYLOAD, at, "a variable source is { kind, … }");
    return null;
  }
  const kind = readEnum(own(value, "kind"), allowed, [...at, "kind"], p, C.INVALID_PAYLOAD, "variable source kind");
  if (kind === null) return null;
  switch (kind) {
    case "STAT": {
      const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind", "stat"], ["kind", "stat"]);
      const stat = r === null ? null : readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, C.INVALID_PAYLOAD, "Stat");
      return stat === null ? null : { kind, stat };
    }
    case "CHARACTER": {
      const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind", "field"], ["kind", "field"]);
      const field = r === null ? null : readEnum(own(r, "field"), CHARACTER_FIELDS, [...at, "field"], p, C.INVALID_PAYLOAD, "CharacterCore field");
      return field === null ? null : { kind, field };
    }
    case "DERIVED": {
      const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind", "statistic"], ["kind", "statistic"]);
      const statistic = r === null ? null : readStatistic(own(r, "statistic"), [...at, "statistic"], p);
      return statistic === null ? null : { kind, statistic };
    }
    default:
      return readRecord(value, at, p, C.INVALID_PAYLOAD, ["kind"], ["kind"]) === null ? null : { kind };
  }
}

/**
 * A derived statistic key. A deferred statistic is refused with its own diagnostic. (M5-WO2 deferred Movement under
 * M5-SC-006; the M5-WO3 designer ruling resolved it, so DEFERRED_STATISTICS is now empty.)
 */
function readStatistic(value: unknown, at: readonly PathSegment[], p: Problems): DerivedStatistic | null {
  if (typeof value === "string" && (DEFERRED_STATISTICS as readonly string[]).includes(value)) {
    p.add(C.DEFERRED_PENDING_CANON, at, `${value} is DEFERRED_PENDING_CANON: no executable formula may exist for it`);
    return null;
  }
  return readEnum(value, DERIVED_STATISTICS, at, p, C.INVALID_PAYLOAD, "derived statistic");
}

/**
 * An authored Formula, validated by M4 itself. The declared variables must be EXACTLY the expression's variables —
 * no undeclared input, no unused declaration — so every value entering the Formula has a named, explicit source.
 */
export function readFormula(value: unknown, at: readonly PathSegment[], p: Problems, allowed: readonly FormulaSourceKind[]): CoreFormula | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FORMULA_FIELDS, ["expression", "rounding", "variables"]);
  if (r === null) return null;
  const before = p.count;
  const expression = own(r, "expression");
  const rounding = readEnum(own(r, "rounding"), ["NONE", "FLOOR", "CEIL"] as const, [...at, "rounding"], p, C.INVALID_PAYLOAD, "explicit rounding");
  const bound = (field: string): number | null => {
    const v = own(r, field);
    if (v === undefined || v === null) return null;
    return readSafeInteger(v, [...at, field], p, C.INVALID_PAYLOAD, field);
  };
  const minimum = bound("minimum");
  const maximum = bound("maximum");
  const unitValue = own(r, "unit");
  const unit = typeof unitValue === "string" ? unitValue : null;

  const program = validateFormulaProgram({ expression, rounding: rounding ?? "NONE", minimum, maximum, unit });
  if (typeof expression !== "string" || !program.ok) {
    p.add(C.INVALID_FORMULA, [...at, "expression"], "expression must be a valid M4 Formula program (validated by @prowess/rules)");
    return null;
  }
  const rawVariables = own(r, "variables");
  const variables: FormulaVariableDeclaration[] = [];
  if (!Array.isArray(rawVariables)) p.add(C.INVALID_PAYLOAD, [...at, "variables"], "variables is an array of { variable, source }");
  else
    rawVariables.forEach((v: unknown, i: number) => {
      const d = readRecord(v, [...at, "variables", i], p, C.INVALID_PAYLOAD, ["variable", "source"], ["variable", "source"]);
      if (d === null) return;
      const variable = own(d, "variable");
      if (typeof variable !== "string" || variables.some((x) => x.variable === variable)) {
        p.add(C.INVALID_PAYLOAD, [...at, "variables", i, "variable"], "each variable is declared exactly once");
        return;
      }
      const source = readVariableSource(own(d, "source"), [...at, "variables", i, "source"], p, allowed);
      if (source !== null) variables.push({ variable, source });
    });
  const used = program.program.variables;
  const declared = variables.map((v) => v.variable);
  for (const name of used) if (!declared.includes(name)) p.add(C.INVALID_FORMULA, [...at, "variables"], `Formula variable "${name}" has no declared source`);
  for (const name of declared) if (!used.includes(name)) p.add(C.INVALID_FORMULA, [...at, "variables"], `declared variable "${name}" is not used by the expression`);
  if (p.count > before || rounding === null) return null;
  return { expression, rounding, minimum, maximum, unit, variables };
}

function readDerived(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): DerivedStatPayload | null {
  const before = p.count;
  const statistic = readStatistic(own(r, "statistic"), [...at, "statistic"], p);
  const formula = readFormula(own(r, "formula"), [...at, "formula"], p, DERIVED_VARIABLE_SOURCE_KINDS);
  const rawTarget = own(r, "bonusTarget");
  const bonusTarget = rawTarget === null ? null : readEnum(rawTarget, BONUS_TARGETS, [...at, "bonusTarget"], p, C.INVALID_PAYLOAD, "bonus target");
  if (formula !== null && (bonusTarget !== null) !== formula.variables.some((v) => v.source.kind === "EXPLICIT_BONUSES")) {
    p.add(C.INVALID_PAYLOAD, [...at, "bonusTarget"], "a statistic names a bonusTarget exactly when its Formula declares an EXPLICIT_BONUSES variable");
  }
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return p.count > before || statistic === null || formula === null || source === null ? null : { statistic, formula, bonusTarget, source };
}

function readCoreResolution(value: unknown, at: readonly PathSegment[], p: Problems): CoreResolutionPayload | null {
  if (!isPlainObject(value)) {
    p.add(C.INVALID_PAYLOAD, at, "expected a plain object");
    return null;
  }
  const procedure = readEnum(own(value, "procedure"), CORE_PROCEDURES, [...at, "procedure"], p, C.INVALID_PAYLOAD, "core procedure");
  if (procedure === null) return null;
  const before = p.count;

  if (procedure === "STAT_MASTERY") {
    const r = readRecord(value, at, p, C.INVALID_PAYLOAD, MASTERY_FIELDS, MASTERY_FIELDS);
    if (r === null) return null;
    const m = readRecord(own(r, "mastery"), [...at, "mastery"], p, C.INVALID_PAYLOAD, ["levelAtLeast", "statAtLeast", "signal"], ["levelAtLeast", "statAtLeast", "signal"]);
    const levelAtLeast = m === null ? null : readBoundedInteger(own(m, "levelAtLeast"), [...at, "mastery", "levelAtLeast"], p, "levelAtLeast", 1);
    const statAtLeast = m === null ? null : readBoundedInteger(own(m, "statAtLeast"), [...at, "mastery", "statAtLeast"], p, "statAtLeast", 1);
    // Stat Mastery grants Advantage (s162) — a signal. A numeric bonus is not representable here by construction.
    const signal = m === null ? null : readEnum(own(m, "signal"), ["ADVANTAGE"] as const, [...at, "mastery", "signal"], p, C.INVALID_PAYLOAD, "Stat Mastery signal");
    const rawApplies = own(r, "appliesTo");
    const appliesTo: Exclude<CoreProcedure, "STAT_MASTERY">[] = [];
    if (!Array.isArray(rawApplies) || rawApplies.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "appliesTo"], "appliesTo lists the roll procedures Stat Mastery signals");
    else
      rawApplies.forEach((v: unknown, i: number) => {
        const proc = readEnum(v, ROLL_PROCEDURES, [...at, "appliesTo", i], p, C.INVALID_PAYLOAD, "roll procedure");
        if (proc !== null && !appliesTo.includes(proc)) appliesTo.push(proc);
      });
    const source = readSource(own(r, "source"), [...at, "source"], p);
    if (p.count > before || levelAtLeast === null || statAtLeast === null || signal === null || source === null) return null;
    return { procedure, mastery: { levelAtLeast, statAtLeast, signal }, appliesTo: [...appliesTo].sort(), source };
  }

  if (procedure === "INITIATIVE") return readInitiative(value, at, p);

  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ROLL_FIELDS, ROLL_FIELDS);
  if (r === null) return null;
  const rawSelection = own(r, "naturalSelection");
  const naturalSelection = rawSelection === null ? null : readNaturalSelection(rawSelection, [...at, "naturalSelection"], p);
  const total = readFormula(own(r, "total"), [...at, "total"], p, VARIABLE_SOURCE_KINDS);
  if (total !== null && (rawSelection !== null) !== total.variables.some((v) => v.source.kind === "NATURAL")) {
    p.add(C.INVALID_PAYLOAD, [...at, "total"], "a roll that selects a natural result adds it to its total (NATURAL), and a dieless procedure never does");
  }
  const rawTarget = own(r, "bonusTarget");
  const bonusTarget = rawTarget === null ? null : readEnum(rawTarget, BONUS_TARGETS, [...at, "bonusTarget"], p, C.INVALID_PAYLOAD, "bonus target");
  if (total !== null && (bonusTarget !== null) !== total.variables.some((v) => v.source.kind === "EXPLICIT_BONUSES")) {
    p.add(C.INVALID_PAYLOAD, [...at, "bonusTarget"], "a roll names a bonusTarget exactly when its total declares an EXPLICIT_BONUSES variable");
  }
  const cmp = readRecord(own(r, "comparison"), [...at, "comparison"], p, C.INVALID_PAYLOAD, ["operator", "against"], ["operator", "against"]);
  const operator = cmp === null ? null : readEnum(own(cmp, "operator"), ROLL_COMPARISON_OPERATORS, [...at, "comparison", "operator"], p, C.INVALID_PAYLOAD, "comparison operator");
  const against = cmp === null ? null : readEnum(own(cmp, "against"), COMPARISON_TARGETS, [...at, "comparison", "against"], p, C.INVALID_PAYLOAD, "comparison target");
  let critical: CoreRollPayload["critical"] = null;
  const rawCritical = own(r, "critical");
  if (rawCritical !== null) {
    const c = readRecord(rawCritical, [...at, "critical"], p, C.INVALID_PAYLOAD, ["threat", "hit", "damage"], ["threat", "hit", "damage"]);
    const threat = c === null ? null : readEnum(own(c, "threat"), CRITICAL_THREAT_RULES, [...at, "critical", "threat"], p, C.INVALID_PAYLOAD, "critical threat rule");
    const hit = c === null ? null : readEnum(own(c, "hit"), CRITICAL_HIT_RULES, [...at, "critical", "hit"], p, C.INVALID_PAYLOAD, "critical hit rule");
    const damage = c === null ? null : readEnum(own(c, "damage"), CRITICAL_DAMAGE_RULES, [...at, "critical", "damage"], p, C.INVALID_PAYLOAD, "critical damage rule");
    if (rawSelection === null) p.add(C.INVALID_PAYLOAD, [...at, "critical"], "a critical needs a natural result; a dieless procedure has none");
    if (threat !== null && hit !== null && damage !== null) critical = { threat, hit, damage };
  }
  const requiresSkill = own(r, "requiresSkill");
  if (typeof requiresSkill !== "boolean") p.add(C.INVALID_PAYLOAD, [...at, "requiresSkill"], "requiresSkill is an explicit boolean");
  if (total !== null && typeof requiresSkill === "boolean" && requiresSkill !== total.variables.some((v) => v.source.kind === "SKILL_RANK_BONUS")) {
    p.add(C.INVALID_PAYLOAD, [...at, "requiresSkill"], "a procedure requires a Skill exactly when its total adds a SKILL_RANK_BONUS");
  }
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || total === null || operator === null || against === null || source === null || typeof requiresSkill !== "boolean") return null;
  return { procedure, naturalSelection, total, bonusTarget, comparison: { operator, against }, critical, requiresSkill, source };
}

/** The three natural-selection programs of a die-rolling procedure, each reading exactly its mode's natural rolls. */
function readNaturalSelection(value: unknown, at: readonly PathSegment[], p: Problems): Record<RollMode, { expression: string }> | null {
  const s = readRecord(value, at, p, C.INVALID_PAYLOAD, ROLL_MODES, ROLL_MODES);
  if (s === null) return null;
  const out: Partial<Record<RollMode, { expression: string }>> = {};
  for (const mode of ROLL_MODES) {
    const mat = [...at, mode];
    const e = readRecord(own(s, mode), mat, p, C.INVALID_PAYLOAD, ["expression"], ["expression"]);
    if (e === null) continue;
    const expression = own(e, "expression");
    const program = validateFormulaProgram({ expression });
    const expected: readonly string[] = ROLL_MODE_VARIABLES[mode];
    if (typeof expression !== "string" || !program.ok) p.add(C.INVALID_FORMULA, [...mat, "expression"], "natural selection is a valid M4 Formula expression");
    else if (program.program.variables.length !== expected.length || !expected.every((v) => program.program.variables.includes(v))) {
      p.add(C.INVALID_FORMULA, [...mat, "expression"], `${mode} selects from exactly the natural rolls ${expected.join(", ")}`);
    } else out[mode] = { expression };
  }
  return ROLL_MODES.every((m) => out[m] !== undefined) ? (out as Record<RollMode, { expression: string }>) : null;
}

/**
 * INITIATIVE (s52, s425): natural selection + a total over NATURAL / STAT / EXPLICIT_BONUSES; no comparison, no
 * critical, no Skill. The tie-break lists distinct HIGHEST_STAT steps and ends with exactly one REROLL.
 */
function readInitiative(value: unknown, at: readonly PathSegment[], p: Problems): InitiativePayload | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, INITIATIVE_FIELDS, INITIATIVE_FIELDS);
  if (r === null) return null;
  const before = p.count;
  const naturalSelection = readNaturalSelection(own(r, "naturalSelection"), [...at, "naturalSelection"], p);
  const total = readFormula(own(r, "total"), [...at, "total"], p, ["NATURAL", "STAT", "EXPLICIT_BONUSES"]);
  if (total !== null && total.variables.filter((v) => v.source.kind === "NATURAL").length !== 1) p.add(C.INVALID_PAYLOAD, [...at, "total"], "the Initiative total adds the selected natural exactly once");
  const rawTarget = own(r, "bonusTarget");
  const bonusTarget = rawTarget === null ? null : readEnum(rawTarget, BONUS_TARGETS, [...at, "bonusTarget"], p, C.INVALID_PAYLOAD, "bonus target");
  if (total !== null && (bonusTarget !== null) !== total.variables.some((v) => v.source.kind === "EXPLICIT_BONUSES")) {
    p.add(C.INVALID_PAYLOAD, [...at, "bonusTarget"], "Initiative names a bonusTarget exactly when its total declares an EXPLICIT_BONUSES variable");
  }
  const rawTiebreak = own(r, "tiebreak");
  const tiebreak: InitiativeTiebreak[] = [];
  if (!Array.isArray(rawTiebreak) || rawTiebreak.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "tiebreak"], "tiebreak is a non-empty ordered array ending in REROLL");
  else
    rawTiebreak.forEach((v: unknown, i: number) => {
      const tat = [...at, "tiebreak", i];
      const kind = isPlainObject(v) ? readEnum(own(v, "kind"), INITIATIVE_TIEBREAK_KINDS, [...tat, "kind"], p, C.INVALID_PAYLOAD, "Initiative tie-break") : (p.add(C.INVALID_PAYLOAD, tat, "a tie-break step is { kind, … }"), null);
      if (kind === "REROLL") {
        if (readRecord(v, tat, p, C.INVALID_PAYLOAD, ["kind"], ["kind"]) !== null) tiebreak.push({ kind });
      } else if (kind === "HIGHEST_STAT") {
        const t = readRecord(v, tat, p, C.INVALID_PAYLOAD, ["kind", "stat"], ["kind", "stat"]);
        const stat = t === null ? null : readEnum(own(t, "stat"), PROWESS_STATS, [...tat, "stat"], p, C.INVALID_PAYLOAD, "Stat");
        if (stat !== null && tiebreak.some((x) => x.kind === "HIGHEST_STAT" && x.stat === stat)) p.add(C.INVALID_PAYLOAD, tat, `${stat} is compared once`);
        else if (stat !== null) tiebreak.push({ kind, stat });
      }
    });
  const rerolls = tiebreak.filter((t) => t.kind === "REROLL");
  if (Array.isArray(rawTiebreak) && rawTiebreak.length > 0 && (rerolls.length !== 1 || tiebreak.at(-1)?.kind !== "REROLL")) {
    p.add(C.INVALID_PAYLOAD, [...at, "tiebreak"], "the tie-break ends with exactly one explicit REROLL step");
  }
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || naturalSelection === null || total === null || source === null) return null;
  return { procedure: "INITIATIVE", naturalSelection, total, bonusTarget, tiebreak, source };
}

/** Kind → v1 payload reader for the M5-WO2 core kinds. Static, closed table (no registration). */
export const CORE_PAYLOAD_FIELDS = Object.freeze({
  STAT: ["stat", "minimum", "maximum", "source"],
  CHARACTER_DIE_PROGRESSION: ["levels", "dice", "progression", "source"],
  RANK_LADDER: ["ladderKey", "ranks", "source"],
  SKILL_RANK: ["ladderKey", "entries", "source"],
  DERIVED_STAT: ["statistic", "formula", "bonusTarget", "source"],
} as const);
export type CorePayloadKind = keyof typeof CORE_PAYLOAD_FIELDS | "CORE_RESOLUTION";
export const CORE_PAYLOAD_KINDS = Object.freeze(["STAT", "CHARACTER_DIE_PROGRESSION", "RANK_LADDER", "SKILL_RANK", "DERIVED_STAT", "CORE_RESOLUTION"] as const satisfies readonly CorePayloadKind[]);
export const isCorePayloadKind = (kind: string): kind is CorePayloadKind => (CORE_PAYLOAD_KINDS as readonly string[]).includes(kind);

/** Validates a version-1 payload of a WO2 core kind. Returns the canonical payload, or null with problems recorded. */
export function readCorePayload(kind: CorePayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  if (kind === "CORE_RESOLUTION") return readCoreResolution(value, at, p) as unknown as JsonObject | null;
  const fields: readonly string[] = CORE_PAYLOAD_FIELDS[kind];
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, fields, fields);
  if (r === null) return null;
  const readers = { STAT: readStat, CHARACTER_DIE_PROGRESSION: readProgression, RANK_LADDER: readLadder, SKILL_RANK: readSkillRank, DERIVED_STAT: readDerived } as const;
  return readers[kind](r, at, p) as unknown as JsonObject | null;
}

