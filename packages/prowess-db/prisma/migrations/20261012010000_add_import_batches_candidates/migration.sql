-- M3-WO2: Import Batch & Extraction Candidate Foundation.
-- Additive only: five enums, three insert-only tables, and two UNIQUE indexes on WO1 tables that exist solely as
-- composite foreign-key targets (each covers a column set that is already unique). No existing column,
-- constraint or row is altered or removed: every M1/M2/M3-WO1 row stays valid as-is.

-- CreateEnum
CREATE TYPE "ImportBatchScopeType" AS ENUM ('SNAPSHOT', 'SECTION_SUBTREE');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('CREATED', 'EXTRACTING', 'READY_FOR_REVIEW', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExtractionCandidateKind" AS ENUM ('ENTITY', 'ENTITY_FIELD', 'FORMULA', 'REQUIREMENT', 'KEYWORD', 'RELATIONSHIP', 'REFERENCE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExtractionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ExtractionCandidateStatus" AS ENUM ('UNREVIEWED', 'MATCHED', 'NEW_ENTITY', 'CONFLICT', 'NEEDS_MAPPING', 'REJECTED', 'APPROVED');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_snapshot_id" UUID NOT NULL,
    "source_structure_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "scope_type" "ImportBatchScopeType" NOT NULL,
    "scope_section_id" UUID,
    "review_ruleset_id" UUID,
    "comparison_manifest_id" UUID,
    "extractor_key" TEXT NOT NULL,
    "extractor_version" TEXT NOT NULL,
    "extractor_config_hash" TEXT,
    "batch_fingerprint" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_batch_id" UUID NOT NULL,
    "source_snapshot_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "candidate_kind" "ExtractionCandidateKind" NOT NULL,
    "proposed_entity_type" "EntityType",
    "proposed_canonical_key" TEXT,
    "display_label" TEXT NOT NULL,
    "summary" TEXT,
    "confidence" "ExtractionConfidence" NOT NULL,
    "status" "ExtractionCandidateStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "payload_schema_key" TEXT NOT NULL,
    "payload_schema_version" INTEGER NOT NULL,
    "payload_json" JSONB NOT NULL,
    "candidate_fingerprint" TEXT NOT NULL,
    "primary_source_section_id" UUID,
    "primary_source_content_node_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_candidate_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_candidate_id" UUID NOT NULL,
    "source_snapshot_id" UUID NOT NULL,
    "source_section_id" UUID,
    "source_content_node_id" UUID,
    "ordinal" INTEGER NOT NULL,
    "excerpt" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_candidate_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_batch_fingerprint_key" ON "import_batches"("batch_fingerprint");

-- CreateIndex
CREATE INDEX "import_batches_source_snapshot_id_idx" ON "import_batches"("source_snapshot_id");

-- CreateIndex
CREATE INDEX "import_batches_status_idx" ON "import_batches"("status");

-- CreateIndex
CREATE INDEX "import_batches_review_ruleset_id_idx" ON "import_batches"("review_ruleset_id");

-- CreateIndex
CREATE INDEX "import_batches_comparison_manifest_id_idx" ON "import_batches"("comparison_manifest_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_id_snapshot_key" ON "import_batches"("id", "source_snapshot_id");

-- CreateIndex
CREATE INDEX "extraction_candidates_status_idx" ON "extraction_candidates"("status");

-- CreateIndex
CREATE INDEX "extraction_candidates_confidence_idx" ON "extraction_candidates"("confidence");

-- CreateIndex
CREATE INDEX "extraction_candidates_candidate_kind_idx" ON "extraction_candidates"("candidate_kind");

-- CreateIndex
CREATE INDEX "extraction_candidates_proposed_entity_type_idx" ON "extraction_candidates"("proposed_entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_candidates_batch_ordinal_key" ON "extraction_candidates"("import_batch_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_candidates_batch_fingerprint_key" ON "extraction_candidates"("import_batch_id", "candidate_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_candidates_id_snapshot_key" ON "extraction_candidates"("id", "source_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_candidate_sources_candidate_ordinal_key" ON "extraction_candidate_sources"("extraction_candidate_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "source_content_nodes_id_snapshot_key" ON "source_content_nodes"("id", "source_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_snapshot_ingestions_snapshot_structure_hash_key" ON "source_snapshot_ingestions"("source_snapshot_id", "structure_hash");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_structure_hash_fkey" FOREIGN KEY ("source_snapshot_id", "source_structure_hash") REFERENCES "source_snapshot_ingestions"("source_snapshot_id", "structure_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_scope_section_fkey" FOREIGN KEY ("scope_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_review_ruleset_fkey" FOREIGN KEY ("review_ruleset_id") REFERENCES "rulesets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_comparison_manifest_fkey" FOREIGN KEY ("comparison_manifest_id", "review_ruleset_id") REFERENCES "ruleset_manifests"("id", "ruleset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_batch_fkey" FOREIGN KEY ("import_batch_id", "source_snapshot_id") REFERENCES "import_batches"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_primary_section_fkey" FOREIGN KEY ("primary_source_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_primary_content_node_fkey" FOREIGN KEY ("primary_source_content_node_id", "source_snapshot_id") REFERENCES "source_content_nodes"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidate_sources" ADD CONSTRAINT "extraction_candidate_sources_candidate_fkey" FOREIGN KEY ("extraction_candidate_id", "source_snapshot_id") REFERENCES "extraction_candidates"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidate_sources" ADD CONSTRAINT "extraction_candidate_sources_snapshot_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidate_sources" ADD CONSTRAINT "extraction_candidate_sources_section_fkey" FOREIGN KEY ("source_section_id", "source_snapshot_id") REFERENCES "source_sections"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidate_sources" ADD CONSTRAINT "extraction_candidate_sources_content_node_fkey" FOREIGN KEY ("source_content_node_id", "source_snapshot_id") REFERENCES "source_content_nodes"("id", "source_snapshot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (Prisma does not model CHECK constraints, so they are invisible to schema.prisma and to the
-- drift check by design, and are pinned instead by the M3 static audit):

-- Scope shape: a SNAPSHOT Batch has no scope section, a SECTION_SUBTREE Batch always has one.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_scope_check" CHECK (
    ("scope_type" = 'SNAPSHOT'        AND "scope_section_id" IS NULL)
 OR ("scope_type" = 'SECTION_SUBTREE' AND "scope_section_id" IS NOT NULL)
);

-- A comparison Manifest requires its review Ruleset, so the composite (MATCH SIMPLE) Manifest key can never be
-- skipped by leaving review_ruleset_id NULL.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_comparison_requires_ruleset_check" CHECK (
    "comparison_manifest_id" IS NULL OR "review_ruleset_id" IS NOT NULL
);

-- Exactly one primary anchor per Candidate, and exactly one anchor per supporting source.
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_exactly_one_primary_anchor_check" CHECK (
    ("primary_source_section_id" IS NOT NULL AND "primary_source_content_node_id" IS NULL)
 OR ("primary_source_section_id" IS NULL     AND "primary_source_content_node_id" IS NOT NULL)
);
ALTER TABLE "extraction_candidate_sources" ADD CONSTRAINT "extraction_candidate_sources_exactly_one_anchor_check" CHECK (
    ("source_section_id" IS NOT NULL AND "source_content_node_id" IS NULL)
 OR ("source_section_id" IS NULL     AND "source_content_node_id" IS NOT NULL)
);

-- Ordinals and schema versions are positive.
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_positive_check" CHECK ("ordinal" >= 1 AND "payload_schema_version" >= 1);
ALTER TABLE "extraction_candidate_sources" ADD CONSTRAINT "extraction_candidate_sources_ordinal_check" CHECK ("ordinal" >= 1);

-- The payload is a JSON object, never a bare array / string / number.
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_payload_object_check" CHECK (jsonb_typeof("payload_json") = 'object');
