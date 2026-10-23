/**
 * M5-WO10 behavioural mutation controls. Each control temporarily mutates REAL WO10 source or policy on disk, runs the
 * permanent guard that must catch it (the static audit or a targeted golden), requires the guard to FAIL for a behavioural
 * reason, restores the file in a `finally`, verifies it byte-identical and re-runs the guard green. Never commit a control.
 *
 * Run from the repository root: node scripts/m5-wo10-negative-controls.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.join(root, file);
const vitest = (pkgDir, args) => () =>
  spawnSync(process.execPath, [path.join(root, pkgDir, "node_modules/vitest/vitest.mjs"), "run", ...args], { cwd: path.join(root, pkgDir), encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "1" } });
const golden = (pattern) => vitest("packages/prowess-game", ["src/spell-cost-golden.test.ts", "-t", pattern]);
const STATIC = vitest("apps/studio", ["tests/unit/m5-wo10-static.test.ts"]);
const MODULE = "packages/prowess-game/src/ability/spell-cost.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/spell-cost.ts";
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
};

const controls = [
  ["net percentage replaced by sequential multiplication", POLICY, replaceOnce('expression: "base * net / 100"', 'expression: "base * net / 100 * net / 100"'), golden("ONE net 90%")],
  ["final MP rounded down instead of normally", POLICY, replaceOnce('expression: "floor(unrounded + 0.5)"', 'expression: "floor(unrounded)"'), golden("13.5")],
  ["intermediate rounding on every WO10 Formula", MODULE, replaceOnce('rounding: "NONE" }, variables }', 'rounding: "FLOOR" }, variables }'), STATIC],
  ["raw listed Casting Condition total consumed instead of the WO9 effective 30%", MODULE, replaceOnce("dc.summary.spellMpPercent.effectiveStep", "dc.summary.spellMpPercent.listedStep"), golden("45%")],
  ["rank-based 20 / 30 / 40 Condition caps reintroduced", MODULE, append("export const rankCaps = [20, 30, 40];"), STATIC],
  ["WO4 listed-cost step left in the plan (Affinity double-count path)", MODULE, replaceOnce("const excluded = new Set([a.outputs.cost.stepKey, a.outputs.cost.netStepKey]);", "const excluded = new Set([a.outputs.cost.netStepKey]);"), STATIC],
  ["Affinity Strength applied twice", MODULE, replaceOnce("for (const m of request.modifiers) netModifiers.push({ ...clonePlainData(m), targetKey: NET_TARGET });", "for (const m of [...request.modifiers, ...request.modifiers.slice(0, 1).map((x) => ({ ...x, modifierKey: \"affinity.strength_again\" }))]) netModifiers.push({ ...clonePlainData(m), targetKey: NET_TARGET });"), golden("Expert Strength −20% on 20 MP")],
  ["ME subtracted from Spell cost", MODULE, append("export const manaEfficiencyDiscount = (mp: number, me: number) => mp - me;"), STATIC],
  ["final Spell AP capped at 3", MODULE, replaceOnce('{ ...modifier("spell.minimum_ap", AP_TARGET, "MAX", "spell.ap_minimum", 2, 0, spellRef), operand: POLICY.minimumAp, source: provenance },', '{ ...modifier("spell.minimum_ap", AP_TARGET, "MAX", "spell.ap_minimum", 2, 0, spellRef), operand: POLICY.minimumAp, source: provenance },\n            { ...modifier("spell.maximum_ap", AP_TARGET, "MIN", "spell.ap_minimum", 2, 1, spellRef), operand: 3, source: provenance },'), golden("36 MP, PRO 5")],
  ["AP modifiers applied to the final MP value instead of the derived base AP", MODULE, replaceOnce('bind("/request/targets/0/value", baseAp)', 'bind("/request/targets/0/value", finalMp)'), golden("Somatic −1 AP applies after base AP")],
  ["final AP floor of 1 removed", MODULE, replaceOnce('{ ...modifier("spell.minimum_ap", AP_TARGET, "MAX", "spell.ap_minimum", 2, 0, spellRef), operand: POLICY.minimumAp, source: provenance },', ""), golden("2 MP, PRO 5")],
  ["AP division rounded normally instead of down", POLICY, replaceOnce('expression: "max(1, floor(final_mp / pro))"', 'expression: "max(1, floor(final_mp / pro + 0.5))"'), golden("floor\\(3.5\\)")],
  ["Sustain runtime implemented", MODULE, append("export function executeSustain() {}"), STATIC],
  ["final Maneuver cost implemented", MODULE, append("export const finalManeuverCost = 1;"), STATIC],
  ["latest / current Definition lookup", MODULE, append("export const latestTrait = null;"), STATIC],
  ["Ruleset provenance check bypassed when reading the run", MODULE, replaceOnce("JSON.stringify(clonePlainData(x.response.ruleset ?? null)) === JSON.stringify(clonePlainData(plan.rulesetProvenance))", "true"), STATIC],
  ["name-based Signature discount", MODULE, append("export const signatureDiscount = (spell: { signature?: boolean }) => (spell.signature === true ? 20 : 0);"), STATIC],
  ["default PRO invented", MODULE, replaceOnce('const pro = isPlainObject(stats) ? own(stats, "PRO") : undefined;', 'const pro = (isPlainObject(stats) ? own(stats, "PRO") : undefined) ?? 4;'), STATIC],
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
console.log(`All ${controls.length} M5-WO10 mutation controls caught and reverted.`);
