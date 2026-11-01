/**
 * PAS-10 M6-WO5 §123 — migration compatibility. Builds a scratch database at the M6-WO4 schema (every migration up to and
 * including M6-WO4), stores real WO3 / WO4 data (a completed Character with creation rows and one committed
 * advancement, plus a Draft), then applies the M6-WO5 migration exactly as written and proves:
 *
 *   - every pre-existing table's rows and structures are unchanged (no play state is synthesized, no Level changes);
 *   - the migration adds only the five sheet-state tables, which begin empty;
 *   - the WO3 / WO4 guards still hold (creation frozen, history append-only, Level only by advancement);
 *   - the new CHECK constraints refuse out-of-range framing and unsafe image types.
 *
 * Invariants: M6-I047 (mutable state separate from history), M6-I050 (nondestructive framing), M6-I053 (creation untouched).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const REGISTRY = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/architecture/m6-schema-changes.json"), "utf8")) as Record<string, { migrations: string[] } | string>;
const WO5 = (REGISTRY["M6-WO5"] as { migrations: string[] }).migrations;
const WO5_TABLES = ["character_play_states", "character_portrait_images", "character_portraits", "character_resource_states", "character_sheet_notes"];
const ALL = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
const BEFORE = ALL.slice(0, ALL.indexOf(WO5[0] as string));
const scratch = `prowess_wo5_upgrade_${Date.now()}`;

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
  const trg = await c.query("select event_object_table, trigger_name, action_statement from information_schema.triggers where trigger_schema = 'public' order by 1, 2, 3");
  const fns = await c.query("select proname, md5(prosrc) as src from pg_proc where pronamespace = 'public'::regnamespace order by 1");
  return { cols: cols.rows, cons: cons.rows, idx: idx.rows, trg: trg.rows, fns: fns.rows };
}

describe("M6-WO5 §123 — upgrading an M6-WO4 database adds only Character Sheet state structures", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await withClient("postgres", (c) => c.query(`CREATE DATABASE "${scratch}"`));
  }, 60_000);
  afterAll(async () => {
    await withClient("postgres", (c) => c.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`));
  }, 60_000);

  it("the registered M6-WO5 migration follows M6-WO4; its SQL only creates sheet-state objects", () => {
    expect(WO5).toEqual(["20261101010000_m6_wo5_character_sheet_state"]);
    expect(ALL.indexOf(WO5[0] as string)).toBe(ALL.indexOf("20261031010000_m6_wo4_character_advancement") + 1);
    const text = sql(WO5[0] as string).replace(/--.*$/gm, "");
    expect(text).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|TRIGGER|FUNCTION)\b/i);
    expect(text).not.toMatch(/\b(UPDATE|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\s+"/i);
    expect(text).not.toMatch(/CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|CREATE TYPE/i);
    for (const m of text.matchAll(/ALTER TABLE\s+"([a-z_]+)"/gi)) expect(WO5_TABLES, m[0]).toContain(m[1]);
    for (const m of text.matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi)) expect(WO5_TABLES).toContain(m[1]);
    // Image bytes live only in their own table — never on the Character or portrait metadata row.
    expect([...text.matchAll(/"(\w+)" BYTEA/g)].map((m) => m[1])).toEqual(["bytes"]);
    expect(text.slice(text.indexOf('CREATE TABLE "character_portrait_images"'))).toMatch(/^CREATE TABLE "character_portrait_images" \(\n\s+"character_id" UUID NOT NULL,\n\s+"bytes" BYTEA NOT NULL,/);
  });

  it("existing Characters, creation rows and history are unchanged; sheet tables begin empty; old guards still hold", async () => {
    await withClient(scratch, async (c) => {
      for (const m of BEFORE) await c.query(sql(m));
      const entity = async (key: string) => {
        const e = (await c.query(`insert into entities (entity_type, canonical_key, updated_at) values ('GENERIC_RULE', $1, now()) returning id`, [key])).rows[0].id as string;
        const v = (await c.query(`insert into entity_versions (entity_id, revision_number, status, display_name, structured_data) values ($1, 1, 'APPROVED', $2, '{}') returning id`, [e, key])).rows[0].id as string;
        return { e, v };
      };
      const ancestry = await entity("test.m6wo5compat.ancestry");
      const affinity = await entity("test.m6wo5compat.affinity");
      const skill = await entity("test.m6wo5compat.skill");
      const r = (await c.query(`insert into rulesets (canonical_key, name, status, channel, updated_at) values ('test.m6wo5compat.ruleset', 'Compat', 'APPROVED', 'CORE_PLAYTEST', now()) returning id`)).rows[0].id as string;
      const p = (await c.query(`insert into canon_policies (ruleset_id, policy_version, name) values ($1, 1, 'P') returning id`, [r])).rows[0].id as string;
      const m = (await c.query(`insert into ruleset_manifests (ruleset_id, manifest_version) values ($1, 1) returning id`, [r])).rows[0].id as string;
      const rel = (await c.query(`insert into ruleset_releases (ruleset_id, release_number, version_label, channel, manifest_id, canon_policy_id, manifest_hash) values ($1, 1, '0.1', 'CORE_PLAYTEST', $2, $3, $4) returning id`, [r, m, p, "a".repeat(64)])).rows[0].id as string;
      const done = (await c.query(`insert into characters (name, ruleset_release_id, ancestry_entity_id, ancestry_entity_version_id, primary_affinity_entity_id, primary_affinity_entity_version_id) values ('Done', $1, $2, $3, $4, $5) returning id`, [rel, ancestry.e, ancestry.v, affinity.e, affinity.v])).rows[0].id as string;
      await c.query(`insert into character_stat_allocations (character_id, stat, points_spent) values ($1, 'STR', 3), ($1, 'AGI', 12)`, [done]);
      await c.query(`insert into character_ancestry_stat_choices (character_id, grant_key, stat) values ($1, 'versatility', 'AGI')`, [done]);
      await c.query(`insert into character_skill_ranks (character_id, skill_entity_id, skill_entity_version_id, rank_key, source_kind, source_grant_key) values ($1, $2, $3, 'TRAINED', 'FREE', null)`, [done, skill.e, skill.v]);
      await c.query(`update characters set core_creation_completed_at = now(), lock_version = 3 where id = $1`, [done]);
      await c.query("BEGIN");
      const adv = (await c.query(`insert into character_advancements (character_id, from_level, to_level, lock_version_before) values ($1, 1, 2, 3) returning id`, [done])).rows[0].id as string;
      await c.query(`insert into character_stat_advancements (advancement_id, stat, points_spent) values ($1, 'PER', 1)`, [adv]);
      await c.query(`update characters set level = 2, lock_version = 4 where id = $1`, [done]);
      await c.query("COMMIT");
      await c.query(`insert into characters (name, ruleset_release_id) values ('Draft', $1)`, [rel]);

      const existing = await tables(c);
      expect(existing.filter((t) => WO5_TABLES.includes(t))).toEqual([]);
      const before = { rows: await digests(c, existing), structure: await structure(c, existing) };

      await c.query(sql(WO5[0] as string));

      const after = await tables(c);
      expect(after.filter((t) => !existing.includes(t)).sort()).toEqual(WO5_TABLES);
      expect(await digests(c, existing)).toEqual(before.rows);
      const afterStructure = await structure(c, existing);
      expect(afterStructure.cols).toEqual(before.structure.cols);
      expect(afterStructure.idx).toEqual(before.structure.idx);
      expect(afterStructure.fns).toEqual(before.structure.fns);
      expect(afterStructure.trg).toEqual(before.structure.trg);
      expect(afterStructure.cons).toEqual(before.structure.cons);
      for (const t of WO5_TABLES) expect((await c.query(`select count(*)::int as n from "${t}"`)).rows[0].n, t).toBe(0);

      // WO3 / WO4 guards are untouched.
      await expect(c.query(`update characters set level = 3 where id = $1`, [done])).rejects.toThrow(/CHARACTER_LEVEL_GUARD/);
      await expect(c.query(`delete from character_advancements where id = $1`, [adv])).rejects.toThrow(/CHARACTER_ADVANCEMENT_IMMUTABLE/);
      await expect(c.query(`update character_stat_allocations set points_spent = 4 where character_id = $1`, [done])).rejects.toThrow(/CHARACTER_CORE_FROZEN/);
      // New sheet state is separate from history and bounded by its own CHECKs.
      await c.query(`insert into character_play_states (character_id) values ($1)`, [done]);
      await c.query(`insert into character_resource_states (character_id, resource_key, current) values ($1, 'HP', 7)`, [done]);
      await expect(c.query(`insert into character_portraits (character_id, zoom, offset_x, offset_y) values ($1, 0.5, 0, 0)`, [done])).rejects.toThrow(/framing_check/);
      await expect(c.query(`insert into character_portraits (character_id, mime_type, byte_size, width, height, content_hash, zoom, offset_x, offset_y) values ($1, 'image/svg+xml', 10, 1, 1, 'x', 1, 0, 0)`, [done])).rejects.toThrow(/image_metadata_check/);
      expect((await c.query(`select level, lock_version from characters where id = $1`, [done])).rows[0]).toEqual({ level: 2, lock_version: 4 });
    });
  }, 120_000);
});
