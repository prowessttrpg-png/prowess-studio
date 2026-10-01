import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

// Deliberately independent from the now-removed
// sandbox-verification/env.ts — small enough that duplicating it here is
// simpler than creating a shared dependency, and this file is meant to
// outlive sandbox-verification/ (which this test suite replaces).
//
// Reads apps/studio's .env.development / .env.test files directly via
// dotenv.parse, WITHOUT touching process.env — this suite needs the dev
// URL available for the isolation check (test 7 below) at the same time
// the test URL is used for everything else, in one process.
const STUDIO_ENV_DIR = path.resolve(import.meta.dirname, "../../../../apps/studio");

function readEnvFile(fileName: string): Record<string, string> {
  const filePath = path.join(STUDIO_ENV_DIR, fileName);
  return parse(readFileSync(filePath, "utf8"));
}

export function getDevDatabaseUrl(): string {
  const url = readEnvFile(".env.development").DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL not found in apps/studio/.env.development");
  }
  return url;
}

export function getTestDatabaseUrl(): string {
  const url = readEnvFile(".env.test").DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL not found in apps/studio/.env.test");
  }
  return url;
}
