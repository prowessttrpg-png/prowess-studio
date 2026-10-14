import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationPlan } from "@prowess/rules";
import { RulesLab } from "../../app/developer/rules/_components/lab";
import { StepOverview, TraceView } from "../../app/developer/rules/_components/views";
import { orderedSteps, parseObject, snapshotRequest } from "../../app/developer/rules/_lib/editor";
import { samplePlan } from "../../app/developer/rules/_lib/sample";
import { runRulesEvaluation } from "../../src/api-client/rules";
import { apiList, GovernanceApiError } from "../../src/api-client/http";
import DeveloperPage from "../../app/developer/page";

vi.mock("../../src/api-client/rules", () => ({ runRulesEvaluation: vi.fn() }));
vi.mock("../../src/api-client/http", async importOriginal => ({ ...await importOriginal<typeof import("../../src/api-client/http")>(), apiList: vi.fn() }));
const ids = { ruleset: "10000000-0000-4000-8000-000000000001", manifest: "20000000-0000-4000-8000-000000000001", entity: "40000000-0000-4000-8000-000000000001" };
const context = createRulesetContext({ rulesetId: ids.ruleset, manifestId: ids.manifest, rules: [] });
if (!context.ok) throw new Error("fixture");
const evaluate = (plan: EvaluationPlan) => orchestrateRulesEvaluation({ evaluationKey: "lab.example", contexts: { ruleset: context.value, actor: { stats: { divisor: 4 } } }, plan });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiList).mockImplementation(async path => ({ items: path.startsWith("/api/rulesets?") ? [{ id: ids.ruleset, name: "Fixture" }] : path.includes("/releases") ? [{ id: "release-1", releaseNumber: 1, versionLabel: "R1", manifestHash: "hash" }] : [{ id: ids.manifest, manifestVersion: 1 }], pagination: null }));
  vi.mocked(runRulesEvaluation).mockImplementation(async request => evaluate(request.plan as unknown as EvaluationPlan));
});
async function setup() {
  render(<RulesLab />);
  await waitFor(() => expect(screen.getByLabelText("Ruleset")).toHaveTextContent("Fixture"));
  fireEvent.change(screen.getByLabelText("Ruleset"), { target: { value: ids.ruleset } });
  await waitFor(() => expect(screen.getByLabelText("Exact Manifest")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Exact Manifest"), { target: { value: ids.manifest } });
  fireEvent.click(screen.getByRole("button", { name: "Load neutral sample" }));
}
async function run() { fireEvent.click(screen.getByRole("button", { name: "Run Evaluation" })); await waitFor(() => expect(screen.getByLabelText("Executed step timeline")).toBeInTheDocument()); }
function inspect(key: string, operation: string) { fireEvent.click(within(screen.getByLabelText("Executed step timeline")).getByRole("button", { name: new RegExp(`${key} · ${operation}`) })); }

describe("WO11 editor — M4-I167–I170 / I184", () => {
  it("syntax checks object/null only; semantic fields remain server-owned", () => {
    expect(parseObject('{"stats":{"opaque":17}}', "Actor")).toEqual({ stats: { opaque: 17 } });
    expect(parseObject("null", "Actor")).toBeNull();
    expect(() => parseObject("[]", "Actor")).toThrow("object or null");
    expect(() => parseObject("{", "Actor")).toThrow("invalid JSON");
  });
  it("order preview matches code-unit order and request snapshots are detached/deep-frozen", () => {
    const steps = [{ order: 20, stepKey: "B" }, { order: 10, stepKey: "Z" }, { order: 20, stepKey: "A" }];
    expect(orderedSteps(steps).map(step => step.stepKey)).toEqual(["Z", "A", "B"]);
    const input = { actor: { stats: { divisor: 4 } } }; const copy = snapshotRequest(input);
    input.actor.stats.divisor = 8;
    expect(copy.actor.stats.divisor).toBe(4); expect(Object.isFrozen(copy.actor.stats)).toBe(true);
  });
  it("no auto selection; explicit Manifest/Release modes and nullable contexts", async () => {
    render(<RulesLab />);
    expect(screen.getByRole("button", { name: "Run Evaluation" })).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText("Ruleset")).toHaveTextContent("Fixture"));
    expect(screen.getByLabelText("Ruleset")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    expect(screen.getByLabelText("Exact Release")).toHaveValue("");
    for (const family of ["actor", "build", "runtime"]) expect(screen.getByLabelText(`${family} JSON`)).toHaveValue("null");
    fireEvent.change(screen.getByLabelText("actor context mode"), { target: { value: "ENABLED" } });
    expect(screen.getByLabelText("actor JSON")).toHaveValue("{}");
  });
  it("step CRUD, operation vocabulary, prior-step filtering and canonical designation filtering", async () => {
    await setup();
    expect(within(screen.getByLabelText("Operation")).getByRole("option", { name: "EXPLANATION_PROJECT" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("Authored execution order")).getByRole("button", { name: "30 · FORMULA · derived" }));
    const prior = screen.getByLabelText("Prior step");
    expect(prior).toHaveTextContent("base"); expect(prior).toHaveTextContent("listed"); expect(prior).not.toHaveTextContent("payment");
    expect(screen.getByLabelText("Explanation Step")).not.toHaveTextContent("summary");
    expect(screen.getByLabelText("Validation Step")).not.toHaveTextContent("payment");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Step" }));
    expect(screen.getByLabelText("stepKey")).toHaveValue("step-8");
    fireEvent.click(screen.getByRole("button", { name: "Remove Step" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));
    expect(screen.getByLabelText("stepKey")).toHaveValue("step-9");
    fireEvent.click(screen.getByRole("button", { name: "Add Binding" }));
    expect(screen.getByLabelText("Source pointer")).toHaveValue("");
    expect(screen.getByText("Whole Context")).toBeInTheDocument();
  });
  it("syntax error disables Run without evaluating or duplicating semantic validation", async () => {
    await setup(); fireEvent.change(screen.getByLabelText("Input template JSON"), { target: { value: "{" } });
    expect(screen.getByRole("button", { name: "Run Evaluation" })).toBeDisabled();
    expect(runRulesEvaluation).not.toHaveBeenCalled();
  });
});

describe("WO11 results — M4-I171–I183", () => {
  it("golden COMPLETE result preserves listed 17 / derived 4 / payments 6+11 / remaining 9 and returned SUMMARY", async () => {
    await setup(); await run();
    expect(screen.getByText("COMPLETE", { selector: "strong" })).toBeInTheDocument();
    inspect("payment", "RESOURCE_PAYMENT_APPLY");
    expect(screen.getByTestId("listed-value")).toHaveTextContent("17");
    expect(screen.getByTestId("payment-allocation")).toHaveTextContent("r.temp66");
    expect(screen.getByTestId("payment-allocation")).toHaveTextContent("r.primary20119");
    expect(screen.getByTestId("resulting-resources")).toHaveTextContent("r.primary9");
    inspect("derived", "FORMULA");
    expect(screen.getByTestId("overview-derived")).toHaveTextContent("4.25");
    expect(screen.getByTestId("overview-derived")).toHaveTextContent("Final Result4");
    fireEvent.change(screen.getByLabelText("Returned explanation step"), { target: { value: "summary" } });
    expect(screen.getByLabelText("SUMMARY explanation")).toBeInTheDocument();
    expect(screen.getByTestId("explanation-payment")).toHaveTextContent("17");
    fireEvent.click(screen.getAllByRole("button", { name: /^Trace derived \/ / })[0]!);
    expect(screen.getByRole("tab", { name: "TRACE" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector('[data-focused="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "PROVENANCE" }));
    expect(screen.getByText("Ruleset Provenance — exact returned identity")).toBeInTheDocument();
  });
  it("edited context and Ruleset selection make old responses STALE without rerun", async () => {
    await setup(); await run();
    fireEvent.change(screen.getByLabelText("actor JSON"), { target: { value: '{"stats":{"divisor":8}}' } });
    expect(screen.getByText(/STALE — Inputs changed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    expect(runRulesEvaluation).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Evaluated request snapshot")).toHaveTextContent('"divisor": 4');
  });
  it("request errors render separately; a subsequent failure clears old run data", async () => {
    await setup(); await run();
    vi.mocked(runRulesEvaluation).mockRejectedValueOnce(new GovernanceApiError("RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE", "Hash verification failed", 409));
    fireEvent.click(screen.getByRole("button", { name: "Run Evaluation" }));
    await waitFor(() => expect(screen.getByText("Request Error — evaluation did not run")).toBeInTheDocument());
    expect(screen.queryByLabelText("Executed step timeline")).not.toBeInTheDocument();
  });
  it("PARTIAL, INVALID child and independent false Requirement remain rule outcomes", () => {
    const plan = { steps: [
      { stepKey: "a", order: 1, operation: "FORMULA", input: { program: { expression: "1 / 0" }, variables: {} }, bindings: [] },
      { stepKey: "b", order: 2, operation: "MODIFIER", input: { request: {} }, bindings: [{ target: "/request", source: { kind: "STEP", stepKey: "a", pointer: "/data/missing" } }] },
      { stepKey: "c", order: 3, operation: "REQUIREMENT", input: { requirement: { kind: "ENTITY_OWNED", entityId: ids.entity }, facts: { ownedEntityIds: [] } }, bindings: [] },
    ] } as EvaluationPlan;
    const result = evaluate(plan); expect(result.data?.executionStatus).toBe("PARTIAL");
    render(<><StepOverview step={result.data!.steps[0]!} /><StepOverview step={result.data!.steps[1]!} /><StepOverview step={result.data!.steps[2]!} /></>);
    expect(screen.getByText("INVALID", { selector: "strong" })).toBeInTheDocument(); expect(screen.getByText("BLOCKED", { selector: "h3" })).toBeInTheDocument(); expect(screen.getByText("NOT SATISFIED", { selector: "h4" })).toBeInTheDocument();
    expect(screen.queryByText("Request Error")).not.toBeInTheDocument();
  });
  it("insufficient payment displays unchanged resulting states; reservation remains capacity", () => {
    const sample = samplePlan(); const payment = sample.steps.find(step => step.stepKey === "payment")!;
    const result = evaluate({ steps: [{ ...payment, bindings: [], input: { snapshot: { resources: [{ resourceKey: "r.a", kind: "POOL", current: 6, minimum: 0, maximum: 20, reservedCapacity: 0 }, { resourceKey: "r.b", kind: "POOL", current: 2, minimum: 0, maximum: 20, reservedCapacity: 0 }] }, payment: { costKey: "x", listedAmount: 10, sources: [{ resourceKey: "r.a", order: 1 }, { resourceKey: "r.b", order: 2 }] } } }] });
    render(<StepOverview step={result.data!.steps[0]!} />);
    expect(screen.getByText("Payment unavailable — State unchanged")).toBeInTheDocument(); expect(screen.getByText("Shortfall 2")).toBeInTheDocument(); expect(screen.getByTestId("resulting-resources")).toHaveTextContent("r.a6r.b2");
  });
  it("large trace renders lazily and preserves exact source order", () => {
    const result = evaluate(samplePlan()); const trace = result.data!.steps[0]!.response!.trace;
    render(<TraceView trace={trace} />); expect(screen.queryByText("Resolved Inputs")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[0]!); expect(screen.getByText("Resolved Inputs")).toBeInTheDocument();
  });
  it("M4-I174 / I177: skipped and deduplicated modifiers stay distinct; reservation does not spend current", () => {
    const base = { targetKey: "t.x", operation: "ADD", operand: 1, phase: { phaseKey: "p", phaseOrder: 1 }, priority: 0, order: 0 };
    const result = evaluate({ steps: [
      { stepKey: "mod", order: 1, operation: "MODIFIER", input: { request: { targets: [{ targetKey: "t.x", kind: "NUMERIC", value: 17 }], modifiers: [
        { ...base, modifierKey: "skip", condition: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">", expected: 100 } },
        { ...base, modifierKey: "a", stacking: { policy: "UNIQUE", stackingKey: "g" } },
        { ...base, modifierKey: "z", stacking: { policy: "UNIQUE", stackingKey: "g" } },
      ], facts: { numeric: [{ key: "f", value: 1 }] } } }, bindings: [] },
      { stepKey: "reserve", order: 2, operation: "RESOURCE_RESERVE_CAPACITY", input: { snapshot: { resources: [{ resourceKey: "r.c", kind: "POOL", current: 18, minimum: 0, maximum: 20, reservedCapacity: 0 }] }, request: { resourceKey: "r.c", amount: 6 } }, bindings: [] },
    ] });
    render(<><StepOverview step={result.data!.steps[0]!} /><StepOverview step={result.data!.steps[1]!} /></>);
    expect(screen.getByText("SKIPPED — SKIPPED_CONDITION")).toBeInTheDocument(); expect(screen.getByText("DEDUPLICATED")).toBeInTheDocument();
    expect(screen.getByText("Capacity Reserved")).toBeInTheDocument();
    expect(screen.getByTestId("overview-reserve")).toHaveTextContent('"current": 18');
    expect(screen.getByTestId("overview-reserve")).toHaveTextContent("Available Maximum After14");
  });
  it("in-flight guard prevents duplicate requests and edits during a run remain stale", async () => {
    await setup(); let resolve!: (value: ReturnType<typeof evaluate>) => void;
    vi.mocked(runRulesEvaluation).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const button = screen.getByRole("button", { name: "Run Evaluation" }); fireEvent.click(button); fireEvent.click(button);
    expect(runRulesEvaluation).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("actor JSON"), { target: { value: "null" } }); resolve(evaluate(samplePlan()));
    await waitFor(() => expect(screen.getByText(/STALE — Inputs changed/)).toBeInTheDocument());
  });
  it("M4-I178: exact validation severity/code/path/details are displayed", () => {
    const result = evaluate({ steps: [{ stepKey: "validation", order: 1, operation: "VALIDATION", input: { request: { checks: ["ERROR", "WARNING", "INFO"].map((severity, order) => ({ checkKey: `c.${order}`, order, outcome: "FAIL", failureSeverity: severity, category: "STRUCTURE", code: `LAB.${severity}`, message: `Lab ${severity}`, path: `/lab/${order}`, details: { exact: 15.3 } })) } }, bindings: [] }] });
    render(<StepOverview step={result.data!.steps[0]!} />);
    for (const severity of ["ERROR", "WARNING", "INFO"]) expect(screen.getByText(new RegExp(`^${severity} · STRUCTURE · LAB\\.${severity}`))).toBeInTheDocument();
    expect(screen.getByTestId("overview-validation")).toHaveTextContent('"exact": 15.3');
  });
  it("navigation is Developer-only and pane/inspector controls expose selected text states", async () => {
    render(<DeveloperPage />); expect(screen.getByRole("link", { name: "Rules Inspector / Calculation Lab" })).toHaveAttribute("href", "/developer/rules");
    render(<RulesLab />); fireEvent.click(screen.getByRole("tab", { name: "DETAILS" })); expect(screen.getByRole("tab", { name: "DETAILS" })).toHaveAttribute("aria-selected", "true");
  });
});

it("WO11 large-plan sanity: 1,000 step rows remain ordered and evaluable", async () => {
  await setup();
  const plan = { steps: Array.from({ length: 1000 }, (_, order) => ({ stepKey: `row.${order}`, order, operation: "FORMULA", input: { program: { expression: "17" }, variables: {} }, bindings: [] })) };
  fireEvent.change(screen.getByLabelText("Plan JSON"), { target: { value: JSON.stringify(plan) } });
  fireEvent.click(screen.getByRole("button", { name: "Use plan JSON" }));
  expect(within(screen.getByLabelText("Authored execution order")).getAllByRole("listitem")).toHaveLength(1000);
  await run();
  expect(within(screen.getByLabelText("Executed step timeline")).getAllByRole("listitem")).toHaveLength(1000);
});
