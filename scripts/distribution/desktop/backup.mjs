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

export async function loadBackup(client, entries, tables) {
  await transaction(client, "BEGIN", async () => {
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

    for (const [index, table] of tables.entries()) {
      const entry = entries[index];
      const names = layout.get(table);
      if (entry.table !== table || !sameList(entry.columns, names) || !Array.isArray(entry.rows)) {
        throw new Error("The backup contains an incompatible table layout.");
      }
      const columnSQL = names.map(identifier).join(", ");
      const qualified = "public." + identifier(table);
      for (let i = 0; i < entry.rows.length; i += 100) {
        const rows = entry.rows.slice(i, i + 100);
        for (const row of rows) {
          const decoded = typeof row === "string" ? JSON.parse(row) : null;
          if (!decoded || Array.isArray(decoded) || !sameList(Object.keys(decoded).sort(), [...names].sort())) {
            throw new Error("The backup contains an invalid row.");
          }
        }
        await client.query("INSERT INTO " + qualified + " (" + columnSQL + ") OVERRIDING SYSTEM VALUE SELECT " +
          columnSQL + " FROM json_populate_recordset(NULL::" + qualified + ", $1::json)", ["[" + rows.join(",") + "]"]);
      }
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const entry of constraints) if (!entry.deferrable) await client.query(alter(entry) + " NOT DEFERRABLE");
  });
}
