import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationPlan } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import { buildCoreResolutionContexts, compileCoreResolution } from "../core/compile.js";
import type { AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import { ACTIVE_MAGIC_DURATIONS, type ActiveMagicDismissal, type ActiveMagicDuration, type ActiveMagicPolicy } from "../definition/active-magic-policy.js";
import { definitionRefOf, isSameExactDefinition, readDefinitionRef, type ProwessDefinitionRef } from "../definition/envelope.js";
import { canonicalJsonOf, clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { buildRuntimeContexts, compileRuntime } from "../runtime/compile.js";
import type { ProwessRuntimeResources } from "../runtime/resources.js";
import { readRuntimeRun } from "../runtime/results.js";
import { RUNTIME_RESOURCE_KEYS, type RuntimeResourceKey } from "../vocabulary/runtime.js";
import { executeAbilityResolution } from "./effect-execution.js";
import { evaluateSpellCost } from "./spell-cost.js";

/**
 * M5-WO13 — ACTIVE MAGIC RUNTIME: Sustain, Mana Lock, Concentration, Channeling and the Active Effect lifecycle.
 *
 * One pure transition: (exact Ruleset, caster, WO3 runtime Resources, Active Magic state, ONE lifecycle event) → (new
 * state, new Resources, trace). Nothing is stored, rolled, clocked or applied to combat state. Ownership stays where it
 * is permanent: WO12 decides what resolved (activation consumes `executeAbilityResolution`), WO10 decides Final Spell MP /
 * AP (`evaluateSpellCost`), WO3 performs every AP / ME / MP / Mana Lock change (`compileRuntime` + M4 Resource engine),
 * WO2 performs the Concentration Prowess Save (`compileCoreResolution`), and M4 executes every Formula (Sustain MP,
 * Concentration capacity and DC). This module selects WHICH exact rule applies, sequences it and records provenance.
 */
export const ACTIVE_MAGIC_ERROR_CODES = deepFreeze({
  INVALID_REQUEST: "PROWESS_ACTIVE_MAGIC.INVALID_REQUEST",
  MISSING_POLICY: "PROWESS_ACTIVE_MAGIC.MISSING_POLICY",
  INVALID_STATE: "PROWESS_ACTIVE_MAGIC.INVALID_STATE",
  CROSS_RULESET: "PROWESS_ACTIVE_MAGIC.CROSS_RULESET",
  INVALID_EVENT: "PROWESS_ACTIVE_MAGIC.INVALID_EVENT",
  INVALID_ABILITY: "PROWESS_ACTIVE_MAGIC.INVALID_ABILITY",
  SPELL_ONLY: "PROWESS_ACTIVE_MAGIC.SPELL_ONLY",
  UNRESOLVED_RUNTIME_RULE: "PROWESS_ACTIVE_MAGIC.UNRESOLVED_RUNTIME_RULE",
  CONCENTRATION_CAPACITY: "PROWESS_ACTIVE_MAGIC.CONCENTRATION_CAPACITY",
  NOT_DISMISSIBLE: "PROWESS_ACTIVE_MAGIC.NOT_DISMISSIBLE",
  CHANNEL_LIMIT: "PROWESS_ACTIVE_MAGIC.CHANNEL_LIMIT",
  INVALID_SELECTION: "PROWESS_ACTIVE_MAGIC.INVALID_SELECTION",
  INSUFFICIENT_RESOURCES: "PROWESS_ACTIVE_MAGIC.INSUFFICIENT_RESOURCES",
  INVALID_INPUT: "PROWESS_ACTIVE_MAGIC.INVALID_INPUT",
  PENDING_DECISION: "PROWESS_ACTIVE_MAGIC.PENDING_DECISION",
});
const K = ACTIVE_MAGIC_ERROR_CODES;

export const ACTIVE_EFFECT_STATUSES = deepFreeze(["ACTIVE", "PENDING_MAINTENANCE", "PENDING_CONCENTRATION", "ENDING", "ENDED"] as const);
export type ActiveEffectStatus = (typeof ACTIVE_EFFECT_STATUSES)[number];
export const ACTIVE_EFFECT_END_REASONS = deepFreeze(["EXPIRED", "DISMISSED", "SUSTAIN_UNPAID", "CONCENTRATION_FAILED", "DISPELLED", "INTERRUPTED", "SOURCE_DESTROYED", "COMBAT_ENDED", "SCENE_ENDED", "MISSION_ENDED", "RULE_TERMINATED"] as const);
export type ActiveEffectEndReason = (typeof ACTIVE_EFFECT_END_REASONS)[number];
/** Explicit lifecycle boundaries supplied by the caller — WO13 never decides when a combat, scene or mission ends. */
export const ACTIVE_MAGIC_BOUNDARIES = deepFreeze({ COMBAT_END: "COMBAT", SCENE_END: "SCENE", MISSION_END: "MISSION" } as const);
const BOUNDARY_REASON = { COMBAT_END: "COMBAT_ENDED", SCENE_END: "SCENE_ENDED", MISSION_END: "MISSION_ENDED" } as const;
/** External end events WO13 consumes (it never performs a Dispel check itself). */
export const ACTIVE_MAGIC_EXTERNAL_ENDS = deepFreeze({ DISPELLED: "DISPELLED", BANISHED: "SOURCE_DESTROYED", DESTROYED: "SOURCE_DESTROYED", SOURCE_ENDED: "SOURCE_DESTROYED", INTERRUPTED: "INTERRUPTED", RULE_TERMINATED: "RULE_TERMINATED" } as const);
/** Structured Concentration triggers (Core Playtest "When to Roll Concentration"); GM discretion is the explicit last one. */
export const CONCENTRATION_TRIGGERS = deepFreeze(["TAKES_DAMAGE", "GRAPPLED", "RESTRAINED", "KNOCKED_PRONE", "FORCIBLY_MOVED", "STUNNED", "DAZED", "FAILED_RELEVANT_SAVE", "MAGICAL_DISRUPTION", "MULTIPLE_UNSTABLE_EFFECTS", "CONCENTRATION_TEST_REQUIRED"] as const);
/** Structured periodic timings an authored outcome operation may carry; prose timing is never parsed. */
export const ACTIVE_EFFECT_TICK_TIMINGS = deepFreeze(["START_OF_TARGET_TURN", "END_OF_TARGET_TURN", "START_OF_CASTER_TURN", "END_OF_CASTER_TURN", "ON_ROUND_START"] as const);
export const ACTIVE_MAGIC_EVENT_KINDS = deepFreeze(["ACTIVATE", "MAINTENANCE", "ROUND_END", "BOUNDARY", "DISMISS", "EXTERNAL_END", "CONCENTRATION_TEST", "CHANNEL_START", "CHANNEL_INVEST", "CHANNEL_STOP", "TIMING"] as const);
export type ActiveMagicEventKind = (typeof ACTIVE_MAGIC_EVENT_KINDS)[number];

export interface ActiveEffectOutcomeBinding { readonly targetKey: string; readonly effectKey: string; readonly outcomeKey: string; readonly definition: ProwessDefinitionRef }
export interface FormulaEvaluation { readonly stepKey: string; readonly role: string; readonly plan: EvaluationPlan; readonly value: number }
export interface ActiveEffectState {
  readonly activeEffectKey: string;
  readonly casterKey: string;
  readonly ability: ProwessDefinitionRef;
  readonly policy: ProwessDefinitionRef;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly executionKey: string;
  readonly outcomes: readonly ActiveEffectOutcomeBinding[];
  readonly duration: { readonly definition: ProwessDefinitionRef; readonly concept: ActiveMagicDuration; readonly remainingRounds: number | null; readonly dismissal: ActiveMagicDismissal };
  /** Sustain upkeep pinned at activation: Final Spell MP (WO10) and PRO; the M4 Sustain MP; the policy Sustain AP. */
  readonly sustain: { readonly finalSpellMp: number; readonly pro: number; readonly mpCost: number; readonly apCost: number; readonly meEligible: boolean; readonly lastPayment: { readonly ap: number; readonly me: number; readonly mp: number } | null } | null;
  readonly concentration: { readonly required: boolean };
  readonly manaLock: { readonly reservedMp: number; readonly rule: "FINAL_SPELL_MP" | "FIXED" } | null;
  readonly ticks: readonly { readonly timing: string; readonly targetKey: string; readonly effectKey: string }[];
  readonly activation: { readonly round: number | null };
  readonly status: ActiveEffectStatus;
  readonly endReason: ActiveEffectEndReason | null;
  readonly endedBy: { readonly event: ActiveMagicEventKind; readonly sourceKey: string | null } | null;
  readonly sourceMap: readonly FormulaEvaluation[];
}
export interface ChannelState {
  readonly channelKey: string;
  readonly casterKey: string;
  readonly spell: ProwessDefinitionRef;
  readonly policy: ProwessDefinitionRef;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly requiredAp: number;
  readonly investedAp: number;
  readonly investedThisRound: number;
  readonly concentration: { readonly required: boolean };
  readonly mpPayment: { readonly status: "UNRESOLVED"; readonly conflictKey: string };
  readonly status: "CHANNELING" | "PENDING_CONCENTRATION";
}
export interface ActiveMagicState {
  readonly contractVersion: 1;
  readonly casterKey: string;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly effects: readonly ActiveEffectState[];
  readonly channel: ChannelState | null;
}
export interface ResourceChange {
  readonly subjectKey: string;
  readonly ruleKey: string;
  readonly resourceKey: string;
  readonly operation: string;
  readonly amount: number;
  readonly before: number;
  readonly after: number;
  readonly reservedBefore: number;
  readonly reservedAfter: number;
  readonly availableMaximumBefore: number | null;
  readonly availableMaximumAfter: number | null;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly runtimeSubjectKey: string;
}
export interface RuntimeEvaluation { readonly subjectKey: string; readonly plan: EvaluationPlan; readonly contexts: { readonly actor: unknown; readonly runtime: unknown } }
export interface ConcentrationTestTrace {
  readonly trigger: string;
  readonly target: string;
  readonly consumers: number;
  readonly dc: number;
  readonly stat: string;
  readonly requestKey: string;
  readonly result: "SUCCESS" | "FAILURE" | null;
  readonly failureScope: "DISRUPTED_EFFECT" | "ALL";
  readonly core: { readonly evaluationKey: string; readonly plan: EvaluationPlan; readonly contexts: { readonly actor: unknown; readonly runtime: unknown }; readonly total: number | null } | null;
}
export interface ActiveMagicTransition {
  readonly status: "APPLIED" | "NO_ACTIVE_EFFECT" | "PENDING_INPUT" | "PENDING_MAINTENANCE_SELECTION";
  readonly event: ActiveMagicEventKind;
  readonly state: ActiveMagicState;
  readonly resources: ProwessRuntimeResources;
  readonly lifecycle: readonly { readonly subjectKey: string; readonly from: string; readonly to: string; readonly reason: string | null }[];
  readonly resourceChanges: readonly ResourceChange[];
  readonly pending: { readonly kind: "MAINTENANCE_SELECTION" | "CONCENTRATION_SAVE"; readonly options: readonly string[]; readonly requestKey: string } | null;
  readonly concentration: { readonly capacity: number; readonly used: number; readonly test: ConcentrationTestTrace | null };
  readonly ticks: readonly { readonly activeEffectKey: string; readonly timing: string; readonly targetKey: string; readonly effectKey: string; readonly kind: "ACTIVE_EFFECT_TICK_DUE" }[];
  readonly channelResult: { readonly channelKey: string; readonly spell: ProwessDefinitionRef; readonly status: "COMPLETE" | "FAILED" | "ABANDONED"; readonly requiredAp: number; readonly investedAp: number; readonly readyToResolve: boolean; readonly mpPayment: { readonly status: "UNRESOLVED"; readonly conflictKey: string } } | null;
  readonly noActiveEffectReason: "INSTANT" | "NOTHING_PERSISTS" | null;
  readonly formulaEvaluations: readonly FormulaEvaluation[];
  readonly runtimeEvaluations: readonly RuntimeEvaluation[];
  readonly inspector: ActiveMagicInspector;
}
export interface ActiveMagicInspector {
  readonly concentration: { readonly capacity: number; readonly used: number; readonly dc: number | null };
  readonly mp: { readonly reserved: number; readonly availableMaximum: number | null; readonly current: number | null };
  readonly effects: readonly {
    readonly activeEffectKey: string;
    readonly sourceSpell: ProwessDefinitionRef;
    readonly ruleset: ProwessRulesetProvenance;
    readonly duration: { readonly concept: string; readonly remainingRounds: number | null };
    readonly sustain: { readonly mpCost: number; readonly apCost: number; readonly paymentSource: { readonly ap: number; readonly me: number; readonly mp: number } | null } | null;
    readonly concentration: { readonly required: boolean };
    readonly manaLock: { readonly reservedMp: number } | null;
    readonly lifecycle: { readonly status: string; readonly endReason: string | null };
  }[];
  readonly channel: { readonly spell: ProwessDefinitionRef; readonly requiredAp: number; readonly investedAp: number; readonly remainingAp: number; readonly concentrationSlot: boolean; readonly status: string } | null;
}

const REQUEST_FIELDS = ["contractVersion", "definitions", "ruleset", "caster", "casterKey", "resources", "state", "event"];
const EVENT_FIELDS: Readonly<Record<ActiveMagicEventKind, readonly string[]>> = {
  ACTIVATE: ["kind", "activeEffectKey", "ability", "round"],
  MAINTENANCE: ["kind", "selection"],
  ROUND_END: ["kind"],
  BOUNDARY: ["kind", "boundary"],
  DISMISS: ["kind", "activeEffectKey"],
  EXTERNAL_END: ["kind", "activeEffectKey", "end", "sourceKey"],
  CONCENTRATION_TEST: ["kind", "trigger", "target", "failureScope", "roll", "sourceKey"],
  CHANNEL_START: ["kind", "channelKey", "ability"],
  CHANNEL_INVEST: ["kind", "amount"],
  CHANNEL_STOP: ["kind"],
  TIMING: ["kind", "timing", "targetKey"],
};
const REQUIRED_EVENT_FIELDS: Readonly<Record<ActiveMagicEventKind, readonly string[]>> = {
  ACTIVATE: ["kind", "activeEffectKey", "ability"], MAINTENANCE: ["kind"], ROUND_END: ["kind"], BOUNDARY: ["kind", "boundary"], DISMISS: ["kind", "activeEffectKey"],
  EXTERNAL_END: ["kind", "activeEffectKey", "end", "sourceKey"], CONCENTRATION_TEST: ["kind", "trigger", "target"], CHANNEL_START: ["kind", "channelKey", "ability"], CHANNEL_INVEST: ["kind", "amount"], CHANNEL_STOP: ["kind"], TIMING: ["kind", "timing"],
};
const isLive = (e: ActiveEffectState) => e.status !== "ENDED";
/** WO3 Resource identities (looked up, never branched on by name). */
const MP = RUNTIME_RESOURCE_KEYS[1], ME = RUNTIME_RESOURCE_KEYS[2];
const resourceOf = (res: ProwessRuntimeResources, key: RuntimeResourceKey) => res.resources.find((x) => x.resourceKey === key);
const byKey = <T,>(items: readonly T[], key: (x: T) => string) => [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** The one exact ABILITY_CONSTRUCTION_RULE of the bundle and its active-magic policy (never defaulted). */
function policyOf(bundle: ProwessDefinitionBundle, p: Problems): { ref: ProwessDefinitionRef; policy: ActiveMagicPolicy } | null {
  const rules = bundle.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  const def = rules.length === 1 ? rules[0]! : null;
  const policy = def ? (def.payload as unknown as AbilityConstructionRulePayload).activeMagicPolicy : undefined;
  if (!def || !policy) { p.add(K.MISSING_POLICY, ["definitions"], "the exact Ruleset pins no active-magic policy; lifecycle defaults are never assumed"); return null; }
  return { ref: definitionRefOf(def), policy };
}
const inBundle = (bundle: ProwessDefinitionBundle, ref: ProwessDefinitionRef) => bundle.definitions.find((d) => isSameExactDefinition(definitionRefOf(d), ref)) ?? null;

/** Validates a caller-held Active Magic state against the exact Ruleset: identity, pinning and internal consistency. */
function readState(value: unknown, bundle: ProwessDefinitionBundle, policyRef: ProwessDefinitionRef, policy: ActiveMagicPolicy, casterKey: string, p: Problems): ActiveMagicState | null {
  const before = p.count, E = K.INVALID_STATE;
  if (value === null) return { contractVersion: 1, casterKey, rulesetProvenance: bundle.rulesetProvenance, effects: [], channel: null };
  const r = readRecord(value, ["state"], p, E, ["contractVersion", "casterKey", "rulesetProvenance", "effects", "channel"], ["contractVersion", "casterKey", "rulesetProvenance", "effects", "channel"]); if (!r) return null;
  if (own(r, "contractVersion") !== 1) p.add(E, ["state", "contractVersion"], "contract version 1");
  if (own(r, "casterKey") !== casterKey) p.add(K.INVALID_STATE, ["state", "casterKey"], "the state belongs to another caster; cross-caster manipulation is refused");
  if (canonicalJsonOf(own(r, "rulesetProvenance")) !== canonicalJsonOf(bundle.rulesetProvenance)) { p.add(K.CROSS_RULESET, ["state", "rulesetProvenance"], "Active Magic state is pinned to its exact Ruleset for its whole lifetime"); return null; }
  const effects: ActiveEffectState[] = [], seen = new Set<string>();
  const raw = own(r, "effects");
  if (!Array.isArray(raw)) p.add(E, ["state", "effects"], "effects is an array");
  else raw.forEach((x, i) => { const e = readEffect(x, ["state", "effects", i], bundle, policyRef, policy, casterKey, p); if (e) { if (seen.has(e.activeEffectKey)) p.add(E, ["state", "effects", i, "activeEffectKey"], "Active Effect identities are unique"); seen.add(e.activeEffectKey); effects.push(e); } });
  const ch = own(r, "channel");
  const channel = ch === null ? null : readChannel(ch, bundle, policyRef, casterKey, p);
  return p.count > before ? null : { contractVersion: 1, casterKey, rulesetProvenance: bundle.rulesetProvenance, effects, channel };
}

function readEffect(value: unknown, at: readonly (string | number)[], bundle: ProwessDefinitionBundle, policyRef: ProwessDefinitionRef, policy: ActiveMagicPolicy, casterKey: string, p: Problems): ActiveEffectState | null {
  const before = p.count, E = K.INVALID_STATE;
  const fields = ["activeEffectKey", "casterKey", "ability", "policy", "rulesetProvenance", "executionKey", "outcomes", "duration", "sustain", "concentration", "manaLock", "ticks", "activation", "status", "endReason", "endedBy", "sourceMap"];
  const r = readRecord(value, at, p, E, fields, fields); if (!r) return null;
  if (!isExactLabel(own(r, "activeEffectKey"))) p.add(E, [...at, "activeEffectKey"], "exact Active Effect identity");
  if (own(r, "casterKey") !== casterKey) p.add(E, [...at, "casterKey"], "an Active Effect belongs to exactly its caster");
  const ability = readDefinitionRef(own(r, "ability"), [...at, "ability"], p, E), pol = readDefinitionRef(own(r, "policy"), [...at, "policy"], p, E);
  if (ability && !inBundle(bundle, ability)) p.add(K.CROSS_RULESET, [...at, "ability"], "the Active Effect's exact Ability version is not in this Ruleset");
  if (pol && !isSameExactDefinition(pol, policyRef)) p.add(K.CROSS_RULESET, [...at, "policy"], "the Active Effect is pinned to another active-magic policy version");
  if (canonicalJsonOf(own(r, "rulesetProvenance")) !== canonicalJsonOf(bundle.rulesetProvenance)) p.add(K.CROSS_RULESET, [...at, "rulesetProvenance"], "an Active Effect never changes Ruleset");
  const status = readEnum(own(r, "status"), ACTIVE_EFFECT_STATUSES, [...at, "status"], p, E, "lifecycle status");
  const endReason = own(r, "endReason") === null ? null : readEnum(own(r, "endReason"), ACTIVE_EFFECT_END_REASONS, [...at, "endReason"], p, E, "end reason");
  if (status === "ENDING") p.add(E, [...at, "status"], "ENDING is transient inside one transition; it is never a held state");
  if ((status === "ENDED") !== (endReason !== null)) p.add(E, [...at, "endReason"], "exactly an ENDED Active Effect carries an end reason");
  const d = readRecord(own(r, "duration"), [...at, "duration"], p, E, ["definition", "concept", "remainingRounds", "dismissal"], ["definition", "concept", "remainingRounds", "dismissal"]);
  let concept: ActiveMagicDuration | null = null;
  if (d) {
    const dref = readDefinitionRef(own(d, "definition"), [...at, "duration", "definition"], p, E);
    const dd = dref ? inBundle(bundle, dref) : null;
    if (dref && !dd) p.add(K.CROSS_RULESET, [...at, "duration", "definition"], "the exact Duration Definition is not in this Ruleset");
    concept = readEnum(own(d, "concept"), ACTIVE_MAGIC_DURATIONS, [...at, "duration", "concept"], p, E, "Duration concept");
    const payloadConcept = dd ? (dd.payload as { durationConcept?: unknown }).durationConcept : undefined;
    if (dd && payloadConcept !== concept) p.add(E, [...at, "duration", "concept"], "the concept is the exact Duration Definition's");
    if (concept === "INSTANT") p.add(E, [...at, "duration", "concept"], "an Instant Effect never persists as Active Effect state");
    const rr = own(d, "remainingRounds");
    if (concept === "ROUNDS" ? !(typeof rr === "number" && Number.isSafeInteger(rr) && (rr >= 1 || (rr === 0 && status === "ENDED"))) : rr !== null) p.add(E, [...at, "duration", "remainingRounds"], "only ROUNDS keeps an exact remaining-round count");
    if (concept && own(d, "dismissal") !== policy.dismissal[concept]) p.add(E, [...at, "duration", "dismissal"], "dismissal is the pinned policy rule for the Duration");
    const fr = dd ? (dd.payload as { rules?: { duration?: { futureRuntime?: { sustain: boolean; manaLock: boolean; concentration: string } } } }).rules?.duration?.futureRuntime : undefined;
    if (fr) {
      const s = own(r, "sustain"), c = own(r, "concentration"), m = own(r, "manaLock");
      if ((s !== null) !== fr.sustain) p.add(E, [...at, "sustain"], "Sustain exists exactly for a Sustained Duration");
      if ((m !== null) !== fr.manaLock) p.add(E, [...at, "manaLock"], "a Mana Lock exists exactly for a Mana Lock Duration");
      if (!isPlainObject(c) || own(c, "required") !== (fr.concentration === "WO13")) p.add(E, [...at, "concentration"], "Concentration is required exactly where the Duration Definition says so");
    }
  }
  const s = own(r, "sustain");
  if (s !== null) {
    const sr = readRecord(s, [...at, "sustain"], p, E, ["finalSpellMp", "pro", "mpCost", "apCost", "meEligible", "lastPayment"], ["finalSpellMp", "pro", "mpCost", "apCost", "meEligible", "lastPayment"]);
    if (sr) {
      for (const k of ["finalSpellMp", "pro", "mpCost", "apCost"]) { const v = own(sr, k); if (!(typeof v === "number" && Number.isSafeInteger(v) && v >= (k === "finalSpellMp" ? 0 : 1))) p.add(E, [...at, "sustain", k], "a non-negative exact integer"); }
      if (own(sr, "apCost") !== policy.sustainApPerRound) p.add(E, [...at, "sustain", "apCost"], "Sustain AP is the pinned policy value; an arbitrary amount is refused");
      if (own(sr, "meEligible") !== policy.sustainMeEligible) p.add(E, [...at, "sustain", "meEligible"], "ME eligibility is the pinned policy value");
    }
  }
  const m = own(r, "manaLock");
  if (m !== null) {
    const mr = readRecord(m, [...at, "manaLock"], p, E, ["reservedMp", "rule"], ["reservedMp", "rule"]);
    const rule = policy.manaLock.amount;
    if (mr && (!rule || own(mr, "rule") !== rule.kind)) p.add(K.UNRESOLVED_RUNTIME_RULE, [...at, "manaLock"], `no exact Mana Lock amount rule pins this reservation (${policy.manaLock.conflictKey})`);
    if (mr && rule?.kind === "FIXED" && own(mr, "reservedMp") !== rule.amount) p.add(E, [...at, "manaLock", "reservedMp"], "an arbitrary lock amount is refused");
    if (mr && !(typeof own(mr, "reservedMp") === "number" && Number.isSafeInteger(own(mr, "reservedMp")) && (own(mr, "reservedMp") as number) >= 1)) p.add(E, [...at, "manaLock", "reservedMp"], "a positive exact reservation");
  }
  if (!Array.isArray(own(r, "outcomes")) || !Array.isArray(own(r, "ticks")) || !Array.isArray(own(r, "sourceMap"))) p.add(E, at, "outcomes, ticks and sourceMap are arrays");
  if (!isPlainObject(own(r, "activation"))) p.add(E, [...at, "activation"], "activation boundary");
  if (p.count > before) return null;
  return clonePlainData(r) as unknown as ActiveEffectState;
}

function readChannel(value: unknown, bundle: ProwessDefinitionBundle, policyRef: ProwessDefinitionRef, casterKey: string, p: Problems): ChannelState | null {
  const before = p.count, E = K.INVALID_STATE, at = ["state", "channel"];
  const fields = ["channelKey", "casterKey", "spell", "policy", "rulesetProvenance", "requiredAp", "investedAp", "investedThisRound", "concentration", "mpPayment", "status"];
  const r = readRecord(value, at, p, E, fields, fields); if (!r) return null;
  if (!isExactLabel(own(r, "channelKey"))) p.add(E, [...at, "channelKey"], "exact Channel identity");
  if (own(r, "casterKey") !== casterKey) p.add(E, [...at, "casterKey"], "a Channel belongs to exactly its caster");
  const spell = readDefinitionRef(own(r, "spell"), [...at, "spell"], p, E), pol = readDefinitionRef(own(r, "policy"), [...at, "policy"], p, E);
  if (spell && !inBundle(bundle, spell)) p.add(K.CROSS_RULESET, [...at, "spell"], "the Channeled Spell's exact version is not in this Ruleset");
  if (pol && !isSameExactDefinition(pol, policyRef)) p.add(K.CROSS_RULESET, [...at, "policy"], "the Channel is pinned to another policy version");
  if (canonicalJsonOf(own(r, "rulesetProvenance")) !== canonicalJsonOf(bundle.rulesetProvenance)) p.add(K.CROSS_RULESET, [...at, "rulesetProvenance"], "a Channel never changes Ruleset");
  const req = own(r, "requiredAp"), inv = own(r, "investedAp"), round = own(r, "investedThisRound");
  if (!(typeof req === "number" && Number.isSafeInteger(req) && req >= 1)) p.add(E, [...at, "requiredAp"], "the exact Final Spell AP");
  if (!(typeof inv === "number" && Number.isSafeInteger(inv) && inv >= 0 && typeof req === "number" && inv < req)) p.add(E, [...at, "investedAp"], "invested AP below the requirement (a completed Channel is no longer held)");
  if (!(typeof round === "number" && Number.isSafeInteger(round) && round >= 0 && typeof inv === "number" && round <= inv)) p.add(E, [...at, "investedThisRound"], "this round's investment is part of the invested total");
  readEnum(own(r, "status"), ["CHANNELING", "PENDING_CONCENTRATION"] as const, [...at, "status"], p, E, "Channel status");
  return p.count > before ? null : (clonePlainData(r) as unknown as ChannelState);
}

/** Pure transition of the caster's active magic by ONE lifecycle event. */
export function transitionActiveMagic(request: unknown): ProwessOutcome<ActiveMagicTransition> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, K.INVALID_REQUEST)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, K.INVALID_REQUEST, REQUEST_FIELDS, REQUEST_FIELDS); if (!r) return finish(p, () => null as never);
  if (own(r, "contractVersion") !== 1) p.add(K.INVALID_REQUEST, ["contractVersion"], "contract version 1");
  const casterKey = own(r, "casterKey");
  if (!isExactLabel(casterKey)) p.add(K.INVALID_REQUEST, ["casterKey"], "exact caster identity");
  const context = createRulesetContext(own(r, "ruleset"));
  const defs = own(r, "definitions");
  const bundleOut = context.ok && isPlainObject(defs) ? createProwessDefinitionBundle({ ruleset: context.value, definitions: own(defs, "definitions") }) : null;
  if (!bundleOut?.ok) { p.add(K.INVALID_REQUEST, ["definitions"], "the exact Ruleset bundle is required"); return finish(p, () => null as never); }
  if (p.count > 0) return finish(p, () => null as never);
  const bundle = bundleOut.value, ruleset = context.ok ? context.value : null!;
  const pol = policyOf(bundle, p); if (!pol) return finish(p, () => null as never);
  const { policy } = pol;
  const caster = own(r, "caster");
  const casterStats = isPlainObject(caster) && isPlainObject(own(caster, "stats")) ? (own(caster, "stats") as Record<string, unknown>) : null;
  const contexts0 = buildRuntimeContexts({ definitions: bundle, character: caster, resources: own(r, "resources") });
  if (!contexts0.ok) { for (const q of contexts0.problems) p.add(K.INVALID_REQUEST, ["resources", q.path], q.message); return finish(p, () => null as never); }
  const state0 = readState(own(r, "state"), bundle, pol.ref, policy, casterKey as string, p); if (!state0) return finish(p, () => null as never);
  const ev = own(r, "event");
  const kind = isPlainObject(ev) ? readEnum(own(ev, "kind"), ACTIVE_MAGIC_EVENT_KINDS, ["event", "kind"], p, K.INVALID_EVENT, "lifecycle event") : null;
  if (!isPlainObject(ev) || !kind) { if (!isPlainObject(ev)) p.add(K.INVALID_EVENT, ["event"], "one structured lifecycle event"); return finish(p, () => null as never); }
  const e = readRecord(ev, ["event"], p, K.INVALID_EVENT, EVENT_FIELDS[kind], REQUIRED_EVENT_FIELDS[kind]); if (!e) return finish(p, () => null as never);

  // ---- working copies; every change is staged and adopted only when the whole event is legal (atomicity) -------------
  let resources: ProwessRuntimeResources = contexts0.value.resources;
  let effects: ActiveEffectState[] = state0.effects.map((x) => clonePlainData(x));
  let channel: ChannelState | null = state0.channel ? clonePlainData(state0.channel) : null;
  const lifecycle: { subjectKey: string; from: string; to: string; reason: string | null }[] = [];
  const resourceChanges: ResourceChange[] = [];
  const formulaEvaluations: FormulaEvaluation[] = [];
  const runtimeEvaluations: RuntimeEvaluation[] = [];
  const ticks: ActiveMagicTransition["ticks"][number][] = [];
  let pending: ActiveMagicTransition["pending"] = null, test: ConcentrationTestTrace | null = null, channelResult: ActiveMagicTransition["channelResult"] = null;
  let status: ActiveMagicTransition["status"] = "APPLIED", noActiveEffectReason: ActiveMagicTransition["noActiveEffectReason"] = null;
  const pendingNow = effects.filter((x) => x.status === "PENDING_MAINTENANCE" || x.status === "PENDING_CONCENTRATION").map((x) => x.status);
  if (pendingNow.includes("PENDING_MAINTENANCE") && kind !== "MAINTENANCE") p.add(K.PENDING_DECISION, ["event"], "a maintenance selection is pending; only MAINTENANCE resolves it");
  if ((pendingNow.includes("PENDING_CONCENTRATION") || channel?.status === "PENDING_CONCENTRATION") && kind !== "CONCENTRATION_TEST") p.add(K.PENDING_DECISION, ["event"], "a Concentration Save is pending; only CONCENTRATION_TEST resolves it");
  if (p.count > 0) return finish(p, () => null as never);

  /** One M4 FORMULA, executed by M4 — the only place a Sustain / capacity / DC number is produced. */
  const formula = (role: string, program: { expression: string }, variables: Record<string, number>): number | null => {
    const stepKey = `wo13.${role}.${String(formulaEvaluations.length)}`;
    const plan: EvaluationPlan = { steps: [{ stepKey, order: 0, operation: "FORMULA", input: { program: { expression: program.expression, rounding: "NONE" }, variables } as unknown as JsonObject, bindings: [] }], primaryStepKey: stepKey, validationStepKey: null, explanationStepKey: null };
    const out = orchestrateRulesEvaluation({ evaluationKey: stepKey, contexts: { ruleset }, plan });
    const v = out.success && out.data ? (out.data.steps[0]?.response?.data as { finalValue?: unknown } | undefined)?.finalValue : undefined;
    if (typeof v !== "number" || !Number.isSafeInteger(v)) { p.add(K.INVALID_INPUT, [role], "the M4 Formula did not produce an exact integer"); return null; }
    formulaEvaluations.push({ stepKey, role, plan, value: v });
    return v;
  };
  /** One WO3 runtime plan on the staged Resources, executed by M4 and read back by WO3. */
  const runtime = (subject: Record<string, unknown>) => {
    const req = { contractVersion: 1, subject, definitions: bundle, ruleset, character: caster, resources };
    const plan = compileRuntime(req);
    if (!plan.ok) { for (const q of plan.problems) p.add(K.INVALID_INPUT, ["runtime", String(subject.subjectKey), q.path], `${q.code}: ${q.message}`); return null; }
    const ctx = buildRuntimeContexts({ definitions: bundle, character: caster, resources });
    if (!ctx.ok) { p.add(K.INVALID_INPUT, ["runtime"], "runtime contexts"); return null; }
    const out = orchestrateRulesEvaluation({ evaluationKey: String(subject.subjectKey), contexts: { ruleset, actor: ctx.value.actor, runtime: ctx.value.runtime }, plan: plan.value.evaluationPlan });
    if (!out.success || !out.data) { p.add(K.INVALID_INPUT, ["runtime", String(subject.subjectKey)], "M4 could not evaluate the WO3 plan"); return null; }
    const reading = readRuntimeRun({ plan: plan.value, run: out.data, resources: ctx.value.resources });
    if (!reading.ok) { for (const q of reading.problems) p.add(K.INVALID_INPUT, ["runtime", String(subject.subjectKey), q.path], `${q.code}: ${q.message}`); return null; }
    runtimeEvaluations.push({ subjectKey: String(subject.subjectKey), plan: plan.value.evaluationPlan, contexts: { actor: ctx.value.actor, runtime: ctx.value.runtime } });
    return reading.value;
  };
  const current = (res: ProwessRuntimeResources, key: RuntimeResourceKey) => resourceOf(res, key)?.current ?? null;
  /** Spend AP for an exact subject through WO3; false (and nothing staged) when it cannot be applied. */
  const spendAp = (subjectKey: string, ruleKey: string, amount: number, sourceKey: string): boolean => {
    const reading = runtime({ kind: "RESOURCE_TRANSITIONS", subjectKey: `wo13.${subjectKey}.${ruleKey}`, transitions: [{ resourceKey: "AP", operation: "SPEND", amount, sourceKey }] });
    const t = reading?.transitions[0];
    if (!reading || !t || !t.applied) return false;
    resourceChanges.push({ subjectKey, ruleKey, resourceKey: "AP", operation: "SPEND", amount, before: t.currentBefore, after: t.currentAfter, reservedBefore: t.reservedBefore, reservedAfter: t.reservedAfter, availableMaximumBefore: t.availableMaximumBefore, availableMaximumAfter: t.availableMaximumAfter, rulesetProvenance: bundle.rulesetProvenance, runtimeSubjectKey: `wo13.${subjectKey}.${ruleKey}` });
    resources = reading.resources;
    return true;
  };
  /** Mana payment through WO3's ME-first MAGICAL_PAYMENT; the listed cost is never reduced by ME. */
  const payMana = (subjectKey: string, ruleKey: string, listedAmount: number, meEligible: boolean, sourceKey: string): { me: number; mp: number } | null => {
    const reading = runtime({ kind: "MAGICAL_PAYMENT", subjectKey: `wo13.${subjectKey}.${ruleKey}`, costKey: ruleKey, listedAmount, meEligible, sourceKey });
    const pay = reading?.payments[0];
    if (!reading || !pay || !pay.canPay) return null;
    const byResource = new Map<string, number>(pay.allocations.map((a) => [a.resourceKey, a.amountPaid]));
    const paid = { me: byResource.get(ME) ?? 0, mp: byResource.get(MP) ?? 0 };
    for (const a of pay.allocations) {
      if (a.amountPaid > 0) resourceChanges.push({ subjectKey, ruleKey, resourceKey: a.resourceKey, operation: "PAYMENT", amount: a.amountPaid, before: a.currentBefore, after: a.currentAfter, reservedBefore: 0, reservedAfter: 0, availableMaximumBefore: null, availableMaximumAfter: null, rulesetProvenance: bundle.rulesetProvenance, runtimeSubjectKey: `wo13.${subjectKey}.${ruleKey}` });
    }
    resources = reading.resources;
    return paid;
  };
  /** Reserve / release Maximum MP capacity through WO3 (current MP is never touched). */
  const capacity = (subjectKey: string, operation: "RESERVE_CAPACITY" | "RELEASE_CAPACITY", amount: number, sourceKey: string): boolean => {
    const reading = runtime({ kind: "RESOURCE_TRANSITIONS", subjectKey: `wo13.${subjectKey}.mana_lock.${operation.toLowerCase()}`, transitions: [{ resourceKey: "MP", operation, amount, sourceKey }] });
    const t = reading?.transitions[0];
    if (!reading || !t || !t.applied) { if (reading) p.add(K.INSUFFICIENT_RESOURCES, ["manaLock", subjectKey], "the Mana Lock reservation cannot be applied to Maximum MP"); return false; }
    resourceChanges.push({ subjectKey, ruleKey: `mana_lock.${operation.toLowerCase()}`, resourceKey: "MP", operation, amount, before: t.currentBefore, after: t.currentAfter, reservedBefore: t.reservedBefore, reservedAfter: t.reservedAfter, availableMaximumBefore: t.availableMaximumBefore, availableMaximumAfter: t.availableMaximumAfter, rulesetProvenance: bundle.rulesetProvenance, runtimeSubjectKey: `wo13.${subjectKey}.mana_lock.${operation.toLowerCase()}` });
    resources = reading.resources;
    return true;
  };
  const res = typeof casterStats?.RES === "number" ? casterStats.RES : null;
  if (res === null || !Number.isSafeInteger(res) || res < 0) { p.add(K.INVALID_REQUEST, ["caster", "stats", "RES"], "Concentration capacity needs the caster's exact Resolve"); return finish(p, () => null as never); }
  const slots = formula("concentration_slots", policy.formulas.concentrationSlots, { res }); if (slots === null) return finish(p, () => null as never);
  const consumers = () => effects.filter((x) => isLive(x) && x.concentration.required).length + (channel?.concentration.required ? 1 : 0);
  const lockedTotal = () => effects.filter((x) => isLive(x) && x.manaLock).reduce((acc, x) => acc + x.manaLock!.reservedMp, 0);
  const mpState0 = resourceOf(resources, MP);
  if (lockedTotal() > (mpState0?.reservedCapacity ?? 0)) { p.add(K.INVALID_STATE, ["resources", "MP", "reservedCapacity"], "the Resource state does not hold the Active Effects' Mana Locks"); return finish(p, () => null as never); }
  // A held Sustain cost is re-executed by M4 from its pinned Final Spell MP and PRO: an arbitrary amount is refused.
  for (const x of effects.filter((y) => isLive(y) && y.sustain)) {
    const v = formula("sustain_mp.verify", policy.formulas.sustainMp, { final_mp: x.sustain!.finalSpellMp, pro: x.sustain!.pro });
    if (v !== x.sustain!.mpCost) p.add(K.INVALID_STATE, ["state", "effects", x.activeEffectKey, "sustain", "mpCost"], "the Sustain MP is not the pinned Formula's result; an arbitrary amount is refused");
  }
  if (p.count > 0) return finish(p, () => null as never);
  if (consumers() > slots) { p.add(K.CONCENTRATION_CAPACITY, ["state"], "the state holds more Concentration consumers than the caster's slots"); return finish(p, () => null as never); }

  /** Ends ONE exact Active Effect: releases exactly its own Concentration slot and Mana Lock; stops its Sustain and ticks. */
  const end = (key: string, reason: ActiveEffectEndReason, sourceKey: string | null): boolean => {
    const i = effects.findIndex((x) => x.activeEffectKey === key);
    const x = effects[i]!;
    lifecycle.push({ subjectKey: key, from: x.status, to: "ENDING", reason });
    if (x.manaLock && !capacity(key, "RELEASE_CAPACITY", x.manaLock.reservedMp, x.ability.canonicalKey)) return false;
    effects[i] = { ...x, status: "ENDED", endReason: reason, endedBy: { event: kind, sourceKey } };
    lifecycle.push({ subjectKey: key, from: "ENDING", to: "ENDED", reason });
    return true;
  };
  const live = (key: unknown, at: string) => {
    const x = effects.find((y) => y.activeEffectKey === key);
    if (!x) { p.add(K.INVALID_EVENT, ["event", at], "no Active Effect of this caster has this exact identity"); return null; }
    if (!isLive(x)) { p.add(K.INVALID_EVENT, ["event", at], "the Active Effect has already ENDED"); return null; }
    return x;
  };
  const authoredRequest = (value: unknown, at: string): Record<string, unknown> | null => {
    if (!isPlainObject(value) || own(value, "definitions") !== undefined || own(value, "ruleset") !== undefined) { p.add(K.INVALID_EVENT, ["event", at], "the authored-Ability request without definitions / ruleset (the transition's exact Ruleset is used)"); return null; }
    return { ...value, definitions: own(r, "definitions"), ruleset: own(r, "ruleset") };
  };
  /** WO10's authoritative cost for an exact Spell (never recalculated here). */
  const spellCost = (ability: Record<string, unknown>, at: string) => {
    const costRequest = Object.fromEntries(Object.entries(ability).filter(([k]) => k !== "execution"));
    const cost = evaluateSpellCost(costRequest);
    if (!cost.ok) {
      if (cost.problems.some((q) => q.code === "PROWESS_SPELL_COST.SPELL_ONLY")) p.add(K.SPELL_ONLY, ["event", at], "WO13 governs active magic: Spells only");
      else for (const q of cost.problems) p.add(K.INVALID_ABILITY, ["event", at, q.path], `${q.code}: ${q.message}`);
      return null;
    }
    if (!cost.value.valid) { p.add(K.INVALID_ABILITY, ["event", at], "an INVALID authored Spell never becomes active magic"); return null; }
    if (casterStats?.PRO !== cost.value.ap.pro) { p.add(K.INVALID_INPUT, ["caster", "stats", "PRO"], "the caster's Prowess must be the PRO the Spell cost was derived from"); return null; }
    return cost.value;
  };

  switch (kind) {
    case "ACTIVATE": {
      const key = own(e, "activeEffectKey"), round = own(e, "round") ?? null;
      if (!isExactLabel(key) || effects.some((x) => x.activeEffectKey === key)) { p.add(K.INVALID_EVENT, ["event", "activeEffectKey"], "a new, unique Active Effect identity"); break; }
      if (round !== null && !(typeof round === "number" && Number.isSafeInteger(round) && round >= 1)) { p.add(K.INVALID_EVENT, ["event", "round"], "rounds are numbered from 1"); break; }
      const ability = authoredRequest(own(e, "ability"), "ability"); if (!ability) break;
      const cost = spellCost(ability, "ability"); if (!cost) break;
      const dur = cost.authored.durationConditions?.duration;
      if (!dur) { p.add(K.INVALID_ABILITY, ["event", "ability"], "the Spell's exact WO9 Duration is required"); break; }
      if (dur.mode === "INSTANT" || !dur.futureRuntime.persists) { status = "NO_ACTIVE_EFFECT"; noActiveEffectReason = "INSTANT"; break; }
      if (dur.mode === "PERMANENT_BY_SPECIAL_RULE") { p.add(K.UNRESOLVED_RUNTIME_RULE, ["event", "ability"], "Permanent needs an exact special rule (M5-SC-045)"); break; }
      const ex = executeAbilityResolution(ability);
      if (!ex.ok) { for (const q of ex.problems) p.add(K.INVALID_ABILITY, ["event", "ability", q.path], `${q.code}: ${q.message}`); break; }
      if (ex.value.status !== "COMPLETE") { p.add(K.INVALID_INPUT, ["event", "ability", "execution"], "activation consumes a COMPLETE WO12 resolution; supply its runtime inputs first"); break; }
      if (!isSameExactDefinition(ex.value.definition, cost.definition)) { p.add(K.INVALID_ABILITY, ["event", "ability"], "WO10 and WO12 must describe the same exact Spell"); break; }
      // Only emitted outcomes with authored operations other than NO_EFFECT persist; a Duration Keyword alone never does.
      const outcomes = ex.value.outcomes.filter((o) => o.operations.some((op) => op.kind !== "NO_EFFECT"));
      if (!outcomes.length) { status = "NO_ACTIVE_EFFECT"; noActiveEffectReason = "NOTHING_PERSISTS"; break; }
      const concept = dur.mode as ActiveMagicDuration;
      const requiresConcentration = dur.futureRuntime.concentration === "WO13";
      if (requiresConcentration && consumers() >= slots) { p.add(K.CONCENTRATION_CAPACITY, ["event"], `all ${String(slots)} Concentration slots are in use; end or release one explicitly first (no effect is terminated automatically)`); break; }
      let remainingRounds: number | null = null;
      if (concept === "ROUNDS") {
        const rounds = dur.parameters.rounds;
        if (!(typeof rounds === "number" && Number.isSafeInteger(rounds) && rounds >= 1)) { p.add(K.INVALID_ABILITY, ["event", "ability"], "a ROUNDS Duration needs its exact positive round count"); break; }
        remainingRounds = rounds;
      }
      const pinned: FormulaEvaluation[] = [];
      let sustain: ActiveEffectState["sustain"] = null;
      if (dur.futureRuntime.sustain) {
        const mpCost = formula("sustain_mp", policy.formulas.sustainMp, { final_mp: cost.finalMpCost, pro: cost.ap.pro }); if (mpCost === null) break;
        pinned.push(formulaEvaluations[formulaEvaluations.length - 1]!);
        sustain = { finalSpellMp: cost.finalMpCost, pro: cost.ap.pro, mpCost, apCost: policy.sustainApPerRound, meEligible: policy.sustainMeEligible, lastPayment: null };
      }
      let manaLock: ActiveEffectState["manaLock"] = null;
      if (dur.futureRuntime.manaLock) {
        const rule = policy.manaLock.amount;
        if (!rule) { p.add(K.UNRESOLVED_RUNTIME_RULE, ["event", "ability"], `the generic Mana Lock reservation amount has no exact structured formula (${policy.manaLock.conflictKey})`); break; }
        const amount = rule.kind === "FIXED" ? rule.amount : cost.finalMpCost;
        if (!capacity(key, "RESERVE_CAPACITY", amount, cost.definition.canonicalKey)) break;
        manaLock = { reservedMp: amount, rule: rule.kind };
      }
      const tickTimings = new Set<string>(ACTIVE_EFFECT_TICK_TIMINGS);
      const effectTicks = outcomes.flatMap((o) => o.operations.flatMap((op) => { const t = isPlainObject(op.data) ? own(op.data as Record<string, unknown>, "timing") : undefined; return typeof t === "string" && tickTimings.has(t) ? [{ timing: t, targetKey: o.targetKey, effectKey: o.effectKey }] : []; }));
      const effect: ActiveEffectState = {
        activeEffectKey: key, casterKey: casterKey as string, ability: cost.definition, policy: pol.ref, rulesetProvenance: bundle.rulesetProvenance, executionKey: ex.value.executionKey,
        outcomes: outcomes.map((o) => ({ targetKey: o.targetKey, effectKey: o.effectKey, outcomeKey: o.outcomeKey, definition: o.definition })),
        duration: { definition: dur.definition, concept, remainingRounds, dismissal: policy.dismissal[concept] },
        sustain, concentration: { required: requiresConcentration }, manaLock, ticks: effectTicks, activation: { round: round as number | null },
        status: "ACTIVE", endReason: null, endedBy: null, sourceMap: pinned,
      };
      effects = [...effects, effect];
      lifecycle.push({ subjectKey: key, from: "NONE", to: "ACTIVE", reason: null });
      break;
    }
    case "MAINTENANCE": {
      // Each Sustained Effect pays its OWN upkeep (AP, then ME-first mana) atomically; the engine never chooses survivors.
      const due = byKey(effects.filter((x) => isLive(x) && x.sustain), (x) => x.activeEffectKey);
      if (!due.length) break;
      const selection = own(e, "selection");
      /** Pays the upkeep of `order` in order, all-or-nothing; returns each payment, or null with nothing staged. */
      const pay = (order: readonly ActiveEffectState[]) => {
        const start = resources, changes = resourceChanges.length, evals = runtimeEvaluations.length;
        const paid = new Map<string, { ap: number; me: number; mp: number }>();
        for (const x of order) {
          const ap = spendAp(x.activeEffectKey, "sustain.ap", x.sustain!.apCost, x.ability.canonicalKey);
          const mana = ap ? payMana(x.activeEffectKey, "sustain.mp", x.sustain!.mpCost, x.sustain!.meEligible, x.ability.canonicalKey) : null;
          if (!mana) { resources = start; resourceChanges.length = changes; runtimeEvaluations.length = evals; return null; }
          paid.set(x.activeEffectKey, { ap: x.sustain!.apCost, me: mana.me, mp: mana.mp });
        }
        return paid;
      };
      const adopt = (paid: ReadonlyMap<string, { ap: number; me: number; mp: number }>) => {
        effects = effects.map((y) => (paid.has(y.activeEffectKey) ? { ...y, status: "ACTIVE", sustain: { ...y.sustain!, lastPayment: paid.get(y.activeEffectKey)! } } : y));
      };
      if (selection === undefined) {
        const all = pay(due);
        if (all) { adopt(all); break; }
        // Not every upkeep can be paid. None affordable, or only one due → each unpaid Effect ends; otherwise the
        // controller must choose (never oldest / newest / cheapest / first-in-array).
        const affordable: ActiveEffectState[] = [];
        for (const x of due) {
          if (pay([x])) affordable.push(x);
          resources = contexts0.value.resources; resourceChanges.length = 0; runtimeEvaluations.length = 0; // probes stage nothing
        }
        if (!affordable.length || due.length === 1) { for (const x of due) end(x.activeEffectKey, "SUSTAIN_UNPAID", "sustain.unpaid"); break; }
        status = "PENDING_MAINTENANCE_SELECTION";
        pending = { kind: "MAINTENANCE_SELECTION", options: due.map((x) => x.activeEffectKey), requestKey: `wo13.${casterKey as string}.maintenance` };
        effects = effects.map((y) => (due.some((d) => d.activeEffectKey === y.activeEffectKey) ? { ...y, status: "PENDING_MAINTENANCE" } : y));
        for (const x of due) lifecycle.push({ subjectKey: x.activeEffectKey, from: x.status, to: "PENDING_MAINTENANCE", reason: "sustain.selection_required" });
        break;
      }
      if (!Array.isArray(selection) || !selection.every((k) => due.some((x) => x.activeEffectKey === k)) || new Set(selection).size !== selection.length) { p.add(K.INVALID_SELECTION, ["event", "selection"], "an ordered list of distinct Sustained Active Effect identities of this caster"); break; }
      const chosen = pay(selection.map((k) => due.find((x) => x.activeEffectKey === k)!));
      if (!chosen) { p.add(K.INVALID_SELECTION, ["event", "selection"], "the selected upkeep cannot all be paid in this order; nothing was paid"); break; }
      adopt(chosen);
      for (const x of due) if (!selection.includes(x.activeEffectKey)) end(x.activeEffectKey, "SUSTAIN_UNPAID", "sustain.not_selected");
      break;
    }
    case "ROUND_END": {
      for (const x of byKey(effects.filter((y) => isLive(y) && y.duration.concept === "ROUNDS"), (y) => y.activeEffectKey)) {
        const remaining = x.duration.remainingRounds! - 1;
        effects = effects.map((y) => (y.activeEffectKey === x.activeEffectKey ? { ...y, duration: { ...y.duration, remainingRounds: remaining } } : y));
        if (remaining === 0) end(x.activeEffectKey, "EXPIRED", "duration.rounds");
      }
      if (channel) {
        if (channel.investedThisRound < policy.channel.minimumApPerRound) {
          channelResult = { channelKey: channel.channelKey, spell: channel.spell, status: "ABANDONED", requiredAp: channel.requiredAp, investedAp: 0, readyToResolve: false, mpPayment: channel.mpPayment };
          lifecycle.push({ subjectKey: channel.channelKey, from: "CHANNELING", to: "ABANDONED", reason: "channel.minimum_ap_per_round" });
          channel = null;
        } else channel = { ...channel, investedThisRound: 0 };
      }
      break;
    }
    case "BOUNDARY": {
      const b = readEnum(own(e, "boundary"), Object.keys(ACTIVE_MAGIC_BOUNDARIES) as (keyof typeof ACTIVE_MAGIC_BOUNDARIES)[], ["event", "boundary"], p, K.INVALID_EVENT, "explicit lifecycle boundary"); if (!b) break;
      for (const x of byKey(effects.filter((y) => isLive(y) && y.duration.concept === ACTIVE_MAGIC_BOUNDARIES[b]), (y) => y.activeEffectKey)) end(x.activeEffectKey, BOUNDARY_REASON[b], `boundary.${b.toLowerCase()}`);
      break;
    }
    case "DISMISS": {
      const x = live(own(e, "activeEffectKey"), "activeEffectKey"); if (!x) break;
      if (x.duration.dismissal !== "FREE_ACTION") { p.add(K.NOT_DISMISSIBLE, ["event", "activeEffectKey"], `${x.duration.concept} Active Effects are not dismissible early without an exact rule`); break; }
      end(x.activeEffectKey, "DISMISSED", "dismissal.free_action");
      break;
    }
    case "EXTERNAL_END": {
      const x = live(own(e, "activeEffectKey"), "activeEffectKey"); if (!x) break;
      const reason = readEnum(own(e, "end"), Object.keys(ACTIVE_MAGIC_EXTERNAL_ENDS) as (keyof typeof ACTIVE_MAGIC_EXTERNAL_ENDS)[], ["event", "end"], p, K.INVALID_EVENT, "external end event");
      if (!isExactLabel(own(e, "sourceKey"))) p.add(K.INVALID_EVENT, ["event", "sourceKey"], "the exact external rule / event identity");
      if (!reason || p.count > 0) break;
      end(x.activeEffectKey, ACTIVE_MAGIC_EXTERNAL_ENDS[reason], own(e, "sourceKey") as string);
      break;
    }
    case "CONCENTRATION_TEST": {
      const trigger = readEnum(own(e, "trigger"), CONCENTRATION_TRIGGERS, ["event", "trigger"], p, K.INVALID_EVENT, "structured Concentration trigger");
      const scope = own(e, "failureScope") === undefined ? "DISRUPTED_EFFECT" : readEnum(own(e, "failureScope"), ["DISRUPTED_EFFECT", "ALL"] as const, ["event", "failureScope"], p, K.INVALID_EVENT, "failure scope");
      const target = own(e, "target");
      const isChannel = target === "CHANNEL";
      const disrupted = isChannel ? null : live(target, "target");
      if (isChannel && !channel) p.add(K.INVALID_EVENT, ["event", "target"], "no Channel is active");
      if (disrupted && !disrupted.concentration.required) p.add(K.INVALID_EVENT, ["event", "target"], "the Active Effect does not use Concentration");
      if (!trigger || !scope || p.count > 0 || (!isChannel && !disrupted)) break;
      // The disrupted consumer is still counted: the DC uses every consumer active when the test is required.
      const n = consumers();
      const dc = formula("concentration_dc", policy.formulas.concentrationDc, { consumers: n }); if (dc === null) break;
      const requestKey = `wo13.${casterKey as string}.concentration.${isChannel ? "channel" : String(target)}`;
      const roll = own(e, "roll");
      test = { trigger, target: isChannel ? "CHANNEL" : String(target), consumers: n, dc, stat: policy.concentrationSaveStat, requestKey, result: null, failureScope: scope, core: null };
      if (roll === undefined) {
        status = "PENDING_INPUT";
        pending = { kind: "CONCENTRATION_SAVE", options: [policy.concentrationSaveStat], requestKey };
        if (isChannel) channel = { ...channel!, status: "PENDING_CONCENTRATION" };
        else effects = effects.map((y) => (y.activeEffectKey === target ? { ...y, status: "PENDING_CONCENTRATION" } : y));
        lifecycle.push({ subjectKey: test.target, from: isChannel ? "CHANNELING" : disrupted!.status, to: "PENDING_CONCENTRATION", reason: trigger });
        break;
      }
      // WO2's Prowess Saving Throw — never a caller's success boolean, never a separate Concentration die system.
      const subject = { kind: "CORE_RESOLUTION", subjectKey: requestKey, procedure: "SAVING_THROW", mode: isPlainObject(roll) ? own(roll, "mode") : undefined, stat: policy.concentrationSaveStat };
      const compiled = compileCoreResolution({ contractVersion: 1, subject, definitions: bundle, ruleset, character: caster });
      if (!compiled.ok) { for (const q of compiled.problems) p.add(K.INVALID_INPUT, ["event", "roll", q.path], q.message); break; }
      const cx = buildCoreResolutionContexts({ definitions: bundle, character: caster, plan: compiled.value, roll, difficultyClass: dc });
      if (!cx.ok) { for (const q of cx.problems) p.add(K.INVALID_INPUT, ["event", "roll", q.path], q.message); break; }
      const out = orchestrateRulesEvaluation({ evaluationKey: `${requestKey}.core`, contexts: { ruleset, actor: cx.value.actor, runtime: cx.value.runtime }, plan: compiled.value.evaluationPlan });
      const value = (stepKey: string | null): unknown => { if (stepKey === null || !out.success || !out.data) return null; const d = out.data.steps.find((s) => s.stepKey === stepKey)?.response?.data as Record<string, unknown> | undefined; return d === undefined ? null : "finalValue" in d ? d.finalValue : "satisfied" in d ? d.satisfied : null; };
      const success = value(compiled.value.outputs.success), total = value(compiled.value.outputs.total);
      if (typeof success !== "boolean") { p.add(K.INVALID_INPUT, ["event", "roll"], "the WO2 Prowess Save did not resolve"); break; }
      test = { ...test, result: success ? "SUCCESS" : "FAILURE", core: { evaluationKey: `${requestKey}.core`, plan: compiled.value.evaluationPlan, contexts: { actor: cx.value.actor, runtime: cx.value.runtime }, total: typeof total === "number" ? total : null } };
      if (success) {
        // Nothing is refunded and nothing is granted; a pending consumer simply returns to its held state.
        if (isChannel) channel = { ...channel!, status: "CHANNELING" };
        else effects = effects.map((y) => (y.activeEffectKey === target ? { ...y, status: "ACTIVE" } : y));
        break;
      }
      const failChannel = () => {
        channelResult = { channelKey: channel!.channelKey, spell: channel!.spell, status: "FAILED", requiredAp: channel!.requiredAp, investedAp: 0, readyToResolve: false, mpPayment: channel!.mpPayment };
        lifecycle.push({ subjectKey: channel!.channelKey, from: channel!.status, to: "FAILED", reason: "CONCENTRATION_FAILED" });
        channel = null; // the Spell fails; every invested AP is lost; a new attempt starts from 0
      };
      if (scope === "ALL") {
        for (const x of byKey(effects.filter((y) => isLive(y) && y.concentration.required), (y) => y.activeEffectKey)) end(x.activeEffectKey, "CONCENTRATION_FAILED", own(e, "sourceKey") === undefined ? "concentration.break_all" : String(own(e, "sourceKey")));
        if (channel) failChannel();
      } else if (isChannel) failChannel();
      else end(String(target), "CONCENTRATION_FAILED", "concentration.disrupted_effect");
      break;
    }
    case "CHANNEL_START": {
      const key = own(e, "channelKey");
      if (channel && policy.channel.maximumSimultaneous <= 1) { p.add(K.CHANNEL_LIMIT, ["event"], "only one Spell may be Channeled at a time without an exact overriding rule"); break; }
      if (!isExactLabel(key)) { p.add(K.INVALID_EVENT, ["event", "channelKey"], "exact Channel identity"); break; }
      const ability = authoredRequest(own(e, "ability"), "ability"); if (!ability) break;
      if (own(ability, "execution") !== undefined) { p.add(K.INVALID_EVENT, ["event", "ability", "execution"], "a Channel resolves only when complete; it carries no execution yet"); break; }
      const cost = spellCost(ability, "ability"); if (!cost) break;
      if (policy.channel.requiresConcentration && consumers() >= slots) { p.add(K.CONCENTRATION_CAPACITY, ["event"], `all ${String(slots)} Concentration slots are in use; a Channel needs one`); break; }
      channel = { channelKey: key, casterKey: casterKey as string, spell: cost.definition, policy: pol.ref, rulesetProvenance: bundle.rulesetProvenance, requiredAp: cost.ap.finalApCost, investedAp: 0, investedThisRound: 0, concentration: { required: policy.channel.requiresConcentration }, mpPayment: { status: "UNRESOLVED", conflictKey: policy.channel.mpPaymentConflictKey }, status: "CHANNELING" };
      lifecycle.push({ subjectKey: key, from: "NONE", to: "CHANNELING", reason: null });
      break;
    }
    case "CHANNEL_INVEST": {
      if (!channel) { p.add(K.INVALID_EVENT, ["event"], "no Channel is active"); break; }
      const amount = readSafeInteger(own(e, "amount"), ["event", "amount"], p, K.INVALID_EVENT, "AP invested"); if (amount === null) break;
      const remaining = channel.requiredAp - channel.investedAp;
      if (amount < 1 || amount > remaining) { p.add(K.INVALID_EVENT, ["event", "amount"], `invest 1–${String(remaining)} AP; overpayment never discounts or refunds`); break; }
      if (!spendAp(channel.channelKey, "channel.ap", amount, channel.spell.canonicalKey)) { p.add(K.INSUFFICIENT_RESOURCES, ["event", "amount"], "the AP cannot be spent; nothing changed"); break; }
      const invested = channel.investedAp + amount;
      if (invested === channel.requiredAp) {
        // Completes immediately — no round boundary; its slot is released; the Spell resolves through the normal path.
        channelResult = { channelKey: channel.channelKey, spell: channel.spell, status: "COMPLETE", requiredAp: channel.requiredAp, investedAp: invested, readyToResolve: true, mpPayment: channel.mpPayment };
        lifecycle.push({ subjectKey: channel.channelKey, from: "CHANNELING", to: "COMPLETE", reason: null });
        channel = null;
      } else channel = { ...channel, investedAp: invested, investedThisRound: channel.investedThisRound + amount };
      break;
    }
    case "CHANNEL_STOP": {
      if (!channel) { p.add(K.INVALID_EVENT, ["event"], "no Channel is active"); break; }
      channelResult = { channelKey: channel.channelKey, spell: channel.spell, status: "ABANDONED", requiredAp: channel.requiredAp, investedAp: 0, readyToResolve: false, mpPayment: channel.mpPayment };
      lifecycle.push({ subjectKey: channel.channelKey, from: "CHANNELING", to: "ABANDONED", reason: "channel.stopped" });
      channel = null; // spent AP is never refunded and no partial progress is retained
      break;
    }
    case "TIMING": {
      const timing = readEnum(own(e, "timing"), ACTIVE_EFFECT_TICK_TIMINGS, ["event", "timing"], p, K.INVALID_EVENT, "structured timing"); if (!timing) break;
      const targetKey = own(e, "targetKey");
      for (const x of byKey(effects.filter((y) => y.status === "ACTIVE"), (y) => y.activeEffectKey))
        for (const t of x.ticks) if (t.timing === timing && (targetKey === undefined || t.targetKey === targetKey)) ticks.push({ activeEffectKey: x.activeEffectKey, timing, targetKey: t.targetKey, effectKey: t.effectKey, kind: "ACTIVE_EFFECT_TICK_DUE" });
      break;
    }
  }
  if (p.count > 0) return finish(p, () => null as never);

  // ---- Inspector ----------------------------------------------------------------------------------------------------
  const used = consumers();
  const dcNow = used > 0 ? formula("concentration_dc.inspector", policy.formulas.concentrationDc, { consumers: used }) : null;
  const mpState = resourceOf(resources, MP) ?? null;
  const lockChange = [...resourceChanges].reverse().find((c) => c.operation === "RESERVE_CAPACITY" || c.operation === "RELEASE_CAPACITY");
  if (p.count > 0) return finish(p, () => null as never);
  const state: ActiveMagicState = { contractVersion: 1, casterKey: casterKey as string, rulesetProvenance: bundle.rulesetProvenance, effects, channel };
  const inspector: ActiveMagicInspector = {
    concentration: { capacity: slots, used, dc: dcNow },
    mp: { reserved: mpState?.reservedCapacity ?? 0, availableMaximum: lockChange ? lockChange.availableMaximumAfter : null, current: current(resources, MP) },
    effects: effects.map((x) => ({
      activeEffectKey: x.activeEffectKey, sourceSpell: x.ability, ruleset: x.rulesetProvenance,
      duration: { concept: x.duration.concept, remainingRounds: x.duration.remainingRounds },
      sustain: x.sustain ? { mpCost: x.sustain.mpCost, apCost: x.sustain.apCost, paymentSource: x.sustain.lastPayment } : null,
      concentration: { required: x.concentration.required }, manaLock: x.manaLock ? { reservedMp: x.manaLock.reservedMp } : null,
      lifecycle: { status: x.status, endReason: x.endReason },
    })),
    channel: channel ? { spell: channel.spell, requiredAp: channel.requiredAp, investedAp: channel.investedAp, remainingAp: channel.requiredAp - channel.investedAp, concentrationSlot: channel.concentration.required, status: channel.status } : null,
  };
  return finish(p, () => deepFreeze(clonePlainData({ status, event: kind, state, resources, lifecycle, resourceChanges, pending, concentration: { capacity: slots, used, test }, ticks, channelResult, noActiveEffectReason, formulaEvaluations, runtimeEvaluations, inspector })) as ActiveMagicTransition);
}
