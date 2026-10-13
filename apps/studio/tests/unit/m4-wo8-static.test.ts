// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO8 Validation Engine — static audit (PAS-10 M4-WO8 §141–150). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I99 Validation Consumes Exact Results; It Does Not Recalculate Mechanics
 * · M4-I101 Explicit Validation Checks Are Plain Data · M4-I102 Check Failure Severity Is Explicit · M4-I103 PASS Emits
 * No Finding · M4-I105 Validation Collects All Discoverable Findings · M4-I109 / M4-I110 / M4-I111 no automatic
 * reclassification · M4-I112 Existing Subsystem Diagnostics Preserve Their Meaning. (The M4-WO1 audit additionally
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

const VAL_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "validation-engine");
const VAL_FILES = walk(VAL_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const src = (file: string) => strip(read("packages", "prowess-rules", "src", "validation-engine", file));
const CATS = "STRUCTURE|COMPATIBILITY|REQUIREMENT|PARAMETER|CAPACITY|RESOURCE|FORMULA|RULESET|RUNTIME";

const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "persistence-or-import", pattern: /@prowess\/db|prisma|postgres|@prowess\/import|ImportDecision|ExtractionCandidate|ImportBatch|MatchRun/i },
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(/ },
  { id: "callback-validator", pattern: /typeof\s+[\w.]+\s*[!=]==\s*["']function["']|\.call\s*\(|\.apply\s*\(|register\w*Validator|Validator\w*Registry|\.check\s*\(\s*\)/ },
  { id: "formula-reimplementation", pattern: /\bexpression\b|tokeniz\w*|\bMath\.\w+|evaluateFormula|parseFormula\w*|formula\// },
  { id: "requirement-reimplementation", pattern: /\b(rank|required\w*)\.order\b|requiredOrder|requiredRankKey|\brankKey\b|\bfactKey\b|NUMERIC_COMPARE|RANK_AT_LEAST|KEYWORD_PRESENT|SET_CONTAINS|ENTITY_OWNED|evaluateRequirement|\.satisfied\b/ },
  { id: "resource-interpretation", pattern: /\.canPay\b|\bshortfall\b|listedAmount|applyResourcePayment|previewResourcePayment|resultingResources|availableMaximum/ },
  { id: "modifier-interpretation", pattern: /SKIPPED_CONDITION|DEDUPLICATED|evaluateModifiers|\.outcomes\b|finalTargets/ },
  { id: "keyword-matching", pattern: /hasKeyword\w*|findResolvedKeyword\w*|resolveKeywords|canonicalKey/ },
  { id: "ruleset-resolution", pattern: /resolveRulesetContext\w*|getEffectiveManifest\w*|manifest|RulesetRelease|findResolvedRule/i },
  { id: "canon-authority", pattern: /canon(?!ical)|GOVERNING|authority|confidence/i },
  { id: "natural-language", pattern: /\.split\s*\(|\.match\s*\(|new\s+RegExp|\.replace\w*\s*\(|\brequires\s+\w+/ },
  { id: "hidden-latest", pattern: /latest|newest|mostRecent|getCurrent\w*|currentVersion/i },
  { id: "category-severity", pattern: new RegExp(`category\\s*[!=]==?\\s*["'\`]|\\bcase\\s+["'\`](${CATS})["'\`]|Record<ValidationCategory,\\s*ValidationSeverity>|["'\`]?\\b(${CATS})["'\`]?\\s*:\\s*["'\`](ERROR|WARNING|INFO)["'\`]`) },
  { id: "auto-correction", pattern: /auto\w*(fix|correct|clamp|select|remove|promote)|\bfix\w*\s*\(|\bbalance\w*/i },
  { id: "game-vocabulary", pattern: /\b(spells?|affinit\w*|weapons?|mana|maneuvers?|summon\w*|character\w*|expert|trained|master)\b/i },
  { id: "game-stat", pattern: /\b(AP|MP|ME|HP|STR|AGI|CON|PER|PRO|RES)\b/ },
  { id: "locale-or-case", pattern: /toLocale\w*|localeCompare|\bIntl\b|toLowerCase|toUpperCase|\.normalize\s*\(/ },
  { id: "mutable-registry", pattern: /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|class\s+\w*Engine/m },
];
const audit = (source: string) => [...new Set(FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

/** No-short-circuit rule for the combining evaluator. */
const shortCircuit = (source: string) => {
  const text = strip(source);
  const v: string[] = [];
  if (/\bbreak\b/.test(text)) v.push("loop-exit");
  if (/\.(some|every|find|findIndex|findLast)\s*\(/.test(text)) v.push("early-exit-array-method");
  if (/severity\s*===\s*["']ERROR["'][^\n]*\)\s*return\b/.test(text)) v.push("return-on-first-error");
  return v;
};

describe("M4-WO8 static audit — scanner control tests (§142–150)", () => {
  it.each([
    ["const value = evaluateArithmetic(tokenize(check.expression));", "formula-reimplementation"],
    ["const total = Math.floor(a / b);", "formula-reimplementation"],
    ["if (rank.order < required.order) emit(check);", "requirement-reimplementation"],
    ["if (resource.canPay === false) messages.push(error(\"RUNTIME\"));", "resource-interpretation"],
    ['if (modifier.status === "SKIPPED_CONDITION") warn(modifier);', "modifier-interpretation"],
    ['if (check.code.startsWith("SPELL")) severity = "ERROR";', "game-vocabulary"],
    ['if (rankLabel === "Expert") ok();', "game-vocabulary"],
    ["if (facts.MP < 5) fail();", "game-stat"],
    ['import { prisma } from "@prowess/db";', "persistence-or-import"],
    ['if (c.category === "RESOURCE") severity = "ERROR";', "category-severity"],
    ['const POLICY = { RESOURCE: "ERROR", COMPATIBILITY: "WARNING" };', "category-severity"],
    ["const latest = getLatestValidation(runs);", "hidden-latest"],
    ["const rules = getCurrentRules(context);", "hidden-latest"],
    ["if (typeof check.validate === \"function\") check.validate();", "callback-validator"],
    ["registerValidator(\"spell\", fn);", "callback-validator"],
    ['const m = text.match(/requires (\\w+)/);', "natural-language"],
    ["const fixed = autoClampParameter(value);", "auto-correction"],
    ["if (authority === \"GOVERNING\") prefer(source);", "canon-authority"],
    ["const pin = getEffectiveManifestEntries(id);", "ruleset-resolution"],
    ["const present = hasKeywordById(set, id);", "keyword-matching"],
    ["export class ValidationEngine { run() {} }", "mutable-registry"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it.each([
    ["return after the first error", "for (const m of messages) { if (m.severity === \"ERROR\") return { data: null, messages: [m] }; }", "return-on-first-error"],
    ["break out of the loop", "for (const c of checks) { if (failed(c)) break; }", "loop-exit"],
    ["find the first failure", "const first = checks.find((c) => c.outcome === \"FAIL\");", "early-exit-array-method"],
  ])("short-circuit control: %s", (_label, snippet, id) => expect(shortCircuit(snippet)).toContain(id));

  it("accepts representative engine code and ignores comments", () => {
    const clean = [
      "// never re-run a Formula; never treat canPay:false or SKIPPED_CONDITION as a finding; no Spell rules",
      'own(VALIDATION_DIAGNOSTIC_CODES.INVALID_CHECK, "malformed check", at);',
      "messages.push(validationMessage({ severity: k.failureSeverity, category: k.category, code: k.code, message: m, path: k.path, provenance: k.provenance, details: k.details }));",
      "return a.entry.order - b.entry.order || byCodeUnit(ka, kb);",
    ].join("\n");
    expect(audit(clean)).toEqual([]);
    expect(shortCircuit(clean)).toEqual([]);
  });
});

describe("M4-WO8 static audit — the Validation implementation", () => {
  it("covers the validation-engine module", () => {
    expect(VAL_FILES.map(rel).sort()).toEqual(["evaluate.ts", "model.ts", "source.ts"].map((f) => `packages/prowess-rules/src/validation-engine/${f}`));
  });

  it.each(VAL_FILES.map((f) => [rel(f), f]))(
    "%s: no recalculation, reclassification, callbacks, category-driven severity, prose parsing, latest lookups, Canon / import logic, auto-correction or game rules (M4-I99 M4-I101 M4-I102 M4-I109 M4-I110 M4-I111)",
    (_n, f) => expect(audit(readFileSync(f, "utf8"))).toEqual([]),
  );

  it("M4-I105: the combining evaluator never short-circuits", () => {
    expect(shortCircuit(read("packages", "prowess-rules", "src", "validation-engine", "evaluate.ts"))).toEqual([]);
  });

  it("the M4-WO1 vocabularies and envelope are reused — no competing categories, severities, statuses or envelope", () => {
    for (const f of VAL_FILES) {
      const text = strip(readFileSync(f, "utf8"));
      expect(text, rel(f)).not.toMatch(/(CATEGORIES|SEVERITIES|STATUSES)\s*=\s*\[|["'`](PASSED|FAILED|BROKEN|READY)["'`]/);
    }
    expect(src("model.ts")).toMatch(/import type \{ ValidationCategory, ValidationSeverity \} from "\.\.\/validation\/validation-message\.js";/);
    expect(src("evaluate.ts")).toMatch(/import \{ evaluate \} from "\.\.\/evaluation\/evaluate\.js";/);
    expect(src("source.ts")).toMatch(/import \{ deriveResponseStatus, isSuccessStatus, RULE_ENGINE_RESPONSE_STATUSES/);
  });

  it("M4-I112: a source's diagnostics are re-emitted field for field", () => {
    expect(src("evaluate.ts")).toContain(
      "messages.push(validationMessage({ severity: v.severity, category: v.category, code: v.code, message: v.message, path: v.path, provenance: v.provenance, details: v.details }));",
    );
  });

  it("M4-I103: only FAIL emits a check finding, and its severity is the check's declared failureSeverity (M4-I102)", () => {
    const evaluator = src("evaluate.ts");
    expect(evaluator).toMatch(/if \(k\.outcome === "FAIL"\) \{\s*messages\.push\(\s*validationMessage\(\{\s*severity: k\.failureSeverity,/);
    expect(evaluator.match(/k\.outcome === "FAIL"/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("M4-I99 / M4-I109 / M4-I110 / M4-I111: a source's business data is never read beyond the M4-WO1 null check", () => {
    expect(src("source.ts").match(/\.data\b/g)).toEqual([".data"]);
    expect(src("source.ts")).toContain("if (!response.success && response.data !== null)");
    expect(src("evaluate.ts")).not.toMatch(/\.response\.data|read\.data|\.data\./);
  });
});

describe("M4-WO8 boundaries (§4–6, §141)", () => {
  it("@prowess/rules still depends on @prowess/model only", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    expect(Object.keys(rules.devDependencies).sort()).toEqual(["typescript", "vitest"]);
  });

  it("adds no validation persistence, migration, route, UI or DB service", () => {
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model\s+Validation\w*|validation_(rules|runs|results|findings)/i);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e))).toHaveLength(22);
    for (const f of [...walk(path.join(ROOT, "apps", "studio")), ...walk(path.join(ROOT, "packages", "prowess-db", "src"))].filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/evaluateValidation/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo8-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO8 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 17 }, (_, i) => `M4-I${i + 99}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));
  const guard = (f: string) => tests.find((t) => path.basename(t) === f);

  it("names M4-I99 – M4-I115 and maps every one to an existing automated guard that cites it", () => {
    for (const id of ids) {
      expect(doc, id).toMatch(new RegExp(`\\*\\*${id}\\*\\*`));
      const row = doc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, `coverage row for ${id}`).toBeDefined();
      const files = [...(row as string).matchAll(/`([\w./-]+\.test\.ts)`/g)].map((x) => x[1] as string);
      expect(files.length, id).toBeGreaterThan(0);
      for (const f of files) expect(guard(f), `${id}: ${f} exists`).toBeDefined();
      expect(files.some((f) => readFileSync(guard(f) as string, "utf8").includes(id)), `${id} is cited by one of its guards`).toBe(true);
    }
  });
});
