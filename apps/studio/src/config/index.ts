import { loadEnv } from "./load";
import { validateEnv } from "./validate";
import type { AppConfig } from "./schema";

export * from "./schema";
export * from "./validate";
export { loadEnv } from "./load";

let cachedConfig: AppConfig | undefined;

/**
 * Load (if needed) and validate the application's environment configuration,
 * caching the result for the lifetime of the process.
 *
 * Throws {@link EnvironmentConfigError} with a readable, complete list of
 * problems if required configuration is missing or malformed — callers at
 * the process boundary (next.config.ts) are responsible for turning that
 * into a clear startup failure.
 */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    loadEnv();
    cachedConfig = validateEnv(process.env);
  }
  return cachedConfig;
}

/** Test-only: clear the cached config so a test can re-validate from scratch. */
export function resetConfigCacheForTests(): void {
  cachedConfig = undefined;
}
