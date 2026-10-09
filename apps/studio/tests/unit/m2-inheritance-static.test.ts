// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO3 static audit — manifest inheritance is snapshot-based. A child manifest
 * pins its parent manifest by EXACT id, so a newer parent manifest can never
 * change what an existing child resolves to. These checks fail if a later change
 * makes resolution look up a Ruleset or a "latest" manifest, infers from latest
 * revision / status / authority / keywords / relationships, grows a way to change
 * a manifest's parent, persists flattened state, or edits an approved migration.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripPrisma = (s: string) => s.replace(/\/\/.*$/gm, "");
const sha256 = (...p: string[]) => createHash("sha256").update(readFileSync(path.join(ROOT, ...p))).digest("hex");

const SCHEMA = stripPrisma(read("packages", "prowess-db", "prisma", "schema.prisma"));
const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1] as string, body: m[2] as string }));
const manifest = models.find((m) => m.name === "RulesetManifest");
const fieldNames = (body: string | undefined) => [...(body ?? "").matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]).sort();

const inheritanceDir = path.join(ROOT, "packages", "prowess-db", "src", "ruleset-inheritance");
const resolutionSources = [
  ...["repository.ts", "resolution.ts", "index.ts"].map((f) => path.join(inheritanceDir, f)),
  path.join(ROOT, "packages", "prowess-model", "src", "ruleset-resolution.ts"),
];
const manifestDir = path.join(ROOT, "packages", "prowess-db", "src", "ruleset-manifest");
const manifestSources = [
  ...["repository.ts", "service.ts", "index.ts"].map((f) => path.join(manifestDir, f)),
  path.join(ROOT, "packages", "prowess-model", "src", "ruleset-manifest.ts"),
];
const MIGRATION = ["packages", "prowess-db", "prisma", "migrations", "20261005120000_add_manifest_inheritance", "migration.sql"] as const;

// "The parent's latest manifest", in every spelling a future change might reach for.
const DYNAMIC_PARENT =
  /\b(parentRulesetLatest|parent_ruleset_latest|inheritLatest|inherit_latest|useParentLatest|use_parent_latest|dynamicParent|dynamic_parent|currentParentManifest|current_parent_manifest|parentLatest|parent_latest)\b/;

describe("M2-WO3 — the inheritance reference is an exact, immutable snapshot pin", () => {
  it("finds the model and every source (so nothing below can match nothing)", () => {
    expect(manifest).toBeDefined();
    for (const file of [...resolutionSources, ...manifestSources]) expect(existsSync(file), file).toBe(true);
    expect(existsSync(path.join(ROOT, ...MIGRATION))).toBe(true);
  });

  it("RulesetManifest gained exactly the self-reference — a nullable parentManifestId plus its two relation fields — and still has no updatedAt", () => {
    expect(fieldNames(manifest?.body)).toEqual(
      // M2-WO7 added only the changeSetOperations back-relation list.
      // M2-WO8 added only the releases back-relation list.
      // M3-WO2 added only the importBatches back-relation list (a Batch may pin a Manifest as exact comparison context).
      ["changeSetOperations", "childManifests", "createdAt", "entries", "id", "importBatches", "manifestVersion", "parentManifest", "parentManifestId", "releases", "ruleset", "rulesetId"],
    );
    expect(manifest?.body).toMatch(/parentManifestId\s+String\?/);
    expect(manifest?.body).not.toMatch(/updatedAt/);
  });

  it("the self-reference is a real foreign key with ON DELETE RESTRICT, and is indexed for reverse dependency checks", () => {
    expect(manifest?.body).toMatch(
      /@relation\("ManifestInheritance",\s*fields:\s*\[parentManifestId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict/,
    );
    expect(manifest?.body).toMatch(/@@index\(\[parentManifestId\]/);
  });

  it("no dynamic / latest-parent field exists anywhere in the schema or the new migration", () => {
    expect(SCHEMA).not.toMatch(DYNAMIC_PARENT);
    expect(read(...MIGRATION)).not.toMatch(DYNAMIC_PARENT);
  });

  it("nothing persists flattened or derived effective state: no effective/flattened/resolution model, no Resolution enum", () => {
    expect(models.map((m) => m.name).filter((n) => /effective|flatten|resolution/i.test(n))).toEqual([]);
    expect(SCHEMA).not.toMatch(/^enum\s+\w*Resolution/m);
  });
});

describe("M2-WO3 — resolution follows ONLY pinned parent manifests", () => {
  // The resolution module must not be able to ask the questions that would make inheritance dynamic.
  const FORBIDDEN =
    /\b(parentRulesetId|selectLatestRulesetManifest|getLatestRulesetManifest|selectRulesetManifestsByRuleset|listRulesetManifests|selectRulesetById|getRuleset|findRulesetByCanonicalKey|latestRevision|revisionNumber|getLatestEntityVersion|selectLatestEntityVersion|listEntityVersions|selectEntityVersionById|getEntityVersion|authorityStatus|SourceAuthority|keyword|Keyword|EntityRelationship|relationship|CANON|EntityVersionStatus)\b/;

  it.each(resolutionSources.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const code = stripTs(readFileSync(file as string, "utf8"));
    expect(code, "no Ruleset lookup, no latest manifest/version, no status/authority/keyword/relationship").not.toMatch(FORBIDDEN);
    expect(code, "no status test").not.toMatch(/\.status\b/);
    expect(code, "no SQL-style latest-revision inference").not.toMatch(/MAX\s*\(|ORDER\s+BY[^;\n]*revision/i);
    expect(code, "no dynamic-parent identifier").not.toMatch(DYNAMIC_PARENT);
  });

  it("resolution walks the stored parentManifestId chain (positive check, so the bans above cannot be vacuous)", () => {
    const code = stripTs(read("packages", "prowess-db", "src", "ruleset-inheritance", "resolution.ts"));
    expect(code).toMatch(/\.parentManifestId\b/);
    expect(code).toMatch(/selectRulesetManifestById\(parentId\)/);
    expect(code).toMatch(/INHERITANCE_CYCLE/);
  });

  it("resolution reaches storage only through three manifest-repository functions — by exact manifest id — and never reads an EntityVersion", () => {
    const code = stripTs(read("packages", "prowess-db", "src", "ruleset-inheritance", "resolution.ts"));
    const imported = /import \{([^}]*)\} from "\.\.\/ruleset-manifest\/repository\.js"/.exec(code)?.[1] ?? "";
    expect(imported.split(",").map((n) => n.trim()).filter(Boolean).sort()).toEqual([
      "selectManifestEntries",
      "selectManifestEntry",
      "selectRulesetManifestById",
    ]);
    expect(code).not.toMatch(/from "\.\.\/entity-version\//);
    expect(code).not.toMatch(/from "\.\.\/ruleset\//);
  });

  it("the creation path validates a pinned parent against the DIRECT parent Ruleset and never picks one for the caller", () => {
    const service = stripTs(read("packages", "prowess-db", "src", "ruleset-manifest", "service.ts"));
    const helper = /async function validateParentManifest\([\s\S]*?\n\}\n/.exec(service)?.[0] ?? "";
    const create = /export async function createRulesetManifest\([\s\S]*?\n\}\n/.exec(service)?.[0] ?? "";
    expect(helper.length).toBeGreaterThan(200);
    expect(create.length).toBeGreaterThan(200);
    expect(helper).toMatch(/parent\.rulesetId !== ruleset\.parentRulesetId/);
    expect(helper).toMatch(/INVALID_PARENT_MANIFEST/);
    for (const body of [helper, create]) {
      expect(body, "creation must never choose the parent's latest manifest").not.toMatch(
        /selectLatestRulesetManifest|getLatestRulesetManifest|selectRulesetManifestsByRuleset|listRulesetManifests/,
      );
    }
  });
});

describe("M2-WO3 — scope boundaries", () => {
  it("exposes exactly two inheritance operations from @prowess/db; nothing sets, changes, or rebases a parent manifest", () => {
    const inheritanceIndex = stripTs(read("packages", "prowess-db", "src", "ruleset-inheritance", "index.ts"));
    const fromModule = [...inheritanceIndex.matchAll(/export \{([^}]*)\} from/g)]
      .flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean))
      .sort();
    expect(fromModule).toEqual(["getEffectiveManifestEntries", "resolveEffectiveEntityVersion"]);
    const fromPackage = [...read("packages", "prowess-db", "src", "index.ts").matchAll(/export \{([^}]*)\} from "\.\/ruleset-inheritance\/index\.js"/g)]
      .flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean))
      .sort();
    expect(fromPackage).toEqual(fromModule);
    expect([...fromModule, ...manifestSources.map((f) => path.basename(f))].filter((n) => /^(set|change|rebase|reparent|update)/i.test(n))).toEqual([]);
  });

  it("the migration adds only the nullable parent_manifest_id column, one index, and one RESTRICT self-reference", () => {
    const sql = read(...MIGRATION);
    expect(sql).not.toMatch(/CREATE TABLE|CREATE TYPE|DROP |ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/);
    expect([...sql.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN\s+"(\w+)" (\w+)(.*);/g)].map((m) => [m[1], m[2], m[3], (m[4] ?? "").trim()])).toEqual([
      ["ruleset_manifests", "parent_manifest_id", "UUID", ""],
    ]);
    expect([...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "(\w+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ["ruleset_manifests_parent_manifest_id_idx", "ruleset_manifests"],
    ]);
    expect(sql).toMatch(
      /ADD CONSTRAINT "ruleset_manifests_parent_manifest_id_fkey" FOREIGN KEY \("parent_manifest_id"\) REFERENCES "ruleset_manifests"\("id"\) ON DELETE RESTRICT/,
    );
    expect([...sql.matchAll(/ON DELETE RESTRICT/g)]).toHaveLength(1);
  });

  it("the approved M2-WO1 and M2-WO2 migrations are byte-for-byte unchanged", () => {
    const base = ["packages", "prowess-db", "prisma", "migrations"];
    expect(sha256(...base, "20261004233000_add_ruleset_foundation", "migration.sql")).toBe("a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6");
    expect(sha256(...base, "20261005001500_add_ruleset_manifest", "migration.sql")).toBe("31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c");
  });

  it("no inheritance / effective-resolution UI exists outside the M2-WO10 governance workspace (those have their own Work Orders) — the HTTP API arrived in M2-WO9 (pinned by m2-api-static)", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        // M2-WO9: the HTTP API now exists; its exact route inventory is pinned by m2-api-static. UI is still WO10's.
        if (path.join(dir, entry) === path.join(ROOT, "apps", "studio", "app", "api")) continue;
        // M2-WO10: the Ruleset & Canon governance UI now exists; its boundaries are pinned by m2-ui-static.
        if (path.join(dir, entry) === path.join(ROOT, "apps", "studio", "app", "developer", "rulesets")) continue;
        const full = path.join(dir, entry);
        if (/inherit|effective|resolution/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
