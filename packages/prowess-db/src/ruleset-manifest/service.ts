import {
  DomainError,
  RULESET_MANIFEST_ERROR_CODES,
  validateCreateRulesetManifestInput,
  type CreateRulesetManifestInput,
  type EntityVersion,
  type Ruleset,
  type RulesetManifest,
  type RulesetManifestEntry,
  type RulesetManifestWithEntries,
} from "@prowess/model";
import { selectEntityById } from "../entity/repository.js";
import { selectEntityVersionById } from "../entity-version/repository.js";
import { selectRulesetById } from "../ruleset/repository.js";
import {
  insertRulesetManifestWithEntries,
  isManifestEntryDuplicateViolation,
  isManifestVersionViolation,
  selectLatestRulesetManifest,
  selectManifestEntry,
  selectRulesetManifestById,
  selectRulesetManifestWithEntries,
  selectRulesetManifestsByRuleset,
  type ManifestEntryInsert,
} from "./repository.js";

/**
 * RulesetManifest service (PAS-10 M2-WO2) — exact EntityVersion pinning.
 *
 * What a manifest entry means: "within this manifest, use exactly this
 * EntityVersion for this Entity" — never "the latest from now on". Nothing in
 * this module chooses a version: no latest-revision lookup, no revision-number
 * comparison, no lifecycle-status test (a manifest may pin a DRAFT as readily as
 * a CANON — eligibility rules belong to later publishing/Canon work), no Source
 * authority, no Keywords or relationships, and no parent-Ruleset fallback
 * (inheritance is M2-WO3). A static audit scans this directory for exactly those
 * identifiers.
 *
 * Deliberately absent: any operation that adds, removes, or updates entries of
 * an existing manifest. To change a composition, create a new manifest.
 */

const normalizeId = (value: string) => value.trim().toLowerCase();

async function requireRuleset(rulesetId: string) {
  const ruleset = await selectRulesetById(rulesetId);
  if (ruleset === null) {
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  }
  return ruleset;
}

async function requireManifest(manifestId: string): Promise<RulesetManifest> {
  const manifest = await selectRulesetManifestById(manifestId);
  if (manifest === null) {
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.NOT_FOUND, `RulesetManifest not found: ${manifestId}`);
  }
  return manifest;
}

/**
 * Validates the parent manifest a new manifest wants to inherit from (M2-WO3).
 * Returns the canonical id to store, or `null` when no inheritance was requested.
 *
 * Inheritance climbs the Ruleset lineage ONE level at a time, so the parent
 * manifest must belong to this Ruleset's DIRECT parent Ruleset — not to a
 * grandparent (the resolver reaches the grandparent through the parent's own
 * pinned manifest) and not to an unrelated Ruleset. A Ruleset with no parent
 * cannot inherit at all. Having a parent Ruleset does NOT require inheriting:
 * omitting `parentManifestId` is a deliberate "this manifest inherits nothing".
 *
 * A plain foreign key cannot express "belongs to the parent Ruleset", so this
 * check is the enforcement; the database separately guarantees the referenced
 * manifest exists and cannot be deleted while a child points at it. It never
 * picks a manifest for the caller — in particular never the parent's latest.
 */
async function validateParentManifest(ruleset: Ruleset, requested: string | null | undefined): Promise<string | null> {
  if (requested === undefined || requested === null) {
    return null;
  }
  if (ruleset.parentRulesetId === null) {
    throw new DomainError(
      RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST,
      `Ruleset ${ruleset.id} has no parent Ruleset, so its manifests cannot inherit`,
    );
  }
  const parent = await selectRulesetManifestById(normalizeId(requested));
  if (parent === null) {
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST, `Parent manifest not found: ${requested}`);
  }
  if (parent.rulesetId !== ruleset.parentRulesetId) {
    throw new DomainError(
      RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST,
      `Manifest ${parent.id} belongs to Ruleset ${parent.rulesetId}, not to this Ruleset's direct parent ${ruleset.parentRulesetId}`,
    );
  }
  return parent.id;
}

/**
 * Creates the next manifest for a Ruleset, atomically, with exactly the
 * supplied pins. `manifest_version` is allocated automatically — the input has
 * no field for it.
 *
 * Validation, in this order — the first failure is reported and NOTHING is written:
 *   1. input shape                            -> INVALID_INPUT
 *   2. the same Entity twice                  -> DUPLICATE_ENTITY
 *   3. the Ruleset exists                     -> RULESET_NOT_FOUND
 *   3b. a requested parent manifest is valid   -> INVALID_PARENT_MANIFEST
 *        (exists; belongs to this Ruleset's DIRECT parent; this Ruleset has a parent)
 *   4. for each entry, in order:
 *        the Entity exists                    -> ENTITY_NOT_FOUND
 *        the EntityVersion exists             -> VERSION_NOT_FOUND
 *        the Version belongs to that Entity   -> VERSION_ENTITY_MISMATCH
 *   5. write manifest + entries in ONE transaction; a concurrent allocation
 *      loser retries, and only an exhausted retry budget -> VERSION_CONFLICT.
 *
 * An EMPTY entries list is allowed and creates an empty snapshot ("this Ruleset
 * pins no Entity content"); no PAS rule forbids it and it is useful in development.
 */
export async function createRulesetManifest(
  rulesetId: string,
  input: CreateRulesetManifestInput,
): Promise<RulesetManifestWithEntries> {
  const problem = validateCreateRulesetManifestInput(input);
  if (problem !== null) {
    if (problem.kind === "DUPLICATE_ENTITY") {
      throw new DomainError(RULESET_MANIFEST_ERROR_CODES.DUPLICATE_ENTITY, problem.message);
    }
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.INVALID_INPUT, problem.message);
  }

  const ruleset = await requireRuleset(rulesetId);
  const parentManifestId = await validateParentManifest(ruleset, input.parentManifestId);

  const pins: ManifestEntryInsert[] = [];
  for (const entry of input.entries) {
    const entity = await selectEntityById(normalizeId(entry.entityId));
    if (entity === null) {
      throw new DomainError(RULESET_MANIFEST_ERROR_CODES.ENTITY_NOT_FOUND, `Entity not found: ${entry.entityId}`);
    }
    const version = await selectEntityVersionById(normalizeId(entry.entityVersionId));
    if (version === null) {
      throw new DomainError(RULESET_MANIFEST_ERROR_CODES.VERSION_NOT_FOUND, `EntityVersion not found: ${entry.entityVersionId}`);
    }
    if (version.entityId !== entity.id) {
      throw new DomainError(
        RULESET_MANIFEST_ERROR_CODES.VERSION_ENTITY_MISMATCH,
        `EntityVersion ${version.id} belongs to Entity ${version.entityId}, not to Entity ${entity.id}`,
      );
    }
    pins.push({ entityId: entity.id, entityVersionId: version.id });
  }

  try {
    return await insertRulesetManifestWithEntries(ruleset.id, pins, parentManifestId);
  } catch (error) {
    if (isManifestVersionViolation(error)) {
      throw new DomainError(
        RULESET_MANIFEST_ERROR_CODES.VERSION_CONFLICT,
        `Could not allocate a manifest_version for Ruleset ${ruleset.id} after repeated concurrent creations; the request is safe to retry`,
      );
    }
    if (isManifestEntryDuplicateViolation(error)) {
      throw new DomainError(RULESET_MANIFEST_ERROR_CODES.DUPLICATE_ENTITY, "A manifest pins one EntityVersion per Entity");
    }
    throw error;
  }
}

/** By explicit identity: absence is exceptional (`RULESET_MANIFEST.NOT_FOUND`), including a malformed id. */
export async function getRulesetManifest(manifestId: string): Promise<RulesetManifestWithEntries> {
  const manifest = await selectRulesetManifestWithEntries(manifestId);
  if (manifest === null) {
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.NOT_FOUND, `RulesetManifest not found: ${manifestId}`);
  }
  return manifest;
}

/**
 * A Ruleset's manifests, ordered `manifest_version ASC` (headers only; use
 * `getRulesetManifest` for membership). A Ruleset with no manifests yet returns
 * an empty list; a Ruleset that does not exist is `RULESET_NOT_FOUND` — the two
 * are different facts.
 */
export async function listRulesetManifests(rulesetId: string): Promise<RulesetManifest[]> {
  const ruleset = await requireRuleset(rulesetId);
  return selectRulesetManifestsByRuleset(ruleset.id);
}

/**
 * The "Latest Manifest": the one with the highest manifest_version, or `null` if
 * the Ruleset has none. A deterministic historical convenience ONLY — it is not
 * the published, active, or Canon manifest, and nothing treats it as in force.
 */
export async function getLatestRulesetManifest(rulesetId: string): Promise<RulesetManifestWithEntries | null> {
  const ruleset = await requireRuleset(rulesetId);
  const latest = await selectLatestRulesetManifest(ruleset.id);
  return latest === null ? null : selectRulesetManifestWithEntries(latest.id);
}

/**
 * The pin for one Entity in one manifest, or `null` when that Entity is not
 * pinned there. A search for membership may legitimately find nothing, so absence
 * is `null`, not an error (contrast `getRulesetManifest`). An unknown manifest is
 * still `RULESET_MANIFEST.NOT_FOUND`.
 *
 * Never falls back: not to the latest EntityVersion, not to another manifest, not
 * to a parent Ruleset.
 */
export async function getManifestEntry(manifestId: string, entityId: string): Promise<RulesetManifestEntry | null> {
  const manifest = await requireManifest(manifestId);
  return selectManifestEntry(manifest.id, normalizeId(entityId));
}

/**
 * The EXACT EntityVersion this manifest pins for the Entity, or `null` when the
 * Entity is not pinned. Creating newer versions of the Entity — or newer
 * manifests — never changes the answer for an existing manifest.
 */
export async function resolveEntityVersionFromManifest(manifestId: string, entityId: string): Promise<EntityVersion | null> {
  const entry = await getManifestEntry(manifestId, entityId);
  if (entry === null) {
    return null;
  }
  const version = await selectEntityVersionById(entry.entityVersionId);
  if (version === null) {
    // Unreachable while the foreign key holds; reported rather than silently substituted.
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.VERSION_NOT_FOUND, `Pinned EntityVersion not found: ${entry.entityVersionId}`);
  }
  return version;
}
