import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { composeFormula, presentFormula, renameFormulaVariable, type FormulaPresentation, type FormulaTermInput } from "./formula-presentation.js";

/**
 * PRE-M7-WO1 — the Studio's guided-Formula operations (POST /api/compendium-rules/formula). This module only VALIDATES
 * the request and labels sources: parsing, classifying and printing belong to the M4 Formula engine
 * (`validateFormulaProgram`); formula-presentation.ts only classifies and prints the engine-validated tree. Pure: no database access, nothing written.
 */
const invalid = (message: string) => new DomainError(CHARACTER_ERROR_CODES.INVALID_INPUT, message);

/** A core Formula variable source as authored (`{ kind, stat? | statistic? | field? }`). */
export interface FormulaSource {
  readonly kind: string;
  readonly stat?: string;
  readonly statistic?: string;
  readonly field?: string;
  /** RULES-WO1: the authored calculated value a `{ kind: "CALCULATED_VALUE" }` input reads. */
  readonly valueKey?: string;
}

const title = (t: string) => t.toLowerCase().split("_").map((w) => (w === "" ? w : w[0]!.toUpperCase() + w.slice(1))).join(" ");

/** A reader-facing label for a source ("Stat STR", "derived Strength Armor", "Character Level", "Explicit Bonuses"). */
export function formulaSourceLabel(s: FormulaSource): string {
  if (s.kind === "STAT") return `Stat ${s.stat ?? "?"}`;
  if (s.kind === "DERIVED") return `derived ${title(s.statistic ?? "?")}`;
  if (s.kind === "CHARACTER") return `Character ${title(s.field ?? "?")}`;
  if (s.kind === "LEVEL") return "Character Level";
  if (s.kind === "CAST_AP") return "the Spell's casting AP";
  if (s.kind === "CALCULATED_VALUE") return `value ${title(s.valueKey ?? "?")}`;
  if (s.kind === "") return "no source";
  return title(s.kind);
}

/** A readable, unused Formula variable name for a source (`str`, `con`, `accuracy`, `level`, `bonuses` …). */
export function variableNameFor(s: FormulaSource, taken: readonly string[]): string {
  const stem = (s.kind === "STAT" ? s.stat : s.kind === "DERIVED" ? s.statistic : s.kind === "CHARACTER" ? s.field : s.kind === "EXPLICIT_BONUSES" ? "bonuses" : s.kind === "CALCULATED_VALUE" ? s.valueKey : s.kind)?.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "input";
  const base = /^[a-z_]/.test(stem) ? stem : `v_${stem}`;
  let name = base;
  for (let i = 2; taken.includes(name); i += 1) name = `${base}_${i}`;
  return name;
}

/** What the Studio's Formula editor shows: the engine's presentation plus a label per declared source. */
export interface FormulaDescription extends FormulaPresentation {
  readonly sourceLabels: readonly string[];
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isSign = (v: unknown): v is 1 | -1 => v === 1 || v === -1;
const isIdent = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) && v.length <= 64;

function readTerm(x: unknown, i: number): FormulaTermInput {
  if (x === null || typeof x !== "object") throw invalid(`terms[${i}] must be an object`);
  const t = x as Record<string, unknown>;
  if (!isSign(t.sign)) throw invalid(`terms[${i}].sign is 1 or -1`);
  switch (t.kind) {
    case "CONSTANT":
      if (!isNumber(t.value) || t.value < 0) throw invalid(`terms[${i}].value is a non-negative number`);
      return { sign: t.sign, kind: "CONSTANT", value: t.value };
    case "INPUT":
      if (!isIdent(t.variable)) throw invalid(`terms[${i}].variable is a Formula variable name`);
      return { sign: t.sign, kind: "INPUT", variable: t.variable };
    case "SCALED":
      if (!isIdent(t.variable) || !isNumber(t.factor) || t.factor < 0) throw invalid(`terms[${i}] needs a variable and a non-negative multiplier`);
      return { sign: t.sign, kind: "SCALED", variable: t.variable, factor: t.factor };
    case "DIVIDED":
      if (!isIdent(t.variable) || !isNumber(t.divisor) || t.divisor < 0 || !(t.rounding === null || t.rounding === "floor" || t.rounding === "ceil")) throw invalid(`terms[${i}] needs a variable, a non-negative divisor and a rounding of floor, ceil or none`);
      return { sign: t.sign, kind: "DIVIDED", variable: t.variable, divisor: t.divisor, rounding: t.rounding };
    case "OTHER":
      if (typeof t.text !== "string" || t.text.length > 500) throw invalid(`terms[${i}].text is the term's expression`);
      return { sign: t.sign, kind: "OTHER", text: t.text };
    default:
      throw invalid(`terms[${i}].kind is CONSTANT, INPUT, SCALED, DIVIDED or OTHER`);
  }
}

function readSources(v: unknown): FormulaSource[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50) throw invalid("sources is a list of at most 50 Formula sources");
  return v.map((x, i) => {
    if (x === null || typeof x !== "object") throw invalid(`sources[${i}] must be an object`);
    const r = x as Record<string, unknown>;
    const str = (k: string) => (typeof r[k] === "string" && (r[k] as string).length <= 64 ? (r[k] as string) : undefined);
    return { kind: str("kind") ?? "", ...(str("stat") ? { stat: str("stat") } : {}), ...(str("statistic") ? { statistic: str("statistic") } : {}), ...(str("field") ? { field: str("field") } : {}), ...(str("valueKey") ? { valueKey: str("valueKey") } : {}) };
  });
}

const describe = (expression: string, sources: readonly FormulaSource[]): FormulaDescription => ({ ...presentFormula(expression), sourceLabels: sources.map(formulaSourceLabel) });

const MAX_EXPRESSION = 2000;
const readExpression = (v: unknown) => {
  if (typeof v !== "string" || v.length > MAX_EXPRESSION) throw invalid(`expression is text of at most ${MAX_EXPRESSION} characters`);
  return v;
};

/**
 * The single Studio entry point: `describe` → the description; `compose` (terms) → the rebuilt expression; `rename` →
 * the expression with one variable renamed; `name` → an unused variable name for a source.
 */
export function formulaGuide(body: Record<string, unknown>): Record<string, unknown> {
  const sources = readSources(body.sources);
  switch (body.op) {
    case "describe":
      return { description: describe(readExpression(body.expression), sources) };
    case "compose": {
      if (!Array.isArray(body.terms) || body.terms.length > 50) throw invalid("terms is a list of at most 50 contributions");
      const out = composeFormula(body.terms.map(readTerm));
      return out.ok ? { ok: true, expression: out.expression, variables: out.variables, description: describe(out.expression, sources) } : { ok: false, reason: out.reason };
    }
    case "rename": {
      const expression = readExpression(body.expression);
      if (!isIdent(body.from) || !isIdent(body.to)) throw invalid("from and to are Formula variable names");
      const out = renameFormulaVariable(expression, body.from, body.to);
      return out.ok ? { ok: true, expression: out.expression, description: describe(out.expression, sources) } : out;
    }
    case "name": {
      const [source] = readSources([body.source]);
      if (!Array.isArray(body.taken) || !body.taken.every(isIdent)) throw invalid("taken is a list of variable names");
      return { variable: variableNameFor(source!, body.taken as string[]), label: formulaSourceLabel(source!) };
    }
    default:
      throw invalid("op is describe, compose, rename or name");
  }
}
