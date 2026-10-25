// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SPELL_COST_POLICY } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/spell-cost";
import { CONDITION_POLICY } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions";

/**
 * M5-WO10 audit — Final Spell Cost & AP Derivation. Permanent static gate over the WO10 module and policy, the conflict
 * register, invariants, docs, CI and the frozen M4 / Prisma inventory. Behavioural mutation controls that edit real files
 * live in scripts/m5-wo10-negative-controls.mjs.
 * Invariants guarded here: M5-I243 · M5-I244 · M5-I245 · M5-I246 · M5-I247 · M5-I248 · M5-I249 · M5-I250 · M5-I251 ·
 * M5-I252 · M5-I253 · M5-I254 · M5-I255 · M5-I256 · M5-I257 · M5-I258 · M5-I259 · M5-I260.
 */
const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const walk = (p: string): string[] => readdirSync(resolve(root, p)).flatMap((n) => (statSync(resolve(root, p, n)).isDirectory() ? walk(`${p}/${n}`) : [`${p}/${n}`]));
const MODULE = "packages/prowess-game/src/ability/spell-cost.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/spell-cost.ts";
const REGISTER = "docs/architecture/m5-core-playtest-source-conflicts.md";
const section = (key: string) => read(REGISTER).split(`### ${key}`)[1]?.split("\n### ")[0] ?? "";

/** AST rules: no runtime, no resource spending, no latest lookup, no hidden math, no reimplemented WO4 / WO9 logic. */
export function auditWo10Source(source: string): string[] {
  const findings = new Set<string>();
  const ast = ts.createSourceFile("wo10.ts", source, ts.ScriptTarget.Latest, true);
  const RUNTIME = /^(spend\w*|pay\w*|deduct\w*|reserve\w*|chargeResource\w*|executeSustain|sustainPayment|executeChannel\w*|channel\w*|concentration\w*|manaLock\w*|activeEffects?|executeEffectChain|effectChain\w*)$/i;
  const LATEST = /^(latest\w*|newest\w*|getLatest\w*|getCurrent\w*|current(Definition|Version|Targeting|Effect|Trait|Duration|Condition)\w*|findNewest\w*|mostRecent\w*)$/i;
  const MANEUVER = /^(finalManeuver\w*|maneuverCost\w*|maneuverAp\w*|baseActions?)$/i;
  const DISCOUNT = /^(signatureDiscount\w*|isSignature\w*|manaEfficiency\w*|meDiscount\w*|specialModifier|freeformPercent\w*|percentModifiers?)$/i;
  const REIMPLEMENT = /^(matchStrength\w*|matchWeakness\w*|selectWeakness\w*|highestWeakness\w*|strengthDiscountByRank|rankCaps|reductionCapsByRank|conditionCap\w*|apCap|maxSpellAp)$/i;
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^(@prowess\/db|@prisma|node:|next|react|pg$)/.test(n.moduleSpecifier.text)) findings.add("pure-boundary");
    if (ts.isIdentifier(n)) {
      if (RUNTIME.test(n.text)) findings.add("runtime-or-resource");
      if (LATEST.test(n.text)) findings.add("latest-or-current");
      if (MANEUVER.test(n.text)) findings.add("maneuver-cost");
      if (DISCOUNT.test(n.text)) findings.add("unauthorized-modifier");
      if (REIMPLEMENT.test(n.text)) findings.add("reimplemented-rule");
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression.getText(ast);
      if (/^(eval|Function|fetch|Date|Date\.now|Math\.\w+|crypto\.\w+)$/.test(callee)) findings.add("executable-or-hidden-math");
    }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.PercentToken].includes(n.operatorToken.kind)) findings.add("executable-or-hidden-math");
    if (ts.isStringLiteral(n) && /"?(matchAny|KEYWORD_PRESENT|activationPenaltyPercent|strengthDiscountPercent)"?/.test(n.text) && n.text.length < 40) findings.add("reimplemented-rule");
    n.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

describe("M5-WO10 audit — Final Spell Cost & AP Derivation", () => {
  it.each([MODULE, POLICY])("%s respects the WO10 domain, runtime and scope boundaries", (f) => expect(auditWo10Source(read(f))).toEqual([]));

  it("M5-I243 / M5-I246 composes the canonical authored compiler and WO4 — no second Spell compiler, no second Affinity matcher", () => {
    const m = read(MODULE);
    expect(m).toContain("compileAbilityDefinition(request)");
    expect(m).toContain("readAbilityDefinitionRun(plan.ability, sub)");
    expect(m).toContain("compileAffinity({ contractVersion: 1, subject: { kind: \"SPELL_AFFINITY_COST\"");
    expect(m).toContain("const excluded = new Set([a.outputs.cost.stepKey, a.outputs.cost.netStepKey]);");
    expect(m).not.toMatch(/affinityAdjustedCost|readAffinityRun|validateAffinityProfile|keywordReference/);
    expect(read("packages/prowess-game/src/index.ts")).toContain('from "./ability/spell-cost.js"');
  });

  it("M5-I247 consumes the WO9 EFFECTIVE Condition reduction only; WO9's flat 30% policy is untouched; no Condition validator is duplicated", () => {
    const m = read(MODULE);
    expect(m).toContain("dc.summary.spellMpPercent.effectiveStep");
    expect(m).not.toMatch(/listedStep\)\s*;?\s*\/\/.*percent|spellMpPercent\.listedStep|readConditionRules|readConditionContributions|spellMpPercentMaximum/);
    expect(CONDITION_POLICY.spellMpPercentMaximum).toBe(30);
    expect(CONDITION_POLICY.formulas.cap.expression).toBe("min(listed, maximum)");
  });

  it("M5-I245 / M5-I248 / M5-I249 / M5-I259 one net percentage, one application, one normal rounding; no other program rounds", () => {
    expect(SPELL_COST_POLICY.formulas.unrounded.expression).toBe("base * net / 100");
    expect(SPELL_COST_POLICY.formulas.finalMp.expression).toBe("floor(unrounded + 0.5)");
    expect(SPELL_COST_POLICY.formulas.contribution.expression).toBe("max(0, units - included) * rate");
    expect(Object.entries(SPELL_COST_POLICY.formulas).filter(([, f]) => /floor|ceil/.test(f.expression)).map(([k]) => k).sort()).toEqual(["baseAp", "finalMp"]);
    const m = read(MODULE);
    expect(m.match(/"spell-final-mp-rounding"/g)).toHaveLength(1);
    expect(m.match(/stepKey: key\("net_percent"\)/g)).toHaveLength(1);
    expect(m).toContain('rounding: "NONE"');
    expect(m).not.toMatch(/"MULTIPLY"|"INCREASE_PERCENT"|"REDUCE_PERCENT"|rounding: "FLOOR"|rounding: "CEIL"/);
  });

  it("M5-I250–I252 AP is derived only from final MP and exact PRO, modified afterwards, floored at 1, never capped at 3", () => {
    expect(SPELL_COST_POLICY.formulas.baseAp.expression).toBe("max(1, floor(final_mp / pro))");
    expect(SPELL_COST_POLICY.minimumAp).toBe(1);
    expect(JSON.stringify(SPELL_COST_POLICY)).not.toMatch(/maximumAp|min\(3|apMaximum|3 AP cap/);
    const m = read(MODULE);
    expect(m).toContain('formula("base_ap", "baseAp", { final_mp: 0, pro }, [bind("/variables/final_mp", finalMp)]');
    expect(m).toContain('modifier("spell.minimum_ap", AP_TARGET, "MAX", "spell.ap_minimum", 2, 0, spellRef), operand: POLICY.minimumAp');
    expect(m).toContain("K.INVALID_PRO");
    expect(m).not.toMatch(/pro \?\?|PRO \?\?|\?\? 4/);
  });

  it("M5-I253–I256 no ME, no resource spending, no runtime, no Maneuver cost, no Effect Chain, no unauthorized modifiers", () => {
    const m = read(MODULE);
    expect(m).toContain("K.SPELL_ONLY");
    expect(m).not.toMatch(/manaEfficiency|"RESOURCE"|operation: "RESOURCE/);
    expect(m).toContain("M5-SC-046");
  });

  it("M5-I257–I258 exact Ruleset provenance, duplicate refusal and safe reading", () => {
    const m = read(MODULE);
    expect(m).toContain("seen.has(identity)");
    expect(m).toContain("K.DUPLICATE_CONTRIBUTION");
    expect(m).toContain("JSON.stringify(clonePlainData(x.response.ruleset ?? null)) === JSON.stringify(clonePlainData(plan.rulesetProvenance))");
    expect(m).toContain("checkPlainData(request, [], p, K.INVALID_REQUEST)");
    expect(m).toContain("deepFreeze(clonePlainData(");
  });

  it("register: SC-028 / SC-021 applied; SC-046 / SC-047 recorded UNRESOLVED; M5-I260 SC-042 still UNRESOLVED and still refused", () => {
    expect(section("M5-SC-028")).toContain("M5-WO10 application");
    for (const key of ["M5-SC-042", "M5-SC-046", "M5-SC-047"]) expect(section(key), key).toContain("`UNRESOLVED`");
    expect(read("packages/prowess-game/src/ability/compile.ts")).toContain('T.CAPACITY_UNRESOLVED, ["additionalAffinityTraits"]');
  });

  it("M4 sources, Prisma schema / migrations and API routes are unchanged; no WO10-only endpoint or UI", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo10-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string>; apiRoutes: string[] };
    expect(baseline.baseCommit).toBe("d5c0f6c61a5e26b59248cccebde7ad2fa4e0b839");
    const files = [...walk("packages/prowess-rules/src"), ...walk("packages/prowess-db/prisma")].sort();
    expect(files).toEqual(Object.keys(baseline.frozenFiles).sort());
    for (const [path, expected] of Object.entries(baseline.frozenFiles)) expect(hash(readFileSync(resolve(root, path))), path).toBe(expected);
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(baseline.apiRoutes);
    for (const f of [...walk("apps/studio/app"), ...walk("apps/studio/src")].filter((x) => /\.(ts|tsx)$/.test(x))) expect(read(f), f).not.toMatch(/@prowess\/game|\/api\/(spell-cost|spells\/cost)/);
  });

  it("invariants M5-I243–I260 exist once, keep history, and are guarded by executing tests that cite them", () => {
    const inv = JSON.parse(read("docs/architecture/m5-invariants.json")) as { id: string; title: string; guards: string[]; status?: string }[];
    expect(inv.slice(0, 260).map((x) => x.id)).toEqual(Array.from({ length: 260 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`)); // M5-WO11 appends M5-I261+ (its own gate checks the full sequence)
    const self = read("apps/studio/tests/unit/m5-wo10-static.test.ts"), md = read("docs/architecture/m5-invariants.md");
    for (const row of inv.slice(242, 260)) {
      expect(row.status ?? "ACTIVE").toBe("ACTIVE");
      expect(row.guards).toEqual(expect.arrayContaining(["apps/studio/tests/unit/m5-wo10-static.test.ts", "scripts/m5-wo10-negative-controls.mjs"]));
      for (const g of row.guards) {
        expect(existsSync(resolve(root, g)), g).toBe(true);
        if (g.endsWith(".test.ts")) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(self).toContain(row.id);
    }
    expect(inv[242]?.title).toBe("Final Spell Cost Is Derived Only From Exact Structured Spell Components And Explicit Cost Modifiers");
    expect(inv[259]?.title).toBe("M5-SC-042 Remains Unresolved And Final Spell Cost Does Not Infer Additional Affinity Trait Capacity");
  });

  it("documentation and the implementation report exist", () => {
    const doc = read("docs/architecture/m5-final-spell-cost.md");
    for (const h of ["Final Spell MP Pipeline", "Component Aggregation", "Percentage Netting (M5-SC-028)", "M5-SC-021 Interaction", "Affinity Reuse (WO4)", "Final MP Rounding", "AP Derivation", "AP Modifier Ordering", "ME Boundary", "Mana Lock Boundary", "Channeling Boundary", "Sustain Boundary", "Historical Reproducibility", "Inspector / Source Map", "Unresolved Legacy Modifiers", "Handoff To WO11–WO13"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h.replace(/[()/]/g, "\\$&")}$`, "m"));
    expect(read("docs/reports/m5-wo10-implementation-report.md")).toContain("M5-WO10");
  });

  it("CI keeps every permanent gate and adds the WO10 gate after WO9 plus a dedicated workflow", () => {
    const ci = read(".github/workflows/ci.yml"), dedicated = read(".github/workflows/m5-wo10.yml");
    for (let i = 1; i <= 9; i++) expect(ci).toContain(`M5-WO${String(i)}`);
    expect(ci.indexOf("M5-WO10 audit — Final Spell Cost & AP Derivation")).toBeGreaterThan(ci.indexOf("M5-WO9 audit — Duration & Ability Condition Framework"));
    for (const path of ["spell-cost-golden.test.ts", "spell-cost-contracts.test.ts", "m5-wo10-static.test.ts", "m5-wo10-inspector-fixture.test.ts", "prowess-spell-cost-history.test.ts", "m5-wo10-spell-cost-api.test.ts", "m5-wo10-negative-controls.mjs"]) {
      expect(ci, path).toContain(path);
      expect(dedicated, path).toContain(path);
    }
  });

  it.each([
    "export const latestTrait = 1;",
    "function spendMp() {}",
    "const finalManeuverCost = 1;",
    "const signatureDiscount = 20;",
    "const v = Math.round(13.5);",
    "const net = base * 0.8 * 1.1;",
    "function executeSustain() {}",
    "const rankCaps = [20, 30, 40];",
    "function selectWeakness() {}",
    "const x = cost - me;",
  ])("detects forbidden mutation %s", (snippet) => expect(auditWo10Source(snippet).length).toBeGreaterThan(0));
});
