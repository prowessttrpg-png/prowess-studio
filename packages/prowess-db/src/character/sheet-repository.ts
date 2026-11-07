import { prisma } from "../client.js";

/**
 * Character Sheet state persistence (PAS-10 M6-WO5) — the only module that reads or writes the sheet tables:
 * play state (current resources), sheet notes, and the portrait (metadata + framing, with the source bytes in their own
 * table). It never writes the Character row, creation rows or advancement history. Every write is an atomic
 * compare-and-set on that row's own lockVersion; `expected = 0` means "no row yet" and creates it (a concurrent create
 * loses on the primary key and is reported stale).
 */

export type SheetWriteOutcome = { readonly outcome: "ok"; readonly version: number } | { readonly outcome: "stale"; readonly current: number };

export interface StoredPortrait {
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly contentHash: string | null;
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly lockVersion: number;
}

export interface StoredSheetState {
  readonly playState: { readonly lockVersion: number; readonly resources: ReadonlyArray<{ readonly resourceKey: string; readonly current: number }> } | null;
  readonly notes: { readonly companyPac: string | null; readonly actionNotes: string; readonly characterNotes: string; readonly possessions: unknown; readonly lockVersion: number } | null;
  readonly portrait: StoredPortrait | null;
}

const PORTRAIT_FIELDS = { mimeType: true, byteSize: true, width: true, height: true, contentHash: true, zoom: true, offsetX: true, offsetY: true, lockVersion: true } as const;

/** The Character's sheet state (no image bytes), read in one consistent snapshot. */
export async function selectSheetState(characterId: string): Promise<StoredSheetState> {
  const [playState, notes, portrait] = await prisma.$transaction(
    [
      prisma.characterPlayState.findUnique({ where: { characterId }, select: { lockVersion: true, resources: { select: { resourceKey: true, current: true }, orderBy: { resourceKey: "asc" } } } }),
      prisma.characterSheetNotes.findUnique({ where: { characterId }, select: { companyPac: true, actionNotes: true, characterNotes: true, possessions: true, lockVersion: true } }),
      prisma.characterPortrait.findUnique({ where: { characterId }, select: PORTRAIT_FIELDS }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return { playState, notes, portrait };
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

class Stale extends Error {
  constructor(readonly current: number) {
    super("stale");
  }
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Runs `write` in one transaction; a lost create race or a missed compare-and-set is `stale`. */
async function atomically(read: () => Promise<number>, write: (tx: Tx) => Promise<number>): Promise<SheetWriteOutcome> {
  try {
    return { outcome: "ok", version: await prisma.$transaction(write) };
  } catch (e) {
    if (e instanceof Stale) return { outcome: "stale", current: e.current };
    if (isUniqueViolation(e)) return { outcome: "stale", current: await read() };
    throw e;
  }
}

/**
 * Writes current resource values. `initial` (only used when the row is created) fills every sheet resource the
 * request does not name, so a created play state is complete; afterwards only the named resources change.
 */
export async function writePlayState(characterId: string, expected: number, values: ReadonlyArray<{ readonly resourceKey: string; readonly current: number }>, initial: ReadonlyArray<{ readonly resourceKey: string; readonly current: number }>): Promise<SheetWriteOutcome> {
  const read = async () => (await prisma.characterPlayState.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0;
  return atomically(read, async (tx) => {
    if (expected === 0) {
      const named = new Set(values.map((v) => v.resourceKey));
      await tx.characterPlayState.create({ data: { characterId } });
      await tx.characterResourceState.createMany({ data: [...values, ...initial.filter((i) => !named.has(i.resourceKey))].map((v) => ({ characterId, resourceKey: v.resourceKey, current: v.current })) });
      return 1;
    }
    const next = expected + 1;
    const claimed = await tx.characterPlayState.updateMany({ where: { characterId, lockVersion: expected }, data: { lockVersion: next, updatedAt: new Date() } });
    if (claimed.count !== 1) throw new Stale((await tx.characterPlayState.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0);
    for (const v of values) await tx.characterResourceState.upsert({ where: { characterId_resourceKey: { characterId, resourceKey: v.resourceKey } }, create: { characterId, resourceKey: v.resourceKey, current: v.current }, update: { current: v.current } });
    return next;
  });
}

/**
 * PAS-10 M6-WO10: the SAME current-value compare-and-set, inside a caller's transaction, so the Play Workspace commits
 * resources, its runtime state and its ledger event atomically (one resource authority; no second write path for the
 * values). Returns the new version, or null when `expected` is not the stored version (the caller aborts its transaction).
 */
export async function writePlayStateWithin(tx: Tx, characterId: string, expected: number, values: ReadonlyArray<{ readonly resourceKey: string; readonly current: number }>, initial: ReadonlyArray<{ readonly resourceKey: string; readonly current: number }>): Promise<number | null> {
  if (expected === 0) {
    if ((await tx.characterPlayState.count({ where: { characterId } })) !== 0) return null;
    const named = new Set(values.map((v) => v.resourceKey));
    await tx.characterPlayState.create({ data: { characterId } });
    await tx.characterResourceState.createMany({ data: [...values, ...initial.filter((i) => !named.has(i.resourceKey))].map((v) => ({ characterId, resourceKey: v.resourceKey, current: v.current })) });
    return 1;
  }
  const next = expected + 1;
  const claimed = await tx.characterPlayState.updateMany({ where: { characterId, lockVersion: expected }, data: { lockVersion: next, updatedAt: new Date() } });
  if (claimed.count !== 1) return null;
  for (const v of values) await tx.characterResourceState.upsert({ where: { characterId_resourceKey: { characterId, resourceKey: v.resourceKey } }, create: { characterId, resourceKey: v.resourceKey, current: v.current }, update: { current: v.current } });
  return next;
}

/** The sheet play-state version inside a caller's transaction (0 = never saved). */
export async function playStateVersionWithin(tx: Tx, characterId: string): Promise<number> {
  return (await tx.characterPlayState.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0;
}

export type SheetTx = Tx;

export interface SheetNotesInput {
  readonly companyPac: string | null;
  readonly actionNotes: string;
  readonly characterNotes: string;
  readonly possessions: ReadonlyArray<{ readonly category: string; readonly item: string; readonly weight: string }>;
}

export async function writeSheetNotes(characterId: string, expected: number, input: SheetNotesInput): Promise<SheetWriteOutcome> {
  const read = async () => (await prisma.characterSheetNotes.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0;
  const data = { companyPac: input.companyPac, actionNotes: input.actionNotes, characterNotes: input.characterNotes, possessions: input.possessions.map((p) => ({ category: p.category, item: p.item, weight: p.weight })) };
  return atomically(read, async (tx) => {
    if (expected === 0) {
      await tx.characterSheetNotes.create({ data: { characterId, ...data } });
      return 1;
    }
    const next = expected + 1;
    const claimed = await tx.characterSheetNotes.updateMany({ where: { characterId, lockVersion: expected }, data: { ...data, lockVersion: next, updatedAt: new Date() } });
    if (claimed.count !== 1) throw new Stale(await read());
    return next;
  });
}

export interface PortraitImageInput {
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly contentHash: string;
  readonly bytes: Uint8Array;
}

const readPortraitVersion = (characterId: string) => async () => (await prisma.characterPortrait.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0;

/** Stores (or replaces) the source image exactly as validated and resets the framing to the whole image. */
export async function writePortraitImage(characterId: string, expected: number, image: PortraitImageInput): Promise<SheetWriteOutcome> {
  const meta = { mimeType: image.mimeType, byteSize: image.byteSize, width: image.width, height: image.height, contentHash: image.contentHash, zoom: 1, offsetX: 0, offsetY: 0 };
  const bytes = Buffer.from(image.bytes);
  return atomically(readPortraitVersion(characterId), async (tx) => {
    if (expected === 0) {
      await tx.characterPortrait.create({ data: { characterId, ...meta } });
      await tx.characterPortraitImage.create({ data: { characterId, bytes } });
      return 1;
    }
    const next = expected + 1;
    const claimed = await tx.characterPortrait.updateMany({ where: { characterId, lockVersion: expected }, data: { ...meta, lockVersion: next, updatedAt: new Date() } });
    if (claimed.count !== 1) throw new Stale((await tx.characterPortrait.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0);
    await tx.characterPortraitImage.upsert({ where: { characterId }, create: { characterId, bytes }, update: { bytes } });
    return next;
  });
}

/** Changes only the framing (zoom / offsets) of an existing image — the source bytes are never touched. */
export async function writePortraitFraming(characterId: string, expected: number, framing: { readonly zoom: number; readonly offsetX: number; readonly offsetY: number }): Promise<SheetWriteOutcome | { readonly outcome: "no_image" }> {
  const row = await prisma.characterPortrait.findUnique({ where: { characterId }, select: { mimeType: true } });
  if (row === null || row.mimeType === null) return { outcome: "no_image" };
  return atomically(readPortraitVersion(characterId), async (tx) => {
    const next = expected + 1;
    const claimed = await tx.characterPortrait.updateMany({ where: { characterId, lockVersion: expected, mimeType: { not: null } }, data: { zoom: framing.zoom, offsetX: framing.offsetX, offsetY: framing.offsetY, lockVersion: next, updatedAt: new Date() } });
    if (claimed.count !== 1) throw new Stale((await tx.characterPortrait.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0);
    return next;
  });
}

/** Removes the image (bytes deleted, metadata cleared). The framing row stays so its version keeps increasing. */
export async function clearPortrait(characterId: string, expected: number): Promise<SheetWriteOutcome | { readonly outcome: "no_image" }> {
  const row = await prisma.characterPortrait.findUnique({ where: { characterId }, select: { mimeType: true } });
  if (row === null || row.mimeType === null) return { outcome: "no_image" };
  return atomically(readPortraitVersion(characterId), async (tx) => {
    const next = expected + 1;
    const claimed = await tx.characterPortrait.updateMany({
      where: { characterId, lockVersion: expected },
      data: { mimeType: null, byteSize: null, width: null, height: null, contentHash: null, zoom: 1, offsetX: 0, offsetY: 0, lockVersion: next, updatedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Stale((await tx.characterPortrait.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0);
    await tx.characterPortraitImage.deleteMany({ where: { characterId } });
    return next;
  });
}

/** The stored source image and its type (null when the Character has none). */
export async function selectPortraitImage(characterId: string): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string; readonly contentHash: string } | null> {
  const row = await prisma.characterPortrait.findUnique({ where: { characterId }, select: { mimeType: true, contentHash: true, image: { select: { bytes: true } } } });
  if (row === null || row.mimeType === null || row.contentHash === null || row.image === null) return null;
  return { bytes: new Uint8Array(row.image.bytes), mimeType: row.mimeType, contentHash: row.contentHash };
}
