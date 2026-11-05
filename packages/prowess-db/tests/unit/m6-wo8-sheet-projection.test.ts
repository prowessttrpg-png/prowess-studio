import { describe, expect, it } from "vitest";
import fixture from "../../../../apps/studio/tests/unit/fixtures/m6-wo8-builder.json";
import { projectManeuverSheet } from "../../src/character/signature-maneuver-presentation";
import type { SignatureManeuverEntry } from "../../src/character/signature-maneuver-service";
const entry = (): SignatureManeuverEntry => {
  const row = structuredClone(fixture.basic.maneuver);
  return { ...row, status: "ACTIVE", current: { ...row.draft, revisionId: "current", revisionNumber: 1, createdAt: new Date() } } as unknown as SignatureManeuverEntry;
};
describe("WO8 read-only current-revision sheet projection", () => {
  it("excludes drafts/retired and retains the active current revision during an invalid rebuild", () => {
    const source = entry(), draft = { ...entry(), status: "DRAFT" as const }, retired = { ...entry(), status: "RETIRED" as const };
    const active = { ...source, draft: { draft: { ...source.current!.draft!, concept: { ...source.current!.draft!.concept, name: "Invalid rebuild" }, effects: [] }, evaluation: null } };
    const before = JSON.stringify([active, draft, retired]);
    const result = projectManeuverSheet([active, draft, retired]);
    expect(result.maneuvers).toHaveLength(1); expect(result.maneuvers[0]!.name).toBe("Maneuver fixture");
    expect(result.maneuvers[0]!.finalApCost).toBe(active.current!.evaluation!.cost!.ap.finalApCost);
    expect(JSON.stringify([active, draft, retired])).toBe(before);
  });
  it("hides stale/provisional prices on invalid and unreadable current revisions while retaining identities and warnings", () => {
    const original = entry(), e = original.current!.evaluation!;
    const invalid = { ...original, current: { ...original.current!, evaluation: { ...e, state: "INVALID" as const, issues: [{ code: "ATTACK_UNAVAILABLE", path: "/actions", message: "Exact equipped Attack unavailable" }] } } };
    const rows = projectManeuverSheet([invalid, { ...entry(), current: { ...entry().current!, evaluation: null } }]).maneuvers;
    expect(rows.every(r => r.finalApCost === null && r.finalMpCost === null)).toBe(true);
    expect(rows[0]!.actions).toEqual(invalid.current.draft!.actions); expect(rows[0]!.warnings[0]!.message).toContain("unavailable");
    expect(rows[1]!.state).toBe("UNREADABLE"); expect(rows[1]!.warnings[0]!.code).toBe("UNREADABLE");
  });
});
