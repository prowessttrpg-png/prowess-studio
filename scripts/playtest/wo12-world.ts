/**
 * PAS-10 M6-WO12 — playtest preparation command (developer / tester tool; never imported by the application or tests).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prowess_studio_playtest_test pnpm playtest:wo12 prepare [runId]
 *   DATABASE_URL=… pnpm playtest:wo12 status
 *   DATABASE_URL=… pnpm playtest:wo12 cleanup <runId>
 *
 * Refuses any database that is not a local `*_test` database (the shared test-database guard) and any database whose
 * migrations are not fully applied. `prepare` writes `.playtest/m6-wo12-<runId>.json` (git-ignored) and prints what the
 * tester needs. Seeds only the isolated R1 background; the journey itself happens in Studio.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [command = "help", arg] = process.argv.slice(2);
const url = process.env.DATABASE_URL;

function usage(code: number): never {
  console.log("Usage: DATABASE_URL=<local *_test database> pnpm playtest:wo12 prepare [runId] | status | cleanup <runId>");
  process.exit(code);
}
if (!["prepare", "status", "cleanup"].includes(command)) usage(command === "help" ? 0 : 2);
if (command === "cleanup" && (!arg || process.argv.length !== 4)) usage(2);
if (url === undefined || url === "") {
  console.error("DATABASE_URL is required and must name a disposable local *_test database (for example prowess_studio_playtest_test).");
  process.exit(2);
}

const db = await import("../../packages/prowess-db/src/index");
try {
  db.assertRunningAgainstTestDatabase(url);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}
const migrations = readdirSync(path.join(root, "packages/prowess-db/prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
const applied = Number((await db.prisma.$queryRawUnsafe<Array<{ n: bigint }>>('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'))[0]?.n ?? 0);
if (applied !== migrations) {
  console.error(`The database has ${applied} of ${migrations} migrations applied. Apply them first with the same DATABASE_URL: pnpm run db:migrate:deploy`);
  process.exit(2);
}
const fx = await import("../../packages/prowess-db/tests/fixtures/m6-wo12-playtest");

try {
  if (command === "prepare") {
    const started = Date.now();
    console.log("Seeding the isolated WO12 Release 1 (about 400 test-only Definitions; this takes a minute or two)…");
    const w = await fx.preparePlaytestWorld(arg ?? fx.newRunId());
    mkdirSync(path.join(root, ".playtest"), { recursive: true });
    const file = path.join(root, ".playtest", `m6-wo12-${w.runId}.json`);
    writeFileSync(file, `${JSON.stringify(w, null, 2)}\n`);
    console.log(`\nPrepared run ${w.runId} in ${Math.round((Date.now() - started) / 1000)} s (saved to ${path.relative(root, file)}).`);
    console.log(`  Ruleset:            ${w.rulesetName}`);
    console.log(`  Release 1:          Release ${w.release1.releaseNumber} — R1 (${w.release1.id})`);
    console.log(`  Definition to revise in Compendium Admin: ${w.revised.canonicalKey} (Revision 1 "${w.revised.baseDisplayName}")`);
    console.log("Follow docs/playtest/m6-wo12-tester-walkthrough.md from step 1.");
  } else if (command === "status") {
    const rows = await fx.playtestStatus();
    if (rows.length === 0) console.log("No WO12 playtest runs in this database.");
    for (const r of rows) console.log(`${r.runId}\t${r.ruleset}\treleases=${r.releases}\tcharacters=${r.characters}\tchangeSets=${r.changeSets}`);
  } else if (arg !== undefined) {
    const n = await fx.cleanupPlaytestWorlds(arg);
    console.log(`Removed ${n} WO12 playtest Ruleset(s) for run ${arg} and everything built on them.`);
  }
} finally {
  await db.prisma.$disconnect();
}
