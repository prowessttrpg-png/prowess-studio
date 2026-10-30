// @vitest-environment node
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";
import { statusForDomainErrorCode, toErrorResponse } from "../../src/api/errors";

/**
 * M3-WO10 final static audit gate. Invariant ids (M3-Ixx) refer to docs/architecture/m3-final-audit.md:
 * M3-I17 No Hidden Latest · M3-I19 Real Source Not Required by CI · M3-I20 Domain/Governance Isolation (static side) ·
 * migration-chain immutability · error-vocabulary completeness · no Prowess-specific semantics, AI or network in the
 * generic core · WO9 real-source evidence preserved · invariant coverage matrix complete.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d)) {
    if (["node_modules", "dist", ".next", "generated", ".git", "test-results", "playwright-report"].includes(e)) continue;
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const code = (f: string) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/\/tests\//.test(rel(f));

/** The M3 implementation (production code only). */
const M3_DIRS = [
  "packages/prowess-import/src",
  "packages/prowess-db/src/source-structure",
  "packages/prowess-db/src/source-ingestion",
  "packages/prowess-db/src/import-batch",
  "packages/prowess-db/src/extraction-candidate",
  "packages/prowess-db/src/extraction",
  "packages/prowess-db/src/import-match",
  "packages/prowess-db/src/import-review",
  "apps/studio/app/api/import",
  "apps/studio/app/developer/import",
];
const M3_FILES = [...M3_DIRS.flatMap((d) => walk(path.join(ROOT, d))), path.join(ROOT, "apps/studio/src/api-client/import.ts")].filter(code);

const MIGRATIONS: Array<[string, string]> = [
  ["20260930235722_init", "e53c493a022e483c2bb4b9dcea5a5a600b8af44e4b434f54e1db4bf7d561eb59"],
  ["20261001045349_add_entity", "115e875462d4bf7821a10a4d7efd72dd79c785c308c283cdc1008df9eda41acf"],
  ["20261001212804_add_entity_version", "61d5ab1ad075e1f80681a5ff3d74c408fe8743aa7c075630c24bf733eb065c68"],
  ["20261001215241_add_entity_version_updated_at", "bef8e61bb81336e2b6e86d11fd61d4fe8881a9584e9081c1b807e5db08117307"],
  ["20261002022400_add_entity_alias", "fa21a62cf2bfd8ec8ac390cd4ce034060b63ae2acf5c9492209b446fae571beb"],
  ["20261002025218_add_keyword_foundation", "67fba78240cb615ddedebc583c15008bbcfb1b30c91db35dd3df323618775543"],
  ["20261002225710_add_entity_relationship", "3ba841c4b649a298c47e254ff65f6e995556d69e52a1c7488d305dd891cdd717"],
  ["20261002231523_add_source_provenance", "75392f571ba230dae4c14ec555dc7962803978b6288cf8ecc6072d9432a53a70"],
  ["20261004233000_add_ruleset_foundation", "a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6"],
  ["20261005001500_add_ruleset_manifest", "31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c"],
  ["20261005120000_add_manifest_inheritance", "5fb2a0707fcffe93357b5e489af594db51ec2aabc0082893cd53230debbe4ea0"],
  ["20261005220000_add_canon_policy", "82d4a44f2caa1bb3f3ac88aaac2bdf18e95448787e32372a45a38398a919fc3c"],
  ["20261006010000_add_rule_conflicts", "5befce6a128a2e730998dad6ccef68484b06282060f5a354c7ad93b204cb8cad"],
  ["20261007010000_add_canon_decisions", "62ed605803a83093c91462ff18d4379016f3815a52d2143734c58017c08c6d7e"],
  ["20261008010000_add_change_sets", "2f11f6f86dfd4591304f415ab7ed8a9fe8c131cb6e90d05a9c620161b9c4d442"],
  ["20261009010000_add_ruleset_releases", "813c659816bd767a99e5f39626dde3c0f4d817cc92276886b9a63e43535ab0f7"],
  ["20261010010000_add_migration_plans", "6a4624ffeb062144c5825917177c6eef2599b3376c62c96ee0e595bdcef2253e"],
  ["20261011010000_add_source_structure", "edd72da496f3fe5ea1d8b499b8ff69278f80bf41fe363b2cc8cfe64dc74faba7"],
  ["20261012010000_add_import_batches_candidates", "6fdc2a4faadd2bc6c1d76ee330c3c6f5d8a6049e62d983301481b51a32db0624"],
  ["20261013010000_add_import_batch_extraction_output", "4a2297e981e62ccc28fd3332792cd606de06f6bf0068f97b6adc45468a2fa473"],
  ["20261014010000_add_import_entity_matching", "fe3ca1beb64a1aac21d3e378cc68f8dac8974768f122a6c5dbbefe2ef78d66b4"],
  ["20261015010000_add_import_decisions", "0246fbbd42c8f4dd54e0c136473037db44834241d94d60ef03cffaed39807b91"],
];

describe("M3-WO10 migration chain", () => {
  it("is exactly the 22 approved migrations, in order, byte-for-byte (no history rewritten)", () => {
    const dir = path.join(ROOT, "packages", "prowess-db", "prisma", "migrations");
    const names = readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory()).filter(notLaterMigration).sort(); // M6-WO3: registered later migrations excluded
    expect(names).toEqual(MIGRATIONS.map(([n]) => n));
    for (const [n, hash] of MIGRATIONS) {
      const h = execSync(`node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" "${path.join(dir, n, "migration.sql")}"`).toString();
      expect(h, n).toBe(hash);
    }
  });
});

describe("M3-I17 no hidden latest", () => {
  it("covers the M3 implementation", () => {
    expect(M3_FILES.length).toBeGreaterThan(60);
  });
  it("no M3 production code selects a 'latest' Snapshot, Batch, extractor, MatchRun, Manifest, Version, Release or Policy", () => {
    for (const f of M3_FILES) {
      const s = strip(readFileSync(f, "utf8"));
      expect(s, rel(f)).not.toMatch(/\blatest\w*\s*\(|getLatest|findLatest|currentMatchRun|activeMatchRun|latestSnapshot|latestVersion|latestManifest|latestRelease|latestPolicy/i);
      expect(s, rel(f)).not.toMatch(/orderBy:\s*\{\s*(createdAt|revisionNumber|ordinal):\s*"desc"/);
    }
  });
  it("the only descending reads are a Candidate's own decision history (sequence) — never a cross-record 'newest' choice", () => {
    const desc = M3_FILES.flatMap((f) => [...strip(readFileSync(f, "utf8")).matchAll(/orderBy:\s*\{\s*(\w+):\s*"desc"/g)].map((m) => `${rel(f)}:${m[1]}`));
    expect([...new Set(desc)].sort()).toEqual(["packages/prowess-db/src/import-review/repository.ts:sequenceNumber"]);
  });
});

describe("generic core: no Prowess-specific semantics, no AI, no network", () => {
  const CORE = M3_FILES.filter((f) => /packages\/prowess-(import|db)\//.test(rel(f)));
  it("generic extractor / matching / review / persistence code special-cases no game vocabulary", () => {
    for (const f of CORE) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/spell ?ap|\bdamage\b|emission|evocation|arcana|concentration|casting|\bPRO\b|\bMP\b|\bAP\b/i);
  });
  it("no core import function depends on an AI service, remote parser or network", () => {
    for (const f of CORE) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/openai|anthropic|claude|embedding|vector|\bfetch\(|https?:\/\/|node:(http|https|net|dgram)|axios/i);
  });
});

describe("error vocabulary", () => {
  it("every declared DomainError code has an explicit HTTP status; unknown errors fail closed to an opaque 500", async () => {
    const vocabularies = Object.entries(model).filter(([k]) => k.endsWith("_ERROR_CODES")) as Array<[string, Record<string, string>]>;
    expect(vocabularies.map(([k]) => k)).toEqual(expect.arrayContaining(["SOURCE_STRUCTURE_ERROR_CODES", "IMPORT_BATCH_ERROR_CODES", "EXTRACTION_CANDIDATE_ERROR_CODES", "IMPORT_MATCH_ERROR_CODES", "IMPORT_DECISION_ERROR_CODES", "IMPORT_REVIEW_ERROR_CODES"]));
    for (const [name, codes] of vocabularies) for (const c of Object.values(codes)) expect(statusForDomainErrorCode(c), `${name} ${c}`).toEqual(expect.any(Number));
    const res = toErrorResponse(new Error("P2003 SELECT * postgres://u:p@h/db /home/runner/x.ts"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/P2003|SELECT|postgres|home/);
  });
});

describe("WO9 real-source evidence is preserved (historical project record)", () => {
  const report = read("docs", "import-reports", "m3-wo9-core-playtest-v0.1.md");
  it.each([
    "98,897,516",
    "21fa6771ebdbb984941e55e45adaa8a7b6747555645530854ad401540ecde54d",
    "3d9a429c8a52c493141f4c5a8971a098d7e84e65262aeb88f461fef18d9bf1e7",
    "5613613b11573465ccd6598bcc6787ba8e5034c528059d1dd8671aeac9f3279f",
    "b5ca9b10e3c6364818130d4b4e158cbb4afeb0f21bfe96628cffa39cc7483c2b",
    "| Sections | 2,487",
    "| Content nodes | 14,269 |",
    "| Blocks | 13,461 |",
    "| Tables | 772 |",
    "| Assets | 36",
    "| Placements | 36 |",
    "2,800 — 2,028 sections (UNKNOWN) + 772 tables (REFERENCE)",
    "**92 Formulas, 289 Requirements, 244 Keywords**",
    "| Approved for Import | 13",
    "| Rejected | 3",
    "**Review Complete**",
    "**UNAVAILABLE FROM SOURCE METADATA**",
    "The ~898-page figure is not stored in the DOCX metadata and therefore was not derived by Prowess Studio. The source page count is recorded as unavailable.",
  ])("records %s", (fact) => expect(report).toContain(fact));
  it("keeps the semantic findings as findings", () => {
    for (const f of ["34 of 289 Requirements begin with \"or\" or \"and\"", "Formulas using `½`", "parenthetical qualifier", "Single-term rules", "Next-line qualifiers"]) expect(report).toContain(f);
  });
});

describe("M3-I19 the real Rulebook is neither in the repository nor CI input", () => {
  it("no .docx is tracked or in reachable history, and no file over 5 MB is in the tree", () => {
    expect(execSync("git ls-files", { cwd: ROOT }).toString()).not.toMatch(/\.docx$/im);
    let history = "";
    try {
      history = execSync("git log --all --format= --name-only", { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
    } catch {
      history = ""; // shallow / unavailable history: the tracked-files check above still applies
    }
    expect(history).not.toMatch(/\.docx$/im);
    expect(walk(ROOT).filter((f) => statSync(f).size > 5 * 1024 * 1024).map(rel)).toEqual([]);
  });
  it("no private absolute path, local test harness or modified copy exists", () => {
    // Production code, scripts, docs, configs and workflows. (Test files are excluded: redaction tests deliberately seed
    // fake paths / credentials to prove they never leak.)
    const text = walk(ROOT).filter((f) => /\.(ts|tsx|mjs|js|json|md|yml|yaml)$/.test(f) && !/\/tests\//.test(rel(f)) && !/\.(test|spec)\.tsx?$/.test(f));
    for (const f of text) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\/mnt\/user-data|C:\\Users|\/home\/claude|\/Users\/\w+\/|wo9-local|wo9-variant|_variant\.docx/);
    expect(walk(path.join(ROOT, "apps", "studio", "tests")).some((f) => rel(f).includes("wo9-local"))).toBe(false);
  });
  it("the Rulebook hash and file name appear only in the approved report, audit doc and audit tests", () => {
    const hits = walk(ROOT).filter((f) => /\.(ts|tsx|mjs|js|json|md|yml)$/.test(f) && /21fa6771ebdbb984|Prowess_Core_Playtest_Packet_VO_1/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(hits).toEqual(["apps/studio/tests/unit/m3-final-static.test.ts", "apps/studio/tests/unit/m3-wo9-real-source-static.test.ts", "docs/architecture/m3-final-audit.md", "docs/import-reports/m3-wo9-core-playtest-v0.1.md"]);
  });
  it("no CI workflow step assumes the private source exists", () => {
    for (const f of walk(path.join(ROOT, ".github"))) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\.docx|import:source|import:verify-real-source|Playtest/i);
  });
});

describe("invariant catalog and coverage matrix", () => {
  const doc = read("docs", "architecture", "m3-final-audit.md");
  const ids = Array.from({ length: 20 }, (_, i) => `M3-I${String(i + 1).padStart(2, "0")}`);
  it("names all twenty M3 invariants and maps every one to at least one existing automated guard that cites it", () => {
    const tests = walk(ROOT).filter((f) => /\.(test|spec)\.tsx?$/.test(f));
    for (const id of ids) {
      expect(doc, id).toMatch(new RegExp(`\\*\\*${id}\\*\\*`));
      const row = doc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, `coverage row for ${id}`).toBeDefined();
      const files = [...(row as string).matchAll(/`([\w./-]+\.(?:test|spec)\.tsx?)`/g)].map((m) => m[1] as string);
      expect(files.length, id).toBeGreaterThan(0);
      for (const f of files) expect(tests.some((t) => t.endsWith(f)), `${id}: ${f} exists`).toBe(true);
      expect(files.some((f) => readFileSync(tests.find((t) => t.endsWith(f)) as string, "utf8").includes(id)), `${id} is cited by one of its guards`).toBe(true);
    }
  });
});
