import { isValidContextKey } from "../context/context-key.js";
import { RULE_ENGINE_ERROR_CODES, RulesEngineError } from "../errors/engine-error.js";
import { InputProblems, MAX_TEXT_LENGTH, readContextKey, readFiniteNumber, readRecord } from "../internal/input-reader.js";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";

/**
 * A minimal typed value for trace inputs and outputs (PAS-10 M4-WO1 §35–36). It only fixes the SHAPE later systems
 * share; M4-WO3 owns formula value semantics (coercion, arithmetic, rounding). No expression language exists here.
 *
 *  - NUMBER carries an optional semantic `unit` label (a context key such as `unit.example`). No unit is built in and
 *    none is interpreted: the engine hard-codes no length, resource or action unit.
 *  - Numbers are finite; `-0` is normalized to `0`. No rounding is ever applied implicitly — rounding is always an
 *    explicit rule (§34, implemented by M4-WO3).
 */
export const EVALUATION_VALUE_TYPES = ["NUMBER", "BOOLEAN", "STRING", "IDENTIFIER", "LIST"] as const;
export type EvaluationValueType = (typeof EVALUATION_VALUE_TYPES)[number];

export type EvaluationValue =
  | { readonly type: "NUMBER"; readonly value: number; readonly unit: string | null }
  | { readonly type: "BOOLEAN"; readonly value: boolean }
  | { readonly type: "STRING"; readonly value: string }
  | { readonly type: "IDENTIFIER"; readonly value: string }
  | { readonly type: "LIST"; readonly items: readonly EvaluationValue[] };

/** A NUMBER value. Throws `RULE_ENGINE.NON_FINITE_NUMBER` for NaN / ±Infinity and `INVALID_INPUT` for a bad unit. */
export function numberValue(value: number, unit: string | null = null): EvaluationValue {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.NON_FINITE_NUMBER, `${String(value)} is not a finite number`, { details: { value: String(value) } });
  }
  if (unit !== null && !isValidContextKey(unit)) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVALID_INPUT, "a unit label must be a context key");
  }
  return { type: "NUMBER", value: Object.is(value, -0) ? 0 : value, unit };
}

export function booleanValue(value: boolean): EvaluationValue {
  return { type: "BOOLEAN", value };
}

export function stringValue(value: string): EvaluationValue {
  return { type: "STRING", value };
}

/** An IDENTIFIER value: a context key, canonical key or other symbolic name — never free text. */
export function identifierValue(value: string): EvaluationValue {
  if (!isValidContextKey(value)) throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVALID_INPUT, "an identifier value must be a context key");
  return { type: "IDENTIFIER", value };
}

export function listValue(items: readonly EvaluationValue[]): EvaluationValue {
  return { type: "LIST", items: [...items] };
}

/** Internal: structural read of an evaluation value supplied by an evaluator (e.g. inside a trace step). */
export function readEvaluationValue(value: unknown, at: readonly PathSegment[], p: InputProblems): EvaluationValue | null {
  if (!isPlainObject(value)) {
    p.invalid(at, "expected an evaluation value object");
    return null;
  }
  const r = value;
  switch (r.type) {
    case "NUMBER": {
      readRecord(r, at, p, ["type", "value", "unit"]);
      const n = readFiniteNumber(r.value, [...at, "value"], p);
      const unit = r.unit === undefined || r.unit === null ? null : readContextKey(r.unit, [...at, "unit"], p);
      return n === null ? null : { type: "NUMBER", value: n, unit };
    }
    case "BOOLEAN":
      readRecord(r, at, p, ["type", "value"]);
      if (typeof r.value !== "boolean") p.invalid([...at, "value"], "expected a boolean");
      return typeof r.value === "boolean" ? { type: "BOOLEAN", value: r.value } : null;
    case "STRING":
      readRecord(r, at, p, ["type", "value"]);
      if (typeof r.value !== "string" || r.value.length > MAX_TEXT_LENGTH) p.invalid([...at, "value"], "expected a string");
      return typeof r.value === "string" ? { type: "STRING", value: r.value } : null;
    case "IDENTIFIER": {
      readRecord(r, at, p, ["type", "value"]);
      const id = readContextKey(r.value, [...at, "value"], p);
      return id === null ? null : { type: "IDENTIFIER", value: id };
    }
    case "LIST": {
      readRecord(r, at, p, ["type", "items"]);
      if (!Array.isArray(r.items)) {
        p.invalid([...at, "items"], "expected an array of evaluation values");
        return null;
      }
      const items: EvaluationValue[] = [];
      r.items.forEach((item: unknown, i: number) => {
        const read = readEvaluationValue(item, [...at, "items", i], p);
        if (read !== null) items.push(read);
      });
      return { type: "LIST", items };
    }
    default:
      p.invalid([...at, "type"], `expected one of ${EVALUATION_VALUE_TYPES.join(", ")}`);
      return null;
  }
}
