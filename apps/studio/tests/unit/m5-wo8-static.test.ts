// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditM5Source } from "./m5-wo1-audit-helpers";
const root = resolve(import.meta.dirname, "../../../.."), text = (p: string) => readFileSync(resolve(root, p), "utf8");
const files = ["ability/compile.ts", "definition/trait-payload.ts", "definition/authored-ability-payload.ts"].map(f => `packages/prowess-game/src/${f}`);
export function auditWo8Source(source: string): string[] {
  const errors = new Set<string>();
  if (/@prisma|PrismaClient|@prowess\/db|DATABASE_URL|fetch\(|Date\.now|Math\.random/.test(source)) errors.add("pure-boundary");
  if (/\beval\(|new Function|executeEffectChain|applyDamage|restoreHp|mutateHp|spendMp|latestTrait|newestDefinition|finalSpellCost|finalManeuverCost/.test(source)) errors.add("runtime-or-bypass");
  if (/function\s+(evaluateRequirement|resolveKeywords|evaluateFormula|calculateModifiers)\b/.test(source)) errors.add("duplicate-engine");
  return [...errors];
}
describe("M5-WO8 audit — Traits and authored Spell/Maneuver definitions", () => {
  const compiler = text(files[0]!), grammar = text(files[1]!), authored = text(files[2]!), family = text("packages/prowess-game/src/vocabulary/families.ts");
  it("extends permanent M5 contracts and emits permanent M4 operations", () => {
    for (const file of files) {
      const source = text(file); expect(auditWo8Source(source), file).toEqual([]);
      // WO8 intentionally branches on typed Definition kinds and named parameter measures; those are not inference.
      expect(auditM5Source(source, file, "game").filter(x => !["kind-inference", "shape-implies-mechanics"].includes(x)), file).toEqual([]);
    }
    for (const name of ["compileAbilityConstruction", "compileAbilityTargeting", "compileEffectUse", "orchestrateRulesEvaluation", "readAbilityConstructionRun", "readAbilityTargetingRun", "readEffectRun"]) expect(compiler).toContain(`${name}(`);
    for (const operation of ["FORMULA", "REQUIREMENT", "KEYWORD", "MODIFIER", "EXPLANATION"]) expect(compiler).toContain(`"${operation}"`);
    expect(compiler).toContain("const construction = compileAbilityConstruction(");
    expect(grammar).toContain("readEffectParameterRules("); expect(grammar).toContain("readEffectCosts(");
  });
  it("requires exact pinned content, Ruleset provenance and explicit authority", () => {
    expect(compiler).toContain("createProwessDefinitionBundle({ ruleset: context.value");
    expect(compiler).toContain("findBundleDefinition(bundle, ref)"); expect(compiler).toContain("clonePlainData(rawBundle.rulesetProvenance");
    expect(compiler).toContain("isSameExactDefinition"); expect(compiler).not.toContain("if (false)");
    expect(authored).toContain('"ARCANE_AUTHORITY", "AFFINITY_AUTHORITY"');
    expect(compiler).toContain(".strengths.flatMap"); expect(compiler).not.toContain(".weaknesses.flatMap");
  });
  it("keeps distinct authored types, inherited attacks, closed Traits and separate capacities", () => {
    expect(family).toContain('SPELL_DEFINITION: active("SPELL")'); expect(family).toContain('MANEUVER_DEFINITION: active("MANEUVER")');
    expect(family).toContain('SHARED_TRAIT: { family: "ABILITY", branch: null, contract: "TRAIT"');
    expect(authored).toContain('Omit<ManeuverComposition, "targeting" | "branch">');
    expect(authored).toContain('readonly kind: "WEAPON"'); expect(authored).toContain('readonly kind: "WEAPON_RANGE"');
    expect(grammar.match(/TRAIT_MODIFICATIONS = deepFreeze\(\[([^\]]+)\]/)?.[1]?.match(/"[A-Z_]+"/g)).toEqual(['"DAMAGE_TYPE"', '"TARGETING_MEASURE"', '"RESOLUTION"', '"TRIGGER"', '"COST"']);
    expect(compiler).toContain("affinityAdditional"); expect(compiler).toContain("M5-SC-042"); expect(compiler).toContain("actionConstruction.push(");
    expect(compiler).toContain("new Set(full.steps.map"); expect(compiler).toContain("x.order === s.order");
    expect(text("docs/architecture/m5-core-playtest-source-conflicts.md")).toContain("M5-SC-041");
  });
  it("preserves schema, M4 engine and previous permanent gates", () => {
    const ci = text(".github/workflows/ci.yml"), dedicated = text(".github/workflows/m5-wo8.yml");
    for (let n = 1; n <= 8; n++) expect(ci).toContain(`M5-WO${n}`);
    for (const file of ["ability-definitions.test.ts", "ability-negative.test.ts", "ability-security.test.ts", "trait-contracts.test.ts", "m5-wo8-static.test.ts", "m5-wo8-negative-controls.mjs"]) expect(dedicated).toContain(file);
    expect(ci).toContain("prowess-authored-ability-history.test.ts"); expect(ci).toContain("m5-wo8-ability-api.test.ts");
    const invariants = JSON.parse(text("docs/architecture/m5-invariants.json")) as { id: string; guards: string[] }[];
    for (let i = 1; i <= 224; i++) expect(invariants.some(x => x.id === `M5-I${String(i).padStart(3, "0")}`)).toBe(true);
  });
  it.each(["import { prisma } from '@prowess/db';", "export const x = new Function('return 1');", "function evaluateRequirement() {}", "export const latestTrait = true;"])("detects forbidden source mutation %s", snippet => {
    expect(auditWo8Source(`${compiler}\n${snippet}`).length).toBeGreaterThan(0);
  });
});
