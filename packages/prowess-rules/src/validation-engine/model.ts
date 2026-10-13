import type { JsonObject } from "@prowess/model";
import type { RuleProvenance } from "../result/provenance.js";
import type { RuleEngineResponseStatus } from "../result/rule-engine-response.js";
import type { ValidationCategory, ValidationSeverity } from "../validation/validation-message.js";

/**
 * The Validation Engine model (PAS-10 M4-WO8).
 *
 * Validation CONSUMES results; it never recalculates them. It combines (a) the diagnostics of exact, already-computed
 * RuleEngineResponses and (b) explicit validation checks whose outcome the caller already determined, into one
 * M4-WO1 RuleEngineResponse. Categories and severities are the M4-WO1 vocabularies, reused unchanged: the nine
 * categories (STRUCTURE … RUNTIME) classify findings and carry no mechanics; severity is always explicit.
 */

/** PASS and NOT_APPLICABLE emit nothing; FAIL emits the check's declared finding. Outcomes are data, never callbacks. */
export const VALIDATION_CHECK_OUTCOMES = ["PASS", "FAIL", "NOT_APPLICABLE"] as const;
export type ValidationCheckOutcome = (typeof VALIDATION_CHECK_OUTCOMES)[number];

/**
 * One explicit check. `checkKey` is exact identity (unique per request); `order` then `checkKey` place it. The
 * finding a FAIL emits is fully declared: `failureSeverity`, `category`, caller-owned `code` (any namespace except
 * the reserved RULE_ENGINE.* and VALIDATION.*), JSON-Pointer `path`, optional `message`, `provenance`, `details`.
 */
export interface ValidationCheck {
  readonly checkKey: string;
  readonly order: number;
  readonly category: ValidationCategory;
  readonly outcome: ValidationCheckOutcome;
  readonly failureSeverity: ValidationSeverity;
  readonly code: string;
  readonly path: string | null;
  readonly message: string | null;
  readonly provenance: RuleProvenance | null;
  readonly details: JsonObject | null;
}

/** One exact, already-computed RuleEngineResponse contributed to validation. It is never re-run or replaced. */
export interface ValidationSource {
  readonly sourceKey: string;
  readonly order: number;
  readonly response: unknown;
}

/** Concise per-check outcome (no copied context). */
export interface ValidationCheckResult {
  readonly checkKey: string;
  readonly order: number;
  readonly outcome: ValidationCheckOutcome;
  readonly category: ValidationCategory;
  /** The emitted severity — only for FAIL. */
  readonly severity: ValidationSeverity | null;
}

/** Concise per-source contribution (no copied data, messages or trace). */
export interface ValidationSourceResult {
  readonly sourceKey: string;
  readonly order: number;
  readonly status: RuleEngineResponseStatus;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
}

/**
 * Data of a valid validation (status SUCCESS or VALID_WITH_WARNINGS). When an ERROR exists the response is INVALID and,
 * per M4-WO1, data is null — counts remain derivable from the message arrays, attribution from the trace.
 */
export interface ValidationSummary {
  readonly valid: true;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly checkCounts: { readonly PASS: number; readonly FAIL: number; readonly NOT_APPLICABLE: number };
  /** Findings per category, derived from the emitted messages; categories with none are omitted. */
  readonly categoryCounts: Readonly<Partial<Record<ValidationCategory, number>>>;
  readonly checks: readonly ValidationCheckResult[];
  readonly sources: readonly ValidationSourceResult[];
}

/** The Validation Engine's OWN input / contract failures. Domain findings keep their caller-owned codes. */
export const VALIDATION_DIAGNOSTIC_CODES = {
  INVALID_REQUEST: "VALIDATION.INVALID_REQUEST",
  INVALID_CHECK: "VALIDATION.INVALID_CHECK",
  DUPLICATE_CHECK: "VALIDATION.DUPLICATE_CHECK",
  INVALID_SOURCE: "VALIDATION.INVALID_SOURCE",
  DUPLICATE_SOURCE: "VALIDATION.DUPLICATE_SOURCE",
  INVALID_CODE: "VALIDATION.INVALID_CODE",
  INVALID_PATH: "VALIDATION.INVALID_PATH",
  LIMIT_EXCEEDED: "VALIDATION.LIMIT_EXCEEDED",
} as const;
export type ValidationDiagnosticCode = (typeof VALIDATION_DIAGNOSTIC_CODES)[keyof typeof VALIDATION_DIAGNOSTIC_CODES];

/** Deterministic limits. Exceeding one fails closed — findings are never silently dropped. */
export const VALIDATION_LIMITS = {
  MAX_SOURCES: 4096,
  MAX_CHECKS: 10_000,
  MAX_FINDINGS: 20_000,
} as const;
