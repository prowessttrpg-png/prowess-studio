import {
  EntityId,
  EntityVersionId,
  INITIAL_RULE_CONFLICT_STATUS,
  RuleConflictCandidateId,
  RuleConflictId,
  RulesetId,
  SourceReferenceId,
  type RuleConflict,
  type RuleConflictCandidate,
  type RuleConflictSeverity,
  type RuleConflictStatus,
  type RuleConflictType,
  type RuleConflictWithCandidates,
} from "@prowess/model";
import { prisma } from "../client.js";
import { isUniqueViolation } from "../prisma-errors.js";
import type {
  RuleConflict as PrismaRuleConflictRow,
  RuleConflictCandidate as PrismaCandidateRow,
} from "../../generated/prisma/client.js";

/**
 * RuleConflict repository — the only place that speaks Prisma's conflict API.
 * Internal to @prowess/db (not exported from `index.ts`); see `./service.ts`.
 *
 * It stores and returns exactly what it is given. It never resolves a conflict, never
 * ranks candidates, and never touches a manifest, a policy, or an EntityVersion's
 * status. It writes no status other than the initial one.
 */

export function toDomainRuleConflict(row: PrismaRuleConflictRow): RuleConflict {
  return {
    id: RuleConflictId.of(row.id),
    rulesetId: RulesetId.of(row.rulesetId),
    entityId: EntityId.of(row.entityId),
    conflictType: row.conflictType as RuleConflictType,
    severity: row.severity as RuleConflictSeverity,
    status: row.status as RuleConflictStatus,
    title: row.title,
    description: row.description,
    createdAt: row.createdAt,
  };
}

/** The redundant `entityId` column is a database-integrity device only; it is not part of the domain shape. */
export function toDomainRuleConflictCandidate(row: PrismaCandidateRow): RuleConflictCandidate {
  return {
    id: RuleConflictCandidateId.of(row.id),
    ruleConflictId: RuleConflictId.of(row.ruleConflictId),
    entityVersionId: EntityVersionId.of(row.entityVersionId),
    sourceReferenceId: row.sourceReferenceId === null ? null : SourceReferenceId.of(row.sourceReferenceId),
    label: row.label,
    positionSummary: row.positionSummary,
    createdAt: row.createdAt,
  };
}

export interface RuleConflictInsert {
  rulesetId: string;
  entityId: string;
  conflictType: RuleConflictType;
  severity: RuleConflictSeverity;
  title: string;
  description: string | null;
}

export interface RuleConflictCandidateInsert {
  entityVersionId: string;
  sourceReferenceId: string | null;
  label: string | null;
  positionSummary: string | null;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Inserts the conflict header. Status is always the initial one — there is no parameter for it. */
export async function insertRuleConflict(tx: Tx, conflict: RuleConflictInsert): Promise<string> {
  const row = await tx.ruleConflict.create({
    data: { ...conflict, status: INITIAL_RULE_CONFLICT_STATUS },
    select: { id: true },
  });
  return row.id;
}

/**
 * Inserts candidates in input order. Each row's `entityId` is ALWAYS the conflict's own
 * Entity (never caller-supplied): with the two composite foreign keys this makes a
 * candidate Version of another Entity impossible to store.
 */
export async function insertRuleConflictCandidates(
  tx: Tx,
  ruleConflictId: string,
  conflictEntityId: string,
  candidates: readonly RuleConflictCandidateInsert[],
): Promise<void> {
  for (const candidate of candidates) {
    await tx.ruleConflictCandidate.create({
      data: { ruleConflictId, entityId: conflictEntityId, ...candidate },
      select: { id: true },
    });
  }
}

/**
 * Creates one conflict and all of its candidates ATOMICALLY: one transaction. If ANY
 * candidate fails — including a database-level rejection after earlier candidates were
 * inserted — the whole transaction rolls back, so no conflict and no candidate persist.
 */
export async function insertRuleConflictWithCandidates(
  conflict: RuleConflictInsert,
  candidates: readonly RuleConflictCandidateInsert[],
): Promise<RuleConflictWithCandidates> {
  const conflictId = await prisma.$transaction(async (tx) => {
    const id = await insertRuleConflict(tx, conflict);
    await insertRuleConflictCandidates(tx, id, conflict.entityId, candidates);
    return id;
  });
  const created = await selectRuleConflictWithCandidates(conflictId);
  if (created === null) {
    throw new Error(`RuleConflict ${conflictId} disappeared immediately after commit`);
  }
  return created;
}

/** UUID-safe: a malformed id simply finds nothing (never a raw database error). */
export async function selectRuleConflictById(id: string): Promise<RuleConflict | null> {
  try {
    const row = await prisma.ruleConflict.findUnique({ where: { id } });
    return row ? toDomainRuleConflict(row) : null;
  } catch {
    return null;
  }
}

/**
 * Ordered by the candidate Version's `revisionNumber` ASC, then candidate id ASC —
 * deterministic and independent of input order. A DISPLAY order, never a ranking: it
 * does not suggest that the higher revision wins.
 */
export async function selectRuleConflictCandidates(ruleConflictId: string): Promise<RuleConflictCandidate[]> {
  const rows = await prisma.ruleConflictCandidate.findMany({
    where: { ruleConflictId },
    orderBy: [{ entityVersion: { revisionNumber: "asc" } }, { id: "asc" }],
  });
  return rows.map(toDomainRuleConflictCandidate);
}

export async function selectRuleConflictWithCandidates(id: string): Promise<RuleConflictWithCandidates | null> {
  const conflict = await selectRuleConflictById(id);
  if (conflict === null) {
    return null;
  }
  return { ...conflict, candidates: await selectRuleConflictCandidates(conflict.id) };
}

export interface RuleConflictListWhere {
  entityId?: string;
  status?: RuleConflictStatus;
  severity?: RuleConflictSeverity;
  conflictType?: RuleConflictType;
}

/** A Ruleset's conflicts (headers), simple equality filters, ordered `created_at ASC, id ASC`. */
export async function selectRuleConflictsByRuleset(rulesetId: string, where: RuleConflictListWhere = {}): Promise<RuleConflict[]> {
  const rows = await prisma.ruleConflict.findMany({
    where: { rulesetId, ...where },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainRuleConflict);
}

/** One Entity's conflicts within one Ruleset (headers), ordered `created_at ASC, id ASC`. */
export async function selectRuleConflictsForEntity(rulesetId: string, entityId: string): Promise<RuleConflict[]> {
  return selectRuleConflictsByRuleset(rulesetId, { entityId });
}

/** Constraint names fixed by the M2-WO5 migration (and pinned by its static audit). */
export const RULE_CONFLICT_CONSTRAINTS = {
  duplicateCandidate: "rule_conflict_candidates_conflict_version_key",
  conflictEntity: "rule_conflict_candidates_conflict_entity_fkey",
  versionEntity: "rule_conflict_candidates_version_entity_fkey",
  sourceReference: "rule_conflict_candidates_source_reference_fkey",
} as const;

export function isDuplicateCandidateViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: RULE_CONFLICT_CONSTRAINTS.duplicateCandidate,
    fields: ["rule_conflict_id", "entity_version_id"],
  });
}

/**
 * Which of this table's foreign keys a write violated, or `null`. Duck-typed like
 * `isUniqueViolation`: a Prisma P2003 names the constraint in its message and/or meta
 * (the exact place differs between engines), so both are searched.
 */
export function violatedCandidateForeignKey(error: unknown): keyof typeof RULE_CONFLICT_CONSTRAINTS | null {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== "P2003") {
    return null;
  }
  const e = error as { message?: unknown; meta?: unknown };
  let haystack = typeof e.message === "string" ? e.message : "";
  try {
    haystack += ` ${JSON.stringify(e.meta ?? null)}`;
  } catch {
    // meta is diagnostic only; an unserializable one just contributes nothing
  }
  for (const key of ["conflictEntity", "versionEntity", "sourceReference"] as const) {
    if (haystack.includes(RULE_CONFLICT_CONSTRAINTS[key])) {
      return key;
    }
  }
  return null;
}
