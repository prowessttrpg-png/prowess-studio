import type { PathSegment } from "../internal/plain-data.js";
import { Problems, isExactLabel, own, readEnum, readRecord } from "../internal/problems.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";

/** How an Active Effect may be ended voluntarily, per Duration concept (no universal dismissal rule). */
export const ACTIVE_MAGIC_DISMISSAL = ["FREE_ACTION", "NOT_DISMISSIBLE"] as const;
export type ActiveMagicDismissal = (typeof ACTIVE_MAGIC_DISMISSAL)[number];
/** The Duration concepts WO13 governs (the exact WO9 Spell Duration vocabulary — no second Duration vocabulary). */
export const ACTIVE_MAGIC_DURATIONS = ["INSTANT", "ROUNDS", "COMBAT", "SCENE", "MISSION", "SUSTAINED", "MANA_LOCK", "PERMANENT_BY_SPECIAL_RULE"] as const;
export type ActiveMagicDuration = (typeof ACTIVE_MAGIC_DURATIONS)[number];
/** A structured Mana Lock reservation rule. `null` in the policy means no exact executable amount exists (fail closed). */
export type ManaLockAmountRule = { readonly kind: "FINAL_SPELL_MP" } | { readonly kind: "FIXED"; readonly amount: number };
interface FormulaProgram { readonly expression: string; readonly variables: readonly string[] }

export interface ActiveMagicPolicy {
  readonly formulas: { readonly sustainMp: FormulaProgram; readonly concentrationSlots: FormulaProgram; readonly concentrationDc: FormulaProgram };
  readonly sustainApPerRound: number;
  readonly sustainMeEligible: boolean;
  readonly concentrationSaveStat: string;
  readonly dismissal: Readonly<Record<ActiveMagicDuration, ActiveMagicDismissal>>;
  readonly channel: { readonly requiresConcentration: boolean; readonly maximumSimultaneous: number; readonly minimumApPerRound: number; readonly mpPaymentTiming: null; readonly mpPaymentConflictKey: string };
  readonly manaLock: { readonly amount: ManaLockAmountRule | null; readonly conflictKey: string };
  readonly authority: readonly string[];
}

const positive = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
function program(value: unknown, variables: readonly string[], at: readonly PathSegment[], p: Problems): FormulaProgram | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["expression", "variables"], ["expression", "variables"]); if (!r) return null;
  const expression = own(r, "expression"), vars = own(r, "variables");
  if (typeof expression !== "string" || !expression.length) p.add(C.INVALID_PAYLOAD, [...at, "expression"], "an M4 Formula expression");
  if (!Array.isArray(vars) || vars.length !== variables.length || vars.some((v, i) => v !== variables[i])) p.add(C.INVALID_PAYLOAD, [...at, "variables"], `the Formula binds exactly ${variables.join(", ")}`);
  return typeof expression === "string" && expression.length ? { expression, variables } : null;
}

/**
 * Additive M5-WO13 policy inside ABILITY_CONSTRUCTION_RULE: the Ruleset-pinned active-magic lifecycle rules (Sustain,
 * Concentration, Channeling, Mana Lock, dismissal). Every number is executed by M4; this reader only validates shape.
 */
export function readActiveMagicPolicy(value: unknown, at: readonly PathSegment[], p: Problems): ActiveMagicPolicy | null {
  const before = p.count, e = C.INVALID_PAYLOAD;
  const fields = ["formulas", "sustainApPerRound", "sustainMeEligible", "concentrationSaveStat", "dismissal", "channel", "manaLock", "authority"];
  const r = readRecord(value, at, p, e, fields, fields); if (!r) return null;
  const f = readRecord(own(r, "formulas"), [...at, "formulas"], p, e, ["sustainMp", "concentrationSlots", "concentrationDc"], ["sustainMp", "concentrationSlots", "concentrationDc"]);
  const sustainMp = f ? program(own(f, "sustainMp"), ["final_mp", "pro"], [...at, "formulas", "sustainMp"], p) : null;
  const concentrationSlots = f ? program(own(f, "concentrationSlots"), ["res"], [...at, "formulas", "concentrationSlots"], p) : null;
  const concentrationDc = f ? program(own(f, "concentrationDc"), ["consumers"], [...at, "formulas", "concentrationDc"], p) : null;
  if (!positive(own(r, "sustainApPerRound"))) p.add(e, [...at, "sustainApPerRound"], "Sustain AP per round is a positive integer");
  if (typeof own(r, "sustainMeEligible") !== "boolean") p.add(e, [...at, "sustainMeEligible"], "explicit boolean");
  if (!isExactLabel(own(r, "concentrationSaveStat"))) p.add(e, [...at, "concentrationSaveStat"], "the exact Saving Throw Stat");
  const d = readRecord(own(r, "dismissal"), [...at, "dismissal"], p, e, ACTIVE_MAGIC_DURATIONS, ACTIVE_MAGIC_DURATIONS);
  const dismissal: Partial<Record<ActiveMagicDuration, ActiveMagicDismissal>> = {};
  if (d) for (const k of ACTIVE_MAGIC_DURATIONS) { const v = readEnum(own(d, k), ACTIVE_MAGIC_DISMISSAL, [...at, "dismissal", k], p, e, "dismissal rule"); if (v) dismissal[k] = v; }
  const ch = readRecord(own(r, "channel"), [...at, "channel"], p, e, ["requiresConcentration", "maximumSimultaneous", "minimumApPerRound", "mpPaymentTiming", "mpPaymentConflictKey"], ["requiresConcentration", "maximumSimultaneous", "minimumApPerRound", "mpPaymentTiming", "mpPaymentConflictKey"]);
  if (ch) {
    if (typeof own(ch, "requiresConcentration") !== "boolean") p.add(e, [...at, "channel", "requiresConcentration"], "explicit boolean");
    if (!positive(own(ch, "maximumSimultaneous"))) p.add(e, [...at, "channel", "maximumSimultaneous"], "positive integer");
    if (!positive(own(ch, "minimumApPerRound"))) p.add(e, [...at, "channel", "minimumApPerRound"], "positive integer");
    if (own(ch, "mpPaymentTiming") !== null) p.add(e, [...at, "channel", "mpPaymentTiming"], "no exact Channel MP payment timing exists (M5-SC-053): it stays null");
    if (!isExactLabel(own(ch, "mpPaymentConflictKey"))) p.add(e, [...at, "channel", "mpPaymentConflictKey"], "the unresolved conflict key");
  }
  const ml = readRecord(own(r, "manaLock"), [...at, "manaLock"], p, e, ["amount", "conflictKey"], ["amount", "conflictKey"]);
  let amount: ManaLockAmountRule | null = null;
  if (ml) {
    const a = own(ml, "amount");
    if (a !== null) {
      const ar = readRecord(a, [...at, "manaLock", "amount"], p, e, ["kind", "amount"], ["kind"]);
      const kind = ar ? readEnum(own(ar, "kind"), ["FINAL_SPELL_MP", "FIXED"] as const, [...at, "manaLock", "amount", "kind"], p, e, "Mana Lock amount rule") : null;
      if (kind === "FIXED" && !positive(own(ar!, "amount"))) p.add(e, [...at, "manaLock", "amount", "amount"], "a FIXED lock is a positive integer");
      if (kind === "FINAL_SPELL_MP" && own(ar!, "amount") !== undefined) p.add(e, [...at, "manaLock", "amount", "amount"], "FINAL_SPELL_MP carries no amount");
      if (kind === "FIXED") amount = { kind, amount: own(ar!, "amount") as number };
      else if (kind) amount = { kind };
    }
    if (!isExactLabel(own(ml, "conflictKey"))) p.add(e, [...at, "manaLock", "conflictKey"], "the unresolved conflict key");
  }
  const authority = own(r, "authority");
  if (!Array.isArray(authority) || !authority.every((x) => typeof x === "string")) p.add(e, [...at, "authority"], "authority is a list of source locators");
  if (p.count > before || !sustainMp || !concentrationSlots || !concentrationDc || !ch || !ml) return null;
  return {
    formulas: { sustainMp, concentrationSlots, concentrationDc },
    sustainApPerRound: own(r, "sustainApPerRound") as number,
    sustainMeEligible: own(r, "sustainMeEligible") as boolean,
    concentrationSaveStat: own(r, "concentrationSaveStat") as string,
    dismissal: dismissal as Record<ActiveMagicDuration, ActiveMagicDismissal>,
    channel: { requiresConcentration: own(ch, "requiresConcentration") as boolean, maximumSimultaneous: own(ch, "maximumSimultaneous") as number, minimumApPerRound: own(ch, "minimumApPerRound") as number, mpPaymentTiming: null, mpPaymentConflictKey: own(ch, "mpPaymentConflictKey") as string },
    manaLock: { amount, conflictKey: own(ml, "conflictKey") as string },
    authority: authority as string[],
  };
}
