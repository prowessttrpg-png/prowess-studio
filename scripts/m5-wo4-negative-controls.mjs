/**
 * M5-WO4 behavioural negative controls (PAS-10 M5-WO4 §243–§265). Each control temporarily mutates REAL source, the REAL
 * canonical content or the REAL conflict register on disk, runs the guard that must catch it, requires that guard to FAIL
 * for the right reason (an assertion, not infrastructure), and restores the file in a `finally`. Every file is verified
 * byte-identical afterwards and every guard is re-run green. Never commit a control.
 *
 * Run from the repository root after building workspace packages: node scripts/m5-wo4-negative-controls.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = (pkgDir, args) => vitestGuard(root, pkgDir, args, { timeout: 180_000 });
const golden = (pattern) => vitest("packages/prowess-game", ["src/affinity-golden.test.ts", "-t", pattern]);
const contracts = (pattern) => vitest("packages/prowess-game", ["src/affinity-contracts.test.ts", "-t", pattern]);
const staticWo4 = (pattern) => vitest("apps/studio", ["tests/unit/m5-wo4-static.test.ts", "-t", pattern]);
const runtimeGolden = (pattern) => vitest("packages/prowess-game", ["src/runtime-resources-golden.test.ts", "-t", pattern]);
const staticRulings = (pattern) => vitest("apps/studio", ["tests/unit/m5-canon-rulings-static.test.ts", "-t", pattern]);
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
const COST_STEP = "      const costStep = e.emit({";
const NET_STEP = "      const netStep = e.emit({";

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
      NET_STEP,
      `      for (const s of rules.strengths) netModifiers.push({ modifierKey: \`stack.\${s.rule.strengthKey}\`, targetKey: NET_PERCENT_TARGET, operation: "SUBTRACT", operand: rank.strengthDiscountPercent, phase: { phaseKey: "affinity.net_percent", phaseOrder: 1 }, priority: 0, order: 2, condition: s.condition, stacking: { policy: "STACK" }, source: null, provenance: null });\n${NET_STEP}`,
    ),
    guard: golden("§182"),
  },
  {
    name: "§247 Healing +30% and Buff +20% applied sequentially under one Affinity",
    file: COMPILE,
    mutate: replaceOnce(
      NET_STEP,
      `      for (const w of rules.weaknesses) netModifiers.push({ modifierKey: \`stack.\${w.rule.weaknessKey}\`, targetKey: NET_PERCENT_TARGET, operation: "ADD", operand: w.rule.activationPenaltyPercent, phase: { phaseKey: "affinity.net_percent", phaseOrder: 1 }, priority: 0, order: 2, condition: w.condition, stacking: { policy: "STACK" }, source: null, provenance: null });\n${NET_STEP}`,
    ),
    guard: golden("§184"),
  },
  {
    // Post-WO4 rulings batch (M5-SC-028): netting is now canonical; the superseded SEQUENTIAL model is the forbidden one.
    name: "§248 / M5-I155 Strength discount and Weakness penalty applied sequentially (−20% then +30% → 104) instead of netted (110)",
    file: COMPILE,
    mutate: (text) =>
      replaceOnce(
        'bindings: [fromFragment("/request/modifiers/0/operand", netStep, "/data/finalTargets/0/value")],',
        'bindings: [factsBinding("/request/facts/keywords"), ...(selection === null ? [] : [fromFragment("/request/modifiers/1/operand", selection, "/data/finalTargets/0/value")])],',
      )(
        replaceOnce(
          'modifiers: [scale(NET_MULTIPLIER, "MULTIPLY", FULL_PRICE_PERCENT, 1), scale(PERCENT_SCALE, "DIVIDE", FULL_PRICE_PERCENT, 2)],',
          'modifiers: [{ ...scale(STRENGTH_MODIFIER, "REDUCE_PERCENT", rank.strengthDiscountPercent, 1), condition: { kind: "ANY", children: strengthConditions, provenance: null } }, { ...scale(WEAKNESS_MODIFIER, "INCREASE_PERCENT", 0, 2), condition: { kind: "ANY", children: weaknessConditions, provenance: null } }],',
        )(text),
      ),
    guard: golden("§185 / M5-I155"),
  },
  {
    name: "§249 / M5-I155 the Weakness penalty subtracted from the net percentage instead of added",
    file: COMPILE,
    mutate: replaceOnce('          operation: "ADD",\n          operand: NO_WEAKNESS_PERCENT,', '          operation: "SUBTRACT",\n          operand: NO_WEAKNESS_PERCENT,'),
    guard: golden("§183"),
  },
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
      NET_STEP,
      `      for (const other of profile.affinities.filter((a) => a.affinity.entityId !== g.entry.ref.entityId)) {\n        const oe = findAffinityEntry(index, other.affinity);\n        if (oe !== null && oe.payload.strengths.length > 0) netModifiers.push({ modifierKey: \`stack.\${other.affinity.entityId}\`, targetKey: NET_PERCENT_TARGET, operation: "SUBTRACT", operand: rankEntry(index, other.rank).strengthDiscountPercent, phase: { phaseKey: "affinity.net_percent", phaseOrder: 1 }, priority: 0, order: 2, condition: { kind: "ANY", children: oe.payload.strengths.map((s) => e.ruleCondition(s.matchAny, oe.provenance, []) as JsonObject), provenance: null }, stacking: { policy: "STACK" }, source: null, provenance: null });\n      }\n${NET_STEP}`,
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
    // Post-WO4 canon rulings: the designer ruled TRAINED (M5-SC-035, M5-I151). Any other starting rank is now the guess.
    name: "§260 / M5-I151 Level 9 new Affinity starts at EXPERT, contrary to the M5-SC-035 ruling",
    file: AFFINITY,
    mutate: content((defs) => void (def(defs, (d) => d.definitionKind === "AFFINITY_PROGRESSION").payload.levels.find((l) => l.level === 9).options.find((o) => o.optionKey === "GAIN_NEW_AFFINITY").startingRank = "EXPERT")),
    guard: contracts("M5-I151 / M5-SC-035 ruling"),
  },
  {
    name: "M5-I151 Level 9 new Affinity reverted to unresolved after the designer ruled TRAINED",
    file: AFFINITY,
    mutate: content((defs) => {
      const gain = def(defs, (d) => d.definitionKind === "AFFINITY_PROGRESSION").payload.levels.find((l) => l.level === 9).options.find((o) => o.optionKey === "GAIN_NEW_AFFINITY");
      gain.startingRank = null;
      gain.conflictKey = "M5-SC-035";
    }),
    guard: contracts("M5-I151 / M5-SC-035 ruling"),
  },
  {
    name: "M5-I154 Large Base Movement drifts from 10 ft to 20 ft",
    file: RUNTIME,
    mutate: content((defs) => void (def(defs, (d) => d.payload.sizeKey === "LARGE").payload.baseMovement = { feet: 20 })),
    guard: runtimeGolden("M5-I154 designer rulings"),
  },
  {
    name: "M5-I154 / M5-SC-036 Huge Base Movement reverts to the superseded 15 ft",
    file: RUNTIME,
    mutate: content((defs) => void (def(defs, (d) => d.payload.sizeKey === "HUGE").payload.baseMovement = { feet: 15 })),
    guard: runtimeGolden("M5-I154 designer rulings"),
  },
  {
    name: "M5-I154 / M5-SC-036 Massive Base Movement drifts from 40 ft to 20 ft",
    file: RUNTIME,
    mutate: content((defs) => void (def(defs, (d) => d.payload.sizeKey === "MASSIVE").payload.baseMovement = { feet: 20 })),
    guard: runtimeGolden("M5-I154 designer rulings"),
  },
  {
    name: "M5-I154 the compiler ignores the character's Size (every creature reads Medium)",
    file: G("core/compile.ts"),
    mutate: replaceOnce("            const size = this.character.creatureSize;\n", '            const size = "MEDIUM" as const;\n'),
    guard: runtimeGolden("M5-I154 designer rulings"),
  },
  {
    name: "M5-I154 the compiler guesses a value for an unauthored (null) Size instead of failing closed",
    file: G("core/compile.ts"),
    mutate: replaceOnce(
      "            if (entry.payload.baseMovement === null) {\n",
      "            if (entry.payload.baseMovement === null) {\n              literals[variable] = 20;\n              break;\n",
    ),
    guard: runtimeGolden("M5-I154 a Size whose Base Movement is unauthored"),
  },
  {
    name: "M5-I153 Arcane Rank reverted to UNRESOLVED after the M5-SC-011 ruling",
    file: G("vocabulary/terminology.ts"),
    mutate: replaceOnce('entry("Arcane Rank", "SKILL_RANK", C, "SKILL", "ARCANE_RANK", { ...designer, conflictKey: "M5-SC-011" })', 'entry("Arcane Rank", "SKILL_RANK", "UNRESOLVED", "SPELL", null, { authority: "SOURCE_AUDIT", conflictKey: "M5-SC-011" })'),
    guard: vitest("packages/prowess-game", ["src/vocabulary.test.ts", "-t", "M5-I153"]),
  },
  {
    name: "M5-I153 Arcana Rank treated as a separate canonical track",
    file: G("vocabulary/terminology.ts"),
    mutate: replaceOnce('entry("Arcana Rank", "SKILL_RANK", L, "SKILL", null, { ...designer, canonicalTerm: "Arcane Rank", conflictKey: "M5-SC-011" })', 'entry("Arcana Rank", "SKILL_RANK", C, "SKILL", "ARCANA_RANK", { ...designer, conflictKey: "M5-SC-011" })'),
    guard: staticRulings("M5-I153"),
  },
  {
    name: "M5-SC-038 (Active Effects / Concentration) restored to UNRESOLVED after the follow-up ruling",
    file: REGISTER,
    mutate: (text) => {
      const at = text.indexOf("### M5-SC-038 ");
      return text.slice(0, at) + text.slice(at).replace("- **status**: `RESOLVED_BY_DESIGNER`", "- **status**: `UNRESOLVED`");
    },
    guard: staticRulings("nothing is open"),
  },
  {
    name: "M5-SC-007 restored to UNRESOLVED after the rulings batch",
    file: REGISTER,
    mutate: (text) => {
      const at = text.indexOf("### M5-SC-007 ");
      const head = text.slice(0, at);
      const rest = text.slice(at).replace("- **status**: `RESOLVED_BY_DESIGNER`", "- **status**: `UNRESOLVED`");
      return head + rest;
    },
    guard: staticRulings("rulings batch: every conflict open after M5-WO4"),
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

runControls({
  root,
  title: "M5-WO4",
  controls: controls,
  expect: /AssertionError|Error: compile failed|Error: reading failed|Error: steps failed|Error: \[|expected/,
  caught: (name) => `Negative control caught: ${name}`,
  done: (count) => `All ${count} M5-WO4 negative controls caught and reverted.`,
});
