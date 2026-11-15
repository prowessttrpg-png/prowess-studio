import { createHash } from "node:crypto";

const format = "prowess-workspace-1";
export const backupLimit = 256 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const identifier = (name) => '"' + name.replaceAll('"', '""') + '"';

function sameList(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((item, index) => item === b[index]);
}

export function compareVersions(a, b) {
  const parse = (value) => {
    if (typeof value !== "string" || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) {
      throw new Error("The application version is unsupported.");
    }
    return value.split(".").map(Number);
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

async function transaction(client, start, operation) {
  await client.query(start);
  try {
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function columns(client, tables) {
  const names = (await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename
  `)).rows.map((row) => row.tablename).sort();
  if (!sameList(names, tables)) throw new Error("The workspace schema has an unexpected table.");
  const result = await client.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND is_generated = 'NEVER'
    ORDER BY table_name, ordinal_position
  `, [tables]);
  const layout = new Map(tables.map((table) => [table, []]));
  for (const row of result.rows) layout.get(row.table_name).push(row.column_name);
  if ([...layout.values()].some((names) => names.length === 0)) throw new Error("The workspace schema is incomplete.");
  return layout;
}

export async function makeBackup(client, { appVersion, migrations, tables, setup }) {
  const payload = await transaction(client, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", async () => {
    const layout = await columns(client, tables);
    const entries = [];
    for (const [table, names] of layout) {
      const { rows } = await client.query("SELECT row_to_json(t)::text AS record FROM (SELECT " +
        names.map(identifier).join(", ") + " FROM public." + identifier(table) + ") t");
      entries.push({ table, columns: names, rows: rows.map((row) => row.record) });
    }
    return JSON.stringify({ appVersion, postgresMajor: 16, migrations, setup, tables: entries });
  });
  const bytes = Buffer.from(JSON.stringify({ format, sha256: digest(payload), payload }) + "\n");
  if (bytes.length > backupLimit) throw new Error("This workspace exceeds the backup size supported by this version.");
  return bytes;
}

export function inspectBackup(bytes, { appVersion, migrations, tables }) {
  if (bytes.length === 0 || bytes.length > backupLimit) throw new Error("The workspace backup size is invalid.");
  const envelope = JSON.parse(bytes.toString("utf8"));
  if (envelope?.format !== format || typeof envelope.payload !== "string" || digest(envelope.payload) !== envelope.sha256) {
    throw new Error("The workspace backup is damaged or unsupported.");
  }
  const payload = JSON.parse(envelope.payload);
  if (payload?.postgresMajor !== 16 || ![null, "empty", "demo"].includes(payload.setup) ||
      compareVersions(payload.appVersion, appVersion) > 0 || !sameList(payload.migrations, migrations) || !Array.isArray(payload.tables) ||
      !sameList(payload.tables.map((entry) => entry?.table), tables)) {
    throw new Error("The workspace backup requires a compatible application and PostgreSQL schema.");
  }
  return { entries: payload.tables, setup: payload.setup };
}

const characters = "characters";
const advancements = "character_advancements";
const advancementChoices = ["character_affinity_advancement_choices", "character_skill_advancements", "character_stat_advancements"];
const abilities = "character_signature_abilities";
const revisions = ["character_signature_maneuver_revisions", "character_signature_spell_revisions"];
const playEvents = "character_play_events";
const historyTables = new Set([advancements, ...advancementChoices, ...revisions, playEvents]);

async function restoreAdvancements(client, rows, insert, withRows) {
  const steps = new Map();
  const levels = new Map();
  for (const record of rows.get(advancements)) {
    const row = JSON.parse(record);
    if (!steps.has(row.from_level)) steps.set(row.from_level, new Map([[advancements, []], ...advancementChoices.map((table) => [table, []])]));
    steps.get(row.from_level).get(advancements).push(record);
    levels.set(row.id, row.from_level);
  }
  for (const table of advancementChoices) {
    for (const record of rows.get(table)) {
      const step = steps.get(levels.get(JSON.parse(record).advancement_id));
      if (!step) throw new Error("An advancement choice has no saved advancement.");
      step.get(table).push(record);
    }
  }
  for (const [level, step] of [...steps].sort(([a], [b]) => a - b)) {
    for (const [table, records] of step) await insert(table, records);
    await client.query(`
      UPDATE public.characters AS c SET level = a.to_level
      FROM public.character_advancements AS a WHERE a.character_id = c.id AND a.from_level = $1
    `, [level]);
  }
  await withRows(characters, rows.get(characters), async (source, values) => {
    const result = await client.query(`
      SELECT 1 FROM ${source} AS expected JOIN public.characters AS actual USING (id)
      WHERE actual.level IS DISTINCT FROM expected.level LIMIT 1
    `, [values]);
    if (result.rowCount) throw new Error("The restored Character level does not match its saved advancement history.");
  });
}

async function restoreAbilityRevisions(client, rows, insert, withRows) {
  for (const table of revisions) {
    const ordered = rows.get(table).map((record) => ({ record, number: JSON.parse(record).revision_number }))
      .sort((a, b) => a.number - b.number).map(({ record }) => record);
    await insert(table, ordered, {}, " ORDER BY revision_number");
  }
  await withRows(abilities, rows.get(abilities), (source, values) => client.query(`
    UPDATE public.character_signature_abilities AS ability
    SET status = expected.status, retired_at = expected.retired_at,
        current_revision_id = expected.current_revision_id, current_maneuver_revision_id = expected.current_maneuver_revision_id
    FROM ${source} AS expected WHERE ability.id = expected.id
  `, [values]));
}

export async function loadBackup(client, entries, tables) {
  await transaction(client, "BEGIN", async () => {
    await client.query("SET LOCAL prowess.content_pack_transfer = 'on'");
    const layout = await columns(client, tables);
    const constraints = (await client.query(`
      SELECT rel.relname AS table_name, c.conname AS name, c.condeferrable AS deferrable, c.condeferred AS deferred
      FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public' AND rel.relname = ANY($1::text[])
    `, [tables])).rows;
    const alter = (entry) => "ALTER TABLE public." + identifier(entry.table_name) +
      " ALTER CONSTRAINT " + identifier(entry.name);
    for (const entry of constraints) if (!entry.deferrable) await client.query(alter(entry) + " DEFERRABLE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    const rows = new Map();
    for (const [index, table] of tables.entries()) {
      const entry = entries[index];
      const names = layout.get(table);
      if (entry.table !== table || !sameList(entry.columns, names) || !Array.isArray(entry.rows)) {
        throw new Error("The backup contains an incompatible table layout.");
      }
      const sortedNames = [...names].sort();
      for (const row of entry.rows) {
        const decoded = typeof row === "string" ? JSON.parse(row) : null;
        if (!decoded || Array.isArray(decoded) || !sameList(Object.keys(decoded).sort(), sortedNames)) {
          throw new Error("The backup contains an invalid row.");
        }
      }
      rows.set(table, entry.rows);
    }
    const qualified = (table) => "public." + identifier(table);
    const withRows = async (table, records, query) => {
      const source = "json_populate_recordset(NULL::" + qualified(table) + ", $1::json)";
      for (let i = 0; i < records.length; i += 100) {
        await query(source, "[" + records.slice(i, i + 100).join(",") + "]");
      }
    };
    const insert = (table, records, staged = {}, order = "") => {
      const names = layout.get(table);
      const columns = names.map(identifier).join(", ");
      const values = names.map((name) => staged[name] ?? identifier(name)).join(", ");
      return withRows(table, records, (source, batch) => client.query(
        "INSERT INTO " + qualified(table) + " (" + columns + ") OVERRIDING SYSTEM VALUE SELECT " +
        values + " FROM " + source + order, [batch]));
    };

    // Restore frozen core choices before their Character. Restore histories through the live INSERT and UPDATE guards.
    for (const table of tables) {
      if (historyTables.has(table)) continue;
      const staged = table === characters ? { level: "1" } : table === abilities ? {
        status: "'DRAFT'", retired_at: "NULL", current_revision_id: "NULL", current_maneuver_revision_id: "NULL",
      } : {};
      await insert(table, rows.get(table), staged);
    }
    await restoreAdvancements(client, rows, insert, withRows);
    await restoreAbilityRevisions(client, rows, insert, withRows);
    // The event Release guard needs an existing runtime even when the foreign key is deferred.
    await insert(playEvents, rows.get(playEvents));

    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const entry of constraints) if (!entry.deferrable) await client.query(alter(entry) + " NOT DEFERRABLE");
  });
}
