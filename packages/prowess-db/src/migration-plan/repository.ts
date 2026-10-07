import {
  EntityId,
  EntityVersionId,
  MigrationPlanId,
  MigrationPlanItemId,
  RulesetReleaseId,
  type MigrationAssessmentItem,
  type MigrationChangeType,
  type MigrationCompatibilityClassification,
  type MigrationPlan,
  type MigrationPlanItem,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { MigrationPlan as PlanRow, MigrationPlanItem as ItemRow } from "../../generated/prisma/client.js";

/**
 * MigrationPlan repository (PAS-10 M2-WO11). Internal to @prowess/db. WRITES exactly two things — a new plan and its
 * items, in one transaction — and reads only its own tables. It never touches a Release, manifest, Version or anything
 * else: preview and assessment read Releases through the WO8 release services.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export function toDomainPlan(row: PlanRow): MigrationPlan {
  return {
    id: MigrationPlanId.of(row.id),
    sourceReleaseId: RulesetReleaseId.of(row.sourceReleaseId),
    targetReleaseId: RulesetReleaseId.of(row.targetReleaseId),
    sourceManifestHash: row.sourceManifestHash,
    targetManifestHash: row.targetManifestHash,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
  };
}

export function toDomainItem(row: ItemRow): MigrationPlanItem {
  return {
    id: MigrationPlanItemId.of(row.id),
    migrationPlanId: MigrationPlanId.of(row.migrationPlanId),
    entityId: EntityId.of(row.entityId),
    sourceEntityVersionId: row.sourceEntityVersionId === null ? null : EntityVersionId.of(row.sourceEntityVersionId),
    targetEntityVersionId: row.targetEntityVersionId === null ? null : EntityVersionId.of(row.targetEntityVersionId),
    changeType: row.changeType as MigrationChangeType,
    compatibilityClassification: row.compatibilityClassification as MigrationCompatibilityClassification,
    createdAt: row.createdAt,
  };
}

export interface MigrationPlanInsert {
  sourceReleaseId: string;
  targetReleaseId: string;
  sourceManifestHash: string;
  targetManifestHash: string;
  name: string;
  description: string | null;
}

/** Plan + every item in ONE transaction: a failure on any item (or anything else) leaves no plan and no items. */
export async function insertMigrationPlanWithItems(plan: MigrationPlanInsert, items: readonly MigrationAssessmentItem[]): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.migrationPlan.create({ data: plan, select: { id: true } });
    for (const item of items) {
      await tx.migrationPlanItem.create({
        data: {
          migrationPlanId: created.id,
          entityId: item.entityId,
          sourceEntityVersionId: item.sourceEntityVersionId,
          targetEntityVersionId: item.targetEntityVersionId,
          changeType: item.changeType,
          compatibilityClassification: item.compatibilityClassification,
        },
        select: { id: true },
      });
    }
    return created.id;
  });
}

export async function selectMigrationPlanById(id: string): Promise<MigrationPlan | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.migrationPlan.findUnique({ where: { id } });
  return row === null ? null : toDomainPlan(row);
}

/** Items ordered by Entity id ascending — the same order the pure assessment produces. */
export async function selectMigrationPlanItems(planId: string): Promise<MigrationPlanItem[]> {
  const rows = await prisma.migrationPlanItem.findMany({ where: { migrationPlanId: planId }, orderBy: { entityId: "asc" } });
  return rows.map(toDomainItem);
}

/** Plans (headers), `created_at ASC, id ASC`, optionally by exact source / target Release. */
export async function selectMigrationPlans(where: { sourceReleaseId?: string; targetReleaseId?: string }): Promise<MigrationPlan[]> {
  const rows = await prisma.migrationPlan.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(toDomainPlan);
}

/** Which of the item foreign keys a write violated (P2003), or null. Duck-typed, as elsewhere in M2. */
export function violatedItemVersionKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== "P2003") return false;
  const e = error as { message?: unknown; meta?: unknown };
  let haystack = typeof e.message === "string" ? e.message : "";
  try {
    haystack += ` ${JSON.stringify(e.meta ?? null)}`;
  } catch {
    // diagnostic only
  }
  return /migration_plan_items_(source_version|target_version|entity)_fkey/.test(haystack);
}
