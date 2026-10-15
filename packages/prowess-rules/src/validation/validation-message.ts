import type { JsonObject } from "@prowess/model";
import { RULE_ENGINE_ERROR_CODES, RULE_ENGINE_ERROR_NAMESPACE, RulesEngineError } from "../errors/engine-error.js";
import { InputProblems, MAX_TEXT_LENGTH } from "../internal/input-reader.js";
import { clonePlainData, deepFreeze, inspectPlainData, isPlainObject } from "../internal/plain-data.js";
import { readProvenance, type RuleProvenance } from "../result/provenance.js";

/**
 * The common structured message model (PAS-10 M4-WO1 §20–22), used by every later engine subsystem and orchestrated
 * by M4-WO8's Validation Engine. M4-WO1 defines the contract and its vocabulary; it implements no validator.
 *
 * A validation message is a statement about the RULES / BUILD being evaluated (a future unmet Requirement, an
 * over-capacity build). It is distinct from an engine error (`errors/engine-error.ts`), which says the engine could not
 * evaluate at all.
 *
 * Machine contract: `code`, `category`, `severity` and structured `details`. The human-readable `message` is useful
 * but is NOT the contract — tests and clients must not depend on its wording (§22).
 */
export const VALIDATION_SEVERITIES = deepFreeze(["ERROR", "WARNING", "INFO"] as const);
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

/** The approved generic categories (§21). None has a validator in M4-WO1. */
export const VALIDATION_CATEGORIES = deepFreeze([
  "STRUCTURE",
  "COMPATIBILITY",
  "REQUIREMENT",
  "PARAMETER",
  "CAPACITY",
  "RESOURCE",
  "FORMULA",
  "RULESET",
  "RUNTIME",
] as const);
export type ValidationCategory = (typeof VALIDATION_CATEGORIES)[number];

/**
 * A validation message code: two or more upper-case `_`-separated segments joined by periods (`REQUIREMENT.NOT_MET`,
 * `EXAMPLE.RULE.FAILED`). The `RULE_ENGINE.` namespace is reserved for engine errors and is rejected here, so the two
 * kinds of failure can never be confused (§19).
 */
const VALIDATION_CODE_PATTERN_INTERNAL = /^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$/;
/** Read-only grammar metadata; validation keeps a separate private matcher. */
export const VALIDATION_CODE_PATTERN = deepFreeze(new RegExp(VALIDATION_CODE_PATTERN_INTERNAL));

export function isValidValidationCode(value: unknown): value is string {
  return typeof value === "string" && VALIDATION_CODE_PATTERN_INTERNAL.test(value) && !value.startsWith(`${RULE_ENGINE_ERROR_NAMESPACE}.`);
}

/**
 *  - `ordinal`     position among all messages of one response, in emission order (§54)
 *  - `path`        RFC 6901 JSON Pointer into the evaluated input (e.g. `/build/components/1`), or null
 *  - `provenance`  the rule the message is about, where known
 *  - `details`     structured, serializable data — the machine-readable substance of the message
 */
export interface ValidationMessage {
  readonly kind: "VALIDATION";
  readonly ordinal: number;
  readonly severity: ValidationSeverity;
  readonly category: ValidationCategory;
  readonly code: string;
  readonly message: string;
  readonly path: string | null;
  readonly provenance: RuleProvenance | null;
  readonly details: JsonObject | null;
}

/** What an evaluator emits; the response assigns `kind` and `ordinal`. */
export interface ValidationMessageInput {
  readonly severity: ValidationSeverity;
  readonly category: ValidationCategory;
  readonly code: string;
  readonly message: string;
  readonly path?: string | null;
  readonly provenance?: RuleProvenance | null;
  readonly details?: JsonObject | null;
}

/** A checked, detached validation message awaiting its ordinal. Produced only by `validationMessage`. */
export type ValidationMessageDraft = Omit<ValidationMessage, "ordinal">;

/**
 * Builds a validation message draft. A malformed message (unknown severity or category, bad code, non-serializable
 * details) is an engine defect, not a rule outcome, so it throws `RULE_ENGINE.INVARIANT_VIOLATION`.
 */
export function validationMessage(input: ValidationMessageInput): ValidationMessageDraft {
  const problems: string[] = [];
  if (!(VALIDATION_SEVERITIES as readonly string[]).includes(input.severity)) problems.push("severity");
  if (!(VALIDATION_CATEGORIES as readonly string[]).includes(input.category)) problems.push("category");
  if (!isValidValidationCode(input.code)) problems.push("code");
  if (typeof input.message !== "string" || input.message.length > MAX_TEXT_LENGTH) problems.push("message");
  const path = input.path ?? null;
  if (path !== null && (typeof path !== "string" || (path !== "" && !path.startsWith("/")))) problems.push("path");
  const details = input.details ?? null;
  if (details !== null && (!isPlainObject(details) || inspectPlainData(details).length > 0)) problems.push("details");
  const provenanceProblems = new InputProblems();
  const provenance = readProvenance(input.provenance, ["provenance"], provenanceProblems);
  if (provenanceProblems.count > 0) problems.push("provenance");
  if (problems.length > 0) {
    throw new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVARIANT_VIOLATION, "an evaluator emitted a malformed validation message", {
      details: { invalidFields: problems },
    });
  }
  return deepFreeze({
    kind: "VALIDATION" as const,
    severity: input.severity,
    category: input.category,
    code: input.code,
    message: input.message,
    path,
    provenance,
    details: details === null ? null : (clonePlainData(details) as JsonObject),
  });
}
