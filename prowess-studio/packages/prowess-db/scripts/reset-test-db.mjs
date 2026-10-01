#!/usr/bin/env node
// The ONLY vetted entrypoint for resetting the test database. Do not call
// `prisma migrate reset` directly anywhere else — always go through this
// script (via `pnpm db:reset:test`), so the safety guard is always
// enforced.
//
// This script — not the caller's shell, not a committed .env file — is
// what sets NODE_ENV=test and TEST_DATABASE_ALLOWED=true. That is
// deliberate: it is what makes the guard's `explicitlyAllowed` check
// meaningful. Any other, unrelated way of invoking a reset won't have
// these set and will be refused.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStudioEnv } from "../../../scripts/load-studio-env.mjs";

process.env.NODE_ENV = "test";
process.env.TEST_DATABASE_ALLOWED = "true";

loadStudioEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set after loading .env.test — aborting.");
  process.exit(1);
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Import the built guard (requires `pnpm --filter @prowess/db run build`
// to have run — the root `db:reset:test` script depends on `build` first;
// see root package.json's `predb:reset:test`). Note the `src/` segment:
// tsconfig.json's rootDir covers both src/ and generated/ (Prisma's
// generated client lives outside src/ and needs compiling too), so the
// build output mirrors that same structure under dist/.
const { assertSafeToResetTestDatabase, UnsafeTestDatabaseResetError } = await import(
  path.join(packageDir, "dist", "src", "testDatabaseGuard.js")
);

try {
  assertSafeToResetTestDatabase({ databaseUrl, explicitlyAllowed: true });
} catch (error) {
  if (error instanceof UnsafeTestDatabaseResetError) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
console.log(`Safety guard passed — resetting test database "${databaseName}".`);

const result = spawnSync(
  "pnpm",
  ["--filter", "@prowess/db", "exec", "prisma", "migrate", "reset", "--force"],
  { stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
