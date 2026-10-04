import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // "node", not the main vitest.config.ts's "jsdom" — these tests call
    // Next.js route handlers directly as functions against a real
    // database; no DOM is involved.
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // All integration files share ONE database, and several use overlapping
    // fixture prefixes with prefix-wide cleanup in afterAll. Running files
    // concurrently made them delete each other's live rows (found by the
    // first real CI run: FK violations in cleanup, "Entity not found"
    // mid-test, and a lifecycle test losing its row). Sequential files make
    // each file's setup/teardown the only thing touching the database.
    fileParallelism: false,
    setupFiles: ["./tests/integration/setup.mjs"],
    // Real DB round-trips are slower than typical unit tests — same
    // reasoning and same value as packages/prowess-db/vitest.integration.config.ts.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
