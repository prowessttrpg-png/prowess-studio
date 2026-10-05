import type { EntityId, EntityVersionId, RulesetId, RulesetManifestEntryId, RulesetManifestId } from "./ids.js";

/**
 * A RulesetManifest — an immutable historical SNAPSHOT of exactly which
 * EntityVersion applies to each Entity under one Ruleset (PAS-10 M2-WO2).
 *
 * ```
 * Ruleset
 *   ├── Manifest 1
 *   │     ├── Entity A → Revision 1
 *   │     └── Entity B → Revision 3
 *   └── Manifest 2
 *         ├── Entity A → Revision 2
 *         └── Entity B → Revision 3
 * ```
 *
 * A Ruleset may have many manifests over time; changing a composition means
 * creating a NEW manifest, never editing one. `manifestVersion` is allocated
 * automatically (1, 2, 3 … per Ruleset) and is never supplied by a caller.
 *
 * There is deliberately no "current", "active", or "published" manifest: the
 * numerically highest one is only ever the "Latest Manifest", a deterministic
 * historical convenience that means nothing about which composition is in force.
 */
export interface RulesetManifest {
  id: RulesetManifestId;
  rulesetId: RulesetId;
  /**
   * The EXACT manifest, belonging to this Ruleset's direct parent Ruleset, from
   * which Entities this manifest does not pin may be inherited — or `null`,
   * meaning this manifest performs no inheritance at all. Chosen at creation
   * and never changed (a new inheritance means a new manifest). It is a
   * snapshot reference, never "the parent's latest manifest".
   */
  parentManifestId: RulesetManifestId | null;
  /** Positive, unique within the Ruleset, automatically allocated. Never the identity. */
  manifestVersion: number;
  createdAt: Date;
}

/**
 * One pin: "within this manifest, use exactly this EntityVersion for this
 * Entity." It never means "the latest version from now on". The database
 * guarantees the version belongs to the entity (a composite foreign key).
 */
export interface RulesetManifestEntry {
  id: RulesetManifestEntryId;
  manifestId: RulesetManifestId;
  entityId: EntityId;
  entityVersionId: EntityVersionId;
  createdAt: Date;
}

/** A manifest together with its membership, entries ordered by the Entity's canonical key then id. */
export interface RulesetManifestWithEntries extends RulesetManifest {
  entries: RulesetManifestEntry[];
}

export interface CreateRulesetManifestEntryInput {
  entityId: string;
  entityVersionId: string;
}

/**
 * What a caller may supply. There is intentionally NO `manifestVersion`
 * (always allocated) and NO per-entry status/authority/keyword selector:
 * selection is explicit, by EntityVersion id, and nothing else.
 */
export interface CreateRulesetManifestInput {
  /**
   * Optional. The exact manifest to inherit unpinned Entities from; it must
   * belong to this Ruleset's DIRECT parent Ruleset, and a Ruleset with no parent
   * cannot supply one. Omit (or pass null) for a manifest that inherits nothing —
   * having a parent Ruleset does not by itself activate inheritance.
   */
  parentManifestId?: string | null;
  /** May be empty: an empty snapshot means "this Ruleset pins no Entity content". */
  entries: CreateRulesetManifestEntryInput[];
}

/** A documented upper bound so one request cannot create an unbounded snapshot. */
export const MAX_RULESET_MANIFEST_ENTRIES = 10_000;

export interface RulesetManifestInputProblem {
  kind: "INVALID_INPUT" | "DUPLICATE_ENTITY";
  message: string;
}

const normalizeId = (value: string) => value.trim().toLowerCase();

/**
 * Pure, shape-only validation; returns the first problem found, or `null`.
 *
 * Shape problems are reported before duplicates. Duplicate Entities are
 * compared case-insensitively (UUID text is case-insensitive). Whether the
 * Ruleset / Entities / Versions exist, and whether each Version belongs to its
 * Entity, are persistence questions answered by the service, not here.
 */
export function validateCreateRulesetManifestInput(input: CreateRulesetManifestInput): RulesetManifestInputProblem | null {
  if (typeof input !== "object" || input === null || !Array.isArray(input.entries)) {
    return { kind: "INVALID_INPUT", message: "entries is required and must be an array (it may be empty)" };
  }
  if (input.entries.length > MAX_RULESET_MANIFEST_ENTRIES) {
    return { kind: "INVALID_INPUT", message: `a manifest may contain at most ${MAX_RULESET_MANIFEST_ENTRIES} entries` };
  }
  for (const [index, entry] of input.entries.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return { kind: "INVALID_INPUT", message: `entries[${index}] must be an object` };
    }
    if (typeof entry.entityId !== "string" || entry.entityId.trim().length === 0) {
      return { kind: "INVALID_INPUT", message: `entries[${index}].entityId is required` };
    }
    if (typeof entry.entityVersionId !== "string" || entry.entityVersionId.trim().length === 0) {
      return { kind: "INVALID_INPUT", message: `entries[${index}].entityVersionId is required` };
    }
  }
  if (input.parentManifestId !== undefined && input.parentManifestId !== null) {
    if (typeof input.parentManifestId !== "string" || input.parentManifestId.trim().length === 0) {
      return { kind: "INVALID_INPUT", message: "parentManifestId, when supplied, must be a non-blank string" };
    }
  }
  const seen = new Set<string>();
  for (const entry of input.entries) {
    const key = normalizeId(entry.entityId);
    if (seen.has(key)) {
      return { kind: "DUPLICATE_ENTITY", message: `Entity ${entry.entityId} appears more than once; a manifest pins one version per Entity` };
    }
    seen.add(key);
  }
  return null;
}
