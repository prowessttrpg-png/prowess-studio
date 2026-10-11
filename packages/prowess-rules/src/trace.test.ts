import { describe, expect, it } from "vitest";
import {
  RulesEngineError,
  buildTrace,
  createRulesetContext,
  evaluate,
  flattenTrace,
  identifierValue,
  listValue,
  numberValue,
  provenanceOf,
  stringValue,
  booleanValue,
  type TraceStepInput,
} from "./index.js";
import { IDS, requestInput, rulesetInput } from "./testing/fixtures.js";

/** M4-WO1 trace contract. Guards M4-I10 (Deterministic Trace Ordering) and M4-I11 (Rule Provenance Preserved). */
const steps = (): TraceStepInput[] => [
  {
    key: "step.total",
    operation: "op.example",
    phase: "phase.base",
    inputs: [
      { name: "left", value: numberValue(4, "unit.example") },
      { name: "right", value: numberValue(2) },
    ],
    output: numberValue(6),
    explanation: "Combine the two example inputs.",
    children: [
      { key: "step.left", operation: "op.read", output: numberValue(4) },
      { key: "step.right", operation: "op.read", output: numberValue(2), children: [{ key: "step.leaf", operation: "op.read" }] },
    ],
  },
  { key: "step.after", operation: "op.example" },
];

describe("M4-I10 deterministic trace identity and order", () => {
  it("assigns hierarchical 1-based paths and 0-based pre-order ordinals, with no random ids or timestamps", () => {
    const trace = buildTrace(steps());
    expect(flattenTrace(trace).map((s) => [s.ordinal, s.path, s.key])).toEqual([
      [0, "1", "step.total"],
      [1, "1.1", "step.left"],
      [2, "1.2", "step.right"],
      [3, "1.2.1", "step.leaf"],
      [4, "2", "step.after"],
    ]);
    expect(trace.stepCount).toBe(5);
    expect(JSON.stringify(trace)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|"(id|timestamp|createdAt|evaluatedAt)"/);
  });

  it("identical input gives an identical trace; siblings are never re-sorted", () => {
    expect(JSON.stringify(buildTrace(steps()))).toBe(JSON.stringify(buildTrace(steps())));
    const swapped = steps().reverse();
    expect(buildTrace(swapped).steps.map((s) => s.key)).toEqual(["step.after", "step.total"]);
  });

  it("keeps the ORDER of named inputs (operand order can matter)", () => {
    const [first] = buildTrace(steps()).steps;
    expect(first?.inputs.map((i) => i.name)).toEqual(["left", "right"]);
  });

  it("rejects malformed steps as an evaluator defect, listing every problem", () => {
    const bad: TraceStepInput[] = [
      { key: "step.a", operation: "op.x" },
      { key: "step.a", operation: "Not A Key", inputs: [{ name: "x", value: { type: "NUMBER", value: Number.NaN, unit: null } }, { name: "x", value: numberValue(1) }] },
    ];
    try {
      buildTrace(bad);
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RulesEngineError);
      expect((e as RulesEngineError).code).toBe("RULE_ENGINE.INVARIANT_VIOLATION");
      const paths = ((e as RulesEngineError).details?.problems as Array<{ path: string }>).map((p) => p.path);
      expect(paths).toEqual(["/trace/1/operation", "/trace/1/inputs/0/value/value", "/trace/1/inputs/1/name", "/trace/1/key"]);
    }
    expect(() => buildTrace([{ key: "step.a", operation: "op.x", extra: 1 } as TraceStepInput])).toThrow(RulesEngineError);
  });

  it("is structured data only — no markup, no functions — and deep-frozen", () => {
    const trace = buildTrace(steps());
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
    expect(Object.isFrozen(trace.steps[0]?.children[0])).toBe(true);
  });
});

describe("evaluation values", () => {
  it("cover NUMBER (with optional unit), BOOLEAN, STRING, IDENTIFIER and LIST", () => {
    expect(listValue([numberValue(1), booleanValue(true), stringValue("s"), identifierValue("stat.power")])).toEqual({
      type: "LIST",
      items: [
        { type: "NUMBER", value: 1, unit: null },
        { type: "BOOLEAN", value: true },
        { type: "STRING", value: "s" },
        { type: "IDENTIFIER", value: "stat.power" },
      ],
    });
  });

  it("refuse non-finite numbers and malformed units, and never round", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => numberValue(bad)).toThrow(expect.objectContaining({ code: "RULE_ENGINE.NON_FINITE_NUMBER" }));
    }
    expect(() => numberValue(1, "Feet")).toThrow(expect.objectContaining({ code: "RULE_ENGINE.INVALID_INPUT" }));
    expect(numberValue(2.75)).toEqual({ type: "NUMBER", value: 2.75, unit: null });
    expect(Object.is(numberValue(-0).type === "NUMBER" ? (numberValue(-0) as { value: number }).value : 1, 0)).toBe(true);
  });
});

describe("M4-I11 rule provenance travels into the trace and the response", () => {
  it("a step can name the exact entity version, ruleset and manifest that produced it", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    const inherited = ctx.value.rules[1];
    const own = ctx.value.rules[0];
    if (inherited === undefined || own === undefined) throw new Error("fixture");
    const response = evaluate(
      {
        kind: "example.noop",
        requires: ["RULESET"],
        evaluate: (req) => ({
          data: null,
          trace: [
            { key: "step.own", operation: "op.example", provenance: provenanceOf(own, req.ruleset) },
            { key: "step.inherited", operation: "op.example", provenance: provenanceOf(inherited, req.ruleset), modifierSource: provenanceOf(own) },
          ],
        }),
      },
      requestInput(),
    );
    expect(response.trace.steps.map((s) => s.provenance)).toEqual([
      { entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", rulesetId: IDS.ruleset, manifestId: IDS.manifest },
      { entityId: IDS.entityB, entityVersionId: IDS.versionB, canonicalKey: "rule.example_b", rulesetId: IDS.parentRuleset, manifestId: IDS.parentManifest },
    ]);
    expect(response.trace.steps[1]?.modifierSource).toEqual({ entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", rulesetId: null, manifestId: null });
    expect(response.ruleset).toEqual({
      rulesetId: IDS.ruleset,
      manifestId: IDS.manifest,
      manifestHash: "a".repeat(64),
      rulesetVersionLabel: "0.1",
      release: { releaseId: IDS.release, releaseNumber: 3, versionLabel: "Example 3" },
    });
  });

  it("provenance is optional: steps without it are valid", () => {
    expect(buildTrace([{ key: "step.a", operation: "op.x" }]).steps[0]?.provenance).toBeNull();
  });
});
