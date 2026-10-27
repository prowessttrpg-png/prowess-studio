/**
 * M5-WO6 behavioural negative controls (PAS-10 M5-WO6 §174–§189). Each control temporarily mutates REAL source, the REAL
 * canonical Targeting content or REAL Studio code on disk, runs the guard that must catch it, requires that guard to FAIL
 * for the right reason (an assertion, not infrastructure), and restores the file in a `finally`. Every file is verified
 * byte-identical afterwards and every guard is re-run green. Never commit a control.
 *
 * Run from the repository root after building workspace packages: node scripts/m5-wo6-negative-controls.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = (pkgDir, args) => vitestGuard(root, pkgDir, args, { timeout: 180_000 });
const golden = (pattern) => vitest("packages/prowess-game", ["src/targeting-golden.test.ts", "-t", pattern]);
const staticWo6 = (pattern) => vitest("apps/studio", ["tests/unit/m5-wo6-static.test.ts", "-t", pattern]);
const COMPILE_RULES = staticWo6("targeting/compile.ts passes the WO6 rules");
const CONTENT_RULES = staticWo6("canonical Targeting content passes every WO6 rule");
const UI_RULES = staticWo6("Studio UI code computes no Targeting geometry");

const G = (f) => `packages/prowess-game/src/${f}`;
const COMPILE = G("targeting/compile.ts");
const CONTENT = G("content/core-playtest-v0.1/targeting.json");
const COMPOSITION = G("construction/composition.ts");
const UI = "apps/studio/src/navigation.ts";
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
};
/** Mutates the canonical Targeting content structurally (parsed, edited, re-serialized in the file's own format). */
const content = (edit) => (text) => {
  const doc = JSON.parse(text);
  edit(doc.definitions, doc);
  return `${JSON.stringify(doc, null, 2)}\n`;
};
const def = (defs, key) => {
  const found = defs.filter((d) => d.canonicalKey === key);
  assert.equal(found.length, 1, `content anchor must match exactly one Definition: ${key}`);
  return found[0];
};
const targeting = (defs, key) => def(defs, key).payload.rules.targeting;

const controls = [
  {
    name: "§174 saveStat = AGI on Spell Radius Targeting",
    file: CONTENT,
    mutate: content((defs) => void (targeting(defs, "spell.targeting.radius").saveStat = "AGI")),
    guard: CONTENT_RULES,
  },
  {
    name: "§175 Single Target emits an Attack Roll",
    file: COMPILE,
    mutate: append('export const singleTargetResolution = { mode: "ATTACK_ROLL", stat: "PER" };'),
    guard: COMPILE_RULES,
  },
  {
    name: "§176 Projectile canonicalized as an alias of Single Target",
    file: CONTENT,
    mutate: content((defs) => void (def(defs, "spell.targeting.projectile").payload.semanticShape = "SINGLE_TARGET")),
    guard: golden("§135"),
  },
  {
    name: "§177 Projectile base MP = 2 from the lower-authority Chapter Book",
    file: CONTENT,
    mutate: content((defs) => void (def(defs, "spell.targeting.projectile").payload.costContributions[0] = { contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE", amount: 2 } })),
    guard: golden("§135"),
  },
  {
    name: "§178 a canonical Trigger-Based SPELL_TARGETING Definition",
    file: CONTENT,
    mutate: content((defs) => void defs.push({ ...def(defs, "spell.targeting.single_target"), canonicalKey: "spell.targeting.trigger_based", payload: { ...def(defs, "spell.targeting.single_target").payload, semanticShape: "TRIGGERED" } })),
    guard: CONTENT_RULES,
  },
  {
    name: "§179 a canonical Glyph / Anchor SPELL_TARGETING Definition",
    file: CONTENT,
    mutate: content((defs) => void defs.push({ ...def(defs, "spell.targeting.zone"), canonicalKey: "spell.targeting.glyph", payload: { ...def(defs, "spell.targeting.zone").payload, semanticShape: "ANCHOR" } })),
    guard: CONTENT_RULES,
  },
  {
    name: "§180 the superseded '+10 ft Radius → +3 MP' expansion restored as canonical scaling",
    file: CONTENT,
    mutate: content((defs) => {
      const d = def(defs, "spell.targeting.radius");
      d.payload.rules.targeting.parameters.push({ parameter: "areaExtension", kind: "STEPS", minimum: 0, default: 0 });
      d.payload.costContributions.push({ contributionKey: "targeting.radius_extension", currency: "MP", data: { kind: "PER_STEP", parameter: "areaExtension", amount: 3, step: { size: 10, unit: "ft" } } });
    }),
    guard: CONTENT_RULES,
  },
  {
    name: "§181 an uncited rounding / minimum algorithm for the base Spell Line width",
    file: CONTENT,
    mutate: content((defs) => void (targeting(defs, "spell.targeting.line").measures[1] = { measure: "WIDTH", valueStatus: "FORMULA", formula: { expression: "max(5, floor(pro / 2) * 5)", rounding: "NONE", unit: "ft", variables: [{ variable: "pro", source: { kind: "STAT", stat: "PRO" } }] } })),
    guard: golden("§136"),
  },
  {
    name: "§182 Spell Range used as the Radius size",
    file: COMPILE,
    mutate: replaceOnce("    const out = formula(`geometry.${m.measure.toLowerCase()}`, m.formula,", "    const out = formula(`geometry.${m.measure.toLowerCase()}`, rules.range.formula ?? m.formula,"),
    guard: golden("§130"),
  },
  {
    name: "§183 the superseded Maneuver STR-band Radius table (1–3 → 5, 4–6 → 10, 7+ → 15)",
    file: COMPILE,
    mutate: replaceOnce("        variables[v.variable] = row.value;", "        variables[v.variable] = [5, 5, 5, 5, 10, 10, 10, 15][Math.min(character.stats.STR ?? 0, 7)] as number;"),
    guard: golden("§90"),
  },
  {
    name: "§184 the exact SPELL_TARGETING Radius EntityVersion reused in a Maneuver",
    file: COMPOSITION,
    mutate: replaceOnce('    if (ref.definitionKind !== required && !(ref.definitionKind === "SHARED_TRAIT" && (required === "SPELL_TRAIT" || required === "MANEUVER_TRAIT"))) {', '    if (ref.definitionKind !== required && !(ref.definitionKind === "SHARED_TRAIT" && (required === "SPELL_TRAIT" || required === "MANEUVER_TRAIT")) && !(ref.definitionKind === "SPELL_TARGETING" && required === "MANEUVER_TARGETING")) {'),
    guard: golden("§147"),
  },
  {
    name: "§185 Agility / Prowess Save Profile on MANEUVER_TARGETING Radius",
    file: CONTENT,
    mutate: content((defs) => void (targeting(defs, "maneuver.targeting.radius").saveProfile = ["AGI", "PRO"])),
    guard: CONTENT_RULES,
  },
  {
    name: "§186 Radius Conversion's +3 AP duplicated on MANEUVER_TARGETING Radius",
    file: CONTENT,
    mutate: content((defs) => void def(defs, "maneuver.targeting.radius").payload.costContributions.push({ contributionKey: "targeting.conversion", currency: "AP", data: { kind: "BASE", amount: 3 } })),
    guard: CONTENT_RULES,
  },
  {
    name: "§187 compatibility accepted because names share a word",
    file: COMPILE,
    mutate: replaceOnce(
      "            { key: IDENTITY_FACT, members: identity, provenance: provenanceJson(targetingProv) },",
      '            { key: IDENTITY_FACT, members: [...identity, ...allow.filter((a) => a.split(/[._]/).some((seg) => envelope.canonicalKey.toUpperCase().includes(seg.toUpperCase())))], provenance: provenanceJson(targetingProv) },',
    ),
    guard: golden("a semantic token never matches"),
  },
  {
    name: "§188 Targeting resolved through the newest EntityVersion",
    file: COMPILE,
    mutate: replaceOnce(
      "  const envelope = findBundleDefinition(bundle, use.definition);",
      "  const findNewestTargeting = () => [...bundle.definitions].reverse().find((d) => d.canonicalKey === use.definition.canonicalKey) ?? null;\n  const envelope = findNewestTargeting();",
    ),
    guard: COMPILE_RULES,
  },
  {
    name: "§189 Radius computed directly in Studio UI code",
    file: UI,
    mutate: append("export const spellRadiusFeet = (prowess: number) => prowess * 5;"),
    guard: UI_RULES,
  },
];

runControls({
  root,
  title: "M5-WO6",
  controls: controls,
  expect: /AssertionError|Error: compile failed|Error: reading failed|Error: steps failed|Error: \[|expected/,
  caught: (name) => `Negative control caught: ${name}`,
  done: (count) => `All ${count} M5-WO6 negative controls caught and reverted.`,
});
