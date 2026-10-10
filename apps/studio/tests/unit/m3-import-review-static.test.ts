// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";

/**
 * M3-WO6 static audit — Conflict Detection & Import Review Decisions. Implementation logic only (comments stripped).
 * Pins: the additive migration and its CHECKs; the fixed workflow graph with terminal APPROVED / REJECTED; review
 * writes only import_decisions + Candidate status + Batch status; no RuleConflict, no materialization, no "latest";
 * pure conflict logic; no route or UI.
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
const REVIEW_FILES = walk(path.join(ROOT, "packages", "prowess-db", "src", "import-review"));
const PURE = strip(read("packages", "prowess-import", "src", "review.ts"));
const MIGRATION_SQL = read("packages", "prowess-db", "prisma", "migrations", "20261015010000_add_import_decisions", "migration.sql");

describe("M3-WO6 migration", () => {
  it("is pinned byte-for-byte and appended after the 21 approved migrations", () => {
    expect(createHash("sha256").update(MIGRATION_SQL).digest("hex")).toBe("0246fbbd42c8f4dd54e0c136473037db44834241d94d60ef03cffaed39807b91");
    const dir = path.join(ROOT, "packages", "prowess-db", "prisma", "migrations");
    const names = readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory()).sort();
    expect(names.indexOf("20261015010000_add_import_decisions")).toBe(21);
  });

  it("creates exactly one table and two enums; earlier tables gain only composite-key-target indexes", () => {
    expect([...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["import_decisions"]);
    expect([...MIGRATION_SQL.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["ImportDecisionType", "ImportMatchDecisionBasis"]);
    expect([...MIGRATION_SQL.matchAll(/CREATE (?:UNIQUE )?INDEX "(\w+)" ON "(\w+)"/g)].filter((m) => m[2] !== "import_decisions").map((m) => m[1]).sort()).toEqual(["candidate_duplicate_groups_id_run_key", "candidate_match_assessments_id_run_candidate_key", "extraction_candidates_id_fingerprint_key"]);
    expect([...MIGRATION_SQL.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]).filter((t) => t !== "import_decisions")).toEqual([]);
    expect(MIGRATION_SQL).not.toMatch(/\b(DROP|RENAME|TRUNCATE|DELETE\s+FROM|ALTER COLUMN)\b/i);
    expect(MIGRATION_SQL).not.toMatch(/CREATE TABLE "(entities|entity_versions|formula|requirement|keyword|rule_conflict|import_conflict|materializ)/i);
  });

  it("every foreign key is RESTRICT; Batch / Candidate / evidence alignment is composite", () => {
    const fks = [...MIGRATION_SQL.matchAll(/ADD CONSTRAINT "(\w+)" FOREIGN KEY \(([^)]+)\) REFERENCES "(\w+)"\(([^)]+)\) ON DELETE (\w+)/g)];
    expect(fks.length).toBe(9);
    for (const fk of fks) expect(fk[5], fk[1]).toBe("RESTRICT");
    const cols = (name: string) => fks.find((f) => f[1] === name)?.[2];
    expect(cols("import_decisions_candidate_set_fkey")).toBe('"import_batch_id", "candidate_set_hash"');
    expect(cols("import_decisions_candidate_fkey")).toBe('"extraction_candidate_id", "import_batch_id"');
    expect(cols("import_decisions_candidate_fingerprint_fkey")).toBe('"extraction_candidate_id", "candidate_fingerprint"');
    expect(cols("import_decisions_match_run_fkey")).toBe('"match_run_id", "import_batch_id"');
    expect(cols("import_decisions_match_assessment_fkey")).toBe('"match_assessment_id", "match_run_id", "extraction_candidate_id"');
    expect(cols("import_decisions_duplicate_group_fkey")).toBe('"duplicate_group_id", "match_run_id"');
    expect(cols("import_decisions_duplicate_member_fkey")).toBe('"duplicate_group_id", "extraction_candidate_id"');
    expect(cols("import_decisions_comparison_version_fkey")).toBe('"comparison_entity_version_id", "target_entity_id"');
  });

  it("carries its CHECK constraints and unique keys", () => {
    for (const name of ["import_decisions_type_status_check", "import_decisions_target_entity_check", "import_decisions_match_basis_check", "import_decisions_rationale_check", "import_decisions_evidence_check", "import_decisions_sequence_hash_check"]) expect(MIGRATION_SQL).toContain(`"${name}" CHECK`);
    for (const key of ["import_decisions_decision_fingerprint_key", "import_decisions_candidate_sequence_key"]) expect(MIGRATION_SQL).toContain(`CREATE UNIQUE INDEX "${key}"`);
    for (const line of MIGRATION_SQL.split("\n").filter((l) => l.trimStart().startsWith("--"))) expect(line).not.toContain(";");
  });
});

describe("M3-WO6 workflow graph", () => {
  it("APPROVED and REJECTED are terminal; no decision type leaves them", () => {
    expect(model.TERMINAL_CANDIDATE_STATUSES).toEqual(["APPROVED", "REJECTED"]);
    for (const t of model.IMPORT_DECISION_TYPES) for (const s of model.TERMINAL_CANDIDATE_STATUSES) expect(model.IMPORT_DECISION_RULES[t].fromStatuses as readonly string[]).not.toContain(s);
  });
  it("approval needs MATCHED / NEW_ENTITY for identity kinds, UNREVIEWED semantic kinds only, and never CONFLICT / NEEDS_MAPPING", () => {
    expect(model.IMPORT_DECISION_RULES.APPROVE_MATCHED.fromStatuses).toEqual(["MATCHED"]);
    expect(model.IMPORT_DECISION_RULES.APPROVE_NEW_ENTITY.fromStatuses).toEqual(["NEW_ENTITY"]);
    expect(model.IMPORT_DECISION_RULES.APPROVE_SEMANTIC).toEqual({ toStatus: "APPROVED", fromStatuses: ["UNREVIEWED"], kinds: ["FORMULA", "REQUIREMENT", "KEYWORD"] });
    for (const t of ["APPROVE_MATCHED", "APPROVE_NEW_ENTITY"] as const) expect(model.IMPORT_DECISION_RULES[t].kinds).toEqual(["ENTITY", "ENTITY_FIELD"]);
  });
  it("structural kinds can only be rejected or marked NEEDS_MAPPING", () => {
    for (const t of model.IMPORT_DECISION_TYPES) {
      const kinds = model.IMPORT_DECISION_RULES[t].kinds as readonly string[];
      if (!["MARK_NEEDS_MAPPING", "REJECT"].includes(t)) for (const k of ["UNKNOWN", "REFERENCE"]) expect(kinds, t).not.toContain(k);
    }
  });
});

describe("M3-WO6 review orchestration (@prowess/db/src/import-review)", () => {
  it("covers the expected modules", () => {
    expect(REVIEW_FILES.map(rel).sort()).toEqual(["packages/prowess-db/src/import-review/index.ts", "packages/prowess-db/src/import-review/repository.ts", "packages/prowess-db/src/import-review/service.ts"]);
  });

  it("writes ONLY import_decisions, ExtractionCandidate.status and ImportBatch.status", () => {
    const writes: string[] = [];
    for (const f of REVIEW_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\$executeRaw|\$queryRaw|\.(upsert|delete|deleteMany)\(|\b(?:tx|prisma)\.\w+\.update\(/);
      for (const m of src.matchAll(/\b(?:tx|prisma)\.(\w+)\.(create|createMany|update|updateMany)\(/g)) writes.push(`${m[1]}.${m[2]}`);
    }
    expect([...new Set(writes)].sort()).toEqual(["extractionCandidate.updateMany", "importBatch.updateMany", "importDecision.create"]);
    const repo = strip(read("packages", "prowess-db", "src", "import-review", "repository.ts"));
    for (const m of repo.matchAll(/\.updateMany\(\{[\s\S]*?data: \{([^}]*)\}/g)) expect((m[1] as string).trim()).toMatch(/^status: (input\.toStatus|REVIEWING|COMPLETED)$/);
  });

  it("never creates RuleConflicts, CanonDecisions or any domain record, and never resolves 'latest' evidence", () => {
    for (const f of REVIEW_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\b(createRuleConflict|createCanonDecision|createEntity|createEntityVersion|createEntityAlias|createKeywordDefinition|createKeyword|createChangeSet|publishRulesetRelease|createRulesetManifest|analyzeImportBatchMatches|extractImportBatch)\b/);
      expect(src, rel(f)).not.toMatch(/\b(ruleConflict|canonDecision|entityVersion|entityAlias|keywordDefinition|ruleset|rulesetManifest|rulesetRelease|changeSet|formulaDefinition|requirementDefinition)\.(create|update|upsert)/);
      expect(src, rel(f)).not.toMatch(/getLatest|latestMatchRun|latest\w*Version|latestManifest|latestRelease|latestPolicy|orderBy:\s*\{\s*createdAt:\s*"desc"/i);
    }
  });

  it("there is no generic status setter or decision mutation anywhere in the public surface", () => {
    const root = read("packages", "prowess-db", "src", "index.ts");
    expect(root).not.toMatch(/setCandidateStatus|updateCandidateStatus|patchCandidate|updateImportDecision|deleteImportDecision|setImportBatchStatus/);
    expect(root).toMatch(/analyzeImportConflicts,\s*completeImportReview,\s*getImportDecision,\s*getImportReviewSummary,\s*listImportDecisionsForBatch,\s*listImportDecisionsForCandidate,\s*reviewImportCandidate,\s*\} from "\.\/import-review\/index\.js";/);
  });
});

describe("M3-WO6 pure conflict logic (@prowess/import/src/review.ts)", () => {
  it("has no database, network, filesystem, clock, randomness or game interpretation", () => {
    for (const m of PURE.matchAll(/\bfrom\s+"([^"]+)"/g)) expect(m[1]).toMatch(/^(@prowess\/model|\.\/[\w-]+\.js)$/);
    expect(PURE).not.toMatch(/prisma|@prowess\/db|"node:|fetch\(|Math\.random|Date\.now|new Date\(|toLocale/);
    expect(PURE).not.toMatch(/\b(cost|damage|MP|AP|newer|older|correct|obsolete|winner|canon)\b/i);
  });
  it("compares only schema key / version and canonical payload", () => {
    expect(PURE).toMatch(/new Set\(members\.map\(\(m\) => `\$\{m\.payloadSchemaKey\}@\$\{m\.payloadSchemaVersion\}`\)\)/);
    expect(PURE).toMatch(/new Set\(members\.map\(\(m\) => canonicalJson\(m\.payload\)\)\)/);
  });
});

describe("M3-WO6 no HTTP route, no UI", () => {
  it("nothing in the Studio app references import review", () => {
    for (const f of [...walk(path.join(ROOT, "apps", "studio", "app")).filter((f) => !rel(f).startsWith("apps/studio/app/api/import/") && !rel(f).startsWith("apps/studio/app/developer/import/")) /* M3-WO7 Import API and M3-WO8 Import Studio: audited by m3-import-api-static / m3-import-ui-static */, ...walk(path.join(ROOT, "apps", "studio", "src", "api-client")).filter((f) => !rel(f).endsWith("src/api-client/import.ts")) /* M3-WO8 Import Studio client: audited by m3-import-ui-static */]) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/ImportDecision|reviewImportCandidate|completeImportReview|analyzeImportConflicts|import-review/);
    }
  });
});

describe("M3-WO6 documentation", () => {
  it("documents the evidence / decision / status separation, the boundaries and the roadmap", () => {
    const doc = read("docs", "architecture", "m3-import-review-decisions.md");
    for (const phrase of ["Automated evidence", "Human ImportDecision", "Candidate CONFLICT", "M2 RuleConflict", "APPROVED", "CANON", "DUPLICATE_EQUIVALENT", "POTENTIAL_CONTENT_CONFLICT", "UNCOMPARABLE_DUPLICATE", "MANUAL_OVERRIDE", "PROWESS_IMPORT_DECISION_V1", "materialization"]) expect(doc).toContain(phrase);
    expect(doc).toMatch(/WO6[\s\S]*WO7[\s\S]*WO8[\s\S]*WO9[\s\S]*WO10/);
  });
});
