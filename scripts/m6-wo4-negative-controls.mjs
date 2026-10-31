/**
 * M6-WO4 negative / mutation controls (PAS-10 M6-WO4 §138) on the shared CLOSEOUT-03 harness: each control mutates REAL
 * source, the permanent M6-WO4 guard must FAIL for a behavioural reason, and the file is restored byte-for-byte.
 * Guards (one green baseline each): the pure advancement / eligibility suite + registry characterization
 * (@prowess/game), and the M6-WO4 static gate with the advancement UI suite (Studio).
 * Invariants: M6-I031 … M6-I044.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = vitestGuard(root, "packages/prowess-game", ["src/character-advancement.test.ts", "src/m6-wo4-registry.test.ts"], { timeout: 300_000, ciEnv: false });
const studio = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo4-static.test.ts", "tests/unit/m6-wo4-advancement-ui.test.tsx"], { timeout: 300_000, ciEnv: false });
const replace = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `one exact mutation anchor: ${from}`);
  return text.replace(from, to);
};
const append = (extra) => (text) => `${text}\n${extra}\n`;

const ADV = "packages/prowess-game/src/character/advancement.ts";
const ELIG = "packages/prowess-game/src/character/eligibility.ts";
const FAMILIES = "packages/prowess-game/src/vocabulary/families.ts";
const REPO = "packages/prowess-db/src/character/advancement-repository.ts";
const SERVICE = "packages/prowess-db/src/character/advancement-service.ts";
const SCHEMA = "packages/prowess-db/prisma/schema.prisma";
const MIGRATION = "packages/prowess-db/prisma/migrations/20261031010000_m6_wo4_character_advancement/migration.sql";
const UI = "apps/studio/app/characters";

const controls = [
  // ---- Level ownership (M6-I032, M6-I033) ----
  // 1 · The next Level skips one.
  ["advancement skips a Level", ADV, replace("  return c.levels.find((l) => level < l) ?? null;", "  return c.levels.filter((l) => level < l).at(1) ?? c.levels.find((l) => level < l) ?? null;"), game],
  // 2 · The maximum Level is hard-coded.
  ["maximum Level hard-coded", ADV, replace("    maximumLevel: c.levels.at(-1) as number,", "    maximumLevel: 10,"), studio],
  // 3 · Cross-Definition coherence is not checked.
  ["advancement Levels not checked against the Character Die progression", ADV, replace("  if (JSON.stringify(authored) !== JSON.stringify(later)) {", "  if (false) {"), game],
  // 4 · History replay accepts a skipped Level.
  ["history replay accepts a skipped Level", ADV, replace("    if (expected === null || record.toLevel !== expected) {", "    if (expected === null) {"), game],
  // 5 · The client supplies the Level.
  ["client supplies the next Level", "apps/studio/app/api/characters/[characterId]/advance/route.ts", replace('readStrictBody(request, ["expectedLockVersion", "choices"])', 'readStrictBody(request, ["expectedLockVersion", "choices", "toLevel"])'), studio],
  // 6 · The database lets the Level jump.
  ["database Level guard allows a jump", MIGRATION, replace('       OR NEW."level" IS DISTINCT FROM OLD."level" + 1', '       OR NEW."level" <= OLD."level"'), studio],
  // 7 · The Advancement Rule accepts another schema version.
  ["unsupported advancement-rule schema version accepted", FAMILIES, replace('  CHARACTER_ADVANCEMENT_RULE: active("CHARACTER"),', '  CHARACTER_ADVANCEMENT_RULE: { ...active("CHARACTER"), schemaVersions: [1, 2] },'), game],
  // ---- Stat Points (M6-I036) ----
  // 8 · More Stat Points than granted.
  ["Stat Points beyond the entitlement accepted", ADV, replace('else if (numericCompare("advancement.points", spent, "<=", step.statPoints) === false) fail(E.STAT_POINTS_EXCEEDED', 'else if (numericCompare("advancement.points", spent, "<=", step.statPoints) === null) fail(E.STAT_POINTS_EXCEEDED'), game],
  // 9 · Unspent Stat Points accepted.
  ["unspent Stat Points accepted", ADV, replace('else if (numericCompare("advancement.points", spent, ">=", step.statPoints) === false) fail(E.STAT_POINTS_UNSPENT', 'else if (numericCompare("advancement.points", spent, ">=", step.statPoints) === null) fail(E.STAT_POINTS_UNSPENT'), game],
  // 10 · The STAT maximum is bypassed.
  ["Release STAT maximum bypassed on advancement", ADV, replace('if (numericCompare("stat.final", final, "<=", s.maximum) === false) fail(E.STAT_OUT_OF_RANGE', 'if (numericCompare("stat.final", final, "<=", s.maximum) === null) fail(E.STAT_OUT_OF_RANGE'), game],
  // 11 · Studio computes the final Stat.
  ["Studio computes the final Stat", `${UI}/_components/CharacterProgress.tsx`, replace("                {s.final}\n", "                {s.baseline + s.ancestry + s.creation + s.advancement}\n"), studio],
  // 12 · Studio counts the remaining points itself.
  ["Studio counts Stat Points locally", `${UI}/_components/AdvancementWizard.tsx`, replace("  const remaining = preview?.statPoints?.remaining ?? null;", "  const remaining = next.statPoints - Object.values(choices.statAllocations).reduce((a, b) => a + b, 0);"), studio],
  // 13 · Studio hard-codes the cadence.
  ["advancement cadence hard-coded in Studio", `${UI}/_components/AdvancementWizard.tsx`, append("export const STAT_POINTS = { 10: 2 };"), studio],
  // ---- Skills (M6-I037) ----
  // 14 · Training stacks.
  ["duplicate Skill training accepted", ADV, replace("      if (owned !== undefined) return fail(E.SKILL_ALREADY_TRAINED", "      if (false) return fail(E.SKILL_ALREADY_TRAINED"), game],
  // 15 · An upgrade jumps to the top rank.
  ["Skill upgrade skips a rank", ADV, replace("      const next = at === undefined ? undefined : c.ladder.ranks.find((r) => at.order < r.order);", "      const next = at === undefined ? undefined : c.ladder.ranks.filter((r) => at.order < r.order).at(-1);"), game],
  // 16 · Skill advancement count ignored.
  ["required Skill advancement not enforced", ADV, replace("  if (choices.skillAdvancements.length < step.skillAdvancements) fail(E.SKILL_ADVANCEMENT_REQUIRED", "  if (false) fail(E.SKILL_ADVANCEMENT_REQUIRED"), game],
  // 17 · One Skill advanced twice in one Level.
  ["one Skill advanced twice in a Level", ADV, replace("    if (touched.includes(ref.entityId)) return fail(E.DUPLICATE_SKILL_ADVANCEMENT", "    if (false) return fail(E.DUPLICATE_SKILL_ADVANCEMENT"), game],
  // ---- Affinity (M6-I038) ----
  // 18 · The automatic Primary step requires (and persists) a choice.
  ["automatic Affinity step treated as a choice", ADV, replace('  return step.mode === "REQUIRED" && only !== undefined && only.action === "RANK_UP" && only.target === "PRIMARY";', "  return false;"), game],
  // 19 · The M5 progression validator's verdict is ignored.
  ["M5 Affinity progression validator ignored", ADV, replace('  if (!progressionOut.ok || progressionOut.value.status !== "VALID") {', "  if (!progressionOut.ok) {"), studio],
  // 20 · An unresolved canon option is guessed.
  ["unresolved Affinity option guessed", ADV, replace("      if (option.startingRank === null || option.conflictKey !== null) fail(E.AFFINITY_OPTION_UNRESOLVED", "      if (false) fail(E.AFFINITY_OPTION_UNRESOLVED"), studio],
  // ---- Exact Release (M6-I031, M6-I043) ----
  // 21 · Another revision of a pinned Entity substitutes.
  ["another revision accepted for an advancement selection", ADV, replace("  if (envelope === null || envelope.entityVersionId !== sel.entityVersionId) {\n    add(E.CROSS_RELEASE_SELECTION", "  if (envelope === null) {\n    add(E.CROSS_RELEASE_SELECTION"), game],
  // 22 · The latest Release is used.
  ["latest Release used for advancement", SERVICE, replace("  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);\n  const progression", "  const { bundle, ruleset } = await releaseRules((await latestReleaseOf(c)).id);\n  const progression"), studio],
  // 23 · Advancement skips Release integrity verification.
  ["advance skips Release integrity verification", SERVICE, replace("  const verification = await verifyRulesetReleaseManifestHash(c.rulesetReleaseId);\n  if (!verification.valid) throw fail(CHARACTER_ERROR_CODES.RELEASE_INTEGRITY_FAILED", "  const verification = { valid: true };\n  if (!verification.valid) throw fail(CHARACTER_ERROR_CODES.RELEASE_INTEGRITY_FAILED"), studio],
  // ---- History, concurrency, persistence (M6-I034, M6-I035, M6-I039) ----
  // 24 · A stale lockVersion commits.
  ["stale lockVersion accepted by Advance Character", REPO, replace("where: { id, lockVersion: expected, coreCreationCompletedAt: { not: null }, level: input.fromLevel }", "where: { id, coreCreationCompletedAt: { not: null }, level: input.fromLevel }"), studio],
  // 25 · History is rewritten during a commit.
  ["advancement history rewritten on commit", REPO, replace("      for (const s of input.skillAdvancements) await tx.characterSkillAdvancement.create(", "      await tx.characterSkillAdvancement.deleteMany({ where: { advancementId: advancement.id } });\n      for (const s of input.skillAdvancements) await tx.characterSkillAdvancement.create("), studio],
  // 26 · Advancement rewrites the Level-1 creation rows.
  ["creation allocation rewritten by advancement", REPO, replace("      await tx.character.update({ where: { id }, data: { level: input.toLevel } });", "      await tx.characterStatAllocation.deleteMany({ where: { characterId: id } });\n      await tx.character.update({ where: { id }, data: { level: input.toLevel } });"), studio],
  // 27 · The database stops refusing history edits.
  ["database allows editing committed history", MIGRATION, replace("  IF TG_OP <> 'INSERT' THEN\n    RAISE EXCEPTION 'CHARACTER_ADVANCEMENT_IMMUTABLE", "  IF FALSE THEN\n    RAISE EXCEPTION 'CHARACTER_ADVANCEMENT_IMMUTABLE"), studio],
  // 28 · A derived value is persisted.
  ["derived Maximum HP persisted on an advancement", SCHEMA, replace('  lockVersionBefore Int @map("lock_version_before")\n', '  lockVersionBefore Int @map("lock_version_before")\n  maximumHp         Int? @map("maximum_hp")\n'), studio],
  // 29 · A second profile builder appears.
  ["profile assembled outside the one builder", SERVICE, append("export function buildCharacterMechanicalProfile(input: unknown): unknown {\n  return input;\n}"), studio],
  // 30 · The client sends a Level with Advance Character.
  ["client sends a Level with Advance Character", `${UI}/_lib/character-client.ts`, replace("`/api/characters/${enc(id)}/advance`, { expectedLockVersion, choices })", "`/api/characters/${enc(id)}/advance`, { expectedLockVersion, choices, toLevel: 0 })"), studio],
  // 31 · Advance Character is enabled before the server accepts the advancement.
  ["Advance Character enabled before a READY preview", `${UI}/_components/AdvancementWizard.tsx`, replace('disabled={busy || preview?.status !== "READY"}', "disabled={busy}"), studio],
  // ---- Eligibility (M6-I040, M6-I041, M6-I042) ----
  // 32 · Eligibility ignores the exact pin.
  ["eligibility accepts another revision", ELIG, replace("  if (envelope === null || envelope.entityVersionId !== definition.entityVersionId) {", "  if (envelope === null) {"), game],
  // 33 · Unrelated Skill progress satisfies a requirement.
  ["unrelated Skill rank satisfies a requirement", ELIG, replace("  const owned = ctx.profile.constructionContext.skillRanks.find((s) => s.skillKey === skillKey);", "  const owned = ctx.profile.constructionContext.skillRanks.find((s) => s.skillKey === skillKey) ?? ctx.profile.constructionContext.skillRanks.at(-1);"), game],
  // 34 · Every evaluated component is eligible.
  ["unmet requirement reported as eligible", ELIG, replace('requirements.every((r) => r.satisfied === true) ? "ELIGIBLE" : "INELIGIBLE"', '"ELIGIBLE"'), game],
  // 35 · A new prerequisite kind is invented.
  ["new prerequisite kind invented", ELIG, replace('  readonly kind: "SKILL_RANK_AT_LEAST" | "AFFINITY_RANK_AT_LEAST";', '  readonly kind: "SKILL_RANK_AT_LEAST" | "AFFINITY_RANK_AT_LEAST" | "LEVEL_AT_LEAST";'), studio],
  // 36 · Rules Text decides eligibility.
  ["Rules Text parsed for eligibility", ELIG, append('export const eligibleByText = (d: { rulesText?: string }) => (d.rulesText ?? "").includes("Arcana");'), studio],
  // 37 · A Level unlock table appears.
  ["Level unlock table introduced", ADV, append('export const LEVEL_UNLOCKS: Record<number, readonly string[]> = { 3: ["test.effect"] };'), studio],
];

runControls({
  root,
  title: "M6-WO4",
  controls: controls.map(([name, file, mutate, guard]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO4 controls caught and restored.`,
});
