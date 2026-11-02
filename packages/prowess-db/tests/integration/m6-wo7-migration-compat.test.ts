/**
 * PAS-10 M6-WO7 §166–§168 — migration compatibility. Builds a scratch database at the M6-WO6 schema (every migration up
 * to and including M6-WO6), stores real WO3 / WO4 / WO5 / WO6 data (a completed Character with creation rows, one
 * committed advancement, play state, sheet notes with Possessions, a portrait and a Weapon loadout, plus a Draft), then
 * applies the M6-WO7 migration exactly as written and proves:
 *
 *   - every pre-existing table's rows and structures are unchanged (no Signature Ability is synthesized);
 *   - the migration adds only the Signature Ability roster and the Signature Spell revisions, which begin empty;
 *   - no component catalog table exists; the new CHECK / FK / trigger guards hold (revisions are append-only).
 *
 * Invariants: M6-I077 (Character-owned, never canon), M6-I092 (append-only revisions).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const REGISTRY = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/architecture/m6-schema-changes.json"), "utf8")) as Record<string, { migrations: string[] } | string>;
const WO7 = (REGISTRY["M6-WO7"] as { migrations: string[] }).migrations;
const WO7_TABLES = ["character_signature_abilities", "character_signature_spell_revisions"];
const ALL = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
const BEFORE = ALL.slice(0, ALL.indexOf(WO7[0] as string));
const scratch = `prowess_wo7_upgrade_${Date.now()}`;

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

describe("M6-WO7 §168 — upgrading an M6-WO6 database adds only the Character Signature Abilities", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await withClient("postgres", (c) => c.query(`CREATE DATABASE "${scratch}"`));
  }, 60_000);
  afterAll(async () => {
    await withClient("postgres", (c) => c.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`));
  }, 60_000);

  it("the registered M6-WO7 migration follows M6-WO6; its SQL only creates the two Signature tables, their indexes, constraints and guards", () => {
    expect(WO7).toEqual(["20261103010000_m6_wo7_signature_spells"]);
    expect(ALL.indexOf(WO7[0] as string)).toBe(ALL.indexOf("20261102010000_m6_wo6_character_weapon_loadout") + 1);
    const text = sql(WO7[0] as string).replace(/--.*$/gm, "");
    expect(text).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|TRIGGER|FUNCTION)\b/i);
    expect(text).not.toMatch(/\b(UPDATE|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\s+"/i);
    expect(text).not.toMatch(/CREATE TYPE|CASCADE|SET NULL/i);
    for (const m of text.matchAll(/ALTER TABLE\s+"([a-z_]+)"/gi)) expect(WO7_TABLES, m[0]).toContain(m[1]);
    for (const m of text.matchAll(/CREATE TRIGGER\s+"[a-z_]+"[^;]*?\bON\s+"([a-z_]+)"/gi)) expect(WO7_TABLES, m[0]).toContain(m[1]);
    expect([...text.matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi)].map((m) => m[1])).toEqual(WO7_TABLES);
    // §78 / §116 / §167: no component catalog and no derived value is persisted.
    expect(text).not.toMatch(/final_mp|final_ap|mp_cost|ap_cost|capacity|discount|sustain|concentration|range|targeting|effect|trait|duration|condition|keyword/i);
  });

  it("existing Characters, creation, history, sheet state and loadouts are unchanged; Signature tables begin empty; guards hold", async () => {
    await withClient(scratch, async (c) => {
      for (const m of BEFORE) await c.query(sql(m));
      const entity = async (key: string) => {
        const e = (await c.query(`insert into entities (entity_type, canonical_key, updated_at) values ('GENERIC_RULE', $1, now()) returning id`, [key])).rows[0].id as string;
        const v = (await c.query(`insert into entity_versions (entity_id, revision_number, status, display_name, structured_data) values ($1, 1, 'APPROVED', $2, '{}') returning id`, [e, key])).rows[0].id as string;
        return { e, v };
      };
      const ancestry = await entity("test.m6wo7compat.ancestry");
      const affinity = await entity("test.m6wo7compat.affinity");
      const skill = await entity("test.m6wo7compat.skill");
      const r = (await c.query(`insert into rulesets (canonical_key, name, status, channel, updated_at) values ('test.m6wo7compat.ruleset', 'Compat', 'APPROVED', 'CORE_PLAYTEST', now()) returning id`)).rows[0].id as string;
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
      // WO5 sheet state and the WO6 loadout.
      await c.query(`insert into character_play_states (character_id) values ($1)`, [done]);
      await c.query(`insert into character_resource_states (character_id, resource_key, current) values ($1, 'HP', 7)`, [done]);
      await c.query(`insert into character_sheet_notes (character_id, action_notes, possessions) values ($1, 'notes', '[{"category":"Gear","item":"Long Blade","weight":"3"}]')`, [done]);
      await c.query(`insert into character_portraits (character_id, zoom, offset_x, offset_y) values ($1, 1, 0, 0)`, [done]);
      const weapon = await entity("test.m6wo7compat.weapon");
      await c.query(`insert into character_weapon_loadouts (character_id, main_hand_entity_id, main_hand_entity_version_id, main_hand_grip) values ($1, $2, $3, 'TWO_HANDED')`, [done, weapon.e, weapon.v]);

      const existing = await tables(c);
      expect(existing.filter((t) => WO7_TABLES.includes(t))).toEqual([]);
      const before = { rows: await digests(c, existing), structure: await structure(c, existing) };

      await c.query(sql(WO7[0] as string));

      const after = await tables(c);
      expect(after.filter((t) => !existing.includes(t)).sort()).toEqual(WO7_TABLES);
      expect(await digests(c, existing)).toEqual(before.rows);
      const afterStructure = await structure(c, existing);
      expect(afterStructure.cols).toEqual(before.structure.cols);
      expect(afterStructure.idx).toEqual(before.structure.idx);
      // Existing tables keep their triggers; the only new functions are the two WO7 guards.
      expect(afterStructure.trg.filter((t) => !WO7_TABLES.includes(t.event_object_table as string))).toEqual(before.structure.trg);
      expect(afterStructure.fns.filter((f) => !before.structure.fns.some((b) => b.proname === f.proname)).map((f) => f.proname).sort()).toEqual(["character_signature_abilities_current_revision_owned", "character_signature_spell_revisions_append_only"]);
      expect(afterStructure.cons).toEqual(before.structure.cons);
      for (const t of WO7_TABLES) expect((await c.query(`select count(*)::int as n from "${t}"`)).rows[0].n, t).toBe(0);

      // WO3 / WO4 guards are untouched.
      await expect(c.query(`update characters set level = 3 where id = $1`, [done])).rejects.toThrow(/CHARACTER_LEVEL_GUARD/);
      await expect(c.query(`delete from character_advancements where id = $1`, [adv])).rejects.toThrow(/CHARACTER_ADVANCEMENT_IMMUTABLE/);
      // The new guards: Spell kind only, closed status, finalized ⇒ a current revision, append-only revisions.
      await expect(c.query(`insert into character_signature_abilities (character_id, ability_kind, status) values ($1, 'MANEUVER', 'DRAFT')`, [done])).rejects.toThrow(/kind_check/);
      await expect(c.query(`insert into character_signature_abilities (character_id, ability_kind, status) values ($1, 'SPELL', 'ACTIVE')`, [done])).rejects.toThrow(/current_check/);
      await expect(c.query(`insert into character_signature_abilities (character_id, ability_kind, status, draft_payload) values ($1, 'SPELL', 'DRAFT', '[1]')`, [done])).rejects.toThrow(/draft_check/);
      const a = (await c.query(`insert into character_signature_abilities (character_id, ability_kind, status, draft_payload) values ($1, 'SPELL', 'DRAFT', '{}') returning id`, [done])).rows[0].id as string;
      const rev = (await c.query(`insert into character_signature_spell_revisions (ability_id, revision_number, character_release_id, payload) values ($1, 1, $2, '{"schemaVersion":1}') returning id`, [a, rel])).rows[0].id as string;
      await c.query(`update character_signature_abilities set status = 'ACTIVE', current_revision_id = $2, draft_payload = null, lock_version = 2 where id = $1`, [a, rev]);
      await expect(c.query(`update character_signature_spell_revisions set payload = '{}' where id = $1`, [rev])).rejects.toThrow(/CHARACTER_SIGNATURE_SPELL_REVISION_IMMUTABLE/);
      await expect(c.query(`delete from character_signature_spell_revisions where id = $1`, [rev])).rejects.toThrow(/CHARACTER_SIGNATURE_SPELL_REVISION_IMMUTABLE/);
      const other = (await c.query(`insert into character_signature_abilities (character_id, ability_kind, status, draft_payload) values ($1, 'SPELL', 'DRAFT', '{}') returning id`, [done])).rows[0].id as string;
      await expect(c.query(`update character_signature_abilities set current_revision_id = $2 where id = $1`, [other, rev])).rejects.toThrow(/CHARACTER_SIGNATURE_ABILITY_CURRENT_REVISION|current_revision_id_key/);
      await expect(c.query(`delete from characters where id = $1`, [done])).rejects.toThrow(/violates foreign key/);
      expect((await c.query(`select level, lock_version from characters where id = $1`, [done])).rows[0]).toEqual({ level: 2, lock_version: 4 });
    });
  }, 120_000);
});
