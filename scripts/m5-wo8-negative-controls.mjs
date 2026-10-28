/** Mutate real WO8 source, prove the permanent guard fails, restore exact bytes (shared harness: scripts/lib/control-harness.mjs). */
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), compiler = "packages/prowess-game/src/ability/compile.ts";
const guard = vitestGuard(root, "apps/studio", ["tests/unit/m5-wo8-static.test.ts"], { timeout: 180_000, ciEnv: false });
const replace = (from, to) => text => { assert.equal(text.split(from).length, 2, `one exact mutation anchor: ${from}`); return text.replace(from, to); };
const controls = [
  ["parallel requirement evaluator", compiler, text => `${text}\nfunction evaluateRequirement() { return true; }\n`],
  ["DB coupling", compiler, text => `${text}\nimport { prisma } from '@prowess/db';\n`],
  ["newest Trait fallback", compiler, text => `${text}\nexport const latestTrait = true;\n`],
  ["runtime damage", compiler, text => `${text}\nexport const applyDamage = true;\n`],
  ["construction bypass", compiler, replace("const construction = compileAbilityConstruction(", "const construction = bypassConstruction(")],
  ["Weakness grants access", compiler, replace(".strengths.flatMap", ".weaknesses.flatMap")],
  ["missing committed action checks", compiler, replace("actionConstruction.push(checked.value)", "ignored.push(checked.value)")],
  ["Trait adds undeclared Effect", "packages/prowess-game/src/definition/trait-payload.ts", replace('["DAMAGE_TYPE", "TARGETING_MEASURE", "RESOLUTION", "TRIGGER", "COST"]', '["DAMAGE_TYPE", "TARGETING_MEASURE", "RESOLUTION", "TRIGGER", "COST", "DAMAGE"]')],
];
runControls({
  root,
  title: "M5-WO8",
  controls: controls.map(([name, file, mutate]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} WO8 source controls caught and restored.`,
});
