// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO8 static audit — publication creates NEW immutable state. A RulesetRelease is born published (no
 * mutable field, no current/active pointer); publishing code writes ONLY the new manifest + entries, the
 * new release, the controlled Ruleset/ChangeSet status transitions and an approved DEPRECATE through the
 * M1 lifecycle; review transitions are expected-state conditional updates; approved migrations are untouched.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SCHEMA = read("packages", "prowess-db", "prisma", "schema.prisma").replace(/\/\/.*$/gm, "");
const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1] as string, body: m[2] as string }));
const find = (name: string) => models.find((m) => m.name === name);
const fieldNames = (body: string | undefined) => [...(body ?? "").matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]).sort();
const sha256 = (...p: string[]) => createHash("sha256").update(readFileSync(path.join(ROOT, ...p))).digest("hex");
const src = (...p: string[]) => stripTs(read("packages", "prowess-db", "src", ...p));
const MIGRATION = ["packages", "prowess-db", "prisma", "migrations", "20261009010000_add_ruleset_releases", "migration.sql"] as const;
const writesIn = (code: string) => [...code.matchAll(/\b(?:tx|prisma|client)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => `${m[1]}.${m[2]}`);

describe("M2-WO8 — RulesetRelease is born published and pins exactly", () => {
  it("has exactly its specified fields; no updatedAt, mutable status, draft, current or active field (§2, §57)", () => {
    expect(fieldNames(find("RulesetRelease")?.body)).toEqual(
      ["canonPolicy", "canonPolicyId", "changeSet", "changeSetId", "channel", "id", "manifest", "manifestHash", "manifestId", "publishedAt", "releaseNotes", "releaseNumber", "ruleset", "rulesetId", "versionLabel"].sort(),
    );
    expect(find("RulesetRelease")?.body).not.toMatch(/updatedAt|\bstatus\b|\bdraft\w*|\bcurrent\w*|\bactive\w*|isCurrent|isActive|\bBoolean\b/i);
    expect(find("RulesetRelease")?.body).toMatch(/channel\s+RulesetChannel\b/); // the existing enum — no second channel vocabulary (§5, §91)
    expect([...SCHEMA.matchAll(/^enum (\w+)/gm)].map((m) => m[1]).filter((n) => /release|publish/i.test(n ?? ""))).toEqual([]);
  });

  it("pins manifest, policy and ChangeSet through same-Ruleset composite keys, all RESTRICT (§8, §54, §55)", () => {
    const body = find("RulesetRelease")?.body ?? "";
    for (const [field, scalar] of [["manifest", "manifestId"], ["canonPolicy", "canonPolicyId"], ["changeSet", "changeSetId"]] as const) {
      expect(body).toMatch(new RegExp(`${field}\\s+\\w+\\??\\s+@relation\\(fields:\\s*\\[${scalar},\\s*rulesetId\\],\\s*references:\\s*\\[id,\\s*rulesetId\\]`));
    }
    for (const r of [...body.matchAll(/@relation\(([^)]*)\)/g)].map((m) => m[1] as string)) expect(r).toMatch(/onDelete:\s*Restrict/);
    expect(body).toMatch(/@@unique\(\[rulesetId,\s*releaseNumber\]/);
    expect(body).toMatch(/@@unique\(\[rulesetId,\s*versionLabel\]/);
    expect(body).toMatch(/@@unique\(\[changeSetId\]/);
  });

  it("no model holds a current / active / published release or manifest pointer (§40, §58)", () => {
    for (const m of models) expect(m.body, m.name).not.toMatch(/\b(currentRelease\w*|activeRelease\w*|publishedManifest\w*|latestRelease\w*|currentManifest\w*)\b/);
    const expected: Record<string, string> = { Ruleset: "releases RulesetRelease[]", RulesetManifest: "releases RulesetRelease[]", CanonPolicy: "releases RulesetRelease[]", ChangeSet: "releases RulesetRelease[]" };
    for (const m of models.filter((x) => x.name !== "RulesetRelease")) {
      const lines = m.body.split("\n").filter((l) => /RulesetRelease/.test(l)).map((l) => l.trim().replace(/\s+/g, " "));
      expect(lines, m.name).toEqual(expected[m.name] === undefined ? [] : [expected[m.name]]);
    }
  });
});

describe("M2-WO8 — publishing writes only what the WO permits (§1, §10–§17, §90)", () => {
  it("the publication repository writes exactly: Ruleset APPROVED->PUBLISHED (conditional) and the release; the manifest goes through the M2-WO2 allocator body", () => {
    const repo = src("ruleset-release", "repository.ts");
    expect(writesIn(repo).sort()).toEqual(["ruleset.updateMany", "rulesetRelease.create"]);
    expect(repo).toMatch(/tx\.ruleset\.updateMany\(\{\s*where:\s*\{\s*id:\s*plan\.rulesetId,\s*status:\s*"APPROVED"\s*\},\s*data:\s*\{\s*status:\s*"PUBLISHED"\s*\}\s*\}\)/);
    expect(repo).toMatch(/insertManifestSnapshotInTransaction\(tx,\s*plan\.rulesetId,\s*plan\.pins,\s*null\)/); // flattened: parent null
    expect(repo).toMatch(/transitionEntityVersionStatusInTransaction\(tx,\s*versionId,\s*"DEPRECATED"\)/); // the M1 lifecycle, on THIS transaction
    expect(repo).toMatch(/FOR UPDATE/);
    expect(repo).not.toMatch(/\$executeRaw/);
  });

  it("the service, hash and review code reach no other write path, never the Rules Engine, and never infer 'latest' beyond release_number", () => {
    const FORBIDDEN = /\b(canonPolicy|canonDecision|ruleConflict|sourceAuthorityRecord|sourceReference|entityRelationship|entityKeyword|entityVersionKeyword|entity)\.(create|update|updateMany|upsert|delete|deleteMany)\(|\b(createCanonPolicy|createCanonDecision|createRuleConflict|createEntityVersion|updateDraftEntityVersion|assignKeyword\w*|createEntityRelationship|calculate\w*|evaluate\w*|rulesEngine|selectLatestRulesetManifest|getLatestRulesetManifest|selectLatestEntityVersion|getLatestCanonPolicy)\b/;
    for (const c of ["tx.canonPolicy.update({})", "prisma.entity.delete({})", "createEntityVersion(x)", "selectLatestRulesetManifest(r)"]) expect(c).toMatch(FORBIDDEN);
    for (const file of [["ruleset-release", "service.ts"], ["ruleset-release", "hash.ts"], ["ruleset-release", "repository.ts"], ["review-lifecycle", "service.ts"], ["review-lifecycle", "repository.ts"]] as const) {
      expect(src(...file), file.join("/")).not.toMatch(FORBIDDEN);
    }
    expect(src("ruleset-release", "service.ts")).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
  });

  it("review transitions are expected-state conditional updates of status only; there is no generic setter (§10, §13, §14)", () => {
    const repo = src("review-lifecycle", "repository.ts");
    expect(writesIn(repo).sort()).toEqual(["changeSet.updateMany", "ruleset.updateMany"]);
    expect([...repo.matchAll(/updateMany\(\{\s*where:\s*\{\s*id,\s*status:\s*from\s*\},\s*data:\s*\{\s*status:\s*to\s*\}\s*\}\)/g)]).toHaveLength(2);
    const root = read("packages", "prowess-db", "src", "index.ts");
    expect(root).not.toMatch(/\b(setChangeSetStatus|setRulesetStatus|transitionChangeSetStatus\w*|transitionRulesetStatus\w*|publishRuleset\b|deleteRulesetRelease|updateRulesetRelease|executePublication|transitionEntityVersionStatusInTransaction|insertManifestSnapshotInTransaction)\b/);
  });

  it("exposes exactly the WO8 surface (§89)", () => {
    const root = read("packages", "prowess-db", "src", "index.ts");
    const exportsFrom = (mod: string) =>
      [...root.matchAll(new RegExp(`export \\{([^}]*)\\} from "\\./${mod}/index\\.js"`, "g"))].flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean)).sort();
    expect(exportsFrom("review-lifecycle")).toEqual(["approveChangeSet", "approveRuleset", "rejectChangeSet", "submitChangeSetForReview", "submitRulesetForReview"]);
    expect(exportsFrom("ruleset-release")).toEqual(["compareRulesetReleases", "getLatestRulesetRelease", "getRulesetRelease", "listRulesetReleases", "publishRulesetRelease", "verifyRulesetReleaseManifestHash"]);
  });

  it("the hash module is pure: node:crypto + the model's canonical text only", () => {
    const hash = src("ruleset-release", "hash.ts");
    expect([...hash.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["@prowess/model", "node:crypto"]);
    expect(hash).toMatch(/createHash\("sha256"\)\.update\(canonicalManifestText\(pins\), "utf8"\)\.digest\("hex"\)/);
  });
});

describe("M2-WO8 — scope boundaries", () => {
  it("the migration adds only ruleset_releases with its keys and indexes; no existing table is altered (§56)", () => {
    const sql = read(...MIGRATION);
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["ruleset_releases"]);
    expect(sql).not.toMatch(/CREATE TYPE|DROP |ALTER COLUMN|ADD COLUMN|ALTER TYPE|CREATE TRIGGER|ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/);
    expect([...new Set([...sql.matchAll(/(?:ALTER TABLE|ON) "(\w+)"/g)].map((m) => m[1]))]).toEqual(["ruleset_releases"]);
    expect([...sql.matchAll(/FOREIGN KEY/g)]).toHaveLength(4);
    expect([...sql.matchAll(/ON DELETE RESTRICT/g)]).toHaveLength(4);
  });

  it("the approved M2-WO1 … M2-WO7 migrations are byte-for-byte unchanged (§93)", () => {
    const base = ["packages", "prowess-db", "prisma", "migrations"];
    const pins: Array<[string, string]> = [
      ["20261004233000_add_ruleset_foundation", "a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6"],
      ["20261005001500_add_ruleset_manifest", "31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c"],
      ["20261005120000_add_manifest_inheritance", "5fb2a0707fcffe93357b5e489af594db51ec2aabc0082893cd53230debbe4ea0"],
      ["20261005220000_add_canon_policy", "82d4a44f2caa1bb3f3ac88aaac2bdf18e95448787e32372a45a38398a919fc3c"],
      ["20261006010000_add_rule_conflicts", "5befce6a128a2e730998dad6ccef68484b06282060f5a354c7ad93b204cb8cad"],
      ["20261007010000_add_canon_decisions", "62ed605803a83093c91462ff18d4379016f3815a52d2143734c58017c08c6d7e"],
      ["20261008010000_add_change_sets", "2f11f6f86dfd4591304f415ab7ed8a9fe8c131cb6e90d05a9c620161b9c4d442"],
    ];
    for (const [name, hash] of pins) expect(sha256(...base, name, "migration.sql"), name).toBe(hash);
    expect(existsSync(path.join(ROOT, ...MIGRATION))).toBe(true);
  });

  it("no release / publishing UI exists outside the M2-WO10 governance workspace (M2-WO9 / M2-WO10) (§95, §96) — the HTTP API arrived in M2-WO9 (pinned by m2-api-static)", () => {
    const found: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        if (entry === "node_modules" || entry === ".next") continue;
        // M2-WO9: the HTTP API now exists; its exact route inventory is pinned by m2-api-static. UI is still WO10's.
        if (path.join(d, entry) === path.join(ROOT, "apps", "studio", "app", "api")) continue;
        // M2-WO10: the Ruleset & Canon governance UI now exists; its boundaries are pinned by m2-ui-static.
        if (path.join(d, entry) === path.join(ROOT, "apps", "studio", "app", "developer", "rulesets")) continue;
        const full = path.join(d, entry);
        if (/release|publish|change|impact|decision|conflict|canon/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    // The ONLY match is the M0-WO5 primary-navigation placeholder route, which predates M2 and must stay a
    // placeholder until M2-WO10 builds the publishing UI.
    expect(found).toEqual([path.join("apps", "studio", "app", "publishing")]);
    const page = read("apps", "studio", "app", "publishing", "page.tsx");
    expect(page).toMatch(/Placeholder — M0-WO5 establishes this route/);
    expect(page).not.toMatch(/@prowess\/db|publishRulesetRelease|fetch\(|use client/);
  });
});
