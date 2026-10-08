import { describe, expect, it } from "vitest";
import type { ChangeSetOperation } from "./change-set.js";
import { RULESET_RELEASE_ERROR_CODES } from "./errors.js";
import { RulesetReleaseId } from "./ids.js";
import { CHANGE_SET_TRANSITIONS, isPublishableRulesetStatus, isValidChangeSetTransition, isValidRulesetReviewTransition, RULESET_REVIEW_TRANSITIONS } from "./review-lifecycle.js";
import { canonicalManifestText, diffCompositions, MANIFEST_HASH_FORMAT, planChangeSetApplication, validateCreateRulesetReleaseInput } from "./ruleset-release.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const [A1, A2, A3, B1, C1] = ["a1", "a2", "a3", "b1", "c1"].map((s) => `${s.padEnd(8, "0")}-1111-4111-8111-111111111111`) as [string, string, string, string, string];
const M = "dddddddd-0000-4000-8000-000000000004";
const OTHER = "eeeeeeee-0000-4000-8000-000000000005";
let seq = 0;
const op = (operationType: string, o: Record<string, unknown> = {}): ChangeSetOperation =>
  ({ id: `op${++seq}`, changeSetId: "cs", sequence: seq, operationType, targetEntityId: null, fromEntityVersionId: null, toEntityVersionId: null, targetManifestId: null, description: null, createdAt: new Date(0), ...o }) as unknown as ChangeSetOperation;
const base = () => new Map([[A, A1], [B, B1]]);
const plan = (ops: ChangeSetOperation[], b = base()) => planChangeSetApplication(b, ops, M);

describe("review lifecycles (§11, §15)", () => {
  it("ChangeSet: DRAFT -> READY_FOR_REVIEW -> APPROVED | REJECTED; nothing else", () => {
    expect(CHANGE_SET_TRANSITIONS).toEqual({ DRAFT: ["READY_FOR_REVIEW"], READY_FOR_REVIEW: ["APPROVED", "REJECTED"], APPROVED: [], REJECTED: [], SUPERSEDED: [] });
    for (const [from, to] of [["DRAFT", "APPROVED"], ["DRAFT", "REJECTED"], ["REJECTED", "APPROVED"], ["APPROVED", "DRAFT"], ["APPROVED", "READY_FOR_REVIEW"]] as const) {
      expect(isValidChangeSetTransition(from, to), `${from}->${to}`).toBe(false);
    }
  });
  it("Ruleset: only DRAFT -> IN_REVIEW -> APPROVED by review; publication-only beyond; APPROVED/PUBLISHED publishable", () => {
    expect(RULESET_REVIEW_TRANSITIONS).toEqual({ DRAFT: ["IN_REVIEW"], IN_REVIEW: ["APPROVED"], APPROVED: [], PUBLISHED: [], DEPRECATED: [], ARCHIVED: [] });
    expect(isValidRulesetReviewTransition("DRAFT", "APPROVED")).toBe(false);
    expect(isValidRulesetReviewTransition("APPROVED", "PUBLISHED")).toBe(false);
    expect(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "DEPRECATED", "ARCHIVED"].filter((s) => isPublishableRulesetStatus(s as never))).toEqual(["APPROVED", "PUBLISHED"]);
  });
});

describe("planChangeSetApplication (§24–§33)", () => {
  it("no operations => the base composition", () => {
    expect(plan([])).toEqual({ ok: true, composition: base(), deprecations: [] });
  });
  it("PIN sets regardless of an existing pin; REPLACE / ADD / REMOVE / NO_CHANGE apply exactly", () => {
    const r = plan([
      op("PIN_ENTITY_VERSION", { targetEntityId: A, toEntityVersionId: A2 }),
      op("REMOVE_ENTITY_FROM_MANIFEST", { targetEntityId: B, fromEntityVersionId: B1 }),
      op("ADD_ENTITY_TO_MANIFEST", { targetEntityId: C, toEntityVersionId: C1, targetManifestId: M }),
    ]);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && [...r.composition.entries()]).toEqual([[A, A2], [C, C1]]);
    const replace = plan([op("REPLACE_ENTITY_VERSION", { targetEntityId: A, fromEntityVersionId: A1, toEntityVersionId: A3 })]);
    expect(replace.ok && replace.composition.get(A)).toBe(A3);
    expect(plan([op("NO_CHANGE")])).toEqual({ ok: true, composition: base(), deprecations: [] });
  });
  it.each([
    ["REPLACE from a Version the base does not pin", op("REPLACE_ENTITY_VERSION", { targetEntityId: A, fromEntityVersionId: A2, toEntityVersionId: A3 })],
    ["REPLACE of an absent Entity", op("REPLACE_ENTITY_VERSION", { targetEntityId: C, fromEntityVersionId: C1, toEntityVersionId: C1 })],
    ["ADD of a present Entity", op("ADD_ENTITY_TO_MANIFEST", { targetEntityId: A, toEntityVersionId: A2 })],
    ["REMOVE of an absent Entity", op("REMOVE_ENTITY_FROM_MANIFEST", { targetEntityId: C })],
    ["REMOVE with a mismatched from", op("REMOVE_ENTITY_FROM_MANIFEST", { targetEntityId: A, fromEntityVersionId: A2 })],
  ])("fails closed: %s -> STALE_CHANGE_SET (§33)", (_n, o) => {
    expect(plan([o])).toMatchObject({ ok: false, kind: "STALE_CHANGE_SET" });
  });
  it("CREATE is never materialized; another manifest's operation is a context error; both fail before applying anything", () => {
    expect(plan([op("PIN_ENTITY_VERSION", { targetEntityId: A, toEntityVersionId: A2 }), op("CREATE_ENTITY_VERSION", { targetEntityId: A })])).toMatchObject({ ok: false, kind: "UNRESOLVED_CREATE_OPERATION" });
    expect(plan([op("NO_CHANGE", { targetManifestId: OTHER })])).toMatchObject({ ok: false, kind: "INVALID_MANIFEST_CONTEXT" });
  });
  it("DEPRECATE queues a lifecycle change and leaves composition alone (§30)", () => {
    const r = plan([op("DEPRECATE_ENTITY_VERSION", { targetEntityId: A, fromEntityVersionId: A1 })]);
    expect(r.ok && r.composition).toEqual(base());
    expect(r.ok && r.deprecations.map((d) => d.entityVersionId)).toEqual([A1]);
  });
  it("applies in sequence order regardless of array order, and never mutates the base map", () => {
    const b = base();
    const second = op("REPLACE_ENTITY_VERSION", { targetEntityId: A, fromEntityVersionId: A2, toEntityVersionId: A3 });
    const first = op("PIN_ENTITY_VERSION", { targetEntityId: A, toEntityVersionId: A2 });
    (first as { sequence: number }).sequence = 1;
    (second as { sequence: number }).sequence = 2;
    const r = plan([second, first], b);
    expect(r.ok && r.composition.get(A)).toBe(A3);
    expect(b).toEqual(base());
  });
});

describe("canonical manifest text (§41, §42)", () => {
  it("is versioned, sorted by entity id, lowercase, one line per pin, independent of input order", () => {
    const pins = [{ entityId: B.toUpperCase(), entityVersionId: B1 }, { entityId: A, entityVersionId: A1.toUpperCase() }];
    expect(canonicalManifestText(pins)).toBe(`${MANIFEST_HASH_FORMAT}\n${A}:${A1}\n${B}:${B1}\n`);
    expect(canonicalManifestText([...pins].reverse())).toBe(canonicalManifestText(pins));
    expect(canonicalManifestText([])).toBe("PROWESS_MANIFEST_V1\n");
  });
});

describe("diffCompositions (§48, §81)", () => {
  it("reports CHANGED / REMOVED / ADDED in Entity order with an unchanged count", () => {
    const r1 = [{ entityId: A, entityVersionId: A1 }, { entityId: B, entityVersionId: B1 }];
    const r2 = [{ entityId: C, entityVersionId: C1 }, { entityId: A, entityVersionId: A2 }];
    expect(diffCompositions(r1, r2)).toEqual({
      entries: [
        { type: "CHANGED_VERSION", entityId: A, fromEntityVersionId: A1, toEntityVersionId: A2 },
        { type: "REMOVED_ENTITY", entityId: B, fromEntityVersionId: B1, toEntityVersionId: null },
        { type: "ADDED_ENTITY", entityId: C, fromEntityVersionId: null, toEntityVersionId: C1 },
      ],
      unchangedCount: 0,
    });
    expect(diffCompositions(r1, r1)).toEqual({ entries: [], unchangedCount: 2 });
  });
});

describe("input, ids, errors (§18, §50, §51)", () => {
  const ok = { rulesetId: A, baseManifestId: M, canonPolicyId: B, versionLabel: " 0.1 " };
  it("requires ids and a non-blank label; release number/hash/channel are not inputs", () => {
    expect(validateCreateRulesetReleaseInput(ok)).toBeNull();
    for (const bad of [{ versionLabel: "  " }, { baseManifestId: "" }, { canonPolicyId: undefined }, { changeSetId: "" }, { releaseNotes: 3 }, { versionLabel: "x".repeat(101) }]) {
      expect(validateCreateRulesetReleaseInput({ ...ok, ...bad } as never), JSON.stringify(bad)).not.toBeNull();
    }
  });
  it("brands ids; the release error vocabulary is exactly seventeen codes", () => {
    expect(RulesetReleaseId.of(A)).toBe(A);
    expect(Object.keys(RULESET_RELEASE_ERROR_CODES)).toHaveLength(18); // +MUTABLE_VERSION_PINNED (M2-WO12 F1)
    for (const [k, v] of Object.entries(RULESET_RELEASE_ERROR_CODES)) expect(v).toBe(`RULESET_RELEASE.${k}`);
  });
});

describe("M2-WO12 F1 — mutable Version statuses are derived from the lifecycle graph", () => {
  it("DRAFT and every status that can reach DRAFT are mutable; today that is exactly DRAFT and IN_REVIEW", async () => {
    const { ENTITY_VERSION_TRANSITIONS } = await import("./entity-version-lifecycle.js");
    const { MUTABLE_ENTITY_VERSION_STATUSES, isPublishableVersionStatus } = await import("./ruleset-release.js");
    expect([...MUTABLE_ENTITY_VERSION_STATUSES]).toEqual(["DRAFT", "IN_REVIEW"]);
    // Requirement 6, made explicit: the ONLY transition back to DRAFT is M1's IN_REVIEW send-back.
    expect(Object.entries(ENTITY_VERSION_TRANSITIONS).filter(([, to]) => (to as readonly string[]).includes("DRAFT")).map(([from]) => from)).toEqual(["IN_REVIEW"]);
    for (const s of ["APPROVED", "PLAYTEST", "CANON", "SUPERSEDED", "DEPRECATED", "ARCHIVED"] as const) expect(isPublishableVersionStatus(s), s).toBe(true);
  });
});
