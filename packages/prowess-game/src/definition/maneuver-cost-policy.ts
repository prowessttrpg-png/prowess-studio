import { validateFormulaProgram } from "@prowess/rules";
import { MANEUVER_COST_POLICY } from "../content/core-playtest-v0.1/maneuver-cost.js";
import type { PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, isToken, own, readRecord, readSafeInteger } from "../internal/problems.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";

type Slot = keyof typeof MANEUVER_COST_POLICY.formulas;
export interface ManeuverCostPolicy {
  readonly signatureApReduction: number;
  readonly minimumAp: number;
  readonly minimumMp: number;
  readonly unresolvedComponentCosts: readonly { readonly canonicalKey: string; readonly conflictKey: string }[];
  readonly inherentRestrictionKeys: readonly string[];
  readonly formulas: Readonly<Record<Slot, { readonly expression: string; readonly variables: readonly string[] }>>;
  readonly authority: readonly string[];
}
/** Additive M5-WO11 policy inside ABILITY_CONSTRUCTION_RULE. Formula slots read only their declared inputs. */
export function readManeuverCostPolicy(value: unknown, at: readonly PathSegment[], p: Problems): ManeuverCostPolicy | null {
  const before = p.count, e = C.INVALID_PAYLOAD;
  const fields = ["signatureApReduction", "minimumAp", "minimumMp", "unresolvedComponentCosts", "inherentRestrictionKeys", "formulas", "authority"];
  const r = readRecord(value, at, p, e, fields, fields); if (!r) return null;
  const n = (k: string, positive: boolean) => { const v = readSafeInteger(own(r, k), [...at, k], p, e, k); if (v !== null && (v < 0 || (positive && v === 0))) p.add(e, [...at, k], `${k} is a ${positive ? "positive" : "non-negative"} integer`); return v ?? 0; };
  const signatureApReduction = n("signatureApReduction", true), minimumAp = n("minimumAp", true), minimumMp = n("minimumMp", false);
  const rawUnresolved = own(r, "unresolvedComponentCosts"), unresolved: { canonicalKey: string; conflictKey: string }[] = [];
  if (!Array.isArray(rawUnresolved)) p.add(e, [...at, "unresolvedComponentCosts"], "array of exact unresolved component costs");
  else rawUnresolved.forEach((x, i) => {
    const q = readRecord(x, [...at, "unresolvedComponentCosts", i], p, e, ["canonicalKey", "conflictKey"], ["canonicalKey", "conflictKey"]); if (!q) return;
    if (!isExactCanonicalKey(own(q, "canonicalKey")) || typeof own(q, "conflictKey") !== "string" || !/^M5-SC-\d{3}$/.test(own(q, "conflictKey") as string)) p.add(e, [...at, "unresolvedComponentCosts", i], "exact canonical key and M5 conflict key");
    else unresolved.push({ canonicalKey: own(q, "canonicalKey") as string, conflictKey: own(q, "conflictKey") as string });
  });
  const inherent = own(r, "inherentRestrictionKeys");
  if (!Array.isArray(inherent) || !inherent.every(isToken) || new Set(inherent).size !== inherent.length) p.add(e, [...at, "inherentRestrictionKeys"], "unique restriction tokens");
  const keys = Object.keys(MANEUVER_COST_POLICY.formulas) as Slot[], fr = readRecord(own(r, "formulas"), [...at, "formulas"], p, e, keys, keys);
  const formulas: Record<string, { expression: string; variables: string[] }> = {};
  if (fr) for (const key of keys) {
    const q = readRecord(own(fr, key), [...at, "formulas", key], p, e, ["expression", "variables"], ["expression", "variables"]); if (!q) continue;
    const program = validateFormulaProgram({ expression: own(q, "expression") }), variables = own(q, "variables");
    if (!program.ok || !Array.isArray(variables) || JSON.stringify(variables) !== JSON.stringify(MANEUVER_COST_POLICY.formulas[key].variables) || program.program.variables.some(v => !(variables as string[]).includes(v))) p.add(e, [...at, "formulas", key], "M4 Formula reading only the slot's declared inputs");
    else formulas[key] = { expression: own(q, "expression") as string, variables: variables as string[] };
  }
  const authority = own(r, "authority");
  if (!Array.isArray(authority) || !authority.every(x => typeof x === "string")) p.add(e, [...at, "authority"], "authority is a list of source locators");
  return p.count > before ? null : { signatureApReduction, minimumAp, minimumMp, unresolvedComponentCosts: unresolved, inherentRestrictionKeys: inherent as string[], formulas: formulas as unknown as ManeuverCostPolicy["formulas"], authority: authority as string[] };
}
