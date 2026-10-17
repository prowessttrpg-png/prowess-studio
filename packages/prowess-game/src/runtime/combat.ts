import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import { CORE_ERROR_CODES as K, DEFINITION_ERROR_CODES as C, RUNTIME_ERROR_CODES as R } from "../definition/codes.js";
import type { InitiativePayload, InitiativeTiebreak } from "../definition/core-payload.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import { SIDE_PHASE_ORDER_POLICY } from "../vocabulary/runtime.js";

/**
 * Side-based combat (PAS-10 M5-WO3 §79–88; s49–s55, s423–s430). Initiative orders SIDES: each side's one chosen creature
 * rolls (an INITIATIVE plan compiled by `compileCoreResolution`, evaluated by M4), and this module only COMPARES the
 * resulting totals and, on a tie, the tied sides' highest Stats in the order the INITIATIVE Definition lists them. A full
 * tie is REROLL_REQUIRED — the reroll is new runtime die input; nothing here rolls, rounds or adds (M5-I101–I103).
 */

export interface InitiativeSideInput {
  readonly sideKey: string;
  /** The side's Initiative total, exactly as M4 evaluated it (fractional totals are valid — no rounding is stated). */
  readonly initiative: number;
  /** The side's creatures with their Stats, for the tie-break's "highest Stat among the tied side". */
  readonly members: readonly { readonly creatureKey: string; readonly stats: Readonly<Partial<Record<ProwessStat, number>>> }[];
}

/** InitiativeRequest: every side's evaluated total. */
export interface InitiativeRequest {
  readonly definitions: ProwessDefinitionBundle;
  readonly sides: readonly InitiativeSideInput[];
}

/** Why one side acts before the next: the totals differ, or the named tie-break Stat decided it. */
export type InitiativeDecision = "INITIATIVE" | `HIGHEST_${ProwessStat}`;

export interface InitiativeResolution {
  /** ORDERED: every adjacent pair is decided. REROLL_REQUIRED: some sides are tied through every tie-break step. */
  readonly status: "ORDERED" | "REROLL_REQUIRED";
  /** Acting order of side groups; a group of more than one side is fully tied and must reroll. */
  readonly order: readonly (readonly string[])[];
  readonly rerollSides: readonly string[];
  /** Between each adjacent pair of groups, what decided it. */
  readonly decisions: readonly { readonly before: string; readonly after: string; readonly decidedBy: InitiativeDecision }[];
}

const readStat = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);

/** The highest value of `stat` among a side's creatures — selection by comparison only. */
function highest(side: InitiativeSideInput, stat: ProwessStat): number {
  return side.members.reduce<number | null>((best, m) => {
    const v = m.stats[stat] as number;
    return best === null || v > best ? v : best;
  }, null) as number;
}

/** Compares two sides: the higher total first; then each HIGHEST_STAT tie-break step in authored order; 0 = full tie. */
function compareSides(a: InitiativeSideInput, b: InitiativeSideInput, tiebreak: readonly InitiativeTiebreak[]): { order: -1 | 0 | 1; decidedBy: InitiativeDecision | null } {
  if (a.initiative !== b.initiative) return { order: a.initiative > b.initiative ? -1 : 1, decidedBy: "INITIATIVE" };
  for (const step of tiebreak) {
    if (step.kind !== "HIGHEST_STAT") continue;
    const [x, y] = [highest(a, step.stat), highest(b, step.stat)];
    if (x !== y) return { order: x > y ? -1 : 1, decidedBy: `HIGHEST_${step.stat}` };
  }
  return { order: 0, decidedBy: null };
}

/** Orders sides by Initiative under the exact INITIATIVE Definition's tie-break (s425). Pure and deterministic. */
export function resolveInitiativeOrder(input: InitiativeRequest): ProwessOutcome<InitiativeResolution> {
  const p = new Problems();
  const core = indexCoreDefinitions(input.definitions);
  if (!core.ok) return core as ProwessOutcome<never>;
  const entry = core.value.procedures.INITIATIVE;
  if (entry === undefined) {
    p.add(K.MISSING_CORE_DEFINITION, ["definitions"], "the bundle has no CORE_RESOLUTION Definition for INITIATIVE");
    return finish(p, () => null as never);
  }
  const tiebreak = (entry.payload as InitiativePayload).tiebreak;
  const needed = tiebreak.flatMap((t) => (t.kind === "HIGHEST_STAT" ? [t.stat] : []));
  if (!checkPlainData(input.sides, ["sides"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  if (!Array.isArray(input.sides) || input.sides.length < 2) {
    p.add(R.INVALID_INITIATIVE, ["sides"], "Initiative orders at least two sides");
    return finish(p, () => null as never);
  }
  const sides: InitiativeSideInput[] = [];
  input.sides.forEach((raw: unknown, i: number) => {
    const s = readRecord(raw, ["sides", i], p, R.INVALID_INITIATIVE, ["sideKey", "initiative", "members"], ["sideKey", "initiative", "members"]);
    if (s === null) return;
    const sideKey = own(s, "sideKey");
    const initiative = own(s, "initiative");
    const members = own(s, "members");
    if (!isExactLabel(sideKey) || sides.some((x) => x.sideKey === sideKey)) p.add(R.INVALID_INITIATIVE, ["sides", i, "sideKey"], "sideKey is an exact label, unique");
    if (typeof initiative !== "number" || !Number.isFinite(initiative)) p.add(R.INVALID_INITIATIVE, ["sides", i, "initiative"], "initiative is the side's finite M4-evaluated total");
    if (!Array.isArray(members) || members.length === 0) {
      p.add(R.INVALID_INITIATIVE, ["sides", i, "members"], "a side has at least one creature");
      return;
    }
    const read = members.flatMap((m: unknown, j: number) => {
      const e = readRecord(m, ["sides", i, "members", j], p, R.INVALID_INITIATIVE, ["creatureKey", "stats"], ["creatureKey", "stats"]);
      const stats = e === null ? null : own(e, "stats");
      if (e === null || !isExactLabel(own(e, "creatureKey")) || !isPlainObject(stats)) {
        if (e !== null) p.add(R.INVALID_INITIATIVE, ["sides", i, "members", j], "a member is { creatureKey, stats }");
        return [];
      }
      const out: Partial<Record<ProwessStat, number>> = {};
      for (const stat of PROWESS_STATS) {
        const v = own(stats, stat);
        if (v === undefined) continue;
        const n = readStat(v);
        if (n === null) p.add(R.INVALID_INITIATIVE, ["sides", i, "members", j, "stats", stat], `${stat} is an integer score`);
        else out[stat] = n;
      }
      for (const stat of needed) if (out[stat] === undefined) p.add(R.INVALID_INITIATIVE, ["sides", i, "members", j, "stats", stat], `the Initiative tie-break compares ${stat}`);
      return [{ creatureKey: own(e, "creatureKey") as string, stats: out }];
    });
    if (isExactLabel(sideKey) && typeof initiative === "number") sides.push({ sideKey, initiative, members: read });
  });
  if (p.count > 0) return finish(p, () => null as never);

  // A stable sort by comparison only; equal sides keep their supplied relative order inside a reroll group.
  const sorted = [...sides].sort((a, b) => compareSides(a, b, tiebreak).order);
  const order: string[][] = [];
  const decisions: { before: string; after: string; decidedBy: InitiativeDecision }[] = [];
  let previous: InitiativeSideInput | null = null;
  for (const side of sorted) {
    const outcome = previous === null ? null : compareSides(previous, side, tiebreak);
    const group = order.at(-1);
    if (outcome !== null && outcome.decidedBy === null && group !== undefined) group.push(side.sideKey);
    else {
      if (outcome !== null && previous !== null && outcome.decidedBy !== null) decisions.push({ before: previous.sideKey, after: side.sideKey, decidedBy: outcome.decidedBy });
      order.push([side.sideKey]);
    }
    previous = side;
  }
  const rerollSides = order.filter((g) => g.length > 1).flat();
  return finish(p, () => deepFreeze({ status: rerollSides.length > 0 ? ("REROLL_REQUIRED" as const) : ("ORDERED" as const), order, rerollSides, decisions }));
}

/**
 * One side's phase (s53, s426–s430). Its creatures form a SET: the side chooses who acts first, second, last or waits —
 * there are no individual Initiative slots and the engine never sorts them (by Initiative, PER, AGI, name or storage
 * order). `actingOrder` is deliberately null until the side records the sequence it chose.
 */
export interface SidePhase {
  readonly sideKey: string;
  readonly members: readonly string[];
  readonly orderPolicy: typeof SIDE_PHASE_ORDER_POLICY;
  readonly actingOrder: null;
}

export function createSidePhase(value: unknown): ProwessOutcome<SidePhase> {
  const p = new Problems();
  if (!checkPlainData(value, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(value, [], p, R.INVALID_SIDE_PHASE, ["sideKey", "members"], ["sideKey", "members"]);
  if (r === null) return finish(p, () => null as never);
  const sideKey = own(r, "sideKey");
  const members = own(r, "members");
  if (!isExactLabel(sideKey)) p.add(R.INVALID_SIDE_PHASE, ["sideKey"], "sideKey is an exact label");
  if (!Array.isArray(members) || members.length === 0 || !members.every((m: unknown) => isExactLabel(m)) || new Set(members).size !== members.length) {
    p.add(R.INVALID_SIDE_PHASE, ["members"], "members is a non-empty set of exact creature keys");
  }
  return finish(p, () => ({ sideKey: sideKey as string, members: [...(members as string[])], orderPolicy: SIDE_PHASE_ORDER_POLICY, actingOrder: null }));
}

/**
 * Accepts ANY acting sequence the side chose (s429): any member first, any last, any waiting (absent), with no relation
 * to Initiative or Stats. A creature acting in two separate runs is interleaving, which needs GM approval (s54, s429).
 */
export function validateActingSequence(input: { readonly phase: SidePhase; readonly sequence: unknown; readonly interleavingApproved: boolean }): ProwessOutcome<{ readonly sequence: readonly string[]; readonly interleaved: boolean }> {
  const p = new Problems();
  const sequence = input.sequence;
  if (!Array.isArray(sequence) || !sequence.every((k: unknown) => typeof k === "string" && input.phase.members.includes(k))) {
    p.add(R.INVALID_SIDE_PHASE, ["sequence"], `every acting creature is a member of side ${input.phase.sideKey}`);
    return finish(p, () => null as never);
  }
  const keys = sequence as string[];
  // A creature is interleaved when it acts again after a different creature acted in between.
  const seen = new Set<string>();
  let last: string | null = null;
  let interleaved = false;
  for (const k of keys) {
    if (k !== last && seen.has(k)) interleaved = true;
    seen.add(k);
    last = k;
  }
  if (interleaved && !input.interleavingApproved) p.add(R.INTERLEAVING_REQUIRES_APPROVAL, ["sequence"], "interleaving actions within the shared phase needs GM approval that the timing is clear (s54)");
  return finish(p, () => deepFreeze({ sequence: [...keys], interleaved }));
}
