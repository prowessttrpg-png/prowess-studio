/**
 * M5-WO5 behavioural negative controls (PAS-10 M5-WO5 §142–§163, §A11). Each control temporarily mutates REAL source, the
 * REAL canonical construction content, the invariant catalog, terminology or CI on disk, runs the guard that must catch
 * it, requires that guard to FAIL for the right reason (an assertion, not infrastructure), and restores the file in a
 * `finally`. Every file is verified byte-identical afterwards and every guard is re-run green. Never commit a control.
 *
 * Run from the repository root after building workspace packages: node scripts/m5-wo5-negative-controls.mjs
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
const golden = (pattern) => vitest("packages/prowess-game", ["src/construction-legality-golden.test.ts", "-t", pattern]);
const contracts = (pattern) => vitest("packages/prowess-game", ["src/construction-legality-contracts.test.ts", "-t", pattern]);
const staticWo5 = (pattern) => vitest("apps/studio", ["tests/unit/m5-wo5-static.test.ts", "-t", pattern]);
const staticWo1 = (pattern) => vitest("apps/studio", ["tests/unit/m5-wo1-static.test.ts", "-t", pattern]);
const LEGALITY_RULES = staticWo5("legality.ts passes the WO5 rules");
const CONTENT_RULES = staticWo5("canonical construction content passes every WO5 rule");

const G = (f) => `packages/prowess-game/src/${f}`;
const LEGALITY = G("construction/legality.ts");
const CONTENT = G("content/core-playtest-v0.1/ability-construction.json");
const TERMINOLOGY = G("vocabulary/terminology.ts");
const append = (snippet) => (text) => `${text}\n${snippet}\n`;
const replaceOnce = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
};
/** Mutates the canonical construction rule structurally (parsed, edited, re-serialized in the file's own format). */
const rule = (edit) => (text) => {
  const doc = JSON.parse(text);
  edit(doc.definitions[0].payload, doc);
  return `${JSON.stringify(doc, null, 2)}\n`;
};

const controls = [
  // ---- Spell access and Authority (§142–§146, M5-I156) ---------------------------------------------------------------
  {
    name: "§142 Arcane capacity hard-coded by rank token in the compiler",
    file: LEGALITY,
    mutate: replaceOnce("    baseEffects = row.effectCapacity;", '    baseEffects = arcaneRank === "EXPERT" ? 2 : row.effectCapacity;'),
    guard: LEGALITY_RULES,
  },
  {
    name: "§143 Arcane and Affinity Authority capacities added together",
    file: LEGALITY,
    mutate: replaceOnce(
      "    baseEffects = authority === null ? NO_AUTHORITY_CAPACITY : authority.effectCapacity;",
      "    baseEffects = (authority === null ? NO_AUTHORITY_CAPACITY : authority.effectCapacity) + (arcane.ranks.find((x) => x.rankKey === arcaneRank)?.effectCapacity ?? 0);",
    ),
    guard: golden("never 5"),
  },
  {
    name: "§144 Arcane Authority silently switched to Affinity Authority when Affinity data is present",
    file: LEGALITY,
    mutate: replaceOnce(
      "    if (chosen !== null) path = chosen;",
      '    if (chosen !== null) { path = chosen === "ARCANE_AUTHORITY" && composition.affinity !== null ? "AFFINITY_AUTHORITY" : chosen; if (path === "AFFINITY_AUTHORITY" && composition.affinity !== null) governing = findAffinityEntry(index, composition.affinity.definition); }',
    ),
    guard: golden("stays Arcane Authority"),
  },
  {
    name: "§145 a Spell without an Authority accepted (defaulted to Arcane)",
    file: LEGALITY,
    mutate: replaceOnce("    if (composition.authority === null) p.add(K.AUTHORITY_REQUIRED,", "    if (composition.authority === null && false) p.add(K.AUTHORITY_REQUIRED,"),
    guard: contracts("a Spell with no Authority"),
  },
  {
    name: "§146 Arcane Authority below TRAINED in content",
    file: CONTENT,
    mutate: rule((p) => void (p.spell.arcaneAuthority.minimumRank = "UNTRAINED")),
    guard: golden("§69"),
  },
  // ---- Capacity and exchange (§147–§151) -------------------------------------------------------------------------------
  {
    name: "§147 Arcane Expert capacity changed to 3 Effects",
    file: CONTENT,
    mutate: rule((p) => void (p.spell.arcaneAuthority.ranks.find((r) => r.rankKey === "EXPERT").effectCapacity = 3)),
    guard: golden("Arcane capacity is 1 / 2 / 3"),
  },
  {
    name: "§148 the Trait exchange allowed to remove the last Effect",
    file: CONTENT,
    mutate: rule((p) => void (p.spell.traitExchange.minimumEffectsRemaining = 0)),
    guard: golden("§64"),
  },
  {
    name: "§149 a Maneuver Trait exchange added",
    file: CONTENT,
    mutate: rule((p) => void (p.maneuver.traitExchange = { effectSlotsPerExchange: 1, traitSlotsPerExchange: 1, minimumEffectsRemaining: 1 })),
    guard: golden("§78"),
  },
  {
    name: "§150 construction arithmetic authored in code instead of content",
    file: LEGALITY,
    mutate: replaceOnce("input: { program: { expression: f.expression,", 'input: { program: { expression: slot === "maximumTrades" ? "floor(base_effects / effect_slots_per_exchange)" : f.expression,'),
    guard: staticWo1("no Prowess mechanics are implemented"),
  },
  {
    name: "§151 a Spell with no Effect allowed",
    file: CONTENT,
    mutate: rule((p) => void (p.spell.minimumEffects = 0)),
    guard: golden("§11"),
  },
  // ---- Casting Conditions (§152, M5-I157) ----------------------------------------------------------------------------
  {
    name: "§152 Casting Condition capacity granted by Affinity rank under Affinity Authority",
    file: LEGALITY,
    mutate: replaceOnce(".capacity : martialRow.conditionCapacity;", '.capacity + (path === "AFFINITY_AUTHORITY" ? baseEffects : 0) : martialRow.conditionCapacity;'),
    guard: golden("§74"),
  },
  {
    name: "§152b Casting Condition capacity source changed away from ARCANE_RANK in content",
    file: CONTENT,
    mutate: rule((p) => void (p.spell.castingConditions.ranks = p.spell.castingConditions.ranks.map((r) => ({ ...r, capacity: r.capacity + 1 })))),
    guard: CONTENT_RULES,
  },
  // ---- Stacking (§153–§155) -------------------------------------------------------------------------------------------
  {
    name: "§153 a stackable Effect counted once per stack",
    file: LEGALITY,
    mutate: replaceOnce("  const effectSlots = composition.effects.length;", "  const effectSlots = composition.effects.reduce((n, u) => n + Number((u.parameters as { stacks?: number }).stacks ?? 1), 0);"),
    guard: golden("§80"),
  },
  {
    name: "§154 separate uses of one Effect Definition collapsed into one slot",
    file: LEGALITY,
    mutate: replaceOnce("  const effectSlots = composition.effects.length;", "  const effectSlots = new Set(composition.effects.map((u) => u.definition.entityId)).size;"),
    guard: golden("§58"),
  },
  {
    name: "§155 a FIXED stack limit replaced by Martial Rank Value",
    file: LEGALITY,
    mutate: replaceOnce('      if (l.kind === "FIXED") limit = l.maximum;', '      if (l.kind === "FIXED") limit = martialRow.martialRankValue;'),
    guard: golden("§84"),
  },
  // ---- Prerequisites and Affinity access (§156–§157) -------------------------------------------------------------------
  {
    name: "§156 component prerequisites ignored",
    file: LEGALITY,
    mutate: replaceOnce("    for (const q of cr.prerequisites) {", "    for (const q of cr.prerequisites.filter(() => false)) {"),
    guard: golden("a Skill prerequisite"),
  },
  {
    name: "§157 Affinity Authority accepts a component outside the Affinity's access",
    file: LEGALITY,
    mutate: replaceOnce(
      "      children.push({ kind: \"SET_CONTAINS\", factKey: GRANTS_FACT, member: target, provenance: null });",
      "      children.push({ kind: \"SET_CONTAINS\", factKey: GRANTS_FACT, member: target, provenance: null });\n      children.push({ kind: \"ENTITY_OWNED\", entityId: g.ref.entityId, provenance: null });",
    ),
    guard: golden("§24"),
  },
  // ---- Signature slots (§158–§160) ------------------------------------------------------------------------------------
  {
    name: "§158 a Signature Ability counted as 2 slots",
    file: CONTENT,
    mutate: rule((p) => void (p.signature.defaultSlotCost = 2)),
    guard: golden("§85"),
  },
  {
    name: "§159 an exemption accepted without an authored rule",
    file: LEGALITY,
    mutate: replaceOnce("members: R.signature.exemptions.map((x) => x.exemptionKey)", "members: [exemptionKey ?? NO_EXEMPTION_NAMED]"),
    guard: golden("§88"),
  },
  {
    name: "§160 Signature capacity read from a statistic other than SIGNATURE_ABILITY_SLOTS",
    file: CONTENT,
    mutate: rule((p) => void (p.signature.capacityStatistic = "MAXIMUM_HP")),
    guard: CONTENT_RULES,
  },
  // ---- Structure, Martial and Maneuvers (§161–§163, §A11, M5-I158) ----------------------------------------------------
  {
    name: "§161 Maneuvers constructible without Martial training",
    file: CONTENT,
    mutate: rule((p) => void (p.maneuver.martial.minimumRank = "UNTRAINED")),
    guard: golden("§77 Martial UNTRAINED"),
  },
  {
    name: "§162 a Maneuver without a Foundation accepted",
    file: CONTENT,
    mutate: rule((p) => void (p.maneuver.foundationRequired = false)),
    guard: golden("names its Foundation"),
  },
  {
    name: "§163 rank order by string comparison / latest lookup in the construction compiler",
    file: LEGALITY,
    mutate: append("export const higherRank = (rankKey: string, other: string) => rankKey > other;\nexport const getLatestConstructionRule = () => null;"),
    guard: LEGALITY_RULES,
  },
  {
    name: "§A11-1 owning an Affinity adds Maneuver Effect capacity",
    file: LEGALITY,
    mutate: replaceOnce("    baseEffects = martialRow.effectCapacity;", "    baseEffects = martialRow.effectCapacity + (character.profile?.affinities.length ?? 0) * 3;"),
    guard: golden("§A5-4"),
  },
  {
    name: "§A11-2 a Maneuver accepts a Spell Authority (Affinity as a substitute for Martial training)",
    file: LEGALITY,
    mutate: replaceOnce("    p.add(K.AUTHORITY_NOT_APPLICABLE,", "    void (K.AUTHORITY_NOT_APPLICABLE,"),
    guard: contracts("a Maneuver carrying a Spell Authority"),
  },
  {
    name: "§A11-3 Martial Master Rank Value changed to 4",
    file: CONTENT,
    mutate: rule((p) => void (p.maneuver.martial.ranks.find((r) => r.rankKey === "MASTER").martialRankValue = 4)),
    guard: golden("§77 Martial TRAINED / EXPERT / MASTER"),
  },
  // ---- Catalog, terminology and CI (§164–§166) ------------------------------------------------------------------------
  {
    name: "M5-I157 reworded in the invariant documentation (Casting Conditions also from Affinity rank)",
    file: "docs/architecture/m5-invariants.md",
    mutate: replaceOnce("### M5-I157 — Casting Condition Capacity Comes From Arcane Rank Only", "### M5-I157 — Casting Condition Capacity Comes From Arcane Or Affinity Rank"),
    guard: staticWo5("the invariant catalog appends M5-I156"),
  },
  {
    name: "Martial Rank reverted to a SYSTEM_SPECIFIC Maneuver track",
    file: TERMINOLOGY,
    mutate: replaceOnce('entry("Martial Rank", "SKILL_RANK", C, "SKILL", "MARTIAL_RANK", { ...designer }),', 'entry("Martial Rank", "SKILL_RANK", SS, "MANEUVER", "MARTIAL_RANK"),'),
    guard: staticWo5("terminology: Martial Rank"),
  },
  {
    name: "the WO5 CI gate renamed away",
    file: ".github/workflows/ci.yml",
    mutate: replaceOnce("- name: M5-WO5 audit — Shared modular ability construction", "- name: M5-WO5 checks"),
    guard: staticWo5("CI: one permanent named WO5 gate"),
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
console.log(`All ${controls.length} M5-WO5 negative controls caught and reverted.`);
