// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";

/**
 * M4-WO6 Modifier Engine — static audit (PAS-10 M4-WO6 §104–108). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I65 Modifiers Transform Explicit Targets Only · M4-I67 Modifier Phases
 * Are Data · M4-I68 Modifier Conditions Reuse Requirement Engine · M4-I70 Numeric Modifiers Never Round Implicitly ·
 * M4-I71 Percentage Modifiers Apply Sequentially · M4-I74 Advantage / Disadvantage Are Signals, Not Roll Semantics ·
 * M4-I75 Modifier Evaluation Has No Side Effects · M4-I79 Listed Cost And Runtime Payment Remain Distinct. (The M4-WO1
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

const MOD_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "modifier");
const MOD_FILES = walk(MOD_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const src = (file: string) => strip(read("packages", "prowess-rules", "src", "modifier", file));

const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "persistence", pattern: /@prowess\/db|prisma|postgres|@prowess\/import/i },
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(/ },
  { id: "callback", pattern: /typeof\s+[\w.]+\s*[!=]==\s*["']function["']|\.call\s*\(|\.apply\s*\(|\.(apply|fn|callback|transform)\s*\(\s*\w+\s*\)/ },
  { id: "game-vocabulary", pattern: /\b(spells?|mana|affinit\w*|armou?r|weapon\w*|casting|somatic|verbal|sustain\w*|efficiency|maneuver\w*|summon\w*|character\w*)\b/i },
  { id: "game-stat", pattern: /\b(AP|MP|ME|HP|STR|AGI|CON|PER|PRO|RES)\b/ },
  { id: "hard-coded-phase", pattern: /(?<!typeof\s+[\w.]*)\bphase(Key)?\s*[!=]==?\s*["'`]/i },
  { id: "hard-coded-phase", pattern: /["'`](BASE|AFFINITY|CONDITIONS?|FINAL_COST|DISCOUNT|PAYMENT)["'`]/ },
  { id: "hard-coded-key", pattern: /(?<!typeof\s+[\w.]*)\b(targetKey|stackingKey|modifierKey|sourceType|sourceKey|currentKey)\s*[!=]==?\s*["'`]/ },
  { id: "implicit-rounding", pattern: /Math\.(round|floor|ceil|trunc|fround)|toFixed|toPrecision|EPSILON|parseFloat|parseInt/ },
  { id: "percentage-combination", pattern: /\.reduce\w*\s*\(|\b(sum|total|combined|aggregate)\w*\s*[=(]/i },
  { id: "dice-semantics", pattern: /\b(dice|die|d(4|6|8|10|12|20)|cancel\w*|net(Advantage|Disadvantage|Signal)\w*|kept|keep(Highest|Lowest)|reroll\w*|rollDice)\b/i },
  { id: "signal-arithmetic", pattern: /\badvantage(\.length)?\s*[-+]\s*\w*\.?disadvantage|\bdisadvantage(\.length)?\s*[-+]\s*\w*\.?advantage/i },
  { id: "resource-payment", pattern: /\b(pay\w*|spend\w*|reserv\w*|deduct\w*|consum\w*|refresh\w*|lock\w*)\b/i },
  { id: "modifier-discovery", pattern: /ActorContext|BuildContext|RuntimeContext|RulesetContext|findResolvedRule|\.ownedEntities|\.keywords\b/ },
  { id: "hidden-latest", pattern: /latest|newest|mostRecent|currentVersion|getCurrent\w*/i },
  { id: "requirement-reimplementation", pattern: /\bfactKey\b|NUMERIC_COMPARE|RANK_AT_LEAST|KEYWORD_PRESENT|SET_CONTAINS|ENTITY_OWNED|hasKeyword\w*|indexFacts|createRequirementFacts/ },
  { id: "formula-execution", pattern: /evaluateFormula|parseFormulaExpression|formula\// },
  { id: "locale-or-case", pattern: /toLocale\w*|localeCompare|\bIntl\b|toLowerCase|toUpperCase|\.normalize\s*\(/ },
  { id: "mutable-registry", pattern: /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|Registry|class\s+\w*Engine/m },
];
const audit = (source: string) => [...new Set(FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

const ALLOWED_CASES = new Set(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "SET", "MIN", "MAX", "INCREASE_PERCENT", "REDUCE_PERCENT", "STEP_UP", "STEP_DOWN", "ADVANTAGE", "DISADVANTAGE", "NUMERIC", "ORDERED", "ROLL_SIGNAL", "STACK", "UNIQUE", "CLAMP", "INVALID"]);
const caseLabels = (source: string) => [...strip(source).matchAll(/\bcase\s+["'`]([^"'`]+)["'`]/g)].map((x) => x[1] as string);

describe("M4-WO6 static audit — scanner control tests (§105, §107, §108)", () => {
  it.each([
    ['import { prisma } from "@prowess/db";', "persistence"],
    ["const v = eval(m.expression);", "code-execution"],
    ['if (targetKey === "spell.mp") return value * 0.9;', "hard-coded-key"],
    ['if (targetKey === "spell.mp") return value * 0.9;', "game-vocabulary"],
    ['if (m.phase.phaseKey === "AFFINITY") skip();', "hard-coded-phase"],
    ['const PHASES = ["AFFINITY", "FINAL_COST"];', "hard-coded-phase"],
    ["return Math.round(current * (1 - operand / 100));", "implicit-rounding"],
    ["w.value = Math.floor(next);", "implicit-rounding"],
    ["const net = w.advantage.length - w.disadvantage.length;", "signal-arithmetic"],
    ["if (adv > 0 && dis > 0) cancelSignals(w);", "dice-semantics"],
    ["const kept = keepHighest(roll2d20());", "dice-semantics"],
    ['if (node.kind === "NUMERIC_COMPARE") return facts.numeric.get(node.factKey) >= node.expected;', "requirement-reimplementation"],
    ["const pct = mods.reduce((acc, x) => acc + (x.operand as number), 0);", "percentage-combination"],
    ["const combinedPercent = a.operand + b.operand;", "percentage-combination"],
    ["payFromResource(w, m.operand);", "resource-payment"],
    ["const extra = context.keywords.filter(isBonus);", "modifier-discovery"],
    ["if (typeof m.apply === \"function\") w.value = m.apply(w.value);", "callback"],
    ["const op = m.operation.toLowerCase();", "locale-or-case"],
    ["export class ModifierEngine { run() {} }", "mutable-registry"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it("accepts representative engine code and ignores comments", () => {
    const clean = [
      "// no rounding, no dice, no Spell MP, no AFFINITY phase, no payment",
      "return current * (1 - operand / 100);",
      'if (typeof node.kind !== "string") return;',
      'const kind: ModifierTargetKind = "ROLL_SIGNAL";',
      "else if (m.operation === \"ADVANTAGE\") w.advantage.push(m.modifierKey);",
      "const r = evaluateValidatedRequirement(m.condition, prepared, [...at(m), \"condition\"]);",
    ].join("\n");
    expect(audit(clean)).toEqual([]);
  });
});

describe("M4-WO6 static audit — the Modifier implementation", () => {
  it("covers the modifier module", () => {
    expect(MOD_FILES.map(rel).sort()).toEqual(["evaluate.ts", "model.ts", "validate.ts"].map((f) => `packages/prowess-rules/src/modifier/${f}`));
  });

  it.each(MOD_FILES.map((f) => [rel(f), f]))(
    "%s: no persistence, callbacks, game operations / phases / keys, rounding, percentage combining, dice semantics, payment, discovery or Requirement re-implementation (M4-I65 M4-I67 M4-I70 M4-I71 M4-I74 M4-I75 M4-I79)",
    (_n, f) => expect(audit(readFileSync(f, "utf8"))).toEqual([]),
  );

  it("M4-I70 / M4-I71: each numeric operation is exactly its documented formula, applied per modifier", () => {
    const evaluator = src("evaluate.ts");
    for (const formula of [
      "return current + operand;",
      "return current - operand;",
      "return current * operand;",
      "return current / operand;",
      "return operand;",
      "return Math.min(current, operand);",
      "return Math.max(current, operand);",
      "return current * (1 + operand / 100);",
      "return current * (1 - operand / 100);",
    ]) {
      expect(evaluator, formula).toContain(formula);
    }
    expect(evaluator.match(/\bMath\.\w+/g)).toEqual(["Math.min", "Math.max"]);
    expect(evaluator).toMatch(/const next = numeric\(m\.operation, w\.value, m\.operand as number\);/);
  });

  it("every switch label belongs to the generic vocabulary (no CUSTOM, no game operation)", () => {
    for (const f of MOD_FILES) for (const label of caseLabels(readFileSync(f, "utf8"))) expect(ALLOWED_CASES.has(label), `${rel(f)}: case "${label}"`).toBe(true);
  });

  it("the documented sort tuple is the only ordering of modifiers", () => {
    expect(src("validate.ts")).toContain(
      "(a, b) => a.phase.phaseOrder - b.phase.phaseOrder || a.priority - b.priority || a.order - b.order || byCodeUnit(a.modifierKey, b.modifierKey),",
    );
  });

  it("M4-I68: conditions go through M4-WO5 — validated by validateRequirement, evaluated against facts prepared once", () => {
    expect(src("validate.ts")).toMatch(/import \{ isExactLabel, validateRequirement \} from "\.\.\/requirement\/validate\.js";/);
    expect(src("validate.ts")).toMatch(/validateRequirement\(m\.condition, /);
    const evaluator = src("evaluate.ts");
    expect(evaluator).toMatch(/import \{ evaluateValidatedRequirement, prepareRequirementFacts, type PreparedRequirementFacts \} from "\.\.\/requirement\/evaluate\.js";/);
    expect(evaluator.match(/prepareRequirementFacts\(/g)).toHaveLength(1);
    expect(evaluator).toMatch(/evaluateValidatedRequirement\(m\.condition, prepared, /);
  });

  it("evaluation goes through the M4-WO1 envelope", () => {
    expect(src("evaluate.ts")).toMatch(/import \{ evaluate \} from "\.\.\/evaluation\/evaluate\.js";/);
  });
});

describe("M4-WO6 boundaries (§5–7, §104)", () => {
  it("@prowess/rules still depends on @prowess/model only", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    expect(Object.keys(rules.devDependencies).sort()).toEqual(["typescript", "vitest"]);
  });

  it("the WO5 prepared-facts path stays internal (not exported from the package entry)", () => {
    expect(strip(read("packages", "prowess-rules", "src", "index.ts"))).not.toMatch(/prepareRequirementFacts|evaluateValidatedRequirement|validateModifiersWithIndex/);
  });

  it("adds no Modifier persistence, migration, route, UI or DB service", () => {
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model\s+Modifier\w*|modifier_(definitions|results|outcomes)/i);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e)).filter(notLaterMigration)).toHaveLength(22);
    for (const f of [...walk(path.join(ROOT, "apps", "studio")), ...walk(path.join(ROOT, "packages", "prowess-db", "src"))].filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/evaluateModifiers|validateModifiers/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo6-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO6 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 15 }, (_, i) => `M4-I${String(i + 65).padStart(2, "0")}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));
  const guard = (f: string) => tests.find((t) => path.basename(t) === f);

  it("names M4-I65 – M4-I79 and maps every one to an existing automated guard that cites it", () => {
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
