// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";
import { withLaterMilestoneRoutes } from "./later-milestone-routes";
import { ACTIVE_MAGIC_POLICY } from "../../../../packages/prowess-game/src/content/core-playtest-v0.1/active-magic";

/**
 * M5-WO13 audit — Active Magic Runtime. Permanent static gate over the WO13 transition module, the active-magic policy
 * content and reader, the conflict register, invariants, docs, CI and the frozen M4 / Prisma inventory. Behavioural
 * mutation controls that edit real files live in scripts/m5-wo13-negative-controls.mjs.
 * Invariants guarded here: M5-I316 · M5-I317 · M5-I318 · M5-I319 · M5-I320 · M5-I321 · M5-I322 · M5-I323 · M5-I324 ·
 * M5-I325 · M5-I326 · M5-I327 · M5-I328 · M5-I329 · M5-I330 · M5-I331 · M5-I332 · M5-I333 · M5-I334 · M5-I335 · M5-I336 ·
 * M5-I337.
 */
const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * M5-CLOSEOUT-03 C5: the dedicated `m5-wo13.yml` workflow was retired after its checks moved into the consolidated
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
const MODULE = "packages/prowess-game/src/ability/active-magic.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/active-magic.ts";
const READER = "packages/prowess-game/src/definition/active-magic-policy.ts";
const REGISTER = "docs/architecture/m5-core-playtest-source-conflicts.md";
const section = (key: string) => read(REGISTER).split(`### ${key}`)[1]?.split("\n### ")[0] ?? "";

/**
 * AST rules: no RNG / clock, no duplicate Resource / Saving Throw / cost / chain engine, no combat-state application, no
 * latest lookup, no Status-Condition Concentration, no hidden Sustain / DC / slot arithmetic outside M4 Formulas.
 */
export function auditWo13Source(source: string): string[] {
  const findings = new Set<string>();
  const ast = ts.createSourceFile("wo13.ts", source, ts.ScriptTarget.Latest, true);
  const COMBAT = /^(applyDamage\w*|dealDamage\w*|applyHealing\w*|healTarget\w*|setHp|reduceHp\w*|currentHp|hpRemaining|applyCondition\w*|addCondition\w*|conditionInstance\w*|moveToken\w*|pushTarget\w*|spawnSummon\w*|summonAi\w*|terrain\w*|armorValue\w*)$/i;
  const LATEST = /^(latest\w*|newest\w*|getLatest\w*|getCurrent\w*|current(Definition|Version|Ruleset|Spell|Trait|Duration|SustainRule|ConcentrationRule|Policy)\w*|findNewest\w*|mostRecent\w*)$/i;
  const DUPLICATE = /^(spendResource|deductMp|deductMe|deductAp|payWithMe|rollSave|savingThrowTotal|concentrationDie|rollConcentration|computeSpellCost|recalculateSpellCost|finalMpFromComponents|executeEffectChain|routeEffectChain|chainTraversal)$/i;
  const CONDITION = /^(concentrationCondition|ConcentratingCondition|statusConcentration)$/i;
  const CLOCK = /^(wallClock|elapsedMs|expiresAt|timestamp)$/i;
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const from = n.moduleSpecifier.text;
      if (/^(@prowess\/db|@prisma|node:|next|react|pg$)/.test(from)) findings.add("pure-boundary");
      if (/effect\/compile|affinity\/compile|maneuver-cost|duration-conditions/.test(from)) findings.add("duplicate-engine");
    }
    if (ts.isIdentifier(n)) {
      if (COMBAT.test(n.text)) findings.add("combat-state-application");
      if (LATEST.test(n.text)) findings.add("latest-or-current");
      if (DUPLICATE.test(n.text)) findings.add("duplicate-engine");
      if (CONDITION.test(n.text)) findings.add("concentration-as-condition");
      if (CLOCK.test(n.text)) findings.add("wall-clock");
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression.getText(ast);
      if (/^(eval|Function|fetch|Date|Date\.now|performance\.now|setTimeout|setInterval|crypto\.\w+)$/.test(callee) || /random/i.test(callee)) findings.add("randomness-clock-or-executable");
      if (/^Math\.\w+$/.test(callee)) findings.add("hidden-math");
    }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken].includes(n.operatorToken.kind)) findings.add("hidden-math");
    n.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

describe("M5-WO13 audit — Active Magic Runtime", () => {
  it.each([MODULE, POLICY, READER])("%s respects the WO13 domain, runtime and scope boundaries", (f) => expect(auditWo13Source(read(f))).toEqual([]));

  it("M5-I336 reuses WO10 / WO12 / WO3 / WO2 / M4 — no second cost, chain, resource or Saving Throw engine", () => {
    const m = read(MODULE);
    expect(m).toContain('import { evaluateSpellCost } from "./spell-cost.js";');
    expect(m).toContain('import { executeAbilityResolution } from "./effect-execution.js";');
    expect(m).toContain('import { buildRuntimeContexts, compileRuntime } from "../runtime/compile.js";');
    expect(m).toContain('import { buildCoreResolutionContexts, compileCoreResolution } from "../core/compile.js";');
    expect(m.match(/evaluateSpellCost\(/g)).toHaveLength(1);
    expect(m.match(/executeAbilityResolution\(/g)).toHaveLength(1);
    expect(m).toContain('operation: "FORMULA"');
    expect(m).not.toMatch(/compileAbilityDefinition|compileSpellCost|readSpellCostRun|compileEffectUse|chain\.nodes/);
  });

  it("M5-I319 / M5-I320 / M5-I325 / M5-I327 Sustain MP, slots and DC are pinned M4 Formulas; Sustain AP is the policy value", () => {
    expect(ACTIVE_MAGIC_POLICY.formulas).toEqual({
      sustainMp: { expression: "max(1, floor(final_mp / pro))", variables: ["final_mp", "pro"] },
      concentrationSlots: { expression: "1 + floor(res / 2)", variables: ["res"] },
      concentrationDc: { expression: "8 + 2 * max(0, consumers - 1)", variables: ["consumers"] },
    });
    expect([ACTIVE_MAGIC_POLICY.sustainApPerRound, ACTIVE_MAGIC_POLICY.sustainMeEligible, ACTIVE_MAGIC_POLICY.concentrationSaveStat]).toEqual([1, true, "PRO"]);
    const m = read(MODULE);
    expect(m).toContain('formula("sustain_mp", policy.formulas.sustainMp, { final_mp: cost.finalMpCost, pro: cost.ap.pro })');
    expect(m).toContain('formula("concentration_slots", policy.formulas.concentrationSlots, { res })');
    expect(m).toContain('formula("concentration_dc", policy.formulas.concentrationDc, { consumers: n })');
    expect(m).toContain("apCost: policy.sustainApPerRound");
  });

  it("M5-I321 / M5-I335 ME pays before MP through WO3's ME-eligible payment; staged changes are adopted only when wholly legal", () => {
    const m = read(MODULE);
    expect(m).toContain('runtime({ kind: "MAGICAL_PAYMENT", subjectKey: `wo13.${subjectKey}.${ruleKey}`, costKey: ruleKey, listedAmount, meEligible, sourceKey })');
    expect(m).toContain("if (!mana) { resources = start; resourceChanges.length = changes; runtimeEvaluations.length = evals; return null; }");
    expect(m).toContain('if (!reading || !pay || !pay.canPay) return null;');
    expect(m).not.toMatch(/listedAmount: [^,]*- /);
  });

  it("M5-I322 unpaid upkeep ends SUSTAIN_UNPAID; partial affordability needs an explicit controller selection", () => {
    const m = read(MODULE);
    expect(m).toContain('end(x.activeEffectKey, "SUSTAIN_UNPAID", "sustain.unpaid")');
    expect(m).toContain('status = "PENDING_MAINTENANCE_SELECTION";');
    expect(m).toContain('end(x.activeEffectKey, "SUSTAIN_UNPAID", "sustain.not_selected")');
  });

  it("M5-I323 / M5-I324 Mana Lock is WO3 RESERVE / RELEASE capacity of exactly the Effect's own amount; no canonical amount (M5-SC-052)", () => {
    const m = read(MODULE);
    expect(m).toContain('if (!capacity(key, "RESERVE_CAPACITY", amount, cost.definition.canonicalKey)) break;');
    expect(m).toContain('if (x.manaLock && !capacity(key, "RELEASE_CAPACITY", x.manaLock.reservedMp, x.ability.canonicalKey)) return false;');
    expect(m).not.toMatch(/operation: "RESTORE"|"SET_CURRENT"/);
    expect(ACTIVE_MAGIC_POLICY.manaLock).toEqual({ amount: null, conflictKey: "M5-SC-052" });
  });

  it("M5-I326 / M5-I328 Concentration Save is WO2's Prowess Save; failure ends the disrupted consumer unless failureScope ALL", () => {
    const m = read(MODULE);
    expect(m).toContain('procedure: "SAVING_THROW", mode: isPlainObject(roll) ? own(roll, "mode") : undefined, stat: policy.concentrationSaveStat');
    expect(m).toContain('const n = consumers();');
    expect(m).toContain('else end(String(target), "CONCENTRATION_FAILED", "concentration.disrupted_effect");');
    expect(m).toContain('if (scope === "ALL") {');
    expect(m).not.toMatch(/Status ?Condition.*[Cc]oncentrat/);
  });

  it("M5-I329–I332 Channeling: Concentration slot, one Channel, ≥ 1 AP per round, immediate completion, progress lost on failure; MP timing unresolved", () => {
    expect(ACTIVE_MAGIC_POLICY.channel).toEqual({ requiresConcentration: true, maximumSimultaneous: 1, minimumApPerRound: 1, mpPaymentTiming: null, mpPaymentConflictKey: "M5-SC-053" });
    const m = read(MODULE);
    expect(m).toContain("if (channel && policy.channel.maximumSimultaneous <= 1)");
    expect(m).toContain("if (channel.investedThisRound < policy.channel.minimumApPerRound) {");
    expect(m).toContain("if (invested === channel.requiredAp) {");
    expect(m).toContain('if (!spendAp(channel.channelKey, "channel.ap", amount, channel.spell.canonicalKey))');
    expect(m).toContain("channel = null; // the Spell fails; every invested AP is lost; a new attempt starts from 0");
  });

  it("M5-I316 / M5-I317 / M5-I334 Instant leaves no state; Timed ends only at explicit boundaries; dismissal is the pinned per-Duration rule", () => {
    const m = read(MODULE);
    expect(m).toContain('if (dur.mode === "INSTANT" || !dur.futureRuntime.persists) { status = "NO_ACTIVE_EFFECT"; noActiveEffectReason = "INSTANT"; break; }');
    expect(m).toContain('if (remaining === 0) end(x.activeEffectKey, "EXPIRED", "duration.rounds");');
    expect(m).toContain("y.duration.concept === ACTIVE_MAGIC_BOUNDARIES[b]");
    expect(m).toContain('if (x.duration.dismissal !== "FREE_ACTION")');
    expect(ACTIVE_MAGIC_POLICY.dismissal).toEqual({ INSTANT: "NOT_DISMISSIBLE", ROUNDS: "NOT_DISMISSIBLE", COMBAT: "NOT_DISMISSIBLE", SCENE: "NOT_DISMISSIBLE", MISSION: "NOT_DISMISSIBLE", SUSTAINED: "FREE_ACTION", MANA_LOCK: "NOT_DISMISSIBLE", PERMANENT_BY_SPECIAL_RULE: "NOT_DISMISSIBLE" });
  });

  it("M5-I318 / M5-I333 / M5-I337 state is pinned to its exact Ruleset and policy; output detached and frozen", () => {
    const m = read(MODULE);
    expect(m).toContain('if (pol && !isSameExactDefinition(pol, policyRef)) p.add(K.CROSS_RULESET, [...at, "policy"], "the Active Effect is pinned to another active-magic policy version");');
    expect(m).toContain('"Active Magic state is pinned to its exact Ruleset for its whole lifetime"');
    expect(m).toContain("deepFreeze(clonePlainData({ status, event: kind, state, resources");
    expect(m).toContain('const v = formula("sustain_mp.verify", policy.formulas.sustainMp, { final_mp: x.sustain!.finalSpellMp, pro: x.sustain!.pro });');
  });

  it("register: SC-042 / 046 / 047 / 048 / 049 / 050 / 051 stay UNRESOLVED; SC-052 / SC-053 recorded UNRESOLVED; SC-054 ruled", () => {
    for (const key of ["M5-SC-042", "M5-SC-046", "M5-SC-047", "M5-SC-048", "M5-SC-049", "M5-SC-050", "M5-SC-051", "M5-SC-052", "M5-SC-053"]) expect(section(key), key).toContain("`UNRESOLVED`");
    expect(section("M5-SC-054")).toContain("`RESOLVED_BY_DESIGNER`");
    expect(section("M5-SC-052")).toContain("recorded by M5-WO13");
    expect(section("M5-SC-053")).toContain("recorded by M5-WO13");
  });

  it("M4 sources, Prisma schema / migrations and API routes are unchanged; no WO13-only endpoint or UI", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo13-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string>; apiRoutes: string[]; priorInvariantCount: number };
    expect([baseline.baseCommit, baseline.priorInvariantCount]).toEqual(["feed5df72187f4c2c7a896d8dc2a6338ad96ac1a", 315]);
    const files = [...walk("packages/prowess-rules/src"), ...walk("packages/prowess-db/prisma").filter(notLaterMigration)].sort(); // M6-WO3: registered later migrations excluded
    expect(files).toEqual(Object.keys(baseline.frozenFiles).sort());
    for (const [path, expected] of Object.entries(baseline.frozenFiles)) expect(hash(frozenFileContent(resolve(root, path))), path).toBe(expected);
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(withLaterMilestoneRoutes(baseline.apiRoutes));
    for (const f of [...walk("apps/studio/app"), ...walk("apps/studio/src")].filter((x) => /\.(ts|tsx)$/.test(x))) expect(read(f), f).not.toMatch(/@prowess\/game|\/api\/(active-magic|sustain|concentration|channel)/);
  });

  it("invariants M5-I001–I337 are sequential; M5-I316–I337 are guarded by executing tests that cite them", () => {
    const inv = JSON.parse(read("docs/architecture/m5-invariants.json")) as { id: string; title: string; group: string; guards: string[]; status?: string }[];
    expect(inv.map((x) => x.id)).toEqual(Array.from({ length: 337 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    const self = read("apps/studio/tests/unit/m5-wo13-static.test.ts"), md = read("docs/architecture/m5-invariants.md");
    for (const row of inv.slice(315, 337)) {
      expect([row.status ?? "ACTIVE", row.group]).toEqual(["ACTIVE", "Active Magic Runtime"]);
      expect(row.guards).toEqual(expect.arrayContaining(["apps/studio/tests/unit/m5-wo13-static.test.ts", "scripts/m5-wo13-negative-controls.mjs"]));
      for (const g of row.guards) {
        expect(existsSync(resolve(root, g)), g).toBe(true);
        if (g.endsWith(".test.ts")) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(self).toContain(row.id);
    }
  });

  it("documentation and the implementation report exist", () => {
    const doc = read("docs/architecture/m5-active-magic-runtime.md");
    for (const h of ["Scope and Ownership", "Transition Architecture", "Active Effect Contract", "Lifecycle States and End Reasons", "Activation and Duration Handling", "Timed Durations", "Sustain", "Atomic Payment and Maintenance Selection", "Mana Lock", "Concentration", "Concentration Save, DC and Failure Scope", "Channeling", "Dismissal, Expiration and External Ends", "Ticks and Summons", "Rules Inspector and Source Maps", "Exact Ruleset and History", "Unresolved Conflicts", "Out of Scope"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h.replace(/[()/]/g, "\\$&")}$`, "m"));
    expect(read("docs/reports/m5-wo13-implementation-report.md")).toContain("M5-WO13");
  });

  it("CI keeps every permanent gate and adds the WO13 gate after WO12; its former dedicated workflow lives in the consolidated gate", () => {
    const ci = read(".github/workflows/ci.yml"), dedicated = consolidated("M5-WO13", "m5-wo13.yml");
    for (let i = 1; i <= 12; i++) expect(ci).toContain(`M5-WO${String(i)}`);
    expect(ci.indexOf("M5-WO13 audit — Active Magic Runtime")).toBeGreaterThan(ci.indexOf("M5-WO12 audit — Effect Chain Execution & Runtime Routing"));
    for (const path of ["active-magic-golden.test.ts", "active-magic-contracts.test.ts", "m5-wo13-static.test.ts", "m5-wo13-inspector-fixture.test.ts", "prowess-active-magic-history.test.ts", "m5-wo13-active-magic-api.test.ts", "m5-wo13-negative-controls.mjs"]) {
      expect(ci, path).toContain(path);
      expect(dedicated, path).toContain(path);
    }
  });

  it.each([
    "const r = Math.random();",
    "const at = Date.now();",
    "export const latestDuration = 1;",
    "const currentSustainRule = 1;",
    "function applyDamage() {}",
    "function addCondition() {}",
    "const concentrationDie = 1;",
    "function rollSave() {}",
    "function recalculateSpellCost() {}",
    "function executeEffectChain() {}",
    "const sustain = Math.floor(mp / pro);",
    "const dc = consumers * 2;",
    "const expiresAt = 1;",
    "const concentrationCondition = 1;",
    "import { prisma } from \"@prowess/db\";",
    "import { compileEffectUse } from \"../effect/compile.js\";",
    "function deductMp() {}",
  ])("detects forbidden mutation %s", (snippet) => expect(auditWo13Source(snippet).length).toBeGreaterThan(0));
});
