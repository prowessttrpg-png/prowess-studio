-- CreateEnum
CREATE TYPE "EntityVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PLAYTEST', 'CANON', 'DEPRECATED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('EDITORIAL', 'CLARIFICATION', 'PRESENTATION', 'MECHANICAL_PATCH', 'MECHANICAL_CHANGE', 'BREAKING_CHANGE', 'CONTENT_ADDITION', 'REMOVAL', 'RENAME', 'RESTRUCTURE');

-- CreateTable
CREATE TABLE "entity_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "EntityVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "display_name" TEXT NOT NULL,
    "short_description" TEXT,
    "rules_text" TEXT,
    "structured_data" JSONB NOT NULL DEFAULT '{}',
    "parent_version_id" UUID,
    "change_type" "ChangeType",
    "change_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_versions_entity_id_revision_number_key" ON "entity_versions"("entity_id", "revision_number");

-- AddForeignKey
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "entity_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
