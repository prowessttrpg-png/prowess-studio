import type { CanonicalKey, EntityId, EntityType, EntityVersionId, RulesetId, RulesetManifestId, RulesetReleaseId } from "@prowess/model";
import {
  InputProblems,
  readCanonicalKey,
  readEntityType,
  readOptionalText,
  readOptionalUuid,
  readPositiveInteger,
  readRecord,
  readText,
  readUuid,
} from "../internal/input-reader.js";
import type { PathSegment } from "../internal/plain-data.js";
import { finishOutcome, type ContextOutcome } from "./shared.js";

/**
 * One exact rule version available to an evaluation (PAS-10 M4-WO1 §10).
 *
 * Identity is `entityId` + `entityVersionId` — immutable ids. `canonicalKey` and `entityType` are carried for
 * explanation and addressing, never as relational identity. `sourceRulesetId` / `sourceManifestId` record where the
 * pin came from when the caller knows it (e.g. the manifest that supplied an inherited pin — M2's
 * `RulesetResolutionResult.resolvedFromManifestId`); they are null when not supplied, never guessed.
 */
export interface ResolvedRuleReference {
  readonly entityId: EntityId;
  readonly entityVersionId: EntityVersionId;
  readonly canonicalKey: CanonicalKey;
  readonly entityType: EntityType;
  readonly sourceRulesetId: RulesetId | null;
  readonly sourceManifestId: RulesetManifestId | null;
}

/** The published-release identity of the Ruleset composition, when the evaluation runs against a release. */
export interface RulesetReleaseIdentity {
  readonly releaseId: RulesetReleaseId;
  readonly releaseNumber: number;
  readonly versionLabel: string;
}

/**
 * The exact rules environment of an evaluation (PAS-10 M4-WO1 §9, §58–59).
 *
 * Always SUPPLIED by the caller — the engine never resolves, looks up or "refreshes" any of it. M4-WO2 connects M2's
 * exact Ruleset / Manifest resolution to this contract. The context deliberately has no Canon, authority, status or
 * "is latest" field: those governance decisions were made before evaluation (M2) and the engine cannot see or change
 * them.
 *
 *  - `manifestHash`  preserved VERBATIM (lowercase hex SHA-256, as M2 publishes it) or null for an unpublished
 *                    manifest; never recomputed here — M2 remains the authority for manifest integrity
 *  - `rules`         the resolved rule versions, a set keyed by Entity: sorted by `entityId`, at most one version per
 *                    Entity, no Version listed twice (the flattened-manifest invariant of M2-WO3)
 */
export interface RulesetContext {
  readonly rulesetId: RulesetId;
  readonly manifestId: RulesetManifestId;
  readonly manifestHash: string | null;
  readonly rulesetVersionLabel: string | null;
  readonly release: RulesetReleaseIdentity | null;
  readonly rules: readonly ResolvedRuleReference[];
}

const MANIFEST_HASH_PATTERN = /^[0-9a-f]{64}$/;

function readRule(value: unknown, at: readonly PathSegment[], p: InputProblems): ResolvedRuleReference | null {
  const fields = ["entityId", "entityVersionId", "canonicalKey", "entityType", "sourceRulesetId", "sourceManifestId"];
  const r = readRecord(value, at, p, fields, ["entityId", "entityVersionId", "canonicalKey", "entityType"]);
  if (r === null) return null;
  const before = p.count;
  const entityId = readUuid(r.entityId, [...at, "entityId"], p);
  const entityVersionId = readUuid(r.entityVersionId, [...at, "entityVersionId"], p);
  const canonicalKey = readCanonicalKey(r.canonicalKey, [...at, "canonicalKey"], p);
  const entityType = readEntityType(r.entityType, [...at, "entityType"], p);
  const sourceRulesetId = readOptionalUuid(r.sourceRulesetId, [...at, "sourceRulesetId"], p);
  const sourceManifestId = readOptionalUuid(r.sourceManifestId, [...at, "sourceManifestId"], p);
  if (p.count > before || entityId === null || entityVersionId === null || canonicalKey === null || entityType === null) return null;
  return {
    entityId: entityId as EntityId,
    entityVersionId: entityVersionId as EntityVersionId,
    canonicalKey,
    entityType,
    sourceRulesetId: sourceRulesetId as RulesetId | null,
    sourceManifestId: sourceManifestId as RulesetManifestId | null,
  };
}

function readRelease(value: unknown, at: readonly PathSegment[], p: InputProblems): RulesetReleaseIdentity | null {
  if (value === undefined || value === null) return null;
  const r = readRecord(value, at, p, ["releaseId", "releaseNumber", "versionLabel"], ["releaseId", "releaseNumber", "versionLabel"]);
  if (r === null) return null;
  const releaseId = readUuid(r.releaseId, [...at, "releaseId"], p);
  const releaseNumber = readPositiveInteger(r.releaseNumber, [...at, "releaseNumber"], p);
  const versionLabel = readText(r.versionLabel, [...at, "versionLabel"], p, 100);
  if (releaseId === null || releaseNumber === null || versionLabel === null) return null;
  return { releaseId: releaseId as RulesetReleaseId, releaseNumber, versionLabel };
}

/** Internal: read a RulesetContext at `at` (used directly and inside an evaluation request). */
export function readRulesetContext(value: unknown, at: readonly PathSegment[], p: InputProblems): RulesetContext | null {
  const fields = ["rulesetId", "manifestId", "manifestHash", "rulesetVersionLabel", "release", "rules"];
  const r = readRecord(value, at, p, fields, ["rulesetId", "manifestId"]);
  if (r === null) return null;
  const rulesetId = readUuid(r.rulesetId, [...at, "rulesetId"], p);
  const manifestId = readUuid(r.manifestId, [...at, "manifestId"], p);

  let manifestHash: string | null = null;
  if (r.manifestHash !== undefined && r.manifestHash !== null) {
    if (typeof r.manifestHash === "string" && MANIFEST_HASH_PATTERN.test(r.manifestHash)) manifestHash = r.manifestHash;
    else p.invalid([...at, "manifestHash"], "expected a lowercase hex SHA-256 manifest hash (preserved verbatim, never recomputed)");
  }
  const rulesetVersionLabel = readOptionalText(r.rulesetVersionLabel, [...at, "rulesetVersionLabel"], p, 100);
  const release = readRelease(r.release, [...at, "release"], p);

  const rules: ResolvedRuleReference[] = [];
  if (r.rules !== undefined) {
    if (!Array.isArray(r.rules)) {
      p.invalid([...at, "rules"], "expected an array of resolved rule references");
    } else {
      const byEntity = new Set<string>();
      const byVersion = new Set<string>();
      r.rules.forEach((item: unknown, i: number) => {
        const rule = readRule(item, [...at, "rules", i], p);
        if (rule === null) return;
        if (byEntity.has(rule.entityId)) {
          p.invalid([...at, "rules", i, "entityId"], "an Entity may resolve to only one EntityVersion in one RulesetContext");
          return;
        }
        if (byVersion.has(rule.entityVersionId)) {
          p.invalid([...at, "rules", i, "entityVersionId"], "duplicate EntityVersion");
          return;
        }
        byEntity.add(rule.entityId);
        byVersion.add(rule.entityVersionId);
        rules.push(rule);
      });
    }
  }
  if (rulesetId === null || manifestId === null) return null;
  return {
    rulesetId: rulesetId as RulesetId,
    manifestId: manifestId as RulesetManifestId,
    manifestHash,
    rulesetVersionLabel,
    release,
    rules: rules.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)),
  };
}

/**
 * Validates and normalizes a caller-supplied RulesetContext. Structural checks only: identifiers, hash format, one
 * version per Entity. It does NOT check that the Ruleset or Manifest exists, is published, is Canon or is current.
 */
export function createRulesetContext(input: unknown): ContextOutcome<RulesetContext> {
  const p = new InputProblems();
  const value = readRulesetContext(input, [], p);
  return finishOutcome(p, () => value as RulesetContext);
}

/** The rule version an exact context resolves `entityId` to, or null. Lookup by immutable id only. */
export function findResolvedRule(context: RulesetContext, entityId: string): ResolvedRuleReference | null {
  const id = entityId.toLowerCase();
  return context.rules.find((rule) => rule.entityId === id) ?? null;
}
