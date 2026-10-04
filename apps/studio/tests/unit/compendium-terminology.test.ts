// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Textual regression (PAS-10 M1-WO10 §38): no Compendium source may put the
 * misleading labels "Current Version", "Current Rule", "Active Version",
 * "Active Revision", "Current Revision" or "Canon Version" in user-facing
 * text. The ONLY sanctioned phrases are Latest Revision / Selected Revision /
 * Revision N / Version History (and a literal CANON status badge).
 *
 * Comments are stripped first — code comments and docs legitimately explain
 * that these terms are NOT used.
 */
const FORBIDDEN = /current version|current rule|current revision|active version|active revision|canon version/i;
const ROOT = path.join(process.cwd(), "app", "compendium");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Compendium terminology", () => {
  const files = sourceFiles(ROOT);

  it("scans a meaningful set of files, including the Version History modules", () => {
    const names = files.map((f) => path.basename(f));
    expect(files.length).toBeGreaterThan(15);
    expect(names).toContain("VersionHistoryList.tsx");
    expect(names).toContain("RevisionComparison.tsx");
    expect(names).toContain("EntityDetailView.tsx");
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f]))("%s has no misleading 'current/active/Canon version' label", (_name, file) => {
    const text = stripComments(readFileSync(file as string, "utf8"));
    expect(text).not.toMatch(FORBIDDEN);
  });
});
