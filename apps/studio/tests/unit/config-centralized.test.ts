import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig, resetConfigCacheForTests } from "../../src/config";
import { loadEnv } from "../../src/config/load";

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CONFIG_KEYS = ["APP_URL", "DATABASE_URL", "LOG_LEVEL", "DEVELOPMENT_MODE"] as const;

function clearConfigEnvVars() {
  for (const key of CONFIG_KEYS) {
    delete process.env[key];
  }
}

describe("DEVELOPMENT_MODE via the centralized getConfig() accessor", () => {
  afterEach(() => {
    resetConfigCacheForTests();
    clearConfigEnvVars();
    vi.unstubAllEnvs();
    loadEnv(STUDIO_ROOT);
  });

  it("is present, typed boolean, and correct for the real .env.development file", () => {
    resetConfigCacheForTests();
    clearConfigEnvVars();
    vi.stubEnv("NODE_ENV", "development");

    // getConfig() itself calls loadEnv() internally — this proves the
    // single, centralized server-configuration entry point (not just the
    // lower-level validateEnv()) exposes DEVELOPMENT_MODE.
    const config = getConfig();

    expect(config).toHaveProperty("DEVELOPMENT_MODE");
    expect(typeof config.DEVELOPMENT_MODE).toBe("boolean");
    expect(config.DEVELOPMENT_MODE).toBe(true);
  });

  it("is present, typed boolean, and correct for the real .env.test file", () => {
    resetConfigCacheForTests();
    clearConfigEnvVars();
    vi.stubEnv("NODE_ENV", "test");

    const config = getConfig();

    expect(typeof config.DEVELOPMENT_MODE).toBe("boolean");
    expect(config.DEVELOPMENT_MODE).toBe(false);
  });
});
