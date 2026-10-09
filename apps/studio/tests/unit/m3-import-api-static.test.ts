// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3-WO7 static audit — the Import HTTP API is a thin transport layer. Pins the exact route / method inventory (and the
 * documented API matrix), the six mutating commands and the service each calls; forbids PATCH / PUT / DELETE, status /
 * approve / reject / materialization / RuleConflict routes, Prisma / repository / @prowess/import imports, and inline
 * import-domain logic.
 */
const STUDIO = process.cwd();
const ROOT = path.resolve(STUDIO, "..", "..");
const API = path.join(STUDIO, "app", "api", "import");
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
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (r: string) => strip(readFileSync(path.join(API, r, "route.ts"), "utf8"));

const EXPECTED: Record<string, string[]> = {
  "source-snapshots": ["GET", "POST"],
  "source-snapshots/[snapshotId]": ["GET"],
  "source-snapshots/[snapshotId]/structure": ["GET"],
  "source-sections/[sectionId]": ["GET"],
  "source-sections/[sectionId]/children": ["GET"],
  "source-sections/[sectionId]/contents": ["GET"],
  "source-blocks/[blockId]": ["GET"],
  "source-tables/[tableId]": ["GET"],
  "source-assets/[assetId]": ["GET"],
  batches: ["GET", "POST"],
  "batches/[batchId]": ["GET"],
  "batches/[batchId]/extract": ["POST"],
  "batches/[batchId]/extraction-result": ["GET"],
  "batches/[batchId]/verify-extraction": ["GET"],
  "batches/[batchId]/candidates": ["GET"],
  "batches/[batchId]/summary": ["GET"],
  "batches/[batchId]/match-runs": ["GET", "POST"],
  "batches/[batchId]/conflicts": ["GET"],
  "batches/[batchId]/decisions": ["GET"],
  "batches/[batchId]/review-summary": ["GET"],
  "batches/[batchId]/complete-review": ["POST"],
  "candidates/[candidateId]": ["GET"],
  "candidates/[candidateId]/decisions": ["GET", "POST"],
  "decisions/[decisionId]": ["GET"],
  "match-runs/[matchRunId]": ["GET"],
  "match-runs/[matchRunId]/assessments": ["GET"],
  "match-runs/[matchRunId]/candidates/[candidateId]/assessment": ["GET"],
  "match-runs/[matchRunId]/duplicate-groups": ["GET"],
};

/** Mutating command -> the ONE service it calls. */
const COMMANDS: Record<string, string> = {
  "source-snapshots": "createSourceSnapshot",
  batches: "createImportBatch",
  "batches/[batchId]/extract": "extractImportBatch",
  "batches/[batchId]/match-runs": "analyzeImportBatchMatches",
  "candidates/[candidateId]/decisions": "reviewImportCandidate",
  "batches/[batchId]/complete-review": "completeImportReview",
};

describe("M3-WO7 — route inventory", () => {
  it("has exactly the expected routes and methods — no PATCH, PUT, DELETE or extra route", () => {
    expect(Object.fromEntries(files.map((f) => [rel(f), methods(readFileSync(f, "utf8"))]))).toEqual(EXPECTED);
  });

  it("matches the documented API matrix in docs/architecture/m3-import-api.md exactly", () => {
    const doc = readFileSync(path.join(ROOT, "docs", "architecture", "m3-import-api.md"), "utf8");
    const rows = [...doc.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| \/api\/import\/(\S+) \| (\w+) \| (yes|no) \|/gm)].map((m) => ({ method: m[1] as string, route: m[2] as string, service: m[3] as string, mutation: m[4] === "yes" }));
    const fromDoc: Record<string, string[]> = {};
    for (const r of rows) fromDoc[r.route] = [...(fromDoc[r.route] ?? []), r.method].sort();
    expect(fromDoc).toEqual(EXPECTED);
    for (const r of rows) {
      expect(src(r.route), `${r.method} ${r.route} calls ${r.service}`).toMatch(new RegExp(`\\b${r.service}\\(`));
      expect(r.mutation, `${r.method} ${r.route}`).toBe(r.method === "POST");
    }
  });

  it("no generic status / approve / reject / materialization / RuleConflict route exists", () => {
    for (const f of files) {
      expect(rel(f)).not.toMatch(/(^|\/)(status|approve|reject|update|edit|delete|set-\w+|materialize|create-entity|create-version|create-keyword|apply(-import)?|rule-conflicts?|create-rule-conflict|record-candidates)(\/|$)/);
    }
  });

  it("exactly six commands mutate, each through exactly its own service", () => {
    const posts = files.filter((f) => methods(readFileSync(f, "utf8")).includes("POST")).map(rel).sort();
    expect(posts).toEqual(Object.keys(COMMANDS).sort());
    const mutators = Object.values(COMMANDS);
    for (const f of files) {
      const s = strip(readFileSync(f, "utf8"));
      const called = mutators.filter((m) => new RegExp(`\\b${m}\\(`).test(s));
      expect(called, rel(f)).toEqual(COMMANDS[rel(f)] ? [COMMANDS[rel(f)]] : []);
      expect(s, rel(f)).not.toMatch(/\b(recordExtractionCandidates|ingestSourceSnapshot|ingestSourceStructure|createEntity|createEntityVersion|createEntityAlias|createKeyword\w*|createRuleConflict|createCanonDecision|createChangeSet|publishRulesetRelease|createRulesetManifest)\(/);
    }
  });
});

describe("M3-WO7 — routes are thin adapters over the public service surface", () => {
  const FORBIDDEN_LOGIC =
    /\b(prisma|createHash|sha256|canonicalJson|extractionSetHash|importBatchFingerprint|extractionCandidateFingerprint|importDecisionFingerprint|importMatchRunFingerprint|entityCatalogHash|editSimilarity|runExtraction|runMatching|analyzeConflictSignals|ruleFor|IMPORT_DECISION_RULES|TERMINAL_CANDIDATE_STATUSES|normalizeEntityAlias|sectionSubtree|DEVELOPMENT_MODE)\b|process\.env|\.sort\(|toStatus|fromStatus|sequenceNumber\s*[+:]/;

  it.each(files.map((f) => [rel(f), f]))("%s", (_name, file) => {
    const s = strip(readFileSync(file as string, "utf8"));
    for (const i of [...s.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string)) {
      expect(i, `${rel(file as string)} imports ${i}`).toMatch(/^(@prowess\/db|@prowess\/model|(\.\.\/)+src\/api\/(index|m2\/index|import\/index))$/);
    }
    expect(s, "no domain logic in a route").not.toMatch(FORBIDDEN_LOGIC);
    expect(s, "every handler maps errors centrally").toMatch(/return toErrorResponse\(error\);/);
    expect([...s.matchAll(/catch \(error\)/g)].length).toBe(methods(s).length);
    expect(s, "no route-local status mapping").not.toMatch(/status:\s*(4|5)\d\d|NextResponse/);
    for (const m of [...s.matchAll(/apiSuccess\([^;]*?,\s*([^)]+)\)\s*;/g)].map((x) => x[1] as string)) expect(m.trim()).toMatch(/^(201|result\.created \? 201 : 200)$/);
  });

  it("the forbidden-logic pattern catches what it should (control)", () => {
    for (const c of ["prisma.importBatch.update", "candidates.sort((a, b) => 0)", "ruleFor(t, s, k)", "canonicalJson(x)", "process.env.X", "toStatus: \"APPROVED\"", "editSimilarity(a, b)"]) expect(c).toMatch(FORBIDDEN_LOGIC);
  });

  it("the shared import request helpers import nothing but the local API helpers", () => {
    for (const f of ["input.ts", "index.ts"]) {
      const s = strip(readFileSync(path.join(STUDIO, "src", "api", "import", f), "utf8"));
      for (const i of [...s.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string)) expect(i, `${f}: ${i}`).toMatch(/^\.\.?\//);
      expect(s).not.toMatch(/@prowess\/(db|import)|prisma|DEVELOPMENT_MODE/);
    }
  });

  it("commands without input accept no body, and server-controlled fields are not in any accepted-field list", () => {
    for (const r of ["batches/[batchId]/extract", "batches/[batchId]/complete-review"]) expect(src(r)).toMatch(/await requireNoBody\(request\);/);
    const accepted = (r: string) => [...src(r).matchAll(/readStrictBody\(request, \[([^\]]*)\]\)/g)].flatMap((m) => [...(m[1] as string).matchAll(/"(\w+)"/g)].map((x) => x[1]));
    const SERVER = ["status", "createdAt", "id"];
    expect(accepted("batches").filter((f) => [...SERVER, "batchFingerprint", "sourceStructureHash", "extractionOutputHash", "extractedAt"].includes(f as string))).toEqual([]);
    expect(accepted("candidates/[candidateId]/decisions").filter((f) => [...SERVER, "sequenceNumber", "decisionFingerprint", "fromStatus", "toStatus", "candidateSetHash", "extractionCandidateId"].includes(f as string))).toEqual([]);
    expect(accepted("batches/[batchId]/match-runs")).toEqual(["matcherKey", "matcherVersion", "matcherConfig"]);
    expect(accepted("source-snapshots").filter((f) => SERVER.includes(f as string))).toEqual([]);
    expect(src("batches/[batchId]/conflicts")).toMatch(/queryUuid\(searchParams, "matchRunId", true\)/);
  });
});

describe("M3-WO7 — no UI change, no DEVELOPMENT_MODE leak", () => {
  it("no page, component or client outside the API references the Import API", () => {
    const studio = (d: string, out: string[] = []) => {
      for (const e of readdirSync(d)) {
        const f = path.join(d, e);
        if (statSync(f).isDirectory()) {
          if (!["node_modules", ".next", "api"].includes(e)) studio(f, out);
        } else if (/\.(ts|tsx)$/.test(e)) out.push(f);
      }
      return out;
    };
    for (const f of [...studio(path.join(STUDIO, "app")), ...studio(path.join(STUDIO, "src", "api-client"))]) expect(readFileSync(f, "utf8"), f).not.toMatch(/\/api\/import/);
  });
});
