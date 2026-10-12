import { DomainError, RULESET_MANIFEST_ERROR_CODES, RULESET_RESOLUTION_ERROR_CODES } from "@prowess/model";
import type { RulesetContext } from "@prowess/rules";
import { getRuleset } from "../ruleset/index.js";
import { getEffectiveManifestEntries } from "../ruleset-inheritance/index.js";
import { selectRulesetManifestById } from "../ruleset-manifest/repository.js";
import { getRulesetRelease, verifyRulesetReleaseManifestHash } from "../ruleset-release/index.js";
import { buildRulesetContextFromComposition, type CompositionPin } from "./composition.js";
import { selectEntityIdentities, selectEntityVersionOwners } from "./repository.js";

/**
 * Exact Ruleset resolution (PAS-10 M4-WO2): turns ONE exact Manifest or ONE exact Release into the M4 RulesetContext
 * that pure evaluation consumes.
 *
 * There are exactly two entry points and both take an exact id. There is deliberately no "resolve by Ruleset id": a
 * Ruleset id alone would force choosing a Manifest or Release implicitly. Nothing here selects by recency, Canon,
 * source authority, conflict outcome or import review — those decisions are already embodied in the exact Manifest or
 * Release the caller names.
 *
 * All M2 semantics are REUSED, never re-implemented:
 *   - Manifest mode → `getEffectiveManifestEntries` (M2-WO3 exact-parent inheritance, nearest pin wins, provenance)
 *   - Release mode  → `verifyRulesetReleaseManifestHash` (M2-WO8 integrity) then `getRulesetRelease` (the release's
 *                     frozen, flattened composition)
 *
 * Read-only: every call issues SELECTs only. Deterministic: the same persisted inputs give a deep-equal, deep-frozen
 * context ordered by Entity id (the @prowess/rules normalization), whatever order the database returns rows in.
 */

async function identityRows(pins: readonly CompositionPin[]) {
  const [entities, versions] = await Promise.all([
    selectEntityIdentities(pins.map((p) => p.entityId)),
    selectEntityVersionOwners(pins.map((p) => p.entityVersionId)),
  ]);
  return { entities, versions };
}

/**
 * Development / playtest evaluation against an exact RulesetManifest (§7–10).
 *
 * The context is the Manifest's EFFECTIVE composition (explicit pins plus those inherited through its exact pinned
 * parent chain), each rule carrying the Ruleset and Manifest that supplied it. A Manifest may pin exact DRAFT content;
 * Manifest mode imposes no publication requirement. M2 stores no hash for an unpublished Manifest, so `manifestHash`
 * is null — none is invented. `release` is null.
 *
 * Errors: RULESET_MANIFEST.NOT_FOUND, RULESET_MANIFEST.INVALID_PARENT_MANIFEST / INHERITANCE_CYCLE (from M2),
 * RULESET_RESOLUTION.INVALID_COMPOSITION.
 */
export async function resolveRulesetContextFromManifest(manifestId: string): Promise<RulesetContext> {
  const requested = await selectRulesetManifestById(manifestId.trim());
  if (requested === null) {
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.NOT_FOUND, `RulesetManifest not found: ${manifestId}`);
  }
  const effective = await getEffectiveManifestEntries(requested.id);

  // The Ruleset of every manifest that supplied a pin: the requested one, plus each exact inherited-from manifest
  // M2 reported. One header read per distinct supplying manifest (bounded by inheritance depth, not entry count).
  const supplierRuleset = new Map<string, string>([[requested.id, requested.rulesetId]]);
  for (const supplierId of [...new Set(effective.map((r) => r.resolvedFromManifestId))].sort()) {
    if (supplierRuleset.has(supplierId)) continue;
    const supplier = await selectRulesetManifestById(supplierId);
    if (supplier === null) {
      throw new DomainError(RULESET_RESOLUTION_ERROR_CODES.INVALID_COMPOSITION, `Inherited-from manifest ${supplierId} no longer exists`);
    }
    supplierRuleset.set(supplier.id, supplier.rulesetId);
  }

  const pins: CompositionPin[] = effective.map((r) => ({
    entityId: r.entityId,
    entityVersionId: r.entityVersionId,
    sourceRulesetId: supplierRuleset.get(r.resolvedFromManifestId) as string,
    sourceManifestId: r.resolvedFromManifestId,
  }));
  const ruleset = await getRuleset(requested.rulesetId);
  return buildRulesetContextFromComposition({
    rulesetId: requested.rulesetId,
    manifestId: requested.id,
    manifestHash: null,
    rulesetVersionLabel: ruleset.versionLabel,
    release: null,
    pins,
    ...(await identityRows(pins)),
  });
}

/**
 * Published / historical evaluation against an exact immutable RulesetRelease (§11–14).
 *
 * Integrity is verified FIRST by M2's own verifier; a mismatch yields RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE and
 * no context. The context is then the Release's FROZEN composition — the entries of its own flattened release manifest
 * — never whatever its base Manifest would resolve to today. The stored hash is carried verbatim, never recomputed
 * here.
 *
 * Errors: RULESET_RELEASE.NOT_FOUND (from M2), RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE,
 * RULESET_RESOLUTION.INVALID_COMPOSITION.
 */
export async function resolveRulesetContextFromRelease(releaseId: string): Promise<RulesetContext> {
  const verification = await verifyRulesetReleaseManifestHash(releaseId);
  if (!verification.valid) {
    throw new DomainError(
      RULESET_RESOLUTION_ERROR_CODES.RELEASE_INTEGRITY_FAILURE,
      `Release ${verification.releaseId}'s composition does not match its stored manifest hash; refusing to build an evaluation context`,
    );
  }
  const release = await getRulesetRelease(verification.releaseId);
  if (release.manifestHash !== verification.storedHash) {
    throw new DomainError(RULESET_RESOLUTION_ERROR_CODES.RELEASE_INTEGRITY_FAILURE, `Release ${release.id} changed while it was being resolved`);
  }

  const pins: CompositionPin[] = release.composition.map((pin) => ({
    entityId: pin.entityId,
    entityVersionId: pin.entityVersionId,
    sourceRulesetId: release.rulesetId,
    sourceManifestId: release.manifestId,
  }));
  const ruleset = await getRuleset(release.rulesetId);
  return buildRulesetContextFromComposition({
    rulesetId: release.rulesetId,
    manifestId: release.manifestId,
    manifestHash: release.manifestHash,
    rulesetVersionLabel: ruleset.versionLabel,
    release: { releaseId: release.id, releaseNumber: release.releaseNumber, versionLabel: release.versionLabel },
    pins,
    ...(await identityRows(pins)),
  });
}
