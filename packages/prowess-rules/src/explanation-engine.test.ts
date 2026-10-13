import { describe, expect, it } from "vitest";
import {
  applyResourcePayment,
  buildExplanation,
  createRulesetContext,
  evaluate,
  evaluateFormula,
  evaluateModifiers,
  evaluateRequirement,
  evaluateValidation,
  EXPLANATION_LIMITS,
  projectExplanation,
  releaseResourceCapacity,
  reserveResourceCapacity,
  resolveKeywords,
  rulesetProvenanceOf,
  type ExplanationDocument,
  type ExplanationNode,
  type ExplanationSection,
  type RuleEngineResponse,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO9 Calculation Trace & Explanation Engine. Guards M4-I116 (Explanation Describes Exact Results; It Does Not
 * Recalculate Mechanics), M4-I117 (Explanation Uses Existing CalculationTrace As Authority), M4-I118 (Explanation
 * Contribution Identity Is Exact), M4-I119 (Explanation Ordering Is Explicit And Deterministic), M4-I120 (Summary And
 * Detailed Views Share One Source Of Truth), M4-I121 (Summary Projection Cannot Invent Mechanics), M4-I122 (Explanation
 * Preserves Source Trace Order), M4-I123 (Explanation Preserves Rule Provenance), M4-I124 (Explanation Preserves Ruleset
 * Provenance), M4-I125 (Requirement False Is Explained As Unsatisfied, Not Invalid), M4-I126 (Skipped Modifiers Are
 * Explained As Skipped), M4-I127 (Resource Insufficiency Is Explained As Runtime Insufficiency, Not Engine Failure),
 * M4-I128 (Listed Cost And Runtime Payment Remain Visibly Distinct), M4-I129 (Explanation Never Rewrites Prior Formula /
 * Modifier / Resource Results), M4-I130 (Explanation Inputs / Outputs Are Immutable), M4-I131 (Explanation Is
 * JSON-Serializable), M4-I132 (Explanation Evaluation Is Deterministic) and M4-I133 (Explanation Node Identity Contains
 * No Randomness).
 *
 * All contributions are REAL WO3–WO8 outputs; names are neutral test data.
 */
const prov = (entityId: string, entityVersionId: string | null) => ({ entityId, entityVersionId, canonicalKey: "rule.example", rulesetId: null, manifestId: null });
const contribution = (contributionKey: string, kind: string, response: unknown, order = 10, extra: Record<string, unknown> = {}) => ({ contributionKey, order, kind, response, ...extra });
const ok = (r: RuleEngineResponse<ExplanationDocument>) => {
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.data as ExplanationDocument;
};
const build = (...contributions: unknown[]) => ok(buildExplanation({ explanationKey: "x", contributions }));
const section = (doc: ExplanationDocument, key: string) => doc.sections.find((s) => s.sectionKey === key) as ExplanationSection;
const facts = (s: ExplanationSection) => Object.fromEntries(s.facts.map((f) => [f.factKey, f.value]));
const flat = (nodes: readonly ExplanationNode[]): ExplanationNode[] => nodes.flatMap((n) => [n, ...flat(n.children)]);
const codes = (r: RuleEngineResponse<unknown>) => r.errors.map((e) => e.code);

// Real subsystem outputs.
const formula = (provenance = prov(IDS.entityA, IDS.versionA)) => evaluateFormula({ expression: "listed / divisor", rounding: "FLOOR", provenance }, { listed: 17, divisor: 4 });
const brokenFormula = () => evaluateFormula({ expression: "1 / 0" }, {});
const requirement = (actual: number) =>
  evaluateRequirement(
    { kind: "ALL", children: [{ kind: "RANK_AT_LEAST", factKey: "skill.example", requiredRankKey: "expert", requiredOrder: 2 }, { kind: "NUMERIC_COMPARE", factKey: "actor.level", operator: ">=", expected: 1 }] },
    { ranks: [{ key: "skill.example", rankKey: actual >= 2 ? "expert" : "trained", order: actual }], numeric: [{ key: "actor.level", value: 3 }] },
  );
const modifiers = () =>
  evaluateModifiers({
    targets: [{ targetKey: "t.value", kind: "NUMERIC", value: 100 }],
    modifiers: [
      { modifierKey: "add", targetKey: "t.value", operation: "ADD", operand: 20, phase: { phaseKey: "base", phaseOrder: 10 }, priority: 0, order: 1 },
      { modifierKey: "skip", targetKey: "t.value", operation: "MULTIPLY", operand: 2, phase: { phaseKey: "base", phaseOrder: 10 }, priority: 0, order: 2, condition: { kind: "NUMERIC_COMPARE", factKey: "f", operator: ">", expected: 9 } },
      { modifierKey: "u1", targetKey: "t.value", operation: "REDUCE_PERCENT", operand: 25, phase: { phaseKey: "discount", phaseOrder: 20 }, priority: 0, order: 1, stacking: { policy: "UNIQUE", stackingKey: "g" } },
      { modifierKey: "u2", targetKey: "t.value", operation: "REDUCE_PERCENT", operand: 25, phase: { phaseKey: "discount", phaseOrder: 20 }, priority: 0, order: 1, stacking: { policy: "UNIQUE", stackingKey: "g" } },
    ],
    facts: { numeric: [{ key: "f", value: 1 }] },
  });
const snapshot = (a: number, b: number) => ({
  resources: [
    { resourceKey: "r.temp", kind: "TEMPORARY_POOL", current: a, minimum: 0, maximum: 10, reservedCapacity: 0 },
    { resourceKey: "r.primary", kind: "POOL", current: b, minimum: 0, maximum: 20, reservedCapacity: 0 },
  ],
});
const payment = (listedAmount: number, a: number, b: number) =>
  applyResourcePayment(snapshot(a, b), { costKey: "cost.example", listedAmount, sources: [{ resourceKey: "r.primary", order: 20 }, { resourceKey: "r.temp", order: 10 }] });
const validation = () =>
  evaluateValidation({
    checks: [
      { checkKey: "e", order: 1, category: "REQUIREMENT", outcome: "FAIL", failureSeverity: "ERROR", code: "OPTION.PREREQUISITE_UNMET", path: "/option", provenance: prov(IDS.entityB, null) },
      { checkKey: "w", order: 2, category: "CAPACITY", outcome: "FAIL", failureSeverity: "WARNING", code: "BUILD.NEAR_LIMIT", path: "/build", details: { used: 9 } },
      { checkKey: "i", order: 3, category: "RUNTIME", outcome: "FAIL", failureSeverity: "INFO", code: "ACTION.NOTE", path: null },
      { checkKey: "p", order: 4, category: "STRUCTURE", outcome: "PASS", failureSeverity: "ERROR", code: "X.Y" },
    ],
  });

describe("M4-I116 / M4-I117 Formula: projected from the exact result and WO1 trace, never re-evaluated", () => {
  it("17 / 4 → raw 4.25, FLOOR, final 4 — copied facts; trace nodes keep WO1 path and ordinal", () => {
    const f = formula();
    const s = section(build(contribution("formula", "FORMULA", f)), "formula");
    expect(facts(s)).toMatchObject({ expressionValue: 4.25, rounding: { mode: "FLOOR", value: 4 }, finalValue: 4, variables: [{ key: "listed", value: 17 }, { key: "divisor", value: 4 }] });
    const sourceSteps = (() => {
      const out: { path: string; ordinal: number; operation: string }[] = [];
      const walk = (steps: typeof f.trace.steps) => steps.forEach((x) => (out.push({ path: x.path, ordinal: x.ordinal, operation: x.operation }), walk(x.children)));
      walk(f.trace.steps);
      return out;
    })();
    expect(flat(s.nodes).map((n) => ({ path: n.sourceTracePath, ordinal: n.sourceTraceOrdinal, operation: n.operation }))).toEqual(sourceSteps);
    expect(flat(s.nodes)[0]).toMatchObject({ nodeId: "formula#1", explanationPath: "1/1", sourceContributionKey: "formula" });
  });

  it("an invalid Formula keeps its diagnostic and whatever trace exists — and gets no invented result", () => {
    const s = section(build(contribution("bad", "FORMULA", brokenFormula())), "bad");
    expect([s.status, s.statusLabel, s.facts, s.diagnostics.map((d) => d.code)]).toEqual(["INVALID", "Invalid evaluation", [], ["FORMULA.DIVISION_BY_ZERO"]]);
  });

  it("a Requirement evaluated invalid keeps its partial trace with the failing node marked INVALID", () => {
    const invalid = evaluateRequirement({ kind: "ANY", children: [{ kind: "NUMERIC_COMPARE", factKey: "a", operator: ">=", expected: 1 }, { kind: "NUMERIC_COMPARE", factKey: "missing", operator: ">=", expected: 1 }] }, { numeric: [{ key: "a", value: 5 }] });
    const s = section(build(contribution("req", "REQUIREMENT", invalid)), "req");
    expect([s.status, s.facts]).toEqual(["INVALID", []]);
    expect(flat(s.nodes).map((n) => n.status)).toEqual(["INVALID", "SATISFIED", "INVALID"]);
  });
});

describe("M4-I125 Requirement: satisfied / not satisfied — never 'invalid' for a valid false", () => {
  it("true and false results, group structure and authored order kept", () => {
    const yes = section(build(contribution("r", "REQUIREMENT", requirement(3))), "r");
    const no = section(build(contribution("r", "REQUIREMENT", requirement(1))), "r");
    expect([yes.status, yes.statusLabel]).toEqual(["SATISFIED", "Requirement satisfied"]);
    expect([no.status, no.statusLabel, no.responseStatus]).toEqual(["NOT_SATISFIED", "Requirement not satisfied", "SUCCESS"]);
    expect(flat(no.nodes).map((n) => [n.operation, n.status])).toEqual([
      ["requirement.all", "NOT_SATISFIED"],
      ["requirement.rank_at_least", "NOT_SATISFIED"],
      ["requirement.numeric_compare", "SATISFIED"],
    ]);
    expect(JSON.stringify(no)).not.toMatch(/INVALID|Invalid/);
  });

  it("a false Requirement plus an explicit mandatory-prerequisite ERROR stay two different facts", () => {
    const doc = build(contribution("req", "REQUIREMENT", requirement(1), 1), contribution("val", "VALIDATION", validation(), 2));
    expect([section(doc, "req").status, section(doc, "req").responseStatus]).toEqual(["NOT_SATISFIED", "SUCCESS"]);
    expect([section(doc, "val").status, section(doc, "val").diagnostics[0]?.code]).toEqual(["INVALID", "OPTION.PREREQUISITE_UNMET"]);
  });
});

describe("M4-I126 Modifiers: applied / skipped / deduplicated in exact application order, grouped by phase", () => {
  it("statuses come from the WO6 trace; order and phases are WO6's", () => {
    const s = section(build(contribution("mods", "MODIFIER", modifiers())), "mods");
    const modifierNodes = flat(s.nodes).filter((n) => n.status !== null);
    expect(modifierNodes.map((n) => [n.inputs.find((i) => i.name === "modifier_key")?.value, n.status, n.label])).toEqual([
      [{ type: "STRING", value: "add" }, "APPLIED", "Applied"],
      [{ type: "STRING", value: "skip" }, "SKIPPED", "Skipped: condition not satisfied"],
      [{ type: "STRING", value: "u1" }, "APPLIED", "Applied"],
      [{ type: "STRING", value: "u2" }, "DEDUPLICATED", "Deduplicated"],
    ]);
    expect(flat(s.nodes).filter((n) => n.operation === "modifier.phase").map((n) => n.inputs[0]?.value)).toEqual([{ type: "STRING", value: "base" }, { type: "STRING", value: "discount" }]);
    expect(facts(s)).toEqual({ "initial:t.value": 100, "final:t.value": 90 });
    expect(JSON.stringify(s)).not.toMatch(/FAIL/);
  });
});

describe("M4-I127 / M4-I128 Resources: listed cost vs payment, insufficiency, reservation, release", () => {
  it("listed 17 → temp 6 then primary 11 (payment order); primary left with 9; listed stays 17; no 'effective cost'", () => {
    const s = section(build(contribution("pay", "RESOURCE", payment(17, 6, 20))), "pay");
    expect(facts(s)).toEqual({
      listedAmount: 17,
      canPay: true,
      totalPaid: 17,
      shortfall: 0,
      "paid:r.temp": 6,
      "paid:r.primary": 11,
      "resultingCurrent:r.temp": 0,
      "resultingCurrent:r.primary": 9,
      resourceStateChanged: true,
    });
    expect(flat(s.nodes).filter((n) => n.operation === "resource.payment.source").map((n) => n.output)).toEqual([{ type: "NUMBER", value: 6, unit: null }, { type: "NUMBER", value: 11, unit: null }]);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/effective|reduced|netCost|adjusted/i);
    expect(s.facts.filter((f) => f.value === 11).map((f) => f.factKey)).toEqual(["paid:r.primary"]); // 11 is only ever a payment
  });

  it("cost 10 with 6 + 2: payment unavailable, shortfall 2, no state changed (A stays 6, B stays 2) — not an engine failure", () => {
    const s = section(build(contribution("pay", "RESOURCE", payment(10, 6, 2))), "pay");
    expect([s.status, s.statusLabel, s.responseStatus]).toEqual(["PAYMENT_UNAVAILABLE", "Payment unavailable", "SUCCESS"]);
    expect(facts(s)).toMatchObject({ canPay: false, shortfall: 2, "resultingCurrent:r.temp": 6, "resultingCurrent:r.primary": 2, resourceStateChanged: false });
    expect(flat(s.nodes).find((n) => n.operation === "resource.payment.settlement")?.status).toBe("PAYMENT_UNAVAILABLE");
  });

  it("reservation: capacity reserved, current stays 18 — no spending; release: capacity returned, current not restored", () => {
    const state = { resources: [{ resourceKey: "r.a", kind: "POOL", current: 18, minimum: 0, maximum: 20, reservedCapacity: 0 }] };
    const reserve = section(build(contribution("reserve", "RESOURCE", reserveResourceCapacity(state, { resourceKey: "r.a", amount: 6 }))), "reserve");
    expect(facts(reserve)).toMatchObject({ transition: "RESERVE_CAPACITY", maximum: 20, reservedBefore: 0, reservedAfter: 6, availableMaximumAfter: 14, currentBefore: 18, currentAfter: 18 });
    const release = section(build(contribution("release", "RESOURCE", releaseResourceCapacity({ resources: [{ ...state.resources[0], current: 8, reservedCapacity: 6 }] }, { resourceKey: "r.a", amount: 6 }))), "release");
    expect(facts(release)).toMatchObject({ transition: "RELEASE_CAPACITY", reservedBefore: 6, reservedAfter: 0, availableMaximumAfter: 20, currentBefore: 8, currentAfter: 8 });
    expect(JSON.stringify([reserve, release])).not.toMatch(/SPEND|RESTORE|spent|restored/i);
  });
});

describe("Validation and Keyword explanations", () => {
  it("ERROR / WARNING / INFO findings keep category, code, path, details and provenance; check nodes link to them", () => {
    const v = validation();
    const s = section(build(contribution("val", "VALIDATION", v)), "val");
    expect(s.diagnostics.map((d) => (d.kind === "VALIDATION" ? [d.severity, d.category, d.code, d.path] : null))).toEqual([
      ["ERROR", "REQUIREMENT", "OPTION.PREREQUISITE_UNMET", "/option"],
      ["WARNING", "CAPACITY", "BUILD.NEAR_LIMIT", "/build"],
      ["INFO", "RUNTIME", "ACTION.NOTE", null],
    ]);
    expect(s.diagnostics[0]?.kind === "VALIDATION" && s.diagnostics[0].provenance?.entityId).toBe(IDS.entityB);
    expect(s.diagnostics[1]?.details).toEqual({ used: 9 });
    expect(flat(s.nodes).filter((n) => n.operation === "validation.check").map((n) => [n.status, n.relatedDiagnosticOrdinals])).toEqual([["FAIL", [0]], ["FAIL", [1]], ["FAIL", [2]], ["PASS", []]]);
    expect(facts(s)).toEqual({ errorCount: 1, warningCount: 1, infoCount: 1 });
  });

  it("a warning-only validation reads as valid with warnings, not as a calculation failure", () => {
    const warn = evaluateValidation({ checks: [{ checkKey: "w", order: 1, category: "CAPACITY", outcome: "FAIL", failureSeverity: "WARNING", code: "BUILD.NEAR_LIMIT" }] });
    const s = section(build(contribution("val", "VALIDATION", warn)), "val");
    expect([s.status, s.statusLabel]).toEqual(["VALID_WITH_WARNINGS", "Valid with warnings"]);
  });

  it("Keywords are explained as resolved identities and contributors only — no implied effect", () => {
    const k = resolveKeywords([{ keyword: { keywordId: "60000000-0000-4000-8000-000000000001", canonicalKey: "keyword.fire", categoryId: null }, source: { sourceType: "test.source", sourceKey: "s" } }]);
    const s = section(build(contribution("kw", "KEYWORD", k)), "kw");
    expect([s.status, facts(s)]).toEqual(["RESOLVED", { keywordCount: 1 }]);
    expect(flat(s.nodes).map((n) => n.operation)).toEqual(["keyword.resolve", "keyword.present", "keyword.contribution"]);
  });

  it("an engine failure is explained as such, with WO1 engine-error metadata only", () => {
    const failure = evaluate({ kind: "example.noop", requires: ["BUILD"], evaluate: () => ({ data: 1 }) }, { kind: "example.noop" });
    const s = section(build(contribution("g", "GENERIC", failure)), "g");
    expect([s.status, s.facts, s.nodes, s.diagnostics[0]?.code]).toEqual(["ENGINE_FAILURE", [], [], "RULE_ENGINE.MISSING_CONTEXT"]);
  });
});

describe("M4-I129 / M4-I128 cross-system: Formula → Modifier → Formula → Payment → Validation", () => {
  it("listed 17 stays 17, derived 4 stays 4, payment is 6 + 11 — and no explanation text says the cost became 11", () => {
    const listed = evaluateModifiers({ targets: [{ targetKey: "t.listed", kind: "NUMERIC", value: 17 }], modifiers: [] });
    const derived = formula();
    const paid = payment(17, 6, 20);
    const valid = evaluateValidation({ sources: [{ sourceKey: "f", order: 1, response: derived }] });
    const inputs = [listed, derived, paid, valid];
    const before = JSON.stringify(inputs);
    const doc = build(
      contribution("listed", "MODIFIER", listed, 10, { label: "Listed Value" }),
      contribution("derived", "FORMULA", derived, 20, { label: "Derived Formula" }),
      contribution("payment", "RESOURCE", paid, 30, { label: "Payment" }),
      contribution("validation", "VALIDATION", valid, 40),
    );
    expect(doc.sections.map((s) => s.sectionKey)).toEqual(["listed", "derived", "payment", "validation"]);
    expect([facts(section(doc, "listed"))["final:t.listed"], facts(section(doc, "derived")).finalValue, facts(section(doc, "payment")).listedAmount]).toEqual([17, 4, 17]);
    expect([facts(section(doc, "payment"))["paid:r.temp"], facts(section(doc, "payment"))["paid:r.primary"]]).toEqual([6, 11]);
    expect(section(doc, "validation").status).toBe("VALID");
    expect(JSON.stringify(inputs)).toBe(before); // nothing upstream changed
    expect(JSON.stringify(doc)).not.toMatch(/effective|reduced to|netCost|adjustedCost/i);
  });
});

describe("M4-I118 / M4-I119 / M4-I122 identity and ordering", () => {
  it("contributions order by order then key (10-Z, 20-A, 20-B), independent of input order", () => {
    const f = formula();
    const rows = [contribution("B", "FORMULA", f, 20), contribution("Z", "FORMULA", f, 10), contribution("A", "FORMULA", f, 20)];
    const doc = build(...rows);
    expect(doc.sections.map((s) => s.sectionKey)).toEqual(["Z", "A", "B"]);
    expect(JSON.stringify(build(...[...rows].reverse()))).toBe(JSON.stringify(doc));
  });

  it("identical duplicate contributions collapse; conflicting ones fail closed", () => {
    const f = formula();
    expect(build(contribution("a", "FORMULA", f), contribution("a", "FORMULA", f)).sections).toHaveLength(1);
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [contribution("a", "FORMULA", f), contribution("a", "FORMULA", formula(prov(IDS.entityB, null)))] }))).toEqual(["EXPLANATION.DUPLICATE_CONTRIBUTION"]);
  });

  it("kind is explicit: a mislabelled response is rejected, not re-interpreted; unknown kinds are unsupported", () => {
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [contribution("a", "REQUIREMENT", formula())] }))).toEqual(["EXPLANATION.INVALID_CONTRIBUTION"]);
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [contribution("a", "SPELL", formula())] }))).toEqual(["EXPLANATION.UNSUPPORTED_CONTRIBUTION"]);
  });

  it("forged traces with an inconsistent path or a dangling diagnostic reference fail closed", () => {
    const f = formula();
    const badPath = { ...f, trace: { ...f.trace, steps: [{ ...f.trace.steps[0], path: "7" }] } };
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [contribution("a", "FORMULA", badPath)] }))).toEqual(["EXPLANATION.INVALID_TRACE_REFERENCE"]);
    const v = validation();
    const root = v.trace.steps[0] as (typeof v.trace.steps)[number];
    const child = root.children[0] as (typeof root.children)[number];
    const dangling = { ...v, trace: { ...v.trace, steps: [{ ...root, children: [{ ...child, inputs: child.inputs.map((i) => (i.name === "final_ordinal" ? { ...i, value: { type: "NUMBER", value: 99, unit: null } } : i)) }, ...root.children.slice(1)] }] } };
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [contribution("v", "VALIDATION", dangling)] }))).toEqual(["EXPLANATION.INVALID_TRACE_REFERENCE"]);
  });

  it("node ids are content-derived (contributionKey#path) — identical across runs, no randomness", () => {
    const a = build(contribution("mods", "MODIFIER", modifiers()));
    const b = build(contribution("mods", "MODIFIER", modifiers()));
    expect(flat(a.sections[0]?.nodes ?? []).map((n) => n.nodeId)).toEqual(flat(b.sections[0]?.nodes ?? []).map((n) => n.nodeId));
    expect(flat(a.sections[0]?.nodes ?? []).every((n) => n.nodeId === `mods#${n.sourceTracePath}`)).toBe(true);
  });
});

describe("M4-I120 / M4-I121 Summary is a projection of Detailed", () => {
  it("summary ⊆ detailed: same node ids and field values, relative order preserved, omitted counts reported", () => {
    const detailed = build(contribution("mods", "MODIFIER", modifiers()), contribution("f", "FORMULA", formula(), 20));
    const summary = ok(projectExplanation(detailed, "SUMMARY"));
    const byId = new Map(flat(detailed.sections.flatMap((s) => s.nodes)).map((n) => [n.nodeId, n]));
    const kept = flat(summary.sections.flatMap((s) => s.nodes));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(byId.size);
    for (const n of kept) {
      const { children: _c, omittedChildCount: _o, ...fields } = n;
      const { children: _dc, omittedChildCount: _do, ...original } = byId.get(n.nodeId) as ExplanationNode;
      expect(fields).toEqual(original);
      void [_c, _o, _dc, _do];
    }
    const detailedOrder = flat(detailed.sections.flatMap((s) => s.nodes)).map((n) => n.nodeId);
    const keptOrder = kept.map((n) => n.nodeId);
    expect(keptOrder).toEqual(detailedOrder.filter((id) => keptOrder.includes(id)));
    expect(summary.sections.map((s) => s.facts)).toEqual(detailed.sections.map((s) => s.facts));
    expect(kept.some((n) => n.omittedChildCount > 0)).toBe(true);
  });

  it("invalid states, failed nodes and warnings stay visible in the summary", () => {
    const invalid = evaluateRequirement({ kind: "ALL", children: [{ kind: "ALL", children: [{ kind: "NUMERIC_COMPARE", factKey: "missing", operator: ">=", expected: 1 }] }] }, {});
    const detailed = build(contribution("req", "REQUIREMENT", invalid, 1), contribution("val", "VALIDATION", validation(), 2));
    const summary = ok(projectExplanation(detailed, "SUMMARY"));
    expect(section(summary, "req").status).toBe("INVALID");
    expect(flat(section(summary, "req").nodes).map((n) => n.sourceTracePath)).toEqual(["1", "1.1", "1.1.1"]); // depth-3 failure kept
    expect([summary.summary.errorCount, summary.summary.warningCount]).toEqual([2, 1]);
    expect(section(summary, "val").diagnostics.map((d) => d.severity)).toEqual(["ERROR", "WARNING", "INFO"]);
  });

  it("projection never mutates the detailed document, is idempotent, and DETAILED projects to itself", () => {
    const detailed = build(contribution("mods", "MODIFIER", modifiers()));
    const before = JSON.stringify(detailed);
    const a = JSON.stringify(projectExplanation(detailed, "SUMMARY"));
    expect(JSON.stringify(projectExplanation(detailed, "SUMMARY"))).toBe(a);
    expect(JSON.stringify(detailed)).toBe(before);
    expect(JSON.stringify(ok(projectExplanation(detailed, "DETAILED")))).toBe(before);
    expect(codes(projectExplanation({ ...detailed, level: "SUMMARY" }, "SUMMARY"))).toEqual(["EXPLANATION.INVALID_INPUT"]);
  });
});

describe("M4-I123 / M4-I124 provenance", () => {
  it("two contributions from two distinct rule versions keep distinct provenance", () => {
    const doc = build(contribution("a", "FORMULA", formula(prov(IDS.entityA, IDS.versionA)), 1), contribution("b", "FORMULA", formula(prov(IDS.entityA, null)), 2));
    expect(doc.sections.map((s) => s.nodes[0]?.provenance?.entityVersionId ?? "none")).toEqual([IDS.versionA, "none"]);
  });

  it("exact RulesetProvenance is preserved verbatim on the document and per contribution", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    const ruleset = rulesetProvenanceOf(ctx.value);
    const f = evaluateFormula({ expression: "1 + 1" }, {}, { ruleset: ctx.value });
    const doc = ok(buildExplanation({ explanationKey: "x", ruleset, contributions: [contribution("a", "FORMULA", f)] }));
    expect([doc.ruleset, doc.sections[0]?.ruleset]).toEqual([ruleset, f.ruleset]);
    expect(codes(buildExplanation({ explanationKey: "x", ruleset: { ...ruleset, rulesetId: "latest" }, contributions: [] }))).toEqual(["EXPLANATION.INVALID_INPUT"]);
  });

  it("display metadata is presentation only: relabelling changes labels, never structure or values", () => {
    const f = formula();
    const a = build(contribution("a", "FORMULA", f, 1, { label: "Primary Pool", unit: "points" }));
    const b = build(contribution("a", "FORMULA", f, 1, { label: "Mana", unit: "MP" }));
    expect([a.sections[0]?.label, b.sections[0]?.label]).toEqual(["Primary Pool", "Mana"]);
    expect(JSON.stringify({ ...a.sections[0], label: null, unit: null })).toBe(JSON.stringify({ ...b.sections[0], label: null, unit: null }));
  });
});

describe("M4-I130 / M4-I131 / M4-I132 immutability, serialization, determinism, safety, limits", () => {
  it("inputs never change and are never frozen; outputs are deep-frozen, detached and serializable", () => {
    const inputs = [formula(), requirement(1), modifiers(), payment(17, 6, 20), validation()];
    const before = JSON.stringify(inputs);
    const label = { text: "Listed" };
    const request = { explanationKey: "x", title: "T", contributions: inputs.map((r, i) => contribution(`c${i}`, ["FORMULA", "REQUIREMENT", "MODIFIER", "RESOURCE", "VALIDATION"][i] as string, r, i, { label: label.text })) };
    const r = buildExplanation(request);
    expect(JSON.stringify(inputs)).toBe(before);
    expect(Object.isFrozen(request) || Object.isFrozen(request.contributions[0])).toBe(false);
    expect(Object.isFrozen(r.data?.sections[0]?.nodes[0]) && Object.isFrozen(r.data?.sections[0]?.facts)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const snapshotJson = JSON.stringify(r.data);
    (request.contributions[0] as Record<string, unknown>).label = "Changed";
    expect(JSON.stringify(r.data)).toBe(snapshotJson);
  });

  it("same input → byte-identical detailed and summary; shuffled contributions change nothing", () => {
    const rows = [contribution("a", "FORMULA", formula(), 2), contribution("b", "MODIFIER", modifiers(), 1), contribution("c", "VALIDATION", validation(), 3)];
    const d = assertDeterministic(() => buildExplanation({ explanationKey: "x", contributions: rows }), { runs: 5 });
    assertDeterministic(() => projectExplanation(d.data, "SUMMARY"), { runs: 5 });
    expect(JSON.stringify(buildExplanation({ explanationKey: "x", contributions: [rows[2], rows[0], rows[1]] }))).toBe(JSON.stringify(d));
  });

  it("getters, prototypes, cycles and pathological nesting fail safely without invocation", () => {
    let called = false;
    const getter = contribution("a", "FORMULA", formula());
    Object.defineProperty(getter, "label", { enumerable: true, get: () => ((called = true), "x") });
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [getter] }))).toEqual(["EXPLANATION.INVALID_CONTRIBUTION"]);
    const cyclic: Record<string, unknown> = { ...formula() };
    cyclic.self = cyclic;
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [contribution("a", "FORMULA", cyclic)] }))).toEqual(["EXPLANATION.INVALID_CONTRIBUTION"]);
    expect(codes(buildExplanation(JSON.parse('{"explanationKey":"x","contributions":[],"__proto__":{"y":1}}')))).toEqual(["EXPLANATION.INVALID_INPUT"]);
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 50_000; i += 1) deep = { d: deep };
    expect(() => buildExplanation({ explanationKey: "x", contributions: [contribution("a", "GENERIC", deep)] })).not.toThrow();
    expect(called).toBe(false);
  });

  it("deep forged traces are bounded iteratively; one over the depth limit fails closed", () => {
    const step = (path: string, ordinal: number, children: unknown[]) => ({ ordinal, path, key: "k", operation: "generic.step", phase: null, inputs: [], output: null, provenance: null, modifierSource: null, explanation: null, children });
    const chain = (depth: number) => {
      let node = step(Array.from({ length: depth }, () => "1").join("."), depth - 1, []);
      for (let d = depth - 1; d >= 1; d -= 1) node = step(Array.from({ length: d }, () => "1").join("."), d - 1, [node]);
      return { contractVersion: 1, evaluationKind: "generic.example", success: true, status: "SUCCESS", data: null, errors: [], warnings: [], info: [], trace: { steps: [node], stepCount: depth }, ruleset: null };
    };
    // data must be non-null on a successful response? WO1 allows data null on SUCCESS for generic results.
    expect(buildExplanation({ explanationKey: "x", contributions: [contribution("a", "GENERIC", chain(EXPLANATION_LIMITS.MAX_TRACE_DEPTH))] }).status).toBe("SUCCESS");
    expect(codes(buildExplanation({ explanationKey: "x", contributions: [contribution("a", "GENERIC", chain(EXPLANATION_LIMITS.MAX_TRACE_DEPTH + 1))] }))).toEqual(["EXPLANATION.LIMIT_EXCEEDED"]);
  });

  it("limits: contributions over the maximum fail closed — never truncated", () => {
    const f = formula();
    expect(codes(buildExplanation({ explanationKey: "x", contributions: Array.from({ length: EXPLANATION_LIMITS.MAX_CONTRIBUTIONS + 1 }, (_, i) => contribution(`c${i}`, "FORMULA", f)) }))).toEqual(["EXPLANATION.LIMIT_EXCEEDED"]);
  });

  it("large sanity: 2,000 modifier outcomes across 20 contributions — deterministic, stable references", () => {
    const big = evaluateModifiers({
      targets: [{ targetKey: "t.value", kind: "NUMERIC", value: 0 }],
      modifiers: Array.from({ length: 100 }, (_, i) => ({ modifierKey: `m${String(i).padStart(3, "0")}`, targetKey: "t.value", operation: "ADD", operand: 1, phase: { phaseKey: `p${i % 5}`, phaseOrder: i % 5 }, priority: 0, order: i })),
    });
    const rows = Array.from({ length: 20 }, (_, i) => contribution(`c${String(i).padStart(2, "0")}`, "MODIFIER", big, i));
    const r = assertDeterministic(() => buildExplanation({ explanationKey: "x", contributions: rows }), { runs: 2 });
    expect([r.status, r.data?.sections.length, facts(r.data?.sections[0] as ExplanationSection)["final:t.value"]]).toEqual(["SUCCESS", 20, 100]);
    expect(r.data?.summary.nodeCount).toBe(20 * (1 + 1 + 5 + 100));
  });
});
