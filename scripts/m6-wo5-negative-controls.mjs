/**
 * M6-WO5 negative / mutation controls (PAS-10 M6-WO5 §121) on the shared CLOSEOUT-03 harness: each control mutates REAL
 * source, the permanent M6-WO5 guard must FAIL for a behavioural reason, and the file is restored byte-for-byte.
 * Guards (one green baseline each): the pure mechanical-sheet suite (@prowess/game), and the M6-WO5 static gate with
 * the Digital Character Sheet UI suite (Studio). Invariants: M6-I045 … M6-I056.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = vitestGuard(root, "packages/prowess-game", ["src/character-sheet.test.ts"], { timeout: 300_000, ciEnv: false });
const studio = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo5-static.test.ts", "tests/unit/m6-wo5-sheet-ui.test.tsx"], { timeout: 300_000, ciEnv: false });
const replace = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `one exact mutation anchor: ${from}`);
  return text.replace(from, to);
};
const append = (extra) => (text) => `${text}\n${extra}\n`;

const GAME = "packages/prowess-game/src/character/sheet.ts";
const REPO = "packages/prowess-db/src/character/sheet-repository.ts";
const SERVICE = "packages/prowess-db/src/character/sheet-service.ts";
const PORTRAIT = "packages/prowess-db/src/character/portrait-image.ts";
const SCHEMA = "packages/prowess-db/prisma/schema.prisma";
const UI = "apps/studio/app/characters/_components/sheet";
const ROUTES = "apps/studio/app/api/characters/[characterId]";
const WO5_END = "// <<< M6-WO5 Character sheet state";

const controls = [
  // ---- Studio never calculates (M6-I046) ----
  // 1 · The frontend calculates a maximum.
  ["frontend calculates max HP", `${UI}/SheetPanels.tsx`, replace('          {r.maximum ?? "—"}', '          {r.maximum === null ? "—" : r.maximum + r.minimum}'), studio],
  // 2 · The frontend calculates a Skill score from the rank markers.
  ["frontend calculates Skill score", `${UI}/SheetPanels.tsx`, replace('<td data-testid="sheet-skill-score">{s.score === null ? "—" : signed(s.score)}</td>', '<td data-testid="sheet-skill-score">{signed(s.ranks.filter((r) => r.held).length * 2)}</td>'), studio],
  // 3 · The frontend computes a Save from the Stat total.
  ["frontend calculates a Save", `${UI}/SheetPanels.tsx`, replace("<Value v={s.savingThrow} sign testId={`sheet-save-${s.stat}`} />", "<Value v={{ ...s.savingThrow, value: s.total + 0 }} sign testId={`sheet-save-${s.stat}`} />"), studio],
  // 4 · Obsolete formula text printed on the sheet.
  ["print view uses obsolete hard-coded formula text", `${UI}/SheetPanels.tsx`, append('export const MOVEMENT_RULE_TEXT = "Movement = 5 ft × AGI";'), studio],
  // 5 · Obsolete terminology reintroduced.
  ["To-Hit terminology reintroduced", `${UI}/SheetPanels.tsx`, replace('["accuracy", "Accuracy", ', '["accuracy", "To-Hit", '), studio],
  // 6 · Portrait stretched to the frame.
  ["portrait source stretched", `${UI}/portrait-framing.ts`, replace("  const heightPct = imageAspect >= frameAspect ? 100 * zoom : 100 * zoom * (frameAspect / imageAspect);", "  const heightPct = 100 * zoom;"), studio],
  // 7 · The Sheet is no longer the default view.
  ["Sheet is not the default Character view", "apps/studio/app/characters/_components/CharacterSheetSummary.tsx", replace('const requested = useSearchParams()?.get("view") ?? "sheet";', 'const requested = useSearchParams()?.get("view") ?? "advancement";'), studio],
  // ---- Client / API inputs (M6-I046, M6-I054) ----
  // 8 · The client submits a maximum.
  ["client submits max HP", "apps/studio/app/characters/_lib/character-client.ts", replace("`/api/characters/${enc(id)}/play-state`, { expectedVersion, resources })", "`/api/characters/${enc(id)}/play-state`, { expectedVersion, resources, maximums: { HP: 99 } })"), studio],
  // 9 · The client may submit the Character Die.
  ["client submits Character Die", `${ROUTES}/play-state/route.ts`, replace('readStrictBody(request, ["expectedVersion", "resources"])', 'readStrictBody(request, ["expectedVersion", "resources", "characterDie"])'), studio],
  // 10 · The client may submit a Skill score (validation lets unknown keys through).
  ["client submits Skill Score", GAME, replace("      issues.push({ code: E.NOT_A_SHEET_RESOURCE, path: `resources.${key}`, message: `${key} is not a current-value resource of this Character's Release` });\n      continue;", "      continue;"), game],
  // 11 · The Level becomes editable from the sheet.
  ["Level editable directly", `${ROUTES}/notes/route.ts`, replace('readStrictBody(request, ["expectedVersion", "companyPac", "actionNotes", "characterNotes", "possessions"])', 'readStrictBody(request, ["expectedVersion", "companyPac", "actionNotes", "characterNotes", "possessions", "level"])'), studio],
  // 12 · Play-state validation skipped.
  ["play-state validation skipped", SERVICE, replace("  const issues = validateSheetPlayState({ resources: mechanics.resources, values: input.resources });", "  const issues: { path: string; message: string }[] = [];"), studio],
  // 13 · Overheal accepted (maximum not enforced).
  ["resource above its maximum accepted", GAME, replace('else if (numericCompare(`resource.${key}`, raw, "<=", r.maximum) !== true) issues.push({ code: E.ABOVE_MAXIMUM', 'else if (numericCompare(`resource.${key}`, raw, "<=", r.maximum) === null) issues.push({ code: E.ABOVE_MAXIMUM'), game],
  // ---- Exact Release and the one profile (M6-I045, M6-I052) ----
  // 14 · The sheet uses the latest Release.
  //      (Since M6-WO6 the sheet loads the Character through loadEquippedCharacter — the same exact-Release read.)
  ["sheet uses latest Release", SERVICE, replace("  const state = await loadEquippedCharacter(id);", "  const state = await loadEquippedCharacter(await latestCharacterRelease(id));"), studio],
  // 15 · The sheet rebuilds the profile itself.
  ["sheet rebuilds the mechanical profile", GAME, append("export const sheetProfile = (r: Parameters<typeof buildCharacterSheetMechanics>[0]) => buildCharacterMechanicalProfile({ bundle: r.bundle, ruleset: r.ruleset, character: { creation: {} as never, level: 1, history: [] } });"), studio],
  // 16 · Performance omitted despite being in the Release.
  ["Performance omitted despite being in Release", GAME, replace('for (const envelope of bundle.definitions.filter((d) => d.definitionKind === "SKILL")) {', 'for (const envelope of bundle.definitions.filter((d) => d.definitionKind === "SKILL" && !d.canonicalKey.includes("performance"))) {'), game],
  // 17 · An undefined value guessed instead of unavailable.
  ["unavailable Concentration guessed", GAME, replace("      concentration: { maximum: unavailable(`Concentration capacity: ${none}`) },", "      concentration: { maximum: { value: profile.level, unit: null, unavailable: null, source: null } },"), game],
  // 18 · A Skill score taken from the wrong rank.
  ["Skill score not from the exact rank", GAME, replace("      const entry = bonuses.find((b) => b.rankKey === rankKey);", "      const entry = bonuses.at(-1);"), game],
  // ---- Notes never create mechanics (M6-I048, M6-I049) ----
  // 19 · Character Notes alter the Level.
  ["notes alter mechanics", SERVICE, replace("level: profile.level, maximumLevel: profile.maximumLevel,", 'level: Number(state.notes?.characterNotes.match(/Level (\\d+)/)?.[1] ?? profile.level), maximumLevel: profile.maximumLevel,'), studio],
  // 20 · Action Notes feed the mechanical sheet.
  ["Action Notes alter mechanics", GAME, replace("export function buildCharacterSheetMechanics(request: { readonly bundle: ProwessDefinitionBundle; readonly ruleset: RulesetContext; readonly profile: CharacterMechanicalProfile }): CharacterSheetMechanics {", "export function buildCharacterSheetMechanics(request: { readonly bundle: ProwessDefinitionBundle; readonly ruleset: RulesetContext; readonly profile: CharacterMechanicalProfile; readonly actionNotes?: string }): CharacterSheetMechanics {"), studio],
  // ---- Frozen creation, advancement and history (M6-I047, M6-I053, M6-I054) ----
  // 21 · Frozen Ancestry editable through the sheet repository.
  ["frozen Ancestry editable", REPO, append("export const setAncestry = (id: string, ancestryEntityId: string) => prisma.character.update({ where: { id }, data: { ancestryEntityId } });"), studio],
  // 22 · Frozen starting Stats editable through the sheet repository.
  ["frozen starting Stats editable", REPO, append("export const setStat = (characterId: string, stat: string, pointsSpent: number) => prisma.characterStatAllocation.updateMany({ where: { characterId, stat }, data: { pointsSpent } });"), studio],
  // 23 · Affinity progression changed from the sheet (advancement bypassed).
  ["Affinity progression editable directly", SERVICE, append('export const quickAdvance = (id: string) => advanceCharacter(id, { expectedLockVersion: 1, choices: { statAllocations: {}, skillAdvancements: [], affinityChoice: { optionKey: "PRIMARY_EXPERT", affinity: null } } });'), studio],
  // 24 · Current resources stored in advancement history.
  ["current resources stored in advancement history", REPO, replace("    for (const v of values) await tx.characterResourceState.upsert(", "    await tx.characterAdvancement.updateMany({ where: { characterId }, data: { lockVersionBefore: next } });\n    for (const v of values) await tx.characterResourceState.upsert("), studio],
  // 25 · A stale resource write accepted.
  ["resource stale write accepted", REPO, replace("const claimed = await tx.characterPlayState.updateMany({ where: { characterId, lockVersion: expected }, data:", "const claimed = await tx.characterPlayState.updateMany({ where: { characterId }, data:"), studio],
  // 26 · A stale portrait write accepted.
  ["portrait stale write accepted", REPO, replace("const claimed = await tx.characterPortrait.updateMany({ where: { characterId, lockVersion: expected, mimeType: { not: null } }, data:", "const claimed = await tx.characterPortrait.updateMany({ where: { characterId, mimeType: { not: null } }, data:"), studio],
  // ---- Portrait safety and nondestructive framing (M6-I050, M6-I051) ----
  // 27 · Framing rewrites the source on every move.
  ["portrait transform destructively rewrites the source", REPO, replace("    const claimed = await tx.characterPortrait.updateMany({ where: { characterId, lockVersion: expected, mimeType: { not: null } }, data: { zoom: framing.zoom,", "    await tx.characterPortraitImage.updateMany({ where: { characterId }, data: { bytes: Buffer.alloc(0) } });\n    const claimed = await tx.characterPortrait.updateMany({ where: { characterId, lockVersion: expected, mimeType: { not: null } }, data: { zoom: framing.zoom,"), studio],
  // 28 · SVG accepted.
  ["SVG accepted unsafely", PORTRAIT, replace('export const PORTRAIT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;', 'export const PORTRAIT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;'), studio],
  // 29 · The size limit bypassed.
  ["portrait file-size limit bypassed", PORTRAIT, replace("  if (bytes.byteLength > PORTRAIT_MAX_BYTES) return { ok: false, reason: \"TOO_LARGE\"", "  if (false) return { ok: false, reason: \"TOO_LARGE\""), studio],
  // 30 · Portrait bytes placed on the main Character row.
  ["portrait bytes on the main Character row", SCHEMA, replace("  advancements         CharacterAdvancement[] // M6-WO4 back-relation\n", "  advancements         CharacterAdvancement[] // M6-WO4 back-relation\n  portraitBytes        Bytes? @map(\"portrait_bytes\") // M6-WO5 back-relation\n"), studio],
  // ---- Integration boundaries (M6-I055) ----
  // 31 · An equipment domain introduced early.
  ["equipment domain introduced prematurely", SCHEMA, replace(WO5_END, "model CharacterEquipmentSlot {\n  id String @id @db.Uuid\n  slot String\n}\n" + WO5_END), studio],
  // 32 · An ability domain introduced early.
  ["ability domain introduced prematurely", SCHEMA, replace(WO5_END, "model CharacterAbility {\n  id String @id @db.Uuid\n  name String\n}\n" + WO5_END), studio],
  // 33 · The image route serves without nosniff.
  ["portrait served without nosniff", `${ROUTES}/portrait/image/route.ts`, replace('        "X-Content-Type-Options": "nosniff",\n', ""), studio],
];

runControls({
  root,
  title: "M6-WO5",
  controls: controls.map(([name, file, mutate, guard]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO5 controls caught and restored.`,
});
