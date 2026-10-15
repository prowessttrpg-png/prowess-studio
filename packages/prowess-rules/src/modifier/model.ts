import { deepFreeze } from "../internal/plain-data.js";
import type { RuleProvenance } from "../result/provenance.js";
import type { RequirementNode } from "../requirement/model.js";

/**
 * The Modifier model (PAS-10 M4-WO6). Modifiers transform explicit values; they never decide what a value means.
 *
 * A modifier is structured data: one exact target, a generic operation, an operand where the operation needs one, an
 * explicit phase / priority / order, an optional M4-WO5 Requirement condition, a stacking policy, and source /
 * provenance. No prose, no callback, no game-specific operation, no rounding, no payment.
 */

/** The three generic target families. Not game identities. */
export const MODIFIER_TARGET_KINDS = deepFreeze(["NUMERIC", "ORDERED", "ROLL_SIGNAL"] as const);
export type ModifierTargetKind = (typeof MODIFIER_TARGET_KINDS)[number];

/** What happens when a step would leave an ORDERED ladder. Always explicit — there is no default. */
export const MODIFIER_BOUNDARY_POLICIES = deepFreeze(["CLAMP", "INVALID"] as const);
export type ModifierBoundaryPolicy = (typeof MODIFIER_BOUNDARY_POLICIES)[number];

export interface NumericTarget {
  readonly targetKey: string;
  readonly kind: "NUMERIC";
  readonly value: number;
}

/** A caller-supplied ladder of unique exact step keys; `currentKey` appears in it exactly once. */
export interface OrderedTarget {
  readonly targetKey: string;
  readonly kind: "ORDERED";
  readonly currentKey: string;
  readonly steps: readonly string[];
  readonly boundaryPolicy: ModifierBoundaryPolicy;
}

/** A target that only collects ADVANTAGE / DISADVANTAGE signals. It has no numeric value. */
export interface RollSignalTarget {
  readonly targetKey: string;
  readonly kind: "ROLL_SIGNAL";
}

export type ModifierTarget = NumericTarget | OrderedTarget | RollSignalTarget;

/**
 * The PAS-02 RuleModifier operation vocabulary, complete. Numeric operations need a NUMERIC target, steps an ORDERED
 * target, signals a ROLL_SIGNAL target.
 */
export const MODIFIER_NUMERIC_OPERATIONS = deepFreeze(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "SET", "MIN", "MAX", "INCREASE_PERCENT", "REDUCE_PERCENT"] as const);
export const MODIFIER_STEP_OPERATIONS = deepFreeze(["STEP_UP", "STEP_DOWN"] as const);
export const MODIFIER_SIGNAL_OPERATIONS = deepFreeze(["ADVANTAGE", "DISADVANTAGE"] as const);
export const MODIFIER_OPERATIONS = deepFreeze([...MODIFIER_NUMERIC_OPERATIONS, ...MODIFIER_STEP_OPERATIONS, ...MODIFIER_SIGNAL_OPERATIONS] as const);
export type ModifierOperation = (typeof MODIFIER_OPERATIONS)[number];

/** An explicit pipeline phase: lower `phaseOrder` applies first. Phase names carry no behaviour. */
export interface ModifierPhase {
  readonly phaseKey: string;
  readonly phaseOrder: number;
}

/**
 * STACK: every applicable modifier applies, in the explicit order. UNIQUE: at most one distinct applicable modifier per
 * `stackingKey` — identical duplicates collapse, different ones are a STACKING_CONFLICT. There is no "strongest wins".
 */
export const MODIFIER_STACKING_POLICIES = deepFreeze(["STACK", "UNIQUE"] as const);
export type ModifierStacking = { readonly policy: "STACK" } | { readonly policy: "UNIQUE"; readonly stackingKey: string };

/** Generic origin of a modifier. `sourceType` is never interpreted. */
export interface ModifierSource {
  readonly sourceType: string;
  readonly sourceKey: string;
  readonly sourceId: string | null;
}

export interface ModifierDefinition {
  /** Exact evaluation identity, unique within one request; the final ordering tie-breaker. */
  readonly modifierKey: string;
  readonly targetKey: string;
  readonly operation: ModifierOperation;
  /** Null exactly for ADVANTAGE / DISADVANTAGE. */
  readonly operand: number | null;
  readonly phase: ModifierPhase;
  /** Lower applies first. */
  readonly priority: number;
  /** Lower applies first within one phase and priority. */
  readonly order: number;
  readonly condition: RequirementNode | null;
  readonly stacking: ModifierStacking;
  readonly source: ModifierSource | null;
  readonly provenance: RuleProvenance | null;
}

/** Final state of each target family. Ordered targets report their position; the ladder is on the initial target. */
export type ModifierTargetState =
  | { readonly targetKey: string; readonly kind: "NUMERIC"; readonly value: number }
  | { readonly targetKey: string; readonly kind: "ORDERED"; readonly currentKey: string; readonly position: number }
  | {
      readonly targetKey: string;
      readonly kind: "ROLL_SIGNAL";
      /** modifierKeys of applied ADVANTAGE signals, in application order. Never cancelled or resolved here. */
      readonly advantage: readonly string[];
      readonly disadvantage: readonly string[];
    };

/** A value as seen by one outcome: a number, an ordered step key, or the signal counts so far. */
export type ModifierValue = number | string | { readonly advantage: number; readonly disadvantage: number };

export const MODIFIER_OUTCOME_STATUSES = deepFreeze(["APPLIED", "SKIPPED_CONDITION", "DEDUPLICATED"] as const);
export type ModifierOutcomeStatus = (typeof MODIFIER_OUTCOME_STATUSES)[number];

/** One modifier's outcome, in application order. `before` === `after` unless APPLIED. */
export interface ModifierOutcome {
  readonly modifierKey: string;
  readonly targetKey: string;
  readonly operation: ModifierOperation;
  readonly operand: number | null;
  readonly phase: ModifierPhase;
  readonly priority: number;
  readonly order: number;
  readonly status: ModifierOutcomeStatus;
  readonly before: ModifierValue;
  readonly after: ModifierValue;
  /** Null when the modifier has no condition; otherwise whether its Requirement was satisfied. */
  readonly condition: { readonly satisfied: boolean } | null;
  /** For DEDUPLICATED: the identical UNIQUE modifier that applied instead. */
  readonly deduplicatedBy: string | null;
  readonly stacking: ModifierStacking;
  readonly source: ModifierSource | null;
  readonly provenance: RuleProvenance | null;
}

export interface ModifierEvaluationResult {
  /** The normalized targets as supplied, in targetKey order. */
  readonly initialTargets: readonly ModifierTarget[];
  readonly finalTargets: readonly ModifierTargetState[];
  /** Every modifier, in actual application order. */
  readonly outcomes: readonly ModifierOutcome[];
}

export const MODIFIER_DIAGNOSTIC_CODES = deepFreeze({
  INVALID_DEFINITION: "MODIFIER.INVALID_DEFINITION",
  INVALID_TARGET: "MODIFIER.INVALID_TARGET",
  TARGET_TYPE_MISMATCH: "MODIFIER.TARGET_TYPE_MISMATCH",
  INVALID_OPERAND: "MODIFIER.INVALID_OPERAND",
  DIVISION_BY_ZERO: "MODIFIER.DIVISION_BY_ZERO",
  NON_FINITE_RESULT: "MODIFIER.NON_FINITE_RESULT",
  PHASE_CONFLICT: "MODIFIER.PHASE_CONFLICT",
  DUPLICATE_KEY: "MODIFIER.DUPLICATE_KEY",
  STACKING_CONFLICT: "MODIFIER.STACKING_CONFLICT",
  STEP_OUT_OF_RANGE: "MODIFIER.STEP_OUT_OF_RANGE",
  INVALID_CONDITION: "MODIFIER.INVALID_CONDITION",
  LIMIT_EXCEEDED: "MODIFIER.LIMIT_EXCEEDED",
} as const);
export type ModifierDiagnosticCode = (typeof MODIFIER_DIAGNOSTIC_CODES)[keyof typeof MODIFIER_DIAGNOSTIC_CODES];

export interface ModifierDiagnostic {
  readonly code: ModifierDiagnosticCode;
  readonly message: string;
  /** RFC 6901 JSON Pointer into the request (`/modifiers/3/operand`, `/targets/0/steps`). */
  readonly path: string;
  readonly modifierKey: string | null;
  /** For INVALID_CONDITION: the underlying REQUIREMENT.* code. */
  readonly requirementCode: string | null;
  readonly provenance: RuleProvenance | null;
}

/** Deterministic complexity limits. Condition trees keep M4-WO5's own limits. */
export const MODIFIER_LIMITS = deepFreeze({
  MAX_TARGETS: 2048,
  MAX_MODIFIERS: 10_000,
  MAX_STEPS_PER_TARGET: 2048,
} as const);
