import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The frozen M1–M6-WO2 gates describe the schema and migration chain AS CERTIFIED. Later Work Orders that are
 * explicitly authorized to change the schema (M6-WO3: the Character domain) register their additions in
 * docs/architecture/m6-schema-changes.json and MARK them in schema.prisma. Earlier gates then compare:
 *
 *   - the schema with exactly the registered, marked additions removed (it must stay byte-identical to their baseline);
 *   - the migration chain without exactly the registered later migrations.
 *
 * An unmarked schema edit, an edit to an existing line, or an unregistered migration still fails every earlier gate.
 * The registry entry itself is pinned by the owning Work Order's gate.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const SCHEMA_PATH = "packages/prowess-db/prisma/schema.prisma";

interface Registry {
  readonly [wo: string]: { readonly migrations: readonly string[]; readonly models: readonly string[] } | string;
}
function registry(): Array<[string, { migrations: readonly string[]; models: readonly string[] }]> {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "docs/architecture/m6-schema-changes.json"), "utf8")) as Registry;
  return Object.entries(raw).filter((e): e is [string, { migrations: readonly string[]; models: readonly string[] }] => /^M\d+-WO\d+$/.test(e[0]) && typeof e[1] === "object");
}

/** Registered later migration directory names. */
export function laterMigrations(): string[] {
  return registry().flatMap(([, v]) => [...v.migrations]);
}

/** True for a migration directory (or a path inside one) that is NOT a registered later migration. */
export function notLaterMigration(nameOrPath: string): boolean {
  return !laterMigrations().some((m) => nameOrPath === m || nameOrPath.includes(`/migrations/${m}/`) || nameOrPath.endsWith(`/migrations/${m}`));
}

/** Removes exactly the registered Work Orders' marked additions from schema text. */
export function stripLaterSchema(text: string): string {
  let out = text;
  for (const [wo] of registry()) {
    const w = wo.replace(/[-]/g, "\\-");
    out = out.replace(new RegExp(`^[^\\n]*// ${w} back-relation[^\\n]*\\n`, "gm"), "");
    out = out.replace(new RegExp(`\\n// >>> ${w}[^\\n]*\\n[\\s\\S]*?// <<< ${w}[^\\n]*\\n`, "g"), "");
  }
  return out;
}

/** schema.prisma as certified before the registered later Work Orders. */
export function frozenSchemaText(): string {
  return stripLaterSchema(readFileSync(path.join(ROOT, SCHEMA_PATH), "utf8"));
}

/** The bytes a frozen-file hash check compares: the frozen schema for schema.prisma, the file itself otherwise. */
export function frozenFileContent(relativePath: string): Buffer | string {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized.endsWith(SCHEMA_PATH)) return frozenSchemaText();
  return readFileSync(path.isAbsolute(relativePath) ? relativePath : path.join(ROOT, relativePath));
}

/*
 * Approved later changes to frozen M5 (@prowess/game) files — docs/architecture/m6-approved-m5-changes.json. An
 * earlier gate's frozen-file check accepts the certified hash OR exactly the registered later hash for that path, and
 * its file-set check ignores exactly the registered added files. The owning Work Order's gate pins its entry.
 */
interface ApprovedChanges {
  readonly [wo: string]: { readonly changedFiles: Record<string, string>; readonly addedFiles: Record<string, string> } | string;
}
function approved(): Array<{ changedFiles: Record<string, string>; addedFiles: Record<string, string> }> {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "docs/architecture/m6-approved-m5-changes.json"), "utf8")) as ApprovedChanges;
  return Object.entries(raw)
    .filter((e): e is [string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> }] => /^M\d+-WO\d+$/.test(e[0]) && typeof e[1] === "object")
    .map(([, v]) => v);
}

/** The hash a frozen file must have: its registered later approved hash if one exists, otherwise its certified hash. */
export function expectedFrozenHash(relativePath: string, certifiedHash: string): string {
  let out = certifiedHash;
  for (const v of approved()) if (v.changedFiles[relativePath] !== undefined) out = v.changedFiles[relativePath];
  return out;
}

/** True unless the path is a registered later added file or inside a registered later migration. */
export function notLaterFile(relativePath: string): boolean {
  if (!notLaterMigration(relativePath)) return false;
  return !approved().some((v) => v.addedFiles[relativePath] !== undefined);
}
