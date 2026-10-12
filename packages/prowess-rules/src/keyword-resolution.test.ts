import { describe, expect, it } from "vitest";
import {
  createRulesetContext,
  findResolvedKeywordByCanonicalKey,
  findResolvedKeywordById,
  flattenTrace,
  hasKeywordByCanonicalKey,
  hasKeywordById,
  resolveKeywords,
  type ResolvedKeywordSet,
  type RuleEngineResponse,
} from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { IDS, rulesetInput } from "./testing/fixtures.js";

/**
 * M4-WO4 Keyword Resolution. Guards M4-I40 (Keywords Are Metadata / Rule Hooks Only), M4-I41 (Keyword Identity Is
 * Exact), M4-I42 (Keyword Aggregation Is Deterministic), M4-I43 (Duplicate Contributions Preserve Provenance), M4-I44
 * (Keywords Have No Implicit Mechanics), M4-I45 (Keyword Lookup Uses No Alias / Fuzzy Matching), M4-I46 (Keyword
 * Categories Grant No Mechanics), M4-I47 (Keyword Resolution Is Read-Only), M4-I48 (Keyword Inputs / Results Are
 * Immutable), M4-I49 (Keyword Provenance Is Preserved) and M4-I50 (Keyword Resolution Is Locale-Independent).
 *
 * Prowess-shaped Keyword names below are test data only; the engine attaches no meaning to them.
 */
const K = {
  fire: { keywordId: "60000000-0000-4000-8000-000000000001", canonicalKey: "keyword.fire", categoryId: "70000000-0000-4000-8000-000000000001" },
  damage: { keywordId: "60000000-0000-4000-8000-000000000002", canonicalKey: "keyword.damage", categoryId: "70000000-0000-4000-8000-000000000002" },
  zone: { keywordId: "60000000-0000-4000-8000-000000000003", canonicalKey: "keyword.zone", categoryId: null },
  elemental: { keywordId: "60000000-0000-4000-8000-000000000004", canonicalKey: "keyword.elemental", categoryId: "70000000-0000-4000-8000-000000000001" },
};
const src = (sourceKey: string, sourceType = "test.source", extra: Record<string, unknown> = {}) => ({ sourceType, sourceKey, ...extra });
const c = (keyword: (typeof K)[keyof typeof K], source: ReturnType<typeof src>, ordinal?: number) => ({ keyword: { ...keyword }, source, ...(ordinal === undefined ? {} : { ordinal }) });

const set = (r: RuleEngineResponse<ResolvedKeywordSet>): ResolvedKeywordSet => {
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.data as ResolvedKeywordSet;
};
const codes = (r: RuleEngineResponse<ResolvedKeywordSet>) => r.errors.map((e) => e.code);
const keys = (s: ResolvedKeywordSet) => s.keywords.map((k) => k.keyword.canonicalKey);
const contributors = (s: ResolvedKeywordSet, canonicalKey: string) => findResolvedKeywordByCanonicalKey(s, canonicalKey)?.contributors.map((x) => x.source.sourceKey);

describe("aggregation and deduplication", () => {
  it("an empty contribution list is a valid empty set", () => {
    const r = resolveKeywords([]);
    expect([r.status, r.data]).toEqual(["SUCCESS", { keywords: [] }]);
  });

  it("one Keyword from one source", () => {
    expect(set(resolveKeywords([c(K.fire, src("a"))]))).toEqual({
      keywords: [{ keyword: K.fire, contributors: [{ source: { sourceType: "test.source", sourceKey: "a", sourceId: null, provenance: null }, ordinal: null }] }],
    });
  });

  it("M4-I43: Source A → Fire, Source B → Fire, Source C → Damage resolves Fire once with BOTH contributors", () => {
    const s = set(resolveKeywords([c(K.fire, src("source-a")), c(K.fire, src("source-b")), c(K.damage, src("source-c"))]));
    expect(keys(s)).toEqual(["keyword.damage", "keyword.fire"]);
    expect(contributors(s, "keyword.fire")).toEqual(["source-a", "source-b"]);
    expect(contributors(s, "keyword.damage")).toEqual(["source-c"]);
  });

  it("an identical contribution repeated collapses into one contributor (policy A)", () => {
    const s = set(resolveKeywords([c(K.fire, src("a")), c(K.fire, src("a")), c(K.fire, src("a"))]));
    expect(s.keywords).toHaveLength(1);
    expect(contributors(s, "keyword.fire")).toEqual(["a"]);
  });

  it("source identity is (sourceType, sourceKey): the same key under two types is two sources", () => {
    const s = set(resolveKeywords([c(K.fire, src("e1", "test.effect")), c(K.fire, src("e1", "test.trait"))]));
    expect(findResolvedKeywordByCanonicalKey(s, "keyword.fire")?.contributors.map((x) => x.source.sourceType)).toEqual(["test.effect", "test.trait"]);
  });
});

describe("M4-I41 exact identity — conflicts fail closed, never silently resolved", () => {
  it("one keywordId with two canonical keys", () => {
    const r = resolveKeywords([c(K.fire, src("a")), c({ ...K.fire, canonicalKey: "keyword.cold" }, src("b"))]);
    expect([r.status, r.data]).toEqual(["INVALID", null]);
    expect(codes(r)).toEqual(["KEYWORD_RESOLUTION.IDENTITY_CONFLICT"]);
    expect(r.errors[0]?.details).toMatchObject({ keywordId: K.fire.keywordId });
  });

  it("M4-I46: one keywordId with two categories (or category vs none) is a conflict — never repaired or inferred", () => {
    expect(codes(resolveKeywords([c(K.fire, src("a")), c({ ...K.fire, categoryId: K.damage.categoryId }, src("b"))]))).toEqual(["KEYWORD_RESOLUTION.IDENTITY_CONFLICT"]);
    expect(codes(resolveKeywords([c(K.fire, src("a")), c({ ...K.fire, categoryId: null }, src("b"))]))).toEqual(["KEYWORD_RESOLUTION.IDENTITY_CONFLICT"]);
  });

  it("two keywordIds claiming one canonical key", () => {
    const r = resolveKeywords([c(K.fire, src("a")), c({ ...K.damage, canonicalKey: "keyword.fire", categoryId: K.fire.categoryId }, src("b"))]);
    expect(codes(r)).toEqual(["KEYWORD_RESOLUTION.CANONICAL_KEY_CONFLICT"]);
    expect(r.errors[0]?.details).toEqual({ canonicalKey: "keyword.fire", keywordIds: [K.fire.keywordId, K.damage.keywordId].sort() });
  });

  it("one source described two ways, or contributing one Keyword with two ordinals, is ambiguous", () => {
    expect(codes(resolveKeywords([c(K.fire, src("a", "test.source", { sourceId: "x1" })), c(K.damage, src("a", "test.source", { sourceId: "x2" }))]))).toEqual([
      "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION",
    ]);
    expect(codes(resolveKeywords([c(K.fire, src("a"), 1), c(K.fire, src("a"), 2)]))).toEqual(["KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"]);
  });

  it("conflict reporting does not depend on input order", () => {
    const list = [c(K.fire, src("a")), c({ ...K.fire, canonicalKey: "keyword.cold" }, src("b")), c(K.damage, src("c")), c({ ...K.damage, canonicalKey: "keyword.zone" }, src("d"))];
    expect(JSON.stringify(resolveKeywords([...list].reverse()).errors)).toBe(JSON.stringify(resolveKeywords(list).errors));
  });
});

describe("malformed input is VALIDATION, never an engine error", () => {
  it.each([
    ["not an array", { keyword: K.fire }, "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["missing keyword id", [{ keyword: { canonicalKey: "keyword.fire", categoryId: null }, source: src("a") }], "KEYWORD_RESOLUTION.INVALID_REFERENCE"],
    ["non-UUID id", [{ keyword: { ...K.fire, keywordId: "fire" }, source: src("a") }], "KEYWORD_RESOLUTION.INVALID_REFERENCE"],
    ["empty canonical key", [{ keyword: { ...K.fire, canonicalKey: "" }, source: src("a") }], "KEYWORD_RESOLUTION.INVALID_REFERENCE"],
    ["display name as key", [{ keyword: { ...K.fire, canonicalKey: "Fire" }, source: src("a") }], "KEYWORD_RESOLUTION.INVALID_REFERENCE"],
    ["single-segment key", [{ keyword: { ...K.fire, canonicalKey: "fire" }, source: src("a") }], "KEYWORD_RESOLUTION.INVALID_REFERENCE"],
    ["bad category id", [{ keyword: { ...K.fire, categoryId: "cat" }, source: src("a") }], "KEYWORD_RESOLUTION.INVALID_REFERENCE"],
    ["extra reference field (name)", [{ keyword: { ...K.fire, name: "Fire" }, source: src("a") }], "KEYWORD_RESOLUTION.INVALID_REFERENCE"],
    ["missing source", [{ keyword: K.fire }], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["bad source type", [c(K.fire, src("a", "Test Source"))], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["blank source key", [c(K.fire, src(" "))], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["negative ordinal", [c(K.fire, src("a"), -1)], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["fractional ordinal", [c(K.fire, src("a"), 1.5)], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["bad provenance", [c(K.fire, src("a", "test.source", { provenance: { entityId: "nope" } }))], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["NaN ordinal", [c(K.fire, src("a"), Number.NaN)], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
    ["a Map", [new Map()], "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"],
  ])("%s", (_label, input, code) => {
    const r = resolveKeywords(input);
    expect(r.status).toBe("INVALID");
    expect(r.errors.every((e) => e.kind === "VALIDATION")).toBe(true);
    expect(codes(r)[0]).toBe(code);
  });

  it("prototype-shaped keys and getters are rejected without ever invoking the getter", () => {
    const polluted = JSON.parse(`[{"keyword": {"keywordId": "${K.fire.keywordId}", "canonicalKey": "keyword.fire", "categoryId": null, "__proto__": {"x": 1}}, "source": {"sourceType": "test.source", "sourceKey": "a"}}]`) as unknown;
    expect(codes(resolveKeywords(polluted))).toEqual(["KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"]);
    let called = false;
    const sneaky = { keyword: K.fire, source: src("a") } as Record<string, unknown>;
    Object.defineProperty(sneaky, "ordinal", { enumerable: true, get: () => ((called = true), 1) });
    expect(codes(resolveKeywords([sneaky]))).toEqual(["KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"]);
    expect(called).toBe(false);
  });
});

describe("M4-I42 / M4-I50 deterministic, locale-independent ordering", () => {
  it("Keywords are ordered by canonical key (UTF-16 code units), whatever the input order", () => {
    const list = [c(K.zone, src("z")), c(K.fire, src("f")), c(K.damage, src("d")), c(K.elemental, src("e"))];
    const a = set(resolveKeywords(list));
    expect(keys(a)).toEqual(["keyword.damage", "keyword.elemental", "keyword.fire", "keyword.zone"]);
    expect(JSON.stringify(set(resolveKeywords([...list].reverse())))).toBe(JSON.stringify(a));
  });

  it("contributors: explicit ordinals first (ascending), then unordered sources by (sourceType, sourceKey)", () => {
    const s = set(resolveKeywords([c(K.fire, src("b")), c(K.fire, src("z"), 2), c(K.fire, src("a")), c(K.fire, src("y"), 0), c(K.fire, src("B"))]));
    expect(contributors(s, "keyword.fire")).toEqual(["y", "z", "B", "a", "b"]);
  });

  it("object property order never matters", () => {
    const reordered = [{ source: { sourceKey: "a", sourceType: "test.source" }, keyword: { categoryId: K.fire.categoryId, canonicalKey: "keyword.fire", keywordId: K.fire.keywordId } }];
    expect(JSON.stringify(set(resolveKeywords(reordered)))).toBe(JSON.stringify(set(resolveKeywords([c(K.fire, src("a"))]))));
  });

  it("upper-case UUIDs are the same identity (M4-WO1 UUID policy); canonical keys are never case-folded", () => {
    const s = set(resolveKeywords([c(K.fire, src("a")), c({ ...K.fire, keywordId: K.fire.keywordId.toUpperCase() }, src("b"))]));
    expect(s.keywords).toHaveLength(1);
    expect(contributors(s, "keyword.fire")).toEqual(["a", "b"]);
  });
});

describe("M4-I45 exact lookup — no alias, display-name, case or fuzzy matching", () => {
  const s = set(resolveKeywords([c(K.fire, src("a")), c(K.damage, src("b")), c(K.zone, src("c"))]));

  it("finds by exact id and exact canonical key", () => {
    expect(findResolvedKeywordById(s, K.damage.keywordId)?.keyword).toEqual(K.damage);
    expect(findResolvedKeywordById(s, K.damage.keywordId.toUpperCase())?.keyword).toEqual(K.damage);
    expect(findResolvedKeywordByCanonicalKey(s, "keyword.zone")?.keyword).toEqual(K.zone);
    expect(hasKeywordById(s, K.fire.keywordId) && hasKeywordByCanonicalKey(s, "keyword.fire")).toBe(true);
  });

  it("absence is explicit null / false", () => {
    expect(findResolvedKeywordById(s, K.elemental.keywordId)).toBeNull();
    expect(hasKeywordByCanonicalKey(s, "keyword.elemental")).toBe(false);
    expect(findResolvedKeywordById(s, "not-a-uuid")).toBeNull();
    expect(findResolvedKeywordByCanonicalKey(s, 7 as unknown as string)).toBeNull();
  });

  it("never matches display names, case changes, prefixes, near-misses or labels", () => {
    for (const probe of ["Fire", "fire", "FIRE", "keyword.FIRE", "Keyword.Fire", "keyword.fir", "keyword.fire_damage", "Fire Damage", "Flame", "keyword", " keyword.fire", "keyword.fire "]) {
      expect(hasKeywordByCanonicalKey(s, probe), probe).toBe(false);
    }
  });

  it("works on the empty set", () => {
    const empty = set(resolveKeywords([]));
    expect([hasKeywordById(empty, K.fire.keywordId), findResolvedKeywordByCanonicalKey(empty, "keyword.fire")]).toEqual([false, null]);
  });
});

describe("M4-I40 / M4-I44 / M4-I46 metadata only — no mechanics, no implication, no stacking", () => {
  it("a category implies nothing: Fire and Elemental share a category but neither implies the other", () => {
    const fireOnly = set(resolveKeywords([c(K.fire, src("a"))]));
    expect(hasKeywordByCanonicalKey(fireOnly, "keyword.elemental")).toBe(false);
    const elementalOnly = set(resolveKeywords([c(K.elemental, src("a"))]));
    expect(hasKeywordByCanonicalKey(elementalOnly, "keyword.fire")).toBe(false);
  });

  it("many contributors never become a stack count, a number or a priority", () => {
    const s = set(resolveKeywords(Array.from({ length: 5 }, (_, i) => c(K.fire, src(`s${i}`)))));
    const entry = findResolvedKeywordByCanonicalKey(s, "keyword.fire");
    expect(Object.keys(entry ?? {}).sort()).toEqual(["contributors", "keyword"]);
    expect(Object.keys(entry?.keyword ?? {}).sort()).toEqual(["canonicalKey", "categoryId", "keywordId"]);
    expect(JSON.stringify(s)).not.toMatch(/"(stack\w*|count|bonus|cost|penalty|duration|range|priority|rank|weight)"/);
  });

  it("there is no removal, negation or suppression input", () => {
    for (const field of ["remove", "negated", "suppress", "immune"]) {
      expect(codes(resolveKeywords([{ ...c(K.fire, src("a")), [field]: true }])), field).toEqual(["KEYWORD_RESOLUTION.INVALID_CONTRIBUTION"]);
    }
  });

  it("a Keyword-shaped name in sourceType or sourceKey changes nothing (sources are generic)", () => {
    const a = set(resolveKeywords([c(K.fire, src("s1", "test.source"))]));
    const b = set(resolveKeywords([c(K.fire, src("s1", "spell.effect"))]));
    expect(a.keywords[0]?.keyword).toEqual(b.keywords[0]?.keyword);
  });
});

describe("M4-I49 provenance", () => {
  const provenance = { entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", rulesetId: null, manifestId: null };

  it("every contributor keeps its source id and provenance — 'why is this Keyword present?' is answerable", () => {
    const s = set(resolveKeywords([c(K.fire, src("effect.e1", "test.effect", { sourceId: "row-17", provenance })), c(K.fire, src("trait.t4", "test.trait"))]));
    expect(findResolvedKeywordByCanonicalKey(s, "keyword.fire")?.contributors).toEqual([
      { source: { sourceType: "test.effect", sourceKey: "effect.e1", sourceId: "row-17", provenance }, ordinal: null },
      { source: { sourceType: "test.trait", sourceKey: "trait.t4", sourceId: null, provenance: null }, ordinal: null },
    ]);
  });

  it("the trace lists Keywords in set order and contributors in contributor order, with provenance on each contributor step", () => {
    const r = resolveKeywords([c(K.fire, src("b")), c(K.damage, src("c")), c(K.fire, src("a", "test.source", { provenance }))]);
    const flat = flattenTrace(r.trace).map((s) => [s.path, s.operation, s.inputs.map((i) => ("value" in i.value ? i.value.value : null)).join("|")]);
    expect(flat).toEqual([
      ["1", "keyword.resolve", ""],
      ["1.1", "keyword.present", `${K.damage.keywordId}|keyword.damage`],
      ["1.1.1", "keyword.contribution", "test.source|c"],
      ["1.2", "keyword.present", `${K.fire.keywordId}|keyword.fire`],
      ["1.2.1", "keyword.contribution", "test.source|a"],
      ["1.2.2", "keyword.contribution", "test.source|b"],
    ]);
    expect(flattenTrace(r.trace)[4]?.provenance).toEqual(provenance);
  });

  it("an exact RulesetContext is recorded, never searched for Keywords", () => {
    const ctx = createRulesetContext(rulesetInput());
    if (!ctx.ok) throw new Error("fixture");
    const r = resolveKeywords([], { ruleset: ctx.value });
    expect([r.data, r.ruleset?.rulesetId]).toEqual([{ keywords: [] }, IDS.ruleset]);
  });

  it("a canonical key longer than a trace key limit still resolves (M1 imposes no length limit)", () => {
    const longKey = `keyword.${"x".repeat(300)}`;
    expect(set(resolveKeywords([c({ ...K.fire, canonicalKey: longKey }, src("a"))])).keywords[0]?.keyword.canonicalKey).toBe(longKey);
  });
});

describe("M4-I47 / M4-I48 read-only, immutable, serializable, deterministic", () => {
  it("same input → byte-identical response across runs; inputs untouched (and frozen during the check)", () => {
    const list = [c(K.fire, src("a")), c(K.damage, src("b"), 3), c(K.fire, src("c"))];
    assertDeterministic(() => resolveKeywords(list), { inputs: [list], runs: 10 });
    const bad = [c(K.fire, src("a")), c({ ...K.fire, canonicalKey: "keyword.cold" }, src("b"))];
    assertDeterministic(() => resolveKeywords(bad), { inputs: [bad], runs: 5 });
  });

  it("results are deep-frozen plain data and detached from the input", () => {
    const list = [c(K.fire, src("a"))];
    const r = resolveKeywords(list);
    const s = set(r);
    expect(Object.isFrozen(s) && Object.isFrozen(s.keywords[0]?.contributors)).toBe(true);
    expect(() => {
      (s.keywords as unknown[]).push({});
    }).toThrow(TypeError);
    expect(s.keywords[0]?.keyword).not.toBe(list[0]?.keyword);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("queries never change the set", () => {
    const s = set(resolveKeywords([c(K.fire, src("a")), c(K.damage, src("b"))]));
    const before = JSON.stringify(s);
    for (let i = 0; i < 20; i += 1) {
      hasKeywordById(s, K.fire.keywordId);
      findResolvedKeywordByCanonicalKey(s, "keyword.damage");
      hasKeywordByCanonicalKey(s, "keyword.none");
    }
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("large-set sanity (no SLA)", () => {
  it("2,000 unique Keywords from 5,000 contributions: deduplicated, ordered, exactly queryable, order-independent", () => {
    const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
    const keyword = (i: number) => ({ keywordId: `80000000-0000-4000-8000-${hex(i, 12)}`, canonicalKey: `keyword.k${String(i).padStart(4, "0")}`, categoryId: null });
    const list = Array.from({ length: 5000 }, (_, i) => ({ keyword: keyword(i % 2000), source: { sourceType: "test.source", sourceKey: `s${i}` } }));
    const s = set(resolveKeywords(list));
    expect(s.keywords).toHaveLength(2000);
    expect(s.keywords.reduce((n, k) => n + k.contributors.length, 0)).toBe(5000);
    expect(keys(s)).toEqual([...keys(s)].sort());
    expect(findResolvedKeywordByCanonicalKey(s, "keyword.k1999")?.contributors.map((x) => x.source.sourceKey)).toEqual(["s1999", "s3999"]);
    expect(hasKeywordById(s, keyword(1234).keywordId)).toBe(true);
    expect(hasKeywordByCanonicalKey(s, "keyword.k2000")).toBe(false);
    expect(JSON.stringify(set(resolveKeywords([...list].reverse())))).toBe(JSON.stringify(s));
  });
});
