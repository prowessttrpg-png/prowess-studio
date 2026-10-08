import type { ChangeSetOperation } from "./change-set.js";
import type { CanonPolicyId, ChangeSetId, EntityId, EntityVersionId, RulesetId, RulesetManifestId, RulesetReleaseId } from "./ids.js";
import type { RulesetChannel } from "./ruleset-channel.js";
import { ENTITY_VERSION_STATUSES, type EntityVersionStatus } from "./status.js";
import { ENTITY_VERSION_TRANSITIONS } from "./entity-version-lifecycle.js";

/**
 * A RulesetRelease — immutable published history (PAS-10 M2-WO8). Born published: no draft state, no
 * updated_at, no current/active flag. It pins EXACTLY: the Ruleset, a NEW flattened manifest snapshot,
 * the CanonPolicy that governed publication, the approved ChangeSet applied (if any), a per-Ruleset
 * release number and version label, the Ruleset's channel at publication, and the composition hash.
 *
 * ```
 * CanonDecision → ChangeSet → (review) APPROVED → explicit publish
 *   Base Manifest → flatten + apply → NEW Release Manifest → RulesetRelease
 * ```
 */
export interface RulesetRelease {
  id: RulesetReleaseId;
  rulesetId: RulesetId;
  /** Allocated per Ruleset (1, 2, 3, …); never caller-supplied. */
  releaseNumber: number;
  /** Trimmed, human-facing, unique per Ruleset. Not interpreted as SemVer. */
  versionLabel: string;
  /** The Ruleset's channel AT PUBLICATION — a historical snapshot. */
  channel: RulesetChannel;
  /** The exact, flattened, parentless manifest that IS this release's composition. */
  manifestId: RulesetManifestId;
  canonPolicyId: CanonPolicyId;
  changeSetId: ChangeSetId | null;
  /** Lowercase hex SHA-256 of the canonical composition text (PROWESS_MANIFEST_V1). */
  manifestHash: string;
  releaseNotes: string | null;
  publishedAt: Date;
}

/** One pin of a published composition. */
export interface ReleasePin {
  entityId: EntityId;
  entityVersionId: EntityVersionId;
}

/** A release with its exact composition (the release manifest's entries, ordered by Entity id). */
export interface RulesetReleaseWithComposition extends RulesetRelease {
  composition: ReleasePin[];
}

/** What a caller supplies. Release number, hash, channel, timestamp and manifest version are never supplied. */
export interface CreateRulesetReleaseInput {
  rulesetId: string;
  baseManifestId: string;
  canonPolicyId: string;
  changeSetId?: string | null;
  versionLabel: string;
  releaseNotes?: string | null;
}

export interface RulesetReleaseManifestVerification {
  releaseId: RulesetReleaseId;
  valid: boolean;
  storedHash: string;
  computedHash: string;
}

export const RULESET_RELEASE_DIFF_TYPES = ["ADDED_ENTITY", "REMOVED_ENTITY", "CHANGED_VERSION"] as const;
export type RulesetReleaseDiffType = (typeof RULESET_RELEASE_DIFF_TYPES)[number];

export interface RulesetReleaseDiffEntry {
  type: RulesetReleaseDiffType;
  entityId: string;
  fromEntityVersionId: string | null;
  toEntityVersionId: string | null;
}

/** Composition-level difference from release A to release B (entries ordered by Entity id). */
export interface RulesetReleaseDiff {
  releaseAId: RulesetReleaseId;
  releaseBId: RulesetReleaseId;
  entries: RulesetReleaseDiffEntry[];
  unchangedCount: number;
}

export const MAX_RELEASE_VERSION_LABEL_LENGTH = 100;
export const MAX_RELEASE_NOTES_LENGTH = 8000;

const isBlank = (v: unknown) => typeof v !== "string" || v.trim().length === 0;
const present = (v: unknown) => v !== undefined && v !== null;

/** Pure shape validation of a publication request. Returns a message, or `null`. */
export function validateCreateRulesetReleaseInput(input: CreateRulesetReleaseInput): string | null {
  if (typeof input !== "object" || input === null) return "input must be an object";
  for (const field of ["rulesetId", "baseManifestId", "canonPolicyId"] as const) {
    if (isBlank(input[field])) return `${field} is required`;
  }
  if (present(input.changeSetId) && isBlank(input.changeSetId)) return "changeSetId, when supplied, must be a non-empty string";
  if (isBlank(input.versionLabel)) return "versionLabel is required and must not be empty";
  if (input.versionLabel.trim().length > MAX_RELEASE_VERSION_LABEL_LENGTH) return `versionLabel must be at most ${MAX_RELEASE_VERSION_LABEL_LENGTH} characters`;
  if (present(input.releaseNotes) && typeof input.releaseNotes !== "string") return "releaseNotes, when supplied, must be a string";
  if (typeof input.releaseNotes === "string" && input.releaseNotes.length > MAX_RELEASE_NOTES_LENGTH) return `releaseNotes must be at most ${MAX_RELEASE_NOTES_LENGTH} characters`;
  return null;
}

/** Version tag of the canonical composition text. Changing the format requires a NEW tag. */
export const MANIFEST_HASH_FORMAT = "PROWESS_MANIFEST_V1";

/**
 * The canonical text whose SHA-256 is a release's `manifest_hash`:
 *
 *   PROWESS_MANIFEST_V1\n
 *   <entity-id>:<entity-version-id>\n      one line per pin, lowercase UUIDs,
 *   …                                       sorted by entity id ascending
 *
 * It depends ONLY on the composition — never on entry row ids, timestamps, insertion order, release
 * label or any other metadata. (Hashing itself happens in @prowess/db with node:crypto, keeping this
 * package free of runtime-specific APIs.)
 */
export function canonicalManifestText(pins: ReadonlyArray<{ entityId: string; entityVersionId: string }>): string {
  const lines = pins
    .map((p) => `${p.entityId.trim().toLowerCase()}:${p.entityVersionId.trim().toLowerCase()}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${MANIFEST_HASH_FORMAT}\n${lines.map((l) => `${l}\n`).join("")}`;
}

export type PublicationProblemKind = "INVALID_MANIFEST_CONTEXT" | "UNRESOLVED_CREATE_OPERATION" | "STALE_CHANGE_SET";

export type PublicationPlan =
  | { ok: true; composition: Map<string, string>; deprecations: Array<{ entityId: string; entityVersionId: string; sequence: number }> }
  | { ok: false; kind: PublicationProblemKind; message: string };

/**
 * Applies an APPROVED ChangeSet's operations, in sequence order, to a working copy of the base
 * manifest's EFFECTIVE composition (entity id -> version id). PURE: nothing is read or written. Fails
 * CLOSED on the first problem — it never "does what the user probably meant":
 *
 *   any op whose targetManifestId is set and is not the base manifest -> INVALID_MANIFEST_CONTEXT
 *   CREATE_ENTITY_VERSION       never materialized                         -> UNRESOLVED_CREATE_OPERATION
 *   PIN_ENTITY_VERSION          Entity -> to, whether or not a pin exists
 *   REPLACE_ENTITY_VERSION      requires current pin == from               -> else STALE_CHANGE_SET
 *   ADD_ENTITY_TO_MANIFEST      requires the Entity to be absent           -> else STALE_CHANGE_SET
 *   REMOVE_ENTITY_FROM_MANIFEST requires a pin (== from, if from given)    -> else STALE_CHANGE_SET
 *   DEPRECATE_ENTITY_VERSION    composition unchanged; the Version is queued for an M1 lifecycle
 *                               transition inside the publication transaction
 *   NO_CHANGE                   nothing
 */
export function planChangeSetApplication(
  baseComposition: ReadonlyMap<string, string>,
  operations: readonly ChangeSetOperation[],
  baseManifestId: string,
): PublicationPlan {
  const composition = new Map(baseComposition);
  const deprecations: Array<{ entityId: string; entityVersionId: string; sequence: number }> = [];
  const ordered = [...operations].sort((a, b) => a.sequence - b.sequence);
  const at = (op: ChangeSetOperation) => `operation ${op.sequence} (${op.operationType})`;

  for (const op of ordered) {
    if (op.targetManifestId !== null && op.targetManifestId !== baseManifestId) {
      return { ok: false, kind: "INVALID_MANIFEST_CONTEXT", message: `${at(op)} targets manifest ${op.targetManifestId}, not the publication's base manifest ${baseManifestId}` };
    }
  }
  const create = ordered.find((op) => op.operationType === "CREATE_ENTITY_VERSION");
  if (create !== undefined) {
    return {
      ok: false,
      kind: "UNRESOLVED_CREATE_OPERATION",
      message: `${at(create)} proposes a Version that does not exist yet; author it, then publish a ChangeSet that references the exact new Version`,
    };
  }

  for (const op of ordered) {
    const entity = op.targetEntityId as string;
    const current = op.targetEntityId === null ? undefined : composition.get(entity);
    const stale = (why: string) => ({ ok: false as const, kind: "STALE_CHANGE_SET" as const, message: `${at(op)}: ${why}; the ChangeSet no longer matches the base manifest` });
    switch (op.operationType) {
      case "PIN_ENTITY_VERSION":
        composition.set(entity, op.toEntityVersionId as string);
        break;
      case "REPLACE_ENTITY_VERSION":
        if (current !== op.fromEntityVersionId) return stale(`expected Entity ${entity} at ${op.fromEntityVersionId}, base has ${current ?? "no pin"}`);
        composition.set(entity, op.toEntityVersionId as string);
        break;
      case "ADD_ENTITY_TO_MANIFEST":
        if (current !== undefined) return stale(`expected Entity ${entity} to be absent, base pins ${current}`);
        composition.set(entity, op.toEntityVersionId as string);
        break;
      case "REMOVE_ENTITY_FROM_MANIFEST":
        if (current === undefined) return stale(`expected Entity ${entity} to be present, base has no pin`);
        if (op.fromEntityVersionId !== null && current !== op.fromEntityVersionId) return stale(`expected Entity ${entity} at ${op.fromEntityVersionId}, base has ${current}`);
        composition.delete(entity);
        break;
      case "DEPRECATE_ENTITY_VERSION":
        deprecations.push({ entityId: entity, entityVersionId: op.fromEntityVersionId as string, sequence: op.sequence });
        break;
      default:
        break; // NO_CHANGE (CREATE was rejected above)
    }
  }
  return { ok: true, composition, deprecations };
}

/** Pure composition diff (A -> B), entries ordered by Entity id. */
export function diffCompositions(
  a: ReadonlyArray<{ entityId: string; entityVersionId: string }>,
  b: ReadonlyArray<{ entityId: string; entityVersionId: string }>,
): { entries: RulesetReleaseDiffEntry[]; unchangedCount: number } {
  const left = new Map(a.map((p) => [p.entityId, p.entityVersionId]));
  const right = new Map(b.map((p) => [p.entityId, p.entityVersionId]));
  const entries: RulesetReleaseDiffEntry[] = [];
  let unchangedCount = 0;
  for (const entityId of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const from = left.get(entityId) ?? null;
    const to = right.get(entityId) ?? null;
    if (from === null) entries.push({ type: "ADDED_ENTITY", entityId, fromEntityVersionId: null, toEntityVersionId: to });
    else if (to === null) entries.push({ type: "REMOVED_ENTITY", entityId, fromEntityVersionId: from, toEntityVersionId: null });
    else if (from !== to) entries.push({ type: "CHANGED_VERSION", entityId, fromEntityVersionId: from, toEntityVersionId: to });
    else unchangedCount++;
  }
  return { entries, unchangedCount };
}

/**
 * EntityVersion statuses whose CONTENT is, or can again become, editable (M2-WO12 F1): DRAFT — the only status
 * `updateDraftEntityVersion` accepts — plus every status from which the M1 lifecycle graph can REACH DRAFT. DERIVED
 * from ENTITY_VERSION_TRANSITIONS (never hard-coded), so a lifecycle change re-derives it. Today: DRAFT, IN_REVIEW
 * (IN_REVIEW -> DRAFT is M1's send-back path). A published composition may pin none of these.
 */
export const MUTABLE_ENTITY_VERSION_STATUSES: readonly EntityVersionStatus[] = ENTITY_VERSION_STATUSES.filter((status) => {
  const seen = new Set<EntityVersionStatus>([status]);
  const queue: EntityVersionStatus[] = [status];
  while (queue.length > 0) {
    const current = queue.shift() as EntityVersionStatus;
    if (current === "DRAFT") return true;
    for (const next of ENTITY_VERSION_TRANSITIONS[current]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
});

/** Whether a Version in this status may be pinned by a published Release (its content can never be edited again). */
export function isPublishableVersionStatus(status: EntityVersionStatus): boolean {
  return !MUTABLE_ENTITY_VERSION_STATUSES.includes(status);
}
