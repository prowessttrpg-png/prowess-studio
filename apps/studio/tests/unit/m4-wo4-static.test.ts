// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO4 Keyword Resolution — static audit (PAS-10 M4-WO4 §87–89). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I40 Keywords Are Metadata / Rule Hooks Only · M4-I44 Keywords Have No
 * Implicit Mechanics · M4-I45 Keyword Lookup Uses No Alias / Fuzzy Matching · M4-I46 Keyword Categories Grant No
 * Mechanics · M4-I47 Keyword Resolution Is Read-Only · M4-I50 Keyword Resolution Is Locale-Independent. (The M4-WO1
 * audit additionally applies all package-wide purity rules to these files.)
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

const KEYWORD_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "keyword");
const KEYWORD_FILES = walk(KEYWORD_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "implicit-mechanics", pattern: /\b(cost|bonus|penalty|damage|duration|range|priority|stacks?|weight|multiplier|magnitude)\b/i },
  { id: "game-keyword", pattern: /\b(fire|cold|healing|zone|sustain\w*|spell\w*|weapon\w*|affinit(y|ies)|mana|elemental|burn\w*)\b/i },
  { id: "game-stat", pattern: /\b(AP|MP|ME|HP|STR|AGI|CON|PER|PRO|RES)\b/ },
  { id: "literal-identity-switch", pattern: /(?<!typeof\s+[\w.]*)\b(canonicalKey|keywordId|categoryId|sourceType|sourceKey)\s*[!=]==?\s*["'`]|\bcase\s+["'`]/ },
  { id: "alias-or-display", pattern: /alias|displayName|\.name\b|\bname\s*[!=]==|description|\blabel\b/i },
  { id: "locale-or-case", pattern: /toLocale\w*|localeCompare|\bIntl\b|\.normalize\s*\(|toLowerCase|toUpperCase/ },
  { id: "fuzzy-matching", pattern: /startsWith|endsWith|indexOf|levenshtein|similar\w*|fuzzy|\.search\s*\(|includes\(\s*(canonicalKey|probe|query)\b/i },
  { id: "mutable-registry", pattern: /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|Registry/m },
  { id: "removal-or-negation", pattern: /remove|suppress|negat|immun|cancel|exclu/i },
  { id: "hierarchy-or-implication", pattern: /parent|child(?!ren\b)|impli\w*|imply|inherit|hierarch|ancestor|descendant/i },
  { id: "canon-or-import", pattern: /canon(?!ical)|GOVERNING|authority|confidence|ExtractionCandidate|MatchRun|import-review|import-batch/i },
  { id: "canon-or-import", pattern: /\bImport(Batch|Decision|Match|Review|Candidate)\b/ },
  { id: "formula-coupling", pattern: /formula/i },
  { id: "requirement-or-modifier", pattern: /requirement|modifier|predicate/i },
  { id: "persistence", pattern: /@prowess\/db|prisma|postgres|@prowess\/import/i },
];
const audit = (source: string) => [...new Set(FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

describe("M4-WO4 static audit — scanner control tests (§89)", () => {
  it.each([
    ['if (keyword.canonicalKey === "keyword.fire") { result.damage += 5; }', "literal-identity-switch"],
    ['if (keyword.canonicalKey === "keyword.fire") { result.damage += 5; }', "implicit-mechanics"],
    ['switch (k.canonicalKey) { case "keyword.zone": return area(); }', "literal-identity-switch"],
    ["const key = input.canonicalKey.toLocaleLowerCase();", "locale-or-case"],
    ["const key = input.canonicalKey.toLowerCase();", "locale-or-case"],
    ["keys.sort((a, b) => a.localeCompare(b));", "locale-or-case"],
    ['import { listKeywordDefinitions } from "@prowess/db";', "persistence"],
    ["return set.keywords.find((k) => k.keyword.displayName === probe);", "alias-or-display"],
    ["const hit = definitions.find((d) => d.name === text);", "alias-or-display"],
    ["const viaAlias = aliases.get(text);", "alias-or-display"],
    ["if (present(categoryId)) add(childrenOfCategory(categoryId)); // implied", "hierarchy-or-implication"],
    ["for (const parentId of keyword.parentIds) present.add(parentId);", "hierarchy-or-implication"],
    ["return keys.find((k) => k.startsWith(prefix));", "fuzzy-matching"],
    ["export const KEYWORDS = new Map<string, ResolvedKeyword>();", "mutable-registry"],
    ["let cache = null;", "mutable-registry"],
    ["export function removeKeyword(set, id) {}", "removal-or-negation"],
    ["if (source.authority === 'GOVERNING') keep(source);", "canon-or-import"],
    ["const vars = { [key]: 1 }; evaluateFormula(program, vars);", "formula-coupling"],
    ["export function keywordRequirement(set, id) {}", "requirement-or-modifier"],
    ["const stacks = contributors.length;", "implicit-mechanics"],
    ["const implied = impliedKeywordsOf(categoryId);", "hierarchy-or-implication"],
    ['if (k.keyword.canonicalKey !== "keyword.zone") skip();', "literal-identity-switch"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it("accepts representative resolution code and ignores comments", () => {
    const clean = [
      "// Fire does not deal damage; no alias, no parent, no toLowerCase here",
      'if (!["keyword", "source", "ordinal"].includes(k)) problems.push(p);',
      "const order = byCodeUnit(a.keyword.canonicalKey, b.keyword.canonicalKey);",
      "children: set.keywords.map((k, index) => ({ key: `keyword.${index}` })),",
      "inputs: [{ name: \"keyword_id\", value: stringValue(k.keyword.keywordId) }],",
      'if (typeof canonicalKey !== "string") return null;',
      'if (typeof k.canonicalKey !== "string" || !isValidCanonicalKey(k.canonicalKey)) return bad();',
      "children: k.contributors.map((c, i) => ({ key: `contributor.${i}` })),",
    ].join("\n");
    expect(audit(clean)).toEqual([]);
  });
});

describe("M4-WO4 static audit — the Keyword implementation", () => {
  it("covers the keyword module", () => {
    expect(KEYWORD_FILES.map(rel).sort()).toEqual(["query.ts", "resolve.ts"].map((f) => `packages/prowess-rules/src/keyword/${f}`));
  });

  it.each(KEYWORD_FILES.map((f) => [rel(f), f]))(
    "%s: no mechanics, game names, literal identity switches, alias/display/fuzzy/locale matching, registry, removal, hierarchy, Canon/import, Formula, Requirement/Modifier or persistence (M4-I40 M4-I44 M4-I45 M4-I46 M4-I47 M4-I50)",
    (_n, f) => expect(audit(readFileSync(f, "utf8"))).toEqual([]),
  );

  it("resolution uses the M4-WO1 envelope and WO1 input safety (UUID reader, plain-data inspection)", () => {
    const resolve = strip(read("packages", "prowess-rules", "src", "keyword", "resolve.ts"));
    expect(resolve).toMatch(/import \{ evaluate \} from "\.\.\/evaluation\/evaluate\.js"/);
    expect(resolve).toMatch(/inspectPlainData\(input\)/);
    expect(resolve).toMatch(/readUuid\(/);
    expect(strip(read("packages", "prowess-rules", "src", "keyword", "query.ts"))).toMatch(/readUuid\(/);
  });

  it("M4-I50: ordering uses an explicit code-unit comparator, never default or locale sort", () => {
    const resolve = strip(read("packages", "prowess-rules", "src", "keyword", "resolve.ts"));
    expect(resolve).toMatch(/const byCodeUnit = \(a: string, b: string\) => \(a < b \? -1 : a > b \? 1 : 0\);/);
    expect(resolve).not.toMatch(/\.sort\(\s*\)/);
  });
});

describe("M4-WO4 boundaries (§5–7, §84, §97)", () => {
  it("@prowess/rules still depends on @prowess/model only; no dependency was added anywhere", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    expect(Object.keys(rules.devDependencies).sort()).toEqual(["typescript", "vitest"]);
  });

  it("no new DB service: @prowess/db source never calls Keyword resolution (only a test maps M1 data)", () => {
    for (const f of walk(path.join(ROOT, "packages", "prowess-db", "src")).filter((file) => file.endsWith(".ts"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/resolveKeywords|KeywordContribution|ResolvedKeywordSet/);
    }
  });

  it("adds no Keyword persistence, migration, route or UI", () => {
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/keyword_(sets|contributions|resolutions)|model\s+(ResolvedKeyword|KeywordContribution|KeywordSet)\b/);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e))).toHaveLength(22);
    for (const f of walk(path.join(ROOT, "apps", "studio")).filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/resolveKeywords|hasKeywordBy|@prowess\/rules/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo4-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO4 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 11 }, (_, i) => `M4-I${String(i + 40).padStart(2, "0")}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));

  it("names M4-I40 – M4-I50 and maps every one to an existing automated guard that cites it", () => {
    for (const id of ids) {
      expect(doc, id).toMatch(new RegExp(`\\*\\*${id}\\*\\*`));
      const row = doc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, `coverage row for ${id}`).toBeDefined();
      const files = [...(row as string).matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1] as string);
      expect(files.length, id).toBeGreaterThan(0);
      // Exact basename match (not a suffix match): guard files with overlapping names must not shadow each other.
      const guard = (f: string) => tests.find((t) => path.basename(t) === f);
      for (const f of files) expect(guard(f), `${id}: ${f} exists`).toBeDefined();
      expect(files.some((f) => readFileSync(guard(f) as string, "utf8").includes(id)), `${id} is cited by one of its guards`).toBe(true);
    }
  });
});
