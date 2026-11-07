import type { ProwessRulesetProvenance } from "../bundle/bundle.js";
import type { ActiveMagicState } from "../ability/active-magic.js";
import { deepFreeze } from "../internal/plain-data.js";

/**
 * PAS-10 M6-WO10 — Character Play Workspace contract. The workspace ORCHESTRATES existing authorities (M5-WO3 runtime
 * Resources and action economy, M5-WO10 / WO11 costs, M5-WO12 resolution, M5-WO13 Active Magic, M6-WO6 Attacks, M6-WO7 /
 * WO8 Signature Abilities, M6-WO9 Action Improvements); it is never a source of rules. Every number below was produced
 * by M4 through one of those authorities, copied, or is an explicit player / GM input labelled as such.
 */
export const PLAY_CONTRACT_VERSION = 1 as const;

/** How a committed operation was established (§14). Manual entries are never presented as engine results. */
export const PLAY_CLASSIFICATIONS = deepFreeze(["RULES_EXECUTED", "MANUAL_ADJUSTMENT", "REFERENCE_ONLY", "NOTE"] as const);
export type PlayClassification = (typeof PLAY_CLASSIFICATIONS)[number];

/** The outcome of evaluating an operation (preview and commit run the same evaluation). */
export const PLAY_OPERATION_STATUSES = deepFreeze(["COMMITTABLE", "REFUSED", "PENDING_INPUT", "PENDING_DECISION", "UNSUPPORTED", "RECONCILIATION_REQUIRED"] as const);
export type PlayOperationStatus = (typeof PLAY_OPERATION_STATUSES)[number];

/** Availability of an entry in the Action Workspace (§19). */
export const PLAY_AVAILABILITY = deepFreeze(["AVAILABLE", "UNAVAILABLE", "INSUFFICIENT_RESOURCES", "PENDING_INPUT", "UNSUPPORTED", "REFERENCE_ONLY"] as const);
export type PlayAvailability = (typeof PLAY_AVAILABILITY)[number];

export const PLAY_TIMING_EVENTS = deepFreeze(["BEGIN_COMBAT", "START_ROUND", "START_TURN", "END_TURN", "END_ROUND", "END_COMBAT"] as const);
export type PlayTimingEvent = (typeof PLAY_TIMING_EVENTS)[number];

export const PLAY_OPERATION_KINDS = deepFreeze(["TIMING", "GENERAL_ACTION", "MOVEMENT", "WEAPON_ATTACK", "SPELL", "MANEUVER", "ACTIVE_MAGIC", "MANUAL_ADJUSTMENT", "NOTE", "RECONCILE"] as const);
export type PlayOperationKind = (typeof PLAY_OPERATION_KINDS)[number];

/** Active Magic lifecycle events a player may submit directly; ACTIVATE / ROUND_END / BOUNDARY / TIMING ride on casting and timing. */
export const PLAY_ACTIVE_MAGIC_EVENTS = deepFreeze(["MAINTENANCE", "DISMISS", "EXTERNAL_END", "CONCENTRATION_TEST", "CHANNEL_START", "CHANNEL_INVEST", "CHANNEL_STOP"] as const);
export type PlayActiveMagicEvent = (typeof PLAY_ACTIVE_MAGIC_EVENTS)[number];

export const PLAY_NOTE_CATEGORIES = deepFreeze(["GM_ADJUDICATION", "POSITION", "GENERAL"] as const);
export type PlayNoteCategory = (typeof PLAY_NOTE_CATEGORIES)[number];

/** Where a roll result came from. All are gameplay inputs, never certified outcomes (§12). */
export const PLAY_ROLL_SOURCES = deepFreeze(["PHYSICAL", "DIGITAL", "GM"] as const);
export type PlayRollSource = (typeof PLAY_ROLL_SOURCES)[number];

export const PLAY_REASON_CODES = deepFreeze({
  INVALID_OPERATION: "PLAY.INVALID_OPERATION",
  NOT_IN_COMBAT: "PLAY.NOT_IN_COMBAT",
  TIMING_SEQUENCE: "PLAY.TIMING_SEQUENCE",
  WRONG_TIMING_WINDOW: "PLAY.WRONG_TIMING_WINDOW",
  TRIGGER_REQUIRED: "PLAY.TRIGGER_REQUIRED",
  INSUFFICIENT_RESOURCES: "PLAY.INSUFFICIENT_RESOURCES",
  USAGE_UNAVAILABLE: "PLAY.USAGE_UNAVAILABLE",
  COST_CHOICE_REQUIRED: "PLAY.COST_CHOICE_REQUIRED",
  COST_UNRESOLVED: "PLAY.COST_UNRESOLVED",
  IMPROVEMENT_CONFLICT: "PLAY.IMPROVEMENT_CONFLICT",
  UNKNOWN_ACTION: "PLAY.UNKNOWN_ACTION",
  UNKNOWN_ABILITY: "PLAY.UNKNOWN_ABILITY",
  ABILITY_NOT_EXECUTABLE: "PLAY.ABILITY_NOT_EXECUTABLE",
  REVISION_CHANGED: "PLAY.REVISION_CHANGED",
  RESOLUTION_UNSUPPORTED: "PLAY.RESOLUTION_UNSUPPORTED",
  PENDING_INPUT: "PLAY.PENDING_INPUT",
  PENDING_DECISION: "PLAY.PENDING_DECISION",
  ENGINE_REFUSED: "PLAY.ENGINE_REFUSED",
  RESOURCE_STATE_INVALID: "PLAY.RESOURCE_STATE_INVALID",
  RECONCILIATION_REQUIRED: "PLAY.RECONCILIATION_REQUIRED",
  RELEASE_MISMATCH: "PLAY.RELEASE_MISMATCH",
  MANUAL_INVALID: "PLAY.MANUAL_INVALID",
  NOTHING_TO_RECONCILE: "PLAY.NOTHING_TO_RECONCILE",
} as const);

export interface PlayReason {
  readonly code: string;
  readonly message: string;
}

/**
 * The Play Workspace's OWN runtime state (§5): timing, the runtime-only Movement Allowance and reserved MP capacity, the
 * exact M5-WO13 Active Magic state and the identity it was established under. Current HP / MP / ME / AP / Counter
 * Actions are NOT here — they stay in the Character Sheet's play state (one resource authority). No maximum, formula,
 * progression or Ability definition is stored.
 */
export interface PlayRuntimeState {
  readonly contractVersion: typeof PLAY_CONTRACT_VERSION;
  readonly characterId: string;
  readonly releaseId: string;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  /** The Character's advancement count when the runtime last committed (an advancement is detected, never absorbed). */
  readonly advancementCount: number;
  readonly combat: {
    readonly active: boolean;
    /** The current round (from 1) once a round has started; null before the first round. */
    readonly round: number | null;
    /** The GM's Surprise determination for this combat (s51); affects Counter Action usage in round 1 only. */
    readonly surprised: boolean;
    readonly phase: "OUT_OF_COMBAT" | "AWAITING_ROUND" | "ROUND";
    readonly turn: "NOT_TAKEN" | "ACTIVE" | "ENDED";
  };
  /** Runtime-only Resources the sheet does not hold: the Movement Allowance tracker and MP reserved capacity. */
  readonly movementAllowance: number;
  readonly reservedMp: number;
  /**
   * Movement record of the current turn for display — each grant and each segment exactly as M4 evaluated it (the
   * allowance tracker above is the authority; nothing here is summed or recalculated).
   */
  readonly movement: { readonly grants: readonly number[]; readonly segments: readonly { readonly distance: number; readonly terrainKey: string; readonly allowanceCost: number }[] };
  readonly activeMagic: ActiveMagicState | null;
}

/** A raw die result as the player / GM supplies it. The die itself always comes from the roller's Character Die. */
export interface PlayRollInput {
  readonly mode: "NORMAL" | "ADVANTAGE" | "DISADVANTAGE";
  readonly rolls: readonly number[];
  readonly source: PlayRollSource;
}

/** A defender the GM describes for a Saving Throw (player / GM provided; never validated against a canonical creature). */
export interface PlayDefenderInput {
  readonly level: number;
  readonly stats: Readonly<Record<"STR" | "AGI" | "CON" | "PER" | "RES" | "PRO", number>>;
}

/** An answer to one exact M5-WO12 input request. The server binds it to the plan; mechanics are never client-claimed. */
export type PlayResolutionInput =
  | { readonly requestKey: string; readonly kind: "ATTACK_ROLL"; readonly roll: PlayRollInput; readonly targetDodge: number }
  | { readonly requestKey: string; readonly kind: "SAVING_THROW"; readonly roll: PlayRollInput; readonly defender: PlayDefenderInput; readonly difficultyClass?: number }
  | { readonly requestKey: string; readonly kind: "SAVE_REMOVAL" | "SAVE_SELECTION"; readonly stat: string };

export interface PlayTargetInput {
  readonly targetKey: string;
  readonly facts?: { readonly numeric?: readonly { readonly key: string; readonly value: number }[]; readonly sets?: readonly { readonly key: string; readonly members: readonly string[] }[] };
}

export type PlayOperation =
  | { readonly kind: "TIMING"; readonly event: PlayTimingEvent; readonly surprised?: boolean }
  | { readonly kind: "GENERAL_ACTION"; readonly actionKey: string; readonly chosenCost?: number; readonly trigger?: { readonly triggerKey: string; readonly description: string } }
  | { readonly kind: "MOVEMENT"; readonly segments: readonly { readonly distance: number; readonly terrainKey: string }[] }
  | { readonly kind: "WEAPON_ATTACK"; readonly attackKey: string; readonly hand: string; readonly damageProfileKey: string; readonly roll?: PlayRollInput; readonly targetDodge?: number }
  | { readonly kind: "SPELL"; readonly abilityId: string; readonly revisionNumber: number; readonly targets: readonly PlayTargetInput[]; readonly inputs: readonly PlayResolutionInput[] }
  | { readonly kind: "MANEUVER"; readonly abilityId: string; readonly revisionNumber: number; readonly targets: readonly PlayTargetInput[]; readonly groupTargets: readonly { readonly groupKey: string; readonly targetKeys: readonly string[] }[]; readonly inputs: readonly PlayResolutionInput[] }
  | { readonly kind: "ACTIVE_MAGIC"; readonly event: PlayActiveMagicEvent; readonly activeEffectKey?: string; readonly selection?: readonly string[]; readonly end?: string; readonly sourceKey?: string; readonly trigger?: string; readonly target?: string; readonly failureScope?: "DISRUPTED_EFFECT" | "ALL"; readonly roll?: PlayRollInput; readonly abilityId?: string; readonly revisionNumber?: number; readonly amount?: number }
  | { readonly kind: "MANUAL_ADJUSTMENT"; readonly resourceKey: string; readonly after: number; readonly reason?: string }
  | { readonly kind: "NOTE"; readonly category: PlayNoteCategory; readonly text: string; readonly subject?: string }
  | { readonly kind: "RECONCILE" };

/** Resource state as the workspace presents it: the sheet's current values plus the runtime-only trackers. */
export interface PlayResourceSnapshot {
  readonly resourceKey: string;
  readonly current: number;
  readonly reservedCapacity: number;
}

export interface PlayOperationOutcome {
  readonly contractVersion: typeof PLAY_CONTRACT_VERSION;
  readonly status: PlayOperationStatus;
  readonly classification: PlayClassification | null;
  readonly operation: PlayOperation;
  /** Human summary of what happened / would happen (presentation only). */
  readonly summary: string;
  readonly reasons: readonly PlayReason[];
  readonly resourcesBefore: readonly PlayResourceSnapshot[];
  /** COMMITTABLE only: the resources after the operation (exact copies of the engine's resulting state). */
  readonly resourcesAfter: readonly PlayResourceSnapshot[] | null;
  /** COMMITTABLE only: the runtime state to persist. */
  readonly runtimeAfter: PlayRuntimeState | null;
  /** Source identity: the exact Action / Attack / Ability revision / Active Effect the operation concerns. */
  readonly source: Readonly<Record<string, unknown>> | null;
  /** Exact engine traces (payments, transitions, resolution results, Active Magic transition) — inert records. */
  readonly trace: Readonly<Record<string, unknown>>;
  /** Pending M5-WO12 / WO13 requests the player must answer before the operation can commit. */
  readonly pending: readonly Readonly<Record<string, unknown>>[];
  /** Player / GM supplied facts (rolls, target values, notes), labelled with their source. */
  readonly inputs: Readonly<Record<string, unknown>>;
}
