import { describe, expect, it } from "vitest";
import {
  defaultMatcherRegistry,
  editSimilarity,
  entityCatalogHash,
  entityMatcherV1,
  importMatchRunFingerprint,
  MatcherRegistry,
  runMatching,
  type EntityIdentityRecord,
  type MatchCandidateInput,
} from "./matcher.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entity = (n: number, entityType: string, canonicalKey: string, aliases: Array<string | [string, string]> = [], display: string | null = null, version: string | null = null): EntityIdentityRecord => ({
  entityId: id(n),
  entityType,
  canonicalKey,
  aliases: aliases.map((a) => (typeof a === "string" ? { normalizedAlias: a.toLowerCase(), normalizedContext: "" } : { normalizedAlias: a[0].toLowerCase(), normalizedContext: a[1] })),
  comparisonEntityVersionId: version,
  comparisonDisplayLabel: display,
});
let ord = 0;
const cand = (over: Partial<MatchCandidateInput> = {}): MatchCandidateInput => ({ candidateId: id(1000 + ++ord), ordinal: ord, candidateKind: "ENTITY", proposedEntityType: null, proposedCanonicalKey: null, displayLabel: "x", ...over });
const run = (candidates: MatchCandidateInput[], catalog: EntityIdentityRecord[], config = {}) => runMatching(defaultMatcherRegistry, "prowess.entity-matcher", "1", config, candidates, catalog);
const one = (c: MatchCandidateInput, catalog: EntityIdentityRecord[], config = {}) => run([c], catalog, config).output.assessments[0]!;

const ARCANA = entity(1, "RESOURCE", "resource.arcana");
const EMISSION = entity(2, "SPELL_TRAIT", "spell.affinity.emission", ["emission", "evocation"]);
const RES_A = entity(3, "RESOURCE", "resource.resistance", ["resistance"]);
const RES_B = entity(4, "SYSTEM", "system.resistance", ["resistance"]);
const CONC = entity(5, "SYSTEM", "system.concentration", ["concentration"]);

describe("registry", () => {
  it("is exact key + version, with explicit hashed defaults", () => {
    expect(defaultMatcherRegistry.keys()).toEqual(["prowess.entity-matcher@1"]);
    expect(() => runMatching(defaultMatcherRegistry, "prowess.entity-matcher", "2", {}, [], [])).toThrow(/exactly prowess\.entity-matcher@2/);
    expect(() => run([], [], { suggestionThreshold: 2 })).toThrow(/suggestionThreshold/);
    expect(() => run([], [], { bogus: 1 } as never)).toThrow(/accepts exactly/);
    expect(run([], []).config).toEqual({ suggestionThreshold: 0.85, maxSuggestions: 5 });
    expect(run([], [], { maxSuggestions: 3 }).configHash).not.toBe(run([], []).configHash);
  });
});

describe("outcomes", () => {
  it("§55 exact canonical key -> EXACT_MATCH / CANONICAL_KEY_EXACT", () => {
    const a = one(cand({ proposedEntityType: "RESOURCE", proposedCanonicalKey: "resource.arcana", displayLabel: "Arcana" }), [ARCANA, CONC]);
    expect(a).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: ARCANA.entityId, matchedBy: "CANONICAL_KEY_EXACT", normalizedProposedCanonicalKey: "resource.arcana", normalizedCandidateLabel: "arcana" });
    expect(a.suggestions[0]).toMatchObject({ entityId: ARCANA.entityId, rank: 1, basis: "CANONICAL_KEY_EXACT", score: 1 });
  });

  it("§17 a canonical key owned by an incompatible type is shown but never auto-matched", () => {
    const a = one(cand({ proposedEntityType: "SYSTEM", proposedCanonicalKey: "resource.arcana", displayLabel: "Arcana" }), [ARCANA]);
    expect(a).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedEntityId: null, matchedBy: "CANONICAL_KEY_EXACT" });
  });

  it("§56 an unambiguous, context-free, type-compatible alias -> EXACT_MATCH / ALIAS_EXACT", () => {
    expect(one(cand({ displayLabel: "Evocation" }), [EMISSION, ARCANA])).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: EMISSION.entityId, matchedBy: "ALIAS_EXACT" });
    expect(one(cand({ proposedEntityType: "RESOURCE", displayLabel: "Evocation" }), [EMISSION])).toMatchObject({ outcome: "NO_MATCH" }); // type-incompatible
  });

  it("a context-scoped alias is only a suggestion (the Candidate cannot satisfy the context)", () => {
    const scoped = entity(6, "SYSTEM", "system.focus", [["focus", "combat"]]);
    expect(one(cand({ displayLabel: "Focus" }), [scoped])).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedBy: "ALIAS_EXACT" });
  });

  it("§60 / §61 cross-type collisions: a type hint narrows; no hint stays ambiguous — never an arbitrary pick", () => {
    expect(one(cand({ proposedEntityType: "RESOURCE", displayLabel: "Resistance" }), [RES_A, RES_B])).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: RES_A.entityId });
    const ambiguous = one(cand({ displayLabel: "Resistance" }), [RES_A, RES_B]);
    expect(ambiguous).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedEntityId: null });
    expect(ambiguous.suggestions.map((s) => s.entityId)).toEqual([RES_A.entityId, RES_B.entityId]); // canonical-key order
  });

  it("§58 display-label equality (exact comparison Version only) is POTENTIAL, never EXACT", () => {
    const shown = entity(7, "RESOURCE", "resource.arcana_lore", [], "Arcana", id(70));
    const a = one(cand({ displayLabel: "Arcana" }), [shown]);
    expect(a).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedBy: "DISPLAY_LABEL_EXACT" });
    expect(a.suggestions[0]).toMatchObject({ basis: "DISPLAY_LABEL_EXACT", comparisonEntityVersionId: id(70) });
    expect(one(cand({ displayLabel: "  ARCANA " }), [shown])).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedBy: "NORMALIZED_LABEL" });
  });

  it("§59 fuzzy typo -> POTENTIAL suggestion with an advisory score, never EXACT", () => {
    const a = one(cand({ displayLabel: "Concentraton" }), [CONC]);
    expect(a).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedBy: "FUZZY_LABEL", matchedEntityId: null });
    expect(a.suggestions[0]!.score).toBeCloseTo(12 / 13, 5);
    expect(one(cand({ displayLabel: "Totally different" }), [CONC]).outcome).toBe("NO_MATCH");
  });

  it("§62 a valid key + type with nothing matching -> NO_MATCH", () => {
    expect(one(cand({ proposedEntityType: "RESOURCE", proposedCanonicalKey: "resource.unknown", displayLabel: "Unknownium" }), [ARCANA, CONC])).toMatchObject({ outcome: "NO_MATCH", matchedBy: "NONE", suggestions: [] });
  });

  it("§63 no key and no usable label -> INSUFFICIENT_IDENTITY; an ENTITY_FIELD with only a type hint too", () => {
    expect(one(cand({ displayLabel: "—" }), [ARCANA]).outcome).toBe("INSUFFICIENT_IDENTITY");
    expect(one(cand({ candidateKind: "ENTITY_FIELD", proposedEntityType: "RESOURCE", displayLabel: "Arcana" }), [ARCANA]).outcome).toBe("INSUFFICIENT_IDENTITY");
    expect(one(cand({ candidateKind: "ENTITY_FIELD", proposedCanonicalKey: "resource.arcana", displayLabel: "cost" }), [ARCANA]).outcome).toBe("EXACT_MATCH");
  });

  it("§14 / §64 structural candidates are NOT_APPLICABLE even when their label equals an alias", () => {
    for (const kind of ["UNKNOWN", "REFERENCE", "FORMULA", "REQUIREMENT", "KEYWORD", "RELATIONSHIP"] as const) {
      expect(one(cand({ candidateKind: kind, displayLabel: "Evocation" }), [EMISSION])).toMatchObject({ outcome: "NOT_APPLICABLE", normalizedCandidateLabel: null, suggestions: [] });
    }
    expect(one(cand({ candidateKind: "ENTITY_FIELD", displayLabel: "Evocation" }), [EMISSION]).outcome).toBe("NOT_APPLICABLE");
  });

  it("suggestions are capped and totally ordered (basis, score, canonical key, id)", () => {
    const many = Array.from({ length: 8 }, (_, i) => entity(100 + i, "SYSTEM", `system.thing_${8 - i}`, ["thing"]));
    const a = one(cand({ displayLabel: "Thing" }), many, { maxSuggestions: 5 });
    expect(a.suggestions.length).toBe(5);
    expect(a.suggestions.map((s) => many.find((m) => m.entityId === s.entityId)!.canonicalKey)).toEqual(["system.thing_1", "system.thing_2", "system.thing_3", "system.thing_4", "system.thing_5"]);
  });
});

describe("§57 locale independence (Turkish dotted/dotless I)", () => {
  it("results do not change when the host's locale lowercasing is Turkish", () => {
    const iris = entity(9, "SYSTEM", "system.iris", ["iris"]);
    const candidates = [cand({ displayLabel: "IRIS" })];
    const base = run(candidates, [iris]);
    const original = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = function (this: string) {
      return original.call(this, "tr-TR");
    } as typeof String.prototype.toLocaleLowerCase;
    try {
      expect("I".toLocaleLowerCase()).toBe("ı");
      const turkish = run(candidates, [iris]);
      expect(turkish.resultHash).toBe(base.resultHash);
      expect(turkish.output.assessments[0]).toMatchObject({ outcome: "EXACT_MATCH", normalizedCandidateLabel: "iris" });
    } finally {
      String.prototype.toLocaleLowerCase = original;
    }
  });
});

describe("duplicate groups", () => {
  it("§68 same type + key groups distinct candidates (ordinal order); none is dropped", () => {
    const a = cand({ proposedEntityType: "RESOURCE", proposedCanonicalKey: "resource.arcana", displayLabel: "Arcana" });
    const b = cand({ proposedEntityType: "RESOURCE", proposedCanonicalKey: "resource.arcana", displayLabel: "Arcana (again)" });
    const r = run([b, a], [ARCANA]);
    expect(r.output.duplicateGroups).toEqual([{ basis: "PROPOSED_CANONICAL_KEY", identityKey: "RESOURCE|resource.arcana", memberCandidateIds: [a.candidateId, b.candidateId] }]);
    expect(r.output.assessments.length).toBe(2);
  });

  it("§69 / §70 normalized-label groups need the same type; cross-type and type-less labels are not grouped", () => {
    const x = cand({ proposedEntityType: "SPELL_EFFECT", displayLabel: "Direct Damage" });
    const y = cand({ proposedEntityType: "SPELL_EFFECT", displayLabel: " direct   damage " });
    const z = cand({ proposedEntityType: "SYSTEM", displayLabel: "Direct Damage" });
    const w = cand({ displayLabel: "Direct Damage" });
    const s = cand({ candidateKind: "UNKNOWN", displayLabel: "Direct Damage" });
    expect(run([x, y, z, w, s], []).output.duplicateGroups).toEqual([{ basis: "NORMALIZED_LABEL", identityKey: "SPELL_EFFECT|direct damage", memberCandidateIds: [x.candidateId, y.candidateId] }]);
  });
});

describe("determinism and hashes", () => {
  it("§75 catalog / candidate input order never changes the catalog hash, fingerprint or result", () => {
    const catalog = [ARCANA, EMISSION, RES_A, RES_B, CONC];
    const candidates = [cand({ displayLabel: "Resistance" }), cand({ displayLabel: "Evocation" }), cand({ displayLabel: "Concentraton" })];
    const a = run(candidates, catalog);
    const b = run([...candidates].reverse(), [...catalog].reverse().map((e) => ({ ...e, aliases: [...e.aliases].reverse() })));
    expect(b.catalogHash).toBe(a.catalogHash);
    expect(b.resultHash).toBe(a.resultHash);
    expect(b.output).toEqual(a.output);
  });

  it("any consulted identity change changes the catalog hash (alias, context, type, key, comparison version, display)", () => {
    const h = entityCatalogHash([ARCANA]);
    for (const changed of [{ ...ARCANA, aliases: [{ normalizedAlias: "lore", normalizedContext: "" }] }, { ...ARCANA, entityType: "SYSTEM" }, { ...ARCANA, canonicalKey: "resource.arcana2" }, { ...ARCANA, comparisonEntityVersionId: id(9), comparisonDisplayLabel: "Arcana" }]) {
      expect(entityCatalogHash([changed])).not.toBe(h);
    }
  });

  it("the run fingerprint covers every context field", () => {
    const base = { importBatchId: id(1), candidateSetHash: "a".repeat(64), entityCatalogHash: "b".repeat(64), comparisonManifestId: null, matcherKey: "prowess.entity-matcher", matcherVersion: "1", matcherConfigHash: "c".repeat(64) };
    const f = importMatchRunFingerprint(base);
    for (const over of [{ candidateSetHash: "d".repeat(64) }, { entityCatalogHash: "d".repeat(64) }, { comparisonManifestId: id(2) }, { matcherVersion: "2" }, { matcherConfigHash: "d".repeat(64) }]) {
      expect(importMatchRunFingerprint({ ...base, ...over })).not.toBe(f);
    }
  });

  it("editSimilarity is normalized Levenshtein", () => {
    expect(editSimilarity("abc", "abc")).toBe(1);
    expect(editSimilarity("kitten", "sitting")).toBeCloseTo(1 - 3 / 7, 5);
  });
});

describe("output validation", () => {
  const reg = (mutate: (o: ReturnType<typeof entityMatcherV1.match>) => unknown) => new MatcherRegistry([{ ...entityMatcherV1, match: (i) => mutate(entityMatcherV1.match(i)) as never }]);
  const attempt = (r: MatcherRegistry) => () => runMatching(r, "prowess.entity-matcher", "1", {}, [cand({ displayLabel: "Concentraton" })], [CONC]);
  it.each([
    ["fuzzy promoted to EXACT", (o: ReturnType<typeof entityMatcherV1.match>) => ({ ...o, assessments: o.assessments.map((a) => ({ ...a, outcome: "EXACT_MATCH", matchedEntityId: CONC.entityId })) })],
    ["missing assessment", (o: ReturnType<typeof entityMatcherV1.match>) => ({ ...o, assessments: [] })],
    ["unknown entity", (o: ReturnType<typeof entityMatcherV1.match>) => ({ ...o, assessments: o.assessments.map((a) => ({ ...a, suggestions: [{ ...a.suggestions[0]!, entityId: id(999) }] })) })],
    ["score out of range", (o: ReturnType<typeof entityMatcherV1.match>) => ({ ...o, assessments: o.assessments.map((a) => ({ ...a, suggestions: [{ ...a.suggestions[0]!, score: 1.5 }] })) })],
    ["thrown", () => { throw new Error("boom"); }],
  ])("rejects %s as INVALID_MATCHER_OUTPUT", (_n, mutate) => {
    expect(attempt(reg(mutate as never))).toThrow(expect.objectContaining({ kind: "INVALID_MATCHER_OUTPUT" }) as unknown as Error);
  });
});
