import { deepFreeze } from "../internal/plain-data.js";
import type { RuleProvenance } from "../result/provenance.js";

/**
 * The Resource model (PAS-10 M4-WO7). Runtime resource state is explicit data supplied by the caller; the engine
 * computes new immutable state and never persists anything.
 *
 * Central rule (M4-I14): a LISTED cost is calculated before payment; PAYMENT only chooses where that already-calculated
 * amount comes from. No payment result carries an "effective cost", and nothing here re-runs a Formula or Modifier.
 */

/**
 * The broader architecture's ResourceDefinition categories. METADATA ONLY: no kind is ever spent first, refreshed,
 * expired, clamped or ordered automatically — every behaviour is an explicit operation or explicit payment order.
 */
export const RESOURCE_KINDS = deepFreeze(["POOL", "ACTION", "CAPACITY", "SLOT", "TRACKER", "TEMPORARY_POOL", "RESERVED_CAPACITY"] as const);
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * One resource's runtime state. `availableMaximum` is never stored — it is derived (`maximum − reservedCapacity`).
 *
 *  - `minimum`           explicit (not assumed 0); a tracker may go negative
 *  - `maximum`           finite, or null for an explicitly unbounded resource (which cannot reserve capacity)
 *  - `current`           minimum ≤ current ≤ maximum — it MAY exceed the available maximum (reservation never spends)
 *  - `reservedCapacity`  ≥ 0 and ≤ maximum − minimum; capacity metadata, never spendable currency
 */
export interface ResourceState {
  readonly resourceKey: string;
  readonly kind: ResourceKind;
  readonly current: number;
  readonly minimum: number;
  readonly maximum: number | null;
  readonly reservedCapacity: number;
  readonly provenance: RuleProvenance | null;
}

/** Unique exact resourceKeys, ordered by resourceKey (UTF-16 code units). Deep-frozen. */
export interface ResourceSnapshot {
  readonly resources: readonly ResourceState[];
}

/** Ceiling for restoration and refresh. AVAILABLE_MAXIMUM needs a finite maximum. */
export const RESOURCE_CEILINGS = deepFreeze(["NOMINAL_MAXIMUM", "AVAILABLE_MAXIMUM"] as const);
export type ResourceCeiling = (typeof RESOURCE_CEILINGS)[number];

/** What a restoration that exceeds its ceiling does. Always explicit. */
export const RESOURCE_OVERFLOW_POLICIES = deepFreeze(["CLAMP", "INVALID"] as const);
export type ResourceOverflowPolicy = (typeof RESOURCE_OVERFLOW_POLICIES)[number];

export const RESOURCE_TRANSITIONS = deepFreeze(["SPEND", "RESTORE", "SET_CURRENT", "RESERVE_CAPACITY", "RELEASE_CAPACITY", "REFRESH"] as const);
export type ResourceTransition = (typeof RESOURCE_TRANSITIONS)[number];

/**
 * The result of one single-resource transition. `applied: false` is a valid runtime outcome (e.g. insufficient
 * resource), never an error; the resulting snapshot then equals the original.
 */
export interface ResourceTransitionResult {
  readonly transition: ResourceTransition;
  readonly resourceKey: string;
  readonly applied: boolean;
  readonly requestedAmount: number;
  readonly actualAmount: number;
  /** SPEND only: how much could not be spent without crossing the minimum. */
  readonly shortfall: number;
  /** RESTORE only: how much exceeded the ceiling (and was not restored). */
  readonly overflow: number;
  /** REFRESH / RESTORE: true when current already sat above the selected ceiling — it is never lowered. */
  readonly currentAboveCeiling: boolean;
  readonly before: ResourceState;
  readonly after: ResourceState;
  readonly availableMaximumBefore: number | null;
  readonly availableMaximumAfter: number | null;
  /** Why the transition was requested, when supplied. */
  readonly provenance: RuleProvenance | null;
  readonly resultingResources: ResourceSnapshot;
}

/** One explicitly ordered payment source. `limit` caps this source's contribution for this payment only. */
export interface PaymentSource {
  readonly resourceKey: string;
  readonly order: number;
  readonly limit: number | null;
  readonly provenance: RuleProvenance | null;
}

/**
 * A request to pay an ALREADY-CALCULATED listed amount. `costKey` is opaque metadata. `listedAmount` is immutable:
 * payment chooses sources, it never changes what was listed.
 */
export interface PaymentRequest {
  readonly costKey: string;
  readonly listedAmount: number;
  readonly sources: readonly PaymentSource[];
  readonly provenance: RuleProvenance | null;
}

/** One source's contribution, in payment order. */
export interface PaymentAllocation {
  readonly resourceKey: string;
  readonly order: number;
  readonly requestedRemainingBefore: number;
  /** current − minimum: what this source could pay before any limit. Reserved capacity does not reduce it. */
  readonly available: number;
  readonly sourceLimit: number | null;
  readonly amountPaid: number;
  readonly currentBefore: number;
  /** The projected value; committed only when the whole payment can be made. */
  readonly currentAfter: number;
  readonly provenance: RuleProvenance | null;
}

export const PAYMENT_MODES = deepFreeze(["PREVIEW", "APPLY"] as const);
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/**
 * A payment result. Preview and apply share one allocation; only `mode` differs. When `canPay` is false the payment is
 * atomic: `resultingResources` equals `originalResources`. There is deliberately no effective-cost field.
 */
export interface PaymentResult {
  readonly mode: PaymentMode;
  readonly costKey: string;
  readonly listedAmount: number;
  readonly canPay: boolean;
  readonly totalPaid: number;
  readonly shortfall: number;
  readonly allocations: readonly PaymentAllocation[];
  readonly provenance: RuleProvenance | null;
  readonly originalResources: ResourceSnapshot;
  readonly resultingResources: ResourceSnapshot;
}

/**
 * Resource diagnostics: malformed input or a request the caller explicitly declared invalid. Never used for
 * insufficient resources — that is `applied: false` / `canPay: false` with a shortfall.
 */
export const RESOURCE_DIAGNOSTIC_CODES = deepFreeze({
  INVALID_STATE: "RESOURCE.INVALID_STATE",
  DUPLICATE_KEY: "RESOURCE.DUPLICATE_KEY",
  NOT_FOUND: "RESOURCE.NOT_FOUND",
  INVALID_AMOUNT: "RESOURCE.INVALID_AMOUNT",
  /** AVAILABLE_MAXIMUM ceiling (or a refresh) on a resource without a finite maximum. */
  INVALID_BOUNDARY: "RESOURCE.INVALID_BOUNDARY",
  /** SET_CURRENT outside its bounds, or RESTORE past its ceiling under the INVALID overflow policy. */
  OUT_OF_BOUNDS: "RESOURCE.OUT_OF_BOUNDS",
  /** Reserving capacity on an unbounded resource. */
  INVALID_RESERVATION: "RESOURCE.INVALID_RESERVATION",
  RESERVATION_EXCEEDS_CAPACITY: "RESOURCE.RESERVATION_EXCEEDS_CAPACITY",
  RELEASE_EXCEEDS_RESERVED: "RESOURCE.RELEASE_EXCEEDS_RESERVED",
  INVALID_PAYMENT: "RESOURCE.INVALID_PAYMENT",
  DUPLICATE_PAYMENT_SOURCE: "RESOURCE.DUPLICATE_PAYMENT_SOURCE",
  NON_FINITE_RESULT: "RESOURCE.NON_FINITE_RESULT",
  LIMIT_EXCEEDED: "RESOURCE.LIMIT_EXCEEDED",
} as const);
export type ResourceDiagnosticCode = (typeof RESOURCE_DIAGNOSTIC_CODES)[keyof typeof RESOURCE_DIAGNOSTIC_CODES];

export interface ResourceDiagnostic {
  readonly code: ResourceDiagnosticCode;
  readonly message: string;
  /** RFC 6901 JSON Pointer into the input (`/resources/2/current`, `/payment/sources/1/limit`). */
  readonly path: string;
  readonly resourceKey: string | null;
}

/** Deterministic complexity limits. */
export const RESOURCE_LIMITS = deepFreeze({
  MAX_RESOURCES: 4096,
  MAX_PAYMENT_SOURCES: 4096,
} as const);
