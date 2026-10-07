import type { EntityId, EntityVersionId, MigrationPlanId, MigrationPlanItemId, RulesetId, RulesetReleaseId } from "./ids.js";

/**
 * Ruleset migration PLANNING (PAS-10 M2-WO11) — an assessment of two EXACT published Releases. Planning is not
 * execution: nothing here (or anywhere in WO11) migrates, upgrades, substitutes, or rewrites anything.
 *
 * ```
 * Release A ──► Migration Assessment ──► MigrationPlan (immutable)
 *                                         ├── UNCHANGED
 *                                         ├── ADDED_ENTITY
 *                                         ├── REMOVED_ENTITY
 *                                         └── CHANGED_VERSION ──► REVIEW_REQUIRED where necessary
 * ```
 */

/** Structural change of one Entity between two exact compositions (§5). Identity only: equal Version ids or not. */
export const MIGRATION_CHANGE_TYPES = ["UNCHANGED", "ADDED_ENTITY", "REMOVED_ENTITY", "CHANGED_VERSION"] as const;
export type MigrationChangeType = (typeof MIGRATION_CHANGE_TYPES)[number];

/**
 * The PAS-08 compatibility vocabulary (§6), declared in full for forward compatibility. M2-WO11 assigns ONLY
 * UNCHANGED (identical Version id) and REVIEW_REQUIRED (anything else): RECALCULATE_ONLY, VALID_WITH_CHANGES,
 * INVALID and UNSUPPORTED require mechanical evaluation (a Rules Engine) or explicit review that does not exist yet.
 */
export const MIGRATION_COMPATIBILITY_CLASSIFICATIONS = ["UNCHANGED", "RECALCULATE_ONLY", "VALID_WITH_CHANGES", "REVIEW_REQUIRED", "INVALID", "UNSUPPORTED"] as const;
export type MigrationCompatibilityClassification = (typeof MIGRATION_COMPATIBILITY_CLASSIFICATIONS)[number];

export function isMigrationChangeType(value: string): value is MigrationChangeType {
  return (MIGRATION_CHANGE_TYPES as readonly string[]).includes(value);
}
export function isMigrationCompatibilityClassification(value: string): value is MigrationCompatibilityClassification {
  return (MIGRATION_COMPATIBILITY_CLASSIFICATIONS as readonly string[]).includes(value);
}

/** The only compatibility WO11 asserts: identical Version => UNCHANGED; any structural change => REVIEW_REQUIRED. */
export function compatibilityFor(changeType: MigrationChangeType): MigrationCompatibilityClassification {
  return changeType === "UNCHANGED" ? "UNCHANGED" : "REVIEW_REQUIRED";
}

/** One assessed Entity. Version presence follows the change type exactly (§8). */
export interface MigrationAssessmentItem {
  entityId: EntityId;
  sourceEntityVersionId: EntityVersionId | null;
  targetEntityVersionId: EntityVersionId | null;
  changeType: MigrationChangeType;
  compatibilityClassification: MigrationCompatibilityClassification;
}

/** STRUCTURAL counts (§14) — not counts of broken rules or invalid builds. */
export interface MigrationSummary {
  unchanged: number;
  added: number;
  removed: number;
  changed: number;
  reviewRequired: number;
  total: number;
}

export interface MigrationReleaseRef {
  releaseId: RulesetReleaseId;
  rulesetId: RulesetId;
  releaseNumber: number;
  versionLabel: string;
  manifestHash: string;
}

/** A read-only, unpersisted assessment of two exact, hash-verified Releases (§11). */
export interface MigrationPreview {
  source: MigrationReleaseRef;
  target: MigrationReleaseRef;
  items: MigrationAssessmentItem[];
  summary: MigrationSummary;
}

/** An immutable, persisted assessment (§7). No applied/current/active/complete field exists. */
export interface MigrationPlan {
  id: MigrationPlanId;
  sourceReleaseId: RulesetReleaseId;
  targetReleaseId: RulesetReleaseId;
  /** The Releases' manifest hashes as VERIFIED at plan creation. */
  sourceManifestHash: string;
  targetManifestHash: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface MigrationPlanItem extends MigrationAssessmentItem {
  id: MigrationPlanItemId;
  migrationPlanId: MigrationPlanId;
  createdAt: Date;
}

/** A plan with its items (ordered by Entity id) and summary. */
export interface MigrationPlanWithItems extends MigrationPlan {
  items: MigrationPlanItem[];
  summary: MigrationSummary;
}

export interface PreviewRulesetMigrationInput {
  sourceReleaseId: string;
  targetReleaseId: string;
}
export interface CreateMigrationPlanInput extends PreviewRulesetMigrationInput {
  name: string;
  description?: string | null;
}
export interface ListMigrationPlansFilters {
  sourceReleaseId?: string;
  targetReleaseId?: string;
}

const key = (id: string) => id.trim().toLowerCase();

/**
 * The structural assessment of `source` -> `target` compositions (§5, §6, §15, §16). PURE and deterministic: one item
 * per Entity in either composition, ordered by lowercase Entity id ascending — independent of input order, entry
 * row ids, query order or timestamps. Equality is Version IDENTITY only; nothing is inferred from names, keywords,
 * descriptions or sources, and no Version is ever substituted.
 */
export function assessMigration(
  source: ReadonlyArray<{ entityId: string; entityVersionId: string }>,
  target: ReadonlyArray<{ entityId: string; entityVersionId: string }>,
): MigrationAssessmentItem[] {
  const from = new Map(source.map((p) => [key(p.entityId), key(p.entityVersionId)]));
  const to = new Map(target.map((p) => [key(p.entityId), key(p.entityVersionId)]));
  const entities = [...new Set([...from.keys(), ...to.keys()])].sort();
  return entities.map((entityId) => {
    const s = from.get(entityId) ?? null;
    const t = to.get(entityId) ?? null;
    const changeType: MigrationChangeType = s === null ? "ADDED_ENTITY" : t === null ? "REMOVED_ENTITY" : s === t ? "UNCHANGED" : "CHANGED_VERSION";
    return {
      entityId: entityId as EntityId,
      sourceEntityVersionId: s as EntityVersionId | null,
      targetEntityVersionId: t as EntityVersionId | null,
      changeType,
      compatibilityClassification: compatibilityFor(changeType),
    };
  });
}

export function summarizeMigration(items: ReadonlyArray<{ changeType: MigrationChangeType; compatibilityClassification: MigrationCompatibilityClassification }>): MigrationSummary {
  const count = (t: MigrationChangeType) => items.filter((i) => i.changeType === t).length;
  return {
    unchanged: count("UNCHANGED"),
    added: count("ADDED_ENTITY"),
    removed: count("REMOVED_ENTITY"),
    changed: count("CHANGED_VERSION"),
    reviewRequired: items.filter((i) => i.compatibilityClassification === "REVIEW_REQUIRED").length,
    total: items.length,
  };
}

export const MAX_MIGRATION_PLAN_NAME_LENGTH = 200;
export const MAX_MIGRATION_PLAN_DESCRIPTION_LENGTH = 4000;
const isBlank = (v: unknown) => typeof v !== "string" || v.trim().length === 0;

/** Shape validation (§2): both exact Release ids are REQUIRED and must differ. Returns a message or null. */
export function validatePreviewRulesetMigrationInput(input: PreviewRulesetMigrationInput): string | null {
  if (typeof input !== "object" || input === null) return "input must be an object";
  if (isBlank(input.sourceReleaseId)) return "sourceReleaseId is required: the caller selects the exact source Release";
  if (isBlank(input.targetReleaseId)) return "targetReleaseId is required: the caller selects the exact target Release";
  if (key(input.sourceReleaseId) === key(input.targetReleaseId)) return "sourceReleaseId and targetReleaseId must be different Releases";
  return null;
}

export function validateCreateMigrationPlanInput(input: CreateMigrationPlanInput): string | null {
  const base = validatePreviewRulesetMigrationInput(input);
  if (base !== null) return base;
  if (isBlank(input.name)) return "name is required";
  if (input.name.trim().length > MAX_MIGRATION_PLAN_NAME_LENGTH) return `name must be at most ${MAX_MIGRATION_PLAN_NAME_LENGTH} characters`;
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string") return "description, when supplied, must be a string";
    if (input.description.length > MAX_MIGRATION_PLAN_DESCRIPTION_LENGTH) return `description must be at most ${MAX_MIGRATION_PLAN_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}
