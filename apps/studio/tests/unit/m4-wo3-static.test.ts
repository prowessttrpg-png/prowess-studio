// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO3 Formula Engine — static audit (PAS-10 M4-WO3 §114–116). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I26 Restricted Formula Grammar · M4-I27 Authored Formula Text Is Never
 * Executed · M4-I29 Rounding Is Explicit · M4-I37 Formula Evaluation Is Read-Only · M4-I39 Units Have No Implicit
 * Mechanics. (The M4-WO1 audit additionally applies all package-wide purity rules to these files.)
 *
 * The scanner is a plain function proven by in-memory control snippets — no broken file is ever committed.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d)) {
    if (["node_modules", "dist", ".next", "generated"].includes(e)) continue;
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FORMULA_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "formula");
const FORMULA_FILES = walk(FORMULA_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const RULES_PRODUCTION = walk(path.join(ROOT, "packages", "prowess-rules", "src")).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !rel(f).includes("/src/testing/"),
);

const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bvm\.|runIn\w*Context|\bimport\s*\(|\brequire\s*\(|setTimeout\s*\(|setInterval\s*\(/ },
  { id: "math-surface", pattern: /Math\.(?!floor\b|ceil\b|min\b|max\b)\w+|Math\s*\[/ },
  { id: "hidden-rounding-or-locale", pattern: /toFixed|toPrecision|EPSILON|parseFloat|parseInt|toLocale\w*|\bIntl\b|localeCompare|Number\.parse/ },
  { id: "dynamic-lookup", pattern: /globalThis|\bwindow\b|\bself\b|Reflect\.|\[\s*(name|node\.name|fn|functionName)\s*\]/ },
  { id: "source-rewrite", pattern: /[×÷−]|\\u00d7|\\u00f7|\\u2212|(source|expression|text)\.replace\w*\s*\(/i },
  { id: "persistence", pattern: /@prowess\/db|prisma|postgres|@prowess\/import/i },
  { id: "network-or-fs", pattern: /\bfetch\s*\(|["']node:|readFileSync|\bprocess\./ },
  { id: "clock-or-random", pattern: /Date\.now|new\s+Date\b|\bDate\s*\(|Math\.random|randomUUID|getRandomValues/ },
  { id: "game-vocabulary", pattern: /\b(spells?|mana|exertion|affinit(y|ies)|weapons?|maneuvers?|summon\w*|damage|healing)\b/i },
  { id: "game-stat", pattern: /\b(AP|MP|ME|HP|STR|AGI|CON|PER|PRO|RES)\b/ },
  { id: "mutable-formula-class", pattern: /class\s+Formula\w*|setVariable|\bthis\.\w+\s*=(?!=)/ },
];
const audit = (source: string) => FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id);

describe("M4-WO3 static audit — scanner control tests (§115)", () => {
  it.each([
    ["return eval(expression);", "code-execution"],
    ['const f = new Function("x", body);', "code-execution"],
    ["const m = await import(name);", "code-execution"],
    ["return Math.random() * 6;", "clock-or-random"],
    ["const seed = Date.now();", "clock-or-random"],
    ['import { prisma } from "@prowess/db";', "persistence"],
    ['import { readFileSync } from "node:fs";', "network-or-fs"],
    ["return Math.round(value);", "math-surface"],
    ["return Math.pow(a, b);", "math-surface"],
    ["const fn = Math[name];", "math-surface"],
    ["return Number(value.toFixed(2));", "hidden-rounding-or-locale"],
    ["const n = parseFloat(text);", "hidden-rounding-or-locale"],
    ["return a.localeCompare(b);", "hidden-rounding-or-locale"],
    ["const fn = globalThis[name];", "dynamic-lookup"],
    ["const fn = FUNCTIONS[name];", "dynamic-lookup"],
    ['const normalized = source.replace("÷", "/");', "source-rewrite"],
    ['if (c === "×") return "STAR";', "source-rewrite"],
    ['if (key === "spell.ap") return value / 4;', "game-vocabulary"],
    ["const cost = vars.MP;", "game-stat"],
    ["export class FormulaEngine { evaluate() {} }", "mutable-formula-class"],
    ["formula.setVariable(\"a\", 1);", "mutable-formula-class"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it("accepts representative engine code and ignores comments", () => {
    const clean = [
      "// never eval(); never Math.random(); no ÷ or × guessing; no spell rules",
      "const value = Math.floor(xs[0] as number);",
      "switch (node.name) { case \"floor\": return Math.floor(x); default: return Math.max(...xs); }",
      "if (right.value === 0) throw new EvaluationStop(d);",
      "function evaluateNode(node: FormulaNode, key: string) { return node; }",
    ].join("\n");
    expect(audit(clean)).toEqual([]);
  });
});

describe("M4-WO3 static audit — the Formula implementation", () => {
  it("covers the formula module", () => {
    expect(FORMULA_FILES.map(rel).sort()).toEqual(
      ["ast.ts", "dependency.ts", "diagnostics.ts", "evaluate.ts", "lexer.ts", "parser.ts"].map((f) => `packages/prowess-rules/src/formula/${f}`),
    );
  });

  it.each(FORMULA_FILES.map((f) => [rel(f), f]))("%s: no execution, hidden rounding, dynamic lookup, source rewriting, persistence, clock, randomness or game logic (M4-I27 M4-I29 M4-I37)", (_n, f) => {
    expect(audit(readFileSync(f, "utf8"))).toEqual([]);
  });

  it("M4-I26: the grammar is owned by the hand-written lexer and parser — no regular expression touches the source there", () => {
    for (const file of ["lexer.ts", "parser.ts"]) {
      const text = strip(read("packages", "prowess-rules", "src", "formula", file));
      expect(text, file).not.toMatch(/new RegExp|\.test\(|\.match\(|\.matchAll\(|\.replace\w*\(|\.split\(/);
      expect(text, file).not.toMatch(/=\s*\/[^/*\s]/); // no regex literal assignment
    }
  });

  it("M4-I29: rounding exists only where explicitly requested — Math.floor / Math.ceil appear only in formula/evaluate.ts (the floor() / ceil() functions and the FLOOR / CEIL modes)", () => {
    const users = RULES_PRODUCTION.filter((f) => /Math\.(floor|ceil|round|trunc)\b/.test(strip(readFileSync(f, "utf8")))).map(rel);
    expect(users).toEqual(["packages/prowess-rules/src/formula/evaluate.ts"]);
    const evaluator = strip(read("packages", "prowess-rules", "src", "formula", "evaluate.ts"));
    expect(evaluator.match(/Math\.floor\(/g)?.length).toBe(2);
    expect(evaluator.match(/Math\.ceil\(/g)?.length).toBe(2);
    expect(evaluator).toMatch(/const rounding = program\.rounding \?\? "NONE";/);
  });

  it("M4-I27: functions are a closed switch over four exact names, never looked up dynamically", () => {
    expect(read("packages", "prowess-rules", "src", "formula", "diagnostics.ts")).toContain('export const FORMULA_FUNCTIONS = ["floor", "ceil", "min", "max"] as const;');
    const evaluator = strip(read("packages", "prowess-rules", "src", "formula", "evaluate.ts"));
    for (const name of ["floor", "ceil", "min"]) expect(evaluator).toContain(`case "${name}":`);
  });

  it("M4-I39: units are carried as labels only — never parsed, converted or compared", () => {
    const evaluator = strip(read("packages", "prowess-rules", "src", "formula", "evaluate.ts"));
    const uses = [...evaluator.matchAll(/\bunit\b[^,;\n]*/g)].map((m) => m[0]);
    for (const use of uses) expect(use, use).not.toMatch(/convert|factor|ratio|===\s*["']|\.split|\.toLower|\.startsWith/);
  });
});

describe("M4-WO3 boundaries (§5–7, §114)", () => {
  it("@prowess/rules still depends on @prowess/model only", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    expect(Object.keys(rules.devDependencies).sort()).toEqual(["typescript", "vitest"]);
  });

  it("adds no Formula persistence, migration, route or UI", () => {
    // M3's extraction already has a FORMULA candidate kind; what must not exist is a persisted Formula model / table.
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model\s+Formula\w*|formula_(definitions|programs|dependencies|results)/i);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e))).toHaveLength(22);
    for (const f of walk(path.join(ROOT, "apps", "studio")).filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      // M4-WO10: only its application service imports @prowess/rules — and even it never calls this primitive directly.
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/evaluateFormula|parseFormulaExpression/);
      if (rel(f) !== "apps/studio/src/rules-evaluation/service.ts") expect(readFileSync(f, "utf8"), rel(f)).not.toContain("@prowess/rules");
    }
    expect(walk(path.join(ROOT, "apps", "studio", "app")).map(rel).filter((f) => /\/formula/i.test(f))).toEqual([]);
    for (const f of walk(path.join(ROOT, "packages", "prowess-db", "src")).filter((file) => file.endsWith(".ts"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/evaluateFormula|parseFormulaExpression/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo3-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO3 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 14 }, (_, i) => `M4-I${String(i + 26).padStart(2, "0")}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));

  it("names M4-I26 – M4-I39 and maps every one to an existing automated guard that cites it", () => {
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
