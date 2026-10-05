/**
 * RulesetManifest — database integration tests (PAS-10 M2-WO2 §27–§39).
 *
 * Runs only against prowess_studio_test (guarded). Every row is tracked by id
 * and torn down in foreign-key order (entries -> manifests -> rulesets -> source
 * rows -> versions -> entities): an incomplete cleanup here would poison every
 * later file's prefix-wide cleanup.
 */
import { RULESET_MANIFEST_ERROR_CODES, SOURCE_DOCUMENT_TYPES, DomainError, type CreateRulesetManifestInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceReference,
  getLatestEntityVersion,
  getLatestRulesetManifest,
  getManifestEntry,
  getRulesetManifest,
  listRulesetManifests,
  prisma,
  resolveEntityVersionFromManifest,
  transitionEntityVersionStatus,
} from "../../src/index";
import { insertRulesetManifestWithEntries } from "../../src/ruleset-manifest/repository";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = "00000000-0000-4000-8000-000000000000";
const SOURCE_TITLE_PREFIX = "ManifestTest ";
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, over: { parentRulesetId?: string } = {}) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.mf_${label}_${tag}_${next()}`,
    name: `ManifestTest ${label}`,
    channel: "DEVELOPMENT",
    ...over,
  });
  rulesetIds.push(r.id);
  return r;
}

async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.manifest.${label}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}

const version = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const pins = (m: { entries: Array<{ entityId: string; entityVersionId: string }> }) =>
  m.entries.map((e) => [e.entityId, e.entityVersionId]);
const counts = async (rulesetId: string, ids: string[]) => ({
  manifests: await prisma.rulesetManifest.count({ where: { rulesetId } }),
  entries: await prisma.rulesetManifestEntry.count({ where: { entityId: { in: ids } } }),
});

describe("RulesetManifest (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
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

  describe("snapshots, exact pinning, and history (§27–§30, §36)", () => {
    it("creates Manifest 1 with exactly the supplied membership, ordered by Entity canonical key (§27, §39)", async () => {
      const r = await ruleset("basic");
      const b = await entity("b"); // created FIRST, so insertion order and key order disagree
      const a = await entity("a");
      const a1 = await version(a.id, "A rev 1");
      const b1 = await version(b.id, "B rev 1");

      // Input order is deliberately B then A.
      const m1 = await createRulesetManifest(r.id, {
        entries: [{ entityId: b.id, entityVersionId: b1.id }, { entityId: a.id, entityVersionId: a1.id }],
      });

      expect(m1.id).toMatch(UUID);
      expect(m1.rulesetId).toBe(r.id);
      expect(m1.manifestVersion).toBe(1);
      expect(Number.isNaN(m1.createdAt.getTime())).toBe(false);
      expect(pins(m1)).toEqual([[a.id, a1.id], [b.id, b1.id]]); // A before B: the order came from the database, not the input
      expect(await getRulesetManifest(m1.id)).toEqual(m1);
    });

    it("a later EntityVersion never changes an existing manifest: Manifest 1 still resolves A -> Revision 1 (§6, §28, §36)", async () => {
      const r = await ruleset("history");
      const a = await entity("hist");
      const a1 = await version(a.id, "A rev 1");
      const m1 = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });

      const a2 = await version(a.id, "A rev 2");
      expect((await getLatestEntityVersion(a.id))?.id).toBe(a2.id); // proof the "latest" really moved on

      expect(pins(await getRulesetManifest(m1.id))).toEqual([[a.id, a1.id]]);
      const resolved = await resolveEntityVersionFromManifest(m1.id, a.id);
      expect(resolved?.id).toBe(a1.id);
      expect(resolved?.revisionNumber).toBe(1);
      expect(resolved?.id).not.toBe(a2.id);
    });

    it("a second manifest records the new composition and leaves the first untouched (§29)", async () => {
      const r = await ruleset("second");
      const a = await entity("sa");
      const b = await entity("sb");
      const a1 = await version(a.id, "A1");
      const b1 = await version(b.id, "B1");
      const m1 = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }, { entityId: b.id, entityVersionId: b1.id }] });
      const before = await getRulesetManifest(m1.id);

      const a2 = await version(a.id, "A2");
      const m2 = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }, { entityId: b.id, entityVersionId: b1.id }] });

      expect([m1.manifestVersion, m2.manifestVersion]).toEqual([1, 2]);
      expect(pins(m2)).toEqual([[a.id, a2.id], [b.id, b1.id]]);
      expect(await getRulesetManifest(m1.id)).toEqual(before); // byte-for-byte what it was
      expect((await listRulesetManifests(r.id)).map((m) => m.manifestVersion)).toEqual([1, 2]);
      expect((await getLatestRulesetManifest(r.id))?.id).toBe(m2.id);
    });

    it("manifest numbering is scoped per Ruleset: two Rulesets can each have Manifest 1 (§30)", async () => {
      const r1 = await ruleset("scope1");
      const r2 = await ruleset("scope2");
      const m1 = await createRulesetManifest(r1.id, { entries: [] });
      const m2 = await createRulesetManifest(r2.id, { entries: [] });
      expect([m1.manifestVersion, m2.manifestVersion]).toEqual([1, 1]);
      expect(m1.id).not.toBe(m2.id);
      expect((await listRulesetManifests(r1.id)).map((m) => m.id)).toEqual([m1.id]);
    });

    it("allows an EMPTY manifest, which pins nothing (§9)", async () => {
      const r = await ruleset("empty");
      const a = await entity("emptyprobe");
      const m = await createRulesetManifest(r.id, { entries: [] });
      expect(m.entries).toEqual([]);
      expect(await resolveEntityVersionFromManifest(m.id, a.id)).toBeNull();
    });

    it("never lets a caller choose the manifest version: a smuggled one is ignored (§3)", async () => {
      const r = await ruleset("smuggle");
      const m = await createRulesetManifest(r.id, { entries: [], manifestVersion: 99 } as unknown as CreateRulesetManifestInput);
      expect(m.manifestVersion).toBe(1);
      expect((await createRulesetManifest(r.id, { entries: [] })).manifestVersion).toBe(2);
    });

    it("manifest_version is always positive and gap-free from 1", async () => {
      const r = await ruleset("positive");
      const versions: number[] = [];
      for (let i = 0; i < 4; i += 1) versions.push((await createRulesetManifest(r.id, { entries: [] })).manifestVersion);
      expect(versions).toEqual([1, 2, 3, 4]);
      const stored = await prisma.rulesetManifest.findMany({ where: { rulesetId: r.id }, select: { manifestVersion: true } });
      expect(stored.every((row: { manifestVersion: number }) => row.manifestVersion >= 1)).toBe(true);
    });
  });

  describe("validation and atomicity (§31–§34)", () => {
    it("rejects pinning Entity A to a Version of Entity B with VERSION_ENTITY_MISMATCH, persisting nothing (§31)", async () => {
      const r = await ruleset("mismatch");
      const a = await entity("ma");
      const b = await entity("mb");
      const b1 = await version(b.id, "B1");
      const attempt = createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: b1.id }] });
      await expect(attempt).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.VERSION_ENTITY_MISMATCH });
      await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
      expect(await counts(r.id, [a.id, b.id])).toEqual({ manifests: 0, entries: 0 });
    });

    it("rejects one Entity pinned twice with DUPLICATE_ENTITY, persisting nothing (§32)", async () => {
      const r = await ruleset("dup");
      const a = await entity("da");
      const a1 = await version(a.id, "A1");
      const a2 = await version(a.id, "A2");
      await expect(
        createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }, { entityId: a.id, entityVersionId: a2.id }] }),
      ).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.DUPLICATE_ENTITY });
      expect(await counts(r.id, [a.id])).toEqual({ manifests: 0, entries: 0 });
    });

    it("reports a missing Ruleset, Entity, or EntityVersion with its own controlled code — never a raw database error (§33)", async () => {
      const r = await ruleset("missing");
      const a = await entity("xa");
      const a1 = await version(a.id, "A1");
      const ok = { entityId: a.id, entityVersionId: a1.id };

      await expect(createRulesetManifest(MISSING, { entries: [ok] })).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.RULESET_NOT_FOUND });
      await expect(createRulesetManifest("not-a-uuid", { entries: [ok] })).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.RULESET_NOT_FOUND });
      await expect(createRulesetManifest(r.id, { entries: [{ entityId: MISSING, entityVersionId: a1.id }] })).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.ENTITY_NOT_FOUND });
      await expect(createRulesetManifest(r.id, { entries: [{ entityId: "not-a-uuid", entityVersionId: a1.id }] })).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.ENTITY_NOT_FOUND });
      await expect(createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: MISSING }] })).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.VERSION_NOT_FOUND });
      await expect(createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: "not-a-uuid" }] })).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.VERSION_NOT_FOUND });
      await expect(createRulesetManifest(r.id, { entries: "nope" } as unknown as CreateRulesetManifestInput)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.INVALID_INPUT });
      expect(await counts(r.id, [a.id])).toEqual({ manifests: 0, entries: 0 });
    });

    it("by-id absence is NOT_FOUND (including a malformed id); an unpinned Entity is null; a missing Ruleset is RULESET_NOT_FOUND", async () => {
      const r = await ruleset("absence");
      const a = await entity("absent");
      await expect(getRulesetManifest(MISSING)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.NOT_FOUND });
      await expect(getRulesetManifest("not-a-uuid")).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.NOT_FOUND });
      await expect(getManifestEntry(MISSING, a.id)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.NOT_FOUND });
      await expect(resolveEntityVersionFromManifest(MISSING, a.id)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.NOT_FOUND });
      await expect(listRulesetManifests(MISSING)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.RULESET_NOT_FOUND });
      await expect(getLatestRulesetManifest(MISSING)).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.RULESET_NOT_FOUND });
      // "No manifests yet" and "no such Ruleset" are different facts:
      expect(await listRulesetManifests(r.id)).toEqual([]);
      expect(await getLatestRulesetManifest(r.id)).toBeNull();
      const m = await createRulesetManifest(r.id, { entries: [] });
      expect(await getManifestEntry(m.id, a.id)).toBeNull();
      expect(await getManifestEntry(m.id, "not-a-uuid")).toBeNull();
    });

    it("valid entries followed by an invalid one leave zero manifest rows and zero entry rows (§34, service level)", async () => {
      const r = await ruleset("rollback");
      const ents = [await entity("ra"), await entity("rb"), await entity("rc")];
      const vers = [] as Awaited<ReturnType<typeof version>>[];
      for (const e of ents) vers.push(await version(e.id, `V of ${e.canonicalKey}`));
      await expect(
        createRulesetManifest(r.id, {
          entries: [
            { entityId: ents[0]!.id, entityVersionId: vers[0]!.id },
            { entityId: ents[1]!.id, entityVersionId: vers[1]!.id },
            { entityId: ents[2]!.id, entityVersionId: vers[0]!.id }, // wrong Entity's Version — last and invalid
          ],
        }),
      ).rejects.toMatchObject({ code: RULESET_MANIFEST_ERROR_CODES.VERSION_ENTITY_MISMATCH });
      expect(await counts(r.id, ents.map((e) => e.id))).toEqual({ manifests: 0, entries: 0 });
    });

    it("the WRITE itself is atomic: a failure inside the transaction, after valid entries were inserted, rolls everything back (§20, §34)", async () => {
      // Bypasses the service's validation on purpose: the database's composite foreign key
      // is the thing that fails, AFTER the manifest and two valid entries were inserted.
      const r = await ruleset("atomic");
      const [a, b, c] = [await entity("aa"), await entity("ab"), await entity("ac")] as const;
      const [a1, b1] = [await version(a.id, "A1"), await version(b.id, "B1")] as const;
      await version(c.id, "C1");

      await expect(
        insertRulesetManifestWithEntries(r.id, [
          { entityId: a.id, entityVersionId: a1.id },
          { entityId: b.id, entityVersionId: b1.id },
          { entityId: c.id, entityVersionId: a1.id }, // A's Version under Entity C: the database refuses
        ]),
      ).rejects.toThrow(/ruleset_manifest_entries_entity_version_id_entity_id_fkey/);

      expect(await counts(r.id, [a.id, b.id, c.id])).toEqual({ manifests: 0, entries: 0 });
      // ...and no manifest_version was consumed by the failed attempt:
      expect((await createRulesetManifest(r.id, { entries: [] })).manifestVersion).toBe(1);
    });
  });

  describe("concurrency (§21, §35)", () => {
    it("concurrent creations for one Ruleset all succeed with distinct, gap-free versions and no lost manifest", async () => {
      const r = await ruleset("race");
      const a = await entity("race");
      const a1 = await version(a.id, "A1");
      const results = await Promise.all(
        Array.from({ length: 5 }, () => createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] })),
      );
      expect(results.map((m) => m.manifestVersion).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(results.map((m) => m.id)).size).toBe(5);
      expect(await prisma.rulesetManifest.count({ where: { rulesetId: r.id } })).toBe(5);
      expect(await prisma.rulesetManifestEntry.count({ where: { manifest: { rulesetId: r.id } } })).toBe(5); // every manifest got its entry
    });
  });

  describe("no implicit selection (§13–§16, §36–§38)", () => {
    it("never falls back to a parent Ruleset's manifest (§13, §37)", async () => {
      const parent = await ruleset("parent");
      const child = await ruleset("child", { parentRulesetId: parent.id });
      const a = await entity("pf");
      const a1 = await version(a.id, "A1");
      const pm = await createRulesetManifest(parent.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const cm = await createRulesetManifest(child.id, { entries: [] });

      expect((await resolveEntityVersionFromManifest(pm.id, a.id))?.id).toBe(a1.id); // the parent does pin it...
      expect(await getManifestEntry(cm.id, a.id)).toBeNull(); // ...the child does not, and does not inherit
      expect(await resolveEntityVersionFromManifest(cm.id, a.id)).toBeNull();
      expect((await getLatestRulesetManifest(child.id))?.id).toBe(cm.id); // the child's own, never the parent's
    });

    it("an explicit pin outranks lifecycle status and Source authority: a DRAFT with a GOVERNING source resolves over a CANON sibling (§14, §15, §38)", async () => {
      const r = await ruleset("explicit");
      const a = await entity("canonsrc");
      const a1 = await version(a.id, "A1 (to be CANON)");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, status);
      const a2 = await version(a.id, "A2 (draft)");
      const sourceType: string = SOURCE_DOCUMENT_TYPES[0];
      const doc = await createSourceDocument({ title: `${SOURCE_TITLE_PREFIX}governing ${tag}_${next()}`, sourceType, authorityStatus: "GOVERNING" });
      await createSourceReference(a2.id, { sourceDocumentId: doc.id });

      const pinsDraft = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const resolved = await resolveEntityVersionFromManifest(pinsDraft.id, a.id);
      expect(resolved?.id).toBe(a2.id);
      expect(resolved?.status).toBe("DRAFT"); // not replaced by the CANON sibling
      expect((await prisma.entityVersion.findUnique({ where: { id: a1.id } }))?.status).toBe("CANON"); // and the CANON one is untouched

      // A manifest may equally pin the CANON one — status is not a gate in either direction.
      const pinsCanon = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      expect((await resolveEntityVersionFromManifest(pinsCanon.id, a.id))?.status).toBe("CANON");
    });

    it("exposes no operation that adds, removes, or updates a manifest's entries (§22)", async () => {
      const surface = await import("../../src/index");
      const ops = Object.keys(surface).filter((n) => /manifest/i.test(n)).sort();
      // getEffectiveManifestEntries (M2-WO3) also matches /manifest/; it is a read.
      expect(ops).toEqual([
        "createRulesetManifest",
        "getEffectiveManifestEntries",
        "getLatestRulesetManifest",
        "getManifestEntry",
        "getRulesetManifest",
        "listRulesetManifests",
        "resolveEntityVersionFromManifest",
      ]);
    });
  });

  describe("the database itself enforces the invariants (§1, §4, §23)", () => {
    it("rejects an entry pairing an Entity with another Entity's Version even when inserted directly, bypassing the service", async () => {
      const r = await ruleset("fkbackstop");
      const a = await entity("fa");
      const b = await entity("fb");
      const b1 = await version(b.id, "B1");
      const m = await createRulesetManifest(r.id, { entries: [] });
      await expect(
        prisma.rulesetManifestEntry.create({ data: { manifestId: m.id, entityId: a.id, entityVersionId: b1.id } }),
      ).rejects.toThrow(/ruleset_manifest_entries_entity_version_id_entity_id_fkey/);
      expect(await prisma.rulesetManifestEntry.count({ where: { manifestId: m.id } })).toBe(0);
    });

    it("rejects a second pin of the same Entity in one manifest, and a repeated (ruleset, manifest_version), even directly", async () => {
      const r = await ruleset("uniq");
      const a = await entity("ua");
      const a1 = await version(a.id, "A1");
      const a2 = await version(a.id, "A2");
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      await expect(
        prisma.rulesetManifestEntry.create({ data: { manifestId: m.id, entityId: a.id, entityVersionId: a2.id } }),
      ).rejects.toThrow(/ruleset_manifest_entries_manifest_id_entity_id_key/);
      await expect(
        prisma.rulesetManifest.create({ data: { rulesetId: r.id, manifestVersion: m.manifestVersion } }),
      ).rejects.toThrow(/ruleset_manifests_ruleset_id_manifest_version_key/);
    });

    it("protects historical composition: a pinned Version/Entity, the manifest, and the Ruleset cannot be physically deleted (RESTRICT)", async () => {
      const r = await ruleset("restrict");
      const a = await entity("restrict");
      const a1 = await version(a.id, "A1");
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });

      await expect(prisma.ruleset.delete({ where: { id: r.id } })).rejects.toThrow(/ruleset_manifests_ruleset_id_fkey/);
      await expect(prisma.rulesetManifest.delete({ where: { id: m.id } })).rejects.toThrow(/ruleset_manifest_entries_manifest_id_fkey/);
      await expect(prisma.entityVersion.delete({ where: { id: a1.id } })).rejects.toThrow(/ruleset_manifest_entries_entity_version_id_entity_id_fkey/);
      await expect(prisma.entity.delete({ where: { id: a.id } })).rejects.toThrow();
      expect(await getRulesetManifest(m.id)).toEqual(m); // the composition survived every attempt
    });

    it("the composite foreign key, its columns, and every delete rule are what the design says", async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.key_column_usage
        WHERE constraint_name = 'ruleset_manifest_entries_entity_version_id_entity_id_fkey' ORDER BY ordinal_position`;
      expect(columns.map((c) => c.column_name)).toEqual(["entity_version_id", "entity_id"]);

      const rules = await prisma.$queryRaw<Array<{ constraint_name: string; delete_rule: string }>>`
        SELECT constraint_name, delete_rule FROM information_schema.referential_constraints
        WHERE constraint_name IN ('ruleset_manifests_ruleset_id_fkey', 'ruleset_manifest_entries_manifest_id_fkey',
                                  'ruleset_manifest_entries_entity_version_id_entity_id_fkey')
        ORDER BY constraint_name`;
      expect(rules).toHaveLength(3);
      expect(rules.every((rule) => rule.delete_rule === "RESTRICT")).toBe(true);
    });

    it("the tables have exactly the specified columns; nothing anywhere points at a current/active manifest", async () => {
      const cols = async (table: string) =>
        (await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY column_name`)
          .map((c) => c.column_name);
      expect(await cols("ruleset_manifests")).toEqual(["created_at", "id", "manifest_version", "parent_manifest_id", "ruleset_id"]); // + parent_manifest_id (M2-WO3)
      expect(await cols("ruleset_manifest_entries")).toEqual(["created_at", "entity_id", "entity_version_id", "id", "manifest_id"]);

      const pointers = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('rulesets', 'entities', 'entity_versions') AND column_name ILIKE '%manifest%'`;
      expect(pointers).toEqual([]);
    });

    it("the M2-WO2 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261005001500_add_ruleset_manifest'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });
  });
});
