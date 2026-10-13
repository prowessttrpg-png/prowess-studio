import { RULES_ENGINE_CONTRACT_VERSION } from "../contract-version.js";
import { isRuleEngineErrorCode, type EngineError } from "../errors/engine-error.js";
import { inspectPlainData, isPlainObject } from "../internal/plain-data.js";
import { deriveResponseStatus, isSuccessStatus, RULE_ENGINE_RESPONSE_STATUSES, type RuleEngineResponseStatus, type RuleMessage } from "../result/rule-engine-response.js";
import { validationMessage, type ValidationMessage } from "../validation/validation-message.js";

/**
 * Safe reading of a caller-supplied source RuleEngineResponse (PAS-10 M4-WO8 §28–36). A source is an exact, already
 * computed response; this module only checks that it really is a well-formed M4-WO1 response and extracts its
 * messages in their original ordinal order. It never re-runs, interprets or rewrites anything: business data (a
 * Requirement outcome, a Resource snapshot, a Modifier result) is ignored, so `satisfied: false`, `canPay: false` or
 * SKIPPED_CONDITION never become findings by themselves.
 */
export interface ReadSource {
  readonly status: RuleEngineResponseStatus;
  /** Every message, in the source's own ordinal order. */
  readonly messages: readonly RuleMessage[];
}

const RESPONSE_FIELDS = ["contractVersion", "evaluationKind", "success", "status", "data", "errors", "warnings", "info", "trace", "ruleset"];
const VALIDATION_FIELDS = ["kind", "ordinal", "severity", "category", "code", "message", "path", "provenance", "details"];
const ENGINE_FIELDS = ["kind", "ordinal", "severity", "code", "message", "path", "details"];
const LIST_NAME = { ERROR: "errors", WARNING: "warnings", INFO: "info" } as const;

/** A plain object whose keys are exactly `fields` (own data properties; getters are never invoked). */
function exactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === fields.length &&
    keys.every((k) => {
      const d = Object.getOwnPropertyDescriptor(value, k);
      return fields.includes(k) && d !== undefined && d.get === undefined && d.set === undefined;
    })
  );
}

function readMessage(value: unknown, expected: "ERROR" | "WARNING" | "INFO"): RuleMessage | string {
  if (isPlainObject(value) && value.kind === "ENGINE") {
    if (expected !== "ERROR" || !exactRecord(value, ENGINE_FIELDS)) return "an engine error must sit in errors with exactly the M4-WO1 engine-error fields";
    if (value.severity !== "ERROR" || !isRuleEngineErrorCode(value.code) || typeof value.message !== "string") return "malformed engine error";
    if (value.path !== null && typeof value.path !== "string") return "malformed engine error path";
    if (value.details !== null && !isPlainObject(value.details)) return "malformed engine error details";
    return value as unknown as EngineError;
  }
  if (!exactRecord(value, VALIDATION_FIELDS) || value.kind !== "VALIDATION") return "a message must have exactly the M4-WO1 validation-message fields";
  if (value.severity !== expected) return `a ${String(value.severity)} message is in the ${LIST_NAME[expected]} list`;
  try {
    // Re-validated by M4-WO1's own constructor — category, code, path, provenance, details.
    validationMessage({
      severity: value.severity as "ERROR",
      category: value.category as "STRUCTURE",
      code: value.code as string,
      message: value.message as string,
      path: value.path as string | null,
      provenance: value.provenance as null,
      details: value.details as null,
    });
  } catch {
    return `malformed ${expected} message (category, code, path, provenance or details)`;
  }
  return value as unknown as ValidationMessage;
}

export function readSourceResponse(response: unknown): ReadSource | string {
  let problems: ReturnType<typeof inspectPlainData>;
  try {
    problems = inspectPlainData(response);
  } catch {
    return "the response is too deeply nested to inspect safely";
  }
  if (problems.length > 0) return `the response is not plain data (${problems[0]?.path || "/"}: ${problems[0]?.reason ?? ""})`;
  if (!exactRecord(response, RESPONSE_FIELDS)) return "the response must have exactly the M4-WO1 RuleEngineResponse fields";
  if (response.contractVersion !== RULES_ENGINE_CONTRACT_VERSION) return "unsupported contractVersion";
  if (!(RULE_ENGINE_RESPONSE_STATUSES as readonly unknown[]).includes(response.status)) return "invalid status";
  const status = response.status as RuleEngineResponseStatus;
  if (response.success !== isSuccessStatus(status)) return "success contradicts status";
  if (!response.success && response.data !== null) return "an unsuccessful response must carry data: null";
  if (!Array.isArray(response.errors) || !Array.isArray(response.warnings) || !Array.isArray(response.info)) return "errors, warnings and info must be arrays";

  const messages: RuleMessage[] = [];
  for (const [list, severity] of [[response.errors, "ERROR"], [response.warnings, "WARNING"], [response.info, "INFO"]] as const) {
    for (const value of list as unknown[]) {
      const read = readMessage(value, severity);
      if (typeof read === "string") return read;
      messages.push(read);
    }
  }
  const ordinals = messages.map((m) => m.ordinal);
  if (!ordinals.every((o) => typeof o === "number" && Number.isSafeInteger(o) && o >= 0)) return "message ordinals must be non-negative integers";
  if (new Set(ordinals).size !== ordinals.length) return "message ordinals must be unique across errors, warnings and info";
  if (deriveResponseStatus(messages) !== status) return "status does not match the messages";
  return { status, messages: [...messages].sort((a, b) => a.ordinal - b.ordinal) };
}
