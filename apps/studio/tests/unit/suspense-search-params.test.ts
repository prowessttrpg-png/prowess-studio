// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Early guard for a rule only `next build` otherwise enforces: any page that
 * can be statically pre-rendered must wrap a component that calls
 * `useSearchParams()` in `<Suspense>`. Lint, typecheck, and every test pass
 * without it — the first real CI build was the first thing to notice.
 *
 * Rule checked: a `page.tsx` that calls `useSearchParams()` itself, OR imports a
 * relative module that does, must contain `<Suspense` and must not call the
 * hook outside a component it wraps (approximated: the page file's default
 * export must not be the function that calls the hook).
 */
const ROOT = path.join(process.cwd(), "app");

function pages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return pages(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

/** Comments are removed first: a comment that merely MENTIONS `<Suspense>` must not satisfy the rule. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function relativeImports(source: string, from: string): string[] {
  return [...source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].flatMap((m) => {
    const base = path.resolve(path.dirname(from), m[1] as string);
    return [`${base}.tsx`, `${base}.ts`].filter(existsSync);
  });
}

describe("pages that read the URL's search params are Suspense-wrapped", () => {
  const all = pages(ROOT);

  it("finds the app's pages", () => {
    expect(all.length).toBeGreaterThanOrEqual(9);
  });

  it.each(all.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const source = code(readFileSync(file as string, "utf8"));
    const readsParams =
      /useSearchParams\s*\(/.test(source) ||
      relativeImports(source, file as string).some((mod) => /useSearchParams\s*\(/.test(code(readFileSync(mod, "utf8"))));
    if (!readsParams) return;

    expect(source, "must wrap the URL-reading component in <Suspense>").toMatch(/<Suspense[\s>]/);

    // The default export must not itself be the function that calls the hook.
    const exportStart = source.indexOf("export default function");
    expect(exportStart, "page must have a default-exported function").toBeGreaterThanOrEqual(0);
    // Slice FROM `export default` (not after it), or the pattern below can never match
    // and this check silently passes on an empty string.
    const own = /^export default function[\s\S]*?\n\}\n/m.exec(source.slice(exportStart))?.[0] ?? "";
    expect(own.length, "extracted the default export's body (a check that matches nothing proves nothing)").toBeGreaterThan(20);
    expect(own, "the default-exported page must not call useSearchParams() directly").not.toMatch(/useSearchParams\s*\(/);
  });
});
