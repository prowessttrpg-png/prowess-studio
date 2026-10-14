// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO10 Rules Evaluation Orchestration & HTTP API — static audit (PAS-10 M4-WO10 §153–165). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I135 Rules Evaluation Orchestration Adds No New Mechanics · M4-I136 One
 * Evaluation Run Uses One Exact Ruleset Context · M4-I137 Steps Cannot Override Ruleset / Actor / Build / Runtime Context
 * · M4-I140 Operation Dispatch Is Closed And Static · M4-I141 Bindings Copy Exact Values And Perform No Calculation ·
 * M4-I146 / M4-I147 / M4-I148 no automatic blocking · M4-I155 HTTP Evaluation Is Stateless · M4-I156 HTTP Ruleset
 * Selection Requires Exact Manifest Or Release Identity · M4-I158 Rules Evaluation Performs No Database Writes. (The
 * M4-WO1 audit additionally applies all package-wide purity rules to the orchestration files.)
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

const ORC_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "orchestration");
const ORC_FILES = walk(ORC_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const orc = (file: string) => strip(read("packages", "prowess-rules", "src", "orchestration", file));
const ROUTE = ["apps", "studio", "app", "api", "rules", "evaluate", "route.ts"];
const SERVICE = ["apps", "studio", "src", "rules-evaluation", "service.ts"];
const OPERATIONS = [
  "FORMULA",
  "KEYWORD",
  "REQUIREMENT",
  "MODIFIER",
  "RESOURCE_SPEND",
  "RESOURCE_RESTORE",
  "RESOURCE_SET_CURRENT",
  "RESOURCE_RESERVE_CAPACITY",
  "RESOURCE_RELEASE_CAPACITY",
  "RESOURCE_REFRESH",
  "RESOURCE_PAYMENT_PREVIEW",
  "RESOURCE_PAYMENT_APPLY",
  "VALIDATION",
  "EXPLANATION",
];

/** Pure-orchestrator rules. */
const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "persistence-or-import", pattern: /@prowess\/db|prisma|postgres|@prowess\/import|ImportDecision|ExtractionCandidate/i },
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(/ },
  { id: "dynamic-dispatch", pattern: /register\w*\s*\(|\w*Registry\b|\[[^\]\n]*\]\s*\(|typeof\s+[\w.]+\s*[!=]==\s*["']function["']|\.call\s*\(|\.apply\s*\(/ },
  { id: "game-operation", pattern: /\b(SPELL|AFFINITY|MANA|WEAPON|ARMOR|MANEUVER|SUMMON|CHARACTER|SUSTAIN)_?\w*\b/ },
  { id: "game-vocabulary", pattern: /\b(spells?|mana|affinit\w*|weapons?|maneuvers?|summon\w*|character\w*|sustain\w*|expert|trained|master)\b/i },
  { id: "game-stat", pattern: /\b(AP|MP|ME|HP|STR|AGI|CON|PER|PRO|RES)\b/ },
  // Operators need surrounding whitespace (repo formatting), so hyphenated paths such as "evaluation-value" never match.
  { id: "binding-arithmetic", pattern: /Math\.(floor|ceil|round|trunc|fround|abs|pow)|toFixed|toPrecision|parseFloat|parseInt|\b(value|resolved\w*|found\.value)\s+[-+*/%]\s+\w|\w\s+[-+*/%]\s+\b(value|resolved\w*)\b/ },
  {
    id: "primitive-reimplementation",
    pattern: /allocatePayment|evaluateValidatedRequirement|prepareRequirementFacts|validateRequirement\b|validateModifiers|readSourceResponse|projectTrace|factsOf|aggregateKeywordContributions|parseFormulaExpression|phaseOrder|stackingKey|\bremaining\b/,
  },
  { id: "automatic-blocking", pattern: /\.satisfied\b|\.canPay\b|SKIPPED_CONDITION|\.shortfall\b|response\??\.status\s*[!=]==|\.success\s*[!=]==|status\s*===\s*["'](INVALID|ERROR)["']/ },
  { id: "effective-cost", pattern: /effective\w*|netCost|adjustedCost|reducedCost|discount\w*/i },
  { id: "latest-or-current", pattern: /latest|newest|mostRecent|getCurrent\w*|currentVersion|activeRuleset|defaultRuleset/i },
  { id: "step-context-override", pattern: /step\.(ruleset|contexts?|actor|build|runtime)\b|\bstepRuleset\b|\bruleset\s*:\s*step\./ },
  { id: "randomness-or-time", pattern: /randomUUID|Math\.random|Date\.now|new\s+Date\b|performance\.now|evaluatedAt|startedAt|duration/ },
  { id: "locale-or-case", pattern: /toLocale\w*|localeCompare|\bIntl\b|toLowerCase|toUpperCase/ },
  { id: "mutable-registry", pattern: /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|class\s+\w*(Orchestrator|Engine)\b/m },
];
const audit = (source: string) => [...new Set(FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

/** Studio application-layer rules (route + service). */
const APP_FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "direct-prisma", pattern: /@prisma\/|from\s+["'][^"']*generated\/prisma|\bprisma\b\s*\.|from\s+["']prisma["']|@prowess\/db\/src/ },
  { id: "latest-or-current", pattern: /latest|newest|mostRecent|getCurrent\w*|currentVersion|activeRuleset|defaultRuleset|getLatest\w*/i },
  { id: "database-write", pattern: /\b(create|update|upsert|delete|save|persist|commit|publish|record)\w*\s*\(|\$executeRaw|\$transaction/ },
  { id: "rule-logic", pattern: /\.sort\s*\(|Math\.|evaluateFormula|evaluateRequirement|evaluateModifiers|applyResourcePayment|evaluateValidation|buildExplanation|readAt|writeAt/ },
  { id: "game-vocabulary", pattern: /\b(spells?|mana|affinit\w*|weapons?|character\w*)\b/i },
];
const appAudit = (source: string) => [...new Set(APP_FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

describe("M4-WO10 static audit — scanner control tests (§154–165)", () => {
  it.each([
    ['import { prisma } from "@prowess/db";', "persistence-or-import"],
    ["const ctx = getLatestManifest(rulesetId);", "latest-or-current"],
    ["const ctx = getCurrentRuleset(rulesetId);", "latest-or-current"],
    ["values.push({ tokens, value: found.value * 2 });", "binding-arithmetic"],
    ["writeAt(input, tokens, Math.floor(value));", "binding-arithmetic"],
    ['if (operation === "SPELL_COST") return computeSpellMp(input);', "game-operation"],
    ['if (key === "stat.STR") boost();', "game-stat"],
    ["if (rank === \"Expert\") block();", "game-vocabulary"],
    ["if (prior.response.data.satisfied === false) block(\"DEPENDENCY_BLOCKED\");", "automatic-blocking"],
    ["if (prior.response.data.canPay === false) return invalidRun();", "automatic-blocking"],
    ['if (outcome.status === "SKIPPED_CONDITION") warn();', "automatic-blocking"],
    ['if (prior.response.status === "INVALID") block("DEPENDENCY_BLOCKED");', "automatic-blocking"],
    ["const effectiveCost = listedAmount - temporaryPayment;", "effective-cost"],
    ["return dispatch(step.operation, input, step.ruleset ?? ruleset);", "step-context-override"],
    ["const handler = ADAPTERS[operation](input);", "dynamic-dispatch"],
    ["registerOperation(\"X\", fn);", "dynamic-dispatch"],
    ["const out = allocatePayment(snapshot, payment);", "primitive-reimplementation"],
    ["const evaluatedAt = new Date().toISOString();", "randomness-or-time"],
    ["export class RulesOrchestrator { run() {} }", "mutable-registry"],
  ])("pure layer catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it.each([
    ['import { prisma } from "@prowess/db"; prisma.rulesetManifest.findMany();', "direct-prisma"],
    ['import { PrismaClient } from "@prisma/client";', "direct-prisma"],
    ["const ruleset = await getLatestRulesetRelease(rulesetId);", "latest-or-current"],
    ["await saveEvaluationRun(result);", "database-write"],
    ["await commitResources(characterId, result);", "database-write"],
    ["const steps = plan.steps.sort((a, b) => a.order - b.order);", "rule-logic"],
  ])("application layer catches %s", (snippet, id) => expect(appAudit(snippet)).toContain(id));

  it("accepts representative code and ignores comments", () => {
    const pure = [
      "// never getLatestManifest; no Spell / MP; no effective cost; no Math.floor",
      "case \"FORMULA\":\n  return evaluateFormula(input.program, input.variables, options);",
      "if (found.found) values.push({ tokens: b.targetTokens, value: found.value });",
    ].join("\n");
    expect(audit(pure)).toEqual([]);
    expect(appAudit("const ruleset = request.ruleset.kind === \"MANIFEST\" ? await resolveRulesetContextFromManifest(id) : await resolveRulesetContextFromRelease(id);")).toEqual([]);
  });
});

describe("M4-WO10 static audit — the pure orchestrator", () => {
  it("covers the orchestration module", () => {
    expect(ORC_FILES.map(rel).sort()).toEqual(["model.ts", "orchestrate.ts", "plan.ts", "pointer.ts"].map((f) => `packages/prowess-rules/src/orchestration/${f}`));
  });

  it.each(ORC_FILES.map((f) => [rel(f), f]))(
    "%s: no database, dynamic dispatch, game operations, binding arithmetic, primitive re-implementation, automatic blocking, effective cost, latest lookup, step context override or randomness (M4-I135 M4-I140 M4-I141 M4-I146 M4-I147 M4-I148)",
    (_n, f) => expect(audit(readFileSync(f, "utf8"))).toEqual([]),
  );

  it("M4-I140: the operation vocabulary is exactly the 14 primitives, and dispatch is one closed switch over them", () => {
    expect(orc("model.ts")).toContain(`export const EVALUATION_OPERATIONS = [\n  ${OPERATIONS.map((o) => `"${o}"`).join(",\n  ")},\n] as const;`);
    const cases = [...orc("orchestrate.ts").matchAll(/\bcase\s+"([A-Z_]+)":/g)].map((m) => m[1]);
    expect(cases).toEqual(OPERATIONS);
  });

  it("M4-I136 / M4-I137: every adapter receives the one shared options object built from the run's single RulesetContext", () => {
    const o = orc("orchestrate.ts");
    expect(o.match(/const options = \{ ruleset \};/g)).toHaveLength(1);
    expect(o.match(/return \w+\([^;]*, options\);/g)).toHaveLength(OPERATIONS.length);
    expect(o).toMatch(/const ruleset = request\.ruleset as RulesetContext;/);
    expect(o).toMatch(/requires: \["RULESET"\]/);
    expect(orc("plan.ts")).toContain('const STEP_FIELDS = ["stepKey", "order", "operation", "input", "bindings"];');
  });

  it("M4-I141: binding values are copied verbatim (clone + write) — never transformed", () => {
    const o = orc("orchestrate.ts");
    expect(o).toContain("for (const { tokens, value } of values) writeAt(input, tokens, clonePlainData(value));");
    expect(orc("plan.ts")).toMatch(/if \(!ownRecord\(b, \["target", "source"\]\)\)/);
  });

  it("M4-I143 / M4-I144: a STEP reference must point strictly backwards in execution order", () => {
    expect(orc("plan.ts")).toMatch(/else if \(p >= i\) report\(ORCHESTRATION_DIAGNOSTIC_CODES\.INVALID_REFERENCE/);
  });
});

describe("M4-WO10 static audit — the Studio HTTP / application layer", () => {
  it("M4-I155 / M4-I158: the route is thin — strict body, one service call, serialization, central errors; POST only", () => {
    const route = strip(read(...ROUTE));
    expect(appAudit(route)).toEqual([]);
    expect(route).not.toMatch(/@prowess\/db|@prowess\/rules/);
    expect([...route.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1])).toEqual(["POST"]);
    expect(route).toContain("return apiSuccess(serializeForApi(await evaluateRules(readRulesEvaluationRequest(body))), 200);");
  });

  it("M4-I156 / M4-I157: the service resolves exactly one exact selector through WO2 and never accepts a resolved context", () => {
    const service = strip(read(...SERVICE));
    expect(appAudit(service)).toEqual([]);
    expect(service).toMatch(/import \{ resolveRulesetContextFromManifest, resolveRulesetContextFromRelease \} from "@prowess\/db";/);
    expect(service).toContain('export const RULES_EVALUATION_BODY_FIELDS = ["ruleset", "evaluationKey", "actor", "build", "runtime", "plan"] as const;');
    expect(service).toContain('strictObject(value, ["kind", "manifestId"], "ruleset")');
    expect(service).toContain('strictObject(value, ["kind", "releaseId"], "ruleset")');
    expect(service.match(/orchestrateRulesEvaluation\(/g)).toHaveLength(1);
  });

  it("the only rules route is POST /api/rules/evaluate — no commit, apply, PATCH / PUT / DELETE routes", () => {
    const rulesRoutes = walk(path.join(ROOT, "apps", "studio", "app", "api", "rules")).map(rel);
    expect(rulesRoutes).toEqual(["apps/studio/app/api/rules/evaluate/route.ts"]);
    for (const f of walk(path.join(ROOT, "apps", "studio", "app", "api")).filter((x) => x.endsWith("route.ts"))) {
      expect(rel(f), rel(f)).not.toMatch(/commit|apply-to-character|evaluation-runs|rules\/(apply|persist)/);
    }
  });

  it("no evaluation persistence, migration or schema change; no UI page", () => {
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model\s+(EvaluationRun|RulesEvaluation|EvaluationPlan)\w*|evaluation_(runs|plans|results)/i);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e))).toHaveLength(22);
    expect(existsSync(path.join(ROOT, "apps", "studio", "app", "developer", "rules"))).toBe(false);
    for (const f of walk(path.join(ROOT, "apps", "studio", "app")).filter((x) => /\.tsx$/.test(x))) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\/api\/rules\/evaluate|orchestrateRulesEvaluation/);
  });

  it("@prowess/rules still depends on @prowess/model only; Studio adds @prowess/rules", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    const studio = JSON.parse(read("apps", "studio", "package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(studio.dependencies).filter((d) => d.startsWith("@prowess/")).sort()).toEqual(["@prowess/db", "@prowess/model", "@prowess/rules", "@prowess/ui"]);
  });

  it("permanent CI runs the audit and the HTTP integration as named gates", () => {
    const ci = read(".github", "workflows", "ci.yml");
    expect(ci).toContain("tests/unit/m4-wo10-static.test.ts");
    expect(ci).toContain("tests/integration/m4-rules-evaluation-api.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO10 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 28 }, (_, i) => `M4-I${i + 135}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));
  const guard = (f: string) => tests.find((t) => path.basename(t) === f);

  it("names M4-I135 – M4-I162 and maps every one to an existing automated guard that cites it", () => {
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
