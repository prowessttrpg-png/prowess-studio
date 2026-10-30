/**
 * M6-WO3 negative / mutation controls (PAS-10 M6-WO3 §109) on the shared CLOSEOUT-03 harness: each control mutates REAL
 * source, the permanent M6-WO3 guard must FAIL for a behavioural reason, and the file is restored byte-for-byte.
 * Guards (one green baseline each): the pure Character creation validator + registry characterization (@prowess/game),
 * and the M6-WO3 static gate with the Character / Compendium-integration UI suites (Studio).
 * Invariants: M6-I021 … M6-I030.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = vitestGuard(root, "packages/prowess-game", ["src/character-creation.test.ts", "src/m6-wo3-registry.test.ts"], { timeout: 300_000, ciEnv: false });
const studio = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo3-static.test.ts", "tests/unit/m6-wo3-character-ui.test.tsx", "tests/unit/m6-wo3-compendium-integration.test.tsx"], { timeout: 300_000, ciEnv: false });
const replace = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `one exact mutation anchor: ${from}`);
  return text.replace(from, to);
};
const append = (extra) => (text) => `${text}\n${extra}\n`;
const chain = (...fns) => (text) => fns.reduce((t, f) => f(t), text);

const CREATION = "packages/prowess-game/src/character/creation.ts";
const FAMILIES = "packages/prowess-game/src/vocabulary/families.ts";
const SERVICE = "packages/prowess-db/src/character/service.ts";
const REPO = "packages/prowess-db/src/character/repository.ts";
const SCHEMA = "packages/prowess-db/prisma/schema.prisma";
const MIGRATION = "packages/prowess-db/prisma/migrations/20261029010000_m6_wo3_character_foundation/migration.sql";
const UI = "apps/studio/app/characters";
// A lookup that ignores the Release pin: any revision of the same Entity of the right kind.
const LOOSE = "  const loose = (sel: unknown, path: string, kind: string): ProwessDefinitionEnvelope | null => (isRecord(sel) ? (bundle.definitions.find((d) => d.entityId === sel.entityId && d.definitionKind === kind) ?? null) : null);\n\n  // ---- Ancestry ---";
const withLoose = (from, to) => chain(replace("\n  // ---- Ancestry ---", `\n${LOOSE}`), replace(from, to));

const controls = [
  // 1 · M6-I021: the Character stores a Ruleset id instead of the exact Release.
  ["Character stores a Ruleset id instead of the Release id", SCHEMA, replace('  rulesetReleaseId String         @map("ruleset_release_id") @db.Uuid', '  rulesetId        String         @map("ruleset_id") @db.Uuid\n  rulesetReleaseId String         @map("ruleset_release_id") @db.Uuid'), studio],
  // 2 · M6-I021 / M6-I030: a reload resolves the Ruleset's latest Release.
  ["latest Release used when a Character is reloaded", SERVICE, replace("  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);\n  return validateCharacterCreation(", "  const { bundle, ruleset } = await releaseRules((await selectLatestRelease(c)).id);\n  return validateCharacterCreation("), studio],
  // 3 · M6-I022: an Ancestry revision from another Release is accepted.
  ["Ancestry from another Release accepted", CREATION, withLoose('const e = pinned(candidate.ancestry, "ancestry", "ANCESTRY");', 'const e = loose(candidate.ancestry, "ancestry", "ANCESTRY");'), game],
  // 4 · M6-I022: a Skill revision from another Release is accepted.
  ["Skill from another Release accepted", CREATION, withLoose('const e = pinned(s.skill, `${path}.skill`, "SKILL");', 'const e = loose(s.skill, `${path}.skill`, "SKILL");'), game],
  // 5 · M6-I022: an Affinity revision from another Release is accepted.
  ["Affinity from another Release accepted", CREATION, withLoose('const e = pinned(candidate.primaryAffinity, "primaryAffinity", "AFFINITY");', 'const e = loose(candidate.primaryAffinity, "primaryAffinity", "AFFINITY");'), game],
  // 6 · M6-I022: the exact revision check is dropped (any / latest revision of the Entity substitutes).
  ["latest EntityVersion substituted for the exact pin", CREATION, replace("    if (envelope === null || envelope.entityVersionId !== sel.entityVersionId) {", "    if (envelope === null) {"), game],
  // 7 · Stat budget bypassed.
  ["Stat point budget bypassed", CREATION, replace("  if (pointsSpent > budget) {", "  if (false && pointsSpent > budget) {"), game],
  // 8 · Stat maximum bypassed.
  ["Release STAT maximum bypassed", CREATION, replace("    if (final < def.payload.minimum || final > def.payload.maximum) {", "    if (final < def.payload.minimum) {"), game],
  // 9 · Duplicate starting Skill accepted (training stacks).
  ["duplicate starting Skill accepted", CREATION, replace("    if (skills.some((x) => x.skill.entityId === ref.entityId)) return add(E.DUPLICATE_SKILL", "    if (false) return add(E.DUPLICATE_SKILL"), game],
  // 10 · Free trained Skill count ignored.
  ["free trained Skill count ignored", CREATION, replace("      if (free.length >= rule.payload.freeTrainedSkillCount) return add(E.FREE_SKILLS_EXCEEDED", "      if (false) return add(E.FREE_SKILLS_EXCEEDED"), game],
  // 11 · Ancestry Stat choice count ignored.
  ["Ancestry Stat choice count ignored", CREATION, replace("      if (chosen.length >= grant.count) return add(E.INVALID_STAT_CHOICE", "      if (false) return add(E.INVALID_STAT_CHOICE"), game],
  // 12 · M6-I028: the client supplies the Level on create.
  ["client supplies the Character Level", "apps/studio/app/api/characters/route.ts", replace('readStrictBody(request, ["name", "concept", "rulesetReleaseId"])', 'readStrictBody(request, ["name", "concept", "rulesetReleaseId", "level"])'), studio],
  // 13 · M6-I023: derived Maximum HP persisted as authoritative source data.
  ["derived Maximum HP persisted on the Character", SCHEMA, replace("  level Int @default(1)\n", "  level Int @default(1)\n\n  maximumHp Int? @map(\"maximum_hp\")\n"), studio],
  // 14 · M6-I029: a derived formula duplicated in Studio.
  ["derived formula duplicated in Studio", `${UI}/_components/CharacterReview.tsx`, append("export const maximumHp = (baseHp: number, con: number) => baseHp + con;"), studio],
  // 15 · M6-I027: Race list hard-coded in the UI.
  ["Race list hard-coded in the Character UI", `${UI}/_components/CharacterWizard.tsx`, append('export const RACES = ["Orcani", "Human"];'), studio],
  // 16 · M6-I027: Skill list hard-coded in the UI.
  ["Skill list hard-coded in the Character UI", `${UI}/_components/CharacterWizard.tsx`, append('export const SKILLS = ["Athletics", "Survival"];'), studio],
  // 17 · M6-I027: Affinity list hard-coded in the UI.
  ["Affinity list hard-coded in the Character UI", `${UI}/_components/CharacterWizard.tsx`, append('export const AFFINITIES = ["Evocation"];'), studio],
  // 18 · M6-I025: a completed Character's mechanical build stays editable.
  ["finalized mechanical build remains editable", SERVICE, replace('  const c = await requireCharacter(id);\n  if (c.coreCreationCompletedAt !== null) explain({ outcome: "frozen" }, id);\n  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);\n  const result = validateCharacterCreation({ bundle, ruleset, candidate: readCandidate(input.candidate) });', "  const c = await requireCharacter(id);\n  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);\n  const result = validateCharacterCreation({ bundle, ruleset, candidate: readCandidate(input.candidate) });"), studio],
  // 19 · M6-I024: a Character stored as an EntityVersion.
  ["Character stored as an EntityVersion", REPO, append("export const storeAsEntity = (entityId: string) => prisma.entityVersion.create({ data: { entityId, revisionNumber: 1, displayName: \"Character\", structuredData: {} } });"), studio],
  // 20 · M6-I026: a creation save is no longer one transaction.
  ["non-atomic Character creation save", REPO, replace("  return inTransaction(async (tx) => {\n    const claimed = await claim(tx, id, expected, false, {", "  return runEach(async (tx) => {\n    const claimed = await claim(tx, id, expected, false, {"), studio],
  // 21 · M6-I026: a stale lockVersion is accepted.
  ["stale lockVersion accepted", REPO, replace("where: { id, lockVersion: expected, ...(allowFrozen ? {} : { coreCreationCompletedAt: null }) },", "where: { id, ...(allowFrozen ? {} : { coreCreationCompletedAt: null }) },"), studio],
  // 22 · M6-I021: the Release may change after creation (database guard removed).
  ["Character Release changeable after creation", MIGRATION, replace("    RAISE EXCEPTION 'CHARACTER_RELEASE_IMMUTABLE: a Character''s Release cannot change after creation' USING ERRCODE = 'check_violation';", "    NULL;"), studio],
  // 23 · §84: an unsupported Ancestry schema version becomes readable.
  ["unsupported Ancestry schema version accepted", FAMILIES, replace('  ANCESTRY: active("ANCESTRY"),', '  ANCESTRY: { ...active("ANCESTRY"), schemaVersions: [1, 2] },'), game],
  // 24 · §84: another existing Definition kind changes while the registry is extended.
  ["another Definition kind changed with the activation", FAMILIES, replace('  RANK_LADDER: active("SKILL"),', '  RANK_LADDER: active("CHARACTER"),'), game],
  // 25 · Layering: the Character frontend imports the database package.
  ["Character UI imports the database package", `${UI}/_components/CharacterIndex.tsx`, replace('import Link from "next/link";', 'import Link from "next/link";\nimport { listCharacters as dbList } from "@prowess/db";\nvoid dbList;'), studio],
  // 26 · §7: completion no longer verifies the Release Manifest.
  ["finalization skips Release integrity verification", SERVICE, replace("  const verification = await verifyRulesetReleaseManifestHash(c.rulesetReleaseId);\n  if (!verification.valid)", "  const verification = { valid: true };\n  if (!verification.valid)"), studio],
  // 27 · §20: a non-executable Affinity becomes a Primary Affinity.
  ["non-executable Affinity accepted", CREATION, replace("      if (!(EXECUTABLE_AFFINITY_SCHEMA_VERSIONS as readonly number[]).includes(e.schemaVersion)) add(E.AFFINITY_NOT_EXECUTABLE", "      if (false) add(E.AFFINITY_NOT_EXECUTABLE"), game],
  // 28 · §49 / §102: Rules Reference links lose the exact Release.
  ["Character rule links drop the exact Release", `${UI}/_components/CharacterReview.tsx`, replace("<Link href={entryHref(release.rulesetId, release.id, refDto.entityId)}", "<Link href={`/compendium/entities/${refDto.entityId}`}"), studio],
];

runControls({
  root,
  title: "M6-WO3",
  controls: controls.map(([name, file, mutate, guard]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO3 controls caught and restored.`,
});
