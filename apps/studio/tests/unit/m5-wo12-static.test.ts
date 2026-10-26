// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EFFECT_EXECUTION_POLICY } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/effect-execution";

/**
 * M5-WO12 audit — Effect Chain Execution & Runtime Routing. Permanent static gate over the WO12 execution module, the
 * authored Effect-chain contract, the execution policy content and reader, the conflict register, invariants, docs, CI and
 * the frozen M4 / Prisma inventory. Behavioural mutation controls that edit real files live in
 * scripts/m5-wo12-negative-controls.mjs.
 * Invariants guarded here: M5-I294 · M5-I295 · M5-I296 · M5-I297 · M5-I298 · M5-I299 · M5-I300 · M5-I301 · M5-I302 ·
 * M5-I303 · M5-I304 · M5-I305 · M5-I306 · M5-I307 · M5-I308 · M5-I309 · M5-I310 · M5-I311 · M5-I312 · M5-I313 · M5-I314 ·
 * M5-I315.
 */
const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const walk = (p: string): string[] => readdirSync(resolve(root, p)).flatMap((n) => (statSync(resolve(root, p, n)).isDirectory() ? walk(`${p}/${n}`) : [`${p}/${n}`]));
const MODULE = "packages/prowess-game/src/ability/effect-execution.ts";
const CHAIN = "packages/prowess-game/src/definition/effect-chain-payload.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/effect-execution.ts";
const READER = "packages/prowess-game/src/definition/effect-execution-policy.ts";
const REGISTER = "docs/architecture/m5-core-playtest-source-conflicts.md";
const section = (key: string) => read(REGISTER).split(`### ${key}`)[1]?.split("\n### ")[0] ?? "";

/** AST rules: no RNG, no state mutation / resource payment, no latest lookup, no WO13 lifecycle, no chain-targeting hops, no broadcast. */
export function auditWo12Source(source: string): string[] {
  const findings = new Set<string>();
  const ast = ts.createSourceFile("wo12.ts", source, ts.ScriptTarget.Latest, true);
  const MUTATION = /^(applyDamage\w*|dealDamage\w*|setHp|reduceHp\w*|hp(Current|Remaining)|currentHp|applyCondition\w*|addCondition\w*|conditionInstance\w*|createSummon\w*|spawn\w*|moveTarget\w*|pushTarget\w*|encounterState\w*|combatState\w*|mutate\w*|spend\w*|pay(Ap|Mp|Cost|ment)\w*|deduct\w*|chargeResource\w*|consumeResource\w*|inventory\w*|createZone\w*|terrain\w*)$/i;
  const LATEST = /^(latest\w*|newest\w*|getLatest\w*|getCurrent\w*|current(Definition|Version|Ruleset|Effect|Policy|Chain)\w*|findNewest\w*|mostRecent\w*)$/i;
  const WO13 = /^(sustain\w*|executeSustain|concentration\w*|manaLock\w*|activeEffects?|activeEffectCapacity|expire\w*|maintain\w*|metamagic\w*|rewriteChain\w*)$/i;
  const HOP = /^(chainTarget\w*|hopTarget\w*|nextHop\w*|jumpTarget\w*)$/i;
  const BROADCAST = /^(applyToEveryAttack|broadcast\w*|shareCursor|sharedCursor|globalCritical|maneuverCritical)$/i;
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const from = n.moduleSpecifier.text;
      if (/^(@prowess\/db|@prisma|node:|next|react|pg$)/.test(from)) findings.add("pure-boundary");
      if (/spell-cost|duration-conditions/.test(from)) findings.add("cost-or-lifecycle-reuse"); // the policy content may extend the WO11 construction rule
    }
    if (ts.isIdentifier(n)) {
      if (MUTATION.test(n.text)) findings.add("state-mutation");
      if (LATEST.test(n.text)) findings.add("latest-or-current");
      if (WO13.test(n.text)) findings.add("wo13-lifecycle");
      if (HOP.test(n.text)) findings.add("chain-targeting-hop");
      if (BROADCAST.test(n.text)) findings.add("broadcast");
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression.getText(ast);
      if (/^(eval|Function|fetch|Date|Date\.now|Math\.random|crypto\.\w+|performance\.now)$/.test(callee) || /random/i.test(callee)) findings.add("randomness-or-executable");
    }
    n.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

describe("M5-WO12 audit — Effect Chain Execution & Runtime Routing", () => {
  it.each([MODULE, CHAIN, POLICY, READER])("%s respects the WO12 domain, runtime and scope boundaries", (f) => expect(auditWo12Source(read(f))).toEqual([]));

  it("M5-I294 / M5-I306 two stages over the exact authored Ability; inputs are explicit raw rolls re-resolved by WO2 on M4", () => {
    const m = read(MODULE);
    expect(m).toContain("compileAbilityDefinition");
    expect(m).toContain("readAbilityDefinitionRun(compiled.value, run.data)"); // evaluated once on M4 from the same compiled plan
    expect(m).toContain("compileCoreResolution({ contractVersion: 1, subject, definitions: bundle, ruleset, character: input.roller })");
    expect(m).toContain("orchestrateRulesEvaluation({ evaluationKey, contexts: { ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: compiledCore.value.evaluationPlan })");
    expect(m).toContain('if (own(r, "executionKey") !== plan.executionKey)');
    expect(m).not.toMatch(/Math\.random|crypto\.|\bsuccess: own\(/);
    expect(m).toContain('pending.push({ requestKey, kind, targetKey, scope, by, options, definitions })');
  });

  it("M5-I296–I301 the five behaviors are the only ones; BRANCH takes exactly one destination; defaults follow M5-SC-014", () => {
    const c = read(CHAIN), m = read(MODULE);
    expect(c).toContain('export const EFFECT_CHAIN_BEHAVIORS = deepFreeze(["CONTINUE", "SUCCESS_ONLY", "FAILURE_ONLY", "STOP", "BRANCH"] as const);');
    expect(m).toContain('if (n.behavior === "STOP") termination = "STOP";');
    expect(m).toContain('else if (n.behavior === "SUCCESS_ONLY" && result === "FAILURE") termination = "SUCCESS_ONLY_FAILURE";');
    expect(m).toContain('else if (n.behavior === "FAILURE_ONLY" && result === "SUCCESS") termination = "FAILURE_ONLY_SUCCESS";');
    expect(m).toContain('else if (n.behavior === "BRANCH") { next = result === "SUCCESS" ? n.branch!.success : n.branch!.failure; viaBranch = true; }');
    expect(m).toContain("const successor = ordered.slice(i + 1).find((x) => !destinations.has(x.effectKey))?.effectKey ?? null;");
    expect(EFFECT_EXECUTION_POLICY.defaultChainBehavior).toBe("SUCCESS_ONLY");
  });

  it("M5-I302 branch destinations are later, distinct and singly owned; traversal guards against revisits", () => {
    const c = read(CHAIN), m = read(MODULE);
    expect(c).toContain("a branch destination comes later in authored order: chains are acyclic");
    expect(c).toContain("a branch selects between two different destinations");
    expect(m).toContain('if (visited.has(cursor)) { termination = "INVALID_RUNTIME_PATH"; break; }');
  });

  it("M5-I303 a false trigger is NOT_TRIGGERED and traversal continues; missing target facts are pending inputs", () => {
    const m = read(MODULE);
    expect(m).toContain('if (!satisfied) { trace({ status: "NOT_TRIGGERED", transition: { behavior: n.behavior, next: n.successor } }); cursor = n.successor; continue; }');
    expect(m).toContain('operation: "REQUIREMENT"');
    expect(m).toContain('kind: "TARGET_FACT"');
  });

  it("M5-I304 / M5-I305 WO7 normalization: hit / target-failed-save → SUCCESS; miss / target-succeeded-save → FAILURE", () => {
    const m = read(MODULE);
    expect(m).toContain('result = r.hit ? "SUCCESS" : "FAILURE"');
    expect(m).toContain('result = r.targetSucceeded ? "FAILURE" : "SUCCESS"');
  });

  it("M5-I307 each target has its own cursor, facts, delivery and termination", () => {
    const m = read(MODULE);
    expect(m).toContain("const visited = new Set<string>();");
    expect(m).toContain('facts.set("chain.previous.success", 0); facts.set("chain.previous.failure", 0); facts.set("delivery.hit", 0); facts.set("delivery.critical", 0);');
    expect(m).toContain("targetTraces.push({ targetKey: t.targetKey, status, delivery: deliveryTrace");
  });

  it("M5-I308 Projectile Attack Effects reuse the delivery roll; a miss never reaches a Save or an Automatic Effect", () => {
    const m = read(MODULE);
    expect(m).toContain('const route: ExecutionEffect["route"] = delivery && e.deliveryInteraction === "SAME_ATTACK_ROLL" ? "DELIVERY_ATTACK" : "OWN";');
    expect(m).toContain('if (deliveryHit === false && n.route !== "DELIVERY_ATTACK") { trace({ status: "NOT_DELIVERED" }); termination = "DELIVERY_FAILED"; break; }');
    expect(m).toContain('if (n.route === "DELIVERY_ATTACK") { result = deliveryHit ? "SUCCESS" : "FAILURE"; critical = deliveryTrace.critical; resolvedBy = deliveryTrace.requestKey; }');
  });

  it("M5-I309–I312 Maneuver groups: one resolution per group and target; one Powerful Blow roll; inherited Effects add no roll; critical stays in its group", () => {
    const m = read(MODULE);
    expect(m).toContain("const pbKey = pb ? `powerful_blow.${[...pb.actionKeys].sort().join(\".\")}` : null;");
    expect(m).toContain("// ONE resolution per group and target: its Attack Roll (a Powerful Blow rolls once) or its replacing Save.");
    expect(m).toContain('if (e.policy === "INHERIT_ABILITY") {');
    expect(m).toContain('const c = e.route === "GROUP" ? critical : false;');
    expect(m).toContain("groupOf(x.actionKeys[0]!) === groupKey");
  });

  it("M5-I313 Martial Save control follows the policy: Trained defender, Expert attacker-removes-one, Master attacker", () => {
    expect(EFFECT_EXECUTION_POLICY.martialSaveControl).toEqual({ TRAINED: "DEFENDER_CHOOSES", EXPERT: "ATTACKER_REMOVES_ONE", MASTER: "ATTACKER_CHOOSES" });
    const m = read(MODULE);
    expect(m).toContain('const removed = choose("SAVE_REMOVAL", "ATTACKER", flow.stats);');
    expect(m).toContain('if (remaining.length === 1) stat = remaining[0]!;');
    expect(m).toContain('if (selection === "MARTIAL_CONTROL" && maneuver) {');
  });

  it("M5-I314 outcomes are inert records; no state is mutated, no resource is paid", () => {
    const m = read(MODULE);
    expect(m).toContain("operations: reading ? reading.operations : []");
    expect(m).not.toMatch(/"RESOURCE"|\.hp\b|applyDamage|addCondition|createSummon/);
  });

  it("M5-I315 output is cloned and frozen; the execution key pins Ruleset, manifest, Ability version and subject", () => {
    const m = read(MODULE);
    expect(m).toContain("return finish(p, () => deepFreeze(clonePlainData({");
    expect(m).toMatch(/executionKey = `\$\{[^}]+\}:\$\{[^}]+\}:\$\{[^}]+\}:\$\{[^}]+\}`/);
  });

  it("register: SC-014 applied by WO12; SC-042 / SC-046 / SC-047 / SC-048 stay UNRESOLVED; new SC-049 / SC-050 / SC-051 fail closed", () => {
    expect(section("M5-SC-014")).toContain("M5-WO12 application");
    for (const key of ["M5-SC-042", "M5-SC-046", "M5-SC-047", "M5-SC-048", "M5-SC-049", "M5-SC-050", "M5-SC-051"]) expect(section(key), key).toContain("`UNRESOLVED`");
    const m = read(MODULE);
    for (const key of ["M5-SC-049", "M5-SC-050", "M5-SC-051"]) expect(m, key).toContain(`"${key}"`);
  });

  it("M4 sources, Prisma schema / migrations and API routes are unchanged; no WO12-only endpoint or UI", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo12-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string>; apiRoutes: string[]; priorInvariantCount: number };
    expect(baseline.baseCommit).toBe("799996b4700cdcf32c53ed75977581b63fa5c793");
    expect(baseline.priorInvariantCount).toBe(293);
    const files = [...walk("packages/prowess-rules/src"), ...walk("packages/prowess-db/prisma")].sort();
    expect(files).toEqual(Object.keys(baseline.frozenFiles).sort());
    for (const [path, expected] of Object.entries(baseline.frozenFiles)) expect(hash(readFileSync(resolve(root, path))), path).toBe(expected);
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(baseline.apiRoutes);
    for (const f of [...walk("apps/studio/app"), ...walk("apps/studio/src")].filter((x) => /\.(ts|tsx)$/.test(x))) expect(read(f), f).not.toMatch(/@prowess\/game|\/api\/(effect-execution|effect-chain|abilities\/execute)/);
  });

  it("invariants M5-I001–I315 are sequential; M5-I294–I315 are guarded by executing tests that cite them", () => {
    const inv = JSON.parse(read("docs/architecture/m5-invariants.json")) as { id: string; title: string; group: string; guards: string[]; status?: string }[];
    expect(inv.map((x) => x.id)).toEqual(Array.from({ length: 315 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    const self = read("apps/studio/tests/unit/m5-wo12-static.test.ts"), md = read("docs/architecture/m5-invariants.md");
    for (const row of inv.slice(293, 315)) {
      expect([row.status ?? "ACTIVE", row.group]).toEqual(["ACTIVE", "Effect Chain Execution"]);
      expect(row.guards).toEqual(expect.arrayContaining(["apps/studio/tests/unit/m5-wo12-static.test.ts", "scripts/m5-wo12-negative-controls.mjs"]));
      for (const g of row.guards) {
        expect(existsSync(resolve(root, g)), g).toBe(true);
        if (g.endsWith(".test.ts")) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(self).toContain(row.id);
    }
  });

  it("documentation and the implementation report exist", () => {
    const doc = read("docs/architecture/m5-effect-chain-execution.md");
    for (const h of ["Scope", "Effect Chain vs Effect Outcome", "Effect Chain vs Chain Targeting", "Execution-Plan Architecture", "Runtime Input Requests", "Trigger Evaluation", "NOT_TRIGGERED Interpretation", "Effect Success / Failure Normalization", "The Five Chain Behaviors", "Branches", "Cycle Prevention", "Multi-Target Isolation", "Projectile Delivery", "Outcome Emission", "State-Mutation Boundary", "Maneuver Attack Resolution Groups", "Powerful Blow", "Inherited Maneuver Resolution", "Martial Save Control", "Critical Scoping", "Historical Execution", "Rules Inspector Traces", "Unresolved Conflicts", "WO13 Boundary"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h.replace(/[()/]/g, "\\$&")}$`, "m"));
    expect(read("docs/reports/m5-wo12-implementation-report.md")).toContain("M5-WO12");
  });

  it("CI keeps every permanent gate and adds the WO12 gate after WO11 plus a dedicated workflow", () => {
    const ci = read(".github/workflows/ci.yml"), dedicated = read(".github/workflows/m5-wo12.yml");
    for (let i = 1; i <= 11; i++) expect(ci).toContain(`M5-WO${String(i)}`);
    expect(ci.indexOf("M5-WO12 audit — Effect Chain Execution & Runtime Routing")).toBeGreaterThan(ci.indexOf("M5-WO11 audit — Final Maneuver Cost & Attack Floors"));
    for (const path of ["effect-execution-golden.test.ts", "effect-execution-contracts.test.ts", "m5-wo12-static.test.ts", "m5-wo12-inspector-fixture.test.ts", "prowess-effect-execution-history.test.ts", "m5-wo12-effect-execution-api.test.ts", "m5-wo12-negative-controls.mjs"]) {
      expect(ci, path).toContain(path);
      expect(dedicated, path).toContain(path);
    }
  });

  it.each([
    "const r = Math.random();",
    "function rollD20() { return randomInt(20); }",
    "export const latestRuleset = 1;",
    "const currentPolicy = 1;",
    "function applyDamage() {}",
    "const hpRemaining = 3;",
    "function addCondition() {}",
    "function createSummon() {}",
    "function spendMp() {}",
    "function executeSustain() {}",
    "const concentrationCheck = 1;",
    "const metamagicRewrite = 1;",
    "const chainTargetOrder = [];",
    "const sharedCursor = 0;",
    "const maneuverCritical = true;",
    "function applyToEveryAttack() {}",
    "import { prisma } from \"@prowess/db\";",
    "import { compileSpellCost } from \"./spell-cost.js\";",
    "const at = Date.now();",
  ])("detects forbidden mutation %s", (snippet) => expect(auditWo12Source(snippet).length).toBeGreaterThan(0));
});
