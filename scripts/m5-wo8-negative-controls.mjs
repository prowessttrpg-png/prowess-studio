/** Mutate real WO8 source, prove the permanent guard fails, restore exact bytes, prove it green. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), compiler = "packages/prowess-game/src/ability/compile.ts";
const guard = () => spawnSync(process.execPath, [resolve(root, "apps/studio/node_modules/vitest/vitest.mjs"), "run", "tests/unit/m5-wo8-static.test.ts"], { cwd: resolve(root, "apps/studio"), encoding: "utf8", timeout: 180_000 });
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
console.log(`All ${controls.length} WO8 source controls caught and restored.`);
