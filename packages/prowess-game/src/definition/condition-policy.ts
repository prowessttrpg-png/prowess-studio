import { validateFormulaProgram } from "@prowess/rules";
import { CONDITION_POLICY } from "../content/core-playtest-v0.1/duration-conditions.js";
import type { PathSegment } from "../internal/plain-data.js";
import { Problems, own, readRecord } from "../internal/problems.js";
import { DURATION_CONDITION_ERRORS } from "./duration-condition-payload.js";
export interface ConditionFormula { readonly expression: string; readonly variables: readonly string[]; }
export interface ConditionPolicy {
  readonly spellMpPercentMaximum: number;
  readonly maneuverApMaximum: number;
  readonly formulas: Readonly<Record<keyof typeof CONDITION_POLICY.formulas, ConditionFormula>>;
}
export function readConditionPolicy(value: unknown, at: readonly PathSegment[], p: Problems): ConditionPolicy | null {
  const before = p.count, e = DURATION_CONDITION_ERRORS.INVALID;
  const r = readRecord(value, at, p, e, ["spellMpPercentMaximum", "maneuverApMaximum", "formulas"], ["spellMpPercentMaximum", "maneuverApMaximum", "formulas"]); if (!r) return null;
  for (const k of ["spellMpPercentMaximum", "maneuverApMaximum"] as const) if (own(r, k) !== CONDITION_POLICY[k]) p.add(e, [...at, k], "flat designer-ruling maximum must be preserved independently of rank capacity");
  const keys = Object.keys(CONDITION_POLICY.formulas) as (keyof typeof CONDITION_POLICY.formulas)[], fr = readRecord(own(r, "formulas"), [...at, "formulas"], p, e, keys, keys);
  const formulas: Record<string, ConditionFormula> = {};
  if (fr) for (const key of keys) {
    const q = readRecord(own(fr, key), [...at, "formulas", key], p, e, ["expression", "variables"], ["expression", "variables"]); if (!q) continue;
    const program = validateFormulaProgram({ expression: own(q, "expression") }), variables = own(q, "variables");
    if (!program.ok || !Array.isArray(variables) || JSON.stringify(variables) !== JSON.stringify(CONDITION_POLICY.formulas[key].variables) || program.program.variables.some(v => !(variables as string[]).includes(v))) p.add(e, [...at, "formulas", key], "M4 Formula with only the slot's declared inputs required");
    else formulas[key] = { expression: own(q, "expression") as string, variables: variables as string[] };
  }
  return p.count > before ? null : { spellMpPercentMaximum: own(r, "spellMpPercentMaximum") as number, maneuverApMaximum: own(r, "maneuverApMaximum") as number, formulas: formulas as ConditionPolicy["formulas"] };
}
