import {
  CanonDecisionId,
  CanonDecisionSelectionId,
  CanonPolicyId,
  DECIDABLE_RULE_CONFLICT_STATUSES,
  EntityVersionId,
  RuleConflictCandidateId,
  RuleConflictId,
  RulesetId,
  ruleConflictStatusForDisposition,
  type CanonConflictDisposition,
  type CanonDecision,
  type CanonDecisionSelection,
  type CanonDecisionType,
  type CanonDecisionWithSelections,
} from "@prowess/model";
import { prisma } from "../client.js";
import { isUniqueViolation } from "../prisma-errors.js";
import type {
  CanonDecision as PrismaDecisionRow,
  CanonDecisionSelection as PrismaSelectionRow,
} from "../../generated/prisma/client.js";

/**
 * CanonDecision repository — the only place that speaks Prisma's decision API.
 * Internal to @prowess/db (not exported from `index.ts`); see `./service.ts`.
 *
 * It writes exactly two things: new decision rows, and — inside the same transaction — the one
 * permitted change to an existing row, a RuleConflict's status moving from OPEN/UNDER_REVIEW to the
 * decision's disposition. It never touches a manifest, an EntityVersion, a policy, or a Ruleset.
 */

export function toDomainCanonDecision(row: PrismaDecisionRow): CanonDecision {
  return {
    id: CanonDecisionId.of(row.id),
    rulesetId: RulesetId.of(row.rulesetId),
    ruleConflictId: RuleConflictId.of(row.ruleConflictId),
    canonPolicyId: CanonPolicyId.of(row.canonPolicyId),
    decisionType: row.decisionType as CanonDecisionType,
    conflictDisposition: row.conflictDisposition as CanonConflictDisposition,
    resultEntityVersionId: row.resultEntityVersionId === null ? null : EntityVersionId.of(row.resultEntityVersionId),
    rationale: row.rationale,
    createdAt: row.createdAt,
  };
}

/** The redundant `ruleConflictId` integrity column is not part of the domain shape. */
export function toDomainCanonDecisionSelection(row: PrismaSelectionRow): CanonDecisionSelection {
  return {
    id: CanonDecisionSelectionId.of(row.id),
    canonDecisionId: CanonDecisionId.of(row.canonDecisionId),
    ruleConflictCandidateId: RuleConflictCandidateId.of(row.ruleConflictCandidateId),
    createdAt: row.createdAt,
  };
}

export interface CanonDecisionInsert {
  rulesetId: string;
  entityId: string;
  ruleConflictId: string;
  canonPolicyId: string;
  decisionType: CanonDecisionType;
  conflictDisposition: CanonConflictDisposition;
  resultEntityVersionId: string | null;
  rationale: string;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Thrown inside the transaction when the conflict is no longer OPEN/UNDER_REVIEW; aborts it. */
export class RuleConflictNotDecidableError extends Error {
  constructor(readonly ruleConflictId: string) {
    super(`RuleConflict ${ruleConflictId} is not OPEN or UNDER_REVIEW`);
    this.name = "RuleConflictNotDecidableError";
  }
}

/**
 * The internal, conditional status transition (§52, §65) — deliberately NOT exported from the
 * package: the only way a conflict leaves OPEN/UNDER_REVIEW is through decision creation.
 *
 * One statement: `UPDATE rule_conflicts SET status = <disposition> WHERE id = $1 AND status IN
 * ('OPEN','UNDER_REVIEW')`. PostgreSQL row-locks the conflict; a concurrent writer for the same
 * conflict blocks, re-evaluates the predicate after this transaction commits, matches zero rows, and
 * so cannot transition it again. Returns whether this caller won.
 */
export async function transitionRuleConflictToDisposition(
  tx: Tx,
  ruleConflictId: string,
  disposition: CanonConflictDisposition,
): Promise<boolean> {
  const { count } = await tx.ruleConflict.updateMany({
    where: { id: ruleConflictId, status: { in: [...DECIDABLE_RULE_CONFLICT_STATUSES] } },
    data: { status: ruleConflictStatusForDisposition(disposition) },
  });
  return count === 1;
}

/**
 * Creates a decision ATOMICALLY: one transaction that (1) conditionally transitions the conflict —
 * FIRST, so the row lock serializes competing deciders before anything is inserted — then
 * (2) inserts the decision and (3) its selections in order. Any failure, including a database-level
 * rejection of a later selection, rolls back everything: no decision, no selection, and the
 * conflict keeps its prior status.
 */
export async function insertCanonDecisionWithTransition(
  decision: CanonDecisionInsert,
  selectedCandidateIds: readonly string[],
): Promise<CanonDecisionWithSelections> {
  const decisionId = await prisma.$transaction(async (tx) => {
    if (!(await transitionRuleConflictToDisposition(tx, decision.ruleConflictId, decision.conflictDisposition))) {
      throw new RuleConflictNotDecidableError(decision.ruleConflictId);
    }
    const created = await tx.canonDecision.create({ data: decision, select: { id: true } });
    for (const ruleConflictCandidateId of selectedCandidateIds) {
      await tx.canonDecisionSelection.create({
        // ruleConflictId is ALWAYS the decision's own conflict, never caller-supplied.
        data: { canonDecisionId: created.id, ruleConflictId: decision.ruleConflictId, ruleConflictCandidateId },
        select: { id: true },
      });
    }
    return created.id;
  });
  const stored = await selectCanonDecisionWithSelections(decisionId);
  if (stored === null) {
    throw new Error(`CanonDecision ${decisionId} disappeared immediately after commit`);
  }
  return stored;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** UUID-safe: a malformed id simply finds nothing. */
export async function selectCanonDecisionById(id: string): Promise<CanonDecision | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.canonDecision.findUnique({ where: { id } });
  return row ? toDomainCanonDecision(row) : null;
}

/** Ordered by the selected candidate's EntityVersion revision ASC, then selection id ASC — display only. */
export async function selectCanonDecisionSelections(canonDecisionId: string): Promise<CanonDecisionSelection[]> {
  const rows = await prisma.canonDecisionSelection.findMany({
    where: { canonDecisionId },
    orderBy: [{ ruleConflictCandidate: { entityVersion: { revisionNumber: "asc" } } }, { id: "asc" }],
  });
  return rows.map(toDomainCanonDecisionSelection);
}

export async function selectCanonDecisionWithSelections(id: string): Promise<CanonDecisionWithSelections | null> {
  const decision = await selectCanonDecisionById(id);
  if (decision === null) {
    return null;
  }
  return { ...decision, selections: await selectCanonDecisionSelections(decision.id) };
}

export interface CanonDecisionListWhere {
  ruleConflictId?: string;
  canonPolicyId?: string;
  decisionType?: CanonDecisionType;
  conflictDisposition?: CanonConflictDisposition;
}

/** A Ruleset's decisions (headers), simple equality filters, ordered `created_at ASC, id ASC`. */
export async function selectCanonDecisionsByRuleset(rulesetId: string, where: CanonDecisionListWhere = {}): Promise<CanonDecision[]> {
  const rows = await prisma.canonDecision.findMany({
    where: { rulesetId, ...where },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainCanonDecision);
}

/** One conflict's decisions (headers), ordered `created_at ASC, id ASC`. */
export async function selectCanonDecisionsForConflict(ruleConflictId: string): Promise<CanonDecision[]> {
  const rows = await prisma.canonDecision.findMany({ where: { ruleConflictId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(toDomainCanonDecision);
}

/** Exact-id candidate lookups for membership checks: id and owning conflict only. Malformed ids find nothing. */
export async function selectCandidateOwners(ids: readonly string[]): Promise<Map<string, string>> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return new Map();
  const rows = await prisma.ruleConflictCandidate.findMany({ where: { id: { in: valid } }, select: { id: true, ruleConflictId: true } });
  return new Map(rows.map((row) => [row.id, row.ruleConflictId]));
}

/** Constraint names fixed by the M2-WO6 migration (and pinned by its static audit). */
export const CANON_DECISION_CONSTRAINTS = {
  duplicateSelection: "canon_decision_selections_decision_candidate_key",
  conflict: "canon_decisions_conflict_fkey",
  policy: "canon_decisions_policy_fkey",
  resultVersion: "canon_decisions_result_version_fkey",
  selectionDecision: "canon_decision_selections_decision_fkey",
  selectionCandidate: "canon_decision_selections_candidate_fkey",
} as const;

export function isDuplicateSelectionViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: CANON_DECISION_CONSTRAINTS.duplicateSelection,
    fields: ["canon_decision_id", "rule_conflict_candidate_id"],
  });
}

/** Which of the decision tables' foreign keys a write violated (Prisma P2003), or `null`. Duck-typed. */
export function violatedDecisionForeignKey(error: unknown): keyof typeof CANON_DECISION_CONSTRAINTS | null {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== "P2003") {
    return null;
  }
  const e = error as { message?: unknown; meta?: unknown };
  let haystack = typeof e.message === "string" ? e.message : "";
  try {
    haystack += ` ${JSON.stringify(e.meta ?? null)}`;
  } catch {
    // meta is diagnostic only
  }
  for (const key of ["conflict", "policy", "resultVersion", "selectionDecision", "selectionCandidate"] as const) {
    if (haystack.includes(CANON_DECISION_CONSTRAINTS[key])) {
      return key;
    }
  }
  return null;
}

/** A transaction the database aborted because of a concurrent one (Prisma P2034: write conflict / deadlock). */
export function isTransactionConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034";
}
