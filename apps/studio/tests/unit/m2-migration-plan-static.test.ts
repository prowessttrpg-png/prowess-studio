// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO11 static audit — migration PLANNING never becomes execution: planning code writes only its own two tables,
 * never mutates a Release / manifest / Version / lifecycle, never selects anything "latest", never publishes, never
 * calls a Rules Engine, and exposes no apply / execute / upgrade operation. No premature creation tables exist.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SCHEMA = read("packages", "prowess-db", "prisma", "schema.prisma").replace(/\/\/.*$/gm, "");
const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1] as string, body: m[2] as string }));
const find = (n: string) => models.find((m) => m.name === n);
const fields = (b: string | undefined) => [...(b ?? "").matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]).sort();
const DB = ["repository.ts", "service.ts", "index.ts"].map((f) => path.join("packages", "prowess-db", "src", "migration-plan", f));
const MODEL = path.join("packages", "prowess-model", "src", "migration-plan.ts");
const sha = (...p: string[]) => createHash("sha256").update(readFileSync(path.join(ROOT, ...p))).digest("hex");

describe("M2-WO11 — migration plans are immutable historical assessments", () => {
  it("MigrationPlan / MigrationPlanItem have exactly their specified fields; no applied/current/active/complete/updated field", () => {
    expect(fields(find("MigrationPlan")?.body)).toEqual(["createdAt", "description", "id", "items", "name", "sourceManifestHash", "sourceRelease", "sourceReleaseId", "targetManifestHash", "targetRelease", "targetReleaseId"].sort());
    expect(fields(find("MigrationPlanItem")?.body)).toEqual(
      ["changeType", "compatibilityClassification", "createdAt", "entity", "entityId", "id", "migrationPlan", "migrationPlanId", "sourceEntityVersion", "sourceEntityVersionId", "targetEntityVersion", "targetEntityVersionId"].sort(),
    );
    for (const n of ["MigrationPlan", "MigrationPlanItem"]) expect(find(n)?.body, n).not.toMatch(/updatedAt|\b(applied\w*|current\w*|active\w*|automatically\w*|complete\w*|executed\w*|status)\b/i);
  });
  it("Version references are composite (Version must belong to the item's Entity); every relation is RESTRICT; one item per Entity", () => {
    const item = find("MigrationPlanItem")?.body ?? "";
    expect(item).toMatch(/sourceEntityVersion\s+EntityVersion\?\s+@relation\("MigrationItemSourceVersion",\s*fields:\s*\[sourceEntityVersionId,\s*entityId\],\s*references:\s*\[id,\s*entityId\]/);
    expect(item).toMatch(/targetEntityVersion\s+EntityVersion\?\s+@relation\("MigrationItemTargetVersion",\s*fields:\s*\[targetEntityVersionId,\s*entityId\],\s*references:\s*\[id,\s*entityId\]/);
    expect(item).toMatch(/@@unique\(\[migrationPlanId,\s*entityId\]/);
    for (const n of ["MigrationPlan", "MigrationPlanItem"]) for (const r of [...(find(n)?.body ?? "").matchAll(/@relation\(([^)]*)\)/g)].map((m) => m[1] as string)) expect(r, n).toMatch(/onDelete:\s*Restrict/);
  });
  it("no premature saved-creation model exists (§18)", () => {
    expect(models.map((m) => m.name).filter((n) => /spell|character|card|campaign|summon|maneuver|creation/i.test(n))).toEqual([]);
  });
});

describe("M2-WO11 — planning code never executes, mutates or infers (§24, §36, §37)", () => {
  it("the repository writes ONLY its own two tables, by create", () => {
    const repo = strip(read(...(DB[0]!.split(path.sep) as [string])));
    expect([...repo.matchAll(/\b(?:tx|prisma)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => `${m[1]}.${m[2]}`).sort()).toEqual(["migrationPlan.create", "migrationPlanItem.create"]);
    expect(repo).not.toMatch(/\$executeRaw|\$queryRaw|rulesetRelease|rulesetManifest|entityVersion\./);
  });
  it("service and model call no write path, no publication, no lifecycle, no latest-selection, no Rules Engine, no second hash", () => {
    const FORBIDDEN = /\b(publishRulesetRelease|executePublication|createRulesetManifest|transitionEntityVersionStatus\w*|updateDraftEntityVersion|getLatest\w*|selectLatest\w*|createHash|sha256|computeManifestHash|canonicalManifestText|getEffectiveManifestEntries|resolveEffectiveEntityVersion|calculate\w*|evaluate\w*|rulesEngine|applyMigration\w*|executeMigration\w*|upgrade\w*|migrateCharacter|migrateSpell)\b|\.(update|updateMany|upsert|delete|deleteMany)\(/;
    for (const c of ["getLatestRulesetRelease(r)", "tx.rulesetRelease.update({})", "computeManifestHash(p)", "applyMigrationPlan(x)"]) expect(c).toMatch(FORBIDDEN);
    for (const f of [DB[1]!, DB[2]!, MODEL]) expect(strip(read(...(f.split(path.sep) as [string]))), f).not.toMatch(FORBIDDEN);
  });
  it("the service reuses the WO8 release services for composition and hash verification (single authority)", () => {
    const svc = strip(read(...(DB[1]!.split(path.sep) as [string])));
    expect(svc).toMatch(/import \{ getRulesetRelease, verifyRulesetReleaseManifestHash \} from "\.\.\/ruleset-release\/service\.js"/);
    expect([...svc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["../ruleset-release/service.js", "./repository.js", "@prowess/model"]);
  });
  it("the public surface is exactly preview, create, get and list — no apply / execute / upgrade / update / delete", () => {
    const root = read("packages", "prowess-db", "src", "index.ts");
    expect(root).toMatch(/export \{ createMigrationPlan, getMigrationPlan, listMigrationPlans, previewRulesetMigration \} from "\.\/migration-plan\/index\.js";/);
    expect(root).not.toMatch(/\b(apply|execute|upgrade|update|delete|replace)\w*Migration\w*|migrate(Character|Spell|Creation)/i);
  });
  it("compatibility is never overstated: the model assigns only UNCHANGED or REVIEW_REQUIRED", () => {
    const model = strip(read(...(MODEL.split(path.sep) as [string])));
    const body = /export function compatibilityFor[\s\S]*?\n\}/.exec(model)?.[0] ?? "";
    expect(body).toMatch(/"UNCHANGED" \? "UNCHANGED" : "REVIEW_REQUIRED"/);
    expect(body).not.toMatch(/RECALCULATE_ONLY|VALID_WITH_CHANGES|INVALID|UNSUPPORTED/);
  });
});

describe("M2-WO11 — scope", () => {
  it("the migration only creates the two plan tables and two enums; no existing table is altered", () => {
    const sql = read("packages", "prowess-db", "prisma", "migrations", "20261010010000_add_migration_plans", "migration.sql");
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["migration_plans", "migration_plan_items"]);
    expect([...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["MigrationChangeType", "MigrationCompatibilityClassification"]);
    expect([...new Set([...sql.matchAll(/(?:ALTER TABLE|ON) "(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(["migration_plan_items", "migration_plans"]);
    expect(sql).not.toMatch(/DROP |ALTER COLUMN|ADD COLUMN|CREATE TRIGGER|ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/);
  });
  it("approved M2-WO1 … WO8 migrations are unchanged", () => {
    const base = ["packages", "prowess-db", "prisma", "migrations"];
    const pins: Array<[string, string]> = [
      ["20261004233000_add_ruleset_foundation", "a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6"],
      ["20261005001500_add_ruleset_manifest", "31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c"],
      ["20261005120000_add_manifest_inheritance", "5fb2a0707fcffe93357b5e489af594db51ec2aabc0082893cd53230debbe4ea0"],
      ["20261005220000_add_canon_policy", "82d4a44f2caa1bb3f3ac88aaac2bdf18e95448787e32372a45a38398a919fc3c"],
      ["20261006010000_add_rule_conflicts", "5befce6a128a2e730998dad6ccef68484b06282060f5a354c7ad93b204cb8cad"],
      ["20261007010000_add_canon_decisions", "62ed605803a83093c91462ff18d4379016f3815a52d2143734c58017c08c6d7e"],
      ["20261009010000_add_ruleset_releases", "813c659816bd767a99e5f39626dde3c0f4d817cc92276886b9a63e43535ab0f7"],
    ];
    for (const [n, h] of pins) expect(sha(...base, n, "migration.sql"), n).toBe(h);
  });
  it("no migration HTTP route or UI is added (WO11 is the service/persistence foundation)", () => {
    const found: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        if (e === "node_modules" || e === ".next") continue;
        const f = path.join(d, e);
        if (/migrat/i.test(e)) found.push(path.relative(ROOT, f));
        if (statSync(f).isDirectory()) walk(f);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
