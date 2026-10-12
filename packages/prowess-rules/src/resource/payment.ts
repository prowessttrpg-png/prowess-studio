import { isValidContextKey } from "../context/context-key.js";
import { evaluate } from "../evaluation/evaluate.js";
import { deepFreeze, jsonPointer } from "../internal/plain-data.js";
import { booleanValue, numberValue, stringValue } from "../result/evaluation-value.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import type { TraceStepInput } from "../trace/calculation-trace.js";
import { isExactLabel } from "../requirement/validate.js";
import {
  RESOURCE_DIAGNOSTIC_CODES,
  RESOURCE_LIMITS,
  type PaymentAllocation,
  type PaymentMode,
  type PaymentRequest,
  type PaymentResult,
  type PaymentSource,
  type ResourceDiagnostic,
  type ResourceDiagnosticCode,
  type ResourceSnapshot,
  type ResourceState,
} from "./model.js";
import { byCodeUnit, createResourceSnapshot, isFiniteNumber, ownRecord, readProvenanceField, zero } from "./snapshot.js";
import { replaceResource, toResourceMessages, type ResourceOperationOptions } from "./transition.js";

/**
 * Ordered multi-source payment (PAS-10 M4-WO7 §51–78, §110–113, §121–123).
 *
 * Payment pays an ALREADY-CALCULATED `listedAmount`. It chooses sources; it never changes the listed amount, never
 * produces an "effective cost", and never re-runs a Formula or Modifier.
 *
 * ONE allocation algorithm serves both preview and apply: sources in explicit order (`order` ASC, then `resourceKey`
 * in code-unit order — input order and resource kind are irrelevant); each pays `min(remaining, current − minimum,
 * limit)`. Reserved capacity does not reduce what a source can pay. The new snapshot is built only when the whole
 * amount is covered; otherwise the payment is atomic — `canPay: false`, a shortfall, and the original state unchanged.
 */

const PAYMENT_FIELDS = ["costKey", "listedAmount", "sources", "provenance"];
const SOURCE_FIELDS = ["resourceKey", "order", "limit", "provenance"];

function readPayment(
  input: unknown,
  report: (code: ResourceDiagnosticCode, message: string, path: readonly (string | number)[], resourceKey?: string | null) => void,
): PaymentRequest | null {
  if (!ownRecord(input, PAYMENT_FIELDS) || !Array.isArray(input.sources)) {
    report(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, `a payment is a plain { ${PAYMENT_FIELDS.join(", ")} } with sources[]`, []);
    return null;
  }
  let ok = true;
  const bad = (code: ResourceDiagnosticCode, message: string, path: readonly (string | number)[], key: string | null = null) => {
    ok = false;
    report(code, message, path, key);
  };
  if (!isExactLabel(input.costKey)) bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, "costKey must be an exact non-empty label", ["costKey"]);
  if (!isFiniteNumber(input.listedAmount) || input.listedAmount < 0) bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_AMOUNT, "listedAmount must be a finite number ≥ 0", ["listedAmount"]);
  const provenance = readProvenanceField(input.provenance);
  if (provenance === undefined) bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, "provenance is malformed", ["provenance"]);
  if (input.sources.length > RESOURCE_LIMITS.MAX_PAYMENT_SOURCES) {
    bad(RESOURCE_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `at most ${RESOURCE_LIMITS.MAX_PAYMENT_SOURCES} payment sources`, ["sources"]);
    return null;
  }
  const sources: PaymentSource[] = [];
  const seen = new Set<string>();
  input.sources.forEach((s: unknown, i: number) => {
    const at = ["sources", i];
    if (!ownRecord(s, SOURCE_FIELDS)) return void bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, `a source is a plain { ${SOURCE_FIELDS.join(", ")} }`, at);
    if (!isValidContextKey(s.resourceKey)) return void bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, "resourceKey must be an exact context key", [...at, "resourceKey"]);
    const key = s.resourceKey;
    if (seen.has(key)) return void bad(RESOURCE_DIAGNOSTIC_CODES.DUPLICATE_PAYMENT_SOURCE, `resource "${key}" appears twice in one payment`, [...at, "resourceKey"], key);
    seen.add(key);
    if (typeof s.order !== "number" || !Number.isSafeInteger(s.order)) return void bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, "order must be an integer", [...at, "order"], key);
    const limit = s.limit === undefined || s.limit === null ? null : s.limit;
    if (limit !== null && (!isFiniteNumber(limit) || limit < 0)) return void bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, "limit must be a finite number ≥ 0 or null", [...at, "limit"], key);
    const sp = readProvenanceField(s.provenance);
    if (sp === undefined) return void bad(RESOURCE_DIAGNOSTIC_CODES.INVALID_PAYMENT, "provenance is malformed", [...at, "provenance"], key);
    sources.push({ resourceKey: key, order: zero(s.order), limit: limit === null ? null : zero(limit as number), provenance: sp });
  });
  if (!ok) return null;
  return { costKey: input.costKey as string, listedAmount: zero(input.listedAmount as number), sources, provenance: provenance ?? null };
}

/**
 * The single allocation algorithm. Pure: reads the snapshot through a key index built once, never writes to it.
 * Returns the ordered allocations, totals, and the resulting snapshot (the original one unless fully payable).
 */
function allocatePayment(snapshot: ResourceSnapshot, payment: PaymentRequest): Omit<PaymentResult, "mode"> {
  const byKey = new Map<string, ResourceState>(snapshot.resources.map((r) => [r.resourceKey, r]));
  const ordered = [...payment.sources].sort((a, b) => a.order - b.order || byCodeUnit(a.resourceKey, b.resourceKey));
  let remaining = payment.listedAmount;
  const allocations: PaymentAllocation[] = ordered.map((source) => {
    const state = byKey.get(source.resourceKey) as ResourceState;
    const available = zero(state.current - state.minimum);
    const capacity = source.limit === null ? available : Math.min(available, source.limit);
    const amountPaid = zero(Math.min(remaining, capacity));
    const requestedRemainingBefore = remaining;
    remaining = zero(remaining - amountPaid);
    return {
      resourceKey: source.resourceKey,
      order: source.order,
      requestedRemainingBefore,
      available,
      sourceLimit: source.limit,
      amountPaid,
      currentBefore: state.current,
      currentAfter: zero(state.current - amountPaid),
      provenance: source.provenance,
    };
  });
  const canPay = remaining === 0;
  let resulting = snapshot;
  if (canPay) {
    for (const a of allocations) if (a.amountPaid !== 0) resulting = replaceResource(resulting, { ...(byKey.get(a.resourceKey) as ResourceState), current: a.currentAfter });
  }
  return {
    costKey: payment.costKey,
    listedAmount: payment.listedAmount,
    canPay,
    totalPaid: zero(payment.listedAmount - remaining),
    shortfall: remaining,
    allocations,
    provenance: payment.provenance,
    originalResources: snapshot,
    resultingResources: resulting,
  };
}

function settlementTrace(result: PaymentResult): TraceStepInput[] {
  return [
    {
      key: "payment",
      operation: `resource.payment.${result.mode === "PREVIEW" ? "preview" : "apply"}`,
      inputs: [
        { name: "cost_key", value: stringValue(result.costKey) },
        { name: "listed_amount", value: numberValue(result.listedAmount) },
      ],
      provenance: result.provenance,
      children: [
        ...result.allocations.map((a, i) => ({
          key: `source.${i}`,
          operation: "resource.payment.source",
          inputs: [
            { name: "resource_key", value: stringValue(a.resourceKey) },
            { name: "order", value: numberValue(a.order) },
            { name: "remaining_before", value: numberValue(a.requestedRemainingBefore) },
            { name: "available", value: numberValue(a.available) },
            ...(a.sourceLimit === null ? [] : [{ name: "limit", value: numberValue(a.sourceLimit) }]),
            { name: "current_before", value: numberValue(a.currentBefore) },
            { name: "paid", value: numberValue(a.amountPaid) },
            { name: "current_after", value: numberValue(a.currentAfter) },
          ],
          output: numberValue(a.amountPaid),
          provenance: a.provenance,
        })),
        {
          key: "settlement",
          operation: "resource.payment.settlement",
          inputs: [
            { name: "listed_amount", value: numberValue(result.listedAmount) },
            { name: "total_paid", value: numberValue(result.totalPaid) },
            { name: "shortfall", value: numberValue(result.shortfall) },
          ],
          output: booleanValue(result.canPay),
        },
      ],
    },
  ];
}

function runPayment(mode: PaymentMode, snapshotInput: unknown, paymentInput: unknown, options: ResourceOperationOptions): RuleEngineResponse<PaymentResult> {
  const kind = `resource.payment.${mode === "PREVIEW" ? "preview" : "apply"}`;
  return evaluate<PaymentResult | null>(
    {
      kind,
      evaluate: () => {
        const diagnostics: ResourceDiagnostic[] = [];
        const snapshot = createResourceSnapshot(snapshotInput, ["snapshot"]);
        if (!snapshot.ok) diagnostics.push(...snapshot.diagnostics);
        const payment = readPayment(paymentInput, (code, message, path, resourceKey = null) =>
          diagnostics.push({ code, message, path: jsonPointer(["payment", ...path]), resourceKey }),
        );
        if (snapshot.ok && payment !== null) {
          const present = new Set(snapshot.snapshot.resources.map((r) => r.resourceKey));
          payment.sources.forEach((s) => {
            if (!present.has(s.resourceKey)) {
              const i = (paymentInput as { sources: { resourceKey?: unknown }[] }).sources.findIndex((x) => x.resourceKey === s.resourceKey);
              diagnostics.push({ code: RESOURCE_DIAGNOSTIC_CODES.NOT_FOUND, message: `payment source "${s.resourceKey}" is not in the snapshot`, path: jsonPointer(["payment", "sources", i, "resourceKey"]), resourceKey: s.resourceKey });
            }
          });
        }
        if (diagnostics.length > 0 || !snapshot.ok || payment === null) return { data: null, messages: toResourceMessages(diagnostics) };
        const result = deepFreeze({ mode, ...allocatePayment(snapshot.snapshot, payment) });
        return { data: result, trace: settlementTrace(result) };
      },
    },
    { kind, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<PaymentResult>;
}

/** Shows how an already-calculated listed amount would be paid, and the projected state. Changes nothing. */
export function previewResourcePayment(snapshot: unknown, payment: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<PaymentResult> {
  return runPayment("PREVIEW", snapshot, payment, options);
}

/**
 * Computes the resulting immutable state of paying the listed amount — the same allocation as preview. "Apply" means
 * compute; nothing is persisted. Insufficient → canPay:false, original state returned unchanged (atomic).
 */
export function applyResourcePayment(snapshot: unknown, payment: unknown, options: ResourceOperationOptions = {}): RuleEngineResponse<PaymentResult> {
  return runPayment("APPLY", snapshot, payment, options);
}
