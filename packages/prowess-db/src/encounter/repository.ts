import { prisma } from "../client.js";
import { selectPlayRuntime } from "../character/play-repository.js";

/**
 * Encounter persistence (M7-WO1) — the only module that reads or writes `encounters`, `encounter_sides`,
 * `encounter_participants` and `encounter_events`. Every command is ONE database transaction that:
 *
 *   1. compare-and-sets the encounter row on (id, lock_version, status = PREPARATION) — the single serialization point
 *      for every roster and lifecycle change of that encounter;
 *   2. applies exactly the command's roster change;
 *   3. appends exactly one history event (unique sequence per encounter, globally unique idempotency key).
 *
 * Any miss aborts the whole transaction. Nothing here reads or writes a Character's resources, play runtime or events.
 */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export const ENCOUNTER_STATUSES = ["PREPARATION", "ARCHIVED"] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

const RELEASE_SELECT = { id: true, releaseNumber: true, versionLabel: true, channel: true, ruleset: { select: { id: true, name: true } } } as const;
const CHARACTER_SELECT = { id: true, name: true, level: true, rulesetReleaseId: true, coreCreationCompletedAt: true } as const;

export interface StoredEncounterEvent {
  readonly id: string;
  readonly encounterId: string;
  readonly sequence: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly kind: string;
  readonly summary: string;
  readonly encounterVersion: number;
  readonly record: unknown;
  readonly createdAt: Date;
}
const EVENT_SELECT = { id: true, encounterId: true, sequence: true, idempotencyKey: true, requestHash: true, kind: true, summary: true, encounterVersion: true, record: true, createdAt: true } as const;

export async function selectEncounter(id: string) {
  return prisma.encounter.findUnique({
    where: { id },
    include: {
      rulesetRelease: { select: RELEASE_SELECT },
      sides: { orderBy: { ordinal: "asc" } },
      participants: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { character: { select: CHARACTER_SELECT } } },
    },
  });
}
export type StoredEncounter = NonNullable<Awaited<ReturnType<typeof selectEncounter>>>;

export interface EncounterListFilter {
  readonly search: string | null;
  readonly status: "ALL" | EncounterStatus;
}
const literalLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
function listWhere(filter: EncounterListFilter) {
  return {
    ...(filter.search === null ? {} : { name: { contains: literalLike(filter.search), mode: "insensitive" as const } }),
    ...(filter.status === "ALL" ? {} : { status: filter.status }),
  };
}
export async function countEncounters(filter: EncounterListFilter): Promise<number> {
  return prisma.encounter.count({ where: listWhere(filter) });
}
export async function selectEncounterPage(skip: number, take: number, filter: EncounterListFilter) {
  return prisma.encounter.findMany({
    where: listWhere(filter),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip,
    take,
    include: { rulesetRelease: { select: RELEASE_SELECT }, _count: { select: { sides: true, participants: true } } },
  });
}

export async function selectEventByKey(idempotencyKey: string): Promise<StoredEncounterEvent | null> {
  return prisma.encounterEvent.findUnique({ where: { idempotencyKey }, select: EVENT_SELECT });
}
/** Newest first, `limit` events at most, optionally before a sequence (history paging). Read-only. */
export async function selectEncounterEvents(encounterId: string, options: { readonly before: number | null; readonly limit: number }): Promise<StoredEncounterEvent[]> {
  return prisma.encounterEvent.findMany({ where: { encounterId, ...(options.before === null ? {} : { sequence: { lt: options.before } }) }, orderBy: { sequence: "desc" }, take: options.limit, select: EVENT_SELECT });
}

export async function selectCharacterForRoster(id: string) {
  return prisma.character.findUnique({ where: { id }, select: CHARACTER_SELECT });
}
/** Characters by literal name text (any Release), most recently updated first — the roster picker's candidates. */
export async function selectCharacterCandidates(search: string | null, take: number) {
  return prisma.character.findMany({
    where: search === null ? {} : { name: { contains: literalLike(search), mode: "insensitive" } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take,
    select: { ...CHARACTER_SELECT, rulesetRelease: { select: RELEASE_SELECT } },
  });
}
/**
 * The stored standalone play runtimes of these Characters, read through the M6-WO10 play repository — the only module
 * that touches the play tables (W10-I155). Read-only.
 */
export async function selectPlayRuntimes(characterIds: readonly string[]) {
  const rows = await Promise.all(characterIds.map(async (characterId) => ({ characterId, runtime: await selectPlayRuntime(characterId) })));
  return rows.flatMap(({ characterId, runtime }) => (runtime === null ? [] : [{ characterId, rulesetReleaseId: runtime.rulesetReleaseId, state: runtime.state, lockVersion: runtime.lockVersion }]));
}

// ---- writes ------------------------------------------------------------------------------------------------------------

export type RosterChange =
  | { readonly kind: "NONE" }
  | { readonly kind: "METADATA"; readonly name: string; readonly notes: string | null }
  | { readonly kind: "ADD_SIDE"; readonly name: string }
  | { readonly kind: "RENAME_SIDE"; readonly sideId: string; readonly name: string }
  | { readonly kind: "REMOVE_SIDE"; readonly sideId: string }
  | { readonly kind: "ADD_PARTICIPANT"; readonly characterId: string; readonly sideId: string | null; readonly rulesetReleaseId: string }
  | { readonly kind: "MOVE_PARTICIPANT"; readonly participantId: string; readonly sideId: string | null }
  | { readonly kind: "REMOVE_PARTICIPANT"; readonly participantId: string }
  | { readonly kind: "ARCHIVE" };

export interface EventInput {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly kind: string;
  readonly summary: string;
  /** Built AFTER the change is applied (it may name a created row), inside the same transaction. */
  readonly record: (created: { readonly sideId: string | null; readonly participantId: string | null }) => object;
}

export type CommandOutcome =
  | { readonly outcome: "ok"; readonly event: StoredEncounterEvent; readonly version: number }
  | { readonly outcome: "stale" }
  | { readonly outcome: "duplicate" }
  | { readonly outcome: "conflict"; readonly reason: "DUPLICATE_PARTICIPANT" | "SIDE_NOT_EMPTY" | "NOT_IN_ENCOUNTER" };

class Abort extends Error {
  constructor(readonly result: CommandOutcome) {
    super(result.outcome);
  }
}
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

async function appendEvent(tx: Tx, encounterId: string, version: number, event: EventInput, created: { sideId: string | null; participantId: string | null }) {
  const last = await tx.encounterEvent.findFirst({ where: { encounterId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  return tx.encounterEvent.create({
    data: { encounterId, sequence: (last?.sequence ?? 0) + 1, idempotencyKey: event.idempotencyKey, requestHash: event.requestHash, kind: event.kind, summary: event.summary.slice(0, 2000), encounterVersion: version, record: JSON.parse(JSON.stringify(event.record(created))) as object },
    select: EVENT_SELECT,
  });
}

/** Creates an encounter at version 1 with its creation event, atomically. A reused idempotency key loses on the index. */
export async function insertEncounter(input: { readonly name: string; readonly notes: string | null; readonly rulesetReleaseId: string; readonly event: EventInput }): Promise<{ readonly outcome: "ok"; readonly encounterId: string; readonly event: StoredEncounterEvent } | { readonly outcome: "duplicate" }> {
  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const row = await tx.encounter.create({ data: { name: input.name, notes: input.notes, rulesetReleaseId: input.rulesetReleaseId, status: "PREPARATION" }, select: { id: true } });
      const event = await appendEvent(tx, row.id, 1, input.event, { sideId: null, participantId: null });
      return { outcome: "ok" as const, encounterId: row.id, event };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { outcome: "duplicate" };
    throw e;
  }
}

/** Applies one roster / lifecycle change under the encounter's compare-and-set, with its event, in ONE transaction. */
export async function applyEncounterCommand(input: { readonly encounterId: string; readonly expectedVersion: number; readonly change: RosterChange; readonly event: EventInput }): Promise<CommandOutcome> {
  const { encounterId, expectedVersion, change } = input;
  const version = expectedVersion + 1;
  try {
    return await prisma.$transaction(async (tx: Tx) => {
      // 1. The serialization point: only a PREPARATION encounter still at the evaluated version moves forward.
      const now = new Date();
      const claimed = await tx.encounter.updateMany({
        where: { id: encounterId, lockVersion: expectedVersion, status: "PREPARATION" },
        data: {
          lockVersion: version,
          updatedAt: now,
          ...(change.kind === "METADATA" ? { name: change.name, notes: change.notes } : {}),
          ...(change.kind === "ARCHIVE" ? { status: "ARCHIVED", archivedAt: now } : {}),
        },
      });
      if (claimed.count !== 1) throw new Abort({ outcome: "stale" });

      // 2. The roster change itself, re-checked against the rows (never trusted from the caller's earlier read).
      const created = { sideId: null as string | null, participantId: null as string | null };
      switch (change.kind) {
        case "ADD_SIDE": {
          const last = await tx.encounterSide.findFirst({ where: { encounterId }, orderBy: { ordinal: "desc" }, select: { ordinal: true } });
          created.sideId = (await tx.encounterSide.create({ data: { encounterId, name: change.name, ordinal: (last?.ordinal ?? 0) + 1 }, select: { id: true } })).id;
          break;
        }
        case "RENAME_SIDE": {
          const r = await tx.encounterSide.updateMany({ where: { id: change.sideId, encounterId }, data: { name: change.name } });
          if (r.count !== 1) throw new Abort({ outcome: "conflict", reason: "NOT_IN_ENCOUNTER" });
          break;
        }
        case "REMOVE_SIDE": {
          if ((await tx.encounterParticipant.count({ where: { encounterId, sideId: change.sideId } })) !== 0) throw new Abort({ outcome: "conflict", reason: "SIDE_NOT_EMPTY" });
          const r = await tx.encounterSide.deleteMany({ where: { id: change.sideId, encounterId } });
          if (r.count !== 1) throw new Abort({ outcome: "conflict", reason: "NOT_IN_ENCOUNTER" });
          break;
        }
        case "ADD_PARTICIPANT": {
          if ((await tx.encounterParticipant.count({ where: { encounterId, characterId: change.characterId } })) !== 0) throw new Abort({ outcome: "conflict", reason: "DUPLICATE_PARTICIPANT" });
          created.participantId = (await tx.encounterParticipant.create({ data: { encounterId, rulesetReleaseId: change.rulesetReleaseId, characterId: change.characterId, sideId: change.sideId }, select: { id: true } })).id;
          break;
        }
        case "MOVE_PARTICIPANT": {
          const r = await tx.encounterParticipant.updateMany({ where: { id: change.participantId, encounterId }, data: { sideId: change.sideId } });
          if (r.count !== 1) throw new Abort({ outcome: "conflict", reason: "NOT_IN_ENCOUNTER" });
          break;
        }
        case "REMOVE_PARTICIPANT": {
          const r = await tx.encounterParticipant.deleteMany({ where: { id: change.participantId, encounterId } });
          if (r.count !== 1) throw new Abort({ outcome: "conflict", reason: "NOT_IN_ENCOUNTER" });
          break;
        }
        case "METADATA":
        case "ARCHIVE":
        case "NONE":
          break;
      }

      // 3. Exactly one append-only event; the compare-and-set above serializes sequence allocation per encounter.
      const event = await appendEvent(tx, encounterId, version, input.event, created);
      return { outcome: "ok" as const, event, version };
    });
  } catch (e) {
    if (e instanceof Abort) return e.result;
    // A concurrent use of the same idempotency key, or a concurrent duplicate membership, loses on a unique index.
    if (isUniqueViolation(e)) return (await selectEventByKey(input.event.idempotencyKey)) === null ? { outcome: "conflict", reason: "DUPLICATE_PARTICIPANT" } : { outcome: "duplicate" };
    throw e;
  }
}
