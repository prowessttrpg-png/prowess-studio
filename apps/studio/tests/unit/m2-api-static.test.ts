// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO9 static audit — the Ruleset / Canon HTTP API is a thin transport layer. Pins the exact route
 * inventory; forbids DELETE / PATCH / PUT and generic status setters; forbids Prisma, generated-client and
 * repository imports; forbids re-implementing domain logic (allocation, hashing, inheritance walking,
 * decision translation, ChangeSet application, authority selection, disposition mapping) in route handlers.
 */
const STUDIO = process.cwd();
const API = path.join(STUDIO, "app", "api");
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f);
    else if (e === "route.ts") files.push(f);
  }
};
walk(API);
const rel = (f: string) => path.relative(API, path.dirname(f)).split(path.sep).join("/");
const methods = (src: string) => [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]).sort();
const M1_PREFIXES = ["entities", "entity-aliases", "entity-versions", "keyword-categories", "keywords", "relationships", "source-documents", "source-references"];
// M3-WO7's /api/import/* routes are the M3 Import API, pinned by m3-import-api-static (not part of the M2 surface).
const m2Files = files.filter((f) => ![...M1_PREFIXES, "import"].some((p) => rel(f) === p || rel(f).startsWith(`${p}/`)));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const EXPECTED: Record<string, string[]> = {
  rulesets: ["GET", "POST"],
  "rulesets/[rulesetId]": ["GET"],
  "rulesets/[rulesetId]/submit-review": ["POST"],
  "rulesets/[rulesetId]/approve": ["POST"],
  "rulesets/[rulesetId]/manifests": ["GET", "POST"],
  "rulesets/[rulesetId]/manifests/latest": ["GET"],
  "ruleset-manifests/[manifestId]": ["GET"],
  "ruleset-manifests/[manifestId]/effective": ["GET"],
  "ruleset-manifests/[manifestId]/resolve/[entityId]": ["GET"],
  "rulesets/[rulesetId]/canon-policies": ["GET", "POST"],
  "rulesets/[rulesetId]/canon-policies/latest": ["GET"],
  "canon-policies/[policyId]": ["GET"],
  "canon-policies/[policyId]/source-authorities": ["GET"],
  "canon-policies/[policyId]/source-authority/resolve": ["GET"],
  "rulesets/[rulesetId]/rule-conflicts": ["GET", "POST"],
  "rule-conflicts/[conflictId]": ["GET"],
  "rule-conflicts/[conflictId]/canon-decisions": ["GET", "POST"],
  "canon-decisions/[decisionId]": ["GET"],
  "rulesets/[rulesetId]/canon-decisions": ["GET"],
  "canon-decisions/[decisionId]/propose-change-set": ["POST"],
  "rulesets/[rulesetId]/change-sets": ["GET", "POST"],
  "change-sets/[changeSetId]": ["GET"],
  "change-sets/[changeSetId]/impact": ["GET"],
  "change-sets/[changeSetId]/submit-review": ["POST"],
  "change-sets/[changeSetId]/approve": ["POST"],
  "change-sets/[changeSetId]/reject": ["POST"],
  "rulesets/[rulesetId]/releases": ["GET", "POST"],
  "rulesets/[rulesetId]/releases/latest": ["GET"],
  "ruleset-releases/[releaseId]": ["GET"],
  "ruleset-releases/[releaseId]/verify-manifest-hash": ["GET"],
  "ruleset-releases/[releaseId]/compare/[otherReleaseId]": ["GET"],
};

describe("M2-WO9 — the M2 route inventory is exactly the WO's (§8–§44, §83)", () => {
  it("has exactly the expected routes and methods — no DELETE, PATCH, PUT, or extra route", () => {
    expect(Object.fromEntries(m2Files.map((f) => [rel(f), methods(readFileSync(f, "utf8"))]))).toEqual(EXPECTED); // key order is irrelevant to toEqual
  });
  it("no generic status / mutation route exists anywhere under the M2 surface (§12, §36, §50–§56)", () => {
    for (const f of m2Files) {
      expect(rel(f), rel(f)).not.toMatch(/(^|\/)(status|edit|update|delete|add-entry|remove-entry|replace-entry|apply|execute|relabel|set-\w+)(\/|$)/);
    }
    const commandDirs = m2Files.map(rel).filter((r) => /\/(submit-review|approve|reject|propose-change-set)$/.test(r));
    expect(commandDirs.sort()).toEqual([
      "canon-decisions/[decisionId]/propose-change-set",
      "change-sets/[changeSetId]/approve",
      "change-sets/[changeSetId]/reject",
      "change-sets/[changeSetId]/submit-review",
      "rulesets/[rulesetId]/approve",
      "rulesets/[rulesetId]/submit-review",
    ]);
  });
  it("exactly ONE route calls publishRulesetRelease, and no route calls a lifecycle function other than its own command (§39)", () => {
    const callers = m2Files.filter((f) => /publishRulesetRelease\(/.test(strip(readFileSync(f, "utf8")))).map(rel);
    expect(callers).toEqual(["rulesets/[rulesetId]/releases"]);
    const proposers = m2Files.filter((f) => /proposeChangeSetFromCanonDecision\(/.test(strip(readFileSync(f, "utf8")))).map(rel);
    expect(proposers).toEqual(["canon-decisions/[decisionId]/propose-change-set"]);
  });
});

describe("M2-WO9 — routes are thin adapters over the public service surface (§1, §57–§59)", () => {
  const FORBIDDEN_LOGIC =
    // Operator-bearing patterns sit OUTSIDE the \b(...)\b group: a trailing \b after "+" or "(" never matches.
    /\b(prisma|createHash|sha256|canonicalManifestText|computeManifestHash|planChangeSetApplication|translateDecisionToOperations|resolveAuthorityFromDeclarations|ruleConflictStatusForDisposition|isValid\w*Transition|revisionNumber|getLatestEntityVersion|selectLatest\w*|DECIDABLE_RULE_CONFLICT_STATUSES|GOVERNING|DEVELOPMENT_MODE)\b|process\.env|\b(manifestVersion|policyVersion|releaseNumber)\s*\+|\bparentManifestId\s*[!=]==|\.sort\(/;
  it.each(m2Files.map((f) => [rel(f), f]))("%s", (_name, file) => {
    const src = strip(readFileSync(file as string, "utf8"));
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
    for (const i of imports) {
      expect(i, `${rel(file as string)} imports ${i}`).toMatch(/^(@prowess\/db|@prowess\/model|(\.\.\/)+src\/api\/(index|m2\/index))$/);
      expect(i).not.toMatch(/@prisma|generated|repository|\/src\/(?!api)/);
    }
    expect(src, "no domain logic in a route").not.toMatch(FORBIDDEN_LOGIC);
    expect(src, "every handler maps errors centrally").toMatch(/return toErrorResponse\(error\);/);
    expect([...src.matchAll(/catch \(error\)/g)].length).toBe(methods(src).length);
    expect(src, "no route-local status mapping").not.toMatch(/status:\s*(4|5)\d\d|NextResponse\.json\([^)]*status:\s*(4|5)/);
  });
  it("the forbidden-logic pattern catches what it should (control)", () => {
    for (const c of ["computeManifestHash(pins)", "x.revisionNumber", "manifestVersion + 1", "releaseNumber+1", "prisma.ruleset.update", "items.sort((a, b) => 0)", "process.env.X"]) expect(c).toMatch(FORBIDDEN_LOGIC);
  });
  it("the shared M2 request helpers import no service, no Prisma and no domain logic", () => {
    for (const f of ["input.ts", "list.ts", "index.ts"]) {
      const src = strip(readFileSync(path.join(STUDIO, "src", "api", "m2", f), "utf8"));
      for (const i of [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string)) expect(i, `${f}: ${i}`).toMatch(/^\.\.?\//);
    }
  });
});
