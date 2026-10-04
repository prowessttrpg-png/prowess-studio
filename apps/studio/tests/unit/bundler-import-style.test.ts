// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard (found by the first real CI run): Next's bundler (Turbopack)
 * does NOT map a `.js` import specifier to the `.ts` file beside it, even though
 * `tsc` (bundler resolution) and Vitest both do. Relative imports in code that
 * Next bundles — everything under apps/studio/app and apps/studio/src — must
 * therefore be extensionless. Typecheck, lint and unit tests all pass with
 * `.js` specifiers, so only the production build ever notices; this test makes
 * the cheap, early check that would have caught it.
 *
 * (The workspace PACKAGES keep `.js` specifiers deliberately: they compile with
 * tsc to Node-ESM output, and apps/studio consumes their built dist.)
 */
const ROOT = path.join(process.cwd());

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry === ".next") return [];
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("apps/studio bundled code uses extensionless relative imports", () => {
  const sources = [...files(path.join(ROOT, "app")), ...files(path.join(ROOT, "src"))];

  it("scans a meaningful number of files", () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  it.each(sources.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const text = readFileSync(file as string, "utf8");
    const offenders = [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']*\.js)["']/g)].map((m) => m[1]);
    expect(offenders, "relative .js import specifiers break `next build` (Turbopack)").toEqual([]);
  });
});
