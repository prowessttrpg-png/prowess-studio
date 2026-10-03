// Mirrors packages/prowess-db/tests/integration/setup.mjs exactly — plain
// .mjs for the same reason (keeps the untyped root loadStudioEnv import
// out of TypeScript's way; tsc ignores .mjs by default).
//
// Vitest runs setupFiles to completion before loading any test file, so by
// the time a test file's `import { prisma } from "@prowess/db"` runs
// (constructing the Prisma client singleton immediately, reading
// process.env.DATABASE_URL at that moment), the correct test-environment
// value is already in place.
import { loadStudioEnv } from "../../../../scripts/load-studio-env.mjs";

loadStudioEnv();
