import { evaluateFormula } from "@prowess/rules";
import { deepFreeze } from "../internal/plain-data.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { DamageProfile, FormulaSlot, TraitContract } from "../definition/equipment-payload.js";
import type { AttackEntry, WeaponEntry } from "./catalog.js";
import type { AttackScaling, WeaponGrip } from "../vocabulary/equipment.js";

/**
 * Character-specific damage PREVIEW (PAS-10 M6-WO6 §25–§31, §81–§82). It produces the exact dice expression the Attack
 * would roll for this Character — it never rolls, never subtracts Armor, never applies Resistance and never spends
 * anything. Every number comes from M4: the Power multiplier and the repeated dice count are the Release's own
 * POWER_SCALING Formulas, the Dual Wield Power is the Release's own Dual Wield Formula. The Versatile die step is the
 * Release's own DIE_STEP table, applied BEFORE Power (§30); a multi-die base fails closed (§31).
 */

export interface DiceExpression {
  readonly count: number;
  readonly sides: number;
  readonly expression: string;
}

export interface DamagePreviewStep {
  readonly step: "BASE" | "VERSATILE_STEP" | "EFFECTIVE_POWER" | "POWER_MULTIPLIER" | "REPEATED_DICE" | "STATIC";
  readonly detail: string;
  readonly source: ProwessDefinitionRef | null;
}

export interface DamagePreview {
  readonly profileKey: string;
  readonly damageType: string;
  readonly status: "PREVIEWED" | "FAIL_CLOSED";
  readonly reason: string | null;
  readonly scaling: AttackScaling;
  readonly base: DiceExpression;
  /** The die after the Versatile step (two-handed grip of a Versatile Weapon), else null. */
  readonly gripAdjusted: DiceExpression | null;
  /** Power-scaled only: authored Power, the Dual Wield adjustment, the effective Power (never below the floor). */
  readonly power: { readonly authored: number; readonly adjustment: number; readonly adjusted: number; readonly minimum: number; readonly scalingStat: string; readonly statScore: number } | null;
  readonly multiplier: number | null;
  readonly final: DiceExpression | null;
  readonly steps: readonly DamagePreviewStep[];
}

/** An explicit Dual Wield Power adjustment for one POWER-scaled Attack (§51–§52). */
export interface PowerAdjustment {
  readonly adjustment: number;
  readonly increment: number;
  readonly sequenceIndex: number;
  readonly rule: ProwessDefinitionRef;
  readonly formula: FormulaSlot;
}

const ONE_DIE = 1;
/** Dice notation ("2d8") — display text of the exact count and sides; never parsed back. */
const notation = (count: number, sides: number) => `${count}d${sides}`;
const dice = (count: number, sides: number): DiceExpression => ({ count, sides, expression: notation(count, sides) });

/** Evaluates one Release-authored M4 Formula slot; null when M4 refuses it (fail closed). */
export function evaluateSlot(slot: FormulaSlot, bindings: Readonly<Record<string, number>>): number | null {
  const response = evaluateFormula({ expression: slot.expression, rounding: "NONE" }, { ...bindings });
  return response.success && response.data !== null ? response.data.finalValue : null;
}

/**
 * Previews one damage profile of one exact Attack for one grip and one Stat score set. `stats` are the Character's
 * final Stat scores (the profile's); only the scaling Stat the Release's POWER_SCALING rule names is read.
 */
export function previewAttackDamage(request: {
  readonly weapon: WeaponEntry;
  readonly attack: AttackEntry;
  readonly profile: DamageProfile;
  readonly grip: WeaponGrip;
  readonly stats: Readonly<Partial<Record<string, number>>>;
  readonly powerAdjustment?: PowerAdjustment | null;
}): DamagePreview {
  const { weapon, attack, profile, grip } = request;
  const steps: DamagePreviewStep[] = [];
  const base = dice(profile.dice.count, profile.dice.sides);
  steps.push({ step: "BASE", detail: `${base.expression} ${profile.damageType}`, source: attack.ref });
  const out = (rest: Partial<DamagePreview>): DamagePreview =>
    deepFreeze({ profileKey: profile.profileKey, damageType: profile.damageType, status: "PREVIEWED", reason: null, scaling: attack.scaling, base, gripAdjusted: null, power: null, multiplier: null, final: null, steps, ...rest });
  const fail = (reason: string, rest: Partial<DamagePreview> = {}) => out({ ...rest, status: "FAIL_CLOSED", reason });

  // 1. Versatile die step, BEFORE Power (§30). Only a single-die base has an exact step; anything else fails closed.
  let rolled = base;
  let gripAdjusted: DiceExpression | null = null;
  if (weapon.payload.handedness === "VERSATILE" && grip === "TWO_HANDED") {
    const rule = weapon.versatileRule;
    if (rule === null) return fail(`${weapon.ref.canonicalKey} names no Versatile die-step rule`);
    if (base.count !== ONE_DIE) return fail(`${base.expression} is a multi-die base; the Versatile rule defines no exact step for it (§31)`);
    const step = rule.contract.steps.find((s) => s.fromSides === base.sides);
    if (step === undefined) return fail(`the Versatile rule defines no step from a d${base.sides}`);
    gripAdjusted = dice(base.count, step.toSides);
    rolled = gripAdjusted;
    steps.push({ step: "VERSATILE_STEP", detail: `${base.expression} → ${gripAdjusted.expression} (two-handed grip)`, source: rule.use.trait });
  }

  // 2. STATIC: the authored (grip-adjusted) dice are final; no Power, no Stat (§28).
  if (attack.scaling === "STATIC") {
    steps.push({ step: "STATIC", detail: "Static damage — STR scaling not applied", source: weapon.ref });
    return out({ gripAdjusted, final: rolled });
  }

  // 3. POWER: effective Power (Dual Wield adjustment through the Release's Formula), then the Release's multiplier
  //    Formula (never below the Power floor) and the full base expression repeated (§25–§27).
  const rule = weapon.scalingRule;
  const authored = weapon.payload.power;
  if (rule === null || authored === null) return fail(`${weapon.ref.canonicalKey} has no Power scaling rule`, { gripAdjusted });
  const contract: Extract<TraitContract, { kind: "POWER_SCALING" }> = rule.contract;
  const statScore = request.stats[contract.stat];
  if (statScore === undefined) return fail(`the Character has no ${contract.stat} score`, { gripAdjusted });
  const adj = request.powerAdjustment ?? null;
  let adjusted = authored;
  if (adj !== null) {
    const value = evaluateSlot(adj.formula, { power: authored, adjustment: adj.adjustment, increment: adj.increment, sequence_index: adj.sequenceIndex });
    if (value === null) return fail("the Dual Wield Power Formula did not evaluate", { gripAdjusted });
    adjusted = value;
    steps.push({ step: "EFFECTIVE_POWER", detail: `Power ${authored} → ${adjusted} (Dual Wield +${adj.adjustment}, sequence ${adj.sequenceIndex})`, source: adj.rule });
  }
  const multiplier = evaluateSlot(contract.multiplier, { stat_score: statScore, power: adjusted, minimum_power: contract.minimumPower });
  if (multiplier === null) return fail("the Power multiplier Formula did not evaluate", { gripAdjusted });
  steps.push({ step: "POWER_MULTIPLIER", detail: `${contract.stat} ${statScore} ÷ Power ${adjusted} (minimum ${contract.minimumPower}) → ×${multiplier}`, source: rule.use.trait });
  const count = evaluateSlot(contract.diceCount, { base_count: rolled.count, multiplier });
  if (count === null) return fail("the repeated-dice Formula did not evaluate", { gripAdjusted });
  const final = dice(count, rolled.sides);
  steps.push({ step: "REPEATED_DICE", detail: `${rolled.expression} × ${multiplier} → ${final.expression}`, source: rule.use.trait });
  return out({
    gripAdjusted,
    power: { authored, adjustment: adj?.adjustment ?? 0, adjusted, minimum: contract.minimumPower, scalingStat: contract.stat, statScore },
    multiplier,
    final,
  });
}
