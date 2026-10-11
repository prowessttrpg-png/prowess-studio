import { describe, expect, it } from "vitest";
import {
  createActorContext,
  createBuildContext,
  createEvaluationRequest,
  createRulesetContext,
  createRuntimeContext,
  findResolvedRule,
  isValidContextKey,
  suppliedContextFamilies,
  type ContextOutcome,
} from "./index.js";
import { actorInput, buildInput, IDS, MANIFEST_HASH, requestInput, rulesetInput, runtimeInput } from "./testing/fixtures.js";

/**
 * M4-WO1 evaluation contexts. Guards M4-I01 (Exact Ruleset Context), M4-I11 (Rule Provenance Preserved),
 * M4-I12 (Engine Does Not Choose Canon), M4-I14 (Listed Cost and Payment Remain Distinct Concepts).
 */
function ok<T>(outcome: ContextOutcome<T>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${JSON.stringify(outcome.errors)}`);
  return outcome.value;
}
function errors<T>(outcome: ContextOutcome<T>) {
  if (outcome.ok) throw new Error("expected errors");
  return outcome.errors.map((e) => ({ code: e.code, path: e.path }));
}

/** Reverses the insertion order of every plain object, recursively (arrays keep their order). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

describe("context keys", () => {
  it.each(["power", "stat.power", "resource.primary", "keyword.fire", "a1_b.c2"])("accepts %s", (key) => expect(isValidContextKey(key)).toBe(true));
  it.each(["", "Stat.Power", "stat..power", ".stat", "stat.", "stat power", "__proto__", "constructor", "prototype", 7, null])("rejects %s", (key) =>
    expect(isValidContextKey(key)).toBe(false),
  );
});

describe("M4-I01 RulesetContext is exact, supplied and structurally validated", () => {
  it("normalizes a valid context: rules sorted by entityId, hash kept verbatim, provenance kept", () => {
    const ctx = ok(createRulesetContext(rulesetInput()));
    expect(ctx.rulesetId).toBe(IDS.ruleset);
    expect(ctx.manifestId).toBe(IDS.manifest);
    expect(ctx.manifestHash).toBe(MANIFEST_HASH);
    expect(ctx.release).toEqual({ releaseId: IDS.release, releaseNumber: 3, versionLabel: "Example 3" });
    expect(ctx.rules.map((r) => r.entityId)).toEqual([IDS.entityA, IDS.entityB]);
    expect(ctx.rules[1]).toEqual({
      entityId: IDS.entityB,
      entityVersionId: IDS.versionB,
      canonicalKey: "rule.example_b",
      entityType: "GENERIC_RULE",
      sourceRulesetId: IDS.parentRuleset,
      sourceManifestId: IDS.parentManifest,
    });
    expect(ctx.rules[0]?.sourceManifestId).toBeNull();
  });

  it("needs only the exact ruleset and manifest ids; everything else defaults to absent/empty", () => {
    const ctx = ok(createRulesetContext({ rulesetId: IDS.ruleset, manifestId: IDS.manifest }));
    expect(ctx).toEqual({ rulesetId: IDS.ruleset, manifestId: IDS.manifest, manifestHash: null, rulesetVersionLabel: null, release: null, rules: [] });
  });

  it("lowercases UUIDs (case-insensitive identity) but never alters the manifest hash", () => {
    const ctx = ok(createRulesetContext({ rulesetId: IDS.ruleset.toUpperCase(), manifestId: IDS.manifest, manifestHash: MANIFEST_HASH }));
    expect(ctx.rulesetId).toBe(IDS.ruleset);
    expect(errors(createRulesetContext({ rulesetId: IDS.ruleset, manifestId: IDS.manifest, manifestHash: MANIFEST_HASH.toUpperCase() }))).toEqual([
      { code: "RULE_ENGINE.INVALID_INPUT", path: "/manifestHash" },
    ]);
  });

  it("rejects one Entity resolving to two Versions, and a duplicated Version", () => {
    const input = rulesetInput();
    input.rules.push({ ...input.rules[1], entityVersionId: IDS.versionB.replace("b", "c") } as never);
    expect(errors(createRulesetContext(input))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/rules/2/entityId" }]);
    const dupVersion = rulesetInput();
    dupVersion.rules.push({ entityId: IDS.entityB.replace("b", "c"), entityVersionId: IDS.versionA, canonicalKey: "rule.other", entityType: "GENERIC_RULE" } as never);
    expect(errors(createRulesetContext(dupVersion))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/rules/2/entityVersionId" }]);
  });

  it("reports every structural problem at once, in walk order", () => {
    const result = errors(
      createRulesetContext({ rulesetId: "nope", manifestId: IDS.manifest, rules: [{ entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "Not A Key", entityType: "NOPE" }] }),
    );
    expect(result).toEqual([
      { code: "RULE_ENGINE.INVALID_INPUT", path: "/rulesetId" },
      { code: "RULE_ENGINE.INVALID_INPUT", path: "/rules/0/canonicalKey" },
      { code: "RULE_ENGINE.INVALID_INPUT", path: "/rules/0/entityType" },
    ]);
  });

  it("finds a resolved rule by immutable entity id only", () => {
    const ctx = ok(createRulesetContext(rulesetInput()));
    expect(findResolvedRule(ctx, IDS.entityA.toUpperCase())?.entityVersionId).toBe(IDS.versionA);
    expect(findResolvedRule(ctx, "rule.example")).toBeNull();
  });
});

describe("M4-I12 the RulesetContext carries no governance decision the engine could make or change", () => {
  it("has no Canon / authority / status / latest field, and rejects one if supplied", () => {
    const ctx = ok(createRulesetContext(rulesetInput()));
    expect(Object.keys(ctx).sort()).toEqual(["manifestHash", "manifestId", "release", "rules", "rulesetId", "rulesetVersionLabel"]);
    for (const field of ["isCanon", "authority", "status", "latest", "current"]) {
      expect(errors(createRulesetContext({ ...rulesetInput(), [field]: true }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: `/${field}` }]);
    }
  });
});

describe("M4-I11 rule provenance survives normalization", () => {
  it("keeps entity, version, canonical key, type and source ruleset/manifest for every rule", () => {
    const ctx = ok(createRulesetContext(rulesetInput()));
    expect(ctx.rules.map((r) => [r.entityId, r.entityVersionId, r.canonicalKey, r.sourceRulesetId, r.sourceManifestId])).toEqual([
      [IDS.entityA, IDS.versionA, "rule.example", null, null],
      [IDS.entityB, IDS.versionB, "rule.example_b", IDS.parentRuleset, IDS.parentManifest],
    ]);
  });
});

describe("Actor / Build / Runtime contexts are generic, independently constructible containers", () => {
  it("an empty actor and runtime are valid; a build needs only its kind", () => {
    expect(ok(createActorContext())).toEqual({ actorRef: null, stats: {}, ranks: {}, keywords: [], resources: {}, ownedEntities: [], properties: {}, tags: [] });
    expect(ok(createRuntimeContext())).toEqual({ resourceValues: {}, reservedCapacity: {}, activeEffects: [], conditions: [], state: {} });
    expect(ok(createBuildContext({ buildKind: "example.build" }))).toEqual({
      buildKind: "example.build",
      components: [],
      parameters: {},
      keywords: [],
      properties: {},
      references: [],
    });
    expect(errors(createBuildContext({}))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/buildKind" }]);
  });

  it("normalizes sets (sorted) but preserves explicitly ordered lists", () => {
    const actor = ok(createActorContext(actorInput()));
    expect(actor.keywords).toEqual(["keyword.air", "keyword.fire"]);
    const build = ok(createBuildContext(buildInput()));
    expect(build.components.map((c) => c.key)).toEqual(["component.second", "component.first"]);
    expect(build.components[1]).toEqual({ key: "component.first", reference: null, parameters: {} });
  });

  it("rejects duplicate set members and duplicate keys in ordered lists", () => {
    expect(errors(createActorContext({ keywords: ["keyword.fire", "keyword.fire"] }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/keywords/1" }]);
    expect(errors(createBuildContext({ buildKind: "example.build", components: [{ key: "component.a" }, { key: "component.a" }] }))).toEqual([
      { code: "RULE_ENGINE.INVALID_INPUT", path: "/components/1/key" },
    ]);
    const ref = { entityId: IDS.entityA, entityVersionId: IDS.versionA };
    expect(errors(createActorContext({ ownedEntities: [ref, { ...ref }] }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/ownedEntities/1" }]);
  });

  it("rejects non-finite numbers with their own code, at their exact path", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(errors(createActorContext({ stats: { "stat.power": bad } }))).toEqual([{ code: "RULE_ENGINE.NON_FINITE_NUMBER", path: "/stats/stat.power" }]);
      expect(errors(createRuntimeContext({ state: { "state.x": bad } }))).toEqual([{ code: "RULE_ENGINE.NON_FINITE_NUMBER", path: "/state/state.x" }]);
    }
  });

  it("normalizes -0 to 0 so in-memory and serialized forms agree", () => {
    const actor = ok(createActorContext({ stats: { "stat.power": -0 } }));
    expect(Object.is(actor.stats["stat.power"], 0)).toBe(true);
  });

  it("rejects unknown fields, malformed keys, prototype keys and non-plain values", () => {
    expect(errors(createActorContext({ strength: 3 }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/strength" }]);
    expect(errors(createActorContext({ stats: { "Stat Power": 1 } }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/stats/Stat Power" }]);
    expect(errors(createActorContext(JSON.parse('{"stats": {"__proto__": 1}}')))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/stats/__proto__" }]);
    expect(errors(createActorContext({ stats: new Map([["stat.power", 1]]) }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/stats" }]);
    expect(errors(createActorContext({ properties: { "property.x": { nested: true } } }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/properties/property.x" }]);
    expect(errors(createActorContext(null))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "" }]);
  });

  it("M4-I14: actor resource values and runtime CURRENT values are separate slots, and no context has a merged effective-cost field", () => {
    const actor = ok(createActorContext(actorInput()));
    const runtime = ok(createRuntimeContext(runtimeInput()));
    expect(actor.resources["resource.primary"]).toBe(17);
    expect(runtime.resourceValues["resource.primary"]).toBe(9);
    const allKeys = JSON.stringify([actor, runtime, ok(createBuildContext(buildInput())), ok(createRulesetContext(rulesetInput()))]);
    expect(allKeys).not.toMatch(/effectiveCost|effective_cost|paidCost|payment/i);
    expect(errors(createBuildContext({ buildKind: "example.build", effectiveCost: 3 }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/effectiveCost" }]);
  });
});

describe("context order independence (semantically unordered data)", () => {
  it("object insertion order and set order never change a normalized context or request", () => {
    const a = ok(createEvaluationRequest(requestInput()));
    const reversed = reverseKeys(requestInput()) as ReturnType<typeof requestInput>;
    reversed.actor.keywords.reverse();
    reversed.actor.tags.reverse();
    reversed.ruleset.rules.reverse();
    const b = ok(createEvaluationRequest(reversed));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("but explicitly ordered lists keep their meaning: reordering components changes the context", () => {
    const swapped = buildInput();
    swapped.components.reverse();
    expect(JSON.stringify(ok(createBuildContext(swapped)))).not.toBe(JSON.stringify(ok(createBuildContext(buildInput()))));
  });
});

describe("evaluation request", () => {
  it("absent families are explicit null; omitted and null mean the same thing", () => {
    const req = ok(createEvaluationRequest({ kind: "example.noop", actor: null }));
    expect(req).toEqual({ contractVersion: 1, kind: "example.noop", ruleset: null, actor: null, build: null, runtime: null, metadata: {} });
    expect(suppliedContextFamilies(req)).toEqual([]);
    expect(suppliedContextFamilies(ok(createEvaluationRequest(requestInput())))).toEqual(["RULESET", "ACTOR", "BUILD", "RUNTIME"]);
  });

  it("prefixes nested problems with the family path, and rejects non-plain or non-finite metadata", () => {
    expect(errors(createEvaluationRequest({ kind: "example.noop", actor: { stats: { "stat.power": Number.NaN } } }))).toEqual([
      { code: "RULE_ENGINE.NON_FINITE_NUMBER", path: "/actor/stats/stat.power" },
    ]);
    expect(errors(createEvaluationRequest({ kind: "example.noop", metadata: { at: new Date(0) } }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/metadata/at" }]);
    expect(errors(createEvaluationRequest({ kind: "example.noop", metadata: { n: Number.POSITIVE_INFINITY } }))).toEqual([
      { code: "RULE_ENGINE.NON_FINITE_NUMBER", path: "/metadata/n" },
    ]);
  });

  it("rejects a missing or malformed kind and a foreign contract version", () => {
    expect(errors(createEvaluationRequest({}))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/kind" }]);
    expect(errors(createEvaluationRequest({ kind: "Example" }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/kind" }]);
    expect(errors(createEvaluationRequest({ kind: "example.noop", contractVersion: 2 }))).toEqual([{ code: "RULE_ENGINE.INVALID_INPUT", path: "/contractVersion" }]);
  });

  it("normalized contexts and requests are deep-frozen, detached copies of the caller's input", () => {
    const input = requestInput();
    const req = ok(createEvaluationRequest(input));
    expect(Object.isFrozen(req)).toBe(true);
    expect(Object.isFrozen(req.actor?.stats)).toBe(true);
    expect(Object.isFrozen(req.ruleset?.rules[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(req.actor?.stats).not.toBe(input.actor.stats);
    expect(req.metadata).not.toBe(input.metadata);
  });

  it("construction never throws on hostile input", () => {
    for (const bad of [undefined, null, 1, "x", [], () => 1, Symbol("x"), new Date(0)]) {
      expect(() => createEvaluationRequest(bad)).not.toThrow();
      expect(createEvaluationRequest(bad).ok).toBe(false);
    }
  });
});
