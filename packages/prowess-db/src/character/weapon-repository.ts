import { prisma } from "../client.js";

/**
 * Character Weapon loadout persistence (PAS-10 M6-WO6) — the only module that reads or writes
 * `character_weapon_loadouts`. It stores the loadout CHOICE only (exact Weapon Entity + EntityVersion per hand and the
 * explicit Versatile grip) and never writes the Character row, creation rows, advancement history or sheet state.
 * Every write is an atomic compare-and-set on the row's lockVersion; `expected = 0` means "no row yet" and creates it
 * (a concurrent create loses on the primary key and is reported stale).
 */

export interface StoredWeaponLoadout {
  readonly mainHand: { readonly entityId: string; readonly entityVersionId: string } | null;
  readonly mainHandGrip: "ONE_HANDED" | "TWO_HANDED" | null;
  readonly offHand: { readonly entityId: string; readonly entityVersionId: string } | null;
  readonly lockVersion: number;
}

export type LoadoutWriteOutcome = { readonly outcome: "ok"; readonly version: number } | { readonly outcome: "stale"; readonly current: number };

const pair = (entityId: string | null, entityVersionId: string | null) => (entityId === null || entityVersionId === null ? null : { entityId, entityVersionId });

/** The Character's stored loadout choice, or null when none was ever saved (an empty loadout). */
export async function selectWeaponLoadout(characterId: string): Promise<StoredWeaponLoadout | null> {
  const row = await prisma.characterWeaponLoadout.findUnique({ where: { characterId } });
  if (row === null) return null;
  return {
    mainHand: pair(row.mainHandEntityId, row.mainHandEntityVersionId),
    mainHandGrip: row.mainHandGrip === "ONE_HANDED" || row.mainHandGrip === "TWO_HANDED" ? row.mainHandGrip : null,
    offHand: pair(row.offHandEntityId, row.offHandEntityVersionId),
    lockVersion: row.lockVersion,
  };
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

class Stale extends Error {
  constructor(readonly current: number) {
    super("stale");
  }
}

/** Writes the loadout choice with a compare-and-set on `expected` (0 = create). */
export async function writeWeaponLoadout(characterId: string, expected: number, choice: Omit<StoredWeaponLoadout, "lockVersion">): Promise<LoadoutWriteOutcome> {
  const read = async () => (await prisma.characterWeaponLoadout.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0;
  const data = {
    mainHandEntityId: choice.mainHand?.entityId ?? null,
    mainHandEntityVersionId: choice.mainHand?.entityVersionId ?? null,
    mainHandGrip: choice.mainHandGrip,
    offHandEntityId: choice.offHand?.entityId ?? null,
    offHandEntityVersionId: choice.offHand?.entityVersionId ?? null,
  };
  try {
    const version = await prisma.$transaction(async (tx) => {
      if (expected === 0) {
        await tx.characterWeaponLoadout.create({ data: { characterId, ...data } });
        return 1;
      }
      const next = expected + 1;
      const claimed = await tx.characterWeaponLoadout.updateMany({ where: { characterId, lockVersion: expected }, data: { ...data, lockVersion: next, updatedAt: new Date() } });
      if (claimed.count !== 1) throw new Stale((await tx.characterWeaponLoadout.findUnique({ where: { characterId }, select: { lockVersion: true } }))?.lockVersion ?? 0);
      return next;
    });
    return { outcome: "ok", version };
  } catch (e) {
    if (e instanceof Stale) return { outcome: "stale", current: e.current };
    if (isUniqueViolation(e)) return { outcome: "stale", current: await read() };
    throw e;
  }
}
