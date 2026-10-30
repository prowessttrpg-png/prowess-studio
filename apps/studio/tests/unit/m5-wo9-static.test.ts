// @vitest-environment node
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";
import { CONDITION_POLICY, DURATION_CONDITION_CONTENT } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions";
import { auditM5Source } from "./m5-wo1-audit-helpers";
const root = resolve(import.meta.dirname, "../../../.."), read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * M5-CLOSEOUT-03 C5: the dedicated `m5-wo9.yml` workflow was retired after its checks moved into the consolidated
 * permanent CI. The same file-level assertions now run against that gate's entry in the machine-checked inventory
 * (scripts/ci/gates.json, which ci-gate-inventory.test.ts ties to ci.yml), and the old workflow must stay retired.
 */
const consolidated = (id: string, workflow: string): string => {
  const gate = (JSON.parse(read("scripts/ci/gates.json")) as { gates: { id: string; previous: string[] }[] }).gates.find((g) => g.id === id);
  expect(gate, id).toBeTruthy();
  expect(gate!.previous.some((prev) => prev.startsWith(`${workflow}#`)), workflow).toBe(true);
  expect(existsSync(resolve(root, ".github/workflows", workflow)), workflow).toBe(false);
  return JSON.stringify(gate);
};
const files = ["ability/duration-conditions.ts", "definition/duration-condition-payload.ts", "definition/condition-policy.ts", "content/core-playtest-v0.1/duration-conditions.ts", "ability/compile.ts"].map(p => `packages/prowess-game/src/${p}`);
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const walk = (p: string): string[] => readdirSync(resolve(root, p)).flatMap(n => statSync(resolve(root, p, n)).isDirectory() ? walk(`${p}/${n}`) : [`${p}/${n}`]);
export function auditWo9Source(source: string): string[] {
  const errors = new Set<string>(), ast = ts.createSourceFile("wo9.ts", source, ts.ScriptTarget.Latest, true);
  const forbidden = /^(latest|newest|getLatest|getCurrent|currentDuration|currentCondition|finalSpell|finalManeuver|finalMp|finalAp|executeSustain|executeManaLock|executeEffectChain|applyStatus|applyDamage|spendMp|reserveMp|evaluateRequirement|evaluateFormula|resolveKeywords|rankCaps|reductionCapsByRank)/i;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^(@prowess\/db|@prisma|node:|next|react)/.test(n.moduleSpecifier.text)) errors.add("pure-boundary");
    if (ts.isIdentifier(n) && forbidden.test(n.text)) errors.add("runtime-or-bypass");
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && /^(eval|Function|fetch|Math\.(random|floor|ceil|round)|Date|Date\.now)$/.test(n.expression.getText(ast))) errors.add("executable-or-nondeterministic");
    n.forEachChild(visit);
  }; visit(ast); return [...errors].sort();
}
describe("M5-WO9 audit — Duration & Ability Condition Framework", () => {
  it.each(files)("%s respects domain and runtime boundaries", f => expect(auditWo9Source(read(f))).toEqual([]));
  it("retains WO1 boundary coverage for its new executable component helper", () => {
    // Typed component metadata is intentionally interpreted after WO1; every other WO1 boundary remains enforced.
    expect(auditM5Source(read(files[0]!), files[0]!, "game").filter(f => !["kind-inference", "shape-implies-mechanics"].includes(f))).toEqual([]);
  });
  it("extends the sole authored Ability compiler and permanent M4 operations", () => {
    const compiler = read(files[4]!), narrow = read(files[0]!), grammar = read(files[1]!);
    expect(compiler).toContain("compileDurationConditions({ bundle, composition");
    expect(compiler).toContain("readDurationConditionRun(plan.durationConditions, full)");
    for (const name of ["compileAbilityConstruction(", "compileAbilityTargeting(", "compileEffectUse(", "orchestrateRulesEvaluation("]) expect(compiler).toContain(name);
    expect(narrow).toContain('"FORMULA"'); expect(narrow).toContain("checkMechanic("); expect(grammar).toContain("validateRequirement(v)");
    expect(grammar).toContain("readEffectParameterRules("); expect(grammar).toContain("readEffectCosts(");
    expect(read("packages/prowess-game/src/index.ts")).not.toMatch(/export.*compileDurationConditions/);
  });
  it("enforces canonical flat contributions and keeps capacity in the WO5 rule", () => {
    expect(CONDITION_POLICY.spellMpPercentMaximum).toBe(30); expect(CONDITION_POLICY.maneuverApMaximum).toBe(3);
    expect(CONDITION_POLICY.formulas.cap.expression).toBe("min(listed, maximum)");
    expect(CONDITION_POLICY.formulas.scale.expression).toBe("units * rate"); expect(CONDITION_POLICY.formulas.sum.expression).toBe("left + right");
    const narrow = read(files[0]!), policy = read(files[2]!);
    expect(narrow).toContain("policy.spellMpPercentMaximum"); expect(narrow).toContain("policy.maneuverApMaximum");
    expect(narrow).toContain('c.abilityKind === "MANEUVER" && modifier === "AP_REDUCTION"');
    expect(policy).toContain('own(r, k) !== CONDITION_POLICY[k]');
    expect(narrow).toContain("construction.outputs.capacity.conditions"); expect(narrow).not.toMatch(/rankKey:\s*["'](TRAINED|EXPERT|MASTER)/);
    expect(read("packages/prowess-game/src/construction/legality.ts")).toContain('...composition.conditions.filter(');
  });
  it("requires exact branch-specific references, dependencies and safe reading", () => {
    const compiler = read(files[4]!), narrow = read(files[0]!), grammar = read(files[1]!);
    expect(compiler).toContain("createProwessDefinitionBundle({ ruleset: context.value");
    expect(narrow).toContain("findBundleDefinition(bundle, durationUse.definition)");
    expect(narrow).toContain("!findBundleDefinition(bundle, dep)"); expect(narrow).toContain("isSameExactDefinition(x.definition, dep)");
    expect(grammar).toContain('if (b !== branch) p.add(E, at, "Duration branch must match its permanent Definition kind")'); expect(grammar).toContain("readDefinitionRef(");
    expect(compiler).toContain('Number.isSafeInteger(data.finalValue)');
    expect(grammar).toContain('q.default !== null'); expect(narrow).toContain('x.option === null || x.option === option');
    expect(narrow).toContain('"REQUIREMENT_CONTRACT_ONLY"'); expect(narrow).toContain('"LISTED_COMPONENT_CONTRIBUTIONS_ONLY"');
  });
  it("keeps distinct existing families and fail-closed source conflicts", () => {
    const families = read("packages/prowess-game/src/vocabulary/families.ts");
    for (const kind of ["SPELL_DURATION", "MANEUVER_DURATION", "SPELL_CASTING_CONDITION", "MANEUVER_CONDITION"]) expect(families).toContain(kind);
    expect(read("packages/prowess-game/src/definition/payload.ts")).toContain("forbiddenKeyPaths(r, ABILITY_CONDITION_FORBIDDEN_KEYS");
    const rows = DURATION_CONDITION_CONTENT.definitions;
    for (const key of ["spell.duration.permanent_by_special_rule", "maneuver.condition.cannot_move_this_turn", "maneuver.condition.once_per_mission", "spell.casting_condition.focus", "spell.casting_condition.material"]) {
      const row = rows.find(d => d.canonicalKey === key)!; expect(row).toBeTruthy(); expect(JSON.stringify(row.payload)).toContain('"DEFERRED"'); expect(row.payload.costContributions).toEqual([]);
    }
    const conflict = read("docs/architecture/m5-core-playtest-source-conflicts.md").split("### M5-SC-042")[1]!.split("### M5-SC-043")[0]!;
    expect(conflict).toContain("UNRESOLVED"); expect(read(files[4]!)).toContain('capacity: null, used: additional, conflictKey: "M5-SC-042"');
    for (const key of ["M5-SC-043", "M5-SC-044", "M5-SC-045"]) expect(read("docs/architecture/m5-core-playtest-source-conflicts.md")).toContain(key);
  });
  it("freezes the entire M4 source inventory, Prisma schema/migrations, and all earlier invariants", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo9-baseline.json")) as { frozenFiles: Record<string, string>; priorInvariants: unknown[] };
    const files = [...walk("packages/prowess-rules/src"), ...walk("packages/prowess-db/prisma").filter(notLaterMigration)].sort(); // M6-WO3: registered later migrations excluded
    expect(files).toEqual(Object.keys(baseline.frozenFiles).sort());
    for (const [path, expected] of Object.entries(baseline.frozenFiles)) expect(hash(frozenFileContent(resolve(root, path))), path).toBe(expected);
    const inv = JSON.parse(read("docs/architecture/m5-invariants.json")) as { id: string; guards: string[] }[];
    expect(inv.slice(0, 224)).toEqual(baseline.priorInvariants); expect(inv.length).toBe(337); // M5-WO10 appended M5-I243–I260; M5-WO11 appended M5-I261–I293; M5-WO12 appended M5-I294–I315; M5-WO13 appended M5-I316–I337
    for (let n = 225; n <= 242; n++) { const row = inv.find(x => x.id === `M5-I${n}`)!; expect(row).toBeTruthy(); for (const path of row.guards) expect(existsSync(resolve(root, path))).toBe(true); }
  });
  it("retains every permanent gate and adds dedicated tests, audit, controls, history, API and Inspector coverage", () => {
    const ci = read(".github/workflows/ci.yml"), dedicated = consolidated("M5-WO9", "m5-wo9.yml");
    for (let i = 1; i <= 9; i++) expect(ci).toContain(`M5-WO${i}`);
    for (const path of ["duration-condition.test.ts", "duration-condition-negative.test.ts", "m5-wo9-static.test.ts", "m5-wo9-negative-controls.mjs"]) { expect(ci).toContain(path); expect(dedicated).toContain(path); }
    expect(ci).toContain("prowess-duration-condition-history.test.ts"); expect(ci).toContain("m5-wo9-ability-api.test.ts");
    expect(ci).toContain("m5-wo9-inspector-fixture.test.ts");
  });
  it.each(["export const latestDuration = true;", "function executeSustain() {}", "const finalSpellCost = 1;", "const finalManeuverCost = 1;", "function applyStatus() {}", "const rankCaps = [20,30,40];"])("detects forbidden mutation %s", snippet => expect(auditWo9Source(snippet).length).toBeGreaterThan(0));
});
