#!/usr/bin/env node
// Loads the correct .env.$(NODE_ENV) file (see load-studio-env.mjs), then
// runs the given command with that environment. Used by the root db:*
// scripts so `prisma generate`/`migrate dev`/etc. always see the right
// DATABASE_URL without requiring the developer to export it by hand.
//
// Usage: node scripts/with-env.mjs <command> [args...]
import { spawnSync } from "node:child_process";
import { loadStudioEnv } from "./load-studio-env.mjs";

loadStudioEnv();

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: with-env.mjs <command> [args...]");
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
