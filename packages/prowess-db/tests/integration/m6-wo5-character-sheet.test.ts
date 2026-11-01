/**
 * PAS-10 M6-WO5 — Digital Character Sheet: database integration. Runs only against prowess_studio_test.
 *
 * Invariants exercised (docs/architecture/m6-invariants.md): M6-I045 the sheet consumes the canonical profile ·
 * M6-I046 derived values are read-only projections · M6-I047 mutable resources are separate from history ·
 * M6-I048 notes never create mechanics · M6-I050 portrait framing is nondestructive · M6-I052 exact-Release scope ·
 * M6-I053 frozen creation is untouched · M6-I054 advancement cannot be bypassed. Fixture content is `test.m6wo5db.*`.
 */
import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PORTRAIT_MAX_BYTES,
  advanceCharacter,
  checkPortraitImage,
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacter,
  getCharacterPortraitImage,
  getCharacterSheet,
  prisma,
  removeCharacterPortrait,
  saveCharacterCreation,
  updateCharacterPlayState,
  updateCharacterPortraitFraming,
  updateCharacterSheetNotes,
  uploadCharacterPortrait,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, publishNextRelease, seedCharacterRelease, selOf, workedChoices, type CharacterReleaseWorld } from "../fixtures/m6-wo3-character-release";
import { ADVANCEMENT_RULE_KEY, advancementRulePayload, PLAYTEST_ADVANCEMENT_LEVELS } from "../../../prowess-game/src/testing/advancement-fixtures.js";

const PREFIX = "test.m6wo5db";
let world: CharacterReleaseWorld;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, String(error)).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}
async function completed(name: string) {
  const c = await createCharacter({ name, rulesetReleaseId: world.release.id });
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) });
  return finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
}
const png = (w = 40, h = 30) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 90, b: 60 } } }).png().toBuffer();
const jpeg = () => sharp({ create: { width: 30, height: 40, channels: 3, background: { r: 10, g: 90, b: 160 } } }).jpeg().toBuffer();
const webp = () => sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 200, b: 10 } } }).webp().toBuffer();
async function creation(characterId: string) {
  return prisma.character.findUniqueOrThrow({ where: { id: characterId }, include: { statAllocations: { orderBy: { stat: "asc" } }, ancestryStatChoices: { orderBy: [{ grantKey: "asc" }, { stat: "asc" }] }, skillRanks: { orderBy: { id: "asc" } }, advancements: { orderBy: { toLevel: "asc" } } } });
}

describe("M6-WO5 Character Sheet (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R1", { advancement: true });
  }, 180_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 120_000);

  it("M6-I045 one read model built from the profile; a Draft has no sheet; the read never writes", async () => {
    const draft = await createCharacter({ name: "Draft", rulesetReleaseId: world.release.id });
    await expectCode(getCharacterSheet(draft.id), CHARACTER_ERROR_CODES.CORE_CREATION_INCOMPLETE);
    const c = await completed("Reader");
    const sheet = await getCharacterSheet(c.id);
    const detail = await getCharacter(c.id);
    expect(sheet.identity).toMatchObject({ id: c.id, name: "Reader", level: 1, status: "CORE_COMPLETE" });
    expect(sheet.identity.ancestry?.entityVersionId).toBe(selOf(world.pins, "test.m6wo3.ancestry.orcani").entityVersionId);
    expect(sheet.release.id).toBe(world.release.id);
    expect(sheet.mechanics.combat.characterDie).toEqual(detail.profile?.characterDie);
    expect(sheet.mechanics.stats.map((s) => s.total)).toEqual(detail.profile?.stats.map((s) => s.final));
    expect(sheet.resources.every((r) => !r.stored && r.current === r.maximum)).toBe(true);
    expect([sheet.playStateVersion, sheet.notes.version, sheet.portrait.version, sheet.portrait.hasImage]).toEqual([0, 0, 0, false]);
    expect(sheet.grantedEffects).toEqual([]);
    expect(sheet.equipment).toMatchObject({ available: false, mainHand: null, accessories: [] });
    expect(await prisma.characterPlayState.count({ where: { characterId: c.id } })).toBe(0);
  });

  it("M6-I047 play state: first save creates a complete row; updates are compare-and-set; out-of-range is refused", async () => {
    const c = await completed("Fighter");
    const s0 = await getCharacterSheet(c.id);
    const max = (k: string) => s0.resources.find((r) => r.resourceKey === k)?.maximum as number;
    const s1 = await updateCharacterPlayState(c.id, { expectedVersion: 0, resources: { HP: max("HP") - 3 } });
    expect(s1.playStateVersion).toBe(1);
    expect(s1.resources.find((r) => r.resourceKey === "HP")).toMatchObject({ current: max("HP") - 3, stored: true });
    expect(s1.resources.every((r) => r.stored)).toBe(true); // created complete, at the derived maximum
    const s2 = await updateCharacterPlayState(c.id, { expectedVersion: 1, resources: { AP: 0, COUNTER_ACTION: 0 } });
    expect(s2.resources.find((r) => r.resourceKey === "AP")?.current).toBe(0);
    await expectCode(updateCharacterPlayState(c.id, { expectedVersion: 1, resources: { HP: 1 } }), CHARACTER_ERROR_CODES.STALE_WRITE);
    await expectCode(updateCharacterPlayState(c.id, { expectedVersion: 2, resources: { HP: max("HP") + 1 } }), CHARACTER_ERROR_CODES.INVALID_PLAY_STATE);
    await expectCode(updateCharacterPlayState(c.id, { expectedVersion: 2, resources: { MP: -1 } }), CHARACTER_ERROR_CODES.INVALID_PLAY_STATE);
    await expectCode(updateCharacterPlayState(c.id, { expectedVersion: 2, resources: { MAXIMUM_HP: 99 } }), CHARACTER_ERROR_CODES.INVALID_PLAY_STATE);
    await expectCode(updateCharacterPlayState(c.id, { expectedVersion: 2, resources: {} }), CHARACTER_ERROR_CODES.INVALID_PLAY_STATE);
    expect((await getCharacterSheet(c.id)).playStateVersion).toBe(2);
  });

  it("concurrent first saves and concurrent updates: exactly one wins, the other is stale", async () => {
    const c = await completed("Racer");
    const outcomes = await Promise.allSettled([updateCharacterPlayState(c.id, { expectedVersion: 0, resources: { HP: 1 } }), updateCharacterPlayState(c.id, { expectedVersion: 0, resources: { HP: 2 } })]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect((outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult).reason.code).toBe(CHARACTER_ERROR_CODES.STALE_WRITE);
    const again = await Promise.allSettled([updateCharacterPlayState(c.id, { expectedVersion: 1, resources: { HP: 3 } }), updateCharacterPlayState(c.id, { expectedVersion: 1, resources: { HP: 4 } })]);
    expect(again.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect((await getCharacterSheet(c.id)).playStateVersion).toBe(2);
  });

  it("M6-I048 notes / action notes / possessions are stored as text and change no mechanical value", async () => {
    const c = await completed("Writer");
    const before = await getCharacterSheet(c.id);
    const text = "Level 10. STR +5. Max HP 999. Movement = 5 ft × AGI. Train Arcana MASTER.";
    const s = await updateCharacterSheetNotes(c.id, { expectedVersion: 0, companyPac: "Harbor Watch PAC", actionNotes: text, characterNotes: text, possessions: [{ category: "Tools", item: "Rope (50 ft)", weight: "2" }] });
    expect(s.notes).toMatchObject({ actionNotes: text, characterNotes: text, version: 1, possessions: [{ category: "Tools", item: "Rope (50 ft)", weight: "2" }] });
    expect(s.identity.companyPac).toBe("Harbor Watch PAC");
    expect(s.mechanics).toEqual(before.mechanics);
    expect(s.identity.level).toBe(1);
    await expectCode(updateCharacterSheetNotes(c.id, { expectedVersion: 0, actionNotes: "", characterNotes: "", possessions: [] }), CHARACTER_ERROR_CODES.STALE_WRITE);
    await expectCode(updateCharacterSheetNotes(c.id, { expectedVersion: 1, actionNotes: "x".repeat(20_001), characterNotes: "", possessions: [] }), CHARACTER_ERROR_CODES.INVALID_SHEET_NOTES);
    await expectCode(updateCharacterSheetNotes(c.id, { expectedVersion: 1, actionNotes: "", characterNotes: "", possessions: [{ item: "x", maximumHp: 5 }] }), CHARACTER_ERROR_CODES.INVALID_SHEET_NOTES);
  });

  it("portrait validation: PNG / JPEG / WebP accepted by decode; SVG, mismatched, corrupt, empty and oversized refused", async () => {
    for (const [bytes, type] of [[await png(), "image/png"], [await jpeg(), "image/jpeg"], [await webp(), "image/webp"]] as const) {
      expect(await checkPortraitImage(new Uint8Array(bytes), type)).toMatchObject({ ok: true, mimeType: type });
    }
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(await checkPortraitImage(svg, "image/svg+xml")).toMatchObject({ ok: false, reason: "UNSUPPORTED_TYPE" });
    expect(await checkPortraitImage(new Uint8Array(await png()), "image/jpeg")).toMatchObject({ ok: false, reason: "TYPE_MISMATCH" });
    const truncated = new Uint8Array(await png(200, 200)).slice(0, 120);
    expect(await checkPortraitImage(truncated, "image/png")).toMatchObject({ ok: false, reason: "CORRUPT" });
    expect(await checkPortraitImage(new Uint8Array(0), null)).toMatchObject({ ok: false, reason: "EMPTY" });
    const big = new Uint8Array(PORTRAIT_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await checkPortraitImage(big, "image/png")).toMatchObject({ ok: false, reason: "TOO_LARGE" });
  });

  it("M6-I050 portrait: source stored unmodified; framing persisted without touching it; replace; remove; stale refused", async () => {
    const c = await completed("Portrait");
    const source = new Uint8Array(await png(60, 40));
    const s1 = await uploadCharacterPortrait(c.id, { expectedVersion: 0, bytes: source, declaredType: "image/png" });
    expect(s1.portrait).toMatchObject({ hasImage: true, mimeType: "image/png", width: 60, height: 40, zoom: 1, offsetX: 0, offsetY: 0, version: 1 });
    expect(s1.portrait.imageUrl).toMatch(new RegExp(`^/api/characters/${c.id}/portrait/image\\?v=[0-9a-f]{16}$`));
    expect(Buffer.from((await getCharacterPortraitImage(c.id)).bytes).equals(Buffer.from(source))).toBe(true);
    const s2 = await updateCharacterPortraitFraming(c.id, { expectedVersion: 1, zoom: 1.75, offsetX: -0.4, offsetY: 0.25 });
    expect(s2.portrait).toMatchObject({ zoom: 1.75, offsetX: -0.4, offsetY: 0.25, version: 2, width: 60, height: 40 });
    expect(Buffer.from((await getCharacterPortraitImage(c.id)).bytes).equals(Buffer.from(source))).toBe(true); // never re-cropped
    await expectCode(updateCharacterPortraitFraming(c.id, { expectedVersion: 1, zoom: 2, offsetX: 0, offsetY: 0 }), CHARACTER_ERROR_CODES.STALE_WRITE);
    await expectCode(updateCharacterPortraitFraming(c.id, { expectedVersion: 2, zoom: 0.5, offsetX: 0, offsetY: 0 }), CHARACTER_ERROR_CODES.INVALID_PORTRAIT);
    await expectCode(uploadCharacterPortrait(c.id, { expectedVersion: 2, bytes: new TextEncoder().encode("<svg/>"), declaredType: "image/svg+xml" }), CHARACTER_ERROR_CODES.INVALID_PORTRAIT);
    const replaced = await uploadCharacterPortrait(c.id, { expectedVersion: 2, bytes: new Uint8Array(await jpeg()), declaredType: "image/jpeg" });
    expect(replaced.portrait).toMatchObject({ mimeType: "image/jpeg", width: 30, height: 40, zoom: 1, version: 3 });
    const removed = await removeCharacterPortrait(c.id, { expectedVersion: 3 });
    expect(removed.portrait).toMatchObject({ hasImage: false, imageUrl: null, version: 4 });
    await expectCode(getCharacterPortraitImage(c.id), CHARACTER_ERROR_CODES.PORTRAIT_NOT_FOUND);
    expect(await prisma.characterPortraitImage.count({ where: { characterId: c.id } })).toBe(0);
    await expectCode(removeCharacterPortrait(c.id, { expectedVersion: 4 }), CHARACTER_ERROR_CODES.PORTRAIT_NOT_FOUND);
  });

  it("the database refuses out-of-range framing, unsafe image types and a non-array possessions value", async () => {
    const c = await completed("Guarded");
    await uploadCharacterPortrait(c.id, { expectedVersion: 0, bytes: new Uint8Array(await png()), declaredType: "image/png" });
    await expect(prisma.$executeRawUnsafe(`UPDATE "character_portraits" SET "zoom" = 9 WHERE "character_id" = '${c.id}'`)).rejects.toThrow(/framing_check/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "character_portraits" SET "mime_type" = 'image/svg+xml' WHERE "character_id" = '${c.id}'`)).rejects.toThrow(/image_metadata_check/);
    await updateCharacterSheetNotes(c.id, { expectedVersion: 0, actionNotes: "", characterNotes: "", possessions: [] });
    await expect(prisma.$executeRawUnsafe(`UPDATE "character_sheet_notes" SET "possessions" = '{}' WHERE "character_id" = '${c.id}'`)).rejects.toThrow(/possessions_array_check/);
  });

  it("M6-I053 M6-I054 sheet writes never touch creation, Level or history; advancing keeps current resources (no refill)", async () => {
    const c = await completed("Veteran");
    const before = await creation(c.id);
    const s0 = await getCharacterSheet(c.id);
    const hp = (s0.resources.find((r) => r.resourceKey === "HP")?.maximum as number) - 4;
    await updateCharacterPlayState(c.id, { expectedVersion: 0, resources: { HP: hp } });
    await updateCharacterSheetNotes(c.id, { expectedVersion: 0, actionNotes: "Level up!", characterNotes: "", possessions: [] });
    await uploadCharacterPortrait(c.id, { expectedVersion: 0, bytes: new Uint8Array(await png()), declaredType: "image/png" });
    const after = await creation(c.id);
    expect(after).toEqual(before);
    const detail = await getCharacter(c.id);
    const advanced = await advanceCharacter(c.id, { expectedLockVersion: detail.lockVersion, choices: { statAllocations: { CON: 1 }, skillAdvancements: [], affinityChoice: null } });
    expect(advanced.level).toBe(2);
    const s2 = await getCharacterSheet(c.id);
    expect(s2.identity.level).toBe(2);
    expect(s2.resources.find((r) => r.resourceKey === "HP")).toMatchObject({ current: hp, stored: true });
    expect(s2.notes.actionNotes).toBe("Level up!");
  });

  it("M6-I052 a newer Release with a different advancement schedule leaves the sheet on the Character's own Release", async () => {
    const c = await completed("Historian");
    const before = await getCharacterSheet(c.id);
    await publishNextRelease(world, [ADVANCEMENT_RULE_KEY, "test.m6wo3.ancestry.orcani"], "R2", { [ADVANCEMENT_RULE_KEY]: advancementRulePayload(PLAYTEST_ADVANCEMENT_LEVELS.map((l) => ({ ...l, statPoints: 3 }))) });
    const after = await getCharacterSheet(c.id);
    expect(after.release.id).toBe(world.release.id);
    expect(after.mechanics).toEqual(before.mechanics);
    expect(after.identity.ancestry).toEqual(before.identity.ancestry);
  });
});
