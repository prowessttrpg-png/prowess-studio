-- CreateEnum
CREATE TYPE "ChangeSetStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ChangeSetOperationType" AS ENUM ('PIN_ENTITY_VERSION', 'REPLACE_ENTITY_VERSION', 'ADD_ENTITY_TO_MANIFEST', 'REMOVE_ENTITY_FROM_MANIFEST', 'CREATE_ENTITY_VERSION', 'DEPRECATE_ENTITY_VERSION', 'NO_CHANGE');

-- CreateTable
CREATE TABLE "change_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleset_id" UUID NOT NULL,
    "canon_decision_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ChangeSetStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_set_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "change_set_id" UUID NOT NULL,
    "ruleset_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "operation_type" "ChangeSetOperationType" NOT NULL,
    "target_entity_id" UUID,
    "from_entity_version_id" UUID,
    "to_entity_version_id" UUID,
    "target_manifest_id" UUID,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_set_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_sets_ruleset_id_idx" ON "change_sets"("ruleset_id");

-- CreateIndex
CREATE INDEX "change_sets_canon_decision_id_idx" ON "change_sets"("canon_decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_sets_id_ruleset_id_key" ON "change_sets"("id", "ruleset_id");

-- CreateIndex
CREATE INDEX "change_set_operations_target_entity_id_idx" ON "change_set_operations"("target_entity_id");

-- CreateIndex
CREATE INDEX "change_set_operations_from_entity_version_id_idx" ON "change_set_operations"("from_entity_version_id");

-- CreateIndex
CREATE INDEX "change_set_operations_to_entity_version_id_idx" ON "change_set_operations"("to_entity_version_id");

-- CreateIndex
CREATE INDEX "change_set_operations_target_manifest_id_idx" ON "change_set_operations"("target_manifest_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_set_operations_change_set_id_sequence_key" ON "change_set_operations"("change_set_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "canon_decisions_id_ruleset_id_key" ON "canon_decisions"("id", "ruleset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ruleset_manifests_id_ruleset_id_key" ON "ruleset_manifests"("id", "ruleset_id");

-- AddForeignKey
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_canon_decision_fkey" FOREIGN KEY ("canon_decision_id", "ruleset_id") REFERENCES "canon_decisions"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set_operations" ADD CONSTRAINT "change_set_operations_change_set_fkey" FOREIGN KEY ("change_set_id", "ruleset_id") REFERENCES "change_sets"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set_operations" ADD CONSTRAINT "change_set_operations_target_entity_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set_operations" ADD CONSTRAINT "change_set_operations_from_version_fkey" FOREIGN KEY ("from_entity_version_id", "target_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set_operations" ADD CONSTRAINT "change_set_operations_to_version_fkey" FOREIGN KEY ("to_entity_version_id", "target_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set_operations" ADD CONSTRAINT "change_set_operations_target_manifest_fkey" FOREIGN KEY ("target_manifest_id", "ruleset_id") REFERENCES "ruleset_manifests"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
