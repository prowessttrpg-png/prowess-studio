import { orchestrateRulesEvaluation } from "@prowess/rules";
import { ACTIVE_MAGIC_EXTERNAL_ENDS, CONCENTRATION_TRIGGERS, transitionActiveMagicWith, type ActiveMagicState, type ActiveMagicTransition } from "../ability/active-magic.js";
import type { AbilityExecutionResult } from "../ability/effect-execution.js";
import { actionImprovementsFor } from "../character/action-improvement.js";
import { validateSheetPlayState, type CharacterSheetMechanics } from "../character/sheet.js";
import { buildCoreResolutionContexts, compileCoreResolution } from "../core/compile.js";
import type { CharacterAttack, CharacterAttackLibrary } from "../equipment/library.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import type { ProwessProblem } from "../internal/problems.js";
import { nextRoundOrdinal } from "../internal/round.js";
import { indexRuntimeDefinitions, type RuntimeDefinitionIndex } from "../runtime/definitions.js";
import type { ProwessRuntimeResources } from "../runtime/resources.js";
import { PROWESS_STATS } from "../vocabulary/core.js";
import { RUNTIME_RESOURCE_KEYS, TERRAIN_KINDS, type CombatTimingEvent, type RuntimeResourceKey } from "../vocabulary/runtime.js";
import { buildResolutionInputs, characterSpellAdapter, describePending, evaluateManeuverSource, evaluateSpellSource, executeCompiled, signatureSourceKey, spellIdentityOf, type PlayAbilityContext } from "./abilities.js";
import {
  PLAY_ACTIVE_MAGIC_EVENTS,
  PLAY_CONTRACT_VERSION,
  PLAY_NOTE_CATEGORIES,
  PLAY_REASON_CODES as R,
  PLAY_ROLL_SOURCES,
  PLAY_TIMING_EVENTS,
  type PlayClassification,
  type PlayOperation,
  type PlayOperationOutcome,
  type PlayOperationStatus,
  type PlayReason,
  type PlayResolutionInput,
  type PlayResourceSnapshot,
  type PlayRollInput,
  type PlayRuntimeState,
  type PlayTargetInput,
} from "./contract.js";
import { payAction, runPlan, type PlayEngineContext, type PlayRun } from "./engine.js";

/**
 * PAS-10 M6-WO10 — the Play Workspace operation evaluator. ONE pure function serves preview and commit: the server calls
 * it, persists `runtimeAfter` / `resourcesAfter` only for a COMMITTABLE outcome, and appends one ledger event. The client
 * supplies choices, targets and raw rolls; every cost, legality decision, payment, timing refresh, movement charge and
 * resolution result is the existing authority's (M5-WO3 … WO13 on M4). Unsupported mechanics are reported, never invented.
 */
export interface PlayContext extends PlayAbilityContext {
  readonly characterName: string;
  readonly level: number;
  readonly advancementCount: number;
  readonly mechanics: CharacterSheetMechanics;
  /** The sheet's Attack Library (the Character's own profile with the current loadout — M6-WO6). */
  readonly attackLibrary: CharacterAttackLibrary;
  readonly names: Readonly<Record<string, string>>;
}

export interface PlayStored {
  /** The Character Sheet's stored current values (null: never saved — the derived maximums apply, as on the sheet). */
  readonly sheetResources: readonly { readonly resourceKey: string; readonly current: number }[] | null;
  readonly runtime: PlayRuntimeState | null;
}

const SHEET_LIMITS = { noteText: 2000, reason: 500, segments: 20, targets: 20, inputs: 60 } as const;

// ---- runtime state ----------------------------------------------------------------------------------------------------

export function initialPlayRuntime(ctx: PlayContext): PlayRuntimeState {
  return deepFreeze({
    contractVersion: PLAY_CONTRACT_VERSION,
    characterId: ctx.characterId,
    releaseId: ctx.releaseId,
    rulesetProvenance: ctx.bundle.rulesetProvenance,
    advancementCount: ctx.advancementCount,
    combat: { active: false, round: null, surprised: false, phase: "OUT_OF_COMBAT", turn: "NOT_TAKEN" },
    movementAllowance: 0,
    reservedMp: 0,
    movement: { grants: [], segments: [] },
    activeMagic: null,
  });
}

/** The runtime Resources the engine sees: the sheet's current values (or derived maximum) + the runtime-only trackers. */
/**
 * The Resources whose current value the play runtime itself holds (no Character Sheet row: turn-scoped, never a sheet
 * pool). A storage location only — every amount, refresh and expiry still comes from the Resource Definition.
 */
export const RUNTIME_HELD_RESOURCES: Readonly<Partial<Record<RuntimeResourceKey, (runtime: PlayRuntimeState) => number>>> = Object.freeze({
  MOVEMENT_ALLOWANCE: (runtime: PlayRuntimeState) => runtime.movementAllowance,
});

export function runtimeResourcesOf(ctx: PlayContext, stored: PlayStored, runtime: PlayRuntimeState, index: RuntimeDefinitionIndex): ProwessRuntimeResources {
  const resources = RUNTIME_RESOURCE_KEYS.flatMap((key): ProwessRuntimeResources["resources"][number][] => {
    const definition = index.resources[key];
    if (definition === undefined) return [];
    const held = RUNTIME_HELD_RESOURCES[key];
    if (held !== undefined) return [{ resourceKey: key, current: held(runtime), reservedCapacity: 0 }];
    const sheet = ctx.mechanics.resources.find((r) => r.resourceKey === key);
    const onSheet = stored.sheetResources?.find((r) => r.resourceKey === key);
    const current = onSheet?.current ?? sheet?.maximum ?? null;
    if (current === null) return [];
    return [{ resourceKey: key, current, reservedCapacity: definition.payload.supportsReservation ? runtime.reservedMp : 0 }];
  });
  return deepFreeze({ resources });
}

const snapshot = (r: ProwessRuntimeResources): PlayResourceSnapshot[] => r.resources.map((x) => ({ resourceKey: x.resourceKey, current: x.current, reservedCapacity: x.reservedCapacity }));
const currentOf = (r: ProwessRuntimeResources, key: RuntimeResourceKey) => r.resources.find((x) => x.resourceKey === key) ?? null;
const reasons = (problems: readonly ProwessProblem[], code: string): PlayReason[] => problems.map((q) => ({ code, message: `${q.code}${q.path ? ` at ${q.path}` : ""}: ${q.message}` }));

/** The runtime after a resource-changing operation: MOVEMENT_ALLOWANCE and reserved MP are copied from the engine's state. */
function withResources(runtime: PlayRuntimeState, resources: ProwessRuntimeResources): PlayRuntimeState {
  const movement = currentOf(resources, "MOVEMENT_ALLOWANCE");
  const mp = currentOf(resources, "MP");
  return { ...runtime, movementAllowance: movement?.current ?? runtime.movementAllowance, reservedMp: mp?.reservedCapacity ?? runtime.reservedMp };
}

const liveMagic = (state: ActiveMagicState | null) => state !== null && (state.effects.some((e) => e.status !== "ENDED") || state.channel !== null);

// ---- operation reading (closed, plain data) -------------------------------------------------------------------------

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };
const bad = (message: string): Read<never> => ({ ok: false, message });
const closed = (v: unknown, allowed: readonly string[], required: readonly string[]): v is Record<string, unknown> => isPlainObject(v) && Object.keys(v).every((k) => allowed.includes(k)) && required.every((k) => Object.hasOwn(v, k));
const int = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const label = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

function readRoll(v: unknown): PlayRollInput | null {
  if (!closed(v, ["mode", "rolls", "source"], ["mode", "rolls", "source"])) return null;
  const mode = v.mode, rolls = v.rolls, source = v.source;
  if (mode !== "NORMAL" && mode !== "ADVANTAGE" && mode !== "DISADVANTAGE") return null;
  if (!Array.isArray(rolls) || rolls.length < 1 || rolls.length > 2 || !rolls.every((x) => int(x, 1, 1000))) return null;
  if (!(PLAY_ROLL_SOURCES as readonly unknown[]).includes(source)) return null;
  return { mode, rolls: rolls as number[], source: source as PlayRollInput["source"] };
}

function readTargets(v: unknown): PlayTargetInput[] | null {
  if (!Array.isArray(v) || v.length > SHEET_LIMITS.targets) return null;
  const out: PlayTargetInput[] = [];
  for (const t of v) {
    if (!closed(t, ["targetKey", "facts"], ["targetKey"]) || typeof t.targetKey !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(t.targetKey)) return null;
    if (t.facts !== undefined && !isPlainObject(t.facts)) return null;
    out.push(clonePlainData(t) as unknown as PlayTargetInput);
  }
  return out;
}

const STATS = PROWESS_STATS;
function readInputs(v: unknown): PlayResolutionInput[] | null {
  if (!Array.isArray(v) || v.length > SHEET_LIMITS.inputs) return null;
  const out: PlayResolutionInput[] = [];
  for (const x of v) {
    if (!isPlainObject(x) || typeof x.requestKey !== "string" || x.requestKey.length > 400) return null;
    if (x.kind === "ATTACK_ROLL") {
      if (!closed(x, ["requestKey", "kind", "roll", "targetDodge"], ["requestKey", "kind", "roll", "targetDodge"]) || !int(x.targetDodge, 0, 1000)) return null;
      const roll = readRoll(x.roll);
      if (roll === null) return null;
      out.push({ requestKey: x.requestKey, kind: "ATTACK_ROLL", roll, targetDodge: x.targetDodge });
    } else if (x.kind === "SAVING_THROW") {
      if (!closed(x, ["requestKey", "kind", "roll", "defender", "difficultyClass"], ["requestKey", "kind", "roll", "defender"])) return null;
      const roll = readRoll(x.roll);
      const d = x.defender;
      if (roll === null || !closed(d, ["level", "stats"], ["level", "stats"]) || !int(d.level, 1, 100) || !closed(d.stats, STATS, STATS) || !STATS.every((s) => int((d.stats as Record<string, unknown>)[s], 0, 100))) return null;
      if (x.difficultyClass !== undefined && !int(x.difficultyClass, 0, 1000)) return null;
      out.push({ requestKey: x.requestKey, kind: "SAVING_THROW", roll, defender: { level: d.level, stats: clonePlainData(d.stats) as unknown as Record<(typeof STATS)[number], number> }, ...(x.difficultyClass === undefined ? {} : { difficultyClass: x.difficultyClass as number }) });
    } else if (x.kind === "SAVE_REMOVAL" || x.kind === "SAVE_SELECTION") {
      if (!closed(x, ["requestKey", "kind", "stat"], ["requestKey", "kind", "stat"]) || typeof x.stat !== "string") return null;
      out.push({ requestKey: x.requestKey, kind: x.kind, stat: x.stat });
    } else return null;
  }
  return out;
}

/** Reads a client operation against the closed WO10 contract. Derived mechanics are not accepted fields of any kind. */
export function readPlayOperation(value: unknown): Read<PlayOperation> {
  if (!isPlainObject(value)) return bad("operation is an object { kind, … }");
  switch (value.kind) {
    case "TIMING": {
      if (!closed(value, ["kind", "event", "surprised"], ["kind", "event"]) || !(PLAY_TIMING_EVENTS as readonly unknown[]).includes(value.event)) return bad(`TIMING needs event ∈ ${PLAY_TIMING_EVENTS.join(", ")}`);
      if (value.surprised !== undefined && (value.event !== "BEGIN_COMBAT" || typeof value.surprised !== "boolean")) return bad("surprised is an explicit boolean of BEGIN_COMBAT only");
      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };
    }
    case "GENERAL_ACTION": {
      if (!closed(value, ["kind", "actionKey", "chosenCost", "trigger"], ["kind", "actionKey"]) || typeof value.actionKey !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.actionKey)) return bad("GENERAL_ACTION needs the exact actionKey");
      if (value.chosenCost !== undefined && !int(value.chosenCost, 0, 100)) return bad("chosenCost is a whole number of AP");
      if (value.trigger !== undefined && (!closed(value.trigger, ["triggerKey", "description"], ["triggerKey", "description"]) || !label(value.trigger.triggerKey) || !text(value.trigger.description, 300))) return bad("trigger is { triggerKey, description } as the player declares it");
      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };
    }
    case "MOVEMENT": {
      if (!closed(value, ["kind", "segments"], ["kind", "segments"]) || !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > SHEET_LIMITS.segments) return bad("MOVEMENT needs 1–20 ordered segments");
      for (const s of value.segments) if (!closed(s, ["distance", "terrainKey"], ["distance", "terrainKey"]) || !int(s.distance, 1, 10_000) || !(TERRAIN_KINDS as readonly unknown[]).includes(s.terrainKey)) return bad(`each segment is { distance (feet ≥ 1), terrainKey ∈ ${TERRAIN_KINDS.join(", ")} }`);
      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };
    }
    case "WEAPON_ATTACK": {
      if (!closed(value, ["kind", "attackKey", "hand", "damageProfileKey", "roll", "targetDodge"], ["kind", "attackKey", "hand", "damageProfileKey"]) || !label(value.attackKey) || !label(value.hand) || !label(value.damageProfileKey)) return bad("WEAPON_ATTACK needs the exact attackKey, hand and chosen damageProfileKey");
      if (value.roll !== undefined && readRoll(value.roll) === null) return bad("roll is { mode, rolls, source }");
      if (value.targetDodge !== undefined && !int(value.targetDodge, 0, 1000)) return bad("targetDodge is the GM-provided whole number");
      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };
    }
    case "SPELL":
    case "MANEUVER": {
      const fields = value.kind === "SPELL" ? ["kind", "abilityId", "revisionNumber", "targets", "inputs"] : ["kind", "abilityId", "revisionNumber", "targets", "groupTargets", "inputs"];
      if (!closed(value, fields, fields) || !uuid(value.abilityId) || !int(value.revisionNumber, 1, 100_000)) return bad(`${String(value.kind)} needs ${fields.slice(1).join(", ")}`);
      const targets = readTargets(value.targets), inputs = readInputs(value.inputs);
      if (targets === null || inputs === null) return bad("targets are { targetKey, facts? } and inputs answer exact requests with raw rolls only");
      if (value.kind === "MANEUVER" && (!Array.isArray(value.groupTargets) || !value.groupTargets.every((g) => closed(g, ["groupKey", "targetKeys"], ["groupKey", "targetKeys"]) && label(g.groupKey) && Array.isArray(g.targetKeys)))) return bad("groupTargets are { groupKey, targetKeys }");
      return { ok: true, value: { ...(clonePlainData(value) as unknown as PlayOperation), ...{ targets, inputs } } as PlayOperation };
    }
    case "ACTIVE_MAGIC": {
      const allowed = ["kind", "event", "activeEffectKey", "selection", "end", "sourceKey", "trigger", "target", "failureScope", "roll", "abilityId", "revisionNumber", "amount"];
      if (!closed(value, allowed, ["kind", "event"]) || !(PLAY_ACTIVE_MAGIC_EVENTS as readonly unknown[]).includes(value.event)) return bad(`ACTIVE_MAGIC needs event ∈ ${PLAY_ACTIVE_MAGIC_EVENTS.join(", ")}`);
      if (value.roll !== undefined && readRoll(value.roll) === null) return bad("roll is { mode, rolls, source }");
      if (value.abilityId !== undefined && !uuid(value.abilityId)) return bad("abilityId is the Signature Spell id");
      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };
    }
    case "MANUAL_ADJUSTMENT": {
      if (!closed(value, ["kind", "resourceKey", "after", "reason"], ["kind", "resourceKey", "after"]) || !(RUNTIME_RESOURCE_KEYS as readonly unknown[]).includes(value.resourceKey) || !int(value.after, 0, 1_000_000)) return bad("MANUAL_ADJUSTMENT is { resourceKey, after (whole number), reason? }");
      if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > SHEET_LIMITS.reason)) return bad(`reason is text of at most ${SHEET_LIMITS.reason} characters`);
      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };
    }
    case "NOTE": {
      if (!closed(value, ["kind", "category", "text", "subject"], ["kind", "category", "text"]) || !(PLAY_NOTE_CATEGORIES as readonly unknown[]).includes(value.category) || !text(value.text, SHEET_LIMITS.noteText)) return bad(`NOTE is { category ∈ ${PLAY_NOTE_CATEGORIES.join(", ")}, text (1–${SHEET_LIMITS.noteText}) }`);
      if (value.subject !== undefined && !label(value.subject)) return bad("subject is an exact label");
      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };
    }
    case "RECONCILE":
      return closed(value, ["kind"], ["kind"]) ? { ok: true, value: { kind: "RECONCILE" } } : bad("RECONCILE takes no fields");
    default:
      return bad("unknown operation kind");
  }
}

// ---- the evaluator --------------------------------------------------------------------------------------------------

interface Draft {
  status: PlayOperationStatus;
  classification: PlayClassification | null;
  summary: string;
  reasons: PlayReason[];
  resourcesAfter: ProwessRuntimeResources | null;
  runtimeAfter: PlayRuntimeState | null;
  source: Record<string, unknown> | null;
  trace: Record<string, unknown>;
  pending: Record<string, unknown>[];
  inputs: Record<string, unknown>;
}

const refuse = (code: string, message: string, extra: Partial<Draft> = {}): Draft => ({ status: "REFUSED", classification: null, summary: message, reasons: [{ code, message }], resourcesAfter: null, runtimeAfter: null, source: null, trace: {}, pending: [], inputs: {}, ...extra });
const accept = (classification: PlayClassification, summary: string, resources: ProwessRuntimeResources, runtime: PlayRuntimeState, extra: Partial<Draft> = {}): Draft => ({ status: "COMMITTABLE", classification, summary, reasons: [], resourcesAfter: resources, runtimeAfter: withResources(runtime, resources), source: null, trace: {}, pending: [], inputs: {}, ...extra });

/** Evaluates ONE operation against the stored state. Pure and deterministic; never writes. */
export function evaluatePlayOperation(ctx: PlayContext, stored: PlayStored, operation: unknown): PlayOperationOutcome {
  const read = readPlayOperation(operation);
  const index = indexRuntimeDefinitions(ctx.bundle);
  const runtime0 = stored.runtime ?? initialPlayRuntime(ctx);
  const resources0: ProwessRuntimeResources = index.ok ? runtimeResourcesOf(ctx, stored, runtime0, index.value) : { resources: [] };
  const finishDraft = (op: PlayOperation, d: Draft): PlayOperationOutcome =>
    deepFreeze(
      clonePlainData({
        contractVersion: PLAY_CONTRACT_VERSION,
        status: d.status,
        classification: d.status === "COMMITTABLE" ? d.classification : null,
        operation: op,
        summary: d.summary,
        reasons: d.reasons,
        resourcesBefore: snapshot(resources0),
        resourcesAfter: d.status === "COMMITTABLE" && d.resourcesAfter !== null ? snapshot(d.resourcesAfter) : null,
        runtimeAfter: d.status === "COMMITTABLE" && d.runtimeAfter !== null ? { ...d.runtimeAfter, advancementCount: ctx.advancementCount } : null,
        source: d.source,
        trace: d.trace,
        pending: d.pending,
        inputs: d.inputs,
      }),
    ) as PlayOperationOutcome;
  if (!read.ok) return finishDraft({ kind: "NOTE", category: "GENERAL", text: "(invalid operation)" }, refuse(R.INVALID_OPERATION, read.message));
  const op = read.value;
  if (!index.ok) return finishDraft(op, refuse(R.ENGINE_REFUSED, "the Character's Release has no coherent runtime Resource content", { reasons: reasons(index.problems, R.ENGINE_REFUSED) }));

  // ---- identity / reconciliation (§5 "State identity") ----
  if (runtime0.characterId !== ctx.characterId || runtime0.releaseId !== ctx.releaseId || runtime0.rulesetProvenance.rulesetId !== ctx.bundle.rulesetProvenance.rulesetId) {
    return finishDraft(op, { ...refuse(R.RELEASE_MISMATCH, "the stored play state belongs to another Character or Release; it is never reinterpreted"), status: "RECONCILIATION_REQUIRED" });
  }
  const advanced = runtime0.advancementCount !== ctx.advancementCount;
  if (advanced && liveMagic(runtime0.activeMagic) && op.kind !== "NOTE" && op.kind !== "MANUAL_ADJUSTMENT" && op.kind !== "RECONCILE") {
    return finishDraft(op, { ...refuse(R.RECONCILIATION_REQUIRED, "the Character advanced while Active Magic is held; acknowledge the advancement (Reconcile) before further play — held Effects keep the costs and durations they were activated with"), status: "RECONCILIATION_REQUIRED" });
  }

  const engine: PlayEngineContext = { bundle: ctx.bundle, ruleset: ctx.ruleset, character: ctx.casterCore, combat: runtime0.combat.active && runtime0.combat.round !== null ? { round: runtime0.combat.round, surprised: runtime0.combat.surprised } : null };
  const draft = (() => {
    switch (op.kind) {
      case "TIMING":
        return timing(ctx, engine, index.value, runtime0, resources0, op);
      case "GENERAL_ACTION":
        return generalAction(ctx, engine, index.value, runtime0, resources0, op);
      case "MOVEMENT":
        return move(engine, runtime0, resources0, op);
      case "WEAPON_ATTACK":
        return weaponAttack(ctx, engine, runtime0, resources0, op);
      case "SPELL":
        return spell(ctx, engine, index.value, runtime0, resources0, op);
      case "MANEUVER":
        return maneuver(ctx, engine, runtime0, resources0, op);
      case "ACTIVE_MAGIC":
        return activeMagic(ctx, runtime0, resources0, op);
      case "MANUAL_ADJUSTMENT":
        return manual(ctx, index.value, runtime0, resources0, op);
      case "NOTE":
        return accept("NOTE", op.category === "GM_ADJUDICATION" ? "GM-assisted adjudication note recorded (not an engine result)" : "Note recorded", resources0, runtime0, { inputs: { text: op.text, category: op.category, ...(op.subject === undefined ? {} : { subject: op.subject }), source: "PLAYER_GM_PROVIDED" } });
      case "RECONCILE":
        return advanced ? accept("RULES_EXECUTED", "Advancement acknowledged; held Active Magic keeps its pinned activation values", resources0, runtime0, { trace: { advancementCount: { before: runtime0.advancementCount, after: ctx.advancementCount } } }) : refuse(R.NOTHING_TO_RECONCILE, "the play state already matches the Character");
    }
  })();
  return finishDraft(op, draft);
}

// ---- timing (§6) ----------------------------------------------------------------------------------------------------

/** Which timing events are legal from the current local timing state (a sequence check — never a resource rule). */
export function legalTimingEvents(runtime: PlayRuntimeState): readonly (typeof PLAY_TIMING_EVENTS)[number][] {
  const c = runtime.combat;
  return PLAY_TIMING_EVENTS.filter((e) => timingRefusal(c, e) === null);
}

function timingRefusal(c: PlayRuntimeState["combat"], event: (typeof PLAY_TIMING_EVENTS)[number]): string | null {
  switch (event) {
    case "BEGIN_COMBAT":
      return c.active ? "combat has already begun" : null;
    case "START_ROUND":
      return !c.active ? "begin combat first" : c.phase !== "AWAITING_ROUND" ? "the current round has not ended" : null;
    case "START_TURN":
      return c.phase !== "ROUND" ? "start a round first" : c.turn === "ACTIVE" ? "this Character's turn is already in progress" : c.turn === "ENDED" ? "this Character has already taken its turn this round (AP would refresh twice)" : null;
    case "END_TURN":
      return c.turn !== "ACTIVE" || c.phase !== "ROUND" ? "no turn of this Character is in progress" : null;
    case "END_ROUND":
      return c.phase !== "ROUND" ? "no round is in progress" : c.turn === "ACTIVE" ? "end this Character's turn first" : null;
    case "END_COMBAT":
      return !c.active ? "no combat is in progress" : c.turn === "ACTIVE" && c.phase === "ROUND" ? "end this Character's turn first" : null;
  }
}

/** The authored M5-WO3 behaviour at one timing event, run only when some supplied Resource authors one (data-driven). */
function runTiming(engine: PlayEngineContext, index: RuntimeDefinitionIndex, event: CombatTimingEvent, resources: ProwessRuntimeResources, subjectKey: string): { ok: true; run: PlayRun | null } | { ok: false; problems: readonly ProwessProblem[] } {
  const authored = resources.resources.some((x) => {
    const d = index.resources[x.resourceKey]?.payload;
    return d !== undefined && (d.refresh.some((r) => r.timing === event) || d.expiry.some((r) => r.timing === event));
  });
  if (!authored) return { ok: true, run: null };
  const out = runPlan(engine, { kind: "RESOURCE_TIMING", subjectKey, event }, resources);
  return out.ok ? { ok: true, run: out.run } : out;
}

function magic(ctx: PlayContext, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, event: Record<string, unknown>): { ok: true; transition: ActiveMagicTransition } | { ok: false; problems: readonly ProwessProblem[] } {
  const out = transitionActiveMagicWith({ contractVersion: 1, definitions: ctx.bundle, ruleset: ctx.ruleset, caster: ctx.casterCore, casterKey: ctx.characterId, resources, state: runtime.activeMagic, event }, characterSpellAdapter(ctx));
  return out.ok ? { ok: true, transition: out.value } : { ok: false, problems: out.problems };
}

function timing(ctx: PlayContext, engine: PlayEngineContext, index: RuntimeDefinitionIndex, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "TIMING" }>): Draft {
  const refusal = timingRefusal(runtime.combat, op.event);
  if (refusal !== null) return refuse(R.TIMING_SEQUENCE, refusal);
  const c = runtime.combat;
  const trace: Record<string, unknown> = {};
  let next = runtime;
  let res = resources;
  const timed = (event: CombatTimingEvent, round: number | null) => {
    const e: PlayEngineContext = { ...engine, combat: round === null ? null : { round, surprised: c.surprised } };
    const out = runTiming(e, index, event, res, `play.timing.${event.toLowerCase()}`);
    if (!out.ok) return out;
    if (out.run !== null) {
      res = out.run.reading.resources;
      trace.timing = { event, transitions: out.run.reading.transitions, availability: out.run.reading.availability, evaluation: out.run.evaluation };
    } else trace.timing = { event, transitions: [], note: "no Resource of this Release authors behaviour at this timing event" };
    return out;
  };
  const tick = (event: Record<string, unknown>) => {
    if (!liveMagic(next.activeMagic)) return null;
    const out = magic(ctx, next, res, event);
    if (!out.ok) return out.problems;
    trace.activeMagic = { event: out.transition.event, lifecycle: out.transition.lifecycle, ticks: out.transition.ticks, channelResult: out.transition.channelResult, resourceChanges: out.transition.resourceChanges };
    res = out.transition.resources;
    next = { ...next, activeMagic: out.transition.state };
    return null;
  };
  switch (op.event) {
    case "BEGIN_COMBAT":
      next = { ...runtime, combat: { active: true, round: null, surprised: op.surprised === true, phase: "AWAITING_ROUND", turn: "NOT_TAKEN" } };
      return accept("RULES_EXECUTED", `Combat begun${op.surprised === true ? " (surprised — GM determination)" : ""}`, res, next, { inputs: { surprised: { value: op.surprised === true, source: "PLAYER_GM_PROVIDED" } } });
    case "START_ROUND": {
      const round = nextRoundOrdinal(c.round);
      const out = timed("START_OF_ROUND", round);
      if (!out.ok) return refuse(R.ENGINE_REFUSED, "the Start of Round refresh could not be evaluated", { reasons: reasons(out.problems, R.ENGINE_REFUSED) });
      next = { ...next, combat: { ...c, round, phase: "ROUND", turn: "NOT_TAKEN" } };
      const problems = tick({ kind: "TIMING", timing: "ON_ROUND_START" });
      if (problems !== null) return refuse(R.ENGINE_REFUSED, "Active Magic could not process the round start", { reasons: reasons(problems, R.ENGINE_REFUSED) });
      return accept("RULES_EXECUTED", `Round ${String(round)} started`, res, next, { trace });
    }
    case "START_TURN": {
      const out = timed("START_OF_TURN", c.round);
      if (!out.ok) return refuse(R.ENGINE_REFUSED, "the Start of Turn refresh could not be evaluated", { reasons: reasons(out.problems, R.ENGINE_REFUSED) });
      next = { ...next, combat: { ...c, turn: "ACTIVE" }, movement: { grants: [], segments: [] } };
      const problems = tick({ kind: "TIMING", timing: "START_OF_CASTER_TURN" });
      if (problems !== null) return refuse(R.ENGINE_REFUSED, "Active Magic could not process the turn start", { reasons: reasons(problems, R.ENGINE_REFUSED) });
      return accept("RULES_EXECUTED", "Turn started", res, next, { trace });
    }
    case "END_TURN": {
      const problems = tick({ kind: "TIMING", timing: "END_OF_CASTER_TURN" });
      if (problems !== null) return refuse(R.ENGINE_REFUSED, "Active Magic could not process the turn end", { reasons: reasons(problems, R.ENGINE_REFUSED) });
      const out = timed("END_OF_TURN", c.round);
      if (!out.ok) return refuse(R.ENGINE_REFUSED, "the End of Turn expiry could not be evaluated", { reasons: reasons(out.problems, R.ENGINE_REFUSED) });
      next = { ...next, combat: { ...c, turn: "ENDED" } };
      return accept("RULES_EXECUTED", "Turn ended", res, next, { trace });
    }
    case "END_ROUND": {
      const out = timed("END_OF_ROUND", c.round);
      if (!out.ok) return refuse(R.ENGINE_REFUSED, "the End of Round timing could not be evaluated", { reasons: reasons(out.problems, R.ENGINE_REFUSED) });
      const problems = tick({ kind: "ROUND_END" });
      if (problems !== null) return refuse(R.ENGINE_REFUSED, "Active Magic could not process the round end", { reasons: reasons(problems, R.ENGINE_REFUSED) });
      next = { ...next, combat: { ...c, phase: "AWAITING_ROUND", turn: "NOT_TAKEN" } };
      return accept("RULES_EXECUTED", `Round ${String(c.round)} ended`, res, next, { trace });
    }
    case "END_COMBAT": {
      const problems = tick({ kind: "BOUNDARY", boundary: "COMBAT_END" });
      if (problems !== null) return refuse(R.ENGINE_REFUSED, "Active Magic could not process the combat boundary", { reasons: reasons(problems, R.ENGINE_REFUSED) });
      next = { ...next, combat: { active: false, round: null, surprised: false, phase: "OUT_OF_COMBAT", turn: "NOT_TAKEN" } };
      return accept("RULES_EXECUTED", "Combat ended (only Combat-duration Effects end at this boundary)", res, next, { trace });
    }
  }
}

// ---- General Actions (§7) and movement (§8) ---------------------------------------------------------------------------

const windowOf = (runtime: PlayRuntimeState) => (runtime.combat.turn === "ACTIVE" && runtime.combat.phase === "ROUND" ? "OWN_TURN" : "OUTSIDE_OWN_TURN");

function paymentRefusal(confirmation: { status: string; payments: readonly { costKey: string; listedAmount: number; shortfall: number; canPay: boolean }[] }): Draft {
  if (confirmation.status === "UNAVAILABLE") return refuse(R.USAGE_UNAVAILABLE, "a usage restriction makes this payment unavailable now (e.g. Surprise in the first round); nothing was paid", { trace: { payments: confirmation.payments } });
  const short = confirmation.payments.filter((p) => !p.canPay).map((p) => `${p.costKey} ${String(p.listedAmount)} (short ${String(p.shortfall)})`);
  return refuse(R.INSUFFICIENT_RESOURCES, `insufficient resources: ${short.join(", ")}; nothing was paid`, { trace: { payments: confirmation.payments } });
}

function generalAction(ctx: PlayContext, engine: PlayEngineContext, index: RuntimeDefinitionIndex, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "GENERAL_ACTION" }>): Draft {
  const action = index.actions[op.actionKey];
  if (action === undefined) return refuse(R.UNKNOWN_ACTION, `the Character's Release has no ACTION ${op.actionKey}`);
  const ref = action.ref;
  const source = { kind: "GENERAL_ACTION", action: ref, actionKey: op.actionKey };
  const cost = action.payload.actionPointCost;
  if (cost.model === "VARIABLE") {
    return cost.determinedBy === "SPELL"
      ? refuse(R.COST_UNRESOLVED, "this Action's AP is set by the Spell it casts — cast a Signature Spell instead (its exact M5-WO10 cost is used)", { source })
      : { ...refuse(R.COST_UNRESOLVED, `this Action's AP is set by the ${cost.determinedBy.toLowerCase().replace(/_/g, " ")} it is used for; no such evaluated result exists here, so it is never priced as zero`, { source }), status: "UNSUPPORTED" };
  }
  const window = windowOf(runtime);
  if (action.payload.timing === "OWN_TURN" && window !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "this Action is taken on the Character's own turn — start the turn first", { source });
  if (action.payload.timing === "OUTSIDE_OWN_TURN") {
    if (!runtime.combat.active) return refuse(R.NOT_IN_COMBAT, "this reaction is used in combat, outside the Character's own turn", { source });
    if (window === "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "this reaction is used outside the Character's own turn", { source });
  }
  if (action.payload.requiresTrigger && op.trigger === undefined) return { ...refuse(R.TRIGGER_REQUIRED, "declare the triggering event; an available Counter Action does not by itself make a reaction legal", { source }), status: "PENDING_INPUT" };
  if (!action.payload.requiresTrigger && op.trigger !== undefined) return refuse(R.INVALID_OPERATION, "this Action takes no trigger", { source });
  if ((cost.model === "RANGE" || cost.model === "MINIMUM") && op.chosenCost === undefined) {
    return { ...refuse(R.COST_CHOICE_REQUIRED, cost.model === "RANGE" ? `choose the AP cost (${String(cost.minimum)}–${String(cost.maximum)})` : `choose the AP cost (at least ${String(cost.minimum)})`, { source }), status: "PENDING_INPUT", pending: [{ kind: "COST_CHOICE", model: cost.model, minimum: cost.minimum, maximum: cost.model === "RANGE" ? cost.maximum : null }] };
  }
  if ((cost.model === "FIXED" || cost.model === "NONE") && op.chosenCost !== undefined) return refuse(R.INVALID_OPERATION, "this Action's cost is not chosen", { source });

  // An improvement replaces the FIXED cost only when M6-WO9's evaluation makes it ACTIVE, APPLIED and unconditional.
  const improvements = cost.model === "FIXED" ? actionImprovementsFor({ bundle: ctx.bundle, profile: ctx.equippedProfile, action: ref }) : [];
  const overrides = improvements.filter((e) => e.status === "ACTIVE").flatMap((e) => e.applicability.modifications.filter((m) => m.support === "APPLIED" && m.condition === null && m.actionPointCost !== null).map((m) => ({ amount: m.actionPointCost!.amount, sourceKey: e.improvement.canonicalKey })));
  if (overrides.length > 1) return refuse(R.IMPROVEMENT_CONFLICT, "more than one active improvement sets this Action's AP cost; no winner is chosen", { source });
  const conditional = improvements.filter((e) => e.status === "ACTIVE" || e.status === "CONDITIONAL").flatMap((e) => e.applicability.modifications.filter((m) => m.condition !== null).map((m) => `${e.improvementKey}.${m.modificationKey}`));
  const subject = {
    subjectKey: `play.action.${op.actionKey.toLowerCase()}`,
    actionKey: op.actionKey,
    window,
    ...(op.chosenCost === undefined ? {} : { actionPointCost: op.chosenCost }),
    ...(overrides.length === 1 ? { costOverride: overrides[0] } : {}),
    ...(op.trigger === undefined ? {} : { trigger: { triggerKey: op.trigger.triggerKey, sourceKey: "play.player_declared_trigger" } }),
  };
  const paid = payAction(engine, subject, resources);
  if (!paid.ok) return refuse(R.ENGINE_REFUSED, "the Action payment was refused by the runtime engine", { reasons: reasons(paid.problems, R.ENGINE_REFUSED), source });
  if (paid.confirmation.status !== "PAID") return { ...paymentRefusal(paid.confirmation), source };
  const trace: Record<string, unknown> = { payment: { status: paid.confirmation.status, payments: paid.confirmation.payments, availability: paid.confirmation.availability, evaluation: paid.run.evaluation }, ...(overrides.length === 1 ? { improvementOverride: overrides[0] } : {}), ...(conditional.length ? { conditionalImprovementsNotApplied: conditional } : {}) };
  let after = paid.confirmation.resources;
  let next = runtime;
  let summary = `${ctx.names[ref.entityVersionId] ?? ref.canonicalKey}: paid`;
  if (action.payload.movementGrant !== null) {
    const follow = runPlan(engine, { kind: "ACTION_FOLLOW_ON", subjectKey: `${subject.subjectKey}.follow_on`, receipt: paid.confirmation }, after);
    if (!follow.ok) return refuse(R.ENGINE_REFUSED, "the Action's follow-on could not be evaluated; nothing was paid", { reasons: reasons(follow.problems, R.ENGINE_REFUSED), source });
    after = follow.run.reading.resources;
    trace.followOn = { movementGrant: follow.run.reading.movementGrant, transitions: follow.run.reading.transitions, evaluation: follow.run.evaluation };
    next = follow.run.reading.movementGrant === null ? runtime : { ...runtime, movement: { grants: [...runtime.movement.grants, follow.run.reading.movementGrant], segments: runtime.movement.segments } };
    summary = `${summary}; Movement Allowance granted ${String(follow.run.reading.movementGrant)}`;
  }
  return accept("RULES_EXECUTED", summary, after, next, { source, trace, inputs: { ...(op.chosenCost === undefined ? {} : { chosenCost: op.chosenCost }), ...(op.trigger === undefined ? {} : { trigger: { ...op.trigger, source: "PLAYER_DECLARED" } }) } });
}

function move(engine: PlayEngineContext, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "MOVEMENT" }>): Draft {
  if (windowOf(runtime) !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "movement is spent during the Character's own turn");
  const out = runPlan(engine, { kind: "MOVEMENT", subjectKey: "play.movement", segments: op.segments }, resources);
  if (!out.ok) return refuse(R.ENGINE_REFUSED, "the movement could not be evaluated", { reasons: reasons(out.problems, R.ENGINE_REFUSED) });
  const segments = op.segments.map((s, i) => ({ ...s, allowanceCost: out.run.reading.movementCosts[i] ?? null, applied: out.run.reading.transitions[i]?.applied ?? false }));
  if (out.run.reading.transitions.some((t) => !t.applied)) return refuse(R.INSUFFICIENT_RESOURCES, "the remaining Movement Allowance does not cover these segments; nothing was spent", { trace: { segments } });
  const recorded = op.segments.map((s, i) => ({ distance: s.distance, terrainKey: s.terrainKey, allowanceCost: out.run.reading.movementCosts[i] as number }));
  return accept("RULES_EXECUTED", `Moved ${op.segments.map((s) => `${String(s.distance)} ft (${s.terrainKey.toLowerCase()})`).join(", ")}`, out.run.reading.resources, { ...runtime, movement: { grants: runtime.movement.grants, segments: [...runtime.movement.segments, ...recorded] } }, { trace: { segments, evaluation: out.run.evaluation } });
}

// ---- payments shared by Attacks, Spells and Maneuvers ----------------------------------------------------------------

interface Paid {
  readonly resources: ProwessRuntimeResources;
  readonly trace: Record<string, unknown>[];
}

/** AP through an authored payment path, then MP through WO3 MAGICAL_PAYMENT; all-or-nothing (nothing staged on failure). */
function payCosts(engine: PlayEngineContext, resources: ProwessRuntimeResources, costs: { readonly ap: { readonly kind: "ACTION"; readonly subject: Record<string, unknown> } | { readonly kind: "SPEND"; readonly amount: number; readonly sourceKey: string }; readonly mp: { readonly amount: number; readonly meEligible: boolean; readonly sourceKey: string } | null }, subjectKey: string): { ok: true; paid: Paid } | { ok: false; draft: Draft } {
  const trace: Record<string, unknown>[] = [];
  let res = resources;
  if (costs.ap.kind === "ACTION") {
    const out = payAction(engine, costs.ap.subject, res);
    if (!out.ok) return { ok: false, draft: refuse(R.ENGINE_REFUSED, "the AP payment was refused by the runtime engine", { reasons: reasons(out.problems, R.ENGINE_REFUSED) }) };
    if (out.confirmation.status !== "PAID") return { ok: false, draft: paymentRefusal(out.confirmation) };
    trace.push({ kind: "ACTION_PAYMENT", payments: out.confirmation.payments, evaluation: out.run.evaluation });
    res = out.confirmation.resources;
  } else if (costs.ap.amount > 0) {
    const out = runPlan(engine, { kind: "RESOURCE_TRANSITIONS", subjectKey: `${subjectKey}.ap`, transitions: [{ resourceKey: "AP", operation: "SPEND", amount: costs.ap.amount, sourceKey: costs.ap.sourceKey }] }, res);
    if (!out.ok) return { ok: false, draft: refuse(R.ENGINE_REFUSED, "the AP payment was refused by the runtime engine", { reasons: reasons(out.problems, R.ENGINE_REFUSED) }) };
    const t = out.run.reading.transitions[0];
    if (t === undefined || !t.applied) return { ok: false, draft: refuse(R.INSUFFICIENT_RESOURCES, `insufficient AP: ${String(costs.ap.amount)} needed (short ${String(t?.shortfall ?? costs.ap.amount)}); nothing was paid`, { trace: { transitions: out.run.reading.transitions } }) };
    trace.push({ kind: "AP_SPEND", transitions: out.run.reading.transitions, evaluation: out.run.evaluation });
    res = out.run.reading.resources;
  }
  if (costs.mp !== null && costs.mp.amount > 0) {
    const out = runPlan(engine, { kind: "MAGICAL_PAYMENT", subjectKey: `${subjectKey}.mp`, costKey: "MP", listedAmount: costs.mp.amount, meEligible: costs.mp.meEligible, sourceKey: costs.mp.sourceKey }, res);
    if (!out.ok) return { ok: false, draft: refuse(R.ENGINE_REFUSED, "the MP payment was refused by the runtime engine; nothing was paid", { reasons: reasons(out.problems, R.ENGINE_REFUSED) }) };
    const pay = out.run.reading.payments[0];
    if (pay === undefined || !pay.canPay) return { ok: false, draft: refuse(R.INSUFFICIENT_RESOURCES, `insufficient mana: ${String(costs.mp.amount)} needed (short ${String(pay?.shortfall ?? costs.mp.amount)}); nothing was paid`, { trace: { payments: out.run.reading.payments } }) };
    trace.push({ kind: "MAGICAL_PAYMENT", payments: out.run.reading.payments, evaluation: out.run.evaluation });
    res = out.run.reading.resources;
  }
  return { ok: true, paid: { resources: res, trace } };
}

/** A payment-only preview (availability in the Action Workspace); never a resolution. */
/** An Attack's OWN authored AP / MP (M6-WO6 listing) as the payment request — MP is never ME-eligible for an Attack. */
const listedAttackCost = (a: CharacterAttack, key: "apCost" | "mpCost"): number => a[key];
export function attackCosts(a: CharacterAttack): Parameters<typeof payCosts>[2] {
  const ap = listedAttackCost(a, "apCost");
  const mp = listedAttackCost(a, "mpCost");
  return { ap: { kind: "SPEND", amount: ap, sourceKey: a.attack.canonicalKey }, mp: mp > 0 ? { amount: mp, meEligible: false, sourceKey: a.attack.canonicalKey } : null };
}

export function previewCosts(ctx: PlayContext, stored: PlayStored, costs: Parameters<typeof payCosts>[2], subjectKey: string): { readonly canPay: boolean; readonly reasons: readonly PlayReason[] } {
  const index = indexRuntimeDefinitions(ctx.bundle);
  if (!index.ok) return { canPay: false, reasons: reasons(index.problems, R.ENGINE_REFUSED) };
  const runtime = stored.runtime ?? initialPlayRuntime(ctx);
  const engine: PlayEngineContext = { bundle: ctx.bundle, ruleset: ctx.ruleset, character: ctx.casterCore, combat: runtime.combat.active && runtime.combat.round !== null ? { round: runtime.combat.round, surprised: runtime.combat.surprised } : null };
  const out = payCosts(engine, runtimeResourcesOf(ctx, stored, runtime, index.value), costs, subjectKey);
  return out.ok ? { canPay: true, reasons: [] } : { canPay: false, reasons: out.draft.reasons };
}

// ---- Weapon Attacks (§9) ----------------------------------------------------------------------------------------------

export function attacksOf(library: CharacterAttackLibrary): CharacterAttack[] {
  return [...(library.unarmed?.attacks ?? []), ...(library.mainHand?.attacks ?? []), ...(library.offHand?.attacks ?? [])];
}

/** Whether an existing structured path resolves this Attack (the WO2 Attack Roll with no Attack-specific modifier). */
export function attackResolutionSupport(attack: CharacterAttack): { readonly supported: boolean; readonly reason: string | null } {
  if (attack.resolution.mode === "DEFERRED") return { supported: false, reason: `canon does not state how this Move resolves: ${attack.resolution.reason}` };
  if (attack.resolution.mode === "SAVING_THROW") return { supported: false, reason: "no existing executable path binds a standalone Weapon Attack's Saving Throw and DC; use the card as reference and adjudicate with the GM" };
  if (attack.accuracyModifier !== 0) return { supported: false, reason: "this Attack's own accuracy modifier has no executable Attack Roll binding; use the card as reference" };
  return { supported: true, reason: null };
}

function weaponAttack(ctx: PlayContext, engine: PlayEngineContext, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "WEAPON_ATTACK" }>): Draft {
  const attack = attacksOf(ctx.attackLibrary).find((a) => a.attackKey === op.attackKey && a.hand === op.hand);
  if (attack === undefined) return refuse(R.UNKNOWN_ACTION, "this exact Attack is not in the Character's current loadout");
  const { weapon: weaponRef, attack: attackRef } = attack;
  const source = { kind: "WEAPON_ATTACK", attackKey: attack.attackKey, hand: attack.hand, weapon: weaponRef, attack: attackRef, grip: attack.grip };
  if (attack.eligibility !== "ELIGIBLE") return refuse(R.ABILITY_NOT_EXECUTABLE, `this Attack is ${attack.eligibility.toLowerCase()} for the Character (requirements)`, { source });
  const profile = attack.damage.find((d) => d.profileKey === op.damageProfileKey);
  if (profile === undefined) return refuse(R.INVALID_OPERATION, "choose one of the Attack's authored damage profiles (never auto-selected)", { source });
  const support = attackResolutionSupport(attack);
  if (!support.supported) return { ...refuse(R.RESOLUTION_UNSUPPORTED, support.reason as string, { source }), status: "UNSUPPORTED" };
  if (windowOf(runtime) !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "Weapon Attacks are made on the Character's own turn — start the turn first", { source });
  if (op.roll === undefined || op.targetDodge === undefined) {
    return { ...refuse(R.PENDING_INPUT, "enter the Attack Roll and the target's Dodge (GM-provided)", { source }), status: "PENDING_INPUT", pending: [{ kind: "ATTACK_ROLL", by: "ATTACKER", characterDie: ctx.characterDie.dieKey, needs: ["roll", "targetDodge"] }] };
  }
  // The Attack's own authored AP / MP — never a same-named generic Action, never charged twice (§9).
  const paid = payCosts(engine, resources, attackCosts(attack), "play.attack");
  if (!paid.ok) return { ...paid.draft, source };
  const subject = { kind: "CORE_RESOLUTION", subjectKey: "play.attack.roll", procedure: "ATTACK_ROLL", mode: op.roll.mode };
  const compiled = compileCoreResolution({ contractVersion: 1, subject, definitions: ctx.bundle, ruleset: ctx.ruleset, character: ctx.casterCore });
  if (!compiled.ok) return refuse(R.ENGINE_REFUSED, "the Attack Roll could not be compiled", { reasons: reasons(compiled.problems, R.ENGINE_REFUSED), source });
  const roll = { die: ctx.characterDie, mode: op.roll.mode, rolls: [...op.roll.rolls] };
  const contexts = buildCoreResolutionContexts({ definitions: ctx.bundle, character: ctx.casterCore, plan: compiled.value, roll, targetDodge: op.targetDodge });
  if (!contexts.ok) return refuse(R.INVALID_OPERATION, "the roll is not valid for the Character Die", { reasons: reasons(contexts.problems, R.INVALID_OPERATION), source });
  const response = orchestrateRulesEvaluation({ evaluationKey: "m6-wo10.play.attack.roll", contexts: { ruleset: ctx.ruleset as never, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: compiled.value.evaluationPlan });
  const value = (stepKey: string | null): unknown => {
    if (stepKey === null || !response.success || !response.data) return null;
    const d = response.data.steps.find((s) => s.stepKey === stepKey)?.response?.data as Record<string, unknown> | undefined;
    return d === undefined ? null : "finalValue" in d ? d.finalValue : "satisfied" in d ? d.satisfied : null;
  };
  const o = compiled.value.outputs;
  const hit = value(o.success);
  if (typeof hit !== "boolean") return refuse(R.ENGINE_REFUSED, "the WO2 Attack Roll did not resolve", { source });
  const result = { hit, natural: value(o.natural), total: value(o.total), criticalHit: value(o.criticalHit), targetDodge: { value: op.targetDodge, source: "PLAYER_GM_PROVIDED" } };
  const outcome = hit ? { kind: "DAMAGE_PROFILE", applied: false, profile: clonePlainData(profile), note: "a hit authorises this damage profile; roll and apply it with the GM — target HP, Armor and Resistance are not changed here" } : { kind: "ON_MISS", applied: false, onMiss: attack.resolution.mode === "ATTACK_ROLL" ? attack.resolution.onMiss : null };
  return accept("RULES_EXECUTED", `${ctx.names[attack.attack.entityVersionId] ?? attack.attack.canonicalKey}: ${hit ? "hit" : "miss"} (total ${String(result.total)} vs Dodge ${String(op.targetDodge)})`, paid.paid.resources, runtime, {
    source,
    trace: { payments: paid.paid.trace, resolution: { ...result, evaluation: { plan: compiled.value.evaluationPlan, contexts: { actor: contexts.value.actor, runtime: contexts.value.runtime } } }, outcome, notExecuted: attack.notExecuted },
    inputs: { roll: { ...op.roll, die: ctx.characterDie.dieKey }, targetDodge: { value: op.targetDodge, source: "PLAYER_GM_PROVIDED" }, damageProfileKey: op.damageProfileKey },
  });
}

// ---- Signature Spells (§10) and Maneuvers (§11) ----------------------------------------------------------------------

/**
 * Mana Efficiency pays a Spell's casting MP before MP (M5-SC-004 RESOLVED_BY_DESIGNER — M5-WO1 §140, s646 / s647 / s715:
 * "an 8 MP spell paid 5 ME + 3 MP"). No such ruling covers Weapon Attack or Maneuver MP, which are therefore MP-only
 * (M5-I090: ME eligibility is never assumed). The listed cost is never reduced either way.
 */
export const SPELL_CASTING_ME_ELIGIBLE = true as const;

function abilityOutcome(result: AbilityExecutionResult) {
  return {
    status: result.status,
    executionKey: result.executionKey,
    outcomes: result.outcomes.map((o) => ({ ...clonePlainData(o), applied: false })),
    targets: result.targets,
    groups: result.groups,
    unusedInputs: result.unusedInputs,
    coreEvaluations: result.coreEvaluations,
    triggerEvaluations: result.triggerEvaluations,
    note: "outcomes are the engine's resolved intent; nothing is applied to any target (HP, Armor, Status Conditions, position)",
  };
}

/** The Signature Spell entry the Character can cast now: ACTIVE, the exact current revision, pinned to this Release. */
function castableSpell(ctx: PlayContext, abilityId: string, revisionNumber: number) {
  const source = ctx.spells.find((s) => s.abilityId === abilityId);
  if (source === undefined) return { error: refuse(R.UNKNOWN_ABILITY, "no Signature Spell of this Character has this id") };
  if (source.status !== "ACTIVE") return { error: refuse(R.ABILITY_NOT_EXECUTABLE, `this Signature Spell is ${source.status.toLowerCase()}; only an active Spell is cast`) };
  if (source.revisionNumber !== revisionNumber) return { error: { ...refuse(R.REVISION_CHANGED, `the Spell's current revision is r${String(source.revisionNumber)}, not r${String(revisionNumber)}; reload and review the new revision`), status: "REFUSED" as const } };
  if (source.revisionReleaseId !== ctx.releaseId) return { error: refuse(R.RELEASE_MISMATCH, "this revision is pinned to another Release and is never re-evaluated against the Character's Release") };
  return { source };
}

function spell(ctx: PlayContext, engine: PlayEngineContext, index: RuntimeDefinitionIndex, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "SPELL" }>): Draft {
  const found = castableSpell(ctx, op.abilityId, op.revisionNumber);
  if ("error" in found) return found.error as Draft;
  const source = { ...spellIdentityOf(ctx.characterId, op.abilityId, op.revisionNumber), name: found.source.name };
  const e = evaluateSpellSource(ctx, found.source);
  if (e === null) return refuse(R.ABILITY_NOT_EXECUTABLE, "the stored revision cannot be read", { source });
  const ev = e.evaluation;
  if (ev.state === "INCOMPLETE" || ev.state === "INVALID" || ev.cost === null) return refuse(R.ABILITY_NOT_EXECUTABLE, `the Spell is ${ev.state.toLowerCase()} for this Character now: ${ev.issues.map((i) => i.message).slice(0, 3).join("; ")}`, { source });
  if (ev.state === "VALID_WITH_RUNTIME_DEFERRED" || e.compiled === null) return { ...refuse(R.RESOLUTION_UNSUPPORTED, `the Spell's runtime resolution is deferred: ${ev.runtime.deferred.map((d) => `${d.conflictKey} ${d.message}`).join("; ")}`, { source }), status: "UNSUPPORTED" };
  // The cast action is the Release's ACTION whose AP is determined by the Spell (data-driven, never an action name).
  const cast = Object.values(index.actions).find((a) => a.payload.actionPointCost.model === "VARIABLE" && a.payload.actionPointCost.determinedBy === "SPELL");
  if (cast === undefined) return { ...refuse(R.COST_UNRESOLVED, "the Release authors no Action whose AP cost a Spell determines", { source }), status: "UNSUPPORTED" };
  if (cast.payload.timing === "OWN_TURN" && windowOf(runtime) !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "Spells are cast on the Character's own turn — start the turn first", { source });
  const built = buildResolutionInputs(ctx, e.compiled.plan.executionKey, op.inputs);
  if (!built.ok) return refuse(R.INVALID_OPERATION, "the resolution inputs are not valid", { reasons: reasons(built.problems, R.INVALID_OPERATION), source });
  const executed = executeCompiled(e.compiled, op.targets, null, built.value.inputs);
  if (!executed.ok) return refuse(R.ENGINE_REFUSED, "M5-WO12 refused this resolution request", { reasons: reasons(executed.problems, R.ENGINE_REFUSED), source, inputs: { targets: op.targets, inputs: built.value.recorded } });
  const costs = { finalApCost: ev.cost.ap.finalApCost, finalMpCost: ev.cost.finalMpCost };
  const label = signatureSourceKey("spell", op.abilityId, op.revisionNumber);
  if (executed.value.status === "PENDING_INPUT") {
    return { ...refuse(R.PENDING_INPUT, `${String(executed.value.pendingInputs.length)} input(s) needed before the Spell resolves; nothing is paid until it is complete`, { source }), status: "PENDING_INPUT", pending: executed.value.pendingInputs.map((q) => describePending(ctx, q) as Record<string, unknown>), trace: { costs, resolution: abilityOutcome(executed.value) }, inputs: { targets: op.targets, inputs: built.value.recorded } };
  }
  const paid = payCosts(engine, resources, { ap: { kind: "ACTION", subject: { subjectKey: "play.spell.cast", actionKey: cast.payload.actionKey, window: windowOf(runtime), actionPointCost: costs.finalApCost, costSourceKey: label } }, mp: { amount: costs.finalMpCost, meEligible: SPELL_CASTING_ME_ELIGIBLE, sourceKey: label } }, "play.spell");
  if (!paid.ok) return { ...paid.draft, source, trace: { ...paid.draft.trace, costs } };
  let after = paid.paid.resources;
  let next = runtime;
  const trace: Record<string, unknown> = { costs, payments: paid.paid.trace, resolution: abilityOutcome(executed.value) };
  const duration = ev.authored?.durationConditions?.duration;
  if (duration !== undefined && duration.mode !== "INSTANT" && duration.futureRuntime.persists) {
    const activation = magic(ctx, { ...runtime, activeMagic: runtime.activeMagic }, after, { kind: "ACTIVATE", activeEffectKey: `${label}.a${String(runtime.activeMagic?.effects.length ?? 0)}`, ability: { characterSignatureSpell: { abilityId: op.abilityId, revisionNumber: op.revisionNumber }, execution: { targets: clonePlainData(op.targets), inputs: clonePlainData(built.value.inputs) } }, round: runtime.combat.active ? runtime.combat.round : null });
    if (!activation.ok) return refuse(R.ENGINE_REFUSED, "M5-WO13 refused to activate this Spell's persistent Effect; nothing was paid or changed", { reasons: reasons(activation.problems, R.ENGINE_REFUSED), source, trace: { costs } });
    trace.activeMagic = { status: activation.transition.status, noActiveEffectReason: activation.transition.noActiveEffectReason, lifecycle: activation.transition.lifecycle, resourceChanges: activation.transition.resourceChanges, inspector: activation.transition.inspector };
    after = activation.transition.resources;
    next = { ...runtime, activeMagic: activation.transition.state };
  } else trace.activeMagic = { status: "NO_ACTIVE_EFFECT", noActiveEffectReason: "INSTANT" };
  const resolved = executed.value.outcomes.length;
  return accept("RULES_EXECUTED", `${found.source.name} cast: ${String(costs.finalApCost)} AP, ${String(costs.finalMpCost)} MP; ${String(resolved)} outcome(s) resolved (not applied)`, after, next, { source, trace, inputs: { targets: op.targets, inputs: built.value.recorded } });
}

function maneuver(ctx: PlayContext, engine: PlayEngineContext, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "MANEUVER" }>): Draft {
  const found = ctx.maneuvers.find((s) => s.abilityId === op.abilityId);
  if (found === undefined) return refuse(R.UNKNOWN_ABILITY, "no Signature Maneuver of this Character has this id");
  if (found.status !== "ACTIVE") return refuse(R.ABILITY_NOT_EXECUTABLE, `this Signature Maneuver is ${found.status.toLowerCase()}; only an active Maneuver is used`);
  if (found.revisionNumber !== op.revisionNumber) return refuse(R.REVISION_CHANGED, `the Maneuver's current revision is r${String(found.revisionNumber)}, not r${String(op.revisionNumber)}; reload and review the new revision`);
  if (found.revisionReleaseId !== ctx.releaseId) return refuse(R.RELEASE_MISMATCH, "this revision is pinned to another Release and is never re-evaluated against the Character's Release");
  const label = signatureSourceKey("maneuver", op.abilityId, op.revisionNumber);
  const source = { kind: "SIGNATURE_MANEUVER", characterId: ctx.characterId, signatureAbilityId: op.abilityId, revisionNumber: op.revisionNumber, canonicalKey: label, name: found.name };
  const e = evaluateManeuverSource(ctx, found);
  if (e === null) return refuse(R.ABILITY_NOT_EXECUTABLE, "the stored revision cannot be read", { source });
  const ev = e.evaluation;
  if (ev.state === "INCOMPLETE" || ev.state === "INVALID" || ev.cost === null) return refuse(R.ABILITY_NOT_EXECUTABLE, `the Maneuver is ${ev.state.toLowerCase()} for this Character now: ${ev.issues.map((i) => i.message).slice(0, 3).join("; ")}`, { source });
  if (ev.state === "VALID_WITH_RUNTIME_DEFERRED" || e.compiled === null) return { ...refuse(R.RESOLUTION_UNSUPPORTED, `the Maneuver's runtime resolution is deferred: ${ev.runtimeDeferred.map((d) => `${d.code} ${d.message}`).join("; ")}`, { source }), status: "UNSUPPORTED" };
  if (windowOf(runtime) !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "Maneuvers are used on the Character's own turn — start the turn first", { source });
  const built = buildResolutionInputs(ctx, e.compiled.plan.executionKey, op.inputs);
  if (!built.ok) return refuse(R.INVALID_OPERATION, "the resolution inputs are not valid", { reasons: reasons(built.problems, R.INVALID_OPERATION), source });
  const executed = executeCompiled(e.compiled, op.targets, op.groupTargets, built.value.inputs);
  if (!executed.ok) return refuse(R.ENGINE_REFUSED, "M5-WO12 refused this resolution request", { reasons: reasons(executed.problems, R.ENGINE_REFUSED), source, inputs: { targets: op.targets, groupTargets: op.groupTargets, inputs: built.value.recorded } });
  const costs = { finalApCost: ev.cost.ap.finalApCost, finalMpCost: ev.cost.mp.finalMpCost };
  // Performance preparation and any other separately priced prerequisite is NOT folded into this cost (§11).
  const separate = (ev.authored?.durationConditions?.conditions ?? []).flatMap((c) => (c.preparationAp === undefined ? [] : [{ condition: c.definition, preparationAp: c.preparationAp, note: "prepared separately; not part of this payment" }]));
  if (executed.value.status === "PENDING_INPUT") {
    return { ...refuse(R.PENDING_INPUT, `${String(executed.value.pendingInputs.length)} input(s) needed before the Maneuver resolves; nothing is paid until it is complete`, { source }), status: "PENDING_INPUT", pending: executed.value.pendingInputs.map((q) => describePending(ctx, q) as Record<string, unknown>), trace: { costs, separatelyPriced: separate, resolution: abilityOutcome(executed.value) }, inputs: { targets: op.targets, groupTargets: op.groupTargets, inputs: built.value.recorded } };
  }
  const paid = payCosts(engine, resources, { ap: { kind: "SPEND", amount: costs.finalApCost, sourceKey: label }, mp: costs.finalMpCost > 0 ? { amount: costs.finalMpCost, meEligible: false, sourceKey: label } : null }, "play.maneuver");
  if (!paid.ok) return { ...paid.draft, source, trace: { ...paid.draft.trace, costs } };
  return accept("RULES_EXECUTED", `${found.name} used: ${String(costs.finalApCost)} AP${costs.finalMpCost > 0 ? `, ${String(costs.finalMpCost)} MP` : ""}; ${String(executed.value.outcomes.length)} outcome(s) resolved (not applied)`, paid.paid.resources, runtime, { source, trace: { costs, separatelyPriced: separate, payments: paid.paid.trace, resolution: abilityOutcome(executed.value) }, inputs: { targets: op.targets, groupTargets: op.groupTargets, inputs: built.value.recorded } });
}

// ---- Active Magic (§13) --------------------------------------------------------------------------------------------------

function activeMagic(ctx: PlayContext, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "ACTIVE_MAGIC" }>): Draft {
  let event: Record<string, unknown>;
  const inputs: Record<string, unknown> = {};
  switch (op.event) {
    case "MAINTENANCE":
      event = { kind: "MAINTENANCE", ...(op.selection === undefined ? {} : { selection: [...op.selection] }) };
      if (op.selection !== undefined) inputs.selection = { value: [...op.selection], source: "PLAYER_DECISION" };
      break;
    case "DISMISS":
      event = { kind: "DISMISS", activeEffectKey: op.activeEffectKey };
      break;
    case "EXTERNAL_END":
      if (!(Object.keys(ACTIVE_MAGIC_EXTERNAL_ENDS) as unknown[]).includes(op.end)) return refuse(R.INVALID_OPERATION, `end ∈ ${Object.keys(ACTIVE_MAGIC_EXTERNAL_ENDS).join(", ")}`);
      event = { kind: "EXTERNAL_END", activeEffectKey: op.activeEffectKey, end: op.end, sourceKey: op.sourceKey };
      inputs.externalEnd = { end: op.end, sourceKey: op.sourceKey, source: "PLAYER_GM_PROVIDED" };
      break;
    case "CONCENTRATION_TEST":
      if (!(CONCENTRATION_TRIGGERS as readonly unknown[]).includes(op.trigger)) return refuse(R.INVALID_OPERATION, `trigger ∈ ${CONCENTRATION_TRIGGERS.join(", ")}`);
      event = { kind: "CONCENTRATION_TEST", trigger: op.trigger, target: op.target, ...(op.failureScope === undefined ? {} : { failureScope: op.failureScope }), ...(op.roll === undefined ? {} : { roll: { die: ctx.characterDie, mode: op.roll.mode, rolls: [...op.roll.rolls] } }) };
      inputs.concentration = { trigger: op.trigger, target: op.target, ...(op.roll === undefined ? {} : { roll: { ...op.roll, die: ctx.characterDie.dieKey } }), source: "PLAYER_GM_PROVIDED" };
      break;
    case "CHANNEL_START": {
      if (op.abilityId === undefined || op.revisionNumber === undefined) return refuse(R.INVALID_OPERATION, "CHANNEL_START names the Signature Spell and its revision");
      const found = castableSpell(ctx, op.abilityId, op.revisionNumber);
      if ("error" in found) return found.error as Draft;
      if (windowOf(runtime) !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "a Channel is started on the Character's own turn");
      event = { kind: "CHANNEL_START", channelKey: `${signatureSourceKey("spell", op.abilityId, op.revisionNumber)}.channel`, ability: { characterSignatureSpell: { abilityId: op.abilityId, revisionNumber: op.revisionNumber } } };
      break;
    }
    case "CHANNEL_INVEST":
      if (windowOf(runtime) !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW, "AP is invested on the Character's own turn");
      event = { kind: "CHANNEL_INVEST", amount: op.amount };
      break;
    case "CHANNEL_STOP":
      event = { kind: "CHANNEL_STOP" };
      break;
  }
  const out = magic(ctx, runtime, resources, event);
  const pendingNow = runtime.activeMagic?.effects.some((x) => x.status === "PENDING_MAINTENANCE" || x.status === "PENDING_CONCENTRATION") === true || runtime.activeMagic?.channel?.status === "PENDING_CONCENTRATION";
  if (!out.ok) {
    const code = pendingNow ? R.PENDING_DECISION : R.ENGINE_REFUSED;
    return { ...refuse(code, pendingNow ? "a held Active Magic decision must be resolved first; nothing changed" : "M5-WO13 refused this lifecycle event; nothing changed", { reasons: [{ code, message: pendingNow ? "resolve the pending Active Magic decision first" : "M5-WO13 refused this lifecycle event" }, ...reasons(out.problems, code)] }), inputs };
  }
  const t = out.transition;
  const pending = t.pending === null ? [] : [{ ...clonePlainData(t.pending), concentrationDc: t.concentration.test?.dc ?? null }];
  const trace = { status: t.status, lifecycle: t.lifecycle, resourceChanges: t.resourceChanges, concentration: t.concentration, ticks: t.ticks, channelResult: t.channelResult, inspector: t.inspector, formulaEvaluations: t.formulaEvaluations, runtimeEvaluations: t.runtimeEvaluations };
  const channelNote = t.channelResult?.status === "COMPLETE" ? "; the Channel is complete — its MP payment timing is unresolved (M5-SC-053), so resolve the Spell with the GM" : "";
  return accept("RULES_EXECUTED", `${op.event.replace(/_/g, " ").toLowerCase()}: ${t.status.replace(/_/g, " ").toLowerCase()}${channelNote}`, t.resources, { ...runtime, activeMagic: t.state }, { trace, pending, inputs, source: { kind: "ACTIVE_MAGIC", magicEvent: op.event, ...(op.activeEffectKey === undefined ? {} : { activeEffectKey: op.activeEffectKey }) } });
}

// ---- Manual adjustment (§14) --------------------------------------------------------------------------------------------

function manual(ctx: PlayContext, index: RuntimeDefinitionIndex, runtime: PlayRuntimeState, resources: ProwessRuntimeResources, op: Extract<PlayOperation, { kind: "MANUAL_ADJUSTMENT" }>): Draft {
  const key = op.resourceKey as RuntimeResourceKey;
  const before = currentOf(resources, key);
  if (before === null) return refuse(R.MANUAL_INVALID, `${op.resourceKey} is not a Resource of this Character's Release`);
  if (before.current === op.after) return refuse(R.MANUAL_INVALID, "the value is unchanged");
  if (RUNTIME_HELD_RESOURCES[key] !== undefined) {
    if (op.after < index.resources[key].payload.minimum) return refuse(R.MANUAL_INVALID, "below the Resource's minimum");
  } else {
    const issues = validateSheetPlayState({ resources: ctx.mechanics.resources, values: { [op.resourceKey]: op.after } });
    if (issues.length > 0) return refuse(R.MANUAL_INVALID, issues.map((i) => i.message).join("; "));
  }
  const after: ProwessRuntimeResources = { resources: resources.resources.map((x) => (x.resourceKey === key ? { ...x, current: op.after } : x)) };
  return accept("MANUAL_ADJUSTMENT", `Manual adjustment: ${op.resourceKey} ${String(before.current)} → ${String(op.after)} (player / GM entered — not calculated by the rules engine)`, after, runtime, { source: { kind: "MANUAL_ADJUSTMENT", resource: index.resources[key].ref }, inputs: { resourceKey: op.resourceKey, before: before.current, after: op.after, reason: op.reason ?? null, source: "PLAYER_GM_PROVIDED" } });
}

/** Reads a stored Active Magic state's held decision (for the workspace view). */
export const pendingDecisionOf = (state: ActiveMagicState | null) =>
  state === null ? null : state.effects.some((x) => x.status === "PENDING_MAINTENANCE") ? "MAINTENANCE_SELECTION" : state.effects.some((x) => x.status === "PENDING_CONCENTRATION") || state.channel?.status === "PENDING_CONCENTRATION" ? "CONCENTRATION_SAVE" : null;

