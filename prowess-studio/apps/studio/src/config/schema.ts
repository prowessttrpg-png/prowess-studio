import { z } from "zod";

/**
 * Supported runtime environments (PAS-10 §8, M0-WO2).
 */
export const ENVIRONMENTS = ["development", "test", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Explicit, literal string representations accepted for a boolean
 * environment variable. Deliberately narrow — no "1"/"0", "yes"/"no", or
 * JavaScript-truthiness fallback (an unset var, empty string, or typo like
 * "TRUE"/"maybe" must fail validation, not silently coerce to a boolean).
 */
const BOOLEAN_STRING_VALUES = ["true", "false"] as const;

function booleanEnvVar(variableName: string) {
  return z
    .string({
      message: `${variableName} is required ("true" or "false")`,
    })
    .refine((value): value is (typeof BOOLEAN_STRING_VALUES)[number] =>
      (BOOLEAN_STRING_VALUES as readonly string[]).includes(value), {
      message: `${variableName} must be exactly "true" or "false" (received an unsupported value) — this is a literal string check, not JavaScript truthiness`,
    })
    .transform((value) => value === "true");
}

/**
 * The five configuration categories required by PAS-10 §8:
 *   - database connection    -> DATABASE_URL
 *   - application URL        -> APP_URL
 *   - logging level          -> LOG_LEVEL
 *   - development/debug mode -> DEVELOPMENT_MODE
 *
 * `NODE_ENV` and `DEVELOPMENT_MODE` answer two different questions and are
 * validated independently — `DEVELOPMENT_MODE` is never derived from
 * `NODE_ENV`:
 *   - NODE_ENV determines the development/test/production *runtime
 *     environment* (affects which .env.$(NODE_ENV) file loads, how Next.js
 *     builds/optimizes, etc.).
 *   - DEVELOPMENT_MODE determines whether Prowess Studio's own
 *     development/debug *capabilities* are enabled (e.g. verbose developer
 *     tooling in a later milestone) — a product decision, not a build mode.
 *     A production deployment could, in principle, run with
 *     DEVELOPMENT_MODE=true for internal debugging; that's exactly why it
 *     must not be inferred from NODE_ENV.
 *
 * DATABASE_URL is validated for *shape* only in M0-WO2 — no database client
 * exists yet (that begins in M0-WO3). Validating it now means M0-WO3 can
 * assume a well-formed connection string is already guaranteed by the time
 * it introduces the actual client.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(ENVIRONMENTS).default("development"),

  APP_URL: z
    .string({ message: "APP_URL is required (the application's base URL, e.g. http://localhost:3000)" })
    .url("APP_URL must be a valid URL, e.g. http://localhost:3000"),

  DATABASE_URL: z
    .string({ message: "DATABASE_URL is required (a PostgreSQL connection string)" })
    .min(1, "DATABASE_URL is required (a PostgreSQL connection string)")
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "DATABASE_URL must be a postgresql:// (or postgres://) connection string",
    }),

  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

  // Server-only by construction: this schema is consumed by next.config.ts
  // and src/config/*, never by a "use client" component, and nothing here
  // uses Next's NEXT_PUBLIC_ prefix (the only mechanism that inlines an
  // env var into the browser bundle) — see
  // tests/unit/config-server-only.test.ts, which enforces this.
  DEVELOPMENT_MODE: booleanEnvVar("DEVELOPMENT_MODE"),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig extends RawEnv {
  /**
   * Derived from NODE_ENV — which *runtime environment* the app is running
   * as. Distinct from DEVELOPMENT_MODE (above), which is the explicit,
   * independently-configured development/debug-mode toggle.
   */
  isDevelopment: boolean;
  isTest: boolean;
  isProduction: boolean;
}
