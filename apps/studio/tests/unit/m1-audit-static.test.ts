// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";
import { statusForDomainErrorCode } from "../../src/api/errors";

/**
 * M1 audit gate (PAS-10 M1-WO11) — STATIC invariants. Everything here reads
 * source/schema/migration files and the exported domain vocabulary; no
 * database or browser is needed, so these run in the ordinary unit step.
 * They fail loudly if a later change quietly breaks an M1 guarantee.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

function walk(dir: string, accept: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry === "generated" || entry === "dist" || entry === ".next") return [];
    return statSync(full).isDirectory() ? walk(full, accept) : accept(full) ? [full] : [];
  });
}
const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f);
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripPrismaComments = (s: string) => s.replace(/\/\/.*$/gm, "");

const SCHEMA = read("packages", "prowess-db", "prisma", "schema.prisma");
const SCHEMA_CODE = stripPrismaComments(SCHEMA);

describe("M1 audit — no global current-version state (§14)", () => {
  const FORBIDDEN =
    /\b(is_current|isCurrent|current_version_id|currentVersionId|current_version|currentVersion|active_version|activeVersion|active_rule|activeRule|global_current_revision|globalCurrentRevision|currentEntityVersion|current_entity_version|useLatest|use_latest|useLatestVersion|use_latest_version|automaticLatest|automatic_latest|globalCurrentRule|global_current_rule|currentManifestEntry|current_manifest_entry)\b/;

  const scanned: Array<[string, string[]]> = [
    ["@prowess/model", walk(path.join(ROOT, "packages", "prowess-model", "src"), isSource)],
    ["@prowess/db", walk(path.join(ROOT, "packages", "prowess-db", "src"), isSource)],
    ["apps/studio/app", walk(path.join(ROOT, "apps", "studio", "app"), isSource)],
    ["apps/studio/src", walk(path.join(ROOT, "apps", "studio", "src"), isSource)],
  ];

  it("scans a meaningful amount of source", () => {
    for (const [, files] of scanned) expect(files.length).toBeGreaterThan(3);
  });

  it.each(scanned)("%s contains no current/active-version field or identifier", (_name, files) => {
    for (const file of files) {
      expect(stripTsComments(readFileSync(file, "utf8")), path.relative(ROOT, file)).not.toMatch(FORBIDDEN);
    }
  });

  it("schema.prisma has no current/active-version column", () => {
    expect(SCHEMA_CODE).not.toMatch(FORBIDDEN);
  });

  it("the ONLY boolean column in the whole schema is KeywordDefinition.deprecated (any new flag must be consciously audited)", () => {
    const booleans = [...SCHEMA_CODE.matchAll(/^\s+(\w+)\s+Boolean\b/gm)].map((m) => m[1]);
    expect(booleans).toEqual(["deprecated"]);
  });

  it("Entity holds no pointer to any EntityVersion; versions point only at their Entity and optional parent", () => {
    const entityModel = /model Entity \{([\s\S]*?)\n\}/.exec(SCHEMA_CODE)?.[1] ?? "";
    expect(entityModel).not.toMatch(/versionId/i);
    const versionModel = /model EntityVersion \{([\s\S]*?)\n\}/.exec(SCHEMA_CODE)?.[1] ?? "";
    const idColumns = [...versionModel.matchAll(/^\s+(\w+Id)\s+String/gm)].map((m) => m[1]);
    expect(idColumns.sort()).toEqual(["entityId", "parentVersionId"]);
  });

  it("latestRevision (highest revisionNumber) is the one deterministic convenience, and is implemented as exactly that", () => {
    const service = read("packages", "prowess-db", "src", "entity-query", "repository.ts");
    expect(service).toMatch(/orderBy:\s*\{\s*revisionNumber:\s*"desc"\s*\}/);
  });
});

describe("M1 audit — enum parity between Prisma schema and @prowess/model (§16)", () => {
  const PARITY: Record<string, readonly string[]> = {
    EntityType: model.ENTITY_TYPES,
    EntityVersionStatus: model.ENTITY_VERSION_STATUSES,
    ChangeType: model.CHANGE_TYPES,
    KeywordAssignmentSource: model.KEYWORD_ASSIGNMENT_SOURCES,
    RelationshipType: model.RELATIONSHIP_TYPES,
    SourceDocumentType: model.SOURCE_DOCUMENT_TYPES,
    SourceAuthorityStatus: model.SOURCE_AUTHORITY_STATUSES,
    RulesetStatus: model.RULESET_STATUSES,
    RulesetChannel: model.RULESET_CHANNELS,
    RuleConflictType: model.RULE_CONFLICT_TYPES,
    RuleConflictSeverity: model.RULE_CONFLICT_SEVERITIES,
    RuleConflictStatus: model.RULE_CONFLICT_STATUSES,
    CanonDecisionType: model.CANON_DECISION_TYPES,
    CanonConflictDisposition: model.CANON_CONFLICT_DISPOSITIONS,
    ChangeSetStatus: model.CHANGE_SET_STATUSES,
    ChangeSetOperationType: model.CHANGE_SET_OPERATION_TYPES,
  };

  const schemaEnums = new Map<string, string[]>(
    [...SCHEMA_CODE.matchAll(/^enum (\w+) \{([^}]*)\}/gm)].map((m) => [
      m[1] as string,
      (m[2] as string)
        .split("\n")
        .map((line) => line.trim().split(/\s+/)[0] ?? "")
        .filter((v) => v.length > 0),
    ]),
  );

  it("every Prisma enum has a parity entry, and every parity entry exists in the schema", () => {
    expect([...schemaEnums.keys()].sort()).toEqual(Object.keys(PARITY).sort());
  });

  it.each(Object.entries(PARITY))("%s: schema values equal the domain vocabulary exactly", (name, domainValues) => {
    expect([...(schemaEnums.get(name) ?? [])].sort()).toEqual([...domainValues].sort());
  });
});

describe("M1 audit — error vocabulary (§17)", () => {
  const vocabularies = Object.entries(model).filter(([key]) => key.endsWith("_ERROR_CODES")) as Array<
    [string, Record<string, string>]
  >;
  const allCodes = vocabularies.flatMap(([, codes]) => Object.values(codes));

  it("exports the sixteen vocabularies (nine from M1, Ruleset M2-WO1, RulesetManifest M2-WO2, CanonPolicy and SourceAuthority M2-WO4, RuleConflict M2-WO5, CanonDecision M2-WO6, ChangeSet M2-WO7)", () => {
    expect(vocabularies.map(([name]) => name).sort()).toEqual(
      [
        "ENTITY_ALIAS_ERROR_CODES",
        "ENTITY_ERROR_CODES",
        "ENTITY_VERSION_ERROR_CODES",
        "KEYWORD_ASSIGNMENT_ERROR_CODES",
        "KEYWORD_CATEGORY_ERROR_CODES",
        "KEYWORD_ERROR_CODES",
        "RELATIONSHIP_ERROR_CODES",
        "RULESET_ERROR_CODES",
        "RULESET_MANIFEST_ERROR_CODES",
        "CANON_POLICY_ERROR_CODES",
        "SOURCE_AUTHORITY_ERROR_CODES",
        "RULE_CONFLICT_ERROR_CODES",
        "CANON_DECISION_ERROR_CODES",
        "CHANGE_SET_ERROR_CODES",
        "SOURCE_DOCUMENT_ERROR_CODES",
        "SOURCE_REFERENCE_ERROR_CODES",
      ].sort(),
    );
  });

  it("codes are well-formed (DOMAIN.REASON) and globally unique", () => {
    for (const code of allCodes) expect(code).toMatch(/^[A-Z_]+\.[A-Z_]+$/);
    expect(new Set(allCodes).size).toBe(allCodes.length);
  });

  it("every controlled code has an explicit numeric HTTP mapping (none relies on a default)", () => {
    for (const code of allCodes) expect(statusForDomainErrorCode(code), code).toBeTypeOf("number");
  });

  it("an unknown code has NO mapping, so the API must fail closed to 500", () => {
    expect(statusForDomainErrorCode("NOT.A_REAL_CODE")).toBeUndefined();
  });

  const CONTROLLED_UNIONS =
    "Entity|EntityVersion|EntityAlias|KeywordCategory|Keyword|KeywordAssignment|Relationship|SourceDocument|SourceReference".split("|").map((n) => `${n}ErrorCode`).join("|");

  it("every DomainError thrown in @prowess/db uses a controlled constant (or a parameter typed with a controlled union) — never a raw string", () => {
    const files = walk(path.join(ROOT, "packages", "prowess-db", "src"), isSource);
    const used: string[] = [];
    for (const file of files) {
      const text = stripTsComments(readFileSync(file, "utf8"));
      for (const match of text.matchAll(/new DomainError\(\s*([^,\n]+),/g)) {
        const arg = (match[1] as string).trim();
        const where = `${path.relative(ROOT, file)}: ${arg}`;
        if (/^\w+$/.test(arg)) {
          // A variable is acceptable ONLY as a parameter typed with a controlled
          // *ErrorCode union — never a plain `string` (PAS-10 M1-WO11 finding F-2).
          expect(text, where).toMatch(new RegExp(`\\b${arg}\\s*:\\s*(${CONTROLLED_UNIONS})\\b`));
        } else {
          expect(arg, where).toMatch(/^[A-Z_]+_ERROR_CODES\.[A-Z_]+$/);
          used.push(arg);
        }
      }
    }
    expect(used.length).toBeGreaterThan(20);
    const byName = Object.fromEntries(vocabularies);
    for (const ref of used) {
      const [vocab, key] = ref.split(".") as [string, string];
      expect(byName[vocab]?.[key], `${ref} must exist in @prowess/model`).toBeTypeOf("string");
    }
  });
});

describe("M1 audit — migration chain (§26)", () => {
  const dir = path.join(ROOT, "packages", "prowess-db", "prisma", "migrations");
  const names = readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory());

  it("is exactly the eight frozen M1 migrations followed by the deliberately-added M2 ones, in timestamp order", () => {
    const M1 = [
      "20260930235722_init",
      "20261001045349_add_entity",
      "20261001212804_add_entity_version",
      "20261001215241_add_entity_version_updated_at",
      "20261002022400_add_entity_alias",
      "20261002025218_add_keyword_foundation",
      "20261002225710_add_entity_relationship",
      "20261002231523_add_source_provenance",
    ];
    // M2 migrations are appended deliberately: a new one must be added here on purpose.
    const M2 = ["20261004233000_add_ruleset_foundation", "20261005001500_add_ruleset_manifest", "20261005120000_add_manifest_inheritance", "20261005220000_add_canon_policy", "20261006010000_add_rule_conflicts", "20261007010000_add_canon_decisions", "20261008010000_add_change_sets"];
    expect(names.slice(0, M1.length)).toEqual(M1);
    expect(names).toEqual([...M1, ...M2]);
    expect([...names].sort()).toEqual(names);
    expect(new Set(names.map((n) => n.slice(0, 14))).size).toBe(names.length);
  });

  it("targets PostgreSQL", () => {
    expect(readFileSync(path.join(dir, "migration_lock.toml"), "utf8")).toMatch(/provider = "postgresql"/);
  });

  it.each(names)("%s drops nothing, cascades no delete, and carries no sandbox/verification residue", (name) => {
    const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|SCHEMA)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT)/i);
    expect(sql).not.toMatch(/sandbox|TODO|FIXME/i);
  });

  it("every foreign key in every migration is ON DELETE RESTRICT", () => {
    const all = names.map((n) => readFileSync(path.join(dir, n, "migration.sql"), "utf8")).join("\n");
    const fks = [...all.matchAll(/ON DELETE (RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION)/g)].map((m) => m[1]);
    expect(fks.length).toBeGreaterThanOrEqual(12);
    expect(new Set(fks)).toEqual(new Set(["RESTRICT"]));
  });

  it("schema.prisma agrees: every relation with a foreign key declares onDelete: Restrict", () => {
    const relations = SCHEMA_CODE.split("\n").filter((l) => /@relation\(.*fields:/.test(l));
    expect(relations.length).toBeGreaterThanOrEqual(12);
    for (const line of relations) expect(line, line.trim()).toMatch(/onDelete:\s*Restrict/);
  });
});

describe("M1 audit — workspace layering (§29)", () => {
  const pkg = (dir: string) =>
    JSON.parse(read(...dir.split("/"), "package.json")) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  const internal = (dir: string) =>
    Object.keys({ ...pkg(dir).dependencies, ...pkg(dir).devDependencies }).filter((d) => d.startsWith("@prowess/"));

  const ALLOWED: Record<string, string[]> = {
    "packages/prowess-model": [],
    "packages/prowess-ui": [],
    "packages/prowess-test-fixtures": [],
    "packages/prowess-db": ["@prowess/model"],
    "apps/studio": ["@prowess/db", "@prowess/model", "@prowess/ui"],
  };

  it.each(Object.entries(ALLOWED))("%s depends only on its permitted workspace packages", (dir, allowed) => {
    expect(internal(dir).sort()).toEqual([...allowed].sort());
  });

  it("the workspace dependency graph has no cycles", () => {
    const graph = new Map(Object.keys(ALLOWED).map((dir) => [pkg(dir).name, internal(dir)]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string) => {
      expect(visiting.has(name), `cycle through ${name}`).toBe(false);
      if (done.has(name)) return;
      visiting.add(name);
      for (const next of graph.get(name) ?? []) visit(next);
      visiting.delete(name);
      done.add(name);
    };
    for (const name of graph.keys()) visit(name);
  });

  it("@prowess/model has no runtime dependencies at all; @prowess/ui has none on persistence", () => {
    expect(Object.keys(pkg("packages/prowess-model").dependencies ?? {})).toEqual([]);
    const ui = Object.keys(pkg("packages/prowess-ui").dependencies ?? {});
    for (const dep of ui) expect(dep).not.toMatch(/^(@prisma\/|prisma$|pg$|@prowess\/db)/);
  });
});

describe("M1 audit — schema.prisma agrees with the migrations' defaults (F-1/F-13, confirmed by Prisma's drift check)", () => {
  const migrationsDir = path.join(ROOT, "packages", "prowess-db", "prisma", "migrations");
  const sql = readdirSync(migrationsDir)
    .filter((entry) => statSync(path.join(migrationsDir, entry)).isDirectory())
    .sort()
    .map((entry) => readFileSync(path.join(migrationsDir, entry, "migration.sql"), "utf8"))
    .join("\n");

  interface ModelInfo {
    name: string;
    table: string | undefined;
    body: string;
  }
  const models: ModelInfo[] = [...SCHEMA_CODE.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
    name: m[1] as string,
    body: m[2] as string,
    table: /@@map\("([^"]+)"\)/.exec(m[2] as string)?.[1],
  }));
  const idModels = models.filter((m) => /^\s+id\s+String\s+@id/m.test(m.body));
  const idLine = (m: ModelInfo) => /^\s+id\s+String\s+@id.*$/m.exec(m.body)?.[0] ?? "";

  /** A column's definition as written in the migrations (CREATE TABLE, or a later ADD COLUMN). */
  function columnDefinition(table: string, column: string): string | undefined {
    const create = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1];
    const fromCreate = create ? new RegExp(`"${column}" [^\\n]*`).exec(create)?.[0] : undefined;
    return fromCreate ?? new RegExp(`ALTER TABLE "${table}" ADD COLUMN "${column}" [^;\\n]*`).exec(sql)?.[0];
  }

  it("parses the schema's models and the migrations' tables (so the checks below cannot match nothing)", () => {
    expect(models.length).toBeGreaterThanOrEqual(11);
    expect(idModels.length).toBeGreaterThanOrEqual(9);
    expect(sql).toContain('CREATE TABLE "entities"');
  });

  it("every single-column UUID id is declared dbgenerated(gen_random_uuid()) with @db.Uuid", () => {
    for (const model of idModels) {
      expect(idLine(model), model.name).toContain('@default(dbgenerated("gen_random_uuid()"))');
      expect(idLine(model), model.name).toContain("@db.Uuid");
    }
  });

  it("no field anywhere still uses the client-side uuid() default", () => {
    expect(SCHEMA_CODE).not.toMatch(/@default\(uuid\(\)\)/);
  });

  it("the tables whose migrations give the id a database default are exactly the tables the schema declares that way", () => {
    const fromMigrations = [...sql.matchAll(/CREATE TABLE "(\w+)" \(\s*"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/g)]
      .map((m) => m[1] as string)
      .sort();
    const fromSchema = idModels
      .filter((m) => /dbgenerated\("gen_random_uuid\(\)"\)/.test(idLine(m)))
      .map((m) => m.table as string)
      .sort();
    expect(fromMigrations.length).toBeGreaterThanOrEqual(9);
    expect(fromSchema).toEqual(fromMigrations);
  });

  it("composite-key assignment tables have no id column and were not touched", () => {
    const composite = models.filter((m) => /@@id\(/.test(m.body)).map((m) => m.name).sort();
    expect(composite).toEqual(["EntityKeyword", "EntityVersionKeyword"]);
    for (const model of ["EntityKeyword", "EntityVersionKeyword"]) {
      expect(models.find((m) => m.name === model)?.body).not.toMatch(/\bgen_random_uuid\b/);
    }
  });

  it("for EVERY @updatedAt field, the schema has a default exactly when the migration gives the column one", () => {
    const updated = models.flatMap((model) =>
      [...model.body.matchAll(/^\s+(\w+)\s+DateTime\s+(.*@updatedAt.*)$/gm)].map((m) => ({
        model: model.name,
        table: model.table as string,
        column: /@map\("([^"]+)"\)/.exec(m[2] as string)?.[1] as string,
        schemaHasDefault: /@default\(/.test(m[2] as string),
      })),
    );
    expect(updated.length).toBeGreaterThanOrEqual(3); // SystemMigrationProbe, Entity, EntityVersion
    for (const field of updated) {
      const definition = columnDefinition(field.table, field.column);
      expect(definition, `${field.table}.${field.column} must be defined in a migration`).toBeDefined();
      expect(field.schemaHasDefault, `${field.model}.updatedAt vs migration: ${definition}`).toBe(/\bDEFAULT\b/.test(definition as string));
    }
  });

  it("EntityVersion.updatedAt keeps TIMESTAMPTZ(6), a database DEFAULT now() on insert, AND @updatedAt on update", () => {
    const entityVersion = models.find((m) => m.name === "EntityVersion") as ModelInfo;
    const line = /^\s+updatedAt\s+DateTime.*$/m.exec(entityVersion.body)?.[0] ?? "";
    expect(line).toContain("@default(now())");
    expect(line).toContain("@updatedAt");
    expect(line).toContain("@db.Timestamptz(6)");
    expect(line).toContain('@map("updated_at")');
    expect(columnDefinition("entity_versions", "updated_at")).toMatch(/TIMESTAMPTZ\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });
});

describe("M1 audit — the schema/migration drift check is a required CI gate", () => {
  const ci = read(".github", "workflows", "ci.yml");
  const start = ci.indexOf("- name: Schema drift check");
  const next = ci.indexOf("\n      #", start); // the comment block that begins the next step
  const step = ci.slice(start, next === -1 ? undefined : next);

  it("exists and runs Prisma's own diff with --exit-code", () => {
    expect(start).toBeGreaterThan(-1);
    expect(step).toContain("prisma migrate diff");
    expect(step).toContain("--exit-code");
  });

  it("is blocking: no continue-on-error, and the step exits with Prisma's own code", () => {
    expect(step).not.toMatch(/continue-on-error/);
    expect(step).toContain('exit "$code"');
  });

  it("does not hide the diff: output is tee'd to the log and repeated in the summary", () => {
    expect(step).toContain("tee /tmp/prisma-drift.txt");
    expect(step).toContain("GITHUB_STEP_SUMMARY");
  });

  it("calls Prisma directly, not through pnpm's recursive runner (which flattens every failure to exit 1)", () => {
    expect(step).toContain("./node_modules/.bin/prisma");
    expect(step).not.toMatch(/pnpm --filter/);
  });
});
