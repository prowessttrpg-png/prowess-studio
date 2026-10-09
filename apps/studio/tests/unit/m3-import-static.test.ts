// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";

/**
 * M3-WO2 static audit — Import Batch & Extraction Candidate Foundation. Pins by reading source, schema and migration
 * text that: the migration is additive and hash-pinned with its CHECK constraints; the import code writes only its
 * three tables, only by insert, only with the initial statuses; it never touches Entity / Canon / Ruleset / Release
 * state, never matches or interprets; @prowess/import keeps its boundary; and no HTTP route or Studio UI exists yet.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
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
const DB_SRC = path.join(ROOT, "packages", "prowess-db", "src");
const WO2_DB_FILES = ["import-batch", "extraction-candidate"].flatMap((d) => walk(path.join(DB_SRC, d)));
const IMPORT_PKG_FILES = walk(path.join(ROOT, "packages", "prowess-import", "src"));
const MIGRATION_SQL = read("packages", "prowess-db", "prisma", "migrations", "20261012010000_add_import_batches_candidates", "migration.sql");

describe("M3-WO2 migration", () => {
  it("is pinned byte-for-byte", () => {
    expect(createHash("sha256").update(MIGRATION_SQL).digest("hex")).toBe("6fdc2a4faadd2bc6c1d76ee330c3c6f5d8a6049e62d983301481b51a32db0624");
  });

  it("creates exactly the three import tables and five import enums", () => {
    expect([...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["import_batches", "extraction_candidates", "extraction_candidate_sources"]);
    expect([...MIGRATION_SQL.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["ImportBatchScopeType", "ImportBatchStatus", "ExtractionCandidateKind", "ExtractionConfidence", "ExtractionCandidateStatus"]);
  });

  it("touches earlier tables ONLY by adding two composite-key-target unique indexes; nothing is dropped or altered", () => {
    const created = new Set([...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]));
    const foreignIndexes = [...MIGRATION_SQL.matchAll(/CREATE (?:UNIQUE )?INDEX "(\w+)" ON "(\w+)"/g)].filter((m) => !created.has(m[2])).map((m) => m[1]);
    expect(foreignIndexes.sort()).toEqual(["source_content_nodes_id_snapshot_key", "source_snapshot_ingestions_snapshot_structure_hash_key"]);
    expect([...MIGRATION_SQL.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]).filter((t) => !created.has(t))).toEqual([]);
    expect(MIGRATION_SQL).not.toMatch(/\b(DROP|RENAME|TRUNCATE|DELETE\s+FROM|ALTER COLUMN)\b/i);
  });

  it("every foreign key is ON DELETE RESTRICT, and every structural / Batch / Manifest key is composite", () => {
    const fks = [...MIGRATION_SQL.matchAll(/ADD CONSTRAINT "(\w+)" FOREIGN KEY \(([^)]+)\) REFERENCES "(\w+)"\(([^)]+)\) ON DELETE (\w+)/g)];
    expect(fks.length).toBe(13);
    for (const fk of fks) expect(fk[5], fk[1]).toBe("RESTRICT");
    for (const fk of fks.filter((f) => ["source_sections", "source_content_nodes", "import_batches", "extraction_candidates"].includes(f[3] as string))) {
      expect(fk[4], fk[1]).toBe('"id", "source_snapshot_id"');
    }
    expect(MIGRATION_SQL).toContain('FOREIGN KEY ("comparison_manifest_id", "review_ruleset_id") REFERENCES "ruleset_manifests"("id", "ruleset_id")');
    expect(MIGRATION_SQL).toContain('FOREIGN KEY ("source_snapshot_id", "source_structure_hash") REFERENCES "source_snapshot_ingestions"("source_snapshot_id", "structure_hash")');
  });

  it("carries the CHECK constraints Prisma cannot model", () => {
    for (const name of [
      "import_batches_scope_check",
      "import_batches_comparison_requires_ruleset_check",
      "extraction_candidates_exactly_one_primary_anchor_check",
      "extraction_candidate_sources_exactly_one_anchor_check",
      "extraction_candidates_positive_check",
      "extraction_candidate_sources_ordinal_check",
      "extraction_candidates_payload_object_check",
    ]) expect(MIGRATION_SQL).toContain(`"${name}" CHECK`);
  });

  it("has the required unique keys and no semicolon inside a comment", () => {
    for (const key of ["import_batches_batch_fingerprint_key", "extraction_candidates_batch_ordinal_key", "extraction_candidates_batch_fingerprint_key"]) expect(MIGRATION_SQL).toContain(`CREATE UNIQUE INDEX "${key}"`);
    for (const line of MIGRATION_SQL.split("\n").filter((l) => l.trimStart().startsWith("--"))) expect(line).not.toContain(";");
  });
});

describe("M3-WO2 schema and vocabulary", () => {
  const SCHEMA = read("packages", "prowess-db", "prisma", "schema.prisma").replace(/\/\/.*$/gm, "");
  const body = (name: string) => new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(SCHEMA)?.[1] ?? "";

  it("no import model persists counters, an updatedAt, a current/active flag, or an authority field", () => {
    for (const m of ["ImportBatch", "ExtractionCandidate", "ExtractionCandidateSource"]) expect(body(m), m).not.toMatch(/count\w*\s+Int|total\w*\s+Int|updatedAt|isCurrent|isActive|authority|canonDecision|latest/i);
  });

  it("vocabularies are generic and exactly as approved", () => {
    expect(model.EXTRACTION_CANDIDATE_KINDS.join()).not.toMatch(/SPELL|MANEUVER|WEAPON|SKILL|TRAIT/);
    expect(model.EXTRACTION_CONFIDENCES).toEqual(["HIGH", "MEDIUM", "LOW"]);
    expect(model.INITIAL_EXTRACTION_CANDIDATE_STATUS).toBe("UNREVIEWED");
    expect(model.INITIAL_IMPORT_BATCH_STATUS).toBe("CREATED");
  });

  it("candidate / batch inputs do not accept status, fingerprints, hashes or Snapshot ids", () => {
    for (const f of ["status", "candidateFingerprint", "sourceSnapshotId", "id", "createdAt"]) expect(model.CREATE_EXTRACTION_CANDIDATE_FIELDS as readonly string[]).not.toContain(f);
    for (const f of ["status", "batchFingerprint", "sourceStructureHash", "id", "createdAt"]) expect(model.CREATE_IMPORT_BATCH_FIELDS as readonly string[]).not.toContain(f);
  });
});

describe("M3-WO2 persistence code boundaries", () => {
  it("covers the expected modules", () => {
    expect(WO2_DB_FILES.map(rel).sort()).toEqual([
      "packages/prowess-db/src/extraction-candidate/index.ts",
      "packages/prowess-db/src/extraction-candidate/repository.ts",
      "packages/prowess-db/src/extraction-candidate/service.ts",
      "packages/prowess-db/src/import-batch/index.ts",
      "packages/prowess-db/src/import-batch/repository.ts",
      "packages/prowess-db/src/import-batch/service.ts",
    ]);
  });

  it("writes ONLY the three import tables, ONLY by insert — no update, upsert, delete or raw SQL", () => {
    const writes: string[] = [];
    for (const f of WO2_DB_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\$executeRaw|\$queryRaw|\b(?:tx|prisma)\.\w+\.(update|upsert|delete|deleteMany)\(/);
      for (const m of src.matchAll(/\b(?:tx|prisma)\.(\w+)\.(create|createMany|updateMany)\(/g)) writes.push(`${m[1]}.${m[2]}`);
    }
    // M3-WO3 added exactly one updateMany: the no-op CREATED -> CREATED row-lock guard that keeps manual recording from
    // interleaving with an extraction commit (pinned below to that exact shape).
    expect([...new Set(writes)].sort()).toEqual(["extractionCandidate.create", "extractionCandidateSource.createMany", "importBatch.create", "importBatch.updateMany"]);
    const guard = strip(read("packages", "prowess-db", "src", "extraction-candidate", "repository.ts"));
    expect([...guard.matchAll(/importBatch\.updateMany\(([^;]*)\)/g)].map((m) => m[1]?.replace(/\s+/g, " "))).toEqual(["{ where: { id: importBatchId, status: INITIAL_IMPORT_BATCH_STATUS }, data: { status: INITIAL_IMPORT_BATCH_STATUS } }"]);
  });

  it("status is only ever written as the initial constant", () => {
    const repos = WO2_DB_FILES.filter((f) => f.endsWith("repository.ts")).map((f) => strip(readFileSync(f, "utf8"))).join("\n");
    const written = [...repos.matchAll(/\bstatus:\s*([\w.]+)/g)].map((m) => m[1]).filter((v) => v !== "row.status"); // row.status = reading back
    expect([...new Set(written)].sort()).toEqual(["INITIAL_EXTRACTION_CANDIDATE_STATUS", "INITIAL_IMPORT_BATCH_STATUS"]);
    expect(repos).not.toMatch(/"(APPROVED|REJECTED|MATCHED|NEW_ENTITY|CONFLICT|NEEDS_MAPPING|EXTRACTING|READY_FOR_REVIEW|REVIEWING|COMPLETED|FAILED|CANCELLED)"/);
  });

  it("reads Entity / Canon / governance state nowhere; Ruleset and Manifest only through their public get services", () => {
    for (const f of WO2_DB_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\b(?:tx|prisma)\.(\w+)\./g)) expect(m[1], rel(f)).toMatch(/^(importBatch|extractionCandidate|extractionCandidateSource|sourceSection|sourceContentNode)$/);
      const imports = [...src.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1] as string);
      for (const i of imports) {
        expect(i, rel(f)).toMatch(/^(@prowess\/model|@prowess\/import|\.\.?\/.*)$/);
        expect(i, rel(f)).not.toMatch(/entity|keyword|relationship|canon|rule-conflict|change-set|review-lifecycle|ruleset-release|migration-plan|ruleset-inheritance|source-reference|source-ingestion|docx/);
      }
      expect(src, rel(f)).not.toMatch(/\b(createEntity|createEntityVersion|createRuleConflict|createCanonDecision|createChangeSet|publishRulesetRelease|createMigrationPlan|createRulesetManifest|createCanonPolicy|resolveSourceAuthority|authorityStatus)\b/);
      expect(src, rel(f)).not.toMatch(/\b(get|select)Latest\w*\(|orderBy:\s*\{\s*\w+:\s*"desc"/);
    }
  });

  it("contains no semantic rule interpretation and no Entity matching", () => {
    // M3-WO4's identity matcher (packages/prowess-import/src/matcher.ts) legitimately performs Entity matching and fuzzy
    // similarity; it (and the package barrel that re-exports it) is excluded by exact path here and audited instead by
    // m3-entity-matching-static. M3-WO5's explicit semantic extractor (semantic-*.ts) deliberately recognizes Formula /
    // Requirement / Keyword statements; it is excluded by exact path and audited by m3-semantic-foundation-static.
    const laterAudited = ["matcher.ts", "index.ts", "semantic-declarations.ts", "semantic-formula.ts", "semantic-foundation-v1.ts"];
    for (const f of [...WO2_DB_FILES, ...IMPORT_PKG_FILES.filter((x) => !laterAudited.some((n) => x.endsWith(`${path.sep}${n}`)))]) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/MP\s*=|AP\s*=|Spell Effect|Requires\s+(Trained|Expert|Master)|\bspell\w*|\bdamage\w*|\bmaneuver\w*|\bweapon\w*|findEntit\w*|matchEntit\w*|similarity|levenshtein|fuzzy/i);
      expect(src, rel(f)).not.toMatch(/\.(includes|startsWith|match|test)\(\s*["'`/][^"'`/]*(MP|Spell|Requires|Formula)/);
    }
  });

  it("never opens or parses source files (no DOCX/PDF, no filesystem)", () => {
    for (const f of [...WO2_DB_FILES, ...IMPORT_PKG_FILES]) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/node:fs|node:zlib|parseDocx|readFile|\.docx|\.pdf/i);
  });
});

describe("M3-WO2 @prowess/import boundary", () => {
  it("depends only on @prowess/model (plus dev tooling), and imports only it and node:crypto", () => {
    const pkg = JSON.parse(read("packages", "prowess-import", "package.json")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@prowess/model"]);
    for (const f of IMPORT_PKG_FILES) {
      for (const m of strip(readFileSync(f, "utf8")).matchAll(/\bfrom\s+"([^"]+)"/g)) expect(m[1], rel(f)).toMatch(/^(@prowess\/model|node:crypto|\.\/[\w-]+\.js)$/);
    }
  });

  it("is used by @prowess/db, which still has no cycle back to it", () => {
    const db = JSON.parse(read("packages", "prowess-db", "package.json")) as { dependencies: Record<string, string> };
    expect(db.dependencies["@prowess/import"]).toBe("workspace:*");
  });
});

describe("M3-WO2 no HTTP API, no Studio UI", () => {
  it("no route, page, component or client references import batches or candidates", () => {
    for (const f of [...walk(path.join(ROOT, "apps", "studio", "app")), ...walk(path.join(ROOT, "apps", "studio", "src", "api-client"))]) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/ImportBatch|import-batch|ExtractionCandidate|extraction-candidate|recordExtraction/i);
    }
  });

  it("the public service surface is exactly the approved one", () => {
    const root = read("packages", "prowess-db", "src", "index.ts");
    const names = new Set<string>();
    for (const m of root.matchAll(/export\s*\{([^}]*)\}/g)) for (const x of (m[1] as string).split(",")) { const t = x.trim().split(/\s+as\s+/).pop(); if (t) names.add(t); }
    expect([...names].filter((x) => /ImportBatch|ExtractionCandidate/.test(x)).sort()).toEqual(
      // M3-WO3 added extractImportBatch (explicit extraction; pinned with its siblings in m3-structural-extraction-static).
      // M3-WO4 added analyzeImportBatchMatches (identity analysis; pinned in m3-entity-matching-static).
      ["analyzeImportBatchMatches", "createImportBatch", "extractImportBatch", "getExtractionCandidate", "getImportBatch", "getImportBatchSummary", "listExtractionCandidates", "listImportBatches", "recordExtractionCandidates"].sort(),
    );
    for (const x of names) expect(x).not.toMatch(/approveCandidate|rejectCandidate|setImportBatchStatus|updateExtraction|deleteExtraction|replaceCandidate/);
  });
});

describe("M3-WO2 documentation", () => {
  it("states the required boundaries and diagrams", () => {
    const doc = read("docs", "architecture", "m3-import-batches-candidates.md");
    for (const phrase of ["PROWESS_IMPORT_BATCH_V1", "PROWESS_EXTRACTION_CANDIDATE_V1", "UNREVIEWED", "ImportDecision", "Candidate ≠ Entity", "APPROVED is not Canon", "HIGH confidence", "high Canon authority"]) expect(doc).toContain(phrase);
    expect(doc).toMatch(/SourceSnapshot V0\.1\s*\n\s*↓\s*\nImportBatch/);
  });
});
