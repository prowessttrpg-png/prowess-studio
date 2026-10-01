import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.mjs"],
    // Real DB round-trips (connection, CRUD, transactions) are slower than
    // typical unit tests; a longer timeout avoids flakiness on a loaded CI
    // runner. Matches sandbox-verification's old config, which this
    // replaces.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
