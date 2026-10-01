// Plain .mjs (not .ts) deliberately: it imports the untyped root
// scripts/load-studio-env.mjs, and keeping this file out of TypeScript
// avoids needing an ambient module declaration just for that one import.
// tsc ignores .mjs files by default (no allowJs/checkJs here), so this
// also never risks breaking `pnpm typecheck`.
//
// Vitest runs setupFiles to completion BEFORE loading any test file, so by
// the time a test file's `import { prisma } from "../../src/index"` runs
// (which constructs the Prisma client singleton immediately, reading
// process.env.DATABASE_URL at that moment), the correct test-environment
// value is already in place.
import { loadStudioEnv } from "../../../../scripts/load-studio-env.mjs";

loadStudioEnv();
