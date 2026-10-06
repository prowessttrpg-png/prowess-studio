import { isChangeSetOperationType, isManifestCompositionOperation, type ChangeSetOperationType } from "./change-set-operation-type.js";
import type { ChangeSetStatus } from "./change-set-status.js";
import type {
  CanonDecisionId,
  ChangeSetId,
  ChangeSetOperationId,
  EntityId,
  EntityVersionId,
  RulesetId,
  RulesetManifestId,
} from "./ids.js";

/**
 * A ChangeSet — an immutable PROPOSAL of exact repository/ruleset changes, usually motivated by a
 * CanonDecision (PAS-10 M2-WO7).
 *
 * ```
 * CanonDecision   "What did governance decide?"             (M2-WO6)
 *       ↓ optional link
 * ChangeSet       "What exact changes are proposed?"         (M2-WO7)
 *       ↓
 * Operations      PROPOSED future changes
 *       ↓ future
 * Ruleset Release (application / publishing)                  (M2-WO8)
 * ```
 *
 * It mutates NOTHING: no Entity, EntityVersion, Ruleset, manifest, policy, conflict, decision,
 * authority record, keyword, relationship or source. Existing manifests are immutable; an applied
 * composition change will later produce a NEW manifest. Every Version reference is an exact id —
 * never latest, current, highest-revision or CANON-by-inference. Created DRAFT; never edited: to
 * revise a proposal, create another ChangeSet.
 */
export interface ChangeSet {
  id: ChangeSetId;
  rulesetId: RulesetId;
  /** Optional motivation; when present it belongs to the same Ruleset. */
  canonDecisionId: CanonDecisionId | null;
  name: string;
  description: string | null;
  /** Always DRAFT in M2-WO7 (no transitions exist yet). */
  status: ChangeSetStatus;
  createdAt: Date;
}

/** One exact proposed change. Which ids are present depends on `operationType` (see CHANGE_SET_OPERATION_RULES). */
export interface ChangeSetOperation {
  id: ChangeSetOperationId;
  changeSetId: ChangeSetId;
  /** 1-based position in the ChangeSet, preserving the author's order. */
  sequence: number;
  operationType: ChangeSetOperationType;
  targetEntityId: EntityId | null;
  fromEntityVersionId: EntityVersionId | null;
  toEntityVersionId: EntityVersionId | null;
  /** The exact manifest whose composition was ANALYZED — never edited by the proposal. */
  targetManifestId: RulesetManifestId | null;
  description: string | null;
  createdAt: Date;
}

/** A ChangeSet with its operations in `sequence` order. */
export interface ChangeSetWithOperations extends ChangeSet {
  operations: ChangeSetOperation[];
}

export interface CreateChangeSetOperationInput {
  operationType: string;
  targetEntityId?: string | null;
  fromEntityVersionId?: string | null;
  toEntityVersionId?: string | null;
  targetManifestId?: string | null;
  description?: string | null;
}

/** There is intentionally no `status` (always DRAFT) and no apply/execute field. */
export interface CreateChangeSetInput {
  canonDecisionId?: string | null;
  name: string;
  description?: string | null;
  operations: CreateChangeSetOperationInput[];
}

/** Optional, simple equality filters for listing a Ruleset's ChangeSets. */
export interface ListChangeSetsFilters {
  canonDecisionId?: string;
  status?: string;
}

export const MIN_CHANGE_SET_OPERATIONS = 1;
/** A documented cap: a proposal larger than this should be split into several reviewable ChangeSets. */
export const MAX_CHANGE_SET_OPERATIONS = 100;
export const MAX_CHANGE_SET_NAME_LENGTH = 200;
export const MAX_CHANGE_SET_DESCRIPTION_LENGTH = 4000;
export const MAX_CHANGE_SET_OPERATION_DESCRIPTION_LENGTH = 2000;

type Presence = "required" | "optional" | "forbidden";

/**
 * The operation validation matrix (§8), as data so it is defined once. `targetManifestId` is
 * optional for every type (analysis context only). REPLACE additionally requires from ≠ to; every
 * referenced Version must belong to the target Entity (checked against the database).
 */
export const CHANGE_SET_OPERATION_RULES = {
  PIN_ENTITY_VERSION: { targetEntity: "required", fromVersion: "forbidden", toVersion: "required" },
  REPLACE_ENTITY_VERSION: { targetEntity: "required", fromVersion: "required", toVersion: "required" },
  ADD_ENTITY_TO_MANIFEST: { targetEntity: "required", fromVersion: "forbidden", toVersion: "required" },
  REMOVE_ENTITY_FROM_MANIFEST: { targetEntity: "required", fromVersion: "optional", toVersion: "forbidden" },
  CREATE_ENTITY_VERSION: { targetEntity: "required", fromVersion: "optional", toVersion: "forbidden" },
  DEPRECATE_ENTITY_VERSION: { targetEntity: "required", fromVersion: "required", toVersion: "forbidden" },
  NO_CHANGE: { targetEntity: "forbidden", fromVersion: "forbidden", toVersion: "forbidden" },
} as const satisfies Record<ChangeSetOperationType, { targetEntity: Presence; fromVersion: Presence; toVersion: Presence }>;

export interface ChangeSetInputProblem {
  kind: "INVALID_INPUT" | "INVALID_OPERATION" | "OPERATION_CONFLICT";
  message: string;
}

const normalizeId = (value: string) => value.trim().toLowerCase();
const isBlank = (value: unknown) => typeof value !== "string" || value.trim().length === 0;
const present = (value: unknown) => value !== undefined && value !== null;

function optionalText(value: unknown, field: string, max: number, kind: ChangeSetInputProblem["kind"]): ChangeSetInputProblem | null {
  if (!present(value)) return null;
  if (typeof value !== "string") return { kind, message: `${field}, when supplied, must be a string` };
  if (value.length > max) return { kind, message: `${field} must be at most ${max} characters` };
  return null;
}

/** Validates ONE operation against the matrix. Returns the first problem, or `null`. */
export function validateChangeSetOperation(op: CreateChangeSetOperationInput, index: number): ChangeSetInputProblem | null {
  const at = `operations[${index}]`;
  const bad = (message: string): ChangeSetInputProblem => ({ kind: "INVALID_OPERATION", message: `${at}: ${message}` });
  if (typeof op !== "object" || op === null) return bad("must be an object");
  if (typeof op.operationType !== "string" || !isChangeSetOperationType(op.operationType)) {
    return bad(`operationType is not a supported ChangeSetOperationType: ${JSON.stringify(op.operationType)}`);
  }
  for (const field of ["targetEntityId", "fromEntityVersionId", "toEntityVersionId", "targetManifestId"] as const) {
    if (present(op[field]) && isBlank(op[field])) return bad(`${field}, when supplied, must be a non-empty string`);
  }
  const rules = CHANGE_SET_OPERATION_RULES[op.operationType];
  const checks: Array<[Presence, unknown, string]> = [
    [rules.targetEntity, op.targetEntityId, "targetEntityId"],
    [rules.fromVersion, op.fromEntityVersionId, "fromEntityVersionId"],
    [rules.toVersion, op.toEntityVersionId, "toEntityVersionId"],
  ];
  for (const [rule, value, field] of checks) {
    if (rule === "required" && !present(value)) return bad(`${op.operationType} requires ${field}`);
    if (rule === "forbidden" && present(value)) return bad(`${op.operationType} must not carry ${field}`);
  }
  if (
    op.operationType === "REPLACE_ENTITY_VERSION" &&
    normalizeId(op.fromEntityVersionId as string) === normalizeId(op.toEntityVersionId as string)
  ) {
    return bad("REPLACE_ENTITY_VERSION requires fromEntityVersionId and toEntityVersionId to differ");
  }
  return optionalText(op.description, `${at}.description`, MAX_CHANGE_SET_OPERATION_DESCRIPTION_LENGTH, "INVALID_OPERATION");
}

/**
 * Contradictions between operations of ONE ChangeSet (§13, §14). Deliberately small — not a
 * planning language:
 *   - NO_CHANGE must be the ONLY operation;
 *   - at most ONE manifest-composition operation (PIN / REPLACE / ADD / REMOVE) per Entity — a future
 *     manifest pins an Entity once, so two REPLACEs, ADD + REMOVE, or PINs of different (or the same)
 *     Versions for one Entity cannot coexist;
 *   - the same CREATE (Entity + base) or DEPRECATE (Version) proposal at most once;
 *   - a Version may not be both deprecated and pinned/added/replaced-to in the same proposal.
 */
export function findChangeSetOperationConflict(operations: readonly CreateChangeSetOperationInput[]): ChangeSetInputProblem | null {
  const conflict = (message: string): ChangeSetInputProblem => ({ kind: "OPERATION_CONFLICT", message });
  if (operations.length > 1 && operations.some((op) => op.operationType === "NO_CHANGE")) {
    return conflict("NO_CHANGE must be the only operation: it states that no repository/ruleset change is proposed");
  }
  const composition = new Map<string, number>();
  const proposals = new Map<string, number>();
  const deprecated = new Map<string, number>();
  const pinnedTo = new Map<string, number>();
  for (const [index, op] of operations.entries()) {
    const type = op.operationType as ChangeSetOperationType;
    const entity = present(op.targetEntityId) ? normalizeId(op.targetEntityId as string) : null;
    if (entity !== null && isManifestCompositionOperation(type)) {
      const earlier = composition.get(entity);
      if (earlier !== undefined) {
        return conflict(
          `operations[${earlier}] and operations[${index}] both propose the manifest composition of Entity ${op.targetEntityId}; express it as one operation`,
        );
      }
      composition.set(entity, index);
      if (present(op.toEntityVersionId)) pinnedTo.set(normalizeId(op.toEntityVersionId as string), index);
    }
    if (type === "CREATE_ENTITY_VERSION" || type === "DEPRECATE_ENTITY_VERSION") {
      const key = `${type}:${entity}:${present(op.fromEntityVersionId) ? normalizeId(op.fromEntityVersionId as string) : ""}`;
      const earlier = proposals.get(key);
      if (earlier !== undefined) return conflict(`operations[${earlier}] and operations[${index}] are the same ${type} proposal`);
      proposals.set(key, index);
      if (type === "DEPRECATE_ENTITY_VERSION") deprecated.set(normalizeId(op.fromEntityVersionId as string), index);
    }
  }
  for (const [version, index] of deprecated) {
    const pin = pinnedTo.get(version);
    if (pin !== undefined) {
      return conflict(`operations[${index}] deprecates the Version that operations[${pin}] proposes to pin`);
    }
  }
  return null;
}

/**
 * Pure validation of a whole ChangeSet request: name/description, then the operation count (1..100,
 * INVALID_INPUT), then each operation against the matrix (INVALID_OPERATION, in input order), then
 * contradictions (OPERATION_CONFLICT). Whether referenced rows exist and belong together is checked
 * by the service against the database.
 */
export function validateCreateChangeSetInput(input: CreateChangeSetInput): ChangeSetInputProblem | null {
  const invalid = (message: string): ChangeSetInputProblem => ({ kind: "INVALID_INPUT", message });
  if (typeof input !== "object" || input === null) return invalid("input must be an object");
  if (present(input.canonDecisionId) && isBlank(input.canonDecisionId)) return invalid("canonDecisionId, when supplied, must be a non-empty string");
  if (isBlank(input.name)) return invalid("name is required and must not be empty");
  if (input.name.trim().length > MAX_CHANGE_SET_NAME_LENGTH) return invalid(`name must be at most ${MAX_CHANGE_SET_NAME_LENGTH} characters`);
  const description = optionalText(input.description, "description", MAX_CHANGE_SET_DESCRIPTION_LENGTH, "INVALID_INPUT");
  if (description !== null) return description;
  if (!Array.isArray(input.operations)) return invalid("operations is required and must be an array");
  if (input.operations.length < MIN_CHANGE_SET_OPERATIONS || input.operations.length > MAX_CHANGE_SET_OPERATIONS) {
    return invalid(
      `a ChangeSet needs ${MIN_CHANGE_SET_OPERATIONS}..${MAX_CHANGE_SET_OPERATIONS} operations (got ${input.operations.length}); use a single NO_CHANGE to record that nothing changes`,
    );
  }
  for (const [index, op] of input.operations.entries()) {
    const problem = validateChangeSetOperation(op, index);
    if (problem !== null) return problem;
  }
  return findChangeSetOperationConflict(input.operations);
}
