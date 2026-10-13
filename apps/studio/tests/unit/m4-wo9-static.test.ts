// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO9 Calculation Trace & Explanation Engine — static audit (PAS-10 M4-WO9 §139–149). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I116 Explanation Describes Exact Results; It Does Not Recalculate
 * Mechanics · M4-I117 Explanation Uses Existing CalculationTrace As Authority · M4-I121 Summary Projection Cannot
 * Invent Mechanics · M4-I128 Listed Cost And Runtime Payment Remain Visibly Distinct · M4-I129 Explanation Never
 * Rewrites Prior Formula / Modifier / Resource Results · M4-I133 Explanation Node Identity Contains No Randomness ·
 * M4-I134 Explanation Has No Database, Canon, Import Or Latest Lookup. (The M4-WO1 audit additionally applies all
 * package-wide purity rules to these files.)
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

const EXP_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "explanation");
const EXP_FILES = walk(EXP_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const src = (file: string) => strip(read("packages", "prowess-rules", "src", "explanation", file));

const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "persistence-or-import", pattern: /@prowess\/db|prisma|postgres|@prowess\/import|ImportDecision|ExtractionCandidate|SourceDocument/i },
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(/ },
  { id: "network-or-ai", pattern: /\bfetch\s*\(|https?:\/\/|XMLHttpRequest|WebSocket|anthropic|openai|completion|\bllm\b/i },
  {
    id: "re-evaluation",
    pattern:
      /evaluateFormula|parseFormula\w*|validateFormulaProgram|evaluateRequirement|evaluateValidatedRequirement|validateRequirement|evaluateModifiers|validateModifiers|spendResource|restoreResource|setResourceCurrent|reserveResourceCapacity|releaseResourceCapacity|refreshResource|applyResourcePayment|previewResourcePayment|allocatePayment|evaluateValidation|resolveKeywords|aggregateKeywordContributions|resolveRulesetContext\w*|getEffectiveManifest\w*/,
  },
  { id: "canon-or-latest", pattern: /canon(?!ical)|GOVERNING|authority|latest|newest|mostRecent|getCurrent\w*|currentVersion/i },
  { id: "rounding-or-formatting", pattern: /Math\.(round|floor|ceil|trunc|fround|max|min|abs|pow)|toFixed|toPrecision|toLocaleString|\bIntl\b|EPSILON|parseFloat|parseInt/ },
  { id: "arithmetic-on-results", pattern: /\b(num|field)\([^)]*\)\s*[-+*/%]|[-+*/%]\s*\b(num|field)\(/ },
  { id: "effective-cost", pattern: /effective\w*|netCost|adjustedCost|reducedCost|discount\w*|reduced\s+to/i },
  { id: "randomness-or-time", pattern: /randomUUID|Math\.random|Date\.now|new\s+Date\b|performance\.now|\bcrypto\b/ },
  { id: "template-or-callback", pattern: /\$\{\s*(value|amount|modifier|operand|before|after)\b|\btemplate\w*|\brender\w*\s*\(|typeof\s+[\w.]+\s*[!=]==\s*["']function["']|\.call\s*\(|\.apply\s*\(/ },
  { id: "inferred-grouping-or-unit", pattern: /(targetKey|resourceKey|sectionKey|contributionKey|factKey)\.(startsWith|includes|split|match)\s*\(|\bunit\s*[:=]\s*["'`][^"'`]+["'`]/ },
  { id: "game-vocabulary", pattern: /\b(spells?|mana|affinit\w*|weapons?|maneuvers?|summon\w*|character\w*|armou?r|sustain\w*|expert|trained|master)\b/i },
  { id: "game-stat", pattern: /\b(AP|MP|ME|HP|STR|AGI|CON|PER|PRO|RES)\b/ },
  { id: "locale-or-case", pattern: /toLocale\w*|localeCompare|toLowerCase|toUpperCase|\.normalize\s*\(/ },
  { id: "mutable-registry", pattern: /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|class\s+\w*(Engine|Builder)\b/m },
];
const audit = (source: string) => [...new Set(FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

describe("M4-WO9 static audit — scanner control tests (§140–149)", () => {
  it.each([
    ["const again = evaluateFormula(program, bindings);", "re-evaluation"],
    ["const ok = evaluateRequirement(tree, facts);", "re-evaluation"],
    ["const mods = evaluateModifiers(request);", "re-evaluation"],
    ["const paid = applyResourcePayment(snapshot, payment);", "re-evaluation"],
    ["const v = evaluateValidation({ sources });", "re-evaluation"],
    ["const effectiveCost = num(data, \"listedAmount\") - num(allocation, \"amountPaid\");", "effective-cost"],
    ["const effectiveCost = num(data, \"listedAmount\") - num(allocation, \"amountPaid\");", "arithmetic-on-results"],
    ["fact(\"total\", \"Total\", Math.round(num(data, \"finalValue\")));", "rounding-or-formatting"],
    ["fact(\"total\", \"Total\", num(data, \"finalValue\").toFixed(2));", "rounding-or-formatting"],
    ['if (sectionKey === "spell.mp") label = "Mana";', "game-vocabulary"],
    ['if (unit === "AP") return;', "game-stat"],
    ['if (rank === "Expert") status = "SATISFIED";', "game-vocabulary"],
    ['import { prisma } from "@prowess/db";', "persistence-or-import"],
    ["const nodeId = crypto.randomUUID();", "randomness-or-time"],
    ["const nodeId = `${key}-${Math.random()}`;", "randomness-or-time"],
    ["const nodeId = `${key}-${Date.now()}`;", "randomness-or-time"],
    ["const text = await fetch(\"https://api.example.com/explain\");", "network-or-ai"],
    ["const label = `${value} after ${modifier}`;", "template-or-callback"],
    ["const group = targetKey.startsWith(\"cost.\") ? \"Cost\" : null;", "inferred-grouping-or-unit"],
    ["const rules = getCurrentRules(context);", "canon-or-latest"],
    ["export class ExplanationEngine { build() {} }", "mutable-registry"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it("accepts representative explanation code and ignores comments", () => {
    const clean = [
      "// never re-run evaluateFormula; no effective cost; no Math.round; Spell / MP examples live in docs only",
      'fact("listedAmount", "Listed amount", num(data, "listedAmount")),',
      "nodeId: `${contributionKey}#${expectedPath}`,",
      'const readSourceResponseResult = readSourceResponse(c.response);',
    ].join("\n");
    expect(audit(clean)).toEqual([]);
  });
});

describe("M4-WO9 static audit — the Explanation implementation", () => {
  it("covers the explanation module", () => {
    expect(EXP_FILES.map(rel).sort()).toEqual(["build.ts", "model.ts", "project.ts"].map((f) => `packages/prowess-rules/src/explanation/${f}`));
  });

  it.each(EXP_FILES.map((f) => [rel(f), f]))(
    "%s: no re-evaluation, rounding, arithmetic on results, effective cost, randomness, AI / network, templates, inferred grouping or units, game rules, DB / Canon / import / latest (M4-I116 M4-I128 M4-I129 M4-I133 M4-I134)",
    (_n, f) => expect(audit(readFileSync(f, "utf8"))).toEqual([]),
  );

  it("M4-I117: traces are read through WO1 contracts — no second trace system", () => {
    const build = src("build.ts");
    expect(build).toMatch(/const TRACE_STEP_FIELDS = \["ordinal", "path", "key", "operation", "phase", "inputs", "output", "provenance", "modifierSource", "explanation", "children"\];/);
    expect(build).toMatch(/import \{ readSourceResponse \} from "\.\.\/validation-engine\/source\.js";/);
    expect(build).toMatch(/sourceTracePath: expectedPath,\s*sourceTraceOrdinal: s\.ordinal,/);
    for (const f of EXP_FILES) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\bbuildTrace\s*\(/);
  });

  it("M4-I133: node identity is content-derived", () => {
    expect(src("build.ts")).toContain("nodeId: `${contributionKey}#${expectedPath}`,");
    expect(src("build.ts")).toContain("explanationPath: `${sectionPosition}/${expectedPath}`,");
  });

  it("presentation statuses read only explicit trace fields (operation, inputs, output)", () => {
    const build = src("build.ts");
    const start = build.indexOf("function nodeStatus(");
    const body = build.slice(start, build.indexOf("\ninterface MutableNode", start));
    expect(body).toMatch(/^function nodeStatus\(kind: ExplanationContributionKind, operation: string, inputs: readonly TraceInput\[\], output: EvaluationValue \| null\)/);
    expect(body).not.toMatch(/\bdata\b|\bresponse\b|typeof\s/);
  });

  it("M4-I121: projection only filters — it copies node fields and never creates values", () => {
    const project = src("project.ts");
    expect(project).toContain("const copy: Built = { ...fields, children: [], omittedChildCount: 0 };");
    expect(project).not.toMatch(/\b(nodeId|sourceTracePath|sourceTraceOrdinal|inputs|output|status|label|facts|value)\s*:/);
    expect(project).not.toMatch(/\bfactsOf\b|\bnodeStatus\b|readSourceResponse/);
  });

  it("M4-I128: the payment facts copy the listed amount and each allocation — and name no derived cost", () => {
    const build = src("build.ts");
    expect(build).toContain('fact("listedAmount", "Listed amount", num(data, "listedAmount")),');
    expect(build).toContain('...allocations.map((a) => fact(`paid:${String(field(a, "resourceKey"))}`, "Paid by source", num(a, "amountPaid"))),');
  });
});

describe("M4-WO9 boundaries (§4–6, §139)", () => {
  it("@prowess/rules still depends on @prowess/model only", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    expect(Object.keys(rules.devDependencies).sort()).toEqual(["typescript", "vitest"]);
  });

  it("adds no explanation persistence, trace cache, migration, route, UI or DB service", () => {
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model\s+(Explanation|Trace)\w*|(explanation|trace)_(documents|cache|runs)/i);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e))).toHaveLength(22);
    for (const f of [...walk(path.join(ROOT, "apps", "studio")), ...walk(path.join(ROOT, "packages", "prowess-db", "src"))].filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/buildExplanation|projectExplanation/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo9-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO9 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 19 }, (_, i) => `M4-I${i + 116}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));
  const guard = (f: string) => tests.find((t) => path.basename(t) === f);

  it("names M4-I116 – M4-I134 and maps every one to an existing automated guard that cites it", () => {
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
