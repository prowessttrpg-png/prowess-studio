/**
 * M5-CLOSEOUT-02 R9 characterization — written and passing BEFORE manifest entries were bulk-inserted. Pins, for the
 * Manifest allocator: entry count, returned ordering and identities, per-manifest atomicity, the DB-level duplicate
 * violation that the service maps to DUPLICATE_ENTITY, the composite FK rejection, and exact Release resolution of a
 * manifest of the WO13 fixture size (242 entries). Also records a local timing for that 242-entry manifest.
 * Runs only against prowess_studio_test (guarded).
 */
import { appendFileSync } from "node:fs";
import { RULESET_MANIFEST_ERROR_CODES } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRuleset, createRulesetManifest, prisma, resolveRulesetContextFromManifest } from "../../src/index";
import { insertManifestSnapshotInTransaction, isManifestEntryDuplicateViolation } from "../../src/ruleset-manifest/repository";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
const N = 242;
const rulesetIds: string[] = [];
const entityIds: string[] = [];
let pins: { entityId: string; entityVersionId: string }[] = [];
let foreignVersionId = "";

async function ruleset(label: string) {
  const r = await createRuleset({ canonicalKey: `test.ruleset.closeout_${label}_${tag}`, name: `Closeout ${label}`, channel: "CORE_PLAYTEST", versionLabel: label });
  rulesetIds.push(r.id);
  return r;
}

describe("M5-CLOSEOUT-02 R9 manifest entry insertion", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    const keys = Array.from({ length: N + 1 }, (_, i) => `test.closeout.bulk_${tag}_${String(i).padStart(4, "0")}`);
    await prisma.entity.createMany({ data: keys.map((canonicalKey) => ({ entityType: "GENERIC_RULE" as const, canonicalKey })) });
    const entities = await prisma.entity.findMany({ where: { canonicalKey: { in: keys } }, select: { id: true, canonicalKey: true }, orderBy: { canonicalKey: "asc" } });
    entityIds.push(...entities.map((e) => e.id));
    await prisma.entityVersion.createMany({ data: entities.map((e) => ({ entityId: e.id, revisionNumber: 1, displayName: e.canonicalKey })) });
    const versions = await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true, entityId: true } });
    const byEntity = new Map(versions.map((v) => [v.entityId, v.id]));
    // Supplied in REVERSE key order, so the stored / returned order cannot simply echo insertion order.
    pins = entities.slice(0, N).reverse().map((e) => ({ entityId: e.id, entityVersionId: byEntity.get(e.id)! }));
    foreignVersionId = byEntity.get(entities[N]!.id)!;
  });

  afterAll(async () => {
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  it("a 242-entry manifest stores every pin once, returns them in canonical-key order with distinct identities, and resolves exactly", async () => {
    const r = await ruleset("shape");
    const before = Date.now();
    const manifest = await createRulesetManifest(r.id, { entries: pins });
    const after = Date.now();
    expect(manifest.entries).toHaveLength(N);
    const keyOrder = [...pins].reverse().map((p) => p.entityId);
    expect(manifest.entries.map((e) => e.entityId)).toEqual(keyOrder);
    expect(new Set(manifest.entries.map((e) => e.id)).size).toBe(N);
    for (const e of manifest.entries) {
      expect(e.manifestId).toBe(manifest.id);
      expect(e.entityVersionId).toBe(pins.find((p) => p.entityId === e.entityId)!.entityVersionId);
    }
    // created_at: every entry is stamped during the allocating transaction, never decreasing in the order supplied.
    const stored = await prisma.rulesetManifestEntry.findMany({ where: { manifestId: manifest.id }, select: { entityId: true, createdAt: true } });
    const at = new Map(stored.map((s) => [s.entityId, s.createdAt.getTime()]));
    const inInputOrder = pins.map((p) => at.get(p.entityId)!);
    for (let i = 1; i < inInputOrder.length; i += 1) expect(inInputOrder[i]!).toBeGreaterThanOrEqual(inInputOrder[i - 1]!);
    expect(inInputOrder[0]!).toBeGreaterThanOrEqual(before - 1000);
    expect(inInputOrder[N - 1]!).toBeLessThanOrEqual(after + 1000);
    const ctx = await resolveRulesetContextFromManifest(manifest.id);
    expect(ctx.rules.map((x) => [x.entityId, x.entityVersionId])).toEqual([...pins].sort((a, b) => (a.entityId < b.entityId ? -1 : 1)).map((p) => [p.entityId, p.entityVersionId]));
  });

  it("a duplicate Entity reaching the database is the named unique violation, and nothing persists (atomic)", async () => {
    const r = await ruleset("dup");
    const dup = [...pins.slice(0, 10), pins[3]!];
    const error = await prisma.$transaction((tx) => insertManifestSnapshotInTransaction(tx, r.id, dup, null)).then(() => null, (e: unknown) => e);
    expect(isManifestEntryDuplicateViolation(error)).toBe(true);
    expect(await prisma.rulesetManifest.count({ where: { rulesetId: r.id } })).toBe(0);
    await expect(createRulesetManifest(r.id, { entries: [pins[0]!, pins[0]!] })).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.DUPLICATE_ENTITY });
  });

  it("an EntityVersion of another Entity is rejected by the composite foreign key, and nothing persists (atomic)", async () => {
    const r = await ruleset("fk");
    const bad = [...pins.slice(0, 5), { entityId: pins[5]!.entityId, entityVersionId: foreignVersionId }];
    const error = (await prisma.$transaction((tx) => insertManifestSnapshotInTransaction(tx, r.id, bad, null)).then(() => null, (e: unknown) => e)) as { code?: string } | null;
    expect(error).not.toBeNull();
    expect(error?.code).toBe("P2003");
    expect(isManifestEntryDuplicateViolation(error)).toBe(false);
    expect(await prisma.rulesetManifest.count({ where: { rulesetId: r.id } })).toBe(0);
  });

  it("records the local time to create the 242-entry manifest (median of 5)", async () => {
    const r = await ruleset("timing");
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      await createRulesetManifest(r.id, { entries: pins });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    if (process.env.M5_CLOSEOUT_TIMING_OUT) appendFileSync(process.env.M5_CLOSEOUT_TIMING_OUT, `R9_MANIFEST_242_MEDIAN_MS ${Math.round(times[2]!)} ${JSON.stringify(times.map(Math.round))}\n`);
    expect(times).toHaveLength(5);
  });
});
