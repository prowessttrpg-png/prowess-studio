/** Mutate real WO9 source, prove the permanent guard fails, restore exact bytes, prove it green. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), compiler = "packages/prowess-game/src/ability/compile.ts";
const guard = () => spawnSync(process.execPath, [resolve(root, "apps/studio/node_modules/vitest/vitest.mjs"), "run", "tests/unit/m5-wo9-static.test.ts"], { cwd: resolve(root, "apps/studio"), encoding: "utf8", timeout: 180_000 });
const replace = (from, to) => text => { assert.equal(text.split(from).length, 2, `one exact mutation anchor: ${from}`); return text.replace(from, to); };
const content = "packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions.ts", grammar = "packages/prowess-game/src/definition/duration-condition-payload.ts", narrow = "packages/prowess-game/src/ability/duration-conditions.ts";
const controls = [
  ["remove flat 30 percent maximum", content, replace("spellMpPercentMaximum: 30", "spellMpPercentMaximum: 40")],
  ["restore rank-based caps", narrow, s => `${s}\nexport const rankCaps = [20, 30, 40];\n`],
  ["permit minus five AP", content, replace("maneuverApMaximum: 3", "maneuverApMaximum: 5")],
  ["disable cap Formula", content, replace("min(listed, maximum)", "listed")],
  ["mix Duration branches", grammar, replace('if (b !== branch) p.add(E, at, "Duration branch must match its permanent Definition kind")', 'if (b === branch) p.add(E, at, "Duration branch must match its permanent Definition kind")')],
  ["execute Sustain", narrow, s => `${s}\nexport function executeSustain() {}\n`],
  ["calculate final Spell cost", narrow, s => `${s}\nexport const finalSpellCost = 1;\n`],
  ["calculate final Maneuver cost", narrow, s => `${s}\nexport const finalManeuverCost = 1;\n`],
  ["merge Ability Conditions with Status Conditions", "packages/prowess-game/src/definition/payload.ts", replace("forbiddenKeyPaths(r, ABILITY_CONDITION_FORBIDDEN_KEYS", "forbiddenKeyPaths(r, []")],
  ["latest Duration lookup", narrow, s => `${s}\nexport const latestDuration = true;\n`],
  ["bypass exact Duration lookup", narrow, replace("findBundleDefinition(bundle, durationUse.definition)", "lookupUnpinnedDuration(bundle, durationUse.definition)")],
  ["bypass Ruleset isolation", compiler, replace("createProwessDefinitionBundle({ ruleset: context.value", "unsafeBundle({ ruleset: context.value")],
];
const originals = new Map();
try {
  let result = guard(); assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const [name, file, mutate] of controls) {
    const path = resolve(root, file), original = readFileSync(path, "utf8"); originals.set(path, original);
    try {
      writeFileSync(path, mutate(original)); result = guard();
      assert.notEqual(result.status, 0, `guard missed ${name}`); assert.match(`${result.stdout}${result.stderr}`, /AssertionError|expected|failed/i);
    } finally { writeFileSync(path, original); }
    assert.equal(readFileSync(path, "utf8"), original);
    result = guard(); assert.equal(result.status, 0, `restore failed: ${name}\n${result.stdout}\n${result.stderr}`);
    console.log(`Caught and restored: ${name}`);
  }
} finally { for (const [path, original] of originals) writeFileSync(path, original); }
console.log(`All ${controls.length} WO9 source controls caught and restored.`);
