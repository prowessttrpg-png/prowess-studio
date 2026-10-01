// Shared by root-level db:* tooling scripts (with-env.mjs,
// packages/prowess-db/scripts/reset-test-db.mjs) so there is exactly one
// place that knows how to find the right .env.$(NODE_ENV) file for CLI
// tooling that runs outside the Next.js CLI.
//
// This intentionally mirrors the precedence rules in
// apps/studio/src/config/load.ts (Next.js's own .env.$(NODE_ENV).local /
// .env.local / .env.$(NODE_ENV) / .env order, with .env.local skipped for
// test). It is a separate, small, plain-JS module — not imported from
// load.ts — because packages/scripts here must not depend on apps/studio,
// and apps/studio's TypeScript module isn't reachable from a plain Node
// script without a build step. Keep the two in sync if the precedence
// rules ever change; both are short enough that this is low-risk.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ENV_DIR = path.resolve(SCRIPTS_DIR, "..", "apps", "studio");

/**
 * Populate `process.env` from the correct `.env.$(NODE_ENV)` file under
 * apps/studio — the single canonical location for environment
 * configuration, established in M0-WO2. Values already present in
 * `process.env` always win (dotenv's default `override: false`).
 */
export function loadStudioEnv() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const candidates =
    nodeEnv === "test"
      ? [".env.test.local", ".env.test", ".env"]
      : [`.env.${nodeEnv}.local`, ".env.local", `.env.${nodeEnv}`, ".env"];

  for (const fileName of candidates) {
    const filePath = path.join(STUDIO_ENV_DIR, fileName);
    if (existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false });
    }
  }
}
