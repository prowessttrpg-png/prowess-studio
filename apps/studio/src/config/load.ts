import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Populate `process.env` from `.env.$(NODE_ENV)` — following Next.js's own
 * file-precedence rules closely enough for our purposes — without
 * depending on @next/env's `loadEnvConfig`.
 *
 * `next dev`/`build`/`start` already load env files themselves before your
 * code (including next.config.ts) ever runs, so this function exists for
 * tooling that runs *outside* the Next CLI: test setup, and future
 * migration/seed scripts.
 *
 * @next/env's `loadEnvConfig` snapshots `process.env` on its first call in
 * a process and resets to that snapshot on every subsequent call — correct
 * for `next dev`/`build`/`start` (NODE_ENV never changes for the life of
 * those processes) but incompatible with a single test run that needs to
 * prove more than one environment's files load correctly. This is a plain,
 * stateless dotenv loader instead, so calling it repeatedly with a
 * different NODE_ENV — as the config tests below do — behaves as expected.
 *
 * Values already present in `process.env` always win over file contents
 * (dotenv's default), which is what lets a deployment platform's real
 * secrets override anything a committed file might contain. Per Next.js
 * convention, `.env.local` is not loaded when NODE_ENV=test, keeping a
 * developer's personal overrides out of test runs.
 */
export function loadEnv(projectDir: string = process.cwd()): void {
  const nodeEnv = process.env.NODE_ENV ?? "development";

  const candidates =
    nodeEnv === "test"
      ? [".env.test.local", ".env.test", ".env"]
      : [`.env.${nodeEnv}.local`, ".env.local", `.env.${nodeEnv}`, ".env"];

  for (const fileName of candidates) {
    const filePath = path.join(projectDir, fileName);
    if (existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false });
    }
  }
}
