// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3-WO8 static audit — the Import Studio is UI only: no backend, schema, migration or route change; no database or
 * algorithm import; network only through the typed client to approved /api routes; no materialization / Canon /
 * publish affordance; and the user-facing terminology distinctions are pinned.
 */
const STUDIO = process.cwd();
const ROOT = path.resolve(STUDIO, "..", "..");
const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d)) {
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(f);
  }
  return out;
};
const UI = walk(path.join(STUDIO, "app", "developer", "import"));
const CLIENT = path.join(STUDIO, "src", "api-client", "import.ts");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => path.relative(STUDIO, f);
/** JSX text and string literals only (what a user can read), comments removed. */
const visible = (src: string) => [...strip(src).matchAll(/>([^<>{}]+)</g), ...strip(src).matchAll(/"([^"\n]{3,})"/g)].map((m) => (m[1] as string).trim()).filter(Boolean);

describe("M3-WO8 — UI only", () => {
  it("finds the Import Studio pages, components and client", () => {
    expect(UI.filter((f) => f.endsWith("page.tsx")).map((f) => path.relative(path.join(STUDIO, "app"), path.dirname(f)).split(path.sep).join("/")).sort()).toEqual([
      "developer/import",
      "developer/import/batches",
      "developer/import/batches/[batchId]",
      "developer/import/sources",
      "developer/import/sources/[snapshotId]",
    ]);
  });

  it("introduces no schema change, migration or new Import API route", () => {
    const dir = path.join(ROOT, "packages", "prowess-db", "prisma", "migrations");
    const migrations = readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory()).sort();
    expect(migrations.length).toBe(22);
    expect(migrations.at(-1)).toBe("20261015010000_add_import_decisions");
    const routes: string[] = [];
    const visit = (d: string) => {
      for (const e of readdirSync(d)) {
        const f = path.join(d, e);
        if (statSync(f).isDirectory()) visit(f);
        else if (e === "route.ts") routes.push(f);
      }
    };
    visit(path.join(STUDIO, "app", "api", "import"));
    expect(routes.length).toBe(28); // the WO7 inventory, pinned route-by-route in m3-import-api-static
  });

  it.each([...UI, CLIENT].map((f) => [rel(f), f]))("%s imports no database, Prisma, repository or import algorithm", (_n, f) => {
    for (const i of [...strip(readFileSync(f as string, "utf8")).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string)) {
      expect(i, i).not.toMatch(/^@prowess\/(db|import)|@prisma|^prisma$|generated\/prisma|repository/);
    }
  });

  it("only the client calls the network, and only GET / POST on relative /api/import URLs", () => {
    for (const f of UI) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\bfetch\(|XMLHttpRequest|https?:\/\//);
    const client = strip(readFileSync(CLIENT, "utf8"));
    expect(client).not.toMatch(/\b(PATCH|PUT|DELETE)\b|\bfetch\(/);
    for (const m of client.matchAll(/[`"](\/[^`"$]*)/g)) expect(m[1]).toMatch(/^\/api\/import\//);
    const posts = [...client.matchAll(/export const (\w+) = [^=]*=>\s*apiPost/g)].map((m) => m[1]).sort();
    expect(posts).toEqual(["analyzeMatches", "completeImportReview", "createImportBatch", "extractImportBatch", "submitDecision"]);
  });

  it("decision requests cannot carry server-controlled fields", () => {
    const client = strip(readFileSync(CLIENT, "utf8"));
    const req = /export interface DecisionRequest \{([^}]*)\}/.exec(client)?.[1] ?? "";
    expect([...req.matchAll(/(\w+)\??:/g)].map((m) => m[1])).toEqual(["candidateFingerprint", "decisionType", "matchBasis", "targetEntityId", "matchRunId", "matchAssessmentId", "duplicateGroupId", "comparisonEntityVersionId", "rationale"]);
    const batch = /export interface CreateBatchRequest \{([\s\S]*?)\n\}/.exec(client)?.[1] ?? "";
    expect(batch).not.toMatch(/status|Fingerprint|Hash|extractedAt|createdAt/);
  });

  it("the browser keeps no workflow graph of its own — actions come from the shared @prowess/model rules", () => {
    const pres = strip(readFileSync(path.join(STUDIO, "app", "developer", "import", "_lib", "presentation.ts"), "utf8"));
    expect(pres).toMatch(/IMPORT_DECISION_RULES\[t\]/);
    for (const f of UI) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/fromStatuses:\s*\[|toStatus:\s*"|\.sort\(|createHash|canonicalJson|editSimilarity|analyzeConflictSignals|ruleFor\(/);
  });
});

describe("M3-WO8 — no materialization, no Canon, no publishing", () => {
  it("no control or label claims to publish, apply to Canon, materialize or create Versions / Entities / RuleConflicts", () => {
    const CLAIM = /\b(publish(es|ed)?|apply to canon|materiali[sz]e|create (version|entity|rule ?conflict|keyword|formula)|imported|applied)\b/i;
    const NEGATED = /\b(not|no|never|nothing|does not|doesn['’]t|isn['’]t|without)\b/i;
    for (const f of UI) {
      for (const text of visible(readFileSync(f, "utf8"))) {
        if (CLAIM.test(text)) expect(text, `${rel(f)}: "${text}" must be explanatory (negated)`).toMatch(NEGATED);
      }
    }
  });

  it("buttons are only the approved commands and navigation", () => {
    const labels = UI.flatMap((f) => [...strip(readFileSync(f, "utf8")).matchAll(/<button[^>]*>\s*([^<{]+?)\s*</g)].map((m) => m[1] as string));
    for (const l of labels) expect(l).not.toMatch(/publish|canon|materiali|delete|edit|set status|apply/i);
  });
});

describe("M3-WO8 — terminology", () => {
  it("prominent statuses read Approved for Import / Review Complete / Import Conflict", () => {
    const pres = readFileSync(path.join(STUDIO, "app", "developer", "import", "_lib", "presentation.ts"), "utf8");
    expect(pres).toMatch(/APPROVED: "Approved for Import"/);
    expect(pres).toMatch(/COMPLETED: "Review Complete"/);
    expect(pres).toMatch(/CONFLICT: "Import Conflict"/);
    expect(pres).toMatch(/CONFLICT: "Import review conflict\. This is not yet a Ruleset RuleConflict\."/);
    for (const f of UI) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/>\s*(Canonical|Official|Published|Imported)\s*</);
  });

  it("upload is honestly absent: no file input, no upload button", () => {
    for (const f of UI) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/type="file"|FileReader|<button[^>]*>\s*Upload/i);
    }
    expect(readFileSync(path.join(STUDIO, "app", "developer", "import", "sources", "page.tsx"), "utf8")).toContain("Document upload is not yet available in the Phase 1 Studio.");
  });
});

describe("M3-WO8 — documentation", () => {
  it("documents the boundaries, the no-upload limitation, the layouts and the roadmap", () => {
    const doc = readFileSync(path.join(ROOT, "docs", "architecture", "m3-import-studio-ui.md"), "utf8");
    for (const phrase of ["APPROVED FOR IMPORT", "REVIEW COMPLETE", "PUBLISHED", "[QUEUE] [SOURCE] [DETAILS] [HISTORY]", "Document upload is not yet", "no production `/seed` route"]) expect(doc).toContain(phrase);
    expect(doc).toMatch(/WO8[\s\S]*WO9[\s\S]*WO10/);
  });
});
