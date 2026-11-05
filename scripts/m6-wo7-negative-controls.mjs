/**
 * M6-WO7 negative / mutation controls (PAS-10 M6-WO7 §165) on the shared CLOSEOUT-03 harness: each control mutates REAL
 * source (game adapter, M5 core, permanent content, database service / repository, schema, migration, routes or Studio),
 * the permanent M6-WO7 guard must FAIL for a behavioural or architectural reason, and the file is restored
 * byte-for-byte. Guards (one green baseline each): the @prowess/game Signature Spell suites with the permanent M5
 * characterization, and the M6-WO7 static gate with the Signature Spell UI suite (Studio). Invariants: M6-I077 … M6-I098.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = vitestGuard(root, "packages/prowess-game", ["src/character-signature-spell.test.ts", "src/character-signature-spell-world.test.ts", "src/m6-wo7-m5-characterization.test.ts"], { timeout: 900_000, ciEnv: false });
const studio = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo7-static.test.ts", "tests/unit/m6-wo7-spell-ui.test.tsx"], { timeout: 300_000, ciEnv: false });

const replace = (...pairs) => (text) => {
  let out = text;
  for (let i = 0; i < pairs.length; i += 2) {
    const [from, to] = [pairs[i], pairs[i + 1]];
    assert.equal(out.split(from).length, 2, `one exact mutation anchor: ${from}`);
    out = out.replace(from, to);
  }
  return out;
};
const append = (extra) => (text) => `${text}\n${extra}\n`;

const G = (f) => `packages/prowess-game/src/${f}`;
const ADAPTER = G("character/signature-spell.ts");
const CATALOG = G("character/signature-spell-catalog.ts");
const M5_COST = G("ability/spell-cost.ts");
const M5_EXECUTION = G("ability/effect-execution.ts");
const CONTENT = (f) => G(`content/core-playtest-v0.1/${f}`);
const SERVICE = "packages/prowess-db/src/character/signature-spell-service.ts";
const REPO = "packages/prowess-db/src/character/signature-spell-repository.ts";
const SCHEMA = "packages/prowess-db/prisma/schema.prisma";
const MIGRATION = "packages/prowess-db/prisma/migrations/20261103010000_m6_wo7_signature_spells/migration.sql";
const API = "apps/studio/app/api/characters/[characterId]";
const UI = (f) => `apps/studio/app/characters/${f}`;
const BUILDER = UI("_components/spells/SpellBuilder.tsx");
const REVIEW = UI("_components/spells/SpellReview.tsx");
const PICKER = UI("_components/spells/SpellComponents.tsx");
const FORMAT = UI("_lib/spell-format.ts");
const WO7_END = "// <<< M6-WO7 Character Signature Abilities";
// Exact shared finalization statement. Historical Spell-only mutations leave the Maneuver branch untouched.
const SPELL_REVISION_CREATE = '      const revision = kind === "SPELL" ? await tx.characterSignatureSpellRevision.create({ data }) : await tx.characterSignatureManeuverRevision.create({ data });';

const controls = [
  // ---- Character-owned, never canon (M6-I077, M6-I078) ----
  ["1 Spell created as a Compendium Entity", SERVICE, append('export const publishSpellAsEntity = async () => (await import("../client.js")).prisma.entity.create({ data: {} as never });'), studio],
  ["2 Character Release mutated on finalization", REPO, replace(SPELL_REVISION_CREATE, `      if (kind === "SPELL") await tx.rulesetRelease.update({ where: { id: input.characterReleaseId }, data: {} });\n${SPELL_REVISION_CREATE}`), studio],
  // ---- No latest component (M6-I095) ----
  ["3 latest Targeting revision lookup", ADAPTER, append("export const latestTargetingRevision = (versions: readonly { revisionNumber: number }[]) => versions.at(-1);"), studio],
  ["4 latest Effect revision lookup", CATALOG, append("export const newestEffectRevision = (versions: readonly { revisionNumber: number }[]) => versions.at(-1);"), studio],
  ["5 latest Trait revision lookup", SERVICE, append('export const traitRevision = async (entityId: string) => (await import("../client.js")).prisma.entityVersion.findMany({ where: { entityId } });'), studio],
  ["6 latest Duration revision lookup", `${API}/spells/[spellId]/builder/route.ts`, append("export const getCurrentDurationVersion = (versions: readonly string[]) => versions[0];"), studio],
  ["7 latest Casting Condition revision lookup", PICKER, append("export const mostRecentCondition = (versions: readonly string[]) => versions[0];"), studio],
  ["8 component found by canonical key / name", ADAPTER, replace("    const d = findBundleDefinition(bundle, ref);", "    const d = bundle.definitions.find((x) => x.canonicalKey === ref.canonicalKey) ?? null;"), studio],
  // ---- Authority (M6-I080, M6-I081) ----
  ["9 authority auto-selected", ADAPTER, replace("concept: { name, description: \"\", visualDescription: \"\", notes: \"\", narrativeTags: [] }, authority: null,", "concept: { name, description: \"\", visualDescription: \"\", notes: \"\", narrativeTags: [] }, authority: \"ARCANE_AUTHORITY\","), studio],
  ["10 authority auto-switched", ADAPTER, replace("      authority: { authority: draft.authority },", '      authority: { authority: draft.authority === "AFFINITY_AUTHORITY" ? "ARCANE_AUTHORITY" : draft.authority },'), game],
  ["11 Arcane + Affinity access self-granted", ADAPTER, replace("    keywords: request.keywords,\n", "    keywords: request.keywords,\n    accessGrants: [],\n"), studio],
  // ---- Studio presents, never computes (M6-I082 … M6-I084) ----
  ["12 Studio calculates Effect capacity", BUILDER, replace('Effects: {c ? `${c.usage.effects} / ${c.capacity.effects.remaining ?? "—"}`', 'Effects: {c ? `${c.usage.effects} / ${c.capacity.effects.remaining + c.capacity.trades.requested}`'), studio],
  ["13 Studio calculates Trait capacity", BUILDER, replace('Traits: {c ? `${c.usage.traits} / ${c.traitCapacity.ordinary.effective ?? "—"}`', 'Traits: {c ? `${c.usage.traits} / ${(c.traitCapacity.ordinary.base ?? 0) + c.capacity.trades.requested}`'), studio],
  ["14 Studio calculates MP", FORMAT, replace("  return c === null ? null : `${c.finalMpCost} MP · ${c.finalApCost} AP`;", "  return c === null ? null : `${c.baseMp * c.netPercent / 100} MP · ${c.finalApCost} AP`;"), studio],
  ["15 Studio calculates AP", FORMAT, replace("  return c === null ? null : `${c.finalMpCost} MP · ${c.finalApCost} AP`;", "  return c === null ? null : `${c.finalMpCost} MP · ${Math.max(1, Math.floor(c.finalMpCost / c.pro))} AP`;"), studio],
  ["16 Studio calculates the Affinity discount", BUILDER, replace("Strength discount ${a.rankRule.strengthDiscountPercent ?? 0}%", "Strength discount ${a.rankRule.strengthDiscountPercent ?? 0}% (saves ${a.rankRule.strengthDiscountPercent / 100} per MP)"), studio],
  ["17 Studio calculates the Weakness penalty", BUILDER, replace('${w.severity ? ` (${formatEnumLabel(w.severity)})` : ""}', '${w.severity ? ` (${formatEnumLabel(w.severity)}, +${w.activationPenaltyPercent ?? 0}%)` : ""}${w.activationPenaltyPercent ? ` ×${w.activationPenaltyPercent / 100}` : ""}'), studio],
  ["18 Studio calculates Sustain", BUILDER, replace('Sustain (M5-WO13 policy): {evaluation.runtime.sustain.mpPerRound ?? "unresolved"} MP', "Sustain (M5-WO13 policy): {evaluation.cost ? evaluation.cost.finalMpCost / evaluation.cost.pro : \"unresolved\"} MP"), studio],
  ["19 ME reduces the listed MP", ADAPTER, replace("    stats: profile.constructionContext.stats,\n", "    stats: profile.constructionContext.stats,\n    manaEfficiency: 1,\n"), studio],
  // ---- The permanent M5-WO10 cost pipeline (M6-I083, M6-I085) ----
  ["20 20 / 30 / 40 Condition cap restored", CONTENT("duration-conditions.ts"), replace("spellMpPercentMaximum: 30,", "spellMpPercentMaximum: 40,"), game],
  ["21 percentages applied sequentially", CONTENT("spell-cost.ts"), replace('unrounded: { expression: "base * net / 100"', 'unrounded: { expression: "base * net / 100 * net / 100"'), game],
  ["22 intermediate rounding", CONTENT("spell-cost.ts"), replace('unrounded: { expression: "base * net / 100"', 'unrounded: { expression: "floor(base * net / 100)"'), game],
  ["23 floor instead of the final rounding", CONTENT("spell-cost.ts"), replace('finalMp: { expression: "floor(unrounded + 0.5)"', 'finalMp: { expression: "floor(unrounded)"'), game],
  ["24 3 AP maximum", CONTENT("spell-cost.ts"), replace('baseAp: { expression: "max(1, floor(final_mp / pro))"', 'baseAp: { expression: "min(3, max(1, floor(final_mp / pro)))"'), game],
  // ---- Composition (M6-I086, M6-I087) ----
  ["25 automatic Trait exchange", ADAPTER, replace("    constructionOptions: draft.constructionOptions,", "    constructionOptions: { effectSlotsTradedForTraits: draft.traits.length },"), game],
  ["26 zero-Effect Spell accepted", ADAPTER, replace('  if (draft.effects.length === 0) out.push("EFFECTS");\n', ""), game],
  ["27 arbitrary mechanical Keyword accepted", ADAPTER, replace("  }))].sort();", "  }))].concat(draft.concept.narrativeTags).sort();"), studio],
  ["28 description parsed for damage type", ADAPTER, replace('    name: "Character Signature Spell",\n    description: "",', '    name: "Character Signature Spell",\n    description: draft.concept.description,'), studio],
  ["29 name parsed for Affinity", ADAPTER, replace('    name: "Character Signature Spell",', "    name: draft.concept.name,"), studio],
  ["30 cross-Release revision evaluated against the Character's Release", SERVICE, replace("r.characterReleaseId !== ctx.c.rulesetReleaseId ? null : evaluateStored", "false ? null : evaluateStored"), studio],
  ["31 invalid Targeting / Effect compatibility accepted", ADAPTER, replace("  const valid = cost !== null && cost.valid && issues.length === 0;", "  const valid = cost !== null;"), game],
  ["32 Effect order discarded", ADAPTER, replace("      effects: draft.effects.map(ordered),", "      effects: [...draft.effects].sort((a, b) => (a.componentKey < b.componentKey ? -1 : 1)).map(ordered),"), studio],
  ["33 not-triggered treated as failure in the review", REVIEW, replace("A later Effect that is not triggered is NOT a failure.", "A later Effect that is not triggered counts as a failure."), studio],
  ["34 Effect Chain reimplemented in Studio", BUILDER, append("export function resolveEffectChain(nodes: readonly unknown[]) { return nodes; }"), studio],
  ["35 dynamic Metamagic introduced", BUILDER, append('export const METAMAGIC = ["Quickened", "Twin Cast", "Overchannel"] as const;'), studio],
  // ---- Unresolved M5 conflicts (M6-I088, M6-I097) ----
  ["36 M5-SC-042 additional Affinity Trait capacity guessed", ADAPTER, replace("    additionalAffinityTraits: draft.additionalAffinityTraits,", "    additionalAffinityTraits: [],"), game],
  ["37 M5-SC-046 unpriced target count hidden", ADAPTER, replace(": costPlan.problems) costUnresolved.push({ path: q.path, message: q.message });", ": costPlan.problems) void q;"), game],
  ["38 M5-SC-047 Signature discount applied", ADAPTER, append("export const signatureDiscount = (mp: number) => mp;"), studio],
  ["39 M5-SC-049 Trait trigger semantics guessed", M5_EXECUTION, replace('if (traits.some((t) => t.modifications.some((m) => m.modification.kind === "TRIGGER"))) unresolved(', 'if (false) unresolved('), studio],
  ["40 M5-SC-050 multiple Saves guessed", M5_EXECUTION, replace('    if (!stats.length) { unresolved(["effects", key], "M5-SC-050",', '    if (stats.length < 0) { unresolved(["effects", key], "M5-SC-050",'), studio],
  ["41 M5-SC-052 Mana Lock amount guessed", CONTENT("active-magic.ts"), replace('  manaLock: { amount: null, conflictKey: "M5-SC-052" },', '  manaLock: { amount: 5, conflictKey: "M5-SC-052" },'), game],
  ["42 M5-SC-053 Channel MP timing guessed", CONTENT("active-magic.ts"), replace("mpPaymentTiming: null,", 'mpPaymentTiming: "ON_CAST",'), studio],
  // ---- Roster and finalization (M6-I089 … M6-I091) ----
  ["43 Draft consumes a Signature slot", REPO, replace('count({ where: { characterId, status: "ACTIVE", id: { not: abilityId } } })', "count({ where: { characterId, id: { not: abilityId } } })"), studio],
  ["44 invalid Draft finalized", SERVICE, replace('      if (e.state === "VALID" || e.state === "VALID_WITH_RUNTIME_DEFERRED") return { ok: true, payload:', '      if (e.state !== "INCOMPLETE") return { ok: true, payload:'), studio],
  ["45 over-capacity accepted", ADAPTER, replace("    signature: { usedSlots: request.usedSlots,", "    signature: { usedSlots: 0,"), studio],
  ["46 concurrent finalization overfills (no Character lock)", REPO, replace('::uuid FOR UPDATE`;', "::uuid`;"), studio],
  // ---- History (M6-I092 … M6-I094) ----
  ["47 finalized revision overwritten", REPO, replace(SPELL_REVISION_CREATE, `      if (kind === "SPELL") await tx.characterSignatureSpellRevision.deleteMany({ where: { abilityId } });\n${SPELL_REVISION_CREATE}`), studio],
  ["48 invalid rebuild replaces the current revision", REPO, replace('      if (!decision.ok) throw new FinalizeAbort({ outcome: "rejected", reason: decision.reason, detail: decision.detail });', '      if (!decision.ok && usedSlots < 0) throw new FinalizeAbort({ outcome: "rejected", reason: decision.reason, detail: decision.detail });'), studio],
  ["49 retirement deletes history", REPO, replace('    return { status: "RETIRED", retiredAt: new Date(), draftPayload: Prisma.DbNull };', '    void prisma.characterSignatureSpellRevision.deleteMany({ where: { abilityId } });\n    return { status: "RETIRED", retiredAt: new Date(), draftPayload: Prisma.DbNull };'), studio],
  ["50 cached final MP persisted and trusted", SCHEMA, replace(WO7_END, '// cached cost\nmodel CharacterSignatureSpellCostCache {\n  abilityId String @id @db.Uuid\n  finalMpCost Int @map("final_mp_cost")\n}\n' + WO7_END), studio],
  // ---- No synthetic canon; M5 semantics reused, never redefined (M6-I077, M6-I096) ----
  ["51 synthetic canonical Spell Definition inserted into the bundle", ADAPTER, replace("    definitions: bundle,\n", '    definitions: { ...bundle, definitions: [...bundle.definitions, { definitionKind: "SPELL_DEFINITION" }] },\n'), studio],
  ["52 adapter refactor changes an M5 golden", M5_COST, replace("{ subjectRefs: [plan.definition], sourceKey:", "{ subjectRefs: [], sourceKey:"), game],
  // ---- No live casting; no Ability Card framework (M6-I098, §99) ----
  ["53 builder spends AP / MP", BUILDER, append("export const spendMp = (current: number) => current;"), studio],
  ["54 builder resolves live damage", ADAPTER, append('export { executeAbilityResolution as castSignatureSpell } from "../ability/effect-execution.js";'), studio],
  ["55 builder creates Active Effect state", REPO, append("export const createActiveEffect = (abilityId: string) => ({ abilityId });"), studio],
  ["56 WO9 Ability Card framework introduced", REVIEW, append("export function AbilityCard() { return null; }"), studio],
  // ---- Additional risks found during implementation ----
  ["57 Builder discards the player's Effect order", BUILDER, replace("list.map((x, i) => ({ ...x, order: i + 1 }));", "list.map((x) => ({ ...x, order: 1 }));"), studio],
  ["58 client may submit a derived cost on the draft write", `${API}/spells/[spellId]/draft/route.ts`, replace('readStrictBody(request, ["expectedVersion", "draft"])', 'readStrictBody(request, ["expectedVersion", "draft", "finalMpCost"])'), studio],
  ["59 a provisional cost shown for an invalid Spell", FORMAT, replace("  return e && e.cost !== null && isFinalizable(e.state) ? e.cost : null;", "  return e && e.cost !== null ? e.cost : null;"), studio],
  ["60 Trait exchange inferred when a Trait is added", BUILDER, replace("                  return { ...d, traits: renumber([...d.traits, trait]) };", "                  return { ...d, traits: renumber([...d.traits, trait]), constructionOptions: { effectSlotsTradedForTraits: d.constructionOptions.effectSlotsTradedForTraits + 1 } };"), studio],
  ["61 Abilities tab removed from the Character", UI("_components/CharacterSheetSummary.tsx"), replace('  { key: "abilities", label: "Abilities" },\n', ""), studio],
  ["62 Signature Spells dropped from the Sheet's Actions", UI("_components/sheet/SheetPanels.tsx"), replace("      <SignatureSpellRows sheet={sheet} />\n", ""), studio],
  ["63 builder hard-codes a component", PICKER, append('export const DEFAULT_TARGETING = "SINGLE_TARGET";'), studio],
  ["64 Studio imports the M5 domain package", REVIEW, append('import { evaluateCharacterSignatureSpell } from "@prowess/game";\nexport const localEvaluate = evaluateCharacterSignatureSpell;'), studio],
  ["65 append-only revision trigger weakened", MIGRATION, replace('CREATE TRIGGER "character_signature_spell_revisions_append_only" BEFORE UPDATE OR DELETE ON', 'CREATE TRIGGER "character_signature_spell_revisions_append_only" BEFORE UPDATE ON'), studio],
  ["66 retired Spell edited", REPO, replace('    if (row.status === "RETIRED") throw new Outcome({ outcome: "state", status: row.status, reason: "a retired Signature Spell is history; it is never edited" });\n', ""), studio],
  ["67 stale Spell write accepted", REPO, replace("updateMany({ where: { id: abilityId, characterId, lockVersion: expected }, data: { ...data,", "updateMany({ where: { id: abilityId, characterId }, data: { ...data,"), studio],
  ["68 finalization ignores a changed Character Release", REPO, replace(" || locked[0]!.ruleset_release_id !== input.characterReleaseId", ""), studio],
];

runControls({
  root,
  title: "M6-WO7",
  controls: controls.map(([name, file, mutate, guard]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO7 controls caught and restored.`,
});
