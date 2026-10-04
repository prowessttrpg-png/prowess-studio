/**
 * Ruleset foundation — database integration tests (PAS-10 M2-WO1 §25–§32).
 *
 * Runs only against prowess_studio_test (guarded). Fixtures are synthetic and
 * tracked by id; teardown detaches parents before deleting (the lineage foreign
 * key is ON DELETE RESTRICT).
 */
import { DomainError, RULESET_ERROR_CODES, type CreateRulesetInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRuleset,
  findRulesetByCanonicalKey,
  getRuleset,
  listRulesets,
  prisma,
} from "../../src/index";
import { selectRulesetAncestors } from "../../src/ruleset/repository";
import { validateParentAssignment } from "../../src/ruleset/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const key = (label: string) => `test.ruleset.${label}_${tag}_${++counter}`;
const created: string[] = [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ruleset(label: string, over: Partial<CreateRulesetInput> = {}) {
  const r = await createRuleset({ canonicalKey: key(label), name: `Test ${label}`, channel: "DEVELOPMENT", ...over });
  created.push(r.id);
  return r;
}

describe("Ruleset (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.ruleset.updateMany({ where: { id: { in: created } }, data: { parentRulesetId: null } });
    await prisma.ruleset.deleteMany({ where: { id: { in: created } } });
  });

  describe("creation", () => {
    it("creates a DRAFT Ruleset with a UUID and valid timestamps (§25)", async () => {
      const k = key("core");
      const before = Date.now();
      const r = await createRuleset({ canonicalKey: k, name: "Test Core Ruleset", channel: "CORE_PLAYTEST" });
      created.push(r.id);

      expect(r.canonicalKey).toBe(k);
      expect(r.name).toBe("Test Core Ruleset");
      expect(r.channel).toBe("CORE_PLAYTEST");
      expect(r.status).toBe("DRAFT");
      expect(r.id).toMatch(UUID);
      expect(r.description).toBeNull();
      expect(r.versionLabel).toBeNull();
      expect(r.parentRulesetId).toBeNull();
      expect(r.createdAt).toBeInstanceOf(Date);
      expect(r.updatedAt).toBeInstanceOf(Date);
      expect(Number.isNaN(r.createdAt.getTime())).toBe(false);
      expect(Number.isNaN(r.updatedAt.getTime())).toBe(false);
      expect(r.createdAt.getTime()).toBeGreaterThan(before - 60_000);
    });

    it("stores a description and trimmed name/version label", async () => {
      const r = await ruleset("fields", { name: "  Padded Name  ", description: "About it", versionLabel: "  Core Playtest 2026.10  " });
      expect(r.name).toBe("Padded Name");
      expect(r.versionLabel).toBe("Core Playtest 2026.10");
      expect(r.description).toBe("About it");
    });

    it("never lets a caller choose the status — a smuggled PUBLISHED is ignored and the Ruleset is DRAFT", async () => {
      const sneaky = { canonicalKey: key("sneaky"), name: "Sneaky", channel: "STABLE", status: "PUBLISHED" } as unknown as CreateRulesetInput;
      const r = await createRuleset(sneaky);
      created.push(r.id);
      expect(r.status).toBe("DRAFT");
      expect((await prisma.ruleset.findUnique({ where: { id: r.id } }))?.status).toBe("DRAFT");
    });

    it("rejects invalid input with RULESET.INVALID_INPUT and persists nothing", async () => {
      const validKey = key("invalid");
      const bad: Array<[string, CreateRulesetInput]> = [
        ["blank name", { canonicalKey: validKey, name: "   ", channel: "DEVELOPMENT" }],
        ["unknown channel", { canonicalKey: validKey, name: "X", channel: "BETA" }],
        ["blank version label", { canonicalKey: validKey, name: "X", channel: "DEVELOPMENT", versionLabel: "  " }],
        ["invalid canonical key", { canonicalKey: "Not A Key", name: "X", channel: "DEVELOPMENT" }],
      ];
      for (const [label, input] of bad) {
        const attempt = createRuleset(input);
        await expect(attempt, label).rejects.toMatchObject({ code: RULESET_ERROR_CODES.INVALID_INPUT });
        await expect(attempt.catch((e: unknown) => e), label).resolves.toBeInstanceOf(DomainError);
      }
      expect(await findRulesetByCanonicalKey(validKey)).toBeNull(); // the three with a valid key left nothing behind
    });
  });

  describe("retrieval", () => {
    it("returns the same Ruleset by UUID and by canonical key (§26)", async () => {
      const r = await ruleset("retrieve", { channel: "EXPERIMENTAL" });
      const byId = await getRuleset(r.id);
      const byKey = await findRulesetByCanonicalKey(r.canonicalKey);
      expect(byId).toEqual(r);
      expect(byKey).toEqual(r);
      expect(byKey).toEqual(byId);
    });

    it("by-id absence is RULESET.NOT_FOUND — including a malformed id, never a raw database error", async () => {
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", ""]) {
        await expect(getRuleset(id), id).rejects.toMatchObject({ code: RULESET_ERROR_CODES.NOT_FOUND });
      }
    });

    it("by-key absence is null, not an error", async () => {
      expect(await findRulesetByCanonicalKey(key("absent"))).toBeNull();
    });
  });

  describe("canonical key uniqueness (§27)", () => {
    it("rejects a duplicate key with RULESET.CANONICAL_KEY_CONFLICT — a DomainError, not a raw Prisma error — leaving one row", async () => {
      const first = await ruleset("dup");
      const attempt = createRuleset({ canonicalKey: first.canonicalKey, name: "Second", channel: "STABLE" });

      await expect(attempt).rejects.toMatchObject({ code: RULESET_ERROR_CODES.CANONICAL_KEY_CONFLICT });
      const error = await attempt.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect(JSON.stringify({ code: (error as DomainError).code, message: (error as DomainError).message })).not.toMatch(/P2\d{3}|prisma/i);
      expect(await prisma.ruleset.count({ where: { canonicalKey: first.canonicalKey } })).toBe(1);
      expect((await findRulesetByCanonicalKey(first.canonicalKey))?.name).toBe(first.name); // the original is untouched
    });
  });

  describe("parent lineage", () => {
    it("persists a parent chosen at creation (§28)", async () => {
      const base = await ruleset("base", { channel: "CORE_PLAYTEST" });
      const child = await ruleset("child", { channel: "EXPERIMENTAL", parentRulesetId: base.id });

      expect(child.parentRulesetId).toBe(base.id);
      expect((await getRuleset(child.id)).parentRulesetId).toBe(base.id);
      expect((await getRuleset(base.id)).parentRulesetId).toBeNull();
      // Lineage is metadata only: the child did not inherit the parent's channel or name.
      expect(child.channel).toBe("EXPERIMENTAL");
      expect(child.name).not.toBe(base.name);
    });

    it("rejects a nonexistent parent with RULESET.INVALID_PARENT and persists no Ruleset (§29)", async () => {
      const k = key("orphan");
      await expect(
        createRuleset({ canonicalKey: k, name: "Orphan", channel: "DEVELOPMENT", parentRulesetId: "00000000-0000-4000-8000-000000000000" }),
      ).rejects.toMatchObject({ code: RULESET_ERROR_CODES.INVALID_PARENT });
      expect(await findRulesetByCanonicalKey(k)).toBeNull();
    });

    it("rejects a malformed parent id with RULESET.INVALID_PARENT, not a raw database error", async () => {
      const k = key("malformed_parent");
      await expect(
        createRuleset({ canonicalKey: k, name: "Bad parent", channel: "DEVELOPMENT", parentRulesetId: "not-a-uuid" }),
      ).rejects.toMatchObject({ code: RULESET_ERROR_CODES.INVALID_PARENT });
      expect(await findRulesetByCanonicalKey(k)).toBeNull();
    });

    it("returns ancestors nearest-first, and a Ruleset with no parent has none", async () => {
      const r1 = await ruleset("anc1");
      const r2 = await ruleset("anc2", { parentRulesetId: r1.id });
      const r3 = await ruleset("anc3", { parentRulesetId: r2.id });
      expect((await selectRulesetAncestors(r3.id)).map((r) => r.id)).toEqual([r2.id, r1.id]);
      expect(await selectRulesetAncestors(r1.id)).toEqual([]);
    });
  });

  describe("self-parenting and cycles (§30–31) — via the internal validator, since no parent-changing API exists", () => {
    it("rejects self-parenting, a two-node loop, and a deeper loop with RULESET.PARENT_CYCLE", async () => {
      const r1 = await ruleset("cyc1");
      const r2 = await ruleset("cyc2", { parentRulesetId: r1.id }); // r1 <- r2
      const r3 = await ruleset("cyc3", { parentRulesetId: r2.id }); // r1 <- r2 <- r3

      await expect(validateParentAssignment(r1.id, r1.id)).rejects.toMatchObject({ code: RULESET_ERROR_CODES.PARENT_CYCLE });
      await expect(validateParentAssignment(r1.id, r2.id)).rejects.toMatchObject({ code: RULESET_ERROR_CODES.PARENT_CYCLE });
      await expect(validateParentAssignment(r1.id, r3.id)).rejects.toMatchObject({ code: RULESET_ERROR_CODES.PARENT_CYCLE });
    });

    it("accepts assignments that do not loop, and reports a missing parent as INVALID_PARENT (not a cycle)", async () => {
      const r1 = await ruleset("ok1");
      const r2 = await ruleset("ok2", { parentRulesetId: r1.id });
      const r3 = await ruleset("ok3", { parentRulesetId: r2.id });

      await expect(validateParentAssignment(r3.id, r1.id)).resolves.toBeUndefined(); // shortcut up the chain
      await expect(validateParentAssignment(null, r1.id)).resolves.toBeUndefined(); // creation: only existence matters
      await expect(validateParentAssignment(r1.id, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
        code: RULESET_ERROR_CODES.INVALID_PARENT,
      });
    });

    it("exposes no operation that changes a parent: the public surface has no update/set for Rulesets", async () => {
      const surface = await import("../../src/index");
      const rulesetOps = Object.keys(surface).filter((n) => /ruleset/i.test(n)).sort();
      expect(rulesetOps).toEqual(["createRuleset", "findRulesetByCanonicalKey", "getRuleset", "listRulesets"]);
    });
  });

  describe("listing (§16)", () => {
    it("is ordered canonical_key ASC regardless of creation order, repeatable, and filterable by status and channel", async () => {
      const prefix = `test.ruleset.list_${tag}`;
      const c = await createRuleset({ canonicalKey: `${prefix}_c`, name: "C", channel: "EXPERIMENTAL" });
      const a = await createRuleset({ canonicalKey: `${prefix}_a`, name: "A", channel: "EXPERIMENTAL" });
      const b = await createRuleset({ canonicalKey: `${prefix}_b`, name: "B", channel: "CORE_PLAYTEST" });
      created.push(a.id, b.id, c.id);
      const ours = (rows: Awaited<ReturnType<typeof listRulesets>>) => rows.filter((r) => r.canonicalKey.startsWith(prefix));

      const all = ours(await listRulesets());
      expect(all.map((r) => r.canonicalKey)).toEqual([`${prefix}_a`, `${prefix}_b`, `${prefix}_c`]);
      expect(ours(await listRulesets()).map((r) => r.id)).toEqual(all.map((r) => r.id)); // repeatable

      expect(ours(await listRulesets({ channel: "EXPERIMENTAL" })).map((r) => r.name)).toEqual(["A", "C"]);
      expect(ours(await listRulesets({ channel: "CORE_PLAYTEST" })).map((r) => r.name)).toEqual(["B"]);
      expect(ours(await listRulesets({ status: "DRAFT" }))).toHaveLength(3);
      expect(ours(await listRulesets({ status: "PUBLISHED" }))).toHaveLength(0);

      // A non-default status filter, proven against a row whose status was set directly
      // (there is deliberately no public status-changing operation yet).
      await prisma.ruleset.update({ where: { id: b.id }, data: { status: "APPROVED" } });
      expect(ours(await listRulesets({ status: "APPROVED" })).map((r) => r.name)).toEqual(["B"]);
      expect(ours(await listRulesets({ status: "DRAFT" })).map((r) => r.name)).toEqual(["A", "C"]);
    });

    it("rejects an unrecognized filter value rather than passing it through", async () => {
      await expect(listRulesets({ status: "ACTIVE" })).rejects.toMatchObject({ code: RULESET_ERROR_CODES.INVALID_INPUT });
      await expect(listRulesets({ channel: "BETA" })).rejects.toMatchObject({ code: RULESET_ERROR_CODES.INVALID_INPUT });
    });
  });

  describe("referential protection (§32)", () => {
    it("a parent Ruleset cannot be physically deleted while a child references it; once the child is gone it can", async () => {
      const parent = await ruleset("del_parent");
      const child = await ruleset("del_child", { parentRulesetId: parent.id });

      await expect(prisma.ruleset.delete({ where: { id: parent.id } })).rejects.toThrow();
      expect(await prisma.ruleset.findUnique({ where: { id: parent.id } })).not.toBeNull();
      expect((await getRuleset(child.id)).parentRulesetId).toBe(parent.id); // the lineage survived the attempt

      await prisma.ruleset.delete({ where: { id: child.id } });
      await expect(prisma.ruleset.delete({ where: { id: parent.id } })).resolves.toBeDefined();
    });
  });

  describe("no coupling to content, no automatic selection (§18–20, §33)", () => {
    it("the rulesets table has exactly the specified columns — nothing that names or selects an Entity/EntityVersion", async () => {
      const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rulesets' ORDER BY column_name`;
      expect(rows.map((r) => r.column_name)).toEqual([
        "canonical_key",
        "channel",
        "created_at",
        "description",
        "id",
        "name",
        "parent_ruleset_id",
        "status",
        "updated_at",
        "version_label",
      ]);
    });

    it("neither entities nor entity_versions gained any ruleset column (no ruleset_id on EntityVersion)", async () => {
      const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('entities', 'entity_versions')
          AND column_name ILIKE '%ruleset%'`;
      expect(rows).toEqual([]);
    });

    it("no table anywhere carries a column that expresses automatic or current selection", async () => {
      const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
      for (const { table_name, column_name } of rows) {
        expect(`${table_name}.${column_name}`).not.toMatch(
          /(^|\.)(is_current|current_version_id|current_entity_version|active_version|active_rule|global_current_(rule|revision)|use_latest(_version)?|automatic_latest|current_manifest_entry)$/,
        );
      }
    });

    it("the M2-WO1 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261004233000_add_ruleset_foundation'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });
  });
});
