// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";

/**
 * M2-WO7 static audit — a ChangeSet PROPOSES; it never applies. ChangeSet and impact code may write
 * only its own two tables; impact analysis may only read; nothing may apply, execute, edit or delete a
 * ChangeSet; nothing infers "latest"; no impact state is persisted; approved migrations stay untouched.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripPrisma = (s: string) => s.replace(/\/\/.*$/gm, "");
const sha256 = (...p: string[]) => createHash("sha256").update(readFileSync(path.join(ROOT, ...p))).digest("hex");
const squash = (l: string) => l.trim().replace(/\s+/g, " ");

const SCHEMA = stripPrisma(read("packages", "prowess-db", "prisma", "schema.prisma"));
const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1] as string, body: m[2] as string }));
const find = (name: string) => models.find((m) => m.name === name);
const fieldNames = (body: string | undefined) => [...(body ?? "").matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]).sort();
const enumValues = (name: string) =>
  (new RegExp(`^enum ${name} \\{([^}]*)\\}`, "m").exec(SCHEMA)?.[1] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

const dir = path.join(ROOT, "packages", "prowess-db", "src", "change-set");
const dbSources = ["repository.ts", "service.ts", "impact.ts", "index.ts"].map((f) => path.join(dir, f));
const modelSources = ["change-set.ts", "change-set-status.ts", "change-set-operation-type.ts", "change-set-translation.ts", "change-set-impact.ts"].map((f) =>
  path.join(ROOT, "packages", "prowess-model", "src", f),
);
const MIGRATION = ["packages", "prowess-db", "prisma", "migrations", "20261008010000_add_change_sets", "migration.sql"] as const;

describe("M2-WO7 — the ChangeSet models are immutable, exactly-referenced proposals", () => {
  it("finds both models, both enums, every source and the migration", () => {
    expect(find("ChangeSet")).toBeDefined();
    expect(find("ChangeSetOperation")).toBeDefined();
    for (const file of [...dbSources, ...modelSources]) expect(existsSync(file), file).toBe(true);
    expect(existsSync(path.join(ROOT, ...MIGRATION))).toBe(true);
  });

  it("ChangeSet and ChangeSetOperation have exactly their specified fields (+ documented sequence / redundant rulesetId) and no updatedAt (§2, §6)", () => {
    expect(fieldNames(find("ChangeSet")?.body)).toEqual(
      // M2-WO8 added only the releases back-relation list (a release applies at most one ChangeSet).
      ["canonDecision", "canonDecisionId", "createdAt", "description", "id", "name", "operations", "releases", "ruleset", "rulesetId", "status"].sort(),
    );
    expect(fieldNames(find("ChangeSetOperation")?.body)).toEqual(
      [
        "changeSet",
        "changeSetId",
        "createdAt",
        "description",
        "fromEntityVersion",
        "fromEntityVersionId",
        "id",
        "operationType",
        "rulesetId",
        "sequence",
        "targetEntity",
        "targetEntityId",
        "targetManifest",
        "targetManifestId",
        "toEntityVersion",
        "toEntityVersionId",
      ].sort(),
    );
    for (const name of ["ChangeSet", "ChangeSetOperation"]) {
      expect(find(name)?.body, name).not.toMatch(/updatedAt|\bBoolean\b|\bJson\b/);
      // M2-WO8's only permitted mention is the back-relation list `releases RulesetRelease[]` on ChangeSet.
      const body = (find(name)?.body ?? "").replace(/^\s*releases\s+RulesetRelease\[\]\s*$/m, "");
      expect(body, name).not.toMatch(/\b(applied\w*|executed\w*|published\w*|release\w*|latest\w*|current\w*|active\w*|patch\w*|script\w*)\b/i);
    }
  });

  it("every relation is RESTRICT and composite exactly as designed (§4, §10, §44)", () => {
    const cs = find("ChangeSet")?.body ?? "";
    const op = find("ChangeSetOperation")?.body ?? "";
    expect(cs).toMatch(/canonDecision\s+CanonDecision\?\s+@relation\(fields:\s*\[canonDecisionId,\s*rulesetId\],\s*references:\s*\[id,\s*rulesetId\]/);
    expect(op).toMatch(/changeSet\s+ChangeSet\s+@relation\(fields:\s*\[changeSetId,\s*rulesetId\],\s*references:\s*\[id,\s*rulesetId\]/);
    expect(op).toMatch(/targetManifest\s+RulesetManifest\?\s+@relation\(fields:\s*\[targetManifestId,\s*rulesetId\],\s*references:\s*\[id,\s*rulesetId\]/);
    expect(op).toMatch(/fromEntityVersion\s+EntityVersion\?\s+@relation\("ChangeSetOperationFrom",\s*fields:\s*\[fromEntityVersionId,\s*targetEntityId\],\s*references:\s*\[id,\s*entityId\]/);
    expect(op).toMatch(/toEntityVersion\s+EntityVersion\?\s+@relation\("ChangeSetOperationTo",\s*fields:\s*\[toEntityVersionId,\s*targetEntityId\],\s*references:\s*\[id,\s*entityId\]/);
    for (const [name, body] of [["ChangeSet", cs], ["ChangeSetOperation", op]] as const) {
      const relations = [...body.matchAll(/@relation\(([^)]*)\)/g)].map((m) => m[1] as string);
      expect(relations.length, name).toBeGreaterThanOrEqual(2);
      for (const r of relations) expect(r, `${name}: ${r}`).toMatch(/onDelete:\s*Restrict/);
    }
    expect(find("CanonDecision")?.body).toMatch(/@@unique\(\[id,\s*rulesetId\]/);
    expect(find("RulesetManifest")?.body).toMatch(/@@unique\(\[id,\s*rulesetId\]/);
  });

  it("other models gained back-relation LISTS only (§43)", () => {
    const expected: Record<string, string[]> = {
      Ruleset: ["changeSets ChangeSet[]"],
      CanonDecision: ["changeSets ChangeSet[]"],
      Entity: ["changeSetOperations ChangeSetOperation[]"],
      RulesetManifest: ["changeSetOperations ChangeSetOperation[]"],
      EntityVersion: [
        'changeSetOperationsFrom ChangeSetOperation[] @relation("ChangeSetOperationFrom")',
        'changeSetOperationsTo ChangeSetOperation[] @relation("ChangeSetOperationTo")',
      ],
    };
    // M2-WO8's RulesetRelease cites an applied ChangeSet by design (composite key); it has its own audit.
    for (const m of models.filter((x) => !["ChangeSet", "ChangeSetOperation", "RulesetRelease"].includes(x.name))) {
      expect(m.body.split("\n").filter((l) => /changeset/i.test(l)).map(squash), m.name).toEqual(expected[m.name] ?? []);
    }
  });

  it("enums match the domain vocabularies; the matrix covers every operation type (§3, §7, §8, §72)", () => {
    expect(enumValues("ChangeSetStatus")).toEqual([...model.CHANGE_SET_STATUSES]);
    expect(enumValues("ChangeSetOperationType")).toEqual([...model.CHANGE_SET_OPERATION_TYPES]);
    expect(Object.keys(model.CHANGE_SET_OPERATION_RULES).sort()).toEqual([...model.CHANGE_SET_OPERATION_TYPES].sort());
    expect(find("ChangeSet")?.body).toMatch(/status\s+ChangeSetStatus\s+@default\(DRAFT\)/);
  });

  it("nothing out of scope exists: no application, rollback or impact-persistence model (§46; RulesetRelease arrived in M2-WO8)", () => {
    expect(models.map((m) => m.name).filter((n) => /applic|applied|rollback|impact|dependency|snapshot|cache/i.test(n))).toEqual([]);
  });
});

describe("M2-WO7 — ChangeSet code proposes and reads; it never applies (§1, §64, §71, §74)", () => {
  it("the repository WRITES only its own two tables, only by create; every other call is a read", () => {
    const repo = stripTs(read("packages", "prowess-db", "src", "change-set", "repository.ts"));
    const writes = [...repo.matchAll(/\b(?:tx|prisma)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(writes.sort()).toEqual(["changeSet.create", "changeSetOperation.create"]);
    expect(repo).not.toMatch(/\$executeRaw|\$queryRaw/);
    expect(repo).toMatch(/status:\s*INITIAL_CHANGE_SET_STATUS/);
    expect(repo).toMatch(/data:\s*\{\s*changeSetId,\s*rulesetId,\s*sequence:\s*index \+ 1,\s*\.\.\.operation\s*\}/);
  });

  it("service, impact and model code call no write path of any other domain, and never the Rules Engine (§74, §35)", () => {
    const FORBIDDEN =
      /\b(create(?!ChangeSet\b)(Entity|EntityVersion|RulesetManifest|CanonDecision|CanonPolicy|RuleConflict|Ruleset|SourceReference|SourceDocument|EntityRelationship|Keyword)\w*|transitionEntityVersionStatus|updateDraftEntityVersion|transitionRuleConflictToDisposition|insert(?!ChangeSet)\w+|assignKeyword\w*|calculate\w*|evaluate\w*|rulesEngine|applyChangeSet|executeChangeSet)\b|\.(update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw/;
    for (const control of ["await tx.rulesetManifest.update({ where: {} })", "x.entityVersion.deleteMany({})", "transitionEntityVersionStatus(id)", "applyChangeSet(id)"]) {
      expect(control, control).toMatch(FORBIDDEN);
    }
    for (const file of [...dbSources.filter((f) => !f.endsWith("repository.ts")), ...modelSources]) {
      expect(stripTs(readFileSync(file, "utf8")), path.relative(ROOT, file)).not.toMatch(FORBIDDEN);
    }
  });

  it("nothing infers a latest / current / highest Version (§9)", () => {
    for (const file of [...dbSources, ...modelSources]) {
      const code = stripTs(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/latest|getLatest|selectLatest|revisionNumber:\s*"desc"|MAX\s*\(/i);
      expect(code, file).not.toMatch(/"CANON"/);
    }
  });

  it("db ChangeSet code imports only exact-id lookups, effective resolution of one exact manifest, and the model", () => {
    const allowed = new Set([
      "@prowess/model",
      "../client.js",
      "../canon-decision/repository.js",
      "../entity/repository.js",
      "../entity-version/repository.js",
      "../rule-conflict/repository.js",
      "../ruleset-inheritance/resolution.js",
      "../ruleset/repository.js",
      "../../generated/prisma/client.js",
      "./repository.js",
      "./service.js",
      "./impact.js",
    ]);
    for (const file of dbSources) {
      for (const match of stripTs(readFileSync(file, "utf8")).matchAll(/from\s+"([^"]+)"/g)) {
        expect(allowed.has(match[1] as string), `${path.basename(file)} imports ${match[1]}`).toBe(true);
      }
    }
    // From other domains' repositories, only exact-id lookups are used.
    const service = stripTs(read("packages", "prowess-db", "src", "change-set", "service.ts"));
    expect(service).toMatch(/import \{ selectCanonDecisionWithSelections \} from "\.\.\/canon-decision\/repository\.js"/);
    expect(service).toMatch(/import \{ resolveEffectiveEntityVersion \} from "\.\.\/ruleset-inheritance\/resolution\.js"/);
  });

  it("impact analysis is read-only and walks relationships exactly one hop (§22, §34)", () => {
    const impact = stripTs(read("packages", "prowess-db", "src", "change-set", "impact.ts"));
    expect(impact).not.toMatch(/\bcreate\w*\(|\binsert\w*\(|\.(update|updateMany|upsert|delete|deleteMany)\(|prisma\b/);
    expect([...impact.matchAll(/selectImpactRelationships\(/g)]).toHaveLength(1);
    const repo = stripTs(read("packages", "prowess-db", "src", "change-set", "repository.ts"));
    const relFn = /export async function selectImpactRelationships[\s\S]*?\n\}/.exec(repo)?.[0] ?? "";
    expect(relFn).toMatch(/OR:\s*\[\{\s*sourceEntityId:\s*entityId\s*\},\s*\{\s*targetEntityId:\s*entityId\s*\}\]/);
    const body = relFn.slice(relFn.indexOf("return"));
    expect(body.length).toBeGreaterThan(20);
    expect(body).not.toMatch(/for\s*\(|while\s*\(|selectImpactRelationships\(/); // no recursion, no loop
  });

  it("exposes exactly five ChangeSet operations; no apply / execute / edit / transition (§40, §71)", () => {
    const names = ["analyzeChangeSetImpact", "createChangeSet", "getChangeSet", "listChangeSets", "proposeChangeSetFromCanonDecision"];
    const exportsOf = (text: string) =>
      [...text.matchAll(/export \{([^}]*)\} from "\.\/change-set\/index\.js"/g)].flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean)).sort();
    expect(exportsOf(read("packages", "prowess-db", "src", "index.ts"))).toEqual(names);
    expect(read("packages", "prowess-db", "src", "index.ts")).not.toMatch(/applyChangeSet|executeChangeSet|insertChangeSet|mapChangeSetWriteError/);
  });
});

describe("M2-WO7 — scope boundaries", () => {
  it("the migration adds only the two ChangeSet tables, two enums, their keys/indexes, and two PK-led composite-key targets (§45, §46)", () => {
    const sql = read(...MIGRATION);
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["change_sets", "change_set_operations"]);
    expect([...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["ChangeSetStatus", "ChangeSetOperationType"]);
    expect(sql).not.toMatch(/DROP |ALTER COLUMN|ADD COLUMN|ALTER TYPE|CREATE TRIGGER|CREATE FUNCTION|ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)|impact|cache|snapshot/i);
    expect([...new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(["change_set_operations", "change_sets"]);
    const onExisting = [...sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "(\w+)"\(([^)]*)\)/g)]
      .filter((m) => !(m[3] as string).startsWith("change_set"))
      .map((m) => [m[2], m[3], m[1] ? "unique" : "index", m[4]]);
    expect(onExisting).toEqual([
      ["canon_decisions_id_ruleset_id_key", "canon_decisions", "unique", '"id", "ruleset_id"'],
      ["ruleset_manifests_id_ruleset_id_key", "ruleset_manifests", "unique", '"id", "ruleset_id"'],
    ]);
    expect([...sql.matchAll(/FOREIGN KEY/g)]).toHaveLength(7);
    expect([...sql.matchAll(/ON DELETE RESTRICT/g)]).toHaveLength(7);
    for (const name of [...sql.matchAll(/(?:CONSTRAINT|INDEX) "(\w+)"/g)].map((m) => m[1] as string)) expect(name.length, name).toBeLessThanOrEqual(63);
  });

  it("the approved M2-WO1 … M2-WO6 migrations are byte-for-byte unchanged", () => {
    const base = ["packages", "prowess-db", "prisma", "migrations"];
    expect(sha256(...base, "20261004233000_add_ruleset_foundation", "migration.sql")).toBe("a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6");
    expect(sha256(...base, "20261005001500_add_ruleset_manifest", "migration.sql")).toBe("31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c");
    expect(sha256(...base, "20261005120000_add_manifest_inheritance", "migration.sql")).toBe("5fb2a0707fcffe93357b5e489af594db51ec2aabc0082893cd53230debbe4ea0");
    expect(sha256(...base, "20261005220000_add_canon_policy", "migration.sql")).toBe("82d4a44f2caa1bb3f3ac88aaac2bdf18e95448787e32372a45a38398a919fc3c");
    expect(sha256(...base, "20261006010000_add_rule_conflicts", "migration.sql")).toBe("5befce6a128a2e730998dad6ccef68484b06282060f5a354c7ad93b204cb8cad");
    expect(sha256(...base, "20261007010000_add_canon_decisions", "migration.sql")).toBe("62ed605803a83093c91462ff18d4379016f3815a52d2143734c58017c08c6d7e");
  });

  it("no ChangeSet / impact UI exists outside the M2-WO10 governance workspace (M2-WO9 / M2-WO10) (§76, §77) — the HTTP API arrived in M2-WO9 (pinned by m2-api-static)", () => {
    const found: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        if (entry === "node_modules" || entry === ".next") continue;
        // M2-WO9: the HTTP API now exists; its exact route inventory is pinned by m2-api-static. UI is still WO10's.
        if (path.join(d, entry) === path.join(ROOT, "apps", "studio", "app", "api")) continue;
        // M2-WO10: the Ruleset & Canon governance UI now exists; its boundaries are pinned by m2-ui-static.
        if (path.join(d, entry) === path.join(ROOT, "apps", "studio", "app", "developer", "rulesets")) continue;
        const full = path.join(d, entry);
        if (/change|impact|decision|conflict|canon/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
