import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../src/config/load";
import { validateEnv } from "../../src/config/validate";

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CONFIG_KEYS = ["APP_URL", "DATABASE_URL", "LOG_LEVEL", "DEVELOPMENT_MODE"] as const;

function clearConfigEnvVars() {
  for (const key of CONFIG_KEYS) {
    delete process.env[key];
  }
}

describe("environment file loading (real .env.development / .env.test)", () => {
  afterEach(() => {
    clearConfigEnvVars();
    vi.unstubAllEnvs();
    loadEnv(STUDIO_ROOT);
  });

  it("loads .env.test — a distinct, valid, isolated configuration — when NODE_ENV=test", () => {
    clearConfigEnvVars();
    vi.stubEnv("NODE_ENV", "test");

    loadEnv(STUDIO_ROOT);
    const config = validateEnv(process.env);

    expect(config.isTest).toBe(true);
    expect(config.DATABASE_URL).toContain("prowess_studio_test");
    expect(config.LOG_LEVEL).toBe("warn");
    expect(config.DEVELOPMENT_MODE).toBe(false);
  });

  it("loads .env.development — a different configuration — when NODE_ENV=development", () => {
    clearConfigEnvVars();
    vi.stubEnv("NODE_ENV", "development");

    loadEnv(STUDIO_ROOT);
    const config = validateEnv(process.env);

    expect(config.isDevelopment).toBe(true);
    expect(config.DATABASE_URL).toContain("prowess_studio_dev");
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.DEVELOPMENT_MODE).toBe(true);
  });

  it("switching NODE_ENV between calls does not leak values from the other environment", () => {
    clearConfigEnvVars();
    vi.stubEnv("NODE_ENV", "development");
    loadEnv(STUDIO_ROOT);
    const devConfig = validateEnv(process.env);
    expect(devConfig.DATABASE_URL).toContain("prowess_studio_dev");

    clearConfigEnvVars();
    vi.stubEnv("NODE_ENV", "test");
    loadEnv(STUDIO_ROOT);
    const testConfig = validateEnv(process.env);

    expect(testConfig.DATABASE_URL).toContain("prowess_studio_test");
    expect(testConfig.DATABASE_URL).not.toBe(devConfig.DATABASE_URL);
    expect(devConfig.DEVELOPMENT_MODE).toBe(true);
    expect(testConfig.DEVELOPMENT_MODE).toBe(false);
  });
});
