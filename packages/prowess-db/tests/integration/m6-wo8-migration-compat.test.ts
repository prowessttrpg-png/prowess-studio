import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

/** Execute the exact WO7 Signature DDL, populate a finalized historical Spell, then apply the exact WO8 migration.
 * Parent-id anchors isolate this migration's unchanged FKs; the Signature tables/checks/triggers are the actual DDL.
 * A private schema keeps the ordinary test database's active schema and data untouched. */
it("upgrades finalized WO7 Spell storage without rewriting its selections, history or current pointer", { timeout: 300_000 }, async () => {
  const url = getTestDatabaseUrl(); assertRunningAgainstTestDatabase(url);
  const client = new Client({ connectionString: url }), schema = `m6_wo8_upgrade_${randomUUID().replaceAll("-", "")}`;
  const old = readFileSync(new URL("../../prisma/migrations/20261103010000_m6_wo7_signature_spells/migration.sql", import.meta.url), "utf8");
  const upgrade = readFileSync(new URL("../../prisma/migrations/20261104010000_m6_wo8_signature_maneuvers/migration.sql", import.meta.url), "utf8");
  const character = randomUUID(), release = randomUUID(), ability = randomUUID(), revision = randomUUID();
  const payload = { schemaVersion: 1, concept: { name: "Historical Spell", description: "inert original prose" }, exactSelections: { entityVersionId: randomUUID() } };
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE "characters" ("id" UUID PRIMARY KEY); CREATE TABLE "ruleset_releases" ("id" UUID PRIMARY KEY)');
    await client.query('INSERT INTO "characters" VALUES ($1)', [character]); await client.query('INSERT INTO "ruleset_releases" VALUES ($1)', [release]);
    await client.query(old);
    await client.query('INSERT INTO "character_signature_abilities" ("id","character_id","ability_kind","status","draft_payload") VALUES ($1,$2,\'SPELL\',\'DRAFT\',NULL)', [ability, character]);
    await client.query('INSERT INTO "character_signature_spell_revisions" ("id","ability_id","revision_number","character_release_id","payload") VALUES ($1,$2,1,$3,$4::jsonb)', [revision, ability, release, JSON.stringify(payload)]);
    await client.query('UPDATE "character_signature_abilities" SET "status"=\'ACTIVE\',"current_revision_id"=$1 WHERE "id"=$2', [revision, ability]);
    const before = (await client.query('SELECT to_jsonb(a) AS value FROM "character_signature_abilities" a')).rows[0].value;
    const history = (await client.query('SELECT to_jsonb(r) AS value FROM "character_signature_spell_revisions" r')).rows[0].value;
    await client.query(upgrade);
    const after = (await client.query('SELECT to_jsonb(a) AS value FROM "character_signature_abilities" a')).rows[0].value;
    expect(after).toEqual({ ...before, current_maneuver_revision_id: null });
    expect((await client.query('SELECT to_jsonb(r) AS value FROM "character_signature_spell_revisions" r')).rows[0].value).toEqual(history);
    await expect(client.query('UPDATE "character_signature_spell_revisions" SET "payload"=\'{}\'::jsonb WHERE "id"=$1', [revision])).rejects.toThrow(/IMMUTABLE/);
    expect((await client.query('SELECT count(*)::int AS count FROM "character_signature_maneuver_revisions"')).rows[0].count).toBe(0);
    expect((await client.query('SELECT "current_revision_id" FROM "character_signature_abilities" WHERE "id"=$1', [ability])).rows[0].current_revision_id).toBe(revision);
  } finally {
    await client.query('SET search_path TO public'); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end();
  }
});
