// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";

/**
 * M3-WO4 static audit — Entity Matching, Normalization & Duplicate Detection. Audits implementation logic (comments
 * stripped): the migration is additive and pinned with its CHECKs; the pure matcher stays pure and locale-free; the
 * orchestration writes only the five analysis tables, never consults "latest" anything, never auto-creates, and never
 * touches Candidate workflow state; no HTTP route or UI exists.
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
const MATCHER = strip(read("packages", "prowess-import", "src", "matcher.ts"));
const ORCH_FILES = walk(path.join(ROOT, "packages", "prowess-db", "src", "import-match"));
const MIGRATION_SQL = read("packages", "prowess-db", "prisma", "migrations", "20261014010000_add_import_entity_matching", "migration.sql");

describe("M3-WO4 migration", () => {
  it("is pinned byte-for-byte", () => {
    expect(createHash("sha256").update(MIGRATION_SQL).digest("hex")).toBe("fe3ca1beb64a1aac21d3e378cc68f8dac8974768f122a6c5dbbefe2ef78d66b4");
  });

  it("creates exactly the five analysis tables and three enums; earlier tables gain only composite-key-target indexes", () => {
    expect([...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["import_match_runs", "candidate_match_assessments", "candidate_match_suggestions", "candidate_duplicate_groups", "candidate_duplicate_group_members"]);
    expect([...MIGRATION_SQL.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["ImportMatchOutcome", "ImportMatchBasis", "CandidateDuplicateBasis"]);
    const created = new Set([...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]));
    expect([...MIGRATION_SQL.matchAll(/CREATE (?:UNIQUE )?INDEX "(\w+)" ON "(\w+)"/g)].filter((m) => !created.has(m[2])).map((m) => m[1]).sort()).toEqual(["extraction_candidates_id_batch_key", "import_batches_id_comparison_manifest_key", "import_batches_id_extraction_output_hash_key"]);
    expect([...MIGRATION_SQL.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]).filter((t) => !created.has(t))).toEqual([]);
    expect(MIGRATION_SQL).not.toMatch(/\b(DROP|RENAME|TRUNCATE|DELETE\s+FROM|ALTER COLUMN)\b/i);
    expect(MIGRATION_SQL).not.toMatch(/matched_entity_id[^\n]*"extraction_candidates"|ALTER TABLE "extraction_candidates"/); // no match column on Candidates
  });

  it("every foreign key is RESTRICT; Batch / Candidate / Version alignment is composite", () => {
    const fks = [...MIGRATION_SQL.matchAll(/ADD CONSTRAINT "(\w+)" FOREIGN KEY \(([^)]+)\) REFERENCES "(\w+)"\(([^)]+)\) ON DELETE (\w+)/g)];
    expect(fks.length).toBe(15);
    for (const fk of fks) expect(fk[5], fk[1]).toBe("RESTRICT");
    for (const name of ["candidate_match_assessments_candidate_fkey", "candidate_duplicate_group_members_candidate_fkey"]) expect(fks.find((f) => f[1] === name)?.[4]).toBe('"id", "import_batch_id"');
    expect(fks.find((f) => f[1] === "import_match_runs_candidate_set_fkey")?.[4]).toBe('"id", "extraction_output_hash"');
    expect(fks.find((f) => f[1] === "import_match_runs_comparison_manifest_fkey")?.[4]).toBe('"id", "comparison_manifest_id"');
    for (const name of ["candidate_match_assessments_comparison_version_fkey", "candidate_match_suggestions_comparison_version_fkey"]) expect(fks.find((f) => f[1] === name)?.[4]).toBe('"id", "entity_id"');
  });

  it("carries its CHECK constraints and the required unique keys", () => {
    for (const name of ["candidate_match_assessments_exact_match_check", "candidate_match_assessments_no_evidence_basis_check", "candidate_match_assessments_comparison_requires_entity_check", "candidate_match_suggestions_rank_score_check", "candidate_duplicate_group_members_ordinal_check", "import_match_runs_hash_format_check", "candidate_duplicate_groups_identity_key_hash_check"]) {
      expect(MIGRATION_SQL).toContain(`"${name}" CHECK`);
    }
    for (const key of ["import_match_runs_run_fingerprint_key", "candidate_match_assessments_run_candidate_key", "candidate_match_suggestions_assessment_rank_key", "candidate_match_suggestions_assessment_entity_key", "candidate_duplicate_groups_run_identity_key", "candidate_duplicate_group_members_group_candidate_key"]) {
      expect(MIGRATION_SQL).toContain(`CREATE UNIQUE INDEX "${key}"`);
    }
    for (const line of MIGRATION_SQL.split("\n").filter((l) => l.trimStart().startsWith("--"))) expect(line).not.toContain(";");
  });
});

describe("M3-WO4 schema", () => {
  const SCHEMA = read("packages", "prowess-db", "prisma", "schema.prisma").replace(/\/\/.*$/gm, "");
  const body = (name: string) => new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(SCHEMA)?.[1] ?? "";
  it("no analysis model has a current / active / latest / approved / applied field, and Candidates gained no match column", () => {
    for (const m of ["ImportMatchRun", "CandidateMatchAssessment", "CandidateMatchSuggestion", "CandidateDuplicateGroup", "CandidateDuplicateGroupMember"]) expect(body(m), m).not.toMatch(/\b(current|active|latest|approved|applied|winner|primaryCandidate|updatedAt)\w*/i);
    expect(body("ExtractionCandidate")).not.toMatch(/matchedEntity|matchedBy|matchOutcome/);
    expect(body("ImportBatch")).not.toMatch(/activeMatchRun|currentMatchRun|latestMatchRun/);
  });
  it("vocabularies are exactly the approved sets", () => {
    expect(model.IMPORT_MATCH_OUTCOMES).toEqual(["EXACT_MATCH", "POTENTIAL_MATCH", "NO_MATCH", "INSUFFICIENT_IDENTITY", "NOT_APPLICABLE"]);
    expect(model.EXACT_IMPORT_MATCH_BASES).toEqual(["CANONICAL_KEY_EXACT", "ALIAS_EXACT"]);
    expect(model.CANDIDATE_DUPLICATE_BASES).toEqual(["PROPOSED_CANONICAL_KEY", "NORMALIZED_LABEL"]);
  });
});

describe("M3-WO4 pure matcher (@prowess/import/src/matcher.ts)", () => {
  it("imports only @prowess/model and sibling modules; no I/O, clock, randomness, locale or AI", () => {
    for (const m of MATCHER.matchAll(/\bfrom\s+"([^"]+)"/g)) expect(m[1]).toMatch(/^(@prowess\/model|\.\/[\w-]+\.js)$/);
    expect(MATCHER).not.toMatch(/toLocaleLowerCase|toLocaleUpperCase|localeCompare|Intl\.|Math\.random|Date\.now|new Date\(|\bfetch\(|https?:\/\/|node:(fs|net|http)|prisma|@prowess\/db|react|next\//i);
  });
  it("reuses M1's normalizeEntityAlias instead of reimplementing alias / label normalization", () => {
    expect(MATCHER).toMatch(/normalizeEntityAlias\(/);
    expect(MATCHER).not.toMatch(/\.normalize\("NF/);
    // The only lowercasing outside normalizeEntityAlias is of UUID text (their canonical lowercase form) for hashing.
    expect([...MATCHER.matchAll(/([\w.]+)\.toLowerCase\(\)/g)].map((m) => m[1]).sort()).toEqual(["r.comparisonEntityVersionId", "r.entityId", "v"]);
  });
  it("only canonical-key or alias evidence can become EXACT; fuzzy / label bases are offered as suggestions only", () => {
    expect([...MATCHER.matchAll(/exact = \{ entity: [^,]+, basis: "(\w+)" \}/g)].map((m) => m[1]).sort()).toEqual(["ALIAS_EXACT", "CANONICAL_KEY_EXACT"]);
    expect(MATCHER).not.toMatch(/exact = \{[^}]*(FUZZY_LABEL|DISPLAY_LABEL_EXACT|NORMALIZED_LABEL)/);
  });
  it("never ranks by lifecycle, Canon status or source authority, and hardcodes no Prowess names", () => {
    expect(MATCHER).not.toMatch(/\b(CANON|PLAYTEST|APPROVED|DRAFT|GOVERNING|CURRENT_PRIMARY|REFERENCE_ONLY|authority|lifecycle|status)\b/);
    expect(MATCHER).not.toMatch(/emission|evocation|arcana|concentration|direct damage/i);
  });
});

describe("M3-WO4 orchestration (@prowess/db/src/import-match)", () => {
  it("covers the expected modules", () => {
    expect(ORCH_FILES.map(rel).sort()).toEqual(["packages/prowess-db/src/import-match/index.ts", "packages/prowess-db/src/import-match/repository.ts", "packages/prowess-db/src/import-match/service.ts"]);
  });

  it("writes ONLY the five analysis tables, ONLY by insert", () => {
    const writes: string[] = [];
    for (const f of ORCH_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\$executeRaw|\$queryRaw|\.(update|updateMany|upsert|delete|deleteMany)\(/);
      for (const m of src.matchAll(/\b(?:tx|prisma)\.(\w+)\.(create|createMany)\(/g)) writes.push(`${m[1]}.${m[2]}`);
    }
    expect([...new Set(writes)].sort()).toEqual(["candidateDuplicateGroup.createMany", "candidateDuplicateGroupMember.createMany", "candidateMatchAssessment.createMany", "candidateMatchSuggestion.createMany", "importMatchRun.create"]);
  });

  it("reads Entity identity, aliases, Candidates and exact pinned Versions only; never a 'latest' anything", () => {
    for (const f of ORCH_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\b(?:tx|prisma)\.(\w+)\./g)) expect(m[1], rel(f)).toMatch(/^(importMatchRun|candidateMatchAssessment|candidateMatchSuggestion|candidateDuplicateGroup|candidateDuplicateGroupMember|extractionCandidate|entity|entityAlias|entityVersion)$/);
      expect(src, rel(f)).not.toMatch(/getLatest\w*|latest\w*Version|LatestRulesetManifest|latestRelease|latestPolicy|orderBy:\s*\{\s*(createdAt|revisionNumber):\s*"desc"/i);
      expect(src, rel(f)).not.toMatch(/\b(createEntity|createEntityVersion|createEntityAlias|createRuleConflict|createCanonDecision|createRulesetManifest|recordExtractionCandidates|extractImportBatch)\b/);
      expect(src, rel(f)).not.toMatch(/authorityStatus|sourceAuthority|canonPolicy|structuredData|rulesText/);
    }
    const repo = strip(read("packages", "prowess-db", "src", "import-match", "repository.ts"));
    expect(repo).toMatch(/entityVersion\.findMany\(\{ where: \{ id: \{ in: versionIds\.slice\(i, i \+ PAGE\) \} \}, select: \{ id: true, displayName: true \} \}\)/);
  });

  it("the comparison Manifest comes only from the Batch, through the approved M2 resolver", () => {
    const svc = strip(read("packages", "prowess-db", "src", "import-match", "service.ts"));
    expect(svc).toMatch(/getEffectiveManifestEntries\(batch\.comparisonManifestId\)/);
    expect(svc).toMatch(/comparisonManifestId: batch\.comparisonManifestId/);
    expect(svc).toContain('const OPTION_KEYS = ["matcherKey", "matcherVersion", "matcherConfig"];');
  });

  it("never touches Candidate workflow status", () => {
    for (const f of ORCH_FILES) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\bstatus\s*:|MATCHED|NEW_ENTITY|NEEDS_MAPPING|REJECTED|"APPROVED"/);
  });
});

describe("M3-WO4 surface: services only, no HTTP route, no UI", () => {
  it("adds exactly the six matching services", () => {
    const root = read("packages", "prowess-db", "src", "index.ts");
    expect(root).toMatch(/analyzeImportBatchMatches,\s*getCandidateMatchAssessment,\s*getImportMatchRun,\s*listCandidateDuplicateGroups,\s*listCandidateMatchAssessments,\s*listImportMatchRuns,\s*\} from "\.\/import-match\/index\.js";/);
    expect(root).not.toMatch(/updateMatch|deleteMatch|applyMatch|acceptMatch|setActiveMatchRun/);
  });
  it("no route, page, component or client references matching", () => {
    for (const f of [...walk(path.join(ROOT, "apps", "studio", "app")).filter((f) => !rel(f).startsWith("apps/studio/app/api/import/") && !rel(f).startsWith("apps/studio/app/developer/import/")) /* M3-WO7 Import API and M3-WO8 Import Studio: audited by m3-import-api-static / m3-import-ui-static */, ...walk(path.join(ROOT, "apps", "studio", "src", "api-client")).filter((f) => !rel(f).endsWith("src/api-client/import.ts")) /* M3-WO8 Import Studio client: audited by m3-import-ui-static */]) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/MatchRun|MatchAssessment|DuplicateGroup|analyzeImportBatchMatches|import-match/i);
    }
  });
});

describe("M3-WO4 documentation", () => {
  it("states the identity / content boundary and the required diagrams", () => {
    const doc = read("docs", "architecture", "m3-entity-matching.md");
    for (const phrase of ["Entity Identity Match", "Rule Content Agreement", "EXACT_MATCH", "POTENTIAL_MATCH", "NO_MATCH", "INSUFFICIENT_IDENTITY", "NOT_APPLICABLE", "PROWESS_ENTITY_CATALOG_V1", "PROWESS_IMPORT_MATCH_RUN_V1", "UNREVIEWED", "Suggestion only"]) expect(doc).toContain(phrase);
  });
});
