import {
  EntityId,
  EntityVersionId,
  RulesetId,
  RulesetManifestEntryId,
  RulesetManifestId,
  type RulesetManifest,
  type RulesetManifestEntry,
  type RulesetManifestWithEntries,
} from "@prowess/model";
import { prisma } from "../client.js";
import { isUniqueViolation } from "../prisma-errors.js";
import type {
  RulesetManifest as PrismaManifestRow,
  RulesetManifestEntry as PrismaManifestEntryRow,
} from "../../generated/prisma/client.js";

/**
 * RulesetManifest repository — the only place that speaks Prisma's manifest API.
 * Internal to @prowess/db (not exported from `index.ts`); see `./service.ts`.
 *
 * Nothing here ever chooses an EntityVersion: it stores and returns exactly the
 * pairs it is given. In particular it never asks "which EntityVersion is the
 * latest", and never looks at lifecycle status, Source authority, or a parent
 * Ruleset.
 */

export function toDomainManifest(row: PrismaManifestRow): RulesetManifest {
  return {
    id: RulesetManifestId.of(row.id),
    rulesetId: RulesetId.of(row.rulesetId),
    manifestVersion: row.manifestVersion,
    createdAt: row.createdAt,
  };
}

export function toDomainManifestEntry(row: PrismaManifestEntryRow): RulesetManifestEntry {
  return {
    id: RulesetManifestEntryId.of(row.id),
    manifestId: RulesetManifestId.of(row.manifestId),
    entityId: EntityId.of(row.entityId),
    entityVersionId: EntityVersionId.of(row.entityVersionId),
    createdAt: row.createdAt,
  };
}

export interface ManifestEntryInsert {
  entityId: string;
  entityVersionId: string;
}

/**
 * How many times a manifest_version allocation is attempted before giving up.
 * The same bounded-retry strategy as EntityVersion revision allocation, with a
 * higher bound: every round at least one contender wins, so up to this many
 * SIMULTANEOUS creators for one Ruleset are guaranteed to all succeed; beyond
 * that the last unique-violation is rethrown (the service reports it as
 * RULESET_MANIFEST.VERSION_CONFLICT, which is safe to retry).
 */
const MAX_MANIFEST_VERSION_ATTEMPTS = 8;

/**
 * Creates one manifest and all of its entries ATOMICALLY.
 *
 * One transaction: read this Ruleset's highest manifest_version, insert the
 * manifest at the next number, insert every entry in order. If ANY step fails
 * — including a database-level rejection of an entry — the whole transaction
 * rolls back, so no manifest and no entries persist and no version number is
 * consumed. If another request wins the same manifest_version, the UNIQUE
 * constraint rejects this attempt and it retries against a fresh maximum.
 *
 * "Highest manifest_version" is the only ordering used, and only to number
 * MANIFESTS. Entity versions are never ordered or compared here.
 */
export async function insertRulesetManifestWithEntries(
  rulesetId: string,
  entries: readonly ManifestEntryInsert[],
): Promise<RulesetManifestWithEntries> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_MANIFEST_VERSION_ATTEMPTS; attempt++) {
    try {
      const manifestId = await prisma.$transaction(async (tx) => {
        const latest = await tx.rulesetManifest.findFirst({
          where: { rulesetId },
          orderBy: { manifestVersion: "desc" },
          select: { manifestVersion: true },
        });
        const nextManifestVersion = (latest?.manifestVersion ?? 0) + 1;

        const manifest = await tx.rulesetManifest.create({
          data: { rulesetId, manifestVersion: nextManifestVersion },
        });
        for (const entry of entries) {
          await tx.rulesetManifestEntry.create({
            data: { manifestId: manifest.id, entityId: entry.entityId, entityVersionId: entry.entityVersionId },
          });
        }
        return manifest.id;
      });

      const created = await selectRulesetManifestWithEntries(manifestId);
      if (created === null) {
        throw new Error(`Manifest ${manifestId} disappeared immediately after commit`);
      }
      return created;
    } catch (error) {
      lastError = error;
      if (isManifestVersionViolation(error)) {
        continue; // another request won this manifest_version — retry against a fresh maximum
      }
      throw error;
    }
  }

  throw lastError;
}

/** UUID-safe: a malformed id simply finds nothing (never a raw database error). */
export async function selectRulesetManifestById(id: string): Promise<RulesetManifest | null> {
  try {
    const row = await prisma.rulesetManifest.findUnique({ where: { id } });
    return row ? toDomainManifest(row) : null;
  } catch {
    return null;
  }
}

/** Entries ordered by the pinned Entity's canonical_key ASC, then entity_id ASC — deterministic. */
export async function selectManifestEntries(manifestId: string): Promise<RulesetManifestEntry[]> {
  const rows = await prisma.rulesetManifestEntry.findMany({
    where: { manifestId },
    orderBy: [{ entityVersion: { entity: { canonicalKey: "asc" } } }, { entityId: "asc" }],
  });
  return rows.map(toDomainManifestEntry);
}

export async function selectRulesetManifestWithEntries(id: string): Promise<RulesetManifestWithEntries | null> {
  const manifest = await selectRulesetManifestById(id);
  if (manifest === null) {
    return null;
  }
  return { ...manifest, entries: await selectManifestEntries(manifest.id) };
}

/** Ordered `manifest_version ASC`. */
export async function selectRulesetManifestsByRuleset(rulesetId: string): Promise<RulesetManifest[]> {
  const rows = await prisma.rulesetManifest.findMany({
    where: { rulesetId },
    orderBy: { manifestVersion: "asc" },
  });
  return rows.map(toDomainManifest);
}

/**
 * The manifest with the highest manifest_version for a Ruleset — "Latest Manifest",
 * a deterministic historical convenience ONLY. It is not the published, active,
 * or Canon manifest; no such concept exists.
 */
export async function selectLatestRulesetManifest(rulesetId: string): Promise<RulesetManifest | null> {
  const row = await prisma.rulesetManifest.findFirst({
    where: { rulesetId },
    orderBy: { manifestVersion: "desc" },
  });
  return row ? toDomainManifest(row) : null;
}

/** One pin, by exact (manifest, entity). `null` when that Entity is not pinned there — never a fallback. UUID-safe. */
export async function selectManifestEntry(manifestId: string, entityId: string): Promise<RulesetManifestEntry | null> {
  try {
    const row = await prisma.rulesetManifestEntry.findUnique({
      where: { manifestId_entityId: { manifestId, entityId } },
    });
    return row ? toDomainManifestEntry(row) : null;
  } catch {
    return null;
  }
}

/**
 * Matched by constraint NAME — see `../prisma-errors.ts` for why `meta.target`
 * cannot be used with the Prisma 7 driver adapter.
 */
export function isManifestVersionViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: "ruleset_manifests_ruleset_id_manifest_version_key",
    fields: ["ruleset_id", "manifest_version"],
  });
}

export function isManifestEntryDuplicateViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: "ruleset_manifest_entries_manifest_id_entity_id_key",
    fields: ["manifest_id", "entity_id"],
  });
}
