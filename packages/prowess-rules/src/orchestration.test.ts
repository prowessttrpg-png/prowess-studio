import { describe, expect, it } from "vitest";
import {
  applyResourcePayment,
  buildExplanation,
  createRulesetContext,
  evaluateFormula,
  evaluateModifiers,
  evaluateRequirement,
  evaluateValidation,
  EVALUATION_OPERATIONS,
  ORCHESTRATION_LIMITS,
  orchestrateRulesEvaluation,
  previewResourcePayment,
  projectExplanation,
  refreshResource,
  releaseResourceCapacity,
  reserveResourceCapacity,
  resolveKeywords,
  restoreResource,
  setResourceCurrent,
  spendResource,
  type EvaluationRun,
  type RuleEngineResponse,
  type RulesetContext,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO10 Rules Evaluation Orchestration (pure). Guards M4-I135 (Rules Evaluation Orchestration Adds No New Mechanics),
 * M4-I136 (One Evaluation Run Uses One Exact Ruleset Context), M4-I137 (Steps Cannot Override Ruleset / Actor / Build /
 * Runtime Context), M4-I138 (Evaluation Step Identity Is Exact), M4-I139 (Evaluation Step Ordering Is Explicit And
 * Deterministic), M4-I140 (Operation Dispatch Is Closed And Static), M4-I141 (Bindings Copy Exact Values And Perform No
 * Calculation), M4-I142 (Binding Targets Are Exact), M4-I143 (Step References May Only Target Earlier Steps), M4-I144
 * (Evaluation Plans Cannot Contain Dependency Cycles), M4-I145 (Child Evaluation Invalidity Does Not Mean Orchestration
 * Invalidity), M4-I146 (Requirement False Does Not Automatically Block Orchestration), M4-I147 (Resource Insufficiency
 * Does Not Automatically Block Orchestration), M4-I148 (Skipped Modifiers Do Not Automatically Block Orchestration),
 * M4-I149 (Blocked Steps Do Not Execute Primitive Engines), M4-I150 (Independent Steps Continue After Unrelated
 * Failure), M4-I151 (Exact Child RuleEngineResponses Are Preserved), M4-I152 (Validation Is An Explicit Operation),
 * M4-I153 (Explanation Is An Explicit Operation), M4-I154 (Resource Apply Produces Projected State Only), M4-I159
 * (Orchestration Inputs / Outputs Are Immutable), M4-I160 (Orchestration Is Deterministic) and M4-I162 (Listed Cost And
 * Runtime Payment Remain Distinct Across Orchestration).
 *
 * Executable fixtures use neutral names only.
 */
const ctx = (() => {
  const c = createRulesetContext(rulesetInput());
  if (!c.ok) throw new Error("fixture");
  return c.value;
})();
type Step = Record<string, unknown>;
const step = (stepKey: string, order: number, operation: string, input: Record<string, unknown>, bindings: unknown[] = []): Step => ({ stepKey, order, operation, input, bindings });
const fromStep = (target: string, stepKey: string, pointer: string) => ({ target, source: { kind: "STEP", stepKey, pointer } });
const fromContext = (target: string, context: string, pointer: string) => ({ target, source: { kind: "CONTEXT", context, pointer } });
const orchestrate = (steps: Step[], extra: Record<string, unknown> = {}, contexts: Record<string, unknown> = {}) =>
  orchestrateRulesEvaluation({ evaluationKey: "eval.example", contexts: { ruleset: ctx, ...contexts }, plan: { steps, ...extra } });
const ok = (r: RuleEngineResponse<EvaluationRun>) => {
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.data as EvaluationRun;
};
const codes = (r: RuleEngineResponse<unknown>) => r.errors.map((e) => e.code);
const stepOf = (run: EvaluationRun, key: string) => run.steps.find((s) => s.stepKey === key) as EvaluationRun["steps"][number];
const data = (run: EvaluationRun, key: string) => stepOf(run, key).response?.data as Record<string, unknown>;

const snapshot = { resources: [{ resourceKey: "r.temp", kind: "TEMPORARY_POOL", current: 6, minimum: 0, maximum: 10, reservedCapacity: 0 }, { resourceKey: "r.primary", kind: "POOL", current: 20, minimum: 0, maximum: 20, reservedCapacity: 0 }] };

/** The 17 → 4 → 6 + 11 pipeline. 17 is authored ONCE (in step 10) and reaches every later step through bindings. */
const pipeline = (): Step[] => [
  step("base", 10, "FORMULA", { program: { expression: "a + b" }, variables: { a: 10, b: 7 } }),
  step("listed", 20, "MODIFIER", { request: { targets: [{ targetKey: "t.listed", kind: "NUMERIC", value: 0 }], modifiers: [] } }, [fromStep("/request/targets/0/value", "base", "/data/finalValue")]),
  step("derived", 30, "FORMULA", { program: { expression: "listed / divisor", rounding: "FLOOR" }, variables: { listed: 0, divisor: 0 } }, [
    fromStep("/variables/listed", "listed", "/data/finalTargets/0/value"),
    fromContext("/variables/divisor", "ACTOR", "/stats/divisor"),
  ]),
  step("payment", 40, "RESOURCE_PAYMENT_APPLY", { snapshot, payment: { costKey: "cost.example", listedAmount: 0, sources: [{ resourceKey: "r.primary", order: 20 }, { resourceKey: "r.temp", order: 10 }] } }, [
    fromStep("/payment/listedAmount", "listed", "/data/finalTargets/0/value"),
  ]),
  step("validation", 50, "VALIDATION", { request: { sources: [{ sourceKey: "derived", order: 1, response: null }, { sourceKey: "payment", order: 2, response: null }] } }, [
    fromStep("/request/sources/0/response", "derived", ""),
    fromStep("/request/sources/1/response", "payment", ""),
  ]),
  step("explanation", 60, "EXPLANATION", {
    input: {
      explanationKey: "x",
      contributions: [
        { contributionKey: "listed", order: 1, kind: "MODIFIER", response: null },
        { contributionKey: "derived", order: 2, kind: "FORMULA", response: null },
        { contributionKey: "payment", order: 3, kind: "RESOURCE", response: null },
        { contributionKey: "validation", order: 4, kind: "VALIDATION", response: null },
      ],
    },
  }, [
    fromStep("/input/contributions/0/response", "listed", ""),
    fromStep("/input/contributions/1/response", "derived", ""),
    fromStep("/input/contributions/2/response", "payment", ""),
    fromStep("/input/contributions/3/response", "validation", ""),
  ]),
];
const actor = { stats: { divisor: 4 } };

describe("M4-I162A — exact existing explanation projection (WO10A)", () => {
  const projection = (pointer = "/data") => step("summary", 70, "EXPLANATION_PROJECT", { document: null, level: "SUMMARY" }, [fromStep("/document", "explanation", pointer)]);
  it("preserves canonical DETAILED and equals WO9 SUMMARY directly, including listed 17, derived 4 and payment 6+11", () => {
    const baseline = ok(orchestrate(pipeline(), { explanationStepKey: "explanation" }, { actor }));
    const run = ok(orchestrate([...pipeline(), projection()], { explanationStepKey: "explanation" }, { actor }));
    expect(run.steps.slice(0, 6)).toEqual(baseline.steps);
    const detailed = stepOf(run, "explanation").response!.data;
    expect(data(run, "explanation").level).toBe("DETAILED");
    expect(stepOf(run, "summary").response).toEqual(projectExplanation(detailed, "SUMMARY"));
    const summary = data(run, "summary");
    expect(summary.level).toBe("SUMMARY");
    expect((summary.sections as Array<{ facts: unknown }>).map(s => s.facts)).toEqual((data(run, "explanation").sections as Array<{ facts: unknown }>).map(s => s.facts));
    expect(run.explanationStepKey).toBe("explanation");
    expect(ok(orchestrate([...pipeline(), projection()].reverse(), { explanationStepKey: "explanation" }, { actor }))).toEqual(run);
  });
  it("contribution input order is deterministic before projection", () => {
    const contributions = [
      { contributionKey: "z", order: 20, kind: "FORMULA", response: evaluateFormula({ expression: "17" }, {}, { ruleset: ctx }) },
      { contributionKey: "a", order: 10, kind: "FORMULA", response: evaluateFormula({ expression: "17 / 4", rounding: "FLOOR" }, {}, { ruleset: ctx }) },
    ];
    const run = (cs: unknown[]) => orchestrate([step("explanation", 60, "EXPLANATION", { input: { explanationKey: "ordered", contributions: cs } }), projection()]);
    expect(run(contributions)).toEqual(run([...contributions].reverse()));
  });
  it("forward, self references and projection as canonical designation fail before dispatch", () => {
    expect(codes(orchestrate([step("summary", 1, "EXPLANATION_PROJECT", { document: null, level: "SUMMARY" }, [fromStep("/document", "explanation", "/data")]), step("explanation", 2, "EXPLANATION", { input: { explanationKey: "x", contributions: [] } })]))).toContain("ORCHESTRATION.INVALID_REFERENCE");
    expect(codes(orchestrate([step("summary", 1, "EXPLANATION_PROJECT", { document: null, level: "SUMMARY" }, [fromStep("/document", "summary", "/data")])]))).toContain("ORCHESTRATION.INVALID_REFERENCE");
    expect(codes(orchestrate([...pipeline(), projection()], { explanationStepKey: "summary" }, { actor }))).toContain("ORCHESTRATION.INVALID_DESIGNATION");
  });
  it("unavailable document path and blocked source use normal dependency blocking", () => {
    expect(stepOf(ok(orchestrate([...pipeline(), projection("/data/missing")], {}, { actor })), "summary").executionStatus).toBe("BLOCKED");
    const steps = pipeline();
    steps[5] = step("explanation", 60, "EXPLANATION", { input: null }, [fromContext("/input", "BUILD", "")]);
    const run = ok(orchestrate([...steps, projection()], {}, { actor }));
    expect(stepOf(run, "summary").blockedBy[0]?.reason).toBe("DEPENDENCY_BLOCKED");
  });
  it("existing null is copied and handled by WO9; invalid level/document never rebuilds", () => {
    for (const [document, level] of [[null, "SUMMARY"], [{ level: "SUMMARY" }, "SUMMARY"], [{}, "UNKNOWN"]]) {
      const run = ok(orchestrate([step("summary", 1, "EXPLANATION_PROJECT", { document, level })]));
      expect(stepOf(run, "summary").response).toEqual(projectExplanation(document, level as "SUMMARY"));
      expect(stepOf(run, "summary").response?.status).toBe("INVALID");
    }
    const run = ok(orchestrate([step("explanation", 60, "EXPLANATION", { input: {} }), projection()]));
    expect(stepOf(run, "summary").executionStatus).toBe("EXECUTED");
    expect(stepOf(run, "summary").response).toEqual(projectExplanation(null, "SUMMARY"));
  });
});

describe("M4-I162 / M4-I141 the 17 → 4 → 6 + 11 pipeline, wired only by bindings", () => {
  it("listed 17, derived floor(17 / 4) = 4, payment 6 + 11, primary left 9, listed still 17 — COMPLETE", () => {
    const run = ok(orchestrate(pipeline(), { primaryStepKey: "listed", validationStepKey: "validation", explanationStepKey: "explanation" }, { actor }));
    expect(run.executionStatus).toBe("COMPLETE");
    expect(run.steps.map((s) => [s.stepKey, s.executionStatus, s.response?.status])).toEqual([
      ["base", "EXECUTED", "SUCCESS"],
      ["listed", "EXECUTED", "SUCCESS"],
      ["derived", "EXECUTED", "SUCCESS"],
      ["payment", "EXECUTED", "SUCCESS"],
      ["validation", "EXECUTED", "SUCCESS"],
      ["explanation", "EXECUTED", "SUCCESS"],
    ]);
    expect(data(run, "base").finalValue).toBe(17);
    expect((data(run, "listed").finalTargets as { value: number }[])[0]?.value).toBe(17);
    expect(data(run, "derived").finalValue).toBe(4);
    const pay = data(run, "payment") as { listedAmount: number; allocations: { amountPaid: number }[]; resultingResources: { resources: { resourceKey: string; current: number }[] } };
    expect([pay.listedAmount, pay.allocations.map((a) => a.amountPaid), pay.resultingResources.resources.find((r) => r.resourceKey === "r.primary")?.current]).toEqual([17, [6, 11], 9]);
    expect(stepOf(run, "validation").response?.status).toBe("SUCCESS");
    const doc = data(run, "explanation") as { sections: { sectionKey: string; facts: { factKey: string; value: unknown }[] }[] };
    expect(doc.sections.find((s) => s.sectionKey === "payment")?.facts.find((f) => f.factKey === "listedAmount")?.value).toBe(17);
    expect(JSON.stringify(run)).not.toMatch(/effective|reduced to|netCost/i);
    // 17 appears in the plan exactly as its two summands — it was never re-typed into a later step.
    expect(JSON.stringify(pipeline())).not.toMatch(/\b17\b/);
  });

  it("M4-I151: each stored child response equals a direct call of the same primitive with the same inputs", () => {
    const run = ok(orchestrate(pipeline(), {}, { actor }));
    const direct = evaluateFormula({ expression: "listed / divisor", rounding: "FLOOR" }, { listed: 17, divisor: 4 }, { ruleset: ctx });
    // Deep-equal (WO1's output boundary canonicalizes object key order; no value, status, diagnostic or trace changes).
    expect(stepOf(run, "derived").response).toEqual(direct);
  });

  it("M4-I136: every executed child carries the run's exact Ruleset provenance", () => {
    const run = ok(orchestrate(pipeline(), {}, { actor }));
    expect(new Set(run.steps.map((s) => JSON.stringify(s.response?.ruleset))).size).toBe(1);
    expect(run.steps[0]?.response?.ruleset?.rulesetId).toBe(IDS.ruleset);
  });
});

describe("M4-I145 / M4-I149 / M4-I150 partial runs: blocked dependencies, independent continuation", () => {
  it("A Formula INVALID → B BLOCKED; C independent EXECUTED; D Explanation of A's whole response EXECUTED; run PARTIAL", () => {
    const run = ok(
      orchestrate([
        step("A", 10, "FORMULA", { program: { expression: "1 / 0" }, variables: {} }),
        step("B", 20, "MODIFIER", { request: { targets: [{ targetKey: "t.x", kind: "NUMERIC", value: 0 }], modifiers: [] } }, [fromStep("/request/targets/0/value", "A", "/data/finalValue")]),
        step("C", 30, "REQUIREMENT", { requirement: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">=", expected: 1 }, facts: { numeric: [{ key: "f", value: 2 }] } }),
        step("D", 40, "EXPLANATION", { input: { explanationKey: "x", contributions: [{ contributionKey: "a", order: 1, kind: "FORMULA", response: null }, { contributionKey: "c", order: 2, kind: "REQUIREMENT", response: null }] } }, [
          fromStep("/input/contributions/0/response", "A", ""),
          fromStep("/input/contributions/1/response", "C", ""),
        ]),
      ]),
    );
    expect(run.executionStatus).toBe("PARTIAL");
    expect(run.steps.map((s) => [s.stepKey, s.executionStatus, s.response?.status ?? null])).toEqual([
      ["A", "EXECUTED", "INVALID"],
      ["B", "BLOCKED", null],
      ["C", "EXECUTED", "SUCCESS"],
      ["D", "EXECUTED", "SUCCESS"],
    ]);
    expect(stepOf(run, "A").response?.errors[0]?.code).toBe("FORMULA.DIVISION_BY_ZERO");
    expect(stepOf(run, "B").blockedBy).toEqual([{ target: "/request/targets/0/value", reason: "DEPENDENCY_VALUE_UNAVAILABLE", source: { kind: "STEP", stepKey: "A", pointer: "/data/finalValue" } }]);
  });

  it("a step depending on a BLOCKED step is blocked too (DEPENDENCY_BLOCKED); its primitive never runs", () => {
    const run = ok(
      orchestrate([
        step("A", 1, "FORMULA", { program: { expression: "1 / 0" }, variables: {} }),
        step("B", 2, "FORMULA", { program: { expression: "x" }, variables: { x: 0 } }, [fromStep("/variables/x", "A", "/data/finalValue")]),
        step("C", 3, "FORMULA", { program: { expression: "x" }, variables: { x: 0 } }, [fromStep("/variables/x", "B", "/data/finalValue")]),
      ]),
    );
    expect([stepOf(run, "B").response, stepOf(run, "C").response, stepOf(run, "C").blockedBy[0]?.reason]).toEqual([null, null, "DEPENDENCY_BLOCKED"]);
  });

  it("M4-I146 / M4-I147 / M4-I148: false Requirement, canPay:false and a skipped modifier never block anything", () => {
    const run = ok(
      orchestrate([
        step("req", 1, "REQUIREMENT", { requirement: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">", expected: 100 }, facts: { numeric: [{ key: "f", value: 1 }] } }),
        step("pay", 2, "RESOURCE_PAYMENT_APPLY", { snapshot, payment: { costKey: "c", listedAmount: 999, sources: [{ resourceKey: "r.temp", order: 1 }] } }),
        step("mod", 3, "MODIFIER", { request: { targets: [{ targetKey: "t.x", kind: "NUMERIC", value: 1 }], modifiers: [{ modifierKey: "m", targetKey: "t.x", operation: "ADD", operand: 1, phase: { phaseKey: "p", phaseOrder: 1 }, priority: 0, order: 0, condition: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">", expected: 100 } }], facts: { numeric: [{ key: "f", value: 1 }] } } }),
        step("after", 4, "FORMULA", { program: { expression: "s + p + m" }, variables: { s: 0, p: 0, m: 0 } }, [
          fromStep("/variables/s", "req", "/data/outcome/actual/value"),
          fromStep("/variables/p", "pay", "/data/shortfall"),
          fromStep("/variables/m", "mod", "/data/finalTargets/0/value"),
        ]),
      ]),
    );
    expect([data(run, "req").satisfied, data(run, "pay").canPay, (data(run, "mod").outcomes as { status: string }[])[0]?.status]).toEqual([false, false, "SKIPPED_CONDITION"]);
    expect([run.executionStatus, data(run, "after").finalValue]).toEqual(["COMPLETE", 1 + 993 + 1]);
  });
});

describe("binding matrix", () => {
  const ctxs = { actor: { stats: { n: 4 } }, build: { buildKind: "example.build", parameters: { size: 2 } }, runtime: { resourceValues: { "r.a": 7 }, state: { flag: true } } };
  const formulaFrom = (key: string, context: string, pointer: string) => step(key, 1, "FORMULA", { program: { expression: "x" }, variables: { x: 0 } }, [fromContext("/variables/x", context, pointer)]);

  it("literal only; Actor, Build and Runtime context references copy exact values", () => {
    const run = ok(orchestrate([step("lit", 0, "FORMULA", { program: { expression: "3" }, variables: {} }), formulaFrom("a", "ACTOR", "/stats/n"), { ...formulaFrom("b", "BUILD", "/parameters/size"), order: 2 }, { ...formulaFrom("r", "RUNTIME", "/resourceValues/r.a"), order: 3 }], {}, ctxs));
    expect(["lit", "a", "b", "r"].map((k) => data(run, k).finalValue)).toEqual([3, 4, 2, 7]);
  });

  it("a Ruleset context reference and a whole prior response (root pointer) are copied exactly", () => {
    const run = ok(orchestrate([
      step("f", 1, "FORMULA", { program: { expression: "1" }, variables: {} }),
      step("v", 2, "VALIDATION", { request: { sources: [{ sourceKey: "f", order: 1, response: null }], checks: [{ checkKey: "c", order: 2, category: "RULESET", outcome: "FAIL", failureSeverity: "INFO", code: "X.Y", details: { manifestId: null } }] } }, [
        fromStep("/request/sources/0/response", "f", ""),
        fromContext("/request/checks/0/details/manifestId", "RULESET", "/manifestId"),
      ]),
    ]));
    expect((stepOf(run, "v").response?.info[0]?.details as { manifestId: string }).manifestId).toBe(ctx.manifestId);
    expect(data(run, "v").sources).toEqual([{ sourceKey: "f", order: 1, status: "SUCCESS", errorCount: 0, warningCount: 0, infoCount: 0 }]);
  });

  it("null at an existing path is a real value; a missing path or a missing context blocks", () => {
    const run = ok(orchestrate([
      step("v", 1, "VALIDATION", { request: { checks: [{ checkKey: "c", order: 1, category: "STRUCTURE", outcome: "FAIL", failureSeverity: "INFO", code: "X.Y", path: "/x" }] } }, [fromContext("/request/checks/0/path", "ACTOR", "/actorRef")]),
      formulaFrom("missingPath", "ACTOR", "/stats/absent"),
      { ...formulaFrom("missingCtx", "BUILD", "/parameters/size"), order: 3 },
    ], {}, { actor: { stats: {} } }));
    expect([stepOf(run, "v").executionStatus, stepOf(run, "v").response?.info[0]?.path]).toEqual(["EXECUTED", null]);
    expect([stepOf(run, "missingPath").blockedBy[0]?.reason, stepOf(run, "missingCtx").blockedBy[0]?.reason]).toEqual(["REFERENCE_NOT_FOUND", "CONTEXT_UNAVAILABLE"]);
  });

  it("M4-I141: values are copied verbatim — no arithmetic, rounding or conversion (a fraction stays a fraction)", () => {
    const run = ok(orchestrate([
      step("frac", 1, "FORMULA", { program: { expression: "x / 3" }, variables: { x: 10 } }),
      step("copy", 2, "FORMULA", { program: { expression: "y" }, variables: { y: 0 } }, [fromStep("/variables/y", "frac", "/data/finalValue")]),
    ]));
    expect(data(run, "copy").finalValue).toBe(10 / 3);
  });
});

describe("plan validation — everything static fails closed before step 1 (M4-I138 / M4-I140 / M4-I142 / M4-I143 / M4-I144)", () => {
  const f = (key: string, order = 1, bindings: unknown[] = []) => step(key, order, "FORMULA", { program: { expression: "1" }, variables: { x: 0 } }, bindings);
  it.each([
    ["unknown operation", [{ ...f("a"), operation: "SPELL_COST" }], "ORCHESTRATION.UNKNOWN_OPERATION"],
    ["conflicting duplicate step", [f("a"), f("a", 2)], "ORCHESTRATION.DUPLICATE_STEP"],
    ["self reference", [f("a", 1, [fromStep("/variables/x", "a", "/data/finalValue")])], "ORCHESTRATION.INVALID_REFERENCE"],
    ["forward reference", [f("a", 1, [fromStep("/variables/x", "b", "/data/finalValue")]), f("b", 2)], "ORCHESTRATION.INVALID_REFERENCE"],
    ["same-order later key", [f("b", 1, [fromStep("/variables/x", "c", "")]), f("c", 1)], "ORCHESTRATION.INVALID_REFERENCE"],
    ["unknown step", [f("a", 1, [fromStep("/variables/x", "zzz", "")])], "ORCHESTRATION.INVALID_REFERENCE"],
    ["duplicate target", [f("a", 1, [fromContext("/variables/x", "ACTOR", ""), fromContext("/variables/x", "BUILD", "")])], "ORCHESTRATION.BINDING_TARGET_CONFLICT"],
    ["nested targets", [f("a", 1, [fromContext("/variables", "ACTOR", ""), fromContext("/variables/x", "BUILD", "")])], "ORCHESTRATION.BINDING_TARGET_CONFLICT"],
    ["root target", [f("a", 1, [fromContext("", "ACTOR", "")])], "ORCHESTRATION.INVALID_POINTER"],
    ["target outside the input", [f("a", 1, [fromContext("/missing/x", "ACTOR", "")])], "ORCHESTRATION.INVALID_POINTER"],
    ["prototype pointer", [f("a", 1, [fromContext("/variables/x", "ACTOR", "/__proto__/polluted")])], "ORCHESTRATION.INVALID_POINTER"],
    ["non-canonical pointer", [f("a", 1, [fromContext("/variables/x", "ACTOR", "stats/n")])], "ORCHESTRATION.INVALID_POINTER"],
    ["transform binding", [f("a", 1, [{ target: "/variables/x", source: { kind: "CONTEXT", context: "ACTOR", pointer: "" }, transform: "floor(value / 4)" }])], "ORCHESTRATION.INVALID_BINDING"],
    ["unknown context family", [f("a", 1, [fromContext("/variables/x", "CHARACTER", "")])], "ORCHESTRATION.INVALID_BINDING"],
    ["step-level ruleset override", [{ ...f("a"), ruleset: { kind: "RELEASE", releaseId: IDS.ruleset } }], "ORCHESTRATION.INVALID_STEP"],
    ["unknown input field", [step("a", 1, "FORMULA", { program: { expression: "1" }, ruleset: {} })], "ORCHESTRATION.INVALID_INPUT"],
  ])("%s → %s", (_label, steps, code) => {
    const r = orchestrate(steps as Step[]);
    expect([r.status, codes(r)]).toEqual(["INVALID", [code]]);
  });

  it("designations must name a step of the right operation; WO10 never infers them", () => {
    expect(codes(orchestrate([f("a")], { validationStepKey: "a" }))).toEqual(["ORCHESTRATION.INVALID_DESIGNATION"]);
    expect(codes(orchestrate([f("a")], { explanationStepKey: "a" }))).toEqual(["ORCHESTRATION.INVALID_DESIGNATION"]);
    expect(codes(orchestrate([f("a")], { primaryStepKey: "missing" }))).toEqual(["ORCHESTRATION.INVALID_DESIGNATION"]);
    const run = ok(orchestrate([f("a"), f("b", 2)]));
    expect([run.primaryStepKey, run.validationStepKey, run.explanationStepKey]).toEqual([null, null, null]);
  });

  it("every plan problem is reported together, and nothing executes", () => {
    const r = orchestrate([{ ...f("a"), operation: "NOPE" }, f("b", 1, [fromStep("/variables/x", "b", "")])]);
    expect(codes(r)).toEqual(["ORCHESTRATION.UNKNOWN_OPERATION", "ORCHESTRATION.INVALID_REFERENCE"]);
    expect(r.data).toBeNull();
  });

  it("limits: steps over the maximum fail closed — never truncated", () => {
    expect(codes(orchestrate(Array.from({ length: ORCHESTRATION_LIMITS.MAX_STEPS + 1 }, (_, i) => f(`s${i}`, i))))).toEqual(["ORCHESTRATION.LIMIT_EXCEEDED"]);
  });

  it("a missing RulesetContext is an engine-boundary MISSING_CONTEXT — a run never proceeds without one exact Ruleset", () => {
    const r = orchestrateRulesEvaluation({ evaluationKey: "e", contexts: {}, plan: { steps: [] } });
    expect([r.status, codes(r)]).toEqual(["ERROR", ["RULE_ENGINE.MISSING_CONTEXT"]]);
  });
});

describe("M4-I139 ordering and determinism", () => {
  it("order then stepKey: 10-Z, 20-A, 20-B — regardless of input array order", () => {
    const rows = [step("B", 20, "FORMULA", { program: { expression: "2" } }), step("Z", 10, "FORMULA", { program: { expression: "1" } }), step("A", 20, "FORMULA", { program: { expression: "3" } })];
    const run = ok(orchestrate(rows));
    expect(run.steps.map((s) => s.stepKey)).toEqual(["Z", "A", "B"]);
    for (const shuffled of [[...rows].reverse(), [rows[1], rows[2], rows[0]]]) expect(JSON.stringify(orchestrate(shuffled as Step[]))).toBe(JSON.stringify(orchestrate(rows)));
  });

  it("binding array order never matters", () => {
    const p = pipeline();
    const reversed = p.map((s) => ({ ...s, bindings: [...(s.bindings as unknown[])].reverse() }));
    expect(JSON.stringify(orchestrate(reversed, {}, { actor }))).toBe(JSON.stringify(orchestrate(p, {}, { actor })));
  });

  it("M4-I160: same input → byte-identical response", () => {
    assertDeterministic(() => orchestrate(pipeline(), {}, { actor }), { runs: 4 });
  });
});

describe("M4-I140 / M4-I135 every operation adapter calls exactly its primitive", () => {
  it("each of the 15 operations returns exactly what its primitive returns", () => {
    const resourceRequest = { resourceKey: "r.temp", amount: 1 };
    const cases: [string, Record<string, unknown>, () => RuleEngineResponse<unknown>][] = [
      ["FORMULA", { program: { expression: "2" }, variables: {} }, () => evaluateFormula({ expression: "2" }, {}, { ruleset: ctx })],
      ["KEYWORD", { contributions: [] }, () => resolveKeywords([], { ruleset: ctx })],
      ["REQUIREMENT", { requirement: { kind: "ENTITY_OWNED", entityId: IDS.entityA }, facts: { ownedEntityIds: [] } }, () => evaluateRequirement({ kind: "ENTITY_OWNED", entityId: IDS.entityA }, { ownedEntityIds: [] }, { ruleset: ctx })],
      ["MODIFIER", { request: { targets: [], modifiers: [] } }, () => evaluateModifiers({ targets: [], modifiers: [] }, { ruleset: ctx })],
      ["RESOURCE_SPEND", { snapshot, request: resourceRequest }, () => spendResource(snapshot, resourceRequest, { ruleset: ctx })],
      ["RESOURCE_RESTORE", { snapshot, request: { ...resourceRequest, ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" } }, () => restoreResource(snapshot, { ...resourceRequest, ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" }, { ruleset: ctx })],
      ["RESOURCE_SET_CURRENT", { snapshot, request: { resourceKey: "r.temp", value: 2 } }, () => setResourceCurrent(snapshot, { resourceKey: "r.temp", value: 2 }, { ruleset: ctx })],
      ["RESOURCE_RESERVE_CAPACITY", { snapshot, request: resourceRequest }, () => reserveResourceCapacity(snapshot, resourceRequest, { ruleset: ctx })],
      ["RESOURCE_RELEASE_CAPACITY", { snapshot, request: { resourceKey: "r.temp", amount: 0 } }, () => releaseResourceCapacity(snapshot, { resourceKey: "r.temp", amount: 0 }, { ruleset: ctx })],
      ["RESOURCE_REFRESH", { snapshot, request: { resourceKey: "r.temp", target: "TO_NOMINAL_MAXIMUM" } }, () => refreshResource(snapshot, { resourceKey: "r.temp", target: "TO_NOMINAL_MAXIMUM" }, { ruleset: ctx })],
      ["RESOURCE_PAYMENT_PREVIEW", { snapshot, payment: { costKey: "c", listedAmount: 1, sources: [{ resourceKey: "r.temp", order: 1 }] } }, () => previewResourcePayment(snapshot, { costKey: "c", listedAmount: 1, sources: [{ resourceKey: "r.temp", order: 1 }] }, { ruleset: ctx })],
      ["RESOURCE_PAYMENT_APPLY", { snapshot, payment: { costKey: "c", listedAmount: 1, sources: [{ resourceKey: "r.temp", order: 1 }] } }, () => applyResourcePayment(snapshot, { costKey: "c", listedAmount: 1, sources: [{ resourceKey: "r.temp", order: 1 }] }, { ruleset: ctx })],
      ["VALIDATION", { request: {} }, () => evaluateValidation({}, { ruleset: ctx })],
      ["EXPLANATION", { input: { explanationKey: "x", contributions: [] } }, () => buildExplanation({ explanationKey: "x", contributions: [] }, { ruleset: ctx })],
    ];
    const document = buildExplanation({ explanationKey: "projection", contributions: [] }, { ruleset: ctx }).data;
    cases.push(["EXPLANATION_PROJECT", { document, level: "SUMMARY" }, () => projectExplanation(document, "SUMMARY")]);
    expect(cases.map((c) => c[0])).toEqual([...EVALUATION_OPERATIONS]);
    for (const [operation, input, direct] of cases) {
      const run = ok(orchestrate([step("s", 1, operation, input)]));
      expect(run.steps[0]?.response, operation).toEqual(direct());
    }
  });

  it("M4-I154: RESOURCE_PAYMENT_APPLY returns projected state only — the caller's snapshot is untouched", () => {
    const before = JSON.stringify(snapshot);
    const run = ok(orchestrate([step("pay", 1, "RESOURCE_PAYMENT_APPLY", { snapshot, payment: { costKey: "c", listedAmount: 3, sources: [{ resourceKey: "r.temp", order: 1 }] } })]));
    expect((data(run, "pay").resultingResources as { resources: { current: number }[] }).resources.map((r) => r.current)).toEqual([20, 3]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe("M4-I159 immutability and safety", () => {
  it("plan, templates and contexts are never mutated or frozen; the output is deep-frozen and serializable", () => {
    const plan = { steps: pipeline() };
    const contexts = { ruleset: ctx, actor: { stats: { divisor: 4 } } };
    const before = JSON.stringify([plan, contexts.actor]);
    const r = orchestrateRulesEvaluation({ evaluationKey: "e", contexts, plan });
    expect(JSON.stringify([plan, contexts.actor])).toBe(before);
    expect(Object.isFrozen(plan) || Object.isFrozen(plan.steps[1]) || Object.isFrozen((plan.steps[1] as { input: object }).input) || Object.isFrozen(contexts.actor)).toBe(false);
    expect(Object.isFrozen(r.data?.steps[0]?.response) && Object.isFrozen(r.data?.steps)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("getters, prototypes and cycles in the plan fail safely without invocation", () => {
    let called = false;
    const getterStep = step("a", 1, "FORMULA", { program: { expression: "1" } });
    Object.defineProperty(getterStep, "operation", { enumerable: true, get: () => ((called = true), "FORMULA") });
    expect(codes(orchestrate([getterStep]))).toEqual(["ORCHESTRATION.INVALID_STEP"]);
    const cyclic: Record<string, unknown> = { expression: "1" };
    cyclic.self = cyclic;
    expect(codes(orchestrate([step("a", 1, "FORMULA", { program: cyclic })]))).toEqual(["ORCHESTRATION.INVALID_INPUT"]);
    expect(codes(orchestrate([JSON.parse('{"stepKey":"a","order":1,"operation":"FORMULA","input":{},"__proto__":{"x":1}}')]))).toEqual(["ORCHESTRATION.INVALID_STEP"]);
    const getterPlan = {} as Record<string, unknown>;
    Object.defineProperty(getterPlan, "steps", { enumerable: true, get: () => ((called = true), []) });
    expect(codes(orchestrateRulesEvaluation({ evaluationKey: "e", contexts: { ruleset: ctx }, plan: getterPlan }))).toEqual(["ORCHESTRATION.INVALID_PLAN"]);
    expect(called).toBe(false);
  });

  it("large sanity: a 1,500-step chain, each step bound to the previous one — deterministic, no stack overflow", () => {
    const steps = Array.from({ length: 1500 }, (_, i) =>
      step(`s${String(i).padStart(4, "0")}`, i, "FORMULA", { program: { expression: "x + 1" }, variables: { x: 0 } }, i === 0 ? [] : [fromStep("/variables/x", `s${String(i - 1).padStart(4, "0")}`, "/data/finalValue")]),
    );
    const r = assertDeterministic(() => orchestrate(steps), { runs: 2 });
    const run = r.data as EvaluationRun;
    expect([run.executionStatus, run.steps.length, (run.steps[1499]?.response?.data as { finalValue: number }).finalValue]).toEqual(["COMPLETE", 1500, 1500]);
  });
});

export type { RulesetContext };
