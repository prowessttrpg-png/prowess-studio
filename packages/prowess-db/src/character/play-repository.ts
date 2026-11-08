import { prisma } from "../client.js";
import { playStateVersionWithin, writePlayStateWithin, type SheetTx } from "./sheet-repository.js";

/**
 * Character Play Workspace persistence (PAS-10 M6-WO10) — the only module that reads or writes character_play_runtimes and
 * character_play_events. A commit is ONE database transaction that:
 *
 *   1. compare-and-sets the Character Sheet play state (the one resource authority) through `writePlayStateWithin`,
 *      or — when the operation changed no resource — verifies the sheet version is still the one evaluated;
 *   2. compare-and-sets the Play runtime row (created at version 1 on the first commit);
 *   3. appends exactly one ledger event (unique sequence and idempotency key; the table is append-only).
 *
 * Any miss aborts the whole transaction: a payment can never persist without its runtime transition and event.
 */

export interface StoredPlayRuntime {
  readonly state: unknown;
  readonly lockVersion: number;
  readonly rulesetReleaseId: string;
}

export interface StoredPlayEvent {
  readonly id: string;
  readonly sequence: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly operationKind: string;
  readonly classification: string;
  readonly summary: string;
  readonly rulesetReleaseId: string;
  readonly runtimeVersion: number;
  readonly playStateVersion: number;
  readonly record: unknown;
  readonly createdAt: Date;
}

const EVENT_FIELDS = { id: true, sequence: true, idempotencyKey: true, requestHash: true, operationKind: true, classification: true, summary: true, rulesetReleaseId: true, runtimeVersion: true, playStateVersion: true, record: true, createdAt: true } as const;

export async function selectPlayRuntime(characterId: string): Promise<StoredPlayRuntime | null> {
  return prisma.characterPlayRuntime.findUnique({ where: { characterId }, select: { state: true, lockVersion: true, rulesetReleaseId: true } });
}

export async function selectPlayEventByKey(characterId: string, idempotencyKey: string): Promise<StoredPlayEvent | null> {
  return prisma.characterPlayEvent.findUnique({ where: { characterId_idempotencyKey: { characterId, idempotencyKey } }, select: EVENT_FIELDS });
}

/** Newest first, `limit` events at most, optionally before a sequence (history paging). Read-only. */
export async function selectPlayEvents(characterId: string, options: { readonly before: number | null; readonly limit: number }): Promise<StoredPlayEvent[]> {
  return prisma.characterPlayEvent.findMany({ where: { characterId, ...(options.before === null ? {} : { sequence: { lt: options.before } }) }, orderBy: { sequence: "desc" }, take: options.limit, select: EVENT_FIELDS });
}

export type PlayCommitOutcome =
  | { readonly outcome: "ok"; readonly event: StoredPlayEvent; readonly runtimeVersion: number; readonly playStateVersion: number }
  | { readonly outcome: "stale"; readonly which: "PLAY_STATE" | "RUNTIME" }
  | { readonly outcome: "duplicate" };

class Abort extends Error {
  constructor(readonly result: PlayCommitOutcome) {
    super(result.outcome);
  }
}
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

export interface PlayCommitInput {
  readonly characterId: string;
  readonly rulesetReleaseId: string;
  readonly expectedRuntimeVersion: number;
  readonly expectedPlayStateVersion: number;
  /** Sheet resources to write (only when the operation changed one); `initial` completes a first-ever sheet row. */
  readonly resources: { readonly values: ReadonlyArray<{ readonly resourceKey: string; readonly current: number }>; readonly initial: ReadonlyArray<{ readonly resourceKey: string; readonly current: number }> } | null;
  readonly state: object;
  readonly event: { readonly idempotencyKey: string; readonly requestHash: string; readonly operationKind: string; readonly classification: string; readonly summary: string; readonly record: object };
}

export async function commitPlayOperation(input: PlayCommitInput): Promise<PlayCommitOutcome> {
  const { characterId } = input;
  try {
    return await prisma.$transaction(async (tx: SheetTx) => {
      // 1. The one resource authority (or proof that it is still the evaluated version).
      let playStateVersion: number;
      if (input.resources !== null) {
        const written = await writePlayStateWithin(tx, characterId, input.expectedPlayStateVersion, input.resources.values, input.resources.initial);
        if (written === null) throw new Abort({ outcome: "stale", which: "PLAY_STATE" });
        playStateVersion = written;
      } else {
        playStateVersion = await playStateVersionWithin(tx, characterId);
        if (playStateVersion !== input.expectedPlayStateVersion) throw new Abort({ outcome: "stale", which: "PLAY_STATE" });
      }
      // 2. The runtime row: created at version 1, then compare-and-set on lockVersion.
      let runtimeVersion: number;
      if (input.expectedRuntimeVersion === 0) {
        if ((await tx.characterPlayRuntime.count({ where: { characterId } })) !== 0) throw new Abort({ outcome: "stale", which: "RUNTIME" });
        await tx.characterPlayRuntime.create({ data: { characterId, rulesetReleaseId: input.rulesetReleaseId, state: input.state } });
        runtimeVersion = 1;
      } else {
        runtimeVersion = input.expectedRuntimeVersion + 1;
        const claimed = await tx.characterPlayRuntime.updateMany({ where: { characterId, lockVersion: input.expectedRuntimeVersion, rulesetReleaseId: input.rulesetReleaseId }, data: { state: input.state, lockVersion: runtimeVersion, updatedAt: new Date() } });
        if (claimed.count !== 1) throw new Abort({ outcome: "stale", which: "RUNTIME" });
      }
      // 3. Exactly one append-only event; the runtime CAS above serializes sequence allocation per Character.
      const last = await tx.characterPlayEvent.findFirst({ where: { characterId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
      const event = await tx.characterPlayEvent.create({
        data: { characterId, rulesetReleaseId: input.rulesetReleaseId, sequence: (last?.sequence ?? 0) + 1, idempotencyKey: input.event.idempotencyKey, requestHash: input.event.requestHash, operationKind: input.event.operationKind, classification: input.event.classification, summary: input.event.summary, runtimeVersion, playStateVersion, record: input.event.record },
        select: EVENT_FIELDS,
      });
      return { outcome: "ok" as const, event, runtimeVersion, playStateVersion };
    });
  } catch (e) {
    if (e instanceof Abort) return e.result;
    // A concurrent create of the sheet / runtime row or a concurrent use of the same key loses on a unique index.
    if (isUniqueViolation(e)) return (await selectPlayEventByKey(characterId, input.event.idempotencyKey)) === null ? { outcome: "stale", which: "RUNTIME" } : { outcome: "duplicate" };
    throw e;
  }
}
