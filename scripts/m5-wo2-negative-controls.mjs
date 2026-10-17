/**
 * M5-WO2 behavioural negative controls (PAS-10 M5-WO2 §183–200). Each control temporarily mutates REAL source or the
 * REAL canonical core content on disk, runs the guard that must catch it, requires that guard to FAIL for the right
 * reason (an assertion, not infrastructure), and restores the file in a `finally`. Every file is verified
 * byte-identical afterwards and every guard is re-run green. Never commit a control.
 *
 * Run from the repository root after building workspace packages: node scripts/m5-wo2-negative-controls.mjs
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
const golden = (pattern) => vitest("packages/prowess-game", ["src/core-resolution-golden.test.ts", "-t", pattern]);
const contracts = (pattern) => vitest("packages/prowess-game", ["src/core-contracts.test.ts", "-t", pattern]);
const staticWo2 = (pattern) => vitest("apps/studio", ["tests/unit/m5-wo2-static.test.ts", "-t", pattern]);

const G = (f) => `packages/prowess-game/src/${f}`;
const CONTENT = G("content/core-playtest-v0.1/core-resolution.json");
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
};
/** Mutates the canonical content JSON structurally (parsed, edited, re-serialized in the file's own format). */
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
const statistic = (name) => (d) => d.definitionKind === "DERIVED_STAT" && d.payload.statistic === name;
const procedure = (name) => (d) => d.definitionKind === "CORE_RESOLUTION" && d.payload.procedure === name;

const controls = [
  {
    name: "§183 canonical PLAYER_DIE progression beside CHARACTER_DIE",
    file: CONTENT,
    mutate: content((defs) => defs.push({ ...structuredClone(def(defs, (d) => d.definitionKind === "CHARACTER_DIE_PROGRESSION")), canonicalKey: "core.player_die.progression" })),
    guard: staticWo2("canonical core content passes"),
  },
  { name: "§184 Math.random() in core roll evaluation", file: G("core/dice.ts"), mutate: append("export const rollNatural = (faces: number) => Math.floor(Math.random() * faces) + 1;"), guard: staticWo2("core/dice.ts passes") },
  { name: "§185 natural + PER + accuracy calculated in compiler TypeScript", file: G("core/compile.ts"), mutate: append("export const attackTotal = (natural: number, per: number, accuracy: number) => natural + per + accuracy;"), guard: staticWo2("core/compile.ts passes") },
  {
    name: "§186 Attack Roll compiled without Prowess Accuracy",
    file: CONTENT,
    mutate: content((defs) => {
      const total = def(defs, procedure("ATTACK_ROLL")).payload.total;
      total.expression = "natural + per + bonuses";
      total.variables = total.variables.filter((v) => v.variable !== "accuracy");
    }),
    guard: golden("§129"),
  },
  {
    name: "§187 PER + floor(PRO/3) pre-added into one opaque term",
    file: CONTENT,
    mutate: content((defs) => {
      const total = def(defs, procedure("ATTACK_ROLL")).payload.total;
      total.expression = "natural + per_with_accuracy + bonuses";
      total.variables = [...total.variables.filter((v) => !["per", "accuracy"].includes(v.variable)), { variable: "per_with_accuracy", source: { kind: "STAT", stat: "PER" } }];
    }),
    guard: contracts("one source-map entry per step"),
  },
  {
    name: "§188 separate canonical Evasion and Dodge values",
    file: CONTENT,
    mutate: content((defs) => {
      const dodge = structuredClone(def(defs, statistic("DODGE")));
      defs.push({ ...dodge, canonicalKey: "core.derived.evasion", payload: { ...dodge.payload, statistic: "EVASION" } });
    }),
    guard: staticWo2("canonical core content passes"),
  },
  {
    name: "§189 floor(PER/3) removed from canonical Dodge",
    file: CONTENT,
    mutate: content((defs) => {
      const f = def(defs, statistic("DODGE")).payload.formula;
      f.expression = "half_character_die + agi + bonuses";
      f.variables = f.variables.filter((v) => v.variable !== "perception_bonus");
    }),
    guard: golden("§126"),
  },
  {
    name: "§190 Resolve threshold removed from Character DC",
    file: CONTENT,
    mutate: content((defs) => {
      const f = def(defs, statistic("CHARACTER_DC")).payload.formula;
      f.expression = "half_character_die + pro + bonuses";
      f.variables = f.variables.filter((v) => v.variable !== "resolve_bonus");
    }),
    guard: golden("§127"),
  },
  { name: "§191 HP = BaseHP × CON", file: CONTENT, mutate: content((defs) => void (def(defs, statistic("MAXIMUM_HP")).payload.formula.expression = "base_hp * con")), guard: golden("§125") },
  { name: "§192 MP = BaseMP × RES", file: CONTENT, mutate: content((defs) => void (def(defs, statistic("MAXIMUM_MP")).payload.formula.expression = "base_mp * res")), guard: golden("§125") },
  {
    name: "§193 Advantage as max(roll1 + bonuses, roll2 + bonuses)",
    file: CONTENT,
    mutate: content((defs) => void (def(defs, procedure("ATTACK_ROLL")).payload.naturalSelection.ADVANTAGE = { expression: "max(r1 + bonuses, r2 + bonuses)" })),
    guard: golden("§131"),
  },
  {
    name: "§194 discarded Advantage / Disadvantage die read as the Critical natural",
    file: G("core/compile.ts"),
    mutate: replaceOnce('bindings: [fromContext("/requirement/expected", "ACTOR", faces), fromFragment("/facts/numeric/0/value", natural)],', 'bindings: [fromContext("/requirement/expected", "ACTOR", faces), fromContext("/facts/numeric/0/value", "RUNTIME", pointer("state", ROLL_STATE_KEYS.r1))],'),
    guard: golden("criticals use the SELECTED natural"),
  },
  {
    name: "§195 a maximum natural hits regardless of Dodge",
    file: G("core/compile.ts"),
    mutate: replaceOnce('requirement: { kind: "ALL", children: [compare(FACT.NATURAL', 'requirement: { kind: "ANY", children: [compare(FACT.NATURAL'),
    guard: golden("§130 control"),
  },
  { name: "§196 Athletics → STR as the only Skill Check Stat", file: G("core/compile.ts"), mutate: replaceOnce("  const stat = subject.stat ?? null;", '  const stat = payload.requiresSkill ? ("STR" as ProwessStat) : (subject.stat ?? null);'), guard: golden("chosen by the approach") },
  {
    name: "§197 TRAINED=1 / EXPERT=2 / MASTER=3 as Skill bonuses",
    file: CONTENT,
    mutate: content((defs) => def(defs, (d) => d.definitionKind === "SKILL_RANK").payload.entries.forEach((e, i) => (e.bonus = i))),
    guard: golden("UNTRAINED \\+0 · TRAINED \\+2"),
  },
  {
    name: "§198 Movement = 5 × AGI as executable canonical WO2 math",
    file: CONTENT,
    mutate: content((defs) =>
      defs.push({ canonicalKey: "core.derived.base_movement", definitionKind: "DERIVED_STAT", payload: { statistic: "BASE_MOVEMENT", formula: { expression: "5 * agi", rounding: "NONE", variables: [{ variable: "agi", source: { kind: "STAT", stat: "AGI" } }] }, bonusTarget: null, source: { locators: ["s23"], conflicts: ["M5-SC-006"] } } }),
    ),
    guard: staticWo2("canonical core content passes"),
  },
  { name: "§199 listedMpAfterMe = listedMp - ME", file: G("core/compile.ts"), mutate: append("export const listedMpAfterMe = (listedMp: number, me: number) => listedMp - me;"), guard: staticWo2("core/compile.ts passes") },
  { name: "§200 Radius Targeting selects an AGI Save", file: G("definition/payload.ts"), mutate: replaceOnce('  "save",\n  "saves",\n  "saveStat",\n', ""), guard: contracts("M5-I061 Targeting never selects a Saving Throw") },
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
      assert.match(`${result.stdout}${result.stderr}`, /AssertionError|Error: compile failed|Error: \[|expected/, `control failed for infrastructure rather than behaviour: ${control.name}\n${result.stdout}${result.stderr}`);
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
console.log(`All ${controls.length} M5-WO2 negative controls caught and reverted.`);
