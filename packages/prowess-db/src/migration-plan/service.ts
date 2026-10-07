import {
  assessMigration,
  DomainError,
  MIGRATION_PLAN_ERROR_CODES,
  RULESET_RELEASE_ERROR_CODES,
  summarizeMigration,
  validateCreateMigrationPlanInput,
  validatePreviewRulesetMigrationInput,
  type CreateMigrationPlanInput,
  type ListMigrationPlansFilters,
  type MigrationPlan,
  type MigrationPlanWithItems,
  type MigrationPreview,
  type PreviewRulesetMigrationInput,
  type RulesetReleaseWithComposition,
} from "@prowess/model";
import { getRulesetRelease, verifyRulesetReleaseManifestHash } from "../ruleset-release/service.js";
import { insertMigrationPlanWithItems, isUuid, selectMigrationPlanById, selectMigrationPlanItems, selectMigrationPlans, violatedItemVersionKey } from "./repository.js";

/**
 * Ruleset migration PLANNING (PAS-10 M2-WO11). Compares two EXACT published Releases chosen by the caller — never a
 * "latest" Release, Manifest, policy or Version — after verifying both manifest hashes with the WO8 verification
 * service (the single authority). Releases' compositions come from the WO8 release service (already flattened
 * snapshots, so no inheritance is resolved here). Releases of different Rulesets compare the same way.
 *
 * Planning is not execution: nothing here modifies, archives, deprecates, hides or upgrades a Release, manifest,
 * Version, policy, decision or ChangeSet, and no apply / execute / upgrade operation exists.
 */
const normalize = (v: string) => v.trim().toLowerCase();

async function loadVerified(releaseId: string, side: "source" | "target"): Promise<RulesetReleaseWithComposition> {
  let release: RulesetReleaseWithComposition;
  try {
    release = await getRulesetRelease(normalize(releaseId));
  } catch (error) {
    if (error instanceof DomainError && error.code === RULESET_RELEASE_ERROR_CODES.NOT_FOUND) {
      if (side === "source") throw new DomainError(MIGRATION_PLAN_ERROR_CODES.SOURCE_RELEASE_NOT_FOUND, `Source Release not found: ${releaseId}`);
      throw new DomainError(MIGRATION_PLAN_ERROR_CODES.TARGET_RELEASE_NOT_FOUND, `Target Release not found: ${releaseId}`);
    }
    throw error;
  }
  const verification = await verifyRulesetReleaseManifestHash(release.id);
  if (!verification.valid) {
    throw new DomainError(
      MIGRATION_PLAN_ERROR_CODES.MANIFEST_INTEGRITY_FAILURE,
      `The ${side} Release ${release.id}'s published composition does not match its stored manifest hash; refusing to plan against a potentially corrupted Release`,
    );
  }
  return release;
}

const ref = (r: RulesetReleaseWithComposition) => ({
  releaseId: r.id,
  rulesetId: r.rulesetId,
  releaseNumber: r.releaseNumber,
  versionLabel: r.versionLabel,
  manifestHash: r.manifestHash,
});

/** Read-only, unpersisted assessment of two exact, hash-verified Releases (§11). Writes nothing. */
export async function previewRulesetMigration(input: PreviewRulesetMigrationInput): Promise<MigrationPreview> {
  const problem = validatePreviewRulesetMigrationInput(input);
  if (problem !== null) throw new DomainError(MIGRATION_PLAN_ERROR_CODES.INVALID_INPUT, problem);
  const source = await loadVerified(input.sourceReleaseId, "source");
  const target = await loadVerified(input.targetReleaseId, "target");
  const items = assessMigration(source.composition, target.composition);
  return { source: ref(source), target: ref(target), items, summary: summarizeMigration(items) };
}

/**
 * Persists an immutable plan (§12): the same verified assessment as the preview, then the plan and EVERY item in one
 * transaction. The recorded hashes are the ones just verified. Any failure leaves no plan and no items.
 */
export async function createMigrationPlan(input: CreateMigrationPlanInput): Promise<MigrationPlanWithItems> {
  const problem = validateCreateMigrationPlanInput(input);
  if (problem !== null) throw new DomainError(MIGRATION_PLAN_ERROR_CODES.INVALID_INPUT, problem);
  const preview = await previewRulesetMigration(input);
  let id: string;
  try {
    id = await insertMigrationPlanWithItems(
      {
        sourceReleaseId: preview.source.releaseId,
        targetReleaseId: preview.target.releaseId,
        sourceManifestHash: preview.source.manifestHash,
        targetManifestHash: preview.target.manifestHash,
        name: input.name.trim(),
        description: input.description ?? null,
      },
      preview.items,
    );
  } catch (error) {
    throw mapMigrationPlanWriteError(error);
  }
  return getMigrationPlan(id);
}

/** Maps a rejected plan write into the controlled vocabulary; unknown errors are returned unchanged. */
export function mapMigrationPlanWriteError(error: unknown): unknown {
  if (violatedItemVersionKey(error)) {
    return new DomainError(MIGRATION_PLAN_ERROR_CODES.INVALID_VERSION_REFERENCE, "An item's Entity / Version reference was rejected by the database; nothing was written");
  }
  if (typeof error === "object" && error !== null && ["P2003", "P2002", "P2034"].includes(String((error as { code?: unknown }).code))) {
    return new DomainError(MIGRATION_PLAN_ERROR_CODES.PLAN_CONFLICT, "The database rejected the plan; nothing was written");
  }
  return error;
}

/** A plan with its items (Entity-id order) and structural summary. Absence (or a malformed id) is NOT_FOUND. */
export async function getMigrationPlan(planId: string): Promise<MigrationPlanWithItems> {
  const plan = await selectMigrationPlanById(normalize(planId));
  if (plan === null) throw new DomainError(MIGRATION_PLAN_ERROR_CODES.NOT_FOUND, `MigrationPlan not found: ${planId}`);
  const items = await selectMigrationPlanItems(plan.id);
  return { ...plan, items, summary: summarizeMigration(items) };
}

/** Plans (headers), `created_at ASC, id ASC`, optionally filtered by exact source / target Release id. */
export async function listMigrationPlans(filters?: ListMigrationPlansFilters): Promise<MigrationPlan[]> {
  const where: { sourceReleaseId?: string; targetReleaseId?: string } = {};
  for (const k of ["sourceReleaseId", "targetReleaseId"] as const) {
    const v = filters?.[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || !isUuid(normalize(v))) throw new DomainError(MIGRATION_PLAN_ERROR_CODES.INVALID_INPUT, `filters.${k} is not a valid id`);
    where[k] = normalize(v);
  }
  return selectMigrationPlans(where);
}
