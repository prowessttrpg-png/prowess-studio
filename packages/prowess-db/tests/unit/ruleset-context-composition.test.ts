import { DomainError, RULESET_RESOLUTION_ERROR_CODES } from "@prowess/model";
import { describe, expect, it } from "vitest";
import { buildRulesetContextFromComposition, type CompositionInput } from "../../src/ruleset-context/composition";

/**
 * M4-WO2: the database-free final step of exact Ruleset resolution. Guards M4-I21 (One Entity → One Resolved
 * EntityVersion) and the fail-closed composition checks behind the database's own constraints (§21, §25, §26, §85).
 */
const R = "10000000-0000-4000-8000-000000000001";
const PARENT_R = "10000000-0000-4000-8000-000000000002";
const M = "20000000-0000-4000-8000-000000000001";
const PARENT_M = "20000000-0000-4000-8000-000000000002";
const E = (n: string) => `40000000-0000-4000-8000-0000000000${n}`;
const V = (n: string) => `50000000-0000-4000-8000-0000000000${n}`;

/** The input with its top-level fields writable, so each test can vary one of them. */
type MutableInput = { -readonly [K in keyof CompositionInput]: CompositionInput[K] };
const input = (): MutableInput => ({
  rulesetId: R,
  manifestId: M,
  manifestHash: null,
  rulesetVersionLabel: "0.1",
  release: null,
  pins: [
    { entityId: E("0b"), entityVersionId: V("0b"), sourceRulesetId: R, sourceManifestId: M },
    { entityId: E("0a"), entityVersionId: V("0a"), sourceRulesetId: PARENT_R, sourceManifestId: PARENT_M },
  ],
  entities: [
    { id: E("0a"), canonicalKey: "rule.alpha", entityType: "GENERIC_RULE" },
    { id: E("0b"), canonicalKey: "rule.beta", entityType: "RESOURCE" },
  ],
  versions: [
    { id: V("0b"), entityId: E("0b") },
    { id: V("0a"), entityId: E("0a") },
  ],
});

function expectInvalid(build: () => unknown, fragment: RegExp) {
  try {
    build();
    throw new Error("expected INVALID_COMPOSITION");
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(RULESET_RESOLUTION_ERROR_CODES.INVALID_COMPOSITION);
    expect((e as DomainError).message).toMatch(fragment);
  }
}

describe("composition → RulesetContext", () => {
  it("builds the canonical @prowess/rules context: exact ids, type, canonical key, supplying ruleset/manifest, sorted by entity id", () => {
    const ctx = buildRulesetContextFromComposition(input());
    expect(ctx).toEqual({
      rulesetId: R,
      manifestId: M,
      manifestHash: null,
      rulesetVersionLabel: "0.1",
      release: null,
      rules: [
        { entityId: E("0a"), entityVersionId: V("0a"), canonicalKey: "rule.alpha", entityType: "GENERIC_RULE", sourceRulesetId: PARENT_R, sourceManifestId: PARENT_M },
        { entityId: E("0b"), entityVersionId: V("0b"), canonicalKey: "rule.beta", entityType: "RESOURCE", sourceRulesetId: R, sourceManifestId: M },
      ],
    });
    expect(Object.isFrozen(ctx.rules[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx);
  });

  it("is independent of the order rows arrive in, and does not mutate its input", () => {
    const a = input();
    const before = JSON.stringify(a);
    const b = input();
    b.pins = [...b.pins].reverse();
    b.entities = [...b.entities].reverse();
    b.versions = [...b.versions].reverse();
    expect(JSON.stringify(buildRulesetContextFromComposition(b))).toBe(JSON.stringify(buildRulesetContextFromComposition(a)));
    expect(JSON.stringify(a)).toBe(before);
  });

  it("an empty composition is a valid context with zero rules", () => {
    expect(buildRulesetContextFromComposition({ ...input(), pins: [], entities: [], versions: [] }).rules).toEqual([]);
  });

  it("carries a release hash and release identity verbatim", () => {
    const ctx = buildRulesetContextFromComposition({
      ...input(),
      manifestHash: "f".repeat(64),
      release: { releaseId: "30000000-0000-4000-8000-000000000001", releaseNumber: 2, versionLabel: "Release 2" },
    });
    expect([ctx.manifestHash, ctx.release]).toEqual(["f".repeat(64), { releaseId: "30000000-0000-4000-8000-000000000001", releaseNumber: 2, versionLabel: "Release 2" }]);
  });
});

describe("M4-I21 fails closed on an ambiguous or malformed composition", () => {
  it("one Entity pinned twice is refused, never resolved to either version", () => {
    const i = input();
    i.pins = [...i.pins, { entityId: E("0a"), entityVersionId: V("0b"), sourceRulesetId: R, sourceManifestId: M }];
    expectInvalid(() => buildRulesetContextFromComposition(i), /appears more than once/);
  });

  it("an EntityVersion belonging to another Entity is refused (§21)", () => {
    const i = input();
    i.versions = [{ id: V("0b"), entityId: E("0a") }, { id: V("0a"), entityId: E("0a") }];
    expectInvalid(() => buildRulesetContextFromComposition(i), /belongs to Entity/);
  });

  it("a missing Entity or EntityVersion is refused", () => {
    expectInvalid(() => buildRulesetContextFromComposition({ ...input(), entities: input().entities.slice(0, 1) }), /does not exist/);
    expectInvalid(() => buildRulesetContextFromComposition({ ...input(), versions: input().versions.slice(0, 1) }), /does not exist/);
  });

  it("two Entities claiming one canonical key are refused rather than choosing one (§26)", () => {
    const i = input();
    i.entities = [i.entities[0]!, { ...i.entities[1]!, canonicalKey: "rule.alpha" }];
    expectInvalid(() => buildRulesetContextFromComposition(i), /canonical key rule\.alpha/);
  });

  it("anything the M4 context constructor rejects is refused too — the constructor is never bypassed (§85)", () => {
    expectInvalid(() => buildRulesetContextFromComposition({ ...input(), manifestHash: "NOT-A-HASH" }), /manifestHash/);
    const badType = input();
    badType.entities = [{ ...badType.entities[0]!, entityType: "NOT_A_TYPE" }, badType.entities[1]!];
    expectInvalid(() => buildRulesetContextFromComposition(badType), /entityType/);
  });
});
