import { describe, expect, it } from "vitest";
import {
  applyResourcePayment,
  createRulesetContext,
  evaluate,
  evaluateFormula,
  evaluateModifiers,
  evaluateRequirement,
  evaluateValidation,
  flattenTrace,
  VALIDATION_LIMITS,
  type RuleEngineResponse,
  type ValidationSummary,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO8 Validation Engine. Guards M4-I99 (Validation Consumes Exact Results; It Does Not Recalculate Mechanics), M4-I100
 * (Validation Errors Are Distinct From Engine Errors), M4-I101 (Explicit Validation Checks Are Plain Data), M4-I102
 * (Check Failure Severity Is Explicit), M4-I103 (PASS Emits No Finding), M4-I104 (NOT_APPLICABLE Is Non-Blocking),
 * M4-I105 (Validation Collects All Discoverable Findings), M4-I106 (Validation Source Identity Is Exact), M4-I107
 * (Validation Check Identity Is Exact), M4-I108 (Validation Ordering Is Explicit And Deterministic), M4-I109 (False
 * Requirement Does Not Automatically Become A Validation Error), M4-I110 (Resource Insufficiency Does Not Automatically
 * Become A Validation Error), M4-I111 (Skipped Modifier Does Not Automatically Become A Validation Error), M4-I112
 * (Existing Subsystem Diagnostics Preserve Their Meaning), M4-I113 (Validation Inputs / Outputs Are Immutable), M4-I114
 * (Validation Evaluation Is Deterministic) and M4-I115 (Validation Provenance Is Preserved).
 */
type C = Record<string, unknown>;
const check = (checkKey: string, outcome: string, failureSeverity = "ERROR", extra: C = {}): C => ({
  checkKey,
  order: 10,
  category: "COMPATIBILITY",
  outcome,
  failureSeverity,
  code: "BUILD.EXAMPLE_ISSUE",
  ...extra,
});
const source = (sourceKey: string, response: unknown, order = 10) => ({ sourceKey, order, response });
const codes = (r: RuleEngineResponse<ValidationSummary>) => [...r.errors, ...r.warnings, ...r.info].sort((a, b) => a.ordinal - b.ordinal).map((m) => m.code);

// Real subsystem responses.
const brokenFormula = () => evaluateFormula({ expression: "floor(a / ", provenance: { entityId: IDS.entityA, entityVersionId: null, canonicalKey: "rule.example", rulesetId: null, manifestId: null } }, {});
const falseRequirement = () => evaluateRequirement({ kind: "RANK_AT_LEAST", factKey: "skill.example", requiredRankKey: "expert", requiredOrder: 2 }, { ranks: [{ key: "skill.example", rankKey: "trained", order: 1 }] });
const skippedModifier = () =>
  evaluateModifiers({
    targets: [{ targetKey: "t.value", kind: "NUMERIC", value: 10 }],
    modifiers: [{ modifierKey: "m", targetKey: "t.value", operation: "ADD", operand: 5, phase: { phaseKey: "p", phaseOrder: 1 }, priority: 0, order: 0, condition: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">", expected: 9 } }],
    facts: { numeric: [{ key: "f", value: 1 }] },
  });
const unaffordable = () =>
  applyResourcePayment(
    { resources: [{ resourceKey: "r.a", kind: "POOL", current: 6, minimum: 0, maximum: 10, reservedCapacity: 0 }, { resourceKey: "r.b", kind: "POOL", current: 2, minimum: 0, maximum: 10, reservedCapacity: 0 }] },
    { costKey: "cost.example", listedAmount: 10, sources: [{ resourceKey: "r.a", order: 1 }, { resourceKey: "r.b", order: 2 }] },
  );
const warningResponse = () =>
  evaluate({ kind: "example.noop", evaluate: () => ({ data: 1, messages: [{ kind: "VALIDATION", severity: "WARNING", category: "CAPACITY", code: "BUILD.NEAR_LIMIT", message: "near", path: "/build", provenance: null, details: { used: 9 } }] as never }) }, { kind: "example.noop" });

describe("check outcome × severity matrix (M4-I102 / M4-I103 / M4-I104)", () => {
  it.each([
    ["PASS", "ERROR", "SUCCESS", []],
    ["PASS", "WARNING", "SUCCESS", []],
    ["PASS", "INFO", "SUCCESS", []],
    ["FAIL", "ERROR", "INVALID", ["BUILD.EXAMPLE_ISSUE"]],
    ["FAIL", "WARNING", "VALID_WITH_WARNINGS", ["BUILD.EXAMPLE_ISSUE"]],
    ["FAIL", "INFO", "SUCCESS", ["BUILD.EXAMPLE_ISSUE"]],
    ["NOT_APPLICABLE", "ERROR", "SUCCESS", []],
  ] as const)("%s / %s → %s", (outcome, severity, status, emitted) => {
    const r = evaluateValidation({ checks: [check("c", outcome, severity)] });
    expect(r.status).toBe(status);
    expect(codes(r)).toEqual(emitted);
    expect(r.errors.every((e) => e.kind === "VALIDATION")).toBe(true);
  });

  it("a valid summary: counts, check results and no findings for PASS / NOT_APPLICABLE", () => {
    const r = evaluateValidation({ checks: [check("a", "PASS"), check("b", "NOT_APPLICABLE"), check("c", "FAIL", "WARNING")] });
    expect(r.data).toMatchObject({
      valid: true,
      errorCount: 0,
      warningCount: 1,
      infoCount: 0,
      checkCounts: { PASS: 1, FAIL: 1, NOT_APPLICABLE: 1 },
      categoryCounts: { COMPATIBILITY: 1 },
    });
    expect(r.data?.checks.map((c) => [c.checkKey, c.outcome, c.severity])).toEqual([["a", "PASS", null], ["b", "NOT_APPLICABLE", null], ["c", "FAIL", "WARNING"]]);
  });

  it("an ERROR makes the response INVALID with data null — a validation failure, never an engine error (M4-I100)", () => {
    const r = evaluateValidation({ checks: [check("c", "FAIL", "ERROR")] });
    expect([r.status, r.success, r.data, r.errors[0]?.kind]).toEqual(["INVALID", false, null, "VALIDATION"]);
  });

  it("no findings at all → SUCCESS; info only → SUCCESS", () => {
    expect(evaluateValidation({}).status).toBe("SUCCESS");
    expect(evaluateValidation({ checks: [check("i", "FAIL", "INFO")] }).status).toBe("SUCCESS");
  });

  it("category never chooses severity: the same category can carry ERROR, WARNING or INFO", () => {
    for (const severity of ["ERROR", "WARNING", "INFO"]) {
      const r = evaluateValidation({ checks: [check("c", "FAIL", severity, { category: "RESOURCE" })] });
      expect([...r.errors, ...r.warnings, ...r.info].map((m) => m.severity)).toEqual([severity]);
    }
  });
});

describe("M4-I105 every finding is collected — no first-error short-circuit", () => {
  it("ERROR, WARNING, ERROR: all three appear, in order", () => {
    const r = evaluateValidation({ checks: [check("a", "FAIL", "ERROR", { order: 1, code: "BUILD.A" }), check("b", "FAIL", "WARNING", { order: 2, code: "BUILD.B" }), check("c", "FAIL", "ERROR", { order: 3, code: "BUILD.C" })] });
    expect(codes(r)).toEqual(["BUILD.A", "BUILD.B", "BUILD.C"]);
    expect(r.errors.map((e) => e.code)).toEqual(["BUILD.A", "BUILD.C"]);
    expect(r.warnings.map((w) => w.code)).toEqual(["BUILD.B"]);
  });

  it("a malformed source never hides a valid source's warning", () => {
    const r = evaluateValidation({ sources: [source("bad", { status: "SUCCESS" }), source("good", warningResponse(), 20)] });
    expect(codes(r)).toEqual(["VALIDATION.INVALID_SOURCE", "BUILD.NEAR_LIMIT"]);
  });

  it("mixed ERROR / WARNING / INFO each land in their own array, in contribution order", () => {
    const r = evaluateValidation({ checks: [check("w", "FAIL", "WARNING", { order: 1 }), check("e", "FAIL", "ERROR", { order: 2 }), check("i", "FAIL", "INFO", { order: 3 })] });
    expect([r.errors.map((m) => m.ordinal), r.warnings.map((m) => m.ordinal), r.info.map((m) => m.ordinal)]).toEqual([[1], [0], [2]]);
  });
});

describe("M4-I108 explicit, deterministic ordering", () => {
  it("checks: order then checkKey (order10-Z, order20-A, order20-B)", () => {
    const r = evaluateValidation({ checks: [check("B", "FAIL", "WARNING", { order: 20, code: "X.B" }), check("Z", "FAIL", "WARNING", { order: 10, code: "X.Z" }), check("A", "FAIL", "WARNING", { order: 20, code: "X.A" })] });
    expect(codes(r)).toEqual(["X.Z", "X.A", "X.B"]);
    expect(r.data?.checks.map((c) => c.checkKey)).toEqual(["Z", "A", "B"]);
  });

  it("sources: order then sourceKey (10-Z, 20-A, 20-B)", () => {
    const r = evaluateValidation({ sources: [source("B", warningResponse(), 20), source("Z", warningResponse(), 10), source("A", warningResponse(), 20)] });
    expect(r.data?.sources.map((s) => s.sourceKey)).toEqual(["Z", "A", "B"]);
  });

  it("sources and checks interleave by order; final ordinals 0, 1, 2, … follow contribution order", () => {
    const two = evaluate({
      kind: "example.noop",
      evaluate: () => ({
        data: 1,
        messages: [
          { kind: "VALIDATION", severity: "WARNING", category: "STRUCTURE", code: "SRC.FIRST", message: "1", path: null, provenance: null, details: null },
          { kind: "VALIDATION", severity: "WARNING", category: "STRUCTURE", code: "SRC.SECOND", message: "2", path: null, provenance: null, details: null },
        ] as never,
      }),
    }, { kind: "example.noop" });
    const info = evaluate({ kind: "example.noop", evaluate: () => ({ data: 1, messages: [{ kind: "VALIDATION", severity: "INFO", category: "RUNTIME", code: "SRC.INFO", message: "i", path: null, provenance: null, details: null }] as never }) }, { kind: "example.noop" });
    const r = evaluateValidation({ sources: [source("s30", info, 30), source("s10", two, 10)], checks: [check("c20", "FAIL", "WARNING", { order: 20, code: "CHK.WARN" })] });
    expect([...r.warnings, ...r.info].sort((a, b) => a.ordinal - b.ordinal).map((m) => [m.ordinal, m.code])).toEqual([
      [0, "SRC.FIRST"],
      [1, "SRC.SECOND"],
      [2, "CHK.WARN"],
      [3, "SRC.INFO"],
    ]);
  });

  it("two sources whose diagnostics both start at ordinal 0 get unique combined ordinals; originals are kept in the trace", () => {
    const r = evaluateValidation({ sources: [source("x", warningResponse(), 1), source("y", warningResponse(), 2)] });
    expect(r.warnings.map((w) => w.ordinal)).toEqual([0, 1]);
    const findings = flattenTrace(r.trace).filter((s) => s.operation === "validation.finding");
    expect(findings.map((s) => s.inputs.filter((i) => i.name.endsWith("ordinal")).map((i) => ("value" in i.value ? i.value.value : null)))).toEqual([[0, 0], [1, 0]]);
  });

  it("shuffling sources and checks never changes the response", () => {
    const sources = [source("b", warningResponse(), 2), source("a", brokenFormula(), 1), source("c", falseRequirement(), 2)];
    const checks = [check("y", "FAIL", "INFO", { order: 1 }), check("x", "PASS"), check("z", "FAIL", "WARNING", { order: 2 })];
    const base = JSON.stringify(evaluateValidation({ sources, checks }));
    for (let i = 0; i < 5; i += 1) {
      const s = [...sources].sort(() => (i % 2 === 0 ? -1 : 1));
      const k = [...checks].reverse();
      expect(JSON.stringify(evaluateValidation({ sources: i % 3 === 0 ? [...s].reverse() : s, checks: k }))).toBe(base);
    }
  });
});

describe("M4-I99 / M4-I112 real subsystem responses: preserved, never recalculated or reclassified", () => {
  it("a broken Formula's diagnostic survives with code, category, path, provenance and details intact", () => {
    const formula = brokenFormula();
    const r = evaluateValidation({ sources: [source("formula-A", formula)] });
    const original = formula.errors[0];
    const kept = r.errors[0];
    expect(original?.kind === "VALIDATION" && kept?.kind === "VALIDATION").toBe(true);
    if (original?.kind !== "VALIDATION" || kept?.kind !== "VALIDATION") return;
    expect({ ...kept, ordinal: 0 }).toEqual({ ...original, ordinal: 0 });
    expect([kept.code, kept.category, kept.path]).toEqual(["FORMULA.INVALID_SYNTAX", "FORMULA", "/expression"]);
  });

  it("M4-I109: a valid false Requirement creates NO finding — until an explicit mandatory check says so", () => {
    const requirement = falseRequirement();
    expect([requirement.status, requirement.data?.satisfied]).toEqual(["SUCCESS", false]);
    const alone = evaluateValidation({ sources: [source("requirement-B", requirement)] });
    expect([alone.status, codes(alone)]).toEqual(["SUCCESS", []]);
    const mandatory = evaluateValidation({
      sources: [source("requirement-B", requirement)],
      checks: [check("prerequisite-mandatory", "FAIL", "ERROR", { category: "REQUIREMENT", code: "OPTION.PREREQUISITE_UNMET", path: "/option/requirement" })],
    });
    expect([mandatory.status, codes(mandatory)]).toEqual(["INVALID", ["OPTION.PREREQUISITE_UNMET"]]);
  });

  it("M4-I111: a SKIPPED_CONDITION modifier creates no finding", () => {
    const modifier = skippedModifier();
    expect(modifier.data?.outcomes[0]?.status).toBe("SKIPPED_CONDITION");
    const r = evaluateValidation({ sources: [source("modifier-C", modifier)] });
    expect([r.status, codes(r)]).toEqual(["SUCCESS", []]);
  });

  it("M4-I110: canPay:false creates no finding — until an explicit RUNTIME affordability check says so", () => {
    const payment = unaffordable();
    expect([payment.status, payment.data?.canPay, payment.data?.shortfall]).toEqual(["SUCCESS", false, 2]);
    expect(evaluateValidation({ sources: [source("resource-D", payment)] }).status).toBe("SUCCESS");
    const runtime = evaluateValidation({
      sources: [source("resource-D", payment)],
      checks: [check("action-affordable", "FAIL", "ERROR", { category: "RUNTIME", code: "ACTION.CANNOT_PAY", details: { shortfall: 2 } })],
    });
    expect([runtime.status, codes(runtime)]).toEqual(["INVALID", ["ACTION.CANNOT_PAY"]]);
    expect(payment.data?.listedAmount).toBe(10); // validation never touches the listed amount
  });

  it("a Ruleset-resolution failure enters as an explicit RULESET check carrying the resolver's own code", () => {
    const r = evaluateValidation({ checks: [check("ruleset-integrity", "FAIL", "ERROR", { category: "RULESET", code: "RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE" })] });
    expect([r.errors[0]?.code, r.errors[0]?.kind === "VALIDATION" && r.errors[0].category]).toEqual(["RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE", "RULESET"]);
  });

  it("M4-I100: a source that failed with an ENGINE error makes the combination an engine failure — never a validation finding", () => {
    const engineFailure = evaluate({ kind: "example.noop", requires: ["BUILD"], evaluate: () => ({ data: 1 }) }, { kind: "example.noop" });
    const r = evaluateValidation({ sources: [source("broken", engineFailure)] });
    expect([r.status, r.errors[0]?.kind, r.errors[0]?.code]).toEqual(["ERROR", "ENGINE", "RULE_ENGINE.MISSING_CONTEXT"]);
    expect(r.errors[0]?.details).toMatchObject({ sourceEngineErrors: [{ sourceKey: "broken", code: "RULE_ENGINE.MISSING_CONTEXT" }] });
  });

  it("the source responses themselves are never re-run or changed", () => {
    const responses = [brokenFormula(), falseRequirement(), skippedModifier(), unaffordable()];
    const before = JSON.stringify(responses);
    evaluateValidation({ sources: responses.map((resp, i) => source(`s${i}`, resp, i)) });
    expect(JSON.stringify(responses)).toBe(before);
  });
});

describe("M4-I106 / M4-I107 identities and duplicates", () => {
  it("identical duplicate check or source collapses; conflicting ones fail closed in either order", () => {
    expect(codes(evaluateValidation({ checks: [check("a", "FAIL", "WARNING"), check("a", "FAIL", "WARNING")] }))).toEqual(["BUILD.EXAMPLE_ISSUE"]);
    for (const pair of [[check("a", "PASS"), check("a", "FAIL")], [check("a", "FAIL"), check("a", "PASS")]]) {
      expect(codes(evaluateValidation({ checks: pair }))).toEqual(["VALIDATION.DUPLICATE_CHECK"]);
    }
    const w = warningResponse();
    expect(codes(evaluateValidation({ sources: [source("s", w), source("s", w)] }))).toEqual(["BUILD.NEAR_LIMIT"]);
    expect(codes(evaluateValidation({ sources: [source("s", w), source("s", brokenFormula())] }))).toEqual(["VALIDATION.DUPLICATE_SOURCE"]);
  });

  it("distinct findings with the same code / path / severity from different contributions are all kept", () => {
    const r = evaluateValidation({ sources: [source("one", warningResponse(), 1), source("two", warningResponse(), 2)], checks: [check("three", "FAIL", "WARNING", { order: 3, code: "BUILD.NEAR_LIMIT", path: "/build" })] });
    expect(r.warnings.map((w) => [w.code, w.path])).toEqual([["BUILD.NEAR_LIMIT", "/build"], ["BUILD.NEAR_LIMIT", "/build"], ["BUILD.NEAR_LIMIT", "/build"]]);
  });
});

describe("M4-I101 strict plain-data input", () => {
  it.each([
    ["callback check", { ...check("a", "FAIL"), check: "() => true" }, "VALIDATION.INVALID_CHECK"],
    ["unknown outcome", check("a", "MAYBE"), "VALIDATION.INVALID_CHECK"],
    ["unknown severity", check("a", "FAIL", "FATAL"), "VALIDATION.INVALID_CHECK"],
    ["unknown category", check("a", "FAIL", "ERROR", { category: "SPELL" }), "VALIDATION.INVALID_CHECK"],
    ["expression string", { ...check("a", "FAIL"), expression: "A && B || C" }, "VALIDATION.INVALID_CHECK"],
    ["reserved VALIDATION code", check("a", "FAIL", "ERROR", { code: "VALIDATION.CHECK_FAILED" }), "VALIDATION.INVALID_CODE"],
    ["reserved RULE_ENGINE code", check("a", "FAIL", "ERROR", { code: "RULE_ENGINE.INVALID_INPUT" }), "VALIDATION.INVALID_CODE"],
    ["lower-case code", check("a", "FAIL", "ERROR", { code: "build.issue" }), "VALIDATION.INVALID_CODE"],
    ["non-pointer path", check("a", "FAIL", "ERROR", { path: "spell.effects[2]" }), "VALIDATION.INVALID_PATH"],
    ["fractional order", check("a", "FAIL", "ERROR", { order: 1.5 }), "VALIDATION.INVALID_CHECK"],
  ])("%s → %s", (_label, c, code) => expect(codes(evaluateValidation({ checks: [c] }))).toEqual([code]));

  it("paths and details survive exactly, and details are detached from the caller", () => {
    const details = { nested: { items: [1, "two", { three: true }] } };
    const r = evaluateValidation({ checks: [check("a", "FAIL", "WARNING", { path: "/spell/effects/2", details })] });
    expect([r.warnings[0]?.path, r.warnings[0]?.details]).toEqual(["/spell/effects/2", { nested: { items: [1, "two", { three: true }] } }]);
    details.nested.items.push(4);
    expect(r.warnings[0]?.details).toEqual({ nested: { items: [1, "two", { three: true }] } });
  });

  it("getters, prototypes and cycles in checks, details and sources fail safely without invocation", () => {
    let called = false;
    const getterCheck = check("a", "FAIL");
    Object.defineProperty(getterCheck, "outcome", { enumerable: true, get: () => ((called = true), "FAIL") });
    expect(codes(evaluateValidation({ checks: [getterCheck] }))).toEqual(["VALIDATION.INVALID_CHECK"]);
    const getterDetails = {} as C;
    Object.defineProperty(getterDetails, "x", { enumerable: true, get: () => ((called = true), 1) });
    expect(codes(evaluateValidation({ checks: [check("b", "FAIL", "ERROR", { details: getterDetails })] }))).toEqual(["VALIDATION.INVALID_CHECK"]);
    const cyclic: C = {};
    cyclic.self = cyclic;
    expect(codes(evaluateValidation({ checks: [check("c", "FAIL", "ERROR", { details: cyclic })] }))).toEqual(["VALIDATION.INVALID_CHECK"]);
    expect(codes(evaluateValidation({ checks: [JSON.parse(`{"checkKey":"d","order":1,"category":"STRUCTURE","outcome":"FAIL","failureSeverity":"ERROR","code":"X.Y","__proto__":{"z":1}}`)] }))).toEqual(["VALIDATION.INVALID_CHECK"]);
    let deep: C = {};
    for (let i = 0; i < 50_000; i += 1) deep = { d: deep };
    expect(() => evaluateValidation({ sources: [source("deep", deep)] })).not.toThrow();
    expect(codes(evaluateValidation({ sources: [source("deep", deep)] }))).toEqual(["VALIDATION.INVALID_SOURCE"]);
    expect(called).toBe(false);
  });

  it("malformed fake responses are controlled VALIDATION.INVALID_SOURCE, never a crash", () => {
    const real = warningResponse();
    for (const fake of [
      { ...real, status: "PASS" },
      { ...real, success: false },
      { ...real, status: "SUCCESS" },
      { ...real, warnings: [{ ...real.warnings[0], ordinal: 0 }, { ...real.warnings[0], ordinal: 0 }] },
      { ...real, warnings: [{ ...real.warnings[0], code: "lower" }] },
      { ...real, warnings: [{ ...real.warnings[0], severity: "ERROR" }] },
      { ...real, extra: 1 },
      { ...real, contractVersion: 2 },
      null,
      "response",
    ]) {
      expect(codes(evaluateValidation({ sources: [source("s", fake)] })), JSON.stringify(fake).slice(0, 60)).toEqual(["VALIDATION.INVALID_SOURCE"]);
    }
  });
});

describe("M4-I115 provenance and trace", () => {
  const checkProvenance = { entityId: IDS.entityB, entityVersionId: null, canonicalKey: null, rulesetId: null, manifestId: null };

  it("a check's provenance and a source diagnostic's own provenance are each kept exactly", () => {
    // A post-validation Formula failure carries the Formula's provenance (a parse failure carries none — WO3 behaviour,
    // which WO8 passes through unchanged as well).
    const divide = evaluateFormula({ expression: "1 / 0", provenance: { entityId: IDS.entityA, entityVersionId: null, canonicalKey: "rule.example", rulesetId: null, manifestId: null } }, {});
    const r = evaluateValidation({ sources: [source("formula-A", divide, 1)], checks: [check("c", "FAIL", "ERROR", { order: 2, provenance: checkProvenance })] });
    expect(r.errors.map((e) => (e.kind === "VALIDATION" ? e.provenance?.entityId : null))).toEqual([IDS.entityA, IDS.entityB]);
    const parseFailure = evaluateValidation({ sources: [source("formula-B", brokenFormula())] });
    expect(parseFailure.errors[0]?.kind === "VALIDATION" && parseFailure.errors[0].provenance).toBeNull();
  });

  it("the trace: source contributions with finding mappings, failed checks with category / severity / code / path, PASS concise", () => {
    const r = evaluateValidation({
      sources: [source("formula-A", brokenFormula(), 1)],
      checks: [check("targeting-compatible", "FAIL", "ERROR", { order: 2, path: "/build/targeting" }), check("parameter-size", "PASS", "ERROR", { order: 3 })],
    });
    const flat = flattenTrace(r.trace);
    expect(flat.map((s) => [s.path, s.operation])).toEqual([
      ["1", "validation.evaluate"],
      ["1.1", "validation.source"],
      ["1.1.1", "validation.finding"],
      ["1.2", "validation.check"],
      ["1.3", "validation.check"],
    ]);
    const inputs = (i: number) => Object.fromEntries((flat[i]?.inputs ?? []).map((x) => [x.name, "value" in x.value ? x.value.value : null]));
    expect(inputs(3)).toEqual({ check_key: "targeting-compatible", order: 2, outcome: "FAIL", category: "COMPATIBILITY", severity: "ERROR", code: "BUILD.EXAMPLE_ISSUE", path: "/build/targeting", final_ordinal: 1 });
    expect(inputs(4)).toEqual({ check_key: "parameter-size", order: 3, outcome: "PASS", category: "COMPATIBILITY" });
  });

  it("an exact RulesetContext is recorded verbatim", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    expect(evaluateValidation({}, { ruleset: ctx.value }).ruleset?.rulesetId).toBe(IDS.ruleset);
  });
});

describe("M4-I113 / M4-I114 immutability, determinism, limits", () => {
  it("same request → byte-identical response; inputs untouched and never frozen; output deep-frozen", () => {
    const request = { sources: [source("a", warningResponse(), 1), source("b", falseRequirement(), 2)], checks: [check("c", "FAIL", "WARNING", { order: 3 })] };
    const before = JSON.stringify(request);
    const r = assertDeterministic(() => evaluateValidation(request), { runs: 6, freezeInputs: false, inputs: [request] });
    expect(JSON.stringify(request)).toBe(before);
    expect(Object.isFrozen(request) || Object.isFrozen(request.checks[0])).toBe(false);
    expect(Object.isFrozen(r.warnings[0]) && Object.isFrozen(r.data?.sources)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("limits: exactly at the check limit passes; one over fails closed; findings over the limit fail closed (never truncated)", () => {
    const passes = Array.from({ length: VALIDATION_LIMITS.MAX_CHECKS }, (_, i) => check(`k${i}`, "PASS"));
    expect(evaluateValidation({ checks: passes }).status).toBe("SUCCESS");
    expect(codes(evaluateValidation({ checks: [...passes, check("one-more", "PASS")] }))).toEqual(["VALIDATION.LIMIT_EXCEEDED"]);
    const fails = Array.from({ length: VALIDATION_LIMITS.MAX_CHECKS }, (_, i) => check(`f${i}`, "FAIL", "INFO"));
    const manyWarnings = evaluate({
      kind: "example.noop",
      evaluate: () => ({ data: 1, messages: Array.from({ length: VALIDATION_LIMITS.MAX_FINDINGS - VALIDATION_LIMITS.MAX_CHECKS + 1 }, () => ({ kind: "VALIDATION", severity: "INFO", category: "STRUCTURE", code: "X.Y", message: "m", path: null, provenance: null, details: null })) as never }),
    }, { kind: "example.noop" });
    expect(codes(evaluateValidation({ checks: fails, sources: [source("big", manyWarnings)] }))).toEqual(["VALIDATION.LIMIT_EXCEEDED"]);
    expect(codes(evaluateValidation({ sources: Array.from({ length: VALIDATION_LIMITS.MAX_SOURCES + 1 }, (_, i) => source(`s${i}`, null)) }))).toEqual(["VALIDATION.LIMIT_EXCEEDED"]);
  });

  it("large sanity: 2,000 sources and 5,000 checks — every finding kept, stable and deterministic", () => {
    const w = warningResponse();
    const sources = Array.from({ length: 2000 }, (_, i) => source(`s${String(i).padStart(4, "0")}`, w, i % 7));
    const checks = Array.from({ length: 5000 }, (_, i) => check(`c${String(i).padStart(4, "0")}`, i % 2 === 0 ? "FAIL" : "PASS", "INFO", { order: i % 11 }));
    const r = assertDeterministic(() => evaluateValidation({ sources, checks }), { runs: 2 });
    expect([r.status, r.warnings.length, r.info.length, r.data?.checkCounts]).toEqual(["VALID_WITH_WARNINGS", 2000, 2500, { PASS: 2500, FAIL: 2500, NOT_APPLICABLE: 0 }]);
    expect(JSON.stringify(evaluateValidation({ sources: [...sources].reverse(), checks: [...checks].reverse() }))).toBe(JSON.stringify(r));
  });
});
