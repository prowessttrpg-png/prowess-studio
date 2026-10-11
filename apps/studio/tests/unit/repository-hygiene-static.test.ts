// @vitest-environment node
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Repository hygiene guards (pre-M4 baseline cleanup): a single LF line-ending policy, no stale synchronization
 * manifest, no nested repositories or duplicate working trees, and pointer-only placeholder directories.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");

describe("repository hygiene", () => {
  it("declares one cross-platform LF text policy", () => {
    expect(readFileSync(path.join(ROOT, ".gitattributes"), "utf8")).toMatch(/^\* text=auto eol=lf$/m);
  });

  it("has no obsolete synchronization manifest or duplicate working tree", () => {
    for (const p of ["SYNC-MANIFEST.txt", "prowess-sync", "prowess-studio"]) expect(existsSync(path.join(ROOT, p)), p).toBe(false);
    expect(execSync("git ls-files", { cwd: ROOT }).toString()).not.toMatch(/^(SYNC-MANIFEST\.txt|prowess-sync\/|prowess-studio\/)/m);
  });

  it("contains no nested Git repositories", () => {
    const nested: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        if (["node_modules", ".next", "dist", "generated"].includes(e)) continue;
        const f = path.join(d, e);
        if (e === ".git" && d !== ROOT) nested.push(path.relative(ROOT, f));
        else if (e !== ".git" && statSync(f).isDirectory()) walk(f);
      }
    };
    walk(ROOT);
    expect(nested).toEqual([]);
  });

  it("keeps the migrations pointer honest: no migrations outside packages/prowess-db/prisma/migrations", () => {
    expect(readdirSync(path.join(ROOT, "database", "migrations"))).toEqual(["README.md"]);
    expect(readFileSync(path.join(ROOT, "database", "migrations", "README.md"), "utf8")).toContain("packages/prowess-db/prisma/migrations/");
  });
});
