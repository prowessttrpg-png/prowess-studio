import { describe, expect, it } from "vitest";
import {
  createRulesetContext,
  evaluateRequirement,
  flattenTrace,
  resolveKeywords,
  type RequirementEvaluation,
  type RequirementGroupOutcome,
  type RequirementLeafOutcome,
  type ResolvedKeywordSet,
  type RuleEngineResponse,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO5 Requirement evaluation. Guards M4-I51 (Unmet Requirement Is A Valid Evaluation Result), M4-I52 (Invalid
 * Requirement Is Distinct From Unsatisfied), M4-I53 (Requirement Predicates Consume Explicit Facts Only), M4-I54
 * (Requirement Facts Use Exact Identity), M4-I55 (Requirement Groups Support ALL / ANY / NONE), M4-I56 (Requirement
 * Groups Evaluate Every Child), M4-I57 (Rank Ordering Is Data, Not Hard-Coded Mechanics), M4-I58 (Keyword Requirements
 * Reuse Exact WO4 Membership), M4-I59 (Requirements Have No Side Effects), M4-I60 (Requirement Evaluation Is
 * Deterministic), M4-I61 (Requirement Inputs / Outputs Are Immutable), M4-I62 (Missing Required Context Fails Closed)
 * and M4-I63 (Requirement Provenance Is Preserved).
 *
 * Prowess-shaped keys and labels are test data only; the engine attaches no meaning to them.
 */
const T = { kind: "NUMERIC_COMPARE", factKey: "t", operator: "==", expected: 1 } as const; // true with facts below
const F = { kind: "NUMERIC_COMPARE", factKey: "t", operator: "==", expected: 0 } as const; // false
const MISSING = { kind: "NUMERIC_COMPARE", factKey: "absent.fact", operator: ">=", expected: 1 } as const;
const MALFORMED = { kind: "NUMERIC_COMPARE", factKey: "t", operator: "~=", expected: 1 } as const;
const UNSUPPORTED = { kind: "CUSTOM", code: "return true" } as const;
const BASE = { numeric: [{ key: "t", value: 1 }] };

const ok = (r: RuleEngineResponse<RequirementEvaluation>) => {
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.data as RequirementEvaluation;
};
const sat = (requirement: unknown, facts: unknown = BASE) => ok(evaluateRequirement(requirement, facts)).satisfied;
const codes = (r: RuleEngineResponse<RequirementEvaluation>) => r.errors.map((e) => e.code);
const nodePaths = (r: RuleEngineResponse<RequirementEvaluation>) => r.errors.map((e) => (e.details as { nodePath: string | null } | null)?.nodePath ?? null);

const KW = {
  fire: { keywordId: "60000000-0000-4000-8000-000000000001", canonicalKey: "keyword.fire", categoryId: null },
  damage: { keywordId: "60000000-0000-4000-8000-000000000002", canonicalKey: "keyword.damage", categoryId: null },
};
const keywordSet = (...keywords: (typeof KW)[keyof typeof KW][]): ResolvedKeywordSet =>
  resolveKeywords(keywords.map((keyword, i) => ({ keyword, source: { sourceType: "test.source", sourceKey: `s${i}` } }))).data as ResolvedKeywordSet;

describe("M4-I51 / M4-I52 satisfied, unsatisfied (valid) and invalid are three different things", () => {
  const level = { kind: "NUMERIC_COMPARE", factKey: "actor.level", operator: ">=", expected: 5 };

  it("CASE A: level 3 vs >= 5 → SUCCESS, satisfied false, no errors / warnings / info", () => {
    const r = evaluateRequirement(level, { numeric: [{ key: "actor.level", value: 3 }] });
    expect([r.status, r.success, r.data?.satisfied]).toEqual(["SUCCESS", true, false]);
    expect([r.errors, r.warnings, r.info]).toEqual([[], [], []]);
  });

  it("CASE B: level missing → INVALID, MISSING_FACT naming the exact key, data null", () => {
    const r = evaluateRequirement(level, {});
    expect([r.status, r.success, r.data]).toEqual(["INVALID", false, null]);
    expect(codes(r)).toEqual(["REQUIREMENT.MISSING_FACT"]);
    expect(r.errors[0]?.message).toContain('"actor.level"');
    expect(r.errors[0]).toMatchObject({ kind: "VALIDATION", category: "REQUIREMENT", path: "/requirement", details: { nodePath: "root" } });
  });

  it("satisfied → SUCCESS, satisfied true", () => {
    expect(evaluateRequirement(level, { numeric: [{ key: "actor.level", value: 5 }] }).data?.satisfied).toBe(true);
  });

  it("no diagnostic code exists for a normal false result", () => {
    const r = evaluateRequirement({ kind: "ALL", children: [F, F, F] }, BASE);
    expect(r.status).toBe("SUCCESS");
    expect(JSON.stringify(r)).not.toMatch(/NOT_MET|UNSATISFIED/);
  });
});

describe("M4-I55 ALL / ANY / NONE truth tables", () => {
  it.each([
    ["ALL", [T, T], true],
    ["ALL", [T, F], false],
    ["ALL", [F, F], false],
    ["ANY", [T, T], true],
    ["ANY", [T, F], true],
    ["ANY", [F, F], false],
    ["NONE", [T, T], false],
    ["NONE", [T, F], false],
    ["NONE", [F, F], true],
  ] as const)("%s %j → %s", (kind, children, expected) => expect(sat({ kind, children })).toBe(expected));

  it("nested: ALL inside ANY, ANY inside ALL, NONE inside ALL, several levels", () => {
    expect(sat({ kind: "ANY", children: [F, { kind: "ALL", children: [T, T] }] })).toBe(true);
    expect(sat({ kind: "ALL", children: [T, { kind: "ANY", children: [F, T] }] })).toBe(true);
    expect(sat({ kind: "ALL", children: [T, { kind: "NONE", children: [F, F] }] })).toBe(true);
    expect(sat({ kind: "ALL", children: [T, { kind: "NONE", children: [F, T] }] })).toBe(false);
    expect(sat({ kind: "ANY", children: [{ kind: "ALL", children: [T, { kind: "NONE", children: [{ kind: "ANY", children: [F, F] }] }] }, F] })).toBe(true);
  });

  it("the group outcome keeps operator, result and ordered child outcomes", () => {
    const outcome = ok(evaluateRequirement({ kind: "ANY", children: [F, T, F] }, BASE)).outcome as RequirementGroupOutcome;
    expect([outcome.kind, outcome.satisfied, outcome.nodePath]).toEqual(["ANY", true, "root"]);
    expect(outcome.children.map((c) => [c.nodePath, c.satisfied])).toEqual([["root.0", false], ["root.1", true], ["root.2", false]]);
  });
});

describe("M4-I56 every child is evaluated — a decided sibling never hides an invalid one", () => {
  it.each([
    ["ANY: true first, then a missing fact", { kind: "ANY", children: [T, MISSING] }, "REQUIREMENT.MISSING_FACT"],
    ["ALL: false first, then a malformed predicate", { kind: "ALL", children: [F, MALFORMED] }, "REQUIREMENT.INVALID_DEFINITION"],
    ["NONE: true first, then an unsupported predicate", { kind: "NONE", children: [T, UNSUPPORTED] }, "REQUIREMENT.UNSUPPORTED_PREDICATE"],
    ["NONE: false first, then an unsupported predicate", { kind: "NONE", children: [F, UNSUPPORTED] }, "REQUIREMENT.UNSUPPORTED_PREDICATE"],
    ["deep: ANY(true, ALL(false, missing))", { kind: "ANY", children: [T, { kind: "ALL", children: [F, MISSING] }] }, "REQUIREMENT.MISSING_FACT"],
  ])("%s → INVALID", (_label, requirement, code) => {
    const r = evaluateRequirement(requirement, BASE);
    expect([r.status, r.data]).toEqual(["INVALID", null]);
    expect(codes(r)).toEqual([code]);
  });

  it("all problems are reported, in authored tree order", () => {
    const r = evaluateRequirement({ kind: "ALL", children: [MISSING, T, { kind: "ANY", children: [{ ...MISSING, factKey: "b.missing" }, F] }, { ...MISSING, factKey: "c.missing" }] }, BASE);
    expect(nodePaths(r)).toEqual(["root.0", "root.2.0", "root.3"]);
  });

  it("the trace of an invalid evaluation shows what was inspected, with null output at failing nodes", () => {
    const r = evaluateRequirement({ kind: "ANY", children: [T, MISSING] }, BASE);
    expect(flattenTrace(r.trace).map((s) => [s.path, s.operation, s.output])).toEqual([
      ["1", "requirement.any", null],
      ["1.1", "requirement.numeric_compare", { type: "BOOLEAN", value: true }],
      ["1.2", "requirement.numeric_compare", null],
    ]);
  });
});

describe("NUMERIC_COMPARE", () => {
  it.each([
    ["==", 5, 5, true], ["==", 5, 4, false],
    ["!=", 3, 4, true], ["!=", 4, 4, false],
    ["<", 2, 3, true], ["<", 3, 3, false],
    ["<=", 3, 3, true], ["<=", 4, 3, false],
    [">", 4, 3, true], [">", 3, 3, false],
    [">=", 5, 5, true], [">=", 4, 5, false],
  ] as const)("%s: actual %s vs %s → %s", (operator, actual, expected, result) => {
    expect(sat({ kind: "NUMERIC_COMPARE", factKey: "x", operator, expected }, { numeric: [{ key: "x", value: actual }] })).toBe(result);
  });

  it("fractional, negative and zero values compare exactly (no epsilon, no rounding); -0 equals 0", () => {
    expect(sat({ kind: "NUMERIC_COMPARE", factKey: "x", operator: ">=", expected: 2.5 }, { numeric: [{ key: "x", value: 2.49 }] })).toBe(false);
    expect(sat({ kind: "NUMERIC_COMPARE", factKey: "x", operator: "<", expected: -1 }, { numeric: [{ key: "x", value: -1.5 }] })).toBe(true);
    expect(sat({ kind: "NUMERIC_COMPARE", factKey: "x", operator: "==", expected: 0.3 }, { numeric: [{ key: "x", value: 0.1 + 0.2 }] })).toBe(false);
    expect(sat({ kind: "NUMERIC_COMPARE", factKey: "x", operator: "==", expected: 0 }, { numeric: [{ key: "x", value: -0 }] })).toBe(true);
    const leaf = ok(evaluateRequirement({ kind: "NUMERIC_COMPARE", factKey: "x", operator: "==", expected: -0 }, { numeric: [{ key: "x", value: -0 }] })).outcome as RequirementLeafOutcome;
    expect(Object.is(leaf.actual.value, 0) && Object.is(leaf.expected.value, 0)).toBe(true);
  });

  it("the leaf outcome records actual vs expected as data", () => {
    const leaf = ok(evaluateRequirement({ kind: "NUMERIC_COMPARE", factKey: "actor.level", operator: ">=", expected: 5 }, { numeric: [{ key: "actor.level", value: 4 }] })).outcome;
    expect(leaf).toEqual({ nodePath: "root", kind: "NUMERIC_COMPARE", satisfied: false, expected: { operator: ">=", value: 5 }, actual: { value: 4 }, provenance: null, factProvenance: null });
  });

  it("an exact key only: case, spelling and dotted variants are missing facts", () => {
    for (const key of ["Actor.level", "actor.Level", "actorlevel", "actor_level", "actor.level.x"]) {
      expect(codes(evaluateRequirement({ kind: "NUMERIC_COMPARE", factKey: "actor.level", operator: ">=", expected: 1 }, { numeric: [{ key, value: 9 }] })), key).toEqual(["REQUIREMENT.MISSING_FACT"]);
    }
  });

  it("a key held as another fact kind is a TYPE_MISMATCH, not a silent false", () => {
    const r = evaluateRequirement({ kind: "NUMERIC_COMPARE", factKey: "w.props", operator: ">=", expected: 1 }, { sets: [{ key: "w.props", members: ["reach"] }] });
    expect(codes(r)).toEqual(["REQUIREMENT.TYPE_MISMATCH"]);
  });
});

describe("M4-I57 RANK_AT_LEAST — order is data, labels are metadata", () => {
  const req = (requiredOrder: number, requiredRankKey = "expert") => ({ kind: "RANK_AT_LEAST", factKey: "skill.arcana", requiredRankKey, requiredOrder });
  const facts = (rankKey: string, order: number) => ({ ranks: [{ key: "skill.arcana", rankKey, order }] });

  it("below / equal / above", () => {
    expect(sat(req(2), facts("trained", 1))).toBe(false);
    expect(sat(req(2), facts("expert", 2))).toBe(true);
    expect(sat(req(2), facts("master", 3))).toBe(true);
  });

  it("Master(order 3) >= Expert(order 2): the outcome keeps both labels and orders", () => {
    const leaf = ok(evaluateRequirement(req(2), facts("master", 3))).outcome;
    expect(leaf).toMatchObject({ satisfied: true, expected: { rankKey: "expert", order: 2 }, actual: { rankKey: "master", order: 3 } });
  });

  it("no built-in ladder: only the supplied orders decide — any scale works, labels are never compared", () => {
    expect(sat(req(2, "Expert"), facts("master", 1))).toBe(false); // a "master" at order 1 is below order 2
    expect(sat(req(10, "gold"), facts("bronze", 99))).toBe(true);
    expect(sat(req(-3, "anything"), facts("whatever", -3))).toBe(true);
    expect(sat(req(2, "EXPERT"), facts("expert", 2))).toBe(true); // labels differ in case; order decides
  });

  it("rank orders must be finite integers", () => {
    for (const order of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codes(evaluateRequirement(req(2), facts("x", order))), String(order)).toEqual(["REQUIREMENT.INVALID_FACTS"]);
      expect(codes(evaluateRequirement(req(order), facts("x", 1))), String(order)).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
    }
  });
});

describe("M4-I58 KEYWORD_PRESENT reuses exact WO4 membership", () => {
  it("present / absent by exact id and by exact canonical key", () => {
    const s = keywordSet(KW.fire);
    expect(sat({ kind: "KEYWORD_PRESENT", keywordId: KW.fire.keywordId }, { keywords: s })).toBe(true);
    expect(sat({ kind: "KEYWORD_PRESENT", keywordId: KW.damage.keywordId }, { keywords: s })).toBe(false);
    expect(sat({ kind: "KEYWORD_PRESENT", canonicalKey: "keyword.fire" }, { keywords: s })).toBe(true);
    expect(sat({ kind: "KEYWORD_PRESENT", canonicalKey: "keyword.damage" }, { keywords: s })).toBe(false);
  });

  it("the same canonical label on a different id is not the Keyword; case changes never match", () => {
    const s = keywordSet(KW.fire);
    expect(sat({ kind: "KEYWORD_PRESENT", keywordId: "60000000-0000-4000-8000-0000000000ff" }, { keywords: s })).toBe(false);
    expect(codes(evaluateRequirement({ kind: "KEYWORD_PRESENT", canonicalKey: "keyword.FIRE" }, { keywords: s }))).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
    expect(codes(evaluateRequirement({ kind: "KEYWORD_PRESENT", canonicalKey: "Fire" }, { keywords: s }))).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
  });

  it("duplicate contributions still produce one membership answer", () => {
    const s = resolveKeywords([1, 2, 3].map((i) => ({ keyword: KW.fire, source: { sourceType: "test.source", sourceKey: `s${i}` } }))).data as ResolvedKeywordSet;
    expect(sat({ kind: "KEYWORD_PRESENT", keywordId: KW.fire.keywordId }, { keywords: s })).toBe(true);
  });

  it("M4-I62: a Keyword requirement with no KeywordSet is invalid; an empty supplied set is a valid false", () => {
    expect(codes(evaluateRequirement({ kind: "KEYWORD_PRESENT", keywordId: KW.fire.keywordId }, {}))).toEqual(["REQUIREMENT.MISSING_FACT"]);
    expect(sat({ kind: "KEYWORD_PRESENT", keywordId: KW.fire.keywordId }, { keywords: keywordSet() })).toBe(false);
  });

  it("a hand-built, reordered or inconsistent KeywordSet is rejected (WO4 lookup depends on its exact shape)", () => {
    const real = keywordSet(KW.fire, KW.damage);
    const reversed = { keywords: [...real.keywords].reverse() };
    for (const forged of [reversed, { keywords: [{ keyword: KW.fire, contributors: [] }] }, { keywords: "fire" }, { keywords: [{ keyword: { ...KW.fire, name: "Fire" }, contributors: real.keywords[1]?.contributors }] }]) {
      expect(codes(evaluateRequirement({ kind: "KEYWORD_PRESENT", keywordId: KW.fire.keywordId }, { keywords: forged })), JSON.stringify(forged).slice(0, 60)).toEqual(["REQUIREMENT.INVALID_FACTS"]);
    }
  });
});

describe("SET_CONTAINS — exact membership", () => {
  const req = (member: string) => ({ kind: "SET_CONTAINS", factKey: "build.weapon_properties", member });
  const facts = (...members: string[]) => ({ sets: [{ key: "build.weapon_properties", members }] });

  it("exact present / absent; case and substring never match", () => {
    expect(sat(req("two_handed"), facts("reach", "two_handed"))).toBe(true);
    expect(sat(req("reach"), facts("two_handed"))).toBe(false);
    for (const near of ["Two_Handed", "TWO_HANDED", "two", "handed", "two_handed_x"]) expect(sat(req(near), facts("two_handed")), near).toBe(false);
  });

  it("duplicate members collapse; member order is irrelevant", () => {
    expect(JSON.stringify(evaluateRequirement(req("reach"), facts("reach", "x", "reach")).data)).toBe(JSON.stringify(evaluateRequirement(req("reach"), facts("x", "reach")).data));
  });

  it("M4-I62: a missing set fact is invalid; an empty supplied set is a valid false", () => {
    expect(codes(evaluateRequirement(req("reach"), {}))).toEqual(["REQUIREMENT.MISSING_FACT"]);
    expect(sat(req("reach"), facts())).toBe(false);
  });
});

describe("ENTITY_OWNED — exact ownership", () => {
  const req = { kind: "ENTITY_OWNED", entityId: IDS.entityA };

  it("owned / not owned / duplicate ids / UUID case", () => {
    expect(sat(req, { ownedEntityIds: [IDS.entityB, IDS.entityA] })).toBe(true);
    expect(sat(req, { ownedEntityIds: [IDS.entityB] })).toBe(false);
    expect(sat(req, { ownedEntityIds: [IDS.entityA, IDS.entityA.toUpperCase()] })).toBe(true);
    expect(sat({ kind: "ENTITY_OWNED", entityId: IDS.entityA.toUpperCase() }, { ownedEntityIds: [IDS.entityA] })).toBe(true);
  });

  it("M4-I62: ownership collection absent → invalid; supplied and empty → valid false", () => {
    expect(codes(evaluateRequirement(req, {}))).toEqual(["REQUIREMENT.MISSING_FACT"]);
    expect(codes(evaluateRequirement(req, { ownedEntityIds: null }))).toEqual(["REQUIREMENT.MISSING_FACT"]);
    expect(sat(req, { ownedEntityIds: [] })).toBe(false);
  });

  it("identity is the Entity id only — never a canonical key or name", () => {
    expect(codes(evaluateRequirement({ kind: "ENTITY_OWNED", entityId: "rule.example" }, { ownedEntityIds: [] }))).toEqual(["REQUIREMENT.INVALID_DEFINITION"]);
    expect(codes(evaluateRequirement(req, { ownedEntityIds: ["rule.example"] }))).toEqual(["REQUIREMENT.INVALID_FACTS"]);
  });
});

describe("M4-I63 provenance", () => {
  const reqProv = { entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", rulesetId: null, manifestId: null };
  const factProv = { entityId: IDS.entityB, entityVersionId: null, canonicalKey: null, rulesetId: null, manifestId: null };

  it("requirement provenance and fact provenance are kept distinct in the outcome; the node's is on its trace step", () => {
    const r = evaluateRequirement(
      { kind: "ALL", provenance: reqProv, children: [{ kind: "RANK_AT_LEAST", factKey: "skill.arcana", requiredRankKey: "expert", requiredOrder: 2, provenance: reqProv }] },
      { ranks: [{ key: "skill.arcana", rankKey: "master", order: 3, provenance: factProv }] },
    );
    const outcome = ok(r).outcome as RequirementGroupOutcome;
    expect(outcome.provenance).toEqual(reqProv);
    expect(outcome.children[0]).toMatchObject({ provenance: reqProv, factProvenance: factProv });
    expect(flattenTrace(r.trace)[1]?.provenance).toEqual(reqProv);
  });

  it("provenance appears only where supplied", () => {
    const leaf = ok(evaluateRequirement(T, BASE)).outcome as RequirementLeafOutcome;
    expect([leaf.provenance, leaf.factProvenance]).toEqual([null, null]);
  });

  it("an exact RulesetContext is recorded as response provenance and never searched", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    expect(evaluateRequirement(T, BASE, { ruleset: ctx.value }).ruleset?.rulesetId).toBe(IDS.ruleset);
  });
});

describe("trace mirrors the authored tree", () => {
  it("ALL(level >= 5, Keyword Fire) — authored order, child.N keys, facts and results as data", () => {
    const r = evaluateRequirement(
      { kind: "ALL", children: [{ kind: "NUMERIC_COMPARE", factKey: "actor.level", operator: ">=", expected: 5 }, { kind: "KEYWORD_PRESENT", keywordId: KW.fire.keywordId }] },
      { numeric: [{ key: "actor.level", value: 7 }], keywords: keywordSet(KW.fire) },
    );
    expect(flattenTrace(r.trace).map((s) => [s.path, s.key, s.operation, s.output])).toEqual([
      ["1", "requirement", "requirement.all", { type: "BOOLEAN", value: true }],
      ["1.1", "child.0", "requirement.numeric_compare", { type: "BOOLEAN", value: true }],
      ["1.2", "child.1", "requirement.keyword_present", { type: "BOOLEAN", value: true }],
    ]);
    expect(flattenTrace(r.trace)[1]?.inputs.map((i) => i.name)).toEqual(["fact_key", "actual", "operator", "expected"]);
  });

  it("a false requirement has an ordinary trace (no error, no warning)", () => {
    const r = evaluateRequirement({ kind: "RANK_AT_LEAST", factKey: "s", requiredRankKey: "expert", requiredOrder: 2 }, { ranks: [{ key: "s", rankKey: "trained", order: 1 }] });
    expect([r.status, r.warnings.length, r.trace.steps[0]?.output]).toEqual(["SUCCESS", 0, { type: "BOOLEAN", value: false }]);
  });

  it("the outcome is proportional to the tree — the facts are never copied into it", () => {
    const facts = { numeric: Array.from({ length: 500 }, (_, i) => ({ key: `f${i}`, value: i })) };
    expect(JSON.stringify(ok(evaluateRequirement({ kind: "NUMERIC_COMPARE", factKey: "f7", operator: "==", expected: 7 }, facts)).outcome).length).toBeLessThan(300);
  });
});

describe("M4-I59 / M4-I60 / M4-I61 read-only, deterministic, immutable", () => {
  const requirement = {
    kind: "ALL",
    children: [
      { kind: "NUMERIC_COMPARE", factKey: "actor.level", operator: ">=", expected: 5 },
      { kind: "ANY", children: [{ kind: "ENTITY_OWNED", entityId: IDS.entityA }, { kind: "ENTITY_OWNED", entityId: IDS.entityB }] },
      { kind: "NONE", children: [{ kind: "SET_CONTAINS", factKey: "conditions", member: "blocked" }] },
    ],
  };
  const facts = () => ({
    numeric: [{ key: "actor.level", value: 7 }],
    sets: [{ key: "conditions", members: ["other"] }],
    ownedEntityIds: [IDS.entityB],
    keywords: keywordSet(KW.fire),
  });

  it("same inputs → byte-identical response; requirement, facts and KeywordSet untouched (and frozen during the check)", () => {
    const f = facts();
    const r = assertDeterministic(() => evaluateRequirement(requirement, f), { inputs: [requirement, f], runs: 10 });
    expect(r.data?.satisfied).toBe(true);
  });

  it("fact order never matters; requirement child order is preserved", () => {
    const a = evaluateRequirement(requirement, facts());
    const shuffled = { ...facts(), numeric: [{ key: "z", value: 0 }, { key: "actor.level", value: 7 }], ownedEntityIds: [IDS.entityB, IDS.entityB] };
    const b = evaluateRequirement(requirement, shuffled);
    expect(JSON.stringify(b.data)).toBe(JSON.stringify(a.data));
    expect((a.data?.outcome as RequirementGroupOutcome).children.map((c) => c.kind)).toEqual(["NUMERIC_COMPARE", "ANY", "NONE"]);
  });

  it("results are deep-frozen, detached and serializable; later caller mutation cannot change them", () => {
    const req = { kind: "NUMERIC_COMPARE", factKey: "x", operator: ">=", expected: 1 };
    const f = { numeric: [{ key: "x", value: 3 }] };
    const r = evaluateRequirement(req, f);
    const before = JSON.stringify(r);
    req.expected = 100;
    f.numeric[0]!.value = -5;
    expect(JSON.stringify(r)).toBe(before);
    expect(Object.isFrozen(r.data) && Object.isFrozen((r.data?.outcome as RequirementLeafOutcome).expected)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
