import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm run build && ./node_modules/.bin/next start -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // `next build`/`next start` always force NODE_ENV=production, which
      // does not load .env.production (deliberately not committed — see
      // .env.production.example). These CI-safe, non-secret values are
      // supplied directly as process env vars instead, exactly as a real
      // deployment platform would inject its own secrets — demonstrating
      // the M0-WO2 config validation path for production without ever
      // committing a production secret.
      // Reuses prowess_studio_test (not a separate "e2e" database) —
      // CI only provisions prowess_studio_dev and prowess_studio_test (see
      // M0-WO2/M0-WO3), and apps/studio doesn't query the database at all
      // yet, so this is purely for config-shape validation today. Keeping
      // it aligned with the two real database names avoids a third,
      // never-actually-created name lingering in the codebase.
      APP_URL: "http://127.0.0.1:3100",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/prowess_studio_test",
      LOG_LEVEL: "warn",
      DEVELOPMENT_MODE: "false",
    },
  },
});
