import { describe, expect, it } from "vitest";
import { canonicalJson, CanonicalJsonError } from "./canonical-json.js";
import {
  EXTRACTION_CANDIDATE_FINGERPRINT_VERSION,
  extractionCandidateFingerprint,
  extractionCandidateFingerprintPreimage,
  IMPORT_BATCH_FINGERPRINT_VERSION,
  importBatchFingerprint,
  importBatchFingerprintPreimage,
  sha256Hex,
  type ExtractionCandidateFingerprintInput,
  type ImportBatchFingerprintInput,
} from "./fingerprint.js";
import { isAnchorInScope, sectionSubtree } from "./scope.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively, so property insertion order never matters", () => {
    expect(canonicalJson({ name: "Arcana", rank: "Expert" })).toBe(canonicalJson({ rank: "Expert", name: "Arcana" }));
    expect(canonicalJson({ b: { y: 1, x: [{ d: 1, c: 2 }] }, a: null })).toBe('{"a":null,"b":{"x":[{"c":2,"d":1}],"y":1}}');
  });

  it("preserves array order, explicit null, string content and numeric values", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
    expect(canonicalJson({ s: "  Expert\tRank " })).toBe('{"s":"  Expert\\tRank "}');
    expect(canonicalJson({ n: 1.5, m: 10, e: 1e21 })).toBe('{"e":1e+21,"m":10,"n":1.5}');
  });

  it("does no case folding and no Unicode normalization", () => {
    expect(canonicalJson("Arcana")).not.toBe(canonicalJson("arcana"));
    expect(canonicalJson("\u00e9")).not.toBe(canonicalJson("e\u0301"));
  });

  it("sorts keys by code unit, not by locale", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, "\u00e4": 4 })).toBe('{"B":2,"a":3,"b":1,"\u00e4":4}');
  });

  it.each([
    ["NaN", { x: Number.NaN }],
    ["Infinity", { x: Number.POSITIVE_INFINITY }],
    ["undefined value", { x: undefined }],
    ["Date", { x: new Date(0) }],
    ["function", { x: () => 1 }],
    ["bigint", { x: BigInt(1) }],
  ])("rejects %s rather than silently coercing it", (_n, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });
});

const batch = (over: Partial<ImportBatchFingerprintInput> = {}): ImportBatchFingerprintInput => ({
  sourceSnapshotId: "11111111-1111-4111-8111-111111111111",
  sourceStructureHash: "a".repeat(64),
  scopeType: "SNAPSHOT",
  scopeSectionId: null,
  reviewRulesetId: null,
  comparisonManifestId: null,
  extractorKey: "manual-foundation",
  extractorVersion: "1.0",
  extractorConfigHash: null,
  ...over,
});

describe("importBatchFingerprint (PROWESS_IMPORT_BATCH_V1)", () => {
  it("uses the documented, versioned preimage", () => {
    expect(importBatchFingerprintPreimage(batch())).toBe(
      [
        IMPORT_BATCH_FINGERPRINT_VERSION,
        "sourceSnapshot=11111111-1111-4111-8111-111111111111",
        `structureHash=${"a".repeat(64)}`,
        "scopeType=SNAPSHOT",
        "scopeSection=null",
        "reviewRuleset=null",
        "comparisonManifest=null",
        "extractorKey=manual-foundation",
        "extractorVersion=1.0",
        "configHash=null",
      ].join("\n"),
    );
    expect(importBatchFingerprint(batch())).toBe(sha256Hex(importBatchFingerprintPreimage(batch())));
    expect(importBatchFingerprint(batch())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls and UUID letter case", () => {
    expect(importBatchFingerprint(batch({ sourceSnapshotId: "11111111-1111-4111-8111-111111111111".toUpperCase() }))).toBe(importBatchFingerprint(batch()));
  });

  it.each([
    ["snapshot", { sourceSnapshotId: "22222222-2222-4222-8222-222222222222" }],
    ["structure hash", { sourceStructureHash: "b".repeat(64) }],
    ["scope", { scopeType: "SECTION_SUBTREE" as const, scopeSectionId: "33333333-3333-4333-8333-333333333333" }],
    ["review ruleset", { reviewRulesetId: "44444444-4444-4444-8444-444444444444" }],
    ["comparison manifest", { reviewRulesetId: "44444444-4444-4444-8444-444444444444", comparisonManifestId: "55555555-5555-4555-8555-555555555555" }],
    ["extractor key", { extractorKey: "prowess.semantic-extractor" }],
    ["extractor version", { extractorVersion: "1.1" }],
    ["config hash", { extractorConfigHash: "c".repeat(64) }],
  ])("changes when the %s changes", (_n, over) => {
    expect(importBatchFingerprint(batch(over))).not.toBe(importBatchFingerprint(batch()));
  });

  it("refuses a newline that could forge another preimage line", () => {
    expect(() => importBatchFingerprint(batch({ extractorVersion: "1\nconfigHash=x" }))).toThrow();
  });
});

const candidate = (over: Partial<ExtractionCandidateFingerprintInput> = {}): ExtractionCandidateFingerprintInput => ({
  candidateKind: "ENTITY",
  proposedEntityType: null,
  proposedCanonicalKey: null,
  displayLabel: "Arcana",
  confidence: "HIGH",
  payloadSchemaKey: "prowess.test.generic",
  payloadSchemaVersion: 1,
  payload: { name: "Arcana", rank: "Expert" },
  primaryAnchor: { sectionId: "66666666-6666-4666-8666-666666666666", contentNodeId: null },
  supportingAnchors: [],
  ...over,
});

describe("extractionCandidateFingerprint (PROWESS_EXTRACTION_CANDIDATE_V1)", () => {
  it("is versioned and ignores payload key order", () => {
    expect(extractionCandidateFingerprintPreimage(candidate()).startsWith(`${EXTRACTION_CANDIDATE_FINGERPRINT_VERSION}\n{`)).toBe(true);
    expect(extractionCandidateFingerprint(candidate({ payload: { rank: "Expert", name: "Arcana" } }))).toBe(extractionCandidateFingerprint(candidate()));
  });

  it.each([
    ["payload meaning", { payload: { name: "Arcana", rank: "Master" } }],
    ["array order in the payload", { payload: { tiers: ["Trained", "Expert"] } }],
    ["kind", { candidateKind: "UNKNOWN" as const }],
    ["confidence", { confidence: "LOW" as const }],
    ["label", { displayLabel: "Arcana (skill)" }],
    ["schema version", { payloadSchemaVersion: 2 }],
    ["primary anchor", { primaryAnchor: { sectionId: null, contentNodeId: "77777777-7777-4777-8777-777777777777" } }],
    ["supporting anchors", { supportingAnchors: [{ sectionId: null, contentNodeId: "77777777-7777-4777-8777-777777777777", excerpt: null }] }],
  ])("changes when the %s changes", (_n, over) => {
    const o = over as Partial<ExtractionCandidateFingerprintInput>;
    const base = extractionCandidateFingerprint(o.payload && "tiers" in o.payload ? candidate({ payload: { tiers: ["Expert", "Trained"] } }) : candidate());
    expect(extractionCandidateFingerprint(candidate(over))).not.toBe(base);
  });

  it("supporting-anchor order is part of the identity", () => {
    const a = { sectionId: null, contentNodeId: "77777777-7777-4777-8777-777777777777", excerpt: null };
    const b = { sectionId: "88888888-8888-4888-8888-888888888888", contentNodeId: null, excerpt: "x" };
    expect(extractionCandidateFingerprint(candidate({ supportingAnchors: [a, b] }))).not.toBe(extractionCandidateFingerprint(candidate({ supportingAnchors: [b, a] })));
  });
});

describe("scope helpers", () => {
  const sections = [
    { id: "spell", parentSectionId: null },
    { id: "targeting", parentSectionId: "spell" },
    { id: "effects", parentSectionId: "spell" },
    { id: "damage", parentSectionId: "effects" },
    { id: "skills", parentSectionId: null },
  ];

  it("a subtree is the root plus every descendant, and nothing else", () => {
    expect([...sectionSubtree("spell", sections)].sort()).toEqual(["damage", "effects", "spell", "targeting"]);
    expect([...sectionSubtree("skills", sections)]).toEqual(["skills"]);
  });

  it("is cycle-safe", () => {
    expect([...sectionSubtree("a", [{ id: "a", parentSectionId: "b" }, { id: "b", parentSectionId: "a" }])].sort()).toEqual(["a", "b"]);
  });

  it("anchors are in scope only inside the subtree; a SNAPSHOT scope accepts any anchor of the Snapshot", () => {
    const scope = { type: "SECTION_SUBTREE" as const, subtree: sectionSubtree("spell", sections) };
    expect(isAnchorInScope({ kind: "SECTION", sectionId: "damage" }, scope)).toBe(true);
    expect(isAnchorInScope({ kind: "SECTION", sectionId: "skills" }, scope)).toBe(false);
    expect(isAnchorInScope({ kind: "CONTENT_NODE", sectionId: null }, scope)).toBe(false);
    expect(isAnchorInScope({ kind: "CONTENT_NODE", sectionId: null }, { type: "SNAPSHOT" })).toBe(true);
  });
});
