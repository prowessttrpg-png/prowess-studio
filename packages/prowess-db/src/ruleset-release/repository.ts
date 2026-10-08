import {
  CanonPolicyId,
  isPublishableVersionStatus,
  ChangeSetId,
  EntityId,
  EntityVersionId,
  RulesetId,
  RulesetManifestId,
  RulesetReleaseId,
  type ReleasePin,
  type RulesetChannel,
  type RulesetRelease,
} from "@prowess/model";
import { prisma } from "../client.js";
import { computeManifestHash } from "./hash.js";
import { transitionEntityVersionStatusInTransaction } from "../entity-version/service.js";
import { isUniqueViolation } from "../prisma-errors.js";
import { insertManifestSnapshotInTransaction, isManifestVersionViolation } from "../ruleset-manifest/repository.js";
import type { RulesetRelease as PrismaReleaseRow } from "../../generated/prisma/client.js";

/**
 * RulesetRelease repository (PAS-10 M2-WO8). Internal to @prowess/db.
 *
 * The publication transaction WRITES exactly: one new manifest + its entries (via the M2-WO2 allocator's
 * transaction body), one new release, the Ruleset's APPROVED -> PUBLISHED transition (first release
 * only), and any approved DEPRECATE through the M1 lifecycle transition. Everything else is a read.
 */

export { computeManifestHash };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);


export function toDomainRelease(row: PrismaReleaseRow): RulesetRelease {
  return {
    id: RulesetReleaseId.of(row.id),
    rulesetId: RulesetId.of(row.rulesetId),
    releaseNumber: row.releaseNumber,
    versionLabel: row.versionLabel,
    channel: row.channel as RulesetChannel,
    manifestId: RulesetManifestId.of(row.manifestId),
    canonPolicyId: CanonPolicyId.of(row.canonPolicyId),
    changeSetId: row.changeSetId === null ? null : ChangeSetId.of(row.changeSetId),
    manifestHash: row.manifestHash,
    releaseNotes: row.releaseNotes,
    publishedAt: row.publishedAt,
  };
}

export async function selectReleaseById(id: string): Promise<RulesetRelease | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.rulesetRelease.findUnique({ where: { id } });
  return row === null ? null : toDomainRelease(row);
}

export async function selectReleasesByRuleset(rulesetId: string): Promise<RulesetRelease[]> {
  const rows = await prisma.rulesetRelease.findMany({ where: { rulesetId }, orderBy: { releaseNumber: "asc" } });
  return rows.map(toDomainRelease);
}

/** Highest release_number only — a convenience query, never a stored pointer. */
export async function selectLatestRelease(rulesetId: string): Promise<RulesetRelease | null> {
  const row = await prisma.rulesetRelease.findFirst({ where: { rulesetId }, orderBy: { releaseNumber: "desc" } });
  return row === null ? null : toDomainRelease(row);
}

export async function selectReleaseByChangeSet(changeSetId: string): Promise<RulesetRelease | null> {
  const row = await prisma.rulesetRelease.findUnique({ where: { changeSetId } });
  return row === null ? null : toDomainRelease(row);
}

export async function selectReleaseByLabel(rulesetId: string, versionLabel: string): Promise<RulesetRelease | null> {
  const row = await prisma.rulesetRelease.findUnique({ where: { rulesetId_versionLabel: { rulesetId, versionLabel } } });
  return row === null ? null : toDomainRelease(row);
}

/** The exact pins of a manifest's OWN entries (release manifests are flattened), ordered by Entity id. */
export async function selectManifestPins(manifestId: string): Promise<ReleasePin[]> {
  const rows = await prisma.rulesetManifestEntry.findMany({ where: { manifestId }, select: { entityId: true, entityVersionId: true }, orderBy: { entityId: "asc" } });
  return rows.map((r) => ({ entityId: EntityId.of(r.entityId), entityVersionId: EntityVersionId.of(r.entityVersionId) }));
}

export interface PublicationPlanInsert {
  rulesetId: string;
  /** The latest release's manifest the plan was computed against (null = first release). Re-checked under the lock. */
  expectedLatestManifestId: string | null;
  canonPolicyId: string;
  changeSetId: string | null;
  versionLabel: string;
  releaseNotes: string | null;
  /** Final composition, ordered by Entity id. */
  pins: ReadonlyArray<{ entityId: string; entityVersionId: string }>;
  manifestHash: string;
  /** Versions to move to DEPRECATED through the M1 lifecycle, in operation order. */
  deprecations: readonly string[];
}

/** Aborts a publication transaction with a controlled reason (mapped by the service). */
export class PublicationAbort extends Error {
  constructor(
    readonly reason: "RULESET_NOT_PUBLISHABLE" | "RELEASE_CONFLICT" | "INVALID_OPERATION" | "MUTABLE_VERSION_PINNED",
    message: string,
  ) {
    super(message);
    this.name = "PublicationAbort";
  }
}

const MAX_PUBLICATION_ATTEMPTS = 8;

export function isReleaseNumberViolation(error: unknown): boolean {
  return isUniqueViolation(error, { constraint: "ruleset_releases_ruleset_id_release_number_key", fields: ["ruleset_id", "release_number"] });
}
export function isVersionLabelViolation(error: unknown): boolean {
  return isUniqueViolation(error, { constraint: "ruleset_releases_ruleset_id_version_label_key", fields: ["ruleset_id", "version_label"] });
}
export function isChangeSetReuseViolation(error: unknown): boolean {
  return isUniqueViolation(error, { constraint: "ruleset_releases_change_set_id_key", fields: ["change_set_id"] });
}

/**
 * THE publication transaction (§34). Everything below commits together or not at all:
 *   1. lock the Ruleset row (SELECT … FOR UPDATE): all publications of one Ruleset serialize here;
 *   2. under the lock, re-check publishability and that the latest release's manifest is still the
 *      plan's baseline (linear history) — a concurrent publisher that got there first => RELEASE_CONFLICT;
 *   2b. M2-WO12 F1: every Version of the FINAL composition must be content-frozen (not DRAFT, and unable to return to
 *      DRAFT through the M1 lifecycle); otherwise MUTABLE_VERSION_PINNED. Checked on this transaction, before any write;
 *      nothing is promoted or modified;
 *   3. first release only: APPROVED -> PUBLISHED (expected-state conditional update);
 *   4. approved DEPRECATEs through the M1 lifecycle transition, ON THIS TRANSACTION;
 *   5. the new flattened, parentless manifest + entries via the M2-WO2 allocator body;
 *   6. re-read the inserted entries and verify their hash equals the plan's;
 *   7. release_number = previous + 1 (serialized by the lock; UNIQUE is the final authority);
 *   8. insert the release.
 * A unique violation on manifest_version or release_number retries the WHOLE transaction (bounded).
 */
export async function executePublication(plan: PublicationPlanInsert): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string; channel: string }>>`
          SELECT status::text AS status, channel::text AS channel FROM rulesets WHERE id = ${plan.rulesetId}::uuid FOR UPDATE`;
        const ruleset = locked[0];
        if (ruleset === undefined || (ruleset.status !== "APPROVED" && ruleset.status !== "PUBLISHED")) {
          throw new PublicationAbort("RULESET_NOT_PUBLISHABLE", `Ruleset ${plan.rulesetId} is ${ruleset?.status ?? "missing"}; only APPROVED or PUBLISHED Rulesets can publish`);
        }
        const latest = await tx.rulesetRelease.findFirst({ where: { rulesetId: plan.rulesetId }, orderBy: { releaseNumber: "desc" } });
        if ((latest?.manifestId ?? null) !== plan.expectedLatestManifestId) {
          throw new PublicationAbort("RELEASE_CONFLICT", "Another release was published first; this publication's base is no longer the latest release's manifest");
        }
        const pinnedIds = plan.pins.map((p) => p.entityVersionId);
        const pinned = await tx.entityVersion.findMany({ where: { id: { in: pinnedIds } }, select: { id: true, status: true }, orderBy: { id: "asc" } });
        const mutable = pinned.filter((v) => !isPublishableVersionStatus(v.status as Parameters<typeof isPublishableVersionStatus>[0]));
        if (mutable.length > 0 || pinned.length !== new Set(pinnedIds).size) {
          throw new PublicationAbort(
            "MUTABLE_VERSION_PINNED",
            `The published composition would pin editable EntityVersion(s): ${mutable.map((v) => `${v.id} (${v.status})`).join(", ")}. Move them out of DRAFT / IN_REVIEW through the lifecycle before publishing.`,
          );
        }
        if (ruleset.status === "APPROVED") {
          const { count } = await tx.ruleset.updateMany({ where: { id: plan.rulesetId, status: "APPROVED" }, data: { status: "PUBLISHED" } });
          if (count !== 1) throw new PublicationAbort("RELEASE_CONFLICT", "The Ruleset's status changed during publication");
        }
        for (const versionId of plan.deprecations) {
          try {
            await transitionEntityVersionStatusInTransaction(tx, versionId, "DEPRECATED");
          } catch (error) {
            throw new PublicationAbort("INVALID_OPERATION", `Cannot deprecate EntityVersion ${versionId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const manifestId = await insertManifestSnapshotInTransaction(tx, plan.rulesetId, plan.pins, null);
        const stored = await tx.rulesetManifestEntry.findMany({ where: { manifestId }, select: { entityId: true, entityVersionId: true } });
        if (computeManifestHash(stored) !== plan.manifestHash) {
          throw new Error(`Release manifest ${manifestId} does not hash to the planned composition`); // defensive: impossible unless an insert was altered
        }
        const created = await tx.rulesetRelease.create({
          data: {
            rulesetId: plan.rulesetId,
            releaseNumber: (latest?.releaseNumber ?? 0) + 1,
            versionLabel: plan.versionLabel,
            channel: ruleset.channel as RulesetChannel,
            manifestId,
            canonPolicyId: plan.canonPolicyId,
            changeSetId: plan.changeSetId,
            manifestHash: plan.manifestHash,
            releaseNotes: plan.releaseNotes,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      lastError = error;
      if (isManifestVersionViolation(error) || isReleaseNumberViolation(error)) continue; // retry against fresh maxima
      throw error;
    }
  }
  throw lastError;
}
