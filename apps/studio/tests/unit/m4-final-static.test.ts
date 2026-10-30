// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";
import { auditSource, type Layer } from "./m4-final-audit-helpers";

const root = path.resolve(process.cwd(), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const walk = (dir: string): string[] => readdirSync(path.join(root, dir)).filter(name => !["node_modules", "dist", ".next", "generated"].includes(name)).flatMap(name => {
  const file = `${dir}/${name}`; return statSync(path.join(root, file)).isDirectory() ? walk(file) : [file];
});
const engine = walk("packages/prowess-rules/src").filter(f => f.endsWith(".ts") && !f.includes("/testing/") && !f.endsWith(".test.ts"));
const resolver = walk("packages/prowess-db/src/ruleset-context").filter(f => f.endsWith(".ts"));
const http = ["apps/studio/src/rules-evaluation/service.ts", "apps/studio/app/api/rules/evaluate/route.ts"];
const ui = [...walk("apps/studio/app/developer/rules").filter(f => /\.tsx?$/.test(f)), "apps/studio/src/api-client/rules.ts"];
const inventory: Array<[string, Layer]> = [...engine.map(f => [f, "engine"] as [string, Layer]), ...resolver.map(f => [f, "resolver"] as [string, Layer]), ...http.map(f => [f, "http"] as [string, Layer]), ...ui.map(f => [f, "ui"] as [string, Layer])];
const catalog = JSON.parse(read("docs/architecture/m4-final-invariants.json")) as Array<{ id: string; group: string; guards: string[] }>;

// M4-I01–I188 + M4-I162A: one authoritative catalog, full paths, actual configured test discovery.
describe("M4 Final Static Architecture Audit", () => {
  it.each(inventory)("%s has no forbidden %s behavior", (file, layer) => expect(auditSource(read(file), file, layer)).toEqual([]));
  it("pins the exact 189 invariant definitions with no gaps or duplicate identifiers", () => {
    const expected = Array.from({ length: 188 }, (_, i) => `M4-I${String(i + 1).padStart(2, "0")}`); expected.splice(162, 0, "M4-I162A");
    expect(catalog.map(x => x.id)).toEqual(expected);
    const definitions = [...read("docs/architecture/m4-rules-engine-core.md").matchAll(/^- \*\*(M4-I\d+A?)\*\*/gm)].map(m => m[1]);
    expect([...definitions].sort()).toEqual([...expected].sort());
    expect(new Set(definitions).size).toBe(189);
  });
  it.each(catalog)("$id maps to executing automated guards in $group", entry => {
    expect(entry.guards.length).toBeGreaterThan(0);
    for (const file of entry.guards) {
      expect(read(file)).toMatch(/\b(it|test|describe)\s*[.(]/);
      expect(file).toMatch(/packages\/[^/]+\/src\/.*\.test\.ts$|packages\/prowess-db\/tests\/(unit|integration)\/.*\.test\.ts$|apps\/studio\/tests\/(unit|integration)\/.*\.test\.(ts|tsx)$/);
    }
  });
  it("duplicates are package-scoped model/DB tests; no guard can shadow another in one configured suite", () => {
    for (const dir of ["packages/prowess-model/src", "packages/prowess-rules/src", "packages/prowess-db/tests/unit", "packages/prowess-db/tests/integration", "packages/prowess-import/src", "packages/prowess-ui/src", "apps/studio/tests/unit", "apps/studio/tests/integration", "apps/studio/tests/e2e"]) {
      const names = walk(dir).filter(f => /\.(test|spec)\.(ts|tsx)$/.test(f)).map(f => path.basename(f));
      expect(new Set(names).size, dir).toBe(names.length);
    }
  });
  it("rules depend on model only; evaluation HTTP route and Developer Inspector are pinned", () => {
    const pkg = JSON.parse(read("packages/prowess-rules/package.json")) as { dependencies: object };
    expect(Object.keys(pkg.dependencies)).toEqual(["@prowess/model"]);
    expect(walk("apps/studio/app/api/rules")).toEqual(["apps/studio/app/api/rules/evaluate/route.ts"]);
    expect(read(http[1]!)).toContain("export async function POST");
    expect(read("apps/studio/app/developer/page.tsx")).toContain('href="/developer/rules"');
  });
  it("final architecture report has all 39 required sections and five scoped diagrams", () => {
    const report = read("docs/architecture/m4-final-audit.md");
    expect([...report.matchAll(/^## (\d+)\./gm)].map(m => Number(m[1]))).toEqual(Array.from({length:39},(_,i)=>i+1));
    expect(report.match(/```mermaid/g)).toHaveLength(5);
    expect(report).toContain("not FINAL PASS");
  });
  it("schema and all migrations equal the approved pre-WO11 baseline", () => {
    const baseline = JSON.parse(read("docs/architecture/m4-wo11-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(hash(frozenSchemaText())).toBe(baseline.schemaHash);
    expect(Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter(f => f.endsWith("migration.sql")).filter(notLaterMigration).map(f => [f, hash(read(f))]))).toEqual(baseline.migrations);
  });
  it("WO1–WO11, WO10A protection, final audit and actual browser workflows remain permanent CI gates", () => {
    const ci = read(".github/workflows/ci.yml");
    for (let i = 1; i <= 11; i++) expect(ci).toContain(`M4-WO${i} audit gate`);
    for (const file of ["m4-final-static.test.ts", "m4-final-engine.test.ts", "m4-final-api.test.ts", "m4-wo11-static.test.ts", "m4-rules-evaluation-api.test.ts"]) expect(ci).toContain(file);
    expect(ci).toContain("M4-WO12 final audit — M4 integration & reproducibility");
    expect(ci).toContain("pnpm run test:e2e");
  });
});

const orc = "packages/prowess-rules/src/orchestration/orchestrate.ts";
const controls: Array<[string, string, Layer, string]> = [
  ["latest selection", "const context = getLatestManifest(rulesetId);", "resolver", "implicit-selection"],
  ["database in rules", 'import { prisma } from "@prowess/db";', "engine", "package-boundary"],
  ["game mechanics", 'if (keyword === "Fire") result += 1;', "engine", "game-branch"],
  ["rounding", "const next = Math.floor(value);", "engine", "hidden-rounding"],
  ["effective cost", "const effectiveCost = listedAmount - temporaryPayment;", "engine", "effective-cost"],
  ["requirement auto-block", "if (prior.response.data.satisfied === false) block();", "engine", "business-auto-block"],
  ["resource auto-block", "if (prior.response.data.canPay === false) block();", "engine", "business-auto-block"],
  ["UI calculation", "const result = 17 / 4;", "ui", "browser-arithmetic"],
  ["UI latest", "setExactId(latestRelease.id);", "ui", "implicit-selection"],
  ["evaluation persistence", "await prisma.evaluationRun.create({ data: result });", "http", "database-write"],
  ["network", 'fetch("https://example.test");', "engine", "environment"],
  ["dynamic code", 'new Function("return 1")();', "engine", "dynamic-code"],
];
describe("WO12 permanent negative controls — mutated real source snapshots", () => {
  it.each(controls)("rejects %s", (_label, snippet, layer, finding) => {
    const file = layer === "ui" ? ui[0]! : layer === "resolver" ? resolver[0]! : layer === "http" ? http[0]! : orc;
    expect(auditSource(`${read(file)}\n${snippet}`, file, layer)).toContain(finding);
  });
  it("WO10A: replacing projectExplanation with buildExplanation is caught", () => {
    const changed = read(orc).replace("return projectExplanation(input.document, input.level as ExplanationLevel);", "return buildExplanation(input.document, options);");
    expect(changed).not.toBe(read(orc)); expect(auditSource(changed, orc, "engine")).toContain("projection-rebuild");
  });
  it("removing runtime freezing from the closed operation vocabulary is caught", () => {
    const file = "packages/prowess-rules/src/orchestration/model.ts";
    const changed = read(file).replace("EVALUATION_OPERATIONS = deepFreeze([", "EVALUATION_OPERATIONS = [").replace("] as const);", "] as const;");
    expect(changed).not.toBe(read(file)); expect(auditSource(changed, file, "engine")).toContain("mutable-contract");
  });
  it("allows resource current values, local traversal cursors and declared Formula rounding", () => {
    expect(auditSource("const current = resource.current; const x = Math.floor(value);", "formula/evaluate.ts", "engine")).toEqual([]);
  });
});
