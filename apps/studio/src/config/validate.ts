import { envSchema, type AppConfig } from "./schema";

/**
 * Thrown when required configuration is missing or malformed. The message
 * is a human-readable, multi-line list of every problem found (not just the
 * first), so a misconfigured deployment can be fixed in one pass rather
 * than one failed boot at a time.
 */
export class EnvironmentConfigError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid or missing environment configuration:\n${issues
        .map((issue) => `  - ${issue}`)
        .join("\n")}`,
    );
    this.name = "EnvironmentConfigError";
    this.issues = issues;
  }
}

/**
 * Validate a raw environment (e.g. `process.env`) against the shared schema.
 *
 * Pure and side-effect-free — it does not read files or mutate
 * `process.env`, which keeps it trivially unit-testable against fixtures for
 * every environment. File-based loading lives separately in `load.ts`.
 */
export function validateEnv(rawEnv: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    throw new EnvironmentConfigError(issues);
  }

  const data = result.data;

  return {
    ...data,
    isDevelopment: data.NODE_ENV === "development",
    isTest: data.NODE_ENV === "test",
    isProduction: data.NODE_ENV === "production",
  };
}
