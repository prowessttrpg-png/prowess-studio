import type { JsonObject } from "@prowess/model";
import { evaluate } from "../evaluation/evaluate.js";
import { RulesEngineError, type EngineError, type RuleEngineErrorCode } from "../errors/engine-error.js";
import { canonicalJson } from "../internal/canonical-json.js";
import { InputProblems } from "../internal/input-reader.js";
import { clonePlainData, inspectPlainData, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { numberValue, stringValue } from "../result/evaluation-value.js";
import { readProvenance } from "../result/provenance.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import type { TraceInput, TraceStepInput } from "../trace/calculation-trace.js";
import { isExactLabel } from "../requirement/validate.js";
import {
  isValidValidationCode,
  validationMessage,
  VALIDATION_CATEGORIES,
  VALIDATION_SEVERITIES,
  type ValidationCategory,
  type ValidationMessageDraft,
  type ValidationSeverity,
} from "../validation/validation-message.js";
import {
  VALIDATION_CHECK_OUTCOMES,
  VALIDATION_DIAGNOSTIC_CODES,
  VALIDATION_LIMITS,
  type ValidationCheck,
  type ValidationCheckOutcome,
  type ValidationCheckResult,
  type ValidationDiagnosticCode,
  type ValidationSourceResult,
  type ValidationSummary,
} from "./model.js";
import { readSourceResponse, type ReadSource } from "./source.js";

/**
 * Validation evaluation (PAS-10 M4-WO8 §15–74, §91–98).
 *
 *  1. Read the request strictly. Every malformed check or source is reported (VALIDATION.*) — one bad item never hides
 *     another — and conflicting duplicate keys fail closed; identical duplicates collapse.
 *  2. Order all contributions — sources and checks together — by `order`, then key (code units), sources before checks
 *     on a full tie. Input array order never matters.
 *  3. Emit findings in that order: a source's own messages in its original ordinal order, PRESERVED (code, severity,
 *     category, path, provenance, details unchanged); a check's declared finding only when its outcome is FAIL. Nothing
 *     short-circuits; every finding is collected. Nothing is recalculated, interpreted or reclassified.
 *  4. Final ordinals are re-assigned by the M4-WO1 boundary in that emission order; the trace maps every finding back to
 *     its contribution and original ordinal.
 *
 * Status follows M4-WO1 exactly: any ERROR → INVALID (data null); warnings only → VALID_WITH_WARNINGS; otherwise
 * SUCCESS. A source carrying ENGINE errors makes the combined evaluation an engine failure (status ERROR) — engine
 * errors are never turned into validation findings.
 */

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const CHECK_FIELDS = ["checkKey", "order", "category", "outcome", "failureSeverity", "code", "path", "message", "provenance", "details"];
const SOURCE_FIELDS = ["sourceKey", "order", "response"];
const MAX_MESSAGE_LENGTH = 10_000;

/** A plain object whose keys are all own data properties within `allowed` (getters are never invoked). */
function ownRecord(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  // Counted rather than `every`, so this module contains no early-exit array method at all (the no-short-circuit audit).
  const disallowed = Object.keys(value).filter((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return !allowed.includes(k) || d === undefined || d.get !== undefined || d.set !== undefined;
  });
  return disallowed.length === 0;
}

/** Plain-data check that cannot crash on pathological nesting. */
function safelyPlain(value: unknown): boolean {
  try {
    return inspectPlainData(value).length === 0;
  } catch {
    return false;
  }
}

interface ReadCheck extends ValidationCheck {
  readonly inputIndex: number;
}
interface ReadSourceEntry {
  readonly sourceKey: string;
  readonly order: number;
  readonly read: ReadSource;
  readonly signature: string;
}
type Contribution = { readonly type: "source"; readonly entry: ReadSourceEntry } | { readonly type: "check"; readonly entry: ReadCheck };

export interface EvaluateValidationOptions {
  /** The exact RulesetContext the evaluation runs under; recorded verbatim as response provenance, never searched. */
  readonly ruleset?: unknown;
}

/** The evaluation kind `evaluateValidation` uses on the M4-WO1 boundary. */
export const VALIDATION_EVALUATION_KIND = "validation.evaluate";

/**
 * Combines `{ sources?, checks? }` into one M4-WO1 RuleEngineResponse<ValidationSummary>. Pure: no source is re-run,
 * no input is mutated or frozen, and the same request (in any array order) gives a byte-identical response.
 */
export function evaluateValidation(request: unknown, options: EvaluateValidationOptions = {}): RuleEngineResponse<ValidationSummary> {
  return evaluate<ValidationSummary | null>(
    {
      kind: VALIDATION_EVALUATION_KIND,
      evaluate: () => {
        const input: ValidationMessageDraft[] = [];
        const own = (code: ValidationDiagnosticCode, message: string, path: readonly (string | number)[], details: JsonObject | null = null) =>
          input.push(validationMessage({ severity: "ERROR", category: "STRUCTURE", code, message, path: jsonPointer(path), details }));

        if (!ownRecord(request, ["sources", "checks"])) {
          own(VALIDATION_DIAGNOSTIC_CODES.INVALID_REQUEST, "a validation request is a plain { sources?, checks? }", []);
          return { data: null, messages: input };
        }
        const rawSources: unknown = request.sources ?? [];
        const rawChecks: unknown = request.checks ?? [];
        if (!Array.isArray(rawSources) || !Array.isArray(rawChecks)) {
          own(VALIDATION_DIAGNOSTIC_CODES.INVALID_REQUEST, "sources and checks must be arrays", []);
          return { data: null, messages: input };
        }
        if (rawSources.length > VALIDATION_LIMITS.MAX_SOURCES) {
          own(VALIDATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `at most ${VALIDATION_LIMITS.MAX_SOURCES} sources`, ["sources"]);
          return { data: null, messages: input };
        }
        if (rawChecks.length > VALIDATION_LIMITS.MAX_CHECKS) {
          own(VALIDATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `at most ${VALIDATION_LIMITS.MAX_CHECKS} checks`, ["checks"]);
          return { data: null, messages: input };
        }

        // 1a. Sources, in input order: every malformed one is reported.
        const sources: ReadSourceEntry[] = [];
        rawSources.forEach((s: unknown, i: number) => {
          if (!ownRecord(s, SOURCE_FIELDS) || !isExactLabel(s.sourceKey) || typeof s.order !== "number" || !Number.isSafeInteger(s.order)) {
            return void own(VALIDATION_DIAGNOSTIC_CODES.INVALID_SOURCE, "a source is { sourceKey: exact label, order: integer, response }", ["sources", i]);
          }
          const read = readSourceResponse(s.response);
          if (typeof read === "string") return void own(VALIDATION_DIAGNOSTIC_CODES.INVALID_SOURCE, `source "${s.sourceKey}": ${read}`, ["sources", i, "response"], { sourceKey: s.sourceKey });
          sources.push({ sourceKey: s.sourceKey, order: s.order, read, signature: canonicalJson({ order: s.order, response: s.response }) });
        });

        // 1b. Checks, in input order.
        const checks: ReadCheck[] = [];
        rawChecks.forEach((c: unknown, i: number) => {
          const at = ["checks", i];
          if (!ownRecord(c, CHECK_FIELDS)) return void own(VALIDATION_DIAGNOSTIC_CODES.INVALID_CHECK, `a check is a plain object with only ${CHECK_FIELDS.join(", ")} (no callbacks)`, at);
          const problems: string[] = [];
          if (!isExactLabel(c.checkKey)) problems.push("checkKey");
          if (typeof c.order !== "number" || !Number.isSafeInteger(c.order)) problems.push("order");
          if (!(VALIDATION_CATEGORIES as readonly unknown[]).includes(c.category)) problems.push("category");
          if (!(VALIDATION_CHECK_OUTCOMES as readonly unknown[]).includes(c.outcome)) problems.push("outcome");
          if (!(VALIDATION_SEVERITIES as readonly unknown[]).includes(c.failureSeverity)) problems.push("failureSeverity");
          if (c.message !== undefined && c.message !== null && (typeof c.message !== "string" || c.message.length > MAX_MESSAGE_LENGTH)) problems.push("message");
          const provenanceProblems = new InputProblems();
          const provenance = readProvenance(c.provenance, [], provenanceProblems);
          if (provenanceProblems.count > 0) problems.push("provenance");
          if (c.details !== undefined && c.details !== null && (!isPlainObject(c.details) || !safelyPlain(c.details))) problems.push("details");
          if (problems.length > 0) {
            return void own(VALIDATION_DIAGNOSTIC_CODES.INVALID_CHECK, `malformed check (${problems.join(", ")})`, at, { invalidFields: problems });
          }
          if (!isValidValidationCode(c.code) || (c.code as string).startsWith("VALIDATION.")) {
            return void own(VALIDATION_DIAGNOSTIC_CODES.INVALID_CODE, "code must be a namespaced upper-case code outside the reserved RULE_ENGINE.* and VALIDATION.* namespaces", [...at, "code"]);
          }
          const path = c.path === undefined ? null : c.path;
          if (path !== null && (typeof path !== "string" || (path !== "" && !path.startsWith("/")) || path.length > MAX_MESSAGE_LENGTH)) {
            return void own(VALIDATION_DIAGNOSTIC_CODES.INVALID_PATH, "path must be an RFC 6901 JSON Pointer (e.g. /build/components/2) or null", [...at, "path"]);
          }
          checks.push({
            checkKey: c.checkKey as string,
            order: c.order as number,
            category: c.category as ValidationCategory,
            outcome: c.outcome as ValidationCheckOutcome,
            failureSeverity: c.failureSeverity as ValidationSeverity,
            code: c.code as string,
            path: path as string | null,
            message: (c.message as string | null | undefined) ?? null,
            provenance,
            details: c.details === undefined || c.details === null ? null : (clonePlainData(c.details) as JsonObject),
            inputIndex: i,
          });
        });

        // 1c. Duplicate identities, in sorted key order: identical collapse, conflicting fail closed.
        const collapse = <T>(items: readonly T[], keyOf: (t: T) => string, signatureOf: (t: T) => string, code: ValidationDiagnosticCode, path: string, label: string): T[] => {
          const groups = new Map<string, T[]>();
          for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
          const out: T[] = [];
          for (const key of [...groups.keys()].sort(byCodeUnit)) {
            const members = groups.get(key) as T[];
            if (new Set(members.map(signatureOf)).size > 1) own(code, `${label} "${key}" is supplied with conflicting content`, [path], { key });
            else out.push(members[0] as T);
          }
          return out;
        };
        const uniqueSources = collapse(sources, (s) => s.sourceKey, (s) => s.signature, VALIDATION_DIAGNOSTIC_CODES.DUPLICATE_SOURCE, "sources", "sourceKey");
        const uniqueChecks = collapse(checks, (c) => c.checkKey, (c) => canonicalJson(Object.fromEntries(Object.entries(c).filter(([field]) => field !== "inputIndex"))), VALIDATION_DIAGNOSTIC_CODES.DUPLICATE_CHECK, "checks", "checkKey");

        // A source that failed with ENGINE errors makes this an engine failure — only when the input itself is sound.
        const engineErrors = uniqueSources.flatMap((s) => s.read.messages.filter((m): m is EngineError => m.kind === "ENGINE").map((m) => ({ s, m })));
        if (input.length === 0 && engineErrors.length > 0) {
          const first = engineErrors[0] as { s: ReadSourceEntry; m: EngineError };
          throw new RulesEngineError(first.m.code as RuleEngineErrorCode, `validation source "${first.s.sourceKey}" reported an engine failure: ${first.m.message}`, {
            path: first.m.path,
            details: { sourceEngineErrors: engineErrors.map(({ s, m }) => ({ sourceKey: s.sourceKey, code: m.code, message: m.message, path: m.path })) },
          });
        }

        // 2. Contribution order: order, then key, sources before checks on a full tie.
        const contributions: Contribution[] = [
          ...uniqueSources.map((entry): Contribution => ({ type: "source", entry })),
          ...uniqueChecks.map((entry): Contribution => ({ type: "check", entry })),
        ].sort((a, b) => {
          const ka = a.type === "source" ? a.entry.sourceKey : a.entry.checkKey;
          const kb = b.type === "source" ? b.entry.sourceKey : b.entry.checkKey;
          return a.entry.order - b.entry.order || byCodeUnit(ka, kb) || (a.type === b.type ? 0 : a.type === "source" ? -1 : 1);
        });

        // Limit on findings — fail closed, never truncate.
        const findingCount =
          input.length +
          uniqueSources.reduce((n, s) => n + s.read.messages.filter((m) => m.kind === "VALIDATION").length, 0) +
          uniqueChecks.filter((c) => c.outcome === "FAIL").length;
        if (findingCount > VALIDATION_LIMITS.MAX_FINDINGS) {
          const limited: ValidationMessageDraft[] = [];
          limited.push(validationMessage({ severity: "ERROR", category: "STRUCTURE", code: VALIDATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, message: `at most ${VALIDATION_LIMITS.MAX_FINDINGS} findings (got ${findingCount}); nothing is dropped silently`, path: "", details: { findingCount } }));
          return { data: null, messages: limited };
        }

        // 3. Emit findings in contribution order; every finding, no short-circuit.
        const messages: ValidationMessageDraft[] = [...input];
        const steps: TraceStepInput[] = contributions.map((c, ci) => {
          if (c.type === "source") {
            const s = c.entry;
            const findingSteps: TraceStepInput[] = s.read.messages
              .filter((m) => m.kind === "VALIDATION")
              .map((m, fi) => {
                const v = m as unknown as ValidationMessageDraft & { ordinal: number };
                messages.push(validationMessage({ severity: v.severity, category: v.category, code: v.code, message: v.message, path: v.path, provenance: v.provenance, details: v.details }));
                return {
                  key: `finding.${fi}`,
                  operation: "validation.finding",
                  inputs: [
                    { name: "final_ordinal", value: numberValue(messages.length - 1) },
                    { name: "original_ordinal", value: numberValue(v.ordinal) },
                    { name: "code", value: stringValue(v.code) },
                    { name: "severity", value: stringValue(v.severity) },
                    { name: "category", value: stringValue(v.category) },
                  ],
                };
              });
            return {
              key: `contribution.${ci}`,
              operation: "validation.source",
              inputs: [
                { name: "source_key", value: stringValue(s.sourceKey) },
                { name: "order", value: numberValue(s.order) },
                { name: "source_status", value: stringValue(s.read.status) },
              ],
              children: findingSteps,
            };
          }
          const k = c.entry;
          const inputs: TraceInput[] = [
            { name: "check_key", value: stringValue(k.checkKey) },
            { name: "order", value: numberValue(k.order) },
            { name: "outcome", value: stringValue(k.outcome) },
            { name: "category", value: stringValue(k.category) },
          ];
          if (k.outcome === "FAIL") {
            messages.push(
              validationMessage({
                severity: k.failureSeverity,
                category: k.category,
                code: k.code,
                message: k.message ?? `validation check "${k.checkKey}" failed`,
                path: k.path,
                provenance: k.provenance,
                details: k.details,
              }),
            );
            inputs.push(
              { name: "severity", value: stringValue(k.failureSeverity) },
              { name: "code", value: stringValue(k.code) },
              ...(k.path === null ? [] : [{ name: "path", value: stringValue(k.path) }]),
              { name: "final_ordinal", value: numberValue(messages.length - 1) },
            );
          }
          return { key: `contribution.${ci}`, operation: "validation.check", inputs, provenance: k.provenance };
        });

        // 4. Summary (kept by M4-WO1 only when there is no ERROR).
        const count = (severity: ValidationSeverity) => messages.filter((m) => m.severity === severity).length;
        const categoryCounts: Partial<Record<ValidationCategory, number>> = {};
        for (const m of messages) categoryCounts[m.category] = (categoryCounts[m.category] ?? 0) + 1;
        const checkResults: ValidationCheckResult[] = contributions
          .filter((c): c is Extract<Contribution, { type: "check" }> => c.type === "check")
          .map(({ entry: k }) => ({ checkKey: k.checkKey, order: k.order, outcome: k.outcome, category: k.category, severity: k.outcome === "FAIL" ? k.failureSeverity : null }));
        const sourceResults: ValidationSourceResult[] = contributions
          .filter((c): c is Extract<Contribution, { type: "source" }> => c.type === "source")
          .map(({ entry: s }) => ({
            sourceKey: s.sourceKey,
            order: s.order,
            status: s.read.status,
            errorCount: s.read.messages.filter((m) => m.severity === "ERROR").length,
            warningCount: s.read.messages.filter((m) => m.severity === "WARNING").length,
            infoCount: s.read.messages.filter((m) => m.severity === "INFO").length,
          }));
        const summary: ValidationSummary = {
          valid: true,
          errorCount: count("ERROR"),
          warningCount: count("WARNING"),
          infoCount: count("INFO"),
          checkCounts: {
            PASS: checkResults.filter((r) => r.outcome === "PASS").length,
            FAIL: checkResults.filter((r) => r.outcome === "FAIL").length,
            NOT_APPLICABLE: checkResults.filter((r) => r.outcome === "NOT_APPLICABLE").length,
          },
          categoryCounts,
          checks: checkResults,
          sources: sourceResults,
        };
        return { data: summary, messages, trace: [{ key: "validation", operation: VALIDATION_EVALUATION_KIND, children: steps }] };
      },
    },
    { kind: VALIDATION_EVALUATION_KIND, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<ValidationSummary>;
}
