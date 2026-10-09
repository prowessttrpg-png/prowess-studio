// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";

/**
 * M3-WO1 static audit — Source Document & Source Structure Foundation. Pins what the structured-source layer may and
 * may not do, by reading the source, schema and migration text:
 *   - the migration is additive, pinned byte-for-byte, and carries its CHECK constraints;
 *   - ingestion code writes ONLY the approved source-domain tables, only by INSERT;
 *   - it never touches Entity / EntityVersion, CanonDecision, Ruleset publication, RuleConflict, Rules Engine logic;
 *   - it contains no semantic Prowess rule classification;
 *   - it never invents page numbers;
 *   - the public service surface is exactly the approved one.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (dir: string, out: string[] = []) => {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) out.push(f);
  }
  return out;
};
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const DB_SRC = path.join(ROOT, "packages", "prowess-db", "src");
const M3_DIRS = ["source-snapshot", "source-structure", "source-ingestion"];
const M3_FILES = M3_DIRS.flatMap((d) => walk(path.join(DB_SRC, d)));
const MIGRATION = "20261011010000_add_source_structure";
const MIGRATION_SQL = read("packages", "prowess-db", "prisma", "migrations", MIGRATION, "migration.sql");
const SCHEMA = read("packages", "prowess-db", "prisma", "schema.prisma").replace(/\/\/.*$/gm, "");

describe("M3-WO1 migration", () => {
  it("is pinned byte-for-byte (an approved migration is never edited)", () => {
    expect(createHash("sha256").update(MIGRATION_SQL).digest("hex")).toBe("edd72da496f3fe5ea1d8b499b8ff69278f80bf41fe363b2cc8cfe64dc74faba7");
  });

  it("creates exactly the eight structured-source tables and four structural enums", () => {
    expect([...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual([
      "source_snapshots", "source_snapshot_ingestions", "source_sections", "source_blocks", "source_tables", "source_assets", "source_asset_placements", "source_content_nodes",
    ]);
    expect([...MIGRATION_SQL.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["SourceBlockType", "SourceContentNodeType", "SourceAssetType", "SourcePageLocationBasis"]);
  });

  it("touches exactly one pre-existing table — source_references — and only by adding NULLABLE columns, indexes, keys and a CHECK", () => {
    const created = new Set([...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]));
    const altered = new Set([...MIGRATION_SQL.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1] as string).filter((t) => !created.has(t)));
    expect([...altered]).toEqual(["source_references"]);
    const addColumns = /ALTER TABLE "source_references" ADD COLUMN[\s\S]*?;/.exec(MIGRATION_SQL)?.[0] ?? "";
    expect([...addColumns.matchAll(/ADD COLUMN\s+"(\w+)" UUID(,|;)/g)].map((m) => m[1])).toEqual(["source_block_id", "source_section_id", "source_snapshot_id", "source_table_id"]);
    expect(addColumns).not.toMatch(/NOT NULL|DEFAULT/);
    expect(MIGRATION_SQL).not.toMatch(/\b(DROP|RENAME|TRUNCATE|UPDATE\s+"|DELETE\s+FROM)\b/i);
    expect(MIGRATION_SQL).not.toMatch(/ALTER COLUMN/i);
  });

  it("every foreign key is ON DELETE RESTRICT and every cross-row structure key is composite over the Snapshot", () => {
    const fks = [...MIGRATION_SQL.matchAll(/ADD CONSTRAINT "(\w+)" FOREIGN KEY \(([^)]+)\) REFERENCES "(\w+)"\(([^)]+)\) ON DELETE (\w+)/g)];
    expect(fks.length).toBe(21);
    for (const fk of fks) expect(fk[5], fk[1]).toBe("RESTRICT");
    const structureTargets = ["source_sections", "source_blocks", "source_tables", "source_assets", "source_asset_placements"];
    for (const fk of fks.filter((f) => structureTargets.includes(f[3] as string))) expect(fk[4], fk[1]).toBe('"id", "source_snapshot_id"');
  });

  it("carries the CHECK constraints that Prisma cannot model (and so the drift check cannot see)", () => {
    for (const name of [
      "source_content_nodes_exactly_one_target_check",
      "source_references_locator_requires_snapshot_check",
      "source_sections_page_location_check",
      "source_blocks_page_location_check",
      "source_tables_page_location_check",
      "source_asset_placements_page_location_check",
    ]) expect(MIGRATION_SQL).toContain(`"${name}" CHECK`);
  });

  it("contains no semicolon inside a comment (some engines split scripts on ';')", () => {
    for (const line of MIGRATION_SQL.split("\n").filter((l) => l.trimStart().startsWith("--"))) expect(line).not.toContain(";");
  });
});

describe("M3-WO1 schema", () => {
  const body = (name: string) => new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(SCHEMA)?.[1] ?? "";

  it("no structure model has an updatedAt, a status, a current/active flag, or any Canon/authority field", () => {
    for (const m of ["SourceSnapshot", "SourceSnapshotIngestion", "SourceSection", "SourceBlock", "SourceTable", "SourceAsset", "SourceAssetPlacement", "SourceContentNode"]) {
      expect(body(m), m).not.toMatch(/updatedAt|\bstatus\b|authority|canon|isCurrent|isActive|current|active|ruleset/i);
    }
  });

  it("every vocabulary is structural, never game-semantic", () => {
    for (const v of [...model.SOURCE_BLOCK_TYPES, ...model.SOURCE_CONTENT_NODE_TYPES, ...model.SOURCE_ASSET_TYPES, ...model.SOURCE_PAGE_LOCATION_BASES]) {
      expect(v).not.toMatch(/SPELL|DAMAGE|FORMULA|SKILL|MANEUVER|SUMMON|MISSION|RULE|EFFECT|COST|TIER|ESTIMATE/);
    }
  });
});

describe("M3-WO1 ingestion code boundaries", () => {
  it("covers the expected modules", () => {
    expect(M3_FILES.map(rel).sort()).toEqual([
      "packages/prowess-db/src/source-ingestion/docx/image-info.ts",
      "packages/prowess-db/src/source-ingestion/docx/parse.ts",
      "packages/prowess-db/src/source-ingestion/docx/xml.ts",
      "packages/prowess-db/src/source-ingestion/docx/zip.ts",
      "packages/prowess-db/src/source-ingestion/index.ts",
      "packages/prowess-db/src/source-ingestion/service.ts",
      "packages/prowess-db/src/source-snapshot/index.ts",
      "packages/prowess-db/src/source-snapshot/repository.ts",
      "packages/prowess-db/src/source-snapshot/service.ts",
      "packages/prowess-db/src/source-structure/index.ts",
      "packages/prowess-db/src/source-structure/repository.ts",
      "packages/prowess-db/src/source-structure/service.ts",
    ]);
  });

  it("imports nothing from Entity / EntityVersion, Canon, Ruleset, conflict, ChangeSet, Release, migration-plan or a Rules Engine", () => {
    for (const f of M3_FILES) {
      const imports = [...strip(readFileSync(f, "utf8")).matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1] as string);
      for (const i of imports) {
        expect(i, rel(f)).not.toMatch(/entity|canon|ruleset|rule-conflict|change-set|review-lifecycle|migration-plan|keyword|relationship|rules-engine|@prowess\/rules/i);
        expect(i, rel(f)).toMatch(/^(\.\.?\/|@prowess\/model$|node:(crypto|zlib)$)/);
      }
    }
  });

  it("writes ONLY the approved source-domain tables, ONLY by insert — no update, upsert, delete or raw SQL", () => {
    const writes: string[] = [];
    for (const f of M3_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\$executeRaw|\$queryRaw|\b(?:tx|prisma)\.\w+\.(update|updateMany|upsert|delete|deleteMany)\(/);
      for (const m of src.matchAll(/\b(?:tx|prisma)\.(\w+)\.(create|createMany)\(/g)) writes.push(`${m[1]}.${m[2]}`);
    }
    expect([...new Set(writes)].sort()).toEqual([
      "sourceAsset.createMany", "sourceAssetPlacement.createMany", "sourceBlock.createMany", "sourceContentNode.createMany",
      "sourceSection.createMany", "sourceSnapshot.create", "sourceSnapshotIngestion.create", "sourceTable.createMany",
    ]);
  });

  it("reads no table outside the source domain", () => {
    for (const f of M3_FILES) {
      for (const m of strip(readFileSync(f, "utf8")).matchAll(/\b(?:tx|prisma)\.(\w+)\./g)) expect(m[1], rel(f)).toMatch(/^source(Snapshot|SnapshotIngestion|Section|Block|Table|Asset|AssetPlacement|ContentNode)$/);
    }
  });

  it("contains no semantic Prowess rule classification (comments excluded)", () => {
    for (const f of M3_FILES) {
      expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\b(spell|damage|formula|maneuver|summon|skill|mission|trained|expert|mpCost|apCost|actionPoint|calculate|rulesEngine)\w*/i);
    }
  });

  it("never invents page numbers: the parser only ever states UNAVAILABLE and assigns no page field", () => {
    const parser = strip(read("packages", "prowess-db", "src", "source-ingestion", "docx", "parse.ts"));
    expect(parser).not.toMatch(/\bpage(Start|End|Number)\s*:/);
    expect([...parser.matchAll(/pageLocationBasis:\s*"(\w+)"/g)].map((m) => m[1])).toSatisfy((v: string[]) => v.length > 0 && v.every((x) => x === "UNAVAILABLE"));
  });

  it("SourceReference reaches the structure layer only through read functions", () => {
    const svc = strip(read("packages", "prowess-db", "src", "source-reference", "service.ts"));
    const imported = [...svc.matchAll(/import \{([^}]*)\} from "\.\.\/source-(snapshot|structure)\/repository\.js"/g)].flatMap((m) => (m[1] as string).split(",").map((x) => x.trim()));
    expect(imported.sort()).toEqual(["selectBlockById", "selectSectionById", "selectSourceSnapshotById", "selectTableById"]);
  });
});

describe("M3-WO1 public service surface", () => {
  const root = read("packages", "prowess-db", "src", "index.ts");
  const names = new Set<string>();
  for (const m of root.matchAll(/export\s*\{([^}]*)\}/g)) for (const x of (m[1] as string).split(",")) { const t = x.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop(); if (t) names.add(t); }

  it("exposes exactly the approved source-structure functions", () => {
    expect([...names].filter((x) => /Source(Snapshot|Structure|Section|Block|Table|Asset)|Docx|DOCX/.test(x)).sort()).toEqual([
      "DOCX_MIME_TYPE", "DOCX_PARSER_NAME", "DOCX_PARSER_VERSION",
      "createSourceSnapshot", "findSourceSnapshotByContentHash", "getSourceAsset", "getSourceBlock", "getSourceSection", "getSourceSectionContent",
      "getSourceSnapshot", "getSourceSnapshotIngestion", "getSourceStructure", "getSourceTable", "hashSourceStructure", "ingestSourceSnapshot",
      "ingestSourceStructure", "listSourceAssetPlacements", "listSourceAssets", "listSourceSectionChildren", "listSourceSnapshots", "parseDocxStructure",
    ].sort());
  });

  it("has no Canon-promotion, matching or semantic-extraction surface (ImportBatch / ExtractionCandidate arrived in M3-WO2; the rest are later M3 Work Orders)", () => {
    for (const x of names) expect(x).not.toMatch(/promote|Promotion|matchEntit|matchCandidate|extractFormula|approveCandidate|rejectCandidate/i); // ImportDecision arrived in M3-WO6 (audited there)
  });

  it("no HTTP route exposes the structure layer yet (services only in WO1)", () => {
    const api = path.join(ROOT, "apps", "studio", "app", "api");
    const routes: string[] = [];
    const visit = (d: string) => { for (const e of readdirSync(d)) { const f = path.join(d, e); if (statSync(f).isDirectory()) visit(f); else routes.push(readFileSync(f, "utf8")); } };
    visit(api);
    for (const r of routes) expect(r).not.toMatch(/SourceSnapshot|SourceStructure|ingestSource|getSource(Section|Block|Table|Asset)/);
  });
});

describe("M3-WO1 documentation", () => {
  it("states the Canon boundary verbatim and carries both required diagrams", () => {
    const doc = read("docs", "architecture", "m3-source-structure.md");
    expect(doc).toContain("Source structure records what a source says and where it says it.");
    expect(doc).toContain("It does not determine whether that source is Canon.");
    expect(doc).toMatch(/SourceDocument[\s\S]{0,80}SourceSnapshot/);
    expect(doc).toMatch(/V0\.1[\s\S]{0,400}V0\.2/);
    expect(doc).toMatch(/no overwrite/i);
  });
});
