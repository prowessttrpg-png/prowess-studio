/**
 * Ruleset inheritance & effective resolution — database integration tests
 * (PAS-10 M2-WO3 §8–§43).
 *
 * Runs only against prowess_studio_test (guarded). Every row is tracked by id and
 * torn down in foreign-key order. Manifest parents are RESTRICT foreign keys, so a
 * manifest's parent pointer is nulled before any manifest is deleted.
 */
import { DomainError, RULESET_MANIFEST_ERROR_CODES, SOURCE_DOCUMENT_TYPES, type CreateRulesetManifestInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceReference,
  getEffectiveManifestEntries,
  getLatestEntityVersion,
  getLatestRulesetManifest,
  getRulesetManifest,
  prisma,
  resolveEffectiveEntityVersion,
  resolveEntityVersionFromManifest,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const MISSING = "00000000-0000-4000-8000-000000000000";
const SOURCE_TITLE_PREFIX = "InheritTest ";
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, parentRulesetId?: string) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.inh_${label}_${tag}_${next()}`,
    name: `InheritTest ${label}`,
    channel: "DEVELOPMENT",
    ...(parentRulesetId === undefined ? {} : { parentRulesetId }),
  });
  rulesetIds.push(r.id);
  return r;
}

async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.inherit.${label}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}

const version = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const pin = (entityId: string, entityVersionId: string) => ({ entityId, entityVersionId });
type Resolved = Awaited<ReturnType<typeof resolveEffectiveEntityVersion>>;
const trace = (r: Resolved) => (r === null ? null : { version: r.entityVersionId, from: r.resolvedFromManifestId, depth: r.resolutionDepth, source: r.source });
const counts = async (rulesetId: string, ids: string[]) => ({
  manifests: await prisma.rulesetManifest.count({ where: { rulesetId } }),
  entries: await prisma.rulesetManifestEntry.count({ where: { entityId: { in: ids } } }),
});

describe("Ruleset inheritance (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.updateMany({ where: { id: { in: rulesetIds } }, data: { parentRulesetId: null } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    const versions = await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } });
    const versionIds = versions.map((v: { id: string }) => v.id);
    await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.sourceDocument.deleteMany({ where: { title: { startsWith: SOURCE_TITLE_PREFIX } } });
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  describe("historical reproducibility (§1, §8, §34–§36)", () => {
    it("a child manifest keeps resolving through the EXACT parent manifest it pinned, however many newer ones appear (§8, §36)", async () => {
      const parent = await ruleset("hp");
      const child = await ruleset("hc", parent.id);
      const a = await entity("hist");
      const a1 = await version(a.id, "A1");

      const p1 = await createRulesetManifest(parent.id, { entries: [pin(a.id, a1.id)] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [] });

      const a2 = await version(a.id, "A2");
      const p2 = await createRulesetManifest(parent.id, { entries: [pin(a.id, a2.id)] });
      expect((await getLatestRulesetManifest(parent.id))?.id).toBe(p2.id); // the parent's LATEST manifest really is P2...
      expect((await getLatestEntityVersion(a.id))?.id).toBe(a2.id); // ...and so is the Entity's latest version

      // ...yet C1, which pinned P1, still resolves A1 from P1 — never A2.
      expect(trace(await resolveEffectiveEntityVersion(c1.id, a.id))).toEqual({ version: a1.id, from: p1.id, depth: 1, source: "INHERITED" });
      expect((await getRulesetManifest(c1.id)).parentManifestId).toBe(p1.id); // the pin itself never moved

      // A new child manifest pinned to P2 resolves A2: inheritance history is reproducible, not frozen.
      const c2 = await createRulesetManifest(child.id, { parentManifestId: p2.id, entries: [] });
      expect(trace(await resolveEffectiveEntityVersion(c2.id, a.id))).toEqual({ version: a2.id, from: p2.id, depth: 1, source: "INHERITED" });
      expect(trace(await resolveEffectiveEntityVersion(c1.id, a.id))?.version).toBe(a1.id); // and C1 is still A1
    });

    it("effective resolution is stable: the same call against unchanged data returns identical output (§43)", async () => {
      const parent = await ruleset("sp");
      const child = await ruleset("sc", parent.id);
      const [a, b] = [await entity("sta"), await entity("stb")] as const;
      const [a1, b1] = [await version(a.id, "A1"), await version(b.id, "B1")] as const;
      const p1 = await createRulesetManifest(parent.id, { entries: [pin(b.id, b1.id), pin(a.id, a1.id)] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [] });
      const first = await getEffectiveManifestEntries(c1.id);
      for (let i = 0; i < 3; i += 1) expect(await getEffectiveManifestEntries(c1.id)).toEqual(first);
      expect(first).toHaveLength(2);
      expect(trace(await resolveEffectiveEntityVersion(c1.id, a.id))).toEqual(trace(await resolveEffectiveEntityVersion(c1.id, a.id)));
    });
  });

  describe("override precedence and recursion (§9–§11, §37–§38, §42)", () => {
    it("an explicit child pin overrides the inherited one; everything else is inherited at depth 1 (§9, §37)", async () => {
      const parent = await ruleset("op");
      const child = await ruleset("oc", parent.id);
      const [a, b] = [await entity("ova"), await entity("ovb")] as const;
      const a1 = await version(a.id, "A1");
      const a2 = await version(a.id, "A2");
      const b1 = await version(b.id, "B1");
      const p1 = await createRulesetManifest(parent.id, { entries: [pin(a.id, a1.id), pin(b.id, b1.id)] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [pin(a.id, a2.id)] });

      expect(trace(await resolveEffectiveEntityVersion(c1.id, a.id))).toEqual({ version: a2.id, from: c1.id, depth: 0, source: "EXPLICIT" });
      expect(trace(await resolveEffectiveEntityVersion(c1.id, b.id))).toEqual({ version: b1.id, from: p1.id, depth: 1, source: "INHERITED" });
    });

    it("resolves recursively across three Ruleset levels with the right depth for each (§10, §38)", async () => {
      const g = await ruleset("mg");
      const p = await ruleset("mp", g.id);
      const c = await ruleset("mc", p.id);
      const [a, b, cc] = [await entity("mla"), await entity("mlb"), await entity("mlc")] as const;
      const a1 = await version(a.id, "A1");
      const b1 = await version(b.id, "B1");
      const b2 = await version(b.id, "B2");
      const c1 = await version(cc.id, "C1");
      const c2 = await version(cc.id, "C2");
      const g1 = await createRulesetManifest(g.id, { entries: [pin(a.id, a1.id), pin(b.id, b1.id), pin(cc.id, c1.id)] });
      const p1 = await createRulesetManifest(p.id, { parentManifestId: g1.id, entries: [pin(b.id, b2.id)] });
      const ch1 = await createRulesetManifest(c.id, { parentManifestId: p1.id, entries: [pin(cc.id, c2.id)] });

      expect(trace(await resolveEffectiveEntityVersion(ch1.id, a.id))).toEqual({ version: a1.id, from: g1.id, depth: 2, source: "INHERITED" });
      expect(trace(await resolveEffectiveEntityVersion(ch1.id, b.id))).toEqual({ version: b2.id, from: p1.id, depth: 1, source: "INHERITED" });
      expect(trace(await resolveEffectiveEntityVersion(ch1.id, cc.id))).toEqual({ version: c2.id, from: ch1.id, depth: 0, source: "EXPLICIT" });
      const result = await resolveEffectiveEntityVersion(ch1.id, a.id);
      expect(result?.requestedManifestId).toBe(ch1.id);
    });

    it("the flattened effective composition: one result per Entity, nearest wins, provenance kept, ordered by canonical key (§18, §20, §21, §42)", async () => {
      const g = await ruleset("eg");
      const p = await ruleset("ep", g.id);
      const c = await ruleset("ec", p.id);
      // Created out of key order (d, b, a, c) so that creation order cannot explain a sorted result.
      const d = await entity("d");
      const b = await entity("b");
      const a = await entity("a");
      const cc = await entity("c");
      const a1 = await version(a.id, "A1");
      const b1 = await version(b.id, "B1");
      const b2 = await version(b.id, "B2");
      const c1 = await version(cc.id, "C1");
      const c2 = await version(cc.id, "C2");
      const d1 = await version(d.id, "D1");

      const g1 = await createRulesetManifest(g.id, { entries: [pin(b.id, b1.id), pin(a.id, a1.id)] });
      const p1 = await createRulesetManifest(p.id, { parentManifestId: g1.id, entries: [pin(cc.id, c1.id), pin(b.id, b2.id)] });
      const ch1 = await createRulesetManifest(c.id, { parentManifestId: p1.id, entries: [pin(d.id, d1.id), pin(cc.id, c2.id)] });

      const effective = await getEffectiveManifestEntries(ch1.id);
      expect(effective.map((r) => [r.entityId, r.entityVersionId, r.resolvedFromManifestId, r.resolutionDepth, r.source])).toEqual([
        [a.id, a1.id, g1.id, 2, "INHERITED"],
        [b.id, b2.id, p1.id, 1, "INHERITED"],
        [cc.id, c2.id, ch1.id, 0, "EXPLICIT"],
        [d.id, d1.id, ch1.id, 0, "EXPLICIT"],
      ]);
      expect(new Set(effective.map((r) => r.entityId)).size).toBe(effective.length); // no duplicate Entity
      expect(effective.every((r) => r.requestedManifestId === ch1.id)).toBe(true);
    });

    it("for a manifest that inherits nothing, the effective order equals the manifest's own entry order (§20, the M2-WO2 convention)", async () => {
      const r = await ruleset("ordr");
      const cc = await entity("c");
      const a = await entity("a");
      const b = await entity("b");
      const [c1, a1, b1] = [await version(cc.id, "C1"), await version(a.id, "A1"), await version(b.id, "B1")] as const;
      const m = await createRulesetManifest(r.id, { entries: [pin(cc.id, c1.id), pin(a.id, a1.id), pin(b.id, b1.id)] }); // input order c, a, b

      const own = (await getRulesetManifest(m.id)).entries.map((e) => e.entityId);
      const effective = (await getEffectiveManifestEntries(m.id)).map((e) => e.entityId);
      expect(effective).toEqual(own);
      expect(effective).toEqual([a.id, b.id, cc.id]); // genuinely sorted, not input order
      expect((await getEffectiveManifestEntries(m.id)).every((e) => e.resolutionDepth === 0 && e.source === "EXPLICIT")).toBe(true);
    });

    it("an empty manifest has an empty effective composition", async () => {
      const r = await ruleset("emptyeff");
      const m = await createRulesetManifest(r.id, { entries: [] });
      expect(await getEffectiveManifestEntries(m.id)).toEqual([]);
    });
  });

  describe("lineage alone never activates inheritance (§5, §39)", () => {
    it("a child manifest with no parentManifestId inherits nothing even though its Ruleset has a parent", async () => {
      const parent = await ruleset("np");
      const child = await ruleset("nc", parent.id);
      const a = await entity("noinh");
      const a1 = await version(a.id, "A1");
      await createRulesetManifest(parent.id, { entries: [pin(a.id, a1.id)] });
      const c1 = await createRulesetManifest(child.id, { entries: [] });

      expect(c1.parentManifestId).toBeNull();
      expect(await resolveEffectiveEntityVersion(c1.id, a.id)).toBeNull();
      expect(await getEffectiveManifestEntries(c1.id)).toEqual([]);
    });

    it("the earlier local operations still see only a manifest's own entries (inheritance is a separate, explicit operation)", async () => {
      const parent = await ruleset("lp");
      const child = await ruleset("lc", parent.id);
      const a = await entity("local");
      const a1 = await version(a.id, "A1");
      const p1 = await createRulesetManifest(parent.id, { entries: [pin(a.id, a1.id)] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [] });

      expect(await resolveEntityVersionFromManifest(c1.id, a.id)).toBeNull(); // local: not pinned HERE
      expect((await resolveEffectiveEntityVersion(c1.id, a.id))?.entityVersionId).toBe(a1.id); // effective: inherited
    });
  });

  describe("parent-manifest validation (§3, §4, §11, §24, §26, §40, §41)", () => {
    it("rejects a manifest belonging to an unrelated Ruleset, persisting nothing (§40)", async () => {
      const parent = await ruleset("wp");
      const child = await ruleset("wc", parent.id);
      const other = await ruleset("wq");
      const q1 = await createRulesetManifest(other.id, { entries: [] });
      await expect(createRulesetManifest(child.id, { parentManifestId: q1.id, entries: [] })).rejects.toMatchObject({
        code: RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST,
      });
      expect(await prisma.rulesetManifest.count({ where: { rulesetId: child.id } })).toBe(0);
    });

    it("rejects skipping a level: a child may reference only its DIRECT parent's manifest, not the grandparent's (§11)", async () => {
      const g = await ruleset("sg");
      const p = await ruleset("sp", g.id);
      const c = await ruleset("sc", p.id);
      const g1 = await createRulesetManifest(g.id, { entries: [] });
      await expect(createRulesetManifest(c.id, { parentManifestId: g1.id, entries: [] })).rejects.toMatchObject({
        code: RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST,
      });
      expect(await prisma.rulesetManifest.count({ where: { rulesetId: c.id } })).toBe(0);
    });

    it("rejects a nonexistent or malformed parent manifest id", async () => {
      const parent = await ruleset("mp2");
      const child = await ruleset("mc2", parent.id);
      for (const id of [MISSING, "not-a-uuid"]) {
        await expect(createRulesetManifest(child.id, { parentManifestId: id, entries: [] }), id).rejects.toMatchObject({
          code: RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST,
        });
      }
      await expect(
        createRulesetManifest(child.id, { parentManifestId: "   ", entries: [] }),
      ).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.INVALID_INPUT });
      expect(await prisma.rulesetManifest.count({ where: { rulesetId: child.id } })).toBe(0);
    });

    it("a root Ruleset (no parent) cannot inherit at all (§4, §41)", async () => {
      const root = await ruleset("root");
      const other = await ruleset("rootother");
      const m = await createRulesetManifest(other.id, { entries: [] });
      const attempt = createRulesetManifest(root.id, { parentManifestId: m.id, entries: [] });
      await expect(attempt).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST });
      await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
      expect(await prisma.rulesetManifest.count({ where: { rulesetId: root.id } })).toBe(0);
    });

    it("is atomic: a bad parent with valid entries, or a bad entry with a valid parent, leaves zero manifests and zero entries (§26)", async () => {
      const parent = await ruleset("atp");
      const child = await ruleset("atc", parent.id);
      const a = await entity("at");
      const b = await entity("atb");
      const a1 = await version(a.id, "A1");
      const b1 = await version(b.id, "B1");
      const p1 = await createRulesetManifest(parent.id, { entries: [] });
      const baseline = await counts(child.id, [a.id, b.id]);

      await expect(createRulesetManifest(child.id, { parentManifestId: MISSING, entries: [pin(a.id, a1.id)] })).rejects.toMatchObject({
        code: RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST,
      });
      await expect(
        createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [pin(a.id, a1.id), pin(a.id, b1.id)] }),
      ).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.DUPLICATE_ENTITY });
      await expect(
        createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [pin(a.id, a1.id), pin(b.id, a1.id)] }),
      ).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.VERSION_ENTITY_MISMATCH });
      expect(await counts(child.id, [a.id, b.id])).toEqual(baseline);
    });

    it("rejects a smuggled manifestVersion and still never lets a caller pick one", async () => {
      const parent = await ruleset("smp");
      const child = await ruleset("smc", parent.id);
      const p1 = await createRulesetManifest(parent.id, { entries: [] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, manifestVersion: 42, entries: [] } as unknown as CreateRulesetManifestInput);
      expect(c1.manifestVersion).toBe(1);
    });
  });

  describe("concurrency (§27)", () => {
    it("concurrent child manifests pointing at the same valid parent manifest all succeed with distinct versions", async () => {
      const parent = await ruleset("cp");
      const child = await ruleset("cc", parent.id);
      const p1 = await createRulesetManifest(parent.id, { entries: [] });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [] })),
      );
      expect(results.map((m) => m.manifestVersion).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
      expect(results.every((m) => m.parentManifestId === p1.id)).toBe(true);
      expect(await prisma.rulesetManifest.count({ where: { parentManifestId: p1.id } })).toBe(5);
    });
  });

  describe("cycle defense (§12, §25)", () => {
    it("terminates with INHERITANCE_CYCLE when stored data contains a loop — a two-manifest loop and a self-loop", async () => {
      const r1 = await ruleset("cy1");
      const r2 = await ruleset("cy2");
      const a = await entity("cyc");
      const a1 = await version(a.id, "A1");
      const m1 = await createRulesetManifest(r1.id, { entries: [] });
      const m2 = await createRulesetManifest(r2.id, { entries: [] });

      // Sane before corruption: neither inherits.
      expect(await resolveEffectiveEntityVersion(m1.id, a.id)).toBeNull();

      // Corrupt the data directly — no supported operation can do this.
      await prisma.rulesetManifest.update({ where: { id: m1.id }, data: { parentManifestId: m2.id } });
      await prisma.rulesetManifest.update({ where: { id: m2.id }, data: { parentManifestId: m1.id } });
      await expect(resolveEffectiveEntityVersion(m1.id, a.id)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.INHERITANCE_CYCLE });
      await expect(getEffectiveManifestEntries(m2.id)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.INHERITANCE_CYCLE });

      const r3 = await ruleset("cy3");
      const m3 = await createRulesetManifest(r3.id, { entries: [pin(a.id, a1.id)] });
      await prisma.rulesetManifest.update({ where: { id: m3.id }, data: { parentManifestId: m3.id } });
      await expect(resolveEffectiveEntityVersion(m3.id, MISSING)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.INHERITANCE_CYCLE });
    });
  });

  describe("absence and errors (§22, §23)", () => {
    it("an Entity pinned nowhere in the chain is null, not an error; an unknown manifest is NOT_FOUND", async () => {
      const parent = await ruleset("abp");
      const child = await ruleset("abc", parent.id);
      const a = await entity("abs");
      const p1 = await createRulesetManifest(parent.id, { entries: [] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [] });

      expect(await resolveEffectiveEntityVersion(c1.id, a.id)).toBeNull();
      expect(await resolveEffectiveEntityVersion(c1.id, "not-a-uuid")).toBeNull();
      for (const id of [MISSING, "not-a-uuid"]) {
        await expect(resolveEffectiveEntityVersion(id, a.id), id).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.NOT_FOUND });
        await expect(getEffectiveManifestEntries(id), id).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.NOT_FOUND });
      }
    });
  });

  describe("no implicit selection (§15–§17, §30–§31, §34–§35)", () => {
    it("lifecycle status does not alter resolution: an explicit DRAFT child pin beats an inherited CANON pin (§30)", async () => {
      const parent = await ruleset("lsp");
      const child = await ruleset("lsc", parent.id);
      const a = await entity("lifecycle");
      const a1 = await version(a.id, "A1 (CANON)");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, status);
      const a2 = await version(a.id, "A2 (draft)");
      const p1 = await createRulesetManifest(parent.id, { entries: [pin(a.id, a1.id)] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [pin(a.id, a2.id)] });
      const c2 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [] });

      expect(trace(await resolveEffectiveEntityVersion(c1.id, a.id))).toEqual({ version: a2.id, from: c1.id, depth: 0, source: "EXPLICIT" });
      expect((await resolveEffectiveEntityVersion(c2.id, a.id))?.entityVersionId).toBe(a1.id); // and the CANON one is simply inherited
    });

    it("Source authority does not enter resolution: an explicit pin of a REFERENCE_ONLY-sourced Version beats an inherited GOVERNING one (§31)", async () => {
      const parent = await ruleset("ssp");
      const child = await ruleset("ssc", parent.id);
      const a = await entity("source");
      const a1 = await version(a.id, "A1");
      const a2 = await version(a.id, "A2");
      const sourceType: string = SOURCE_DOCUMENT_TYPES[0];
      const governing = await createSourceDocument({ title: `${SOURCE_TITLE_PREFIX}governing ${tag}_${next()}`, sourceType, authorityStatus: "GOVERNING" });
      const refOnly = await createSourceDocument({ title: `${SOURCE_TITLE_PREFIX}reference ${tag}_${next()}`, sourceType, authorityStatus: "REFERENCE_ONLY" });
      await createSourceReference(a1.id, { sourceDocumentId: governing.id });
      await createSourceReference(a2.id, { sourceDocumentId: refOnly.id });
      const p1 = await createRulesetManifest(parent.id, { entries: [pin(a.id, a1.id)] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [pin(a.id, a2.id)] });
      expect((await resolveEffectiveEntityVersion(c1.id, a.id))?.entityVersionId).toBe(a2.id);
    });

    it("exposes exactly two inheritance operations and none that changes a manifest's parent, entries, or version (§7, §44)", async () => {
      const surface = await import("../../src/index");
      const names = Object.keys(surface);
      expect(names.filter((n) => /effective/i.test(n)).sort()).toEqual(["getEffectiveManifestEntries", "resolveEffectiveEntityVersion"]);
      expect(names.filter((n) => /(setParentManifest|changeInheritedManifest|rebaseManifest|updateManifest|setManifest|reparent)/i.test(n))).toEqual([]);
    });
  });

  describe("the database enforces what it can (§13, §28, §29, §45, §46)", () => {
    it("a parent manifest cannot be physically deleted while a child manifest points at it (RESTRICT) (§28)", async () => {
      const parent = await ruleset("dp");
      const child = await ruleset("dc", parent.id);
      // The parent manifest is EMPTY on purpose: with no entries, the only foreign key that can refuse
      // the delete is the new self-reference — so this test proves THAT constraint, not another.
      const p1 = await createRulesetManifest(parent.id, { entries: [] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [] });

      await expect(prisma.rulesetManifest.delete({ where: { id: p1.id } })).rejects.toThrow(/ruleset_manifests_parent_manifest_id_fkey/);
      expect((await getRulesetManifest(c1.id)).parentManifestId).toBe(p1.id); // the inheritance survived the attempt
      expect((await getRulesetManifest(p1.id)).id).toBe(p1.id);
    });

    it("the existing protections still hold: a parent Ruleset with manifests and a child Ruleset cannot be deleted (§29)", async () => {
      const parent = await ruleset("rp");
      const child = await ruleset("rc", parent.id);
      await createRulesetManifest(parent.id, { entries: [] });
      await expect(prisma.ruleset.delete({ where: { id: parent.id } })).rejects.toThrow();
      expect((await prisma.ruleset.findUnique({ where: { id: child.id } }))?.parentRulesetId).toBe(parent.id);
    });

    it("the self-reference, its column, and its RESTRICT rule are what the design says; the column is the table's only new one", async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.key_column_usage
        WHERE constraint_name = 'ruleset_manifests_parent_manifest_id_fkey' ORDER BY ordinal_position`;
      expect(columns.map((c) => c.column_name)).toEqual(["parent_manifest_id"]);

      const rule = await prisma.$queryRaw<Array<{ delete_rule: string }>>`
        SELECT delete_rule FROM information_schema.referential_constraints
        WHERE constraint_name = 'ruleset_manifests_parent_manifest_id_fkey'`;
      expect(rule.map((r) => r.delete_rule)).toEqual(["RESTRICT"]);

      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ruleset_manifests' ORDER BY column_name`;
      expect(cols.map((c) => c.column_name)).toEqual(["created_at", "id", "manifest_version", "parent_manifest_id", "ruleset_id"]);
    });

    it("no flattened or derived effective state is persisted anywhere, and nothing dynamic-parent-shaped exists (§19)", async () => {
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND (table_name ILIKE '%effective%' OR table_name ILIKE '%flatten%' OR table_name ILIKE '%resolution%')`;
      expect(tables).toEqual([]);
      const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~* '(inherit_latest|use_parent_latest|dynamic_parent|current_parent_manifest|parent_ruleset_latest|parent_latest)'`;
      expect(columns).toEqual([]);
    });

    it("the M2-WO3 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261005120000_add_manifest_inheritance'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });
  });
});
