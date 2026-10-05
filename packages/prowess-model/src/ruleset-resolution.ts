import { EntityId, EntityVersionId, RulesetManifestId } from "./ids.js";

/**
 * Effective resolution across manifest inheritance (PAS-10 M2-WO3).
 *
 * ```
 * Grandparent Manifest G1
 *         ↓ (pinned by exact id)
 * Parent Manifest P1
 *         ↓ (pinned by exact id)
 * Child Manifest C1
 *
 * Child explicit pin  >  Parent inherited pin  >  Grandparent inherited pin
 * ```
 *
 * A child manifest pins its parent manifest by EXACT id — never "whichever
 * manifest of the parent Ruleset is latest" — so creating newer parent
 * manifests can never change what an existing child resolves to.
 */

/**
 * Where a resolved pin came from. A domain-only distinction for the trace: it
 * is deliberately NOT a Prisma enum, because it is a transient result, never
 * stored.
 */
export const RULESET_RESOLUTION_SOURCES = ["EXPLICIT", "INHERITED"] as const;
export type RulesetResolutionSource = (typeof RULESET_RESOLUTION_SOURCES)[number];

/**
 * The answer to "why does this Entity resolve to this Version?" — enough for a
 * future inspector to explain it without re-deriving anything.
 *
 *  - `requestedManifestId`   the manifest the caller asked about
 *  - `resolvedFromManifestId` the manifest whose entry supplied the pin
 *  - `resolutionDepth`       0 = the requested manifest itself, 1 = its pinned
 *                            parent manifest, 2 = that one's parent, …
 *  - `source`                EXPLICIT (depth 0) or INHERITED (depth > 0)
 */
export interface RulesetResolutionResult {
  entityId: EntityId;
  entityVersionId: EntityVersionId;
  requestedManifestId: RulesetManifestId;
  resolvedFromManifestId: RulesetManifestId;
  resolutionDepth: number;
  source: RulesetResolutionSource;
}

export function resolutionSourceForDepth(depth: number): RulesetResolutionSource {
  return depth === 0 ? "EXPLICIT" : "INHERITED";
}

/** One manifest in an inheritance chain and the pins it contains. */
export interface InheritanceLevel {
  manifestId: string;
  pins: ReadonlyArray<{ entityId: string; entityVersionId: string }>;
}

/**
 * Flattens an inheritance chain into one result per Entity. Pure and
 * storage-independent.
 *
 * `levels` is ordered NEAREST FIRST: `levels[0]` is the requested manifest,
 * `levels[1]` its pinned parent manifest, and so on. For each Entity the
 * nearest level that pins it wins, so an explicit child entry always
 * outranks an inherited one and no Entity appears twice.
 *
 * The result is in encounter order — it is NOT sorted. Ordering by the Entity's
 * canonical key is a database collation question, so the caller applies the
 * same ordering the database uses for manifest entries (see the persistence
 * layer), keeping the convention identical to M2-WO2's.
 *
 * Nothing here consults a version's revision, lifecycle status, Source
 * authority, Keywords, relationships, or any Ruleset: a manifest chain and its
 * pins are the entire input.
 */
export function flattenInheritanceChain(levels: readonly InheritanceLevel[]): RulesetResolutionResult[] {
  const nearest = levels[0];
  if (nearest === undefined) {
    return [];
  }
  const requestedManifestId = RulesetManifestId.of(nearest.manifestId);
  const decided = new Set<string>();
  const results: RulesetResolutionResult[] = [];

  levels.forEach((level, depth) => {
    for (const pin of level.pins) {
      const key = pin.entityId.toLowerCase();
      if (decided.has(key)) {
        continue; // a nearer manifest already decided this Entity
      }
      decided.add(key);
      results.push({
        entityId: EntityId.of(pin.entityId),
        entityVersionId: EntityVersionId.of(pin.entityVersionId),
        requestedManifestId,
        resolvedFromManifestId: RulesetManifestId.of(level.manifestId),
        resolutionDepth: depth,
        source: resolutionSourceForDepth(depth),
      });
    }
  });
  return results;
}
