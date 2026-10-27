/** Mutate real WO9 source, prove the permanent guard fails, restore exact bytes (shared harness: scripts/lib/control-harness.mjs). */
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), compiler = "packages/prowess-game/src/ability/compile.ts";
const guard = vitestGuard(root, "apps/studio", ["tests/unit/m5-wo9-static.test.ts"], { timeout: 180_000, ciEnv: false });
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
runControls({
  root,
  title: "M5-WO9",
  controls: controls.map(([name, file, mutate]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} WO9 source controls caught and restored.`,
});
