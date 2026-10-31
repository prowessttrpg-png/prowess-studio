/**
 * PAS-10 M6-WO4 §141 — migration compatibility. Builds a scratch database at the M6-WO3 schema (every migration up to and
 * including M6-WO3), stores real WO3 data (a completed Character with its creation Stat allocations, Ancestry choices and
 * starting Skills, plus a Draft), then applies the M6-WO4 migration exactly as written and proves:
 *
 *   - every pre-existing table's rows and structures are unchanged (no fake advancement is synthesized);
 *   - the migration adds only the four advancement tables, which begin empty;
 *   - the replaced Character guard now allows a Level change ONLY through a committed advancement of exactly one Level.
 *
 * Invariants: M6-I034 (creation state unchanged), M6-I035 (append-only history), M6-I032 (one Level at a time).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const REGISTRY = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/architecture/m6-schema-changes.json"), "utf8")) as Record<string, { migrations: string[] } | string>;
const WO4 = (REGISTRY["M6-WO4"] as { migrations: string[] }).migrations;
const WO4_TABLES = ["character_advancements", "character_affinity_advancement_choices", "character_skill_advancements", "character_stat_advancements"];
const ALL = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
const BEFORE = ALL.slice(0, ALL.indexOf(WO4[0] as string));
const scratch = `prowess_wo4_upgrade_${Date.now()}`;

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

describe("M6-WO4 §141 — upgrading an M6-WO3 database adds only advancement structures", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await withClient("postgres", (c) => c.query(`CREATE DATABASE "${scratch}"`));
  }, 60_000);
  afterAll(async () => {
    await withClient("postgres", (c) => c.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`));
  }, 60_000);

  it("the registered M6-WO4 migration follows M6-WO3; its SQL only creates advancement objects and replaces the Character guard", () => {
    expect(WO4).toEqual(["20261031010000_m6_wo4_character_advancement"]);
    expect(ALL.indexOf(WO4[0] as string)).toBe(ALL.indexOf("20261029010000_m6_wo3_character_foundation") + 1);
    const text = sql(WO4[0] as string).replace(/--.*$/gm, "");
    expect(text).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|TRIGGER|FUNCTION)\b/i);
    expect(text).not.toMatch(/\b(UPDATE|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\s+"/i);
    for (const m of text.matchAll(/ALTER TABLE\s+"([a-z_]+)"/gi)) expect(WO4_TABLES, m[0]).toContain(m[1]);
    for (const m of text.matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi)) expect(WO4_TABLES).toContain(m[1]);
    expect([...text.matchAll(/CREATE OR REPLACE FUNCTION\s+"([a-z_]+)"/gi)].map((m) => m[1])).toEqual(["characters_guard"]);
    expect(text).not.toMatch(/CREATE TYPE/i);
  });

  it("existing WO3 Characters and creation rows are unchanged; advancement tables begin empty; Level moves only by advancement", async () => {
    await withClient(scratch, async (c) => {
      for (const m of BEFORE) await c.query(sql(m));
      const entity = async (key: string) => {
        const e = (await c.query(`insert into entities (entity_type, canonical_key, updated_at) values ('GENERIC_RULE', $1, now()) returning id`, [key])).rows[0].id as string;
        const v = (await c.query(`insert into entity_versions (entity_id, revision_number, status, display_name, structured_data) values ($1, 1, 'APPROVED', $2, '{}') returning id`, [e, key])).rows[0].id as string;
        return { e, v };
      };
      const ancestry = await entity("test.m6wo4compat.ancestry");
      const affinity = await entity("test.m6wo4compat.affinity");
      const skill = await entity("test.m6wo4compat.skill");
      const r = (await c.query(`insert into rulesets (canonical_key, name, status, channel, updated_at) values ('test.m6wo4compat.ruleset', 'Compat', 'APPROVED', 'CORE_PLAYTEST', now()) returning id`)).rows[0].id as string;
      const p = (await c.query(`insert into canon_policies (ruleset_id, policy_version, name) values ($1, 1, 'P') returning id`, [r])).rows[0].id as string;
      const m = (await c.query(`insert into ruleset_manifests (ruleset_id, manifest_version) values ($1, 1) returning id`, [r])).rows[0].id as string;
      const rel = (await c.query(`insert into ruleset_releases (ruleset_id, release_number, version_label, channel, manifest_id, canon_policy_id, manifest_hash) values ($1, 1, '0.1', 'CORE_PLAYTEST', $2, $3, $4) returning id`, [r, m, p, "a".repeat(64)])).rows[0].id as string;
      // A completed WO3 Character with its creation rows, and a Draft.
      const done = (await c.query(`insert into characters (name, ruleset_release_id, ancestry_entity_id, ancestry_entity_version_id, primary_affinity_entity_id, primary_affinity_entity_version_id) values ('Done', $1, $2, $3, $4, $5) returning id`, [rel, ancestry.e, ancestry.v, affinity.e, affinity.v])).rows[0].id as string;
      await c.query(`insert into character_stat_allocations (character_id, stat, points_spent) values ($1, 'STR', 3), ($1, 'AGI', 12)`, [done]);
      await c.query(`insert into character_ancestry_stat_choices (character_id, grant_key, stat) values ($1, 'versatility', 'AGI')`, [done]);
      await c.query(`insert into character_skill_ranks (character_id, skill_entity_id, skill_entity_version_id, rank_key, source_kind, source_grant_key) values ($1, $2, $3, 'TRAINED', 'FREE', null)`, [done, skill.e, skill.v]);
      await c.query(`update characters set core_creation_completed_at = now(), lock_version = 3 where id = $1`, [done]);
      const draft = (await c.query(`insert into characters (name, ruleset_release_id) values ('Draft', $1) returning id`, [rel])).rows[0].id as string;

      const existing = await tables(c);
      expect(existing.filter((t) => WO4_TABLES.includes(t))).toEqual([]);
      const before = { rows: await digests(c, existing), structure: await structure(c, existing) };

      await c.query(sql(WO4[0] as string));

      const after = await tables(c);
      expect(after.filter((t) => !existing.includes(t)).sort()).toEqual(WO4_TABLES);
      expect(await digests(c, existing)).toEqual(before.rows);
      expect(await structure(c, existing)).toEqual(before.structure);
      for (const t of WO4_TABLES) expect((await c.query(`select count(*)::int as n from "${t}"`)).rows[0].n, t).toBe(0);

      // The advancement-aware Level guard.
      await expect(c.query(`update characters set level = 2 where id = $1`, [done])).rejects.toThrow(/CHARACTER_LEVEL_GUARD/);
      await expect(c.query(`update characters set level = 2 where id = $1`, [draft])).rejects.toThrow(/CHARACTER_LEVEL_GUARD/);
      await expect(c.query(`insert into character_advancements (character_id, from_level, to_level, lock_version_before) values ($1, 1, 2, 1)`, [draft])).rejects.toThrow(/CHARACTER_ADVANCEMENT_ORDER/);
      await c.query("BEGIN");
      const adv = (await c.query(`insert into character_advancements (character_id, from_level, to_level, lock_version_before) values ($1, 1, 2, 3) returning id`, [done])).rows[0].id as string;
      await c.query(`insert into character_stat_advancements (advancement_id, stat, points_spent) values ($1, 'PER', 1)`, [adv]);
      await c.query(`update characters set level = 2, lock_version = 4 where id = $1`, [done]);
      await c.query("COMMIT");
      expect((await c.query(`select level from characters where id = $1`, [done])).rows[0].level).toBe(2);
      await expect(c.query(`delete from character_advancements where id = $1`, [adv])).rejects.toThrow(/CHARACTER_ADVANCEMENT_IMMUTABLE/);
      await expect(c.query(`insert into character_stat_advancements (advancement_id, stat, points_spent) values ($1, 'STR', 1)`, [adv])).rejects.toThrow(/CHARACTER_ADVANCEMENT_IMMUTABLE/);
      await expect(c.query(`update character_stat_allocations set points_spent = 4 where character_id = $1`, [done])).rejects.toThrow(/CHARACTER_CORE_FROZEN/);
    });
  }, 120_000);
});
