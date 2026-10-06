import {
  CHANGE_SET_ERROR_CODES,
  DomainError,
  isChangeSetStatus,
  translateDecisionToOperations,
  validateCreateChangeSetInput,
  type ChangeSet,
  type ChangeSetOperationType,
  type ChangeSetStatus,
  type ChangeSetWithOperations,
  type CreateChangeSetInput,
  type ListChangeSetsFilters,
} from "@prowess/model";
import { selectCanonDecisionWithSelections } from "../canon-decision/repository.js";
import { selectEntityById } from "../entity/repository.js";
import { selectEntityVersionById } from "../entity-version/repository.js";
import { selectRuleConflictById } from "../rule-conflict/repository.js";
import { resolveEffectiveEntityVersion } from "../ruleset-inheritance/resolution.js";
import { selectRulesetById } from "../ruleset/repository.js";
import {
  insertChangeSetWithOperations,
  isUuid,
  selectCandidateEntityVersionId,
  selectChangeSetsByRuleset,
  selectChangeSetWithOperations,
  selectManifestNode,
  type ChangeSetOperationInsert,
} from "./repository.js";

/**
 * ChangeSet service (PAS-10 M2-WO7) — immutable PROPOSALS of exact repository/ruleset changes.
 *
 *   CanonDecision creation  ≠  ChangeSet creation  ≠  application/publishing
 *
 * Creating a ChangeSet writes only the ChangeSet and its operations. It never mutates an Entity,
 * EntityVersion, Ruleset, manifest, policy, conflict, decision, authority record, keyword,
 * relationship or source. Reads of other domains are exact-id existence/ownership lookups, plus — for
 * decision translation only — M2-WO3 effective resolution of one exact manifest.
 *
 * Deliberately absent: any update, add/remove-operation, status transition, apply or execute operation.
 */

const normalizeId = (value: string) => value.trim().toLowerCase();
const optionalId = (value: string | null | undefined) => (value === undefined || value === null ? null : normalizeId(value));

/**
 * Records a DRAFT ChangeSet with exactly the supplied operations, atomically.
 *
 * Order — the first failure is reported and NOTHING is written:
 *   0. pure checks: name/description/operation count (1..100) -> INVALID_INPUT; each operation against the
 *      matrix -> INVALID_OPERATION; contradictions between operations -> OPERATION_CONFLICT
 *   1. the Ruleset exists                                    -> RULESET_NOT_FOUND
 *   2. a linked CanonDecision exists                          -> DECISION_NOT_FOUND
 *      and belongs to the same Ruleset                        -> INVALID_DECISION_CONTEXT
 *   3. for each operation, in order:
 *        the target Entity exists                             -> ENTITY_NOT_FOUND
 *        each from/to Version exists                          -> VERSION_NOT_FOUND
 *        and belongs to the target Entity                     -> VERSION_ENTITY_MISMATCH
 *        a target manifest exists                             -> MANIFEST_NOT_FOUND
 *        and belongs to the ChangeSet's Ruleset               -> INVALID_MANIFEST_CONTEXT
 *   4. ONE transaction: the ChangeSet (DRAFT), then its operations as sequence 1..n.
 * The database's composite keys re-check steps 2–3 and map to the same codes.
 */
export async function createChangeSet(rulesetId: string, input: CreateChangeSetInput): Promise<ChangeSetWithOperations> {
  const problem = validateCreateChangeSetInput(input);
  if (problem !== null) {
    if (problem.kind === "INVALID_OPERATION") throw new DomainError(CHANGE_SET_ERROR_CODES.INVALID_OPERATION, problem.message);
    if (problem.kind === "OPERATION_CONFLICT") throw new DomainError(CHANGE_SET_ERROR_CODES.OPERATION_CONFLICT, problem.message);
    throw new DomainError(CHANGE_SET_ERROR_CODES.INVALID_INPUT, problem.message);
  }

  const ruleset = await selectRulesetById(rulesetId);
  if (ruleset === null) {
    throw new DomainError(CHANGE_SET_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  }

  const decisionId = optionalId(input.canonDecisionId);
  if (decisionId !== null) {
    const decision = isUuid(decisionId) ? await selectCanonDecisionWithSelections(decisionId) : null;
    if (decision === null) {
      throw new DomainError(CHANGE_SET_ERROR_CODES.DECISION_NOT_FOUND, `CanonDecision not found: ${input.canonDecisionId}`);
    }
    if (decision.rulesetId !== ruleset.id) {
      throw new DomainError(
        CHANGE_SET_ERROR_CODES.INVALID_DECISION_CONTEXT,
        `CanonDecision ${decision.id} belongs to Ruleset ${decision.rulesetId}, not the ChangeSet's Ruleset ${ruleset.id}`,
      );
    }
  }

  const operations: ChangeSetOperationInsert[] = [];
  for (const [index, op] of input.operations.entries()) {
    const at = `operations[${index}]`;
    const entityId = optionalId(op.targetEntityId);
    if (entityId !== null && (!isUuid(entityId) || (await selectEntityById(entityId)) === null)) {
      throw new DomainError(CHANGE_SET_ERROR_CODES.ENTITY_NOT_FOUND, `${at}: Entity not found: ${op.targetEntityId}`);
    }
    for (const side of ["fromEntityVersionId", "toEntityVersionId"] as const) {
      const versionId = optionalId(op[side]);
      if (versionId === null) continue;
      const version = isUuid(versionId) ? await selectEntityVersionById(versionId) : null;
      if (version === null) {
        throw new DomainError(CHANGE_SET_ERROR_CODES.VERSION_NOT_FOUND, `${at}: ${side} not found: ${op[side]}`);
      }
      if (version.entityId !== entityId) {
        throw new DomainError(
          CHANGE_SET_ERROR_CODES.VERSION_ENTITY_MISMATCH,
          `${at}: ${side} ${version.id} belongs to Entity ${version.entityId}, not the target Entity ${entityId}`,
        );
      }
    }
    const manifestId = optionalId(op.targetManifestId);
    if (manifestId !== null) {
      const manifest = await selectManifestNode(manifestId);
      if (manifest === null) {
        throw new DomainError(CHANGE_SET_ERROR_CODES.MANIFEST_NOT_FOUND, `${at}: RulesetManifest not found: ${op.targetManifestId}`);
      }
      if (manifest.rulesetId !== ruleset.id) {
        throw new DomainError(
          CHANGE_SET_ERROR_CODES.INVALID_MANIFEST_CONTEXT,
          `${at}: RulesetManifest ${manifest.id} belongs to Ruleset ${manifest.rulesetId}, not the ChangeSet's Ruleset ${ruleset.id}`,
        );
      }
    }
    operations.push({
      operationType: op.operationType as ChangeSetOperationType, // validated in step 0
      targetEntityId: entityId,
      fromEntityVersionId: optionalId(op.fromEntityVersionId),
      toEntityVersionId: optionalId(op.toEntityVersionId),
      targetManifestId: manifestId,
      description: op.description ?? null,
    });
  }

  try {
    return await insertChangeSetWithOperations(
      { rulesetId: ruleset.id, canonDecisionId: decisionId, name: input.name.trim(), description: input.description ?? null },
      operations,
    );
  } catch (error) {
    throw mapChangeSetWriteError(error);
  }
}

/**
 * Translates a database rejection of a ChangeSet write (Prisma P2003, a concurrent change between the
 * service's checks and commit) into the controlled vocabulary; anything else is returned unchanged.
 */
export function mapChangeSetWriteError(error: unknown): unknown {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== "P2003") return error;
  const e = error as { message?: unknown; meta?: unknown };
  let haystack = typeof e.message === "string" ? e.message : "";
  try {
    haystack += ` ${JSON.stringify(e.meta ?? null)}`;
  } catch {
    // diagnostic only
  }
  const nothing = "; nothing was written";
  if (haystack.includes("change_sets_canon_decision_fkey")) {
    return new DomainError(CHANGE_SET_ERROR_CODES.INVALID_DECISION_CONTEXT, `The CanonDecision does not exist or belongs to another Ruleset${nothing}`);
  }
  if (haystack.includes("change_set_operations_target_manifest_fkey")) {
    return new DomainError(CHANGE_SET_ERROR_CODES.INVALID_MANIFEST_CONTEXT, `A target manifest does not exist or belongs to another Ruleset${nothing}`);
  }
  if (haystack.includes("change_set_operations_from_version_fkey") || haystack.includes("change_set_operations_to_version_fkey")) {
    return new DomainError(CHANGE_SET_ERROR_CODES.VERSION_ENTITY_MISMATCH, `A Version does not exist or belongs to another Entity${nothing}`);
  }
  if (haystack.includes("change_set_operations_target_entity_fkey")) {
    return new DomainError(CHANGE_SET_ERROR_CODES.ENTITY_NOT_FOUND, `A target Entity does not exist${nothing}`);
  }
  return error;
}

/** By explicit identity: absence is `CHANGE_SET.NOT_FOUND` (including a malformed id). Operations in sequence order. */
export async function getChangeSet(changeSetId: string): Promise<ChangeSetWithOperations> {
  const changeSet = await selectChangeSetWithOperations(normalizeId(changeSetId));
  if (changeSet === null) {
    throw new DomainError(CHANGE_SET_ERROR_CODES.NOT_FOUND, `ChangeSet not found: ${changeSetId}`);
  }
  return changeSet;
}

/** A Ruleset's ChangeSets (headers), `created_at ASC, id ASC`, optionally filtered by exact decision / status. */
export async function listChangeSets(rulesetId: string, filters?: ListChangeSetsFilters): Promise<ChangeSet[]> {
  if (filters !== undefined && (typeof filters !== "object" || filters === null)) {
    throw new DomainError(CHANGE_SET_ERROR_CODES.INVALID_INPUT, "filters, when supplied, must be an object");
  }
  const ruleset = await selectRulesetById(rulesetId);
  if (ruleset === null) {
    throw new DomainError(CHANGE_SET_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  }
  const where: { canonDecisionId?: string; status?: ChangeSetStatus } = {};
  if (filters?.canonDecisionId !== undefined) {
    const id = normalizeId(String(filters.canonDecisionId));
    if (!isUuid(id)) throw new DomainError(CHANGE_SET_ERROR_CODES.INVALID_INPUT, `filters.canonDecisionId is not a valid id: ${JSON.stringify(filters.canonDecisionId)}`);
    where.canonDecisionId = id;
  }
  if (filters?.status !== undefined) {
    if (typeof filters.status !== "string" || !isChangeSetStatus(filters.status)) {
      throw new DomainError(CHANGE_SET_ERROR_CODES.INVALID_INPUT, `filters.status is not a recognized ChangeSetStatus: ${JSON.stringify(filters.status)}`);
    }
    where.status = filters.status;
  }
  return selectChangeSetsByRuleset(ruleset.id, where);
}

export interface ProposeChangeSetFromDecisionInput {
  targetManifestId?: string | null;
  name: string;
  description?: string | null;
}

/**
 * EXPLICITLY creates a DRAFT ChangeSet proposed from a CanonDecision (§15–§21). Calling it is the
 * only way this happens — deciding never creates a ChangeSet — and it applies nothing.
 *
 * The decision's Ruleset is the ChangeSet's Ruleset. The governance-chosen Version is SELECT_RULE's
 * selected candidate's exact Version, or MERGE's exact result. With a target manifest (which must belong
 * to the decision's Ruleset), its EFFECTIVE pin for the conflict's Entity (M2-WO3, so inherited pins
 * count) decides between ADD, NO_CHANGE and REPLACE; without one, the proposal is a PIN. Every other
 * decision is NO_CHANGE. The mapping itself is the pure `translateDecisionToOperations`.
 */
export async function proposeChangeSetFromCanonDecision(
  canonDecisionId: string,
  input: ProposeChangeSetFromDecisionInput,
): Promise<ChangeSetWithOperations> {
  if (typeof input !== "object" || input === null) {
    throw new DomainError(CHANGE_SET_ERROR_CODES.INVALID_INPUT, "input must be an object");
  }
  const id = normalizeId(canonDecisionId);
  const decision = isUuid(id) ? await selectCanonDecisionWithSelections(id) : null;
  if (decision === null) {
    throw new DomainError(CHANGE_SET_ERROR_CODES.DECISION_NOT_FOUND, `CanonDecision not found: ${canonDecisionId}`);
  }
  const conflict = await selectRuleConflictById(decision.ruleConflictId);
  if (conflict === null) {
    throw new Error(`CanonDecision ${decision.id} references a missing RuleConflict ${decision.ruleConflictId}`); // impossible: RESTRICT
  }

  const manifestId = optionalId(input.targetManifestId);
  if (manifestId !== null) {
    const manifest = await selectManifestNode(manifestId);
    if (manifest === null) {
      throw new DomainError(CHANGE_SET_ERROR_CODES.MANIFEST_NOT_FOUND, `RulesetManifest not found: ${input.targetManifestId}`);
    }
    if (manifest.rulesetId !== decision.rulesetId) {
      throw new DomainError(
        CHANGE_SET_ERROR_CODES.INVALID_MANIFEST_CONTEXT,
        `RulesetManifest ${manifest.id} belongs to Ruleset ${manifest.rulesetId}, not the decision's Ruleset ${decision.rulesetId}`,
      );
    }
  }

  let chosenEntityVersionId: string | null = null;
  if (decision.decisionType === "SELECT_RULE" && decision.selections.length === 1) {
    chosenEntityVersionId = await selectCandidateEntityVersionId(decision.selections[0]!.ruleConflictCandidateId);
  } else if (decision.decisionType === "MERGE") {
    chosenEntityVersionId = decision.resultEntityVersionId;
  }

  const effective = manifestId === null ? null : await resolveEffectiveEntityVersion(manifestId, conflict.entityId);

  const operations = translateDecisionToOperations({
    decisionId: decision.id,
    decisionType: decision.decisionType,
    conflictDisposition: decision.conflictDisposition,
    entityId: conflict.entityId,
    chosenEntityVersionId,
    targetManifestId: manifestId,
    effective:
      effective === null
        ? null
        : { entityVersionId: effective.entityVersionId, resolvedFromManifestId: effective.resolvedFromManifestId, source: effective.source },
  });

  return createChangeSet(decision.rulesetId, {
    canonDecisionId: decision.id,
    name: input.name,
    description: input.description ?? null,
    operations,
  });
}
