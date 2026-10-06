// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as model from "@prowess/model";
import { describe, expect, it } from "vitest";

/**
 * M2-WO6 static audit — a CanonDecision is an immutable record of an explicit governance outcome. It
 * pins one exact conflict and one exact policy snapshot, and its ONLY side effect is the conflict's
 * status. These checks fail if a later change lets decision code touch a manifest, an EntityVersion,
 * a policy, source authority or a Ruleset; infer anything "latest"; branch on the decision type to do
 * something; expose an update/apply/delete or a public conflict-status setter; weaken the composite
 * keys; or edit an approved migration.
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

const dbDir = path.join(ROOT, "packages", "prowess-db", "src", "canon-decision");
const dbSources = ["repository.ts", "service.ts", "index.ts"].map((f) => path.join(dbDir, f));
const modelDir = path.join(ROOT, "packages", "prowess-model", "src");
const modelSources = ["canon-decision.ts", "canon-decision-type.ts", "canon-conflict-disposition.ts"].map((f) => path.join(modelDir, f));
const decisionSources = [...dbSources, ...modelSources];
const MIGRATION = ["packages", "prowess-db", "prisma", "migrations", "20261007010000_add_canon_decisions", "migration.sql"] as const;

describe("M2-WO6 — the decision models are immutable, exactly-pinned records", () => {
  it("finds both models, both enums, every source and the migration (so nothing below can match nothing)", () => {
    expect(find("CanonDecision")).toBeDefined();
    expect(find("CanonDecisionSelection")).toBeDefined();
    expect(enumValues("CanonDecisionType").length).toBe(4);
    expect(enumValues("CanonConflictDisposition").length).toBe(3);
    for (const file of decisionSources) expect(existsSync(file), file).toBe(true);
    expect(existsSync(path.join(ROOT, ...MIGRATION))).toBe(true);
  });

  it("CanonDecision has exactly its specified fields plus the documented redundant entityId — no updatedAt (§22)", () => {
    expect(fieldNames(find("CanonDecision")?.body)).toEqual(
      [
        "canonPolicy",
        "canonPolicyId",
        "conflictDisposition",
        "createdAt",
        "decisionType",
        "entityId",
        "id",
        "rationale",
        "resultEntityVersion",
        "resultEntityVersionId",
        "ruleConflict",
        "ruleConflictId",
        "ruleset",
        "rulesetId",
        "selections",
      ].sort(),
    );
    expect(find("CanonDecision")?.body).not.toMatch(/updatedAt|\bBoolean\b/);
  });

  it("CanonDecisionSelection has exactly its specified fields plus the documented redundant ruleConflictId (§23)", () => {
    expect(fieldNames(find("CanonDecisionSelection")?.body)).toEqual(
      ["canonDecision", "canonDecisionId", "createdAt", "id", "ruleConflictCandidate", "ruleConflictCandidateId", "ruleConflictId"].sort(),
    );
    expect(find("CanonDecisionSelection")?.body).not.toMatch(/updatedAt|\bBoolean\b/);
  });

  it("no winner / active / current / latest / applied-manifest identifier exists in either model (§22)", () => {
    const FORBIDDEN = /\b(winner\w*|winning\w*|active\w*|current\w*|isLatest|latest\w*|applied\w*|appliedManifest\w*|\w*[Mm]anifest\w*|supersed\w*|rollback\w*)\b/;
    for (const name of ["CanonDecision", "CanonDecisionSelection"]) expect(find(name)?.body, name).not.toMatch(FORBIDDEN);
    for (const control of ["winnerId", "active", "currentVersion", "isLatest", "appliedManifestId"]) expect(control).toMatch(FORBIDDEN);
  });

  it("every relation is composite exactly as designed, and every one is ON DELETE RESTRICT (§24–§26, §58)", () => {
    const decision = find("CanonDecision")?.body ?? "";
    expect(decision).toMatch(/ruleConflict\s+RuleConflict\s+@relation\(fields:\s*\[ruleConflictId,\s*rulesetId,\s*entityId\],\s*references:\s*\[id,\s*rulesetId,\s*entityId\]/);
    expect(decision).toMatch(/canonPolicy\s+CanonPolicy\s+@relation\(fields:\s*\[canonPolicyId,\s*rulesetId\],\s*references:\s*\[id,\s*rulesetId\]/);
    expect(decision).toMatch(/resultEntityVersion\s+EntityVersion\?\s+@relation\(fields:\s*\[resultEntityVersionId,\s*entityId\],\s*references:\s*\[id,\s*entityId\]/);
    const selection = find("CanonDecisionSelection")?.body ?? "";
    expect(selection).toMatch(/canonDecision\s+CanonDecision\s+@relation\(fields:\s*\[canonDecisionId,\s*ruleConflictId\],\s*references:\s*\[id,\s*ruleConflictId\]/);
    expect(selection).toMatch(/ruleConflictCandidate\s+RuleConflictCandidate\s+@relation\(fields:\s*\[ruleConflictCandidateId,\s*ruleConflictId\],\s*references:\s*\[id,\s*ruleConflictId\]/);
    expect(selection).toMatch(/@@unique\(\[canonDecisionId,\s*ruleConflictCandidateId\]/);
    for (const [name, body] of [["CanonDecision", decision], ["CanonDecisionSelection", selection]] as const) {
      const relations = [...body.matchAll(/@relation\(([^)]*)\)/g)].map((m) => m[1] as string);
      expect(relations.length, name).toBeGreaterThanOrEqual(2);
      for (const r of relations) expect(r, `${name}: ${r}`).toMatch(/onDelete:\s*Restrict/);
    }
  });

  it("the composite-key targets exist on RuleConflict, RuleConflictCandidate, CanonPolicy and CanonDecision (§60)", () => {
    expect(find("RuleConflict")?.body).toMatch(/@@unique\(\[id,\s*rulesetId,\s*entityId\]/);
    expect(find("RuleConflictCandidate")?.body).toMatch(/@@unique\(\[id,\s*ruleConflictId\]/);
    expect(find("CanonPolicy")?.body).toMatch(/@@unique\(\[id,\s*rulesetId\]/);
    expect(find("CanonDecision")?.body).toMatch(/@@unique\(\[id,\s*ruleConflictId\]/);
  });

  it("there is NO unique constraint on rule_conflict_id alone: future rollback/supersession may add history (§36)", () => {
    expect(find("CanonDecision")?.body).not.toMatch(/@@unique\(\[ruleConflictId\]/);
    expect(find("CanonDecision")?.body).not.toMatch(/ruleConflictId\s+String[^\n]*@unique/);
  });

  it("other models gained back-relation LISTS only — no decision pointer column anywhere else (§57)", () => {
    const expected: Record<string, string[]> = {
      Ruleset: ["canonDecisions CanonDecision[]"],
      RuleConflict: ["canonDecisions CanonDecision[]"],
      CanonPolicy: ["canonDecisions CanonDecision[]"],
      EntityVersion: ["mergeResultDecisions CanonDecision[]"],
      RuleConflictCandidate: ["decisionSelections CanonDecisionSelection[]"],
    };
    for (const m of models.filter((x) => !["CanonDecision", "CanonDecisionSelection"].includes(x.name))) {
      const lines = m.body.split("\n").filter((l) => /decision/i.test(l)).map(squash);
      expect(lines, m.name).toEqual(expected[m.name] ?? []);
    }
  });

  it("the enums hold exactly the WO vocabularies; every disposition is a RuleConflictStatus and none is decidable (§6–§8)", () => {
    expect(enumValues("CanonDecisionType")).toEqual(["SELECT_RULE", "KEEP_SEPARATE", "MERGE", "RESOLVE_CONFLICT"]);
    expect(enumValues("CanonConflictDisposition")).toEqual(["RESOLVED", "ACCEPTED_DIVERGENCE", "DISMISSED"]);
    expect([...model.CANON_DECISION_TYPES]).toEqual(enumValues("CanonDecisionType"));
    expect([...model.CANON_CONFLICT_DISPOSITIONS]).toEqual(enumValues("CanonConflictDisposition"));
    for (const d of model.CANON_CONFLICT_DISPOSITIONS) {
      expect(enumValues("RuleConflictStatus")).toContain(d);
      expect((model.DECIDABLE_RULE_CONFLICT_STATUSES as readonly string[]).includes(d)).toBe(false);
    }
    // Unimplemented PAS-08 decision types are not present anywhere in the vocabulary yet (§6).
    for (const t of ["RENAME", "DEPRECATE", "AUTHORIZE_EXPERIMENT", "PROMOTE", "ROLLBACK", "SOURCE_AUTHORITY_CHANGE"]) {
      expect(enumValues("CanonDecisionType")).not.toContain(t);
    }
  });

  it("nothing still out of scope exists: no ChangeSet, RulesetRelease, decision-application or rollback model (§59)", () => {
    expect(models.map((m) => m.name).filter((n) => /changeset|release|application|applied|rollback|supersession/i.test(n))).toEqual([]);
  });
});

describe("M2-WO6 — decision code records; it never applies, infers, or selects automatically (§27–§31, §53, §64)", () => {
  const FORBIDDEN =
    /\b(rulesetManifest\w*|RulesetManifest\w*|manifestEntr\w*|createRulesetManifest|getRulesetManifest|resolveEntityVersionFromManifest|resolveEffectiveEntityVersion|getEffectiveManifestEntries|parentManifestId|transitionEntityVersionStatus|updateDraftEntityVersion|createEntityVersion|entityVersion\.(update|updateMany|upsert|delete)|sourceAuthorityRecord|SourceAuthorityStatus|resolveSourceAuthority|getSourceAuthorityRecord|selectSourceAuthorityRecord|resolveAuthorityFromDeclarations|GOVERNING|REFERENCE_ONLY|ruleset\.(update|updateMany|upsert|delete)|canonPolicy\.(create|update|updateMany|upsert|delete)|getLatest\w*|selectLatest\w*|calculate\w*|evaluate\w*|rulesEngine|applyDecision|winner\w*)\b/;

  it.each(decisionSources.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const code = stripTs(readFileSync(file as string, "utf8"));
    expect(code, "no manifest / lifecycle / authority / Ruleset mutation, no rules engine, no automatic winner").not.toMatch(FORBIDDEN);
    expect(code, "'latest' never appears").not.toMatch(/latest/i);
    expect(code, "no highest-revision inference").not.toMatch(/revisionNumber:\s*"desc"|MAX\s*\(|ORDER\s+BY[^;\n]*DESC/i);
  });

  it("the db decision code imports only its repository, the exact-id lookups, the shared Prisma helpers, and the model (§64)", () => {
    const allowed = new Set([
      "@prowess/model",
      "../client.js",
      "../prisma-errors.js",
      "../canon-policy/repository.js",
      "../entity-version/repository.js",
      "../rule-conflict/repository.js",
      "../ruleset/repository.js",
      "../../generated/prisma/client.js",
      "./repository.js",
      "./service.js",
    ]);
    for (const file of dbSources) {
      for (const match of stripTs(readFileSync(file, "utf8")).matchAll(/from\s+"([^"]+)"/g)) {
        expect(allowed.has(match[1] as string), `${path.basename(file)} imports ${match[1]}`).toBe(true);
      }
    }
  });

  it("the service reaches other domains only through exact-id lookups (§64)", () => {
    const service = stripTs(read("packages", "prowess-db", "src", "canon-decision", "service.ts"));
    const lookups = [...service.matchAll(/\b(select\w+)\(/g)].map((m) => m[1]).filter((n) => !/CanonDecision/.test(n ?? ""));
    expect([...new Set(lookups)].sort()).toEqual(["selectCandidateOwners", "selectCanonPolicyById", "selectEntityVersionById", "selectRuleConflictById", "selectRulesetById"]);
  });

  it("the repository writes exactly: decision + selection inserts, and ONE conditional conflict-status update — nothing else (§10, §52, §78)", () => {
    const repo = stripTs(read("packages", "prowess-db", "src", "canon-decision", "repository.ts"));
    const writes = [...repo.matchAll(/\b(?:tx|prisma)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(writes.sort()).toEqual(["canonDecision.create", "canonDecisionSelection.create", "ruleConflict.updateMany"]);
    expect(repo).not.toMatch(/\$executeRaw|\$queryRaw/);
    // The update is conditional on a decidable status (the race-safe transition) and sets only `status`.
    expect(repo).toMatch(/where:\s*\{\s*id:\s*ruleConflictId,\s*status:\s*\{\s*in:\s*\[\.\.\.DECIDABLE_RULE_CONFLICT_STATUSES\]\s*\}\s*\}/);
    expect(repo).toMatch(/data:\s*\{\s*status:\s*ruleConflictStatusForDisposition\(disposition\)\s*\}/);
    // The transition happens BEFORE the decision insert, inside the same transaction.
    const tx = /prisma\.\$transaction\(async \(tx\) => \{([\s\S]*?)\n {2}\}\);/.exec(repo)?.[1] ?? "";
    expect(tx.indexOf("transitionRuleConflictToDisposition")).toBeGreaterThan(-1);
    expect(tx.indexOf("transitionRuleConflictToDisposition")).toBeLessThan(tx.indexOf("canonDecision.create"));
    // A selection's redundant conflict id is always the decision's own.
    expect(repo).toMatch(/data:\s*\{\s*canonDecisionId:\s*created\.id,\s*ruleConflictId:\s*decision\.ruleConflictId,\s*ruleConflictCandidateId\s*\}/);
  });

  it("the decision type carries no behavior: db code never compares or switches on decisionType / conflictDisposition values (§53)", () => {
    for (const file of dbSources) {
      const code = stripTs(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/\.(decisionType|conflictDisposition)\s*(===|!==|==|!=)\s*"|switch\s*\([^)]*\b(decisionType|conflictDisposition)\b/);
    }
  });

  it("the rationale is required and caller-written — never derived (§11)", () => {
    const service = stripTs(read("packages", "prowess-db", "src", "canon-decision", "service.ts"));
    expect(service).toMatch(/rationale:\s*input\.rationale\.trim\(\)/);
    expect([...service.matchAll(/rationale:/g)]).toHaveLength(1);
  });
});

describe("M2-WO6 — scope boundaries", () => {
  const exportsOf = (text: string, from: RegExp) =>
    [...text.matchAll(from)].flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean)).sort();

  it("exposes exactly four decision operations; the conditional status transition stays internal (§2, §28, §65)", () => {
    const names = ["createCanonDecision", "getCanonDecision", "listCanonDecisions", "listCanonDecisionsForConflict"];
    expect(exportsOf(stripTs(read("packages", "prowess-db", "src", "canon-decision", "index.ts")), /export \{([^}]*)\} from/g)).toEqual(names);
    const root = read("packages", "prowess-db", "src", "index.ts");
    expect(exportsOf(root, /export \{([^}]*)\} from "\.\/canon-decision\/index\.js"/g)).toEqual(names);
    expect(root).not.toMatch(/transitionRuleConflict|setRuleConflictStatus|insertCanonDecision/);
    // RuleConflict's public surface is still exactly its four create/read operations.
    expect(exportsOf(stripTs(read("packages", "prowess-db", "src", "rule-conflict", "index.ts")), /export \{([^}]*)\} from/g)).toEqual([
      "createRuleConflict",
      "getRuleConflict",
      "listRuleConflicts",
      "listRuleConflictsForEntity",
    ]);
  });

  it("the migration adds only the two decision tables, two enums, their keys and indexes, and three composite-key targets (§59, §60)", () => {
    const sql = read(...MIGRATION);
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["canon_decisions", "canon_decision_selections"]);
    expect([...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["CanonDecisionType", "CanonConflictDisposition"]);
    expect(sql).not.toMatch(/DROP |ALTER COLUMN|ADD COLUMN|ALTER TYPE|CREATE TRIGGER|CREATE FUNCTION|ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/);
    expect([...new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(["canon_decision_selections", "canon_decisions"]);
    expect([...sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "(\w+)"\(([^)]*)\)/g)].map((m) => [m[2], m[3], m[1] ? "unique" : "index", m[4]])).toEqual([
      ["canon_decisions_ruleset_id_idx", "canon_decisions", "index", '"ruleset_id"'],
      ["canon_decisions_rule_conflict_id_idx", "canon_decisions", "index", '"rule_conflict_id"'],
      ["canon_decisions_canon_policy_id_idx", "canon_decisions", "index", '"canon_policy_id"'],
      ["canon_decisions_result_entity_version_id_idx", "canon_decisions", "index", '"result_entity_version_id"'],
      ["canon_decisions_id_rule_conflict_id_key", "canon_decisions", "unique", '"id", "rule_conflict_id"'],
      ["canon_decision_selections_candidate_id_idx", "canon_decision_selections", "index", '"rule_conflict_candidate_id"'],
      ["canon_decision_selections_decision_candidate_key", "canon_decision_selections", "unique", '"canon_decision_id", "rule_conflict_candidate_id"'],
      // Composite-key targets on existing tables: each starts with the primary key, so it adds no real uniqueness (§60).
      ["canon_policies_id_ruleset_id_key", "canon_policies", "unique", '"id", "ruleset_id"'],
      ["rule_conflict_candidates_id_rule_conflict_id_key", "rule_conflict_candidates", "unique", '"id", "rule_conflict_id"'],
      ["rule_conflicts_id_ruleset_id_entity_id_key", "rule_conflicts", "unique", '"id", "ruleset_id", "entity_id"'],
    ]);
    expect([...sql.matchAll(/ADD CONSTRAINT "(\w+)" FOREIGN KEY \(([^)]*)\) REFERENCES "(\w+)"\(([^)]*)\) ON DELETE RESTRICT/g)].map((m) => [m[1], m[2], m[3], m[4]])).toEqual([
      ["canon_decisions_ruleset_id_fkey", '"ruleset_id"', "rulesets", '"id"'],
      ["canon_decisions_conflict_fkey", '"rule_conflict_id", "ruleset_id", "entity_id"', "rule_conflicts", '"id", "ruleset_id", "entity_id"'],
      ["canon_decisions_policy_fkey", '"canon_policy_id", "ruleset_id"', "canon_policies", '"id", "ruleset_id"'],
      ["canon_decisions_result_version_fkey", '"result_entity_version_id", "entity_id"', "entity_versions", '"id", "entity_id"'],
      ["canon_decision_selections_decision_fkey", '"canon_decision_id", "rule_conflict_id"', "canon_decisions", '"id", "rule_conflict_id"'],
      ["canon_decision_selections_candidate_fkey", '"rule_conflict_candidate_id", "rule_conflict_id"', "rule_conflict_candidates", '"id", "rule_conflict_id"'],
    ]);
    expect([...sql.matchAll(/FOREIGN KEY/g)]).toHaveLength(6);
    expect(sql).not.toMatch(/change_set|ruleset_release|applied|winner|is_latest|active|"current/i);
  });

  it("every constraint name fits PostgreSQL's 63-byte identifier limit", () => {
    const names = [...read(...MIGRATION).matchAll(/(?:CONSTRAINT|INDEX) "(\w+)"/g)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
  });

  it("the approved M2-WO1 … M2-WO5 migrations are byte-for-byte unchanged", () => {
    const base = ["packages", "prowess-db", "prisma", "migrations"];
    expect(sha256(...base, "20261004233000_add_ruleset_foundation", "migration.sql")).toBe("a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6");
    expect(sha256(...base, "20261005001500_add_ruleset_manifest", "migration.sql")).toBe("31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c");
    expect(sha256(...base, "20261005120000_add_manifest_inheritance", "migration.sql")).toBe("5fb2a0707fcffe93357b5e489af594db51ec2aabc0082893cd53230debbe4ea0");
    expect(sha256(...base, "20261005220000_add_canon_policy", "migration.sql")).toBe("82d4a44f2caa1bb3f3ac88aaac2bdf18e95448787e32372a45a38398a919fc3c");
    expect(sha256(...base, "20261006010000_add_rule_conflicts", "migration.sql")).toBe("5befce6a128a2e730998dad6ccef68484b06282060f5a354c7ad93b204cb8cad");
  });

  it("no decision HTTP route or UI exists yet (M2-WO9 / M2-WO10 own those)", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = path.join(dir, entry);
        if (/decision|conflict|canon/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
