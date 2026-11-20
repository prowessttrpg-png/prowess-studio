import { evaluateFormula } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { deepFreeze, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";
import { SUMMON_COST_INPUT_KINDS, SUMMON_LIMIT_INPUT_KINDS, readValueFormula, type ValueFormula } from "./rules-authoring-payload.js";

/**
 * RULES-WO1 Phase C — version-1 contracts for the remaining rule families, for AUTHORING, VALIDATION, REFERENCE and
 * PREVIEW. None of them is executed: no compiler, play, combat or sheet module reads these payloads (the coverage
 * matrix records each family's live-execution status separately). Every number is a whole number the author states;
 * every Formula is an M4 program; what the rulebook leaves to the GM stays written text.
 *
 *   ARMOR             worn armor: category, Armor value, Strength requirement, AGI cap on Dodge, Movement penalty, Stealth
 *   STATUS_CONDITION  a state applied TO a creature: effects, duration, removal, ongoing timing, stacking
 *   SUMMON_TYPE       one Summon engine (7 engines): tiers table, trait slots, cost / sustain Formulas, limits
 *   SUMMON_TRAIT      a trait a Summon engine can take: engines, cost per tier, effect, forbidden flag
 *   MISSION_RULE      a GM rule: a die-range table (coverage-checked), a Threat Clock, an Intel token or a reference rule
 *   METAMAGIC         a Metamagic option or trait: costs, effect, restrictions
 *   JOB_TEMPLATE      an OPTIONAL Job Class template: role, suggested Stats / Skills, starting gear, features
 *   REFERENCE_RULE    a written gameplay rule: a die-range table (difficulty, critical, cover …) or written rule points
 *   MAGE_ART (v2)     v1 plus per-mode scaling steps, granted benefits and maintenance exceptions
 */
export const RULES_REFERENCE_PAYLOAD_KINDS = deepFreeze(["ARMOR", "STATUS_CONDITION", "SUMMON_TYPE", "SUMMON_TRAIT", "MISSION_RULE", "METAMAGIC", "JOB_TEMPLATE", "REFERENCE_RULE"] as const);
export type RulesReferencePayloadKind = (typeof RULES_REFERENCE_PAYLOAD_KINDS)[number];
export const isRulesReferencePayloadKind = (kind: string): kind is RulesReferencePayloadKind => (RULES_REFERENCE_PAYLOAD_KINDS as readonly string[]).includes(kind);

export const ARMOR_CATEGORIES = deepFreeze(["LIGHT", "MEDIUM", "HEAVY"] as const);
export const STEALTH_EFFECTS = deepFreeze(["NORMAL", "DISADVANTAGE"] as const);
export const CONDITION_DURATION_MODELS = deepFreeze(["UNTIL_REMOVED", "ROUNDS", "END_OF_NEXT_TURN", "UNTIL_SAVE", "SCENE", "SPECIAL"] as const);
export const CONDITION_ONGOING_TIMINGS = deepFreeze(["NONE", "START_OF_TURN", "END_OF_TURN", "EACH_ROUND"] as const);
export const CONDITION_STACKING = deepFreeze(["DOES_NOT_STACK", "STACKS", "REFRESHES_DURATION", "SPECIAL"] as const);
export const SUMMON_ENGINES = deepFreeze(["SUMMON_ENTITY", "TOTEM", "PERSISTENT_CONSTRUCT", "BOUND_SUMMON", "MANIFESTED_ENTITY", "FUSION", "EQUIPMENT_SUMMONING"] as const);
export const SUMMON_SUSTAIN_MODES = deepFreeze(["SUSTAINED", "PERIODIC", "SUSTAINED_OR_PERIODIC", "NONE"] as const);
/** The shape decides which ONE part exists; each part is named after its shape in lower case. */
export const MISSION_RULE_SHAPES = deepFreeze(["ROLL_TABLE", "CLOCK", "INTEL", "POINTS"] as const);
/** A gameplay reference rule is a table or written points (the Mission-only shapes are refused). */
export const REFERENCE_RULE_SHAPES = deepFreeze(["ROLL_TABLE", "POINTS"] as const);
export const CLOCK_VISIBILITIES = deepFreeze(["VISIBLE", "HIDDEN", "EITHER"] as const);
export const METAMAGIC_FORMS = deepFreeze(["OPTION", "TRAIT"] as const);
export type ArmorCategory = (typeof ARMOR_CATEGORIES)[number];
export type SummonEngine = (typeof SUMMON_ENGINES)[number];

const MAX_TEXT = 4000;
type Out = Record<string, unknown>;

function text(value: unknown, at: readonly PathSegment[], p: Problems, what: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is ${nullable ? "null or " : ""}non-empty text`);
    return null;
  }
  return value;
}
function texts(value: unknown, at: readonly PathSegment[], p: Problems, what: string, atLeastOne = false): string[] {
  if (!Array.isArray(value) || (atLeastOne && value.length === 0)) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is a list of text${atLeastOne ? " with at least one entry" : ""}`);
    return [];
  }
  return value.flatMap((v: unknown, i: number) => {
    const t = text(v, [...at, i], p, what);
    return t === null ? [] : [t];
  });
}
function whole(value: unknown, at: readonly PathSegment[], p: Problems, what: string, opts: { nullable?: boolean; min?: number } = {}): number | null {
  if (value === null && opts.nullable) return null;
  const n = readSafeInteger(value, at, p, C.INVALID_PAYLOAD, what);
  if (n !== null && n < (opts.min ?? 0)) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is at least ${opts.min ?? 0}`);
    return null;
  }
  return n;
}
function token(value: unknown, at: readonly PathSegment[], p: Problems, what: string): string | null {
  if (!isToken(value)) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is a SCREAMING_SNAKE token`);
    return null;
  }
  return value;
}
function bool(value: unknown, at: readonly PathSegment[], p: Problems, what: string, nullable = false): boolean | null {
  if (value === null && nullable) return null;
  if (typeof value !== "boolean") {
    p.add(C.INVALID_PAYLOAD, at, `${what} is an explicit true / false${nullable ? " (or null = not stated)" : ""}`);
    return null;
  }
  return value;
}
/** Rows keyed by a unique token. */
function keyedRows<T>(value: unknown, at: readonly PathSegment[], p: Problems, what: string, keyField: string, fields: readonly string[], read: (r: Record<string, unknown>, at: readonly PathSegment[]) => T | null, atLeastOne = false): T[] {
  if (!Array.isArray(value) || (atLeastOne && value.length === 0)) {
    p.add(C.INVALID_PAYLOAD, at, `${what} is a list${atLeastOne ? " with at least one entry" : ""}`);
    return [];
  }
  const keys: string[] = [];
  return value.flatMap((v: unknown, i: number) => {
    const r = readRecord(v, [...at, i], p, C.INVALID_PAYLOAD, fields, fields);
    if (r === null) return [];
    const k = own(r, keyField);
    if (!isToken(k) || keys.includes(k)) {
      p.add(C.INVALID_PAYLOAD, [...at, i, keyField], `${keyField} is a unique SCREAMING_SNAKE token`);
      return [];
    }
    keys.push(k);
    const out = read(r, [...at, i]);
    return out === null ? [] : [out];
  });
}

/** Whole-number arithmetic for coverage checks goes through M4 like every other number in @prowess/game. */
function m4(expression: string, bindings: Record<string, number>): number | null {
  const out = evaluateFormula({ expression, rounding: "NONE" }, bindings);
  return out.success && out.data !== null ? out.data.finalValue : null;
}

function done(p: Problems, before: number, out: Out, ...required: unknown[]): JsonObject | null {
  return p.count > before || required.some((x) => x === null) ? null : (out as JsonObject);
}

function readArmor(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const armorKey = token(own(r, "armorKey"), [...at, "armorKey"], p, "armorKey");
  const category = readEnum(own(r, "category"), ARMOR_CATEGORIES, [...at, "category"], p, C.INVALID_PAYLOAD, "armor category");
  const armorValue = whole(own(r, "armorValue"), [...at, "armorValue"], p, "armorValue");
  const strengthRequirement = whole(own(r, "strengthRequirement"), [...at, "strengthRequirement"], p, "strengthRequirement", { nullable: true });
  const maxAgiForDodge = whole(own(r, "maxAgiForDodge"), [...at, "maxAgiForDodge"], p, "maxAgiForDodge", { nullable: true });
  const movementPenaltyFeet = whole(own(r, "movementPenaltyFeet"), [...at, "movementPenaltyFeet"], p, "movementPenaltyFeet");
  const stealth = readEnum(own(r, "stealth"), STEALTH_EFFECTS, [...at, "stealth"], p, C.INVALID_PAYLOAD, "stealth effect");
  const notes = texts(own(r, "notes"), [...at, "notes"], p, "notes");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return done(p, before, { armorKey, category, armorValue, strengthRequirement, maxAgiForDodge, movementPenaltyFeet, stealth, notes, source }, armorKey, category, armorValue, movementPenaltyFeet, stealth, source);
}

function readCondition(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const conditionKey = token(own(r, "conditionKey"), [...at, "conditionKey"], p, "conditionKey");
  const effects = keyedRows(own(r, "effects"), [...at, "effects"], p, "effects", "effectKey", ["effectKey", "text"], (e, eat) => {
    const t = text(own(e, "text"), [...eat, "text"], p, "effect text");
    return t === null ? null : { effectKey: own(e, "effectKey") as string, text: t };
  }, true);
  const d = readRecord(own(r, "duration"), [...at, "duration"], p, C.INVALID_PAYLOAD, ["model", "rounds", "text"], ["model", "rounds", "text"]);
  let duration: Out | null = null;
  if (d !== null) {
    const model = readEnum(own(d, "model"), CONDITION_DURATION_MODELS, [...at, "duration", "model"], p, C.INVALID_PAYLOAD, "duration model");
    const rounds = whole(own(d, "rounds"), [...at, "duration", "rounds"], p, "rounds", { nullable: true, min: 1 });
    const dt = text(own(d, "text"), [...at, "duration", "text"], p, "duration text", true);
    if (model === "ROUNDS" && rounds === null) p.add(C.INVALID_PAYLOAD, [...at, "duration", "rounds"], "a ROUNDS duration states its number of rounds");
    if (model !== null && model !== "ROUNDS" && rounds !== null) p.add(C.INVALID_PAYLOAD, [...at, "duration", "rounds"], "only a ROUNDS duration has a number of rounds");
    if (model === "SPECIAL" && dt === null) p.add(C.INVALID_PAYLOAD, [...at, "duration", "text"], "a SPECIAL duration is described in text");
    duration = model === null ? null : { model, rounds, text: dt };
  }
  const removal = texts(own(r, "removal"), [...at, "removal"], p, "removal", true);
  const ongoingTiming = readEnum(own(r, "ongoingTiming"), CONDITION_ONGOING_TIMINGS, [...at, "ongoingTiming"], p, C.INVALID_PAYLOAD, "ongoing timing");
  const stacking = readEnum(own(r, "stacking"), CONDITION_STACKING, [...at, "stacking"], p, C.INVALID_PAYLOAD, "stacking");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return done(p, before, { conditionKey, effects, duration, removal, ongoingTiming, stacking, source }, conditionKey, duration, ongoingTiming, stacking, source);
}

const TIER_FIELDS = ["tierKey", "label", "baseMp", "dieFaces", "staticValue", "hp", "armor", "resolve", "radiusFeet", "size", "traitSlots"];
function readSummonType(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const summonKey = token(own(r, "summonKey"), [...at, "summonKey"], p, "summonKey");
  const engine = readEnum(own(r, "engine"), SUMMON_ENGINES, [...at, "engine"], p, C.INVALID_PAYLOAD, "Summon engine");
  const tiers = keyedRows(own(r, "tiers"), [...at, "tiers"], p, "tiers", "tierKey", TIER_FIELDS, (t, tat) => {
    const label = text(own(t, "label"), [...tat, "label"], p, "tier label");
    const n = (f: string) => whole(own(t, f), [...tat, f], p, f, { nullable: true });
    const row = { tierKey: own(t, "tierKey") as string, label, baseMp: n("baseMp"), dieFaces: n("dieFaces"), staticValue: n("staticValue"), hp: n("hp"), armor: n("armor"), resolve: n("resolve"), radiusFeet: n("radiusFeet"), size: text(own(t, "size"), [...tat, "size"], p, "size", true), traitSlots: n("traitSlots") };
    return label === null ? null : row;
  }, true);
  const formula = (f: string): ValueFormula | null => (own(r, f) === null ? null : readValueFormula(own(r, f), [...at, f], p, SUMMON_COST_INPUT_KINDS));
  const castingAp = formula("castingAp");
  const sustainMode = readEnum(own(r, "sustainMode"), SUMMON_SUSTAIN_MODES, [...at, "sustainMode"], p, C.INVALID_PAYLOAD, "sustain mode");
  const sustainMp = formula("sustainMp");
  const sustainApPerRound = whole(own(r, "sustainApPerRound"), [...at, "sustainApPerRound"], p, "sustainApPerRound", { nullable: true });
  const countsTowardConcentration = bool(own(r, "countsTowardConcentration"), [...at, "countsTowardConcentration"], p, "countsTowardConcentration", true);
  const maxActive = own(r, "maxActive") === null ? null : readValueFormula(own(r, "maxActive"), [...at, "maxActive"], p, SUMMON_LIMIT_INPUT_KINDS);
  if (sustainMode === "NONE" && (sustainMp !== null || sustainApPerRound !== null)) p.add(C.INVALID_PAYLOAD, [...at, "sustainMode"], "an engine without sustain states no sustain cost");
  const actionEconomy = text(own(r, "actionEconomy"), [...at, "actionEconomy"], p, "actionEconomy");
  const restrictions = texts(own(r, "restrictions"), [...at, "restrictions"], p, "restrictions");
  const openQuestions = texts(own(r, "openQuestions"), [...at, "openQuestions"], p, "openQuestions");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return done(p, before, { summonKey, engine, tiers, castingAp, sustainMode, sustainMp, sustainApPerRound, countsTowardConcentration, maxActive, actionEconomy, restrictions, openQuestions, source }, summonKey, engine, sustainMode, actionEconomy, source);
}

function readSummonTrait(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const traitKey = token(own(r, "traitKey"), [...at, "traitKey"], p, "traitKey");
  const rawEngines = own(r, "engines");
  const engines: string[] = [];
  if (!Array.isArray(rawEngines) || rawEngines.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "engines"], "engines lists at least one Summon engine");
  else
    rawEngines.forEach((e: unknown, i: number) => {
      const v = readEnum(e, SUMMON_ENGINES, [...at, "engines", i], p, C.INVALID_PAYLOAD, "Summon engine");
      if (v !== null && engines.includes(v)) p.add(C.INVALID_PAYLOAD, [...at, "engines", i], "each engine is listed once");
      else if (v !== null) engines.push(v);
    });
  const costs = keyedRows(own(r, "costs"), [...at, "costs"], p, "costs", "tierKey", ["tierKey", "mp"], (c, cat) => {
    const mp = whole(own(c, "mp"), [...cat, "mp"], p, "mp");
    return mp === null ? null : { tierKey: own(c, "tierKey") as string, mp };
  });
  const forbidden = bool(own(r, "forbidden"), [...at, "forbidden"], p, "forbidden");
  const effect = text(own(r, "effect"), [...at, "effect"], p, "effect");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return done(p, before, { traitKey, engines, costs, forbidden, effect, source }, traitKey, forbidden, effect, source);
}

function readMissionRule(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const ruleKey = token(own(r, "ruleKey"), [...at, "ruleKey"], p, "ruleKey");
  const shape = readEnum(own(r, "shape"), MISSION_RULE_SHAPES, [...at, "shape"], p, C.INVALID_PAYLOAD, "mission rule shape");
  const parts: Record<string, unknown> = { rollTable: own(r, "rollTable"), clock: own(r, "clock"), intel: own(r, "intel"), points: own(r, "points") };
  const expected = shape === null ? null : shape.toLowerCase().replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()); // ROLL_TABLE → rollTable
  for (const [k, v] of Object.entries(parts)) if (k !== expected && v !== null) p.add(C.INVALID_PAYLOAD, [...at, k], `a ${shape ?? "?"} rule has no ${k} (null)`);
  let rollTable: Out | null = null;
  let clock: Out | null = null;
  let intel: Out | null = null;
  let points: string[] | null = null;
  if (shape === "ROLL_TABLE") {
    const t = readRecord(parts.rollTable, [...at, "rollTable"], p, C.INVALID_PAYLOAD, ["dieCount", "dieFaces", "rows"], ["dieCount", "dieFaces", "rows"]);
    if (t !== null) {
      const dieCount = whole(own(t, "dieCount"), [...at, "rollTable", "dieCount"], p, "dieCount", { min: 1 });
      const dieFaces = whole(own(t, "dieFaces"), [...at, "rollTable", "dieFaces"], p, "dieFaces", { min: 2 });
      const raw = own(t, "rows");
      const rows: { from: number; to: number; result: string }[] = [];
      if (!Array.isArray(raw) || raw.length === 0) p.add(C.INVALID_PAYLOAD, [...at, "rollTable", "rows"], "rows is a non-empty list of { from, to, result }");
      else
        raw.forEach((x: unknown, i: number) => {
          const row = readRecord(x, [...at, "rollTable", "rows", i], p, C.INVALID_PAYLOAD, ["from", "to", "result"], ["from", "to", "result"]);
          if (row === null) return;
          const from = whole(own(row, "from"), [...at, "rollTable", "rows", i, "from"], p, "from", { min: 1 });
          const to = whole(own(row, "to"), [...at, "rollTable", "rows", i, "to"], p, "to", { min: 1 });
          const result = text(own(row, "result"), [...at, "rollTable", "rows", i, "result"], p, "result");
          if (from !== null && to !== null && from > to) p.add(C.INVALID_PAYLOAD, [...at, "rollTable", "rows", i, "to"], "a row's range runs from low to high");
          if (from !== null && to !== null && result !== null) rows.push({ from, to, result });
        });
      // Coverage: the rows cover every possible roll exactly once, in order (no gap, no overlap).
      if (dieCount !== null && dieFaces !== null && rows.length === (Array.isArray(raw) ? raw.length : -1)) {
        const low = dieCount;
        const high = m4("dice * sides", { dice: dieCount, sides: dieFaces });
        let expect: number | null = low;
        for (const [i, row] of rows.entries()) {
          if (row.from !== expect) p.add(C.INVALID_PAYLOAD, [...at, "rollTable", "rows", i, "from"], `the table must continue at ${String(expect)} (no gap or overlap)`);
          expect = m4("last + 1", { last: row.to });
        }
        if (high === null || expect !== m4("last + 1", { last: high })) p.add(C.INVALID_PAYLOAD, [...at, "rollTable", "rows"], `the rows must cover ${low}–${String(high)} exactly`);
      }
      rollTable = { dieCount, dieFaces, rows };
    }
  } else if (shape === "CLOCK") {
    const c = readRecord(parts.clock, [...at, "clock"], p, C.INVALID_PAYLOAD, ["segments", "visibility", "advancesWhen", "escalations"], ["segments", "visibility", "advancesWhen", "escalations"]);
    if (c !== null) {
      const segments = whole(own(c, "segments"), [...at, "clock", "segments"], p, "segments", { min: 1 });
      const visibility = readEnum(own(c, "visibility"), CLOCK_VISIBILITIES, [...at, "clock", "visibility"], p, C.INVALID_PAYLOAD, "visibility");
      const advancesWhen = texts(own(c, "advancesWhen"), [...at, "clock", "advancesWhen"], p, "advancesWhen");
      const raw = own(c, "escalations");
      const escalations: { atSegment: number; text: string }[] = [];
      if (!Array.isArray(raw)) p.add(C.INVALID_PAYLOAD, [...at, "clock", "escalations"], "escalations is a list of { atSegment, text }");
      else
        raw.forEach((x: unknown, i: number) => {
          const e = readRecord(x, [...at, "clock", "escalations", i], p, C.INVALID_PAYLOAD, ["atSegment", "text"], ["atSegment", "text"]);
          if (e === null) return;
          const atSegment = whole(own(e, "atSegment"), [...at, "clock", "escalations", i, "atSegment"], p, "atSegment", { min: 1 });
          const t = text(own(e, "text"), [...at, "clock", "escalations", i, "text"], p, "escalation text");
          const previous = escalations.at(-1);
          if (atSegment !== null && segments !== null && atSegment > segments) p.add(C.INVALID_PAYLOAD, [...at, "clock", "escalations", i, "atSegment"], `an escalation is at segment ${segments} or earlier`);
          else if (atSegment !== null && previous !== undefined && !(atSegment > previous.atSegment)) p.add(C.INVALID_PAYLOAD, [...at, "clock", "escalations", i, "atSegment"], "escalations are in increasing segment order");
          else if (atSegment !== null && t !== null) escalations.push({ atSegment, text: t });
        });
      clock = { segments, visibility, advancesWhen, escalations };
    }
  } else if (shape === "INTEL") {
    const t = readRecord(parts.intel, [...at, "intel"], p, C.INVALID_PAYLOAD, ["uses"], ["uses"]);
    if (t !== null) intel = { uses: texts(own(t, "uses"), [...at, "intel", "uses"], p, "uses", true) };
  } else if (shape === "POINTS") {
    points = texts(parts.points, [...at, "points"], p, "rule points", true);
  }
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return done(p, before, { ruleKey, shape, rollTable, clock, intel, points, source }, ruleKey, shape, source);
}

function readMetamagic(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const metamagicKey = token(own(r, "metamagicKey"), [...at, "metamagicKey"], p, "metamagicKey");
  const form = readEnum(own(r, "form"), METAMAGIC_FORMS, [...at, "form"], p, C.INVALID_PAYLOAD, "Metamagic form");
  const mp = whole(own(r, "mp"), [...at, "mp"], p, "mp", { nullable: true });
  const ap = whole(own(r, "ap"), [...at, "ap"], p, "ap", { nullable: true });
  const otherCost = text(own(r, "otherCost"), [...at, "otherCost"], p, "otherCost", true);
  const effect = text(own(r, "effect"), [...at, "effect"], p, "effect");
  const restrictions = texts(own(r, "restrictions"), [...at, "restrictions"], p, "restrictions");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return done(p, before, { metamagicKey, form, mp, ap, otherCost, effect, restrictions, source }, metamagicKey, form, effect, source);
}

function readJobTemplate(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const jobKey = token(own(r, "jobKey"), [...at, "jobKey"], p, "jobKey");
  const role = text(own(r, "role"), [...at, "role"], p, "role");
  const rawStats = own(r, "suggestedStats");
  const suggestedStats: ProwessStat[] = [];
  if (!Array.isArray(rawStats)) p.add(C.INVALID_PAYLOAD, [...at, "suggestedStats"], "suggestedStats is a list of Stats");
  else
    rawStats.forEach((s: unknown, i: number) => {
      const v = readEnum(s, PROWESS_STATS, [...at, "suggestedStats", i], p, C.INVALID_PAYLOAD, "Stat");
      if (v !== null && !suggestedStats.includes(v)) suggestedStats.push(v);
    });
  const rawSkills = own(r, "suggestedSkills");
  const suggestedSkills: ProwessDefinitionRef[] = [];
  if (!Array.isArray(rawSkills)) p.add(C.INVALID_PAYLOAD, [...at, "suggestedSkills"], "suggestedSkills is a list of exact SKILL references");
  else
    rawSkills.forEach((x: unknown, i: number) => {
      const ref = readDefinitionRef(x, [...at, "suggestedSkills", i], p, C.INVALID_PAYLOAD);
      if (ref !== null && ref.definitionKind !== "SKILL") p.add(C.INVALID_PAYLOAD, [...at, "suggestedSkills", i, "definitionKind"], "a suggested Skill is an exact SKILL Definition");
      else if (ref !== null) suggestedSkills.push(ref);
    });
  const startingEquipment = texts(own(r, "startingEquipment"), [...at, "startingEquipment"], p, "startingEquipment");
  const features = texts(own(r, "features"), [...at, "features"], p, "features");
  const source = readSource(own(r, "source"), [...at, "source"], p);
  return done(p, before, { jobKey, role, suggestedStats, suggestedSkills, startingEquipment, features, source }, jobKey, role, source);
}

function readReferenceRule(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const shape = own(r, "shape");
  if (!(REFERENCE_RULE_SHAPES as readonly unknown[]).includes(shape)) {
    p.add(C.INVALID_PAYLOAD, [...at, "shape"], `a gameplay reference rule is a ${REFERENCE_RULE_SHAPES.join(" or ")}`);
    return null;
  }
  return readMissionRule(r, at, p);
}

const FIELDS: Readonly<Record<RulesReferencePayloadKind, readonly string[]>> = {
  ARMOR: ["armorKey", "category", "armorValue", "strengthRequirement", "maxAgiForDodge", "movementPenaltyFeet", "stealth", "notes", "source"],
  STATUS_CONDITION: ["conditionKey", "effects", "duration", "removal", "ongoingTiming", "stacking", "source"],
  SUMMON_TYPE: ["summonKey", "engine", "tiers", "castingAp", "sustainMode", "sustainMp", "sustainApPerRound", "countsTowardConcentration", "maxActive", "actionEconomy", "restrictions", "openQuestions", "source"],
  SUMMON_TRAIT: ["traitKey", "engines", "costs", "forbidden", "effect", "source"],
  MISSION_RULE: ["ruleKey", "shape", "rollTable", "clock", "intel", "points", "source"],
  METAMAGIC: ["metamagicKey", "form", "mp", "ap", "otherCost", "effect", "restrictions", "source"],
  JOB_TEMPLATE: ["jobKey", "role", "suggestedStats", "suggestedSkills", "startingEquipment", "features", "source"],
  REFERENCE_RULE: ["ruleKey", "shape", "rollTable", "clock", "intel", "points", "source"],
};
const READERS = { ARMOR: readArmor, STATUS_CONDITION: readCondition, SUMMON_TYPE: readSummonType, SUMMON_TRAIT: readSummonTrait, MISSION_RULE: readMissionRule, METAMAGIC: readMetamagic, JOB_TEMPLATE: readJobTemplate, REFERENCE_RULE: readReferenceRule } as const;

/** Validates `value` as the version-1 payload of a Phase C reference kind (the caller checked the version). */
export function readRulesReferencePayload(kind: RulesReferencePayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS[kind], FIELDS[kind]);
  return r === null ? null : READERS[kind](r, at, p);
}

/** MAGE_ART payload version 2: v1 plus per-mode scaling steps, granted benefits and maintenance exceptions (text). */
export function readMageArtV2Extras(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems): { grantedBenefits: string[]; maintenanceExceptions: string[]; scaling: Record<string, { stepKey: string; label: string; text: string }[]> } {
  const grantedBenefits = texts(own(r, "grantedBenefits"), [...at, "grantedBenefits"], p, "grantedBenefits");
  const maintenanceExceptions = texts(own(r, "maintenanceExceptions"), [...at, "maintenanceExceptions"], p, "maintenanceExceptions");
  const scaling: Record<string, { stepKey: string; label: string; text: string }[]> = {};
  const raw = own(r, "modes");
  if (Array.isArray(raw))
    raw.forEach((m: unknown, i: number) => {
      if (!isPlainObject(m)) return;
      const steps = keyedRows(own(m, "scaling"), [...at, "modes", i, "scaling"], p, "scaling", "stepKey", ["stepKey", "label", "text"], (s, sat) => {
        const label = text(own(s, "label"), [...sat, "label"], p, "step label");
        const t = text(own(s, "text"), [...sat, "text"], p, "step text");
        return label === null || t === null ? null : { stepKey: own(s, "stepKey") as string, label, text: t };
      });
      scaling[String(own(m, "modeKey"))] = steps;
    });
  return { grantedBenefits, maintenanceExceptions, scaling };
}

export type { CoreDefinitionSource };
