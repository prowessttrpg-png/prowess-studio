// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO4 static audit — a CanonPolicy is an immutable, Ruleset-scoped snapshot of
 * source-AUTHORITY metadata, and that metadata never selects content. These checks
 * fail if a later change makes the policy code select an EntityVersion, read a
 * manifest, fall back across policies or to a parent Ruleset, infer authority,
 * grow a "current/active policy" pointer or a way to edit a policy, redefine the
 * authority vocabulary, or edit an approved migration.
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

const dbDir = path.join(ROOT, "packages", "prowess-db", "src", "canon-policy");
const dbSources = ["repository.ts", "service.ts", "index.ts"].map((f) => path.join(dbDir, f));
const modelDir = path.join(ROOT, "packages", "prowess-model", "src");
const modelSources = ["canon-policy.ts", "source-authority-scope.ts", "source-authority-resolution.ts"].map((f) => path.join(modelDir, f));
const policySources = [...dbSources, ...modelSources];
const MIGRATION = ["packages", "prowess-db", "prisma", "migrations", "20261005220000_add_canon_policy", "migration.sql"] as const;

describe("M2-WO4 — the policy models are immutable snapshots with explicit authority", () => {
  it("finds both models and every source (so nothing below can match nothing)", () => {
    expect(find("CanonPolicy")).toBeDefined();
    expect(find("SourceAuthorityRecord")).toBeDefined();
    for (const file of policySources) expect(existsSync(file), file).toBe(true);
    expect(existsSync(path.join(ROOT, ...MIGRATION))).toBe(true);
  });

  it("CanonPolicy has exactly its specified fields, and NO updatedAt — a snapshot is never edited", () => {
    expect(fieldNames(find("CanonPolicy")?.body)).toEqual(
      // M2-WO6 added only the canonDecisions back-relation list (decisions cite a policy; a policy never points at one).
      // M2-WO8 added only the releases back-relation list (a release pins the policy it was published under).
      ["authorityRecords", "canonDecisions", "createdAt", "description", "id", "name", "policyVersion", "releases", "ruleset", "rulesetId"],
    );
    expect(find("CanonPolicy")?.body).not.toMatch(/updatedAt|\bBoolean\b/);
  });

  it("SourceAuthorityRecord has exactly its specified fields, and NO updatedAt or Boolean", () => {
    expect(fieldNames(find("SourceAuthorityRecord")?.body)).toEqual(
      ["authorityStatus", "canonPolicy", "canonPolicyId", "createdAt", "id", "rationale", "scopeKey", "sourceDocument", "sourceDocumentId"],
    );
    expect(find("SourceAuthorityRecord")?.body).not.toMatch(/updatedAt|\bBoolean\b/);
  });

  it("a record belongs to a policy and references a SourceDocument — and to NOTHING else (no Entity, EntityVersion, SourceReference, manifest, or Ruleset)", () => {
    expect(find("SourceAuthorityRecord")?.body).not.toMatch(/\b(Entity|EntityVersion|SourceReference|RulesetManifest|RulesetManifestEntry|Ruleset)\b/);
    expect(find("CanonPolicy")?.body).not.toMatch(/\b(Entity|EntityVersion|SourceReference|SourceDocument|RulesetManifest|RulesetManifestEntry)\b/);
  });

  it("reuses the existing SourceAuthorityStatus enum: no second authority vocabulary, no new enum at all", () => {
    expect(find("SourceAuthorityRecord")?.body).toMatch(/authorityStatus\s+SourceAuthorityStatus\s/);
    const enums = [...SCHEMA.matchAll(/^enum (\w+)/gm)].map((m) => m[1]);
    expect(enums.filter((n) => /polic|authority|resolution|scope/i.test(n ?? ""))).toEqual(["SourceAuthorityStatus"]);
  });

  it("SourceDocument.authorityStatus is untouched — still nullable descriptive metadata — and gained only a back-relation list", () => {
    expect(find("SourceDocument")?.body).toMatch(/authorityStatus\s+SourceAuthorityStatus\?/);
    expect(fieldNames(find("SourceDocument")?.body)).toEqual(
      ["authorityRecords", "authorityStatus", "createdAt", "fileReference", "id", "notes", "references", "sourceType", "title", "versionLabel"],
    );
  });

  it("the uniqueness the design needs is declared: one version per Ruleset, one record per document per scope per policy", () => {
    expect(find("CanonPolicy")?.body).toMatch(/@@unique\(\[rulesetId,\s*policyVersion\]/);
    expect(find("SourceAuthorityRecord")?.body).toMatch(/@@unique\(\[canonPolicyId,\s*sourceDocumentId,\s*scopeKey\]/);
  });

  it("no current/active/effective policy exists: no such identifier in the schema, and nothing but Ruleset's list mentions a policy outside the two policy models", () => {
    expect(SCHEMA).not.toMatch(/(currentPolicy|activePolicy|effectivePolicy\w*|useLatestPolicy|current_policy\w*|active_policy\w*|effective_policy\w*|use_latest_policy|isCurrent|isActive)/);
    for (const model of models.filter((m) => !["CanonPolicy", "SourceAuthorityRecord"].includes(m.name))) {
      const lines = model.body.split("\n").filter((line) => /polic/i.test(line));
      if (model.name === "Ruleset") {
        expect(lines.map((l) => l.trim().replace(/\s+/g, " "))).toEqual(["canonPolicies CanonPolicy[]"]);
      } else if (model.name === "RulesetRelease") {
        // M2-WO8: a release pins ONE exact policy id (composite with its Ruleset) — never a current/latest pointer.
        expect(lines.map((l) => l.trim().replace(/\s+/g, " "))).toEqual([
          'canonPolicyId String @map("canon_policy_id") @db.Uuid',
          'canonPolicy CanonPolicy @relation(fields: [canonPolicyId, rulesetId], references: [id, rulesetId], onDelete: Restrict, onUpdate: Cascade, map: "ruleset_releases_policy_fkey")',
          '@@index([canonPolicyId], map: "ruleset_releases_canon_policy_id_idx")',
        ]);
      } else if (model.name === "CanonDecision") {
        // M2-WO6: a decision pins ONE exact policy id (composite with its Ruleset) — never a current/latest pointer.
        expect(lines.map((l) => l.trim().replace(/\s+/g, " "))).toEqual([
          'canonPolicyId String @map("canon_policy_id") @db.Uuid',
          'canonPolicy CanonPolicy @relation(fields: [canonPolicyId, rulesetId], references: [id, rulesetId], onDelete: Restrict, onUpdate: Cascade, map: "canon_decisions_policy_fkey")',
          '@@index([canonPolicyId], map: "canon_decisions_canon_policy_id_idx")',
        ]);
      } else {
        expect(lines, `${model.name} must not reference a policy`).toEqual([]);
      }
    }
  });
});

describe("M2-WO4 — policy code never selects content, reads manifests, or infers authority", () => {
  const FORBIDDEN =
    /\b(getLatestEntityVersion|selectLatestEntityVersion|listEntityVersions|selectEntityVersionById|getEntityVersion|latestRevision|revisionNumber|EntityVersionStatus|resolveEffectiveEntityVersion|getEffectiveManifestEntries|resolveEntityVersionFromManifest|createRulesetManifest|getRulesetManifest|getManifestEntry|listRulesetManifests|getLatestRulesetManifest|selectLatestRulesetManifest|insertRulesetManifestWithEntries|selectRulesetManifestById|selectManifestEntry|selectManifestEntries|parentRulesetId|parentManifestId|selectRulesetAncestors|checkParentAssignment|keyword|Keyword|EntityRelationship|relationship|CANON)\b/;
  const CURRENT_POINTERS =
    /\b(currentPolicy|activePolicy|effectivePolicy\w*|useLatestPolicy|use_latest_policy|current_policy\w*|active_policy\w*|isCurrent|isActive|is_current|is_active)\b/;

  it.each(policySources.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const code = stripTs(readFileSync(file as string, "utf8"));
    expect(code, "no EntityVersion selection, manifest access, parent/inheritance lookup, keyword or relationship logic").not.toMatch(FORBIDDEN);
    expect(code, "no status test").not.toMatch(/\.status\b/);
    expect(code, "no SQL-style latest-revision inference").not.toMatch(/MAX\s*\(|ORDER\s+BY[^;\n]*revision/i);
    expect(code, "no current / active / effective policy pointer").not.toMatch(CURRENT_POINTERS);
    // "latest" may appear ONLY as the two explicitly named highest-policy_version operations.
    expect(code.replace(/\b(getLatestCanonPolicy|selectLatestCanonPolicy)\b/g, ""), "'latest' means only highest policy_version").not.toMatch(/latest/i);
  });

  it("the db policy code reaches only the policy repository, the Ruleset and SourceDocument existence lookups, and the model", () => {
    const allowed = new Set([
      "@prowess/model",
      "../client.js",
      "../prisma-errors.js",
      "../ruleset/repository.js",
      "../source-document/repository.js",
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

  it("resolution and exact lookup read ONLY the requested policy: no other policy, no Ruleset, no parent", () => {
    const service = stripTs(read("packages", "prowess-db", "src", "canon-policy", "service.ts"));
    for (const fn of ["resolveSourceAuthority", "getSourceAuthorityRecord"]) {
      const body = new RegExp(`export async function ${fn}\\([\\s\\S]*?\\n\\}\\n`).exec(service)?.[0] ?? "";
      expect(body.length, fn).toBeGreaterThan(200);
      expect(body, `${fn} must look up declarations inside the one requested policy`).toMatch(/selectSourceAuthorityRecord\(policy\.id/);
      expect(body, `${fn} must not read another policy, a Ruleset, or a parent`).not.toMatch(
        /selectCanonPoliciesByRuleset|selectLatestCanonPolicy|getLatestCanonPolicy|listCanonPolicies|selectRulesetById|requireRuleset|parentRulesetId/,
      );
    }
  });

  it("authority is never inferred: no date, version label, reference count, status, or channel feeds the resolver", () => {
    const code = stripTs(read("packages", "prowess-model", "src", "source-authority-resolution.ts"));
    expect(code).not.toMatch(/createdAt|versionLabel|fileReference|references|channel|\.status|count|length/);
  });

  it("the scope validator reuses the existing canonical-key grammar and defines no key pattern of its own", () => {
    const code = stripTs(read("packages", "prowess-model", "src", "source-authority-scope.ts"));
    expect(code).toMatch(/import \{ isValidCanonicalKey \} from "\.\/canonical-key\.js"/);
    expect(code).not.toMatch(/\[a-z0-9_\]/); // the canonical-key character class is not re-declared here
  });

  it("the authority vocabulary is defined once: no second list of statuses exists in model or db source", () => {
    const holders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) && stripTs(readFileSync(full, "utf8")).includes("CURRENT_PRIMARY")) holders.push(path.relative(ROOT, full));
      }
    };
    walk(path.join(ROOT, "packages", "prowess-model", "src"));
    walk(path.join(ROOT, "packages", "prowess-db", "src"));
    expect(holders).toEqual([path.join("packages", "prowess-model", "src", "source-authority-status.ts")]);
  });
});

describe("M2-WO4 — scope boundaries", () => {
  const exportsOf = (text: string, from: RegExp) =>
    [...text.matchAll(from)].flatMap((m) => (m[1] as string).split(",").map((n) => n.trim()).filter(Boolean)).sort();

  it("exposes exactly six policy operations; nothing updates, sets, removes, activates or publishes a policy", () => {
    const names = [
      "createCanonPolicy",
      "getCanonPolicy",
      "getLatestCanonPolicy",
      "getSourceAuthorityRecord",
      "listCanonPolicies",
      "resolveSourceAuthority",
    ];
    expect(exportsOf(stripTs(read("packages", "prowess-db", "src", "canon-policy", "index.ts")), /export \{([^}]*)\} from/g)).toEqual(names);
    expect(exportsOf(read("packages", "prowess-db", "src", "index.ts"), /export \{([^}]*)\} from "\.\/canon-policy\/index\.js"/g)).toEqual(names);
    const mutator = /^(set|change|rebase|reparent|update|add|remove|delete|patch|upsert|activate|publish|promote)/i;
    expect(names.filter((n) => mutator.test(n))).toEqual([]);
    // Control: the matcher must flag genuine mutators, so the check above cannot silently stop working.
    expect(["updateCanonPolicy", "activateCanonPolicy", "setSourceAuthority"].filter((n) => mutator.test(n))).toHaveLength(3);
  });

  it("the migration adds only the two policy tables, their constraints and indexes — no enum, no other table touched", () => {
    const sql = read(...MIGRATION);
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["canon_policies", "source_authority_records"]);
    expect(sql).not.toMatch(/CREATE TYPE|DROP |ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/);
    expect([...new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(["canon_policies", "source_authority_records"]);
    expect([...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "(\w+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ["canon_policies_ruleset_id_policy_version_key", "canon_policies"],
      ["source_authority_records_source_document_id_idx", "source_authority_records"],
      ["source_authority_records_policy_source_scope_key", "source_authority_records"],
    ]);
    expect([...sql.matchAll(/ON DELETE RESTRICT/g)]).toHaveLength(3);
    expect(sql).toMatch(/"authority_status" "SourceAuthorityStatus" NOT NULL/);
    expect(sql).toMatch(/REFERENCES "rulesets"\("id"\)/);
    expect(sql).toMatch(/REFERENCES "source_documents"\("id"\)/);
    expect(sql).not.toMatch(/ruleset_manifest|entity_version|"entities"|source_references/);
  });

  it("the approved M2-WO1, M2-WO2 and M2-WO3 migrations are byte-for-byte unchanged", () => {
    const base = ["packages", "prowess-db", "prisma", "migrations"];
    expect(sha256(...base, "20261004233000_add_ruleset_foundation", "migration.sql")).toBe("a081c52eb2e3760520b488613136e0c08294633cba9386ed68998056ac54a8a6");
    expect(sha256(...base, "20261005001500_add_ruleset_manifest", "migration.sql")).toBe("31f2aa6c695444d75150c90299d6dbd9b302cc6e87a0dd60c821196a3d1dc14c");
    expect(sha256(...base, "20261005120000_add_manifest_inheritance", "migration.sql")).toBe("5fb2a0707fcffe93357b5e489af594db51ec2aabc0082893cd53230debbe4ea0");
  });

  it("no policy / authority / Canon UI exists outside the M2-WO10 governance workspace (those have their own Work Orders) — the HTTP API arrived in M2-WO9 (pinned by m2-api-static)", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        // M2-WO9: the HTTP API now exists; its exact route inventory is pinned by m2-api-static. UI is still WO10's.
        if (path.join(dir, entry) === path.join(ROOT, "apps", "studio", "app", "api")) continue;
        // M2-WO10: the Ruleset & Canon governance UI now exists; its boundaries are pinned by m2-ui-static.
        if (path.join(dir, entry) === path.join(ROOT, "apps", "studio", "app", "developer", "rulesets")) continue;
        const full = path.join(dir, entry);
        if (/polic|authority|canon/i.test(entry)) found.push(path.relative(ROOT, full));
        if (statSync(full).isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, "apps", "studio", "app"));
    walk(path.join(ROOT, "apps", "studio", "src"));
    expect(found).toEqual([]);
  });
});
