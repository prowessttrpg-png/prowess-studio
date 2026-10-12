import { describe, expect, it } from "vitest";
import { createRulesetContext, findResolvedRule, findResolvedRuleByCanonicalKey, type ContextOutcome, type RulesetContext } from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO2 pure lookups inside an already-resolved RulesetContext (§27–30, §51–54). Guards M4-I21 (One Entity → One
 * Resolved EntityVersion) at the pure-contract level.
 */
function ok<T>(outcome: ContextOutcome<T>): T {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return outcome.value;
}
const context = (): RulesetContext => ok(createRulesetContext(rulesetInput()));

describe("exact lookup by Entity id", () => {
  it("returns the exact reference, and treats UUID case as insignificant", () => {
    expect(findResolvedRule(context(), IDS.entityB)?.entityVersionId).toBe(IDS.versionB);
    expect(findResolvedRule(context(), IDS.entityB.toUpperCase())?.entityVersionId).toBe(IDS.versionB);
  });

  it("an absent Entity is explicitly null — no fallback of any kind", () => {
    expect(findResolvedRule(context(), "40000000-0000-4000-8000-0000000000ff")).toBeNull();
    expect(findResolvedRule(context(), IDS.versionA)).toBeNull(); // a version id is not an entity id
    expect(findResolvedRule(context(), "rule.example")).toBeNull(); // nor is a canonical key
    expect(findResolvedRule(context(), 7 as unknown as string)).toBeNull();
  });
});

describe("exact lookup by canonical key", () => {
  it("returns the exact reference for the exact key", () => {
    const rule = findResolvedRuleByCanonicalKey(context(), "rule.example_b");
    expect(rule).toEqual({
      entityId: IDS.entityB,
      entityVersionId: IDS.versionB,
      canonicalKey: "rule.example_b",
      entityType: "GENERIC_RULE",
      sourceRulesetId: IDS.parentRuleset,
      sourceManifestId: IDS.parentManifest,
    });
  });

  it("never case-folds, trims, prefix-matches or fuzzy-matches", () => {
    for (const near of ["RULE.EXAMPLE", "Rule.Example", " rule.example", "rule.example ", "rule.exampl", "rule", "rule.example.x", "rule_example"]) {
      expect(findResolvedRuleByCanonicalKey(context(), near), near).toBeNull();
    }
  });

  it("never matches a display name, title or alias", () => {
    for (const notAKey of ["Example Rule", "Example", "example", "Example B", "ex-b", IDS.entityA]) {
      expect(findResolvedRuleByCanonicalKey(context(), notAKey), notAKey).toBeNull();
    }
  });

  it("a missing key is explicitly null", () => {
    expect(findResolvedRuleByCanonicalKey(context(), "rule.not_in_this_ruleset")).toBeNull();
    expect(findResolvedRuleByCanonicalKey(context(), null as unknown as string)).toBeNull();
  });
});

describe("lookups are read-only", () => {
  it("repeated lookups leave the context deeply identical and return identical answers", () => {
    const ctx = context();
    const before = JSON.stringify(ctx);
    const answers = assertDeterministic(
      () => [findResolvedRule(ctx, IDS.entityA), findResolvedRuleByCanonicalKey(ctx, "rule.example_b"), findResolvedRuleByCanonicalKey(ctx, "rule.none")],
      { inputs: [ctx], runs: 10 },
    );
    expect(answers[2]).toBeNull();
    expect(JSON.stringify(ctx)).toBe(before);
  });
});

describe("M4-I21 an unambiguous context: one version per Entity, one Entity per canonical key", () => {
  it("rejects two rules sharing a canonical key rather than choosing one", () => {
    const input = rulesetInput();
    input.rules.push({ entityId: "40000000-0000-4000-8000-00000000000c", entityVersionId: "50000000-0000-4000-8000-00000000000c", canonicalKey: "rule.example", entityType: "GENERIC_RULE" } as never);
    const outcome = createRulesetContext(input);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.map((e) => [e.code, e.path])).toEqual([["RULE_ENGINE.INVALID_INPUT", "/rules/2/canonicalKey"]]);
  });

  it("rejects one Entity resolving to two versions", () => {
    const input = rulesetInput();
    input.rules.push({ entityId: IDS.entityA, entityVersionId: "50000000-0000-4000-8000-00000000000d", canonicalKey: "rule.other", entityType: "GENERIC_RULE" } as never);
    expect(createRulesetContext(input).ok).toBe(false);
  });
});
