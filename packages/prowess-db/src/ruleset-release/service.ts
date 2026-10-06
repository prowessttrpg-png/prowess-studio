import {
  DomainError,
  diffCompositions,
  isPublishableRulesetStatus,
  isValidEntityVersionTransition,
  planChangeSetApplication,
  RULESET_RELEASE_ERROR_CODES,
  validateCreateRulesetReleaseInput,
  type CreateRulesetReleaseInput,
  type RulesetRelease,
  type RulesetReleaseDiff,
  type RulesetReleaseManifestVerification,
  type RulesetReleaseWithComposition,
} from "@prowess/model";
import { selectCanonPolicyById } from "../canon-policy/repository.js";
import { selectChangeSetWithOperations } from "../change-set/repository.js";
import { selectEntityVersionById } from "../entity-version/repository.js";
import { getEffectiveManifestEntries } from "../ruleset-inheritance/resolution.js";
import { selectRulesetManifestById } from "../ruleset-manifest/repository.js";
import { selectRulesetById } from "../ruleset/repository.js";
import {
  computeManifestHash,
  executePublication,
  isChangeSetReuseViolation,
  isUuid,
  isVersionLabelViolation,
  PublicationAbort,
  selectLatestRelease,
  selectManifestPins,
  selectReleaseByChangeSet,
  selectReleaseById,
  selectReleaseByLabel,
  selectReleasesByRuleset,
} from "./repository.js";

/**
 * Ruleset publishing (PAS-10 M2-WO8) — the ONLY boundary that turns an approved proposal into
 * immutable release state. Explicit: approving a ChangeSet or a Ruleset, or deciding a conflict, never
 * publishes. Publication creates NEW state (a flattened manifest and a release) and never rewrites a
 * historical manifest, policy, decision, conflict, ChangeSet or authority record.
 */
const normalizeId = (value: string) => value.trim().toLowerCase();

/**
 * Publishes the next release of a Ruleset. Order — the first failure is reported and NOTHING changes:
 *   0. request shape                                                         -> INVALID_INPUT
 *   1. the Ruleset exists / is APPROVED or PUBLISHED                         -> RULESET_NOT_FOUND / RULESET_NOT_PUBLISHABLE
 *   2. the base manifest exists / is this Ruleset's                          -> MANIFEST_NOT_FOUND / INVALID_MANIFEST_CONTEXT
 *      and, after a first release, IS the latest release's manifest (linear history) -> INVALID_MANIFEST_CONTEXT
 *   3. the CanonPolicy exists / is this Ruleset's                            -> POLICY_NOT_FOUND / INVALID_POLICY_CONTEXT
 *   4. an optional ChangeSet exists / is this Ruleset's / is APPROVED / backs no release yet
 *      -> CHANGE_SET_NOT_FOUND / INVALID_CHANGE_SET_CONTEXT / CHANGE_SET_NOT_APPROVED / CHANGE_SET_ALREADY_PUBLISHED
 *   5. the base's EFFECTIVE composition (M2-WO3) is flattened and the operations applied IN MEMORY,
 *      failing closed -> INVALID_MANIFEST_CONTEXT / UNRESOLVED_CREATE_OPERATION / STALE_CHANGE_SET
 *   6. every DEPRECATE is allowed by the M1 lifecycle graph                  -> INVALID_OPERATION
 *   7. the version label is unused in this Ruleset                           -> VERSION_LABEL_CONFLICT
 *   8. the publication transaction (see `executePublication`); concurrency outcomes map to the same codes,
 *      or RELEASE_CONFLICT when another release landed first.
 */
export async function publishRulesetRelease(input: CreateRulesetReleaseInput): Promise<RulesetReleaseWithComposition> {
  const shape = validateCreateRulesetReleaseInput(input);
  if (shape !== null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.INVALID_INPUT, shape);

  const ruleset = await selectRulesetById(input.rulesetId);
  if (ruleset === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${input.rulesetId}`);
  if (!isPublishableRulesetStatus(ruleset.status)) {
    throw new DomainError(RULESET_RELEASE_ERROR_CODES.RULESET_NOT_PUBLISHABLE, `Ruleset ${ruleset.id} is ${ruleset.status}; only APPROVED or PUBLISHED Rulesets can publish`);
  }

  const baseId = normalizeId(input.baseManifestId);
  const base = isUuid(baseId) ? await selectRulesetManifestById(baseId) : null;
  if (base === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.MANIFEST_NOT_FOUND, `RulesetManifest not found: ${input.baseManifestId}`);
  if (base.rulesetId !== ruleset.id) {
    throw new DomainError(RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT, `RulesetManifest ${base.id} belongs to Ruleset ${base.rulesetId}, not ${ruleset.id}`);
  }
  const latest = await selectLatestRelease(ruleset.id);
  if (latest !== null && latest.manifestId !== base.id) {
    throw new DomainError(
      RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT,
      `Release ${latest.releaseNumber + 1} must be based on Release ${latest.releaseNumber}'s exact manifest ${latest.manifestId}, not ${base.id} (release history is linear)`,
    );
  }

  const policyId = normalizeId(input.canonPolicyId);
  const policy = isUuid(policyId) ? await selectCanonPolicyById(policyId) : null;
  if (policy === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.POLICY_NOT_FOUND, `CanonPolicy not found: ${input.canonPolicyId}`);
  if (policy.rulesetId !== ruleset.id) {
    throw new DomainError(RULESET_RELEASE_ERROR_CODES.INVALID_POLICY_CONTEXT, `CanonPolicy ${policy.id} belongs to Ruleset ${policy.rulesetId}, not ${ruleset.id}`);
  }

  let changeSetId: string | null = null;
  let operations: Parameters<typeof planChangeSetApplication>[1] = [];
  if (input.changeSetId !== undefined && input.changeSetId !== null) {
    const id = normalizeId(input.changeSetId);
    const changeSet = isUuid(id) ? await selectChangeSetWithOperations(id) : null;
    if (changeSet === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.CHANGE_SET_NOT_FOUND, `ChangeSet not found: ${input.changeSetId}`);
    if (changeSet.rulesetId !== ruleset.id) {
      throw new DomainError(RULESET_RELEASE_ERROR_CODES.INVALID_CHANGE_SET_CONTEXT, `ChangeSet ${changeSet.id} belongs to Ruleset ${changeSet.rulesetId}, not ${ruleset.id}`);
    }
    if (changeSet.status !== "APPROVED") {
      throw new DomainError(RULESET_RELEASE_ERROR_CODES.CHANGE_SET_NOT_APPROVED, `ChangeSet ${changeSet.id} is ${changeSet.status}; only an APPROVED ChangeSet can be published`);
    }
    const already = await selectReleaseByChangeSet(changeSet.id);
    if (already !== null) {
      throw new DomainError(RULESET_RELEASE_ERROR_CODES.CHANGE_SET_ALREADY_PUBLISHED, `ChangeSet ${changeSet.id} was already published as Release ${already.releaseNumber}`);
    }
    changeSetId = changeSet.id;
    operations = changeSet.operations;
  }

  const effective = await getEffectiveManifestEntries(base.id);
  const plan = planChangeSetApplication(new Map(effective.map((e) => [e.entityId as string, e.entityVersionId as string])), operations, base.id);
  if (!plan.ok) {
    if (plan.kind === "STALE_CHANGE_SET") throw new DomainError(RULESET_RELEASE_ERROR_CODES.STALE_CHANGE_SET, plan.message);
    if (plan.kind === "UNRESOLVED_CREATE_OPERATION") throw new DomainError(RULESET_RELEASE_ERROR_CODES.UNRESOLVED_CREATE_OPERATION, plan.message);
    throw new DomainError(RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT, plan.message);
  }

  for (const deprecation of plan.deprecations) {
    const version = await selectEntityVersionById(deprecation.entityVersionId);
    if (version === null || !isValidEntityVersionTransition(version.status, "DEPRECATED")) {
      throw new DomainError(
        RULESET_RELEASE_ERROR_CODES.INVALID_OPERATION,
        `operation ${deprecation.sequence}: EntityVersion ${deprecation.entityVersionId} cannot move to DEPRECATED from ${version?.status ?? "a missing state"}`,
      );
    }
  }

  const versionLabel = input.versionLabel.trim();
  if ((await selectReleaseByLabel(ruleset.id, versionLabel)) !== null) {
    throw new DomainError(RULESET_RELEASE_ERROR_CODES.VERSION_LABEL_CONFLICT, `Ruleset ${ruleset.id} already has a release labelled ${JSON.stringify(versionLabel)}`);
  }

  const pins = [...plan.composition.entries()].map(([entityId, entityVersionId]) => ({ entityId, entityVersionId })).sort((a, b) => (a.entityId < b.entityId ? -1 : 1));
  try {
    const releaseId = await executePublication({
      rulesetId: ruleset.id,
      expectedLatestManifestId: latest?.manifestId ?? null,
      canonPolicyId: policy.id,
      changeSetId,
      versionLabel,
      releaseNotes: input.releaseNotes ?? null,
      pins,
      manifestHash: computeManifestHash(pins),
      deprecations: plan.deprecations.map((d) => d.entityVersionId),
    });
    return await getRulesetRelease(releaseId);
  } catch (error) {
    throw mapPublicationError(error);
  }
}

/** Maps a rejected publication transaction into the controlled vocabulary; anything else is returned unchanged. */
export function mapPublicationError(error: unknown): unknown {
  if (error instanceof PublicationAbort) {
    if (error.reason === "RULESET_NOT_PUBLISHABLE") return new DomainError(RULESET_RELEASE_ERROR_CODES.RULESET_NOT_PUBLISHABLE, error.message);
    if (error.reason === "INVALID_OPERATION") return new DomainError(RULESET_RELEASE_ERROR_CODES.INVALID_OPERATION, error.message);
    return new DomainError(RULESET_RELEASE_ERROR_CODES.RELEASE_CONFLICT, error.message);
  }
  if (isVersionLabelViolation(error)) return new DomainError(RULESET_RELEASE_ERROR_CODES.VERSION_LABEL_CONFLICT, "The version label was taken by a concurrent publication; nothing was written");
  if (isChangeSetReuseViolation(error)) return new DomainError(RULESET_RELEASE_ERROR_CODES.CHANGE_SET_ALREADY_PUBLISHED, "The ChangeSet was published by a concurrent publication; nothing was written");
  return error;
}

async function withComposition(release: RulesetRelease): Promise<RulesetReleaseWithComposition> {
  return { ...release, composition: await selectManifestPins(release.manifestId) };
}

/** A release with its exact composition. Absence (or a malformed id) is NOT_FOUND. */
export async function getRulesetRelease(releaseId: string): Promise<RulesetReleaseWithComposition> {
  const release = await selectReleaseById(normalizeId(releaseId));
  if (release === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.NOT_FOUND, `RulesetRelease not found: ${releaseId}`);
  return withComposition(release);
}

async function requireRuleset(rulesetId: string) {
  const ruleset = await selectRulesetById(rulesetId);
  if (ruleset === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  return ruleset;
}

/** A Ruleset's releases (headers), release_number ASC. */
export async function listRulesetReleases(rulesetId: string): Promise<RulesetRelease[]> {
  return selectReleasesByRuleset((await requireRuleset(rulesetId)).id);
}

/** The highest-numbered release, or null when the Ruleset has none. A query — never a stored pointer. */
export async function getLatestRulesetRelease(rulesetId: string): Promise<RulesetReleaseWithComposition | null> {
  const latest = await selectLatestRelease((await requireRuleset(rulesetId)).id);
  return latest === null ? null : withComposition(latest);
}

/** Recomputes the composition hash from the release manifest's exact entries. Read-only. */
export async function verifyRulesetReleaseManifestHash(releaseId: string): Promise<RulesetReleaseManifestVerification> {
  const release = await selectReleaseById(normalizeId(releaseId));
  if (release === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.NOT_FOUND, `RulesetRelease not found: ${releaseId}`);
  const computedHash = computeManifestHash(await selectManifestPins(release.manifestId));
  return { releaseId: release.id, valid: computedHash === release.manifestHash, storedHash: release.manifestHash, computedHash };
}

/**
 * Composition-level diff from release A to release B (ADDED_ENTITY / REMOVED_ENTITY / CHANGED_VERSION,
 * ordered by Entity id, plus an unchanged count). Read-only; no payload inspection. Releases of different
 * Rulesets compare the same way — that falls out naturally and is not otherwise special.
 */
export async function compareRulesetReleases(releaseAId: string, releaseBId: string): Promise<RulesetReleaseDiff> {
  const a = await getRulesetRelease(releaseAId);
  const b = await getRulesetRelease(releaseBId);
  return { releaseAId: a.id, releaseBId: b.id, ...diffCompositions(a.composition, b.composition) };
}
