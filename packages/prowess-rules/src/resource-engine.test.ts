import { describe, expect, it } from "vitest";
import {
  applyResourcePayment,
  createResourceSnapshot,
  createRulesetContext,
  evaluateFormula,
  evaluateModifiers,
  flattenTrace,
  getAvailableMaximum,
  previewResourcePayment,
  refreshResource,
  releaseResourceCapacity,
  reserveResourceCapacity,
  RESOURCE_LIMITS,
  restoreResource,
  setResourceCurrent,
  spendResource,
  type PaymentResult,
  type ResourceTransitionResult,
  type RuleEngineResponse,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO7 Resource Engine. Guards M4-I80 (Resource State Is Explicit Runtime Data), M4-I81 (Resource Identity Is Exact),
 * M4-I82 (Listed Cost Is Immutable During Payment), M4-I83 (Payment Source Order Is Explicit), M4-I84 (Temporary Pools
 * Have No Automatic Priority), M4-I85 (Insufficient Resources Are A Valid Runtime Outcome), M4-I86 (Failed Payment Is
 * Atomic), M4-I87 (Capacity Reservation Does Not Spend), M4-I88 (Capacity Release Does Not Restore Current Value),
 * M4-I89 (Reserved Capacity Produces A Distinct Available Maximum), M4-I90 (Current May Remain Above Available Maximum),
 * M4-I91 (Resource Refresh Is Explicit), M4-I92 (Resource Operations Never Round Implicitly), M4-I93 (Resource
 * Evaluation Has No External Side Effects), M4-I94 (Resource Inputs / Outputs Are Immutable), M4-I95 (Resource
 * Evaluation Is Deterministic), M4-I96 (Resource Provenance Is Preserved), M4-I97 (Payment Preview And Apply Share One
 * Allocation Semantics) and M4-I98 (Runtime Payment Never Rewrites Prior Formula / Modifier Results).
 *
 * Resource names are neutral test data ("r.temp", "r.primary"); the engine attaches no meaning to them.
 */
type R = Record<string, unknown>;
const res = (resourceKey: string, current: number, extra: R = {}): R => ({ resourceKey, kind: "POOL", current, minimum: 0, maximum: 20, reservedCapacity: 0, ...extra });
const snap = (...resources: R[]) => ({ resources });
const ok = <T>(r: RuleEngineResponse<T>): T => {
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.data as T;
};
const codes = (r: RuleEngineResponse<unknown>) => r.errors.map((e) => e.code);
const t = (r: RuleEngineResponse<ResourceTransitionResult>) => ok(r);
const current = (r: ResourceTransitionResult | PaymentResult, key: string) =>
  ("resultingResources" in r ? r.resultingResources : r).resources.find((x) => x.resourceKey === key)?.current;

describe("M4-I80 / M4-I81 resource state and snapshot", () => {
  it("valid bounded, unbounded, at-minimum and at-maximum states; ordered by resourceKey; deduplicated", () => {
    const s = createResourceSnapshot(snap(res("r.b", 20), res("r.a", 0), { ...res("r.tracker", -5), minimum: -10, maximum: null }, res("r.a", 0)));
    expect(s.ok && s.snapshot.resources.map((r) => [r.resourceKey, r.current, r.maximum])).toEqual([["r.a", 0, 20], ["r.b", 20, 20], ["r.tracker", -5, null]]);
  });

  it.each([
    ["minimum above maximum", res("r.a", 5, { minimum: 10, maximum: 5 }), "RESOURCE.INVALID_STATE"],
    ["current below minimum", res("r.a", -1), "RESOURCE.INVALID_STATE"],
    ["current above maximum", res("r.a", 21), "RESOURCE.INVALID_STATE"],
    ["negative reservation", res("r.a", 5, { reservedCapacity: -1 }), "RESOURCE.INVALID_STATE"],
    ["reservation too large", res("r.a", 5, { reservedCapacity: 21 }), "RESOURCE.RESERVATION_EXCEEDS_CAPACITY"],
    ["unbounded reservation", res("r.a", 5, { maximum: null, reservedCapacity: 1 }), "RESOURCE.INVALID_RESERVATION"],
    ["unknown kind", res("r.a", 5, { kind: "MANA" }), "RESOURCE.INVALID_STATE"],
    ["NaN current", res("r.a", Number.NaN), "RESOURCE.INVALID_STATE"],
    ["Infinity maximum", res("r.a", 5, { maximum: Number.POSITIVE_INFINITY }), "RESOURCE.INVALID_STATE"],
    ["stored availableMaximum", res("r.a", 5, { availableMaximum: 14 }), "RESOURCE.INVALID_STATE"],
    ["bad key", res("R.A", 5), "RESOURCE.INVALID_STATE"],
  ])("%s → %s", (_label, state, code) => {
    const s = createResourceSnapshot(snap(state));
    expect(!s.ok && s.diagnostics.map((d) => d.code)).toEqual([code]);
  });

  it("conflicting duplicates fail closed in either order — never last-write-wins", () => {
    for (const list of [[res("r.a", 5), res("r.a", 6)], [res("r.a", 6), res("r.a", 5)]]) {
      const s = createResourceSnapshot(snap(...list));
      expect(!s.ok && s.diagnostics.map((d) => d.code)).toEqual(["RESOURCE.DUPLICATE_KEY"]);
    }
  });

  it("exact keys: a case or spelling variant is a missing resource", () => {
    for (const key of ["r.A", "r.a2", "ra"]) expect(codes(spendResource(snap(res("r.a", 5)), { resourceKey: key, amount: 1 })), key).toEqual(["RESOURCE.NOT_FOUND"]);
  });

  it("getters and unsafe prototypes are rejected without invocation", () => {
    let called = false;
    const sneaky = res("r.a", 5);
    Object.defineProperty(sneaky, "current", { enumerable: true, get: () => ((called = true), 5) });
    expect(createResourceSnapshot(snap(sneaky)).ok).toBe(false);
    expect(createResourceSnapshot(snap(JSON.parse('{"resourceKey":"r.a","kind":"POOL","current":1,"minimum":0,"maximum":2,"__proto__":{"x":1}}'))).ok).toBe(false);
    expect(createResourceSnapshot(snap(Object.create(res("r.a", 5)) as R)).ok).toBe(false);
    expect(called).toBe(false);
  });

  it("limits: 4,096 resources", () => {
    const s = createResourceSnapshot(snap(...Array.from({ length: RESOURCE_LIMITS.MAX_RESOURCES + 1 }, (_, i) => res(`r.k${i}`, 1))));
    expect(!s.ok && s.diagnostics.map((d) => d.code)).toEqual(["RESOURCE.LIMIT_EXCEEDED"]);
  });
});

describe("M4-I89 / M4-I90 reservation, available maximum, current above it", () => {
  it("available maximum is derived and distinct from current", () => {
    expect(getAvailableMaximum({ maximum: 20, reservedCapacity: 6 })).toBe(14);
    expect(getAvailableMaximum({ maximum: null, reservedCapacity: 0 })).toBeNull();
  });

  it("M4-I87: reserving 6 on current 18 / maximum 20 leaves current 18 — available maximum 14 — a legal state", () => {
    const r = t(reserveResourceCapacity(snap(res("r.a", 18)), { resourceKey: "r.a", amount: 6 }));
    expect([r.after.current, r.after.maximum, r.after.reservedCapacity, r.availableMaximumAfter]).toEqual([18, 20, 6, 14]);
    expect(createResourceSnapshot(r.resultingResources).ok).toBe(true);
  });

  it("sequential reservations, exactly to the limit, and beyond it", () => {
    const first = t(reserveResourceCapacity(snap(res("r.a", 10)), { resourceKey: "r.a", amount: 5 }));
    const second = t(reserveResourceCapacity(first.resultingResources, { resourceKey: "r.a", amount: 15 }));
    expect([second.after.reservedCapacity, second.availableMaximumAfter, second.after.current]).toEqual([20, 0, 10]);
    expect(codes(reserveResourceCapacity(second.resultingResources, { resourceKey: "r.a", amount: 0.5 }))).toEqual(["RESOURCE.RESERVATION_EXCEEDS_CAPACITY"]);
    expect(codes(reserveResourceCapacity(snap(res("r.a", 5, { minimum: 5, maximum: 10 })), { resourceKey: "r.a", amount: 6 }))).toEqual(["RESOURCE.RESERVATION_EXCEEDS_CAPACITY"]);
  });

  it("unbounded resources cannot reserve; zero reservation changes nothing", () => {
    expect(codes(reserveResourceCapacity(snap(res("r.a", 5, { maximum: null })), { resourceKey: "r.a", amount: 1 }))).toEqual(["RESOURCE.INVALID_RESERVATION"]);
    const zero = t(reserveResourceCapacity(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 0 }));
    expect(zero.after).toEqual(zero.before);
  });

  it("M4-I88: releasing 6 from current 8 / reserved 6 returns capacity only — current stays 8", () => {
    const r = t(releaseResourceCapacity(snap(res("r.a", 8, { reservedCapacity: 6 })), { resourceKey: "r.a", amount: 6 }));
    expect([r.after.current, r.after.reservedCapacity, r.availableMaximumBefore, r.availableMaximumAfter]).toEqual([8, 0, 14, 20]);
  });

  it("partial, zero and over-large releases", () => {
    expect(t(releaseResourceCapacity(snap(res("r.a", 8, { reservedCapacity: 6 })), { resourceKey: "r.a", amount: 2 })).after.reservedCapacity).toBe(4);
    expect(t(releaseResourceCapacity(snap(res("r.a", 8, { reservedCapacity: 6 })), { resourceKey: "r.a", amount: 0 })).after.current).toBe(8);
    expect(codes(releaseResourceCapacity(snap(res("r.a", 8, { reservedCapacity: 6 })), { resourceKey: "r.a", amount: 7 }))).toEqual(["RESOURCE.RELEASE_EXCEEDS_RESERVED"]);
  });

  it("the reservation and release traces never show a current change", () => {
    const reserve = reserveResourceCapacity(snap(res("r.a", 18)), { resourceKey: "r.a", amount: 6 });
    const inputs = Object.fromEntries((reserve.trace.steps[0]?.inputs ?? []).map((i) => [i.name, "value" in i.value ? i.value.value : null]));
    expect(inputs).toMatchObject({ maximum: 20, current_before: 18, reserved_before: 0, reserved_after: 6, available_maximum_after: 14, current_after: 18 });
  });
});

describe("M4-I85 spend", () => {
  it("full spend, spend to exactly the minimum, fractional spend, non-zero minimum", () => {
    expect(t(spendResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 3 })).after.current).toBe(2);
    expect(t(spendResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 5 })).after.current).toBe(0);
    expect(t(spendResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 1.25 })).after.current).toBe(3.75);
    expect(t(spendResource(snap(res("r.a", 5, { minimum: 2 })), { resourceKey: "r.a", amount: 3 })).after.current).toBe(2);
  });

  it("insufficient: a valid SUCCESS outcome with applied:false and a shortfall — never below minimum, never an error", () => {
    const r = spendResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 7 });
    expect([r.status, r.errors, r.warnings]).toEqual(["SUCCESS", [], []]);
    expect(r.data).toMatchObject({ applied: false, actualAmount: 0, shortfall: 2 });
    expect(r.data?.after.current).toBe(5); // atomic
    expect(r.data?.resultingResources).toEqual(r.data && { resources: [r.data.before] });
  });

  it("zero spend changes nothing; a negative spend is invalid input, never a restoration", () => {
    expect(t(spendResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 0 })).after.current).toBe(5);
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY, "3"]) expect(codes(spendResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount })), String(amount)).toEqual(["RESOURCE.INVALID_AMOUNT"]);
  });
});

describe("restore, set current, refresh", () => {
  const above = () => snap(res("r.a", 18, { reservedCapacity: 6 })); // available maximum 14

  it("restore to the nominal or available maximum, with CLAMP or INVALID overflow", () => {
    expect(t(restoreResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 10, ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" })).after.current).toBe(15);
    expect(t(restoreResource(snap(res("r.a", 5, { reservedCapacity: 6 })), { resourceKey: "r.a", amount: 20, ceiling: "AVAILABLE_MAXIMUM", overflow: "CLAMP" }))).toMatchObject({ actualAmount: 9, overflow: 11, after: { current: 14 } });
    expect(codes(restoreResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 20, ceiling: "NOMINAL_MAXIMUM", overflow: "INVALID" }))).toEqual(["RESOURCE.OUT_OF_BOUNDS"]);
  });

  it("unbounded: NOMINAL_MAXIMUM has no ceiling; AVAILABLE_MAXIMUM is invalid", () => {
    expect(t(restoreResource(snap(res("r.a", 5, { maximum: null })), { resourceKey: "r.a", amount: 1000, ceiling: "NOMINAL_MAXIMUM", overflow: "INVALID" })).after.current).toBe(1005);
    expect(codes(restoreResource(snap(res("r.a", 5, { maximum: null })), { resourceKey: "r.a", amount: 1, ceiling: "AVAILABLE_MAXIMUM", overflow: "CLAMP" }))).toEqual(["RESOURCE.INVALID_BOUNDARY"]);
  });

  it("M4-I90: restoring under AVAILABLE_MAXIMUM when current (18) is above it (14) never lowers current", () => {
    const r = t(restoreResource(above(), { resourceKey: "r.a", amount: 3, ceiling: "AVAILABLE_MAXIMUM", overflow: "CLAMP" }));
    expect([r.after.current, r.actualAmount, r.overflow, r.currentAboveCeiling]).toEqual([18, 0, 3, true]);
    expect(codes(restoreResource(above(), { resourceKey: "r.a", amount: 3, ceiling: "AVAILABLE_MAXIMUM", overflow: "INVALID" }))).toEqual(["RESOURCE.OUT_OF_BOUNDS"]);
  });

  it("zero and negative restoration", () => {
    expect(t(restoreResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: 0, ceiling: "NOMINAL_MAXIMUM", overflow: "INVALID" })).after.current).toBe(5);
    expect(codes(restoreResource(snap(res("r.a", 5)), { resourceKey: "r.a", amount: -2, ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" }))).toEqual(["RESOURCE.INVALID_AMOUNT"]);
  });

  it("set current obeys minimum and the nominal maximum unless AVAILABLE_MAXIMUM is explicitly requested", () => {
    expect(t(setResourceCurrent(above(), { resourceKey: "r.a", value: 17 })).after.current).toBe(17);
    expect(codes(setResourceCurrent(above(), { resourceKey: "r.a", value: 17, ceiling: "AVAILABLE_MAXIMUM" }))).toEqual(["RESOURCE.OUT_OF_BOUNDS"]);
    expect(codes(setResourceCurrent(above(), { resourceKey: "r.a", value: 21 }))).toEqual(["RESOURCE.OUT_OF_BOUNDS"]);
    expect(codes(setResourceCurrent(above(), { resourceKey: "r.a", value: -1 }))).toEqual(["RESOURCE.OUT_OF_BOUNDS"]);
  });

  it("M4-I91: refresh is an explicit set-to-ceiling raise — and never lowers current", () => {
    expect(t(refreshResource(snap(res("r.a", 3, { reservedCapacity: 6 })), { resourceKey: "r.a", target: "TO_NOMINAL_MAXIMUM" })).after.current).toBe(20);
    expect(t(refreshResource(snap(res("r.a", 3, { reservedCapacity: 6 })), { resourceKey: "r.a", target: "TO_AVAILABLE_MAXIMUM" })).after.current).toBe(14);
    expect(t(refreshResource(above(), { resourceKey: "r.a", target: "TO_AVAILABLE_MAXIMUM" }))).toMatchObject({ actualAmount: 0, currentAboveCeiling: true, after: { current: 18 } });
    expect(codes(refreshResource(snap(res("r.a", 3, { maximum: null })), { resourceKey: "r.a", target: "TO_NOMINAL_MAXIMUM" }))).toEqual(["RESOURCE.INVALID_BOUNDARY"]);
  });

  it("ACTION and TEMPORARY_POOL kinds do nothing on their own: other operations leave them exactly as they were", () => {
    const s = snap(res("r.actions", 0, { kind: "ACTION", maximum: 3 }), res("r.temp", 4, { kind: "TEMPORARY_POOL", maximum: 10 }), res("r.main", 10));
    const after = t(spendResource(t(restoreResource(s, { resourceKey: "r.main", amount: 1, ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" })).resultingResources, { resourceKey: "r.main", amount: 5 }));
    expect([current(after, "r.actions"), current(after, "r.temp")]).toEqual([0, 4]);
    expect(t(refreshResource(s, { resourceKey: "r.actions", target: "TO_NOMINAL_MAXIMUM" })).after.current).toBe(3); // only when explicitly asked
  });
});

describe("M4-I82 / M4-I83 / M4-I84 / M4-I97 payment", () => {
  const two = () => snap(res("r.temp", 6, { kind: "TEMPORARY_POOL", maximum: 6 }), res("r.primary", 20));
  const pay = (listedAmount: number, ...sources: R[]) => ({ costKey: "cost.example", listedAmount, sources });

  it("listed 17: temp (order 10) pays 6, primary (order 20) pays 11; primary left with 9; listed stays 17", () => {
    const r = ok(applyResourcePayment(two(), pay(17, { resourceKey: "r.primary", order: 20 }, { resourceKey: "r.temp", order: 10 })));
    expect([r.canPay, r.listedAmount, r.totalPaid, r.shortfall]).toEqual([true, 17, 17, 0]);
    expect(r.allocations.map((a) => [a.resourceKey, a.requestedRemainingBefore, a.available, a.amountPaid, a.currentBefore, a.currentAfter])).toEqual([
      ["r.temp", 17, 6, 6, 6, 0],
      ["r.primary", 11, 20, 11, 20, 9],
    ]);
    expect([current(r, "r.temp"), current(r, "r.primary")]).toEqual([0, 9]);
    expect(Object.keys(r).sort()).toEqual(["allocations", "canPay", "costKey", "listedAmount", "mode", "originalResources", "provenance", "resultingResources", "shortfall", "totalPaid"]);
    expect(JSON.stringify(r)).not.toMatch(/effective/i);
  });

  it("M4-I84: kind has no priority — a POOL ordered 10 pays before a TEMPORARY_POOL ordered 20", () => {
    const r = ok(applyResourcePayment(two(), pay(5, { resourceKey: "r.primary", order: 10 }, { resourceKey: "r.temp", order: 20 })));
    expect(r.allocations.map((a) => [a.resourceKey, a.amountPaid])).toEqual([["r.primary", 5], ["r.temp", 0]]);
  });

  it("equal orders tie-break by resourceKey; input order never decides", () => {
    const s = snap(res("r.b", 10), res("r.a", 10));
    const a = ok(applyResourcePayment(s, pay(12, { resourceKey: "r.b", order: 1 }, { resourceKey: "r.a", order: 1 })));
    const b = ok(applyResourcePayment(s, pay(12, { resourceKey: "r.a", order: 1 }, { resourceKey: "r.b", order: 1 })));
    expect(a.allocations.map((x) => [x.resourceKey, x.amountPaid])).toEqual([["r.a", 10], ["r.b", 2]]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("source limits cap one payment without changing the resource's state", () => {
    const r = ok(applyResourcePayment(two(), pay(17, { resourceKey: "r.temp", order: 10, limit: 2 }, { resourceKey: "r.primary", order: 20 })));
    expect(r.allocations.map((a) => [a.resourceKey, a.sourceLimit, a.amountPaid])).toEqual([["r.temp", 2, 2], ["r.primary", null, 15]]);
    expect(r.resultingResources.resources.find((x) => x.resourceKey === "r.temp")).toMatchObject({ current: 4, maximum: 6, reservedCapacity: 0 });
  });

  it("reserved capacity does not reduce what a source can pay (current − minimum)", () => {
    const r = ok(applyResourcePayment(snap(res("r.a", 18, { reservedCapacity: 6 })), pay(18, { resourceKey: "r.a", order: 1 })));
    expect([r.canPay, r.allocations[0]?.available, current(r, "r.a")]).toEqual([true, 18, 0]);
  });

  it("zero cost: payable, nothing allocated, state unchanged; fractional amounts are exact", () => {
    const z = ok(applyResourcePayment(two(), pay(0, { resourceKey: "r.temp", order: 1 })));
    expect([z.canPay, z.totalPaid, z.allocations[0]?.amountPaid]).toEqual([true, 0, 0]);
    expect(z.resultingResources).toEqual(z.originalResources);
    const f = ok(applyResourcePayment(snap(res("r.a", 2.5), res("r.b", 10)), pay(3.75, { resourceKey: "r.a", order: 1 }, { resourceKey: "r.b", order: 2 })));
    expect(f.allocations.map((a) => a.amountPaid)).toEqual([2.5, 1.25]);
  });

  it("M4-I86: insufficient total → canPay:false, shortfall, theoretical allocations, and NO state change", () => {
    const r = applyResourcePayment(snap(res("r.a", 6), res("r.b", 2)), pay(10, { resourceKey: "r.a", order: 1 }, { resourceKey: "r.b", order: 2 }));
    expect([r.status, r.errors]).toEqual(["SUCCESS", []]);
    const d = r.data as PaymentResult;
    expect([d.canPay, d.totalPaid, d.shortfall]).toEqual([false, 8, 2]);
    expect(d.allocations.map((a) => a.amountPaid)).toEqual([6, 2]);
    expect(d.resultingResources).toEqual(d.originalResources);
    expect([current(d, "r.a"), current(d, "r.b")]).toEqual([6, 2]);
  });

  it("M4-I97: preview and apply produce the same allocation (only mode differs)", () => {
    for (const listed of [17, 30]) {
      const request = pay(listed, { resourceKey: "r.primary", order: 20 }, { resourceKey: "r.temp", order: 10 });
      const p = ok(previewResourcePayment(two(), request));
      const a = ok(applyResourcePayment(two(), request));
      expect([p.mode, a.mode]).toEqual(["PREVIEW", "APPLY"]);
      expect(JSON.stringify({ ...p, mode: null })).toBe(JSON.stringify({ ...a, mode: null }));
    }
  });

  it("malformed payments are invalid (distinct from insufficient)", () => {
    expect(codes(applyResourcePayment(two(), pay(-1, { resourceKey: "r.temp", order: 1 })))).toEqual(["RESOURCE.INVALID_AMOUNT"]);
    expect(codes(applyResourcePayment(two(), pay(Number.NaN, { resourceKey: "r.temp", order: 1 })))).toEqual(["RESOURCE.INVALID_AMOUNT"]);
    expect(codes(applyResourcePayment(two(), pay(1, { resourceKey: "r.temp", order: 1 }, { resourceKey: "r.temp", order: 2 })))).toEqual(["RESOURCE.DUPLICATE_PAYMENT_SOURCE"]);
    expect(codes(applyResourcePayment(two(), pay(1, { resourceKey: "r.missing", order: 1 })))).toEqual(["RESOURCE.NOT_FOUND"]);
    expect(codes(applyResourcePayment(two(), pay(1, { resourceKey: "r.temp", order: 1, limit: -2 })))).toEqual(["RESOURCE.INVALID_PAYMENT"]);
    expect(codes(applyResourcePayment(two(), pay(1, { resourceKey: "r.temp", order: 1.5 })))).toEqual(["RESOURCE.INVALID_PAYMENT"]);
    expect(codes(applyResourcePayment(two(), { costKey: "c", listedAmount: 1, sources: [], effectiveCost: 0 }))).toEqual(["RESOURCE.INVALID_PAYMENT"]);
  });

  it("the payment trace: listed amount, sources in payment order with remainders, then settlement — listed unchanged", () => {
    const r = applyResourcePayment(two(), pay(17, { resourceKey: "r.primary", order: 20 }, { resourceKey: "r.temp", order: 10 }));
    const flat = flattenTrace(r.trace);
    expect(flat.map((s) => [s.path, s.operation])).toEqual([["1", "resource.payment.apply"], ["1.1", "resource.payment.source"], ["1.2", "resource.payment.source"], ["1.3", "resource.payment.settlement"]]);
    const inputs = (i: number) => Object.fromEntries((flat[i]?.inputs ?? []).map((x) => [x.name, "value" in x.value ? x.value.value : null]));
    expect(inputs(0)).toMatchObject({ listed_amount: 17 });
    expect(inputs(1)).toMatchObject({ resource_key: "r.temp", remaining_before: 17, current_before: 6, paid: 6, current_after: 0 });
    expect(inputs(2)).toMatchObject({ resource_key: "r.primary", remaining_before: 11, paid: 11, current_after: 9 });
    expect(inputs(3)).toMatchObject({ listed_amount: 17, total_paid: 17, shortfall: 0 });
  });
});

describe("M4-I98 runtime payment never rewrites prior Formula / Modifier results", () => {
  it("listed 17 → floor(17 / 4) = 4; paying 6 + 11 afterwards leaves the Formula and Modifier results byte-identical", () => {
    const modifiers = evaluateModifiers({ targets: [{ targetKey: "t.listed", kind: "NUMERIC", value: 20 }], modifiers: [{ modifierKey: "m", targetKey: "t.listed", operation: "SUBTRACT", operand: 3, phase: { phaseKey: "p", phaseOrder: 1 }, priority: 0, order: 0 }] });
    const listed = (modifiers.data?.finalTargets[0] as { value: number }).value;
    const formula = evaluateFormula({ expression: "floor(listed / divisor)" }, { listed, divisor: 4 });
    const before = JSON.stringify([modifiers, formula]);
    const payment = ok(applyResourcePayment(snap(res("r.temp", 6, { kind: "TEMPORARY_POOL", maximum: 6 }), res("r.primary", 20)), {
      costKey: "cost.example",
      listedAmount: listed,
      sources: [{ resourceKey: "r.temp", order: 10 }, { resourceKey: "r.primary", order: 20 }],
    }));
    expect([listed, formula.data?.finalValue, payment.listedAmount]).toEqual([17, 4, 17]);
    expect(payment.allocations.map((a) => a.amountPaid)).toEqual([6, 11]);
    expect(JSON.stringify([modifiers, formula])).toBe(before);
    expect(JSON.stringify(payment)).not.toMatch(/"(effective\w*|netCost|adjustedCost)"/i);
  });
});

describe("M4-I92 / M4-I93 / M4-I94 / M4-I95 / M4-I96 numeric safety, immutability, determinism, provenance", () => {
  const provenance = { entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", rulesetId: null, manifestId: null };

  it("never rounds; non-finite results fail closed; -0 → 0", () => {
    expect(t(spendResource(snap(res("r.a", 1)), { resourceKey: "r.a", amount: 0.1 })).after.current).toBe(1 - 0.1);
    expect(codes(restoreResource(snap(res("r.a", 1e308, { maximum: null })), { resourceKey: "r.a", amount: 1e308, ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" }))).toEqual(["RESOURCE.NON_FINITE_RESULT"]);
    expect(Object.is(t(spendResource(snap(res("r.a", 0)), { resourceKey: "r.a", amount: 0 })).after.current, 0)).toBe(true);
  });

  it("provenance of state, transition request, payment request and each source is preserved", () => {
    const tr = t(reserveResourceCapacity(snap(res("r.a", 10, { provenance })), { resourceKey: "r.a", amount: 2, provenance }));
    expect([tr.before.provenance, tr.provenance, tr.resultingResources.resources[0]?.provenance]).toEqual([provenance, provenance, provenance]);
    const p = ok(applyResourcePayment(snap(res("r.a", 10)), { costKey: "c", listedAmount: 1, provenance, sources: [{ resourceKey: "r.a", order: 1, provenance }] }));
    expect([p.provenance, p.allocations[0]?.provenance]).toEqual([provenance, provenance]);
  });

  it("an exact RulesetContext is recorded and never searched", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    expect(spendResource(snap(res("r.a", 1)), { resourceKey: "r.a", amount: 0 }, { ruleset: ctx.value }).ruleset?.rulesetId).toBe(IDS.ruleset);
  });

  it("inputs are never mutated or frozen; outputs are deep-frozen, detached and serializable", () => {
    const s = snap(res("r.b", 10), res("r.a", 5));
    const request = { costKey: "c", listedAmount: 7, sources: [{ resourceKey: "r.a", order: 1 }, { resourceKey: "r.b", order: 2 }] };
    const before = JSON.stringify([s, request]);
    const r = applyResourcePayment(s, request);
    expect(JSON.stringify([s, request])).toBe(before);
    expect(Object.isFrozen(s) || Object.isFrozen(s.resources[0]) || Object.isFrozen(request)).toBe(false);
    expect(Object.isFrozen(r.data?.resultingResources.resources[0]) && Object.isFrozen(r.data?.allocations)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const snapshotJson = JSON.stringify(r.data?.resultingResources);
    (s.resources[0] as { current: number }).current = 0;
    expect(JSON.stringify(r.data?.resultingResources)).toBe(snapshotJson);
  });

  it("same inputs → byte-identical; shuffled resources and sources change nothing", () => {
    const s = snap(res("r.c", 3), res("r.a", 5), res("r.b", 9));
    const request = { costKey: "c", listedAmount: 10, sources: [{ resourceKey: "r.b", order: 3 }, { resourceKey: "r.a", order: 1 }, { resourceKey: "r.c", order: 2 }] };
    const r = assertDeterministic(() => applyResourcePayment(s, request), { inputs: [s, request], runs: 6 });
    const shuffled = applyResourcePayment(snap(res("r.b", 9), res("r.c", 3), res("r.a", 5)), { ...request, sources: [...request.sources].reverse() });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(r));
  });

  it("large sanity: 2,000 resources, a payment across 1,000 explicitly ordered sources", () => {
    const resources = Array.from({ length: 2000 }, (_, i) => res(`r.k${String(i).padStart(4, "0")}`, 1));
    const sources = Array.from({ length: 1000 }, (_, i) => ({ resourceKey: `r.k${String(i * 2).padStart(4, "0")}`, order: 1000 - i }));
    const r = assertDeterministic(() => applyResourcePayment({ resources }, { costKey: "c", listedAmount: 500, sources }), { runs: 2 });
    const d = r.data as PaymentResult;
    expect([d.canPay, d.totalPaid, d.allocations[0]?.resourceKey, d.allocations.filter((a) => a.amountPaid > 0).length]).toEqual([true, 500, "r.k1998", 500]);
    expect(d.resultingResources.resources.filter((x) => x.current === 0)).toHaveLength(500);
  });
});
