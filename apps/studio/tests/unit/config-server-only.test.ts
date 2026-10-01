import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { envSchema } from "../../src/config/schema";

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Next.js only ever inlines an environment variable into the browser bundle
 * when it is referenced as `process.env.NEXT_PUBLIC_*` (a static,
 * build-time replacement) or explicitly listed under next.config.ts's
 * `env` key. Neither mechanism is used for DEVELOPMENT_MODE anywhere in
 * this app, and this test enforces that rather than relying on convention:
 *   1. no schema key uses the NEXT_PUBLIC_ prefix,
 *   2. no "use client" file references DEVELOPMENT_MODE (directly or as
 *      NEXT_PUBLIC_DEVELOPMENT_MODE),
 *   3. next.config.ts does not forward it via an `env` key.
 *
 * If a future specification deliberately decides to expose it to the
 * client, that should be a conscious change to this test, not a silent gap.
 */
describe("DEVELOPMENT_MODE is server-only (not exposed to the browser)", () => {
  it("is not declared under Next.js's NEXT_PUBLIC_ client-exposure prefix", () => {
    const keys = Object.keys(envSchema.shape);
    expect(keys).toContain("DEVELOPMENT_MODE");
    for (const key of keys) {
      expect(key.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it('no "use client" file in app/ references DEVELOPMENT_MODE', () => {
    const appDir = path.join(STUDIO_ROOT, "app");
    const offendingFiles: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;

        const contents = readFileSync(fullPath, "utf8");
        const isClientFile = /^\s*["']use client["'];?\s*$/m.test(contents);
        const referencesDevMode =
          contents.includes("DEVELOPMENT_MODE") || contents.includes("NEXT_PUBLIC_DEVELOPMENT_MODE");

        if (isClientFile && referencesDevMode) {
          offendingFiles.push(fullPath);
        }
      }
    }

    walk(appDir);
    expect(offendingFiles).toEqual([]);
  });

  it("next.config.ts does not forward DEVELOPMENT_MODE to the client via an `env` key", () => {
    const configSource = readFileSync(path.join(STUDIO_ROOT, "next.config.ts"), "utf8");
    // A real `env: { ... }` block in next.config.ts is the other mechanism
    // (besides NEXT_PUBLIC_*) that can inline a var into the client bundle.
    // We don't use one at all yet, which this loosely guards against
    // regressing without a deliberate decision.
    const hasEnvBlock = /\benv\s*:\s*\{/.test(configSource);
    if (hasEnvBlock) {
      expect(configSource).not.toMatch(/\benv\s*:\s*\{[^}]*DEVELOPMENT_MODE/s);
    } else {
      expect(hasEnvBlock).toBe(false);
    }
  });
});
