import { CHARACTER_ERROR_CODES } from "@prowess/model";
import { buildCharacterAttackLibrary, buildCharacterSheetMechanics, validateSheetPlayState, type CharacterAttack, type CharacterSheetMechanics, type ProwessDefinitionRef, type SheetResource } from "@prowess/game";
import { checkPortraitImage, PORTRAIT_MAX_BYTES } from "./portrait-image.js";
import { libraryRefs, loadEquippedCharacter, loadoutSummary, type CharacterWeaponsView } from "./weapon-service.js";
import { clearPortrait, selectPortraitImage, selectSheetState, writePlayState, writePortraitFraming, writePortraitImage, writeSheetNotes, type SheetWriteOutcome, type StoredSheetState } from "./sheet-repository.js";
import { choicesOf, fail, namesOf, releaseSummary, requireCharacter, type CharacterReleaseSummary } from "./service.js";
import { signatureSpellsForSheet, type SheetSignatureSpell } from "./signature-spell-service.js";
import { signatureManeuversForSheet } from "./signature-maneuver-service.js";

/**
 * Digital Character Sheet service (PAS-10 M6-WO5). Orchestration and persistence only:
 *
 *   Character + exact Release → CharacterMechanicalProfile (M6-WO4, the one builder) → @prowess/game sheet mechanics
 *   + mutable play state / sheet text / portrait framing → ONE CharacterSheetView
 *
 * Nothing here computes a rule. Maximums, ranks, scores and every derived value come from @prowess/game; the client
 * submits only current resource values, player text and portrait framing. Creation choices, the Level and advancement
 * are never written here (they stay with M6-WO3 / M6-WO4). Notes are player text and never read as mechanics.
 */

export const SHEET_TEXT_LIMITS = { companyPac: 120, actionNotes: 20_000, characterNotes: 20_000, possessions: 200, category: 60, item: 200, weight: 20 } as const;

export interface CharacterSheetView {
  readonly identity: {
    readonly id: string;
    readonly name: string;
    readonly concept: string | null;
    readonly level: number;
    readonly maximumLevel: number;
    readonly status: "CORE_COMPLETE";
    /** Presented as "Species" on the sheet; the domain stays the ANCESTRY Definition. */
    readonly ancestry: ProwessDefinitionRef | null;
    readonly primaryAffinity: ProwessDefinitionRef | null;
    readonly companyPac: string | null;
  };
  readonly release: CharacterReleaseSummary;
  readonly portrait: {
    readonly hasImage: boolean;
    readonly mimeType: string | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly zoom: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly version: number;
    /** Served by the application (never a public file path); the content hash makes each image URL immutable. */
    readonly imageUrl: string | null;
    readonly maxBytes: number;
  };
  readonly mechanics: CharacterSheetMechanics;
  /** Current values: stored ones, or the derived maximum for a resource never set (not written by a read). */
  readonly resources: ReadonlyArray<SheetResource & { readonly current: number | null; readonly stored: boolean }>;
  readonly playStateVersion: number;
  readonly notes: {
    readonly actionNotes: string;
    readonly characterNotes: string;
    readonly possessions: ReadonlyArray<{ readonly category: string; readonly item: string; readonly weight: string }>;
    readonly version: number;
    readonly limits: typeof SHEET_TEXT_LIMITS;
  };
  /** Structured effects currently applying. No persisted Character effect instances exist yet (M5-WO13 owns the lifecycle). */
  readonly grantedEffects: readonly never[];
  /**
   * M6-WO6: the Weapon loadout (Main-hand / Off-hand) from the Character's exact Release. Armor and Accessories stay
   * outside WO6 (placeholders). `available` is false when the Release offers no coherent Weapon Library.
   */
  readonly equipment: {
    readonly available: boolean;
    readonly mainHand: CharacterWeaponsView["loadout"]["mainHand"];
    readonly offHand: CharacterWeaponsView["loadout"]["offHand"];
    readonly loadoutVersion: number;
    readonly loadoutStatus: CharacterWeaponsView["loadout"]["status"];
    readonly loadoutIssues: CharacterWeaponsView["loadout"]["issues"];
    readonly armor: null;
    readonly accessorySlots: number | null;
    readonly accessories: readonly never[];
  };
  /** M6-WO6: compact Weapon Attack rows for the Actions panel (Unarmed, Main-hand, Off-hand) — previews, never rolls. */
  readonly weaponAttacks: readonly CharacterAttack[];
  readonly dualWield: { readonly available: boolean; readonly reasons: readonly string[] };
  /** M6-WO7: compact Signature Spell lines (the current revision of each active Spell) — previews, never cast. */
  readonly signatureSpells: readonly SheetSignatureSpell[];
  readonly signatureManeuvers: Awaited<ReturnType<typeof signatureManeuversForSheet>>["maneuvers"];
  readonly advancementHistoryCount: number;
  readonly names: Readonly<Record<string, string>>;
}

function refFrom(bundle: { definitions: readonly { entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string; systemFamily: string }[] }, sel: { entityId: string; entityVersionId: string } | null): ProwessDefinitionRef | null {
  if (sel === null) return null;
  const d = bundle.definitions.find((x) => x.entityId === sel.entityId && x.entityVersionId === sel.entityVersionId);
  return d === undefined ? null : ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily } as ProwessDefinitionRef);
}

const possessionsOf = (raw: unknown): CharacterSheetView["notes"]["possessions"] =>
  Array.isArray(raw)
    ? raw.flatMap((p) => (typeof p === "object" && p !== null ? [{ category: String((p as Record<string, unknown>).category ?? ""), item: String((p as Record<string, unknown>).item ?? ""), weight: String((p as Record<string, unknown>).weight ?? "") }] : []))
    : [];

async function loadSheet(id: string) {
  // M6-WO6: the ONE profile, with the equipped Weapons' additive equipment context (unequipped ⇒ the M6-WO5 profile).
  const state = await loadEquippedCharacter(id);
  const { c, bundle, ruleset, history, profile } = state;
  const mechanics = buildCharacterSheetMechanics({ bundle, ruleset, profile });
  return { c, bundle, profile, mechanics, history, state };
}

function resourcesOf(mechanics: CharacterSheetMechanics, state: StoredSheetState): CharacterSheetView["resources"] {
  return mechanics.resources.map((r) => {
    const stored = state.playState?.resources.find((x) => x.resourceKey === r.resourceKey);
    return { ...r, current: stored?.current ?? r.maximum, stored: stored !== undefined };
  });
}

/** The whole Character Sheet in ONE read (§79). Read-only: it never creates play state. */
export async function getCharacterSheet(id: string): Promise<CharacterSheetView> {
  const { c, bundle, profile, mechanics, history, state: equipped } = await loadSheet(id);
  const state = await selectSheetState(c.id);
  const library = buildCharacterAttackLibrary({ bundle, characterProfile: equipped.base, loadout: equipped.choice });
  const weaponAttacks = [...(library.unarmed?.attacks ?? []), ...(library.mainHand?.attacks ?? []), ...(library.offHand?.attacks ?? [])];
  const loadout = loadoutSummary(equipped);
  const choices = choicesOf(c);
  const ancestry = refFrom(bundle, choices.ancestry);
  const primaryAffinity = refFrom(bundle, choices.primaryAffinity);
  const spells = await signatureSpellsForSheet(c.id);
  const maneuvers = await signatureManeuversForSheet(c.id);
  const portrait = state.portrait;
  const hasImage = portrait !== null && portrait.mimeType !== null && portrait.contentHash !== null;
  const names = await namesOf([ancestry, primaryAffinity, ...mechanics.skills.map((s) => s.skill), ...mechanics.affinities.map((a) => a.affinity), ...mechanics.resources.map((r) => r.definition), ...libraryRefs(library), ...spells.refs, ...maneuvers.refs]);
  return {
    identity: { id: c.id, name: c.name, concept: c.concept, level: profile.level, maximumLevel: profile.maximumLevel, status: "CORE_COMPLETE", ancestry, primaryAffinity, companyPac: state.notes?.companyPac ?? null },
    release: await releaseSummary(c.rulesetReleaseId),
    portrait: {
      hasImage,
      mimeType: hasImage ? portrait.mimeType : null,
      width: hasImage ? portrait.width : null,
      height: hasImage ? portrait.height : null,
      zoom: portrait?.zoom ?? 1,
      offsetX: portrait?.offsetX ?? 0,
      offsetY: portrait?.offsetY ?? 0,
      version: portrait?.lockVersion ?? 0,
      imageUrl: hasImage ? `/api/characters/${encodeURIComponent(c.id)}/portrait/image?v=${(portrait.contentHash as string).slice(0, 16)}` : null,
      maxBytes: PORTRAIT_MAX_BYTES,
    },
    mechanics,
    resources: resourcesOf(mechanics, state),
    playStateVersion: state.playState?.lockVersion ?? 0,
    notes: { actionNotes: state.notes?.actionNotes ?? "", characterNotes: state.notes?.characterNotes ?? "", possessions: possessionsOf(state.notes?.possessions), version: state.notes?.lockVersion ?? 0, limits: SHEET_TEXT_LIMITS },
    grantedEffects: [],
    equipment: {
      available: library.capability.weaponLibrary.status === "WEAPON_LIBRARY_READY",
      mainHand: loadout.mainHand,
      offHand: loadout.offHand,
      loadoutVersion: loadout.version,
      loadoutStatus: loadout.status,
      loadoutIssues: loadout.issues,
      armor: null,
      accessorySlots: mechanics.attunement.maximum.value,
      accessories: [],
    },
    weaponAttacks,
    dualWield: { available: library.dualWield.available, reasons: library.dualWield.reasons },
    signatureSpells: spells.spells,
    signatureManeuvers: maneuvers.maneuvers,
    advancementHistoryCount: history.length,
    names,
  };
}

function readVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "expectedVersion is a non-negative whole number (0 when nothing has been saved yet)");
  return value;
}

function stale(outcome: SheetWriteOutcome | { readonly outcome: "no_image" }, what: string): number {
  if (outcome.outcome === "ok") return outcome.version;
  if (outcome.outcome === "no_image") throw fail(CHARACTER_ERROR_CODES.PORTRAIT_NOT_FOUND, "This Character has no portrait image");
  throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, `This Character's ${what} changed since it was loaded (now at version ${outcome.current}). Reload and try again.`);
}

/**
 * Updates CURRENT resource values (§31–§35). Only `{ RESOURCE_KEY: current }` is accepted; each is validated by
 * @prowess/game against the Release's minimum and the derived maximum and refused (never clamped) when out of range.
 */
export async function updateCharacterPlayState(id: string, input: { readonly expectedVersion: unknown; readonly resources: unknown }): Promise<CharacterSheetView> {
  const expected = readVersion(input.expectedVersion);
  const { c, mechanics } = await loadSheet(id);
  const issues = validateSheetPlayState({ resources: mechanics.resources, values: input.resources });
  if (issues.length > 0) throw fail(CHARACTER_ERROR_CODES.INVALID_PLAY_STATE, issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  const values = Object.entries(input.resources as Record<string, number>).map(([resourceKey, current]) => ({ resourceKey, current }));
  if (values.length === 0) throw fail(CHARACTER_ERROR_CODES.INVALID_PLAY_STATE, "name at least one resource to update");
  const initial = mechanics.resources.flatMap((r) => (r.maximum === null ? [] : [{ resourceKey: r.resourceKey, current: r.maximum }]));
  stale(await writePlayState(c.id, expected, values, initial), "play state");
  return getCharacterSheet(c.id);
}

const text = (value: unknown, field: string, max: number, nullable = false): string | null => {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string") throw fail(CHARACTER_ERROR_CODES.INVALID_SHEET_NOTES, `${field} is text`);
  if (value.length > max) throw fail(CHARACTER_ERROR_CODES.INVALID_SHEET_NOTES, `${field} is at most ${max} characters`);
  return value;
};

/** Saves the player-written sheet text. It is stored and shown exactly as written and never read as mechanics. */
export async function updateCharacterSheetNotes(id: string, input: { readonly expectedVersion: unknown; readonly companyPac?: unknown; readonly actionNotes: unknown; readonly characterNotes: unknown; readonly possessions: unknown }): Promise<CharacterSheetView> {
  const expected = readVersion(input.expectedVersion);
  const L = SHEET_TEXT_LIMITS;
  const companyPac = text(input.companyPac, "companyPac", L.companyPac, true);
  const actionNotes = text(input.actionNotes, "actionNotes", L.actionNotes) as string;
  const characterNotes = text(input.characterNotes, "characterNotes", L.characterNotes) as string;
  if (!Array.isArray(input.possessions) || input.possessions.length > L.possessions) throw fail(CHARACTER_ERROR_CODES.INVALID_SHEET_NOTES, `possessions is a list of at most ${L.possessions} rows`);
  const possessions = input.possessions.map((row: unknown, i: number) => {
    if (typeof row !== "object" || row === null || Array.isArray(row) || Object.keys(row).some((k) => !["category", "item", "weight"].includes(k))) throw fail(CHARACTER_ERROR_CODES.INVALID_SHEET_NOTES, `possessions[${i}] is { category, item, weight }`);
    const r = row as Record<string, unknown>;
    return { category: text(r.category ?? "", `possessions[${i}].category`, L.category) as string, item: text(r.item ?? "", `possessions[${i}].item`, L.item) as string, weight: text(r.weight ?? "", `possessions[${i}].weight`, L.weight) as string };
  });
  const c = await requireCharacter(id);
  if (c.coreCreationCompletedAt === null) throw fail(CHARACTER_ERROR_CODES.CORE_CREATION_INCOMPLETE, "The Character Sheet is available once core creation is complete");
  stale(await writeSheetNotes(c.id, expected, { companyPac, actionNotes, characterNotes, possessions }), "sheet notes");
  return getCharacterSheet(c.id);
}

/** Uploads or replaces the portrait: validated (size, signature, full decode), stored unmodified, framing reset. */
export async function uploadCharacterPortrait(id: string, input: { readonly expectedVersion: unknown; readonly bytes: Uint8Array; readonly declaredType: string | null }): Promise<CharacterSheetView> {
  const expected = readVersion(input.expectedVersion);
  const c = await requireCharacter(id);
  if (c.coreCreationCompletedAt === null) throw fail(CHARACTER_ERROR_CODES.CORE_CREATION_INCOMPLETE, "The Character Sheet is available once core creation is complete");
  const checked = await checkPortraitImage(input.bytes, input.declaredType);
  if (!checked.ok) throw fail(checked.reason === "TOO_LARGE" ? CHARACTER_ERROR_CODES.PORTRAIT_TOO_LARGE : CHARACTER_ERROR_CODES.INVALID_PORTRAIT, checked.message);
  stale(await writePortraitImage(c.id, expected, { mimeType: checked.mimeType, byteSize: checked.byteSize, width: checked.width, height: checked.height, contentHash: checked.contentHash, bytes: input.bytes }), "portrait");
  return getCharacterSheet(c.id);
}

const framingNumber = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw fail(CHARACTER_ERROR_CODES.INVALID_PORTRAIT, `${field} is a number from ${min} to ${max}`);
  return value;
};

/** Saves the portrait framing (zoom ≥ 1, offsets in [-1, 1]); the stored source image is never changed. */
export async function updateCharacterPortraitFraming(id: string, input: { readonly expectedVersion: unknown; readonly zoom: unknown; readonly offsetX: unknown; readonly offsetY: unknown }): Promise<CharacterSheetView> {
  const expected = readVersion(input.expectedVersion);
  const framing = { zoom: framingNumber(input.zoom, "zoom", 1, 5), offsetX: framingNumber(input.offsetX, "offsetX", -1, 1), offsetY: framingNumber(input.offsetY, "offsetY", -1, 1) };
  const c = await requireCharacter(id);
  stale(await writePortraitFraming(c.id, expected, framing), "portrait");
  return getCharacterSheet(c.id);
}

export async function removeCharacterPortrait(id: string, input: { readonly expectedVersion: unknown }): Promise<CharacterSheetView> {
  const expected = readVersion(input.expectedVersion);
  const c = await requireCharacter(id);
  stale(await clearPortrait(c.id, expected), "portrait");
  return getCharacterSheet(c.id);
}

/** The stored portrait bytes for the application's own image route (never a public file path). */
export async function getCharacterPortraitImage(id: string): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string; readonly contentHash: string }> {
  const c = await requireCharacter(id);
  const image = await selectPortraitImage(c.id);
  if (image === null) throw fail(CHARACTER_ERROR_CODES.PORTRAIT_NOT_FOUND, "This Character has no portrait image");
  return image;
}
