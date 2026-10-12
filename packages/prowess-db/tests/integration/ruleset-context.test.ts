/**
 * Exact Ruleset resolution — database integration tests (PAS-10 M4-WO2 §39–§54, §74, §81–§84).
 * Runs only against prowess_studio_test (guarded). Torn down in FK order.
 *
 * Invariants guarded here (docs/architecture/m4-exact-ruleset-resolver.md): M4-I16 Exact Manifest Resolution,
 * M4-I17 Exact Release Resolution, M4-I18 Effective Manifest Reuses M2 Inheritance, M4-I19 Release Context Uses Frozen
 * Composition, M4-I20 Release Integrity Verified Before Evaluation, M4-I21 One Entity → One Resolved EntityVersion,
 * M4-I23 Historical Manifest Resolution Is Reproducible, M4-I24 Historical Release Resolution Is Reproducible,
 * M4-I25 Ruleset Resolution Is Read-Only.
 */
import {
  DomainError,
  RULESET_MANIFEST_ERROR_CODES,
  RULESET_RELEASE_ERROR_CODES,
  RULESET_RESOLUTION_ERROR_CODES,
  type CreateChangeSetOperationInput,
} from "@prowess/model";
import { findResolvedRule, findResolvedRuleByCanonicalKey, type RulesetContext } from "@prowess/rules";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  approveChangeSet,
  approveRuleset,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityAlias,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  getEffectiveManifestEntries,
  prisma,
  publishRulesetRelease,
  resolveRulesetContextFromManifest,
  resolveRulesetContextFromRelease,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const MISSING = "00000000-0000-4000-8000-000000000000";
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, opts: { approved?: boolean; parentRulesetId?: string } = {}) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.ctx_${label.toLowerCase()}_${tag}_${next()}`,
    name: `ContextTest ${label}`,
    channel: "CORE_PLAYTEST",
    versionLabel: `label ${label}`,
    ...(opts.parentRulesetId === undefined ? {} : { parentRulesetId: opts.parentRulesetId }),
  });
  rulesetIds.push(r.id);
  if (opts.approved === true) {
    await submitRulesetForReview(r.id);
    await approveRuleset(r.id);
  }
  return r;
}
async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.ctx.${label.toLowerCase()}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}
/** Content-frozen through the normal M1 lifecycle (publication requires it). */
const version = async (entityId: string, name: string) => {
  const v = await createEntityVersion(entityId, { displayName: name });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
};
const draft = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const pin = (entityId: string, entityVersionId: string) => ({ entityId, entityVersionId });
const policy = (rulesetId: string) => createCanonPolicy(rulesetId, { name: `P ${next()}`, authorities: [] });
async function approvedChangeSet(rulesetId: string, operations: CreateChangeSetOperationInput[]) {
  const cs = await createChangeSet(rulesetId, { name: `cs ${next()}`, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  return cs;
}
const versionsOf = (ctx: RulesetContext) => Object.fromEntries(ctx.rules.map((r) => [r.entityId, r.entityVersionId]));

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

/** Every application table, hashed row-by-row in a stable order. */
async function fingerprintAll(): Promise<Record<string, string>> {
  const tables = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`,
  );
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string; n: bigint }>>(
      `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h, count(*) AS n FROM "${t}" x`,
    );
    out[t] = `${row?.n ?? 0}:${row?.h ?? ""}`;
  }
  return out;
}

describe("Exact Ruleset resolution (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.rulesetRelease.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSetOperation.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSet.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonPolicy.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.updateMany({ where: { id: { in: rulesetIds } }, data: { parentRulesetId: null } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityAlias.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entityVersion.updateMany({ where: { entityId: { in: entityIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  describe("M4-I16 / M4-I23 exact Manifest resolution", () => {
    it("maps an exact Manifest to the canonical RulesetContext, and later content never changes it (§7, §16–20, §43)", async () => {
      const r = await ruleset("hist");
      const a = await entity("histA");
      const a1 = await version(a.id, "A1");
      await version(a.id, "A2");
      const m1 = await createRulesetManifest(r.id, { entries: [pin(a.id, a1.id)] });

      const c1 = await resolveRulesetContextFromManifest(m1.id);
      expect(c1).toEqual({
        rulesetId: r.id,
        manifestId: m1.id,
        manifestHash: null, // M2 stores no hash for an unpublished Manifest — none is invented
        rulesetVersionLabel: "label hist",
        release: null,
        rules: [{ entityId: a.id, entityVersionId: a1.id, canonicalKey: a.canonicalKey, entityType: "GENERIC_RULE", sourceRulesetId: r.id, sourceManifestId: m1.id }],
      });
      expect(Object.isFrozen(c1) && Object.isFrozen(c1.rules[0])).toBe(true);
      expect(JSON.parse(JSON.stringify(c1))).toEqual(c1);

      const a3 = await version(a.id, "A3");
      const m2 = await createRulesetManifest(r.id, { entries: [pin(a.id, a3.id)] });
      expect(await resolveRulesetContextFromManifest(m1.id)).toEqual(c1);
      expect(versionsOf(await resolveRulesetContextFromManifest(m2.id))).toEqual({ [a.id]: a3.id });
    });

    it("development content may be exact DRAFT content; no publication rule is imposed (§10)", async () => {
      const r = await ruleset("draft");
      const a = await entity("draftA");
      const d1 = await draft(a.id, "D1");
      const m = await createRulesetManifest(r.id, { entries: [pin(a.id, d1.id)] });
      expect(versionsOf(await resolveRulesetContextFromManifest(m.id))).toEqual({ [a.id]: d1.id });
    });

    it("an empty Manifest resolves to zero rules (§82)", async () => {
      const r = await ruleset("empty");
      const m = await createRulesetManifest(r.id, { entries: [] });
      const ctx = await resolveRulesetContextFromManifest(m.id);
      expect([ctx.manifestId, ctx.rules]).toEqual([m.id, []]);
    });

    it("unknown or malformed ids reuse M2's NOT_FOUND codes (§55)", async () => {
      await expectCode(resolveRulesetContextFromManifest(MISSING), RULESET_MANIFEST_ERROR_CODES.NOT_FOUND);
      await expectCode(resolveRulesetContextFromManifest("not-a-uuid"), RULESET_MANIFEST_ERROR_CODES.NOT_FOUND);
      await expectCode(resolveRulesetContextFromRelease(MISSING), RULESET_RELEASE_ERROR_CODES.NOT_FOUND);
      await expectCode(resolveRulesetContextFromRelease("not-a-uuid"), RULESET_RELEASE_ERROR_CODES.NOT_FOUND);
    });
  });

  describe("M4-I18 effective Manifest reuses M2 inheritance", () => {
    it("C1 inheriting exact P1 resolves A1 inherited + B2 explicit with exact source provenance, and a newer P2 changes nothing (§8–9, §22, §44)", async () => {
      const rp = await ruleset("parent");
      const rc = await ruleset("child", { parentRulesetId: rp.id });
      const [a, b] = [await entity("inhA"), await entity("inhB")];
      const [a1, a3] = [await version(a.id, "A1"), await version(a.id, "A3")];
      const [b1, b2, b3] = [await version(b.id, "B1"), await version(b.id, "B2"), await version(b.id, "B3")];
      const p1 = await createRulesetManifest(rp.id, { entries: [pin(a.id, a1.id), pin(b.id, b1.id)] });
      const c1 = await createRulesetManifest(rc.id, { parentManifestId: p1.id, entries: [pin(b.id, b2.id)] });

      const ctx = await resolveRulesetContextFromManifest(c1.id);
      expect([ctx.rulesetId, ctx.manifestId]).toEqual([rc.id, c1.id]);
      const byEntity = Object.fromEntries(ctx.rules.map((rule) => [rule.entityId, [rule.entityVersionId, rule.sourceRulesetId, rule.sourceManifestId]]));
      expect(byEntity).toEqual({ [a.id]: [a1.id, rp.id, p1.id], [b.id]: [b2.id, rc.id, c1.id] });

      // Identical to what M2's own effective resolver reports — one algorithm, not two.
      const m2 = await getEffectiveManifestEntries(c1.id);
      expect(Object.fromEntries(m2.map((e) => [e.entityId, [e.entityVersionId, e.resolvedFromManifestId]]))).toEqual({
        [a.id]: [a1.id, p1.id],
        [b.id]: [b2.id, c1.id],
      });

      await createRulesetManifest(rp.id, { entries: [pin(a.id, a3.id), pin(b.id, b3.id)] }); // newer parent P2
      expect(await resolveRulesetContextFromManifest(c1.id)).toEqual(ctx);
    });

    it("three inheritance levels keep exact per-entry provenance (§83)", async () => {
      const rg = await ruleset("grand");
      const rp = await ruleset("mid", { parentRulesetId: rg.id });
      const rc = await ruleset("leaf", { parentRulesetId: rp.id });
      const [a, b, c] = [await entity("depA"), await entity("depB"), await entity("depC")];
      const [a1, b1, c1v] = [await version(a.id, "A1"), await version(b.id, "B1"), await version(c.id, "C1")];
      const g1 = await createRulesetManifest(rg.id, { entries: [pin(a.id, a1.id)] });
      const p1 = await createRulesetManifest(rp.id, { parentManifestId: g1.id, entries: [pin(b.id, b1.id)] });
      const leaf = await createRulesetManifest(rc.id, { parentManifestId: p1.id, entries: [pin(c.id, c1v.id)] });
      const ctx = await resolveRulesetContextFromManifest(leaf.id);
      expect(Object.fromEntries(ctx.rules.map((rule) => [rule.entityId, [rule.sourceRulesetId, rule.sourceManifestId]]))).toEqual({
        [a.id]: [rg.id, g1.id],
        [b.id]: [rp.id, p1.id],
        [c.id]: [rc.id, leaf.id],
      });
    });

    it("an inheritance cycle surfaces M2's controlled failure; the resolver never repairs or guesses (§84)", async () => {
      const [r1, r2] = [await ruleset("cy1"), await ruleset("cy2")];
      const m1 = await createRulesetManifest(r1.id, { entries: [] });
      const m2 = await createRulesetManifest(r2.id, { entries: [] });
      // Corrupt the data directly — no supported operation can do this (the M2-WO3 precedent).
      await prisma.rulesetManifest.update({ where: { id: m1.id }, data: { parentManifestId: m2.id } });
      await prisma.rulesetManifest.update({ where: { id: m2.id }, data: { parentManifestId: m1.id } });
      try {
        await expectCode(resolveRulesetContextFromManifest(m1.id), RULESET_MANIFEST_ERROR_CODES.INHERITANCE_CYCLE);
      } finally {
        await prisma.rulesetManifest.updateMany({ where: { id: { in: [m1.id, m2.id] } }, data: { parentManifestId: null } });
      }
    });
  });

  describe("M4-I17 / M4-I19 / M4-I20 / M4-I24 exact Release resolution", () => {
    async function unpublished(label: string) {
      const r = await ruleset(label, { approved: true });
      const [a, b] = [await entity(`${label}A`), await entity(`${label}B`)];
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")];
      const b1 = await version(b.id, "B1");
      const m = await createRulesetManifest(r.id, { entries: [pin(a.id, a1.id), pin(b.id, b1.id)] });
      const p = await policy(r.id);
      return { r, a, b, a1, a2, b1, m, p };
    }
    async function published(label: string) {
      const w = await unpublished(label);
      const r1 = await publishRulesetRelease({ rulesetId: w.r.id, baseManifestId: w.m.id, canonPolicyId: w.p.id, versionLabel: `${label} 1` });
      return { ...w, r1 };
    }

    it("maps an exact Release, verbatim hash and identity included, and later releases never change it (§11, §18, §45)", async () => {
      const w = await published("relhist");
      const x = await resolveRulesetContextFromRelease(w.r1.id);
      expect(x).toEqual({
        rulesetId: w.r.id,
        manifestId: w.r1.manifestId,
        manifestHash: w.r1.manifestHash,
        rulesetVersionLabel: "label relhist",
        release: { releaseId: w.r1.id, releaseNumber: 1, versionLabel: "relhist 1" },
        rules: [w.a, w.b]
          .map((e) => ({
            entityId: e.id,
            entityVersionId: e.id === w.a.id ? w.a1.id : w.b1.id,
            canonicalKey: e.canonicalKey,
            entityType: "GENERIC_RULE",
            sourceRulesetId: w.r.id,
            sourceManifestId: w.r1.manifestId,
          }))
          .sort((p, q) => (p.entityId < q.entityId ? -1 : 1)),
      });

      const a3 = await version(w.a.id, "A3");
      const cs = await approvedChangeSet(w.r.id, [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: w.a.id, fromEntityVersionId: w.a1.id, toEntityVersionId: a3.id }]);
      const r2 = await publishRulesetRelease({ rulesetId: w.r.id, baseManifestId: w.r1.manifestId, canonPolicyId: w.p.id, changeSetId: cs.id, versionLabel: "relhist 2" });
      expect(versionsOf(await resolveRulesetContextFromRelease(r2.id))[w.a.id]).toBe(a3.id);
      expect(await resolveRulesetContextFromRelease(w.r1.id)).toEqual(x); // R1 never becomes R2
    });

    it("uses the FROZEN release composition, not what its base Manifest resolves to (§12, §47–48)", async () => {
      // The FIRST release applies a ChangeSet (A1 → A2) to base Manifest M, so its frozen composition and M's live
      // effective composition genuinely diverge — a resolver that re-derived the release from M would be caught.
      const w = await unpublished("frozen");
      const cs = await approvedChangeSet(w.r.id, [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: w.a.id, fromEntityVersionId: w.a1.id, toEntityVersionId: w.a2.id }]);
      const r2 = await publishRulesetRelease({ rulesetId: w.r.id, baseManifestId: w.m.id, canonPolicyId: w.p.id, changeSetId: cs.id, versionLabel: "frozen 1" });

      const release = await resolveRulesetContextFromRelease(r2.id);
      const baseManifest = await resolveRulesetContextFromManifest(w.m.id);
      expect(versionsOf(release)[w.a.id]).toBe(w.a2.id); // the release's own composition
      expect(versionsOf(baseManifest)[w.a.id]).toBe(w.a1.id); // what the live base manifest says
      expect(release.manifestId).toBe(r2.manifestId);
      expect(release.manifestId).not.toBe(w.m.id);

      // Development content advances; the published release stays frozen.
      const a4 = await version(w.a.id, "A4");
      const dev = await createRulesetManifest(w.r.id, { entries: [pin(w.a.id, a4.id), pin(w.b.id, w.b1.id)] });
      expect(versionsOf(await resolveRulesetContextFromManifest(dev.id))[w.a.id]).toBe(a4.id);
      expect(await resolveRulesetContextFromRelease(r2.id)).toEqual(release);
    });

    it("refuses a tampered Release: integrity fails, no context; restored, it resolves identically again (§13, §46)", async () => {
      const w = await published("tamper");
      const before = await resolveRulesetContextFromRelease(w.r1.id);
      const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: w.r1.manifestId, entityId: w.a.id } });
      try {
        await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${w.a2.id}::uuid WHERE id = ${entry.id}::uuid`; // test-only corruption
        await expectCode(resolveRulesetContextFromRelease(w.r1.id), RULESET_RESOLUTION_ERROR_CODES.RELEASE_INTEGRITY_FAILURE);
      } finally {
        await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
      }
      expect(await resolveRulesetContextFromRelease(w.r1.id)).toEqual(before);
    });
  });

  describe("M4-I21 one Entity → one EntityVersion, owned by that Entity", () => {
    it("the database refuses a cross-Entity composition outright, so it can never reach a context (§21)", async () => {
      const r = await ruleset("cross");
      const [a, b] = [await entity("crossA"), await entity("crossB")];
      const [a1, b1] = [await version(a.id, "A1"), await version(b.id, "B1")];
      const m = await createRulesetManifest(r.id, { entries: [pin(a.id, a1.id)] });
      const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: m.id } });
      await expect(prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${b1.id}::uuid WHERE id = ${entry.id}::uuid`).rejects.toThrow();
      expect(versionsOf(await resolveRulesetContextFromManifest(m.id))).toEqual({ [a.id]: a1.id });
    });
  });

  describe("Ruleset isolation", () => {
    it("two Rulesets pinning different versions of one Entity resolve independently (§49)", async () => {
      const [rx, ry] = [await ruleset("isoX"), await ruleset("isoY")];
      const a = await entity("isoA");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")];
      const mx = await createRulesetManifest(rx.id, { entries: [pin(a.id, a1.id)] });
      const my = await createRulesetManifest(ry.id, { entries: [pin(a.id, a2.id)] });
      expect(versionsOf(await resolveRulesetContextFromManifest(mx.id))).toEqual({ [a.id]: a1.id });
      expect(versionsOf(await resolveRulesetContextFromManifest(my.id))).toEqual({ [a.id]: a2.id });
    });

    it("the same exact version in two Rulesets gives equal rules but distinct Ruleset / Manifest provenance (§50)", async () => {
      const [rx, rw] = [await ruleset("sameX"), await ruleset("sameW")];
      const a = await entity("sameA");
      const a1 = await version(a.id, "A1");
      const x = await resolveRulesetContextFromManifest((await createRulesetManifest(rx.id, { entries: [pin(a.id, a1.id)] })).id);
      const w = await resolveRulesetContextFromManifest((await createRulesetManifest(rw.id, { entries: [pin(a.id, a1.id)] })).id);
      expect(versionsOf(x)).toEqual(versionsOf(w));
      expect(x.rulesetId).not.toBe(w.rulesetId);
      expect(x.manifestId).not.toBe(w.manifestId);
      expect(x).not.toEqual(w);
    });
  });

  describe("pure lookups on a resolved context (§51, §53)", () => {
    it("finds by exact Entity id and exact canonical key; aliases, display names and case changes never match; absence never falls back", async () => {
      const r = await ruleset("lookup");
      const [a, other] = [await entity("lookA"), await entity("lookOther")];
      const a1 = await version(a.id, "Readable Display Name");
      await version(other.id, "O1");
      await createEntityAlias(a.id, { alias: "Friendly Alias" });
      const ctx = await resolveRulesetContextFromManifest((await createRulesetManifest(r.id, { entries: [pin(a.id, a1.id)] })).id);

      expect(findResolvedRule(ctx, a.id)?.entityVersionId).toBe(a1.id);
      expect(findResolvedRuleByCanonicalKey(ctx, a.canonicalKey)?.entityVersionId).toBe(a1.id);
      for (const miss of [a.canonicalKey.toUpperCase(), "Friendly Alias", "friendly alias", "Readable Display Name"]) {
        expect(findResolvedRuleByCanonicalKey(ctx, miss), miss).toBeNull();
      }
      // `other` exists with versions, but is not part of this Ruleset: absent — no latest / Canon fallback.
      expect(findResolvedRule(ctx, other.id)).toBeNull();
      expect(findResolvedRuleByCanonicalKey(ctx, other.canonicalKey)).toBeNull();
    });
  });

  describe("M4-I25 read-only, deterministic resolution (§39–40, §74)", () => {
    it("resolving Manifests (with inheritance) and Releases repeatedly leaves every table byte-identical and returns deep-equal contexts", async () => {
      const rp = await ruleset("roP", { approved: true });
      const rc = await ruleset("roC", { parentRulesetId: rp.id });
      const [a, b] = [await entity("roA"), await entity("roB")];
      const [a1, b1] = [await version(a.id, "A1"), await version(b.id, "B1")];
      const pm = await createRulesetManifest(rp.id, { entries: [pin(b.id, b1.id), pin(a.id, a1.id)] });
      const cm = await createRulesetManifest(rc.id, { parentManifestId: pm.id, entries: [] });
      const rel = await publishRulesetRelease({ rulesetId: rp.id, baseManifestId: pm.id, canonPolicyId: (await policy(rp.id)).id, versionLabel: "ro 1" });

      const before = await fingerprintAll();
      const firstManifest = JSON.stringify(await resolveRulesetContextFromManifest(cm.id));
      const firstRelease = JSON.stringify(await resolveRulesetContextFromRelease(rel.id));
      for (let i = 0; i < 5; i += 1) {
        expect(JSON.stringify(await resolveRulesetContextFromManifest(cm.id))).toBe(firstManifest);
        expect(JSON.stringify(await resolveRulesetContextFromRelease(rel.id))).toBe(firstRelease);
      }
      expect(await fingerprintAll()).toEqual(before);
    });
  });

  describe("performance sanity — no N+1 (§38, §81)", () => {
    it("a 1,200-entry Manifest resolves with the same number of queries as a 2-entry one", async () => {
      const r = await ruleset("bulk");
      const N = 1200;
      const keys = Array.from({ length: N }, (_, i) => `test.ctx.bulk_${tag}_${String(i).padStart(4, "0")}`);
      await prisma.entity.createMany({ data: keys.map((canonicalKey) => ({ entityType: "GENERIC_RULE" as const, canonicalKey })) });
      const bulk = await prisma.entity.findMany({ where: { canonicalKey: { in: keys } }, select: { id: true } });
      entityIds.push(...bulk.map((e) => e.id));
      await prisma.entityVersion.createMany({ data: bulk.map((e) => ({ entityId: e.id, revisionNumber: 1, displayName: "bulk" })) });
      const versions = await prisma.entityVersion.findMany({ where: { entityId: { in: bulk.map((e) => e.id) } }, select: { id: true, entityId: true } });
      const big = await createRulesetManifest(r.id, { entries: versions.map((v) => pin(v.entityId, v.id)) });
      const small = await createRulesetManifest(r.id, { entries: versions.slice(0, 2).map((v) => pin(v.entityId, v.id)) });

      const count = async (manifestId: string) => {
        const spies = [vi.spyOn(prisma.entity, "findMany"), vi.spyOn(prisma.entityVersion, "findMany"), vi.spyOn(prisma.entityVersion, "findUnique"), vi.spyOn(prisma.entity, "findUnique"), vi.spyOn(prisma.rulesetManifestEntry, "findMany"), vi.spyOn(prisma.rulesetManifestEntry, "findUnique")];
        try {
          const ctx = await resolveRulesetContextFromManifest(manifestId);
          return { rules: ctx.rules.length, calls: spies.map((s) => s.mock.calls.length) };
        } finally {
          for (const s of spies) s.mockRestore();
        }
      };
      const bigResult = await count(big.id);
      const smallResult = await count(small.id);
      expect(bigResult.rules).toBe(N);
      expect(smallResult.rules).toBe(2);
      expect(bigResult.calls).toEqual(smallResult.calls);
      expect(bigResult.calls.reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(6);
    });
  });
});
