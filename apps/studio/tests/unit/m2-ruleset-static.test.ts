// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO1 static audit — the Ruleset foundation is identity + lifecycle ONLY.
 * These checks fail if a later change quietly couples a Ruleset to content,
 * introduces automatic selection, or sneaks in a second key grammar. They read
 * source/schema/migration text, so they run in the ordinary unit step.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripPrisma = (s: string) => s.replace(/\/\/.*$/gm, "");

const SCHEMA = stripPrisma(read("packages", "prowess-db", "prisma", "schema.prisma"));
const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1] as string, body: m[2] as string }));
const ruleset = models.find((m) => m.name === "Ruleset");

const modelDir = path.join(ROOT, "packages", "prowess-model", "src");
const dbDir = path.join(ROOT, "packages", "prowess-db", "src", "ruleset");
const rulesetSources = [
  ...["ruleset.ts", "ruleset-status.ts", "ruleset-channel.ts", "ruleset-lineage.ts"].map((f) => path.join(modelDir, f)),
  ...["repository.ts", "service.ts", "index.ts"].map((f) => path.join(dbDir, f)),
];

describe("M2-WO1 — the Ruleset model is identity and lifecycle only", () => {
  it("finds the Ruleset model and its sources (so nothing below can match nothing)", () => {
    expect(ruleset).toBeDefined();
    for (const file of rulesetSources) expect(existsSync(file), file).toBe(true);
  });

  it("has exactly the specified fields (M2-WO2, M2-WO4, M2-WO5 and M2-WO6 added only the manifests, canonPolicies, ruleConflicts and canonDecisions back-relation lists, never a column) — nothing that names or selects content", () => {
    const fields = [...(ruleset?.body ?? "").matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]).sort();
    expect(fields).toEqual(
      ["canonDecisions", "canonPolicies", "canonicalKey", "channel", "children", "createdAt", "description", "id", "manifests", "name", "parent", "parentRulesetId", "ruleConflicts", "status", "updatedAt", "versionLabel"].sort(),
    );
  });

  it("has no Boolean field (no flags such as 'current' or 'useLatest')", () => {
    expect(ruleset?.body).not.toMatch(/\bBoolean\b/);
  });

  it("references no Entity or EntityVersion; and apart from the manifest models, CanonPolicy, RuleConflict and CanonDecision, no model references Ruleset", () => {
    // M2-WO2 superseded the old blanket "no other model references Ruleset": the manifest models legitimately do.
    // The intent stands: Entity and EntityVersion never reference a Ruleset (no ruleset_id on EntityVersion).
    expect(ruleset?.body).not.toMatch(/\bEntity(Version)?\b/);
    for (const other of models.filter((model) => !["Ruleset", "RulesetManifest", "RulesetManifestEntry", "CanonPolicy", "RuleConflict", "CanonDecision"].includes(model.name))) {
      expect(other.body, `${other.name} must not reference Ruleset (no ruleset_id / rulesetId / Ruleset relation)`).not.toMatch(/\bRuleset\b|rulesetId|ruleset_id/i);
    }
  });

  it("no release, change-set, inheritance, or effective-manifest model exists yet", () => {
    // Manifests were removed from this list by M2-WO2; everything still out of scope stays on it.
    const premature = models.map((m) => m.name).filter((n) => /release|changeset|inherit|effective/i.test(n));
    expect(premature).toEqual([]);
  });
});

describe("M2-WO1 — no automatic selection, no derivation from latest/CANON/authority", () => {
  const SELECTION =
    /\b(currentVersion|currentEntityVersion|current_entity_version|useLatest|use_latest|use_latest_version|automaticLatest|automatic_latest|activeRule|active_rule|globalCurrentRule|global_current_rule|currentManifestEntry|current_manifest_entry|isCurrent|is_current)\b/;
  const DERIVATION = /\b(latestRevision|revisionNumber|authorityStatus|EntityVersion|entityVersion)\b/;

  it.each(rulesetSources.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const code = stripTs(readFileSync(file as string, "utf8"));
    expect(code).not.toMatch(SELECTION);
    expect(code, "Ruleset code must not consult latest revision, revision number, or Source authority").not.toMatch(DERIVATION);
  });

  it("the Ruleset schema model and its migration carry none of those identifiers either", () => {
    expect(ruleset?.body).not.toMatch(SELECTION);
    const migration = read("packages", "prowess-db", "prisma", "migrations", "20261004233000_add_ruleset_foundation", "migration.sql");
    expect(migration).not.toMatch(SELECTION);
    expect(migration).not.toMatch(/\b(entity_version|entity_versions)\b/);
  });
});

describe("M2-WO1 — reuse of existing vocabulary, no second grammar", () => {
  it("validates the canonical key with the project's one validator, and defines no key regex of its own", () => {
    const code = stripTs(read("packages", "prowess-model", "src", "ruleset.ts"));
    expect(code).toMatch(/import \{ isValidCanonicalKey \} from "\.\/canonical-key\.js"/);
    expect(code).toMatch(/isValidCanonicalKey\(input\.canonicalKey\)/);
    expect(code).not.toMatch(/RegExp|\/\^\[/);
  });

  it("RulesetStatus is its own vocabulary: it does not import or alias EntityVersionStatus", () => {
    const code = stripTs(read("packages", "prowess-model", "src", "ruleset-status.ts"));
    expect(code).not.toMatch(/EntityVersionStatus|ENTITY_VERSION_STATUSES/);
  });
});

describe("M2-WO1 — scope boundaries", () => {
  it("exposes exactly four Ruleset operations from @prowess/db — creation and reads, no mutation", () => {
    const exported = [...read("packages", "prowess-db", "src", "index.ts").matchAll(/export \{([^}]*)\} from "\.\/ruleset\/index\.js"/g)]
      .flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean))
      .sort();
    expect(exported).toEqual(["createRuleset", "findRulesetByCanonicalKey", "getRuleset", "listRulesets"]);
  });

  it("the migration creates only the Ruleset foundation: two enums, one table, one RESTRICT self-reference", () => {
    const sql = read("packages", "prowess-db", "prisma", "migrations", "20261004233000_add_ruleset_foundation", "migration.sql");
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["rulesets"]);
    expect([...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1]).sort()).toEqual(["RulesetChannel", "RulesetStatus"]);
    expect([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["rulesets"]);
    expect(sql).toMatch(/ON DELETE RESTRICT/);
    expect(sql).not.toMatch(/ON DELETE (CASCADE|SET NULL)|DROP /);
  });

  it("no Ruleset HTTP route or UI exists yet (those have their own Work Orders)", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = path.join(dir, entry);
        if (/ruleset/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
