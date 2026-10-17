import { createRuntimeContext, type RuntimeContext } from "@prowess/rules";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isToken, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { CORE_ERROR_CODES as K, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { COMPARISON_STATE_KEYS, ROLL_MODES, ROLL_MODE_VARIABLES, ROLL_STATE_KEYS, type RollMode } from "../vocabulary/core.js";
import type { CharacterDie } from "./character.js";

/**
 * Dice are RUNTIME INPUT (PAS-10 M5-WO2): neither @prowess/game nor @prowess/rules rolls a die. A caller (a person at a
 * table, a future runtime service) supplies the natural results; this module only checks them against the exact die
 * and the roll mode. NORMAL takes exactly one natural roll, ADVANTAGE / DISADVANTAGE exactly two, each an integer from
 * 1 to the die's faces.
 */
export interface ProwessDieRollInput {
  readonly die: { readonly dieKey: string; readonly faces: number };
  readonly mode: RollMode;
  readonly rolls: readonly number[];
}

/** Validates a roll input against the die the character must roll. Never re-rolls, clamps or reorders a value. */
export function validateDieRollInput(value: unknown, expected: CharacterDie): ProwessOutcome<ProwessDieRollInput> {
  const p = new Problems();
  if (!checkPlainData(value, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(value, [], p, K.INVALID_ROLL_INPUT, ["die", "mode", "rolls"], ["die", "mode", "rolls"]);
  if (r === null) return finish(p, () => null as never);
  const die = readRecord(own(r, "die"), ["die"], p, K.INVALID_ROLL_INPUT, ["dieKey", "faces"], ["dieKey", "faces"]);
  const dieKey = die === null ? null : own(die, "dieKey");
  const faces = die === null ? null : readSafeInteger(own(die, "faces"), ["die", "faces"], p, K.INVALID_ROLL_INPUT, "faces");
  if (die !== null && (!isToken(dieKey) || dieKey !== expected.dieKey || faces !== expected.faces)) {
    p.add(K.DIE_MISMATCH, ["die"], `the roll must use the character's Character Die ${expected.dieKey} (${expected.faces} faces)`);
  }
  const mode = readEnum(own(r, "mode"), ROLL_MODES, ["mode"], p, K.INVALID_ROLL_INPUT, "roll mode");
  const rolls = own(r, "rolls");
  if (!Array.isArray(rolls)) p.add(K.INVALID_ROLL_INPUT, ["rolls"], "rolls is an array of natural results");
  else {
    if (mode !== null && rolls.length !== ROLL_MODE_VARIABLES[mode].length) {
      p.add(K.ROLL_COUNT_MISMATCH, ["rolls"], `${mode} takes exactly ${ROLL_MODE_VARIABLES[mode].length} natural roll(s); got ${rolls.length}`);
    }
    rolls.forEach((n: unknown, i: number) => {
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > expected.faces) {
        p.add(K.ROLL_OUT_OF_RANGE, ["rolls", i], `a natural ${expected.dieKey} result is an integer from 1 to ${expected.faces}`);
      }
    });
  }
  return finish(p, () => deepFreeze({ die: { dieKey: dieKey as string, faces: faces as number }, mode: mode as RollMode, rolls: [...(rolls as number[])] }));
}

/**
 * The roll mode a set of collected M4 roll signals produces (designer ruling M5-SC-010): no signal → NORMAL; one or
 * more Advantage signals → ADVANTAGE; one or more Disadvantage → DISADVANTAGE (duplicates collapse — there is no
 * double Advantage). Advantage AND Disadvantage together fail closed with ROLL_MODE_CONFLICT: there is no canon ruling
 * (recorded as M5-SC-032), so nothing cancels, nets or picks a winner.
 *
 * Accepts the M4 ROLL_SIGNAL target state `{ advantage: modifierKey[], disadvantage: modifierKey[] }` (M4-I74).
 */
export function resolveRollMode(signals: unknown): ProwessOutcome<RollMode> {
  const p = new Problems();
  if (!checkPlainData(signals, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  if (!isPlainObject(signals)) {
    p.add(K.INVALID_ROLL_INPUT, [], "roll signals are { advantage: string[], disadvantage: string[] }");
    return finish(p, () => null as never);
  }
  const list = (field: "advantage" | "disadvantage"): readonly unknown[] => {
    const v = own(signals, field);
    if (Array.isArray(v) && v.every((x: unknown) => typeof x === "string")) return v;
    p.add(K.INVALID_ROLL_INPUT, [field], `${field} is an array of signal keys`);
    return [];
  };
  const advantage = list("advantage").length > 0;
  const disadvantage = list("disadvantage").length > 0;
  if (advantage && disadvantage) {
    p.add(K.ROLL_MODE_CONFLICT, [], "Advantage and Disadvantage are both present; their interaction is unresolved (M5-SC-032), so the roll fails closed");
  }
  const mode: RollMode = advantage ? "ADVANTAGE" : disadvantage ? "DISADVANTAGE" : "NORMAL";
  return finish(p, () => mode);
}

/**
 * The M4 RuntimeContext of one roll: the natural results under `roll.r1` / `roll.r2` and the value the total is
 * compared with (a Difficulty Class, or the target's Dodge). Copied, never computed.
 */
export function buildRollRuntimeContext(input: { readonly roll: ProwessDieRollInput | null; readonly difficultyClass?: number; readonly targetDodge?: number }): ProwessOutcome<RuntimeContext> {
  const p = new Problems();
  const state: Record<string, number> = {};
  if (input.roll !== null) {
    const names = ROLL_MODE_VARIABLES[input.roll.mode];
    names.forEach((name, i) => {
      const value = input.roll?.rolls[i];
      if (value !== undefined) state[ROLL_STATE_KEYS[name]] = value;
    });
  }
  if (input.difficultyClass !== undefined) state[COMPARISON_STATE_KEYS.DIFFICULTY_CLASS] = input.difficultyClass;
  if (input.targetDodge !== undefined) state[COMPARISON_STATE_KEYS.TARGET_DODGE] = input.targetDodge;
  const created = createRuntimeContext({ resourceValues: {}, reservedCapacity: {}, activeEffects: [], conditions: [], state });
  if (!created.ok) p.add(K.INVALID_ROLL_INPUT, [], "the roll does not form a valid M4 RuntimeContext");
  return finish(p, () => (created as { ok: true; value: RuntimeContext }).value);
}
