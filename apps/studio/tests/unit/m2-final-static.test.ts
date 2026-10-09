// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2 FINAL static audit (PAS-10 M2-WO12): cross-cutting guarantees of the whole M2 system — no hidden "latest",
 * no current/active persistence, intact package boundaries, an untouched migration chain, a pinned public service
 * surface, no Rules Engine / keyword / authority / lifecycle "auto-winner" mechanics, server-only secrets, and an
 * index proving every transactional and concurrency guarantee has its regression test.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (dir: string, out: string[] = []) => {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === "generated" || e === "dist") continue;
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
};
const DB_SRC = walk(path.join(ROOT, "packages", "prowess-db", "src"));
const MODEL_SRC = walk(path.join(ROOT, "packages", "prowess-model", "src"));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const SCHEMA = read("packages", "prowess-db", "prisma", "schema.prisma").replace(/\/\/.*$/gm, "");
const M2_DB_DIRS = ["ruleset", "ruleset-manifest", "ruleset-inheritance", "canon-policy", "rule-conflict", "canon-decision", "change-set", "review-lifecycle", "ruleset-release", "migration-plan"];
const inDir = (f: string, dirs: string[]) => dirs.some((d) => rel(f).startsWith(`packages/prowess-db/src/${d}/`));

describe("§5 no hidden 'latest' selection", () => {
  it("every latest-style read is on the reviewed allowlist (convenience queries, M1 display, WO8 linear history)", () => {
    const calls: string[] = [];
    for (const f of DB_SRC) {
      for (const m of strip(readFileSync(f, "utf8")).matchAll(/\b((?:select|get)Latest\w*)\(/g)) {
        if (!new RegExp(`export (async )?function ${m[1]}\\b`).test(readFileSync(f, "utf8")) || !readFileSync(f, "utf8").includes(`function ${m[1]}(`)) calls.push(`${rel(f)} → ${m[1]}`);
      }
    }
    expect(calls.sort()).toEqual(
      [
        "packages/prowess-db/src/canon-policy/service.ts → selectLatestCanonPolicy", // inside getLatestCanonPolicy (convenience)
        "packages/prowess-db/src/entity-query/service.ts → selectLatestVersionsByEntityIds", // M1 Compendium "latest revision" display
        "packages/prowess-db/src/entity-query/service.ts → selectLatestVersionsByEntityIds",
        "packages/prowess-db/src/entity-version/service.ts → selectLatestEntityVersion", // M1 getLatestEntityVersion (convenience)
        "packages/prowess-db/src/ruleset-manifest/service.ts → selectLatestRulesetManifest", // inside getLatestRulesetManifest (convenience)
        "packages/prowess-db/src/ruleset-release/service.ts → selectLatestRelease", // WO8 §39 linear-history baseline (mandated)
        "packages/prowess-db/src/ruleset-release/service.ts → selectLatestRelease", // inside getLatestRulesetRelease (convenience)
      ].sort(),
    );
  });
  it("historical resolution, decisions, ChangeSets, impact, review and migration planning never call a latest-style read", () => {
    for (const f of DB_SRC.filter((x) => inDir(x, ["ruleset-inheritance", "rule-conflict", "canon-decision", "change-set", "review-lifecycle", "migration-plan"]))) {
      expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\b(get|select)Latest\w*\(|orderBy:\s*\{\s*\w+:\s*"desc"/);
    }
  });
  it("the Studio UI never auto-selects a 'latest' record (the client's latest helpers are unused convenience)", () => {
    for (const f of walk(path.join(ROOT, "apps", "studio", "app"))) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\bgetLatest(Manifest|Policy|Release)\(/);
  });
});

describe("§6 no current / active authority persistence", () => {
  it("no schema field is a current/active pointer or flag", () => {
    // Fields only (inside model bodies, name and type on ONE line) — enum VALUES such as SourceAuthorityStatus
    // CURRENT_SUPPLEMENTAL are approved vocabulary, not pointers.
    const bodies = [...SCHEMA.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)].map((m) => m[1] as string).join("\n");
    const fields = [...bodies.matchAll(/^[ \t]+(\w+)[ \t]+[A-Z]/gm)].map((m) => m[1] as string);
    expect(fields.filter((f) => /^(current|active|is_?current|is_?active)\w*$/i.test(f) || /^\w*(Current|Active)(Ruleset|Manifest|Policy|Release)\w*$/.test(f))).toEqual([]);
  });
  it("no model, service, API or UI source names a currentX / activeX authority", () => {
    const files = [...MODEL_SRC, ...DB_SRC, ...walk(path.join(ROOT, "apps", "studio", "app")), ...walk(path.join(ROOT, "apps", "studio", "src"))];
    // Comments are stripped: explanatory text saying such a pointer must NOT exist is permitted (WO12 §38).
    for (const f of files) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\b(current|active)(Ruleset|Manifest|Policy|Release)(Id)?\b|\bis(Current|Active)\b/);
  });
});

describe("§41–§43 package boundaries", () => {
  it("@prowess/model imports nothing framework- or persistence-specific", () => {
    const imports = (f: string) => [...strip(readFileSync(f, "utf8")).matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gm)].map((m) => m[1] as string);
    for (const f of MODEL_SRC) for (const i of imports(f)) expect(i, rel(f)).toMatch(/^\.\.?\//);
  });
  it("@prowess/db imports no React / Next / UI code", () => {
    for (const f of DB_SRC) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/from\s+"(react|react-dom|next(\/[\w-]+)?|@prowess\/ui)"/);
  });
  it("Studio pages, components and the client layer never import @prowess/db or Prisma", () => {
    for (const f of [...walk(path.join(ROOT, "apps", "studio", "app")).filter((x) => !rel(x).includes("/app/api/")), ...walk(path.join(ROOT, "apps", "studio", "src", "api-client"))]) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/from\s+"(@prowess\/db|@prisma\/[\w-]+|prisma)"/);
    }
  });
});

describe("§44–§45 migration chain", () => {
  it("every approved migration through M2-WO11 is byte-for-byte unchanged, and none were added, squashed or reordered", () => {
    const pins: Array<[string, string]> = [
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
    ];
    const dir = path.join(ROOT, "packages", "prowess-db", "prisma", "migrations");
    // WO12 added none. Later milestones append deliberately (each pinned by its own milestone audit): M3-WO1 adds
    // 20261011010000_add_source_structure (hash pinned in m3-source-structure-static.test.ts). Nothing is inserted
    // before, squashed into, or reordered among the M1/M2 migrations.
    const appendedAfterM2 = ["20261011010000_add_source_structure", "20261012010000_add_import_batches_candidates", "20261013010000_add_import_batch_extraction_output"];
    expect(readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory()).sort()).toEqual([...pins.map(([n]) => n), ...appendedAfterM2]);
    for (const [n, h] of pins) expect(createHash("sha256").update(readFileSync(path.join(dir, n, "migration.sql"))).digest("hex"), n).toBe(h);
  });
});

describe("§50 public service surface", () => {
  const root = read("packages", "prowess-db", "src", "index.ts");
  const names = new Set<string>();
  for (const m of root.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of (m[1] as string).split(",")) { const t = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop(); if (t) names.add(t); }
  it("every mutation in the public surface is an approved creation, named command, M1 assignment edit, or DRAFT-only edit", () => {
    const mutations = [...names].filter((n) => /^(create|update|set|apply|execute|upgrade|delete|remove|replace|publish|approve|reject|submit|transition|assign|propose)/.test(n)).sort();
    expect(mutations).toEqual(
      [
        "approveChangeSet", "approveRuleset", "assignKeywordToEntity", "assignKeywordToEntityVersion", "createCanonDecision", "createCanonPolicy", "createChangeSet",
        "createEntity", "createEntityAlias", "createImportBatch", "createEntityRelationship", "createEntityVersion", "createKeywordCategory", "createKeywordDefinition", "createMigrationPlan",
        "createRuleConflict", "createRuleset", "createRulesetManifest", "createSourceDocument", "createSourceReference", "createSourceSnapshot", "proposeChangeSetFromCanonDecision",
        "publishRulesetRelease", "rejectChangeSet", "removeEntityAlias", "removeEntityRelationship", "removeKeywordFromEntity", "removeKeywordFromEntityVersion",
        "removeSourceReference", "submitChangeSetForReview", "submitRulesetForReview", "transitionEntityVersionStatus", "updateDraftEntityVersion",
      ].sort(),
    );
  });
  it("no forbidden mutation API has leaked (§50)", () => {
    for (const n of names) expect(n).not.toMatch(/^(setStatus|set\w*Status|update(Manifest|Ruleset|Policy|Decision|Conflict|ChangeSet|Release|MigrationPlan)|apply\w*|execute\w*|upgrade\w*|delete\w*|replace\w*|edit\w*)$/);
  });
});

describe("§51–§54 no mechanics, no auto-winners", () => {
  const m2Files = [...DB_SRC.filter((f) => inDir(f, M2_DB_DIRS)), ...walk(path.join(ROOT, "apps", "studio", "app", "developer")), ...walk(path.join(ROOT, "apps", "studio", "src", "api-client"))];
  it("no game-mechanical calculation exists in M2 (§51)", () => {
    for (const f of m2Files) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\b(mpCost|apCost|damage\w*|savingThrow\w*|saveDc|concentration\w*|playerDice|characterStats?|weaponDamage|maneuverCapacity|calculate\w*|rulesEngine)\b/i);
  });
  it("keywords never drive selection, authority, decisions, publication or migration — only impact reporting reads them (§52)", () => {
    for (const f of DB_SRC.filter((x) => inDir(x, M2_DB_DIRS.filter((d) => d !== "change-set")))) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/keyword/i);
  });
  it("conflict and decision code never auto-selects by source authority or lifecycle status (§53, §54)", () => {
    for (const f of DB_SRC.filter((x) => inDir(x, ["rule-conflict", "canon-decision", "ruleset-manifest", "ruleset-inheritance"]))) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\b(GOVERNING|CURRENT_PRIMARY|resolveSourceAuthority|resolveAuthorityFromDeclarations)\b/);
      expect(src, rel(f)).not.toMatch(/status\s*===?\s*"(CANON|APPROVED|PLAYTEST)"/);
    }
  });
});

describe("§62 security sanity", () => {
  it("client components never read process.env, DEVELOPMENT_MODE or a database URL", () => {
    for (const f of [...walk(path.join(ROOT, "apps", "studio", "app")), ...walk(path.join(ROOT, "apps", "studio", "src", "api-client"))]) {
      const src = readFileSync(f, "utf8");
      if (!/^\s*["']use client["']/m.test(src)) continue;
      expect(src, rel(f)).not.toMatch(/process\.env|DEVELOPMENT_MODE|DATABASE_URL|postgres(ql)?:\/\//);
    }
  });
  it("the destructive test reset stays guarded", () => {
    expect(read("packages", "prowess-db", "src", "testDatabaseGuard.ts")).toMatch(/assertSafeToResetTestDatabase/);
  });
});

describe("§25–§26 audit index: every transactional and concurrency guarantee has a regression test", () => {
  const T = (...p: string[]) => read("packages", "prowess-db", "tests", "integration", ...p);
  it.each([
    ["Manifest creation rollback", "ruleset-manifest.test.ts", /rollback|atomic|nothing persists|partial/i],
    ["CanonPolicy creation rollback", "canon-policy.test.ts", /rollback|atomic|nothing persists|partial/i],
    ["RuleConflict creation rollback", "rule-conflict.test.ts", /rollback|atomic|nothing persists|partial/i],
    ["CanonDecision creation rollback", "canon-decision.test.ts", /rollback|atomic|nothing persists|partial/i],
    ["ChangeSet creation rollback", "change-set.test.ts", /rollback|atomic|nothing persists|partial/i],
    ["Publication rollback", "ruleset-release.test.ts", /rolls ALL of it back/],
    ["MigrationPlan rollback", "migration-plan.test.ts", /late failure during creation leaves no plan/],
    ["Manifest version concurrency", "ruleset-manifest.test.ts", /concurren/i],
    ["Policy version concurrency", "canon-policy.test.ts", /concurren/i],
    ["Decision race", "canon-decision.test.ts", /concurren|race/i],
    ["ChangeSet terminal transition race", "ruleset-release.test.ts", /concurrent approve\/reject/],
    ["First publication race", "ruleset-release.test.ts", /concurrent first publications/],
    ["Final audit concurrency", "m2-final-audit.test.ts", /§26 concurrency/],
  ])("%s", (_name, file, pattern) => {
    expect(T(file as string)).toMatch(pattern as RegExp);
  });
});
