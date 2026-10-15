import { deepFreeze } from "../internal/plain-data.js";
import type { JsonValue } from "@prowess/model";
import type { EvaluationValue } from "../result/evaluation-value.js";
import type { RuleProvenance, RulesetProvenance } from "../result/provenance.js";
import type { RuleEngineResponseStatus, RuleMessage } from "../result/rule-engine-response.js";
import type { TraceInput } from "../trace/calculation-trace.js";

/**
 * The Explanation model (PAS-10 M4-WO9). EXPLANATION DESCRIBES CALCULATION; IT NEVER PERFORMS IT.
 *
 * An explanation is a structured, machine-readable VIEW over exact completed results: each contribution is one exact
 * RuleEngineResponse, its WO1 CalculationTrace projected node by node (source path and ordinal kept verbatim), plus
 * "facts" copied from the response's own result fields. Nothing is re-evaluated, re-ordered, rounded or formatted.
 * There is one canonical DETAILED document; SUMMARY is a filter over it.
 */

export const EXPLANATION_LEVELS = deepFreeze(["DETAILED", "SUMMARY"] as const);
export type ExplanationLevel = (typeof EXPLANATION_LEVELS)[number];

/** Which engine layer produced a contribution. Always explicit; never guessed from the object's shape. */
export const EXPLANATION_CONTRIBUTION_KINDS = deepFreeze(["FORMULA", "KEYWORD", "REQUIREMENT", "MODIFIER", "RESOURCE", "VALIDATION", "GENERIC"] as const);
export type ExplanationContributionKind = (typeof EXPLANATION_CONTRIBUTION_KINDS)[number];

/**
 * Presentation statuses — each derived only from an explicit field of the source result or trace (never from value
 * shape). A valid false Requirement is NOT_SATISFIED (not INVALID); a skipped modifier is SKIPPED (not failed); an
 * unaffordable payment is PAYMENT_UNAVAILABLE (not an engine failure).
 */
export const EXPLANATION_STATUSES = deepFreeze([
  "EVALUATED",
  "RESOLVED",
  "SATISFIED",
  "NOT_SATISFIED",
  "APPLIED",
  "NOT_APPLIED",
  "SKIPPED",
  "DEDUPLICATED",
  "PAYABLE",
  "PAYMENT_UNAVAILABLE",
  "PASS",
  "FAIL",
  "NOT_APPLICABLE",
  "VALID",
  "VALID_WITH_WARNINGS",
  "INVALID",
  "ENGINE_FAILURE",
] as const);
export type ExplanationStatus = (typeof EXPLANATION_STATUSES)[number];

/** Short canonical phrases — deterministic labels, not narrative. Localization belongs to the UI. */
export const EXPLANATION_STATUS_LABELS: Readonly<Record<ExplanationStatus, string>> = deepFreeze({
  EVALUATED: "Evaluated",
  RESOLVED: "Resolved",
  SATISFIED: "Requirement satisfied",
  NOT_SATISFIED: "Requirement not satisfied",
  APPLIED: "Applied",
  NOT_APPLIED: "Not applied",
  SKIPPED: "Skipped: condition not satisfied",
  DEDUPLICATED: "Deduplicated",
  PAYABLE: "Payment available",
  PAYMENT_UNAVAILABLE: "Payment unavailable",
  PASS: "Check passed",
  FAIL: "Check failed",
  NOT_APPLICABLE: "Not applicable",
  VALID: "Valid",
  VALID_WITH_WARNINGS: "Valid with warnings",
  INVALID: "Invalid evaluation",
  ENGINE_FAILURE: "Engine failure",
});

/** One exact completed result to explain, with caller-supplied presentation metadata (never mechanics). */
export interface ExplanationContribution {
  readonly contributionKey: string;
  readonly order: number;
  readonly kind: ExplanationContributionKind;
  /** The exact RuleEngineResponse. Never re-run. */
  readonly response: unknown;
  readonly label?: string | null;
  readonly description?: string | null;
  readonly unit?: string | null;
  readonly groupKey?: string | null;
  readonly provenance?: RuleProvenance | null;
}

export interface ExplanationInput {
  readonly explanationKey: string;
  readonly title?: string | null;
  readonly contributions: readonly ExplanationContribution[];
  /** Exact RulesetProvenance for the whole explanation, preserved verbatim. */
  readonly ruleset?: RulesetProvenance | null;
  readonly provenance?: RuleProvenance | null;
}

/** A value copied from an exact result field — never computed. */
export interface ExplanationFact {
  readonly factKey: string;
  readonly label: string;
  readonly value: JsonValue;
}

/**
 * One projected trace step. `nodeId` = `<contributionKey>#<sourceTracePath>` (deterministic, no randomness);
 * `explanationPath` = `<section position>/<sourceTracePath>`; `sourceTracePath` / `sourceTraceOrdinal` are the WO1
 * trace's own path and (contribution-local) ordinal, verbatim.
 */
export interface ExplanationNode {
  readonly nodeId: string;
  readonly explanationPath: string;
  readonly sourceContributionKey: string;
  readonly sourceTracePath: string;
  readonly sourceTraceOrdinal: number;
  readonly key: string;
  readonly operation: string;
  readonly phase: string | null;
  readonly status: ExplanationStatus | null;
  readonly label: string | null;
  readonly inputs: readonly TraceInput[];
  readonly output: EvaluationValue | null;
  readonly provenance: RuleProvenance | null;
  readonly modifierSource: RuleProvenance | null;
  /** Ordinals (in this contribution's own message numbering) of diagnostics this node produced. */
  readonly relatedDiagnosticOrdinals: readonly number[];
  /** SUMMARY only: how many direct children were filtered out (0 in DETAILED). */
  readonly omittedChildCount: number;
  readonly children: readonly ExplanationNode[];
}

/** One contribution's explanation. */
export interface ExplanationSection {
  readonly sectionKey: string;
  readonly kind: ExplanationContributionKind;
  readonly order: number;
  readonly label: string | null;
  readonly description: string | null;
  readonly unit: string | null;
  readonly groupKey: string | null;
  readonly evaluationKind: string | null;
  /** The source response's own WO1 status. */
  readonly responseStatus: RuleEngineResponseStatus;
  readonly status: ExplanationStatus;
  readonly statusLabel: string;
  /** Values copied from the exact result's own fields (empty when the result has no data). */
  readonly facts: readonly ExplanationFact[];
  readonly nodes: readonly ExplanationNode[];
  /** The source response's own messages, exact (contribution-local ordinals). */
  readonly diagnostics: readonly RuleMessage[];
  readonly provenance: RuleProvenance | null;
  /** The source response's own RulesetProvenance, verbatim. */
  readonly ruleset: unknown;
}

export interface ExplanationDocument {
  readonly explanationKey: string;
  readonly title: string | null;
  readonly level: ExplanationLevel;
  readonly ruleset: RulesetProvenance | null;
  readonly provenance: RuleProvenance | null;
  readonly summary: {
    readonly contributionCount: number;
    readonly errorCount: number;
    readonly warningCount: number;
    readonly infoCount: number;
    readonly nodeCount: number;
  };
  /** In explicit contribution order (order, then contributionKey). */
  readonly sections: readonly ExplanationSection[];
}

export const EXPLANATION_DIAGNOSTIC_CODES = deepFreeze({
  INVALID_INPUT: "EXPLANATION.INVALID_INPUT",
  INVALID_CONTRIBUTION: "EXPLANATION.INVALID_CONTRIBUTION",
  UNSUPPORTED_CONTRIBUTION: "EXPLANATION.UNSUPPORTED_CONTRIBUTION",
  DUPLICATE_CONTRIBUTION: "EXPLANATION.DUPLICATE_CONTRIBUTION",
  INVALID_TRACE_REFERENCE: "EXPLANATION.INVALID_TRACE_REFERENCE",
  LIMIT_EXCEEDED: "EXPLANATION.LIMIT_EXCEEDED",
} as const);

/** Deterministic limits; exceeding one fails closed — nothing is silently omitted. */
export const EXPLANATION_LIMITS = deepFreeze({
  MAX_CONTRIBUTIONS: 4096,
  MAX_TRACE_NODES_PER_CONTRIBUTION: 50_000,
  MAX_TOTAL_NODES: 100_000,
  MAX_TRACE_DEPTH: 512,
} as const);
