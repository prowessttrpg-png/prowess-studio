import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../client.js";

/**
 * Character Signature Spell persistence (PAS-10 M6-WO7) — the only module that reads or writes
 * `character_signature_abilities` and `character_signature_spell_revisions`. It stores SELECTIONS only (the strict
 * Character Spell payload); never a cost, capacity or other derived value, never an Entity / EntityVersion / Release row,
 * and never the Character row, its creation, advancement history, sheet state or loadout.
 *
 *   DRAFT   — a working composition, no finalized revision, consumes no Signature slot;
 *   ACTIVE  — one current finalized revision (append-only history), consumes its Signature slot; may carry a rebuild draft;
 *   RETIRED — released from the roster; its history stays.
 *
 * Every write is an atomic compare-and-set on the ability's lockVersion. Finalization runs in ONE transaction that locks
 * the Character row (so two finalizations — or a finalization and an advancement — are serialized), re-checks the
 * Character version and the roster, asks the caller's M5 evaluation with the exact used-slot count, and only then appends
 * the revision and makes it current (§88–§89, M6-I091).
 */

export type SignatureAbilityStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export interface StoredSpellRevision {
  readonly id: string;
  readonly revisionNumber: number;
  readonly characterReleaseId: string;
  readonly previousRevisionId: string | null;
  readonly payload: unknown;
  readonly createdAt: Date;
}
export interface StoredSignatureAbility {
  readonly id: string;
  readonly characterId: string;
  readonly abilityKind: "SPELL" | "MANEUVER";
  readonly status: SignatureAbilityStatus;
  readonly currentRevisionId: string | null;
  readonly draftPayload: unknown;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly retiredAt: Date | null;
  /** Oldest first. */
  readonly revisions: readonly StoredSpellRevision[];
}

export type SpellWriteOutcome =
  | { readonly outcome: "ok"; readonly version: number }
  | { readonly outcome: "stale"; readonly current: number }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "state"; readonly status: SignatureAbilityStatus; readonly reason: string };

const include = { revisions: { orderBy: { revisionNumber: "asc" as const } }, maneuverRevisions: { orderBy: { revisionNumber: "asc" as const } } };
type Row = Awaited<ReturnType<typeof prisma.characterSignatureAbility.findFirst<{ include: typeof include }>>>;

function toStored(row: NonNullable<Row>): StoredSignatureAbility {
  return {
    id: row.id,
    characterId: row.characterId,
    abilityKind: row.abilityKind as StoredSignatureAbility["abilityKind"],
    status: row.status as SignatureAbilityStatus,
    currentRevisionId: row.abilityKind === "MANEUVER" ? row.currentManeuverRevisionId : row.currentRevisionId,
    draftPayload: row.draftPayload,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retiredAt: row.retiredAt,
    revisions: (row.abilityKind === "MANEUVER" ? row.maneuverRevisions : row.revisions).map((r) => ({ id: r.id, revisionNumber: r.revisionNumber, characterReleaseId: r.characterReleaseId, previousRevisionId: r.previousRevisionId, payload: r.payload, createdAt: r.createdAt })),
  };
}

export async function selectSignatureAbilities(characterId: string): Promise<StoredSignatureAbility[]> {
  const rows = await prisma.characterSignatureAbility.findMany({ where: { characterId }, include, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(toStored);
}

export async function selectSignatureAbility(characterId: string, abilityId: string): Promise<StoredSignatureAbility | null> {
  const row = await prisma.characterSignatureAbility.findFirst({ where: { id: abilityId, characterId }, include });
  return row === null ? null : toStored(row);
}

/** A new DRAFT Signature Spell holding its first working composition. */
export async function insertSignatureSpellDraft(characterId: string, draft: object, abilityKind: "SPELL" | "MANEUVER" = "SPELL"): Promise<StoredSignatureAbility> {
  const row = await prisma.characterSignatureAbility.create({ data: { characterId, abilityKind, status: "DRAFT", draftPayload: draft }, include });
  return toStored(row);
}

class Outcome extends Error {
  constructor(readonly result: SpellWriteOutcome) {
    super(result.outcome);
  }
}

/** Compare-and-set on the ability; `apply` decides the update from the locked row or throws an Outcome. */
async function casAbility(characterId: string, abilityId: string, expected: number, apply: (row: StoredSignatureAbility) => Record<string, unknown>, kind: "SPELL" | "MANEUVER"): Promise<SpellWriteOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.characterSignatureAbility.findFirst({ where: { id: abilityId, characterId }, include });
      if (row === null || row.abilityKind !== kind) throw new Outcome({ outcome: "not_found" });
      const stored = toStored(row);
      if (stored.lockVersion !== expected) throw new Outcome({ outcome: "stale", current: stored.lockVersion });
      const data = apply(stored);
      const next = expected + 1;
      const claimed = await tx.characterSignatureAbility.updateMany({ where: { id: abilityId, characterId, lockVersion: expected }, data: { ...data, lockVersion: next, updatedAt: new Date() } });
      if (claimed.count !== 1) throw new Outcome({ outcome: "stale", current: (await tx.characterSignatureAbility.findFirst({ where: { id: abilityId }, select: { lockVersion: true } }))?.lockVersion ?? 0 });
      return { outcome: "ok" as const, version: next };
    });
  } catch (e) {
    if (e instanceof Outcome) return e.result;
    throw e;
  }
}

/** Saves (or, with null on an ACTIVE Spell, discards) the working composition. A RETIRED Spell is never edited. */
export function writeSignatureSpellDraft(characterId: string, abilityId: string, expected: number, draft: object | null, kind: "SPELL" | "MANEUVER" = "SPELL"): Promise<SpellWriteOutcome> {
  return casAbility(characterId, abilityId, expected, (row) => {
    if (row.status === "RETIRED") throw new Outcome({ outcome: "state", status: row.status, reason: "a retired Signature Spell is history; it is never edited" });
    if (row.status === "ACTIVE" && row.draftPayload === null && draft !== null) throw new Outcome({ outcome: "state", status: row.status, reason: "start a Rebuild before editing a finalized Signature Spell" });
    if (row.status === "DRAFT" && draft === null) throw new Outcome({ outcome: "state", status: row.status, reason: "a never-finalized Spell keeps its draft; retire it to remove it from the roster" });
    return { draftPayload: draft === null ? Prisma.DbNull : draft };
  }, kind);
}

/** Starts a rebuild: the working draft becomes a copy of the CURRENT revision's selections (the revision is untouched). */
export function startSignatureSpellRebuild(characterId: string, abilityId: string, expected: number, kind: "SPELL" | "MANEUVER" = "SPELL"): Promise<SpellWriteOutcome> {
  return casAbility(characterId, abilityId, expected, (row) => {
    if (row.status !== "ACTIVE") throw new Outcome({ outcome: "state", status: row.status, reason: "only an active finalized Signature Spell can be rebuilt" });
    if (row.draftPayload !== null) throw new Outcome({ outcome: "state", status: row.status, reason: "a rebuild is already in progress" });
    const current = row.revisions.find((r) => r.id === row.currentRevisionId);
    if (current === undefined) throw new Outcome({ outcome: "state", status: row.status, reason: "the Spell has no current revision" });
    return { draftPayload: current.payload as object };
  }, kind);
}

/** Retires the Spell: it leaves the active roster (its slot is released); every revision stays (§90, M6-I094). */
export function retireSignatureSpell(characterId: string, abilityId: string, expected: number, kind: "SPELL" | "MANEUVER" = "SPELL"): Promise<SpellWriteOutcome> {
  return casAbility(characterId, abilityId, expected, (row) => {
    if (row.status === "RETIRED") throw new Outcome({ outcome: "state", status: row.status, reason: "the Spell is already retired" });
    return { status: "RETIRED", retiredAt: new Date(), draftPayload: Prisma.DbNull };
  }, kind);
}

export type FinalizeDecision = { readonly ok: true; readonly payload: object } | { readonly ok: false; readonly reason: "invalid" | "capacity"; readonly detail: string };
export type FinalizeOutcome = SpellWriteOutcome | { readonly outcome: "rejected"; readonly reason: "invalid" | "capacity"; readonly detail: string } | { readonly outcome: "character_changed" };

/**
 * Finalizes the working draft atomically against the roster (§88–§89). Inside one transaction: lock the Character row,
 * verify the Character and ability versions, count the OTHER active Signature Abilities, ask `decide` (the M5
 * evaluation with that exact count) and only on success append revision N+1 and make it current.
 */
export async function finalizeSignatureSpell(input: {
  readonly characterId: string;
  readonly abilityId: string;
  readonly expected: number;
  readonly characterLockVersion: number;
  readonly characterReleaseId: string;
  readonly weaponLoadoutVersion?: number;
  readonly decide: (draft: unknown, usedSlots: number) => FinalizeDecision;
}, kind: "SPELL" | "MANEUVER" = "SPELL"): Promise<FinalizeOutcome> {
  const { characterId, abilityId, expected } = input;
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ lock_version: number; ruleset_release_id: string }[]>`SELECT "lock_version", "ruleset_release_id" FROM "characters" WHERE "id" = ${characterId}::uuid FOR UPDATE`;
      if (locked.length !== 1) throw new Outcome({ outcome: "not_found" });
      if (locked[0]!.lock_version !== input.characterLockVersion || locked[0]!.ruleset_release_id !== input.characterReleaseId) throw new FinalizeAbort({ outcome: "character_changed" });
      if (input.weaponLoadoutVersion !== undefined) {
        const loadout = await tx.characterWeaponLoadout.findUnique({ where: { characterId }, select: { lockVersion: true } });
        if ((loadout?.lockVersion ?? 0) !== input.weaponLoadoutVersion) throw new FinalizeAbort({ outcome: "character_changed" });
      }
      const row = await tx.characterSignatureAbility.findFirst({ where: { id: abilityId, characterId }, include });
      if (row === null || row.abilityKind !== kind) throw new Outcome({ outcome: "not_found" });
      const stored = toStored(row);
      if (stored.lockVersion !== expected) throw new Outcome({ outcome: "stale", current: stored.lockVersion });
      if (stored.status === "RETIRED") throw new Outcome({ outcome: "state", status: stored.status, reason: "a retired Signature Spell is never finalized again" });
      if (stored.draftPayload === null) throw new Outcome({ outcome: "state", status: stored.status, reason: "there is no draft to finalize" });
      const usedSlots = await tx.characterSignatureAbility.count({ where: { characterId, status: "ACTIVE", id: { not: abilityId } } });
      const decision = input.decide(stored.draftPayload, usedSlots);
      if (!decision.ok) throw new FinalizeAbort({ outcome: "rejected", reason: decision.reason, detail: decision.detail });
      const last = stored.revisions.at(-1) ?? null;
      const data = { abilityId, revisionNumber: (last?.revisionNumber ?? 0) + 1, characterReleaseId: input.characterReleaseId, previousRevisionId: stored.currentRevisionId, payload: decision.payload };
      const revision = kind === "SPELL" ? await tx.characterSignatureSpellRevision.create({ data }) : await tx.characterSignatureManeuverRevision.create({ data });
      const next = expected + 1;
      const claimed = await tx.characterSignatureAbility.updateMany({ where: { id: abilityId, characterId, lockVersion: expected }, data: { status: "ACTIVE", ...(kind === "SPELL" ? { currentRevisionId: revision.id } : { currentManeuverRevisionId: revision.id }), draftPayload: Prisma.DbNull, lockVersion: next, updatedAt: new Date() } });
      if (claimed.count !== 1) throw new Outcome({ outcome: "stale", current: expected });
      return { outcome: "ok" as const, version: next };
    });
  } catch (e) {
    if (e instanceof Outcome) return e.result;
    if (e instanceof FinalizeAbort) return e.result;
    throw e;
  }
}

class FinalizeAbort extends Error {
  constructor(readonly result: FinalizeOutcome) {
    super("finalize aborted");
  }
}
