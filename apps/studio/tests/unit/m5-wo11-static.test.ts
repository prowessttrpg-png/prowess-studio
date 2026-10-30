// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";
import { withLaterMilestoneRoutes } from "./later-milestone-routes";
import { MANEUVER_COST_POLICY } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/maneuver-cost";
import { CONDITION_POLICY } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions";

/**
 * M5-WO11 audit — Final Maneuver Cost & Attack Floors. Permanent static gate over the WO11 module, policy content and
 * policy reader, the conflict register, invariants, docs, CI and the frozen M4 / Prisma inventory. Behavioural mutation
 * controls that edit real files live in scripts/m5-wo11-negative-controls.mjs.
 * Invariants guarded here: M5-I261 · M5-I262 · M5-I263 · M5-I264 · M5-I265 · M5-I266 · M5-I267 · M5-I268 · M5-I269 ·
 * M5-I270 · M5-I271 · M5-I272 · M5-I273 · M5-I274 · M5-I275 · M5-I276 · M5-I277 · M5-I278 · M5-I279 · M5-I280 · M5-I281 ·
 * M5-I282 · M5-I283 · M5-I284 · M5-I285 · M5-I286 · M5-I287 · M5-I288 · M5-I289 · M5-I290 · M5-I291 · M5-I292 · M5-I293.
 */
const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * M5-CLOSEOUT-03 C5: the dedicated `m5-wo11.yml` workflow was retired after its checks moved into the consolidated
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
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const walk = (p: string): string[] => readdirSync(resolve(root, p)).flatMap((n) => (statSync(resolve(root, p, n)).isDirectory() ? walk(`${p}/${n}`) : [`${p}/${n}`]));
const MODULE = "packages/prowess-game/src/ability/maneuver-cost.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/maneuver-cost.ts";
const READER = "packages/prowess-game/src/definition/maneuver-cost-policy.ts";
const COMPILE = "packages/prowess-game/src/ability/compile.ts";
const REGISTER = "docs/architecture/m5-core-playtest-source-conflicts.md";
const section = (key: string) => read(REGISTER).split(`### ${key}`)[1]?.split("\n### ")[0] ?? "";

/** AST rules: no runtime / resource / encounter execution, no latest lookup, no Spell semantics, no 3 AP cap, no broadcast. */
export function auditWo11Source(source: string): string[] {
  const findings = new Set<string>();
  const ast = ts.createSourceFile("wo11.ts", source, ts.ScriptTarget.Latest, true);
  const RUNTIME = /^(spend\w*|pay(Ap|Mp|Cost|ment)\w*|deduct\w*|reserve\w*|chargeResource\w*|executeSustain|sustain\w*|executeChannel\w*|channel\w*|concentration\w*|manaLock\w*|activeEffects?|executeEffect\w*|effectChain\w*|roll\w*|attackRoll\w*|applyDamage\w*|dealDamage\w*|damageRoll\w*|moveFeet\w*|executeMovement\w*|push\w*Target|encounterState\w*)$/i;
  const LATEST = /^(latest\w*|newest\w*|getLatest\w*|getCurrent\w*|current(Definition|Version|Foundation|Effect|Trait|Duration|Condition|SignatureRule|ManeuverEffect)\w*|findNewest\w*|mostRecent\w*)$/i;
  const SPELL = /^(pro|proScore|netPercent\w*|unrounded\w*|spellCost\w*|compileSpellCost|SPELL_COST_POLICY|compileAffinity|strengthPercent\w*|weaknessPercent\w*|affinityPercent\w*|mpPerAp|apPerMp|exchangeRate\w*)$/;
  const CAP = /^(maxAp|apCap|maximumAp|maxManeuverAp|threeApCap|turnApLimit)$/i;
  const BROADCAST = /^(applyToEveryAttack|broadcast\w*|forEachAttackApply\w*)$/i;
  const NAME = /^(isSignatureByName|signatureFromName|foundationCostByName|costByName|nameCost\w*)$/i;
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const from = n.moduleSpecifier.text;
      if (/^(@prowess\/db|@prisma|node:|next|react|pg$)/.test(from)) findings.add("pure-boundary");
      if (/spell-cost|affinity\/compile|duration-condition-payload/.test(from)) findings.add("spell-or-duplicate-validator");
    }
    if (ts.isIdentifier(n)) {
      if (RUNTIME.test(n.text)) findings.add("runtime-or-resource");
      if (LATEST.test(n.text)) findings.add("latest-or-current");
      if (SPELL.test(n.text)) findings.add("spell-semantics");
      if (CAP.test(n.text)) findings.add("three-ap-cap");
      if (BROADCAST.test(n.text)) findings.add("attachment-broadcast");
      if (NAME.test(n.text)) findings.add("name-switch");
    }
    if (ts.isStringLiteral(n) && n.text === "MIN") findings.add("three-ap-cap");
    if (ts.isStringLiteral(n) && /^(RESOURCE|MP_PERCENT|PERCENT)$/.test(n.text)) findings.add("spell-semantics");
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression.getText(ast);
      if (/^(eval|Function|fetch|Date|Date\.now|Math\.\w+|crypto\.\w+)$/.test(callee)) findings.add("executable-or-hidden-math");
    }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.PercentToken].includes(n.operatorToken.kind)) findings.add("executable-or-hidden-math");
    n.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

describe("M5-WO11 audit — Final Maneuver Cost & Attack Floors", () => {
  it.each([MODULE, POLICY, READER])("%s respects the WO11 domain, runtime and scope boundaries", (f) => expect(auditWo11Source(read(f))).toEqual([]));

  it("M5-I261 composes the canonical authored compiler — no second Ability compiler, no Spell final-cost reuse, no MP ÷ PRO", () => {
    const m = read(MODULE);
    expect(m).toContain("compileAbilityDefinition(abilityRequest)");
    expect(m).toContain("readAbilityDefinitionRun(plan.ability");
    expect(m).toContain("K.MANEUVER_ONLY");
    expect(m).not.toMatch(/compileEffectUse|compileAbilityTargeting|compileAbilityConstruction|compileDurationConditions|orchestrateRulesEvaluation\(\{ evaluationKey: `authored/);
    expect(m).not.toMatch(/final_mp \/ pro|SPELL_COST|net_percent|unrounded/);
  });

  it("M5-I262–I266 Base AP / Base MP are independent M4 sums; cost options need an explicit authored choice; AND applies both", () => {
    const m = read(MODULE);
    expect(m).toContain('const baseAp = sum("base_ap", BASE_AP, "AP", "maneuver-base-ap");');
    expect(m).toContain('const baseMp = sum("base_mp", BASE_MP, "MP", "maneuver-base-mp");');
    expect(m).toContain("if (!selectedParam?.explicit) p.add(K.MISSING_COST_CHOICE");
    expect(m).toContain("for (const c of e.plan.outputs.costContributions) listed(\"EFFECT\", componentKey, def, c);");
  });

  it("M5-I267–I269 consumes WO9's EFFECTIVE Condition AP reduction (cap 3) and only selected MP options; final MP floors at 0", () => {
    const m = read(MODULE);
    expect(CONDITION_POLICY.maneuverApMaximum).toBe(3);
    expect(m).toContain("dc?.summary.maneuverAp.effectiveStep");
    expect(m).not.toMatch(/maneuverAp\.listedStep/);
    expect(m).toContain('if (v.modifier === "AP_REDUCTION") continue;');
    expect(MANEUVER_COST_POLICY.minimumMp).toBe(0);
    expect(m).toContain('modifier("maneuver.minimum_mp", FINAL_MP, "MAX", "maneuver.minimum_mp", 2, 0, policyRef, policy.minimumMp)');
    expect(m).not.toMatch(/readConditionRules|readConditionContributions|maneuverApMaximum/);
  });

  it("M5-I270–I276 attack floor, Powerful Blow as one resolution, explicit Signature ordering, final 1 AP minimum, no 3 AP cap", () => {
    const m = read(MODULE);
    expect(MANEUVER_COST_POLICY.formulas.attackFloor.expression).toBe("max(minimum, attacks)");
    expect(MANEUVER_COST_POLICY.formulas.conditionReduced.expression).toBe("base - reduction");
    expect([MANEUVER_COST_POLICY.signatureApReduction, MANEUVER_COST_POLICY.minimumAp]).toEqual([1, 1]);
    expect(m).toContain('separateAttackResolutions: resolutionGroups.filter((g) => g.kind !== "ACTION").length');
    expect(m).toContain('kind: groupKey === pbKey ? "POWERFUL_BLOW" : attack ? "ATTACK" : "ACTION"');
    expect(m).toContain('modifier("maneuver.condition_attack_floor", POST_AP, "MAX", "maneuver.condition_floor", 1, 0, policyRef)');
    expect(m).toContain('modifier("maneuver.signature", FINAL_AP, "SUBTRACT", "maneuver.signature", 1, 0, policyRef, policy.signatureApReduction)');
    expect(m).toContain('modifier("maneuver.minimum_ap", FINAL_AP, "MAX", "maneuver.minimum_ap", 2, 0, policyRef, policy.minimumAp)');
    expect(m.indexOf('key("post_condition_ap")')).toBeLessThan(m.indexOf('key("final_ap")'));
    expect(m).not.toMatch(/"MIN"/);
    expect(m).not.toMatch(/"maneuver\.signature", (FINAL_MP|POST_AP|CONDITION_MP|BASE_AP)/); // Signature modifies FINAL AP only — never MP, never a Condition
  });

  it("M5-I277–I278 no AP / MP spending, no RESOURCE step, no Effect / damage / movement / Sustain execution", () => {
    const m = read(MODULE);
    expect(m).not.toMatch(/"RESOURCE"|operation: "RESOURCE|EffectChain|executeEffect/);
    expect(m).toContain('primaryStepKey: finalAp');
  });

  it("M5-I279–I280 exact Ruleset provenance, duplicate refusal, per-instance Effect counting and safe reading", () => {
    const m = read(MODULE);
    expect(m).toContain("seen.has(identity)");
    expect(m).toContain("if (counted.has(componentKey)) continue;");
    expect(m).toContain("JSON.stringify(clonePlainData(x.response.ruleset ?? null)) === JSON.stringify(clonePlainData(plan.rulesetProvenance))");
    expect(m).toContain("checkPlainData(request, [], p, K.INVALID_REQUEST)");
    expect(m).toContain("deepFreeze(clonePlainData(");
  });

  it("M5-I282–I293 attachment graph: exact Attacks, inherited weapon requirements, no broadcast, Powerful Blow of one Attack only", () => {
    const c = read(COMPILE), m = read(MODULE);
    expect(c).toContain("Powerful Blow combines compatible uses of the same exact Attack only");
    expect(c).toContain("an attack-scoped Effect attaches to exactly one resolution: one Attack use or one whole Powerful Blow; it is never broadcast");
    expect(c).toContain("readFoundationProfile(payload.rules as Record<string, unknown>");
    expect(c).toContain("const attached = composition.effects.filter(e => man!.effectAttachments.find(a => a.effectKey === e.componentKey)!.actionKeys.includes(action.componentKey));");
    expect(c).toContain("traits: composition.traits.filter(t => t.appliesTo.componentKey === null || t.appliesTo.scope === \"TARGETING\" || attached.some(e => e.componentKey === t.appliesTo.componentKey))");
    expect(m).toContain("const effectGroup = (effectKey: string) => { const a = authored.effectAttachments.find((x) => x.effectKey === effectKey); return a ? groupOf(a.actionKeys[0]!) : null; };");
    expect(m).toContain('grantsConditionDiscount: false, consumesConditionSlot: false, status: "REQUIREMENT_CONTRACT_ONLY"');
    expect(m).toContain("K.REDUNDANT_RESTRICTION");
    expect(MANEUVER_COST_POLICY.inherentRestrictionKeys).toEqual(["WEAPON_LOCK"]);
  });

  it("M5-I281 register: SC-025 / SC-026 applied by WO11; SC-042 / SC-044 / SC-046 / SC-047 / SC-048 UNRESOLVED; SC-048 fails closed", () => {
    expect(section("M5-SC-025")).toContain("M5-WO11 application");
    expect(section("M5-SC-026")).toContain("M5-WO11 application");
    for (const key of ["M5-SC-042", "M5-SC-044", "M5-SC-046", "M5-SC-047", "M5-SC-048"]) expect(section(key), key).toContain("`UNRESOLVED`");
    expect(MANEUVER_COST_POLICY.unresolvedComponentCosts).toEqual([{ canonicalKey: "maneuver.effect.elemental_damage_conversion", conflictKey: "M5-SC-048" }]);
    expect(read(COMPILE)).toContain('T.CAPACITY_UNRESOLVED, ["additionalAffinityTraits"]');
  });

  it("M4 sources, Prisma schema / migrations and API routes are unchanged; no WO11-only endpoint or UI", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo11-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string>; apiRoutes: string[] };
    expect(baseline.baseCommit).toBe("efb4fe7157a6b01a39457cf7cce6b761699f8cb4");
    const files = [...walk("packages/prowess-rules/src"), ...walk("packages/prowess-db/prisma").filter(notLaterMigration)].sort(); // M6-WO3: registered later migrations excluded
    expect(files).toEqual(Object.keys(baseline.frozenFiles).sort());
    for (const [path, expected] of Object.entries(baseline.frozenFiles)) expect(hash(frozenFileContent(resolve(root, path))), path).toBe(expected);
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(withLaterMilestoneRoutes(baseline.apiRoutes));
    for (const f of [...walk("apps/studio/app"), ...walk("apps/studio/src")].filter((x) => /\.(ts|tsx)$/.test(x))) expect(read(f), f).not.toMatch(/@prowess\/game|\/api\/(maneuver-cost|maneuvers\/cost)/);
  });

  it("invariants M5-I261–I293 exist once after WO10's, keep history, and are guarded by executing tests that cite them", () => {
    const inv = JSON.parse(read("docs/architecture/m5-invariants.json")) as { id: string; title: string; group: string; guards: string[]; status?: string }[];
    expect(inv.slice(0, 293).map((x) => x.id)).toEqual(Array.from({ length: 293 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`)); // M5-WO12 appends M5-I294+ (its own gate checks the full sequence)
    const self = read("apps/studio/tests/unit/m5-wo11-static.test.ts"), md = read("docs/architecture/m5-invariants.md");
    for (const row of inv.slice(260, 293)) {
      expect([row.status ?? "ACTIVE", row.group]).toEqual(["ACTIVE", "Final Maneuver Cost"]);
      expect(row.guards).toEqual(expect.arrayContaining(["apps/studio/tests/unit/m5-wo11-static.test.ts", "scripts/m5-wo11-negative-controls.mjs"]));
      for (const g of row.guards) {
        expect(existsSync(resolve(root, g)), g).toBe(true);
        if (g.endsWith(".test.ts")) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(self).toContain(row.id);
    }
    expect(inv[260]?.title).toBe("Final Maneuver Cost Is Derived Only From Exact Authored Actions, Effects, Conditions And Authorized Structured Cost Rules");
    expect(inv[292]?.title).toBe("Maneuver Effect Cost Is Based On Authored Effect Instances And Is Never Automatically Multiplied Across Unrelated Attacks");
  });

  it("documentation and the implementation report exist", () => {
    const doc = read("docs/architecture/m5-final-maneuver-cost.md");
    for (const h of ["Final Maneuver Cost Pipeline", "Base AP", "Base MP", "Action / Foundation Aggregation", "Attack Binding And Attachment Scope", "Effect Cost Choices", "MP-Bearing Effects", "Effect-Specific Affinity Cost Rules", "Condition AP / MP Application", "Three-AP Condition Cap", "Attack-Count Floor", "Powerful Blow", "Signature Maneuver Order", "Final 1 AP Floor", "No 3 AP Maximum", "Commitment / Base AP Distinction", "Provenance And Inspector", "Historical Reproducibility", "Unresolved Conflicts", "Handoff To WO12"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h.replace(/[()/]/g, "\\$&")}$`, "m"));
    expect(read("docs/reports/m5-wo11-implementation-report.md")).toContain("M5-WO11");
  });

  it("CI keeps every permanent gate and adds the WO11 gate after WO10; its former dedicated workflow lives in the consolidated gate", () => {
    const ci = read(".github/workflows/ci.yml"), dedicated = consolidated("M5-WO11", "m5-wo11.yml");
    for (let i = 1; i <= 10; i++) expect(ci).toContain(`M5-WO${String(i)}`);
    expect(ci.indexOf("M5-WO11 audit — Final Maneuver Cost & Attack Floors")).toBeGreaterThan(ci.indexOf("M5-WO10 audit — Final Spell Cost & AP Derivation"));
    for (const path of ["maneuver-cost-golden.test.ts", "maneuver-cost-contracts.test.ts", "m5-wo11-static.test.ts", "m5-wo11-inspector-fixture.test.ts", "prowess-maneuver-cost-history.test.ts", "m5-wo11-maneuver-cost-api.test.ts", "m5-wo11-negative-controls.mjs"]) {
      expect(ci, path).toContain(path);
      expect(dedicated, path).toContain(path);
    }
  });

  it.each([
    "export const latestManeuverEffect = 1;",
    "export const currentFoundation = 1;",
    "function spendAp() {}",
    "function rollAttack() {}",
    "function applyDamage() {}",
    "const v = Math.max(1, 2);",
    "const apCap = 3;",
    "const x = { operation: \"MIN\" };",
    "const ap = finalMp / pro;",
    "import { compileSpellCost } from \"./spell-cost.js\";",
    "import { compileAffinity } from \"../affinity/compile.js\";",
    "function applyToEveryAttack() {}",
    "const reduced = base - 1;",
    "function executeSustain() {}",
    "const isSignatureByName = true;",
    "import { readConditionRules } from \"../definition/duration-condition-payload.js\";",
  ])("detects forbidden mutation %s", (snippet) => expect(auditWo11Source(snippet).length).toBeGreaterThan(0));
});
