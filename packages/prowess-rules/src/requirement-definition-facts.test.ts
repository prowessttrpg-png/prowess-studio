import { describe, expect, it } from "vitest";
import { createRequirementFacts, evaluateRequirement, REQUIREMENT_LIMITS, validateRequirement, type RequirementFactsOutcome } from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";

/**
 * M4-WO5 Requirement definitions, facts, limits and security. Guards M4-I52 (Invalid Requirement Is Distinct From
 * Unsatisfied), M4-I53 (Requirement Predicates Consume Explicit Facts Only), M4-I54 (Requirement Facts Use Exact
 * Identity), M4-I61 (Requirement Inputs / Outputs Are Immutable) and M4-I64 (Requirement Trees Are Complexity-Bounded).
 */
const leaf = { kind: "NUMERIC_COMPARE", factKey: "x", operator: ">=", expected: 1 };
const defCodes = (r: unknown) => {
  const v = validateRequirement(r);
  return v.ok ? [] : v.diagnostics.map((d) => d.code);
};
const factDiag = (input: unknown) => {
  const o = createRequirementFacts(input) as RequirementFactsOutcome;
  return o.ok ? [] : o.diagnostics.map((d) => [d.code, d.path]);
};

describe("definition validation", () => {
  it("accepts every predicate kind and nested groups, returning a detached frozen tree", () => {
    const tree = {
      kind: "ALL",
      children: [
        leaf,
        { kind: "RANK_AT_LEAST", factKey: "skill.arcana", requiredRankKey: "Expert", requiredOrder: 2 },
        { kind: "KEYWORD_PRESENT", keywordId: "60000000-0000-4000-8000-000000000001" },
        { kind: "KEYWORD_PRESENT", canonicalKey: "keyword.fire" },
        { kind: "ANY", children: [{ kind: "SET_CONTAINS", factKey: "w.props", member: "Reach" }, { kind: "ENTITY_OWNED", entityId: "40000000-0000-4000-8000-00000000000A" }] },
        { kind: "NONE", children: [leaf] },
      ],
    };
    const v = validateRequirement(tree);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Object.isFrozen(v.requirement)).toBe(true);
    expect(v.requirement).not.toBe(tree);
    expect(JSON.parse(JSON.stringify(v.requirement))).toEqual(v.requirement);
    expect(JSON.stringify(v.requirement)).toContain("40000000-0000-4000-8000-00000000000a");
  });

  it.each([
    ["empty ALL", { kind: "ALL", children: [] }],
    ["empty ANY", { kind: "ANY", children: [] }],
    ["empty NONE", { kind: "NONE", children: [] }],
    ["group without children", { kind: "ALL" }],
    ["unknown operator", { ...leaf, operator: "=>" }],
    ["string threshold", { ...leaf, expected: "5" }],
    ["non-finite threshold", { ...leaf, expected: Number.POSITIVE_INFINITY }],
    ["bad fact key", { ...leaf, factKey: "actor level" }],
    ["prototype fact key", { ...leaf, factKey: "__proto__" }],
    ["unknown field", { ...leaf, weight: 2 }],
    ["keyword with both id and key", { kind: "KEYWORD_PRESENT", keywordId: "60000000-0000-4000-8000-000000000001", canonicalKey: "keyword.fire" }],
    ["keyword with neither", { kind: "KEYWORD_PRESENT" }],
    ["blank member", { kind: "SET_CONTAINS", factKey: "s", member: " reach" }],
    ["entity name, not id", { kind: "ENTITY_OWNED", entityId: "Sword of X" }],
    ["fractional rank order", { kind: "RANK_AT_LEAST", factKey: "s", requiredRankKey: "expert", requiredOrder: 2.5 }],
    ["bad provenance", { ...leaf, provenance: { entityId: "nope" } }],
  ])("%s → INVALID_DEFINITION", (_label, node) => expect(defCodes(node)).toEqual(["REQUIREMENT.INVALID_DEFINITION"]));

  it("CUSTOM and unknown kinds are a controlled UNSUPPORTED_PREDICATE — nothing is executed", () => {
    let called = false;
    const custom = { kind: "CUSTOM", evaluate: () => ((called = true), true) };
    const r = evaluateRequirement(custom, {});
    expect(r.errors.map((e) => e.code)).toEqual(["REQUIREMENT.UNSUPPORTED_PREDICATE"]);
    expect(called).toBe(false);
    expect(defCodes({ kind: "STAT_SCORE", factKey: "x" })).toEqual(["REQUIREMENT.UNSUPPORTED_PREDICATE"]);
    expect(defCodes({ kind: "requires Expert Emission" })).toEqual(["REQUIREMENT.UNSUPPORTED_PREDICATE"]);
  });

  it("a function or accessor anywhere in a node is rejected without being invoked", () => {
    let called = false;
    const sneaky = { kind: "NUMERIC_COMPARE", factKey: "x", operator: ">=" } as Record<string, unknown>;
    Object.defineProperty(sneaky, "expected", { enumerable: true, get: () => ((called = true), 1) });
    expect(defCodes(sneaky)).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
    expect(defCodes({ ...leaf, expected: () => 1 })).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
    expect(called).toBe(false);
  });

  it("prose, strings, arrays and class instances are not Requirements", () => {
    for (const bad of ["level >= 5", "(A && B) || !C", [leaf], new Date(0), null, 5]) expect(defCodes(bad), String(bad)).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
  });

  it("diagnostics are reported in authored pre-order with exact JSON pointers and node paths", () => {
    const v = validateRequirement({ kind: "ALL", children: [{ ...leaf, operator: "~" }, { kind: "ANY", children: [] }, { kind: "CUSTOM" }] });
    expect(!v.ok && v.diagnostics.map((d) => [d.code, d.path, d.nodePath])).toEqual([
      ["REQUIREMENT.INVALID_DEFINITION", "/children/0/operator", "root.0"],
      ["REQUIREMENT.INVALID_DEFINITION", "/children/1/children", "root.1"],
      ["REQUIREMENT.UNSUPPORTED_PREDICATE", "/children/2/kind", "root.2"],
    ]);
  });
});

describe("M4-I64 complexity limits and cycles", () => {
  const nest = (depth: number) => {
    let node: unknown = leaf;
    for (let i = 1; i < depth; i += 1) node = { kind: "ALL", children: [node] };
    return node;
  };

  it("depth: exactly 64 levels is accepted; 65 and 100,000 fail cleanly (no stack overflow)", () => {
    expect(validateRequirement(nest(REQUIREMENT_LIMITS.MAX_DEPTH)).ok).toBe(true);
    expect(defCodes(nest(REQUIREMENT_LIMITS.MAX_DEPTH + 1))).toEqual(["REQUIREMENT.LIMIT_EXCEEDED"]);
    expect(evaluateRequirement(nest(100_000), {}).errors.map((e) => e.code)).toEqual(["REQUIREMENT.LIMIT_EXCEEDED"]);
  });

  it("children per group: 512 accepted, 513 rejected", () => {
    expect(validateRequirement({ kind: "ANY", children: Array.from({ length: 512 }, () => leaf) }).ok).toBe(true);
    expect(defCodes({ kind: "ANY", children: Array.from({ length: 513 }, () => leaf) })).toEqual(["REQUIREMENT.LIMIT_EXCEEDED"]);
  });

  it("node count: 2,048 accepted, 2,049 rejected", () => {
    const tree = (leaves: number) => ({ kind: "ALL", children: Array.from({ length: Math.ceil(leaves / 500) }, (_, g) => ({ kind: "ANY", children: Array.from({ length: Math.min(500, leaves - g * 500) }, () => leaf) })) });
    // 1 root + 5 groups + 2,042 leaves = 2,048 nodes
    expect(validateRequirement(tree(2042)).ok).toBe(true);
    expect(defCodes(tree(2043))).toEqual(["REQUIREMENT.LIMIT_EXCEEDED"]);
  });

  it("a cyclic object graph is rejected safely; a shared (non-cyclic) child is fine", () => {
    const loop: Record<string, unknown> = { kind: "ALL" };
    loop.children = [leaf, loop];
    expect(defCodes(loop)).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
    const shared = { kind: "ALL", children: [leaf, leaf, { kind: "ANY", children: [leaf] }] };
    expect(validateRequirement(shared).ok).toBe(true);
  });

  it("large-tree sanity: ~1,500 nodes evaluate correctly and deterministically", () => {
    const facts = { numeric: Array.from({ length: 300 }, (_, i) => ({ key: `f${i}`, value: i })) };
    const tree = {
      kind: "ALL",
      children: Array.from({ length: 300 }, (_, i) => ({
        kind: "ANY",
        children: [
          { kind: "NUMERIC_COMPARE", factKey: `f${i}`, operator: "==", expected: i },
          { kind: "NUMERIC_COMPARE", factKey: `f${i}`, operator: "<", expected: 0 },
          { kind: "NONE", children: [{ kind: "NUMERIC_COMPARE", factKey: `f${i}`, operator: "<", expected: 0 }] },
        ],
      })),
    };
    const r = assertDeterministic(() => evaluateRequirement(tree, facts), { inputs: [tree, facts], runs: 3 });
    expect([r.status, r.data?.satisfied, r.trace.stepCount]).toEqual(["SUCCESS", true, 1501]);
  });
});

describe("M4-I53 / M4-I54 facts: explicit, exact, normalized, conflict-free", () => {
  it("normalizes collections into key order, collapses identical facts and duplicate members", () => {
    const o = createRequirementFacts({
      numeric: [{ key: "b", value: 2 }, { key: "a", value: 1 }, { key: "b", value: 2 }],
      sets: [{ key: "s", members: ["z", "a", "z"] }],
      ownedEntityIds: ["40000000-0000-4000-8000-00000000000B", "40000000-0000-4000-8000-00000000000a", "40000000-0000-4000-8000-00000000000b"],
    });
    expect(o.ok && o.facts).toEqual({
      numeric: [{ key: "a", value: 1, provenance: null }, { key: "b", value: 2, provenance: null }],
      ranks: [],
      sets: [{ key: "s", members: ["a", "z"], provenance: null }],
      ownedEntityIds: ["40000000-0000-4000-8000-00000000000a", "40000000-0000-4000-8000-00000000000b"],
      keywords: null,
    });
  });

  it("absent collections are distinguishable: ownedEntityIds and keywords stay null unless supplied", () => {
    const o = createRequirementFacts({});
    expect(o.ok && [o.facts.ownedEntityIds, o.facts.keywords]).toEqual([null, null]);
    const supplied = createRequirementFacts({ ownedEntityIds: [] });
    expect(supplied.ok && supplied.facts.ownedEntityIds).toEqual([]);
  });

  it("never coerces: strings, booleans, null and non-finite numbers are invalid facts", () => {
    for (const value of ["5", true, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, [5]]) {
      expect(factDiag({ numeric: [{ key: "x", value }] }), String(value)).toEqual([["REQUIREMENT.INVALID_FACTS", "/numeric/0/value"]]);
    }
  });

  it("conflicting duplicates fail closed — never 'last one wins' — independent of input order", () => {
    const a = factDiag({ numeric: [{ key: "actor.level", value: 4 }, { key: "actor.level", value: 7 }] });
    const b = factDiag({ numeric: [{ key: "actor.level", value: 7 }, { key: "actor.level", value: 4 }] });
    expect(a).toEqual([["REQUIREMENT.FACT_CONFLICT", "/numeric"]]);
    expect(b).toEqual(a);
    expect(factDiag({ ranks: [{ key: "s", rankKey: "expert", order: 2 }, { key: "s", rankKey: "master", order: 3 }] })).toEqual([["REQUIREMENT.FACT_CONFLICT", "/ranks"]]);
    expect(factDiag({ ranks: [{ key: "s", rankKey: "expert", order: 2 }, { key: "s", rankKey: "Expert", order: 2 }] })).toEqual([["REQUIREMENT.FACT_CONFLICT", "/ranks"]]);
    expect(factDiag({ sets: [{ key: "s", members: ["a"] }, { key: "s", members: ["b"] }] })).toEqual([["REQUIREMENT.FACT_CONFLICT", "/sets"]]);
    expect(factDiag({ numeric: [{ key: "x", value: 1 }, { key: "x", value: 1, provenance: { entityId: "40000000-0000-4000-8000-00000000000a" } }] })).toEqual([["REQUIREMENT.FACT_CONFLICT", "/numeric"]]);
  });

  it("identical set facts with members in a different order are the same fact", () => {
    expect(factDiag({ sets: [{ key: "s", members: ["a", "b"] }, { key: "s", members: ["b", "a", "a"] }] })).toEqual([]);
  });

  it("one key belongs to one fact kind", () => {
    expect(factDiag({ numeric: [{ key: "k", value: 1 }], sets: [{ key: "k", members: ["x"] }] })).toEqual([["REQUIREMENT.FACT_CONFLICT", ""]]);
  });

  it("rejects unknown fields, malformed keys, prototype keys, getters and non-plain input", () => {
    expect(factDiag({ numbers: [] })).toEqual([["REQUIREMENT.INVALID_FACTS", ""]]);
    expect(factDiag({ numeric: [{ key: "Actor Level", value: 1 }] })).toEqual([["REQUIREMENT.INVALID_FACTS", "/numeric/0/key"]]);
    expect(factDiag({ numeric: [{ key: "constructor", value: 1 }] })).toEqual([["REQUIREMENT.INVALID_FACTS", "/numeric/0/key"]]);
    expect(factDiag(JSON.parse('{"numeric": [{"key": "x", "value": 1, "__proto__": {"y": 1}}]}'))).toEqual([["REQUIREMENT.INVALID_FACTS", "/numeric/0"]]);
    let called = false;
    const sneaky = { key: "x" } as Record<string, unknown>;
    Object.defineProperty(sneaky, "value", { enumerable: true, get: () => ((called = true), 1) });
    expect(factDiag({ numeric: [sneaky] })).toEqual([["REQUIREMENT.INVALID_FACTS", "/numeric/0"]]);
    expect(called).toBe(false);
    expect(factDiag(new Map())).toEqual([["REQUIREMENT.INVALID_FACTS", ""]]);
  });

  it("a deeply nested junk object inside a fact cannot overflow the stack", () => {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 50_000; i += 1) deep = { inner: deep };
    expect(() => createRequirementFacts({ numeric: [{ key: "x", value: 1, provenance: deep }] })).not.toThrow();
    expect(factDiag({ numeric: [{ key: "x", value: 1, provenance: deep }] })[0]?.[0]).toBe("REQUIREMENT.INVALID_FACTS");
  });

  it("M4-I61: facts are detached and deep-frozen; the caller's input is not modified", () => {
    const input = { numeric: [{ key: "b", value: 2 }, { key: "a", value: 1 }] };
    const before = JSON.stringify(input);
    const o = createRequirementFacts(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(o.ok && Object.isFrozen(o.facts.numeric[0])).toBe(true);
    const again = createRequirementFacts(o.ok ? o.facts : null);
    expect(again.ok && again.facts).toEqual(o.ok && o.facts); // normalized facts are valid input (idempotent)
  });

  it("M4-I52: invalid definitions and invalid facts are reported together, definitions first", () => {
    const r = evaluateRequirement({ kind: "ALL", children: [] }, { numeric: [{ key: "x", value: "1" }] });
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([
      ["REQUIREMENT.INVALID_DEFINITION", "/requirement/children"],
      ["REQUIREMENT.INVALID_FACTS", "/facts/numeric/0/value"],
    ]);
  });
});
