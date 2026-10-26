/**
 * M5-WO12 behavioural mutation controls. Each control temporarily mutates REAL WO12 source, chain contract or execution
 * policy on disk, runs the permanent guard that must catch it (a targeted golden / contract test or the static audit),
 * requires the guard to FAIL for a behavioural reason, restores the file in a `finally`, verifies it byte-identical and
 * re-runs the guard green. Never commit a control.
 *
 * Run from the repository root: node scripts/m5-wo12-negative-controls.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.join(root, file);
const vitest = (pkgDir, args) => () =>
  spawnSync(process.execPath, [path.join(root, pkgDir, "node_modules/vitest/vitest.mjs"), "run", ...args], { cwd: path.join(root, pkgDir), encoding: "utf8", timeout: 900_000, env: { ...process.env, CI: "1" } });
const golden = (pattern) => vitest("packages/prowess-game", ["src/effect-execution-golden.test.ts", "-t", pattern]);
const contract = (pattern) => vitest("packages/prowess-game", ["src/effect-execution-contracts.test.ts", "-t", pattern]);
const STATIC = vitest("apps/studio", ["tests/unit/m5-wo12-static.test.ts"]);
const MODULE = "packages/prowess-game/src/ability/effect-execution.ts";
const CHAIN = "packages/prowess-game/src/definition/effect-chain-payload.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/effect-execution.ts";
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, () => to);
};
const both = (...steps) => (text) => steps.reduce((t, f) => f(t), text);
const NOT_TRIGGERED = 'if (!satisfied) { trace({ status: "NOT_TRIGGERED", transition: { behavior: n.behavior, next: n.successor } }); cursor = n.successor; continue; }';
const GROUP_OF = "const groupOf = (actionKey: string) => (pb?.actionKeys.includes(actionKey) ? pbKey! : actionKey);";
const GROUP_ATTACK = 'result = r.hit ? "SUCCESS" : "FAILURE"; critical = r.critical; requestKey = r.requestKey;';

const controls = [
  ["STOP removed (continues to the successor)", MODULE, replaceOnce('if (n.behavior === "STOP") termination = "STOP";', 'if (n.behavior === "STOP") next = n.successor;'), golden("STOP —")],
  ["SUCCESS_ONLY inverted", MODULE, replaceOnce('n.behavior === "SUCCESS_ONLY" && result === "FAILURE"', 'n.behavior === "SUCCESS_ONLY" && result === "SUCCESS"'), golden("SUCCESS_ONLY —")],
  ["FAILURE_ONLY inverted", MODULE, replaceOnce('n.behavior === "FAILURE_ONLY" && result === "SUCCESS"', 'n.behavior === "FAILURE_ONLY" && result === "FAILURE"'), golden("FAILURE_ONLY —")],
  ["both BRANCH paths executed (destinations no longer skipped)", MODULE, replaceOnce("const successor = ordered.slice(i + 1).find((x) => !destinations.has(x.effectKey))?.effectKey ?? null;", "const successor = ordered[i + 1]?.effectKey ?? null;"), golden("BRANCH —")],
  ["ruled default ignored (no-chain Spell continues after failure)", MODULE, replaceOnce(': policy.defaultChainBehavior;', ': "CONTINUE";'), golden("ruled default")],
  ["triggers ignored", MODULE, replaceOnce("        if (n.trigger) {", "        if (false && n.trigger) {"), golden("a false trigger")],
  ["NOT_TRIGGERED treated as FAILURE", MODULE, replaceOnce(NOT_TRIGGERED, 'if (!satisfied) { emit(t.targetKey, n, null, "FAILURE", false, null); trace({ status: "EXECUTED_FAILURE" }); cursor = n.successor; continue; }'), golden("a false trigger")],
  ["targets share one chain cursor", MODULE, both(
    replaceOnce("    targetTraces = [];\n", "    targetTraces = []; let sharedCursor: string | null | undefined;\n"),
    replaceOnce('let cursor: string | null = status === "PENDING_INPUT" ? null : plan.chain.start;', 'let cursor: string | null = status === "PENDING_INPUT" ? null : sharedCursor === undefined ? plan.chain.start : sharedCursor;'),
    replaceOnce("cursor = termination === null ? next : null;", "cursor = termination === null ? next : null; sharedCursor = cursor;"),
  ), golden("Target A succeeds")],
  ["Projectile Attack Effect rolls a second Attack (delivery roll not reused)", MODULE, replaceOnce('delivery && e.deliveryInteraction === "SAME_ATTACK_ROLL" ? "DELIVERY_ATTACK" : "OWN"', '"OWN"'), golden("SAME roll")],
  ["Save requested after a delivery miss", MODULE, replaceOnce('if (deliveryHit === false && n.route !== "DELIVERY_ATTACK") { trace({ status: "NOT_DELIVERED" }); termination = "DELIVERY_FAILED"; break; }', ""), golden("delivery miss")],
  ["caller success boolean trusted over M4", MODULE, both(
    replaceOnce('ATTACK_ROLL: ["requestKey", "kind", "executionKey", "roller", "roll", "targetDodge"],', 'ATTACK_ROLL: ["requestKey", "kind", "executionKey", "roller", "roll", "targetDodge", "success"],'),
    replaceOnce("const o = compiledCore.value.outputs, success = value(o.success);", 'const o = compiledCore.value.outputs, claimed = (input as unknown as { success?: unknown }).success, success = typeof claimed === "boolean" ? claimed : value(o.success);'),
  ), contract("bare success claim")],
  ["Saving Throw normalization inverted (target success = Effect success)", MODULE, replaceOnce('result = r.targetSucceeded ? "FAILURE" : "SUCCESS"; resolvedBy = r.requestKey;', 'result = r.targetSucceeded ? "SUCCESS" : "FAILURE"; resolvedBy = r.requestKey;'), golden("target fails → Effect SUCCESS")],
  ["input bound to another plan accepted", MODULE, replaceOnce('if (own(r, "executionKey") !== plan.executionKey)', "if (false)"), contract("another plan")],
  ["internal RNG", MODULE, append("export const rollD6 = () => Math.floor(Math.random() * 6);"), STATIC],
  ["HP mutated", MODULE, append("export function applyDamage(target: { hp: number }, n: number) { target.hp = n; }"), STATIC],
  ["Condition instance created", MODULE, append("export function addCondition() {}"), STATIC],
  ["latest / current content lookup", MODULE, append("export const latestRuleset = null;"), STATIC],
  ["separate Attacks collapsed into one resolution", MODULE, replaceOnce(GROUP_OF, "const groupOf = (actionKey: string) => (pb?.actionKeys.includes(actionKey) ? pbKey! : plan.actions[0]!.componentKey);"), golden("separate Attacks")],
  ["Powerful Blow split into one roll per constituent Attack", MODULE, replaceOnce(GROUP_OF, "const groupOf = (actionKey: string) => actionKey;"), golden("Powerful Blow: ONE")],
  ["attached Effects broadcast to every group", MODULE, replaceOnce("groupOf(x.actionKeys[0]!) === groupKey", "true"), golden("separate Attacks")],
  ["critical broadcast across the Maneuver", MODULE, both(
    replaceOnce("    groupTraces = [];\n", "    groupTraces = []; let sawCritical = false;\n"),
    replaceOnce(GROUP_ATTACK, 'result = r.hit ? "SUCCESS" : "FAILURE"; critical = r.critical || sawCritical; sawCritical = critical; requestKey = r.requestKey;'),
  ), golden("separate Attacks")],
  ["inherited Effect detached from its Attack resolution", MODULE, replaceOnce('return { ...base, route: "GROUP", resolution: resolution.mode === "SAVING_THROW" ? "SAVING_THROW" : "ATTACK_ROLL" };', "return base;"), golden("inherited resolution")],
  ["Martial Save replacement ignored (Attack Roll still requested)", MODULE, replaceOnce("replacement && replacement.throwFlow ?", "false && replacement?.throwFlow ?"), golden("Save replacement")],
  ["Martial EXPERT control bypassed (defender chooses from the full profile)", POLICY, replaceOnce('EXPERT: "ATTACKER_REMOVES_ONE"', 'EXPERT: "DEFENDER_CHOOSES"'), golden("EXPERT —")],
  ["Martial MASTER control bypassed (defender chooses)", POLICY, replaceOnce('MASTER: "ATTACKER_CHOOSES"', 'MASTER: "DEFENDER_CHOOSES"'), golden("MASTER —")],
  ["cyclic chain accepted (backward branch destination)", CHAIN, replaceOnce("else if ((position.get(v) as number) <= (position.get(effectKey) as number))", "else if (false)"), contract("a backward destination")],
];

const originals = new Map();
try {
  for (const [name, file, mutate, guard] of controls) {
    if (!originals.has(file)) originals.set(file, readFileSync(abs(file), "utf8"));
    const original = originals.get(file);
    const baseline = guard();
    assert.equal(baseline.status, 0, `baseline guard is not green for ${name}:\n${baseline.stdout}${baseline.stderr}`);
    assert.doesNotMatch(baseline.stdout, /no tests|No test files found|\b0 passed/i, `baseline guard selected no tests for ${name}`);
    const mutated = mutate(original);
    assert.notEqual(mutated, original);
    writeFileSync(abs(file), mutated);
    try {
      const result = guard();
      assert.notEqual(result.status, 0, `control was NOT caught: ${name}`);
      assert.match(`${result.stdout}${result.stderr}`, /AssertionError|Error: execution failed|Error: execution plan failed|Error: stuck|Error: no scripted answer|Error: did not complete|expected/, `control failed for infrastructure rather than behaviour: ${name}\n${result.stdout}${result.stderr}`);
    } finally {
      writeFileSync(abs(file), original);
    }
    assert.equal(readFileSync(abs(file), "utf8"), original, `file not restored byte-for-byte: ${file}`);
    assert.equal(guard().status, 0, `guard not green after restoring ${name}`);
    console.log(`Mutation control caught: ${name}`);
  }
} finally {
  for (const [file, text] of originals) writeFileSync(abs(file), text);
}
console.log(`All ${controls.length} M5-WO12 mutation controls caught and reverted.`);
