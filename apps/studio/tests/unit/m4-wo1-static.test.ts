// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO1 static architecture audit for @prowess/rules (PAS-10 M4-WO1 §63–64). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md:
 * M4-I02 No Hidden Latest · M4-I03 Pure Deterministic Evaluation (no module-level mutable state) · M4-I04 No Arbitrary
 * Code Execution · M4-I05 No Wall-Clock Dependency · M4-I06 No Randomness · M4-I07 No Network Dependency ·
 * M4-I12 Engine Does Not Choose Canon · M4-I14 Listed Cost and Payment Remain Distinct Concepts ·
 * M4-I15 Runtime Mutation Is Outside Pure Evaluation — plus dependency boundaries, no Prowess-specific mechanics, no
 * M3 import-review coupling, CI integration, and the invariant coverage matrix.
 *
 * The scanner is a plain function so its control tests (below) prove it catches each forbidden pattern using
 * in-memory snippets — no intentionally broken file is ever committed.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const RULES = path.join(ROOT, "packages", "prowess-rules");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d)) {
    if (["node_modules", "dist"].includes(e)) continue;
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};
/** Comments removed (string contents kept: a forbidden call hidden in a string would still be caught). */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ALL_TS = walk(path.join(RULES, "src")).filter((f) => f.endsWith(".ts"));
/** Production engine code: excludes tests and the non-exported test-support folder. */
const PRODUCTION = ALL_TS.filter((f) => !f.endsWith(".test.ts") && !rel(f).includes("/src/testing/"));

type Rule = { id: string; pattern: RegExp };

/** Forbidden patterns in production @prowess/rules code. */
const FORBIDDEN: Rule[] = [
  { id: "database", pattern: /prisma|PrismaClient|\$queryRaw|\$executeRaw|postgres|\bfrom\s+["']pg["']/i },
  { id: "framework", pattern: /\bfrom\s+["'](react|react-dom|next)(\/[^"']*)?["']|\bReact\.|\bJSX\b/ },
  { id: "network", pattern: /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|\bnavigator\.|https?:\/\/|openai|anthropic|\bclaude\b/i },
  { id: "filesystem", pattern: /\bfs\.|readFileSync|writeFileSync|readFile\s*\(|\bprocess\.|\bBuffer\b|__dirname/ },
  { id: "randomness", pattern: /Math\.random|randomUUID|getRandomValues|randomBytes|\bcrypto\b/ },
  { id: "clock", pattern: /Date\.now|new\s+Date\b|\bDate\s*\(|performance\.now|hrtime|setTimeout|setInterval|setImmediate/ },
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bvm\.|runInNewContext|runInThisContext|\bimport\s*\(|\brequire\s*\(/ },
  { id: "hidden-latest", pattern: /latest|newest|mostRecent|getCurrent\w*|findCurrent\w*|currentVersion|isCurrent\b/i },
  { id: "canon-choice", pattern: /\bcanon(?!ical)\w*|isCanon|GOVERNING|chooseRuleset|selectRuleset|resolveRuleset/i },
  { id: "cost-payment-merge", pattern: /effectiveCost|effective_cost/i },
  // M4-WO7's pure resource transitions (spendResource, applyResourcePayment) return new immutable state and persist
  // nothing; they are the only allowed names of this shape. Any other such function still fails.
  { id: "runtime-mutation", pattern: /\bfunction\s+(?!spendResource\s*\(|applyResourcePayment\s*\()(commit|pay|spend|deduct|consume|mutate|apply|persist|save)\w*\s*\(/i },
  { id: "import-review-coupling", pattern: /ImportCandidate|ImportDecision|ExtractionCandidate|ImportBatch|ImportMatch|ImportReview|SourceSnapshot|SourceSection|SourceBlock/ },
  { id: "game-vocabulary", pattern: /\b(spells?|mana|sustain\w*|concentration|affinit(y|ies)|emission|evocation|weapons?|maneuvers?|damage|healing|summon\w*|arcana|casting)\b/i },
  { id: "game-stat", pattern: /\b(AP|MP|ME|HP|STR|AGI|CON|PER|PRO|RES)\b/ },
  { id: "engine-class-or-registry", pattern: /\bclass\s+(RulesEngine|Engine)\b|\bRegistry\b/ },
  { id: "module-mutable-state", pattern: /^(export\s+)?(let|var)\s/m },
  { id: "untyped-any", pattern: /:\s*any\b|<any>|\bas\s+any\b/ },
];

/** Every import specifier must be relative or exactly @prowess/model. */
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*\sfrom\s*)?["']([^"']+)["']/g;
const allowedImport = (spec: string) => spec.startsWith("./") || spec.startsWith("../") || spec === "@prowess/model";

function audit(source: string): string[] {
  const text = strip(source);
  const violations = FORBIDDEN.filter((r) => r.pattern.test(text)).map((r) => r.id);
  for (const m of text.matchAll(IMPORT_RE)) if (!allowedImport(m[1] as string)) violations.push(`import:${m[1]}`);
  return violations;
}

describe("M4-WO1 static audit — scanner control tests (§64)", () => {
  it.each([
    ['import { listEntities } from "@prowess/db";', "import:@prowess/db"],
    ['import { canonicalJson } from "@prowess/import";', "import:@prowess/import"],
    ['import { readFileSync } from "node:fs";', "import:node:fs"],
    ['import { useState } from "react";', "framework"],
    ["const p = new PrismaClient();", "database"],
    ["const x = Math.random();", "randomness"],
    ["const id = crypto.randomUUID();", "randomness"],
    ["const t = Date.now();", "clock"],
    ["const d = new Date();", "clock"],
    ['const v = eval("1 + 1");', "code-execution"],
    ['const f = new Function("return 1");', "code-execution"],
    ['const m = await import("x");', "code-execution"],
    ['const r = await fetch("https://example.invalid");', "network"],
    ["export function getLatestRule() { return null; }", "hidden-latest"],
    ["export function isCanonRuleset() { return true; }", "canon-choice"],
    ["const effectiveCost = 3;", "cost-payment-merge"],
    ["export function commitResources() {}", "runtime-mutation"],
    ["export function spendAll(snapshot) {}", "runtime-mutation"],
    ["export function applyPaymentToCharacter(c) {}", "runtime-mutation"],
    ["const c: ImportDecision = x;", "import-review-coupling"],
    ['const k = "damage";', "game-vocabulary"],
    ["const v = stats.PRO;", "game-stat"],
    ["export class RulesEngine {}", "engine-class-or-registry"],
    ["let counter = 0;", "module-mutable-state"],
    ["function f(x: any) { return x; }", "untyped-any"],
  ])("catches %s", (snippet, expected) => {
    expect(audit(snippet)).toContain(expected);
  });

  it("accepts representative clean engine code, and ignores forbidden words inside comments", () => {
    const clean = [
      'import { isUuidString, type CanonicalKey } from "@prowess/model";',
      'import { deepFreeze } from "../internal/plain-data.js";',
      "// Never call Date.now() or Math.random() here; no latest lookup, no damage rules.",
      "/** eval is forbidden; fetch is forbidden. */",
      "export function readKey(value: unknown): string | null { const key = value as string; return key; }",
    ].join("\n");
    expect(audit(clean)).toEqual([]);
  });
});

describe("M4-WO1 static audit — @prowess/rules production code", () => {
  it("covers the whole engine package", () => {
    expect(PRODUCTION.length).toBeGreaterThanOrEqual(12);
    expect(PRODUCTION.map(rel)).toEqual(expect.arrayContaining(["packages/prowess-rules/src/index.ts", "packages/prowess-rules/src/evaluation/evaluate.ts"]));
  });

  it.each(PRODUCTION.map((f) => [rel(f), f]))("%s has no forbidden dependency or pattern (M4-I02 M4-I04 M4-I05 M4-I06 M4-I07 M4-I12 M4-I14 M4-I15)", (_name, file) => {
    expect(audit(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("test files and test support import only the engine itself, @prowess/model and vitest", () => {
    for (const f of ALL_TS.filter((file) => !PRODUCTION.includes(file))) {
      for (const m of strip(readFileSync(f, "utf8")).matchAll(IMPORT_RE)) {
        const spec = m[1] as string;
        expect(allowedImport(spec) || spec === "vitest", `${rel(f)} imports ${spec}`).toBe(true);
      }
    }
  });

  it("the package declares @prowess/model as its only runtime dependency, and compiles without Node or DOM types", () => {
    const pkg = JSON.parse(read("packages", "prowess-rules", "package.json")) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe("@prowess/rules");
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@prowess/model"]);
    expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual(["typescript", "vitest"]);
    const tsconfig = JSON.parse(read("packages", "prowess-rules", "tsconfig.json")) as { compilerOptions: { lib: string[]; types: string[] } };
    expect(tsconfig.compilerOptions.lib).toEqual(["ES2022"]);
    expect(tsconfig.compilerOptions.types).toEqual([]);
  });

  it("the test-support folder is not part of the public entry point", () => {
    expect(strip(read("packages", "prowess-rules", "src", "index.ts"))).not.toMatch(/testing\/|internal\//);
  });
});

describe("M4-WO1 boundaries elsewhere in the repository", () => {
  it("the architecture checker enforces the @prowess/rules boundary and includes it in the cycle check", () => {
    const script = read("scripts", "check-architecture.mjs");
    expect(script).toContain('name: "@prowess/rules"');
    expect(script).toContain('"packages/prowess-rules",');
  });

  it("no lower layer depends on @prowess/rules (it sits above @prowess/model only)", () => {
    for (const dir of ["packages/prowess-model", "packages/prowess-import", "packages/prowess-ui", "packages/prowess-test-fixtures"]) {
      expect(read(...dir.split("/"), "package.json"), dir).not.toContain("@prowess/rules");
    }
  });

  it("adds no Rules HTTP route and no Rules UI (M4-WO10 / M4-WO11 own those)", () => {
    const studio = walk(path.join(ROOT, "apps", "studio", "app")).map(rel);
    expect(studio.filter((f) => /\/(rules|rules-engine|rules-inspector|calculation-lab)\//.test(f))).toEqual([]);
    for (const f of walk(path.join(ROOT, "apps", "studio")).filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toContain("@prowess/rules");
    }
  });

  it("permanent CI builds and unit-tests @prowess/rules and runs this audit as a named gate", () => {
    const ci = read(".github", "workflows", "ci.yml");
    const build = ci.split("\n").find((l) => l.includes("run: pnpm") && l.includes("run build") && l.includes("@prowess/model"));
    const unit = ci.split("\n").find((l) => l.includes("run test:unit") && l.includes("@prowess/model"));
    expect(build).toContain('--filter "@prowess/rules"');
    expect(unit).toContain('--filter "@prowess/rules"');
    expect(ci).toContain("tests/unit/m4-wo1-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO1 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 15 }, (_, i) => `M4-I${String(i + 1).padStart(2, "0")}`);
  const tests = [...walk(path.join(RULES, "src")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));

  it("names all fifteen WO1 invariants and maps every one to an existing automated guard that cites it", () => {
    for (const id of ids) {
      expect(doc, id).toMatch(new RegExp(`\\*\\*${id}\\*\\*`));
      const row = doc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, `coverage row for ${id}`).toBeDefined();
      const files = [...(row as string).matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1] as string);
      expect(files.length, id).toBeGreaterThan(0);
      for (const f of files) expect(tests.some((t) => t.endsWith(f)), `${id}: ${f} exists`).toBe(true);
      expect(files.some((f) => readFileSync(tests.find((t) => t.endsWith(f)) as string, "utf8").includes(id)), `${id} is cited by one of its guards`).toBe(true);
    }
  });
});
