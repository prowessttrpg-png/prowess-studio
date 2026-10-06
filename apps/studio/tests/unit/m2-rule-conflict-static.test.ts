// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO5 static audit — a RuleConflict RECORDS a disagreement between exact historical
 * EntityVersions; it never RESOLVES one. These checks fail if a later change gives the
 * conflict models a winner/resolution column, makes conflict code select content, read a
 * manifest or source authority, infer a "latest" anything, branch on type or severity,
 * grow a status-transition / edit / delete operation, redefine the vocabularies, weaken
 * the composite-key integrity, or edit an approved migration.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripPrisma = (s: string) => s.replace(/\/\/.*$/gm, "");
const sha256 = (...p: string[]) => createHash("sha256").update(readFileSync(path.join(ROOT, ...p))).digest("hex");

const SCHEMA = stripPrisma(read("packages", "prowess-db", "prisma", "schema.prisma"));
const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1] as string, body: m[2] as string }));
const find = (name: string) => models.find((m) => m.name === name);
const fieldNames = (body: string | undefined) => [...(body ?? "").matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]).sort();
const enumBody = (name: string) => new RegExp(`^enum ${name} \\{([^}]*)\\}`, "m").exec(SCHEMA)?.[1] ?? "";
const enumValues = (name: string) => enumBody(name).split("\n").map((l) => l.trim()).filter(Boolean);

const dbDir = path.join(ROOT, "packages", "prowess-db", "src", "rule-conflict");
const dbSources = ["repository.ts", "service.ts", "index.ts"].map((f) => path.join(dbDir, f));
const modelDir = path.join(ROOT, "packages", "prowess-model", "src");
const modelSources = ["rule-conflict.ts", "rule-conflict-type.ts", "rule-conflict-severity.ts", "rule-conflict-status.ts"].map((f) => path.join(modelDir, f));
const conflictSources = [...dbSources, ...modelSources];
const MIGRATION = ["packages", "prowess-db", "prisma", "migrations", "20261006010000_add_rule_conflicts", "migration.sql"] as const;

const WINNER_WORDS = /\b(winner\w*|winning\w*|selectedCandidate\w*|resolvedCandidate\w*|preferredCandidate\w*|activeCandidate\w*|currentCandidate\w*|chosenCandidate\w*|resolvedAt|resolutionText|canonDecision\w*|canonPolicyId)\b/i;

describe("M2-WO5 — the conflict models record, never resolve", () => {
  it("finds both models, all three enums, every source and the migration (so nothing below can match nothing)", () => {
    expect(find("RuleConflict")).toBeDefined();
    expect(find("RuleConflictCandidate")).toBeDefined();
    for (const e of ["RuleConflictType", "RuleConflictSeverity", "RuleConflictStatus"]) expect(enumValues(e).length, e).toBeGreaterThan(3);
    for (const file of conflictSources) expect(existsSync(file), file).toBe(true);
    expect(existsSync(path.join(ROOT, ...MIGRATION))).toBe(true);
  });

  it("RuleConflict has exactly its specified fields — no winner, resolution, decision, policy, or updatedAt (§4, §64)", () => {
    expect(fieldNames(find("RuleConflict")?.body)).toEqual(
      // M2-WO6 added only the canonDecisions back-relation LIST: a decision points at its conflict, never the reverse.
      ["candidates", "canonDecisions", "conflictType", "createdAt", "description", "entity", "entityId", "id", "ruleset", "rulesetId", "severity", "status", "title"].sort(),
    );
    expect(find("RuleConflict")?.body).not.toMatch(/updatedAt|\bBoolean\b/);
  });

  it("RuleConflictCandidate has exactly its specified fields plus the documented redundant entityId (§9, §39)", () => {
    expect(fieldNames(find("RuleConflictCandidate")?.body)).toEqual(
      [
        "createdAt",
        "decisionSelections", // M2-WO6 back-relation list only
        "entityId",
        "entityVersion",
        "entityVersionId",
        "id",
        "label",
        "positionSummary",
        "ruleConflict",
        "ruleConflictId",
        "sourceReference",
        "sourceReferenceId",
      ].sort(),
    );
    expect(find("RuleConflictCandidate")?.body).not.toMatch(/updatedAt|\bBoolean\b/);
  });

  it("no winner / current / selected / resolution / decision identifier exists in either model (§64)", () => {
    // M2-WO6 superseded "no decision identifier at all": the ONE permitted mention is the back-relation list
    // `canonDecisions CanonDecision[]`. A conflict or candidate still has no decision POINTER column.
    const withoutWo6Lists = (body: string | undefined) =>
      (body ?? "").replace(/^\s*canonDecisions\s+CanonDecision\[\]\s*$/m, "").replace(/^\s*decisionSelections\s+CanonDecisionSelection\[\]\s*$/m, "");
    expect(withoutWo6Lists(find("RuleConflict")?.body)).not.toMatch(WINNER_WORDS);
    expect(withoutWo6Lists(find("RuleConflictCandidate")?.body)).not.toMatch(WINNER_WORDS);
    for (const name of ["RuleConflict", "RuleConflictCandidate"]) expect(find(name)?.body, name).not.toMatch(/\w*[Dd]ecisionId\s+String/);
    // Control: the matcher must catch the forbidden names, so the check above cannot silently stop working.
    for (const name of ["winningVersionId", "selectedCandidateId", "resolvedCandidate", "preferredCandidate", "activeCandidate", "currentCandidate", "canonDecisionId", "resolvedAt"]) {
      expect(name, name).toMatch(WINNER_WORDS);
    }
  });

  it("no authority is denormalized into a candidate, and a conflict is not tied to a policy (§18, §63)", () => {
    for (const name of ["RuleConflict", "RuleConflictCandidate"]) {
      expect(find(name)?.body, name).not.toMatch(/SourceAuthorityStatus|SourceAuthorityRecord|CanonPolicy|authority|polic|RulesetManifest/i);
    }
  });

  it("the candidate's integrity is COMPOSITE, from both sides, and the optional evidence is composite too (§11, §14, §39)", () => {
    const body = find("RuleConflictCandidate")?.body ?? "";
    expect(body).toMatch(/ruleConflict\s+RuleConflict\s+@relation\(fields:\s*\[ruleConflictId,\s*entityId\],\s*references:\s*\[id,\s*entityId\]/);
    expect(body).toMatch(/entityVersion\s+EntityVersion\s+@relation\(fields:\s*\[entityVersionId,\s*entityId\],\s*references:\s*\[id,\s*entityId\]/);
    expect(body).toMatch(/sourceReference\s+SourceReference\?\s+@relation\(fields:\s*\[sourceReferenceId,\s*entityVersionId\],\s*references:\s*\[id,\s*entityVersionId\]/);
    expect(body).toMatch(/@@unique\(\[ruleConflictId,\s*entityVersionId\]/);
    expect(find("RuleConflict")?.body).toMatch(/@@unique\(\[id,\s*entityId\]/);
    expect(find("SourceReference")?.body).toMatch(/@@unique\(\[id,\s*entityVersionId\]/);
    expect(find("EntityVersion")?.body).toMatch(/@@unique\(\[id,\s*entityId\]/);
  });

  it("every conflict relation is ON DELETE RESTRICT (§31, §37)", () => {
    for (const name of ["RuleConflict", "RuleConflictCandidate"]) {
      const relations = [...(find(name)?.body ?? "").matchAll(/@relation\(([^)]*)\)/g)].map((m) => m[1] as string);
      expect(relations.length, name).toBeGreaterThanOrEqual(2);
      for (const r of relations) expect(r, `${name}: ${r}`).toMatch(/onDelete:\s*Restrict/);
    }
  });

  it("other models gained back-relation LISTS only — no conflict pointer, flag, or column (§19, §21, §22)", () => {
    const expected: Record<string, string[]> = {
      Ruleset: ["ruleConflicts RuleConflict[]"],
      Entity: ["ruleConflicts RuleConflict[]"],
      EntityVersion: ["conflictCandidates RuleConflictCandidate[]"],
      SourceReference: ["conflictCandidates RuleConflictCandidate[]"],
    };
    // M2-WO6's decision models reference conflicts by design; they have their own audit (m2-canon-decision-static).
    for (const model of models.filter((m) => !["RuleConflict", "RuleConflictCandidate", "CanonDecision", "CanonDecisionSelection"].includes(m.name))) {
      const lines = model.body
        .split("\n")
        .filter((line) => /conflict/i.test(line))
        .map((l) => l.trim().replace(/\s+/g, " "));
      expect(lines, model.name).toEqual(expected[model.name] ?? []);
    }
  });

  it("the three enums hold exactly the WO vocabularies; status defaults to OPEN; no other conflict/decision enum exists (§5–§8)", () => {
    expect(enumValues("RuleConflictType")).toEqual([
      "SOURCE_CONTRADICTION",
      "MECHANICAL_DIVERGENCE",
      "TERMINOLOGY_DIVERGENCE",
      "STRUCTURAL_DIVERGENCE",
      "AUTHORING_STANDARD_CONFLICT",
      "OTHER",
    ]);
    expect(enumValues("RuleConflictSeverity")).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    expect(enumValues("RuleConflictStatus")).toEqual(["OPEN", "UNDER_REVIEW", "RESOLVED", "ACCEPTED_DIVERGENCE", "DISMISSED"]);
    expect(find("RuleConflict")?.body).toMatch(/status\s+RuleConflictStatus\s+@default\(OPEN\)/);
    const enums = [...SCHEMA.matchAll(/^enum (\w+)/gm)].map((m) => m[1]);
    // M2-WO6 added CanonDecisionType and CanonConflictDisposition (audited in m2-canon-decision-static); nothing else.
    expect(enums.filter((n) => /conflict|decision|resolution|winner/i.test(n ?? "")).sort()).toEqual([
      "CanonConflictDisposition",
      "CanonDecisionType",
      "RuleConflictSeverity",
      "RuleConflictStatus",
      "RuleConflictType",
    ]);
  });

  it("nothing still out of scope exists: no RulesetRelease or resolution model (CanonDecision arrived in M2-WO6, ChangeSet in M2-WO7)", () => {
    expect(models.map((m) => m.name).filter((n) => /release|resolution|winner/i.test(n))).toEqual([]);
  });
});

describe("M2-WO5 — conflict code observes; it never resolves, selects, or infers", () => {
  // §65: no governance resolution, no "latest", no manifest or authority access, no lifecycle mutation, no Rules Engine.
  const FORBIDDEN =
    /\b(resolveEffectiveEntityVersion|getEffectiveManifestEntries|resolveEntityVersionFromManifest|resolveSourceAuthority|resolveAuthorityFromDeclarations|getLatestEntityVersion|selectLatestEntityVersion|getLatestRulesetManifest|selectLatestRulesetManifest|getLatestCanonPolicy|selectLatestCanonPolicy|getSourceAuthorityRecord|selectSourceAuthorityRecord|listEntityVersions|selectEntityVersionsByEntityId|createRulesetManifest|getRulesetManifest|getManifestEntry|selectManifestEntry|canonPolicy|sourceAuthorityRecord|rulesetManifest\w*|transitionEntityVersionStatus|updateDraftEntityVersion|EntityVersionStatus|parentRulesetId|parentManifestId|calculate\w*|evaluate\w*|rulesEngine)\b/;

  it.each(conflictSources.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const code = stripTs(readFileSync(file as string, "utf8"));
    expect(code, "no resolution / manifest / authority / lifecycle / rules-engine access").not.toMatch(FORBIDDEN);
    expect(code, "no winner identifier").not.toMatch(WINNER_WORDS);
    expect(code, "'latest' never appears: nothing is inferred from recency").not.toMatch(/latest/i);
    expect(code, "no highest-revision inference").not.toMatch(/revisionNumber:\s*"desc"|MAX\s*\(|ORDER\s+BY[^;\n]*DESC/i);
    // Comparing one of these fields to a vocabulary VALUE (or switching on it) would be behavior keyed on
    // classification. Shape checks such as `typeof x.severity !== "string"` are not, and stay allowed.
    expect(code, "type, severity and status values are never branched on").not.toMatch(
      /\.(conflictType|severity|status)\s*(===|!==|==|!=)\s*"[A-Z_]+"|"[A-Z_]+"\s*(===|!==|==|!=)\s*[\w.]*\.(conflictType|severity|status)\b|switch\s*\([^)]*\b(conflictType|severity|status)\b/,
    );
    expect('if (conflict.severity === "CRITICAL")', "control").toMatch(/\.(conflictType|severity|status)\s*(===|!==|==|!=)\s*"[A-Z_]+"/);
    expect(code, "no CANON-status test").not.toMatch(/"CANON"/);
  });

  it("the db conflict code reaches only its repository, the four existence lookups, the shared Prisma helpers, and the model", () => {
    const allowed = new Set([
      "@prowess/model",
      "../client.js",
      "../prisma-errors.js",
      "../ruleset/repository.js",
      "../entity/repository.js",
      "../entity-version/repository.js",
      "../source-reference/repository.js",
      "../../generated/prisma/client.js",
      "./repository.js",
      "./service.js",
    ]);
    for (const file of dbSources) {
      const code = stripTs(readFileSync(file, "utf8"));
      for (const match of code.matchAll(/from\s+"([^"]+)"/g)) {
        expect(allowed.has(match[1] as string), `${path.basename(file)} imports ${match[1]}`).toBe(true);
      }
    }
  });

  it("the existence lookups are exact-id lookups only (§65: existence validation is the one justified read)", () => {
    const service = stripTs(read("packages", "prowess-db", "src", "rule-conflict", "service.ts"));
    const lookups = [...service.matchAll(/\b(select\w+)\(/g)].map((m) => m[1]).filter((n) => !/RuleConflict/.test(n ?? ""));
    expect([...new Set(lookups)].sort()).toEqual(["selectEntityById", "selectEntityVersionById", "selectRulesetById", "selectSourceReferenceById"]);
  });

  it("the repository only CREATES and READS: no update, upsert or delete of any row, and status is written only as the initial value (§29–§31)", () => {
    const repo = stripTs(read("packages", "prowess-db", "src", "rule-conflict", "repository.ts"));
    expect(repo).not.toMatch(/\.(update|updateMany|upsert|delete|deleteMany|\$executeRaw\w*|\$queryRaw\w*)\(/);
    const statusWrites = [...repo.matchAll(/\bstatus:\s*([\w.]+)/g)].map((m) => m[1]).filter((v) => !v?.startsWith("row."));
    expect(statusWrites).toEqual(["INITIAL_RULE_CONFLICT_STATUS"]);
    // The candidate's redundant entityId is always the conflict's Entity, never caller-supplied.
    expect(repo).toMatch(/data:\s*\{\s*ruleConflictId,\s*entityId:\s*conflictEntityId,\s*\.\.\.candidate\s*\}/);
    expect(repo).not.toMatch(/entityId:\s*candidate\./);
  });

  it("candidate order is revision ASC then id ASC — a display order, never a ranking (§28)", () => {
    const repo = stripTs(read("packages", "prowess-db", "src", "rule-conflict", "repository.ts"));
    expect(repo).toMatch(/orderBy:\s*\[\{\s*entityVersion:\s*\{\s*revisionNumber:\s*"asc"\s*\}\s*\},\s*\{\s*id:\s*"asc"\s*\}\]/);
  });

  it("the creation input has no status or winner field, and the vocabularies are defined exactly once", () => {
    const model = stripTs(read("packages", "prowess-model", "src", "rule-conflict.ts"));
    const input = /export interface CreateRuleConflictInput \{([\s\S]*?)\n\}/.exec(model)?.[1] ?? "";
    expect(input.length).toBeGreaterThan(20);
    expect(input).not.toMatch(/\bstatus\b|winner|resolved|selected/i);
    const holders: Record<string, string[]> = { ACCEPTED_DIVERGENCE: [], AUTHORING_STANDARD_CONFLICT: [], CRITICAL: [] };
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
          const code = stripTs(readFileSync(full, "utf8"));
          for (const word of Object.keys(holders)) if (code.includes(`"${word}"`)) holders[word]?.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, "packages", "prowess-model", "src"));
    walk(path.join(ROOT, "packages", "prowess-db", "src"));
    expect(holders).toEqual({
      // M2-WO6: the disposition vocabulary deliberately repeats the three terminal labels (its own Prisma enum);
      // m2-canon-decision-static proves it is an exact subset of RuleConflictStatus.
      ACCEPTED_DIVERGENCE: [
        path.join("packages", "prowess-model", "src", "canon-conflict-disposition.ts"),
        // The decision rules table USES the disposition values; `satisfies` type-checks them against the vocabulary.
        path.join("packages", "prowess-model", "src", "canon-decision.ts"),
        path.join("packages", "prowess-model", "src", "rule-conflict-status.ts"),
      ],
      AUTHORING_STANDARD_CONFLICT: [path.join("packages", "prowess-model", "src", "rule-conflict-type.ts")],
      CRITICAL: [path.join("packages", "prowess-model", "src", "rule-conflict-severity.ts")],
    });
  });
});

describe("M2-WO5 — scope boundaries", () => {
  const exportsOf = (text: string, from: RegExp) =>
    [...text.matchAll(from)].flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean)).sort();

  it("exposes exactly four conflict operations; nothing transitions, edits, resolves, or deletes a conflict (§29–§31)", () => {
    const names = ["createRuleConflict", "getRuleConflict", "listRuleConflicts", "listRuleConflictsForEntity"];
    expect(exportsOf(stripTs(read("packages", "prowess-db", "src", "rule-conflict", "index.ts")), /export \{([^}]*)\} from/g)).toEqual(names);
    expect(exportsOf(read("packages", "prowess-db", "src", "index.ts"), /export \{([^}]*)\} from "\.\/rule-conflict\/index\.js"/g)).toEqual(names);
    const mutator = /^(set|change|update|resolve|dismiss|accept|choose|select|close|reopen|add|remove|delete|patch|upsert|edit|transition)/i;
    expect(names.filter((n) => mutator.test(n))).toEqual([]);
    expect(["resolveConflict", "dismissConflict", "acceptDivergence", "setConflictStatus", "chooseWinner"].filter((n) => mutator.test(n))).toHaveLength(5);
  });

  it("the migration adds only the two conflict tables, three enums, their keys and indexes, and the one composite-key target on source_references (§38)", () => {
    const sql = read(...MIGRATION);
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["rule_conflicts", "rule_conflict_candidates"]);
    expect([...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1])).toEqual(["RuleConflictType", "RuleConflictSeverity", "RuleConflictStatus"]);
    expect(sql).not.toMatch(/DROP |ALTER COLUMN|ADD COLUMN|ALTER TYPE|CREATE TRIGGER|CREATE FUNCTION|ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/);
    expect([...new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(["rule_conflict_candidates", "rule_conflicts"]);
    expect([...sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "(\w+)"/g)].map((m) => [m[2], m[3], m[1] ? "unique" : "index"])).toEqual([
      ["rule_conflicts_ruleset_id_entity_id_idx", "rule_conflicts", "index"],
      ["rule_conflicts_ruleset_id_status_idx", "rule_conflicts", "index"],
      ["rule_conflicts_entity_id_idx", "rule_conflicts", "index"],
      ["rule_conflicts_id_entity_id_key", "rule_conflicts", "unique"],
      ["rule_conflict_candidates_entity_version_id_idx", "rule_conflict_candidates", "index"],
      ["rule_conflict_candidates_source_reference_id_idx", "rule_conflict_candidates", "index"],
      ["rule_conflict_candidates_conflict_version_key", "rule_conflict_candidates", "unique"],
      ["source_references_id_entity_version_id_key", "source_references", "unique"],
    ]);
    expect([...sql.matchAll(/ADD CONSTRAINT "(\w+)" FOREIGN KEY \(([^)]*)\) REFERENCES "(\w+)"\(([^)]*)\) ON DELETE RESTRICT/g)].map((m) => [m[1], m[2], m[3], m[4]])).toEqual([
      ["rule_conflicts_ruleset_id_fkey", '"ruleset_id"', "rulesets", '"id"'],
      ["rule_conflicts_entity_id_fkey", '"entity_id"', "entities", '"id"'],
      ["rule_conflict_candidates_conflict_entity_fkey", '"rule_conflict_id", "entity_id"', "rule_conflicts", '"id", "entity_id"'],
      ["rule_conflict_candidates_version_entity_fkey", '"entity_version_id", "entity_id"', "entity_versions", '"id", "entity_id"'],
      ["rule_conflict_candidates_source_reference_fkey", '"source_reference_id", "entity_version_id"', "source_references", '"id", "entity_version_id"'],
    ]);
    expect([...sql.matchAll(/FOREIGN KEY/g)]).toHaveLength(5);
    expect(sql).not.toMatch(/canon_decision|change_set|ruleset_release|winner|resolved_|resolution/i);
  });

  it("every constraint name fits PostgreSQL's 63-byte identifier limit (no silent truncation)", () => {
    const names = [...read(...MIGRATION).matchAll(/(?:CONSTRAINT|INDEX) "(\w+)"/g)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
  });

  it("the approved M2-WO1 … M2-WO4 migrations are byte-for-byte unchanged (§68)", () => {
    const base = ["packages", "prowess-db", "prisma", "migrations"];
    expect(sha256(...base, "20261004233000_add_ruleset_foundation", "migration.sql")).toBe("a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6");
    expect(sha256(...base, "20261005001500_add_ruleset_manifest", "migration.sql")).toBe("31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c");
    expect(sha256(...base, "20261005120000_add_manifest_inheritance", "migration.sql")).toBe("5fb2a0707fcffe93357b5e489af594db51ec2aabc0082893cd53230debbe4ea0");
    expect(sha256(...base, "20261005220000_add_canon_policy", "migration.sql")).toBe("82d4a44f2caa1bb3f3ac88aaac2bdf18e95448787e32372a45a38398a919fc3c");
  });

  it("no conflict HTTP route or UI exists yet (M2-WO9 / M2-WO10 own those) (§70, §71)", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = path.join(dir, entry);
        if (/conflict|decision/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
