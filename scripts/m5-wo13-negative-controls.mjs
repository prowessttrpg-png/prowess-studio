/**
 * M5-WO13 behavioural mutation controls. Each control temporarily mutates REAL WO13 source or active-magic policy on disk,
 * runs the permanent guard that must catch it (a targeted golden / contract test or the static audit), requires the guard
 * to FAIL for a behavioural reason, restores the file in a `finally`, verifies it byte-identical and re-runs the guard
 * green. Never commit a control.
 *
 * Run from the repository root: node scripts/m5-wo13-negative-controls.mjs
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
const golden = (pattern) => vitest("packages/prowess-game", ["src/active-magic-golden.test.ts", "-t", pattern]);
const contract = (pattern) => vitest("packages/prowess-game", ["src/active-magic-contracts.test.ts", "-t", pattern]);
const STATIC = vitest("apps/studio", ["tests/unit/m5-wo13-static.test.ts"]);
const MODULE = "packages/prowess-game/src/ability/active-magic.ts";
const POLICY = "packages/prowess-game/src/content/core-playtest-v0.1/active-magic.ts";
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, () => to);
};
const both = (...steps) => (text) => steps.reduce((t, f) => f(t), text);
const RESERVE = 'if (!capacity(key, "RESERVE_CAPACITY", amount, cost.definition.canonicalKey)) break;';
const RELEASE = 'if (x.manaLock && !capacity(key, "RELEASE_CAPACITY", x.manaLock.reservedMp, x.ability.canonicalKey)) return false;';

const controls = [
  ["Sustain minimum of 1 removed", POLICY, replaceOnce('sustainMp: { expression: "max(1, floor(final_mp / pro))"', 'sustainMp: { expression: "floor(final_mp / pro)"'), golden("minimum 1 MP")],
  ["Sustain rounded normally instead of down", POLICY, replaceOnce('"max(1, floor(final_mp / pro))"', '"max(1, floor(final_mp / pro + 0.5))"'), golden("rounds DOWN")],
  ["Sustain calculated from pre-WO10 MP", MODULE, replaceOnce("{ final_mp: cost.finalMpCost, pro: cost.ap.pro }", "{ final_mp: cost.mp.baseMpCost, pro: cost.ap.pro }"), STATIC],
  ["MP spent before ME (Sustain not ME-eligible)", POLICY, replaceOnce("sustainMeEligible: true,", "sustainMeEligible: false,"), golden("ME first")],
  ["Sustain AP omitted", MODULE, replaceOnce('const ap = spendAp(x.activeEffectKey, "sustain.ap", x.sustain!.apCost, x.ability.canonicalKey);', "const ap = true;"), golden("ME first")],
  ["unpaid Sustain kept active", MODULE, replaceOnce('for (const x of due) end(x.activeEffectKey, "SUSTAIN_UNPAID", "sustain.unpaid"); break;', "break;"), golden("unpayable upkeep")],
  ["partial resources mutated by a failed upkeep", MODULE, both(
    replaceOnce("if (!mana) { resources = start; resourceChanges.length = changes; runtimeEvaluations.length = evals; return null; }", "if (!mana) { return null; }"),
    replaceOnce("resources = contexts0.value.resources; resourceChanges.length = 0; runtimeEvaluations.length = 0; // probes stage nothing", "// probes stage nothing"),
  ), golden("unpayable upkeep")],
  ["the engine auto-chooses which Sustained Effect survives", MODULE, replaceOnce('status = "PENDING_MAINTENANCE_SELECTION";', 'status = "APPLIED"; for (const x of due.slice(1)) end(x.activeEffectKey, "SUSTAIN_UNPAID", "auto"); break;'), golden("engine never chooses")],
  ["Timed Effects require Sustain", MODULE, replaceOnce("if (dur.futureRuntime.sustain) {", "if (dur.futureRuntime.persists) {"), golden("ROUNDS 3")],
  ["Timed Effects consume Concentration", MODULE, replaceOnce('const requiresConcentration = dur.futureRuntime.concentration === "WO13";', "const requiresConcentration = true;"), golden("ROUNDS 3")],
  ["Timed dismissal allowed universally", MODULE, replaceOnce('if (x.duration.dismissal !== "FREE_ACTION")', "if (false)"), golden("not dismissible early")],
  ["Instant Spell retained as an Active Effect", MODULE, replaceOnce('if (dur.mode === "INSTANT" || !dur.futureRuntime.persists) { status = "NO_ACTIVE_EFFECT"; noActiveEffectReason = "INSTANT"; break; }', ""), golden("an Instant Spell")],
  ["Mana Lock spends Current MP", MODULE, replaceOnce(RESERVE, `${RESERVE}\n        if (!payMana(key, "lock.mp", amount, false, cost.definition.canonicalKey)) break;`), golden("Max 40")],
  ["Mana Lock end refunds Current MP", MODULE, replaceOnce(RELEASE, `${RELEASE}\n    if (x.manaLock) { const rr = runtime({ kind: "RESOURCE_TRANSITIONS", subjectKey: "wo13.refund", transitions: [{ resourceKey: "MP", operation: "RESTORE", amount: x.manaLock.reservedMp, sourceKey: x.ability.canonicalKey }] }); if (rr) resources = rr.resources; }`), golden("Max 40")],
  ["Mana Lock not released when its exact Effect ends", MODULE, replaceOnce(RELEASE, ""), golden("locks stack")],
  ["Concentration slot capacity removed", MODULE, replaceOnce("if (requiresConcentration && consumers() >= slots)", "if (false)"), golden("beyond capacity")],
  ["Concentration slots derived from PRO instead of RES", MODULE, replaceOnce('formula("concentration_slots", policy.formulas.concentrationSlots, { res })', 'formula("concentration_slots", policy.formulas.concentrationSlots, { res: casterStats?.PRO as number })'), golden("slots")],
  ["Concentration DC progression altered (+2 for every consumer)", POLICY, replaceOnce('"8 + 2 * max(0, consumers - 1)"', '"8 + 2 * consumers"'), golden("DC = 8")],
  ["disrupted Effect removed before the DC is calculated", MODULE, replaceOnce("const n = consumers();", "const n = consumers() - 1;"), golden("only B ends")],
  ["every Concentration failure breaks all Concentration", MODULE, replaceOnce('if (scope === "ALL") {', "if (true) {"), golden("only B ends")],
  ["Channeling ignores Concentration", POLICY, replaceOnce("channel: { requiresConcentration: true,", "channel: { requiresConcentration: false,"), golden("5 AP Spell")],
  ["two simultaneous Channels allowed", MODULE, replaceOnce("if (channel && policy.channel.maximumSimultaneous <= 1)", "if (false)"), golden("only one Channel")],
  ["Channel AP progress kept after a failed Save", MODULE, replaceOnce("channel = null; // the Spell fails; every invested AP is lost; a new attempt starts from 0", 'channel = { ...channel!, status: "CHANNELING" };'), golden("6 AP Spell")],
  ["zero-AP round continues the Channel", MODULE, replaceOnce("if (channel.investedThisRound < policy.channel.minimumApPerRound) {", "if (false) {"), golden("only one Channel")],
  ["Channel completion delayed after the AP requirement is met", MODULE, replaceOnce("if (invested === channel.requiredAp) {", "if (false) {"), golden("5 AP Spell")],
  ["negative Channel investment allowed", MODULE, replaceOnce("if (amount < 1 || amount > remaining)", "if (amount > remaining)"), contract("negative / non-integer")],
  ["wall-clock expiration", MODULE, append("export const expiresAt = Date.now();"), STATIC],
  ["latest / current Definition lookup", MODULE, append("export const latestDuration = null;"), STATIC],
  ["held Sustain amount trusted (no M4 re-execution)", MODULE, replaceOnce('if (v !== x.sustain!.mpCost) p.add(', "if (false) p.add("), contract("an arbitrary Sustain MP")],
  ["cross-Ruleset Active Effect accepted", MODULE, replaceOnce('if (canonicalJsonOf(own(r, "rulesetProvenance")) !== canonicalJsonOf(bundle.rulesetProvenance)) { p.add(K.CROSS_RULESET, ["state", "rulesetProvenance"]', 'if (false) { p.add(K.CROSS_RULESET, ["state", "rulesetProvenance"]'), contract("R1 Active Effect state is refused")],
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
      assert.match(`${result.stdout}${result.stderr}`, /AssertionError|Error: transition failed|expected/, `control failed for infrastructure rather than behaviour: ${name}\n${result.stdout}${result.stderr}`);
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
console.log(`All ${controls.length} M5-WO13 mutation controls caught and reverted.`);
