// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3-WO3 static audit — Structural Segmentation & Automated Extraction. Audits IMPLEMENTATION LOGIC (comments and
 * string literals used only as documentation are stripped before the semantic checks), so documentation that explains
 * prohibited behaviour is never mechanically forbidden.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (dir: string, out: string[] = []) => {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) {
      if (!["node_modules", "dist", ".next", "generated"].includes(e)) walk(f, out);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
};
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const IMPORT_SRC = path.join(ROOT, "packages", "prowess-import", "src");
const EXTRACTOR_FILES = ["extractor.ts", "structural-v1.ts", "registry.ts"].map((f) => path.join(IMPORT_SRC, f));
const ORCHESTRATION_FILES = walk(path.join(ROOT, "packages", "prowess-db", "src", "extraction"));
const MIGRATION_SQL = read("packages", "prowess-db", "prisma", "migrations", "20261013010000_add_import_batch_extraction_output", "migration.sql");

describe("M3-WO3 migration", () => {
  it("is pinned byte-for-byte", () => {
    expect(createHash("sha256").update(MIGRATION_SQL).digest("hex")).toBe("4a2297e981e62ccc28fd3332792cd606de06f6bf0068f97b6adc45468a2fa473");
  });

  it("adds exactly two nullable workflow columns to import_batches and creates no table, type or semantic structure", () => {
    expect(MIGRATION_SQL).not.toMatch(/CREATE (TABLE|TYPE|INDEX|UNIQUE)/);
    expect([...MIGRATION_SQL.matchAll(/ALTER TABLE "(\w+)"/g)].every((m) => m[1] === "import_batches")).toBe(true);
    expect([...MIGRATION_SQL.matchAll(/ADD COLUMN\s+"(\w+)" ([A-Z]+[^,;\n]*)/g)].map((m) => [m[1], m[2]?.trim()])).toEqual([["extracted_at", "TIMESTAMPTZ(6)"], ["extraction_output_hash", "TEXT"]]);
    expect(MIGRATION_SQL).not.toMatch(/NOT NULL DEFAULT|\b(DROP|RENAME|TRUNCATE|DELETE\s+FROM|ALTER COLUMN|UPDATE\s+")\b/i);
  });

  it("carries its CHECK constraints (status <-> output hash, pair, hex format)", () => {
    for (const name of ["import_batches_extraction_output_pair_check", "import_batches_extraction_output_hash_format_check", "import_batches_extraction_status_check"]) expect(MIGRATION_SQL).toContain(`"${name}" CHECK`);
    for (const line of MIGRATION_SQL.split("\n").filter((l) => l.trimStart().startsWith("--"))) expect(line).not.toContain(";");
  });
});

describe("M3-WO3 extractor purity and boundary (@prowess/import)", () => {
  it("extractor code imports only @prowess/model and sibling modules — no database, network, filesystem, AI or Node I/O", () => {
    for (const f of EXTRACTOR_FILES) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\bfrom\s+"([^"]+)"/g)) expect(m[1], rel(f)).toMatch(/^(@prowess\/model|\.\/[\w-]+\.js)$/);
      expect(src, rel(f)).not.toMatch(/\bfetch\(|https?:\/\/|XMLHttpRequest|node:(fs|net|http|https|child_process)|anthropic|openai|Math\.random|Date\.now|new Date\(/i);
    }
  });

  it("the runner looks extractors up by EXACT key + version only — no latest / default / fallback", () => {
    const src = stripComments(readFileSync(path.join(IMPORT_SRC, "extractor.ts"), "utf8"));
    expect(src).toMatch(/find\(key: string, version: string\): ExtractorDefinition \| null \{\s*return this\.byKey\.get\(registryKey\(key, version\)\) \?\? null;/);
    expect(src).not.toMatch(/latest|newest|fallback|default(?!Extractor)|semver|compatib/i);
  });

  it("the official registry is exactly prowess.structural@1 (+ prowess.semantic-foundation@1 since M3-WO5)", () => {
    // M3-WO5 registered its semantic extractor as a SEPARATE key; prowess.structural@1 itself is unchanged (pinned below).
    expect(stripComments(readFileSync(path.join(IMPORT_SRC, "registry.ts"), "utf8"))).toMatch(/OFFICIAL_EXTRACTORS = \[structuralExtractorV1, semanticFoundationExtractorV1\] as const/);
    const v1 = readFileSync(path.join(IMPORT_SRC, "structural-v1.ts"), "utf8");
    expect(v1).toMatch(/STRUCTURAL_EXTRACTOR_KEY = "prowess\.structural"/);
    expect(v1).toMatch(/STRUCTURAL_EXTRACTOR_VERSION = "1"/);
  });
});

describe("M3-WO3 semantic boundary (implementation logic of prowess.structural@1)", () => {
  const code = stripComments(readFileSync(path.join(IMPORT_SRC, "structural-v1.ts"), "utf8"));

  it("contains no game-semantic vocabulary or classification", () => {
    expect(code).not.toMatch(/\b(spell|skill|weapon|maneuver|summon|affinity|damage|healing|requirement|requires|formula|keyword|trained|expert|master|mp|ap|pro)\b/i);
  });

  it("never inspects text content: no regexes, substring tests or case changes over raw text", () => {
    expect(code).not.toMatch(/rawText\.(match|includes|startsWith|endsWith|search|split|toLowerCase|toUpperCase|indexOf)\(|normalizedText|\.test\(n\./);
    // The ONLY use of source text is an emptiness test (is there any text at all?) — never its content.
    const uses = [...code.matchAll(/rawText(\.[\w.()]+)?/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toBe("rawText.trim().length");
  });

  it("emits only generic candidate kinds and no entity / canonical-key proposal", () => {
    expect([...code.matchAll(/candidateKind: "(\w+)",/g)].map((m) => m[1]).sort()).toEqual(["REFERENCE", "UNKNOWN", "UNKNOWN"]);
    expect(code).toMatch(/proposedEntityType: null,/);
    expect(code).toMatch(/proposedCanonicalKey: null,/);
    expect(code).not.toMatch(/"(ENTITY|ENTITY_FIELD|FORMULA|REQUIREMENT|KEYWORD|RELATIONSHIP)"/);
    expect([...code.matchAll(/unitType: "(\w+)"/g)].map((m) => m[1]).sort()).toEqual(["ROOT_CONTENT", "ROOT_CONTENT", "SECTION", "SECTION", "TABLE", "TABLE"]);
  });

  it("does no image understanding and generates no excerpts", () => {
    expect(code).not.toMatch(/ocr|vision|caption\s*=|altText|excerpt/i);
  });
});

describe("M3-WO3 orchestration writes and reads (@prowess/db/src/extraction)", () => {
  it("covers the expected modules", () => {
    expect(ORCHESTRATION_FILES.map(rel).sort()).toEqual(["packages/prowess-db/src/extraction/index.ts", "packages/prowess-db/src/extraction/repository.ts", "packages/prowess-db/src/extraction/service.ts"]);
  });

  it("writes only ImportBatch workflow fields, ExtractionCandidate and ExtractionCandidateSource", () => {
    const repo = stripComments(read("packages", "prowess-db", "src", "extraction", "repository.ts"));
    const writes = [...repo.matchAll(/\btx\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect([...new Set(writes)].sort()).toEqual(["extractionCandidate.createMany", "extractionCandidateSource.createMany", "importBatch.update", "importBatch.updateMany"]);
    expect(repo).toMatch(/importBatch\.updateMany\(\{ where: \{ id: importBatchId, status: INITIAL_IMPORT_BATCH_STATUS \}, data: \{ status: EXTRACTING_IMPORT_BATCH_STATUS \} \}\)/);
    expect(repo).toMatch(/importBatch\.update\(\{ where: \{ id: importBatchId \}, data: \{ status: EXTRACTED_IMPORT_BATCH_STATUS, extractionOutputHash, extractedAt: new Date\(\) \} \}\)/);
    for (const f of ORCHESTRATION_FILES) expect(stripComments(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\$executeRaw|\$queryRaw|\bprisma\.\w+\.(create|update|delete|upsert)/);
  });

  it("writes only the WO3 workflow statuses; candidates only ever UNREVIEWED; no generic status setter", () => {
    const repo = stripComments(read("packages", "prowess-db", "src", "extraction", "repository.ts"));
    expect([...new Set([...repo.matchAll(/\bstatus:\s*([\w.]+)/g)].map((m) => m[1]))].sort()).toEqual(["EXTRACTED_IMPORT_BATCH_STATUS", "EXTRACTING_IMPORT_BATCH_STATUS", "INITIAL_EXTRACTION_CANDIDATE_STATUS", "INITIAL_IMPORT_BATCH_STATUS"]);
    const surface = read("packages", "prowess-db", "src", "index.ts");
    expect(surface).not.toMatch(/setImportBatchStatus|transitionImportBatch|approveCandidate|rejectCandidate|matchCandidate/); // ImportDecision arrived in M3-WO6
  });

  it("does no matching and touches no Entity / Keyword / conflict / decision / governance / source-authority code", () => {
    for (const f of ORCHESTRATION_FILES) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\bfrom\s+"([^"]+)"/g)) {
        expect(m[1], rel(f)).toMatch(/^(@prowess\/model|@prowess\/import|node:crypto|\.\.\/(extraction-candidate|import-batch|source-structure)\/(service|repository)\.js|\.\/(repository|service)\.js|\.\.\/client\.js|\.\.\/\.\.\/generated\/prisma\/client\.js)$/);
      }
      expect(src, rel(f)).not.toMatch(/\b(entity|entityVersion|entityAlias|keyword\w*|ruleConflict|canonDecision|canonPolicy|sourceAuthority\w*|ruleset|rulesetManifest|changeSet|rulesetRelease|migrationPlan)\.(find|create|update|count)/);
      expect(src, rel(f)).not.toMatch(/findEntit|matchEntit|\balias|\bcanonicalKey\s*[=:]|authorityStatus|getLatest|latest\w*\(/i);
    }
  });

  it("the public surface adds exactly the three extraction services; no HTTP route or Studio UI references extraction", () => {
    const root = read("packages", "prowess-db", "src", "index.ts");
    expect(root).toContain('export { extractImportBatch, getExtractionResult, verifyExtractionOutput } from "./extraction/index.js";');
    for (const f of [...walk(path.join(ROOT, "apps", "studio", "app")).filter((f) => !rel(f).startsWith("apps/studio/app/api/import/")) /* M3-WO7 Import API: audited by m3-import-api-static */, ...walk(path.join(ROOT, "apps", "studio", "src", "api-client"))]) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/extractImportBatch|getExtractionResult|verifyExtractionOutput|ImportBatch|ExtractionCandidate|structural extraction/i);
    }
  });
});

describe("M3-WO3 documentation", () => {
  it("documents the boundary, the lifecycle and the roadmap", () => {
    const doc = read("docs", "architecture", "m3-structural-extraction.md");
    for (const phrase of ["prowess.structural", "PROWESS_EXTRACTION_SET_V1", "READY_FOR_REVIEW", "NONDETERMINISTIC_OUTPUT", "Structural Candidate", "Prowess Entity", "FormulaDefinition", "prowess.structural.section", "prowess.structural.table", "prowess.structural.root-content"]) expect(doc).toContain(phrase);
    expect(doc).toMatch(/WO4[\s\S]*matching[\s\S]*WO5[\s\S]*Formula[\s\S]*WO6/i);
  });
});
