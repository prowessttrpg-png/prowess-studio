import type { ResourceSnapshot } from "@prowess/rules";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, own, type ProwessOutcome } from "../internal/problems.js";
import { DEFINITION_ERROR_CODES as C, RUNTIME_ERROR_CODES as R } from "../definition/codes.js";
import type { ProwessRulesetProvenance } from "../bundle/bundle.js";
import { RESOURCE_CONTEXT_KEYS, RUNTIME_RESOURCE_KEYS, type PaymentPolicy, type RuntimeResourceKey } from "../vocabulary/runtime.js";
import type { ProwessRuntimeCompiledPlan } from "./compile.js";
import { runtimeResourcesFromSnapshots, type ProwessRuntimeResources } from "./resources.js";

/**
 * Reading an evaluated runtime plan (PAS-10 M5-WO3 §96, §104). Every value below is COPIED from an M4 step response —
 * the payment's listed amount, allocations, shortfall and before / after state; a transition's before / after; a
 * Requirement's outcome. Nothing is recomputed, and the listed amount is never replaced by "what was paid".
 */
export interface RuntimePaymentReading {
  readonly costKey: string;
  readonly policy: PaymentPolicy;
  /** The listed amount, exactly as compiled and as M4 echoed it — unchanged by ME (M5-I091). */
  readonly listedAmount: number;
  readonly canPay: boolean;
  readonly totalPaid: number;
  readonly shortfall: number;
  readonly allocations: readonly { readonly resourceKey: RuntimeResourceKey; readonly order: number; readonly amountPaid: number; readonly currentBefore: number; readonly currentAfter: number }[];
}

export interface RuntimeTransitionReading {
  readonly resourceKey: RuntimeResourceKey;
  readonly operation: string;
  readonly applied: boolean;
  readonly shortfall: number;
  readonly overflow: number;
  readonly currentBefore: number;
  readonly currentAfter: number;
  readonly reservedBefore: number;
  readonly reservedAfter: number;
  readonly availableMaximumBefore: number | null;
  readonly availableMaximumAfter: number | null;
}

export interface RuntimeRunReading {
  /** The runtime Resources after the plan: exact copies of the chain's final M4 snapshot over the base state. */
  readonly resources: ProwessRuntimeResources;
  readonly payments: readonly RuntimePaymentReading[];
  readonly transitions: readonly RuntimeTransitionReading[];
  readonly availability: readonly { readonly resourceKey: RuntimeResourceKey; readonly restrictionKey: string; readonly available: boolean }[];
  /** Resources at their minimum after the plan, for those whose Definition exposes depletion (0 HP). */
  readonly depleted: readonly { readonly resourceKey: RuntimeResourceKey; readonly depleted: boolean }[];
  readonly movementGrant: number | null;
  readonly movementCosts: readonly number[];
}

const prowessKeyOf = (contextKey: unknown): RuntimeResourceKey | null => RUNTIME_RESOURCE_KEYS.find((k) => RESOURCE_CONTEXT_KEYS[k] === contextKey) ?? null;

/** Reads every named output of `plan` from an M4 EvaluationRun of exactly that plan. Fails closed on a foreign / incomplete run. */
export function readRuntimeRun(input: { readonly plan: ProwessRuntimeCompiledPlan; readonly run: unknown; readonly resources: ProwessRuntimeResources }): ProwessOutcome<RuntimeRunReading> {
  const p = new Problems();
  if (!checkPlainData(input.run, ["run"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const steps = isPlainObject(input.run) ? own(input.run, "steps") : undefined;
  if (!Array.isArray(steps)) {
    p.add(R.INCOMPLETE_RUN, ["run"], "an EvaluationRun has a steps array");
    return finish(p, () => null as never);
  }
  const planned = new Set(input.plan.evaluationPlan.steps.map((s) => s.stepKey));
  const ran = new Set(steps.map((s: unknown) => (isPlainObject(s) ? own(s, "stepKey") : null)));
  if (planned.size !== ran.size || ![...planned].every((k) => ran.has(k))) p.add(R.INCOMPLETE_RUN, ["run", "steps"], "the run is not an evaluation of exactly this plan");
  const data = (stepKey: string): Record<string, unknown> | null => {
    const step = steps.find((s: unknown) => isPlainObject(s) && own(s, "stepKey") === stepKey) as Record<string, unknown> | undefined;
    const response = step === undefined ? undefined : own(step, "response");
    const value = isPlainObject(response) && own(response, "success") === true ? own(response, "data") : undefined;
    if (step === undefined || own(step, "executionStatus") !== "EXECUTED" || !isPlainObject(value)) {
      p.add(R.INCOMPLETE_RUN, ["run", "steps"], `step ${stepKey} did not execute successfully`);
      return null;
    }
    return value;
  };
  const o = input.plan.outputs;
  const payments = o.payments.flatMap((pay): RuntimePaymentReading[] => {
    const d = data(pay.apply);
    if (d === null) return [];
    const allocations = (own(d, "allocations") as Record<string, unknown>[]).map((a) => ({
      resourceKey: prowessKeyOf(own(a, "resourceKey")) as RuntimeResourceKey,
      order: own(a, "order") as number,
      amountPaid: own(a, "amountPaid") as number,
      currentBefore: own(a, "currentBefore") as number,
      currentAfter: own(a, "currentAfter") as number,
    }));
    return [{ costKey: pay.costKey, policy: pay.policy, listedAmount: own(d, "listedAmount") as number, canPay: own(d, "canPay") as boolean, totalPaid: own(d, "totalPaid") as number, shortfall: own(d, "shortfall") as number, allocations }];
  });
  const transitions = o.transitions.flatMap((t): RuntimeTransitionReading[] => {
    const d = data(t.stepKey);
    if (d === null) return [];
    const before = own(d, "before") as Record<string, unknown>;
    const after = own(d, "after") as Record<string, unknown>;
    return [
      {
        resourceKey: t.resourceKey,
        operation: t.operation,
        applied: own(d, "applied") as boolean,
        shortfall: own(d, "shortfall") as number,
        overflow: own(d, "overflow") as number,
        currentBefore: own(before, "current") as number,
        currentAfter: own(after, "current") as number,
        reservedBefore: own(before, "reservedCapacity") as number,
        reservedAfter: own(after, "reservedCapacity") as number,
        availableMaximumBefore: own(d, "availableMaximumBefore") as number | null,
        availableMaximumAfter: own(d, "availableMaximumAfter") as number | null,
      },
    ];
  });
  const availability = o.availability.flatMap((a) => {
    const d = data(a.stepKey);
    return d === null ? [] : [{ resourceKey: a.resourceKey, restrictionKey: a.restrictionKey, available: own(d, "satisfied") as boolean }];
  });
  const finalStep = Object.values(o.resources)[0];
  const snapshots: ResourceSnapshot[] = [];
  if (finalStep !== undefined) {
    const d = data(finalStep);
    if (d !== null) snapshots.push(own(d, "resultingResources") as ResourceSnapshot);
  }
  const depleted = o.depletion.flatMap((d) => {
    const v = data(d.stepKey);
    return v === null ? [] : [{ resourceKey: d.resourceKey, depleted: own(v, "satisfied") as boolean }];
  });
  const grant = o.movementGrant === null ? null : data(o.movementGrant);
  const costs = o.movementCosts.map((k) => data(k));
  return finish(p, () =>
    deepFreeze({
      resources: runtimeResourcesFromSnapshots(input.resources, snapshots),
      payments,
      transitions,
      availability,
      depleted,
      movementGrant: grant === null ? null : (own(grant, "finalValue") as number),
      movementCosts: costs.map((c) => own(c as Record<string, unknown>, "finalValue") as number),
    }),
  );
}

/** The outcome of an action's payment phase. Only PAID unlocks the follow-on; the others leave state unchanged. */
export interface ActionPaymentConfirmation {
  readonly status: "PAID" | "CANNOT_PAY" | "UNAVAILABLE";
  readonly actionKey: string;
  readonly actionCanonicalKey: string;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  /** PAID: the state the payment produced. CANNOT_PAY / UNAVAILABLE: the ORIGINAL state — nothing is partially paid. */
  readonly resources: ProwessRuntimeResources;
  readonly payments: readonly RuntimePaymentReading[];
  readonly availability: RuntimeRunReading["availability"];
}

/**
 * Confirms an ACTION_PAYMENT plan's evaluated run (§76 — explicit two-phase safety). M4 never blocks a later step merely
 * because `canPay` is false, so the follow-on benefit (a Move's allowance) lives in a SEPARATE plan that compiles only
 * from a PAID confirmation. UNAVAILABLE (a usage restriction such as first-round Surprise) wins over CANNOT_PAY; either
 * way the original Resource state is returned unchanged — never a partial payment (M5-I092, M5-I110).
 */
export function confirmActionPayment(input: { readonly plan: ProwessRuntimeCompiledPlan; readonly run: unknown; readonly resources: ProwessRuntimeResources }): ProwessOutcome<ActionPaymentConfirmation> {
  const p = new Problems();
  if (input.plan.subject.kind !== "ACTION_PAYMENT" || input.plan.subject.actionKey === null || input.plan.subject.actionCanonicalKey === null) {
    p.add(R.INVALID_PAYMENT_RECEIPT, ["plan", "subject"], "only an ACTION_PAYMENT plan is confirmed");
    return finish(p, () => null as never);
  }
  const reading = readRuntimeRun(input);
  if (!reading.ok) return reading;
  const r = reading.value;
  const available = r.availability.every((a) => a.available);
  const paid = r.payments.every((x) => x.canPay);
  const status = !available ? "UNAVAILABLE" : paid ? "PAID" : "CANNOT_PAY";
  return finish(p, () =>
    deepFreeze({
      status,
      actionKey: input.plan.subject.actionKey as string,
      actionCanonicalKey: input.plan.subject.actionCanonicalKey as string,
      rulesetProvenance: input.plan.rulesetProvenance,
      resources: status === "PAID" ? r.resources : input.resources,
      payments: r.payments,
      availability: r.availability,
    }),
  );
}
