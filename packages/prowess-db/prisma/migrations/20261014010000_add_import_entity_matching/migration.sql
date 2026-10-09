-- M3-WO4: Entity Matching, Normalization & Duplicate Detection.
-- Additive only: three enums, five insert-only analysis tables, and three UNIQUE indexes on earlier import tables
-- that exist solely as composite foreign-key targets (each covers a column set that is already unique, since it
-- contains the primary key). No existing column, constraint or row is altered or removed.

-- CreateEnum
CREATE TYPE "ImportMatchOutcome" AS ENUM ('EXACT_MATCH', 'POTENTIAL_MATCH', 'NO_MATCH', 'INSUFFICIENT_IDENTITY', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ImportMatchBasis" AS ENUM ('CANONICAL_KEY_EXACT', 'ALIAS_EXACT', 'DISPLAY_LABEL_EXACT', 'NORMALIZED_LABEL', 'FUZZY_LABEL', 'NONE');

-- CreateEnum
CREATE TYPE "CandidateDuplicateBasis" AS ENUM ('PROPOSED_CANONICAL_KEY', 'NORMALIZED_LABEL');

-- CreateTable
CREATE TABLE "import_match_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_batch_id" UUID NOT NULL,
    "candidate_set_hash" TEXT NOT NULL,
    "comparison_manifest_id" UUID,
    "matcher_key" TEXT NOT NULL,
    "matcher_version" TEXT NOT NULL,
    "matcher_config_hash" TEXT NOT NULL,
    "matcher_config_json" JSONB NOT NULL,
    "entity_catalog_hash" TEXT NOT NULL,
    "run_fingerprint" TEXT NOT NULL,
    "result_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_match_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_match_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "match_run_id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "extraction_candidate_id" UUID NOT NULL,
    "outcome" "ImportMatchOutcome" NOT NULL,
    "matched_by" "ImportMatchBasis" NOT NULL,
    "matched_entity_id" UUID,
    "normalized_candidate_label" TEXT,
    "normalized_proposed_canonical_key" TEXT,
    "comparison_entity_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_match_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_match_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_match_assessment_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "basis" "ImportMatchBasis" NOT NULL,
    "comparison_entity_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_match_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_duplicate_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "match_run_id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "basis" "CandidateDuplicateBasis" NOT NULL,
    "identity_key" TEXT NOT NULL,
    "identity_key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_duplicate_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_duplicate_group_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "extraction_candidate_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_duplicate_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_match_runs_run_fingerprint_key" ON "import_match_runs"("run_fingerprint");

-- CreateIndex
CREATE INDEX "import_match_runs_import_batch_id_idx" ON "import_match_runs"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_match_runs_id_batch_key" ON "import_match_runs"("id", "import_batch_id");

-- CreateIndex
CREATE INDEX "candidate_match_assessments_extraction_candidate_id_idx" ON "candidate_match_assessments"("extraction_candidate_id");

-- CreateIndex
CREATE INDEX "candidate_match_assessments_matched_entity_id_idx" ON "candidate_match_assessments"("matched_entity_id");

-- CreateIndex
CREATE INDEX "candidate_match_assessments_outcome_idx" ON "candidate_match_assessments"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_match_assessments_run_candidate_key" ON "candidate_match_assessments"("match_run_id", "extraction_candidate_id");

-- CreateIndex
CREATE INDEX "candidate_match_suggestions_entity_id_idx" ON "candidate_match_suggestions"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_match_suggestions_assessment_rank_key" ON "candidate_match_suggestions"("candidate_match_assessment_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_match_suggestions_assessment_entity_key" ON "candidate_match_suggestions"("candidate_match_assessment_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_duplicate_groups_run_identity_key" ON "candidate_duplicate_groups"("match_run_id", "basis", "identity_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_duplicate_groups_id_batch_key" ON "candidate_duplicate_groups"("id", "import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_duplicate_group_members_group_candidate_key" ON "candidate_duplicate_group_members"("group_id", "extraction_candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_duplicate_group_members_group_ordinal_key" ON "candidate_duplicate_group_members"("group_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_candidates_id_batch_key" ON "extraction_candidates"("id", "import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_id_extraction_output_hash_key" ON "import_batches"("id", "extraction_output_hash");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_id_comparison_manifest_key" ON "import_batches"("id", "comparison_manifest_id");

-- AddForeignKey
ALTER TABLE "import_match_runs" ADD CONSTRAINT "import_match_runs_candidate_set_fkey" FOREIGN KEY ("import_batch_id", "candidate_set_hash") REFERENCES "import_batches"("id", "extraction_output_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_match_runs" ADD CONSTRAINT "import_match_runs_comparison_manifest_fkey" FOREIGN KEY ("import_batch_id", "comparison_manifest_id") REFERENCES "import_batches"("id", "comparison_manifest_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_run_fkey" FOREIGN KEY ("match_run_id", "import_batch_id") REFERENCES "import_match_runs"("id", "import_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_batch_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_candidate_fkey" FOREIGN KEY ("extraction_candidate_id", "import_batch_id") REFERENCES "extraction_candidates"("id", "import_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_entity_fkey" FOREIGN KEY ("matched_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_comparison_version_fkey" FOREIGN KEY ("comparison_entity_version_id", "matched_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_suggestions" ADD CONSTRAINT "candidate_match_suggestions_assessment_fkey" FOREIGN KEY ("candidate_match_assessment_id") REFERENCES "candidate_match_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_suggestions" ADD CONSTRAINT "candidate_match_suggestions_entity_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_match_suggestions" ADD CONSTRAINT "candidate_match_suggestions_comparison_version_fkey" FOREIGN KEY ("comparison_entity_version_id", "entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_duplicate_groups" ADD CONSTRAINT "candidate_duplicate_groups_run_fkey" FOREIGN KEY ("match_run_id", "import_batch_id") REFERENCES "import_match_runs"("id", "import_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_duplicate_groups" ADD CONSTRAINT "candidate_duplicate_groups_batch_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_duplicate_group_members" ADD CONSTRAINT "candidate_duplicate_group_members_group_fkey" FOREIGN KEY ("group_id", "import_batch_id") REFERENCES "candidate_duplicate_groups"("id", "import_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_duplicate_group_members" ADD CONSTRAINT "candidate_duplicate_group_members_batch_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_duplicate_group_members" ADD CONSTRAINT "candidate_duplicate_group_members_candidate_fkey" FOREIGN KEY ("extraction_candidate_id", "import_batch_id") REFERENCES "extraction_candidates"("id", "import_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (Prisma does not model CHECK constraints, so they are pinned by the M3 static audit):

-- An authoritative matched Entity exists for, and only for, EXACT_MATCH, and only an exact canonical-key or alias
-- basis can establish it. Outcomes without any match evidence carry basis NONE.
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_exact_match_check" CHECK (
    ("outcome" = 'EXACT_MATCH' AND "matched_entity_id" IS NOT NULL AND "matched_by" IN ('CANONICAL_KEY_EXACT', 'ALIAS_EXACT'))
 OR ("outcome" <> 'EXACT_MATCH' AND "matched_entity_id" IS NULL)
);
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_no_evidence_basis_check" CHECK (
    "outcome" IN ('EXACT_MATCH', 'POTENTIAL_MATCH') OR "matched_by" = 'NONE'
);

-- A comparison Version is cited only together with the Entity it belongs to, so the composite (MATCH SIMPLE) key onto
-- entity_versions(id, entity_id) can never be skipped.
ALTER TABLE "candidate_match_assessments" ADD CONSTRAINT "candidate_match_assessments_comparison_requires_entity_check" CHECK (
    "comparison_entity_version_id" IS NULL OR "matched_entity_id" IS NOT NULL
);

-- Suggestions: positive rank, score in [0, 1], a real basis.
ALTER TABLE "candidate_match_suggestions" ADD CONSTRAINT "candidate_match_suggestions_rank_score_check" CHECK (
    "rank" >= 1 AND "score" >= 0 AND "score" <= 1 AND "basis" <> 'NONE'
);

-- Duplicate members: positive display ordinal.
ALTER TABLE "candidate_duplicate_group_members" ADD CONSTRAINT "candidate_duplicate_group_members_ordinal_check" CHECK ("ordinal" >= 1);

-- Hashes are lowercase SHA-256 hex digests.
ALTER TABLE "import_match_runs" ADD CONSTRAINT "import_match_runs_hash_format_check" CHECK (
    "candidate_set_hash" ~ '^[0-9a-f]{64}$' AND "entity_catalog_hash" ~ '^[0-9a-f]{64}$' AND "matcher_config_hash" ~ '^[0-9a-f]{64}$'
 AND "run_fingerprint" ~ '^[0-9a-f]{64}$' AND "result_hash" ~ '^[0-9a-f]{64}$'
);
ALTER TABLE "candidate_duplicate_groups" ADD CONSTRAINT "candidate_duplicate_groups_identity_key_hash_check" CHECK ("identity_key_hash" ~ '^[0-9a-f]{64}$');
