import { describe, expect, it } from "vitest";
import { EnvironmentConfigError, validateEnv } from "../../src/config/validate";

const VALID_BASE = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/prowess_studio_dev",
  DEVELOPMENT_MODE: "true",
};

describe("validateEnv", () => {
  it("loads a valid development configuration", () => {
    const config = validateEnv({ ...VALID_BASE, NODE_ENV: "development", LOG_LEVEL: "debug" });
    expect(config.isDevelopment).toBe(true);
    expect(config.isTest).toBe(false);
    expect(config.isProduction).toBe(false);
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.APP_URL).toBe("http://localhost:3000");
  });

  it("loads a valid test configuration independently of development", () => {
    const config = validateEnv({
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/prowess_studio_test",
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      DEVELOPMENT_MODE: "false",
    });
    expect(config.isTest).toBe(true);
    expect(config.isDevelopment).toBe(false);
    expect(config.DATABASE_URL).toContain("prowess_studio_test");
  });

  it("loads a valid production configuration", () => {
    const config = validateEnv({
      APP_URL: "https://studio.example.com",
      DATABASE_URL: "postgresql://user:pass@db.internal:5432/prowess_studio",
      NODE_ENV: "production",
      DEVELOPMENT_MODE: "false",
    });
    expect(config.isProduction).toBe(true);
    // LOG_LEVEL has a default, so omitting it is not an error.
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("defaults NODE_ENV to development when unset", () => {
    const config = validateEnv({ ...VALID_BASE });
    expect(config.NODE_ENV).toBe("development");
    expect(config.isDevelopment).toBe(true);
  });

  it("throws a readable EnvironmentConfigError when APP_URL is missing", () => {
    expect(() =>
      validateEnv({ DATABASE_URL: VALID_BASE.DATABASE_URL, DEVELOPMENT_MODE: "true" }),
    ).toThrow(EnvironmentConfigError);

    try {
      validateEnv({ DATABASE_URL: VALID_BASE.DATABASE_URL, DEVELOPMENT_MODE: "true" });
      expect.unreachable("validateEnv should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigError);
      const configError = error as EnvironmentConfigError;
      expect(configError.issues.some((issue) => issue.startsWith("APP_URL"))).toBe(true);
      expect(configError.message).toContain("APP_URL");
    }
  });

  it("throws a readable EnvironmentConfigError when DATABASE_URL is missing", () => {
    try {
      validateEnv({ APP_URL: VALID_BASE.APP_URL, DEVELOPMENT_MODE: "true" });
      expect.unreachable("validateEnv should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigError);
      expect((error as EnvironmentConfigError).issues.some((i) => i.startsWith("DATABASE_URL"))).toBe(
        true,
      );
    }
  });

  it("reports every problem at once, not just the first", () => {
    try {
      validateEnv({ NODE_ENV: "not-a-real-environment" });
      expect.unreachable("validateEnv should have thrown");
    } catch (error) {
      const configError = error as EnvironmentConfigError;
      // NODE_ENV, APP_URL, DATABASE_URL, and DEVELOPMENT_MODE are all
      // invalid/missing here.
      expect(configError.issues.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("rejects a DATABASE_URL that is not a postgres connection string", () => {
    expect(() =>
      validateEnv({
        APP_URL: VALID_BASE.APP_URL,
        DATABASE_URL: "mysql://localhost/db",
        DEVELOPMENT_MODE: "true",
      }),
    ).toThrow(EnvironmentConfigError);
  });

  it("rejects an APP_URL that is not a valid URL", () => {
    expect(() =>
      validateEnv({
        APP_URL: "not-a-url",
        DATABASE_URL: VALID_BASE.DATABASE_URL,
        DEVELOPMENT_MODE: "true",
      }),
    ).toThrow(EnvironmentConfigError);
  });

  it("rejects an unrecognized LOG_LEVEL", () => {
    expect(() => validateEnv({ ...VALID_BASE, LOG_LEVEL: "verbose" })).toThrow(
      EnvironmentConfigError,
    );
  });

  describe("DEVELOPMENT_MODE", () => {
    it('parses "true" as boolean true', () => {
      const config = validateEnv({ ...VALID_BASE, DEVELOPMENT_MODE: "true" });
      expect(config.DEVELOPMENT_MODE).toBe(true);
    });

    it('parses "false" as boolean false', () => {
      const config = validateEnv({ ...VALID_BASE, DEVELOPMENT_MODE: "false" });
      expect(config.DEVELOPMENT_MODE).toBe(false);
    });

    it("fails clearly on an unsupported value, rather than using JS truthiness", () => {
      try {
        validateEnv({ ...VALID_BASE, DEVELOPMENT_MODE: "maybe" });
        expect.unreachable("validateEnv should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvironmentConfigError);
        const configError = error as EnvironmentConfigError;
        expect(configError.issues.some((issue) => issue.startsWith("DEVELOPMENT_MODE"))).toBe(true);
        expect(configError.message).toContain("DEVELOPMENT_MODE");
        expect(configError.message).toContain('"true" or "false"');
      }
    });

    it("fails on other truthy-looking-but-unsupported representations", () => {
      // Deliberately not accepted, to prove this is a literal check and not
      // JS truthiness / common alternate boolean spellings.
      for (const unsupported of ["1", "0", "yes", "no", "TRUE", "False", ""]) {
        expect(
          () => validateEnv({ ...VALID_BASE, DEVELOPMENT_MODE: unsupported }),
          `expected "${unsupported}" to be rejected`,
        ).toThrow(EnvironmentConfigError);
      }
    });

    it("is required — omitting it fails validation rather than defaulting", () => {
      const { DEVELOPMENT_MODE: _omit, ...withoutDevelopmentMode } = VALID_BASE;
      try {
        validateEnv(withoutDevelopmentMode);
        expect.unreachable("validateEnv should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvironmentConfigError);
        expect(
          (error as EnvironmentConfigError).issues.some((i) => i.startsWith("DEVELOPMENT_MODE")),
        ).toBe(true);
      }
    });

    it("is available through the centralized validated configuration object", () => {
      const config = validateEnv({ ...VALID_BASE, DEVELOPMENT_MODE: "true" });
      expect(config).toHaveProperty("DEVELOPMENT_MODE");
      expect(typeof config.DEVELOPMENT_MODE).toBe("boolean");
    });
  });
});
