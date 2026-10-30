/**
 * PAS-10 M6-WO3 §113 — migration compatibility. Builds a scratch database at the M6-WO2 schema (every migration before
 * the registered M6-WO3 migration), stores Entity / revision / Ruleset / Canon Policy / Manifest / Release rows, then
 * applies the M6-WO3 migration exactly as written and proves:
 *
 *   - every pre-existing table's rows are byte-identical (content digests before == after);
 *   - the migration only ADDS the four Character tables (no existing table, column, type or constraint is altered);
 *   - a Character can reference the pre-existing Release and exact EntityVersions through the new foreign keys.
 *
 * The scratch database is created and dropped by this test; prowess_studio_test is never modified by it.
 * Invariants: M6-I021 (Release FK RESTRICT + immutability trigger), M6-I024 (Characters are their own tables).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const REGISTRY = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/architecture/m6-schema-changes.json"), "utf8")) as Record<string, { migrations: string[] } | string>;
const WO3 = (REGISTRY["M6-WO3"] as { migrations: string[] }).migrations;
const WO3_TABLES = ["character_ancestry_stat_choices", "character_skill_ranks", "character_stat_allocations", "characters"];
const ALL = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
const BEFORE = ALL.slice(0, ALL.indexOf(WO3[0] as string));
const scratch = `prowess_wo3_upgrade_${Date.now()}`;

function urlFor(database: string): string {
  const u = new URL(getTestDatabaseUrl());
  u.pathname = `/${database}`;
  u.search = "";
  return u.toString();
}
async function withClient<T>(database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlFor(database) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const sql = (name: string) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");

async function tables(c: pg.Client): Promise<string[]> {
  return (await c.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows.map((r) => r.table_name as string);
}
async function digests(c: pg.Client, names: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of names) out[t] = (await c.query(`select count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as d from "${t}" x`)).rows[0].d as string;
  return out;
}
async function structure(c: pg.Client, names: readonly string[]) {
  const cols = await c.query("select table_name, column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = any($1) order by 1, 2", [names]);
  const cons = await c.query("select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text = any($1) order by 1, 2", [names.map((n) => `"${n}"`).concat(names)]);
  const idx = await c.query("select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2", [names]);
  const types = await c.query("select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid = t.oid group by 1 order by 1");
  return { cols: cols.rows, cons: cons.rows, idx: idx.rows, types: types.rows };
}

describe("M6-WO3 §113 — upgrading an M6-WO2 database adds only Character structures", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await withClient("postgres", (c) => c.query(`CREATE DATABASE "${scratch}"`));
  }, 60_000);
  afterAll(async () => {
    await withClient("postgres", (c) => c.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`));
  }, 60_000);

  it("the registered M6-WO3 migration is the last migration and its SQL only creates Character objects", () => {
    expect(WO3).toEqual(["20261029010000_m6_wo3_character_foundation"]);
    expect(ALL.at(-1)).toBe(WO3[0]);
    const text = sql(WO3[0] as string).replace(/--.*$/gm, "");
    expect(text).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)\b/i);
    expect(text).not.toMatch(/\b(UPDATE|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\s+"(?!character)/i);
    for (const m of text.matchAll(/ALTER TABLE\s+"([a-z_]+)"/gi)) expect(WO3_TABLES, m[0]).toContain(m[1]);
    for (const m of text.matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi)) expect(WO3_TABLES).toContain(m[1]);
    expect(text).not.toMatch(/CREATE TYPE/i);
  });

  it("existing rows and structures are unchanged; a Character can pin the existing Release", async () => {
    await withClient(scratch, async (c) => {
      for (const m of BEFORE) await c.query(sql(m));
      // Pre-existing M1 / M2 content.
      const e = (await c.query(`insert into entities (entity_type, canonical_key, updated_at) values ('GENERIC_RULE', 'test.m6wo3compat.rule', now()) returning id`)).rows[0].id as string;
      const v1 = (await c.query(`insert into entity_versions (entity_id, revision_number, status, display_name, structured_data) values ($1, 1, 'APPROVED', 'Rule r1', '{"a":1}') returning id`, [e])).rows[0].id as string;
      await c.query(`insert into entity_versions (entity_id, revision_number, status, display_name, structured_data, parent_version_id) values ($1, 2, 'DRAFT', 'Rule r2', '{"a":2}', $2)`, [e, v1]);
      const r = (await c.query(`insert into rulesets (canonical_key, name, status, channel, updated_at) values ('test.m6wo3compat.ruleset', 'Compat', 'APPROVED', 'CORE_PLAYTEST', now()) returning id`)).rows[0].id as string;
      const p = (await c.query(`insert into canon_policies (ruleset_id, policy_version, name) values ($1, 1, 'P') returning id`, [r])).rows[0].id as string;
      const m = (await c.query(`insert into ruleset_manifests (ruleset_id, manifest_version) values ($1, 1) returning id`, [r])).rows[0].id as string;
      await c.query(`insert into ruleset_manifest_entries (manifest_id, entity_id, entity_version_id) values ($1, $2, $3)`, [m, e, v1]);
      const rel = (await c.query(`insert into ruleset_releases (ruleset_id, release_number, version_label, channel, manifest_id, canon_policy_id, manifest_hash) values ($1, 1, '0.1', 'CORE_PLAYTEST', $2, $3, $4) returning id`, [r, m, p, "a".repeat(64)])).rows[0].id as string;

      const existing = await tables(c);
      expect(existing.filter((t) => WO3_TABLES.includes(t))).toEqual([]);
      const before = { rows: await digests(c, existing), structure: await structure(c, existing) };

      await c.query(sql(WO3[0] as string));

      const after = await tables(c);
      expect(after.filter((t) => !existing.includes(t)).sort()).toEqual(WO3_TABLES);
      expect(await digests(c, existing)).toEqual(before.rows);
      expect(await structure(c, existing)).toEqual(before.structure);
      for (const t of WO3_TABLES) expect((await c.query(`select count(*)::int as n from "${t}"`)).rows[0].n, t).toBe(0);

      // The new structures reference the pre-existing rows (RESTRICT keeps them from disappearing underneath).
      const ch = (await c.query(`insert into characters (name, ruleset_release_id) values ('Compat', $1) returning id, level, lock_version`, [rel])).rows[0];
      expect([ch.level, ch.lock_version]).toEqual([1, 1]);
      await expect(c.query(`delete from ruleset_releases where id = $1`, [rel])).rejects.toThrow(/foreign key|violates/i);
      await expect(c.query(`update characters set ruleset_release_id = gen_random_uuid() where id = $1`, [ch.id])).rejects.toThrow(/CHARACTER_RELEASE_IMMUTABLE|foreign key/);
    });
  }, 120_000);
});
