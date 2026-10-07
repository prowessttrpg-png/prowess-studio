-- CreateEnum
CREATE TYPE "MigrationChangeType" AS ENUM ('UNCHANGED', 'ADDED_ENTITY', 'REMOVED_ENTITY', 'CHANGED_VERSION');

-- CreateEnum
CREATE TYPE "MigrationCompatibilityClassification" AS ENUM ('UNCHANGED', 'RECALCULATE_ONLY', 'VALID_WITH_CHANGES', 'REVIEW_REQUIRED', 'INVALID', 'UNSUPPORTED');

-- CreateTable
CREATE TABLE "migration_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_release_id" UUID NOT NULL,
    "target_release_id" UUID NOT NULL,
    "source_manifest_hash" TEXT NOT NULL,
    "target_manifest_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_plan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "migration_plan_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "source_entity_version_id" UUID,
    "target_entity_version_id" UUID,
    "change_type" "MigrationChangeType" NOT NULL,
    "compatibility_classification" "MigrationCompatibilityClassification" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "migration_plans_source_release_id_idx" ON "migration_plans"("source_release_id");

-- CreateIndex
CREATE INDEX "migration_plans_target_release_id_idx" ON "migration_plans"("target_release_id");

-- CreateIndex
CREATE INDEX "migration_plan_items_entity_id_idx" ON "migration_plan_items"("entity_id");

-- CreateIndex
CREATE INDEX "migration_plan_items_source_entity_version_id_idx" ON "migration_plan_items"("source_entity_version_id");

-- CreateIndex
CREATE INDEX "migration_plan_items_target_entity_version_id_idx" ON "migration_plan_items"("target_entity_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "migration_plan_items_plan_entity_key" ON "migration_plan_items"("migration_plan_id", "entity_id");

-- AddForeignKey
ALTER TABLE "migration_plans" ADD CONSTRAINT "migration_plans_source_release_fkey" FOREIGN KEY ("source_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_plans" ADD CONSTRAINT "migration_plans_target_release_fkey" FOREIGN KEY ("target_release_id") REFERENCES "ruleset_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_plan_items" ADD CONSTRAINT "migration_plan_items_plan_fkey" FOREIGN KEY ("migration_plan_id") REFERENCES "migration_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_plan_items" ADD CONSTRAINT "migration_plan_items_entity_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_plan_items" ADD CONSTRAINT "migration_plan_items_source_version_fkey" FOREIGN KEY ("source_entity_version_id", "entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_plan_items" ADD CONSTRAINT "migration_plan_items_target_version_fkey" FOREIGN KEY ("target_entity_version_id", "entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;
