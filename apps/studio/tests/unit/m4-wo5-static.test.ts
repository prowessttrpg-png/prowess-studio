// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO5 Requirement Engine — static audit (PAS-10 M4-WO5 §105–109). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I53 Requirement Predicates Consume Explicit Facts Only · M4-I56
 * Requirement Groups Evaluate Every Child · M4-I57 Rank Ordering Is Data, Not Hard-Coded Mechanics · M4-I58 Keyword
 * Requirements Reuse Exact WO4 Membership · M4-I59 Requirements Have No Side Effects. (The M4-WO1 audit additionally
 * applies all package-wide purity rules to these files.)
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

const REQ_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "requirement");
const REQ_FILES = walk(REQ_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const EVALUATOR = () => strip(read("packages", "prowess-rules", "src", "requirement", "evaluate.ts"));

const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "persistence", pattern: /@prowess\/db|prisma|postgres|@prowess\/import/i },
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(/ },
  { id: "callback-predicate", pattern: /typeof\s+[\w.]+\s*[!=]==\s*["']function["']|\.(evaluate|predicate|test|check|callback|fn|run)\s*\(\s*\)|\.call\s*\(|\.apply\s*\(/ },
  { id: "prose-parsing", pattern: /\.match\s*\(|\.matchAll\s*\(|\.replace\w*\s*\(|\.split\s*\(|new\s+RegExp|JSON\.parse/ },
  { id: "hidden-latest", pattern: /latest|newest|mostRecent|currentVersion|getCurrent\w*/i },
  { id: "game-vocabulary", pattern: /\b(stats?|skills?|affinit(y|ies)|arcan\w*|martial|levels?|mana|spell\w*|weapon\w*|maneuver\w*|summon\w*|damage|emission|character\w*)\b/i },
  { id: "game-stat", pattern: /\b(STR|AGI|CON|PER|PRO|RES|AP|MP|ME|HP)\b/ },
  { id: "rank-ladder", pattern: /\b(trained|expert|master|novice|apprentice|journeyman|adept|legendary|untrained|grandmaster)\b/i },
  { id: "literal-identity-switch", pattern: /(?<!typeof\s+[\w.]*)\b(factKey|rankKey|requiredRankKey|member|entityId|keywordId|canonicalKey)\s*[!=]==?\s*["'`]/ },
  { id: "formula-execution", pattern: /evaluateFormula|parseFormulaExpression|validateFormulaProgram|formula\/(evaluate|parser|lexer)/ },
  { id: "modifier-behaviour", pattern: /modif\w*/i },
  { id: "resource-mutation", pattern: /\b(spend|reserve|deduct|consume|restore|pay)\w*/i },
  { id: "keyword-reimplementation", pattern: /\.keywords\s*\.\s*(find|filter|some|every|includes|indexOf)\s*\(|keyword\.(keywordId|canonicalKey)\s*===/ },
  { id: "locale-or-case", pattern: /toLocale\w*|localeCompare|\bIntl\b|toLowerCase|toUpperCase|\.normalize\s*\(/ },
  { id: "mutable-registry", pattern: /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|Registry|class\s+\w*Engine/m },
];
const audit = (source: string) => [...new Set(FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

/** No-short-circuit rule for the evaluator: groups combine a fully mapped child list, never stop early. */
const shortCircuit = (source: string) => {
  const text = strip(source);
  const v: string[] = [];
  if (/\.(some|every|find|findIndex|findLast|findLastIndex)\s*\(/.test(text)) v.push("early-exit-array-method");
  if (/\bbreak\b|\bcontinue\b/.test(text)) v.push("loop-exit");
  if (/(&&|\|\|)\s*evaluate(Node|Predicate)\s*\(/.test(text)) v.push("boolean-short-circuit");
  if (!/const results = node\.children\.map\(/.test(text)) v.push("children-not-all-mapped");
  // Structural: no loops at all (an early `return` inside a loop is the classic short-circuit), and evaluateNode is
  // called from exactly two places — the single children.map recursion and the root call.
  if (/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{|\.forEach\s*\(|\.reduce\w*\s*\(/.test(text)) v.push("loop-in-evaluator");
  if ((text.match(/\bevaluateNode\s*\(/g) ?? []).length !== 3) v.push("extra-evaluation-site");
  return v;
};

/** Every `case "…"` label in the module must belong to the engine's own generic vocabulary. */
const ALLOWED_CASES = new Set(["ALL", "ANY", "NONE", "NUMERIC_COMPARE", "RANK_AT_LEAST", "KEYWORD_PRESENT", "SET_CONTAINS", "ENTITY_OWNED", "==", "!=", "<", "<=", ">", ">="]);
const caseLabels = (source: string) => [...strip(source).matchAll(/\bcase\s+["'`]([^"'`]+)["'`]/g)].map((m) => m[1] as string);

describe("M4-WO5 static audit — scanner control tests (§106, §108, §109)", () => {
  it.each([
    ['if (factKey === "stat.STR") return true;', "literal-identity-switch"],
    ['if (factKey === "stat.STR") return true;', "game-stat"],
    ['if (fact.rankKey === "Expert") return 2;', "literal-identity-switch"],
    ['if (fact.rankKey === "Expert") return 2;', "rank-ladder"],
    ["const RANKS = { Trained: 1, Expert: 2, Master: 3 };", "rank-ladder"],
    ["const ok = eval(node.expression);", "code-execution"],
    ['import { prisma } from "@prowess/db";', "persistence"],
    ["if (typeof node.evaluate === \"function\") return node.evaluate();", "callback-predicate"],
    ["return predicate.check();", "callback-predicate"],
    ["const v = evaluateFormula({ expression: node.formula }, bindings);", "formula-execution"],
    ["const parts = text.split(\" and \");", "prose-parsing"],
    ['const m = prose.match(/requires (\\w+)/);', "prose-parsing"],
    ["return set.keywords.find((k) => k.keyword.keywordId === id) !== undefined;", "keyword-reimplementation"],
    ["applyModifier(result, node);", "modifier-behaviour"],
    ["spendResource(facts, node.factKey, node.expected);", "resource-mutation"],
    ["const key = node.factKey.toLowerCase();", "locale-or-case"],
    ["export const FACT_CACHE = new Map<string, number>();", "mutable-registry"],
    ["export class RequirementEngine { evaluate() {} }", "mutable-registry"],
    ["const level = facts.numeric.get(\"actor.level\");", "game-vocabulary"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it.each([
    ["ANY returning on the first true child", "if (node.kind === \"ANY\") return node.children.some((c) => evaluateNode(c).outcome?.satisfied);\nconst results = node.children.map(x);", "early-exit-array-method"],
    ["ALL stopping at the first false child", "for (const c of node.children) { if (!ev(c)) break; }\nconst results = node.children.map(x);", "loop-exit"],
    ["boolean operators deciding evaluation", "const s = a.satisfied && evaluateNode(b, k, p, at, i, d);\nconst results = node.children.map(x);", "boolean-short-circuit"],
    ["children not all evaluated first", "const first = evaluateNode(node.children[0]);", "children-not-all-mapped"],
    ["for…of with an early return", "for (const c of node.children) { const r = evaluateNode(c); if (r.outcome?.satisfied) return r; }\nconst results = node.children.map(x);", "loop-in-evaluator"],
    ["reduce-based combination", "const s = node.children.reduce((acc, c) => acc || ev(c), false);\nconst results = node.children.map(x);", "loop-in-evaluator"],
    ["a second evaluation site", "function evaluateNode() {}\nconst a = evaluateNode(first);\nconst results = node.children.map((c) => evaluateNode(c));\nevaluateNode(root);", "extra-evaluation-site"],
  ])("short-circuit control: %s", (_label, snippet, id) => expect(shortCircuit(snippet)).toContain(id));

  it("accepts representative engine code and ignores comments", () => {
    const clean = [
      "// no Trained/Expert/Master ladder; never eval; Fire is just a Keyword; never stat.STR",
      "const present = node.keywordId !== null ? hasKeywordById(set, node.keywordId) : hasKeywordByCanonicalKey(set, node.canonicalKey as string);",
      'if (typeof node.canonicalKey !== "string" || !isValidCanonicalKey(node.canonicalKey)) fail();',
      "return leaf(fact.order >= node.requiredOrder, expected, actual, fact.provenance, inputs);",
    ].join("\n");
    expect(audit(clean)).toEqual([]);
    expect(caseLabels('switch (k) { case "ALL": case ">=": break; }')).toEqual(["ALL", ">="]);
  });
});

describe("M4-WO5 static audit — the Requirement implementation", () => {
  it("covers the requirement module", () => {
    expect(REQ_FILES.map(rel).sort()).toEqual(["evaluate.ts", "facts.ts", "model.ts", "validate.ts"].map((f) => `packages/prowess-rules/src/requirement/${f}`));
  });

  it.each(REQ_FILES.map((f) => [rel(f), f]))(
    "%s: no persistence, callbacks, code execution, prose parsing, game keys, rank ladder, Formula execution, Modifier / Resource behaviour or Keyword re-implementation (M4-I53 M4-I57 M4-I58 M4-I59)",
    (_n, f) => expect(audit(readFileSync(f, "utf8"))).toEqual([]),
  );

  it("M4-I56: the evaluator maps every child before combining and has no early exit", () => {
    expect(shortCircuit(read("packages", "prowess-rules", "src", "requirement", "evaluate.ts"))).toEqual([]);
    expect(EVALUATOR()).toMatch(/const satisfiedCount = valid\.filter\(\(o\) => o\.satisfied\)\.length;/);
  });

  it("every switch label belongs to the engine's generic vocabulary — CUSTOM is never a case", () => {
    for (const f of REQ_FILES) for (const label of caseLabels(readFileSync(f, "utf8"))) expect(ALLOWED_CASES.has(label), `${rel(f)}: case "${label}"`).toBe(true);
  });

  it("M4-I58: Keyword presence uses M4-WO4's exact membership primitives", () => {
    expect(EVALUATOR()).toMatch(/import \{ hasKeywordByCanonicalKey, hasKeywordById \} from "\.\.\/keyword\/query\.js";/);
    expect(EVALUATOR()).toMatch(/hasKeywordById\(set, node\.keywordId\)/);
    expect(strip(read("packages", "prowess-rules", "src", "requirement", "facts.ts"))).toMatch(/aggregateKeywordContributions\(contributions\)/);
  });

  it("the only Formula dependency is the shared identifier grammar (no Formula evaluation)", () => {
    const imports = REQ_FILES.flatMap((f) => [...strip(readFileSync(f, "utf8")).matchAll(/from "(\.\.\/formula\/[^"]+)"/g)].map((m) => m[1]));
    expect(imports).toEqual(["../formula/ast.js"]);
    expect(strip(read("packages", "prowess-rules", "src", "requirement", "validate.ts"))).toMatch(/import \{ isValidFormulaIdentifier \} from "\.\.\/formula\/ast\.js";/);
  });

  it("evaluation goes through the M4-WO1 envelope", () => {
    expect(EVALUATOR()).toMatch(/import \{ evaluate \} from "\.\.\/evaluation\/evaluate\.js";/);
  });
});

describe("M4-WO5 boundaries (§7–9, §105)", () => {
  it("@prowess/rules still depends on @prowess/model only", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    expect(Object.keys(rules.devDependencies).sort()).toEqual(["typescript", "vitest"]);
  });

  it("adds no Requirement persistence, migration, route, UI or DB service", () => {
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model\s+Requirement\w*|requirement_(definitions|results|facts|outcomes)/i);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e))).toHaveLength(22);
    for (const f of [...walk(path.join(ROOT, "apps", "studio")), ...walk(path.join(ROOT, "packages", "prowess-db", "src"))].filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/evaluateRequirement|createRequirementFacts|validateRequirement/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo5-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO5 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 14 }, (_, i) => `M4-I${String(i + 51).padStart(2, "0")}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));
  const guard = (f: string) => tests.find((t) => path.basename(t) === f);

  it("names M4-I51 – M4-I64 and maps every one to an existing automated guard that cites it", () => {
    for (const id of ids) {
      expect(doc, id).toMatch(new RegExp(`\\*\\*${id}\\*\\*`));
      const row = doc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, `coverage row for ${id}`).toBeDefined();
      const files = [...(row as string).matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1] as string);
      expect(files.length, id).toBeGreaterThan(0);
      for (const f of files) expect(guard(f), `${id}: ${f} exists`).toBeDefined();
      expect(files.some((f) => readFileSync(guard(f) as string, "utf8").includes(id)), `${id} is cited by one of its guards`).toBe(true);
    }
  });
});
