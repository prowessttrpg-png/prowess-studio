import {
  checkParentAssignment,
  DomainError,
  isRulesetChannel,
  isRulesetStatus,
  RULESET_ERROR_CODES,
  validateCreateRulesetInput,
  type CreateRulesetInput,
  type Ruleset,
  type RulesetChannel,
  type RulesetStatus,
} from "@prowess/model";
import {
  insertRuleset,
  isRulesetCanonicalKeyViolation,
  selectRulesetAncestors,
  selectRulesetById,
  selectRulesetByCanonicalKey,
  selectRulesets,
} from "./repository.js";

/**
 * Ruleset service (PAS-10 M2-WO1) — identity and lifecycle foundation only.
 *
 * Deliberately absent: manifest membership, EntityVersion pinning, inheritance
 * resolution, Canon behavior, publishing, and ANY operation that mutates a
 * Ruleset after creation (including its parent). A Ruleset never selects
 * content: nothing here consults latest revision, CANON status, revision
 * number, or Source authority.
 */

/**
 * Checks that `parentId` may be the parent of `rulesetId`.
 *
 *   - the parent must exist                      -> RULESET.INVALID_PARENT
 *   - a Ruleset cannot be its own parent         -> RULESET.PARENT_CYCLE
 *   - the assignment cannot close a lineage loop -> RULESET.PARENT_CYCLE
 *
 * `rulesetId === null` means "a Ruleset being created": a brand-new Ruleset has
 * no id yet, so it can be neither its own parent nor anyone's ancestor, and only
 * existence matters. The cycle checks are for any FUTURE operation that changes
 * a parent; no such operation is exposed in M2-WO1 (parent lineage is
 * creation-time metadata), so they are reachable only from tests. A future
 * mutating operation MUST run this inside a transaction that locks the chain.
 *
 * Internal: not exported from the package's public surface.
 */
export async function validateParentAssignment(rulesetId: string | null, parentId: string): Promise<void> {
  const parent = await selectRulesetById(parentId);
  if (parent === null) {
    throw new DomainError(RULESET_ERROR_CODES.INVALID_PARENT, `Parent Ruleset not found: ${parentId}`);
  }
  if (rulesetId === null) {
    return;
  }

  const ancestors = await selectRulesetAncestors(parentId);
  const parentOf = new Map<string, string | null>([[parent.id, parent.parentRulesetId]]);
  for (const ancestor of ancestors) {
    parentOf.set(ancestor.id, ancestor.parentRulesetId);
  }

  const check = checkParentAssignment(rulesetId, parentId, (id) => parentOf.get(id) ?? null);
  if (check.kind === "self") {
    throw new DomainError(RULESET_ERROR_CODES.PARENT_CYCLE, "A Ruleset cannot be its own parent");
  }
  if (check.kind === "cycle") {
    throw new DomainError(
      RULESET_ERROR_CODES.PARENT_CYCLE,
      `Assigning this parent would create a lineage cycle: ${check.path.join(" -> ")}`,
    );
  }
}

/**
 * Creates a Ruleset. Always created as DRAFT — callers cannot choose a status.
 *
 * Throws, before or instead of persisting anything:
 *   - `RULESET.INVALID_INPUT`            malformed key/name/channel/label
 *   - `RULESET.INVALID_PARENT`           a supplied parent does not exist
 *   - `RULESET.CANONICAL_KEY_CONFLICT`   the key is taken (the database's UNIQUE
 *                                        constraint is the authority, so a race
 *                                        between two creates is still caught)
 */
export async function createRuleset(input: CreateRulesetInput): Promise<Ruleset> {
  const problem = validateCreateRulesetInput(input);
  if (problem !== null) {
    throw new DomainError(RULESET_ERROR_CODES.INVALID_INPUT, `${problem.field}: ${problem.message}`);
  }
  const channel = input.channel as RulesetChannel; // validated by validateCreateRulesetInput
  const parentRulesetId = input.parentRulesetId ?? null;

  if (parentRulesetId !== null) {
    await validateParentAssignment(null, parentRulesetId);
  }

  try {
    return await insertRuleset({
      canonicalKey: input.canonicalKey,
      name: input.name.trim(),
      description: input.description ?? null,
      channel,
      versionLabel: input.versionLabel === undefined || input.versionLabel === null ? null : input.versionLabel.trim(),
      parentRulesetId,
    });
  } catch (error) {
    if (isRulesetCanonicalKeyViolation(error)) {
      throw new DomainError(
        RULESET_ERROR_CODES.CANONICAL_KEY_CONFLICT,
        `canonicalKey is already in use: ${input.canonicalKey}`,
      );
    }
    throw error;
  }
}

/** By explicit identity: absence is exceptional (`RULESET.NOT_FOUND`). A malformed id is "not found", never a raw error. */
export async function getRuleset(id: string): Promise<Ruleset> {
  const ruleset = await selectRulesetById(id);
  if (ruleset === null) {
    throw new DomainError(RULESET_ERROR_CODES.NOT_FOUND, `Ruleset not found: ${id}`);
  }
  return ruleset;
}

/** A search may find nothing — returns `null`, not an error. */
export async function findRulesetByCanonicalKey(canonicalKey: string): Promise<Ruleset | null> {
  return selectRulesetByCanonicalKey(canonicalKey);
}

export interface ListRulesetsFilters {
  status?: string;
  channel?: string;
}

/** Ordered `canonical_key ASC, id ASC`. Optional status/channel filters are validated, not passed through blindly. */
export async function listRulesets(filters: ListRulesetsFilters = {}): Promise<Ruleset[]> {
  if (filters.status !== undefined && !isRulesetStatus(filters.status)) {
    throw new DomainError(RULESET_ERROR_CODES.INVALID_INPUT, `status: Not a recognized RulesetStatus: ${JSON.stringify(filters.status)}`);
  }
  if (filters.channel !== undefined && !isRulesetChannel(filters.channel)) {
    throw new DomainError(RULESET_ERROR_CODES.INVALID_INPUT, `channel: Not a recognized RulesetChannel: ${JSON.stringify(filters.channel)}`);
  }
  // Explicit casts rather than relying on control-flow narrowing: both values were
  // validated just above.
  const status = filters.status as RulesetStatus | undefined;
  const channel = filters.channel as RulesetChannel | undefined;
  return selectRulesets({
    ...(status !== undefined ? { status } : {}),
    ...(channel !== undefined ? { channel } : {}),
  });
}
