import type { JsonObject, JsonValue } from "@prowess/model";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";

/**
 * Rules Evaluation Orchestration (PAS-10 M4-WO10). Orchestration adds NO mechanics: it runs an explicit, plain-data
 * EvaluationPlan — a closed set of operations, each a thin adapter over an existing WO3–WO9 primitive — in an explicit
 * order, under ONE exact set of contexts, copying exact values between steps through explicit bindings (no arithmetic,
 * no rounding, no transforms). Child responses are stored exactly as the primitive returned them.
 */

/**
 * The closed operation vocabulary — each maps to exactly one public primitive. No M5 / Prowess operation exists here
 * (no spell cost, affinity, mana lock, weapon damage …); those will be compiled INTO plans of these operations.
 */
export const EVALUATION_OPERATIONS = [
  "FORMULA",
  "KEYWORD",
  "REQUIREMENT",
  "MODIFIER",
  "RESOURCE_SPEND",
  "RESOURCE_RESTORE",
  "RESOURCE_SET_CURRENT",
  "RESOURCE_RESERVE_CAPACITY",
  "RESOURCE_RELEASE_CAPACITY",
  "RESOURCE_REFRESH",
  "RESOURCE_PAYMENT_PREVIEW",
  "RESOURCE_PAYMENT_APPLY",
  "VALIDATION",
  "EXPLANATION",
  "EXPLANATION_PROJECT",
] as const;
export type EvaluationOperation = (typeof EVALUATION_OPERATIONS)[number];

/** The named arguments each operation's input may carry — the primitive's own parameters, nothing else. */
export const EVALUATION_OPERATION_INPUT_FIELDS: Readonly<Record<EvaluationOperation, readonly string[]>> = {
  FORMULA: ["program", "variables"],
  KEYWORD: ["contributions"],
  REQUIREMENT: ["requirement", "facts"],
  MODIFIER: ["request"],
  RESOURCE_SPEND: ["snapshot", "request"],
  RESOURCE_RESTORE: ["snapshot", "request"],
  RESOURCE_SET_CURRENT: ["snapshot", "request"],
  RESOURCE_RESERVE_CAPACITY: ["snapshot", "request"],
  RESOURCE_RELEASE_CAPACITY: ["snapshot", "request"],
  RESOURCE_REFRESH: ["snapshot", "request"],
  RESOURCE_PAYMENT_PREVIEW: ["snapshot", "payment"],
  RESOURCE_PAYMENT_APPLY: ["snapshot", "payment"],
  VALIDATION: ["request"],
  EXPLANATION: ["input"],
  EXPLANATION_PROJECT: ["document", "level"],
};

/** The four WO1 context families a binding may read from. */
export const EVALUATION_CONTEXT_FAMILIES = ["RULESET", "ACTOR", "BUILD", "RUNTIME"] as const;
export type EvaluationContextFamily = (typeof EVALUATION_CONTEXT_FAMILIES)[number];

/**
 * Where a bound value comes from. `pointer` is an RFC 6901 JSON Pointer; `""` is the root (the whole normalized
 * context, or the whole prior RuleEngineResponse — what WO8 sources and WO9 contributions need).
 */
export type EvaluationReference =
  | { readonly kind: "CONTEXT"; readonly context: EvaluationContextFamily; readonly pointer: string }
  | { readonly kind: "STEP"; readonly stepKey: string; readonly pointer: string };

/** Copies the exact value at `source` into the detached step input at `target` (a non-root JSON Pointer). */
export interface EvaluationBinding {
  readonly target: string;
  readonly source: EvaluationReference;
}

export interface EvaluationStep {
  readonly stepKey: string;
  readonly order: number;
  readonly operation: EvaluationOperation;
  /** A plain-data template of the operation's named arguments; bindings fill selected positions. */
  readonly input: JsonObject;
  readonly bindings: readonly EvaluationBinding[];
}

export interface EvaluationPlan {
  readonly steps: readonly EvaluationStep[];
  /** Explicit designations — never inferred. */
  readonly primaryStepKey?: string | null;
  readonly validationStepKey?: string | null;
  readonly explanationStepKey?: string | null;
}

/** Whether a step RAN — not whether its rule evaluation was valid (its response says that). */
export const EVALUATION_STEP_EXECUTION_STATUSES = ["EXECUTED", "BLOCKED"] as const;
export type EvaluationStepExecutionStatus = (typeof EVALUATION_STEP_EXECUTION_STATUSES)[number];

/** Whether every step ran. Not a rule-validity status. */
export const EVALUATION_RUN_EXECUTION_STATUSES = ["COMPLETE", "PARTIAL"] as const;
export type EvaluationRunExecutionStatus = (typeof EVALUATION_RUN_EXECUTION_STATUSES)[number];

/** Why a binding's value was unavailable at run time. */
export const EVALUATION_BLOCK_REASONS = ["CONTEXT_UNAVAILABLE", "REFERENCE_NOT_FOUND", "DEPENDENCY_BLOCKED", "DEPENDENCY_VALUE_UNAVAILABLE"] as const;
export type EvaluationBlockReason = (typeof EVALUATION_BLOCK_REASONS)[number];

export interface EvaluationBlockedBinding {
  readonly target: string;
  readonly reason: EvaluationBlockReason;
  readonly source: EvaluationReference;
}

export interface EvaluationStepResult {
  readonly stepKey: string;
  readonly order: number;
  readonly operation: EvaluationOperation;
  readonly executionStatus: EvaluationStepExecutionStatus;
  /** The primitive's exact response — null only when BLOCKED (the primitive never ran). */
  readonly response: RuleEngineResponse<JsonValue> | null;
  /** Every unavailable binding, in target order — empty when EXECUTED. */
  readonly blockedBy: readonly EvaluationBlockedBinding[];
}

export interface EvaluationRun {
  readonly evaluationKey: string;
  readonly executionStatus: EvaluationRunExecutionStatus;
  readonly primaryStepKey: string | null;
  readonly validationStepKey: string | null;
  readonly explanationStepKey: string | null;
  /** In execution order: order, then stepKey. */
  readonly steps: readonly EvaluationStepResult[];
}

/** The orchestrator's OWN plan / request diagnostics. A child's INVALID response is never one of these. */
export const ORCHESTRATION_DIAGNOSTIC_CODES = {
  INVALID_REQUEST: "ORCHESTRATION.INVALID_REQUEST",
  INVALID_PLAN: "ORCHESTRATION.INVALID_PLAN",
  INVALID_STEP: "ORCHESTRATION.INVALID_STEP",
  UNKNOWN_OPERATION: "ORCHESTRATION.UNKNOWN_OPERATION",
  DUPLICATE_STEP: "ORCHESTRATION.DUPLICATE_STEP",
  INVALID_INPUT: "ORCHESTRATION.INVALID_INPUT",
  INVALID_BINDING: "ORCHESTRATION.INVALID_BINDING",
  INVALID_POINTER: "ORCHESTRATION.INVALID_POINTER",
  BINDING_TARGET_CONFLICT: "ORCHESTRATION.BINDING_TARGET_CONFLICT",
  INVALID_REFERENCE: "ORCHESTRATION.INVALID_REFERENCE",
  INVALID_DESIGNATION: "ORCHESTRATION.INVALID_DESIGNATION",
  LIMIT_EXCEEDED: "ORCHESTRATION.LIMIT_EXCEEDED",
} as const;
export type OrchestrationDiagnosticCode = (typeof ORCHESTRATION_DIAGNOSTIC_CODES)[keyof typeof ORCHESTRATION_DIAGNOSTIC_CODES];

/** Deterministic limits — exceeding one fails closed; nothing is ignored or truncated. */
export const ORCHESTRATION_LIMITS = {
  MAX_STEPS: 4096,
  MAX_BINDINGS_PER_STEP: 4096,
  MAX_TOTAL_BINDINGS: 32_768,
  MAX_POINTER_LENGTH: 2048,
  MAX_POINTER_TOKENS: 64,
} as const;
