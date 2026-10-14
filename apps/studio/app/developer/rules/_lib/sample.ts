import type { EvaluationBinding, EvaluationPlan } from "@prowess/rules";

const fromStep = (target: string, stepKey: string, pointer: string): EvaluationBinding => ({ target, source: { kind: "STEP", stepKey, pointer } });

/** Neutral authored data. Every result is produced by the real HTTP evaluation, never by this module. */
export function samplePlan(): EvaluationPlan {
  return {
    primaryStepKey: "listed",
    validationStepKey: "validation",
    explanationStepKey: "explanation",
    steps: [
      { stepKey: "base", order: 10, operation: "FORMULA", input: { program: { expression: "a + b" }, variables: { a: 10, b: 7 } }, bindings: [] },
      { stepKey: "listed", order: 20, operation: "MODIFIER", input: { request: { targets: [{ targetKey: "t.listed", kind: "NUMERIC", value: 0 }], modifiers: [] } }, bindings: [fromStep("/request/targets/0/value", "base", "/data/finalValue")] },
      { stepKey: "derived", order: 30, operation: "FORMULA", input: { program: { expression: "listed / divisor", rounding: "FLOOR" }, variables: { listed: 0, divisor: 0 } }, bindings: [fromStep("/variables/listed", "listed", "/data/finalTargets/0/value"), { target: "/variables/divisor", source: { kind: "CONTEXT", context: "ACTOR", pointer: "/stats/divisor" } }] },
      { stepKey: "payment", order: 40, operation: "RESOURCE_PAYMENT_APPLY", input: {
        snapshot: { resources: [
          { resourceKey: "r.temp", kind: "TEMPORARY_POOL", current: 6, minimum: 0, maximum: 10, reservedCapacity: 0 },
          { resourceKey: "r.primary", kind: "POOL", current: 20, minimum: 0, maximum: 20, reservedCapacity: 0 },
        ] },
        payment: { costKey: "cost.example", listedAmount: 0, sources: [{ resourceKey: "r.temp", order: 10 }, { resourceKey: "r.primary", order: 20 }] },
      }, bindings: [fromStep("/payment/listedAmount", "listed", "/data/finalTargets/0/value")] },
      { stepKey: "validation", order: 50, operation: "VALIDATION", input: { request: { sources: [{ sourceKey: "derived", order: 1, response: null }, { sourceKey: "payment", order: 2, response: null }] } }, bindings: [fromStep("/request/sources/0/response", "derived", ""), fromStep("/request/sources/1/response", "payment", "")] },
      { stepKey: "explanation", order: 60, operation: "EXPLANATION", input: { input: { explanationKey: "lab.example", contributions: [
        { contributionKey: "listed", order: 1, kind: "MODIFIER", response: null },
        { contributionKey: "derived", order: 2, kind: "FORMULA", response: null },
        { contributionKey: "payment", order: 3, kind: "RESOURCE", response: null },
        { contributionKey: "validation", order: 4, kind: "VALIDATION", response: null },
      ] } }, bindings: [fromStep("/input/contributions/0/response", "listed", ""), fromStep("/input/contributions/1/response", "derived", ""), fromStep("/input/contributions/2/response", "payment", ""), fromStep("/input/contributions/3/response", "validation", "")] },
      { stepKey: "summary", order: 70, operation: "EXPLANATION_PROJECT", input: { document: null, level: "SUMMARY" }, bindings: [fromStep("/document", "explanation", "/data")] },
    ],
  };
}
