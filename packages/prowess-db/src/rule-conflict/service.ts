import {
  DomainError,
  RULE_CONFLICT_ERROR_CODES,
  validateCreateRuleConflictInput,
  validateListRuleConflictsFilters,
  type CreateRuleConflictInput,
  type ListRuleConflictsFilters,
  type RuleConflict,
  type RuleConflictSeverity,
  type RuleConflictStatus,
  type RuleConflictType,
  type RuleConflictWithCandidates,
} from "@prowess/model";
import { selectEntityById } from "../entity/repository.js";
import { selectEntityVersionById } from "../entity-version/repository.js";
import { selectRulesetById } from "../ruleset/repository.js";
import { selectSourceReferenceById } from "../source-reference/repository.js";
import {
  insertRuleConflictWithCandidates,
  isDuplicateCandidateViolation,
  selectRuleConflictsByRuleset,
  selectRuleConflictsForEntity,
  selectRuleConflictWithCandidates,
  violatedCandidateForeignKey,
  type RuleConflictCandidateInsert,
} from "./repository.js";

/**
 * RuleConflict service (PAS-10 M2-WO5) — explicit, Ruleset-scoped records of rule
 * disagreements between exact historical EntityVersions.
 *
 * A conflict RECORDS an observation; it never RESOLVES one. Nothing here selects a
 * candidate, reads or alters a manifest, consults inheritance, reads source authority,
 * changes an EntityVersion's status, or infers a "latest" anything. The only reads of
 * other domains are EXISTENCE and OWNERSHIP checks by exact id (Ruleset, Entity,
 * EntityVersion, SourceReference). Type and severity are stored, never acted on.
 *
 * Deliberately absent: any operation that changes a conflict after creation — no status
 * transition, edit, candidate change, winner, or delete. M2-WO6 (Canon Decisions) owns
 * outcomes. A static audit scans this directory for anything that would break this.
 */

const normalizeId = (value: string) => value.trim().toLowerCase();

async function requireRuleset(rulesetId: string) {
  const ruleset = await selectRulesetById(rulesetId);
  if (ruleset === null) {
    throw new DomainError(RULE_CONFLICT_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  }
  return ruleset;
}

async function requireEntity(entityId: string) {
  const entity = await selectEntityById(normalizeId(entityId));
  if (entity === null) {
    throw new DomainError(RULE_CONFLICT_ERROR_CODES.ENTITY_NOT_FOUND, `Entity not found: ${entityId}`);
  }
  return entity;
}

/**
 * Records a new conflict, OPEN, with exactly the supplied candidates — atomically.
 *
 * Validation, in this order — the first failure is reported and NOTHING is written:
 *   1. input shape (title, type, severity, field types, the candidate cap) -> INVALID_INPUT
 *      fewer than two candidates                                          -> INSUFFICIENT_CANDIDATES
 *      the same EntityVersion twice                                       -> DUPLICATE_CANDIDATE
 *   2. the Ruleset exists                                                 -> RULESET_NOT_FOUND
 *   3. the Entity exists                                                  -> ENTITY_NOT_FOUND
 *   4. for each candidate, in input order:
 *        the EntityVersion exists                                         -> VERSION_NOT_FOUND
 *        it belongs to the conflict's Entity                              -> VERSION_ENTITY_MISMATCH
 *        an optional SourceReference exists and belongs to THAT Version   -> INVALID_SOURCE_REFERENCE
 *   5. write the conflict + every candidate in ONE transaction. The composite foreign keys
 *      re-check steps 4's ownership rules in the database; a rejection there (a concurrent
 *      change) maps to the same codes and rolls everything back.
 *
 * There is no status input: every conflict starts OPEN. Nothing about the conflict's type
 * or severity triggers any other behavior.
 */
export async function createRuleConflict(rulesetId: string, input: CreateRuleConflictInput): Promise<RuleConflictWithCandidates> {
  const problem = validateCreateRuleConflictInput(input);
  if (problem !== null) {
    if (problem.kind === "INSUFFICIENT_CANDIDATES") {
      throw new DomainError(RULE_CONFLICT_ERROR_CODES.INSUFFICIENT_CANDIDATES, problem.message);
    }
    if (problem.kind === "DUPLICATE_CANDIDATE") {
      throw new DomainError(RULE_CONFLICT_ERROR_CODES.DUPLICATE_CANDIDATE, problem.message);
    }
    throw new DomainError(RULE_CONFLICT_ERROR_CODES.INVALID_INPUT, problem.message);
  }

  const ruleset = await requireRuleset(rulesetId);
  const entity = await requireEntity(input.entityId);

  const candidates: RuleConflictCandidateInsert[] = [];
  for (const [index, candidate] of input.candidates.entries()) {
    const version = await selectEntityVersionById(normalizeId(candidate.entityVersionId));
    if (version === null) {
      throw new DomainError(RULE_CONFLICT_ERROR_CODES.VERSION_NOT_FOUND, `candidates[${index}]: EntityVersion not found: ${candidate.entityVersionId}`);
    }
    if (version.entityId !== entity.id) {
      throw new DomainError(
        RULE_CONFLICT_ERROR_CODES.VERSION_ENTITY_MISMATCH,
        `candidates[${index}]: EntityVersion ${version.id} belongs to Entity ${version.entityId}, not the conflict's Entity ${entity.id}`,
      );
    }

    let sourceReferenceId: string | null = null;
    if (candidate.sourceReferenceId !== undefined && candidate.sourceReferenceId !== null) {
      const reference = await selectSourceReferenceById(normalizeId(candidate.sourceReferenceId));
      if (reference === null) {
        throw new DomainError(
          RULE_CONFLICT_ERROR_CODES.INVALID_SOURCE_REFERENCE,
          `candidates[${index}]: SourceReference not found: ${candidate.sourceReferenceId}`,
        );
      }
      if (reference.entityVersionId !== version.id) {
        throw new DomainError(
          RULE_CONFLICT_ERROR_CODES.INVALID_SOURCE_REFERENCE,
          `candidates[${index}]: SourceReference ${reference.id} belongs to EntityVersion ${reference.entityVersionId}, not the candidate's EntityVersion ${version.id}`,
        );
      }
      sourceReferenceId = reference.id;
    }

    candidates.push({
      entityVersionId: version.id,
      sourceReferenceId,
      label: candidate.label ?? null,
      positionSummary: candidate.positionSummary ?? null,
    });
  }

  try {
    return await insertRuleConflictWithCandidates(
      {
        rulesetId: ruleset.id,
        entityId: entity.id,
        conflictType: input.conflictType as RuleConflictType, // validated above
        severity: input.severity as RuleConflictSeverity, // validated above
        title: input.title.trim(),
        description: input.description ?? null,
      },
      candidates,
    );
  } catch (error) {
    throw mapRuleConflictWriteError(error);
  }
}

/**
 * Translates a database rejection of a conflict write into the controlled vocabulary.
 * Reachable only when the database disagrees with the service's checks (a concurrent
 * change between validation and commit); anything unrecognized is returned unchanged.
 */
export function mapRuleConflictWriteError(error: unknown): unknown {
  if (isDuplicateCandidateViolation(error)) {
    return new DomainError(RULE_CONFLICT_ERROR_CODES.DUPLICATE_CANDIDATE, "An EntityVersion may appear only once in one conflict");
  }
  switch (violatedCandidateForeignKey(error)) {
    case "versionEntity":
      return new DomainError(
        RULE_CONFLICT_ERROR_CODES.VERSION_ENTITY_MISMATCH,
        "A candidate's EntityVersion does not exist or does not belong to the conflict's Entity",
      );
    case "sourceReference":
      return new DomainError(
        RULE_CONFLICT_ERROR_CODES.INVALID_SOURCE_REFERENCE,
        "A candidate's SourceReference does not exist or does not belong to the candidate's EntityVersion",
      );
    default:
      return error;
  }
}

/** By explicit identity: absence is exceptional (`RULE_CONFLICT.NOT_FOUND`), including a malformed id. No winner is computed. */
export async function getRuleConflict(conflictId: string): Promise<RuleConflictWithCandidates> {
  const conflict = await selectRuleConflictWithCandidates(normalizeId(conflictId));
  if (conflict === null) {
    throw new DomainError(RULE_CONFLICT_ERROR_CODES.NOT_FOUND, `RuleConflict not found: ${conflictId}`);
  }
  return conflict;
}

/**
 * A Ruleset's conflicts (headers; use `getRuleConflict` for candidates), ordered
 * `created_at ASC, id ASC`, optionally filtered by exact entityId / status / severity /
 * conflictType. A Ruleset with none lists as empty; one that does not exist is
 * RULESET_NOT_FOUND; a filter Entity that does not exist is ENTITY_NOT_FOUND.
 */
export async function listRuleConflicts(rulesetId: string, filters?: ListRuleConflictsFilters): Promise<RuleConflict[]> {
  const problem = validateListRuleConflictsFilters(filters);
  if (problem !== null) {
    throw new DomainError(RULE_CONFLICT_ERROR_CODES.INVALID_INPUT, problem.message);
  }
  const ruleset = await requireRuleset(rulesetId);
  const where: Parameters<typeof selectRuleConflictsByRuleset>[1] = {};
  if (filters?.entityId !== undefined) where.entityId = (await requireEntity(filters.entityId)).id;
  if (filters?.status !== undefined) where.status = filters.status as RuleConflictStatus;
  if (filters?.severity !== undefined) where.severity = filters.severity as RuleConflictSeverity;
  if (filters?.conflictType !== undefined) where.conflictType = filters.conflictType as RuleConflictType;
  return selectRuleConflictsByRuleset(ruleset.id, where);
}

/** One Entity's conflicts within one Ruleset (headers), ordered `created_at ASC, id ASC`. */
export async function listRuleConflictsForEntity(rulesetId: string, entityId: string): Promise<RuleConflict[]> {
  const ruleset = await requireRuleset(rulesetId);
  const entity = await requireEntity(entityId);
  return selectRuleConflictsForEntity(ruleset.id, entity.id);
}
