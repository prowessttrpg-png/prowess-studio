import { randomUUID } from "node:crypto";
import {
  CandidateDuplicateGroupId,
  CandidateMatchAssessmentId,
  CandidateMatchSuggestionId,
  EntityId,
  EntityVersionId,
  ExtractionCandidateId,
  ImportBatchId,
  ImportMatchRunId,
  IMPORT_MATCH_OUTCOMES,
  normalizeEntityAlias,
  RulesetManifestId,
  type CandidateDuplicateGroup,
  type CandidateMatchAssessment,
  type CandidateMatchSuggestion,
  type CandidateDuplicateBasis,
  type ExtractionCandidateKind,
  type ImportMatchBasis,
  type ImportMatchOutcome,
  type ImportMatchRun,
  type JsonObject,
} from "@prowess/model";
import { sha256Hex, type EntityIdentityRecord, type MatchCandidateInput, type MatcherOutput } from "@prowess/import";
import { prisma } from "../client.js";
import type { ImportMatchRun as RunRow, Prisma } from "../../generated/prisma/client.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * Import identity-matching repository (PAS-10 M3-WO4). Internal to @prowess/db.
 *
 * READS (never writes): Candidate identity hints, Entity identity (id, type, canonical key), EntityAlias normalized
 * values, and — only for a Batch's exact comparison Manifest — the displayName of each pinned Version. No "latest"
 * Version, Manifest, Release or policy is ever selected.
 * WRITES only the five WO4 analysis tables, only by INSERT, all of one run in ONE transaction.
 */
const PAGE = 5_000;
const ROWS = 2_000;
export const RUN_FINGERPRINT_UNIQUE = "import_match_runs_run_fingerprint_key";

export class CatalogIntegrityError extends Error {}

/** Candidate identity hints of a Batch, paged by ordinal. */
export async function selectMatchCandidates(importBatchId: string): Promise<MatchCandidateInput[]> {
  const out: MatchCandidateInput[] = [];
  let after = 0;
  for (;;) {
    const page = await prisma.extractionCandidate.findMany({
      where: { importBatchId, ordinal: { gt: after } },
      select: { id: true, ordinal: true, candidateKind: true, proposedEntityType: true, proposedCanonicalKey: true, displayLabel: true },
      orderBy: { ordinal: "asc" },
      take: PAGE,
    });
    out.push(...page.map((c) => ({ candidateId: c.id, ordinal: c.ordinal, candidateKind: c.candidateKind as ExtractionCandidateKind, proposedEntityType: c.proposedEntityType, proposedCanonicalKey: c.proposedCanonicalKey, displayLabel: c.displayLabel })));
    if (page.length < PAGE) return out;
    after = (page[page.length - 1] as { ordinal: number }).ordinal;
  }
}

async function pagedById<T extends { id: string }>(load: (after: string | null) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await load(after);
    out.push(...page);
    if (page.length < PAGE) return out;
    after = (page[page.length - 1] as T).id;
  }
}

/**
 * The deterministic Entity identity catalog. `comparison` maps entityId -> exact pinned Version id (from the
 * approved M2 effective-Manifest resolver); only those Versions' display names are read.
 */
export async function selectEntityCatalog(comparison: ReadonlyMap<string, string> | null): Promise<EntityIdentityRecord[]> {
  const entities = await pagedById((after) =>
    prisma.entity.findMany({ where: after === null ? {} : { id: { gt: after } }, select: { id: true, entityType: true, canonicalKey: true }, orderBy: { id: "asc" }, take: PAGE }),
  );
  const aliases = await pagedById((after) =>
    prisma.entityAlias.findMany({ where: after === null ? {} : { id: { gt: after } }, select: { id: true, entityId: true, alias: true, normalizedAlias: true, context: true, normalizedContext: true }, orderBy: { id: "asc" }, take: PAGE }),
  );
  const aliasesByEntity = new Map<string, Array<{ normalizedAlias: string; normalizedContext: string }>>();
  for (const a of aliases) {
    // Integrity: the stored lookup forms must be exactly M1's normalization of the authored values.
    const expectedContext = a.context !== null ? normalizeEntityAlias(a.context) : "";
    if (a.normalizedAlias !== normalizeEntityAlias(a.alias) || a.normalizedContext !== expectedContext) {
      throw new CatalogIntegrityError(`EntityAlias ${a.id}: stored normalized alias/context is not the M1 normalization of its authored value`);
    }
    aliasesByEntity.set(a.entityId, [...(aliasesByEntity.get(a.entityId) ?? []), { normalizedAlias: a.normalizedAlias, normalizedContext: a.normalizedContext }]);
  }
  const displayByVersion = new Map<string, string>();
  if (comparison !== null) {
    const versionIds = [...new Set(comparison.values())];
    for (let i = 0; i < versionIds.length; i += PAGE) {
      const rows = await prisma.entityVersion.findMany({ where: { id: { in: versionIds.slice(i, i + PAGE) } }, select: { id: true, displayName: true } });
      for (const r of rows) displayByVersion.set(r.id, r.displayName);
    }
  }
  return entities.map((e) => {
    const versionId = comparison?.get(e.id) ?? null;
    return {
      entityId: e.id,
      entityType: e.entityType,
      canonicalKey: e.canonicalKey,
      aliases: aliasesByEntity.get(e.id) ?? [],
      comparisonEntityVersionId: versionId,
      comparisonDisplayLabel: versionId === null ? null : (displayByVersion.get(versionId) ?? null),
    };
  });
}

// ---- writes ---------------------------------------------------------------------------------------------------------

export interface InsertMatchRunInput {
  importBatchId: string;
  candidateSetHash: string;
  comparisonManifestId: string | null;
  matcherKey: string;
  matcherVersion: string;
  matcherConfigHash: string;
  matcherConfig: JsonObject;
  entityCatalogHash: string;
  runFingerprint: string;
  resultHash: string;
}

/** Writes the run and its entire result in ONE transaction, or returns "DUPLICATE" when the fingerprint exists. */
export async function insertMatchRun(input: InsertMatchRunInput, output: MatcherOutput): Promise<string | "DUPLICATE"> {
  const runId = randomUUID();
  const b = input.importBatchId;
  const assessments: Prisma.CandidateMatchAssessmentCreateManyInput[] = [];
  const suggestions: Prisma.CandidateMatchSuggestionCreateManyInput[] = [];
  for (const a of output.assessments) {
    const id = randomUUID();
    assessments.push({
      id, matchRunId: runId, importBatchId: b, extractionCandidateId: a.candidateId, outcome: a.outcome, matchedBy: a.matchedBy, matchedEntityId: a.matchedEntityId,
      normalizedCandidateLabel: a.normalizedCandidateLabel, normalizedProposedCanonicalKey: a.normalizedProposedCanonicalKey, comparisonEntityVersionId: a.comparisonEntityVersionId,
    });
    for (const s of a.suggestions) suggestions.push({ candidateMatchAssessmentId: id, entityId: s.entityId, rank: s.rank, score: s.score, basis: s.basis, comparisonEntityVersionId: s.comparisonEntityVersionId });
  }
  const groups: Prisma.CandidateDuplicateGroupCreateManyInput[] = [];
  const members: Prisma.CandidateDuplicateGroupMemberCreateManyInput[] = [];
  for (const g of output.duplicateGroups) {
    const id = randomUUID();
    groups.push({ id, matchRunId: runId, importBatchId: b, basis: g.basis, identityKey: g.identityKey, identityKeyHash: sha256Hex(g.identityKey) });
    g.memberCandidateIds.forEach((candidateId, i) => members.push({ groupId: id, importBatchId: b, extractionCandidateId: candidateId, ordinal: i + 1 }));
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.importMatchRun.create({
          data: {
            id: runId, importBatchId: b, candidateSetHash: input.candidateSetHash, comparisonManifestId: input.comparisonManifestId, matcherKey: input.matcherKey, matcherVersion: input.matcherVersion,
            matcherConfigHash: input.matcherConfigHash, matcherConfigJson: input.matcherConfig as Prisma.InputJsonObject, entityCatalogHash: input.entityCatalogHash, runFingerprint: input.runFingerprint, resultHash: input.resultHash,
          },
        });
        for (let i = 0; i < assessments.length; i += ROWS) await tx.candidateMatchAssessment.createMany({ data: assessments.slice(i, i + ROWS) });
        for (let i = 0; i < suggestions.length; i += ROWS) await tx.candidateMatchSuggestion.createMany({ data: suggestions.slice(i, i + ROWS) });
        for (let i = 0; i < groups.length; i += ROWS) await tx.candidateDuplicateGroup.createMany({ data: groups.slice(i, i + ROWS) });
        for (let i = 0; i < members.length; i += ROWS) await tx.candidateDuplicateGroupMember.createMany({ data: members.slice(i, i + ROWS) });
      },
      { maxWait: 10_000, timeout: 300_000 },
    );
    return runId;
  } catch (error) {
    if (isUniqueViolation(error, { constraint: RUN_FINGERPRINT_UNIQUE, fields: ["run_fingerprint"] })) return "DUPLICATE";
    throw error;
  }
}

// ---- reads --------------------------------------------------------------------------------------------------------

export function toDomainRun(r: RunRow): ImportMatchRun {
  return {
    id: ImportMatchRunId.of(r.id),
    importBatchId: ImportBatchId.of(r.importBatchId),
    matcherKey: r.matcherKey,
    matcherVersion: r.matcherVersion,
    matcherConfigHash: r.matcherConfigHash,
    matcherConfig: r.matcherConfigJson as JsonObject,
    candidateSetHash: r.candidateSetHash,
    entityCatalogHash: r.entityCatalogHash,
    comparisonManifestId: r.comparisonManifestId === null ? null : RulesetManifestId.of(r.comparisonManifestId),
    runFingerprint: r.runFingerprint,
    resultHash: r.resultHash,
    createdAt: r.createdAt,
  };
}

export async function selectRunById(id: string): Promise<ImportMatchRun | null> {
  const r = await prisma.importMatchRun.findUnique({ where: { id } });
  return r ? toDomainRun(r) : null;
}

export async function selectRunByFingerprint(runFingerprint: string): Promise<ImportMatchRun | null> {
  const r = await prisma.importMatchRun.findUnique({ where: { runFingerprint } });
  return r ? toDomainRun(r) : null;
}

/** History order (`createdAt ASC, id ASC`). There is no current / active / latest run. */
export async function selectRunsForBatch(importBatchId: string): Promise<ImportMatchRun[]> {
  return (await prisma.importMatchRun.findMany({ where: { importBatchId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(toDomainRun);
}

export async function selectRunSummary(matchRunId: string): Promise<{ assessmentCount: number; byOutcome: Record<ImportMatchOutcome, number>; duplicateGroupCount: number }> {
  const [groups, duplicateGroupCount] = await Promise.all([
    prisma.candidateMatchAssessment.groupBy({ by: ["outcome"], where: { matchRunId }, _count: { _all: true } }),
    prisma.candidateDuplicateGroup.count({ where: { matchRunId } }),
  ]);
  const byOutcome = Object.fromEntries(IMPORT_MATCH_OUTCOMES.map((o) => [o, 0])) as Record<ImportMatchOutcome, number>;
  for (const g of groups) byOutcome[g.outcome as ImportMatchOutcome] = g._count._all;
  return { assessmentCount: groups.reduce((n, g) => n + g._count._all, 0), byOutcome, duplicateGroupCount };
}

/** Assessments of a run (optionally one Candidate), in Candidate ordinal order, each with ranked suggestions. */
export async function selectAssessments(matchRunId: string, extractionCandidateId?: string): Promise<CandidateMatchAssessment[]> {
  const rows = await pagedById((after) =>
    prisma.candidateMatchAssessment.findMany({
      where: { matchRunId, ...(extractionCandidateId === undefined ? {} : { extractionCandidateId }), ...(after === null ? {} : { id: { gt: after } }) },
      orderBy: { id: "asc" },
      take: PAGE,
    }),
  );
  const ids = rows.map((r) => r.id);
  const suggestions: Array<Awaited<ReturnType<typeof prisma.candidateMatchSuggestion.findMany>>[number]> = [];
  for (let i = 0; i < ids.length; i += PAGE) suggestions.push(...(await prisma.candidateMatchSuggestion.findMany({ where: { candidateMatchAssessmentId: { in: ids.slice(i, i + PAGE) } } })));
  const ordinals = new Map<string, number>();
  const candidateIds = rows.map((r) => r.extractionCandidateId);
  for (let i = 0; i < candidateIds.length; i += PAGE) {
    for (const c of await prisma.extractionCandidate.findMany({ where: { id: { in: candidateIds.slice(i, i + PAGE) } }, select: { id: true, ordinal: true } })) ordinals.set(c.id, c.ordinal);
  }
  const byAssessment = new Map<string, CandidateMatchSuggestion[]>();
  for (const s of suggestions) {
    byAssessment.set(s.candidateMatchAssessmentId, [
      ...(byAssessment.get(s.candidateMatchAssessmentId) ?? []),
      {
        id: CandidateMatchSuggestionId.of(s.id),
        candidateMatchAssessmentId: CandidateMatchAssessmentId.of(s.candidateMatchAssessmentId),
        entityId: EntityId.of(s.entityId),
        rank: s.rank,
        score: s.score,
        basis: s.basis as ImportMatchBasis,
        comparisonEntityVersionId: s.comparisonEntityVersionId === null ? null : EntityVersionId.of(s.comparisonEntityVersionId),
        createdAt: s.createdAt,
      },
    ]);
  }
  return rows
    .map((r) => ({
      id: CandidateMatchAssessmentId.of(r.id),
      matchRunId: ImportMatchRunId.of(r.matchRunId),
      importBatchId: ImportBatchId.of(r.importBatchId),
      extractionCandidateId: ExtractionCandidateId.of(r.extractionCandidateId),
      outcome: r.outcome as ImportMatchOutcome,
      matchedEntityId: r.matchedEntityId === null ? null : EntityId.of(r.matchedEntityId),
      matchedBy: r.matchedBy as ImportMatchBasis,
      normalizedCandidateLabel: r.normalizedCandidateLabel,
      normalizedProposedCanonicalKey: r.normalizedProposedCanonicalKey,
      comparisonEntityVersionId: r.comparisonEntityVersionId === null ? null : EntityVersionId.of(r.comparisonEntityVersionId),
      suggestions: (byAssessment.get(r.id) ?? []).sort((a, b) => a.rank - b.rank),
      createdAt: r.createdAt,
    }))
    .sort((a, b) => (ordinals.get(a.extractionCandidateId) ?? 0) - (ordinals.get(b.extractionCandidateId) ?? 0));
}

/** Duplicate groups of a run (basis, identity key order) with members in display order. */
export async function selectDuplicateGroups(matchRunId: string): Promise<CandidateDuplicateGroup[]> {
  // Same total order as the matcher's output (basis name, then identity key, by code unit) — never enum declaration order.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const groups = (await prisma.candidateDuplicateGroup.findMany({ where: { matchRunId } })).sort((a, b) => cmp(a.basis, b.basis) || cmp(a.identityKey, b.identityKey));
  const members = groups.length === 0 ? [] : await prisma.candidateDuplicateGroupMember.findMany({ where: { groupId: { in: groups.map((g) => g.id) } }, orderBy: [{ groupId: "asc" }, { ordinal: "asc" }] });
  return groups.map((g) => ({
    id: CandidateDuplicateGroupId.of(g.id),
    matchRunId: ImportMatchRunId.of(g.matchRunId),
    basis: g.basis as CandidateDuplicateBasis,
    identityKey: g.identityKey,
    identityKeyHash: g.identityKeyHash,
    memberCandidateIds: members.filter((m) => m.groupId === g.id).map((m) => ExtractionCandidateId.of(m.extractionCandidateId)),
    createdAt: g.createdAt,
  }));
}
