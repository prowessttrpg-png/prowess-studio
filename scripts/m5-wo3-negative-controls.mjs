/**
 * M5-WO3 behavioural negative controls (PAS-10 M5-WO3 §174–§194). Each control temporarily mutates REAL source, the REAL
 * canonical content or the REAL conflict register on disk, runs the guard that must catch it, requires that guard to FAIL
 * for the right reason (an assertion, not infrastructure), and restores the file in a `finally`. Every file is verified
 * byte-identical afterwards and every guard is re-run green. Never commit a control.
 *
 * Run from the repository root after building workspace packages: node scripts/m5-wo3-negative-controls.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.join(root, file);
const vitest = (pkgDir, args) => () =>
  spawnSync(process.execPath, [path.join(root, pkgDir, "node_modules/vitest/vitest.mjs"), "run", ...args], { cwd: path.join(root, pkgDir), encoding: "utf8", timeout: 180_000, env: { ...process.env, CI: "1" } });
const golden = (pattern) => vitest("packages/prowess-game", ["src/runtime-resources-golden.test.ts", "-t", pattern]);
const coreGolden = (pattern) => vitest("packages/prowess-game", ["src/core-resolution-golden.test.ts", "-t", pattern]);
const staticWo3 = (pattern) => vitest("apps/studio", ["tests/unit/m5-wo3-static.test.ts", "-t", pattern]);
const sourceRules = (file) => staticWo3(`packages/prowess-game/src/${file} passes the WO3`);
const CONTENT_RULES = "content passes every WO3 rule";

const G = (f) => `packages/prowess-game/src/${f}`;
const CORE = G("content/core-playtest-v0.1/core-resolution.json");
const RUNTIME = G("content/core-playtest-v0.1/runtime-resources.json");
const REGISTER = "docs/architecture/m5-core-playtest-source-conflicts.md";
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
};
const all = (...edits) => (text) => edits.reduce((t, e) => e(t), text);
/** Mutates a canonical content JSON structurally (parsed, edited, re-serialized in the file's own format). */
const content = (edit) => (text) => {
  const doc = JSON.parse(text);
  edit(doc.definitions);
  return `${JSON.stringify(doc, null, 2)}\n`;
};
const def = (defs, predicate) => {
  const found = defs.filter(predicate);
  assert.equal(found.length, 1, "content anchor must match exactly one Definition");
  return found[0];
};
const resource = (key) => (d) => d.definitionKind === "RESOURCE" && d.payload.resourceKey === key;
const MODE_LINE = '  const mode: RollMode = hasAdvantage === hasDisadvantage ? "NORMAL" : hasAdvantage ? "ADVANTAGE" : "DISADVANTAGE";';

const controls = [
  {
    name: "§174 M5-SC-006 restored to UNRESOLVED while executable Base Movement exists",
    file: REGISTER,
    mutate: replaceOnce("- **status**: `RESOLVED_BY_DESIGNER`\n- **resolution authority**: M5-WO3 §4–§6 (designer ruling)", "- **status**: `UNRESOLVED`\n- **resolution authority**: none"),
    guard: staticWo3("source-conflict register: M5-SC-006"),
  },
  {
    name: "§175 Base Movement calculated as 10 × AGI",
    file: CORE,
    mutate: content((defs) => void (def(defs, (d) => d.payload.statistic === "BASE_MOVEMENT").payload.formula.expression = "10 * agi")),
    guard: golden("AGI 4 → 20 ft"),
  },
  {
    name: "§176 Movement modifier derived from Large 10 × 10 occupied space",
    file: RUNTIME,
    mutate: content((defs) => void (def(defs, (d) => d.payload.sizeKey === "LARGE").payload.baseMovement = { kind: "ADD", feet: 10, derivedFrom: "occupiedSpaceFeet" })),
    guard: staticWo3(CONTENT_RULES),
  },
  {
    name: "§177 two Advantage sources produce a stronger-than-Advantage state",
    file: G("core/dice.ts"),
    mutate: replaceOnce(MODE_LINE, '  const mode = (advantage.length >= 2 && !hasDisadvantage ? "GREATER_ADVANTAGE" : hasAdvantage === hasDisadvantage ? "NORMAL" : hasAdvantage ? "ADVANTAGE" : "DISADVANTAGE") as RollMode;'),
    guard: sourceRules("core/dice.ts"),
  },
  {
    name: "§178 2 Advantage + 1 Disadvantage netted to ADVANTAGE",
    file: G("core/dice.ts"),
    mutate: replaceOnce(MODE_LINE, '  const mode: RollMode = advantage.length > disadvantage.length ? "ADVANTAGE" : advantage.length < disadvantage.length ? "DISADVANTAGE" : "NORMAL";'),
    guard: sourceRules("core/dice.ts"),
  },
  {
    name: "§179 WO2 Advantage + Disadvantage → ROLL_MODE_CONFLICT restored",
    file: G("core/dice.ts"),
    mutate: replaceOnce(MODE_LINE, `${MODE_LINE}\n  if (hasAdvantage && hasDisadvantage) p.add("PROWESS_CORE.ROLL_MODE_CONFLICT", [], "both signals present");`),
    guard: coreGolden("resolve NORMAL"),
  },
  {
    name: "§180 signals collapsed to booleans without their source keys",
    file: G("core/dice.ts"),
    mutate: replaceOnce("({ mode, advantage, disadvantage, cancelled:", '({ mode, advantage: hasAdvantage ? ["ADVANTAGE"] : [], disadvantage: hasDisadvantage ? ["DISADVANTAGE"] : [], cancelled:'),
    guard: golden("§120 Stat Mastery"),
  },
  {
    name: "§181 unused AP carried into the next turn (no END_OF_TURN expiry)",
    file: RUNTIME,
    mutate: content((defs) => void (def(defs, resource("AP")).payload.expiry = [])),
    guard: staticWo3(CONTENT_RULES),
  },
  {
    name: "§182 unused Counter Actions accumulate (restorable, no refresh to Capacity)",
    file: RUNTIME,
    mutate: content((defs) => {
      const c = def(defs, resource("COUNTER_ACTION")).payload;
      c.refresh = [];
      c.restoration = { ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" };
    }),
    guard: staticWo3(CONTENT_RULES),
  },
  { name: "§183 Current ME preserved instead of refreshed at a new Round", file: RUNTIME, mutate: content((defs) => void (def(defs, resource("ME")).payload.refresh = [])), guard: golden("§110 PRO 5") },
  {
    name: "§184 listed cost reduced by ME",
    file: G("runtime/compile.ts"),
    mutate: all(replaceOnce("chain.payment(subject.costKey, policy, subject.listedAmount,", "chain.payment(subject.costKey, policy, effectiveCost(subject.listedAmount, 5),"), append("function effectiveCost(listed: number, me: number): number { return listed - me; }")),
    guard: sourceRules("runtime/compile.ts"),
  },
  {
    name: "§185 eligible magical cost paid MP then ME",
    file: RUNTIME,
    mutate: content((defs) => {
      def(defs, resource("ME")).payload.payment = [{ policy: "ME_ELIGIBLE_MAGICAL_COST", order: 1 }];
      def(defs, resource("MP")).payload.payment = [{ policy: "MAGICAL_COST", order: 0 }, { policy: "ME_ELIGIBLE_MAGICAL_COST", order: 0 }];
    }),
    guard: golden("§111 listed 8"),
  },
  {
    name: "§186 available Resources deducted when the full cost cannot be paid",
    file: G("runtime/results.ts"),
    mutate: replaceOnce(
      'resources: status === "PAID" ? r.resources : input.resources,',
      "resources: { resources: input.resources.resources.map((s) => ({ ...s, current: r.payments.flatMap((x) => x.allocations).find((a) => a.resourceKey === s.resourceKey)?.currentAfter ?? s.current })) },",
    ),
    guard: golden("§107 current 2"),
  },
  {
    name: "§187 reserving capacity decreases Current MP",
    file: G("runtime/compile.ts"),
    mutate: replaceOnce("chain.transition(t.resourceKey, t.operation, t.operation, request, []);", 'chain.transition(t.resourceKey, t.operation === "RESERVE_CAPACITY" ? "SPEND" : t.operation, t.operation, request, []);'),
    guard: golden("§113 MP maximum 20"),
  },
  {
    name: "§188 releasing a reservation refills Current MP",
    file: G("runtime/compile.ts"),
    mutate: all(
      replaceOnce('const request: JsonObject = t.operation === "RESTORE" && restoration !== null', 'const request: JsonObject = (t.operation === "RESTORE" || t.operation === "RELEASE_CAPACITY") && restoration !== null'),
      replaceOnce("chain.transition(t.resourceKey, t.operation, t.operation, request, []);", 'chain.transition(t.resourceKey, t.operation === "RELEASE_CAPACITY" ? "RESTORE" : t.operation, t.operation, request, []);'),
    ),
    guard: golden("§114 maximum 20"),
  },
  {
    name: "§189 3 AP modelled as exactly 3 action slots (every action costs one)",
    file: G("runtime/compile.ts"),
    mutate: replaceOnce("      return subject.costOverride === undefined ? cost.amount : subject.costOverride.amount;", "      return 1; // one action slot"),
    guard: golden("§106 current 5"),
  },
  {
    name: "§190 core Action cost hard-coded by action-name switch",
    file: G("runtime/compile.ts"),
    mutate: append('export function actionCost(actionKey: string): number { switch (actionKey) { case "MOVE": return 1; case "SPRINT": return 3; case "HEAVY_ATTACK": return 3; default: return 2; } }'),
    guard: sourceRules("runtime/compile.ts"),
  },
  {
    name: "§191 player characters sorted into mandatory personal Initiative order",
    file: G("runtime/combat.ts"),
    mutate: replaceOnce("members: [...(members as string[])],", "members: [...(members as string[])].sort(),"),
    guard: sourceRules("runtime/combat.ts"),
  },
  {
    name: "§192 PER / 2 and AGI / 2 floored without an explicit rule",
    file: CORE,
    mutate: content((defs) => void (def(defs, (d) => d.payload.procedure === "INITIATIVE").payload.total.expression = "natural + floor(per / 2) + floor(agi / 2) + bonuses")),
    guard: golden("§121 d8 natural 5"),
  },
  { name: "§193 tie reroll generated inside the engine", file: G("runtime/combat.ts"), mutate: append("export const rerollInitiative = (faces: number): number => Math.ceil(Math.random() * faces);"), guard: sourceRules("runtime/combat.ts") },
  {
    name: "§194 invented fixed AP penalty for Surprise",
    file: G("runtime/compile.ts"),
    mutate: replaceOnce("if (refresh !== undefined) chain.transition(", 'if (refresh !== undefined && !(combat.surprised && key === "AP")) chain.transition('),
    guard: golden("§52 Surprise invents no AP penalty"),
  },
];

const originals = new Map();
const restore = () => {
  for (const [file, text] of originals) writeFileSync(abs(file), text);
};
try {
  for (const control of controls) {
    if (!originals.has(control.file)) originals.set(control.file, readFileSync(abs(control.file), "utf8"));
    const original = originals.get(control.file);
    const baseline = control.guard();
    assert.equal(baseline.status, 0, `baseline guard is not green for ${control.name}:\n${baseline.stdout}${baseline.stderr}`);
    assert.doesNotMatch(baseline.stdout, /no tests|No test files found|\b0 passed/i, `baseline guard selected no tests for ${control.name}`);

    const mutated = control.mutate(original);
    assert.notEqual(mutated, original);
    writeFileSync(abs(control.file), mutated);
    try {
      const result = control.guard();
      assert.notEqual(result.status, 0, `control was NOT caught: ${control.name}`);
      assert.match(`${result.stdout}${result.stderr}`, /AssertionError|Error: compile failed|Error: reading failed|Error: \[|expected/, `control failed for infrastructure rather than behaviour: ${control.name}\n${result.stdout}${result.stderr}`);
    } finally {
      writeFileSync(abs(control.file), original);
    }
    assert.equal(readFileSync(abs(control.file), "utf8"), original, `file not restored byte-for-byte: ${control.file}`);
    assert.equal(control.guard().status, 0, `guard not green after restoring ${control.name}`);
    console.log(`Negative control caught: ${control.name}`);
  }
} finally {
  restore();
}
console.log(`All ${controls.length} M5-WO3 negative controls caught and reverted.`);
