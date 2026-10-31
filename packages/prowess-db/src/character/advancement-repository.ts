import { prisma } from "../client.js";
import { CHARACTER_CHILDREN, type CharacterWithChildren, type WriteOutcome } from "./repository.js";

/**
 * Character advancement persistence (PAS-10 M6-WO4) — the only module that reads or writes the advancement tables.
 * Committed advancement history is APPEND-ONLY: this module inserts one advancement (with its Stat, Skill and Affinity
 * choice rows) and moves the Character exactly one Level, atomically, at exactly the version the caller loaded; it has
 * no update or delete of history. The Level-1 creation rows are never touched. Database triggers enforce the same.
 */

export interface AdvancementRow {
  readonly id: string;
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly lockVersionBefore: number;
  readonly createdAt: Date;
  readonly statAdvancements: ReadonlyArray<{ readonly stat: string; readonly pointsSpent: number }>;
  readonly skillAdvancements: ReadonlyArray<{ readonly skillEntityId: string; readonly skillEntityVersionId: string; readonly action: string }>;
  readonly affinityChoice: { readonly optionKey: string; readonly affinityEntityId: string | null; readonly affinityEntityVersionId: string | null } | null;
}

const historyQuery = (characterId: string) =>
  prisma.characterAdvancement.findMany({
    where: { characterId },
    orderBy: { toLevel: "asc" },
    select: {
      id: true,
      fromLevel: true,
      toLevel: true,
      lockVersionBefore: true,
      createdAt: true,
      statAdvancements: { select: { stat: true, pointsSpent: true }, orderBy: { stat: "asc" } },
      skillAdvancements: { select: { skillEntityId: true, skillEntityVersionId: true, action: true }, orderBy: { id: "asc" } },
      affinityChoice: { select: { optionKey: true, affinityEntityId: true, affinityEntityVersionId: true } },
    },
  });

/** The Character's committed advancements, in Level order. */
export async function selectAdvancementHistory(characterId: string): Promise<AdvancementRow[]> {
  return historyQuery(characterId);
}

/**
 * The Character row (with its creation rows) and its committed history read from ONE consistent snapshot, so a
 * concurrent advancement can never be seen half (a Level without its history row, or a history row past the Level).
 */
export async function selectCharacterSnapshot(id: string): Promise<{ character: CharacterWithChildren | null; history: AdvancementRow[] }> {
  const [character, history] = await prisma.$transaction([prisma.character.findUnique({ where: { id }, include: CHARACTER_CHILDREN }), historyQuery(id)], { isolationLevel: "RepeatableRead" });
  return { character, history };
}

export interface AdvancementRecordInput {
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly statAllocations: ReadonlyArray<{ readonly stat: string; readonly pointsSpent: number }>;
  readonly skillAdvancements: ReadonlyArray<{ readonly skillEntityId: string; readonly skillEntityVersionId: string; readonly action: string }>;
  readonly affinityChoice: { readonly optionKey: string; readonly affinityEntityId: string | null; readonly affinityEntityVersionId: string | null } | null;
}

class Abort extends Error {
  constructor(readonly result: WriteOutcome) {
    super(result.outcome);
  }
}

/**
 * Commits ONE advancement in ONE transaction (§42): compare-and-set the Character's `lock_version` (which also locks
 * the row, so a concurrent advance waits and then finds a stale version), check it is a completed Character still at
 * `fromLevel`, insert the advancement and its child rows, then move the Character to `toLevel`. Any failure rolls back
 * everything: no Level change, no version change, no history row.
 */
export async function commitAdvancement(id: string, expected: number, input: AdvancementRecordInput): Promise<WriteOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      const next = expected + 1;
      const claimed = await tx.character.updateMany({ where: { id, lockVersion: expected, coreCreationCompletedAt: { not: null }, level: input.fromLevel }, data: { lockVersion: next, updatedAt: new Date() } });
      if (claimed.count !== 1) {
        const row = await tx.character.findUnique({ where: { id }, select: { lockVersion: true } });
        throw new Abort(row === null ? { outcome: "not_found" } : row.lockVersion !== expected ? { outcome: "stale", current: row.lockVersion } : { outcome: "frozen" });
      }
      const advancement = await tx.characterAdvancement.create({ data: { characterId: id, fromLevel: input.fromLevel, toLevel: input.toLevel, lockVersionBefore: expected } });
      if (input.statAllocations.length > 0) await tx.characterStatAdvancement.createMany({ data: input.statAllocations.map((s) => ({ advancementId: advancement.id, stat: s.stat, pointsSpent: s.pointsSpent })) });
      for (const s of input.skillAdvancements) await tx.characterSkillAdvancement.create({ data: { advancementId: advancement.id, ...s } });
      if (input.affinityChoice !== null) await tx.characterAffinityAdvancementChoice.create({ data: { advancementId: advancement.id, ...input.affinityChoice } });
      await tx.character.update({ where: { id }, data: { level: input.toLevel } });
      return { outcome: "ok" as const, lockVersion: next };
    });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}
