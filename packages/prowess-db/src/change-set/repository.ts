import {
  CanonDecisionId,
  ChangeSetId,
  ChangeSetOperationId,
  EntityId,
  EntityVersionId,
  INITIAL_CHANGE_SET_STATUS,
  RulesetId,
  RulesetManifestId,
  type ChangeSet,
  type ChangeSetOperation,
  type ChangeSetOperationType,
  type ChangeSetStatus,
  type ChangeSetWithOperations,
} from "@prowess/model";
import { prisma } from "../client.js";
import type {
  ChangeSet as PrismaChangeSetRow,
  ChangeSetOperation as PrismaOperationRow,
} from "../../generated/prisma/client.js";

/**
 * ChangeSet repository — the only place that speaks Prisma's ChangeSet API.
 * Internal to @prowess/db (not exported from `index.ts`); see `./service.ts` and `./impact.ts`.
 *
 * WRITES exactly two things: new ChangeSet rows and their operation rows. Every other function is a
 * read. Nothing here updates or deletes any row — of a ChangeSet or of anything a ChangeSet mentions.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export function toDomainChangeSet(row: PrismaChangeSetRow): ChangeSet {
  return {
    id: ChangeSetId.of(row.id),
    rulesetId: RulesetId.of(row.rulesetId),
    canonDecisionId: row.canonDecisionId === null ? null : CanonDecisionId.of(row.canonDecisionId),
    name: row.name,
    description: row.description,
    status: row.status as ChangeSetStatus,
    createdAt: row.createdAt,
  };
}

/** The redundant `rulesetId` integrity column is not part of the domain shape. */
export function toDomainChangeSetOperation(row: PrismaOperationRow): ChangeSetOperation {
  return {
    id: ChangeSetOperationId.of(row.id),
    changeSetId: ChangeSetId.of(row.changeSetId),
    sequence: row.sequence,
    operationType: row.operationType as ChangeSetOperationType,
    targetEntityId: row.targetEntityId === null ? null : EntityId.of(row.targetEntityId),
    fromEntityVersionId: row.fromEntityVersionId === null ? null : EntityVersionId.of(row.fromEntityVersionId),
    toEntityVersionId: row.toEntityVersionId === null ? null : EntityVersionId.of(row.toEntityVersionId),
    targetManifestId: row.targetManifestId === null ? null : RulesetManifestId.of(row.targetManifestId),
    description: row.description,
    createdAt: row.createdAt,
  };
}

export interface ChangeSetInsert {
  rulesetId: string;
  canonDecisionId: string | null;
  name: string;
  description: string | null;
}

export interface ChangeSetOperationInsert {
  operationType: ChangeSetOperationType;
  targetEntityId: string | null;
  fromEntityVersionId: string | null;
  toEntityVersionId: string | null;
  targetManifestId: string | null;
  description: string | null;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Inserts the header, always DRAFT — there is no parameter for status. */
export async function insertChangeSet(tx: Tx, changeSet: ChangeSetInsert): Promise<string> {
  const row = await tx.changeSet.create({ data: { ...changeSet, status: INITIAL_CHANGE_SET_STATUS }, select: { id: true } });
  return row.id;
}

/** Inserts operations in input order as sequence 1..n; each row's rulesetId is ALWAYS the ChangeSet's own. */
export async function insertChangeSetOperations(
  tx: Tx,
  changeSetId: string,
  rulesetId: string,
  operations: readonly ChangeSetOperationInsert[],
): Promise<void> {
  for (const [index, operation] of operations.entries()) {
    await tx.changeSetOperation.create({ data: { changeSetId, rulesetId, sequence: index + 1, ...operation }, select: { id: true } });
  }
}

/** ChangeSet + every operation in ONE transaction: an invalid later operation leaves nothing behind. */
export async function insertChangeSetWithOperations(
  changeSet: ChangeSetInsert,
  operations: readonly ChangeSetOperationInsert[],
): Promise<ChangeSetWithOperations> {
  const id = await prisma.$transaction(async (tx) => {
    const created = await insertChangeSet(tx, changeSet);
    await insertChangeSetOperations(tx, created, changeSet.rulesetId, operations);
    return created;
  });
  const stored = await selectChangeSetWithOperations(id);
  if (stored === null) {
    throw new Error(`ChangeSet ${id} disappeared immediately after commit`);
  }
  return stored;
}

/** UUID-safe: a malformed id finds nothing. */
export async function selectChangeSetById(id: string): Promise<ChangeSet | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.changeSet.findUnique({ where: { id } });
  return row ? toDomainChangeSet(row) : null;
}

/** Operations in the author's order (`sequence` ASC). */
export async function selectChangeSetOperations(changeSetId: string): Promise<ChangeSetOperation[]> {
  const rows = await prisma.changeSetOperation.findMany({ where: { changeSetId }, orderBy: { sequence: "asc" } });
  return rows.map(toDomainChangeSetOperation);
}

export async function selectChangeSetWithOperations(id: string): Promise<ChangeSetWithOperations | null> {
  const changeSet = await selectChangeSetById(id);
  if (changeSet === null) return null;
  return { ...changeSet, operations: await selectChangeSetOperations(changeSet.id) };
}

/** A Ruleset's ChangeSets (headers), simple equality filters, ordered `created_at ASC, id ASC`. */
export async function selectChangeSetsByRuleset(
  rulesetId: string,
  where: { canonDecisionId?: string; status?: ChangeSetStatus } = {},
): Promise<ChangeSet[]> {
  const rows = await prisma.changeSet.findMany({ where: { rulesetId, ...where }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(toDomainChangeSet);
}

/** Exact-id lookup of a conflict candidate's Version (for decision translation). */
export async function selectCandidateEntityVersionId(candidateId: string): Promise<string | null> {
  if (!isUuid(candidateId)) return null;
  const row = await prisma.ruleConflictCandidate.findUnique({ where: { id: candidateId }, select: { entityVersionId: true } });
  return row?.entityVersionId ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Impact reads (§39). All read-only.
// ---------------------------------------------------------------------------------------------------

export interface ManifestNode {
  id: string;
  rulesetId: string;
  parentManifestId: string | null;
}

/** Exact-id manifest lookup returning only what impact analysis needs. */
export async function selectManifestNode(id: string): Promise<ManifestNode | null> {
  if (!isUuid(id)) return null;
  return prisma.rulesetManifest.findUnique({ where: { id }, select: { id: true, rulesetId: true, parentManifestId: true } });
}

/**
 * Every manifest that inherits from `manifestId`, directly or transitively, via exact
 * `parent_manifest_id` links (M2-WO3), with its depth (1 = direct child). Breadth-first; inheritance is
 * acyclic by construction (a parent always pre-exists its child), and a visited set guards anyway.
 */
export async function selectInheritingManifests(manifestId: string): Promise<Array<ManifestNode & { depth: number }>> {
  const found: Array<ManifestNode & { depth: number }> = [];
  const seen = new Set<string>([manifestId]);
  let frontier = [manifestId];
  for (let depth = 1; frontier.length > 0; depth++) {
    const children = await prisma.rulesetManifest.findMany({
      where: { parentManifestId: { in: frontier } },
      select: { id: true, rulesetId: true, parentManifestId: true },
      orderBy: { id: "asc" },
    });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push({ ...child, depth });
      frontier.push(child.id);
    }
  }
  return found;
}

/** ONE hop of generic relationships touching `entityId`, in either direction. Never recursive. */
export async function selectImpactRelationships(
  entityId: string,
): Promise<Array<{ id: string; sourceEntityId: string; targetEntityId: string; relationshipType: string }>> {
  return prisma.entityRelationship.findMany({
    where: { OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }] },
    select: { id: true, sourceEntityId: true, targetEntityId: true, relationshipType: true },
    orderBy: { id: "asc" },
  });
}

/** Keyword assignments on an Entity and on exact Versions — review context, never interpreted. */
export async function selectImpactKeywords(entityIds: readonly string[], versionIds: readonly string[]) {
  const [entityKeywords, versionKeywords] = await Promise.all([
    prisma.entityKeyword.findMany({
      where: { entityId: { in: [...entityIds] } },
      select: { entityId: true, keywordId: true, keyword: { select: { canonicalKey: true } } },
    }),
    prisma.entityVersionKeyword.findMany({
      where: { entityVersionId: { in: [...versionIds] } },
      select: { entityVersionId: true, keywordId: true, keyword: { select: { canonicalKey: true } } },
    }),
  ]);
  return { entityKeywords, versionKeywords };
}

/** SourceReferences of exact Versions — provenance context. */
export async function selectImpactSources(versionIds: readonly string[]) {
  return prisma.sourceReference.findMany({
    where: { entityVersionId: { in: [...versionIds] } },
    select: { id: true, entityVersionId: true, sourceDocumentId: true },
    orderBy: { id: "asc" },
  });
}

/**
 * Governance context in ONE Ruleset: conflicts about the given Entities, the decisions on them, and the
 * policies those decisions pinned; plus an explicitly linked decision and its policy.
 */
export async function selectImpactGovernance(rulesetId: string, entityIds: readonly string[], linkedDecisionId: string | null) {
  const conflicts = await prisma.ruleConflict.findMany({
    where: { rulesetId, entityId: { in: [...entityIds] } },
    select: { id: true, entityId: true, status: true },
    orderBy: { id: "asc" },
  });
  const decisions = await prisma.canonDecision.findMany({
    where: {
      OR: [
        { ruleConflictId: { in: conflicts.map((c) => c.id) } },
        ...(linkedDecisionId === null ? [] : [{ id: linkedDecisionId }]),
      ],
    },
    select: { id: true, ruleConflictId: true, canonPolicyId: true, decisionType: true },
    orderBy: { id: "asc" },
  });
  return { conflicts, decisions };
}
