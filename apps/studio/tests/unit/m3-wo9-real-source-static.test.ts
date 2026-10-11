// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3-WO9 static audit — the developer real-source tooling (`pnpm import:source`, `pnpm import:verify-real-source`)
 * is a thin wrapper over existing public services: no parser, hashing or persistence of its own, no game / governance
 * writes, no decisions, no Prowess-specific semantic parsing, no local path stored as source identity — and the real
 * Rulebook is never part of the repository.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SCRIPTS = { importSource: "packages/prowess-db/scripts/import-source.mjs", verify: "packages/prowess-db/scripts/verify-real-source.mjs" };
const code = (rel: string) => strip(read(...rel.split("/")));

describe("M3-WO9 developer real-source tooling", () => {
  it("is wired as developer-only root commands that build first and require an explicit --file", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["import:source"]).toBe("node --import ./scripts/dev/register-extensionless.mjs packages/prowess-db/scripts/import-source.mjs");
    expect(pkg.scripts["import:verify-real-source"]).toBe("node --import ./scripts/dev/register-extensionless.mjs packages/prowess-db/scripts/verify-real-source.mjs");
    for (const k of ["preimport:source", "preimport:verify-real-source"]) expect(pkg.scripts[k]).toMatch(/run build$/);
    for (const rel of Object.values(SCRIPTS)) {
      expect(code(rel)).toMatch(/if \(!file\) \{[\s\S]*?process\.exit\(2\);/);
      expect(code(rel)).not.toMatch(/readdirSync|glob|homedir|Downloads|\.cache/); // never searches for the Rulebook
    }
    const ci = read(".github", "workflows", "ci.yml");
    expect(ci).not.toMatch(/import:source|import:verify-real-source|\.docx/);
  });

  it("imports only Node built-ins, the env loader, the built @prowess/db surface and @prowess/import's canonicalJson", () => {
    for (const rel of Object.values(SCRIPTS)) {
      const src = code(rel);
      for (const m of src.matchAll(/(?:from\s+|import\()\s*"([^"]+)"/g)) expect(m[1], rel).toMatch(/^(node:(fs|path|url)|\.\.\/\.\.\/\.\.\/scripts\/load-studio-env\.mjs|@prowess\/import)$/);
      expect(src, rel).toMatch(/await import\(path\.join\(packageDir, "dist", "src", "index\.js"\)\)/);
    }
    expect(code(SCRIPTS.importSource)).toMatch(/const \{ canonicalJson \} = await import\("@prowess\/import"\);/);
  });

  it("implements no parser, hashing or persistence of its own", () => {
    for (const rel of Object.values(SCRIPTS)) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/zlib|inflate|word\/document\.xml|<w:|createHash|sha256|\bprisma\.(?!\$disconnect)|\$queryRaw|\$executeRaw|writeFileSync\(file|insert\w*\(/i);
    }
  });

  it("calls only source / extraction / matching services — never decisions, Canon, governance or domain creation", () => {
    const calls = (rel: string) => [...new Set([...code(rel).matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]))].sort();
    expect(calls(SCRIPTS.importSource)).toEqual(["createSourceDocument", "getSourceStructure", "hashSourceStructure", "ingestSourceSnapshot", "listSourceDocuments", "parseDocxStructure"]);
    expect(calls(SCRIPTS.verify)).toEqual([
      "analyzeImportBatchMatches", "createImportBatch", "extractImportBatch", "getExtractionResult", "getImportBatch", "getSourceStructure",
      "ingestSourceSnapshot", "listExtractionCandidates", "listImportDecisionsForBatch", "listSourceDocuments", "verifyExtractionOutput",
    ]);
  });

  it("assigns no source authority and never stores the local path as source identity", () => {
    const src = code(SCRIPTS.importSource);
    expect(src).toMatch(/createSourceDocument\(\{ title, sourceType: "DOCUMENT", versionLabel: declaredVersion, notes: declaredDraftState \}\)/);
    expect(src).not.toMatch(/authorityStatus|fileReference|GOVERNING|CURRENT_PRIMARY|CANON/);
    expect(src).toMatch(/const filename = path\.basename\(file\);/);
    expect(src).toMatch(/originalFilename: filename/);
    expect(code(SCRIPTS.verify)).toMatch(/originalFilename: path\.basename\(file\)/);
  });

  it("contains no Prowess-specific semantic parsing (pilot sections are caller input)", () => {
    for (const rel of Object.values(SCRIPTS)) expect(code(rel), rel).not.toMatch(/spell|casting|damage|emission|evocation|arcana|requires|keywords?:|formula|\bAP\b|\bMP\b/i);
    expect(code(SCRIPTS.verify)).toMatch(/const section = structure\.sections\.find\(\(s\) => s\.title === pilot\);/);
  });

  it("the developer resolve hook only retries extensionless relative specifiers with .js", () => {
    const hook = code("scripts/dev/extensionless-resolve.mjs");
    expect(hook).toMatch(/return nextResolve\(`\$\{specifier\}\.js`, context\);/);
    expect(hook).not.toMatch(/fetch|readFile|process\.env/);
  });
});

describe("M3-WO9 the real Rulebook is not in the repository", () => {
  it("no .docx source and no file over 5 MB is tracked in the working tree", () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        if ([".git", "node_modules", ".next", "dist", "generated", "test-results", "playwright-report"].includes(e)) continue;
        const f = path.join(d, e);
        const st = statSync(f);
        if (st.isDirectory()) walk(f);
        else if (/\.docx$/i.test(e) || st.size > 5 * 1024 * 1024) offenders.push(path.relative(ROOT, f));
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
  });

  it("the import report records metadata and hashes, not the Rulebook text", () => {
    const report = read("docs", "import-reports", "m3-wo9-core-playtest-v0.1.md");
    expect(report).toContain("21fa6771ebdbb984941e55e45adaa8a7b6747555645530854ad401540ecde54d");
    expect(report).toContain("The ~898-page figure is not stored in the DOCX metadata and therefore was not derived by Prowess Studio. The source page count is recorded as unavailable.");
    expect(report.length).toBeLessThan(40_000);
  });
});
