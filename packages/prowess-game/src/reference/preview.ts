import { evaluateFormula } from "@prowess/rules";
import type { ValueFormula } from "../definition/rules-authoring-payload.js";
import { deepFreeze } from "../internal/plain-data.js";
import type { ProwessStat } from "../vocabulary/core.js";

/**
 * RULES-WO1 Phase C — PREVIEWS of reference rule families for sample inputs. Pure; every number goes through M4. None of
 * these is the live rule: Armor is not equipped on the sheet, no Summon is played and no Mission is generated in
 * RULES-WO1, so every result carries `appliesInPlay: false`.
 */
export interface ArmorPreviewInput {
  readonly armor: { readonly armorValue: number; readonly strengthRequirement: number | null; readonly maxAgiForDodge: number | null; readonly movementPenaltyFeet: number; readonly stealth: string };
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
}

function m4(expression: string, bindings: Record<string, number>): number | null {
  const out = evaluateFormula({ expression, rounding: "NONE" }, bindings);
  return out.success && out.data !== null ? out.data.finalValue : null;
}
function run(formula: ValueFormula, bindings: Record<string, number>): number | null {
  const out = evaluateFormula({ expression: formula.expression, rounding: formula.rounding, minimum: formula.minimum, maximum: formula.maximum, unit: null }, bindings);
  return out.success && out.data !== null ? out.data.finalValue : null;
}

export function previewArmor(input: ArmorPreviewInput) {
  const { armor, stats } = input;
  const agi = stats.AGI;
  const str = stats.STR;
  const agiCountedForDodge = typeof agi !== "number" ? null : armor.maxAgiForDodge === null ? agi : m4("min(agility, cap)", { agility: agi, cap: armor.maxAgiForDodge });
  const meetsStrengthRequirement = armor.strengthRequirement === null ? true : typeof str !== "number" ? null : str >= armor.strengthRequirement;
  return deepFreeze({
    armorValue: armor.armorValue,
    agiCountedForDodge,
    agiCapped: typeof agi === "number" && agiCountedForDodge !== null && agiCountedForDodge !== agi,
    meetsStrengthRequirement,
    movementPenaltyFeet: armor.movementPenaltyFeet,
    stealthDisadvantage: armor.stealth === "DISADVANTAGE",
    appliesInPlay: false as const,
  });
}

/** Bindings for a Summon cost Formula: each STAT input from `stats`, each TOTAL_MP input from `totalMp`. */
function summonBindings(formula: ValueFormula, stats: Readonly<Partial<Record<ProwessStat, number>>>, totalMp: number | null): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const { variable, source } of formula.variables) {
    const v = source.kind === "STAT" ? stats[source.stat] : source.kind === "TOTAL_MP" ? totalMp : undefined;
    if (typeof v !== "number") return null;
    out[variable] = v;
  }
  return out;
}

export function previewSummonCosts(input: {
  readonly summon: { readonly castingAp: ValueFormula | null; readonly sustainMp: ValueFormula | null; readonly sustainApPerRound: number | null; readonly maxActive: ValueFormula | null; readonly countsTowardConcentration: boolean | null; readonly tiers: readonly { readonly tierKey: string; readonly baseMp: number | null }[] };
  readonly tierKey: string | null;
  readonly totalMp: number | null;
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
}) {
  const tier = input.tierKey === null ? undefined : input.summon.tiers.find((t) => t.tierKey === input.tierKey);
  const totalMp = input.totalMp ?? tier?.baseMp ?? null;
  const at = (f: ValueFormula | null) => {
    if (f === null) return null;
    const b = summonBindings(f, input.stats, totalMp);
    return b === null ? null : run(f, b);
  };
  return deepFreeze({
    totalMp,
    castingAp: at(input.summon.castingAp),
    sustainMp: at(input.summon.sustainMp),
    sustainApPerRound: input.summon.sustainApPerRound,
    maxActive: at(input.summon.maxActive),
    countsTowardConcentration: input.summon.countsTowardConcentration,
    appliesInPlay: false as const,
  });
}

export function previewMissionTable(input: { readonly table: { readonly rows: readonly { readonly from: number; readonly to: number; readonly result: string }[] }; readonly roll: number }) {
  const row = input.table.rows.find((r) => input.roll >= r.from && input.roll <= r.to) ?? null;
  return deepFreeze({ roll: input.roll, result: row?.result ?? null, appliesInPlay: false as const });
}

export function previewThreatClock(input: { readonly clock: { readonly segments: number; readonly escalations: readonly { readonly atSegment: number; readonly text: string }[] }; readonly filled: number }) {
  const reached = input.clock.escalations.filter((e) => e.atSegment <= input.filled);
  return deepFreeze({ filled: input.filled, segments: input.clock.segments, complete: input.filled >= input.clock.segments, reached: reached.map((e) => e.text), appliesInPlay: false as const });
}
