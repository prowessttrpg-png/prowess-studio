import { DomainError, type JsonObject } from "@prowess/model";
import { clonePlainData, deepFreeze, inspectPlainData, isPlainObject } from "../internal/plain-data.js";

/**
 * Rules Engine error vocabulary (PAS-10 M4-WO1 §19, §37–38).
 *
 * An ENGINE error means the engine could not evaluate at all: the input is malformed, a number is not finite, a
 * required context is absent, or an internal invariant broke. It is never a statement about the rules being
 * evaluated. A rule outcome (a future unmet Requirement, an over-capacity build) is a VALIDATION message instead —
 * see `validation/validation-message.ts`. The two never collapse into one opaque string: they are distinct types,
 * distinguished by `kind`, and validation messages may not use the `RULE_ENGINE.*` namespace.
 *
 * The codes follow the repository's DomainError convention (`NAMESPACE.REASON`, a frozen `as const` vocabulary plus a
 * union type). They live in @prowess/rules, not @prowess/model, because they are engine-specific contracts (§7). M4-WO1
 * adds no HTTP route, and the central HTTP status map is keyed by @prowess/model's vocabularies only, so no status
 * mapping is required yet; M4-WO10 owns mapping these codes when the Rules HTTP API exists.
 *
 * Only the codes M4-WO1 actually raises exist. Later Work Orders append their own (e.g. an unsupported formula
 * operation in M4-WO3).
 */
export const RULE_ENGINE_ERROR_CODES = deepFreeze({
  /** The evaluation input is malformed: wrong shape, unknown field, invalid identifier or key, duplicate set member. */
  INVALID_INPUT: "RULE_ENGINE.INVALID_INPUT",
  /** A number at the public boundary is NaN, Infinity or -Infinity. */
  NON_FINITE_NUMBER: "RULE_ENGINE.NON_FINITE_NUMBER",
  /** The evaluation requires a context family (Ruleset / Actor / Build / Runtime) the request does not supply. */
  MISSING_CONTEXT: "RULE_ENGINE.MISSING_CONTEXT",
  /** An internal engine invariant broke — e.g. an evaluator produced malformed or non-serializable output. A defect. */
  INVARIANT_VIOLATION: "RULE_ENGINE.INVARIANT_VIOLATION",
} as const);

export type RuleEngineErrorCode = (typeof RULE_ENGINE_ERROR_CODES)[keyof typeof RULE_ENGINE_ERROR_CODES];

const ENGINE_ERROR_CODE_VALUES: readonly string[] = Object.values(RULE_ENGINE_ERROR_CODES);

export function isRuleEngineErrorCode(value: unknown): value is RuleEngineErrorCode {
  return typeof value === "string" && ENGINE_ERROR_CODE_VALUES.includes(value);
}

/** The namespace prefix reserved for engine errors. */
export const RULE_ENGINE_ERROR_NAMESPACE = "RULE_ENGINE";

/**
 * A structured, serializable engine error as it appears in results. Plain data only: no stack trace, no cause chain,
 * no function, no circular reference (§79).
 *
 *  - `ordinal`  position among all messages of one outcome, in emission order (§54)
 *  - `path`     RFC 6901 JSON Pointer into the evaluation input, or null when the error is not about one location
 */
export interface EngineError {
  readonly kind: "ENGINE";
  readonly ordinal: number;
  readonly severity: "ERROR";
  readonly code: RuleEngineErrorCode;
  readonly message: string;
  readonly path: string | null;
  readonly details: JsonObject | null;
}

/** What raises an engine error: everything except the ordinal, which the collecting outcome assigns. */
export interface EngineErrorInput {
  readonly code: RuleEngineErrorCode;
  readonly message: string;
  readonly path?: string | null;
  readonly details?: JsonObject | null;
}

function safeDetails(details: unknown): JsonObject | null {
  if (details === undefined || details === null) return null;
  if (!isPlainObject(details) || inspectPlainData(details).length > 0) return null;
  return clonePlainData(details) as JsonObject;
}

/** Freezes engine-error inputs into result form, numbering them from `firstOrdinal` in the given order. */
export function toEngineErrors(inputs: readonly EngineErrorInput[], firstOrdinal = 0): EngineError[] {
  return inputs.map((input, index) =>
    deepFreeze({
      kind: "ENGINE" as const,
      ordinal: firstOrdinal + index,
      severity: "ERROR" as const,
      code: input.code,
      message: input.message,
      path: input.path ?? null,
      details: safeDetails(input.details),
    }),
  );
}

/**
 * The thrown form of an engine error, for evaluator code that must abort mid-evaluation. Extends the shared
 * `DomainError` so any caller already handling the domain error vocabulary recognizes it. `evaluate` converts it back
 * into an `EngineError` value inside an `ERROR` response; nothing else in the package lets it escape.
 */
export class RulesEngineError extends DomainError {
  declare readonly code: RuleEngineErrorCode;
  readonly path: string | null;
  readonly details: JsonObject | null;

  constructor(code: RuleEngineErrorCode, message: string, options: { path?: string | null; details?: JsonObject | null } = {}) {
    super(code, message);
    this.name = "RulesEngineError";
    this.path = options.path ?? null;
    this.details = safeDetails(options.details);
  }

  /** The serializable form: code, message, path and details only — never the stack (§79). */
  toInput(): EngineErrorInput {
    return { code: this.code, message: this.message, path: this.path, details: this.details };
  }
}

export function isRulesEngineError(value: unknown): value is RulesEngineError {
  return value instanceof RulesEngineError;
}
