#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const compilerPath = "packages/prowess-game/src/construction/legality.ts";
const contentPath = "packages/prowess-game/src/content/core-playtest-v0.1/ability-construction.json";
const compiler = readFileSync(compilerPath, "utf8");
const contentText = readFileSync(contentPath, "utf8");

const problems = (source, content) => {
  const out = [];
  const rule = JSON.parse(content).definitions[0].payload;
  const row = (rank) => rule.ranks.find((r) => r.rank === rank);

  if (!source.includes('authority === "ARCANE_AUTHORITY"') || !source.includes('"AFFINITY_AUTHORITY"')) out.push("spell-access-two-paths");
  if (!source.includes("const arcaneRank = skillRank(character, ARCANA_SKILL_KEY)")) out.push("casting-condition-source");
  if (/affinityRank.*castingCondition|affinity.*conditionCapacity/i.test(source)) out.push("affinity-condition-leak");
  if (!source.includes('"capacity.effective_effects", "base - trades"') || !source.includes('"capacity.effective_traits", "base + trades"')) out.push("trait-exchange-1-to-1");
  if (!source.includes('"capacity.minimum_effect"')) out.push("minimum-one-effect");
  if (!source.includes('"spell-only-trait-exchange-limit"')) out.push("spell-only-trade");
  if (!source.includes('own(rules, "stacking")') || !source.includes("a stackable Effect explicitly authors its stack-limit rule")) out.push("explicit-stacking");
  if (!source.includes("no default is inferred")) out.push("no-default-stack-cap");
  if (!source.includes("signature.exemption === null ? constructionRule.payload.signature.defaultSlotsPerAbility : 0")) out.push("signature-explicit-exemption");
  if (/arcane.*effectCapacity\s*\+\s*.*affinity|affinity.*effectCapacity\s*\+\s*.*arcane/i.test(source)) out.push("authority-capacity-stacking");
  if (/Math\.(?:floor|ceil|round|random)|Date\.now|new Date\(|prisma\.|DATABASE_URL/.test(source)) out.push("purity");

  if (row("TRAINED").arcane.maximumTraitTrades !== 0) out.push("trained-trade");
  if (row("EXPERT").arcane.maximumTraitTrades !== 1) out.push("expert-trade");
  if (row("MASTER").arcane.maximumTraitTrades !== 2) out.push("master-trade");
  if (row("TRAINED").arcane.castingConditionCapacity !== 1 || row("EXPERT").arcane.castingConditionCapacity !== 2 || row("MASTER").arcane.castingConditionCapacity !== 3) out.push("condition-capacity");
  if (row("TRAINED").martial.rankValue !== undefined) out.push("unexpected-nested-rank-value");
  if (row("TRAINED").rankValue !== 1 || row("EXPERT").rankValue !== 2 || row("MASTER").rankValue !== 3) out.push("martial-rank-values");
  if (rule.spellAccess.minimumArcaneRank !== "TRAINED" || rule.spellAccess.minimumAffinityRank !== "TRAINED") out.push("minimum-spell-access");
  if (rule.spellAccess.minimumEffects !== 1) out.push("minimum-effects");
  if (rule.signature.defaultSlotsPerAbility !== 1 || rule.signature.capacityStat !== "PRO") out.push("signature-rule");
  return out;
};

assert.deepEqual(problems(compiler, contentText), [], "canonical WO5 source/content must pass before controls run");

const controls = [
  ["Arcane-only spell access", compiler.replace('"AFFINITY_AUTHORITY"', '"NO_AFFINITY_AUTHORITY"'), contentText, "spell-access-two-paths"],
  ["Affinity grants Casting Conditions", `${compiler}\nconst affinityRankCastingConditionCapacity = 3;`, contentText, "affinity-condition-leak"],
  ["remove effective Effect trade", compiler.replace('"capacity.effective_effects", "base - trades"', '"capacity.effective_effects", "base"'), contentText, "trait-exchange-1-to-1"],
  ["allow exchanging final Effect", compiler.replace('"capacity.minimum_effect"', '"capacity.no_minimum"'), contentText, "minimum-one-effect"],
  ["make exchange non-Spell-specific", compiler.replace('"spell-only-trait-exchange-limit"', '"universal-trait-exchange"'), contentText, "spell-only-trade"],
  ["implicit stacking", compiler.replace('own(rules, "stacking")', 'own(rules, "anything")'), contentText, "explicit-stacking"],
  ["default rank stack cap", compiler.replace("no default is inferred", "rank value is the default"), contentText, "no-default-stack-cap"],
  ["implicit Signature exemption", compiler.replace("signature.exemption === null ? constructionRule.payload.signature.defaultSlotsPerAbility : 0", "0"), contentText, "signature-explicit-exemption"],
  ["add Arcane and Affinity capacity", `${compiler}\nconst illegal = arcane.effectCapacity + affinity.effectCapacity;`, contentText, "authority-capacity-stacking"],
  ["hidden gameplay Math", `${compiler}\nMath.floor(1.5);`, contentText, "purity"],
];

const mutate = (fn) => {
  const doc = JSON.parse(contentText);
  fn(doc.definitions[0].payload);
  return JSON.stringify(doc);
};
controls.push(
  ["Trained Trait trade", compiler, mutate((r) => (r.ranks.find((x) => x.rank === "TRAINED").arcane.maximumTraitTrades = 1)), "trained-trade"],
  ["Expert gets two trades", compiler, mutate((r) => (r.ranks.find((x) => x.rank === "EXPERT").arcane.maximumTraitTrades = 2)), "expert-trade"],
  ["Master gets three trades", compiler, mutate((r) => (r.ranks.find((x) => x.rank === "MASTER").arcane.maximumTraitTrades = 3)), "master-trade"],
  ["Affinity/Arcane access below Trained", compiler, mutate((r) => (r.spellAccess.minimumArcaneRank = "UNTRAINED")), "minimum-spell-access"],
  ["zero-Effect Spell", compiler, mutate((r) => (r.spellAccess.minimumEffects = 0)), "minimum-effects"],
  ["unlimited/no Signature slot", compiler, mutate((r) => (r.signature.defaultSlotsPerAbility = 0)), "signature-rule"],
  ["wrong Signature capacity stat", compiler, mutate((r) => (r.signature.capacityStat = "RES")), "signature-rule"],
  ["wrong Martial Rank Value", compiler, mutate((r) => (r.ranks.find((x) => x.rank === "EXPERT").rankValue = 3)), "martial-rank-values"],
);

for (const [name, source, content, expected] of controls) {
  const found = problems(source, content);
  assert(found.includes(expected), `${name}: expected audit to catch ${expected}; got ${found.join(", ")}`);
}

console.log(`M5-WO5 negative controls: ${controls.length} deliberate breakages caught and canonical files left unchanged.`);
