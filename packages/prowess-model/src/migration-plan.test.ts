import { describe, expect, it } from "vitest";
import { MIGRATION_PLAN_ERROR_CODES } from "./errors.js";
import { MigrationPlanId, MigrationPlanItemId } from "./ids.js";
import {
  assessMigration, compatibilityFor, MIGRATION_CHANGE_TYPES, MIGRATION_COMPATIBILITY_CLASSIFICATIONS, summarizeMigration,
  validateCreateMigrationPlanInput, validatePreviewRulesetMigrationInput,
} from "./migration-plan.js";
import { diffCompositions } from "./ruleset-release.js";

const E = (c: string) => `${c.repeat(8)}-0000-4000-8000-000000000000`;
const V = (c: string, n: number) => `${c.repeat(8)}-0000-4000-8000-00000000000${n}`;
const [A, B, C, D] = ["a", "b", "c", "d"].map(E) as [string, string, string, string];
const pin = (entityId: string, entityVersionId: string) => ({ entityId, entityVersionId });
const shape = (items: ReturnType<typeof assessMigration>) => items.map((i) => [i.entityId, i.changeType, i.compatibilityClassification, i.sourceEntityVersionId, i.targetEntityVersionId]);

describe("vocabularies (§5, §6)", () => {
  it("change types are the four structural changes; compatibility keeps the full PAS-08 vocabulary", () => {
    expect([...MIGRATION_CHANGE_TYPES]).toEqual(["UNCHANGED", "ADDED_ENTITY", "REMOVED_ENTITY", "CHANGED_VERSION"]);
    expect([...MIGRATION_COMPATIBILITY_CLASSIFICATIONS]).toEqual(["UNCHANGED", "RECALCULATE_ONLY", "VALID_WITH_CHANGES", "REVIEW_REQUIRED", "INVALID", "UNSUPPORTED"]);
  });
  it("WO11 asserts only UNCHANGED or REVIEW_REQUIRED — never mechanical certainty", () => {
    expect(MIGRATION_CHANGE_TYPES.map(compatibilityFor)).toEqual(["UNCHANGED", "REVIEW_REQUIRED", "REVIEW_REQUIRED", "REVIEW_REQUIRED"]);
  });
  it("ids brand; errors are exactly the seven MIGRATION_PLAN codes, none for execution", () => {
    expect(MigrationPlanId.of(A)).toBe(A);
    expect(MigrationPlanItemId.of(B)).toBe(B);
    expect(Object.keys(MIGRATION_PLAN_ERROR_CODES)).toHaveLength(7);
    for (const [k, v] of Object.entries(MIGRATION_PLAN_ERROR_CODES)) expect(v).toBe(`MIGRATION_PLAN.${k}`);
    expect(Object.keys(MIGRATION_PLAN_ERROR_CODES).filter((k) => /APPLY|EXECUTE|UPGRADE|MIGRATE/.test(k))).toEqual([]);
  });
});

describe("assessMigration (§5, §15, §16, §25–§28)", () => {
  it("identical compositions: everything UNCHANGED, nothing needs review (§25)", () => {
    const comp = [pin(A, V("a", 1)), pin(B, V("b", 1))];
    const items = assessMigration(comp, comp);
    expect(items.every((i) => i.changeType === "UNCHANGED" && i.sourceEntityVersionId === i.targetEntityVersionId)).toBe(true);
    expect(summarizeMigration(items)).toEqual({ unchanged: 2, added: 0, removed: 0, changed: 0, reviewRequired: 0, total: 2 });
  });
  it("A1 -> A2 is CHANGED_VERSION, REVIEW_REQUIRED — reported, never substituted or declared compatible (§16, §26)", () => {
    expect(shape(assessMigration([pin(A, V("a", 1))], [pin(A, V("a", 2))]))).toEqual([[A, "CHANGED_VERSION", "REVIEW_REQUIRED", V("a", 1), V("a", 2)]]);
  });
  it("added and removed (§27)", () => {
    expect(shape(assessMigration([pin(A, V("a", 1)), pin(B, V("b", 1))], [pin(A, V("a", 1)), pin(C, V("c", 1))]))).toEqual([
      [A, "UNCHANGED", "UNCHANGED", V("a", 1), V("a", 1)],
      [B, "REMOVED_ENTITY", "REVIEW_REQUIRED", V("b", 1), null],
      [C, "ADDED_ENTITY", "REVIEW_REQUIRED", null, V("c", 1)],
    ]);
  });
  it("multiple changes, ordered by Entity id, with correct counts (§14, §28)", () => {
    const items = assessMigration([pin(A, V("a", 1)), pin(B, V("b", 1)), pin(C, V("c", 1))], [pin(A, V("a", 2)), pin(C, V("c", 1)), pin(D, V("d", 1))]);
    expect(items.map((i) => [i.entityId, i.changeType])).toEqual([[A, "CHANGED_VERSION"], [B, "REMOVED_ENTITY"], [C, "UNCHANGED"], [D, "ADDED_ENTITY"]]);
    expect(summarizeMigration(items)).toEqual({ unchanged: 1, added: 1, removed: 1, changed: 1, reviewRequired: 3, total: 4 });
  });
  it("is deterministic: input order and id case never change the result (§15)", () => {
    const s = [pin(A, V("a", 1)), pin(B, V("b", 1)), pin(C, V("c", 1))];
    const t = [pin(D, V("d", 1)), pin(C, V("c", 1)), pin(A, V("a", 2))];
    const one = assessMigration(s, t);
    expect(assessMigration([...s].reverse(), [...t].reverse())).toEqual(one);
    expect(assessMigration(s.map((p) => pin(p.entityId.toUpperCase(), p.entityVersionId.toUpperCase())), t)).toEqual(one);
  });
  it("agrees with the shared WO8 composition diff for every non-UNCHANGED Entity (§3, §37)", () => {
    const s = [pin(A, V("a", 1)), pin(B, V("b", 1)), pin(C, V("c", 1))];
    const t = [pin(A, V("a", 2)), pin(C, V("c", 1)), pin(D, V("d", 1))];
    const diff = diffCompositions(s, t);
    const changed = assessMigration(s, t).filter((i) => i.changeType !== "UNCHANGED");
    expect(changed.map((i) => [i.changeType, i.entityId, i.sourceEntityVersionId, i.targetEntityVersionId])).toEqual(diff.entries.map((e) => [e.type, e.entityId, e.fromEntityVersionId, e.toEntityVersionId]));
    expect(assessMigration(s, t).filter((i) => i.changeType === "UNCHANGED")).toHaveLength(diff.unchangedCount);
  });
});

describe("input validation (§2)", () => {
  it("requires two explicit, different Release ids, a name, and a bounded description", () => {
    expect(validatePreviewRulesetMigrationInput({ sourceReleaseId: A, targetReleaseId: B })).toBeNull();
    for (const bad of [{ sourceReleaseId: "", targetReleaseId: B }, { sourceReleaseId: A, targetReleaseId: " " }, { sourceReleaseId: A, targetReleaseId: A.toUpperCase() }]) {
      expect(validatePreviewRulesetMigrationInput(bad), JSON.stringify(bad)).not.toBeNull();
    }
    expect(validateCreateMigrationPlanInput({ sourceReleaseId: A, targetReleaseId: B, name: "x" })).toBeNull();
    expect(validateCreateMigrationPlanInput({ sourceReleaseId: A, targetReleaseId: B, name: " " })).not.toBeNull();
    expect(validateCreateMigrationPlanInput({ sourceReleaseId: A, targetReleaseId: B, name: "x", description: "y".repeat(4001) })).not.toBeNull();
  });
});
