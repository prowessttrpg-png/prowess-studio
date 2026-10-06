// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO2 static audit — a Ruleset's composition is an explicit, immutable
 * snapshot of EXACT EntityVersion pins, and nothing else. These checks fail if
 * a later change quietly lets a manifest infer its content (latest revision,
 * lifecycle status, Source authority, a parent Ruleset), grows a mutable or
 * "current" shape, or edits the approved M2-WO1 migration. They read
 * source/schema/migration text, so they run in the ordinary unit step.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripPrisma = (s: string) => s.replace(/\/\/.*$/gm, "");

const SCHEMA = stripPrisma(read("packages", "prowess-db", "prisma", "schema.prisma"));
const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1] as string, body: m[2] as string }));
const find = (name: string) => models.find((m) => m.name === name);
const fieldNames = (body: string | undefined) => [...(body ?? "").matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]).sort();

const dbDir = path.join(ROOT, "packages", "prowess-db", "src", "ruleset-manifest");
const manifestSources = [
  ...["repository.ts", "service.ts", "index.ts"].map((f) => path.join(dbDir, f)),
  path.join(ROOT, "packages", "prowess-model", "src", "ruleset-manifest.ts"),
];
const MIGRATION_DIR = ["packages", "prowess-db", "prisma", "migrations", "20261005001500_add_ruleset_manifest"] as const;

describe("M2-WO2 — the manifest models are immutable snapshots with exact pins", () => {
  it("finds both models and every source (so nothing below can match nothing)", () => {
    expect(find("RulesetManifest")).toBeDefined();
    expect(find("RulesetManifestEntry")).toBeDefined();
    for (const file of manifestSources) expect(existsSync(file), file).toBe(true);
  });

  it("RulesetManifest has exactly its specified fields — and NO updatedAt, because a snapshot is never edited", () => {
    expect(fieldNames(find("RulesetManifest")?.body)).toEqual(
      // M2-WO7 added only the changeSetOperations back-relation LIST: proposals cite a manifest; a manifest is never edited.
      ["changeSetOperations", "childManifests", "createdAt", "entries", "id", "manifestVersion", "parentManifest", "parentManifestId", "ruleset", "rulesetId"],
    ); // M2-WO3 added only the parent-manifest self-reference
    expect(find("RulesetManifest")?.body).not.toMatch(/updatedAt/);
  });

  it("RulesetManifestEntry has exactly its specified fields — an Entity, a Version, nothing that selects", () => {
    expect(fieldNames(find("RulesetManifestEntry")?.body)).toEqual(
      ["createdAt", "entityId", "entityVersion", "entityVersionId", "id", "manifest", "manifestId"],
    );
    expect(find("RulesetManifestEntry")?.body).not.toMatch(/updatedAt/);
  });

  it("neither model has a Boolean (no 'active' / 'current' / 'published' flag)", () => {
    expect(find("RulesetManifest")?.body).not.toMatch(/\bBoolean\b/);
    expect(find("RulesetManifestEntry")?.body).not.toMatch(/\bBoolean\b/);
  });

  it("the Version reference is COMPOSITE (entityVersionId, entityId) -> (id, entityId): the database enforces that the Version belongs to the Entity", () => {
    expect(find("RulesetManifestEntry")?.body).toMatch(/fields:\s*\[entityVersionId,\s*entityId\],\s*references:\s*\[id,\s*entityId\]/);
    expect(find("EntityVersion")?.body).toMatch(/@@unique\(\[id,\s*entityId\]/);
  });

  it("one pin per Entity per manifest, and one manifest_version per Ruleset, are unique constraints", () => {
    expect(find("RulesetManifestEntry")?.body).toMatch(/@@unique\(\[manifestId,\s*entityId\]/);
    expect(find("RulesetManifest")?.body).toMatch(/@@unique\(\[rulesetId,\s*manifestVersion\]/);
  });

  it("Ruleset gained a back-relation list only: no manifest pointer column on Ruleset, Entity or EntityVersion", () => {
    for (const name of ["Ruleset", "Entity", "EntityVersion"]) {
      const body = find(name)?.body ?? "";
      expect(body, name).not.toMatch(/\b(current|active|published|effective|latest)Manifest\w*|\bmanifestId\b|\bmanifest_id\b/i);
    }
    expect(find("Ruleset")?.body).toMatch(/manifests\s+RulesetManifest\[\]/);
  });

  it("nothing still out of scope exists: no release, inheritance, or effective manifest (ChangeSet arrived in M2-WO7)", () => {
    const premature = models.map((m) => m.name).filter((n) => /release|inherit|effective/i.test(n));
    expect(premature).toEqual([]);
  });
});

describe("M2-WO2 — a manifest never infers what it pins", () => {
  // Resolution must be by the exact EntityVersion id stored in the entry. These are the ways it could silently drift.
  const INFERENCE =
    /\b(latestRevision|revisionNumber|getLatestEntityVersion|selectLatestEntityVersion|listEntityVersions|authorityStatus|SourceAuthority|keyword|Keyword|EntityRelationship|relationship|CANON|EntityVersionStatus)\b/;
  const CURRENT_POINTERS =
    /\b(currentManifest|activeManifest|effectiveManifest|current_manifest\w*|active_manifest\w*|is_active|isActive|is_current|isCurrent|useLatest|use_latest\w*|automaticLatest|automatic_latest)\b/;

  it.each(manifestSources.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const code = stripTs(readFileSync(file as string, "utf8"));
    expect(code, "no latest-version / lifecycle / authority / keyword / relationship inference").not.toMatch(INFERENCE);
    // M2-WO3: validating a pinned parent manifest at CREATION requires reading the Ruleset's direct parent, so the
    // creation service may mention parentRulesetId. Nothing else in manifest code may — and the resolution module
    // (ruleset-inheritance/) is audited separately and may not touch Rulesets at all.
    if (!String(file).endsWith(path.join("ruleset-manifest", "service.ts"))) {
      expect(code, "only the creation service may read a Ruleset's parent").not.toMatch(/\bparentRulesetId\b/);
    }
    expect(code, "no status test on an EntityVersion").not.toMatch(/\.status\b/);
    expect(code, "no SQL-style latest-revision inference").not.toMatch(/MAX\s*\(|ORDER\s+BY[^;\n]*revision/i);
    expect(code, "no revision ordering").not.toMatch(/orderBy:\s*\{\s*revisionNumber/);
    expect(code, "no current / active / effective manifest pointer").not.toMatch(CURRENT_POINTERS);
  });

  it("the only ordering the repository performs is by manifestVersion (numbering MANIFESTS) or Entity key — never by an Entity's revision", () => {
    const code = stripTs(read("packages", "prowess-db", "src", "ruleset-manifest", "repository.ts"));
    const orderings = [...code.matchAll(/orderBy:\s*(\{[^}]*\}|\[[^\]]*\])/g)].map((m) => m[1] as string);
    expect(orderings.length).toBeGreaterThanOrEqual(3);
    for (const ordering of orderings) {
      expect(ordering).toMatch(/manifestVersion|canonicalKey|entityId/);
      expect(ordering).not.toMatch(/revision/i);
    }
  });
});

describe("M2-WO2 — scope boundaries", () => {
  it("exposes exactly six manifest operations from @prowess/db — creation and reads; nothing adds, removes, or updates entries", () => {
    const exported = [...read("packages", "prowess-db", "src", "index.ts").matchAll(/export \{([^}]*)\} from "\.\/ruleset-manifest\/index\.js"/g)]
      .flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean))
      .sort();
    expect(exported).toEqual([
      "createRulesetManifest",
      "getLatestRulesetManifest",
      "getManifestEntry",
      "getRulesetManifest",
      "listRulesetManifests",
      "resolveEntityVersionFromManifest",
    ]);
    expect(exported.filter((n) => /^(add|remove|update|delete|set|patch|upsert)/i.test(n))).toEqual([]);
  });

  it("the migration adds only the two manifest tables, their constraints, and the one unique index their composite key needs", () => {
    const sql = read(...MIGRATION_DIR, "migration.sql");
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["ruleset_manifests", "ruleset_manifest_entries"]);
    expect(sql).not.toMatch(/CREATE TYPE/); // no new enum was invented
    expect([...new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(["ruleset_manifest_entries", "ruleset_manifests"]);
    expect([...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "[^"]+" ON "(\w+)"/g)].map((m) => m[1])).toEqual([
      "entity_versions",
      "ruleset_manifests",
      "ruleset_manifest_entries",
      "ruleset_manifest_entries",
      "ruleset_manifest_entries",
    ]);
    expect(sql).not.toMatch(/DROP |ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/);
    expect([...sql.matchAll(/ON DELETE RESTRICT/g)]).toHaveLength(3);
    expect(sql).toMatch(/FOREIGN KEY \("entity_version_id", "entity_id"\) REFERENCES "entity_versions"\("id", "entity_id"\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "entity_versions_id_entity_id_key" ON "entity_versions"\("id", "entity_id"\)/);
  });

  it("the approved M2-WO1 migration is byte-for-byte unchanged", () => {
    const sha = createHash("sha256")
      .update(readFileSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations", "20261004233000_add_ruleset_foundation", "migration.sql")))
      .digest("hex");
    expect(sha).toBe("a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6");
  });

  it("no manifest HTTP route or UI exists yet (those have their own Work Orders)", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = path.join(dir, entry);
        if (/manifest/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
