import {
  DomainError,
  flattenInheritanceChain,
  resolutionSourceForDepth,
  RULESET_MANIFEST_ERROR_CODES,
  type RulesetManifest,
  type RulesetResolutionResult,
} from "@prowess/model";
import {
  selectManifestEntries,
  selectManifestEntry,
  selectRulesetManifestById,
} from "../ruleset-manifest/repository.js";
import { selectEntityIdsInCanonicalKeyOrder } from "./repository.js";

/**
 * Effective resolution across manifest inheritance (PAS-10 M2-WO3).
 *
 * The ONLY path this module follows is the chain of EXACT parent-manifest ids
 * stored on the manifests themselves: requested manifest -> its
 * parent_manifest_id -> that manifest's parent_manifest_id -> … It never looks
 * up a Ruleset, never asks for a Ruleset's "latest" manifest, and never reads an
 * EntityVersion at all — so a newer parent manifest, a newer EntityVersion, a
 * lifecycle status, a Source authority, a Keyword or a relationship cannot change
 * what an existing manifest resolves to. A static audit scans this directory for
 * exactly those identifiers.
 *
 * Deliberately absent: persisting flattened results (they are derived from
 * immutable snapshots, and a stored copy could drift), and any operation that
 * changes a manifest's parent.
 */

const normalizeId = (value: string) => value.trim().toLowerCase();

async function requireManifest(manifestId: string): Promise<RulesetManifest> {
  const manifest = await selectRulesetManifestById(manifestId);
  if (manifest === null) {
    throw new DomainError(RULESET_MANIFEST_ERROR_CODES.NOT_FOUND, `RulesetManifest not found: ${manifestId}`);
  }
  return manifest;
}

/**
 * The requested manifest followed by its pinned parent manifest, that one's
 * parent, and so on — nearest first. Stops at a manifest that inherits nothing.
 *
 * Supported operations cannot create a loop (each hop climbs the acyclic Ruleset
 * lineage), but the stored chain is defended anyway: revisiting a manifest ends
 * resolution with INHERITANCE_CYCLE rather than recursing forever on corrupt data.
 */
async function loadInheritanceChain(requested: RulesetManifest): Promise<RulesetManifest[]> {
  const chain: RulesetManifest[] = [requested];
  const seen = new Set<string>([requested.id]);
  let current = requested;

  while (current.parentManifestId !== null) {
    const parentId = current.parentManifestId;
    if (seen.has(parentId)) {
      throw new DomainError(
        RULESET_MANIFEST_ERROR_CODES.INHERITANCE_CYCLE,
        `Manifest inheritance loops back to ${parentId}: ${[...chain.map((m) => m.id), parentId].join(" -> ")}`,
      );
    }
    const parent = await selectRulesetManifestById(parentId);
    if (parent === null) {
      throw new DomainError(
        RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST,
        `Manifest ${current.id} inherits from ${parentId}, which does not exist`,
      );
    }
    seen.add(parent.id);
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/**
 * What one Entity resolves to under a manifest, with the trace of WHY.
 *
 * Checks the manifest's own explicit entry first (depth 0, EXPLICIT); if absent,
 * the manifest it pinned as its parent (depth 1, INHERITED); and so on up the
 * chain. Nearest wins. If no manifest in the chain pins the Entity the answer is
 * `null` — an Entity nobody pinned is a normal answer, not an error. An unknown
 * requested manifest is `RULESET_MANIFEST.NOT_FOUND`.
 *
 * A manifest with no parent_manifest_id resolves only its own entries, even if its
 * Ruleset has a parent Ruleset: lineage alone never activates inheritance.
 */
export async function resolveEffectiveEntityVersion(
  manifestId: string,
  entityId: string,
): Promise<RulesetResolutionResult | null> {
  const requested = await requireManifest(manifestId);
  const chain = await loadInheritanceChain(requested);
  const wanted = normalizeId(entityId);

  for (const [depth, manifest] of chain.entries()) {
    const entry = await selectManifestEntry(manifest.id, wanted);
    if (entry !== null) {
      return {
        entityId: entry.entityId,
        entityVersionId: entry.entityVersionId,
        requestedManifestId: requested.id,
        resolvedFromManifestId: manifest.id,
        resolutionDepth: depth,
        source: resolutionSourceForDepth(depth),
      };
    }
  }
  return null;
}

/**
 * The flattened effective composition of a manifest: one result per Entity pinned
 * anywhere in its inheritance chain, the nearest pin winning, each carrying its
 * provenance (which manifest supplied it, at what depth, EXPLICIT or INHERITED).
 *
 * Derived on every call from immutable snapshots and never stored. Ordered by the
 * Entity's canonical key ASC, then id — the same convention as a manifest's own
 * entries (M2-WO2), applied by the database so the two can never disagree.
 */
export async function getEffectiveManifestEntries(manifestId: string): Promise<RulesetResolutionResult[]> {
  const requested = await requireManifest(manifestId);
  const chain = await loadInheritanceChain(requested);

  const levels = [];
  for (const manifest of chain) {
    const entries = await selectManifestEntries(manifest.id);
    levels.push({
      manifestId: manifest.id,
      pins: entries.map((entry) => ({ entityId: entry.entityId, entityVersionId: entry.entityVersionId })),
    });
  }

  const flattened = flattenInheritanceChain(levels);
  const ordered = await selectEntityIdsInCanonicalKeyOrder(flattened.map((result) => result.entityId));
  const position = new Map(ordered.map((id, index) => [id, index] as const));
  return [...flattened].sort((a, b) => (position.get(a.entityId) ?? 0) - (position.get(b.entityId) ?? 0));
}
