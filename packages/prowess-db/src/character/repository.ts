import { prisma } from "../client.js";

/**
 * Character persistence (PAS-10 M6-WO3) — the only module that reads or writes the Character tables. Characters are
 * player state in their own typed tables, never Entity / EntityVersion rows. Every mutating write is a single
 * compare-and-set on `lock_version` inside one transaction together with all of its child rows: a write either
 * happens completely, at exactly the version the caller loaded, or not at all.
 */

export interface CharacterRow {
  readonly id: string;
  readonly name: string;
  readonly concept: string | null;
  readonly rulesetReleaseId: string;
  readonly level: number;
  readonly ancestryEntityId: string | null;
  readonly ancestryEntityVersionId: string | null;
  readonly primaryAffinityEntityId: string | null;
  readonly primaryAffinityEntityVersionId: string | null;
  readonly coreCreationCompletedAt: Date | null;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CharacterChildren {
  readonly statAllocations: ReadonlyArray<{ readonly stat: string; readonly pointsSpent: number }>;
  readonly ancestryStatChoices: ReadonlyArray<{ readonly grantKey: string; readonly stat: string }>;
  readonly skillRanks: ReadonlyArray<{ readonly skillEntityId: string; readonly skillEntityVersionId: string; readonly rankKey: string; readonly sourceKind: string; readonly sourceGrantKey: string | null }>;
}

export type CharacterWithChildren = CharacterRow & CharacterChildren;

export const CHARACTER_CHILDREN = {
  statAllocations: { select: { stat: true, pointsSpent: true }, orderBy: { stat: "asc" as const } },
  ancestryStatChoices: { select: { grantKey: true, stat: true }, orderBy: [{ grantKey: "asc" as const }, { stat: "asc" as const }] },
  skillRanks: { select: { skillEntityId: true, skillEntityVersionId: true, rankKey: true, sourceKind: true, sourceGrantKey: true }, orderBy: { skillEntityId: "asc" as const } },
};

export async function insertCharacter(input: { name: string; concept: string | null; rulesetReleaseId: string; level: number }): Promise<CharacterRow> {
  return prisma.character.create({ data: { name: input.name, concept: input.concept, rulesetReleaseId: input.rulesetReleaseId, level: input.level } });
}

export async function selectCharacter(id: string): Promise<CharacterWithChildren | null> {
  return prisma.character.findUnique({ where: { id }, include: CHARACTER_CHILDREN });
}

export async function countCharacters(): Promise<number> {
  return prisma.character.count();
}

/** A page of Characters, most recently updated first (then id), with the exact Release identity for the index. */
export async function selectCharacterPage(skip: number, take: number) {
  return prisma.character.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip,
    take,
    include: { rulesetRelease: { select: { id: true, releaseNumber: true, versionLabel: true, channel: true, ruleset: { select: { id: true, name: true } } } } },
  });
}

export type WriteOutcome = { readonly outcome: "ok"; readonly lockVersion: number } | { readonly outcome: "not_found" } | { readonly outcome: "stale"; readonly current: number } | { readonly outcome: "frozen" };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Compare-and-set the version (and, unless `allowFrozen`, require a Draft); explains a miss. Runs inside `tx`. */
async function claim(tx: Tx, id: string, expected: number, allowFrozen: boolean, data: Record<string, unknown>): Promise<WriteOutcome> {
  const next = expected + 1;
  const updated = await tx.character.updateMany({
    where: { id, lockVersion: expected, ...(allowFrozen ? {} : { coreCreationCompletedAt: null }) },
    data: { ...data, lockVersion: next, updatedAt: new Date() },
  });
  if (updated.count === 1) return { outcome: "ok", lockVersion: next };
  const row = await tx.character.findUnique({ where: { id }, select: { lockVersion: true, coreCreationCompletedAt: true } });
  if (row === null) return { outcome: "not_found" };
  if (row.lockVersion !== expected) return { outcome: "stale", current: row.lockVersion };
  return { outcome: "frozen" };
}

/** Thrown inside a transaction to roll it back with an explained outcome. */
class Abort extends Error {
  constructor(readonly result: WriteOutcome) {
    super(result.outcome);
  }
}

async function inTransaction(work: (tx: Tx) => Promise<WriteOutcome>): Promise<WriteOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      const out = await work(tx);
      if (out.outcome !== "ok") throw new Abort(out);
      return out;
    });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

/**
 * Replaces a DRAFT Character's mechanical creation inputs atomically: the version claim, the exact Ancestry / Primary
 * Affinity references and every child row, in ONE transaction. Any failure rolls all of it back.
 */
export async function replaceCreationInputs(
  id: string,
  expected: number,
  input: {
    readonly ancestry: { readonly entityId: string; readonly entityVersionId: string } | null;
    readonly primaryAffinity: { readonly entityId: string; readonly entityVersionId: string } | null;
    readonly statAllocations: ReadonlyArray<{ readonly stat: string; readonly pointsSpent: number }>;
    readonly ancestryStatChoices: ReadonlyArray<{ readonly grantKey: string; readonly stat: string }>;
    readonly skillRanks: CharacterChildren["skillRanks"];
  },
): Promise<WriteOutcome> {
  return inTransaction(async (tx) => {
    const claimed = await claim(tx, id, expected, false, {
      ancestryEntityId: input.ancestry?.entityId ?? null,
      ancestryEntityVersionId: input.ancestry?.entityVersionId ?? null,
      primaryAffinityEntityId: input.primaryAffinity?.entityId ?? null,
      primaryAffinityEntityVersionId: input.primaryAffinity?.entityVersionId ?? null,
    });
    if (claimed.outcome !== "ok") return claimed;
    await tx.characterStatAllocation.deleteMany({ where: { characterId: id } });
    await tx.characterAncestryStatChoice.deleteMany({ where: { characterId: id } });
    await tx.characterSkillRank.deleteMany({ where: { characterId: id } });
    if (input.statAllocations.length > 0) await tx.characterStatAllocation.createMany({ data: input.statAllocations.map((a) => ({ characterId: id, stat: a.stat, pointsSpent: a.pointsSpent })) });
    if (input.ancestryStatChoices.length > 0) await tx.characterAncestryStatChoice.createMany({ data: input.ancestryStatChoices.map((c) => ({ characterId: id, grantKey: c.grantKey, stat: c.stat })) });
    for (const s of input.skillRanks) await tx.characterSkillRank.create({ data: { characterId: id, ...s } });
    return claimed;
  });
}

/** Profile fields only (name, concept) — allowed in any state; never touches a mechanical column. */
export async function updateProfile(id: string, expected: number, input: { readonly name: string; readonly concept: string | null }): Promise<WriteOutcome> {
  return inTransaction((tx) => claim(tx, id, expected, true, { name: input.name, concept: input.concept }));
}

/** Records core-creation completion on a Draft at exactly the expected version. No game choice changes. */
export async function markCoreCreationComplete(id: string, expected: number, at: Date): Promise<WriteOutcome> {
  return inTransaction((tx) => claim(tx, id, expected, false, { coreCreationCompletedAt: at }));
}

export interface PinnedContentRow {
  readonly id: string;
  readonly entityId: string;
  readonly revisionNumber: number;
  readonly displayName: string;
  readonly shortDescription: string | null;
  readonly rulesText: string | null;
}

/** Display content of exact EntityVersions (names, short descriptions, Rules Text) — presentation only. */
export async function selectVersionDisplay(ids: readonly string[]): Promise<PinnedContentRow[]> {
  if (ids.length === 0) return [];
  return prisma.entityVersion.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, entityId: true, revisionNumber: true, displayName: true, shortDescription: true, rulesText: true },
    orderBy: { id: "asc" },
  });
}
