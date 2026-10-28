/**
 * M5-WO7 behavioural negative controls. Each control mutates real branch source/content, requires a WO7 guard to fail,
 * restores the original bytes in finally (shared harness, scripts/lib/control-harness.mjs). Never commit a mutated control state.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = (pkgDir, args) => vitestGuard(root, pkgDir, args, { timeout: 180_000 });
const STATIC = vitest("apps/studio", ["tests/unit/m5-wo7-static.test.ts"]);
const GOLDEN = vitest("packages/prowess-game", ["src/effect-golden.test.ts", "src/effect-contracts.test.ts"]);
const SECURITY = vitest("packages/prowess-game", ["src/effect-security.test.ts"]);
const T = "packages/prowess-game/src/content/core-playtest-v0.1/targeting-wo7-amendments.ts";
const E = "packages/prowess-game/src/content/core-playtest-v0.1/effects.ts";
const V = "packages/prowess-game/src/vocabulary/effect.ts";
const C = "packages/prowess-game/src/effect/compile.ts";
const H = "packages/prowess-game/src/content/core-playtest-v0.1/targeting.json";

const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
};
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const mutateJson = (mutator) => (text) => {
  const value = JSON.parse(text);
  mutator(value);
  return `${JSON.stringify(value, null, 2)}\n`;
};
const PROJECTILE_BASE = '{ contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE", amount: 3 } }';

const controls = [
  { name: "§192 Projectile returned to DEFERRED_PENDING_CANON", file: T, mutate: replaceOnce(PROJECTILE_BASE, '{ contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE_DEFERRED", conflictKey: "M5-SC-039" } }'), guard: STATIC },
  { name: "§193 Projectile wrong base cost = 2 MP", file: T, mutate: replaceOnce(PROJECTILE_BASE, '{ contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE", amount: 2 } }'), guard: STATIC },
  { name: "§194 Projectile Save Effect skips delivery", file: C, mutate: append('export const skipProjectileDelivery = true;'), guard: STATIC },
  { name: "§195 Projectile Attack Effect double-rolls", file: C, mutate: append('export const projectileDoubleAttack = true;'), guard: STATIC },
  { name: "§196 old Spell Line length 15×PRO restored", file: T, mutate: replaceOnce('expression: "10 * pro + length_extension * 10"', 'expression: "15 * pro + length_extension * 10"'), guard: STATIC },
  { name: "§197 Spell Line width returned to deferred", file: T, mutate: append('export const lineWidthStatus = "DEFERRED_PENDING_CANON";'), guard: STATIC },
  { name: "§198 Spell Line width uses floor", file: T, mutate: replaceOnce('5 * ceil(pro / 2) + width_extension * 5', '5 * floor(pro / 2) + width_extension * 5'), guard: STATIC },
  { name: "§199 Targeting chooses AGI Save", file: T, mutate: append('export const projectileSaveProfile = { validSaves: ["AGI"] };'), guard: STATIC },
  { name: "§200 MOVEMENT promoted to top-level Spell Effect family", file: V, mutate: replaceOnce('  "SUMMONING",\n] as const', '  "SUMMONING",\n  "MOVEMENT",\n] as const'), guard: STATIC },
  { name: "§201 CLEANSE promoted to top-level Spell Effect family", file: V, mutate: replaceOnce('  "SUMMONING",\n] as const', '  "SUMMONING",\n  "CLEANSE",\n] as const'), guard: STATIC },
  { name: "§202 SPELL_INTERFERENCE promoted to top-level family", file: V, mutate: replaceOnce('  "SUMMONING",\n] as const', '  "SUMMONING",\n  "SPELL_INTERFERENCE",\n] as const'), guard: STATIC },
  { name: "§203 executable Spell Effect uses null resolution", file: E, mutate: replaceOnce('spell("spell.effect.direct_damage", "DAMAGE", { mode: "ATTACK_ROLL", data: {} }', 'spell("spell.effect.direct_damage", "DAMAGE", null'), guard: STATIC },
  { name: "§204 missing Maneuver resolution implicitly inherits", file: C, mutate: append('export const implicitManeuverInheritance = true;'), guard: STATIC },
  { name: "§205 fuzzy Effect Targeting compatibility", file: C, mutate: append('export const fuzzyTargetingCompatibility = (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase());'), guard: STATIC },
  { name: "§206 Character Dice cap made global across Spell", file: C, mutate: append('export const globalCharacterDiceCap = true;'), guard: STATIC },
  { name: "§207 Fire Damage implicitly applies Burning", file: C, mutate: append('export const damageImpliesBurning = true;'), guard: STATIC },
  { name: "§208 Lightning conversion implicitly applies Shocked", file: E, mutate: replaceOnce('DAMAGE_TYPE_ONLY_NO_IMPLICIT_CONDITION', 'DAMAGE_TYPE_ONLY_NO_IMPLICIT_CONDITION", "Shocked'), guard: STATIC },
  { name: "§209 Targeting duplicates Radius Conversion +3 AP", file: H, mutate: mutateJson((catalog) => { const radius = catalog.definitions.find((d) => d.canonicalKey === "maneuver.targeting.radius"); radius.payload.costContributions = [{ contributionKey: "conversion.radius", currency: "AP", data: { kind: "BASE", amount: 3 } }]; }), guard: STATIC },
  { name: "§210 Targeting duplicates Radius Conversion Save Profile", file: H, mutate: mutateJson((catalog) => { const radius = catalog.definitions.find((d) => d.canonicalKey === "maneuver.targeting.radius"); radius.payload.rules.targeting.saveProfile = { validSaves: ["AGI", "PRO"] }; }), guard: STATIC },
  { name: "§211 WO7 calculates final Ability cost", file: C, mutate: append('export const finalSpellCost = 0; export const finalManeuverCost = 0;'), guard: STATIC },
  { name: "§212 WO7 mutates runtime HP", file: C, mutate: append('export const runtimeHpMutation = true;'), guard: STATIC },
  { name: "§213 Effect resolves through latest version", file: C, mutate: append('export const latestEffect = true;'), guard: STATIC },
];

runControls({
  root,
  title: "M5-WO7",
  controls,
  expect: /AssertionError|expected|failed|Error:/i,
  emptyBaseline: /No test files found|\b0 passed/i,
  caught: (name) => `Negative control caught: ${name}`,
  done: (count) => `All ${count} M5-WO7 source/content negative controls caught and reverted.`,
  // Behavioural parser/evaluator security suite is itself a negative-control surface for malformed runtime data.
  after: () => {
    assert.equal(SECURITY().status, 0, "WO7 security controls must remain green");
    assert.equal(GOLDEN().status, 0, "WO7 golden/contract suite must remain green after all controls restore");
  },
});
