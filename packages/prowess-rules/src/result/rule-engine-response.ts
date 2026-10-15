import { deepFreeze } from "../internal/plain-data.js";
import { RULES_ENGINE_CONTRACT_VERSION, type RulesEngineContractVersion } from "../contract-version.js";
import type { EngineError } from "../errors/engine-error.js";
import type { CalculationTrace } from "../trace/calculation-trace.js";
import type { ValidationMessage } from "../validation/validation-message.js";
import type { RulesetProvenance } from "./provenance.js";

/**
 * Response status vocabulary (PAS-10 M4-WO1 §17), derived deterministically from the messages alone:
 *
 *  - ERROR                at least one ENGINE error — the engine could not evaluate
 *  - INVALID              no engine error, at least one VALIDATION ERROR — evaluation ran, the result is not valid
 *  - VALID_WITH_WARNINGS  no errors, at least one WARNING
 *  - SUCCESS              no errors and no warnings (INFO messages never change the status)
 *
 * The api-contract draft's CONFLICT status is intentionally absent: the engine does not resolve or report Canon
 * conflicts (M2 decided them before evaluation). A later ruleset-integrity finding is a RULESET-category message.
 */
export const RULE_ENGINE_RESPONSE_STATUSES = deepFreeze(["SUCCESS", "VALID_WITH_WARNINGS", "INVALID", "ERROR"] as const);
export type RuleEngineResponseStatus = (typeof RULE_ENGINE_RESPONSE_STATUSES)[number];

/** Any message a response can carry. `kind` distinguishes an engine failure from a rule (validation) outcome. */
export type RuleMessage = EngineError | ValidationMessage;

/**
 * The common response envelope every M4 subsystem reuses (§16, §50): FormulaResult, RequirementResult, ModifierResult,
 * ResourcePreview, ValidationResult … are all `RuleEngineResponse<T>` with a different `T`.
 *
 * Success semantics (§18):
 *  - `success === true`   evaluation completed and produced a valid result (status SUCCESS or VALID_WITH_WARNINGS);
 *                         `data` is the result
 *  - `success === false`  an engine error (ERROR) or a blocking validation error (INVALID) prevented a valid result;
 *                         `data` is null
 *
 * `errors` holds every ERROR-severity message — engine errors AND validation errors, each identifiable by `kind`;
 * `warnings` and `info` hold validation messages. Every list is in `ordinal` (emission) order, and ordinals are unique
 * across the three lists (§54).
 *
 * Clock policy (§29, option A): the pure response has NO `evaluatedAt`. A wall-clock time would make two identical
 * evaluations unequal; an application or HTTP layer that needs one stamps it outside the pure result.
 *
 * Results are deep-frozen plain data: serializable, and unchanged by any number of reads (§32, §51).
 */
export interface RuleEngineResponse<T> {
  readonly contractVersion: RulesEngineContractVersion;
  /** The request's evaluation kind, or null when the request itself was unreadable. */
  readonly evaluationKind: string | null;
  readonly success: boolean;
  readonly status: RuleEngineResponseStatus;
  readonly data: T | null;
  readonly errors: readonly RuleMessage[];
  readonly warnings: readonly ValidationMessage[];
  readonly info: readonly ValidationMessage[];
  readonly trace: CalculationTrace;
  /** The exact Ruleset identity evaluated against, verbatim from the request; null when none was supplied or readable. */
  readonly ruleset: RulesetProvenance | null;
}

/** Derives the status from a response's messages. Pure; the only way a status is ever chosen. */
export function deriveResponseStatus(messages: readonly RuleMessage[]): RuleEngineResponseStatus {
  if (messages.some((m) => m.kind === "ENGINE")) return "ERROR";
  if (messages.some((m) => m.severity === "ERROR")) return "INVALID";
  if (messages.some((m) => m.severity === "WARNING")) return "VALID_WITH_WARNINGS";
  return "SUCCESS";
}

export function isSuccessStatus(status: RuleEngineResponseStatus): boolean {
  return status === "SUCCESS" || status === "VALID_WITH_WARNINGS";
}

/** Internal: assemble a response from ordered messages. `data` is discarded unless the status is a success. */
export function assembleResponse<T>(parts: {
  evaluationKind: string | null;
  messages: readonly RuleMessage[];
  data: T | null;
  trace: CalculationTrace;
  ruleset: RulesetProvenance | null;
}): RuleEngineResponse<T> {
  const status = deriveResponseStatus(parts.messages);
  const success = isSuccessStatus(status);
  return {
    contractVersion: RULES_ENGINE_CONTRACT_VERSION,
    evaluationKind: parts.evaluationKind,
    success,
    status,
    data: success ? parts.data : null,
    errors: parts.messages.filter((m) => m.severity === "ERROR"),
    warnings: parts.messages.filter((m): m is ValidationMessage => m.kind === "VALIDATION" && m.severity === "WARNING"),
    info: parts.messages.filter((m): m is ValidationMessage => m.kind === "VALIDATION" && m.severity === "INFO"),
    trace: parts.trace,
    ruleset: parts.ruleset,
  };
}
