import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // "node", not the main vitest.config.ts's "jsdom" — these tests call
    // Next.js route handlers directly as functions against a real
    // database; no DOM is involved.
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.mjs"],
    // Real DB round-trips are slower than typical unit tests — same
    // reasoning and same value as packages/prowess-db/vitest.integration.config.ts.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
