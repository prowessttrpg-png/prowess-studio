/**
 * PAS-10 M6-WO6 §141–§142 — migration compatibility. Builds a scratch database at the M6-WO5 schema (every migration up
 * to and including M6-WO5), stores real WO3 / WO4 / WO5 data (a completed Character with creation rows, one committed
 * advancement, play state, sheet notes with Possessions and a portrait, plus a Draft), then applies the M6-WO6
 * migration exactly as written and proves:
 *
 *   - every pre-existing table's rows and structures are unchanged (no loadout is synthesized);
 *   - the migration adds only `character_weapon_loadouts`, which begins empty (every Character starts None / None);
 *   - the WO3 / WO4 guards still hold; the new CHECK / FK constraints refuse half pairs, stray grips and foreign ids.
 *
 * Invariants: M6-I066 (the loadout never mutates Release identity), M6-I073 (no ammunition runtime state).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const REGISTRY = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/architecture/m6-schema-changes.json"), "utf8")) as Record<string, { migrations: string[] } | string>;
const WO6 = (REGISTRY["M6-WO6"] as { migrations: string[] }).migrations;
const WO6_TABLES = ["character_weapon_loadouts"];
const ALL = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
const BEFORE = ALL.slice(0, ALL.indexOf(WO6[0] as string));
const scratch = `prowess_wo6_upgrade_${Date.now()}`;

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

describe("M6-WO6 §142 — upgrading an M6-WO5 database adds only the Character Weapon loadout", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await withClient("postgres", (c) => c.query(`CREATE DATABASE "${scratch}"`));
  }, 60_000);
  afterAll(async () => {
    await withClient("postgres", (c) => c.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`));
  }, 60_000);

  it("the registered M6-WO6 migration follows M6-WO5; its SQL only creates the loadout table, its indexes and constraints", () => {
    expect(WO6).toEqual(["20261102010000_m6_wo6_character_weapon_loadout"]);
    expect(ALL.indexOf(WO6[0] as string)).toBe(ALL.indexOf("20261101010000_m6_wo5_character_sheet_state") + 1);
    const text = sql(WO6[0] as string).replace(/--.*$/gm, "");
    expect(text).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|TRIGGER|FUNCTION)\b/i);
    expect(text).not.toMatch(/\b(UPDATE|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\s+"/i);
    expect(text).not.toMatch(/CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|CREATE TYPE/i);
    for (const m of text.matchAll(/ALTER TABLE\s+"([a-z_]+)"/gi)) expect(WO6_TABLES, m[0]).toContain(m[1]);
    expect([...text.matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi)].map((m) => m[1])).toEqual(WO6_TABLES);
    // No ammunition, inventory, ownership, durability or derived-value column (§141).
    expect(text).not.toMatch(/ammo|round|magazine|reload|inventory|owner|durability|damage|power|armor|dodge|movement/i);
  });

  it("existing Characters, creation, history and sheet state are unchanged; loadouts begin empty; guards still hold", async () => {
    await withClient(scratch, async (c) => {
      for (const m of BEFORE) await c.query(sql(m));
      const entity = async (key: string) => {
        const e = (await c.query(`insert into entities (entity_type, canonical_key, updated_at) values ('GENERIC_RULE', $1, now()) returning id`, [key])).rows[0].id as string;
        const v = (await c.query(`insert into entity_versions (entity_id, revision_number, status, display_name, structured_data) values ($1, 1, 'APPROVED', $2, '{}') returning id`, [e, key])).rows[0].id as string;
        return { e, v };
      };
      const ancestry = await entity("test.m6wo6compat.ancestry");
      const affinity = await entity("test.m6wo6compat.affinity");
      const skill = await entity("test.m6wo6compat.skill");
      const r = (await c.query(`insert into rulesets (canonical_key, name, status, channel, updated_at) values ('test.m6wo6compat.ruleset', 'Compat', 'APPROVED', 'CORE_PLAYTEST', now()) returning id`)).rows[0].id as string;
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

      // WO5 sheet state.
      await c.query(`insert into character_play_states (character_id) values ($1)`, [done]);
      await c.query(`insert into character_resource_states (character_id, resource_key, current) values ($1, 'HP', 7)`, [done]);
      await c.query(`insert into character_sheet_notes (character_id, action_notes, possessions) values ($1, 'notes', '[{"category":"Gear","item":"Long Blade","weight":"3"}]')`, [done]);
      await c.query(`insert into character_portraits (character_id, zoom, offset_x, offset_y) values ($1, 1, 0, 0)`, [done]);
      const weapon = await entity("test.m6wo6compat.weapon");

      const existing = await tables(c);
      expect(existing.filter((t) => WO6_TABLES.includes(t))).toEqual([]);
      const before = { rows: await digests(c, existing), structure: await structure(c, existing) };

      await c.query(sql(WO6[0] as string));

      const after = await tables(c);
      expect(after.filter((t) => !existing.includes(t)).sort()).toEqual(WO6_TABLES);
      expect(await digests(c, existing)).toEqual(before.rows);
      const afterStructure = await structure(c, existing);
      expect(afterStructure.cols).toEqual(before.structure.cols);
      expect(afterStructure.idx).toEqual(before.structure.idx);
      expect(afterStructure.fns).toEqual(before.structure.fns);
      expect(afterStructure.trg).toEqual(before.structure.trg);
      expect(afterStructure.cons).toEqual(before.structure.cons);
      expect((await c.query(`select count(*)::int as n from "character_weapon_loadouts"`)).rows[0].n).toBe(0);

      // WO3 / WO4 guards are untouched.
      await expect(c.query(`update characters set level = 3 where id = $1`, [done])).rejects.toThrow(/CHARACTER_LEVEL_GUARD/);
      await expect(c.query(`delete from character_advancements where id = $1`, [adv])).rejects.toThrow(/CHARACTER_ADVANCEMENT_IMMUTABLE/);
      // The loadout stores exact pairs only, bounded by its own CHECK / FK constraints.
      await c.query(`insert into character_weapon_loadouts (character_id, main_hand_entity_id, main_hand_entity_version_id, main_hand_grip) values ($1, $2, $3, 'TWO_HANDED')`, [done, weapon.e, weapon.v]);
      await expect(c.query(`insert into character_weapon_loadouts (character_id, off_hand_entity_id) values ($1, $2)`, [done, weapon.e])).rejects.toThrow(/pkey|off_hand_pair_check/);
      await expect(c.query(`update character_weapon_loadouts set off_hand_entity_id = $2 where character_id = $1`, [done, weapon.e])).rejects.toThrow(/off_hand_pair_check/);
      await expect(c.query(`update character_weapon_loadouts set main_hand_entity_version_id = $2 where character_id = $1`, [done, ancestry.v])).rejects.toThrow(/main_hand_fkey/);
      await expect(c.query(`delete from characters where id = $1`, [done])).rejects.toThrow(/character_weapon_loadouts_character_id_fkey|violates foreign key/);
      expect((await c.query(`select level, lock_version from characters where id = $1`, [done])).rows[0]).toEqual({ level: 2, lock_version: 4 });
    });
  }, 120_000);
});
