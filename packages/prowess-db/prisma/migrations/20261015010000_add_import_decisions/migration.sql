-- M3-WO6: Conflict Detection & Import Review Decisions.
-- Additive only: two enums, one insert-only table (import_decisions), and three UNIQUE indexes on earlier import
-- tables that exist solely as composite foreign-key targets (each contains the primary key, so none adds a real
-- constraint). No existing column, constraint or row is altered or removed.

-- CreateEnum
CREATE TYPE "ImportDecisionType" AS ENUM ('CLASSIFY_MATCHED', 'CLASSIFY_NEW_ENTITY', 'MARK_CONFLICT', 'MARK_NEEDS_MAPPING', 'REJECT', 'APPROVE_MATCHED', 'APPROVE_NEW_ENTITY', 'APPROVE_SEMANTIC');

-- CreateEnum
CREATE TYPE "ImportMatchDecisionBasis" AS ENUM ('EXACT_MATCH', 'SUGGESTED_MATCH', 'MANUAL_OVERRIDE');

-- CreateTable
CREATE TABLE "import_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_batch_id" UUID NOT NULL,
    "candidate_set_hash" TEXT NOT NULL,
    "extraction_candidate_id" UUID NOT NULL,
    "candidate_fingerprint" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "decision_type" "ImportDecisionType" NOT NULL,
    "from_status" "ExtractionCandidateStatus" NOT NULL,
    "to_status" "ExtractionCandidateStatus" NOT NULL,
    "match_basis" "ImportMatchDecisionBasis",
    "match_run_id" UUID,
    "match_assessment_id" UUID,
    "duplicate_group_id" UUID,
    "target_entity_id" UUID,
    "comparison_entity_version_id" UUID,
    "rationale" TEXT,
    "decision_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_decisions_decision_fingerprint_key" ON "import_decisions"("decision_fingerprint");

-- CreateIndex
CREATE INDEX "import_decisions_import_batch_id_idx" ON "import_decisions"("import_batch_id");

-- CreateIndex
CREATE INDEX "import_decisions_target_entity_id_idx" ON "import_decisions"("target_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_decisions_candidate_sequence_key" ON "import_decisions"("extraction_candidate_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_duplicate_groups_id_run_key" ON "candidate_duplicate_groups"("id", "match_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_match_assessments_id_run_candidate_key" ON "candidate_match_assessments"("id", "match_run_id", "extraction_candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_candidates_id_fingerprint_key" ON "extraction_candidates"("id", "candidate_fingerprint");

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_candidate_set_fkey" FOREIGN KEY ("import_batch_id", "candidate_set_hash") REFERENCES "import_batches"("id", "extraction_output_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_candidate_fkey" FOREIGN KEY ("extraction_candidate_id", "import_batch_id") REFERENCES "extraction_candidates"("id", "import_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_candidate_fingerprint_fkey" FOREIGN KEY ("extraction_candidate_id", "candidate_fingerprint") REFERENCES "extraction_candidates"("id", "candidate_fingerprint") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_match_run_fkey" FOREIGN KEY ("match_run_id", "import_batch_id") REFERENCES "import_match_runs"("id", "import_batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_match_assessment_fkey" FOREIGN KEY ("match_assessment_id", "match_run_id", "extraction_candidate_id") REFERENCES "candidate_match_assessments"("id", "match_run_id", "extraction_candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_duplicate_group_fkey" FOREIGN KEY ("duplicate_group_id", "match_run_id") REFERENCES "candidate_duplicate_groups"("id", "match_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_duplicate_member_fkey" FOREIGN KEY ("duplicate_group_id", "extraction_candidate_id") REFERENCES "candidate_duplicate_group_members"("group_id", "extraction_candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_target_entity_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_comparison_version_fkey" FOREIGN KEY ("comparison_entity_version_id", "target_entity_id") REFERENCES "entity_versions"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (Prisma does not model CHECK constraints, so they are pinned by the M3 static audit). The full
-- workflow graph lives in the service (transactionally protected), and these pin the simple structural invariants.

-- Each decision type moves to exactly one status, and never to the status it came from.
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_type_status_check" CHECK (
    "from_status" <> "to_status" AND (
       ("decision_type" = 'CLASSIFY_MATCHED'    AND "to_status" = 'MATCHED')
    OR ("decision_type" = 'CLASSIFY_NEW_ENTITY' AND "to_status" = 'NEW_ENTITY')
    OR ("decision_type" = 'MARK_CONFLICT'       AND "to_status" = 'CONFLICT')
    OR ("decision_type" = 'MARK_NEEDS_MAPPING'  AND "to_status" = 'NEEDS_MAPPING')
    OR ("decision_type" = 'REJECT'              AND "to_status" = 'REJECTED')
    OR ("decision_type" IN ('APPROVE_MATCHED', 'APPROVE_NEW_ENTITY', 'APPROVE_SEMANTIC') AND "to_status" = 'APPROVED')
    ) AND "from_status" NOT IN ('APPROVED', 'REJECTED')
);

-- Target Entity: required to classify / approve a match, forbidden for new-Entity, semantic, mapping and rejection
-- decisions (no Entity is chosen, created or reserved), optional only for MARK_CONFLICT.
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_target_entity_check" CHECK (
    ("decision_type" IN ('CLASSIFY_MATCHED', 'APPROVE_MATCHED') AND "target_entity_id" IS NOT NULL)
 OR ("decision_type" = 'MARK_CONFLICT')
 OR ("decision_type" IN ('CLASSIFY_NEW_ENTITY', 'APPROVE_NEW_ENTITY', 'APPROVE_SEMANTIC', 'MARK_NEEDS_MAPPING', 'REJECT') AND "target_entity_id" IS NULL)
);

-- A match basis exists for, and only for, CLASSIFY_MATCHED. MANUAL_OVERRIDE and REJECT require a rationale.
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_match_basis_check" CHECK (
    ("decision_type" = 'CLASSIFY_MATCHED') = ("match_basis" IS NOT NULL)
);
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_rationale_check" CHECK (
    ("match_basis" IS DISTINCT FROM 'MANUAL_OVERRIDE' AND "decision_type" <> 'REJECT')
 OR ("rationale" IS NOT NULL AND length(btrim("rationale")) > 0)
);

-- Evidence cited only with what it belongs to, so no composite (MATCH SIMPLE) key can be skipped.
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_evidence_check" CHECK (
    ("match_assessment_id" IS NULL OR "match_run_id" IS NOT NULL)
 AND ("duplicate_group_id" IS NULL OR "match_run_id" IS NOT NULL)
 AND ("comparison_entity_version_id" IS NULL OR "target_entity_id" IS NOT NULL)
);

-- Positive sequence, and lowercase SHA-256 hex hashes.
ALTER TABLE "import_decisions" ADD CONSTRAINT "import_decisions_sequence_hash_check" CHECK (
    "sequence_number" >= 1
 AND "candidate_fingerprint" ~ '^[0-9a-f]{64}$' AND "candidate_set_hash" ~ '^[0-9a-f]{64}$' AND "decision_fingerprint" ~ '^[0-9a-f]{64}$'
);
