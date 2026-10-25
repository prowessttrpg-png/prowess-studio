/**
 * M5-WO11 behavioural mutation controls. Each control temporarily mutates REAL WO11 / WO8 / WO9 source or policy on disk,
 * runs the permanent guard that must catch it (a targeted golden / contract test or the static audit), requires the guard
 * to FAIL for a behavioural reason, restores the file in a `finally`, verifies it byte-identical and re-runs the guard
 * green. Never commit a control.
 *
 * Run from the repository root: node scripts/m5-wo11-negative-controls.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.join(root, file);
const vitest = (pkgDir, args) => () =>
  spawnSync(process.execPath, [path.join(root, pkgDir, "node_modules/vitest/vitest.mjs"), "run", ...args], { cwd: path.join(root, pkgDir), encoding: "utf8", timeout: 600_000, env: { ...process.env, CI: "1" } });
const golden = (pattern) => vitest("packages/prowess-game", ["src/maneuver-cost-golden.test.ts", "-t", pattern]);
const contract = (pattern) => vitest("packages/prowess-game", ["src/maneuver-cost-contracts.test.ts", "-t", pattern]);
const STATIC = vitest("apps/studio", ["tests/unit/m5-wo11-static.test.ts"]);
const MODULE = "packages/prowess-game/src/ability/maneuver-cost.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/maneuver-cost.ts";
const COMPILE = "packages/prowess-game/src/ability/compile.ts";
const WO9 = "packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions.ts";
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, () => to);
};
const both = (...steps) => (text) => steps.reduce((t, f) => f(t), text);
const FINAL_SIGNATURE = '...(assigned ? [modifier("maneuver.signature", FINAL_AP, "SUBTRACT", "maneuver.signature", 1, 0, policyRef, policy.signatureApReduction)] : []),';
const MINIMUM_AP = 'modifier("maneuver.minimum_ap", FINAL_AP, "MAX", "maneuver.minimum_ap", 2, 0, policyRef, policy.minimumAp),';
const FLOOR = 'modifiers: [modifier("maneuver.condition_attack_floor", POST_AP, "MAX", "maneuver.condition_floor", 1, 0, policyRef)]';

const controls = [
  ["−3 AP Condition cap removed (raw listed total consumed)", MODULE, replaceOnce("dc?.summary.maneuverAp.effectiveStep", "dc?.summary.maneuverAp.listedStep"), golden("over-cap")],
  ["Once per Mission −5 AP made an executable Condition reduction", WO9, both(
    replaceOnce('["weapon_lock", "environmental_lock", "once_per_mission"]', '["weapon_lock", "environmental_lock"]'),
    replaceOnce('    condition("MANEUVER", "target_flanked"', '    condition("MANEUVER", "once_per_mission", "ONCE_PER_MISSION", ["s2020"], [cost("once_per_mission.ap", "AP_REDUCTION", 5)]),\n    condition("MANEUVER", "target_flanked"'),
  ), contract("Once per Mission")],
  ["attack floor removed", POLICY, replaceOnce('attackFloor: { expression: "max(minimum, attacks)"', 'attackFloor: { expression: "minimum"'), golden("C — two SEPARATE")],
  ["Powerful Blow constituents counted as separate floor attacks", MODULE, replaceOnce('separateAttackResolutions: resolutionGroups.filter((g) => g.kind !== "ACTION").length', "separateAttackResolutions: plan.actions.filter((a) => isAttackFoundation(a.profile)).length"), golden("D — Powerful Blow")],
  ["Powerful Blow constituents no longer all counted in Base AP", MODULE, replaceOnce("  for (const a of plan.actions) {\n    const costs", "  for (const a of plan.actions.filter((x, i, all) => !pb?.actionKeys.includes(x.componentKey) || all.findIndex((y) => pb.actionKeys.includes(y.componentKey)) === i)) {\n    const costs"), golden("D — Powerful Blow")],
  ["Maneuver AP capped at 3", MODULE, replaceOnce(MINIMUM_AP, `${MINIMUM_AP}\n        modifier("maneuver.maximum_ap", FINAL_AP, "MIN", "maneuver.minimum_ap", 2, 1, policyRef, 3),`), golden("B — Heavy")],
  ["final 1 AP minimum removed", MODULE, replaceOnce(MINIMUM_AP, ""), golden("Signature is not a Condition")],
  ["Signature applied before the attack floor", MODULE, both(
    replaceOnce(FINAL_SIGNATURE, ""),
    replaceOnce(FLOOR, 'modifiers: [...(assigned ? [modifier("maneuver.signature", POST_AP, "SUBTRACT", "maneuver.signature", 0, 0, policyRef, policy.signatureApReduction)] : []), modifier("maneuver.condition_attack_floor", POST_AP, "MAX", "maneuver.condition_floor", 1, 0, policyRef)]'),
  ), golden("I — Signature applies AFTER")],
  ["Signature prevented from bypassing the attack floor", MODULE, replaceOnce(MINIMUM_AP, 'modifier("maneuver.minimum_ap", FINAL_AP, "MAX", "maneuver.minimum_ap", 2, 0, policyRef, structure.separateAttackResolutions || policy.minimumAp),'), golden("I — Signature applies AFTER")],
  ["Signature reduces MP", MODULE, replaceOnce('modifier("maneuver.condition_mp", FINAL_MP, "SUBTRACT", "maneuver.condition_mp", 1, 0, policyRef),', 'modifier("maneuver.condition_mp", FINAL_MP, "SUBTRACT", "maneuver.condition_mp", 1, 0, policyRef),\n        ...(assigned ? [modifier("maneuver.signature_mp", FINAL_MP, "SUBTRACT", "maneuver.condition_mp", 1, 1, policyRef, policy.signatureApReduction)] : []),'), golden("H — Signature")],
  ["Signature treated as a Condition-stage reduction", MODULE, replaceOnce('modifier("maneuver.signature", FINAL_AP,', 'modifier("maneuver.signature", POST_AP,'), STATIC],
  ["AP-or-MP alternative auto-selected (explicit choice no longer required)", MODULE, replaceOnce('if (!selectedParam?.explicit) p.add(K.MISSING_COST_CHOICE, ["effects", componentKey, parameter], "an AP-or-MP cost option requires an explicit authored choice; it is never auto-selected");', ""), contract("without an authored choice")],
  ["negative final MP allowed", MODULE, replaceOnce('        modifier("maneuver.minimum_mp", FINAL_MP, "MAX", "maneuver.minimum_mp", 2, 0, policyRef, policy.minimumMp),\n', ""), golden("never becomes negative")],
  ["Spell MP ÷ PRO AP derivation", MODULE, append("export const apFromMp = (finalMp: number, pro: number) => finalMp / pro;"), STATIC],
  ["Spell Affinity percentage applied to Maneuvers", MODULE, append('import { compileAffinity } from "../affinity/compile.js";\nexport const affinityPercent = compileAffinity;'), STATIC],
  ["damage / runtime executed", MODULE, append("export function applyDamage() {}"), STATIC],
  ["latest / current content lookup", MODULE, append("export const latestManeuverEffect = null;"), STATIC],
  ["Ruleset provenance check bypassed when reading the run", MODULE, replaceOnce("JSON.stringify(clonePlainData(x.response.ruleset ?? null)) === JSON.stringify(clonePlainData(plan.rulesetProvenance))", "true"), STATIC],
  ["inherited weapon performance requirement removed", MODULE, replaceOnce("inheritedRequirements: attack ? [", "inheritedRequirements: false ? ["), golden("carries its own weapon requirement")],
  ["inherited weapon requirement made discount-bearing", MODULE, replaceOnce("grantsConditionDiscount: false, consumesConditionSlot: false", "grantsConditionDiscount: true, consumesConditionSlot: false"), golden("carries its own weapon requirement")],
  ["Attack-scoped Effects broadcast to every Attack", COMPILE, replaceOnce("const attached = composition.effects.filter(e => man!.effectAttachments.find(a => a.effectKey === e.componentKey)!.actionKeys.includes(action.componentKey));", "const attached = composition.effects;"), golden("ONE instance")],
  ["Attack-scoped Traits broadcast to every Attack", COMPILE, replaceOnce('traits: composition.traits.filter(t => t.appliesTo.componentKey === null || t.appliesTo.scope === "TARGETING" || attached.some(e => e.componentKey === t.appliesTo.componentKey))', "traits: composition.traits"), STATIC],
  ["Powerful Blow allowed to combine different Attack types", COMPILE, replaceOnce(" || members.some(a => !isSameExactDefinition(a.definition, members[0]!.definition))", ""), contract("Powerful Blow cannot combine")],
  ["a Powerful Blow's attached Effect cost multiplied by constituent count", MODULE, replaceOnce("    if (counted.has(componentKey)) continue;\n", ""), golden("ONE instance")],
  ["ordinary repeated Attacks merged without Powerful Blow", MODULE, replaceOnce("const groupOf = (actionKey: string) => (pb?.actionKeys.includes(actionKey) ? pbKey! : actionKey);", "const groupOf = (actionKey: string) => (pb?.actionKeys.includes(actionKey) ? pbKey! : plan.actions.find((x) => isSameExactDefinition(x.definition, plan.actions.find((y) => y.componentKey === actionKey)!.definition))!.componentKey);"), golden("C — two SEPARATE")],
  ["explicit Attack attachment identity discarded", MODULE, replaceOnce("return a ? groupOf(a.actionKeys[0]!) : null; };", "return a ? null : null; };"), golden("C — two SEPARATE")],
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
      assert.match(`${result.stdout}${result.stderr}`, /AssertionError|Error: compile failed|Error: reading failed|Error: steps failed|Error: M4 run failed|expected/, `control failed for infrastructure rather than behaviour: ${name}\n${result.stdout}${result.stderr}`);
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
console.log(`All ${controls.length} M5-WO11 mutation controls caught and reverted.`);
