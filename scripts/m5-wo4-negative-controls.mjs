/**
 * M5-WO4 behavioural negative controls (PAS-10 M5-WO4 §243–§265). Each control temporarily mutates REAL source, the REAL
 * canonical content or the REAL conflict register on disk, runs the guard that must catch it, requires that guard to FAIL
 * for the right reason (an assertion, not infrastructure), and restores the file in a `finally`. Every file is verified
 * byte-identical afterwards and every guard is re-run green. Never commit a control.
 *
 * Run from the repository root after building workspace packages: node scripts/m5-wo4-negative-controls.mjs
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
const golden = (pattern) => vitest("packages/prowess-game", ["src/affinity-golden.test.ts", "-t", pattern]);
const contracts = (pattern) => vitest("packages/prowess-game", ["src/affinity-contracts.test.ts", "-t", pattern]);
const staticWo4 = (pattern) => vitest("apps/studio", ["tests/unit/m5-wo4-static.test.ts", "-t", pattern]);
const sourceRules = (file) => staticWo4(`packages/prowess-game/src/${file} passes the WO4`);
const CONTENT_RULES = "content passes every WO4 rule";

const G = (f) => `packages/prowess-game/src/${f}`;
const COMPILE = G("affinity/compile.ts");
const AFFINITY = G("content/core-playtest-v0.1/affinity.json");
const CORE = G("content/core-playtest-v0.1/core-resolution.json");
const RUNTIME = G("content/core-playtest-v0.1/runtime-resources.json");
const REGISTER = "docs/architecture/m5-core-playtest-source-conflicts.md";
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
};
/** Mutates a canonical content JSON structurally (parsed, edited, re-serialized in the file's own format). */
const content = (edit) => (text) => {
  const doc = JSON.parse(text);
  edit(doc.definitions, doc);
  return `${JSON.stringify(doc, null, 2)}\n`;
};
const def = (defs, predicate) => {
  const found = defs.filter(predicate);
  assert.equal(found.length, 1, "content anchor must match exactly one Definition");
  return found[0];
};
const affinity = (token) => (d) => d.definitionKind === "AFFINITY" && d.payload.affinity === token;
const STRENGTH_IF = "      if (strengthConditions.length > 0) {\n        modifiers.push({";
const COST_STEP = "      const costStep = e.emit({";

const controls = [
  {
    name: "§243 canonical affinity.emission Definition",
    file: AFFINITY,
    mutate: content((defs) => void defs.push({ ...def(defs, affinity("EVOCATION")), canonicalKey: "affinity.emission", payload: { ...def(defs, affinity("EVOCATION")).payload, affinity: "EMISSION" } })),
    guard: staticWo4(CONTENT_RULES),
  },
  { name: "§244 `if affinity === \"EVOCATION\"` mechanics in the compiler", file: COMPILE, mutate: append('export const evocationBonus = (affinity: string): number => (affinity === "EVOCATION" ? 10 : 0);'), guard: sourceRules("affinity/compile.ts") },
  {
    name: "§245 \"direct damage\" matched to DIRECT_DAMAGE by display-text comparison",
    file: G("affinity/definitions.ts"),
    mutate: replaceOnce(
      "return catalog.references.find((r) => r.canonicalKey === canonicalKey) ?? null;",
      'return catalog.references.find((r) => r.canonicalKey.replace(/_/g, " ").toLowerCase() === canonicalKey.replace(/_lookalike$/, "").replace(/_/g, " ").toLowerCase()) ?? null;',
    ),
    guard: golden("§191"),
  },
  {
    name: "§246 Expert −20% applied once for DIRECT_DAMAGE and again for AREA_EFFECT",
    file: COMPILE,
    mutate: replaceOnce(
      COST_STEP,
      `      for (const s of rules.strengths) modifiers.splice(1, 0, { modifierKey: \`stack.\${s.rule.strengthKey}\`, targetKey, operation: "REDUCE_PERCENT", operand: rank.strengthDiscountPercent, phase: { phaseKey: "affinity.strength", phaseOrder: 1 }, priority: 0, order: 1, condition: s.condition, stacking: { policy: "STACK" }, source: null, provenance: null });\n${COST_STEP}`,
    ),
    guard: golden("§182"),
  },
  {
    name: "§247 Healing +30% and Buff +20% applied sequentially under one Affinity",
    file: COMPILE,
    mutate: replaceOnce(
      COST_STEP,
      `      for (const w of rules.weaknesses) modifiers.push({ modifierKey: \`stack.\${w.rule.weaknessKey}\`, targetKey, operation: "INCREASE_PERCENT", operand: w.rule.activationPenaltyPercent, phase: { phaseKey: "affinity.weakness", phaseOrder: 2 }, priority: 0, order: 1, condition: w.condition, stacking: { policy: "STACK" }, source: null, provenance: null });\n${COST_STEP}`,
    ),
    guard: golden("§184"),
  },
  {
    name: "§248 Strength −20 and Weakness +30 netted to +10",
    file: COMPILE,
    mutate: (text) =>
      replaceOnce(
        "              })),\n              facts,",
        '              })).concat(rules.strengths.length === 0 ? [] : [{ modifierKey: "net.strength", targetKey: WEAKNESS_TARGET, operation: "ADD", operand: -rankEntry(index, g.owned.rank).strengthDiscountPercent, phase: { phaseKey: "affinity.weakness_selection", phaseOrder: 2 }, priority: 0, order: 0, condition: { kind: "ANY", children: rules.strengths.map((s) => s.condition), provenance: null }, stacking: { policy: "STACK" }, source: null, provenance: null }]),\n              facts,',
      )(replaceOnce(STRENGTH_IF, "      if (strengthConditions.length < 0) {\n        modifiers.push({")(text)),
    guard: golden("§185"),
  },
  { name: "§249 Weakness applied before Strength", file: COMPILE, mutate: replaceOnce('phase: { phaseKey: "affinity.strength", phaseOrder: 1 },', 'phase: { phaseKey: "affinity.strength", phaseOrder: 3 },'), guard: golden("§185") },
  {
    name: "§250 17 − 10% rounded inside Affinity evaluation",
    file: G("affinity/results.ts"),
    mutate: replaceOnce('affinityAdjustedCost: own(target, "value") as number };', 'affinityAdjustedCost: Math.round(own(target, "value") as number) };'),
    guard: golden("§186"),
  },
  {
    name: "§251 Level 1 rank NONE given a 10% Strength discount",
    file: AFFINITY,
    mutate: content((defs) => void (def(defs, (d) => d.definitionKind === "AFFINITY_RANK_RULE").payload.ranks[0].strengthDiscountPercent = 10)),
    guard: golden("§188"),
  },
  {
    name: "§252 any Weakness-aligned Spell marked structurally invalid",
    file: G("affinity/results.ts"),
    mutate: replaceOnce("      issues: [],", '      issues: anyWeakness ? ["WEAKNESS_PROHIBITS_CONSTRUCTION"] : [],'),
    guard: golden("§101 / §130"),
  },
  {
    name: "§253 highest-rank owned Affinity selected automatically",
    file: COMPILE,
    mutate: replaceOnce("  const ref = composition.affinity.definition;", "  const ref = [...profile.affinities].sort((a, b) => b.rank.localeCompare(a.rank))[0]!.affinity;"),
    guard: contracts("M5-I133"),
  },
  {
    name: "§254 discounts stacked from two owned Affinities",
    file: COMPILE,
    mutate: replaceOnce(
      COST_STEP,
      `      for (const other of profile.affinities.filter((a) => a.affinity.entityId !== g.entry.ref.entityId)) {\n        const oe = findAffinityEntry(index, other.affinity);\n        if (oe !== null && oe.payload.strengths.length > 0) modifiers.splice(1, 0, { modifierKey: \`stack.\${other.affinity.entityId}\`, targetKey, operation: "REDUCE_PERCENT", operand: rankEntry(index, other.rank).strengthDiscountPercent, phase: { phaseKey: "affinity.strength", phaseOrder: 1 }, priority: 0, order: 1, condition: { kind: "ANY", children: oe.payload.strengths.map((s) => e.ruleCondition(s.matchAny, oe.provenance, []) as JsonObject), provenance: null }, stacking: { policy: "STACK" }, source: null, provenance: null });\n      }\n${COST_STEP}`,
    ),
    guard: contracts("M5-I134"),
  },
  {
    name: "§255 Arcane Effect capacity added to Affinity Effect capacity",
    file: COMPILE,
    mutate: replaceOnce(
      'capacityStep("authority.effect_capacity", EFFECT_COUNT_FACT, effectCount, rank.authority.effectCapacity, ',
      'capacityStep("authority.effect_capacity", EFFECT_COUNT_FACT, effectCount, rank.authority.effectCapacity + (own(composition.authority ?? {}, "arcanaRank") === undefined ? 0 : rank.authority.effectCapacity), ',
    ),
    guard: golden("§194"),
  },
  { name: "§256 Affinity-qualified Trait made free", file: COMPILE, mutate: append("export const qualifiedTrait = { traitCost: 0 };"), guard: sourceRules("affinity/compile.ts") },
  { name: "§257 Spell AP reduced directly because of an Affinity Strength", file: COMPILE, mutate: append("export const spellApDiscount = (spellAp: number): number => spellAp - 1;"), guard: sourceRules("affinity/compile.ts") },
  {
    name: "§258 ME combined into the Affinity cost modifier",
    file: COMPILE,
    mutate: replaceOnce('sourceType: "prowess.affinity_rank_rule"', 'sourceType: "prowess.mana_efficiency"'),
    guard: contracts("M5-I148 / M5-I149"),
  },
  {
    name: "§259 Spell −20% MP Affinity path applied to a Maneuver",
    file: COMPILE,
    mutate: replaceOnce('if (subject.kind === "SPELL_AFFINITY_COST" && composition.abilityKind !== "SPELL") {', "if (false) {"),
    guard: contracts("M5-I144"),
  },
  {
    name: "§260 Level 9 new Affinity assigned TRAINED without canon",
    file: AFFINITY,
    mutate: content((defs) => {
      const gain = def(defs, (d) => d.definitionKind === "AFFINITY_PROGRESSION").payload.levels.find((l) => l.level === 9).options.find((o) => o.optionKey === "GAIN_NEW_AFFINITY");
      gain.startingRank = "TRAINED";
      gain.conflictKey = null;
    }),
    guard: contracts("M5-SC-035"),
  },
  {
    name: "§261 Divination Persistent Effects +15% coerced to Moderate +20%",
    file: AFFINITY,
    mutate: content((defs) => {
      const w = def(defs, affinity("DIVINATION")).payload.weaknesses.find((x) => x.weaknessKey === "PERSISTENT_EFFECT");
      w.activationPenaltyPercent = 20;
      w.severity = "MODERATE";
    }),
    guard: golden("§187"),
  },
  {
    name: "§262 any Radius Targeting counted as an Evocation Area Strength",
    file: COMPILE,
    mutate: replaceOnce(
      "      const keywords = (envelope.payload as { keywords?: readonly string[] }).keywords ?? [];",
      '      const keywords = [...((envelope.payload as { keywords?: readonly string[] }).keywords ?? []), ...((envelope.payload as { semanticShape?: string }).semanticShape === "RADIUS" ? ["keyword.area_effect"] : [])];',
    ),
    guard: golden("§63–§64"),
  },
  { name: "§263 governing Affinity resolved by newest EntityVersion", file: G("affinity/definitions.ts"), mutate: append("export const pickGoverning = (defs: { canonicalKey: string }[]) => findNewestAffinityDefinition(defs);"), guard: sourceRules("affinity/definitions.ts") },
  {
    name: "§264 Base Movement = 5 × AGI reintroduced as the canonical semantic model",
    file: CORE,
    mutate: content((defs) => {
      const f = def(defs, (d) => d.payload.statistic === "BASE_MOVEMENT").payload.formula;
      f.expression = "5 * agi";
      f.variables = [{ variable: "agi", source: { kind: "STAT", stat: "AGI" } }];
    }),
    guard: golden("§175"),
  },
  {
    name: "§265 Sprint requires a distinct totalMovement statistic",
    file: RUNTIME,
    mutate: content((defs) => {
      const g = def(defs, (d) => d.payload.actionKey === "SPRINT").payload.movementGrant.formula;
      g.expression = "total_movement * 4";
      g.variables = [{ variable: "total_movement", source: { kind: "DERIVED", statistic: "TOTAL_MOVEMENT" } }];
    }),
    guard: golden("§176"),
  },
  {
    name: "M5-SC-034 restored to UNRESOLVED while Sprint = Movement × 4 is executable",
    file: REGISTER,
    mutate: replaceOnce("- **status**: `RESOLVED_BY_DESIGNER`\n- **resolution authority**: M5-WO4 §12–§14 (designer ruling, applied post-WO3)", "- **status**: `UNRESOLVED`\n- **resolution authority**: none"),
    guard: staticWo4("source-conflict register: M5-SC-034"),
  },
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
      assert.match(`${result.stdout}${result.stderr}`, /AssertionError|Error: compile failed|Error: reading failed|Error: steps failed|Error: \[|expected/, `control failed for infrastructure rather than behaviour: ${control.name}\n${result.stdout}${result.stderr}`);
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
console.log(`All ${controls.length} M5-WO4 negative controls caught and reverted.`);
