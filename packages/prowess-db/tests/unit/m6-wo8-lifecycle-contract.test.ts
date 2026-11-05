import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../apps/studio/tests/unit/fixtures/m6-wo8-builder.json";

// Exercise the real shared repository and Maneuver adapter. These are transaction-port spies, not a database;
// PostgreSQL locking, rollback, triggers and concurrent races remain mandatory integration checks in CI.
const db = vi.hoisted(() => {
  const revision = () => ({ create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() });
  const tx = {
    $queryRaw: vi.fn(), characterWeaponLoadout: { findUnique: vi.fn() },
    characterSignatureAbility: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    characterSignatureSpellRevision: revision(), characterSignatureManeuverRevision: revision(),
  };
  return { tx, prisma: { $transaction: vi.fn(), characterSignatureAbility: tx.characterSignatureAbility } };
});
vi.mock("../../src/client.js", () => ({ prisma: db.prisma }));
import { finalizeSignatureManeuver, insertSignatureManeuverDraft, retireSignatureManeuver, startSignatureManeuverRebuild, writeSignatureManeuverDraft } from "../../src/character/signature-maneuver-repository.js";

const draft = () => structuredClone(fixture.basic.maneuver.draft.draft);
const row = () => ({
  id: "ability", characterId: "character", abilityKind: "MANEUVER", status: "ACTIVE", lockVersion: 4,
  currentRevisionId: null, currentManeuverRevisionId: "revision1", draftPayload: draft(),
  createdAt: new Date(0), updatedAt: new Date(0), retiredAt: null, revisions: [],
  maneuverRevisions: [{ id: "revision1", revisionNumber: 1, characterReleaseId: "release", previousRevisionId: null, payload: draft(), createdAt: new Date(0) }],
});
let stored: ReturnType<typeof row>;
const decide = vi.fn((payload: unknown) => ({ ok: true as const, payload: payload as object }));
const input = () => ({ characterId: "character", abilityId: "ability", expected: 4, characterLockVersion: 7, characterReleaseId: "release", weaponLoadoutVersion: 3, decide });
beforeEach(() => {
  vi.resetAllMocks(); stored = row();
  db.prisma.$transaction.mockImplementation(async (fn: (tx: typeof db.tx) => Promise<unknown>) => fn(db.tx));
  db.tx.$queryRaw.mockResolvedValue([{ lock_version: 7, ruleset_release_id: "release" }]);
  db.tx.characterWeaponLoadout.findUnique.mockResolvedValue({ lockVersion: 3 });
  db.tx.characterSignatureAbility.findFirst.mockImplementation(async () => stored);
  db.tx.characterSignatureAbility.create.mockImplementation(async () => ({ ...stored, status: "DRAFT", currentManeuverRevisionId: null, maneuverRevisions: [] }));
  db.tx.characterSignatureAbility.count.mockResolvedValue(2);
  db.tx.characterSignatureAbility.updateMany.mockResolvedValue({ count: 1 });
  db.tx.characterSignatureManeuverRevision.create.mockResolvedValue({ id: "revision2" });
  db.tx.characterSignatureSpellRevision.create.mockResolvedValue({ id: "spellRevision2" });
  decide.mockImplementation((payload: unknown) => ({ ok: true, payload: payload as object }));
});
const noHistoryWrites = () => {
  for (const table of [db.tx.characterSignatureManeuverRevision, db.tx.characterSignatureSpellRevision]) {
    expect(table.create).not.toHaveBeenCalled(); expect(table.updateMany).not.toHaveBeenCalled();
    expect(table.deleteMany).not.toHaveBeenCalled(); expect(table.upsert).not.toHaveBeenCalled();
  }
};

describe("WO8 shared lifecycle transaction contracts — M6-I099 I100 I110 I111 I112 I113 I114 I118 I119 I122", () => {
  it("creates a choices-only DRAFT without an active slot or a finalized revision", async () => {
    const selections = draft(); await insertSignatureManeuverDraft("character", selections);
    expect(db.tx.characterSignatureAbility.create.mock.calls[0]?.[0].data).toEqual({ characterId: "character", abilityKind: "MANEUVER", status: "DRAFT", draftPayload: selections });
    noHistoryWrites(); expect(db.tx.characterSignatureAbility.count).not.toHaveBeenCalled();
  });
  it("uses the Character lock and the OTHER ACTIVE roster of both kinds for the evaluator", async () => {
    expect(await finalizeSignatureManeuver(input())).toEqual({ outcome: "ok", version: 5 });
    const sql = db.tx.$queryRaw.mock.calls[0]![0] as readonly string[];
    expect(sql.join("?")).toMatch(/FROM\s+"characters"[\s\S]*FOR\s+UPDATE/);
    expect(db.tx.characterSignatureAbility.count).toHaveBeenCalledWith({ where: { characterId: "character", status: "ACTIVE", id: { not: "ability" } } });
    expect(decide).toHaveBeenCalledWith(stored.draftPayload, 2);
    expect(db.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(decide.mock.invocationCallOrder[0]!);
  });
  it("rejects shared capacity exhaustion before appending or moving the current revision", async () => {
    const before = structuredClone(stored);
    const reject = vi.fn(() => ({ ok: false as const, reason: "capacity" as const, detail: "Both Signature kinds fill the available capacity" }));
    expect(await finalizeSignatureManeuver({ ...input(), decide: reject })).toMatchObject({ outcome: "rejected", reason: "capacity" });
    expect(reject).toHaveBeenCalledWith(stored.draftPayload, 2);
    noHistoryWrites(); expect(db.tx.characterSignatureAbility.updateMany).not.toHaveBeenCalled(); expect(stored).toEqual(before);
  });
  it("an invalid rebuild cannot append a revision or replace its valid predecessor", async () => {
    const before = structuredClone(stored);
    expect(await finalizeSignatureManeuver({ ...input(), decide: () => ({ ok: false, reason: "invalid", detail: "Missing required Effect" }) })).toMatchObject({ outcome: "rejected", reason: "invalid" });
    noHistoryWrites(); expect(db.tx.characterSignatureAbility.updateMany).not.toHaveBeenCalled(); expect(stored).toEqual(before);
  });
  it("appends only Maneuver choices with its predecessor and claims the own-kind pointer by CAS", async () => {
    expect(await finalizeSignatureManeuver(input())).toEqual({ outcome: "ok", version: 5 });
    expect(db.tx.characterSignatureManeuverRevision.create).toHaveBeenCalledWith({ data: { abilityId: "ability", revisionNumber: 2, characterReleaseId: "release", previousRevisionId: "revision1", payload: stored.draftPayload } });
    expect(db.tx.characterSignatureSpellRevision.create).not.toHaveBeenCalled();
    const claim = db.tx.characterSignatureAbility.updateMany.mock.calls[0]![0];
    expect(claim.where).toEqual({ id: "ability", characterId: "character", lockVersion: 4 });
    expect(claim.data).toMatchObject({ currentManeuverRevisionId: "revision2", status: "ACTIVE", lockVersion: 5 });
    expect(claim.data).not.toHaveProperty("currentRevisionId");
    for (const table of [db.tx.characterSignatureManeuverRevision, db.tx.characterSignatureSpellRevision]) {
      expect(table.updateMany).not.toHaveBeenCalled(); expect(table.deleteMany).not.toHaveBeenCalled(); expect(table.upsert).not.toHaveBeenCalled();
    }
  });
  it.each([{ lock_version: 8, ruleset_release_id: "release" }, { lock_version: 7, ruleset_release_id: "other-release" }])("refuses changed Character context %j before evaluation", async context => {
    db.tx.$queryRaw.mockResolvedValue([context]);
    expect(await finalizeSignatureManeuver(input())).toEqual({ outcome: "character_changed" });
    expect(decide).not.toHaveBeenCalled(); noHistoryWrites(); expect(db.tx.characterSignatureAbility.updateMany).not.toHaveBeenCalled();
  });
  it("refuses a changed WO6 loadout version before evaluation", async () => {
    db.tx.characterWeaponLoadout.findUnique.mockResolvedValue({ lockVersion: 5 });
    expect(await finalizeSignatureManeuver(input())).toEqual({ outcome: "character_changed" });
    expect(decide).not.toHaveBeenCalled(); noHistoryWrites();
  });
  it("refuses stale draft and finalize versions without overwriting the current selections", async () => {
    expect(await writeSignatureManeuverDraft("character", "ability", 3, draft())).toEqual({ outcome: "stale", current: 4 });
    expect(await finalizeSignatureManeuver({ ...input(), expected: 3 })).toEqual({ outcome: "stale", current: 4 });
    expect(decide).not.toHaveBeenCalled(); expect(db.tx.characterSignatureAbility.updateMany).not.toHaveBeenCalled(); noHistoryWrites();
  });
  it("draft writes retain the expected version in the database compare-and-set", async () => {
    const selections = draft();
    expect(await writeSignatureManeuverDraft("character", "ability", 4, selections)).toEqual({ outcome: "ok", version: 5 });
    expect(db.tx.characterSignatureAbility.updateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: "ability", characterId: "character", lockVersion: 4 }, data: { draftPayload: selections, lockVersion: 5 } });
    noHistoryWrites();
  });
  it("a lost CAS claim reports a conflict", async () => {
    db.tx.characterSignatureAbility.updateMany.mockResolvedValue({ count: 0 });
    expect(await writeSignatureManeuverDraft("character", "ability", 4, draft())).toMatchObject({ outcome: "stale" });
    noHistoryWrites();
  });
  it("rebuild copies only the current revision's choices and never rewrites history", async () => {
    stored.draftPayload = null as unknown as ReturnType<typeof draft>;
    expect(await startSignatureManeuverRebuild("character", "ability", 4)).toEqual({ outcome: "ok", version: 5 });
    const data = db.tx.characterSignatureAbility.updateMany.mock.calls[0]![0].data;
    expect(data.draftPayload).toEqual(stored.maneuverRevisions[0]!.payload);
    expect(data).not.toHaveProperty("currentManeuverRevisionId"); noHistoryWrites();
  });
  it("retirement releases the active status while preserving the current pointer and every revision", async () => {
    expect(await retireSignatureManeuver("character", "ability", 4)).toEqual({ outcome: "ok", version: 5 });
    const data = db.tx.characterSignatureAbility.updateMany.mock.calls[0]![0].data;
    expect(data.status).toBe("RETIRED"); expect(data).not.toHaveProperty("currentManeuverRevisionId"); noHistoryWrites();
  });
  it("retired Maneuvers cannot be edited, rebuilt or finalized", async () => {
    stored.status = "RETIRED";
    expect(await writeSignatureManeuverDraft("character", "ability", 4, draft())).toMatchObject({ outcome: "state", status: "RETIRED" });
    expect(await startSignatureManeuverRebuild("character", "ability", 4)).toMatchObject({ outcome: "state", status: "RETIRED" });
    expect(await finalizeSignatureManeuver(input())).toMatchObject({ outcome: "state", status: "RETIRED" });
    expect(decide).not.toHaveBeenCalled(); expect(db.tx.characterSignatureAbility.updateMany).not.toHaveBeenCalled(); noHistoryWrites();
  });
});
