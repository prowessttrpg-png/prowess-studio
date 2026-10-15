// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as engine from "@prowess/rules";
import {
  createRulesetContext, orchestrateRulesEvaluation, projectExplanation, evaluate, evaluateFormula,
  evaluateRequirement, evaluateModifiers, applyResourcePayment, reserveResourceCapacity, evaluateValidation,
  buildExplanation, FORMULA_LIMITS, REQUIREMENT_LIMITS, MODIFIER_LIMITS, RESOURCE_LIMITS, VALIDATION_LIMITS,
  EXPLANATION_LIMITS, ORCHESTRATION_LIMITS, type EvaluationRun, type ExplanationDocument,
  type RuleEngineResponse,
} from "@prowess/rules";
import { samplePlan } from "../../app/developer/rules/_lib/sample";

const outcome = createRulesetContext({ rulesetId: "40000000-0000-4000-8000-000000000001", manifestId: "40000000-0000-4000-8000-000000000002", rules: [] });
if (!outcome.ok) throw new Error("invalid audit context");
const ruleset = outcome.value;
const run = (plan: unknown, contexts: Record<string, unknown> = {}) => orchestrateRulesEvaluation({ evaluationKey: "audit.final", contexts: { ruleset, ...contexts }, plan });

describe("WO12 top-level getter safety — M4-I04/I08/I09/I159", () => {
  it("rejects context accessors without invoking caller code", () => {
    const getter = vi.fn(() => 4);
    const stats = Object.defineProperty({}, "divisor", { enumerable: true, get: getter });
    const response = run(samplePlan(), { actor: { stats } });
    expect(getter).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
  });
  it("rejects accessors at plan array indices without invoking caller code", () => {
    const getter = vi.fn(() => samplePlan().steps[0]);
    const steps = Object.defineProperty([null], "0", { enumerable: true, get: getter });
    const response = run({ steps });
    expect(getter).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
  });
  it.each(["plan", "step", "binding", "source"])("rejects non-enumerable %s accessors without invoking caller code", surface => {
    const source = { kind: "CONTEXT", context: "ACTOR", pointer: "/stats/divisor" };
    const binding = { target: "/variables/x", source };
    const step = { stepKey: "probe", order: 1, operation: "FORMULA", input: { program: { expression: "x" }, variables: { x: 0 } }, bindings: [binding] };
    const plan = { steps: [step] };
    const targets = { plan: [plan, "steps"], step: [step, "operation"], binding: [binding, "source"], source: [source, "pointer"] } as const;
    const [target, key] = targets[surface as keyof typeof targets];
    const value = Object.getOwnPropertyDescriptor(target, key)!.value;
    const getter = vi.fn(() => value);
    Object.defineProperty(target, key, { enumerable: false, get: getter });
    const response = run(plan, { actor: { stats: { divisor: 4 } } });
    expect(getter).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
  });
});

const gold = () => run(samplePlan(), { actor: { stats: { divisor: 4 } } });
const dataOf = (result: RuleEngineResponse<EvaluationRun>, key: string) => result.data!.steps.find(s => s.stepKey === key)!.response!.data as Record<string, unknown>;
const frozen = (value: unknown): boolean => value === null || typeof value !== "object" || Object.isFrozen(value) && Object.values(value).every(frozen);

describe("WO12 integrated golden — M4-I14/I128/I129/I162/I162A", () => {
  it("17 / 4 / 6+11 survives every pure child and both server explanation levels", () => {
    const response = gold(); expect(response.status).toBe("SUCCESS"); expect(response.data!.executionStatus).toBe("COMPLETE");
    expect((dataOf(response, "listed").finalTargets as Array<{value: number}>)[0]!.value).toBe(17);
    expect(dataOf(response, "derived")).toMatchObject({ expressionValue: 4.25, finalValue: 4 });
    expect(dataOf(response, "payment")).toMatchObject({ listedAmount: 17, canPay: true, allocations: [{amountPaid: 6}, {amountPaid: 11}], resultingResources: { resources: [{ current: 9 }, { current: 0 }] } });
    expect(dataOf(response, "validation")).toMatchObject({ errorCount: 0 });
    const detailed = dataOf(response, "explanation") as unknown as ExplanationDocument;
    const summary = dataOf(response, "summary") as unknown as ExplanationDocument;
    expect(detailed.level).toBe("DETAILED"); expect(summary.level).toBe("SUMMARY");
    expect(response.data!.steps.find(s => s.stepKey === "summary")!.response).toEqual(projectExplanation(detailed, "SUMMARY"));
    for (const doc of [detailed, summary]) {
      expect(doc.sections.find(s => s.sectionKey === "payment")!.facts.find(f => f.factKey === "listedAmount")!.value).toBe(17);
      expect(doc.sections.find(s => s.sectionKey === "derived")!.facts.find(f => f.factKey === "finalValue")!.value).toBe(4);
    }
    expect(JSON.stringify(response)).not.toMatch(/effectiveCost|netCost|adjustedCost/);
  });
  it("array/binding/contribution shuffles preserve the entire deterministic response", () => {
    const original = structuredClone(samplePlan());
    const plan = { ...original, steps: [...original.steps].reverse().map(step => ({ ...step, bindings: [...step.bindings].reverse() })) };
    const explanation = plan.steps.find(s => s.operation === "EXPLANATION")!;
    // Shuffle contribution inputs together with exact binding targets (identity remains explicit).
    const input = explanation.input.input as { contributions: unknown[] };
    input.contributions.reverse();
    const max = input.contributions.length - 1;
    explanation.bindings = explanation.bindings.map(b => ({ ...b, target: b.target.replace(/\/contributions\/(\d+)\//, (_m, i: string) => `/contributions/${max - Number(i)}/`) }));
    expect(run(plan, { actor: { stats: { divisor: 4 } } })).toEqual(gold());
  });
  it("concurrent exact evaluations are deeply equal, frozen, serializable and detached", async () => {
    const plan = samplePlan(); const actor = { stats: { divisor: 4 } }; const before = JSON.stringify({ plan, actor });
    const responses = await Promise.all(Array.from({ length: 24 }, async () => run(plan, { actor })));
    expect(JSON.stringify({ plan, actor })).toBe(before);
    expect(Object.isFrozen(plan)).toBe(false); expect(Object.isFrozen(actor)).toBe(false);
    const saved = JSON.stringify(responses[0]); actor.stats.divisor = 8; plan.steps[0]!.input.program = { expression: "999" };
    for (const response of responses) { expect(JSON.stringify(response)).toBe(saved); expect(JSON.parse(saved)).toEqual(response); expect(frozen(response)).toBe(true); }
  });
  it("clock, random, network and locale ordering cannot affect the golden evaluation", () => {
    const expected = gold(); const forbidden = () => { throw new Error("environment dependency"); };
    let actual: ReturnType<typeof gold>;
    const spies = [vi.spyOn(Date, "now").mockImplementation(forbidden), vi.spyOn(Math, "random").mockImplementation(forbidden), vi.spyOn(String.prototype, "localeCompare").mockImplementation(forbidden), vi.spyOn(globalThis, "fetch").mockImplementation(forbidden)];
    try { actual = gold(); } finally { for (const spy of spies) spy.mockRestore(); }
    expect(actual).toEqual(expected);
  });
});

describe("WO12 top-level security surfaces — M4-I04/I08/I159", () => {
  it.each(["FORMULA", "REQUIREMENT", "MODIFIER", "RESOURCE_PAYMENT_APPLY", "VALIDATION", "EXPLANATION", "EXPLANATION_PROJECT"] as const)("%s rejects nested accessors without mechanics or caller execution", operation => {
    const getter = vi.fn(() => { throw new Error("authored getter"); });
    const bad = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    const fields: Record<string, string> = { FORMULA: "program", REQUIREMENT: "facts", MODIFIER: "request", RESOURCE_PAYMENT_APPLY: "snapshot", VALIDATION: "request", EXPLANATION: "input", EXPLANATION_PROJECT: "document" };
    const response = run({ steps: [{ stepKey: "attack", order: 1, operation, input: { [fields[operation]!]: bad } }] });
    expect(response.success).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(response.data).toBeNull();
  });
  it.each(["actor", "build", "runtime"])("%s context accessors fail without invocation", family => {
    const getter = vi.fn(() => { throw new Error("context getter"); });
    const field = family === "actor" ? "stats" : family === "build" ? "buildKind" : "state";
    const response = run({ steps: [] }, { [family]: Object.defineProperty({}, field, { enumerable: true, get: getter }) });
    expect(response.success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("an optional context getter is rejected rather than guessed absent", () => {
    const getter = vi.fn(() => ({}));
    const contexts = Object.defineProperty({ ruleset }, "actor", { enumerable: true, get: getter });
    const response = orchestrateRulesEvaluation({ evaluationKey: "audit", contexts, plan: { steps: [] } });
    expect(response.success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("core failure reporting never reads a kind getter", () => {
    const getter = vi.fn(() => "audit.noop");
    const response = evaluate({ kind: "audit.noop", evaluate: () => ({ data: null }) }, Object.defineProperty({}, "kind", { enumerable: true, get: getter }));
    expect(response.success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("array method getters and non-plain constructor getters are never invoked", () => {
    const getter = vi.fn(() => { throw new Error("getter"); });
    const array = Object.defineProperty([1], "map", { get: getter });
    const object = Object.defineProperty(Object.create({}), "constructor", { get: getter });
    for (const variables of [{ x: array }, { x: object }]) expect(run({ steps: [{ stepKey: "a", order: 1, operation: "FORMULA", input: { program: { expression: "x" }, variables } }] }).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["__proto__", "prototype", "constructor"])("rejects unsafe key/pointer %s", key => {
    const bad = JSON.parse(`{"${key}":1}`) as object;
    expect(run({ steps: [{ stepKey: "a", order: 1, operation: "FORMULA", input: { program: bad } }] }).success).toBe(false);
    expect(run({ steps: [{ stepKey: "a", order: 1, operation: "FORMULA", input: { variables: { x: 0 }, program: { expression: "x" } }, bindings: [{ target: "/variables/x", source: { kind: "CONTEXT", context: "ACTOR", pointer: `/${key}` } }] }] }).success).toBe(false);
  });
  it("array prototype/iteration overrides cannot execute caller callbacks or silently drop steps", () => {
    const callback = vi.fn();
    const step = {stepKey: "a", order: 1, operation: "FORMULA", input: {program: {expression: "1"}}};
    const steps = Object.defineProperty([step], "forEach", {value: callback});
    const response = run({steps});
    expect(callback).not.toHaveBeenCalled(); expect(response.success).toBe(false);
    const protoArray = Object.setPrototypeOf([1], {map: callback});
    expect(run({steps: [{...step, input: {program: {expression: "x"}, variables: {x: protoArray}}}]}).success).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });
  it("cycles and excessive nesting fail explicitly without recursion crashes", () => {
    const cycle: Record<string, unknown> = {}; cycle.x = cycle;
    let deep: Record<string, unknown> = {}; for (let i = 0; i < 5000; i++) deep = { x: deep };
    for (const variables of [cycle, deep]) {
      const result = run({ steps: [{ stepKey: "a", order: 1, operation: "FORMULA", input: { program: { expression: "x" }, variables } }] });
      expect(result.success).toBe(false); expect(result.data).toBeNull();
    }
  });
});

describe("WO12 closed contract constants — M4-I03/I140", () => {
  it("attempted mutation of a public vocabulary cannot change the same evaluation", () => {
    const operations = engine.EVALUATION_OPERATIONS as unknown as string[];
    const before = gold(); const saved = [...operations];
    try {
      try {operations.shift();} catch { /* frozen contract rejects mutation */ }
      expect(gold()).toEqual(before);
    } finally {if (!Object.isFrozen(operations)) operations.splice(0, operations.length, ...saved);}
  });
  it("public contract collections and limits are deeply immutable", () => {
    for (const [name, value] of Object.entries(engine)) if (/^[A-Z_]+$/.test(name) && value !== null && typeof value === "object") expect(frozen(value), name).toBe(true);
  });
});

describe("WO12 documented maximum and one-over rejection", () => {
  it("Formula source limit (M4-I26/I64) accepts the maximum and rejects one over", () => {
    expect(evaluateFormula({ expression: "1".padEnd(FORMULA_LIMITS.MAX_SOURCE_LENGTH) }, {}).success).toBe(true);
    expect(evaluateFormula({ expression: "1".padEnd(FORMULA_LIMITS.MAX_SOURCE_LENGTH + 1) }, {}).success).toBe(false);
  });
  it("Requirement group limit accepts all children and explicitly rejects one over", () => {
    const children = Array.from({ length: REQUIREMENT_LIMITS.MAX_CHILDREN_PER_GROUP }, () => ({ kind: "ENTITY_OWNED", entityId: "40000000-0000-4000-8000-000000000003" }));
    expect(evaluateRequirement({ kind: "ALL", children }, { ownedEntityIds: [] }).data?.satisfied).toBe(false);
    expect(evaluateRequirement({ kind: "ALL", children: [...children, children[0]] }, { ownedEntityIds: [] }).success).toBe(false);
  });
  it("Modifier target limit accepts maximum and rejects one over", () => {
    const targets = Array.from({ length: MODIFIER_LIMITS.MAX_TARGETS }, (_, i) => ({ targetKey: `t.n${i}`, kind: "NUMERIC", value: 1 }));
    expect(evaluateModifiers({ targets, modifiers: [] }).success).toBe(true);
    expect(evaluateModifiers({ targets: [...targets, { targetKey: "t.extra", kind: "NUMERIC", value: 1 }], modifiers: [] }).success).toBe(false);
  });
  it("Resource source and state limits accept maximum and reject one over", () => {
    const resources = Array.from({ length: RESOURCE_LIMITS.MAX_RESOURCES }, (_, i) => ({ resourceKey: `r.n${i}`, kind: "POOL", current: 1, minimum: 0, maximum: 1, reservedCapacity: 0 }));
    const sources = resources.map((r, order) => ({ resourceKey: r.resourceKey, order }));
    expect(applyResourcePayment({ resources }, { costKey: "c", listedAmount: 1, sources }).success).toBe(true);
    expect(applyResourcePayment({ resources }, { costKey: "c", listedAmount: 1, sources: [...sources, sources[0]] }).success).toBe(false);
    expect(reserveResourceCapacity({ resources: [...resources, { ...resources[0], resourceKey: "r.extra" }] }, { resourceKey: "r.n0", amount: 1 }).success).toBe(false);
  });
  it("Validation checks accept maximum and reject one over", () => {
    const checks = Array.from({ length: VALIDATION_LIMITS.MAX_CHECKS }, (_, order) => ({ checkKey: `c.${order}`, order, outcome: "PASS", failureSeverity: "ERROR", category: "STRUCTURE", code: "AUDIT.PASS", message: "Audit check", path: "" }));
    expect(evaluateValidation({ checks }).success).toBe(true);
    expect(evaluateValidation({ checks: [...checks, { ...checks[0], checkKey: "c.extra", order: checks.length }] }).success).toBe(false);
  });
  it("Explanation contribution limit accepts maximum and rejects one over", () => {
    const response = evaluateFormula({ expression: "1" }, {});
    const contributions = Array.from({ length: EXPLANATION_LIMITS.MAX_CONTRIBUTIONS }, (_, order) => ({ contributionKey: `c.${order}`, order, kind: "FORMULA", response }));
    expect(buildExplanation({ explanationKey: "limit", contributions }).success).toBe(true);
    expect(buildExplanation({ explanationKey: "limit", contributions: [...contributions, { contributionKey: "extra", order: contributions.length, kind: "FORMULA", response }] }).success).toBe(false);
  });
  it("Orchestration maximum executes every step; one over executes none", () => {
    const steps = Array.from({ length: ORCHESTRATION_LIMITS.MAX_STEPS }, (_, order) => ({ stepKey: `s${order}`, order, operation: "FORMULA", input: { program: { expression: "1" }, variables: {} } }));
    expect(run({ steps }).data?.steps).toHaveLength(ORCHESTRATION_LIMITS.MAX_STEPS);
    const result = run({ steps: [...steps, { ...steps[0], stepKey: "extra", order: steps.length }] });
    expect(result.data).toBeNull(); expect(result.errors[0]?.code).toBe("ORCHESTRATION.LIMIT_EXCEEDED");
  });
});
