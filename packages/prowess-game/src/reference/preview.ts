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
function m4Rounded(expression: string, bindings: Record<string, number>, rounding: "FLOOR" | "CEIL"): number | null {
  const out = evaluateFormula({ expression, rounding }, bindings);
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

// ---- RULES-WO1 Phase D -------------------------------------------------------------------------------------------------

export interface ReloadPreviewInput {
  /** The weapon's Loading (X) capacity and Reload AP (its LOADING / RELOAD properties), and the AP a turn provides. */
  readonly loading: number;
  readonly reloadAp: number;
  readonly apPerTurn: number;
  /** The ammunition used: how many rounds a normal attack (and a Burst, when stated) consumes. */
  readonly ammunition: { readonly perAttack: number; readonly burstPerAttack: number | null } | null;
  /** Modifications fitted: only their LOADING and RELOAD_AP changes affect this preview. */
  readonly modifications: readonly { readonly changes: readonly { readonly kind: string; readonly amount: number | null }[] }[];
}

/** Attacks before a reload and how a reload's AP splits across turns (Reload AP may be split across turns). */
export function previewReload(input: ReloadPreviewInput) {
  const sumOf = (kind: string) => input.modifications.flatMap((m) => m.changes).filter((c) => c.kind === kind && c.amount !== null).map((c) => c.amount as number);
  const add = (base: number, deltas: readonly number[]) => (deltas.length === 0 ? base : m4(["base", ...deltas.map((_, i) => `d${i}`)].join(" + "), Object.fromEntries([["base", base], ...deltas.map((d, i) => [`d${i}`, d])])));
  const loading = add(input.loading, sumOf("LOADING"));
  const reloadAp = add(input.reloadAp, sumOf("RELOAD_AP"));
  const loadingClamped = loading === null ? null : m4("max(0, value)", { value: loading });
  const reloadClamped = reloadAp === null ? null : m4("max(0, value)", { value: reloadAp });
  const each = input.ammunition?.perAttack ?? 1;
  // Whole attacks only (M4 rounds down), and whole turns (M4 rounds up).
  const attacksBeforeReload = loadingClamped === null ? null : m4Rounded("capacity / each", { capacity: loadingClamped, each }, "FLOOR");
  const burstAttacksBeforeReload = loadingClamped === null || input.ammunition?.burstPerAttack == null ? null : m4Rounded("capacity / each", { capacity: loadingClamped, each: input.ammunition.burstPerAttack }, "FLOOR");
  const turnsToReload = reloadClamped === null ? null : m4Rounded("need / turn", { need: reloadClamped, turn: input.apPerTurn }, "CEIL");
  // The AP spent on each turn of the reload: full turns, then the remainder (Reload AP may be split across turns).
  const split: number[] = [];
  if (reloadClamped !== null && turnsToReload !== null)
    Array.from({ length: turnsToReload }).forEach((_, index) => split.push(m4("min(turn, need - index * turn)", { turn: input.apPerTurn, need: reloadClamped, index }) ?? 0));
  return deepFreeze({ loading: loadingClamped, reloadAp: reloadClamped, attacksBeforeReload, burstAttacksBeforeReload, turnsToReload, apSplit: split, appliesInPlay: false as const });
}

export interface MageArtScalingPreviewInput {
  readonly scaling: readonly { readonly scalingKey: string; readonly label: string; readonly unit: string | null; readonly byLevel: readonly { readonly fromLevel: number; readonly toLevel: number; readonly value: number }[] | null; readonly formula: ValueFormula | null }[];
  readonly level: number;
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
}

/** Each scaling of a Mage Art mode at one Level (and the Stats a Formula reads). */
export function previewMageArtScaling(input: MageArtScalingPreviewInput) {
  const values = input.scaling.map((s) => {
    if (s.byLevel !== null) {
      const row = s.byLevel.find((r) => input.level >= r.fromLevel && input.level <= r.toLevel) ?? null;
      return { scalingKey: s.scalingKey, label: s.label, unit: s.unit, value: row === null ? null : row.value, reason: row === null ? `no row covers Level ${input.level}` : null };
    }
    const bindings: Record<string, number> = {};
    let missing: string | null = null;
    for (const { variable, source } of s.formula?.variables ?? []) {
      const v = source.kind === "STAT" ? input.stats[source.stat] : source.kind === "LEVEL" ? input.level : undefined;
      if (typeof v !== "number") missing = source.kind === "STAT" ? source.stat : source.kind;
      else bindings[variable] = v;
    }
    const value = missing !== null || s.formula === null ? null : run(s.formula, bindings);
    return { scalingKey: s.scalingKey, label: s.label, unit: s.unit, value, reason: missing !== null ? `${missing} is needed` : null };
  });
  return deepFreeze({ level: input.level, values, appliesInPlay: false as const });
}

export interface SummonEconomyPreviewInput {
  readonly summon: { readonly sustainMode: string; readonly sustainApPerRound: number | null; readonly ownership: { readonly actionModel: string; readonly actsWhen: string; readonly baseAp: number | null; readonly apOwner: string; readonly hpOwner: string; readonly mpOwner: string; readonly counterActions: boolean | null; readonly dismissal: string } };
}

/** Who acts and who pays each round, as authored (no Summon is created or played). */
export function previewSummonEconomy(input: SummonEconomyPreviewInput) {
  const o = input.summon.ownership;
  return deepFreeze({
    actionModel: o.actionModel,
    actsWhen: o.actsWhen,
    summonApPerRound: o.apOwner === "SUMMON" || o.apOwner === "SPLIT" ? o.baseAp : null,
    usesCasterAp: o.apOwner === "CASTER" || o.apOwner === "SPLIT",
    casterSustainApPerRound: input.summon.sustainMode === "NONE" ? null : input.summon.sustainApPerRound,
    hpOwner: o.hpOwner,
    mpOwner: o.mpOwner,
    counterActions: o.counterActions,
    dismissal: o.dismissal,
    appliesInPlay: false as const,
  });
}
