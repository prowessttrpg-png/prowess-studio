-- CreateEnum
CREATE TYPE "RuleConflictType" AS ENUM ('SOURCE_CONTRADICTION', 'MECHANICAL_DIVERGENCE', 'TERMINOLOGY_DIVERGENCE', 'STRUCTURAL_DIVERGENCE', 'AUTHORING_STANDARD_CONFLICT', 'OTHER');

-- CreateEnum
CREATE TYPE "RuleConflictSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RuleConflictStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'ACCEPTED_DIVERGENCE', 'DISMISSED');

-- CreateTable
CREATE TABLE "rule_conflicts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleset_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "conflict_type" "RuleConflictType" NOT NULL,
    "severity" "RuleConflictSeverity" NOT NULL,
    "status" "RuleConflictStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_conflict_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rule_conflict_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_version_id" UUID NOT NULL,
    "source_reference_id" UUID,
    "label" TEXT,
    "position_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_conflict_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rule_conflicts_ruleset_id_entity_id_idx" ON "rule_conflicts"("ruleset_id", "entity_id");

-- CreateIndex
CREATE INDEX "rule_conflicts_ruleset_id_status_idx" ON "rule_conflicts"("ruleset_id", "status");

-- CreateIndex
CREATE INDEX "rule_conflicts_entity_id_idx" ON "rule_conflicts"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_conflicts_id_entity_id_key" ON "rule_conflicts"("id", "entity_id");

-- CreateIndex
CREATE INDEX "rule_conflict_candidates_entity_version_id_idx" ON "rule_conflict_candidates"("entity_version_id");

-- CreateIndex
CREATE INDEX "rule_conflict_candidates_source_reference_id_idx" ON "rule_conflict_candidates"("source_reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_conflict_candidates_conflict_version_key" ON "rule_conflict_candidates"("rule_conflict_id", "entity_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_references_id_entity_version_id_key" ON "source_references"("id", "entity_version_id");

-- AddForeignKey
ALTER TABLE "rule_conflicts" ADD CONSTRAINT "rule_conflicts_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_conflicts" ADD CONSTRAINT "rule_conflicts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_conflict_candidates" ADD CONSTRAINT "rule_conflict_candidates_conflict_entity_fkey" FOREIGN KEY ("rule_conflict_id", "entity_id") REFERENCES "rule_conflicts"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_conflict_candidates" ADD CONSTRAINT "rule_conflict_candidates_version_entity_fkey" FOREIGN KEY ("entity_version_id", "entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_conflict_candidates" ADD CONSTRAINT "rule_conflict_candidates_source_reference_fkey" FOREIGN KEY ("source_reference_id", "entity_version_id") REFERENCES "source_references"("id", "entity_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;
